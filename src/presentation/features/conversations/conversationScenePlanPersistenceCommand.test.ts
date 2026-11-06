import type { Conversation } from '@/types/chatContracts'
import type { ConversationStorePersistencePort } from '@/modules/conversations'
import { conversationScenePlanRevision } from '@/modules/conversations'
import {
  bindConversationStorePersistence, releaseConversationStorePersistence,
  saveConversationRecord, saveConversationScenePlanRecord, replaceConversationRecords, deleteConversationRecord, loadConversationRecord,
} from './conversationStorePersistenceCommand'

const original: Conversation = { id: 'c', title: 'History', providerId: 'p', model: 'm', systemPrompt: 'Before',
  temperature: 0.6, maxTokens: 10, messages: [], createdAt: 1, updatedAt: 1 }
let current: Conversation | undefined
let persistence: ConversationStorePersistencePort
let save: jest.Mock
beforeEach(() => {
  current = original
  save = jest.fn(async (value: Conversation) => { current = value })
  persistence = { loadRecords: async () => current ? [current] : [], loadRecord: async () => current,
    loadPage: async () => ({ conversations: [], hasMore: false }),
    saveRecord: save, deleteRecord: async id => { if (current?.id === id) current = undefined }, replaceRecords: async values => { current = values[0] },
    readActiveSelection: async () => null, writeActiveSelection: async () => undefined }
  bindConversationStorePersistence(persistence)
})
afterEach(() => releaseConversationStorePersistence(persistence))

test('addressed reads wait for earlier queued deletion and do not observe the removed record', async () => {
  let commit!: () => void
  const pending = new Promise<void>(resolve => { commit = resolve })
  persistence.deleteRecord = async () => { await pending; current = undefined }
  const deletion = deleteConversationRecord(original.id)
  const read = loadConversationRecord(original.id)
  let settled = false
  void read.then(() => { settled = true })
  await Promise.resolve()
  expect(settled).toBe(false)
  commit()
  await deletion
  expect(await read).toBeUndefined()
})

test('does not recreate a conversation removed by an earlier queued scoped deletion', async () => {
  const deletion = deleteConversationRecord(original.id)
  const application = saveConversationScenePlanRecord({ ...original, systemPrompt: 'Scene' }, conversationScenePlanRevision(original), async () => true)
  await deletion
  await expect(application).rejects.toThrow('conversation_scene_plan_missing')
  expect(current).toBeUndefined()
  expect(save).not.toHaveBeenCalled()
})

test('compares after an earlier queued save and does not overwrite its newer configuration', async () => {
  const previous = saveConversationRecord({ ...original, systemPrompt: 'External edit', updatedAt: 2 })
  const application = saveConversationScenePlanRecord({ ...original, systemPrompt: 'Scene', updatedAt: 3 }, conversationScenePlanRevision(original), async () => true)
  await previous
  await expect(application).rejects.toThrow('conversation_scene_plan_conflict')
  expect(current?.systemPrompt).toBe('External edit')
  expect(save).toHaveBeenCalledTimes(1)
})

test('does not resurrect a record deleted by an earlier queued operation', async () => {
  const deletion = replaceConversationRecords([])
  const application = saveConversationScenePlanRecord({ ...original, systemPrompt: 'Scene' }, conversationScenePlanRevision(original), async () => true)
  await deletion
  await expect(application).rejects.toThrow('conversation_scene_plan_missing')
  expect(current).toBeUndefined()
  expect(save).not.toHaveBeenCalled()
})

test('revalidates the preview inside the queue immediately before its canonical save', async () => {
  const validate = jest.fn(async () => false)
  await expect(saveConversationScenePlanRecord({ ...original, systemPrompt: 'Scene' }, conversationScenePlanRevision(original), validate))
    .rejects.toThrow('conversation_scene_plan_conflict')
  expect(validate).toHaveBeenCalledTimes(1)
  expect(save).not.toHaveBeenCalled()
  await saveConversationScenePlanRecord({ ...original, systemPrompt: 'Scene' }, conversationScenePlanRevision(original), async () => true)
  expect(current?.systemPrompt).toBe('Scene')
})

test('applies an untouched legacy record after the store has inferred its generation preferences', async () => {
  const loaded = { ...original, generationParameterOverrides: { temperature: true, maxTokens: true } }
  await saveConversationScenePlanRecord({ ...loaded, systemPrompt: 'Scene' }, conversationScenePlanRevision(loaded), async () => true)
  expect(current?.systemPrompt).toBe('Scene')
  expect(save).toHaveBeenCalledTimes(1)
})

test('still rejects changing explicit model-default preferences on a legacy record', async () => {
  const loaded = { ...original, generationParameterOverrides: {} }
  await expect(saveConversationScenePlanRecord({ ...loaded, systemPrompt: 'Scene' }, conversationScenePlanRevision(loaded), async () => true))
    .rejects.toThrow('conversation_scene_plan_conflict')
  expect(save).not.toHaveBeenCalled()
})

test('keeps canonical historical messages and metadata when the rendered record has been sanitized', async () => {
  const historical: Conversation['messages'] = [{ id: 'historical', role: 'assistant', content: 'Historical text',
    timestamp: 1, status: 'done', toolCalls: [{ id: 'old-tool', type: 'tool', title: 'read',
      content: 'Original diagnostic metadata', status: 'done', startedAt: 1 }] }]
  current = { ...original, messages: historical, title: 'Canonical title' }
  const incoming = { ...original, systemPrompt: 'Scene', messages: [], title: 'Rendered title', updatedAt: 2 }
  await saveConversationScenePlanRecord(incoming, conversationScenePlanRevision(current), async () => true)
  expect(current?.systemPrompt).toBe('Scene')
  expect(current?.title).toBe('Canonical title')
  expect(current?.messages).toBe(historical)
  expect(JSON.stringify(current?.messages)).toBe(JSON.stringify(historical))
})
