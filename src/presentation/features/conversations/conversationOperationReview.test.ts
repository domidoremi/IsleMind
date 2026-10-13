import { confirmConversationAction } from './conversationMessageActionCommand'
import { useChatStore } from '@/store/chatStore'
import type { AssistantRun } from '@/modules/assistant-runtime'
import type { Conversation } from '@/types/chatContracts'

const mockLatest = jest.fn()
const mockResume = jest.fn()
jest.mock('./conversationMessageRuntimeBinding', () => ({
  getLatestConversationResponseRunRuntime: (...args: unknown[]) => mockLatest(...args),
  resumePendingConversationModelOperationRuntime: (...args: unknown[]) => mockResume(...args),
}))
const previous = useChatStore.getState()
const conversation: Conversation = {
  id: 'conversation', title: 'Fixture', providerId: 'fixture', model: 'fixture-model', systemPrompt: '',
  temperature: 0, maxTokens: 128, createdAt: 1, updatedAt: 1,
  messages: [{ id: 'response', role: 'assistant', content: '', status: 'done', timestamp: 1,
    reasoning: [{ id: 'pending', type: 'system', title: 'Pending', content: '', status: 'pending', startedAt: 1,
      metadata: { pendingModelOperationRunId: 'run' } }] }],
}
const run = {
  id: 'run', status: 'awaiting-confirmation',
  pendingModelOperation: { continuationToken: 'reviewed-token', continuationDigest: 'reviewed-digest' },
} as AssistantRun
beforeEach(() => {
  jest.clearAllMocks()
  useChatStore.setState({ conversations: [conversation] })
  mockLatest.mockResolvedValue(run)
  mockResume.mockResolvedValue(true)
})
afterEach(() => useChatStore.setState(previous, true))

it('requires an actual preview decision before resuming a pending operation', async () => {
  expect(await confirmConversationAction('conversation', 'response')).toBe(false)
  expect(await confirmConversationAction('conversation', 'response', async () => false)).toBe(false)
  expect(mockResume).not.toHaveBeenCalled()
})
it.each(['reasoning', 'toolCalls', 'retrievalTrace'] as const)('finds the durable review identity in %s even while the message remains unfinished', async key => {
  const message = conversation.messages[0]
  useChatStore.setState({ conversations: [{ ...conversation, messages: [{ ...message,
    status: 'streaming', reasoning: [], [key]: message.reasoning,
  }] }] })
  expect(await confirmConversationAction('conversation', 'response', async () => true)).toBe(true)
  expect(mockResume).toHaveBeenCalledWith('conversation', 'response', 'run', true,
    { continuationToken: 'reviewed-token', continuationDigest: 'reviewed-digest' })
})
it('passes the reviewed identity, not a newer pending identity, through approval', async () => {
  await confirmConversationAction('conversation', 'response', async preview => {
    expect(preview).toBe(run)
    mockLatest.mockResolvedValue({ ...run, pendingModelOperation: { continuationToken: 'new-token', continuationDigest: 'new-digest' } })
    return true
  })
  expect(mockResume).toHaveBeenCalledWith('conversation', 'response', 'run', true,
    { continuationToken: 'reviewed-token', continuationDigest: 'reviewed-digest' })
})
it('submits a refusal only for an explicit decline, not for closing the preview', async () => {
  await confirmConversationAction('conversation', 'response', async () => 'decline')
  expect(mockResume).toHaveBeenCalledWith('conversation', 'response', 'run', false,
    { continuationToken: 'reviewed-token', continuationDigest: 'reviewed-digest' })
})
