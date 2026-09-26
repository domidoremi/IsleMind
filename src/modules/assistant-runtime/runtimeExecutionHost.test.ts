import { asAssistantRunId, asContextSnapshotId, CHAT_REQUEST_SCHEMA, type ChatRequest } from '@/core'
import { createAssistantRuntime } from './runtime'
import { createInMemoryRunStore } from './testing/inMemoryRunStore'
import { createAgentDefinition } from './agentDefinition'
import { DELEGATE_OPERATION } from './agentCollaboration'
import { projectRunSnapshot } from './harnessCheckpoint'
import type { AssistantModelOperationSession, AssistantRunGovernance } from './contracts'
import { PENDING_MODEL_OPERATION_SCHEMA } from './contracts'
import type { ProviderGateway } from '@/modules/providers'
import { createExecutionResources } from '@/modules/tasks'
import type { AndroidAgentExecutionLease, AndroidAgentExecutionPort } from '@/platform/native/androidAgentExecution'
import { createAssistantExecutionHost } from '@/bootstrap/assistantExecutionHost'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}
const request: ChatRequest = { schema: CHAT_REQUEST_SCHEMA, conversationId: 'conversation', providerId: 'provider', model: 'model',
  messages: [{ id: 'user', role: 'user', text: 'work' }], generationParameterSources: {} }
const context = { schema: 'islemind.context-snapshot.v1' as const, id: asContextSnapshotId('context'), createdAt: 1,
  conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] }
const rootId = asAssistantRunId('root')

function fixture(providerGateway: ProviderGateway) {
  const persistence = createInMemoryRunStore()
  const resources = createExecutionResources()
  const acquire = jest.fn(async ({ runId, generation }) => ({ ok: true, reason: 'acquired' as const,
    lease: { runId, generation, startId: 1, leaseToken: 'token', expiresAtElapsedMs: 15_000 } }))
  const renew = jest.fn(async (lease: AndroidAgentExecutionLease) => ({ ok: true, reason: 'renewed' as const, lease: { ...lease } }))
  const release = jest.fn(async (_lease: AndroidAgentExecutionLease, _reason?: string) => ({ ok: true, reason: 'released' as const }))
  const port = { isAvailable: () => true, acquire, renew, release,
    subscribeControl: () => () => undefined, subscribeMemoryPressure: () => () => undefined } as unknown as AndroidAgentExecutionPort
  const host = createAssistantExecutionHost({ port, resources, pause: (id) => runtime.pause(id) })
  const governance: AssistantRunGovernance = {
    reserveText: resources.reserveText,
    executionStarted: host.executionStarted,
    async created() {}, async beforeAttempt(run) { host.assertAdmission(run.rootRunId ?? run.id) },
    async lifecycle(run) { if (!run.parentRunId) await host.persisted(projectRunSnapshot(run)) },
  }
  let next = 0
  const runtime = createAssistantRuntime({ persistence, governance, providerGateway,
    clock: { now: Date.now }, ids: { next: () => `child-${++next}` } })
  host.start()
  return { runtime, host, persistence, resources, acquire, renew, release }
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test('failed stream persistence releases the invocation even when the durable root still says running', async () => {
  const fx = fixture({ describe: () => undefined, async *stream() { yield { type: 'text-delta', text: 'result' } } })
  const append = fx.persistence.appendAndSave
  fx.persistence.appendAndSave = async (...args) => {
    if (args[0].type === 'stream.event') throw new Error('disk full')
    return append(...args)
  }
  await fx.host.enableBackground(rootId, true)
  const result = await fx.runtime.execute({ runId: rootId, request, context })
  expect(result.ok ? undefined : result.error.code).toBe('persistence_failed')
  expect((await fx.persistence.get(rootId))?.status).toBe('running')
  expect(fx.acquire).toHaveBeenCalledTimes(1)
  expect(fx.release).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(15_000)
  expect(fx.renew).not.toHaveBeenCalled()
  fx.host.stop()
})

test('an activity checkpoint failure releases CPU even if its executor ignores abort and rejection', async () => {
  const failed = deferred(); const finish = deferred()
  const fx = fixture({ describe: () => undefined, async *stream() {} })
  const append = fx.persistence.appendAndSave
  fx.persistence.appendAndSave = async (...args) => {
    if (args[0].type === 'stream.event') throw new Error('disk full')
    return append(...args)
  }
  await fx.host.enableBackground(rootId, true)
  const execution = fx.runtime.executeActivity({ runId: rootId, kind: 'chat', conversationId: request.conversationId,
    providerId: request.providerId, model: request.model, request, context, executor: { async execute({ checkpointTextDelta }) {
      await checkpointTextDelta!('result').catch(() => undefined)
      failed.resolve(); await finish.promise
      return { outputText: 'late result' }
    } } })
  await failed.promise
  expect(fx.acquire).toHaveBeenCalledTimes(1)
  expect(fx.release).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(15_000)
  expect(fx.renew).not.toHaveBeenCalled()
  finish.resolve()
  const result = await execution
  expect(result.ok ? undefined : result.error.code).toBe('persistence_failed')
  fx.host.stop()
})

test.each(['pause', 'cancel'] as const)('%s revokes CPU before blocked persistence or an uninterruptible operation drains', async (command) => {
  const entered = deferred(); const finish = deferred(); const persist = deferred()
  const fx = fixture({ describe: () => undefined, async *stream() {} })
  const session: AssistantModelOperationSession = { prepareRequest: (value) => value, validatePending: () => true,
    async resume() { throw new Error('unexpected resume') },
    async evaluateTurn() { entered.resolve(); await finish.promise; return { kind: 'continue', request, receipt: { late: true } } } }
  await fx.host.enableBackground(rootId, true)
  const execution = fx.runtime.execute({ runId: rootId, request, context, modelOperationSession: session })
  await entered.promise
  const append = fx.persistence.appendAndSave
  fx.persistence.appendAndSave = async (...args) => {
    if (args[0].type === 'run.paused' || args[0].type === 'run.cancellation-requested') {
      await persist.promise; throw new Error('disk full')
    }
    return append(...args)
  }
  const stopping = fx.runtime[command](rootId)
  expect(fx.release).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(15_000)
  expect(fx.renew).not.toHaveBeenCalled()
  expect(fx.resources.retainedTextBytes).toBeGreaterThan(0)
  persist.resolve(); expect((await stopping).ok).toBe(false)
  finish.resolve(); await execution
  expect((await fx.persistence.list(rootId)).some((entry) => entry.type === 'model-operation.selected')).toBe(false)
  fx.host.stop()
})

test.each(['pause', 'cancel'] as const)('a child %s stops its root and sibling before uninterruptible child operations drain', async (command) => {
  const entered = deferred(); const finish = deferred()
  const otherEntered = deferred(); const otherFinish = deferred()
  let childEntries = 0
  const fx = fixture({ describe: () => undefined, async *stream(value) {
    if (value.conversationId === 'other') { otherEntered.resolve(); await otherFinish.promise; return }
    if (value.conversationId === 'conversation') yield { type: 'tool-call', toolCallId: 'delegate', toolName: DELEGATE_OPERATION,
      arguments: { tasks: [{ agentId: 'reader', task: 'read' }, { agentId: 'reader', task: 'verify' }] } }
  } })
  const definition = createAgentDefinition({ id: 'root-agent', name: 'Root', providerId: 'provider', modelId: 'model' })
  definition.modelBinding.actionCapability = 'validated_structured_actions'
  definition.delegateAgentIds = ['reader']
  const childDefinition = createAgentDefinition({ id: 'reader', name: 'Reader', providerId: 'provider', modelId: 'model' })
  childDefinition.modelBinding.actionCapability = 'validated_structured_actions'
  const session: AssistantModelOperationSession = { prepareRequest: (value) => value, validatePending: () => true,
    async forAgent() { return session }, async forIndependentChild() { return session },
    async resume() { throw new Error('unexpected resume') },
    async evaluateTurn() { if (++childEntries === 2) entered.resolve(); await finish.promise
      return { kind: 'continue', request, receipt: { late: true } } } }
  await fx.host.enableBackground(rootId, true)
  const otherId = asAssistantRunId('other')
  await fx.host.enableBackground(otherId, true)
  const other = fx.runtime.execute({ runId: otherId, request: { ...request, conversationId: 'other' }, context })
  await otherEntered.promise
  const execution = fx.runtime.execute({ runId: rootId, request, context, agentDefinition: definition, modelOperationSession: session,
    agentResolver: { async resolve() { return childDefinition }, async bind() {
      return { request: { ...request, conversationId: 'child' }, context, modelOperationSession: session }
    } } })
  await entered.promise
  const childId = (await fx.persistence.get(rootId))!.delegation!.children[0].runId
  const siblingId = (await fx.persistence.get(rootId))!.delegation!.children[1].runId
  const stopped = await fx.runtime[command](childId)
  const childStatus = command === 'pause' ? 'paused' : 'cancelled'
  expect(stopped.ok && stopped.value.status).toBe(childStatus)
  expect((await fx.persistence.get(rootId))?.status).toBe('paused')
  expect((await fx.persistence.get(siblingId))?.status).toBe('cancelled')
  expect(fx.release).toHaveBeenCalledTimes(1)
  expect(fx.release.mock.calls[0][0].runId).toBe(rootId)
  await jest.advanceTimersByTimeAsync(5_000)
  expect(fx.renew).toHaveBeenCalledTimes(1)
  expect(fx.renew.mock.calls[0][0].runId).toBe(otherId)
  const childSequence = (await fx.persistence.get(childId))!.journalSequence
  finish.resolve(); await execution
  expect((await fx.persistence.get(childId))!.journalSequence).toBe(childSequence + (command === 'pause' ? 1 : 0))
  if (command === 'pause') expect((await fx.persistence.get(childId))!.lifecycleCheckpoint?.effectCertainty).toBe('settled')
  expect((await fx.persistence.get(childId))!.status).toBe(childStatus)
  expect((await fx.persistence.get(rootId))!.status).toBe('paused')
  expect(fx.acquire).toHaveBeenCalledTimes(2)
  expect(fx.release).toHaveBeenCalledTimes(1)
  otherFinish.resolve(); await other
  fx.host.stop()
})

test('one invocation retains its lease across provider, tool and next provider turn while backgrounded', async () => {
  const toolEntered = deferred(); const toolFinish = deferred(); const finalEntered = deferred(); const finalFinish = deferred()
  let turns = 0
  const fx = fixture({ describe: () => undefined, async *stream() {
    turns++
    if (turns === 2) { finalEntered.resolve(); await finalFinish.promise }
  } })
  const session: AssistantModelOperationSession = { prepareRequest: (value) => value, validatePending: () => true,
    async resume() { throw new Error('unexpected resume') }, async evaluateTurn() {
      if (turns === 2) return { kind: 'no-operation' }
      toolEntered.resolve(); await toolFinish.promise; return { kind: 'continue', request, receipt: {} }
    } }
  await fx.host.enableBackground(rootId, true)
  const execution = fx.runtime.execute({ runId: rootId, request, context, modelOperationSession: session })
  await toolEntered.promise; fx.host.setVisible(false)
  await jest.advanceTimersByTimeAsync(5_000)
  toolFinish.resolve(); await finalEntered.promise
  expect(fx.acquire).toHaveBeenCalledTimes(1)
  expect(fx.release).not.toHaveBeenCalled()
  await jest.advanceTimersByTimeAsync(5_000)
  expect(fx.renew).toHaveBeenCalledTimes(2)
  finalFinish.resolve()
  expect((await execution).ok).toBe(true)
  expect(fx.release).toHaveBeenCalledTimes(1)
  fx.host.stop()
})

test('a resumed invocation keeps its own lease when the old aborted provider finally drains', async () => {
  const firstEntered = deferred(); const firstFinish = deferred(); const secondEntered = deferred(); const secondFinish = deferred()
  let turns = 0
  const fx = fixture({ describe: () => undefined, async *stream() {
    if (++turns === 1) { firstEntered.resolve(); await firstFinish.promise }
    else { secondEntered.resolve(); await secondFinish.promise }
  } })
  await fx.host.enableBackground(rootId, true)
  const execution = fx.runtime.execute({ runId: rootId, request, context })
  await firstEntered.promise
  await fx.runtime.pause(rootId)
  await execution
  fx.host.prepareUserResume(rootId)
  expect((await fx.runtime.resume({ runId: rootId })).ok).toBe(true)
  await secondEntered.promise
  firstFinish.resolve()
  await jest.advanceTimersByTimeAsync(5_000)
  expect(fx.acquire).toHaveBeenCalledTimes(2)
  expect(fx.release).toHaveBeenCalledTimes(1)
  expect(fx.renew.mock.calls[0][0].generation).toBe(fx.acquire.mock.calls[1][0].generation)
  await fx.runtime.cancel(rootId)
  secondFinish.resolve()
  await jest.advanceTimersByTimeAsync(0)
  expect(fx.release).toHaveBeenCalledTimes(2)
  fx.host.stop()
})

test('confirmation resumption owns a fresh scope and pause releases it before an approved operation drains', async () => {
  const entered = deferred(); const finish = deferred()
  const fx = fixture({ describe: () => undefined, async *stream() {} })
  const session: AssistantModelOperationSession = { prepareRequest: (value) => value, validatePending: () => true,
    async evaluateTurn({ run }) { return { kind: 'awaiting-confirmation', receipt: {}, pending: {
      schema: PENDING_MODEL_OPERATION_SCHEMA, runId: run.id, callId: 'call', operationId: 'operation',
      catalogRevision: 'catalog', argumentDigest: 'arguments', idempotencyKey: 'effect', continuationToken: 'token',
      continuationDigest: 'digest', stepIndex: 0, maxSteps: 4, requestedAt: Date.now(), continuationRequest: request,
      continuationMode: 'structured', continuationOutputText: '', continuationState: {},
    } } },
    async resume() { entered.resolve(); await finish.promise; return { kind: 'continue', request, receipt: { late: true } } } }
  await fx.host.enableBackground(rootId, true)
  const waiting = await fx.runtime.execute({ runId: rootId, request, context, modelOperationSession: session })
  expect(waiting.ok && waiting.value.status).toBe('awaiting-confirmation')
  expect(fx.release).toHaveBeenCalledTimes(1)
  expect(fx.release.mock.calls[0][1]).toBe('waiting')
  fx.host.prepareUserResume(rootId)
  const resumed = fx.runtime.resumeModelOperation({ runId: rootId, approved: true, session })
  await entered.promise
  expect(fx.acquire).toHaveBeenCalledTimes(2)
  expect((await fx.runtime.pause(rootId)).ok).toBe(true)
  const pausedSequence = (await fx.persistence.get(rootId))!.journalSequence
  expect(fx.release).toHaveBeenCalledTimes(2)
  await jest.advanceTimersByTimeAsync(5_000)
  expect(fx.renew).not.toHaveBeenCalled()
  finish.resolve(); await resumed
  expect((await fx.persistence.get(rootId))!.journalSequence).toBe(pausedSequence + 1)
  expect((await fx.persistence.get(rootId))!.lifecycleCheckpoint?.effectCertainty).toBe('settled')
  expect((await fx.persistence.get(rootId))!.status).toBe('paused')
  expect(fx.acquire).toHaveBeenCalledTimes(2)
  expect(fx.release).toHaveBeenCalledTimes(2)
  await jest.advanceTimersByTimeAsync(5_000)
  expect(fx.renew).not.toHaveBeenCalled()
  fx.host.stop()
})
