import { createAssistantRuntime } from './runtime'
import { getAssistantRunMessageAttribution } from './application/actualExecutionAttribution'
import type { AssistantRun, AssistantRunPersistence, ContextSnapshot, RunJournalEntry } from './contracts'
import type { ProviderExecutionTarget, ProviderGateway } from '@/modules/providers'
import { asAssistantRunId, asContextSnapshotId, CHAT_REQUEST_SCHEMA, type ChatRequest } from '@/core'

const target: ProviderExecutionTarget = {
  providerId: 'actual', model: 'upstream', credentialSource: { kind: 'group', groupId: 'default' },
  protocolAdapterId: 'anthropic', endpointVariant: 'direct', attemptId: 'attempt-1',
}
const context: ContextSnapshot = { schema: 'islemind.context-snapshot.v1', id: asContextSnapshotId('context'), createdAt: 1, conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] }
const request: ChatRequest = { schema: CHAT_REQUEST_SCHEMA, conversationId: 'conversation', providerId: 'preferred', model: 'alias', messages: [], generationParameterSources: {} }

function fixture(gateway: ProviderGateway) {
  const runs = new Map<string, AssistantRun>()
  const journal: RunJournalEntry[] = []
  const persistence: AssistantRunPersistence = {
    get: async (id) => runs.get(id), getLatestForResponseMessage: async () => [...runs.values()].at(-1),
    listRecoverable: async () => [...runs.values()].filter((run) => run.status === 'running'),
    save: async (run) => { runs.set(run.id, run) }, append: async (entry) => { journal.push(entry) }, list: async () => journal,
    getRequestSnapshot: async () => undefined, getLatestContextReceipt: async () => undefined, clear: async () => { runs.clear() },
    appendAndSave: async (entry, run) => { journal.push(entry); runs.set(run.id, run) },
  }
  let sequence = 0
  return { persistence, journal, runtime: createAssistantRuntime({ persistence, providerGateway: gateway, clock: { now: () => ++sequence }, ids: { next: (prefix) => `${prefix}-${++sequence}` } }) }
}

describe('durable actual producing route', () => {
  it('persists actual Plain attribution and does not copy credential identity into messages/results/checkpoints', async () => {
    const { runtime, journal } = fixture({ describe: () => undefined, async *stream(_request, options) {
      await options.onExecutionTarget?.(target)
      yield { type: 'text-delta', text: 'actual answer' }
    } })
    const outcome = await runtime.execute({ request, context })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value).toMatchObject({ providerId: 'actual', model: 'upstream', routeDetails: { credentialSource: target.credentialSource, protocolAdapterId: 'anthropic' } })
    expect(journal.find((entry) => entry.type === 'provider.route-selected')?.data?.attemptId).toBe('attempt-1')
    const attribution = getAssistantRunMessageAttribution(outcome.value)
    expect(attribution).toEqual({ providerId: 'actual', model: 'upstream', generationProtocol: { schema: 'islemind.message-protocol.v1', adapterId: 'anthropic' } })
    expect(JSON.stringify([attribution, outcome.value.checkpoint, outcome.value.result])).not.toContain('credentialSource')
  })

  it('uses the same Rich activity callback and preserves the producer when a later attempt has no output', async () => {
    const { runtime } = fixture({ describe: () => undefined, async *stream() {} })
    const outcome = await runtime.executeActivity({ kind: 'chat', conversationId: 'conversation', context, providerId: 'preferred', model: 'alias', executor: {
      async execute(input) {
        await input.recordProviderExecutionTarget?.(target)
        await input.checkpointTextDelta?.('retained answer')
        await input.recordProviderExecutionTarget?.({ ...target, providerId: 'attempt-only', model: 'no-output', attemptId: 'attempt-2' })
        return { outputText: 'retained answer' }
      },
    } })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(getAssistantRunMessageAttribution(outcome.value)?.providerId).toBe('actual')
  })

  it.each([false, true])('retains cancellation attribution only with provider output (output=%s)', async (withOutput) => {
    const controller = new AbortController()
    const { runtime, persistence } = fixture({ describe: () => undefined, async *stream(_request, options) {
      await options.onExecutionTarget?.(target)
      if (withOutput) yield { type: 'text-delta', text: 'partial' }
      controller.abort()
    } })
    await runtime.execute({ runId: asAssistantRunId('cancelled'), request, context, cancellationSignal: controller.signal })
    const run = (await persistence.get(asAssistantRunId('cancelled')))!
    expect(run.status).toBe('cancelled')
    expect(getAssistantRunMessageAttribution(run)?.providerId).toBe(withOutput ? 'actual' : undefined)
  })

  it('never fabricates historical route details from the original preference', async () => {
    const { runtime } = fixture({ describe: () => undefined, async *stream() { yield { type: 'text-delta', text: 'legacy' } } })
    const outcome = await runtime.execute({ request, context })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(getAssistantRunMessageAttribution(outcome.value)).toBeUndefined()
  })

  it('keeps actual attribution for cancelled tool-only output without inventing text', async () => {
    const controller = new AbortController()
    const { runtime, persistence } = fixture({ describe: () => undefined, async *stream(_request, options) {
      await options.onExecutionTarget?.(target)
      yield { type: 'tool-call', toolCallId: 'call', toolName: 'lookup', arguments: {} }
      controller.abort()
    } })
    await runtime.execute({ runId: asAssistantRunId('tool-only'), request, context, cancellationSignal: controller.signal })
    const run = (await persistence.get(asAssistantRunId('tool-only')))!
    expect(run.status).toBe('cancelled')
    expect(run.checkpoint?.outputText).toBe('')
    expect(getAssistantRunMessageAttribution(run)?.providerId).toBe('actual')
  })

  it('does not dispatch or attribute output if the actual-target journal barrier fails', async () => {
    let dispatched = false
    const { runtime, persistence } = fixture({ describe: () => undefined, async *stream(_request, options) {
      await options.onExecutionTarget?.(target)
      dispatched = true
      yield { type: 'text-delta', text: 'must not appear' }
    } })
    const appendAndSave = persistence.appendAndSave!
    persistence.appendAndSave = async (entry, run) => {
      if (entry.type === 'provider.route-selected' && entry.data?.attemptId) throw new Error('disk failure')
      return appendAndSave(entry, run)
    }
    const outcome = await runtime.execute({ runId: asAssistantRunId('blocked'), request, context })
    expect(outcome.ok).toBe(false)
    expect(dispatched).toBe(false)
    expect(getAssistantRunMessageAttribution((await persistence.get(asAssistantRunId('blocked')))!)).toBeUndefined()
  })
})
