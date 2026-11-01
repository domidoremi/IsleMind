import { createConversationAssistantMessageProjectionPolicy } from './conversationAssistantMessageProjection'

describe('conversation assistant message projection identity', () => {
  it('retains partial answer text and provider usage on failed or incomplete streams', () => {
    const buildEstimatedUsage = jest.fn(() => ({ source: 'estimated' as const, outputTokens: 99 }))
    const policy = createConversationAssistantMessageProjectionPolicy({
      buildEstimatedUsage, estimateTextTokens: () => 99,
    })
    const plan = policy.buildFailurePlan({
      conversation: { messages: [] },
      message: { id: 'partial', role: 'assistant', content: 'Already shown answer',
        timestamp: 1, status: 'streaming', startedAt: 1 },
      content: 'The provider stopped at its output limit.',
      errorCode: 'max_tokens_exceeded', providerId: 'provider', completedAt: 10,
      providerUsage: { source: 'provider', inputTokens: 12, outputTokens: 4 },
    })
    expect(plan.messagePatch).toMatchObject({
      status: 'error', content: 'Already shown answer', responseText: 'Already shown answer',
      usage: { source: 'provider', inputTokens: 12, outputTokens: 4 },
      tokenCount: 4, estimatedTokens: false, errorCode: 'max_tokens_exceeded',
    })
    expect(plan.taskCompletion.error).toBe('The provider stopped at its output limit.')
    expect(buildEstimatedUsage).not.toHaveBeenCalled()
  })

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
