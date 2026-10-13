import { asAssistantRunId, asContextSnapshotId, CHAT_REQUEST_SCHEMA, type ChatRequest } from '@/core'
import { createAgentDefinition, freezeAgentDefinition } from '../agentDefinition'
import type { AssistantRun } from '@/modules/assistant-runtime'
import { createModelOperationCatalogSnapshot, formatTaggedModelOperationPrompt, type ModelOperationDescriptor } from '@/modules/integrations'
import { createConversationModelOperationSession, type ConversationModelOperationRuntimeInput, type ConversationModelOperationSessionDependencies } from '@/bootstrap/conversationModelOperationRuntime'
import { resolveAgentModelBinding } from '@/bootstrap/agentModelBinding'
import { KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST } from '@/modules/knowledge'
import { createAssistantRuntime } from '../runtime'
import { createInMemoryRunStore } from './inMemoryRunStore'
import { DELEGATE_OPERATION } from '../agentCollaboration'

async function fixture(permission: 'read-only' | 'read-write' = 'read-write', includeTrustedRead = false) {
  const descriptors: ModelOperationDescriptor[] = [includeTrustedRead ? KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST.id : 'first', 'second'].map((id) => ({ id, name: id, description: id,
    inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'], additionalProperties: false },
    permission, requiresConfirmation: permission !== 'read-only', capabilityScopes: ['source:builtin', `permission:${permission}`],
    executor: { kind: id === KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST.id ? 'rag' : 'builtin', id }, availability: { status: 'available' } }))
  const snapshot = createModelOperationCatalogSnapshot(descriptors)
  if (!snapshot.ok) throw new Error(snapshot.message)
  const prompt = formatTaggedModelOperationPrompt(snapshot.snapshot)
  if (!prompt.ok) throw new Error(prompt.message)
  const executeExternal = jest.fn(async () => ({ observation: { ok: true, output: 'done', metadata: { taskId: 'task', taskStatus: 'succeeded' } } }))
  const createRagRuntime = jest.fn(async () => ({}))
  const dependencies = { createCatalog: async () => ({ ok: true, catalog: { snapshot: snapshot.snapshot, taggedPrompt: prompt.prompt,
    manifests: descriptors.map((item) => ({ ...item, source: 'builtin', enabled: true })) } }),
    executeExternal, executeInternal: jest.fn(), declinePendingTask: async () => ({ ok: true }), createRagRuntime, now: Date.now,
  } as unknown as ConversationModelOperationSessionDependencies
  const input = { conversation: { id: 'conversation', providerId: 'provider', model: 'gpt-4o', messages: [] },
    provider: { id: 'provider', type: 'openai', models: ['gpt-4o'], capabilities: { nativeTools: true } },
    settings: { agentWorkflowAllowReadWriteTools: true },
  } as unknown as ConversationModelOperationRuntimeInput
  const session = (await createConversationModelOperationSession(input, dependencies))!
  const run = { id: asAssistantRunId('run'), providerId: 'provider', model: 'gpt-4o' } as AssistantRun
  const request: ChatRequest = { schema: CHAT_REQUEST_SCHEMA, conversationId: 'conversation', providerId: 'provider', model: 'gpt-4o', messages: [], generationParameterSources: {} }
  const turn = (current = session) => {
    const prepared = current.prepareRequest(request)
    return { run, request: prepared, outputText: '', calls: [{ callId: 'call', name: prepared.toolDefinitions![0].name, arguments: { target: 'item' } }],
      reasoningReplay: [], stepIndex: 0, signal: new AbortController().signal }
  }
  return { session, turn, run, request, executeExternal, createRagRuntime, provider: input.provider, input, dependencies, descriptors }
}

function batchTurn(f: Awaited<ReturnType<typeof fixture>>) {
  const turn = f.turn()
  return { ...turn, calls: turn.request.toolDefinitions!.map((tool, index) => ({
    callId: `batch-${index}`, name: tool.name, arguments: { target: `item-${index}` },
    providerMetadata: { providerCallId: `provider-${index}`, thoughtSignature: `signature-${index}` },
  })) }
}

test.each([true, false, 'cancel-after-restart'] as const)('Rich activity exposes durable confirmation and applies only the reviewed decision (%s)', async decision => {
  const approved = decision === true
  const f = await fixture('read-write')
  const persistence = createInMemoryRunStore()
  const runId = asAssistantRunId('rich-confirmation-' + approved)
  let providerTurns = 0
  const gateway = { describe: () => undefined, async *stream() {
    providerTurns++
    yield { type: 'text-delta' as const, text: approved ? 'Applied after approval.' : 'Declined; no change.' }
  } }
  const runtime = createAssistantRuntime({ persistence, clock: { now: Date.now }, ids: { next: () => runId }, providerGateway: gateway })
  const turn = f.turn()
  let presented = false
  const result = await runtime.executeActivity({ runId, kind: 'chat', conversationId: f.request.conversationId,
    providerId: f.request.providerId, model: f.request.model, request: turn.request,
    context: { schema: 'islemind.context-snapshot.v1', id: asContextSnapshotId('context'), createdAt: 1,
      conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] },
    executor: { async execute({ continueProviderTurns }) {
      const outcome = await continueProviderTurns!({ request: turn.request, session: f.session,
        calls: turn.calls, reasoningReplay: [], outputText: '', stream: gateway.stream })
      expect(outcome.pendingConfirmation?.operationId).toBe('first')
      expect((await persistence.get(runId))?.pendingModelOperation).toEqual(outcome.pendingConfirmation)
      presented = true
      return {}
    } },
  })
  expect(presented).toBe(true)
  expect(result.ok && result.value.status).toBe('awaiting-confirmation')
  expect(f.executeExternal).not.toHaveBeenCalled()
  expect(providerTurns).toBe(0)
  const pending = (await persistence.get(runId))!.pendingModelOperation!
  if (decision === 'cancel-after-restart') {
    const recovered = createAssistantRuntime({ persistence, clock: { now: Date.now }, ids: { next: () => runId }, providerGateway: gateway })
    const cancelled = await recovered.cancel(runId)
    expect(cancelled.ok && cancelled.value.status).toBe('cancelled')
    expect((await persistence.get(runId))?.status).toBe('cancelled')
    const staleApproval = await recovered.resumeModelOperation({ runId, session: f.session, approved: true,
      continuationToken: pending.continuationToken, continuationDigest: pending.continuationDigest })
    expect(staleApproval.ok).toBe(false)
    expect(f.executeExternal).not.toHaveBeenCalled()
    expect(providerTurns).toBe(0)
    return
  }
  const resumed = await runtime.resumeModelOperation({ runId, session: f.session, approved,
    continuationToken: pending.continuationToken, continuationDigest: pending.continuationDigest })
  expect(resumed.ok && resumed.value.status).toBe('succeeded')
  expect(f.executeExternal).toHaveBeenCalledTimes(approved ? 1 : 0)
  expect(providerTurns).toBe(1)
})

test('batch dispatch advances exactly once per checkpoint and replays the original native group once', async () => {
  const f = await fixture('read-only')
  const turn = batchTurn(f)
  const first = await f.session.evaluateTurn(turn)
  expect(f.executeExternal).toHaveBeenCalledTimes(1)
  if (first.kind !== 'continue' || !first.operationBatch) throw new Error('Expected a queued second call')
  expect(first.operationBatch.receipts).toHaveLength(1)
  expect(first.request.messages).toHaveLength(0) // Never send incomplete native result groups to a provider.
  const second = await f.session.evaluateTurn({ ...turn, request: first.request, calls: [], stepIndex: 1, operationBatch: first.operationBatch })
  if (second.kind !== 'continue') throw new Error('Expected completed batch')
  expect(second.operationBatch).toBeUndefined()
  expect(f.executeExternal).toHaveBeenCalledTimes(2)
  const assistant = second.request.messages.filter(message => message.role === 'assistant')
  expect(assistant).toHaveLength(1)
  expect(assistant[0].toolCalls).toMatchObject(turn.calls.map(call => ({ callId: call.callId, providerMetadata: call.providerMetadata })))
  expect(second.request.messages.filter(message => message.role === 'tool').map(message => message.toolCallId)).toEqual(['batch-0', 'batch-1'])
})

test('failure records a not-executed tail rather than dispatching it or claiming success', async () => {
  const f = await fixture('read-only')
  f.executeExternal.mockResolvedValue({ observation: { ok: false, output: 'Disk unavailable', metadata: { taskId: 'task', taskStatus: 'failed' } } })
  const turn = batchTurn(f)
  const first = await f.session.evaluateTurn(turn)
  if (first.kind !== 'continue' || !first.operationBatch) throw new Error('Expected queued tail')
  const last = await f.session.evaluateTurn({ ...turn, request: first.request, stepIndex: 1, calls: [], operationBatch: first.operationBatch })
  expect(f.executeExternal).toHaveBeenCalledTimes(1)
  if (last.kind !== 'continue') throw new Error('Expected batch feedback')
  expect(last.receipt).toMatchObject({ status: 'rejected', code: 'batch_stopped', callId: 'batch-1' })
  expect(last.request.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.text).status)).toEqual(['failed', 'rejected'])
})

test('a native group above the eight-call bound is rejected without partial dispatch', async () => {
  const f = await fixture('read-only')
  const turn = batchTurn(f)
  const result = await f.session.evaluateTurn({ ...turn, calls: Array.from({ length: 9 }, (_, index) => ({ ...turn.calls[0], callId: `large-${index}` })) })
  expect(result.kind).toBe('continue')
  if (result.kind === 'continue') expect(result.receipt).toMatchObject({ status: 'rejected', code: 'multiple_operations_requested' })
  expect(f.executeExternal).not.toHaveBeenCalled()
})

test('concurrent invocations sharing a session cannot exchange batch continuation contexts', async () => {
  const f = await fixture('read-only')
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  f.executeExternal.mockImplementation(async () => {
    entered(); await gate
    return { observation: { ok: true, output: 'done', metadata: { taskId: 'task', taskStatus: 'succeeded' } } }
  })
  const turn = batchTurn(f)
  const first = f.session.evaluateTurn(turn)
  await started
  const second = f.session.evaluateTurn({ ...turn, run: { ...f.run, id: asAssistantRunId('other-run') } })
  await Promise.resolve()
  expect(f.executeExternal).toHaveBeenCalledTimes(1)
  release()
  const [left, right] = await Promise.all([first, second])
  if (left.kind !== 'continue' || right.kind !== 'continue') throw new Error('Expected queued results')
  expect(left.operationBatch?.turnId).toBe('run')
  expect(right.operationBatch?.turnId).toBe('other-run')
})

test('each write in a batch needs its own exact confirmation, including after session recreation', async () => {
  const f = await fixture('read-write')
  const turn = batchTurn(f)
  const first = await f.session.evaluateTurn(turn)
  if (first.kind !== 'awaiting-confirmation') throw new Error('Expected first confirmation')
  expect(f.executeExternal).not.toHaveBeenCalled()
  expect(f.session.validatePending({ run: f.run, pending: first.pending })).toBe(true)
  const recreated = (await createConversationModelOperationSession(f.input, f.dependencies))!
  const approved = await recreated.resume({ run: f.run, pending: first.pending, approved: true, signal: turn.signal })
  if (approved.kind !== 'continue' || !approved.operationBatch) throw new Error('Expected pending tail')
  expect(f.executeExternal).toHaveBeenCalledTimes(1)
  const second = await recreated.evaluateTurn({ ...turn, request: approved.request, stepIndex: 1, calls: [], operationBatch: approved.operationBatch })
  if (second.kind !== 'awaiting-confirmation') throw new Error('Expected independent second confirmation')
  expect(second.pending.callId).toBe('batch-1')
  expect(second.pending.continuationToken).not.toBe(first.pending.continuationToken)
  expect(f.executeExternal).toHaveBeenCalledTimes(1)
  const declined = await recreated.resume({ run: f.run, pending: second.pending, approved: false, signal: turn.signal })
  if (declined.kind !== 'continue') throw new Error('Expected declined feedback')
  expect(declined.receipt.status).toBe('rejected')
  expect(declined.operationBatch).toBeUndefined()
})

test('an expired approval returns a not-executed receipt and stops the queued tail', async () => {
  const f = await fixture('read-write')
  const turn = batchTurn(f)
  const first = await f.session.evaluateTurn(turn)
  if (first.kind !== 'awaiting-confirmation') throw new Error('Expected first confirmation')
  const recreated = (await createConversationModelOperationSession(f.input, f.dependencies))!
  const expired = await recreated.resume({ run: f.run, pending: first.pending, approved: true, authorizationExpired: true, signal: turn.signal })
  expect(f.executeExternal).not.toHaveBeenCalled()
  if (expired.kind !== 'continue') throw new Error('Expected model feedback')
  expect(expired.receipt).toMatchObject({ status: 'rejected', code: 'confirmation_expired', callId: 'batch-0' })
  const tail = await recreated.evaluateTurn({ ...turn, request: expired.request, stepIndex: 1, calls: [], operationBatch: expired.operationBatch })
  if (tail.kind !== 'continue') throw new Error('Expected batch feedback')
  expect(tail.receipt).toMatchObject({ status: 'rejected', code: 'batch_stopped', callId: 'batch-1' })
  expect(tail.operationBatch).toBeUndefined()
  expect(tail.request.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.text).code))
    .toEqual(['confirmation_expired', 'batch_stopped'])
  // The consumed confirmation cannot later be approved as a fresh grant.
  const again = await recreated.resume({ run: f.run, pending: first.pending, approved: true, signal: turn.signal })
  expect(again.kind === 'continue' && again.receipt.code).toBe('confirmation_already_consumed')
  expect(f.executeExternal).not.toHaveBeenCalled()
})

test('Harness persists the full batch on the first confirmation and resumes each independently approved write', async () => {
  const f = await fixture('read-write')
  const persistence = createInMemoryRunStore()
  const runId = asAssistantRunId('approved-batch')
  let turns = 0
  const runtime = createAssistantRuntime({ persistence, clock: { now: Date.now }, ids: { next: () => 'approved-batch' },
    providerGateway: { describe: () => undefined, async *stream(request) {
      if (++turns === 1) {
        for (const [index, tool] of request.toolDefinitions!.entries()) yield { type: 'tool-call', toolCallId: `batch-${index}`, toolName: tool.name, arguments: { target: 'item' } }
      } else {
        expect(request.messages.filter(message => message.role === 'tool')).toHaveLength(2)
        yield { type: 'text-delta', text: 'Both approved operations completed.' }
      }
    } } })
  await runtime.execute({ runId, request: f.request, modelOperationSession: f.session,
    context: { schema: 'islemind.context-snapshot.v1', id: asContextSnapshotId('context'), createdAt: 1,
      conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] } })
  for (let index = 0; index < 2; index++) {
    const saved = (await persistence.get(runId))!
    expect(saved.status).toBe('awaiting-confirmation')
    expect(saved.lifecycleCheckpoint?.operationBatch?.receipts).toHaveLength(index)
    expect(saved.pendingModelOperation?.callId).toBe(`batch-${index}`)
    expect(f.executeExternal).toHaveBeenCalledTimes(index)
    const pending = saved.pendingModelOperation!
    const fresh = (await createConversationModelOperationSession(f.input, f.dependencies))!
    const result = await runtime.resumeModelOperation({ runId, session: fresh, approved: true,
      continuationToken: pending.continuationToken, continuationDigest: pending.continuationDigest })
    expect(result.ok).toBe(true)
  }
  expect((await persistence.get(runId))?.status).toBe('succeeded')
  expect(f.executeExternal).toHaveBeenCalledTimes(2)
  expect(turns).toBe(2)
})

test('queued calls reject changed request/catalog, tampering and duplicate ids before dispatch', async () => {
  const f = await fixture('read-only')
  const turn = batchTurn(f)
  await expect(f.session.evaluateTurn({ ...turn, calls: [turn.calls[0], turn.calls[0]] })).rejects.toThrow('batch')
  expect(f.executeExternal).not.toHaveBeenCalled()
  const first = await f.session.evaluateTurn(turn)
  if (first.kind !== 'continue' || !first.operationBatch) throw new Error('Expected queue')
  for (const change of [
    { request: { ...first.request, model: 'changed' } },
    { operationBatch: { ...first.operationBatch, receipts: [] } },
  ]) {
    await expect(f.session.evaluateTurn({ ...turn, request: first.request, stepIndex: 1, calls: [], operationBatch: first.operationBatch, ...change })).rejects.toThrow()
  }
  expect(f.executeExternal).toHaveBeenCalledTimes(1)
})

test.each([false, true])('Harness commits each batch receipt before the next dispatch (commit failure: %s)', async failCommit => {
  const f = await fixture('read-only')
  const store = createInMemoryRunStore()
  const runId = asAssistantRunId('batch-runtime')
  let providerTurns = 0
  let effects = 0
  const persistence = { ...store, async appendAndSave(...args: Parameters<typeof store.appendAndSave>) {
    if (failCommit && args[0].type === 'model-operation.selected') throw new Error('simulated storage failure')
    return store.appendAndSave(...args)
  } }
  f.executeExternal.mockImplementation(async () => {
    if (++effects === 2) {
      const receipts = (await store.list(runId)).filter(entry => entry.type === 'model-operation.selected')
      expect(receipts).toHaveLength(1)
      expect(receipts[0].data?.receipt).toMatchObject({ callId: 'batch-0', status: 'succeeded' })
    }
    return { observation: { ok: true, output: `result-${effects}`, metadata: { taskId: 'task', taskStatus: 'succeeded' } } }
  })
  const runtime = createAssistantRuntime({ persistence, clock: { now: Date.now }, ids: { next: () => 'batch-runtime' },
    providerGateway: { describe: () => undefined, async *stream(request) {
      if (++providerTurns === 1) {
        for (const [index, tool] of request.toolDefinitions!.entries()) {
          yield { type: 'tool-call', toolCallId: `batch-${index}`, toolName: tool.name, arguments: { target: 'item' } }
        }
      } else {
        expect(effects).toBe(2)
        expect(request.messages.filter(message => message.role === 'tool')).toHaveLength(2)
        yield { type: 'text-delta', text: 'All recorded.' }
      }
    } } })
  const result = await runtime.execute({ runId, request: f.request, modelOperationSession: f.session,
    context: { schema: 'islemind.context-snapshot.v1', id: asContextSnapshotId('context'), createdAt: 1,
      conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] } })
  expect(result.ok).toBe(!failCommit)
  expect(effects).toBe(failCommit ? 1 : 2)
  expect(providerTurns).toBe(failCommit ? 1 : 2)
  if (failCommit) {
    expect((await store.get(runId))?.lifecycleCheckpoint?.recovery).toBe('reconciliation-required')
  } else {
    expect((await store.list(runId)).filter(entry => entry.type === 'model-operation.selected')).toHaveLength(2)
  }
})

test('cancelling between committed operations preserves the completed receipt and never dispatches the tail', async () => {
  const f = await fixture('read-only')
  const persistence = createInMemoryRunStore()
  const runId = asAssistantRunId('cancel-batch')
  const runtime = createAssistantRuntime({ persistence, clock: { now: Date.now }, ids: { next: () => 'cancel-batch' },
    providerGateway: { describe: () => undefined, async *stream(request) {
      for (const [index, tool] of request.toolDefinitions!.entries()) {
        yield { type: 'tool-call', toolCallId: `batch-${index}`, toolName: tool.name, arguments: { target: 'item' } }
      }
    } } })
  let cancellation: Promise<unknown> | undefined
  runtime.subscribe(({ journalEntry }) => {
    if (journalEntry.type === 'model-operation.selected' && !cancellation) cancellation = runtime.cancel(runId)
  })
  await runtime.execute({ runId, request: f.request, modelOperationSession: f.session,
    context: { schema: 'islemind.context-snapshot.v1', id: asContextSnapshotId('context'), createdAt: 1,
      conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] } })
  await cancellation
  expect(f.executeExternal).toHaveBeenCalledTimes(1)
  expect((await persistence.get(runId))?.status).toBe('cancelled')
  expect((await persistence.list(runId)).filter(entry => entry.type === 'model-operation.selected').map(entry => entry.data?.receipt))
    .toEqual([expect.objectContaining({ callId: 'batch-0', status: 'succeeded' })])
})

test.each(['succeeded', 'failed', 'cancelled'] as const)('cancellation preserves a late %s executor receipt without reviving the run or dispatching the batch tail', async status => {
  const f = await fixture('read-only')
  const persistence = createInMemoryRunStore()
  const runId = asAssistantRunId('late-receipt')
  let enter!: () => void; let release!: () => void
  const started = new Promise<void>(resolve => { enter = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  f.executeExternal.mockImplementation(async () => {
    enter(); await gate
    return { observation: { ok: status === 'succeeded', output: 'File receipt: partial copy, 4096 bytes, target draft',
      metadata: { taskId: 'task', taskStatus: status } } }
  })
  let providerTurns = 0
  const runtime = createAssistantRuntime({ persistence, clock: { now: Date.now }, ids: { next: () => runId },
    providerGateway: { describe: () => undefined, async *stream(request) {
      ++providerTurns
      for (const [index, tool] of request.toolDefinitions!.entries()) {
        yield { type: 'tool-call', toolCallId: `batch-${index}`, toolName: tool.name, arguments: { target: 'item' } }
      }
    } } })
  const execution = runtime.execute({ runId, request: f.request, modelOperationSession: f.session,
    context: { schema: 'islemind.context-snapshot.v1', id: asContextSnapshotId('context'), createdAt: 1,
      conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] } })
  await started
  await runtime.cancel(runId)
  const stopped = (await persistence.get(runId))!
  expect(stopped.status).toBe('cancelled')
  release(); await execution
  const saved = (await persistence.get(runId))!
  expect(saved.status).toBe('cancelled')
  expect(saved.completedAt).toBe(stopped.completedAt)
  expect(saved.lifecycleCheckpoint?.recovery).toBe('reconciliation-required')
  expect(saved.lifecycleCheckpoint?.stepIndex).toBe(0)
  expect(saved.checkpoint).toEqual(stopped.checkpoint)
  expect(f.executeExternal).toHaveBeenCalledTimes(1)
  expect(providerTurns).toBe(1)
  const receipts = (await persistence.list(runId)).filter(entry => entry.type === 'model-operation.selected')
  expect(receipts).toHaveLength(1)
  expect(receipts[0].data).toMatchObject({ afterStop: true, receipt: { status, output: expect.stringContaining('4096 bytes') } })
  expect((await runtime.resume({ runId, modelOperationSession: f.session })).ok).toBe(false)
})

test('a definitive result returned after pause checkpoints the native call and resumes only the next operation', async () => {
  const f = await fixture('read-only')
  const persistence = createInMemoryRunStore()
  const runId = asAssistantRunId('paused-late-receipt')
  let enter!: () => void; let release!: () => void
  const started = new Promise<void>(resolve => { enter = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  f.executeExternal.mockImplementationOnce(async () => {
    enter(); await gate
    return { observation: { ok: true, output: 'First action really completed', metadata: { taskId: 'task', taskStatus: 'succeeded' } } }
  })
  let providerTurns = 0
  const runtime = createAssistantRuntime({ persistence, clock: { now: Date.now }, ids: { next: () => runId },
    providerGateway: { describe: () => undefined, async *stream(request) {
      if (++providerTurns === 1) {
        for (const [index, tool] of request.toolDefinitions!.entries()) {
          yield { type: 'tool-call', toolCallId: `batch-${index}`, toolName: tool.name, arguments: { target: 'item' } }
        }
      } else {
        expect(request.messages.filter(message => message.role === 'tool')).toHaveLength(2)
        yield { type: 'text-delta', text: 'Complete' }
      }
    } } })
  const execution = runtime.execute({ runId, request: f.request, modelOperationSession: f.session,
    context: { schema: 'islemind.context-snapshot.v1', id: asContextSnapshotId('context'), createdAt: 1,
      conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] } })
  await started; await runtime.pause(runId); release(); await execution
  const saved = (await persistence.get(runId))!
  expect(saved.status).toBe('paused')
  expect(saved.lifecycleCheckpoint).toMatchObject({ stepIndex: 1, recovery: 'resumable', operationBatch: { receipts: [expect.objectContaining({ status: 'succeeded' })] } })
  expect(f.executeExternal).toHaveBeenCalledTimes(1)
  let finish!: () => void
  const completed = new Promise<void>(resolve => { finish = resolve })
  const unsubscribe = runtime.subscribe(({ run }) => { if (run.status === 'succeeded' || run.status === 'failed') finish() })
  expect((await runtime.resume({ runId, modelOperationSession: f.session })).ok).toBe(true)
  await completed; unsubscribe()
  expect(f.executeExternal).toHaveBeenCalledTimes(2)
  expect(providerTurns).toBe(2)
})

test('a single native receipt after abort keeps the matching call when constructing a safe checkpoint', async () => {
  const f = await fixture('read-only')
  const controller = new AbortController()
  f.executeExternal.mockImplementation(async () => {
    controller.abort()
    return { observation: { ok: true, output: 'Completed before cancellation', metadata: { taskId: 'task', taskStatus: 'succeeded' } } }
  })
  const outcome = await f.session.evaluateTurn({ ...f.turn(), signal: controller.signal })
  if (outcome.kind !== 'continue') throw new Error('Expected a definitive receipt checkpoint')
  expect(outcome.request.messages.map(message => message.role)).toEqual(['assistant', 'tool'])
  expect(outcome.request.messages[0].toolCalls?.[0].callId).toBe('call')
  expect(outcome.request.messages[1].toolCallId).toBe('call')
  expect(outcome.receipt.status).toBe('succeeded')
})

test('read-write intent is persisted before Tasks admission and approval binds the exact operation', async () => {
  const f = await fixture()
  const outcome = await f.session.evaluateTurn(f.turn())
  expect(outcome.kind).toBe('awaiting-confirmation')
  expect(f.executeExternal).not.toHaveBeenCalled()
  if (outcome.kind !== 'awaiting-confirmation') throw new Error('Expected confirmation')
  expect(f.session.validatePending({ run: f.run, pending: outcome.pending })).toBe(true)
  expect(f.session.validatePending({ run: f.run, pending: { ...outcome.pending, argumentDigest: 'forged' } })).toBe(false)
  await f.session.resume({ run: f.run, pending: outcome.pending, approved: true, signal: new AbortController().signal })
  expect(f.executeExternal).toHaveBeenCalledTimes(1)
  const dispatched = (f.executeExternal.mock.calls as unknown[][])[0][0] as Parameters<ConversationModelOperationSessionDependencies['executeExternal']>[0]
  expect(dispatched.options.userConfirmed).toBe(true)
  expect(dispatched.modelOperationAuthorization?.attestation.confirmationStatus).toBe('confirmed')
  expect(dispatched.modelOperationAuthorization!.policy.verify(dispatched.modelOperationAuthorization!.attestation, dispatched.modelOperationAuthorization!.expected)).toBe(true)
})

test('decline does not create or dispatch a task', async () => {
  const f = await fixture()
  const pending = await f.session.evaluateTurn(f.turn())
  if (pending.kind !== 'awaiting-confirmation') throw new Error('Expected confirmation')
  const result = await f.session.resume({ run: f.run, pending: pending.pending, approved: false, signal: new AbortController().signal })
  expect(result.kind).toBe('continue')
  expect(f.executeExternal).not.toHaveBeenCalled()
})

test.each(['native', 'tagged'] as const)('LLM → Harness → local executor → receipt → LLM repeats until final output (%s)', async mode => {
  const f = await fixture('read-only')
  const persistence = createInMemoryRunStore()
  const catalog = createModelOperationCatalogSnapshot(f.descriptors)
  if (!catalog.ok) throw new Error(catalog.message)
  let turns = 0
  const operations = ['first', 'second']
  f.executeExternal.mockImplementation(async () => {
    const entries = await persistence.list(asAssistantRunId('loop'))
    expect(entries.at(-1)?.data?.operation).toMatchObject({ operationId: operations[turns - 1] })
    return { observation: { ok: turns !== 1, output: turns === 1 ? 'Not found; try the second source.' : 'Found the answer.', metadata: { taskId: 'task', taskStatus: turns === 1 ? 'failed' : 'succeeded' } } }
  })
  const runtime = createAssistantRuntime({ persistence, clock: { now: Date.now }, ids: { next: () => 'loop' },
    providerGateway: { describe: () => undefined, async *stream(request) {
      ++turns
      if (turns > 1) {
        const feedback = request.messages.at(-1)!.text
        expect(feedback).toContain(turns === 2 ? 'Not found' : 'Found the answer')
        expect(feedback).toContain(turns === 2 ? '"status":"failed"' : '"status":"succeeded"')
        if (mode === 'tagged') expect(feedback).toContain('Decide the next permitted operation')
      }
      if (turns === 3) { yield { type: 'text-delta', text: 'Verified answer from the second source.' }; return }
      const operationId = operations[turns - 1]
      if (mode === 'native') yield { type: 'tool-call', toolCallId: `call-${turns}`, toolName: request.toolDefinitions!.find(tool => tool.operationId === operationId)!.name, arguments: { target: 'item' } }
      else yield { type: 'text-delta', text: `<islemind_tool_call>${JSON.stringify({ schema: 'islemind.model-tool-call.v1', catalogRevision: catalog.snapshot.revision, operationId, arguments: { target: 'item' } })}</islemind_tool_call>` }
    } },
  })
  const result = await runtime.execute({ runId: asAssistantRunId('loop'), request: f.request, modelOperationSession: f.session,
    context: { schema: 'islemind.context-snapshot.v1', id: asContextSnapshotId('context'), createdAt: 1,
      conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] } })
  expect(result.ok && result.value.result?.outputText).toBe('Verified answer from the second source.')
  expect(turns).toBe(3)
  expect(f.executeExternal).toHaveBeenCalledTimes(2)
  expect((await persistence.list(asAssistantRunId('loop'))).filter(entry => entry.type === 'model-operation.selected')
    .map(entry => (entry.data?.receipt as { status: string }).status)).toEqual(['failed', 'succeeded'])
})

test.each(['persistence-failure', 'cancelled'] as const)('an activity boundary cannot dispatch after %s', async reason => {
  const f = await fixture('read-only')
  const controller = new AbortController()
  const input = { ...f.turn(), signal: controller.signal, onOperationStarted: async () => {
    if (reason === 'persistence-failure') throw new Error('disk full')
    controller.abort()
  } }
  await expect(f.session.evaluateTurn(input)).rejects.toThrow()
  expect(f.executeExternal).not.toHaveBeenCalled()
})

test.each(['native', 'tagged'] as const)('model continuation receives actual file content and revision, not just a success summary (%s)', async mode => {
  const f = await fixture('read-only')
  const revision = `sha256:${'a'.repeat(64)}`
  const content = 'The next lookup target is local-file-42.'
  f.executeExternal.mockResolvedValue({ observation: { ok: true, output: 'Read a workspace text file.', metadata: { taskId: 'task', taskStatus: 'succeeded' },
    blocks: [
      { type: 'text', text: JSON.stringify({ relativePath: 'workspace/notes.txt', revision }), name: 'workspace-file-info' },
      { type: 'text', text: content, name: 'workspace-text' },
      { type: 'image', data: 'never-inline-binary', mimeType: 'image/png' },
    ],
  } } as never)
  const persistence = createInMemoryRunStore()
  const catalog = createModelOperationCatalogSnapshot(f.descriptors)
  if (!catalog.ok) throw new Error(catalog.message)
  let turns = 0
  const runtime = createAssistantRuntime({ persistence, clock: { now: Date.now }, ids: { next: () => 'file-loop' },
    providerGateway: { describe: () => undefined, async *stream(request) {
      if (++turns === 1) {
        if (mode === 'native') yield { type: 'tool-call', toolCallId: 'read', toolName: request.toolDefinitions![0].name, arguments: { target: 'workspace/notes.txt' } }
        else yield { type: 'text-delta', text: `<islemind_tool_call>${JSON.stringify({ schema: 'islemind.model-tool-call.v1', catalogRevision: catalog.snapshot.revision, operationId: 'first', arguments: { target: 'workspace/notes.txt' } })}</islemind_tool_call>` }
        return
      }
      const feedback = request.messages.at(-1)!.text
      expect(feedback).toContain(revision)
      expect(feedback).toContain(content)
      expect(feedback).not.toContain('never-inline-binary')
      yield { type: 'text-delta', text: 'Use local-file-42 and the observed revision.' }
    } },
  })
  const result = await runtime.execute({ request: f.request, modelOperationSession: f.session,
    context: { schema: 'islemind.context-snapshot.v1', id: asContextSnapshotId('context'), createdAt: 1,
      conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] } })
  expect(result).toMatchObject({ ok: true, value: { status: 'succeeded' } })
  expect(turns).toBe(2)
})

test('oversized tool blocks are explicitly bounded without JSON-serializing binary or private adapter metadata', async () => {
  const f = await fixture('read-only')
  f.executeExternal.mockResolvedValue({ observation: { ok: true, output: 'Summary', metadata: { taskId: 'task', taskStatus: 'succeeded', privateData: 'not-for-model' },
    blocks: [{ type: 'text', text: 'x'.repeat(30_000) }, { type: 'image', data: 'not-for-model' }],
  } } as never)
  const outcome = await f.session.evaluateTurn(f.turn())
  expect(outcome.kind).toBe('continue')
  if (outcome.kind !== 'continue') throw new Error('Expected a continuation')
  if (typeof outcome.receipt.output !== 'string') throw new Error('Expected text receipt')
  expect(outcome.receipt.output.length).toBeLessThanOrEqual(4_800)
  expect(outcome.receipt.output).toContain('[tool output truncated]')
  expect(outcome.receipt.output).not.toContain('not-for-model')
})

test.each(['failed', 'cancelled', 'awaiting-confirmation', 'running'] as const)('an ok adapter flag cannot override the actual task status %s', async taskStatus => {
  const f = await fixture('read-only')
  f.executeExternal.mockResolvedValue({ observation: { ok: true, output: 'receipt', metadata: { taskId: 'task', taskStatus } } })
  const result = await f.session.evaluateTurn(f.turn())
  expect(result.kind).toBe(taskStatus === 'cancelled' ? 'cancelled' : taskStatus === 'awaiting-confirmation' ? 'awaiting-confirmation' : 'continue')
  if (result.kind !== 'no-operation') expect(result.receipt.status).not.toBe('succeeded')
})

test('agent catalogs only narrow and an empty parent knowledge scope cannot be widened', async () => {
  const f = await fixture('read-only')
  const agent = createAgentDefinition({ id: 'agent', name: 'Read', providerId: 'provider', modelId: 'gpt-4o' })
  agent.modelBinding = resolveAgentModelBinding(f.provider, 'gpt-4o')
  agent.allowedToolIds = ['first']
  const parent = (await f.session.forAgent!(freezeAgentDefinition(agent)))!
  const child = (await parent.forAgent!(freezeAgentDefinition({ ...agent, allowedToolIds: ['first', 'second'], knowledgeIds: ['forbidden'] })))!
  expect(child.prepareRequest(f.request).toolDefinitions).toHaveLength(1)
  await child.evaluateTurn(f.turn(child))
  expect(f.createRagRuntime).toHaveBeenCalledWith(expect.objectContaining({ agentScope: expect.objectContaining({ knowledgeIds: [] }) }))
  expect(await parent.forAgent!(freezeAgentDefinition({ ...agent, modelBinding: { ...agent.modelBinding, actionCapability: 'text_only' } }))).toBeUndefined()
})

test('independent children do not trust third-party or generic builtin read-only annotations', async () => {
  const f = await fixture('read-only')
  const agent = createAgentDefinition({ id: 'child', name: 'Child', providerId: 'provider', modelId: 'gpt-4o' })
  agent.modelBinding = resolveAgentModelBinding(f.provider, 'gpt-4o')
  agent.allowedToolIds = ['first', 'second']
  const child = await f.session.forAgent!(freezeAgentDefinition(agent), { independentReadOnly: true })
  expect(child).toBeUndefined()
  expect(f.executeExternal).not.toHaveBeenCalled()
})

test('independent child catalog admits only host-vetted RAG within the intersected knowledge scope', async () => {
  const f = await fixture('read-only', true)
  const agent = createAgentDefinition({ id: 'parent', name: 'Parent', providerId: 'provider', modelId: 'gpt-4o' })
  agent.modelBinding = resolveAgentModelBinding(f.provider, 'gpt-4o')
  agent.allowedToolIds = [KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST.id, 'second']; agent.knowledgeIds = ['shared']
  const parent = (await f.session.forAgent!(freezeAgentDefinition(agent)))!
  const child = (await parent.forAgent!(freezeAgentDefinition({ ...agent, id: 'child', knowledgeIds: ['shared', 'private'] }), { independentReadOnly: true }))!
  expect(child.prepareRequest(f.request).toolDefinitions?.map((tool) => tool.operationId)).toEqual([KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST.id])
  expect(await parent.forAgent!(freezeAgentDefinition({ ...agent, id: 'child', knowledgeIds: ['private'] }), { independentReadOnly: true })).toBeUndefined()
})

test.each(['knowledge-changed', 'schema-changed', 'no-parent-scope', 'same-authority-new-model'] as const)(
  'production child composition intersects the active frozen parent session: %s', async (scenario) => {
    const f = await fixture('read-only', true)
    const input = { ...f.input, conversation: { ...f.input.conversation, knowledgeSources: ['A'] } }
    const parentSession = await createConversationModelOperationSession(input, f.dependencies)
    const root = createAgentDefinition({ id: 'root', name: 'Root', providerId: 'provider', modelId: 'gpt-4o' })
    root.modelBinding = resolveAgentModelBinding(f.provider, 'gpt-4o'); root.knowledgeIds = ['A', 'B']; root.delegateAgentIds = ['child']
    root.allowedToolIds = scenario === 'no-parent-scope' ? [] : [KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST.id]
    const childProvider = { ...f.provider, models: [...f.provider.models, 'gpt-4o-mini'] }
    const child = { ...root, id: 'child', allowedToolIds: [KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST.id],
      modelBinding: resolveAgentModelBinding(childProvider, 'gpt-4o-mini'), delegateAgentIds: [] }
    const context = { schema: 'islemind.context-snapshot.v1' as const, id: asContextSnapshotId('context'), createdAt: 1,
      conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] }
    let rootCalls = 0; let childCalls = 0; let nextId = 0
    const runtime = createAssistantRuntime({ persistence: createInMemoryRunStore(), clock: { now: () => 1 }, ids: { next: () => `run-${++nextId}` },
      providerGateway: { describe: () => undefined, async *stream() {
        if (++rootCalls === 1) {
          // Simulate a settings/conversation change after the root's effective session was frozen.
          if (scenario === 'knowledge-changed') input.conversation.knowledgeSources = ['B']
          yield { type: 'tool-call', toolCallId: 'delegate', toolName: DELEGATE_OPERATION, arguments: { tasks: [{ agentId: 'child', task: 'look up source' }] } }
        } else yield { type: 'text-delta', text: 'root result' }
      } },
    })
    const result = await runtime.execute({ request: f.request, context, agentDefinition: root,
      modelOperationSession: scenario === 'no-parent-scope' ? undefined : parentSession,
      agentResolver: { resolve: async () => child, bind: async () => {
        const descriptors = f.descriptors.map((operation) => scenario === 'schema-changed'
          ? { ...operation, inputSchema: { type: 'object', properties: { other: { type: 'string' } } } } : operation)
        const snapshot = createModelOperationCatalogSnapshot(descriptors)
        if (!snapshot.ok) throw new Error(snapshot.message)
        const candidate = await createConversationModelOperationSession({ ...input, provider: childProvider,
          conversation: { ...input.conversation, model: 'gpt-4o-mini' } }, { ...f.dependencies,
          createCatalog: async () => {
            const created = await f.dependencies.createCatalog(f.input.settings)
            if (!created.ok) return created
            return { ok: true, catalog: { ...created.catalog, snapshot: snapshot.snapshot } }
          },
        })
        return { context, request: { ...f.request, model: 'gpt-4o-mini', toolDefinitions: [{ operationId: 'injected', name: 'injected',
          description: 'Must never survive the runtime boundary', permission: 'read-only', inputSchema: { type: 'object' } }] }, modelOperationSession: candidate,
          providerGateway: { describe: () => undefined, async *stream(request) {
            childCalls++
            const tools = request.toolDefinitions ?? []
            if (scenario === 'same-authority-new-model') {
              expect(tools.map((tool) => tool.operationId)).toEqual([KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST.id])
              if (childCalls === 1) yield { type: 'tool-call', toolCallId: 'read', toolName: tools[0].name, arguments: { target: 'fact' } }
              else yield { type: 'text-delta', text: 'scoped fact' }
            } else { expect(tools).toEqual([]); yield { type: 'text-delta', text: 'no read permission' } }
          } } }
      } } })
    expect(result.ok && result.value.status).toBe('succeeded')
    expect(childCalls).toBe(scenario === 'same-authority-new-model' ? 2 : 1)
    if (scenario === 'same-authority-new-model') expect(f.createRagRuntime).toHaveBeenCalledWith(expect.objectContaining({
      agentScope: expect.objectContaining({ knowledgeIds: ['A'] }), independentReadOnly: true,
    }))
    else expect(f.createRagRuntime).not.toHaveBeenCalled()
  },
)
