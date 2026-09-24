import { asAssistantRunId, asContextSnapshotId, CHAT_REQUEST_SCHEMA, type ChatRequest } from '@/core'
import { createAgentDefinition, freezeAgentDefinition } from '@/modules/assistant-runtime/agentDefinition'
import type { AssistantRun } from '@/modules/assistant-runtime'
import { createModelOperationCatalogSnapshot, formatTaggedModelOperationPrompt, type ModelOperationDescriptor } from '@/modules/integrations'
import { createConversationModelOperationSession, type ConversationModelOperationRuntimeInput, type ConversationModelOperationSessionDependencies } from './conversationModelOperationRuntime'
import { resolveAgentModelBinding } from './agentModelBinding'
import { KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST } from '@/modules/knowledge'
import { createAssistantRuntime } from '@/modules/assistant-runtime/runtime'
import { createInMemoryRunStore } from '@/modules/assistant-runtime/testing/inMemoryRunStore'
import { DELEGATE_OPERATION } from '@/modules/assistant-runtime/agentCollaboration'

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
    executeExternal, executeInternal: jest.fn(), declinePendingTask: async () => ({ ok: true }), createRagRuntime, now: () => 1,
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
