import { describe, expect, it } from '@jest/globals'
import { asAssistantRunId, asContextSnapshotId, CHAT_REQUEST_SCHEMA, type ChatRequest, type StreamEvent } from '@/core'
import type { ProviderGateway } from '@/modules/providers'
import { createExecutionResources, ExecutionResourceError } from '@/modules/tasks'
import type { AssistantModelOperationSession, AssistantRunGovernance } from './contracts'
import { createAssistantRuntime } from './runtime'
import { createInMemoryRunStore } from './testing/inMemoryRunStore'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

const request: ChatRequest = { schema: CHAT_REQUEST_SCHEMA, conversationId: 'conversation', providerId: 'provider', model: 'model',
  messages: [{ id: 'user', role: 'user', text: 'work' }], generationParameterSources: {} }
const context = { schema: 'islemind.context-snapshot.v1' as const, id: asContextSnapshotId('context'), createdAt: 1,
  conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] }
const id = asAssistantRunId('resource-run')

function fixture(gateway: ProviderGateway, maxTextBytes = 8 * 1024 * 1024, maxOutputChars?: number) {
  const resources = createExecutionResources({ maxTextBytes })
  const persistence = createInMemoryRunStore()
  const governance: AssistantRunGovernance = {
    reserveText: resources.reserveText,
    reserveStopText: resources.reserveStopText,
    async created() {}, async lifecycle() {}, async beforeAttempt() {},
    admissionPauseReason: (error) => error instanceof ExecutionResourceError ? 'memory_pressure' : undefined,
  }
  const runtime = createAssistantRuntime({ persistence, governance, providerGateway: gateway,
    clock: { now: () => 1 }, ids: { next: () => 'unused' }, options: { maxOutputChars } })
  return { resources, persistence, governance, runtime }
}

describe('Harness managed text lifecycle', () => {
  it('refuses an oversized raw provider delta before output truncation or checkpoint retention', async () => {
    const fx = fixture({ describe: () => undefined, async *stream() {
      yield { type: 'text-delta', text: 'x'.repeat(5 * 1024 * 1024) }
    } })
    const result = await fx.runtime.execute({ runId: id, request, context })
    expect(result.ok && result.value.status).toBe('paused')
    expect((await fx.persistence.get(id))?.lifecycleCheckpoint?.waitingReason).toBe('memory_pressure')
    expect((await fx.persistence.list(id)).some((entry) => entry.type === 'stream.event')).toBe(false)
    expect((await fx.persistence.get(id))?.checkpoint?.outputText ?? '').toBe('')
    expect(fx.resources.retainedTextBytes).toBe(0)
  })

  it('holds the full raw event reservation across the checkpoint persistence await', async () => {
    const entered = deferred(); const saved = deferred()
    const size = 50_000
    const fx = fixture({ describe: () => undefined, async *stream() {
      yield { type: 'text-delta', text: 'x'.repeat(size) }
    } })
    const append = fx.persistence.appendAndSave
    fx.persistence.appendAndSave = async (...args) => {
      if (args[0].type === 'stream.event') { entered.resolve(); await saved.promise }
      return append(...args)
    }
    const execution = fx.runtime.execute({ runId: id, request, context })
    await entered.promise
    // Raw event copies and retained output are independent simultaneous slots.
    expect(fx.resources.retainedTextBytes).toBeGreaterThanOrEqual(size * (6 + 8))
    saved.resolve()
    expect((await execution).ok).toBe(true)
    expect(fx.resources.retainedTextBytes).toBe(0)
  })

  it('can cancel a fully exited paused run under critical pressure without admitting steer, resume or new work', async () => {
    const entered = deferred(); const finish = deferred()
    let attempts = 0
    const fx = fixture({ describe: () => undefined, async *stream() {
      attempts++; entered.resolve(); await finish.promise
    } })
    const execution = fx.runtime.execute({ runId: id, request, context })
    await entered.promise
    expect((await fx.runtime.pause(id)).ok).toBe(true)
    finish.resolve(); await execution
    // Drain the async iterator's queued return after its outstanding next.
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(fx.resources.retainedTextBytes).toBe(0)
    fx.resources.setPressure(true)
    expect((await fx.runtime.steer(id, 'new instruction')).ok).toBe(false)
    expect((await fx.runtime.resume({ runId: id })).ok).toBe(false)
    expect((await fx.runtime.execute({ runId: asAssistantRunId('new-run'), request, context })).ok).toBe(false)
    const result = await fx.runtime.cancel(id)
    expect(result.ok && result.value.status).toBe('cancelled')
    expect(attempts).toBe(1)
    expect((await fx.persistence.get(id))?.status).toBe('cancelled')
    expect(fx.resources.retainedTextBytes).toBe(0)
  })

  it('reports a stop persistence failure rather than bypassing an exhausted shared text cap', async () => {
    const entered = deferred(); const finish = deferred()
    const maxBytes = 64_000
    const fx = fixture({ describe: () => undefined, async *stream() { entered.resolve(); await finish.promise } }, maxBytes)
    const execution = fx.runtime.execute({ runId: id, request, context })
    await entered.promise
    await fx.runtime.pause(id)
    finish.resolve(); await execution
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(fx.resources.retainedTextBytes).toBe(0)
    const full = fx.resources.reserveText(maxBytes)
    fx.resources.setPressure(true)
    const result = await fx.runtime.cancel(id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('persistence_failed')
    expect((await fx.persistence.get(id))?.status).toBe('paused')
    expect(fx.resources.retainedTextBytes).toBe(maxBytes)
    full()
    expect((await fx.runtime.cancel(id)).ok).toBe(true)
    expect(fx.resources.retainedTextBytes).toBe(0)
  })

  it('does not impose managed-text limits when the optional reserveText hook is absent', async () => {
    const fx = fixture({ describe: () => undefined, async *stream() {} }, undefined, 10_000_000)
    fx.governance.reserveText = undefined
    const output = 'x'.repeat(9 * 1024 * 1024)
    const result = await fx.runtime.executeActivity({ runId: id, kind: 'chat', conversationId: request.conversationId,
      providerId: request.providerId, model: request.model, request, context,
      executor: { async execute() { return { outputText: output } } } })
    expect(result.ok && result.value.result?.outputText).toBe(output)
    expect(fx.resources.retainedTextBytes).toBe(0)
  })

  it('refuses an oversized original request before freezing or dispatching and releases failed admission', async () => {
    let dispatched = false
    const fx = fixture({ describe: () => undefined, async *stream() { dispatched = true } }, 24_000)
    const result = await fx.runtime.execute({ runId: id, request: { ...request,
      messages: [{ id: 'user', role: 'user', text: 'x'.repeat(6_000) }] }, context })
    expect(result.ok).toBe(false)
    expect(dispatched).toBe(false)
    expect(await fx.persistence.get(id)).toBeUndefined()
    expect(fx.resources.retainedTextBytes).toBe(0)
  })

  it('accounts for retained request, output and serialized checkpoints, then releases on success', async () => {
    const entered = deferred(); const finish = deferred()
    const fx = fixture({ describe: () => undefined, async *stream() {
      yield { type: 'text-delta', text: 'result'.repeat(1000) }
      entered.resolve(); await finish.promise
    } })
    const execution = fx.runtime.execute({ runId: id, request, context })
    await entered.promise
    expect(fx.resources.retainedTextBytes).toBeGreaterThan(6_000 * 8)
    expect((await fx.persistence.get(id))?.checkpoint?.outputText).toHaveLength(6_000)
    finish.resolve()
    expect((await execution).ok).toBe(true)
    expect(fx.resources.retainedTextBytes).toBe(0)
  })

  it('durably pauses on output exhaustion without accepting the unreserved delta', async () => {
    const fx = fixture({ describe: () => undefined, async *stream() {
      yield { type: 'text-delta', text: 'x'.repeat(20_000) }
    } }, 64_000)
    const result = await fx.runtime.execute({ runId: id, request, context })
    expect(result.ok && result.value.status).toBe('paused')
    expect((await fx.persistence.get(id))?.lifecycleCheckpoint?.waitingReason).toBe('memory_pressure')
    expect((await fx.persistence.get(id))?.checkpoint?.outputText ?? '').toBe('')
    expect(fx.resources.retainedTextBytes).toBe(0)
  })

  it('does not dispatch under critical pressure and can still persist the stop barrier', async () => {
    let dispatched = false
    const fx = fixture({ describe: () => undefined, async *stream() { dispatched = true } })
    fx.governance.lifecycle = async (run) => { if (run.status === 'running') fx.resources.setPressure(true) }
    const result = await fx.runtime.execute({ runId: id, request, context })
    expect(result.ok && result.value.status).toBe('paused')
    expect(dispatched).toBe(false)
    expect((await fx.persistence.get(id))?.lifecycleCheckpoint?.waitingReason).toBe('memory_pressure')
    expect(fx.resources.retainedTextBytes).toBe(0)
  })

  it('retains cancelled stream reservations until both native next and cleanup settle, ignoring late text', async () => {
    const entered = deferred(); const next = deferred<IteratorResult<StreamEvent>>()
    const cleaned = deferred<IteratorResult<StreamEvent>>()
    const fx = fixture({ describe: () => undefined, stream() {
      return { [Symbol.asyncIterator]() { return {
        next() { entered.resolve(); return next.promise }, return() { return cleaned.promise },
      } } }
    } })
    const execution = fx.runtime.execute({ runId: id, request, context })
    await entered.promise
    fx.resources.setPressure(true)
    expect((await fx.runtime.cancel(id)).ok).toBe(true)
    expect((await execution).ok).toBe(false)
    expect(fx.resources.retainedTextBytes).toBeGreaterThan(0)
    next.resolve({ done: false, value: { type: 'text-delta', text: 'late result' } })
    await Promise.resolve(); await Promise.resolve()
    expect(fx.resources.retainedTextBytes).toBeGreaterThan(0)
    cleaned.resolve({ done: true, value: undefined })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(fx.resources.retainedTextBytes).toBe(0)
    expect((await fx.persistence.get(id))?.status).toBe('cancelled')
    expect((await fx.persistence.list(id)).some((entry) => entry.type === 'stream.event')).toBe(false)
  })

  it('retains a cancelled uninterruptible tool and does not accept its late receipt', async () => {
    const entered = deferred(); const finish = deferred()
    const fx = fixture({ describe: () => undefined, async *stream() {
      yield { type: 'tool-call', toolCallId: 'call', toolName: 'work', arguments: { text: 'argument'.repeat(500) } }
    } })
    const session: AssistantModelOperationSession = {
      prepareRequest: (value) => value, validatePending: () => true,
      async resume() { throw new Error('unexpected resume') },
      async evaluateTurn() {
        entered.resolve(); await finish.promise
        return { kind: 'continue', request, receipt: { text: 'late receipt' } }
      },
    }
    const execution = fx.runtime.execute({ runId: id, request, context, modelOperationSession: session })
    await entered.promise
    expect(fx.resources.retainedTextBytes).toBeGreaterThan(3500 * 6)
    fx.resources.setPressure(true)
    expect((await fx.runtime.cancel(id)).ok).toBe(true)
    expect(fx.resources.retainedTextBytes).toBeGreaterThan(0)
    finish.resolve(); await execution
    expect(fx.resources.retainedTextBytes).toBe(0)
    expect((await fx.persistence.list(id)).some((entry) => entry.type === 'model-operation.selected')).toBe(false)
  })

  it('refuses an oversized tool receipt before another provider turn and preserves the uncertain-effect fence', async () => {
    let attempts = 0
    const fx = fixture({ describe: () => undefined, async *stream() { attempts++ } }, 64_000)
    const session: AssistantModelOperationSession = {
      prepareRequest: (value) => value, validatePending: () => true,
      async resume() { throw new Error('unexpected resume') },
      async evaluateTurn() { return { kind: 'continue', request, receipt: { text: 'x'.repeat(20_000) } } },
    }
    const result = await fx.runtime.execute({ runId: id, request, context, modelOperationSession: session })
    expect(result.ok && result.value.status).toBe('paused')
    expect(attempts).toBe(1)
    expect((await fx.persistence.get(id))?.lifecycleCheckpoint?.recovery).toBe('reconciliation-required')
    expect(fx.resources.retainedTextBytes).toBe(0)
  })

  it('accounts for coalesced activity callbacks until their shared checkpoint receipt settles', async () => {
    const fx = fixture({ describe: () => undefined, async *stream() { throw new Error('unexpected provider') } })
    const result = await fx.runtime.executeActivity({ runId: id, kind: 'chat', conversationId: request.conversationId,
      providerId: request.providerId, model: request.model, request, context, executor: { async execute(input) {
        const before = fx.resources.retainedTextBytes
        const first = input.checkpointTextDelta!('a'.repeat(4000))
        const second = input.checkpointTextDelta!('b'.repeat(4000))
        expect(first).toBe(second)
        expect(fx.resources.retainedTextBytes - before).toBeGreaterThanOrEqual(8000 * 6)
        await Promise.all([first, second])
        expect((await fx.persistence.get(id))?.checkpoint?.outputText).toHaveLength(8000)
        return {}
      } } })
    expect(result.ok && result.value.result?.outputText.length).toBe(8000)
    expect(fx.resources.retainedTextBytes).toBe(0)
  })

  it('accounts for nonstreaming activity output and pauses rather than serializing an over-budget result', async () => {
    const fx = fixture({ describe: () => undefined, async *stream() {} }, 64_000)
    const result = await fx.runtime.executeActivity({ runId: id, kind: 'chat', conversationId: request.conversationId,
      providerId: request.providerId, model: request.model, request, context,
      executor: { async execute() { return { outputText: 'x'.repeat(20_000) } } } })
    expect(result.ok && result.value.status).toBe('paused')
    expect((await fx.persistence.get(id))?.lifecycleCheckpoint?.waitingReason).toBe('memory_pressure')
    expect((await fx.persistence.get(id))?.result).toBeUndefined()
    expect(fx.resources.retainedTextBytes).toBe(0)
  })
})
