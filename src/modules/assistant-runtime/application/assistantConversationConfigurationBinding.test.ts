import { createAssistantConversationReplyStartRuntime } from './assistantConversationReplyStartRuntime'
import { createAssistantConversationContextAcquisitionRuntime } from './assistantConversationContextAcquisitionRuntime'
import { createAssistantConversationKnowledgeContextRuntime } from './assistantConversationKnowledgeContextRuntime'
import { createAssistantConversationStreamLifecycleRuntime } from './assistantConversationStreamLifecycleRuntime'
import { createAssistantConversationFinalizationRuntime } from './assistantConversationFinalizationRuntime'
import { createAssistantMcpToolTurnRuntime } from './assistantMcpToolTurnRuntime'
import type { ProcessTrace, ToolContentBlock } from '@/core'
import { createAssistantConversationPlainChatHandoffRuntime } from './assistantConversationPlainChatHandoffRuntime'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail })
  return { promise, resolve, reject }
}
const tick = async () => { for (let index = 0; index < 8; index++) await Promise.resolve() }

function replyFixture() {
  const controller = new AbortController()
  const provider = { id: 'provider', apiKey: 'fixture-key' }
  const settings = { memoryEnabled: true, nested: { maxSteps: 2 } }
  const providers = [provider]
  const conversation = { id: 'conversation', model: 'preferred-model', title: 'Admitted',
    messages: [{ id: 'user', role: 'user' as const, content: 'original request' }] }
  const admissionBarrier = deferred<void>()
  const persistenceBarrier = deferred<void>()
  const getSettings = jest.fn(() => ({ memoryEnabled: false, nested: { maxSteps: 9 } }))
  const admit = jest.fn(async (_input: unknown) => {
    await admissionBarrier.promise
    return { kind: 'ready' as const, conversation, provider, upstreamModel: 'upstream-model', modelConfig: {} }
  })
  const handoff = jest.fn(async (_input: unknown) => ({ kind: 'continue' as const }))
  const acquire = jest.fn(async (_input: unknown) => ({ kind: 'ready' as const,
    context: { sources: [], prompt: '' }, fallbackProviders: [], searchMode: 'off',
    webSources: [], mcpContext: { prompt: '', tools: [] } }))
  const toolAdmit = jest.fn(async (_input: unknown) => ({ kind: 'ready' as const }))
  const modelSession = jest.fn(async (_input: unknown) => undefined)
  const plan = jest.fn(async (_input: unknown) => ({ kind: 'planned' as const,
    retrievalSources: [], providerWebSearchMode: 'off', nativeSearchTraceId: 'search',
    systemPrompt: 'system', activePrompt: { messages: [], contextPrompt: '' },
    contextPlan: { windowState: {}, fragments: [] },
    compactDecision: { enabled: false, mode: 'auto', strategy: 'off', capabilityKind: 'none', remoteClassification: 'off' },
    remoteCompactProbe: { estimatedInputTokens: 1 } }))
  const build = jest.fn((_input: unknown) => ({}))
  const dispatch = jest.fn(async (input: { buildStreamLifecycle: (value: { modelTraceId: string }) => unknown }) => {
    input.buildStreamLifecycle({ modelTraceId: 'model' })
    return { kind: 'dispatched' as const,
      providerDispatchOutcome: { kind: 'dispatched' as const, streamingOutcome: { kind: 'started' as const } } }
  })
  const persist = jest.fn(async (_input: unknown) => { await persistenceBarrier.promise })
  const runtime = createAssistantConversationReplyStartRuntime({
    replySessionRuntime: { start: async () => ({ kind: 'ready' as const, conversation,
      message: { id: 'response' }, requestController: controller }) },
    getProviderSettingsState: () => ({ settings, providers }), getSettings,
    providerAdmissionRuntime: { admit }, persistAdmissionConversation: persist,
    getLatestConversation: () => conversation, filterSendableAttachments: () => [],
    workspaceSourceRuntime: { resolve: async () => undefined },
    workspaceWritebackHandoffRuntime: {
      admitResolvedSource: () => ({ status: 'none' as const }),
      bindRun: jest.fn(),
    },
    projectWorkspaceWritebackHandoffTerminal: jest.fn(),
    plainChatHandoffRuntime: { handoff }, contextAcquisitionRuntime: { acquire },
    providerToolAdmissionRuntime: { admit: toolAdmit }, createModelOperationSession: modelSession,
    requestPlanningRuntime: { plan }, streamLifecycleRuntime: { build },
    durableDispatchRuntime: { dispatch },
  })
  return { runtime, controller, provider, settings, providers, conversation, admissionBarrier,
    persistenceBarrier, getSettings, admit, handoff, acquire, toolAdmit, modelSession, plan, build, dispatch, persist }
}

it('carries the provider-admission settings snapshot through Rich context, tools, planning, dispatch and lifecycle', async () => {
  const f = replyFixture()
  const pending = f.runtime.start({ conversationId: 'conversation' })
  await tick()
  f.settings.memoryEnabled = false
  f.settings.nested.maxSteps = 99
  f.providers.push({ id: 'later-provider', apiKey: 'later-key' })
  f.admissionBarrier.resolve()
  await tick()
  f.provider.apiKey = 'changed-during-persistence'
  f.conversation.model = 'changed-during-persistence'
  f.persistenceBarrier.resolve()
  await expect(pending).resolves.toMatchObject({ kind: 'completed' })
  const admitted = f.admit.mock.calls[0][0] as { settings: unknown; providers: unknown }
  expect(admitted.settings).toEqual({ memoryEnabled: true, nested: { maxSteps: 2 } })
  expect(admitted.providers).toEqual([{ id: 'provider', apiKey: 'fixture-key' }])
  for (const port of [f.handoff, f.acquire, f.toolAdmit, f.modelSession, f.plan, f.build]) {
    expect(port.mock.calls[0][0]).toMatchObject({
      settings: admitted.settings, provider: { id: 'provider', apiKey: 'fixture-key' },
    })
  }
  expect(f.dispatch.mock.calls[0][0]).toMatchObject({ settings: admitted.settings })
  expect(f.acquire.mock.calls[0][0]).toMatchObject({ providers: admitted.providers,
    runtimeConversation: { model: 'preferred-model' }, signal: f.controller.signal })
  expect(f.getSettings).not.toHaveBeenCalled()
})

function acquisitionFixture() {
  const controller = new AbortController()
  const barrier = deferred<{ id: string; apiKey: string }[]>()
  const listFallbackProviders = jest.fn((_options?: unknown) => barrier.promise)
  const getKnowledgeSettings = jest.fn((settings?: unknown) => settings ?? { knowledgeEnabled: false })
  const resolveKnowledgeContext = jest.fn(async (_input: unknown) => ({
    kind: 'ready' as const, context: { sources: [], prompt: '' },
  }))
  const resolveMcpContext = jest.fn(async (_input: unknown) => ({
    kind: 'disabled' as const, prompt: '', tools: [], traces: [],
  }))
  const resolveSearchMode = jest.fn((settings: { mcpEnabled?: boolean }) => settings.mcpEnabled)
  const input = { conversationId: 'conversation', assistantMessageId: 'response',
    provider: { id: 'provider', apiKey: 'fixture-key' },
    providers: [{ id: 'provider', apiKey: 'fixture-key' }],
    runtimeConversation: { id: 'conversation', knowledgeSources: ['original-scope'] },
    lastUserMessage: { content: 'original request' },
    settings: { knowledgeEnabled: true, mcpEnabled: false }, signal: controller.signal }
  const runtime = createAssistantConversationContextAcquisitionRuntime({
    listFallbackProviders, getKnowledgeSettings, resolveKnowledgeContext,
    isReplyCancelled: () => false, resolveSearchMode, createEmptyWebSources: () => [],
    resolveMcpContext, recordTrace: jest.fn(), mcpFailureContent: () => 'failed', projectTerminalFailure: jest.fn(),
  })
  return { controller, barrier, input, runtime, listFallbackProviders, getKnowledgeSettings,
    resolveKnowledgeContext, resolveMcpContext, resolveSearchMode }
}

it('binds fallback selection and knowledge settings before provider awaits rather than rereading the store', async () => {
  const f = acquisitionFixture()
  const pending = f.runtime.acquire(f.input)
  f.input.settings.knowledgeEnabled = false
  f.input.settings.mcpEnabled = true
  f.input.provider.apiKey = 'later-key'
  f.input.runtimeConversation.knowledgeSources.push('later-scope')
  f.input.lastUserMessage.content = 'later request'
  f.barrier.resolve([{ id: 'provider', apiKey: 'fixture-key' }])
  await expect(pending).resolves.toMatchObject({ kind: 'ready' })
  expect(f.listFallbackProviders).toHaveBeenCalledWith({
    settings: { knowledgeEnabled: true, mcpEnabled: false },
    providers: [{ id: 'provider', apiKey: 'fixture-key' }], signal: f.controller.signal,
  })
  expect(f.resolveKnowledgeContext).toHaveBeenCalledWith(expect.objectContaining({
    settings: { knowledgeEnabled: true, mcpEnabled: false },
    provider: { id: 'provider', apiKey: 'fixture-key' },
    conversation: { id: 'conversation', knowledgeSources: ['original-scope'] },
    userMessage: { content: 'original request' }, signal: f.controller.signal,
  }))
  expect(f.resolveMcpContext).toHaveBeenCalledWith(expect.objectContaining({ mcpEnabled: false }))
})

it('checks entry cancellation before fallback admission', async () => {
  const f = acquisitionFixture()
  f.barrier.resolve([])
  f.controller.abort()
  await expect(f.runtime.acquire(f.input)).resolves.toMatchObject({ kind: 'cancelled' })
  expect(f.listFallbackProviders).not.toHaveBeenCalled()
  expect(f.resolveKnowledgeContext).not.toHaveBeenCalled()
})

it.each(['success', 'rejection'] as const)('settles fallback %s and suppresses later knowledge/MCP admission after original cancellation', async mode => {
  const f = acquisitionFixture()
  let settled = false
  const pending = f.runtime.acquire(f.input).finally(() => { settled = true })
  f.input.signal = new AbortController().signal
  f.controller.abort()
  await tick()
  expect(settled).toBe(false)
  if (mode === 'success') f.barrier.resolve([])
  else f.barrier.reject(new Error('late catalog failure'))
  await expect(pending).resolves.toMatchObject({ kind: 'cancelled' })
  expect(f.resolveKnowledgeContext).not.toHaveBeenCalled()
  expect(f.resolveMcpContext).not.toHaveBeenCalled()
})

it('forwards full knowledge settings and explicit provider:null while keeping trace evidence detached', async () => {
  const controller = new AbortController()
  const barrier = deferred<{ sources: never[]; prompt: string }>()
  const retrieve = jest.fn((_conversation: unknown, _message: unknown, _signal: AbortSignal, _options?: unknown) => barrier.promise)
  const recordTrace = jest.fn()
  const input = { conversationId: 'conversation', assistantMessageId: 'response',
    conversation: { knowledgeSources: ['original-scope'] }, userMessage: { content: 'original request' },
    provider: null, settings: { knowledgeEnabled: true, memoryEnabled: true, ragMode: 'deep',
      knowledgeMaxItems: 3 }, signal: controller.signal }
  const runtime = createAssistantConversationKnowledgeContextRuntime({
    retrieve, createEmptyContext: () => ({ sources: [], prompt: '' }),
    isCancellation: (_error: unknown, signal: AbortSignal) => signal.aborted,
    now: () => 1, traceId: (prefix: string) => prefix,
    buildTrace: (value: unknown) => value, completeTrace: (value: unknown) => value,
    recordTrace, translate: (key: string) => key,
  })
  const pending = runtime.resolveContext(input)
  input.settings.knowledgeEnabled = false
  input.settings.knowledgeMaxItems = 99
  input.userMessage.content = 'later request'
  barrier.resolve({ sources: [], prompt: '' })
  await expect(pending).resolves.toMatchObject({ kind: 'ready' })
  expect(retrieve).toHaveBeenCalledWith({ knowledgeSources: ['original-scope'] },
    { content: 'original request' }, controller.signal,
    { settings: { knowledgeEnabled: true, memoryEnabled: true, ragMode: 'deep', knowledgeMaxItems: 3 }, provider: null })
  expect(recordTrace.mock.calls.at(-1)?.[0]).toMatchObject({
    trace: { metadata: { knowledgeEnabled: true, memoryEnabled: true } },
  })
})

it('suppresses later knowledge projections when the completed context observer cancels the original signal', async () => {
  const controller = new AbortController()
  const retrieve = jest.fn(async () => ({
    sources: [
      { type: 'memory', title: 'Memory', content: 'memory evidence' },
      { type: 'knowledge', title: 'Knowledge', content: 'knowledge evidence' },
    ],
    prompt: 'evidence',
    trace: [{ id: 'raw-retrieval', stage: 'retrieval', title: 'Retrieved', status: 'done' as const, startedAt: 1 }],
  }))
  const recordTrace = jest.fn((input: { trace: { status?: string } }) => {
    if (input.trace.status === 'done') controller.abort()
  })
  const runtime = createAssistantConversationKnowledgeContextRuntime({
    retrieve, createEmptyContext: () => ({ sources: [], prompt: '', trace: [] }),
    isCancellation: (_error: unknown, signal: AbortSignal) => signal.aborted,
    now: () => 1, traceId: (prefix: string) => prefix,
    buildTrace: (value: unknown) => value as { status?: string },
    completeTrace: (value: { status?: string }) => value,
    recordTrace, translate: (key: string) => key,
  })
  const input = { conversationId: 'conversation', assistantMessageId: 'response',
    conversation: { id: 'conversation' }, userMessage: { content: 'request' },
    settings: { memoryEnabled: true, knowledgeEnabled: true }, signal: controller.signal }
  const pending = runtime.resolveContext(input)
  input.signal = new AbortController().signal
  await expect(pending).resolves.toEqual({ kind: 'cancelled' })
  expect(recordTrace.mock.calls.map(([value]) => value.trace.status)).toEqual(['running', 'done'])
})

it('captures lifecycle settings and identities at build, but retains callable ports and the owned controller', async () => {
  const finalize = jest.fn(async (_input: unknown) => 'finalized')
  const failure = jest.fn()
  const runtime = createAssistantConversationStreamLifecycleRuntime({
    finalize, failProvider: failure, projectCompletionFailure: failure, projectStartFailure: failure,
  })
  const input = { conversationId: 'conversation', assistantMessageId: 'response',
    context: {}, runtimeConversation: { model: 'original-model' }, provider: { id: 'provider', apiKey: 'fixture-key' },
    settings: { memoryEnabled: true }, modelTraceId: 'model', nativeSearchTraceId: 'search',
    providerWebSearchMode: 'off', systemPrompt: '', packedMessages: [], baseContextPrompt: '',
    mcpTools: [], upstreamModel: 'upstream', remoteCompactStrategy: 'off',
    remoteCompactCapabilityKind: 'none', remoteCompactClassification: 'off' }
  const lifecycle = runtime.build(input)
  input.settings.memoryEnabled = false
  input.provider.id = 'later-provider'
  input.runtimeConversation.model = 'later-model'
  input.conversationId = 'later-conversation'
  const controller = new AbortController()
  const flush = jest.fn()
  await expect(lifecycle.complete({}, { requestController: controller, flush })).resolves.toBe('finalized')
  expect(finalize).toHaveBeenCalledWith(expect.objectContaining({
    conversationId: 'conversation', provider: { id: 'provider', apiKey: 'fixture-key' },
    settings: { memoryEnabled: true }, runtimeConversation: { model: 'original-model' },
    requestController: controller, chunkFlush: flush,
  }))
  lifecycle.completionFailed(new Error('failed'))
  expect(failure).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conversation', providerId: 'provider' }))
})

function finalizationFixture() {
  const controller = new AbortController()
  const detachedController = new AbortController()
  const barrier = deferred<void>()
  const extractionBarrier = deferred<unknown>()
  const release = jest.fn()
  const extractMemory = jest.fn((_input: unknown) => extractionBarrier.promise)
  const getSettings = jest.fn(() => ({ memoryEnabled: false, marker: 'live' }))
  const settings = { memoryEnabled: true, marker: 'admitted' }
  const message = { id: 'response', status: 'streaming', content: 'first answer', startedAt: 1 }
  const conversation = { id: 'conversation', title: 'Admitted', model: 'original-model',
    messages: [{ ...message, id: 'user', status: 'done' }] }
  const committed = { ...conversation, messages: [{ ...message, content: 'committed answer', status: 'done' }] }
  let committedRead = false
  const events: string[] = []
  const flushStreamingMessage = jest.fn(async () => { await barrier.promise })
  const reviseWithMcpTools = jest.fn(async (_input: unknown) => ({ text: 'revised answer' }))
  const resolveSupplementalEvidence = jest.fn(async (_input: unknown) => ({
    status: 'skipped' as const, reason: 'verification_not_needed', sources: [], citations: [],
  }))
  const recordRemoteCompactCompleted = jest.fn((_input: unknown) => { events.push('compact') })
  const commitSuccess = jest.fn(() => { events.push('commit'); committedRead = true })
  const runtime = createAssistantConversationFinalizationRuntime({
    acquireDetachedWork: () => ({ signal: detachedController.signal, release, settle: release }),
    flushStreamingMessage, getActiveStream: () => undefined, clearActiveStream: jest.fn(),
    getMessage: () => message, getConversation: () => committedRead ? committed : conversation,
    getSettings, mergeUsage: (_base, extra) => extra,
    verifyInitialGeneration: () => ({ needsFlare: false }),
    reviseWithMcpTools, resolveSupplementalEvidence, now: () => 2,
    buildSuccessPlan: () => {
      events.push('eligibility')
      return { kind: 'project' as const, messagePatch: { usage: { inputTokens: 1, outputTokens: 1 } } }
    },
    recordRemoteCompactCompleted, recordRemoteCompactFailed: jest.fn(), commitSuccess,
    updateProviderCredentialGroupHealth: jest.fn(async () => undefined), recordRagEvaluation: jest.fn(),
    buildTrace: (value: unknown) => value, completeTrace: (value: unknown) => value,
    recordTrace: jest.fn(), getMessageWithStreamingTraceState: () => null,
    settleRunningTraces: jest.fn(), translate: (key: string) => key, extractMemory,
    projectProviderModelFailure: jest.fn(), projectProviderNativeSearchFailure: jest.fn(), projectProviderTerminalFailure: jest.fn(),
  })
  const input = { conversationId: 'conversation', assistantMessageId: 'response',
    result: { text: 'first answer' }, context: { sources: [] }, runtimeConversation: conversation,
    provider: { id: 'provider', apiKey: 'fixture-key' }, settings, modelTraceId: 'model',
    nativeSearchTraceId: 'search', providerWebSearchMode: 'off' as const, systemPrompt: '',
    packedMessages: [], baseContextPrompt: '', mcpTools: [{}], requestController: controller,
    chunkFlush: jest.fn(), upstreamModel: 'upstream-model', remoteCompactEligible: true,
    remoteCompactStrategy: 'off', remoteCompactCapabilityKind: 'none', remoteCompactClassification: 'off' }
  return { controller, detachedController, barrier, extractionBarrier, release, extractMemory, getSettings,
    input, runtime, committed, reviseWithMcpTools, resolveSupplementalEvidence, recordRemoteCompactCompleted, commitSuccess, events }
}

it('binds finalization before flush and passes one snapshot to tagged revision, supplemental retrieval, compact persistence and detached extraction', async () => {
  const f = finalizationFixture()
  const pending = f.runtime.finalize(f.input)
  f.input.settings.memoryEnabled = false
  f.input.settings.marker = 'later'
  f.input.provider.apiKey = 'later-key'
  f.input.runtimeConversation.model = 'later-model'
  f.input.requestController = new AbortController()
  f.barrier.resolve()
  await expect(pending).resolves.toMatchObject({ kind: 'completed' })
  for (const port of [f.reviseWithMcpTools, f.resolveSupplementalEvidence, f.recordRemoteCompactCompleted, f.extractMemory]) {
    expect(port.mock.calls[0][0]).toMatchObject({ settings: { memoryEnabled: true, marker: 'admitted' } })
  }
  expect(f.reviseWithMcpTools.mock.calls[0][0]).toMatchObject({ signal: f.controller.signal,
    provider: { id: 'provider', apiKey: 'fixture-key' }, conversation: { model: 'original-model' } })
  expect(f.extractMemory.mock.calls[0][0]).toMatchObject({
    messages: [expect.objectContaining({ content: 'committed answer', status: 'done' })],
    model: 'upstream-model', signal: f.detachedController.signal,
  })
  expect(f.getSettings).not.toHaveBeenCalled()
  expect(f.release).not.toHaveBeenCalled()
  expect(f.events).toEqual(['eligibility', 'compact', 'commit'])
  f.extractionBarrier.resolve(undefined)
  await tick()
  expect(f.release).toHaveBeenCalledTimes(1)
})

it.each(['resolve', 'reject', 'throw'] as const)('settles the exact detached lease once on extractor %s without holding reply completion', async mode => {
  const f = finalizationFixture()
  if (mode === 'throw') f.extractMemory.mockImplementation(() => { throw new Error('synchronous extractor failure') })
  f.barrier.resolve()
  await expect(f.runtime.finalize(f.input)).resolves.toMatchObject({ kind: 'completed' })
  if (mode !== 'throw') {
    expect(f.release).not.toHaveBeenCalled()
    if (mode === 'resolve') f.extractionBarrier.resolve(undefined)
    else f.extractionBarrier.reject(new Error('extractor failure'))
  }
  await tick()
  expect(f.release).toHaveBeenCalledTimes(1)
})

it('uses one entry fallback for old finalization callers that do not supply settings', async () => {
  const f = finalizationFixture()
  const { settings: _settings, ...legacyInput } = f.input
  const pending = f.runtime.finalize(legacyInput)
  f.barrier.resolve()
  await pending
  expect(f.getSettings).toHaveBeenCalledTimes(1)
  expect(f.extractMemory.mock.calls[0][0]).toMatchObject({ settings: { memoryEnabled: false, marker: 'live' } })
  f.extractionBarrier.resolve(undefined)
  await tick()
})

it('releases the detached lease and retains reply success when committed extraction data cannot be captured', async () => {
  const f = finalizationFixture()
  Object.defineProperty(f.committed.messages[0], 'uncopyable', { value: new Date(0), enumerable: true })
  f.barrier.resolve()
  await expect(f.runtime.finalize(f.input)).resolves.toMatchObject({ kind: 'completed' })
  expect(f.extractMemory).not.toHaveBeenCalled()
  expect(f.release).toHaveBeenCalledTimes(1)
  expect(f.commitSuccess).toHaveBeenCalledTimes(1)
})

function taggedFixture() {
  const controller = new AbortController()
  const barrier = deferred<{
    observation: { ok: boolean; status: string; blocks: { type: 'text'; text: string }[];
      diagnostic: { id: string; type: 'tool'; title: string; status: 'done'; startedAt: number } }
  }>()
  const settings = { allowReadOnlyTools: true, maxTokens: 8 }
  const getSettings = jest.fn(() => ({ allowReadOnlyTools: false, maxTokens: 99 }))
  const tool = { server: { id: 'mcp', name: 'Fixture', enabled: true, status: 'connected' },
    tool: { name: 'read', enabled: true, permission: 'read-only' as const } }
  const executeTask = jest.fn((_input: unknown) => barrier.promise)
  const synthesize = jest.fn(async (_input: Record<string, unknown>) => ({ text: 'synthesized answer' }))
  const parameters = jest.fn((input: { settings: typeof settings }) => ({ maxTokens: input.settings.maxTokens }))
  const recordTrace = jest.fn()
  const runtime = createAssistantMcpToolTurnRuntime({
    parseRequest: () => ({ toolName: 'read', arguments: {} }), findTool: () => tool,
    getSettings, resolveLimits: (value: typeof settings) => ({ allowReadOnlyTools: value.allowReadOnlyTools }),
    buildRuntimeLogOptions: () => ({}), executeTask, truncateBlocks: (blocks: ToolContentBlock[]) => blocks,
    formatBlocks: () => 'tool evidence', buildRevisionSystemPrompt: (value: string) => value,
    buildRevisionMessages: (input: { messages: readonly unknown[] }) => input.messages,
    resolveGenerationParameters: parameters, synthesize, sanitizeAnswer: (value: string) => value,
    translate: (key: string) => key, buildTraceMetadata: () => ({}),
    completeTrace: (value: ProcessTrace) => value, recordTrace, traceId: (prefix: string) => prefix, now: () => 1,
  })
  const input = { conversationId: 'conversation', assistantMessageId: 'response',
    conversation: { id: 'conversation', model: 'original-model' },
    provider: { id: 'provider', apiKey: 'fixture-key' }, settings,
    systemPrompt: '', messages: [], baseContextPrompt: '', firstOutput: 'tagged request', tools: [tool], signal: controller.signal }
  const result = { observation: { ok: true, status: 'done', blocks: [{ type: 'text' as const, text: 'evidence' }],
    diagnostic: { id: 'receipt', type: 'tool' as const, title: 'Receipt', status: 'done' as const, startedAt: 1 } } }
  return { controller, barrier, settings, getSettings, runtime, input, executeTask, synthesize, parameters, recordTrace, result }
}

it('uses the original tagged-tool configuration for limits and answer synthesis after the tool await', async () => {
  const f = taggedFixture()
  const pending = f.runtime.execute(f.input)
  f.settings.allowReadOnlyTools = false
  f.settings.maxTokens = 99
  f.input.provider.apiKey = 'later-key'
  f.input.conversation.model = 'later-model'
  f.barrier.resolve(f.result)
  await expect(pending).resolves.toEqual({ text: 'synthesized answer' })
  expect(f.synthesize).toHaveBeenCalledWith(expect.objectContaining({
    settings: { allowReadOnlyTools: true, maxTokens: 8 },
    provider: { id: 'provider', apiKey: 'fixture-key' }, model: 'original-model', maxTokens: 8,
  }))
  expect(f.getSettings).not.toHaveBeenCalled()
  expect(f.executeTask).toHaveBeenCalledWith(expect.objectContaining({
    options: expect.objectContaining({ intentVisible: true, userConfirmed: false, signal: f.controller.signal }),
  }))
})

it('does not synthesize after cancellation of the original tagged request signal', async () => {
  const f = taggedFixture()
  const pending = f.runtime.execute(f.input)
  f.input.signal = new AbortController().signal
  f.controller.abort()
  f.barrier.resolve(f.result)
  await expect(pending).resolves.toBeNull()
  expect(f.synthesize).not.toHaveBeenCalled()
})

it('does not admit a tagged task after the running trace cancels its original signal', async () => {
  const f = taggedFixture()
  f.barrier.resolve(f.result)
  f.recordTrace.mockImplementationOnce(() => f.controller.abort())
  await expect(f.runtime.execute(f.input)).resolves.toBeNull()
  expect(f.executeTask).not.toHaveBeenCalled()
  expect(f.synthesize).not.toHaveBeenCalled()
})

it('waits for a rejected admitted tagged task but does not turn cancellation into a synthesis failure', async () => {
  const f = taggedFixture()
  const pending = f.runtime.execute(f.input)
  f.input.signal = new AbortController().signal
  f.controller.abort()
  f.barrier.reject(new Error('late task failure'))
  await expect(pending).resolves.toBeNull()
  expect(f.synthesize).not.toHaveBeenCalled()
  expect(f.recordTrace.mock.calls.map(([trace]) => trace.status)).toEqual(['running'])
})

it('settles late synthesis without accepting its answer after original cancellation', async () => {
  const f = taggedFixture()
  const synthesis = deferred<{ text: string }>()
  f.synthesize.mockImplementationOnce(() => synthesis.promise)
  f.barrier.resolve(f.result)
  const pending = f.runtime.execute(f.input)
  await tick()
  expect(f.synthesize).toHaveBeenCalledTimes(1)
  f.input.signal = new AbortController().signal
  f.controller.abort()
  synthesis.resolve({ text: 'late answer' })
  await expect(pending).resolves.toBeNull()
})

it('detaches Plain handoff configuration while retaining runtime ports and cancellation ownership', async () => {
  const controller = new AbortController()
  const barrier = deferred<{ done: Promise<void> }>()
  const done = deferred<void>()
  const startPlainChatRun = jest.fn((_input: unknown) => barrier.promise)
  const runtime = createAssistantConversationPlainChatHandoffRuntime({
    isEligible: () => true, getPersistedConversation: () => input.runtimeConversation,
    isReplyCancelled: () => controller.signal.aborted, startPlainChatRun,
    setActiveStream: jest.fn(), getActiveStream: () => undefined, clearActiveStream: jest.fn(),
    projectFailure: jest.fn(), fallbackFailureMessage: () => 'failed', unknownErrorCode: 'unknown',
  })
  const input = { conversationId: 'conversation', assistantMessageId: 'response',
    runtimeConversation: { providerId: 'provider', model: 'original-model', systemPrompt: '', temperature: 0, maxTokens: 8 },
    provider: { id: 'provider', apiKey: 'fixture-key' }, settings: { memoryEnabled: true },
    hasAttachments: false, requestController: controller }
  const pending = runtime.handoff(input)
  input.runtimeConversation.model = 'later-model'
  input.provider.apiKey = 'later-key'
  input.settings.memoryEnabled = false
  input.requestController = new AbortController()
  barrier.resolve({ done: done.promise })
  await expect(pending).resolves.toMatchObject({ kind: 'started', conversation: { model: 'original-model' } })
  expect(startPlainChatRun).toHaveBeenCalledWith(expect.objectContaining({
    conversation: expect.objectContaining({ model: 'original-model' }), provider: { id: 'provider', apiKey: 'fixture-key' },
    settings: { memoryEnabled: true }, controller,
  }))
  done.resolve()
  await tick()
})
