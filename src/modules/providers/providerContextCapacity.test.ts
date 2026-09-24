import { checkProviderContextCapacity } from './providerContextCapacity'

test('accounts for assembled tool schemas and output, even without history compression', () => {
  const body = { messages: [{ role: 'user', content: 'hello' }], max_tokens: 100 }
  expect(checkProviderContextCapacity({ body, contextWindow: 1000, defaultOutputTokens: 100 }).limit).toBe(850)
  expect(() => checkProviderContextCapacity({ body: { ...body, tools: [{ description: 'word '.repeat(1000) }] }, contextWindow: 1000, defaultOutputTokens: 100 })).toThrow('context_capacity')
})

test('does not invent a minimum budget when output consumes the window', () => {
  expect(() => checkProviderContextCapacity({ body: { max_tokens: 900 }, contextWindow: 1000, defaultOutputTokens: 100 })).toThrow('context_capacity')
})

test('does not estimate base64 as natural language or double count thinking output', () => {
  const result = checkProviderContextCapacity({ body: { messages: [{ content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'a'.repeat(100_000) } }] }], max_tokens: 1000, thinking: { budget_tokens: 500 } }, providerType: 'openai', model: 'gpt-4o', contextWindow: 100_000, defaultOutputTokens: 1000 })
  expect(result.reservedOutputTokens).toBe(1000)
  expect(result.estimatedInputTokens).toBeLessThan(25_000)
  expect(result.mediaEstimated).toBe(true)
})

test('image accounting follows model rules and unknown binary media does not silently become free text', () => {
  const body = { messages: [{ content: [{ type: 'image_url', image_url: { url: 'https://example.invalid/image.png' } }] }], max_tokens: 100 }
  const mini = checkProviderContextCapacity({ body, providerType: 'openai', model: 'gpt-4o-mini', contextWindow: 128_000, defaultOutputTokens: 100 })
  expect(mini.estimatedInputTokens).toBeGreaterThanOrEqual(48_169)
  expect(() => checkProviderContextCapacity({ body, providerType: 'openai-compatible', model: 'unknown', contextWindow: 128_000, defaultOutputTokens: 100 })).toThrow('media_estimate_unavailable')
  const audio = { messages: [{ content: [{ type: 'input_audio', input_audio: { data: 'AAAA', format: 'wav' } }] }] }
  expect(() => checkProviderContextCapacity({ body: audio, contextWindow: 128_000, defaultOutputTokens: 100 })).toThrow('media_estimate_unavailable')
})

test('rejects invalid limits and oversized strings before estimating', () => {
  expect(() => checkProviderContextCapacity({ body: {}, contextWindow: NaN, defaultOutputTokens: 1 })).toThrow('invalid_capacity')
  expect(() => checkProviderContextCapacity({ body: { text: 'x'.repeat(4 * 1024 * 1024 + 1) }, contextWindow: 1_000_000, defaultOutputTokens: 1 })).toThrow('request_too_large')
})

test('media-shaped tool JSON cannot hide large text from the final guard', () => {
  expect(() => checkProviderContextCapacity({ body: { tools: [{ input: { type: 'image_url', image_url: { url: 'word '.repeat(10000) } } }] }, contextWindow: 1000, defaultOutputTokens: 1 })).toThrow('context_capacity')
})
