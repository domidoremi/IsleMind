import { asAssistantRunId, CHAT_REQUEST_SCHEMA, type ChatRequest } from '@/core'
import { BUILT_IN_CAPABILITY_SERVER_ID, createModelOperationCatalogSnapshot, formatTaggedModelOperationPrompt, type ModelOperationDescriptor } from '@/modules/integrations'
import { createConversationModelOperationSession, type ConversationModelOperationRuntimeInput,
  type ConversationModelOperationSessionDependencies } from './conversationModelOperationRuntime'
import type { AssistantRun } from '@/modules/assistant-runtime'
import type { Settings } from '@/types/settingsContracts'
import { createConversationModelOperationCatalog } from './modelOperationCatalogRuntime'
import { listConversationToolManifests } from './conversationToolCatalog'

jest.mock('./conversationToolCatalog', () => ({ listConversationToolManifests: jest.fn() }))

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture() {
  const controller = new AbortController()
  const barrier = deferred<void>()
  const ragBarrier = deferred<void>()
  const descriptor: ModelOperationDescriptor = { id: 'builtin:read', name: 'read', description: 'Read a bounded fixture',
    permission: 'read-only', inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] },
    requiresConfirmation: false, capabilityScopes: ['source:builtin', 'permission:read-only'],
    executor: { kind: 'builtin', id: 'builtin:read' }, availability: { status: 'available' } }
  const created = createModelOperationCatalogSnapshot([descriptor])
  if (!created.ok) throw new Error(created.message)
  const tagged = formatTaggedModelOperationPrompt(created.snapshot)
  if (!tagged.ok) throw new Error(tagged.message)
  const manifest = { ...descriptor, source: 'builtin', enabled: true, serverId: 'original-server',
    metadata: { executor: { id: 'original' } } }
  const catalog = { snapshot: created.snapshot, manifests: [manifest], taggedPrompt: tagged.prompt }
  const input = { conversation: { id: 'conversation', providerId: 'provider', model: 'gpt-4o', messages: [],
    knowledgeSources: ['admitted-knowledge'] },
    provider: { id: 'provider', type: 'openai', models: ['gpt-4o'], capabilities: { nativeTools: true } },
    settings: { agentWorkflowMaxSteps: 2, agentWorkflowAllowReadOnlyTools: true, runtimeLogEnabled: true, runtimeLogMaxBytes: 100 },
    signal: controller.signal } as unknown as ConversationModelOperationRuntimeInput & { signal: AbortSignal }
  const createCatalog = jest.fn(async (_settings: unknown) => { await barrier.promise; return { ok: true, catalog } })
  const executeExternal = jest.fn(async (_input: unknown) => ({ observation: { ok: true, status: 'done', output: 'fixture evidence',
    metadata: { taskStatus: 'succeeded' } } }))
  const createRagRuntime = jest.fn(async (_input: unknown) => { await ragBarrier.promise; return {} })
  const dependencies = { createCatalog, executeExternal, executeInternal: jest.fn(),
    declinePendingTask: jest.fn(), createRagRuntime, now: () => 1 } as unknown as ConversationModelOperationSessionDependencies
  const request: ChatRequest = { schema: CHAT_REQUEST_SCHEMA, conversationId: 'conversation',
    providerId: 'provider', model: 'gpt-4o', messages: [], generationParameterSources: {} }
  const run = { id: asAssistantRunId('run'), providerId: 'provider', model: 'gpt-4o' } as AssistantRun
  return { input, controller, barrier, ragBarrier, catalog, manifest, dependencies, createCatalog,
    executeExternal, createRagRuntime, request, run }
}

async function admitted(f: ReturnType<typeof fixture>) {
  f.barrier.resolve()
  return (await createConversationModelOperationSession(f.input, f.dependencies))!
}

function turn(f: ReturnType<typeof fixture>, session: Awaited<ReturnType<typeof admitted>>) {
  const request = session.prepareRequest(f.request)
  return { run: f.run, request, calls: [{ callId: 'call', name: request.toolDefinitions![0].name, arguments: { target: 'fixture' } }],
    reasoningReplay: [], outputText: '', stepIndex: 0, signal: f.controller.signal }
}

it('captures session settings, provider, conversation and knowledge scope before catalog discovery yields', async () => {
  const f = fixture()
  const pending = createConversationModelOperationSession(f.input, f.dependencies)
  f.input.settings.agentWorkflowMaxSteps = 99
  f.input.settings.runtimeLogMaxBytes = 999
  f.input.provider.id = 'later-provider'
  f.input.conversation.id = 'later-conversation'
  f.input.conversation.knowledgeSources!.push('later-knowledge')
  f.barrier.resolve()
  const session = (await pending)!
  f.ragBarrier.resolve()
  await session.evaluateTurn(turn(f, session))
  expect(f.createCatalog.mock.calls[0][0]).toMatchObject({ agentWorkflowMaxSteps: 2, runtimeLogMaxBytes: 100 })
  expect(f.executeExternal.mock.calls[0][0]).toMatchObject({
    options: { limits: { maxSteps: 2 }, runtimeLog: { enabled: true, maxBytes: 100 }, signal: f.controller.signal },
  })
  expect(f.createRagRuntime.mock.calls[0][0]).toMatchObject({
    provider: { id: 'provider' }, conversation: { id: 'conversation', knowledgeSources: ['admitted-knowledge'] },
  })
})

it('retains deeply immutable manifest schemas, executor metadata and permissions throughout the operation await', async () => {
  const f = fixture()
  const session = await admitted(f)
  const pending = session.evaluateTurn(turn(f, session))
  for (let index = 0; index < 20; index++) await Promise.resolve()
  f.manifest.permission = 'destructive'
  f.manifest.serverId = 'later-server'
  f.manifest.metadata.executor.id = 'later-executor'
  f.catalog.manifests.push({ ...f.manifest, id: 'later-operation' })
  f.ragBarrier.resolve()
  await pending
  const input = f.executeExternal.mock.calls[0][0] as { request: { serverId: string };
    options: { manifests: typeof f.catalog.manifests; limits: object; userConfirmed: boolean } }
  expect(input.request.serverId).toBe('original-server')
  expect(input.options.manifests).toHaveLength(1)
  expect(input.options.manifests[0]).toMatchObject({ permission: 'read-only',
    metadata: { executor: { id: 'original' } } })
  expect(Object.isFrozen(input.options.manifests[0].metadata.executor)).toBe(true)
  expect(Object.isFrozen(input.options.limits)).toBe(true)
  expect(input.options.userConfirmed).toBe(false)
})

it('does not discover a model-operation catalog for a pre-aborted session', async () => {
  const f = fixture()
  f.controller.abort()
  f.barrier.resolve()
  expect(await createConversationModelOperationSession(f.input, f.dependencies)).toBeUndefined()
  expect(f.createCatalog).not.toHaveBeenCalled()
})

it.each(['resolve', 'reject'] as const)('retains original discovery cancellation after catalog %s', async mode => {
  const f = fixture()
  const pending = createConversationModelOperationSession(f.input, f.dependencies)
  f.input.signal = new AbortController().signal
  f.controller.abort()
  if (mode === 'resolve') f.barrier.resolve()
  else f.barrier.reject(new Error('late catalog failure'))
  await expect(pending).resolves.toBeUndefined()
  expect(f.executeExternal).not.toHaveBeenCalled()
})

it('checks the original operation signal again after admitted RAG-port acquisition before Tasks entry', async () => {
  const f = fixture()
  const session = await admitted(f)
  const pending = session.evaluateTurn(turn(f, session))
  for (let index = 0; index < 20; index++) await Promise.resolve()
  expect(f.createRagRuntime).toHaveBeenCalledTimes(1)
  f.controller.abort()
  f.ragBarrier.resolve()
  await pending.catch(() => undefined)
  expect(f.executeExternal).not.toHaveBeenCalled()
})

it('keeps non-cancellation discovery failure visible without creating a session', async () => {
  const f = fixture()
  const error = new Error('catalog failed')
  const pending = createConversationModelOperationSession(f.input, f.dependencies)
  f.barrier.reject(error)
  await expect(pending).rejects.toBe(error)
})

it('captures direct catalog filtering settings before the manifest-list await', async () => {
  const barrier = deferred<Awaited<ReturnType<typeof listConversationToolManifests>>>()
  jest.mocked(listConversationToolManifests).mockReturnValueOnce(barrier.promise)
  const settings = { webSearchEnabled: true, searchProvider: 'custom', customSearchEndpoint: 'https://search.example.invalid' } as Settings
  const pending = createConversationModelOperationCatalog(settings)
  settings.webSearchEnabled = false
  barrier.resolve([{ id: `builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:search_web`, name: 'search_web', source: 'builtin', description: 'Search',
    permission: 'read-only', enabled: true, serverId: BUILT_IN_CAPABILITY_SERVER_ID,
    inputSchema: { type: 'object', properties: { target: { type: 'string' } } } }])
  const result = await pending
  expect(result.ok && result.catalog.snapshot.operations).toHaveLength(1)
})

it('deeply detaches catalog schemas and metadata as data rather than shallow-freezing their owners', async () => {
  const manifest = { id: 'builtin:fixture:read', name: 'read', source: 'builtin' as const, description: 'Read',
    permission: 'read-only' as const, enabled: true, serverId: 'fixture',
    inputSchema: { type: 'object', properties: { target: { type: 'string' } } },
    metadata: { executor: { id: 'original' } } }
  jest.mocked(listConversationToolManifests).mockResolvedValueOnce([manifest])
  const result = await createConversationModelOperationCatalog({ mcpEnabled: true } as Settings)
  if (!result.ok) throw new Error(result.message)
  expect(Object.isFrozen(result.catalog.manifests[0].inputSchema!.properties)).toBe(true)
  expect(Object.isFrozen(result.catalog.manifests[0].metadata!.executor)).toBe(true)
  manifest.metadata.executor.id = 'later'
  expect(result.catalog.manifests[0].metadata).toEqual({ executor: { id: 'original' } })
})
