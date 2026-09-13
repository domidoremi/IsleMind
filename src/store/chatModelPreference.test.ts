import type { Conversation } from '@/types/chatContracts'
import type { ConversationStorePersistencePort } from '@/modules/conversations'
import { bindConversationStorePersistence, releaseConversationStorePersistence } from '@/presentation/features/conversations/conversationStorePersistenceCommand'
import { lockConversation, resetConversationLocksForTests } from '@/services/conversationLock'
import { clearActiveStream, setActiveStream } from '@/services/chatStreamLifecycle'
import { useChatStore } from './chatStore'
import { useSettingsStore } from './settingsStore'

jest.mock('./settingsStore', () => ({ useSettingsStore: { getState: () => mockSettingsState } }))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))
jest.mock('yaml', () => ({ parseDocument: () => { throw new Error('Model selection must not parse Skills') } }))
jest.mock('@/bootstrap/conversationAssistantDetachedWorkRegistry', () => ({ cancelAllConversationAssistantDetachedWork: jest.fn(), cancelConversationAssistantDetachedWork: jest.fn() }))

const mockSettingsState = {
  settings: { defaultTemperature: 0.2, defaultMaxTokens: 128 },
  providers: [{ id: 'p', type: 'openai' as const, name: 'P', apiKey: '', models: ['gpt-4o', 'gpt-4o-mini'], enabled: true }],
  rememberPreferredModel: jest.fn(async () => undefined),
}

describe('explicit Chat model preference saves', () => {
  let persistence: ConversationStorePersistencePort
  let saveRecord: jest.Mock
  let source: Conversation

  beforeEach(() => {
    mockSettingsState.rememberPreferredModel.mockReset().mockResolvedValue(undefined)
    source = { id: 'c', title: 'History', providerId: null, model: null, systemPrompt: '', temperature: 0.2, maxTokens: 128, createdAt: 1, updatedAt: 1,
      messages: [{ id: 'a', role: 'assistant', content: 'Unknown historical identity', status: 'done', timestamp: 1 }] }
    saveRecord = jest.fn(async () => undefined)
    persistence = { loadRecords: async () => [source], loadPage: async () => ({ conversations: [source], hasMore: false }), loadRecord: async () => source,
      saveRecord, replaceRecords: jest.fn(), readActiveSelection: async () => null, writeActiveSelection: jest.fn(async () => undefined) }
    bindConversationStorePersistence(persistence)
    useChatStore.setState({ conversations: [source], currentId: 'c', draftConversationIds: new Set(), error: null })
  })
  afterEach(() => { releaseConversationStorePersistence(persistence); resetConversationLocksForTests(); clearActiveStream('c') })

  it('binds only on explicit selection, retains history and uses the full record save', async () => {
    expect(useChatStore.getState().switchConversationModel('c', 'p', 'gpt-4o')).toBe(true)
    await Promise.resolve()
    expect(useChatStore.getState().conversations[0]).toMatchObject({ providerId: 'p', model: 'gpt-4o', providerModelMode: 'manual' })
    expect(saveRecord).toHaveBeenCalledTimes(1)
    expect(persistence.replaceRecords).not.toHaveBeenCalled()
    expect(saveRecord.mock.calls[0][0].messages[0].providerId).toBeUndefined()
    expect(useSettingsStore.getState().rememberPreferredModel).toHaveBeenCalledWith('p', 'gpt-4o')
  })
  it('does not remember a skill-applied preference or touch locked runs', () => {
    expect(useChatStore.getState().switchConversationModel('c', 'p', 'gpt-4o', { rememberPreference: false })).toBe(true)
    expect(mockSettingsState.rememberPreferredModel).not.toHaveBeenCalled()
    const release = lockConversation('c')
    expect(useChatStore.getState().switchConversationModel('c', 'p', 'gpt-4o-mini')).toBe(false)
    release()
    expect(useChatStore.getState().conversations[0].model).toBe('gpt-4o')
  })
  it('does not cancel or change an already-running reply when a model is selected', () => {
    const controller = new AbortController()
    setActiveStream('c', { controller, messageId: 'a' })
    expect(useChatStore.getState().switchConversationModel('c', 'p', 'gpt-4o')).toBe(false)
    expect(controller.signal.aborted).toBe(false)
    expect(useChatStore.getState().conversations[0]).toBe(source)
    expect(mockSettingsState.rememberPreferredModel).not.toHaveBeenCalled()
    expect(saveRecord).not.toHaveBeenCalled()
  })
  it('keeps drafts unsaved and surfaces global save failure without reverting the selected preference', async () => {
    useChatStore.setState({ draftConversationIds: new Set(['c']) })
    mockSettingsState.rememberPreferredModel.mockRejectedValueOnce(new Error('settings unavailable'))
    useChatStore.getState().switchConversationModel('c', 'p', 'gpt-4o')
    await Promise.resolve()
    expect(saveRecord).not.toHaveBeenCalled()
    expect(useChatStore.getState().conversations[0].model).toBe('gpt-4o')
    expect(useChatStore.getState().error).toBe('chat.preferredModelSaveFailed')
  })
  it('reports a failed Conversation save instead of replacing or dropping history', async () => {
    saveRecord.mockRejectedValueOnce(new Error('disk full'))
    useChatStore.getState().switchConversationModel('c', 'p', 'gpt-4o')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(useChatStore.getState().error).toBe('storage.sqliteSyncFailed')
    expect(useChatStore.getState().conversations[0].messages).toBe(source.messages)
    expect(persistence.replaceRecords).not.toHaveBeenCalled()
  })
})
