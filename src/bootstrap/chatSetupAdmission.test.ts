import { act, renderHook } from '@testing-library/react-native'

import { buildProviderFallbackCandidates } from '@/bootstrap/providerFallbackCandidates'
import { requiredFallbackCapabilities } from '@/modules/providers'
import { sendConversationMessage } from '@/presentation/features/conversations/conversationMessageCommand'
import { useChatStore } from '@/store/chatStore'
import type { AIModel, AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'

import { createSetupConversationShell } from '@/components/chat/chatModelSelection'
import { useChatSetupWorkspaceState } from '@/components/chat/chatSetupWorkspaceState'

jest.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => mockSettingsState } }))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))
jest.mock('@/bootstrap/conversationAssistantDetachedWorkRegistry', () => ({ cancelAllConversationAssistantDetachedWork: jest.fn(), cancelConversationAssistantDetachedWork: jest.fn() }))
jest.mock('@/presentation/features/conversations/conversationMessageCommand', () => ({ sendConversationMessage: jest.fn() }))
jest.mock('@/presentation/features/conversations/conversationStorePersistenceCommand', () => ({ writeActiveConversationSelection: jest.fn() }))

const mockSettingsState = {
  settings: { defaultTemperature: 0.2, defaultMaxTokens: 128 } as Settings,
  providers: [] as AIProvider[],
  rememberPreferredModel: jest.fn(async () => undefined),
}

const capabilities = { chat: true, streaming: true, modelList: true, vision: false, files: false,
  audioInput: false, audioTranscription: false, speech: false, nativeSearch: false, reasoningEffort: false, topP: true }

function model(id: string, overrides: Partial<AIModel> = {}): AIModel {
  return { id, name: id, provider: 'openai-compatible', source: 'remote', contextWindow: 32768,
    maxTokens: 32768, maxOutputTokens: 4096, defaultMaxTokens: 1024, supportsVision: false,
    supportsFiles: false, chatCompatible: true, ...overrides }
}

function provider(models: AIModel[], overrides: Partial<AIProvider> = {}): AIProvider {
  return { id: 'test-provider', type: 'openai-compatible', name: 'Test', apiKey: 'synthetic-test-key',
    baseUrl: 'https://example.invalid/v1', enabled: true, lastModelSyncStatus: 'ok', models: models.map(item => item.id),
    modelConfigs: models, capabilities, ...overrides }
}

async function setup(selected: AIProvider) {
  mockSettingsState.providers = [selected]
  const state = useChatStore.getState()
  const updateConversation = jest.fn(state.updateConversation)
  const options = {
    active: true, conversation: null, providers: [selected], settings: mockSettingsState.settings,
    modelAccessSettings: {}, composerOutputMode: 'text', createConversation: state.createDraft,
    updateConversation, applyQuickStartDraft: jest.fn(), markChromeActive: jest.fn(),
    setComposerPanel: jest.fn(), setShowOptions: jest.fn(), dialog: { toast: jest.fn() },
    t: (key: string) => key,
  } as unknown as Parameters<typeof useChatSetupWorkspaceState>[0]
  return { ...await renderHook(() => useChatSetupWorkspaceState(options)), updateConversation }
}

beforeEach(() => {
  useChatStore.setState({ conversations: [], currentId: null, draftConversationIds: new Set(), error: null })
  jest.mocked(sendConversationMessage).mockReset().mockImplementation(async () => {
    // Keep the in-memory draft available for assertions without persisting a real conversation.
    useChatStore.setState({ currentId: null })
  })
})

it.each([
  model('gpt-4o-mini'),
  model('deepseek-ai/deepseek-flash', { reasoningMode: 'deepseek-thinking', reasoningEfforts: ['none', 'high', 'xhigh'] }),
  model('deepseek-ai/deepseek-v4-flash-0731', { deprecated: true, reasoningMode: 'deepseek-thinking', reasoningEfforts: ['none', 'high', 'xhigh'] }),
])('does not admit hidden reasoning into a new $id conversation', async selectedModel => {
  const selectedProvider = provider([selectedModel])
  const { result, updateConversation } = await setup(selectedProvider)
  expect(result.current.supportsSetupReasoningQuick).toBe(false)
  expect(result.current.setupReasoningEffort).toBeUndefined()
  expect(result.current.setupConversation.reasoningEffort).toBeUndefined()

  await act(async () => result.current.submitSetup('好的', []))

  expect(sendConversationMessage).toHaveBeenCalledTimes(1)
  const dispatched = jest.mocked(sendConversationMessage).mock.calls[0][0].conversation
  expect(dispatched.reasoningEffort).toBeUndefined()
  expect(updateConversation.mock.calls[0][1]).toHaveProperty('reasoningEffort', undefined)
  expect(useChatStore.getState().conversations[0].reasoningEffort).toBeUndefined()
  const required = requiredFallbackCapabilities({ provider: selectedProvider, model: selectedModel.id, reasoningEffort: dispatched.reasoningEffort })
  expect(required).not.toContain('reasoning')
  const fallback = buildProviderFallbackCandidates({ providers: [selectedProvider], original: { providerId: selectedProvider.id, model: selectedModel.id }, requiredCapabilities: required })
  // Retirement is independent of reasoning admission: the refreshed catalogue
  // must still reject the legacy Flash ID, not silently re-enable it for this test.
  expect(fallback.candidates).toHaveLength(selectedModel.deprecated ? 0 : 1)
  expect(fallback.rejectedCandidates).toEqual(selectedModel.deprecated
    ? [{ providerId: selectedProvider.id, model: selectedModel.id, reason: 'model_deprecated' }] : [])
})

it('preserves a supported explicit effort and clears it on a setup model switch', async () => {
  const selectedProvider = provider([
    model('gpt-5.2', { provider: 'openai', reasoningMode: 'openai-effort', reasoningEfforts: ['low', 'medium', 'high'] }),
    model('gpt-4o-mini', { provider: 'openai' }),
  ], { type: 'openai', capabilities: { ...capabilities, reasoningEffort: true } })
  const { result } = await setup(selectedProvider)
  expect(result.current.setupReasoningEffort).toBe('low')
  expect(result.current.supportsSetupReasoningQuick).toBe(true)
  await act(() => result.current.setSetupReasoningEffort('high'))
  await act(async () => result.current.submitSetup('hello', []))
  expect(jest.mocked(sendConversationMessage).mock.calls[0][0].conversation.reasoningEffort).toBe('high')
  await act(() => result.current.switchSetupModel('gpt-4o-mini'))
  expect(result.current.setupConversation.reasoningEffort).toBeUndefined()
  expect(result.current.setupReasoningEffort).toBeUndefined()
  await act(async () => result.current.submitSetup('hello again', []))
  expect(jest.mocked(sendConversationMessage).mock.calls[1][0].conversation.reasoningEffort).toBeUndefined()
})

it('keeps overlapping aliases single-hop in setup and persisted conversation defaults', async () => {
  const selectedProvider = provider([
    model('gpt-4o-mini', { provider: 'openai' }),
    model('gpt-5.2', { provider: 'openai', reasoningMode: 'openai-effort', reasoningEfforts: ['low', 'medium', 'high'] }),
  ], { type: 'openai', capabilities: { ...capabilities, reasoningEffort: true },
    modelAliases: [{ alias: 'fast', model: 'gpt-4o-mini' }, { alias: 'gpt-4o-mini', model: 'gpt-5.2' }] })
  const { result } = await setup(selectedProvider)
  await act(() => result.current.switchSetupModel('fast'))
  expect(result.current.supportsSetupReasoningQuick).toBe(false)
  expect(result.current.setupConversation.reasoningEffort).toBeUndefined()
  const shell = createSetupConversationShell(selectedProvider, 'fast', 'high', '')
  const id = useChatStore.getState().createDraft(selectedProvider.id, 'fast')
  expect(shell.reasoningEffort).toBeUndefined()
  expect(useChatStore.getState().conversations.find(item => item.id === id)?.reasoningEffort).toBeUndefined()
  useChatStore.getState().switchConversationModel(id, selectedProvider.id, 'gpt-5.2', { rememberPreference: false })
  useChatStore.getState().updateConversation(id, { reasoningEffort: 'high' })
  useChatStore.getState().switchConversationModel(id, selectedProvider.id, 'fast', { rememberPreference: false })
  expect(useChatStore.getState().conversations.find(item => item.id === id)?.reasoningEffort).toBeUndefined()
})

it('uses the same normalization for setup and direct draft creation, preserving provider-default reasoning', () => {
  const selectedProvider = provider([model('gpt-5.2', { provider: 'openai', reasoningMode: 'openai-effort', reasoningEfforts: ['medium', 'high'] })],
    { type: 'openai', capabilities: { ...capabilities, reasoningEffort: true } })
  mockSettingsState.providers = [selectedProvider]
  const shell = createSetupConversationShell(selectedProvider, 'gpt-5.2', 'low', '')
  const id = useChatStore.getState().createDraft(selectedProvider.id, 'gpt-5.2')
  expect(shell.reasoningEffort).toBe('medium')
  expect(useChatStore.getState().conversations.find(item => item.id === id)?.reasoningEffort).toBe(shell.reasoningEffort)
  expect(createSetupConversationShell(selectedProvider, 'gpt-5.2', undefined, '').reasoningEffort).toBeUndefined()
})
