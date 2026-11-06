import type { Conversation } from '@/types/chatContracts'
import type { ConversationPage, ConversationStorePersistencePort } from '@/modules/conversations'
import { bindConversationStorePersistence, releaseConversationStorePersistence } from '@/presentation/features/conversations/conversationStorePersistenceCommand'
import { useChatStore } from './chatStore'
import { abortAllStreams } from '@/services/chatStreamLifecycle'
import { cancelAllConversationAssistantDetachedWork } from '@/bootstrap/conversationAssistantDetachedWorkRegistry'

jest.mock('./settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: {}, providers: [] }) } }))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))
jest.mock('yaml', () => ({ parseDocument: jest.fn() }))
jest.mock('@/services/chatStreamLifecycle', () => ({ abortAllStreams: jest.fn(), abortStream: jest.fn(), hasActiveStream: () => false }))
jest.mock('@/bootstrap/conversationAssistantDetachedWorkRegistry', () => ({
  cancelAllConversationAssistantDetachedWork: jest.fn(), cancelConversationAssistantDetachedWork: jest.fn(),
}))

const record = (id: string): Conversation => ({
  id, title: id, providerId: 'fixture', model: 'model', systemPrompt: '', temperature: 0.3, maxTokens: 512,
  generationParameterOverrides: {}, messages: [{ id: id + '-message', role: 'user', content: 'Fixture', timestamp: 1, status: 'done' }],
  createdAt: 1, updatedAt: 1,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
let persistence: ConversationStorePersistencePort
let database: Conversation[]

beforeEach(() => {
  jest.clearAllMocks()
  database = [record('visible'), record('not-loaded')]
  persistence = {
    loadRecords: jest.fn(async () => database),
    loadPage: jest.fn(async () => ({ conversations: database.slice(0, 1), hasMore: database.length > 1 })),
    loadRecord: jest.fn(async id => database.find(item => item.id === id)),
    saveRecord: jest.fn(async record => { database = [...database.filter(item => item.id !== record.id), record] }),
    deleteRecord: jest.fn(async () => undefined), replaceRecords: jest.fn(async records => { database = [...records] }),
    readActiveSelection: jest.fn(async () => 'visible'),
    writeActiveSelection: jest.fn(async () => undefined),
  }
  bindConversationStorePersistence(persistence)
  useChatStore.setState({ conversations: [database[0]], draftConversationIds: new Set(), currentId: 'visible',
    isLoading: false, error: null, historyCursor: 'next', historyHasMore: true, historyLoadingMore: false })
})
afterEach(() => releaseConversationStorePersistence(persistence))

it('deletes records beyond the loaded page, stops active work, and waits for durable deletion', async () => {
  const commit = deferred<void>()
  const replace = persistence.replaceRecords as jest.Mock
  replace.mockImplementationOnce(async () => { await commit.promise; database = [] })
  let settled = false
  const deletion = useChatStore.getState().clearAll().then(() => { settled = true })
  await Promise.resolve()
  expect(settled).toBe(false)
  expect(database).toHaveLength(2)
  expect(abortAllStreams).toHaveBeenCalledTimes(1)
  expect(cancelAllConversationAssistantDetachedWork).toHaveBeenCalledTimes(1)
  commit.resolve()
  await deletion
  expect(database).toEqual([])
  expect(replace).toHaveBeenCalledWith([])
  expect(persistence.writeActiveSelection).toHaveBeenCalledWith(null)
  expect(useChatStore.getState()).toMatchObject({ conversations: [], currentId: null, historyHasMore: false, historyCursor: null })
})

it.each(['initial', 'older-page', 'background'] as const)('does not resurrect deleted records from a pending %s read', async source => {
  const page = deferred<ConversationPage>()
  const background = deferred<readonly Conversation[]>()
  const stale = [...database]
  let loading: Promise<unknown>
  if (source === 'background') {
    ;(persistence.loadPage as jest.Mock).mockResolvedValueOnce({ conversations: [], hasMore: false })
    ;(persistence.loadRecords as jest.Mock).mockReturnValueOnce(background.promise)
    await useChatStore.getState().load()
    loading = background.promise
  } else {
    ;(persistence.loadPage as jest.Mock).mockReturnValueOnce(page.promise)
    loading = source === 'initial' ? useChatStore.getState().load() : useChatStore.getState().loadMore()
  }
  await useChatStore.getState().clearAll()
  page.resolve({ conversations: stale, hasMore: true, nextCursor: 'old-page' })
  background.resolve(stale)
  await loading
  await Promise.resolve()
  expect(database).toEqual([])
  expect(useChatStore.getState()).toMatchObject({ conversations: [], currentId: null, isLoading: false, historyHasMore: false })
})

it('reports a failed transaction and keeps the visible history available to retry', async () => {
  ;(persistence.replaceRecords as jest.Mock).mockRejectedValueOnce(new Error('database unavailable'))
  await expect(useChatStore.getState().clearAll()).rejects.toThrow('database unavailable')
  expect(database).toHaveLength(2)
  expect(useChatStore.getState()).toMatchObject({ currentId: 'visible', historyHasMore: true })
  expect(useChatStore.getState().conversations.map(item => item.id)).toEqual(['visible'])
  expect(useChatStore.getState().error).toBe('storage.sqliteSyncFailed')
})
