import { buildChatMessageEditPlan } from '../chatMessageEditState'
import type { Conversation, Message } from '@/types/chatContracts'

function message(id: string, role: Message['role'], content: string): Message {
  return {
    id,
    role,
    content,
    timestamp: 1,
    status: 'done',
  }
}

function conversation(messages: Message[]): Conversation {
  return {
    id: 'conversation-1',
    title: 'Test',
    providerId: 'provider-1',
    model: 'model-1',
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: 512,
    messages,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('buildChatMessageEditPlan', () => {
  it('keeps the earlier transcript and removes the edited turn plus all later replies', () => {
    const first = message('user-1', 'user', 'first')
    const edited = message('user-2', 'user', 'edit me')
    const reply = message('assistant-2', 'assistant', 'old reply')
    const plan = buildChatMessageEditPlan(conversation([first, edited, reply]), edited)

    expect(plan).toEqual({
      messageId: 'user-2',
      draft: { content: 'edit me', attachments: undefined },
      retainedMessages: [first],
      removedMessageIds: ['user-2', 'assistant-2'],
    })
  })

  it('rejects assistant messages and unknown message ids', () => {
    const user = message('user-1', 'user', 'hello')
    const assistant = message('assistant-1', 'assistant', 'reply')
    const current = conversation([user, assistant])

    expect(buildChatMessageEditPlan(current, assistant)).toBeNull()
    expect(buildChatMessageEditPlan(current, message('missing', 'user', 'missing'))).toBeNull()
  })
})
