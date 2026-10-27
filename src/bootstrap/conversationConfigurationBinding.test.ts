import type { Settings } from '@/types/settingsContracts'
import type { Conversation, Message } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import { conversationAssistantContextAcquisitionRuntime } from './conversationAssistantContextAcquisitionRuntime'
import { runConversationMemoryExtraction } from './conversationMemoryExtractionRuntime'
import { conversationRagFinalizationRuntime } from './conversationRagFinalizationRuntime'
import { conversationAssistantPlainChatHandoffRuntime } from './conversationAssistantPlainChatHandoffRuntime'
import type { BoundConversation } from '@/types/chatContracts'

let mockSettings: Settings
let mockReads = 0
const mockConfiguredProviders = jest.fn()
const mockKnowledgeRetrieve = jest.fn()
const mockExtract = jest.fn()
const mockFlareRetrieve = jest.fn()
const mockRecord = jest.fn()
const mockStartPlain = jest.fn()
const mockLeaseRelease = jest.fn()
let mockPlainConversation: Conversation | undefined
let mockDetachedController: AbortController

jest.mock('@/modules/assistant-runtime', () => ({
  ...jest.requireActual('@/modules/assistant-runtime/application/assistantConversationContextAcquisitionRuntime'),
  ...jest.requireActual('@/modules/assistant-runtime/application/assistantConversationKnowledgeContextRuntime'),
  ...jest.requireActual('@/modules/assistant-runtime/application/assistantConversationPlainChatHandoffRuntime'),
}))
jest.mock('@/modules/knowledge', () => ({
  ...jest.requireActual('@/modules/knowledge/application/conversationMemoryExtractionRuntime'),
  ...jest.requireActual('@/modules/knowledge/application/conversationRagFinalizationRuntime'),
  verifyRagGeneration: jest.fn(),
}))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => {
  mockReads++
  return { settings: mockSettings, getConfiguredProviders: mockConfiguredProviders }
} } }))
jest.mock('@/store/chatStore', () => ({ useChatStore: { getState: () => ({
  conversations: mockPlainConversation ? [mockPlainConversation] : [], upsertMessageTrace: mockRecord,
  transitionMessageLifecycle: jest.fn(),
}) } }))
jest.mock('@/store/chatStreamingStore', () => ({ useChatStreamingStore: { getState: () => ({
  activeStreams: new Map(), upsertTrace: mockRecord,
}) } }))
jest.mock('@/bootstrap/knowledgeContextRuntime', () => ({
  retrieveConversationKnowledgeContext: (...args: unknown[]) => mockKnowledgeRetrieve(...args),
  retrieveConversationFlareContext: (...args: unknown[]) => mockFlareRetrieve(...args),
}))
jest.mock('@/bootstrap/knowledgeMemoryExtraction', () => ({
  extractConversationMemories: (...args: unknown[]) => mockExtract(...args),
}))
jest.mock('@/bootstrap/conversationMcpContextRuntime', () => ({ conversationMcpContextRuntime: {
  resolveConversationMcpContext: async () => ({ kind: 'disabled', prompt: '', tools: [], traces: [] }),
} }))
jest.mock('@/bootstrap/conversationAssistantMessageProjection', () => ({ projectConversationAssistantFailure: jest.fn() }))
jest.mock('@/bootstrap/conversationAssistantDetachedWorkRegistry', () => ({ conversationAssistantDetachedWorkRegistry: {
  acquire: () => ({ signal: mockDetachedController.signal, release: mockLeaseRelease, settle: mockLeaseRelease }),
} }))
jest.mock('@/bootstrap/conversationRuntime', () => ({ createPlainChatRuntime: jest.fn() }))
jest.mock('@/modules/conversations', () => ({
  hasConversationModelPreference: (value: Conversation) => Boolean(value.providerId && value.model),
}))
jest.mock('@/presentation/features/conversations/plainChatCommand', () => ({
  isPlainChatEligible: () => true, tryStartPlainChatRun: (...args: unknown[]) => mockStartPlain(...args),
}))
jest.mock('@/services/chatStreamLifecycle', () => ({ setActiveStream: jest.fn(), getActiveStream: () => undefined, clearActiveStream: jest.fn() }))
jest.mock('@/bootstrap/ragEvaluationRepository', () => ({ ragEvaluationRepository: { log: jest.fn(async () => undefined) } }))
jest.mock('@/modules/integrations', () => ({ MCP_TOOL_CALL_TAG: 'fixture', resolveSearchProvider: () => 'off' }))
jest.mock('@/services/chatTraceUtils', () => ({ completeTrace: (value: unknown) => value, sanitizeTrace: (value: unknown) => value }))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))

beforeEach(() => {
  jest.clearAllMocks()
  mockReads = 0
  mockPlainConversation = undefined
  mockDetachedController = new AbortController()
  mockSettings = { memoryEnabled: false, knowledgeEnabled: false, mcpEnabled: false } as Settings
  mockConfiguredProviders.mockResolvedValue([])
  mockKnowledgeRetrieve.mockResolvedValue({ sources: [], prompt: '' })
  mockExtract.mockResolvedValue([])
  mockFlareRetrieve.mockResolvedValue({ sources: [], prompt: '', trace: [] })
})
const provider = { id: 'provider', apiKey: 'fixture-key' } as AIProvider
const conversation = { id: 'conversation', model: 'model', messages: [{ id: 'user', role: 'user', content: 'request' }] } as Conversation

it('bootstrap fallback selection and knowledge retrieval use the displayed admitted settings/provider catalog', async () => {
  const controller = new AbortController()
  const settings = { memoryEnabled: true, knowledgeEnabled: true, mcpEnabled: false } as Settings
  await conversationAssistantContextAcquisitionRuntime.acquire({
    conversationId: 'conversation', assistantMessageId: 'response',
    runtimeConversation: conversation, lastUserMessage: conversation.messages[0],
    settings, provider, providers: [provider], signal: controller.signal,
  })
  expect(mockConfiguredProviders).toHaveBeenCalledWith({ settings, providers: [provider], signal: controller.signal })
  expect(mockKnowledgeRetrieve).toHaveBeenCalledWith(conversation, conversation.messages[0], controller.signal, { settings, provider })
})

it('bootstrap memory extraction honors supplied settings without reading the live memory switch', async () => {
  const controller = new AbortController()
  const settings = { memoryEnabled: true, knowledgeEnabled: true } as Settings
  const recordTrace = jest.fn()
  await runConversationMemoryExtraction({ conversationId: 'conversation', assistantMessageId: 'response',
    messages: conversation.messages, provider, model: 'model', settings, signal: controller.signal, recordTrace })
  expect(mockExtract).toHaveBeenCalledWith('conversation', conversation.messages, provider, 'model', controller.signal, { settings })
  expect(mockReads).toBe(0)
  expect(recordTrace.mock.calls.map(([trace]) => trace.metadata.memoryEnabled)).toEqual([true, true])
})

it('bootstrap memory extraction retains the admitted signal and trace sink across extractor settlement', async () => {
  let finish!: (items: string[]) => void
  mockExtract.mockImplementationOnce(() => new Promise<string[]>(resolve => { finish = resolve }))
  const controller = new AbortController()
  const firstTrace = jest.fn()
  const replacementTrace = jest.fn()
  mockSettings.memoryEnabled = true
  const input = { conversationId: 'conversation', assistantMessageId: 'response',
    messages: conversation.messages as readonly Message[], provider, model: 'model',
    signal: controller.signal, recordTrace: firstTrace }
  const pending = runConversationMemoryExtraction(input)
  input.signal = new AbortController().signal
  input.recordTrace = replacementTrace
  controller.abort()
  finish(['effect-may-remain'])
  await expect(pending).resolves.toMatchObject({ status: 'cancelled' })
  expect(replacementTrace).not.toHaveBeenCalled()
  expect(firstTrace.mock.calls.at(-1)?.[0]).toMatchObject({
    status: 'cancelled', metadata: { memoryEnabled: true, signalAborted: true },
  })
  expect(mockReads).toBe(1)
})

it('bootstrap supplemental retrieval preserves supplied settings rather than allowing a downstream live fallback', async () => {
  const settings = { knowledgeEnabled: true } as Settings
  await conversationRagFinalizationRuntime.resolveSupplementalEvidence({
    conversationId: 'conversation', assistantMessageId: 'response', conversation,
    plan: { query: 'query', enabledTechniques: ['flare'] } as Parameters<typeof conversationRagFinalizationRuntime.resolveSupplementalEvidence>[0]['plan'],
    contextSources: [], citations: [], settings,
    verification: { needsFlare: true, confidence: 0.2, factualClaimCount: 1, citedClaimCount: 0,
      unsupportedClaimCount: 1, reasons: [] }, signal: new AbortController().signal,
  })
  expect(mockFlareRetrieve).toHaveBeenCalledWith(expect.objectContaining({ settings }))
})

it('Plain reply completion forwards admitted settings to detached memory extraction despite a later live switch', async () => {
  let complete!: () => void
  const done = new Promise<void>(resolve => { complete = resolve })
  mockStartPlain.mockResolvedValueOnce({ done })
  const settings = { memoryEnabled: true, knowledgeEnabled: true } as Settings
  mockPlainConversation = { ...conversation, providerId: 'provider', systemPrompt: '', temperature: 0, maxTokens: 8,
    messages: [...conversation.messages, { id: 'response', role: 'assistant', content: 'committed answer', status: 'done', timestamp: 2 }] }
  const outcome = await conversationAssistantPlainChatHandoffRuntime.handoff({
    conversationId: 'conversation', assistantMessageId: 'response',
    runtimeConversation: mockPlainConversation as BoundConversation, provider, settings,
    hasAttachments: false, requestController: new AbortController(),
  })
  settings.memoryEnabled = false
  complete()
  expect(outcome.kind).toBe('started')
  if (outcome.kind !== 'started') throw new Error('Plain fixture did not start')
  await outcome.handle.done
  for (let index = 0; index < 8; index++) await Promise.resolve()
  expect(mockExtract).toHaveBeenCalledWith('conversation', mockPlainConversation.messages, provider, 'model',
    mockDetachedController.signal, { settings: { memoryEnabled: true, knowledgeEnabled: true } })
  expect(mockReads).toBe(0)
  expect(mockLeaseRelease).toHaveBeenCalledTimes(1)
})
