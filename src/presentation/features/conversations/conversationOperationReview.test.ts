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
const conversationFixture: Conversation = {
  id: 'conversation', title: 'Fixture', providerId: 'fixture', model: 'fixture-model', systemPrompt: '',
  temperature: 0, maxTokens: 128, createdAt: 1, updatedAt: 1,
  messages: [{ id: 'response', role: 'assistant', content: '', status: 'done', timestamp: 1,
    reasoning: [{ id: 'pending', type: 'system', title: 'Pending', content: '', status: 'pending', startedAt: 1,
      metadata: { pendingModelOperationRunId: 'run' } }] }],
}
const runFixture = {
  id: 'run', conversationId: 'conversation', responseMessageId: 'response', status: 'awaiting-confirmation',
  pendingModelOperation: { continuationToken: 'reviewed-token', continuationDigest: 'reviewed-digest' },
} as AssistantRun
let conversation: Conversation
let run: AssistantRun
beforeEach(() => {
  jest.clearAllMocks()
  conversation = JSON.parse(JSON.stringify(conversationFixture))
  run = JSON.parse(JSON.stringify(runFixture))
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

it.each([true, 'decline'] as const)('captures primitive reviewed identity before a mutable preview resolves (%s)', async decision => {
  await confirmConversationAction('conversation', 'response', async preview => {
    expect(preview).toBe(run)
    Object.assign(preview.pendingModelOperation!, {
      continuationToken: 'unreviewed-token', continuationDigest: 'unreviewed-digest',
    })
    return decision
  })
  expect(mockResume).toHaveBeenCalledWith('conversation', 'response', 'run', decision === true,
    { continuationToken: 'reviewed-token', continuationDigest: 'reviewed-digest' })
})

const messageChanges: [string, () => void][] = [
  ['removed conversation', () => useChatStore.setState({ conversations: [] })],
  ['removed response', () => { conversation.messages = [] }],
  ['cancelled response', () => { conversation.messages[0].status = 'cancelled' }],
  ['replaced role', () => { conversation.messages[0].role = 'user' }],
  ['newer run marker', () => { conversation.messages[0].reasoning![0].metadata!.pendingModelOperationRunId = 'new-run' }],
  ['newer turn', () => { conversation.messages.push({ id: 'new-user', role: 'user', content: 'New request', status: 'done', timestamp: 2 }) }],
  ['changed provider selection', () => { conversation.providerId = 'new-provider' }],
  ['changed model selection', () => { conversation.model = 'new-model' }],
  ['changed knowledge scope', () => { conversation.knowledgeSources = ['new-source'] }],
  ['changed system prompt', () => { conversation.systemPrompt = 'Unreviewed prompt' }],
]

it.each(messageChanges)('does not submit a decision after %s during review', async (_label, change) => {
  await expect(confirmConversationAction('conversation', 'response', async () => {
    change()
    return true
  })).resolves.toBe(false)
  expect(mockResume).not.toHaveBeenCalled()
})

it.each(messageChanges)('does not open a review after %s during durable lookup', async (_label, change) => {
  const review = jest.fn(async () => true)
  mockLatest.mockImplementationOnce(async () => { change(); return run })
  await expect(confirmConversationAction('conversation', 'response', review)).resolves.toBe(false)
  expect(review).not.toHaveBeenCalled()
  expect(mockResume).not.toHaveBeenCalled()
})

it('prevents overlapping preview submissions without replacing the original decision', async () => {
  const finishes: ((approved: boolean) => void)[] = []
  const review = jest.fn(() => new Promise<boolean>(resolve => { finishes.push(resolve) }))
  const first = confirmConversationAction('conversation', 'response', review)
  await Promise.resolve()
  const duplicate = confirmConversationAction('conversation', 'response', review)
  await Promise.resolve()
  await Promise.resolve()
  const reviewCount = review.mock.calls.length
  finishes.forEach(finish => finish(true))
  await expect(Promise.all([first, duplicate])).resolves.toEqual([true, false])
  expect(reviewCount).toBe(1)
  expect(mockResume).toHaveBeenCalledTimes(1)
})

it.each(['lookup', 'review'] as const)('does not resume after lifetime cancellation during %s', async boundary => {
  const lifetime = new AbortController()
  if (boundary === 'lookup') mockLatest.mockImplementationOnce(async () => { lifetime.abort(); return run })
  const review = jest.fn(async () => { lifetime.abort(); return true })
  await expect(confirmConversationAction('conversation', 'response', review, lifetime.signal)).resolves.toBe(false)
  if (boundary === 'lookup') expect(review).not.toHaveBeenCalled()
  expect(mockResume).not.toHaveBeenCalled()
})

it.each([true, 'decline'] as const)('retains the chat lifetime, not the explicit-decline dialog signal (%s)', async decision => {
  const lifetime = new AbortController()
  await expect(confirmConversationAction('conversation', 'response', async () => decision, lifetime.signal)).resolves.toBe(true)
  expect(mockResume).toHaveBeenCalledWith('conversation', 'response', 'run', decision === true,
    { continuationToken: 'reviewed-token', continuationDigest: 'reviewed-digest' }, lifetime.signal)
  expect(lifetime.signal.aborted).toBe(false)
})

it.each(['conversation', 'response'] as const)('rejects a durable run belonging to another %s before review', async owner => {
  const review = jest.fn(async () => true)
  mockLatest.mockResolvedValueOnce({ ...run,
    ...(owner === 'conversation' ? { conversationId: 'other' } : { responseMessageId: 'other' }),
  })
  await expect(confirmConversationAction('conversation', 'response', review)).resolves.toBe(false)
  expect(review).not.toHaveBeenCalled()
  expect(mockResume).not.toHaveBeenCalled()
})
