import type { Conversation, Message } from '@/types/chatContracts'
import { createConversationBranchDraft, type ConversationStorePersistencePort } from '@/modules/conversations'
import { createConversationMessageController } from '@/presentation/features/conversations/conversationMessageController'
import {
  bindConversationStorePersistence,
  releaseConversationStorePersistence,
} from '@/presentation/features/conversations/conversationStorePersistenceCommand'
import { lockConversation, resetConversationLocksForTests } from '@/services/conversationLock'
import { useChatStore } from './chatStore'

jest.mock('./settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: {}, providers: [] }) },
}))
jest.mock('@/i18n/service', () => ({ st: (key: string, values?: { title?: string }) => values?.title ? `${values.title} · branch` : key }))
jest.mock('yaml', () => ({ parseDocument: () => { throw new Error('Branching must not import a Skill document') } }))
jest.mock('@/bootstrap/conversationAssistantDetachedWorkRegistry', () => ({
  cancelAllConversationAssistantDetachedWork: jest.fn(),
  cancelConversationAssistantDetachedWork: jest.fn(),
}))

function sourceConversation(): Conversation {
  return {
    id: 'source', title: 'Pilot review', providerId: 'provider', model: 'model',
    providerModelMode: 'manual', systemPrompt: 'Keep uncertainty explicit.',
    temperature: 0.3, topP: 0.8, maxTokens: 1024, generationParameterOverrides: {},
    enabledTools: ['rag:context_pack'], knowledgeSources: ['policy'],
    commandRefs: [{ id: 'private-memory', type: 'memory', label: 'Original memory', value: 'source-only' }],
    skillIds: ['review'], skillSnapshot: {
      skillIds: ['review'], names: ['Review'], systemPrompt: 'Review facts.', variables: { audience: 'team' },
    },
    messages: [
      { id: 'question', role: 'user', content: 'Can the pilot launch?', status: 'done', timestamp: 1,
        attachments: [{ id: 'note', type: 'text', uri: 'file://transient-note', name: 'note.txt', mimeType: 'text/plain', size: 4, base64: 'bm90ZQ==' }] },
      { id: 'answer', role: 'assistant', content: 'Public launch is blocked.', responseText: 'Public launch is blocked.', status: 'done', timestamp: 2,
        providerId: 'captured-provider', model: 'captured-model', usage: { totalTokens: 80, source: 'provider' }, durationMs: 900,
        citations: [{ id: 'policy-0', type: 'knowledge', title: 'Pilot policy', documentId: 'policy', chunkId: 'policy-0', headingPath: ['Decision'] }],
        toolCalls: [{ id: 'old-task', type: 'tool', title: 'Approval', status: 'done', metadata: { taskId: 'old-task', runId: 'old-run', confirmable: true } }],
        responseLifecycle: { stage: 'completed', startedAt: 1, stageStartedAt: 2, completedAt: 2, history: [] } },
      { id: 'follow-up', role: 'user', content: 'Keep the existing path.', status: 'done', timestamp: 3 },
      { id: 'later-answer', role: 'assistant', content: 'Original later reply.', status: 'cancelled', timestamp: 4 },
    ],
    createdAt: 1, updatedAt: 4,
  }
}

describe('non-destructive Chat branch drafts', () => {
  let source: Conversation
  let records: Map<string, Conversation>
  let persistence: ConversationStorePersistencePort
  let saveRecord: jest.Mock

  beforeEach(() => {
    source = sourceConversation()
    records = new Map([[source.id, source]])
    saveRecord = jest.fn(async (record: Conversation) => { records.set(record.id, record) })
    persistence = {
      loadRecords: async () => [...records.values()],
      loadPage: async () => ({ conversations: [...records.values()], hasMore: false }),
      loadRecord: async id => records.get(id),
      saveRecord,
      replaceRecords: jest.fn(async () => undefined),
      readActiveSelection: async () => source.id,
      writeActiveSelection: jest.fn(async () => undefined),
    }
    bindConversationStorePersistence(persistence)
    useChatStore.setState({ conversations: [source], draftConversationIds: new Set(), currentId: source.id, error: null })
  })

  afterEach(() => {
    releaseConversationStorePersistence(persistence)
    resetConversationLocksForTests()
  })

  function branch() {
    const id = useChatStore.getState().createBranchDraft(source.id, 'answer')!
    expect(id).toBeTruthy()
    return useChatStore.getState().conversations.find(record => record.id === id)!
  }

  it('copies the selected prefix and AI settings without run authority, duplicate cost or shared mutable fields', () => {
    const before = JSON.stringify(source)
    const draft = branch()
    expect(draft.messages.map(message => message.content)).toEqual(['Can the pilot launch?', 'Public launch is blocked.'])
    expect(draft.messages.every(message => !source.messages.some(original => original.id === message.id))).toBe(true)
    expect(draft.messages[1]).toMatchObject({ providerId: 'captured-provider', model: 'captured-model', status: 'done' })
    expect(draft.messages[1].toolCalls).toBeUndefined()
    expect(draft.messages[1].responseLifecycle).toBeUndefined()
    expect(draft.messages[1].usage).toBeUndefined()
    expect(draft.messages[1].durationMs).toBeUndefined()
    expect(draft.commandRefs).toBeUndefined()
    expect(draft).toMatchObject({ providerId: source.providerId, model: source.model, systemPrompt: source.systemPrompt, generationParameterOverrides: {} })
    expect(draft.messages[0].attachments).toEqual(source.messages[0].attachments)
    expect(draft.messages[1].citations).toEqual(source.messages[1].citations)
    draft.messages[0].attachments![0].name = 'changed.txt'
    draft.messages[1].citations![0].headingPath!.push('Changed')
    draft.skillSnapshot!.variables.audience = 'new'
    draft.enabledTools!.push('another-tool')
    expect(JSON.stringify(source)).toBe(before)
    expect(saveRecord).not.toHaveBeenCalled()
    expect(persistence.writeActiveSelection).not.toHaveBeenCalled()
  })

  it('keeps cancellation/error status and rejects a stale target or an unfinished prefix', () => {
    const identity = { id: 'branch', title: 'Branch', now: 10 }
    const full = createConversationBranchDraft(source, 'later-answer', identity)!
    expect(full.messages.at(-1)?.status).toBe('cancelled')
    source.messages[1].status = 'error'
    expect(createConversationBranchDraft(source, 'answer', identity)?.messages[1].status).toBe('error')
    expect(createConversationBranchDraft(source, 'missing', identity)).toBeNull()
    source.messages[1].status = 'streaming'
    expect(createConversationBranchDraft(source, 'answer', identity)).toBeNull()
    expect(createConversationBranchDraft(source, 'question', identity)?.messages).toHaveLength(1)
    source.messages[0].status = 'sending'
    expect(createConversationBranchDraft(source, 'question', identity)).toBeNull()
  })

  it('does not create a draft for a locked, missing or already-unsaved source', () => {
    const release = lockConversation(source.id)
    expect(useChatStore.getState().createBranchDraft(source.id, 'answer')).toBeNull()
    release()
    expect(useChatStore.getState().createBranchDraft('missing', 'answer')).toBeNull()
    useChatStore.setState({ draftConversationIds: new Set([source.id]) })
    expect(useChatStore.getState().createBranchDraft(source.id, 'answer')).toBeNull()
    expect(useChatStore.getState().conversations).toEqual([source])
    expect(saveRecord).not.toHaveBeenCalled()
  })

  it('can modify or discard the unsent branch without saving it or changing the original', async () => {
    const before = JSON.stringify(source)
    const draft = branch()
    useChatStore.getState().removeMessage(draft.id, draft.messages[1].id)
    useChatStore.getState().trimAfterMessage(draft.id, draft.messages[0].id)
    await Promise.resolve()
    expect(saveRecord).not.toHaveBeenCalled()
    useChatStore.getState().select(source.id)
    expect(useChatStore.getState().conversations).toEqual([source])
    expect(useChatStore.getState().draftConversationIds.size).toBe(0)
    expect(JSON.stringify(records.get(source.id))).toBe(before)
  })

  function sender(dispatch: jest.Mock) {
    return createConversationMessageController({
      createMessageId: () => 'new-question', normalizeContent: value => value.trim(), now: () => 10,
      estimateTextTokens: text => text.length, buildEstimatedUsage: () => ({ source: 'estimated' }),
      dispatchLegacyMessage: dispatch,
      store: {
        setError: useChatStore.getState().setError,
        addMessage: useChatStore.getState().addMessage,
        getConversation: id => useChatStore.getState().conversations.find(record => record.id === id),
      },
    })
  }

  it('saves the prefix and new user turn through the existing Send barrier before dispatch', async () => {
    const draft = branch()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    saveRecord.mockImplementation(async (record: Conversation) => { await gate; records.set(record.id, record) })
    const dispatch = jest.fn(async () => undefined)
    const sending = sender(dispatch).send({ conversation: draft, content: 'Explore the private pilot instead.' })
    await Promise.resolve()
    expect(dispatch).not.toHaveBeenCalled()
    expect(records.has(draft.id)).toBe(false)
    release()
    await sending
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(records.get(draft.id)?.messages).toHaveLength(3)
    expect(records.get(draft.id)?.messages.at(-1)?.content).toBe('Explore the private pilot instead.')
    expect(records.get(draft.id)?.messages[0].attachments?.[0].base64).toBeUndefined()
    expect(records.get(source.id)).toBe(source)
    expect(useChatStore.getState().draftConversationIds.has(draft.id)).toBe(false)
  })

  it('does not dispatch or damage the source if saving the new branch fails', async () => {
    const draft = branch()
    saveRecord.mockRejectedValue(new Error('disk full'))
    const dispatch = jest.fn(async () => undefined)
    await expect(sender(dispatch).send({ conversation: draft, content: 'Try another direction.' })).rejects.toThrow('disk full')
    expect(dispatch).not.toHaveBeenCalled()
    expect(records.has(draft.id)).toBe(false)
    expect(records.get(source.id)).toBe(source)
    expect(useChatStore.getState().conversations.find(record => record.id === source.id)).toBe(source)
  })
})
