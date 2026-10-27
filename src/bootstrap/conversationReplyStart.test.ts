import { initializeConversationReplyStart } from './conversationReplyStart'
import type { ConversationMessageRuntime } from '@/presentation/features/conversations/conversationMessageRuntimeBinding'
import type { AssistantRun } from '@/modules/assistant-runtime'
import type { ConversationRunProjection } from '@/modules/conversations'
import type { Conversation, Message } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'

let mockRuntime: ConversationMessageRuntime
let mockConversation: Conversation | undefined
let mockProvider: AIProvider | undefined
let mockSettings: Settings
const mockHydrate = jest.fn()
const mockLatestRun = jest.fn()
const mockResume = jest.fn()
const mockPausedResume = jest.fn()
const mockSetActiveStream = jest.fn()
const mockClearActiveStream = jest.fn()
const mockSetError = jest.fn()
const mockCreateProjection = jest.fn()
const mockRecoverProjection = jest.fn()
const mockProject = jest.fn()
const mockActiveStream = jest.fn()
const mockLifecycle = jest.fn()
const mockSetStreaming = jest.fn()
const mockClearStreaming = jest.fn()
const mockFlushStreaming = jest.fn()
const mockPersistStreaming = jest.fn()
const mockCommitStreamingText = jest.fn()
const mockCommitStreamingTraces = jest.fn()
const mockPersistStreamingText = jest.fn()
let mockActiveStreams: Map<string, boolean>
let mockLiveStreamingStore: typeof import('@/store/chatStreamingStore').useChatStreamingStore | undefined

jest.mock('@/store/chatStore', () => ({ useChatStore: { getState: () => ({
  conversations: mockConversation ? [mockConversation] : [],
  transitionMessageLifecycle: mockLifecycle, updateMessage: jest.fn(), setError: mockSetError,
  commitStreamingContent: mockCommitStreamingText, commitStreamingTraceSnapshot: mockCommitStreamingTraces,
  persistStreamingContentSnapshot: mockPersistStreamingText, flushStreamingMessage: mockPersistStreaming,
}) } }))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => ({
  providers: mockProvider ? [mockProvider] : [], settings: mockSettings, hydrateProviderKey: mockHydrate,
}) } }))
jest.mock('@/store/chatStreamingStore', () => ({ useChatStreamingStore: { getState: () => mockLiveStreamingStore?.getState() ?? ({
  activeStreams: mockActiveStreams, setStreaming: mockSetStreaming,
  clearStreaming: mockClearStreaming, flushStreamingMessage: mockFlushStreaming,
}) } }))
jest.mock('@/presentation/features/conversations/conversationMessageRuntimeBinding', () => ({
  bindConversationMessageRuntime: (runtime: ConversationMessageRuntime) => { mockRuntime = runtime },
  releaseConversationMessageRuntime: jest.fn(),
}))
jest.mock('@/presentation/features/conversations/plainChatProjection', () => ({
  createPlainChatProjection: (...args: unknown[]) => mockCreateProjection(...args),
  recoverChatProjection: (...args: unknown[]) => mockRecoverProjection(...args),
}))
jest.mock('@/bootstrap/conversationRuntime', () => ({
  resumeConversationModelOperation: (...args: unknown[]) => mockResume(...args),
  resumePausedConversationRun: (...args: unknown[]) => mockPausedResume(...args),
  cancelConversationResponseRun: jest.fn(),
  getLatestConversationResponseRun: (...args: unknown[]) => mockLatestRun(...args),
}))
jest.mock('@/services/chatStreamLifecycle', () => ({
  getActiveStream: (...args: unknown[]) => mockActiveStream(...args),
  clearActiveStream: (...args: unknown[]) => mockClearActiveStream(...args),
  setActiveStream: (...args: unknown[]) => mockSetActiveStream(...args), registerStreamAborter: jest.fn(),
  registerStreamStateCleaner: jest.fn(),
}))
jest.mock('@/bootstrap/assistantExecutionHostRuntime', () => ({ assistantExecutionHost: { prepareUserResume: jest.fn() } }))
jest.mock('@/modules/conversations', () => ({
  ...jest.requireActual('@/modules/conversations/application/responseLifecycle'),
  createConversationChatWorkflowReplyStarter: () => jest.fn(),
}))
jest.mock('@/modules/assistant-runtime', () => ({ HARNESS_ENGINE_VERSION: 'islemind.harness.v1' }))
jest.mock('@/modules/tasks', () => ({
  bindConversationTaskActivityCancellation: jest.fn(), finishConversationTaskActivityForMessage: jest.fn(),
  resolveWorkflowRunLimitsFromSettings: jest.fn(), startConversationTaskActivity: jest.fn(),
}))
jest.mock('@/bootstrap/conversationChatWorkflowResolutionRuntime', () => ({ resolveConversationChatWorkflowAssistantMessage: jest.fn() }))
jest.mock('@/bootstrap/knowledgeContextRuntime', () => ({ retrieveConversationKnowledgeContextInLocalJob: jest.fn() }))
jest.mock('@/bootstrap/chatWorkflowRuntime', () => ({ createChatWorkflowRuntime: jest.fn() }))
jest.mock('@/bootstrap/conversationAssistantReplyStartRuntime', () => ({ startConversationAssistantReplyAfterHistoryProjection: jest.fn() }))
jest.mock('@/bootstrap/workflowSkills', () => ({
  extractWorkflowDefinitionsFromSkillSnapshot: jest.fn(), listBlockedWorkflowStatesForSkillSnapshot: jest.fn(),
  listEnabledWorkflowIdsForSkillSnapshot: jest.fn(), saveApprovedWorkflowSkillSuggestion: jest.fn(),
}))
jest.mock('@/bootstrap/workflowSearchToolAdmission', () => ({ filterLocalSearchToolManifests: jest.fn() }))
jest.mock('@/bootstrap/conversationToolCatalog', () => ({ listConversationToolManifests: jest.fn(), resolveConversationTool: jest.fn() }))
jest.mock('@/bootstrap/tavernWorkspace', () => ({ resolveChatWorkspaceReviewRuntime: jest.fn() }))
jest.mock('@/presentation/features/conversations/chatWorkspaceReviewCommand', () => ({
  bindChatWorkspaceReviewRuntime: jest.fn(), releaseChatWorkspaceReviewRuntime: jest.fn(),
}))
jest.mock('@/presentation/features/conversations/conversationControlCommand', () => ({ stopConversationMessage: jest.fn() }))
jest.mock('@/services/chatErrorUtils', () => ({ classifyChatError: jest.fn(), toUserFacingError: jest.fn() }))
jest.mock('@/services/chatMessageUtils', () => ({ normalizeUserContent: jest.fn() }))
jest.mock('@/services/tokenUsage', () => ({ buildEstimatedUsage: jest.fn(), estimateTextTokens: jest.fn() }))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))

const identity = { continuationToken: 'reviewed-token', continuationDigest: 'reviewed-digest' }
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(finish => { resolve = finish })
  return { promise, resolve }
}
function response(): Message {
  return mockConversation!.messages[0]
}
function resume(signal?: AbortSignal) {
  return mockRuntime.resumePendingModelOperation!('conversation', 'response', 'run', true, identity, signal)
}
function event(status: AssistantRun['status'] = 'running'): Parameters<ConversationRunProjection>[0] {
  return {
    conversationId: 'conversation',
    run: { id: 'run', conversationId: 'conversation', responseMessageId: 'response', status } as AssistantRun,
    journalEntry: {
      schema: 'islemind.assistant-run-journal-entry.v1', runId: 'run' as AssistantRun['id'], sequence: 1,
      occurredAt: 2, type: status === 'running' ? 'run.confirmation-resolved' : 'run.succeeded',
    },
  }
}
beforeAll(() => initializeConversationReplyStart())
beforeEach(() => {
  jest.clearAllMocks()
  mockLiveStreamingStore = undefined
  mockConversation = {
    id: 'conversation', title: 'Review', providerId: 'provider', model: 'reviewed-model',
    systemPrompt: '', temperature: 0, maxTokens: 128, createdAt: 1, updatedAt: 1,
    enabledTools: ['fixture.read'], knowledgeSources: ['reviewed-source'],
    messages: [{ id: 'response', role: 'assistant', content: '', status: 'streaming', timestamp: 1,
      responseLifecycle: { stage: 'tool_calling', startedAt: 1, stageStartedAt: 1, history: [] },
      reasoning: [{ id: 'pending', type: 'system', title: 'Review', status: 'running',
        metadata: { pendingModelOperationRunId: 'run' } }] }],
  }
  mockProvider = { id: 'provider', type: 'openai', name: 'Fixture', apiKey: '', enabled: true,
    baseUrl: 'https://fixture.invalid/v1', models: ['reviewed-model'] }
  mockSettings = { mcpEnabled: true, webSearchEnabled: false } as Settings
  mockActiveStreams = new Map()
  mockHydrate.mockImplementation(async () => ({ ...mockProvider!, apiKey: 'local-fixture-key' }))
  mockLatestRun.mockResolvedValue({
    id: 'run', conversationId: 'conversation', responseMessageId: 'response', status: 'awaiting-confirmation',
    providerId: 'provider', model: 'reviewed-model', pendingModelOperation: { ...identity },
  })
  mockActiveStream.mockReturnValue(undefined)
  mockSetActiveStream.mockImplementation((_id, handle) => mockActiveStream.mockReturnValue(handle))
  mockClearActiveStream.mockImplementation(() => mockActiveStream.mockReturnValue(undefined))
  mockResume.mockResolvedValue(false)
  mockPausedResume.mockResolvedValue(false)
  mockProject.mockResolvedValue(undefined)
  mockRecoverProjection.mockResolvedValue(undefined)
  mockFlushStreaming.mockResolvedValue(undefined)
  mockPersistStreaming.mockResolvedValue(undefined)
  mockCreateProjection.mockImplementation(input => {
    mockLifecycle(input.conversation.id, input.assistantMessageId, 'waiting')
    return mockProject
  })
})
afterEach(() => {
  mockLiveStreamingStore?.getState().clearAllStreaming()
  mockLiveStreamingStore = undefined
  jest.useRealTimers()
})

function setupPausedResponse() {
  response().reasoning = []
  response().responseLifecycle = {
    stage: 'paused', startedAt: 1, stageStartedAt: 2,
    history: [{ stage: 'paused', startedAt: 2, traceId: 'harness-pause-v1:run:9' }],
  }
  const run = {
    id: 'run', conversationId: 'conversation', responseMessageId: 'response', status: 'paused',
    engineVersion: 'islemind.harness.v1', journalSequence: 9, providerId: 'provider', model: 'reviewed-model',
    lifecycleCheckpoint: { phase: 'provider', recovery: 'resumable', request: {
      conversationId: 'conversation', providerId: 'provider', model: 'reviewed-model',
    } },
  }
  mockLatestRun.mockResolvedValue(run)
  mockCreateProjection.mockImplementation(() => mockProject)
  return run
}
function resumePause(signal?: AbortSignal) {
  return mockRuntime.resumePausedResponse!('conversation', 'response', { runId: 'run', journalSequence: 9 }, signal)
}
function resumedEvent(): Parameters<ConversationRunProjection>[0] {
  const next = event()
  return { ...next, run: { ...next.run, journalSequence: 10 }, journalEntry: { ...next.journalEntry!, sequence: 10, type: 'run.resumed' } }
}

it('does not turn a paused click or credential restoration into unacknowledged generation', async () => {
  setupPausedResponse()
  expect(mockPausedResume).not.toHaveBeenCalled()
  await expect(resumePause()).resolves.toBe(false)
  expect(mockPausedResume).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run', expectedJournalSequence: 9 }))
  expect(mockSetActiveStream).not.toHaveBeenCalled()
  expect(mockSetStreaming).not.toHaveBeenCalled()
  expect(mockCreateProjection).not.toHaveBeenCalled()
  expect(response().responseLifecycle?.stage).toBe('paused')
})

it('keeps the preferred model while restoring the actual durable checkpoint route', async () => {
  const run = setupPausedResponse()
  run.model = 'actual-model'
  run.lifecycleCheckpoint.request.model = 'actual-model'
  await resumePause()
  expect(mockPausedResume.mock.calls[0][0].conversation.model).toBe('actual-model')
  expect(mockPausedResume.mock.calls[0][0].provider.apiKey).toBe('local-fixture-key')
  expect(mockConversation!.model).toBe('reviewed-model')
  expect(response().completedAt).toBeUndefined()
})

it('rejects the old pause sequence before reading a credential', async () => {
  const run = setupPausedResponse()
  run.journalSequence = 11
  await expect(resumePause()).resolves.toBe(false)
  expect(mockHydrate).not.toHaveBeenCalled()
  expect(mockPausedResume).not.toHaveBeenCalled()
})

it.each(['operation', 'confirmation', 'pending-decision', 'complete', 'reconciliation', 'child', 'engine', 'request-owner', 'running'])(
  'rejects an unsafe %s durable continuation without dispatch', async variant => {
    const run = setupPausedResponse()
    if (variant === 'operation' || variant === 'confirmation' || variant === 'complete') run.lifecycleCheckpoint.phase = variant
    if (variant === 'pending-decision') Object.assign(run, { pendingModelOperation: { continuationToken: 'unreviewed' } })
    if (variant === 'reconciliation') run.lifecycleCheckpoint.recovery = 'reconciliation-required'
    if (variant === 'child') Object.assign(run, { parentRunId: 'parent' })
    if (variant === 'engine') run.engineVersion = 'legacy'
    if (variant === 'request-owner') run.lifecycleCheckpoint.request.conversationId = 'another-chat'
    if (variant === 'running') run.status = 'running'
    await expect(resumePause()).resolves.toBe(false)
    expect(mockHydrate).not.toHaveBeenCalled()
    expect(mockPausedResume).not.toHaveBeenCalled()
  },
)

it.each(['cancelled', 'new-message', 'provider-disabled', 'settings', 'new-pause', 'new-live', 'aborted'])(
  'rechecks %s after an awaited credential read and retains the paused projection', async variant => {
    setupPausedResponse()
    const hydrated = deferred<AIProvider>()
    const credential = { ...mockProvider!, apiKey: 'local-fixture-key' }
    mockHydrate.mockReturnValueOnce(hydrated.promise)
    const lifetime = new AbortController()
    const attempt = resumePause(lifetime.signal)
    await Promise.resolve()
    expect(mockHydrate).toHaveBeenCalledTimes(1)
    if (variant === 'cancelled') response().status = 'cancelled'
    if (variant === 'new-message') mockConversation!.messages.push({ id: 'new-user', role: 'user', content: 'new request', status: 'done', timestamp: 3 })
    if (variant === 'provider-disabled') mockProvider!.enabled = false
    if (variant === 'settings') mockSettings.webSearchEnabled = true
    if (variant === 'new-pause') response().responseLifecycle!.history[0].traceId = 'harness-pause-v1:run:11'
    if (variant === 'new-live') mockActiveStream.mockReturnValue({ controller: new AbortController(), messageId: 'new-response' })
    if (variant === 'aborted') lifetime.abort()
    hydrated.resolve(credential)
    await expect(attempt).resolves.toBe(false)
    expect(mockPausedResume).not.toHaveBeenCalled()
    expect(mockCreateProjection).not.toHaveBeenCalled()
    expect(mockClearActiveStream).not.toHaveBeenCalled()
  },
)

it('retains Stop, the cancellation lifetime and the duplicate fence after durable resume admission', async () => {
  setupPausedResponse()
  mockPausedResume.mockImplementation(async input => {
    await input.projection(resumedEvent())
    return true
  })
  const lifetime = new AbortController()
  await expect(resumePause(lifetime.signal)).resolves.toBe(true)
  const input = mockPausedResume.mock.calls[0][0]
  expect(mockSetActiveStream).toHaveBeenCalledTimes(1)
  expect(mockActiveStream()).toMatchObject({ messageId: 'response', controller: expect.any(AbortController) })
  expect(mockFlushStreaming).not.toHaveBeenCalled()
  expect(mockClearActiveStream).not.toHaveBeenCalled()
  await expect(resumePause()).resolves.toBe(false)
  expect(mockPausedResume).toHaveBeenCalledTimes(1)
  lifetime.abort()
  expect(input.cancellationSignal.aborted).toBe(true)
  await input.onSettled({ ok: true, value: { status: 'cancelled' } })
  expect(mockFlushStreaming).toHaveBeenCalledWith('conversation', 'response', expect.any(Function))
  expect(mockClearActiveStream).toHaveBeenCalledTimes(1)
  mockPausedResume.mockResolvedValueOnce(false)
  await expect(resumePause()).resolves.toBe(false)
  expect(mockPausedResume).toHaveBeenCalledTimes(2)
})

it('opens generation only on run.resumed, not an arbitrary running snapshot', async () => {
  setupPausedResponse()
  mockPausedResume.mockImplementation(async input => {
    await input.projection({ ...resumedEvent(), journalEntry: { ...resumedEvent().journalEntry!, type: 'run.checkpointed' } })
    expect(mockSetActiveStream).not.toHaveBeenCalled()
    expect(mockCreateProjection).not.toHaveBeenCalled()
    await input.projection(resumedEvent())
    await input.onSettled({ ok: true, value: { status: 'succeeded' } })
    return true
  })
  await expect(resumePause()).resolves.toBe(true)
  expect(mockCreateProjection).toHaveBeenCalledTimes(1)
  expect(mockProject).toHaveBeenCalledWith(resumedEvent())
})

it('aborts a no-longer-owned resume before projecting or dispatching the acknowledged request', async () => {
  setupPausedResponse()
  mockPausedResume.mockImplementation(async input => {
    mockConversation!.messages.push({ id: 'new-user', role: 'user', content: 'new question', status: 'done', timestamp: 4 })
    await input.projection(resumedEvent())
    expect(input.cancellationSignal.aborted).toBe(true)
    await input.onSettled({ ok: true, value: { status: 'cancelled' } })
    return false
  })
  await expect(resumePause()).resolves.toBe(false)
  expect(mockCreateProjection).not.toHaveBeenCalled()
  expect(mockSetActiveStream).not.toHaveBeenCalled()
})

it('does not clear a replacement live controller when the previous resume settles', async () => {
  setupPausedResponse()
  mockPausedResume.mockImplementation(async input => {
    await input.projection(resumedEvent())
    return true
  })
  await resumePause()
  const input = mockPausedResume.mock.calls[0][0]
  const replacement = { controller: new AbortController(), messageId: 'new-response' }
  mockActiveStream.mockReturnValue(replacement)
  await input.onSettled({ ok: true, value: { status: 'cancelled' } })
  expect(mockFlushStreaming).not.toHaveBeenCalled()
  expect(mockClearActiveStream).not.toHaveBeenCalled()
  expect(mockActiveStream()).toBe(replacement)
})

it('surfaces a post-admission persistence failure and releases its lifetime without inventing completion', async () => {
  setupPausedResponse()
  mockPausedResume.mockImplementation(async input => { await input.projection(resumedEvent()); return true })
  await resumePause()
  await mockPausedResume.mock.calls[0][0].onSettled({ ok: false, error: { code: 'persistence_failed', message: 'fixture' } })
  expect(mockSetError).toHaveBeenCalledWith('messageBubble.resumeFailed')
  expect(mockClearActiveStream).toHaveBeenCalledTimes(1)
  expect(response().completedAt).toBeUndefined()
})

it('aborts and releases a resume lifetime if its caller fails after admission', async () => {
  setupPausedResponse()
  const failure = new Error('unexpected caller failure')
  mockPausedResume.mockImplementationOnce(async input => {
    await input.projection(resumedEvent())
    throw failure
  })
  await expect(resumePause()).rejects.toBe(failure)
  const input = mockPausedResume.mock.calls[0][0]
  expect(input.cancellationSignal.aborted).toBe(true)
  expect(mockClearActiveStream).toHaveBeenCalledTimes(1)
  await expect(resumePause()).resolves.toBe(false)
  expect(mockPausedResume).toHaveBeenCalledTimes(2)
  expect(response().completedAt).toBeUndefined()
})

it('does not project an unacknowledged resume as streaming or waiting when runtime rejects it', async () => {
  await expect(resume()).resolves.toBe(false)
  expect(mockHydrate).toHaveBeenCalledWith('provider')
  expect(mockResume).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run', ...identity }))
  expect(mockSetStreaming).not.toHaveBeenCalled()
  expect(mockLifecycle).not.toHaveBeenCalled()
  expect(mockCreateProjection).not.toHaveBeenCalled()
  expect(response().responseLifecycle?.stage).toBe('tool_calling')
})

it('keeps pre-admission failures visible without fabricating a message lifecycle', async () => {
  const failure = new Error('catalog restoration failed')
  mockResume.mockRejectedValueOnce(failure)
  await expect(resume()).rejects.toBe(failure)
  expect(mockSetStreaming).not.toHaveBeenCalled()
  expect(mockLifecycle).not.toHaveBeenCalled()
})

const hydrationChanges: [string, () => void][] = [
  ['removed conversation', () => { mockConversation = undefined }],
  ['removed provider', () => { mockProvider = undefined }],
  ['disabled provider', () => { mockProvider!.enabled = false }],
  ['changed provider endpoint', () => { mockProvider!.baseUrl = 'https://new.invalid/v1' }],
  ['changed model', () => { mockConversation!.model = 'unreviewed-model' }],
  ['changed knowledge scope', () => { mockConversation!.knowledgeSources!.push('unreviewed-source') }],
  ['changed settings', () => { mockSettings.mcpEnabled = false }],
  ['cancelled response', () => { response().status = 'cancelled' }],
  ['removed response', () => { mockConversation!.messages = [] }],
  ['changed run marker', () => { response().reasoning![0].metadata!.pendingModelOperationRunId = 'new-run' }],
  ['newer turn', () => { mockConversation!.messages.push({ id: 'new-user', role: 'user', content: 'New turn', timestamp: 2, status: 'done' }) }],
]
it.each(hydrationChanges)('rejects %s while local credentials are hydrating', async (_label, change) => {
  const wait = deferred<AIProvider>()
  mockHydrate.mockReturnValueOnce(wait.promise)
  const hydrated = { ...mockProvider!, apiKey: 'local-fixture-key' }
  const result = resume()
  await Promise.resolve()
  await Promise.resolve()
  expect(mockHydrate).toHaveBeenCalledTimes(1)
  change()
  wait.resolve(hydrated)
  await expect(result).resolves.toBe(false)
  expect(mockResume).not.toHaveBeenCalled()
  expect(mockCreateProjection).not.toHaveBeenCalled()
  expect(mockSetStreaming).not.toHaveBeenCalled()
})

it('does not replace a newer live stream registered during hydration', async () => {
  const wait = deferred<AIProvider>()
  mockHydrate.mockReturnValueOnce(wait.promise)
  const result = resume()
  await Promise.resolve()
  await Promise.resolve()
  mockActiveStream.mockReturnValue({ messageId: 'new-response', controller: new AbortController() })
  wait.resolve({ ...mockProvider!, apiKey: 'local-fixture-key' })
  await expect(result).resolves.toBe(false)
  expect(mockResume).not.toHaveBeenCalled()
  expect(mockClearStreaming).not.toHaveBeenCalled()
})

it.each(['entry', 'hydration'] as const)('honors pending-review lifetime cancellation at %s', async boundary => {
  const lifetime = new AbortController()
  const wait = deferred<AIProvider>()
  if (boundary === 'entry') lifetime.abort()
  else mockHydrate.mockReturnValueOnce(wait.promise)
  const result = resume(lifetime.signal)
  if (boundary === 'hydration') {
    await Promise.resolve()
    await Promise.resolve()
    expect(mockHydrate).toHaveBeenCalledTimes(1)
  }
  lifetime.abort()
  wait.resolve({ ...mockProvider!, apiKey: 'local-fixture-key' })
  await expect(result).resolves.toBe(false)
  if (boundary === 'entry') expect(mockHydrate).not.toHaveBeenCalled()
  expect(mockResume).not.toHaveBeenCalled()
})

it('does not share caller-owned continuation identity across credential hydration', async () => {
  const wait = deferred<AIProvider>()
  mockHydrate.mockReturnValueOnce(wait.promise)
  const approvedIdentity = { ...identity }
  const result = mockRuntime.resumePendingModelOperation!('conversation', 'response', 'run', true, approvedIdentity)
  approvedIdentity.continuationToken = 'unreviewed-token'
  approvedIdentity.continuationDigest = 'unreviewed-digest'
  wait.resolve({ ...mockProvider!, apiKey: 'local-fixture-key' })
  await result
  expect(mockResume).toHaveBeenCalledWith(expect.objectContaining(identity))
})

it('detaches restored runtime configuration from later store mutations', async () => {
  let restored: Parameters<typeof mockResume>[0]
  mockResume.mockImplementationOnce(async input => {
    restored = input
    mockConversation!.knowledgeSources!.push('later-source')
    mockSettings.mcpEnabled = false
    return false
  })
  await resume()
  expect(restored!.conversation.knowledgeSources).toEqual(['reviewed-source'])
  expect(restored!.settings.mcpEnabled).toBe(true)
})

it('creates one projection only after a matching durable event, then clears its own flags', async () => {
  mockResume.mockImplementationOnce(async input => {
    expect(mockCreateProjection).not.toHaveBeenCalled()
    await input.projection(event())
    await input.projection(event('succeeded'))
    return true
  })
  await expect(resume()).resolves.toBe(true)
  expect(mockCreateProjection).toHaveBeenCalledTimes(1)
  expect(mockProject).toHaveBeenCalledTimes(2)
  expect(mockFlushStreaming).toHaveBeenCalledWith('conversation', 'response', expect.any(Function))
  expect(mockClearStreaming).not.toHaveBeenCalled()
})

it('ignores projections for another durable owner', async () => {
  mockResume.mockImplementationOnce(async input => {
    await input.projection({ ...event(), run: { ...event().run, id: 'other-run' } })
    return false
  })
  await resume()
  expect(mockCreateProjection).not.toHaveBeenCalled()
  expect(mockProject).not.toHaveBeenCalled()
})

it('does not clear streaming state acquired by a newer owner while resume settles', async () => {
  mockResume.mockImplementationOnce(async input => {
    await input.projection(event())
    response().reasoning![0].metadata!.pendingModelOperationRunId = 'new-run'
    mockActiveStream.mockReturnValue({ messageId: 'response', controller: new AbortController() })
    return false
  })
  await resume()
  expect(mockClearStreaming).not.toHaveBeenCalled()
})

it('admits one restoration per conversation and releases it after failure', async () => {
  const wait = deferred<AIProvider>()
  mockHydrate.mockReturnValueOnce(wait.promise)
  const first = resume()
  const duplicate = resume()
  wait.resolve({ ...mockProvider!, apiKey: 'local-fixture-key' })
  await expect(Promise.all([first, duplicate])).resolves.toEqual([false, false])
  expect(mockHydrate).toHaveBeenCalledTimes(1)
  expect(mockResume).toHaveBeenCalledTimes(1)
  await resume()
  expect(mockHydrate).toHaveBeenCalledTimes(2)
})

it('retains the review lifetime through the canonical admission boundary', async () => {
  const lifetime = new AbortController()
  mockResume.mockImplementationOnce(async input => {
    expect(input.cancellationSignal).toBe(lifetime.signal)
    lifetime.abort()
    await input.projection(event())
    return false
  })
  await expect(resume(lifetime.signal)).resolves.toBe(false)
  expect(mockCreateProjection).not.toHaveBeenCalled()
  expect(mockSetStreaming).not.toHaveBeenCalled()
})

it('does not clear a previously active response when resume produces no durable event', async () => {
  mockActiveStreams.set('conversation:response', true)
  await expect(resume()).resolves.toBe(false)
  expect(mockCreateProjection).not.toHaveBeenCalled()
  expect(mockClearStreaming).not.toHaveBeenCalled()
})

it('hydrates the durable producing route without rewriting the selected conversation preference', async () => {
  mockProvider = { ...mockProvider!, id: 'durable-provider', models: ['durable-model'] }
  mockLatestRun.mockResolvedValueOnce({
    id: 'run', conversationId: 'conversation', responseMessageId: 'response', status: 'awaiting-confirmation',
    providerId: 'durable-provider', model: 'durable-model', pendingModelOperation: { ...identity },
  })
  await resume()
  expect(mockHydrate).toHaveBeenCalledWith('durable-provider')
  expect(mockResume).toHaveBeenCalledWith(expect.objectContaining({
    conversation: expect.objectContaining({ providerId: 'durable-provider', model: 'durable-model' }),
    provider: expect.objectContaining({ id: 'durable-provider' }),
  }))
  expect(mockConversation).toMatchObject({ providerId: 'provider', model: 'reviewed-model' })
})

it('rejects changed continuation identity before hydrating a durable provider route', async () => {
  mockLatestRun.mockResolvedValueOnce({
    id: 'run', conversationId: 'conversation', responseMessageId: 'response', status: 'awaiting-confirmation',
    providerId: 'provider', model: 'reviewed-model',
    pendingModelOperation: { continuationToken: 'new-token', continuationDigest: 'new-digest' },
  })
  await expect(resume()).resolves.toBe(false)
  expect(mockHydrate).not.toHaveBeenCalled()
  expect(mockResume).not.toHaveBeenCalled()
})

it('reconciles acknowledged cancellation after leaving without creating an optimistic waiting projection', async () => {
  const lifetime = new AbortController()
  const cancelled = event('cancelled')
  mockResume.mockImplementationOnce(async input => {
    lifetime.abort()
    await input.projection(cancelled)
    return false
  })
  await expect(resume(lifetime.signal)).resolves.toBe(false)
  expect(mockRecoverProjection).toHaveBeenCalledWith(cancelled.run, expect.any(Function))
  expect(mockCreateProjection).not.toHaveBeenCalled()
  expect(mockLifecycle).not.toHaveBeenCalled()
  expect(mockSetStreaming).not.toHaveBeenCalled()
  expect(mockFlushStreaming).toHaveBeenCalledWith('conversation', 'response', expect.any(Function))
  expect(mockClearStreaming).not.toHaveBeenCalled()
})

it('retains the durable owner guard inside queued streaming-buffer cleanup', async () => {
  let guard: (() => boolean) | undefined
  mockFlushStreaming.mockImplementationOnce(async (_conversation, _message, owns) => {
    guard = owns
    response().reasoning![0].metadata!.pendingModelOperationRunId = 'replacement-run'
  })
  mockResume.mockImplementationOnce(async input => {
    await input.projection(event())
    return true
  })
  await resume()
  expect(mockFlushStreaming).toHaveBeenCalledWith('conversation', 'response', expect.any(Function))
  expect(guard?.()).toBe(false)
  expect(mockClearStreaming).not.toHaveBeenCalled()
})

it.each(['text', 'trace'])('preserves late same-owner %s through the complete resume cleanup', async kind => {
  jest.useFakeTimers()
  mockLiveStreamingStore = jest.requireActual<typeof import('@/store/chatStreamingStore')>(
    '@/store/chatStreamingStore',
  ).useChatStreamingStore
  const streaming = mockLiveStreamingStore.getState()
  streaming.clearAllStreaming()
  streaming.appendContent('conversation', 'response', 'reviewed')
  const persisting = deferred<void>()
  const entered = deferred<void>()
  mockPersistStreaming.mockImplementationOnce(() => {
    entered.resolve()
    return persisting.promise
  })
  mockResume.mockImplementationOnce(async input => {
    await input.projection(event())
    return true
  })
  const finished = resume()
  await entered.promise
  if (kind === 'text') streaming.appendContent('conversation', 'response', ' and late')
  else streaming.upsertTrace('conversation', 'response', {
    id: 'late-trace', type: 'tool', title: 'Late operation', status: 'running', startedAt: 2,
  })
  persisting.resolve()
  await expect(finished).resolves.toBe(true)
  expect(mockLiveStreamingStore.getState().activeStreams.get('conversation:response')).toBe(true)
  if (kind === 'text') {
    expect(mockLiveStreamingStore.getState().getStreamingText('conversation', 'response')).toBe('reviewed and late')
    jest.advanceTimersByTime(420)
    expect(mockPersistStreamingText).toHaveBeenCalledWith('conversation', 'response', 'reviewed and late')
  } else {
    expect(mockLiveStreamingStore.getState().getStreamingTraceSnapshot('conversation', 'response')?.toolCalls)
      .toEqual([expect.objectContaining({ id: 'late-trace' })])
  }
})

it('clears acknowledged unchanged buffers through the store-owned resume cleanup', async () => {
  mockLiveStreamingStore = jest.requireActual<typeof import('@/store/chatStreamingStore')>(
    '@/store/chatStreamingStore',
  ).useChatStreamingStore
  const streaming = mockLiveStreamingStore.getState()
  streaming.clearAllStreaming()
  streaming.appendContent('conversation', 'response', 'reviewed')
  mockResume.mockImplementationOnce(async input => {
    await input.projection(event())
    return true
  })
  await expect(resume()).resolves.toBe(true)
  expect(mockCommitStreamingText).toHaveBeenCalledWith('conversation', 'response', 'reviewed')
  expect(mockPersistStreaming).toHaveBeenCalledTimes(1)
  expect(mockLiveStreamingStore.getState().activeStreams.has('conversation:response')).toBe(false)
  expect(mockLiveStreamingStore.getState().getStreamingText('conversation', 'response')).toBe('')
})
