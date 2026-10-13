import { extractUsage } from './providerUsage'

test('compatible chat usage does not lose positive counters to zero Responses placeholders', () => {
  // Shape observed from the authorized Gemini-compatible live endpoint.
  expect(extractUsage({ usage: {
    prompt_tokens: 88, completion_tokens: 20, total_tokens: 108,
    input_tokens: 0, output_tokens: 0,
  } }, 'openai-compatible')).toMatchObject({ inputTokens: 88, outputTokens: 20, totalTokens: 108 })
})

test('overlapping aliases are not added or allowed to erase a larger observed count', () => {
  expect(extractUsage({ usage: {
    input_tokens: 12, prompt_tokens: 10, output_tokens: 3, completion_tokens: 4,
    input_tokens_details: { cached_tokens: 0 }, prompt_tokens_details: { cached_tokens: 5 },
    output_tokens_details: { reasoning_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 2 },
  } }, 'openai-compatible')).toMatchObject({ inputTokens: 12, outputTokens: 4, totalTokens: 16,
    cachedInputTokens: 5, reasoningTokens: 2 })
})

test('single protocol counters, genuine zeros and absent usage retain their meaning', () => {
  expect(extractUsage({ usage: { input_tokens: 5, output_tokens: 0 } }, 'openai')).toMatchObject({ inputTokens: 5, outputTokens: 0, totalTokens: 5 })
  expect(extractUsage({ usage: { prompt_tokens: 0, completion_tokens: 0 } }, 'openai-compatible')).toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  expect(extractUsage({}, 'openai-compatible')).toBeUndefined()
  expect(extractUsage({ usage: { input_tokens: -1, prompt_tokens: 7, output_tokens: NaN } }, 'openai-compatible')).toMatchObject({ inputTokens: 7, totalTokens: 7 })
  expect(extractUsage({ usage: { completion_tokens: 4, completion_tokens_details: { reasoning_tokens: 2 } } }, 'openai-compatible', { includeReasoning: false })).not.toHaveProperty('reasoningTokens')
})
