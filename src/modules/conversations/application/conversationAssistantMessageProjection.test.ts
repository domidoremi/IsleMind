import { createConversationAssistantMessageProjectionPolicy } from './conversationAssistantMessageProjection'

describe('conversation assistant message projection identity', () => {
  it('projects the provider and model that actually completed the response', () => {
    const policy = createConversationAssistantMessageProjectionPolicy({
      buildEstimatedUsage: () => ({ source: 'estimated', outputTokens: 4, totalTokens: 7 }),
      estimateTextTokens: () => 4,
    })
    const outcome = policy.buildSuccessPlan({
      conversation: { messages: [] },
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 1,
        status: 'streaming',
        startedAt: 1,
      },
      outputText: 'done',
      citations: [],
      providerId: 'anthropic-fallback',
      model: 'claude-sonnet-4-5',
      completedAt: 10,
    })

    expect(outcome.kind).toBe('project')
    if (outcome.kind !== 'project') return
    expect(outcome.messagePatch).toEqual(expect.objectContaining({
      providerId: 'anthropic-fallback',
      model: 'claude-sonnet-4-5',
    }))
  })
})
