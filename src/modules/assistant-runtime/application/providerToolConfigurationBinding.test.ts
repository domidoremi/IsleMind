import { createAssistantProviderToolTurnRuntime } from './assistantProviderToolTurnRuntime'
import { createAssistantConversationProviderToolAdmissionRuntime } from './assistantConversationProviderToolAdmissionRuntime'
import { createAssistantConversationStreamLifecycleRuntime } from './assistantConversationStreamLifecycleRuntime'
import { createAssistantConversationFinalizationRuntime } from './assistantConversationFinalizationRuntime'
import { createAssistantConversationReplyStartRuntime } from './assistantConversationReplyStartRuntime'
import { snapshotPlainData } from '@/core'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function toolFixture() {
  const controller = new AbortController()
  const barrier = deferred<void>()
  const provider = { id: 'provider', type: 'openai', wireProtocol: 'openai-compatible' }
  const settings = { allowReadOnlyTools: true, searchProvider: 'local', outputCharLimit: 100 }
  const manifest = { id: 'builtin:read', name: 'read', permission: 'read-only', enabled: true,
    inputSchema: { type: 'object', properties: { target: { type: 'string' } } },
    metadata: { executor: { id: 'original-executor' } } }
  const manifests = [manifest]
  const limits = { maxToolCallsPerStep: 9, allowReadOnlyTools: true, outputCharLimit: 100 }
  const target = jest.fn((_provider: unknown, _options: unknown) => 'openai-chat')
  const list = jest.fn(async () => { await barrier.promise; return manifests })
  const filter = jest.fn((items: readonly typeof manifest[], value: typeof settings) =>
    value.searchProvider === 'local' ? items : [])
  const adapter = { target: 'openai-chat', tools: [{ function: { name: 'read', parameters: manifest.inputSchema } }],
    toolNameMap: [{ toolId: manifest.id, toolName: manifest.name, metadata: manifest.metadata }] }
  const declarations = jest.fn((_input: unknown) => adapter)
  const runtime = createAssistantProviderToolTurnRuntime({
    resolveDeclarationTarget: target, resolveLimits: () => limits, listManifests: list,
    filterManifests: filter, buildDeclarations: declarations,
    resolveCatalogRevision: (items: readonly typeof manifest[]) => JSON.stringify(items),
  })
  const input = { provider, settings, nativeToolSupported: true, modelPreferredEndpoint: 'chat',
    wireProtocol: provider.wireProtocol, signal: controller.signal }
  return { runtime, controller, barrier, input, provider, settings, manifest, manifests,
    limits, adapter, target, list, filter, declarations }
}

it('binds provider, filtering settings and limits before catalog discovery yields', async () => {
  const f = toolFixture()
  const pending = f.runtime.admit(f.input)
  f.settings.searchProvider = 'native'
  f.settings.outputCharLimit = 999
  f.limits.outputCharLimit = 999
  f.provider.id = 'later-provider'
  f.input.settings = { ...f.settings }
  f.input.wireProtocol = 'later-protocol'
  f.barrier.resolve()
  const result = await pending
  expect(result?.manifests).toHaveLength(1)
  expect(result?.limits).toEqual({ maxToolCallsPerStep: 1, allowReadOnlyTools: true, outputCharLimit: 100 })
  expect(f.filter.mock.calls[0][1]).toEqual({ allowReadOnlyTools: true, searchProvider: 'local', outputCharLimit: 100 })
  expect(f.target.mock.calls[0][0]).toEqual({ id: 'provider', type: 'openai', wireProtocol: 'openai-compatible' })
})

it('detaches nested manifests, declarations and name mappings from their catalog owners', async () => {
  const f = toolFixture()
  f.barrier.resolve()
  const result = (await f.runtime.admit(f.input))!
  const originalRevision = result.catalogRevision
  f.manifest.inputSchema.properties.target.type = 'number'
  f.manifest.permission = 'destructive'
  f.manifest.metadata.executor.id = 'changed-executor'
  f.adapter.tools[0].function.name = 'destroy'
  f.adapter.toolNameMap[0].toolName = 'destroy'
  f.manifests.push({ ...f.manifest, id: 'later' })
  expect(result.manifests).toHaveLength(1)
  expect(result.manifests[0]).toMatchObject({ permission: 'read-only',
    inputSchema: { properties: { target: { type: 'string' } } },
    metadata: { executor: { id: 'original-executor' } } })
  expect(result.adapter.tools[0]).toMatchObject({ function: { name: 'read' } })
  expect(result.adapter.toolNameMap[0]).toMatchObject({ toolName: 'read' })
  expect(result.catalogRevision).toBe(originalRevision)
})

it('freezes the complete admitted context without promoting visible intent to confirmation', async () => {
  const f = toolFixture()
  f.barrier.resolve()
  const result = (await f.runtime.admit(f.input))!
  for (const value of [result, result.adapter, result.adapter.tools, result.adapter.toolNameMap,
    result.manifests[0], result.manifests[0].inputSchema, result.limits]) {
    expect(Object.isFrozen(value)).toBe(true)
  }
  expect(Reflect.set(result.limits, 'maxToolCallsPerStep', 9)).toBe(false)
  expect(result).not.toHaveProperty('userConfirmed')
})

it('retains already deeply immutable manifest and declaration identities', async () => {
  const f = toolFixture()
  const manifests = snapshotPlainData(f.manifests)
  const adapter = snapshotPlainData(f.adapter)
  f.list.mockImplementation(async () => manifests)
  f.declarations.mockImplementation(() => adapter)
  const result = (await f.runtime.admit(f.input))!
  expect(result.manifests).toBe(manifests)
  expect(result.adapter.tools).toBe(adapter.tools)
})

it('does not open catalog discovery for an already cancelled admission', async () => {
  const f = toolFixture()
  f.controller.abort()
  f.barrier.resolve()
  expect(await f.runtime.admit(f.input)).toBeUndefined()
  expect(f.target).not.toHaveBeenCalled()
  expect(f.list).not.toHaveBeenCalled()
})

it.each(['resolve', 'reject'] as const)('settles original cancellation after catalog %s without admitting declarations', async mode => {
  const f = toolFixture()
  const pending = f.runtime.admit(f.input)
  f.input.signal = new AbortController().signal
  f.controller.abort(new Error('original stop'))
  if (mode === 'resolve') f.barrier.resolve()
  else f.barrier.reject(new Error('late catalog failure'))
  await expect(pending).resolves.toBeUndefined()
  expect(f.filter).not.toHaveBeenCalled()
  expect(f.declarations).not.toHaveBeenCalled()
})

it('keeps ordinary discovery rejection visible without declaring a partial catalog', async () => {
  const f = toolFixture()
  const error = new Error('catalog unavailable')
  const pending = f.runtime.admit(f.input)
  f.barrier.reject(error)
  await expect(pending).rejects.toBe(error)
  expect(f.declarations).not.toHaveBeenCalled()
})

it('rejects behavioral manifest data before filtering or declaration construction', async () => {
  const f = toolFixture()
  Object.defineProperty(f.manifest.metadata, 'dispatch', { value: () => undefined, enumerable: true })
  f.barrier.resolve()
  await expect(f.runtime.admit(f.input)).rejects.toThrow('plain data')
  expect(f.filter).not.toHaveBeenCalled()
  expect(f.declarations).not.toHaveBeenCalled()
})

it('retains the complete sixty-four-operation ceiling and rejects sixty-five before declaration binding', async () => {
  const f = toolFixture()
  f.list.mockImplementation(async () => Array.from({ length: 65 }, (_, index) => ({ ...f.manifest, id: `tool-${index}` })))
  await expect(f.runtime.admit(f.input)).rejects.toThrow('limit is 64')
  expect(f.declarations).not.toHaveBeenCalled()
})

function conversationFixture() {
  const controller = new AbortController()
  const barrier = deferred<void>()
  const context = { adapter: { tools: [{ name: 'read' }] }, limits: { maxToolCallsPerStep: 1 } }
  const support = { supported: true, reason: 'supported' }
  const admit = jest.fn(async (_input: unknown) => { await barrier.promise; return context })
  const gateway = jest.fn((_input: unknown) => ({ status: 'ready' }))
  const trace = jest.fn()
  const log = jest.fn(async (_input: unknown) => undefined)
  const runtime = createAssistantConversationProviderToolAdmissionRuntime({
    resolveSupport: () => support, admitProviderTools: admit,
    buildManifestTrace: (_context: unknown) => ({ id: 'manifest' }),
    buildSkippedTrace: (_support: unknown) => ({ id: 'skipped' }),
    appendUnclaimedCompatibilityLog: log, emitGatewayOutcome: gateway,
    buildGatewayTrace: (_outcome: unknown) => ({ id: 'gateway' }), recordTrace: trace,
  })
  const input = { conversationId: 'conversation', assistantMessageId: 'response',
    provider: { id: 'provider', wireProtocol: 'openai-compatible' },
    modelConfig: { preferredEndpoint: 'chat' }, upstreamModel: 'upstream', requestedModel: 'requested',
    settings: { mcpEnabled: true, runtimeLogEnabled: true, runtimeLogMaxBytes: 100 },
    mcpContext: { prompt: 'original prompt', tools: [{ name: 'read' }] }, signal: controller.signal }
  return { runtime, controller, barrier, input, context, support, admit, gateway, trace, log }
}

it('uses the same detached conversation admission data for support, tools and gateway attribution', async () => {
  const f = conversationFixture()
  const pending = f.runtime.admit(f.input)
  f.input.conversationId = 'later-conversation'
  f.input.provider.id = 'later-provider'
  f.input.upstreamModel = 'later-model'
  f.input.settings.mcpEnabled = false
  f.input.settings.runtimeLogMaxBytes = 999
  f.input.mcpContext.prompt = 'later prompt'
  f.input.mcpContext.tools.push({ name: 'later' })
  f.support.supported = false
  f.barrier.resolve()
  expect(await pending).toMatchObject({ kind: 'ready', support: { supported: true } })
  expect(f.gateway).toHaveBeenCalledWith(expect.objectContaining({
    conversationId: 'conversation', provider: { id: 'provider', wireProtocol: 'openai-compatible' },
    model: 'upstream', mcpEnabled: true, mcpPrompt: 'original prompt', mcpToolCount: 1,
    runtimeLog: { enabled: true, maxBytes: 100 }, nativeToolSupport: { supported: true, reason: 'supported' },
  }))
  expect(f.admit.mock.calls[0][0]).toMatchObject({ signal: f.controller.signal })
})

it.each(['before', 'resolve', 'reject'] as const)('suppresses gateway and trace admission after original conversation cancellation (%s)', async mode => {
  const f = conversationFixture()
  if (mode === 'before') f.controller.abort()
  const pending = f.runtime.admit(f.input)
  f.input.signal = new AbortController().signal
  f.controller.abort()
  if (mode === 'reject') f.barrier.reject(new Error('late failure'))
  else f.barrier.resolve()
  await expect(pending).resolves.toMatchObject({ kind: 'cancelled' })
  expect(f.gateway).not.toHaveBeenCalled()
  expect(f.trace).not.toHaveBeenCalled()
  expect(f.log).not.toHaveBeenCalled()
  if (mode === 'before') expect(f.admit).not.toHaveBeenCalled()
})

it('detaches admitted context data while reusing fully immutable context identities', async () => {
  const f = conversationFixture()
  f.barrier.resolve()
  const result = await f.runtime.admit(f.input)
  f.context.adapter.tools[0].name = 'destroy'
  expect(result).toMatchObject({ providerToolContext: { adapter: { tools: [{ name: 'read' }] } } })
  const frozen = snapshotPlainData(f.context)
  f.admit.mockImplementation(async () => frozen)
  expect((await f.runtime.admit(f.input))).toMatchObject({ providerToolContext: frozen })
  expect(f.gateway.mock.calls[1][0]).toMatchObject({ providerToolContext: frozen })
})

it('captures provider-tool data at lifecycle build and preserves only callable live ports', async () => {
  const finalize = jest.fn(async (_input: unknown) => 'finalized')
  const runtime = createAssistantConversationStreamLifecycleRuntime({
    finalize, failProvider: jest.fn(), projectCompletionFailure: jest.fn(), projectStartFailure: jest.fn(),
  })
  const providerTools = { manifests: [{ id: 'read', inputSchema: { type: 'object' } }],
    adapter: { tools: [{ name: 'read' }] }, limits: { maxToolCallsPerStep: 1 } }
  const input = { conversationId: 'conversation', assistantMessageId: 'response',
    provider: { id: 'provider' }, runtimeConversation: { model: 'model' }, settings: {},
    context: {}, modelTraceId: 'trace', nativeSearchTraceId: 'search', providerWebSearchMode: 'off',
    systemPrompt: '', packedMessages: [], baseContextPrompt: '', mcpTools: [], providerTools,
    upstreamModel: 'model', remoteCompactStrategy: 'off', remoteCompactCapabilityKind: 'none',
    remoteCompactClassification: 'off' }
  const lifecycle = runtime.build(input)
  providerTools.manifests[0].inputSchema.type = 'number'
  providerTools.adapter.tools[0].name = 'destroy'
  providerTools.limits.maxToolCallsPerStep = 9
  const controller = new AbortController()
  const observer = jest.fn(async () => undefined)
  await lifecycle.complete({}, { requestController: controller, flush: jest.fn(), onExecutionTarget: observer })
  expect(finalize).toHaveBeenCalledWith(expect.objectContaining({
    providerTools: { manifests: [{ id: 'read', inputSchema: { type: 'object' } }],
      adapter: { tools: [{ name: 'read' }] }, limits: { maxToolCallsPerStep: 1 } },
    requestController: controller, onExecutionTarget: observer,
  }))
})

it('captures provider-tool data before finalization flush rather than treating the context as a live adapter', async () => {
  const barrier = deferred<void>()
  const revise = jest.fn(async (_input: unknown) => null)
  const runtime = createAssistantConversationFinalizationRuntime({
    acquireDetachedWork: () => ({ signal: new AbortController().signal, release: jest.fn(), settle: jest.fn() }),
    flushStreamingMessage: async () => barrier.promise, getActiveStream: () => undefined, clearActiveStream: jest.fn(),
    getMessage: () => ({ id: 'response', status: 'streaming', content: 'tagged', startedAt: 1 }),
    getConversation: () => undefined, getSettings: () => ({}), mergeUsage: (_a, b) => b,
    verifyInitialGeneration: () => ({}), hasTaggedToolRequest: () => true, reviseWithMcpTools: revise,
    resolveSupplementalEvidence: async () => ({ status: 'skipped' as const, reason: 'not_needed', sources: [], citations: [] }),
    now: () => 2, buildSuccessPlan: () => ({ kind: 'skip' as const }),
    recordRemoteCompactCompleted: jest.fn(), recordRemoteCompactFailed: jest.fn(), commitSuccess: jest.fn(),
    updateProviderCredentialGroupHealth: jest.fn(), recordRagEvaluation: jest.fn(),
    buildTrace: value => value, completeTrace: value => value, recordTrace: jest.fn(),
    getMessageWithStreamingTraceState: () => null, settleRunningTraces: jest.fn(), translate: key => key,
    extractMemory: jest.fn(), projectProviderModelFailure: jest.fn(), projectProviderNativeSearchFailure: jest.fn(),
    projectProviderTerminalFailure: jest.fn(),
  })
  const providerTools = { manifests: [{ id: 'read', metadata: { executor: 'original' } }], limits: { maxToolCallsPerStep: 1 } }
  const pending = runtime.finalize({ conversationId: 'conversation', assistantMessageId: 'response', result: { text: 'tagged' },
    context: { sources: [] }, runtimeConversation: { title: '', model: 'model', messages: [] },
    provider: { id: 'provider' }, settings: {}, providerTools, mcpTools: [], modelTraceId: 'trace', nativeSearchTraceId: 'search',
    providerWebSearchMode: 'off', systemPrompt: '', packedMessages: [], baseContextPrompt: '',
    requestController: new AbortController(), chunkFlush: jest.fn(), upstreamModel: 'model',
    remoteCompactStrategy: 'off', remoteCompactCapabilityKind: 'none', remoteCompactClassification: 'off' })
  providerTools.manifests[0].metadata.executor = 'later'
  providerTools.limits.maxToolCallsPerStep = 99
  barrier.resolve()
  await pending
  expect(revise).toHaveBeenCalledWith(expect.objectContaining({
    providerTools: { manifests: [{ id: 'read', metadata: { executor: 'original' } }], limits: { maxToolCallsPerStep: 1 } },
  }))
})

it.each(['tool admission', 'session catalog'] as const)('does not plan or dispatch a reply after cancellation during %s', async stage => {
  const controller = new AbortController()
  const barrier = deferred<void>()
  const provider = { id: 'provider', apiKey: 'synthetic-key' }
  const settings = { memoryEnabled: false }
  const conversation = { id: 'conversation', title: '', model: 'model', messages: [] }
  const toolAdmission = jest.fn(async (input: { signal?: AbortSignal }) => {
    expect(input.signal).toBe(controller.signal)
    if (stage === 'tool admission') await barrier.promise
    return { kind: 'ready' as const }
  })
  const session = jest.fn(async (input: { signal?: AbortSignal }) => {
    expect(input.signal).toBe(controller.signal)
    if (stage === 'session catalog') await barrier.promise
    return undefined
  })
  const planning = jest.fn()
  const dispatch = jest.fn()
  const runtime = createAssistantConversationReplyStartRuntime({
    replySessionRuntime: { start: async () => ({ kind: 'ready' as const, conversation,
      message: { id: 'response' }, requestController: controller }) },
    getProviderSettingsState: () => ({ settings, providers: [provider] }), getSettings: () => settings,
    providerAdmissionRuntime: { admit: async () => ({ kind: 'ready' as const,
      conversation, provider, upstreamModel: 'model', modelConfig: {} }) },
    persistAdmissionConversation: jest.fn(async () => undefined), getLatestConversation: () => conversation,
    filterSendableAttachments: () => [], workspaceSourceRuntime: { resolve: async () => undefined },
    workspaceWritebackHandoffRuntime: { admitResolvedSource: () => ({ status: 'none' as const }), bindRun: jest.fn() },
    projectWorkspaceWritebackHandoffTerminal: jest.fn(), plainChatHandoffRuntime: { handoff: async () => ({ kind: 'continue' as const }) },
    contextAcquisitionRuntime: { acquire: async () => ({ kind: 'ready' as const, context: { sources: [], prompt: '' },
      fallbackProviders: [provider], searchMode: 'off', webSources: [], mcpContext: { tools: [], prompt: '' } }) },
    providerToolAdmissionRuntime: { admit: toolAdmission }, createModelOperationSession: session,
    requestPlanningRuntime: { plan: planning }, streamLifecycleRuntime: { build: jest.fn() },
    durableDispatchRuntime: { dispatch },
  })
  const pending = runtime.start({ conversationId: 'conversation' })
  for (let index = 0; index < 20; index++) await Promise.resolve()
  expect(stage === 'tool admission' ? toolAdmission : session).toHaveBeenCalledTimes(1)
  controller.abort()
  barrier.resolve()
  await expect(pending).resolves.toMatchObject({ kind: 'terminal', stage: 'provider_tool_admission',
    outcome: { kind: 'cancelled' } })
  expect(planning).not.toHaveBeenCalled()
  expect(dispatch).not.toHaveBeenCalled()
  if (stage === 'tool admission') expect(session).not.toHaveBeenCalled()
})

it('carries detached producing-provider data and the live continuation admission port through finalization', async () => {
  const finalize = jest.fn(async (_input: unknown) => 'done')
  const runtime = createAssistantConversationStreamLifecycleRuntime({
    finalize, failProvider: jest.fn(), projectCompletionFailure: jest.fn(), projectStartFailure: jest.fn(),
  })
  const lifecycle = runtime.build({ conversationId: 'conversation', assistantMessageId: 'response', provider: { id: 'preferred' },
    runtimeConversation: { model: 'preferred-model' }, context: {}, modelTraceId: 'trace', nativeSearchTraceId: 'search',
    providerWebSearchMode: 'off', systemPrompt: '', packedMessages: [], baseContextPrompt: '', mcpTools: [],
    upstreamModel: 'preferred-model', remoteCompactStrategy: 'off', remoteCompactCapabilityKind: 'none',
    remoteCompactClassification: 'off' })
  const admit = jest.fn()
  const providerContinuation = { provider: { id: 'actual', name: 'Actual', type: 'openai' as const,
    enabled: true, models: ['actual-model'], apiKey: 'synthetic-key' }, model: 'actual-model', admit }
  const controller = new AbortController()
  await lifecycle.complete({}, { requestController: controller, flush: jest.fn(), providerContinuation })
  expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ providerContinuation }))
  expect((finalize.mock.calls[0][0] as { providerContinuation: { admit: unknown } }).providerContinuation.admit).toBe(admit)
})
