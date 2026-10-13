import { checkProviderContextCapacity, MAX_PROVIDER_REQUEST_CODE_UNITS } from './providerContextCapacity'
import { buildAnthropicAttachmentPart, buildGoogleAttachmentPart, buildOpenAIChatAttachmentPart, buildOpenAIResponsesAttachmentPart } from './providerAttachments'

test('missing or non-positive output bounds cannot pass admission', () => {
  for (const body of [{}, { max_tokens: 0 }, { max_output_tokens: -1 }]) {
    expect(() => checkProviderContextCapacity({ body, contextWindow: 1000 })).toThrow('invalid_capacity')
  }
  expect(checkProviderContextCapacity({ body: {}, contextWindow: 1000, modelMaxOutputTokens: 500 }).reservedOutputTokens).toBe(500)
})

test('accounts for assembled tool schemas and output, even without history compression', () => {
  const body = { messages: [{ role: 'user', content: 'hello' }], max_tokens: 100 }
  expect(checkProviderContextCapacity({ body, contextWindow: 1000, modelMaxOutputTokens: 100 }).limit).toBe(850)
  expect(() => checkProviderContextCapacity({ body: { ...body, tools: [{ description: 'word '.repeat(1000) }] }, contextWindow: 1000, modelMaxOutputTokens: 100 })).toThrow('context_capacity')
})

test('does not invent a minimum budget when output consumes the window', () => {
  expect(() => checkProviderContextCapacity({ body: { max_tokens: 900 }, contextWindow: 1000, modelMaxOutputTokens: 100 })).toThrow('context_capacity')
})

test('does not estimate base64 as natural language or double count thinking output', () => {
  const result = checkProviderContextCapacity({ body: { messages: [{ content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'a'.repeat(100_000) } }] }], max_tokens: 1000, thinking: { budget_tokens: 500 } }, providerType: 'openai', model: 'gpt-4o', contextWindow: 100_000, modelMaxOutputTokens: 1000 })
  expect(result.reservedOutputTokens).toBe(1000)
  expect(result.estimatedInputTokens).toBeLessThan(25_000)
  expect(result.mediaEstimated).toBe(true)
})

test('image accounting follows model rules and unknown binary media does not silently become free text', () => {
  const body = { messages: [{ content: [{ type: 'image_url', image_url: { url: 'https://example.invalid/image.png' } }] }], max_tokens: 100 }
  const mini = checkProviderContextCapacity({ body, providerType: 'openai', model: 'gpt-4o-mini', contextWindow: 128_000, modelMaxOutputTokens: 100 })
  expect(mini.estimatedInputTokens).toBeGreaterThanOrEqual(48_169)
  expect(() => checkProviderContextCapacity({ body, providerType: 'openai-compatible', model: 'unknown', contextWindow: 128_000, modelMaxOutputTokens: 100 })).toThrow('media_estimate_unavailable')
  const audio = { messages: [{ content: [{ type: 'input_audio', input_audio: { data: 'AAAA', format: 'wav' } }] }] }
  expect(() => checkProviderContextCapacity({ body: audio, contextWindow: 128_000, modelMaxOutputTokens: 100 })).toThrow('media_estimate_unavailable')
})

test('rejects invalid limits and oversized strings before estimating', () => {
  expect(() => checkProviderContextCapacity({ body: {}, contextWindow: NaN, modelMaxOutputTokens: 1 })).toThrow('invalid_capacity')
  expect(() => checkProviderContextCapacity({ body: { text: 'x'.repeat(4 * 1024 * 1024 + 1) }, contextWindow: 1_000_000, modelMaxOutputTokens: 1 })).toThrow('request_too_large')
})

test('media-shaped tool JSON cannot hide large text from the final guard', () => {
  expect(() => checkProviderContextCapacity({ body: { tools: [{ input: { type: 'image_url', image_url: { url: 'word '.repeat(10000) } } }] }, contextWindow: 1000, modelMaxOutputTokens: 1 })).toThrow('context_capacity')
})

test.each(['google', 'openai-chat', 'openai-responses', 'anthropic', 'perplexity'] as const)(
  'actual %s attachment serialization cannot bypass unmeasured PDF admission', protocol => {
    const attachment = { type: 'pdf' as const, name: 'synthetic.pdf', mimeType: 'application/pdf', base64: 'JVBERi0xLjQKJUVPRgo=' }
    const part = protocol === 'google' ? buildGoogleAttachmentPart(attachment)
      : protocol === 'anthropic' ? buildAnthropicAttachmentPart(attachment)
      : protocol === 'openai-responses' ? buildOpenAIResponsesAttachmentPart(attachment)
      : buildOpenAIChatAttachmentPart(protocol === 'perplexity' ? { ...attachment, base64: 'https://files.example.invalid/synthetic.pdf' } : attachment,
        protocol === 'perplexity' ? 'url' : 'inline')
    const body = protocol === 'google' ? { contents: [{ role: 'user', parts: [part] }], generationConfig: { maxOutputTokens: 100 } }
      : protocol === 'openai-responses' ? { input: [{ role: 'user', content: [part] }], max_output_tokens: 100 }
      : { messages: [{ role: 'user', content: [part] }], max_tokens: 100 }
    expect(() => checkProviderContextCapacity({ body, contextWindow: 128_000, providerType: protocol === 'google' ? 'google' : 'openai', model: 'gpt-4o' }))
      .toThrow('media_estimate_unavailable')
  },
)

test('actual Google image serialization uses media accounting, not base64 text length', () => {
  const part = buildGoogleAttachmentPart({ type: 'image', name: 'synthetic.png', mimeType: 'image/png', base64: 'AAAA' })
  const result = checkProviderContextCapacity({ body: { contents: [{ role: 'user', parts: [part] }], generationConfig: { maxOutputTokens: 100 } },
    contextWindow: 128_000, providerType: 'google', model: 'gemini-3-pro-preview' })
  expect(result.mediaEstimated).toBe(true)
  expect(result.rawInputTokens).toBeGreaterThanOrEqual(1120)
})

test.each(['inlineData', 'inline_data', 'fileData', 'file_data'])(
  'Google %s aliases reject unmeasured media and account for images', key => {
    const field = key.includes('_') ? 'mime_type' : 'mimeType'
    const check = (mime: string) => checkProviderContextCapacity({
      body: { contents: [{ parts: [{ [key]: { [field]: mime, data: 'AAAA', fileUri: 'https://example.invalid/media' } }] }], max_tokens: 100 },
      contextWindow: 128_000, providerType: 'google', model: 'gemini-3-pro-preview',
    })
    for (const mime of ['application/pdf', 'audio/wav', 'video/mp4', 'application/octet-stream']) {
      expect(() => check(mime)).toThrow('media_estimate_unavailable')
    }
    expect(check('image/png')).toMatchObject({ mediaEstimated: true })
    expect(check('image/png').rawInputTokens).toBeGreaterThanOrEqual(1120)
  },
)

test('media payload strings remain size bounded without becoming text tokens', () => {
  const data = 'a'.repeat(5 * 1024 * 1024)
  const image = (url: string) => ({ type: 'image_url', image_url: { url } })
  const check = (parts: unknown[]) => checkProviderContextCapacity({
    body: { messages: [{ content: parts }], max_tokens: 100 },
    contextWindow: 128_000, providerType: 'openai', model: 'gpt-4o',
  })
  const small = check([image('data:image/png;base64,AAAA')])
  const large = check([image('data:image/png;base64,' + data)])
  expect(large.rawInputTokens).toBe(small.rawInputTokens)
  expect(large.managedTextBytes).toBe(small.managedTextBytes)
  expect(() => check([image('a'.repeat(MAX_PROVIDER_REQUEST_CODE_UNITS + 1))])).toThrow('request_too_large')
  expect(() => check(Array.from({ length: 4 }, () => image(data)))).toThrow('request_too_large')
  // Opaque does not mean unbounded: JSON escaping is also part of wire size.
  expect(() => check([image('\u0000'.repeat(3 * 1024 * 1024))])).toThrow('request_too_large')
})

test('media traversal still enforces depth, node and metadata limits', () => {
  const check = (metadata: unknown) => checkProviderContextCapacity({
    body: { messages: [{ content: [{ type: 'image_url', image_url: { url: 'https://example.invalid/image' }, metadata }] }], max_tokens: 100 },
    contextWindow: 128_000, providerType: 'openai', model: 'gpt-4o',
  })
  let deep: unknown = 'leaf'
  for (let i = 0; i < 32; i++) deep = { child: deep }
  expect(() => check(deep)).toThrow('request_too_large')
  expect(() => check(Array(100_001).fill(null))).toThrow('request_too_large')
  expect(() => check({ ['k'.repeat(4 * 1024 * 1024 + 1)]: 'value' })).toThrow('request_too_large')
  expect(() => check('word '.repeat(100_000))).toThrow('context_capacity')
  const getter = jest.fn(() => 'unsafe')
  expect(() => check(Object.defineProperty({}, 'text', { enumerable: true, get: getter }))).toThrow('request_too_large')
  expect(getter).not.toHaveBeenCalled()
})

test('forged media paths and nested tool parameters cannot hide text tokens', () => {
  const media = { type: 'image_url', image_url: { url: 'word '.repeat(10_000) } }
  for (const body of [
    { 'messages.0.content.0': media },
    { messages: { 0: { content: { 0: media } } } },
    { messages: [{ content: [{ type: 'tool_use', input: media }] }] },
    { contents: [{ parts: [{ functionCall: { args: { inline_data: { mime_type: 'image/png', data: 'word '.repeat(10_000) } } } }] }] },
  ]) {
    expect(() => checkProviderContextCapacity({ body, contextWindow: 1000, modelMaxOutputTokens: 1,
      providerType: 'openai', model: 'gpt-4o' })).toThrow('context_capacity')
  }
})

test('an image bound cannot cover an additional unmeasured payload in the same part', () => {
  expect(() => checkProviderContextCapacity({ body: { contents: [{ parts: [{
    inlineData: { mimeType: 'image/png', data: 'AAAA' }, file_data: { mime_type: 'application/pdf', file_uri: 'https://example.invalid/file' },
  }] }], max_tokens: 100 }, contextWindow: 128_000, providerType: 'google', model: 'gemini-3-pro-preview' }))
    .toThrow('media_estimate_unavailable')
})

test('conflicting Google MIME aliases cannot spend an image allowance on PDF or audio', () => {
  for (const key of ['inlineData', 'inline_data', 'fileData', 'file_data']) {
    for (const mime of ['application/pdf', 'audio/wav']) {
      expect(() => checkProviderContextCapacity({
        body: { contents: [{ parts: [{ [key]: { mimeType: 'image/png', mime_type: mime, data: 'AAAA' } }] }], max_tokens: 100 },
        contextWindow: 128_000, providerType: 'google', model: 'gemini-3-pro-preview',
      })).toThrow('media_estimate_unavailable')
    }
  }
})
