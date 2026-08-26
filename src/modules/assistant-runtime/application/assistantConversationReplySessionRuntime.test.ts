import { createAssistantConversationReplySessionRuntime } from './assistantConversationReplySessionRuntime'

describe('assistant conversation reply session identity', () => {
  it('captures the selected provider and model on the durable assistant placeholder', async () => {
    const appended: unknown[] = []
    const runtime = createAssistantConversationReplySessionRuntime({
      stopConversationMessage: jest.fn(),
      getConversation: () => ({ providerId: 'openai-primary', model: 'gpt-5.2' }),
      now: () => 42,
      generateId: () => 'assistant-1',
      appendMessage: (_conversationId, message) => {
        appended.push(message)
      },
      startConversationTaskActivity: jest.fn(),
      setStreaming: jest.fn(),
      createRequestController: () => new AbortController(),
      setActiveStream: jest.fn(),
    })

    await runtime.start({ conversationId: 'conversation-1' })

    expect(appended).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        providerId: 'openai-primary',
        model: 'gpt-5.2',
      }),
    ])
  })
})
