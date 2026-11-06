import type { Conversation } from '@/types/chatContracts'
import type { ConversationPage, ConversationStorePersistencePort } from '@/modules/conversations'
import {
  bindConversationStorePersistence,
  releaseConversationStorePersistence,
} from '@/presentation/features/conversations/conversationStorePersistenceCommand'
import { useChatStore } from './chatStore'

jest.mock('./settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: {}, providers: [] }) },
}))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))
jest.mock('yaml', () => ({ parseDocument: () => { throw new Error('Hydration must not import a Skill') } }))
jest.mock('@/bootstrap/conversationAssistantDetachedWorkRegistry', () => ({
  cancelAllConversationAssistantDetachedWork: jest.fn(),
  cancelConversationAssistantDetachedWork: jest.fn(),
}))

function conversation(id: string): Conversation {
  return {
    id, title: id, providerId: 'fixture-provider', model: 'fixture-model',
    systemPrompt: '', temperature: 0.3, maxTokens: 512, generationParameterOverrides: {},
    messages: [{ id: `${id}-answer`, role: 'assistant', content: 'Retained partial answer.',
      responseText: 'Retained partial answer.', status: 'cancelled', timestamp: 2 }],
    createdAt: 1, updatedAt: 2,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

let persistence: ConversationStorePersistencePort
let loadPage: jest.Mock
let loadRecord: jest.Mock
let readActiveSelection: jest.Mock
let writeActiveSelection: jest.Mock
let retained: Conversation

beforeEach(() => {
  retained = conversation('retained')
  loadPage = jest.fn().mockResolvedValue({ conversations: [retained], hasMore: false })
  loadRecord = jest.fn().mockResolvedValue(undefined)
  readActiveSelection = jest.fn().mockResolvedValue(retained.id)
  writeActiveSelection = jest.fn().mockResolvedValue(undefined)
  persistence = {
    loadRecords: jest.fn().mockResolvedValue([]),
    loadPage, loadRecord, readActiveSelection, writeActiveSelection,
    saveRecord: jest.fn().mockResolvedValue(undefined),
    deleteRecord: jest.fn(async () => undefined), replaceRecords: jest.fn().mockResolvedValue(undefined),
  }
  bindConversationStorePersistence(persistence)
  useChatStore.setState({
    conversations: [], draftConversationIds: new Set(), currentId: null,
    isLoading: false, error: null, historyCursor: null, historyHasMore: false, historyLoadingMore: false,
  })
})

afterEach(() => releaseConversationStorePersistence(persistence))

it.each(['page', 'selection', 'active-record'] as const)(
  'settles a failed %s read without erasing records, drafts, selection or unrelated errors',
  async stage => {
    const existing = conversation('existing')
    const draft = { ...conversation('draft'), messages: [] }
    const previous = {
      conversations: [existing, draft], draftConversationIds: new Set([draft.id]), currentId: draft.id,
      historyCursor: 'retained-cursor', historyHasMore: true, error: 'An unrelated operation failed.',
    }
    useChatStore.setState(previous)
    const failure = new Error(`${stage} unavailable`)
    if (stage === 'page') loadPage.mockRejectedValueOnce(failure)
    else if (stage === 'selection') readActiveSelection.mockRejectedValueOnce(failure)
    else {
      readActiveSelection.mockResolvedValueOnce('outside-first-page')
      loadRecord.mockRejectedValueOnce(failure)
    }
    await expect(useChatStore.getState().load()).rejects.toBe(failure)
    expect(useChatStore.getState()).toMatchObject({ ...previous, isLoading: false })
    expect(useChatStore.getState().conversations).toBe(previous.conversations)
    expect(useChatStore.getState().draftConversationIds).toBe(previous.draftConversationIds)
    expect(writeActiveSelection).not.toHaveBeenCalled()
    expect(persistence.saveRecord).not.toHaveBeenCalled()
    expect(persistence.replaceRecords).not.toHaveBeenCalled()
  },
)

it('allows a fresh attempt after rejection and reconstructs terminal content without replay or false success', async () => {
  loadPage.mockRejectedValueOnce(new Error('temporary lock conflict'))
  await expect(useChatStore.getState().load()).rejects.toThrow('temporary lock conflict')
  await useChatStore.getState().load()
  expect(loadPage).toHaveBeenCalledTimes(2)
  expect(useChatStore.getState()).toMatchObject({ isLoading: false, currentId: retained.id, conversations: [retained] })
  const restored = useChatStore.getState().conversations[0].messages
  const terminalOutput = (record: Conversation['messages'][number]) => ({
    id: record.id, content: record.content, responseText: record.responseText, status: record.status,
  })
  expect(restored.map(terminalOutput)).toEqual(retained.messages.map(terminalOutput))
  expect(restored[0].responseLifecycle?.stage).toBe('cancelled')
  expect(writeActiveSelection).toHaveBeenCalledWith(retained.id)
  expect(persistence.saveRecord).not.toHaveBeenCalled()
  expect(persistence.replaceRecords).not.toHaveBeenCalled()
})

it('shares one in-flight hydration between concurrent callers rather than publishing competing snapshots', async () => {
  const page = deferred<ConversationPage>()
  loadPage.mockReturnValue(page.promise)
  const first = useChatStore.getState().load()
  const second = useChatStore.getState().load()
  const callsWhilePending = loadPage.mock.calls.length
  const pendingWasLoading = useChatStore.getState().isLoading
  page.resolve({ conversations: [retained], hasMore: false })
  await Promise.all([first, second])
  expect(pendingWasLoading).toBe(true)
  expect(callsWhilePending).toBe(1)
  expect(readActiveSelection).toHaveBeenCalledTimes(1)
  expect(writeActiveSelection).toHaveBeenCalledTimes(1)
  expect(useChatStore.getState()).toMatchObject({ isLoading: false, conversations: [retained] })
})

it('still represents a successfully read empty database as empty, not as a startup failure', async () => {
  loadPage.mockResolvedValue({ conversations: [], hasMore: false })
  useChatStore.setState({ conversations: [conversation('stale')], currentId: 'stale' })
  await useChatStore.getState().load()
  expect(useChatStore.getState()).toMatchObject({ conversations: [], currentId: null, isLoading: false, error: null })
  expect(writeActiveSelection).toHaveBeenCalledWith(null)
  expect(persistence.replaceRecords).not.toHaveBeenCalled()
})

it('loads only an addressed older conversation without selecting, writing or expanding the history page', async () => {
  const older = conversation('older')
  loadRecord.mockResolvedValue(older)
  useChatStore.setState({ conversations: [retained], currentId: retained.id, historyCursor: 'cursor', historyHasMore: true })
  expect(await useChatStore.getState().ensureLoaded(older.id)).toBe(true)
  expect(loadRecord).toHaveBeenCalledWith(older.id)
  expect(loadPage).not.toHaveBeenCalled()
  expect(useChatStore.getState()).toMatchObject({ currentId: retained.id, historyCursor: 'cursor', historyHasMore: true })
  expect(useChatStore.getState().conversations.map(value => value.id)).toEqual([retained.id, older.id])
  expect(writeActiveSelection).not.toHaveBeenCalled()
  expect(persistence.saveRecord).not.toHaveBeenCalled()
  expect(persistence.replaceRecords).not.toHaveBeenCalled()
})

it('retains a loaded draft and rejects a missing or mismatched addressed record', async () => {
  useChatStore.setState({ conversations: [retained], draftConversationIds: new Set([retained.id]) })
  expect(await useChatStore.getState().ensureLoaded(retained.id)).toBe(true)
  expect(loadRecord).not.toHaveBeenCalled()
  expect(await useChatStore.getState().ensureLoaded('missing')).toBe(false)
  loadRecord.mockResolvedValueOnce(conversation('different'))
  expect(await useChatStore.getState().ensureLoaded('addressed')).toBe(false)
  expect(useChatStore.getState().conversations).toEqual([retained])
})

it.each(['cancel', 'delete', 'clear-all'] as const)('does not publish an older read after %s', async action => {
  const pending = deferred<Conversation | undefined>()
  loadRecord.mockReturnValue(pending.promise)
  const controller = new AbortController()
  const read = useChatStore.getState().ensureLoaded('older', controller.signal)
  if (action === 'cancel') controller.abort()
  else if (action === 'delete') useChatStore.getState().delete('older')
  else await useChatStore.getState().clearAll()
  pending.resolve(conversation('older'))
  expect(await read).toBe(false)
  expect(useChatStore.getState().conversations).toEqual([])
})

it('retains a newer local version that appears while its addressed read is pending', async () => {
  const pending = deferred<Conversation | undefined>()
  loadRecord.mockReturnValue(pending.promise)
  const read = useChatStore.getState().ensureLoaded('older')
  const newer = { ...conversation('older'), title: 'Local edit' }
  useChatStore.setState({ conversations: [newer] })
  pending.resolve(conversation('older'))
  expect(await read).toBe(true)
  expect(useChatStore.getState().conversations).toEqual([newer])
})

it('reports an addressed read failure to the caller and permits retry without erasing state', async () => {
  loadRecord.mockRejectedValueOnce(new Error('read unavailable'))
  await expect(useChatStore.getState().ensureLoaded('older')).rejects.toThrow('read unavailable')
  loadRecord.mockResolvedValueOnce(conversation('older'))
  expect(await useChatStore.getState().ensureLoaded('older')).toBe(true)
})
