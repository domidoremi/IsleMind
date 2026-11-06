import type { Conversation } from '@/types/chatContracts'
import type { ConversationPage, ConversationStorePersistencePort } from '@/modules/conversations'
import { bindConversationStorePersistence, releaseConversationStorePersistence } from '@/presentation/features/conversations/conversationStorePersistenceCommand'
import { useChatStore } from './chatStore'

jest.mock('./settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: {}, providers: [] }) } }))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))
jest.mock('yaml', () => ({ parseDocument: jest.fn() }))
jest.mock('@/services/chatStreamLifecycle', () => ({ abortAllStreams: jest.fn(), abortStream: jest.fn(), hasActiveStream: () => false }))
jest.mock('@/bootstrap/conversationAssistantDetachedWorkRegistry', () => ({
  cancelAllConversationAssistantDetachedWork: jest.fn(), cancelConversationAssistantDetachedWork: jest.fn(),
}))

const record = (index: number): Conversation => ({
  id: `c-${index}`, title: `Conversation ${index}`, providerId: 'fixture', model: 'model', systemPrompt: '',
  temperature: 0.3, maxTokens: 512, generationParameterOverrides: {}, createdAt: index, updatedAt: index,
  messages: [{ id: `m-${index}`, role: 'user', content: `Original history ${index}`, timestamp: index, status: 'done' }],
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
async function settled() { for (let index = 0; index < 30; index++) await Promise.resolve() }
let persistence: ConversationStorePersistencePort
let database: Map<string, Conversation>
let original: string

beforeEach(() => {
  database = new Map(Array.from({ length: 81 }, (_, index) => { const value = record(index); return [value.id, value] }))
  original = JSON.stringify([...database])
  persistence = {
    loadRecords: jest.fn(async () => [...database.values()]),
    loadPage: jest.fn(async () => ({ conversations: [...database.values()].slice(0, 40), hasMore: true, nextCursor: 'older' })),
    loadRecord: jest.fn(async id => database.get(id)),
    saveRecord: jest.fn(async value => { database.set(value.id, value) }),
    deleteRecord: jest.fn(async id => { database.delete(id) }),
    replaceRecords: jest.fn(async values => { database = new Map(values.map(value => [value.id, value])) }),
    readActiveSelection: jest.fn(async () => 'c-0'),
    writeActiveSelection: jest.fn(async () => undefined),
  }
  bindConversationStorePersistence(persistence)
  useChatStore.setState({ conversations: [...database.values()].slice(0, 40), draftConversationIds: new Set(),
    currentId: 'c-0', isLoading: false, error: null, historyCursor: 'older', historyHasMore: true, historyLoadingMore: false })
})
afterEach(async () => { await settled(); releaseConversationStorePersistence(persistence) })

it.each(['normal', 'guide'] as const)('preserves all 81 stored histories when creating and deleting a %s conversation with only 40 loaded', async kind => {
  const id = kind === 'normal' ? useChatStore.getState().create('fixture', 'model') : useChatStore.getState().createLocalSetupConversation()
  await settled()
  expect(database.size).toBe(82)
  expect(JSON.stringify([...database].filter(([key]) => key !== id))).toBe(original)
  expect(useChatStore.getState().conversations).toHaveLength(41)
  useChatStore.getState().delete(id)
  await settled()
  expect(JSON.stringify([...database])).toBe(original)
  expect(useChatStore.getState().conversations).toHaveLength(40)
  expect(persistence.replaceRecords).not.toHaveBeenCalled()
  expect(persistence.saveRecord).toHaveBeenCalledTimes(1)
  expect(persistence.deleteRecord).toHaveBeenCalledWith(id)
  expect(useChatStore.getState()).toMatchObject({ historyHasMore: true, historyCursor: 'older' })
})

it.each(['c-0', 'c-80'])('deletes only the addressed %s record, including outside the loaded page', async id => {
  const expected = JSON.stringify([...database].filter(([key]) => key !== id))
  useChatStore.getState().delete(id)
  await settled()
  expect(JSON.stringify([...database])).toBe(expected)
  expect(database.size).toBe(80)
  expect(persistence.replaceRecords).not.toHaveBeenCalled()
  expect(persistence.saveRecord).not.toHaveBeenCalled()
})

it('serializes a new record and its immediate deletion without retaining an orphan', async () => {
  const id = useChatStore.getState().create('fixture', 'model')
  useChatStore.getState().delete(id)
  await settled()
  expect(JSON.stringify([...database])).toBe(original)
  expect(persistence.saveRecord).toHaveBeenCalledTimes(1)
  expect(persistence.deleteRecord).toHaveBeenCalledWith(id)
})

it('discards an unsent draft without persisting it or the next draft selection', async () => {
  const next = useChatStore.getState().createDraft('fixture', 'model')
  const discarded = useChatStore.getState().createDraft('fixture', 'model')
  useChatStore.getState().delete(discarded)
  await settled()
  expect(useChatStore.getState().currentId).toBe(next)
  expect(persistence.writeActiveSelection).not.toHaveBeenCalled()
  expect(persistence.deleteRecord).not.toHaveBeenCalled()
  expect(persistence.saveRecord).not.toHaveBeenCalled()
  expect(persistence.replaceRecords).not.toHaveBeenCalled()
  expect(JSON.stringify([...database])).toBe(original)
})

it.each(['initial', 'older-page', 'background'] as const)('rejects stale %s reads after scoped deletion without losing other saved history', async source => {
  const page = deferred<ConversationPage>()
  const background = deferred<readonly Conversation[]>()
  const stale = [...database.values()]
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
  useChatStore.getState().delete('c-0')
  page.resolve({ conversations: stale, hasMore: true, nextCursor: 'stale' })
  background.resolve(stale)
  await loading
  await settled()
  expect(database.size).toBe(80)
  expect(useChatStore.getState().conversations.some(value => value.id === 'c-0')).toBe(false)
  expect(useChatStore.getState()).toMatchObject({ isLoading: false, historyLoadingMore: false })
  expect(database.get('c-80')?.messages[0].content).toBe('Original history 80')
})

it('reports failed scoped writes, preserves durable history and permits reload and retry', async () => {
  ;(persistence.deleteRecord as jest.Mock).mockRejectedValueOnce(new Error('database unavailable'))
  useChatStore.getState().delete('c-0')
  await settled()
  expect(useChatStore.getState().error).toBe('storage.sqliteSyncFailed')
  expect(JSON.stringify([...database])).toBe(original)
  await useChatStore.getState().load()
  expect(useChatStore.getState().conversations.some(value => value.id === 'c-0')).toBe(true)
  useChatStore.getState().delete('c-0')
  await settled()
  expect(database.size).toBe(80)
  expect(database.has('c-0')).toBe(false)
})

it('reports a failed new-record save without replacing any older history', async () => {
  ;(persistence.saveRecord as jest.Mock).mockRejectedValueOnce(new Error('database unavailable'))
  useChatStore.getState().create('fixture', 'model')
  await settled()
  expect(useChatStore.getState().error).toBe('storage.sqliteSyncFailed')
  expect(JSON.stringify([...database])).toBe(original)
  expect(persistence.replaceRecords).not.toHaveBeenCalled()
})
