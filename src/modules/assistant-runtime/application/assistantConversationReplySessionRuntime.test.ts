import { createAssistantConversationReplySessionRuntime } from './assistantConversationReplySessionRuntime'

describe('assistant conversation reply session identity', () => {
  it('leaves placeholder attribution unknown until evidence identifies the actual producing route', async () => {
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

    expect(appended).toEqual([{
      id: 'assistant-1', role: 'assistant', content: '', status: 'streaming',
      timestamp: 42, startedAt: 42,
    }])
    expect(appended[0]).not.toHaveProperty('providerId')
    expect(appended[0]).not.toHaveProperty('model')
    expect(appended[0]).not.toHaveProperty('generationProtocol')
  })
})
