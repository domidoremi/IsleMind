import { asAssistantRunId, asContextSnapshotId, CHAT_REQUEST_SCHEMA, type ChatRequest, type ChatToolDefinition, type JsonRecord, type StreamEvent } from '@/core'
import {
  createModelOperationCatalogSnapshot, formatTaggedModelOperationPrompt, stableIdentityHash,
  MODEL_OPERATION_DISCOVERY_ID, MODEL_OPERATION_DISCOVERY_NAME, type ModelOperationDescriptor,
} from '@/modules/integrations'
import {
  createConversationModelOperationSession,
  type ConversationModelOperationRuntimeInput,
  type ConversationModelOperationSessionDependencies,
} from '@/bootstrap/conversationModelOperationRuntime'
import type { AssistantModelOperationSession, AssistantRun } from '../contracts'
import { buildAssistantContextPlanReceipt } from '../application/contextPlanReceipt'
import { createModelOperationBatch } from '../application/modelOperationBatch'
import { createAssistantRuntime } from '../runtime'
import { createInMemoryRunStore } from './inMemoryRunStore'
import { createAgentDefinition, freezeAgentDefinition } from '../agentDefinition'
import { resolveAgentModelBinding } from '@/bootstrap/agentModelBinding'

const context = { schema: 'islemind.context-snapshot.v1' as const, id: asContextSnapshotId('context'), createdAt: 1,
  conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] }
type Mode = 'native' | 'tagged'

test.each(['native', 'tagged'] as const)('scene tool restrictions narrow %s declarations before discovery or execution', async mode => {
  const f = await fixture(mode)
  const scoped = (await createConversationModelOperationSession({ ...f.input,
    conversation: { ...f.input.conversation, enabledTools: ['workspace:03'],
      resourceScopeOverride: { schema: 'islemind.conversation-resource-scope.v1', tools: 'selected' } },
  }, f.dependencies))!
  const prepared = scoped.prepareRequest(f.request)
  expect(prepared.toolDefinitions!.map(definition => definition.operationId)).toEqual(['workspace:03'])
  expect(scoped.describeDeclarations?.(prepared)).toMatchObject({ totalCount: 1, declaredCount: 1, deferredCount: 0 })
  expect(f.executeExternal).not.toHaveBeenCalled()
  const before = f.createCatalog.mock.calls.length
  expect(await createConversationModelOperationSession({ ...f.input,
    conversation: { ...f.input.conversation, enabledTools: [], resourceScopeOverride: {
      schema: 'islemind.conversation-resource-scope.v1', tools: 'none' } },
  }, f.dependencies)).toBeUndefined()
  expect(f.createCatalog.mock.calls.length).toBe(before)
})

test('a selected knowledge-none scope does not admit the formal RAG operation', async () => {
  const f = await fixture()
  const { KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST } = await import('@/modules/knowledge')
  const rag = { ...f.descriptors[0], id: KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST.id, executor: { kind: 'rag' as const, id: KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST.id } }
  const catalog = createModelOperationCatalogSnapshot([...f.descriptors, rag])
  if (!catalog.ok) throw Error(catalog.message)
  const tagged = formatTaggedModelOperationPrompt(catalog.snapshot)
  if (!tagged.ok) throw Error(tagged.message)
  f.createCatalog.mockResolvedValue({ ok: true, catalog: { snapshot: catalog.snapshot, taggedPrompt: tagged.prompt,
    manifests: [...f.descriptors.map(descriptor => ({ ...descriptor, source: 'builtin', enabled: true })), { ...rag, source: 'rag', enabled: true }] } } as never)
  const session = (await createConversationModelOperationSession({ ...f.input, conversation: { ...f.input.conversation,
    resourceScopeOverride: { schema: 'islemind.conversation-resource-scope.v1', knowledge: 'none' } } }, f.dependencies))!
  const prepared = session.prepareRequest(f.request)
  expect(session.describeDeclarations?.(prepared)?.totalCount).toBe(12)
  expect(prepared.systemPrompt).not.toContain(KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST.id)
  expect(f.executeInternal).not.toHaveBeenCalled()
})

async function fixture(mode: Mode = 'native', permission: 'read-only' | 'read-write' = 'read-only') {
  const descriptors: ModelOperationDescriptor[] = Array.from({ length: 12 }, (_, index) => {
    const id = `workspace:${String(index).padStart(2, '0')}`
    return { id, name: 'Read workspace source', description: `Inspect source ${index} by target and revision.`,
      inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'], additionalProperties: false },
      permission, requiresConfirmation: permission !== 'read-only', capabilityScopes: [`permission:${permission}`],
      executor: { kind: 'builtin', id }, availability: { status: 'available' } }
  })
  const created = createModelOperationCatalogSnapshot(descriptors)
  if (!created.ok) throw new Error(created.message)
  const snapshot = created.snapshot
  const prompt = formatTaggedModelOperationPrompt(snapshot)
  if (!prompt.ok) throw new Error(prompt.message)
  const executeExternal = jest.fn(async () => ({ observation: { ok: true, output: 'Exact source content',
    metadata: { taskId: 'task', taskStatus: 'succeeded' } } }))
  const executeInternal = jest.fn()
  const createRagRuntime = jest.fn(async () => ({}))
  const createCatalog = jest.fn(async () => ({ ok: true as const, catalog: { snapshot, taggedPrompt: prompt.prompt,
    manifests: descriptors.map(item => ({ ...item, source: 'builtin', enabled: true })) } }))
  const dependencies = { createCatalog, executeExternal, executeInternal, createRagRuntime,
    declinePendingTask: jest.fn(async () => ({ ok: true })), now: Date.now } as unknown as ConversationModelOperationSessionDependencies
  const input = { conversation: { id: 'conversation', providerId: 'provider', model: 'gpt-4o', messages: [] },
    provider: { id: 'provider', type: 'openai', models: ['gpt-4o'], capabilities: { nativeTools: mode === 'native' } },
    settings: { toolDeclarationMode: 'auto', agentWorkflowAllowReadWriteTools: true, agentWorkflowMaxSteps: 12 },
  } as unknown as ConversationModelOperationRuntimeInput
  const session = (await createConversationModelOperationSession(input, dependencies))!
  const full = (await createConversationModelOperationSession({ ...input, settings: { ...input.settings, toolDeclarationMode: 'full' } }, dependencies))!
  const request: ChatRequest = { schema: CHAT_REQUEST_SCHEMA, conversationId: 'conversation', providerId: 'provider', model: 'gpt-4o',
    systemPrompt: 'Help with the current workspace.', messages: [{ id: 'user', role: 'user', text: 'Find the requested source.' }], generationParameterSources: {} }
  const fullDefinitions = new Map(full.prepareRequest(request).toolDefinitions!.map(tool => [tool.operationId, tool]))
  const run = { id: asAssistantRunId('run'), providerId: 'provider', model: 'gpt-4o' } as AssistantRun
  function turn(currentRequest: ChatRequest, id: string, args: Record<string, string | number> = {}, stepIndex = 0) {
    const name = id === MODEL_OPERATION_DISCOVERY_ID ? MODEL_OPERATION_DISCOVERY_NAME : fullDefinitions.get(id)?.name ?? id
    return { run, request: currentRequest, stepIndex, reasoningReplay: [], signal: new AbortController().signal,
      calls: mode === 'native' ? [{ callId: `call-${stepIndex}`, name, arguments: args }] : [],
      outputText: mode === 'tagged' ? tagged(id, args) : '' }
  }
  function tagged(id: string, args: Record<string, string | number>, revision = snapshot.revision) {
    return `<islemind_tool_call>${JSON.stringify({ schema: 'islemind.model-tool-call.v1', catalogRevision: revision,
      operationId: id, arguments: args })}</islemind_tool_call>`
  }
  async function discover(query = 'workspace:03', currentRequest = session.prepareRequest(request), current = session) {
    const outcome = await current.evaluateTurn(turn(currentRequest, MODEL_OPERATION_DISCOVERY_ID, { query }))
    if (outcome.kind !== 'continue') throw new Error('Expected a discovery continuation')
    expect(outcome.receipt.status).toBe('succeeded')
    return outcome.request
  }
  return { input, dependencies, descriptors, snapshot, request, session, fullDefinitions, run, turn, tagged, discover,
    executeExternal, executeInternal, createRagRuntime, createCatalog }
}

test.each(['native', 'tagged'] as const)('the formal %s loop discovers schemas, executes the original operation and returns a final answer', async mode => {
  const f = await fixture(mode)
  const persistence = createInMemoryRunStore()
  const requests: ChatRequest[] = []
  const contextReceipt = buildAssistantContextPlanReceipt({ providerId: 'provider', model: 'gpt-4o' })
  const runtime = createAssistantRuntime({ persistence, clock: { now: Date.now }, ids: { next: () => 'discovery-loop' },
    providerGateway: { describe: () => undefined, async *stream(request): AsyncGenerator<StreamEvent> {
      requests.push(request)
      const turn = requests.length
      if (turn === 1) {
        expect(request.toolDefinitions!.map(tool => tool.operationId)).toEqual([MODEL_OPERATION_DISCOVERY_ID])
        expect(request.systemPrompt).toContain('TOOL_DIRECTORY_JSON=')
        expect(request.systemPrompt).not.toContain('MODEL_OPERATION_CATALOG_JSON=')
        if (mode === 'native') yield { type: 'tool-call', toolCallId: 'find', toolName: MODEL_OPERATION_DISCOVERY_NAME, arguments: { query: 'workspace:03' } }
        else yield { type: 'text-delta', text: f.tagged(MODEL_OPERATION_DISCOVERY_ID, { query: 'workspace:03' }) }
      } else if (turn === 2) {
        expect(request.toolDefinitions![1]).toEqual(f.fullDefinitions.get('workspace:03'))
        expect(request.providerStateBinding).toEqual({ providerId: 'provider', model: 'gpt-4o' })
        if (mode === 'native') yield { type: 'tool-call', toolCallId: 'read', toolName: request.toolDefinitions![1].name, arguments: { target: 'source.txt' },
          providerMetadata: { providerCallId: 'provider-read', thoughtSignature: 'synthetic-signature' } }
        else yield { type: 'text-delta', text: f.tagged('workspace:03', { target: 'source.txt' }) }
      } else {
        expect(request.messages.at(-1)!.text).toContain('Exact source content')
        yield { type: 'text-delta', text: 'The requested source is available.' }
      }
    } } })
  f.executeExternal.mockImplementation(async (...args: unknown[]) => {
    const execution = args[0] as Parameters<ConversationModelOperationSessionDependencies['executeExternal']>[0]
    expect(execution.request.toolId).toBe('workspace:03')
    const auth = execution.modelOperationAuthorization!
    expect(auth.policy.verify(auth.attestation, auth.expected)).toBe(true)
    expect(auth.attestation.confirmationStatus).toBe('not-required')
    const journal = await persistence.list(asAssistantRunId('discovery-loop'))
    expect(journal.at(-1)?.data?.operation).toMatchObject({ operationId: 'workspace:03' })
    return { observation: { ok: true, output: 'Exact source content', metadata: { taskId: 'task', taskStatus: 'succeeded' } } }
  })
  const result = await runtime.execute({ request: f.request, context, contextReceipt, modelOperationSession: f.session })
  expect(result.ok && result.value.status).toBe('succeeded')
  expect(requests).toHaveLength(3)
  expect(f.executeExternal).toHaveBeenCalledTimes(1)
  expect(f.executeInternal).not.toHaveBeenCalled()
  expect(f.createRagRuntime).toHaveBeenCalledTimes(1)
  const captured = await persistence.getRequestSnapshot(asAssistantRunId('discovery-loop'))
  expect(captured?.schema === 'islemind.assistant-run-request-snapshot.v1' && captured.contextReceipt?.toolDeclarations)
    .toMatchObject({ mode: 'discovery', catalogRevision: f.snapshot.revision, totalCount: 12, declaredCount: 0, deferredCount: 12 })
  expect((await persistence.list(asAssistantRunId('discovery-loop'))).filter(entry => entry.type === 'model-operation.selected')
    .map(entry => (entry.data?.receipt as JsonRecord | undefined)?.operationId)).toEqual([MODEL_OPERATION_DISCOVERY_ID, 'workspace:03'])
})

test.each(['native', 'tagged'] as const)('a %s page survives exact re-preparation and session recreation, and the next discovery replaces it', async mode => {
  const f = await fixture(mode)
  const initial = f.session.prepareRequest(f.request)
  expect(f.session.prepareRequest(initial)).toEqual(initial)
  const page = await f.discover()
  const fresh = (await createConversationModelOperationSession({ ...f.input,
    settings: { ...f.input.settings, toolDeclarationMode: 'full' } }, f.dependencies))!
  expect(fresh.prepareRequest(page)).toEqual(page)
  expect(fresh.describeDeclarations?.(page)).toMatchObject({ mode: 'discovery', declaredCount: 1, deferredCount: 11 })
  const next = await f.discover('workspace:07', fresh.prepareRequest(page), fresh)
  expect(next.toolDefinitions!.map(tool => tool.operationId)).toEqual([MODEL_OPERATION_DISCOVERY_ID, 'workspace:07'])
  expect(next.systemPrompt!.split('TOOL_DIRECTORY_JSON=')).toHaveLength(2)
  const rejected = await fresh.evaluateTurn(f.turn(next, 'workspace:03', { target: 'old' }, 2))
  expect(rejected.kind === 'continue' && rejected.receipt).toMatchObject({ status: 'rejected', code: 'operation_unavailable' })
  expect(f.executeExternal).not.toHaveBeenCalled()
  const newRun = fresh.prepareRequest(f.request)
  expect(newRun.toolDefinitions).toHaveLength(12)
  const noVirtualAuthority = await fresh.evaluateTurn(f.turn(newRun, MODEL_OPERATION_DISCOVERY_ID, { query: '' }))
  expect(noVirtualAuthority.kind === 'continue' && noVirtualAuthority.receipt.status).toBe('rejected')
})

test.each(['native', 'tagged'] as const)('the %s declaration page rejects absent, altered, duplicate and unknown schemas before dispatch', async mode => {
  const f = await fixture(mode)
  const initial = f.session.prepareRequest(f.request)
  const absent = await f.session.evaluateTurn(f.turn(initial, 'workspace:03', { target: 'source' }))
  expect(absent.kind === 'continue' && absent.receipt.status).toBe('rejected')
  const page = await f.discover()
  const valid = page.toolDefinitions!
  const variants: readonly ChatToolDefinition[][] = [
    [], [valid[1]], [valid[0], { ...valid[1], inputSchema: { type: 'object' } }],
    [valid[0], { ...valid[1], name: 'forged_name' }], [valid[0], valid[1], valid[1]],
    [valid[0], valid[1], { ...valid[1], operationId: 'unknown:tool' }],
  ]
  for (const toolDefinitions of variants) {
    const bad = { ...page, toolDefinitions }
    const result = await f.session.evaluateTurn(f.turn(bad, 'workspace:03', { target: 'source' }, 1))
    expect(result.kind === 'continue' && result.receipt.status).toBe('rejected')
    if (toolDefinitions.some(tool => tool.operationId === MODEL_OPERATION_DISCOVERY_ID)) {
      expect(() => f.session.prepareRequest(bad)).toThrow('declaration page')
    }
  }
  const invalidArgs = await f.session.evaluateTurn(f.turn(page, 'workspace:03', {}, 1))
  expect(invalidArgs.kind === 'continue' && invalidArgs.receipt.code).toBe('arguments_invalid')
  expect(f.executeExternal).not.toHaveBeenCalled()
})

test.each(['native', 'tagged'] as const)('a captured full %s request keeps full definitions after the global mode changes to auto', async mode => {
  const f = await fixture(mode)
  const original = (await createConversationModelOperationSession({ ...f.input,
    settings: { ...f.input.settings, toolDeclarationMode: 'full' } }, f.dependencies))!
  const captured = original.prepareRequest(f.request)
  const restored = f.session.prepareRequest(captured)
  expect(restored).toEqual(captured)
  expect(f.session.describeDeclarations?.(restored)).toMatchObject({ mode: 'full', declaredCount: 12, deferredCount: 0 })
  const result = await f.session.evaluateTurn(f.turn(restored, 'workspace:03', { target: 'source' }))
  expect(result.kind === 'continue' && result.receipt.status).toBe('succeeded')
  expect(f.executeExternal).toHaveBeenCalledTimes(1)
})

test.each(['native', 'tagged'] as const)('stale %s catalog data cannot restore a page or resume its execution', async mode => {
  const f = await fixture(mode)
  const page = await f.discover()
  const stale = { ...page, systemPrompt: page.systemPrompt!.replaceAll(f.snapshot.revision, 'islemind.model.operation.catalog.v1:stale') }
  expect(() => f.session.prepareRequest(stale)).toThrow('declaration page')
  const result = await f.session.evaluateTurn({ ...f.turn(stale, 'workspace:03', { target: 'source' }, 1),
    ...(mode === 'tagged' ? { outputText: f.tagged('workspace:03', { target: 'source' }, 'islemind.model.operation.catalog.v1:stale') } : {}) })
  expect(result.kind === 'continue' && result.receipt.status).toBe('rejected')
  expect(f.executeExternal).not.toHaveBeenCalled()
})

test('metadata queries obey argument, step, cancellation and durable-start boundaries without entering Tasks', async () => {
  const f = await fixture()
  const request = f.session.prepareRequest(f.request)
  const started = jest.fn()
  const invalid: Record<string, string | number>[] = [{ query: 'x'.repeat(257) }, { query: '', limit: 9 }, { query: '', offset: -1 }]
  for (const args of invalid) {
    const result = await f.session.evaluateTurn({ ...f.turn(request, MODEL_OPERATION_DISCOVERY_ID, args), onOperationStarted: started })
    expect(result.kind === 'continue' && result.receipt.code).toBe('arguments_invalid')
  }
  expect(started).not.toHaveBeenCalled()
  const stopped = new AbortController(); stopped.abort()
  const cancelled = await f.session.evaluateTurn({ ...f.turn(request, MODEL_OPERATION_DISCOVERY_ID, { query: '' }),
    signal: stopped.signal, onOperationStarted: started })
  expect(cancelled.kind).toBe('cancelled')
  await expect(f.session.evaluateTurn({ ...f.turn(request, MODEL_OPERATION_DISCOVERY_ID, { query: '' }),
    onOperationStarted: async () => { throw new Error('durable-start failed') } })).rejects.toThrow('durable-start failed')
  const limited = (await createConversationModelOperationSession({ ...f.input,
    settings: { ...f.input.settings, agentWorkflowMaxSteps: 1 } }, f.dependencies))!
  const found = await f.discover('workspace:03', limited.prepareRequest(f.request), limited)
  const denied = await limited.evaluateTurn(f.turn(found, 'workspace:03', { target: 'source' }, 1))
  expect(denied.kind === 'continue' && denied.receipt.code).toBe('step_limit_reached')
  expect(f.executeExternal).not.toHaveBeenCalled()
  expect(f.executeInternal).not.toHaveBeenCalled()
  expect(f.createRagRuntime).not.toHaveBeenCalled()
})

test('same-group discovery cannot enable undeclared batch calls, and publication survives the rejected tail after recreation', async () => {
  const f = await fixture()
  const turn = f.turn(f.session.prepareRequest(f.request), MODEL_OPERATION_DISCOVERY_ID, { query: 'workspace:03' })
  const first = await f.session.evaluateTurn({ ...turn, calls: [turn.calls[0],
    { callId: 'second', name: f.fullDefinitions.get('workspace:03')!.name, arguments: { target: 'source' } },
    { callId: 'third', name: f.fullDefinitions.get('workspace:07')!.name, arguments: { target: 'another' } }] })
  if (first.kind !== 'continue' || !first.operationBatch) throw new Error('Expected checkpointed batch')
  expect(first.request.toolDefinitions).toHaveLength(1)
  const fresh = (await createConversationModelOperationSession({ ...f.input,
    settings: { ...f.input.settings, toolDeclarationMode: 'full' } }, f.dependencies))!
  const second = await fresh.evaluateTurn({ ...turn, request: first.request, operationBatch: first.operationBatch, stepIndex: 1, calls: [] })
  if (second.kind !== 'continue' || !second.operationBatch) throw new Error('Expected rejected batch tail')
  expect(second.receipt.code).toBe('operation_unavailable')
  const third = await fresh.evaluateTurn({ ...turn, request: second.request, operationBatch: second.operationBatch, stepIndex: 2, calls: [] })
  if (third.kind !== 'continue') throw new Error('Expected complete batch feedback')
  expect(third.receipt.code).toBe('batch_stopped')
  expect(third.operationBatch).toBeUndefined()
  expect(third.request.toolDefinitions!.map(tool => tool.operationId)).toEqual([MODEL_OPERATION_DISCOVERY_ID, 'workspace:03'])
  expect(third.request.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.text).status))
    .toEqual(['succeeded', 'rejected', 'rejected'])
  expect(f.executeExternal).not.toHaveBeenCalled()
})

test.each([true, false])('a batch confirmation stays bound to its original page while the next page is checkpointed (%s)', async approved => {
  const f = await fixture('native', 'read-write')
  const initialPage = await f.discover('workspace:03')
  const turn = f.turn(initialPage, MODEL_OPERATION_DISCOVERY_ID, { query: 'workspace:07' }, 1)
  const found = await f.session.evaluateTurn({ ...turn, calls: [turn.calls[0],
    { callId: 'write', name: f.fullDefinitions.get('workspace:03')!.name, arguments: { target: 'reviewed' } }] })
  if (found.kind !== 'continue' || !found.operationBatch) throw new Error('Expected queued confirmation')
  const pending = await f.session.evaluateTurn({ ...turn, request: found.request, operationBatch: found.operationBatch, stepIndex: 2, calls: [] })
  if (pending.kind !== 'awaiting-confirmation') throw new Error('Expected exact write confirmation')
  expect(pending.pending.continuationRequest.toolDefinitions![1].operationId).toBe('workspace:03')
  const fresh = (await createConversationModelOperationSession({ ...f.input,
    settings: { ...f.input.settings, toolDeclarationMode: 'full' } }, f.dependencies))!
  expect(fresh.validatePending({ run: f.run, pending: pending.pending })).toBe(true)
  const completed = await fresh.resume({ run: f.run, pending: pending.pending, approved, signal: turn.signal })
  if (completed.kind !== 'continue') throw new Error('Expected batch completion')
  expect(completed.request.toolDefinitions![1].operationId).toBe('workspace:07')
  expect(f.executeExternal).toHaveBeenCalledTimes(approved ? 1 : 0)
  if (approved) {
    const value = (f.executeExternal.mock.calls as unknown[][])[0][0] as Parameters<ConversationModelOperationSessionDependencies['executeExternal']>[0]
    expect(value.modelOperationAuthorization?.attestation.confirmationStatus).toBe('confirmed')
    expect(value.request.toolId).toBe('workspace:03')
  }
})

test.each(['native', 'tagged'] as const)('saved %s confirmation cannot authorize an altered declaration page even with a recomputed digest', async mode => {
  const f = await fixture(mode, 'read-write')
  const page = await f.discover()
  const result = await f.session.evaluateTurn(f.turn(page, 'workspace:03', { target: 'reviewed' }, 1))
  if (result.kind !== 'awaiting-confirmation') throw new Error('Expected pending write')
  const pending = { ...result.pending, continuationRequest: { ...result.pending.continuationRequest,
    toolDefinitions: [page.toolDefinitions![0], { ...page.toolDefinitions![1], inputSchema: { type: 'object' } }] } }
  const { schema: _schema, continuationDigest: _digest, ...body } = pending
  pending.continuationDigest = stableIdentityHash(body)
  const fresh = (await createConversationModelOperationSession(f.input, f.dependencies))!
  expect(fresh.validatePending({ run: f.run, pending })).toBe(false)
  await expect(fresh.resume({ run: f.run, pending, approved: true, signal: new AbortController().signal })).rejects.toThrow()
  expect(f.executeExternal).not.toHaveBeenCalled()
})

test('malformed recovered publication and a changed batch request fail before another dispatch', async () => {
  const f = await fixture()
  const turn = f.turn(f.session.prepareRequest(f.request), MODEL_OPERATION_DISCOVERY_ID, { query: 'workspace:03' })
  const first = await f.session.evaluateTurn({ ...turn, calls: [turn.calls[0],
    { callId: 'next', name: MODEL_OPERATION_DISCOVERY_NAME, arguments: { query: 'workspace:07' } }] })
  if (first.kind !== 'continue' || !first.operationBatch) throw new Error('Expected batch')
  const { schema: _schema, digest: _digest, ...body } = first.operationBatch
  const damaged = createModelOperationBatch({ ...body, receipts: [{ ...body.receipts[0],
    output: JSON.stringify({ schema: 'islemind.tool-discovery-result.v1', catalogRevision: f.snapshot.revision, operationIds: ['workspace:03'], returnedCount: 1 }) }] })
  await expect(f.session.evaluateTurn({ ...turn, request: first.request, operationBatch: damaged, stepIndex: 1, calls: [] })).rejects.toThrow('publication')
  await expect(f.session.evaluateTurn({ ...turn, request: { ...first.request, toolDefinitions: [...first.request.toolDefinitions!, f.fullDefinitions.get('workspace:03')!] },
    operationBatch: first.operationBatch, stepIndex: 1, calls: [] })).rejects.toThrow('request')
  expect(f.executeExternal).not.toHaveBeenCalled()
})

test.each(['pause', 'cancel', 'receipt-write-failure'] as const)('Harness %s after discovery does not replay it or prematurely execute the next operation', async action => {
  const f = await fixture()
  const store = createInMemoryRunStore()
  const runId = asAssistantRunId('discovery-checkpoint')
  let turns = 0
  const persistence = { ...store, async appendAndSave(...args: Parameters<typeof store.appendAndSave>) {
    if (action === 'receipt-write-failure' && args[0].type === 'model-operation.selected') throw new Error('checkpoint unavailable')
    return store.appendAndSave(...args)
  } }
  const gateway = { describe: () => undefined, async *stream(request: ChatRequest): AsyncGenerator<StreamEvent> {
    if (++turns === 1) yield { type: 'tool-call' as const, toolCallId: 'find', toolName: MODEL_OPERATION_DISCOVERY_NAME, arguments: { query: 'workspace:03' } }
    else if (turns === 2) {
      expect(request.toolDefinitions![1]).toEqual(f.fullDefinitions.get('workspace:03'))
      yield { type: 'tool-call' as const, toolCallId: 'read', toolName: request.toolDefinitions![1].name, arguments: { target: 'source' } }
    } else yield { type: 'text-delta' as const, text: 'Done' }
  } }
  const runtime = createAssistantRuntime({ persistence, clock: { now: Date.now }, ids: { next: () => runId }, providerGateway: gateway })
  let control: Promise<unknown> | undefined
  runtime.subscribe(({ journalEntry }) => {
    if (journalEntry.type === 'model-operation.selected' && !control && action !== 'receipt-write-failure') {
      control = action === 'pause' ? runtime.pause(runId) : runtime.cancel(runId)
    }
  })
  const result = await runtime.execute({ runId, request: f.request, context, modelOperationSession: f.session })
  await control
  expect(turns).toBe(1)
  expect(f.executeExternal).not.toHaveBeenCalled()
  const saved = (await store.get(runId))!
  if (action === 'receipt-write-failure') {
    expect(result.ok).toBe(false)
    expect(saved.lifecycleCheckpoint).toMatchObject({ phase: 'operation', effectCertainty: 'uncertain', recovery: 'reconciliation-required' })
  } else expect(saved.status).toBe(action === 'pause' ? 'paused' : 'cancelled')
  const restarted = createAssistantRuntime({ persistence, clock: { now: Date.now }, ids: { next: () => runId }, providerGateway: gateway })
  const fresh = (await createConversationModelOperationSession(f.input, f.dependencies))!
  if (action === 'pause') {
    expect(saved.lifecycleCheckpoint?.request.toolDefinitions![1].operationId).toBe('workspace:03')
    let finish!: () => void
    const done = new Promise<void>(resolve => { finish = resolve })
    const unsubscribe = restarted.subscribe(({ run }) => { if (run.status === 'succeeded' || run.status === 'failed') finish() })
    expect((await restarted.resume({ runId, modelOperationSession: fresh })).ok).toBe(true)
    await done; unsubscribe()
    expect((await store.get(runId))?.status).toBe('succeeded')
    expect(f.executeExternal).toHaveBeenCalledTimes(1)
    expect(turns).toBe(3)
    expect((await store.list(runId)).filter(entry => entry.type === 'model-operation.selected'
      && (entry.data?.receipt as JsonRecord | undefined)?.operationId === MODEL_OPERATION_DISCOVERY_ID)).toHaveLength(1)
  } else {
    expect((await restarted.resume({ runId, modelOperationSession: fresh })).ok).toBe(false)
    expect(f.executeExternal).not.toHaveBeenCalled()
  }
})

test('agent scoping only discovers the frozen parent subset and a small child keeps full definitions', async () => {
  const f = await fixture()
  const definition = freezeAgentDefinition({ ...createAgentDefinition({ id: 'scoped', name: 'Scoped', providerId: 'provider', modelId: 'gpt-4o' }),
    allowedToolIds: ['workspace:03', 'unknown:tool'], modelBinding: resolveAgentModelBinding(f.input.provider, 'gpt-4o') })
  const count = f.createCatalog.mock.calls.length
  const child = (await f.session.forAgent?.(definition)) as AssistantModelOperationSession
  expect(child).toBeDefined()
  const prepared = child.prepareRequest(f.request)
  expect(prepared.toolDefinitions!.map(tool => tool.operationId)).toEqual(['workspace:03'])
  expect(child.describeDeclarations?.(prepared)).toMatchObject({ mode: 'full', totalCount: 1, deferredCount: 0 })
  const denied = await child.evaluateTurn(f.turn(prepared, 'workspace:07', { target: 'other' }))
  expect(denied.kind === 'continue' && denied.receipt.status).toBe('rejected')
  expect(f.createCatalog.mock.calls.length).toBe(count)
  expect(f.executeExternal).not.toHaveBeenCalled()
})
