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
