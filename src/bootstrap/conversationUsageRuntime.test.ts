import { attributeConversationUsageRequest } from './conversationUsageRuntime'
import type { ProviderRuntimeChatRequest } from '@/modules/providers'
import type { Conversation, Message } from '@/types/chatContracts'

let mockConversations: Conversation[]
let mockSequence = 0
const mockUpdateMessage = jest.fn()
jest.mock('@/store/chatStore', () => ({ useChatStore: { getState: () => ({
  conversations: mockConversations, updateMessage: mockUpdateMessage,
}) } }))
jest.mock('@/modules/conversations', () => jest.requireActual('@/modules/conversations/application/messageUsageExecution'))
jest.mock('./usageExecutionIdentity', () => ({ nextUsageExecutionId: (prefix: string) => `${prefix}-${++mockSequence}` }))

function request(): ProviderRuntimeChatRequest {
  return { provider: { id: 'provider' }, model: 'model', conversationId: 'conversation',
    messages: [{ role: 'user', content: 'Question' }], generationParameterSources: {},
  } as ProviderRuntimeChatRequest
}
function message(id: string, role: Message['role'] = 'assistant'): Message {
  return { id, role, content: '', timestamp: 1, status: 'streaming' }
}
beforeEach(() => {
  mockSequence = 0
  mockConversations = [{ id: 'conversation', messages: [message('user', 'user'), message('answer'), message('newer-answer')] },
    { id: 'other-conversation', messages: [message('answer')] }] as Conversation[]
  mockUpdateMessage.mockReset().mockImplementation((conversationId, messageId, patch) => {
    const target = mockConversations.find(item => item.id === conversationId)?.messages.find(item => item.id === messageId)
    if (target) Object.assign(target, patch)
  })
})

it('binds the exact response, keeps the route receipt and replaces unrelated execution identity', () => {
  const original = request()
  const routingPlan = { id: 'plan', name: 'Reviewed route', primaryProviderId: 'primary', primaryModel: 'preferred' }
  original.usageContext = { source: 'chat', correlationId: 'correlation', runId: 'run', execution: {
    schema: 'islemind.request-execution.v1', logicalRequestId: 'unlinked-request', requestStartedAt: 1,
    responseExecutionId: 'unrelated-response', messageId: 'unrelated-message', parentRequestId: 'unrelated-parent', routingPlan,
  } }
  const result = attributeConversationUsageRequest(original, 'conversation', 'answer')
  expect(mockUpdateMessage).toHaveBeenCalledTimes(1)
  expect(mockUpdateMessage).toHaveBeenCalledWith('conversation', 'answer', { usageExecution: {
    schema: 'islemind.message-usage-reference.v1', responseExecutionId: 'response-1', requestIds: ['request-2'],
  } })
  expect(result.usageContext).toEqual({ source: 'chat', correlationId: 'correlation', runId: 'run', execution: {
    schema: 'islemind.request-execution.v1', logicalRequestId: 'request-2', requestStartedAt: expect.any(Number),
    responseExecutionId: 'response-1', messageId: 'answer', routingPlan,
  } })
  expect(result.usageContext?.execution?.routingPlan).not.toBe(routingPlan)
  expect(original.usageContext.execution?.logicalRequestId).toBe('unlinked-request')
  expect(mockConversations[0].messages[2].usageExecution).toBeUndefined()
  expect(mockConversations[1].messages[0].usageExecution).toBeUndefined()
})

it('adds continuation requests to the same response with the previous request as parent', () => {
  const first = attributeConversationUsageRequest(request(), 'conversation', 'answer')
  const next = attributeConversationUsageRequest(request(), 'conversation', 'answer', 'tool-continuation')
  expect(next.usageContext).toMatchObject({ source: 'tool-continuation', execution: {
    responseExecutionId: first.usageContext!.execution!.responseExecutionId,
    logicalRequestId: 'request-3', parentRequestId: 'request-2', messageId: 'answer',
  } })
  expect(mockConversations[0].messages[1].usageExecution?.requestIds).toEqual(['request-2', 'request-3'])
})

it.each(['missing-conversation', 'missing-message', 'user', 'cancelled', 'mismatched-conversation'])('does not fabricate attribution for %s', kind => {
  const original = request()
  const controller = new AbortController()
  if (kind === 'cancelled') { controller.abort(); original.signal = controller.signal }
  if (kind === 'mismatched-conversation') original.conversationId = 'other-conversation'
  const result = attributeConversationUsageRequest(original,
    kind === 'missing-conversation' ? 'missing' : 'conversation',
    kind === 'missing-message' ? 'missing' : kind === 'user' ? 'user' : 'answer')
  expect(result).toBe(original)
  expect(mockUpdateMessage).not.toHaveBeenCalled()
})
