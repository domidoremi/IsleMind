import { getModelConfig } from './modelCatalog'

describe('current provider model catalog', () => {
  it.each(['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'])(
    '%s exposes the current documented DeepSeek effort levels', (id) => {
      // https://api-docs.deepseek.com/guides/thinking_mode/
      expect(getModelConfig(id, 'openai-compatible').reasoningEfforts).toEqual(['none', 'low', 'high', 'max'])
    },
  )

  it.each(['claude-opus-4-6', 'claude-sonnet-4-6'])('%s offers only documented effort levels and synchronous output limits', (id) => {
    // https://platform.claude.com/docs/en/build-with-claude/effort
    // The 4.6 model pages specify 128K sync output, not the 300K batch-only beta.
    expect(getModelConfig(id, 'anthropic')).toMatchObject({
      maxOutputTokens: 128000,
      defaultMaxTokens: 8192,
      reasoningEfforts: ['none', 'low', 'medium', 'high', 'max'],
      deprecated: false,
    })
  })

  it('offers explicit thinking off only for Claude 5 models that allow it', () => {
    for (const id of ['claude-opus-5', 'claude-sonnet-5']) {
      expect(getModelConfig(id, 'anthropic').reasoningEfforts).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
    }
    expect(getModelConfig('claude-fable-5-1', 'anthropic').reasoningEfforts).not.toContain('none')
  })

  it('keeps the old DeepSeek Flash alias deprecated but exposes its current vision capability', () => {
    expect(getModelConfig('deepseek-v4-flash', 'openai-compatible')).toMatchObject({
      deprecated: true, supportsVision: true, contextWindow: 1000000, maxOutputTokens: 384000,
    })
    expect(getModelConfig('deepseek-v4-pro', 'openai-compatible')).toMatchObject({ deprecated: false, supportsVision: false })
  })

  it('contains the current official flagship entries', () => {
    expect(getModelConfig('gpt-6-astra', 'openai')).toMatchObject({
      contextWindow: 1050000,
      maxOutputTokens: 128000,
      preferredEndpoint: 'responses',
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    })
    expect(getModelConfig('gpt-5.6-sol', 'openai')).toMatchObject({
      contextWindow: 1050000,
      maxOutputTokens: 128000,
      preferredEndpoint: 'responses',
    })
    expect(getModelConfig('claude-fable-5-1', 'anthropic')).toMatchObject({
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      reasoningMode: 'anthropic-thinking',
      supportsVision: true,
    })
    expect(getModelConfig('gemini-3.8-flash', 'google')).toMatchObject({
      contextWindow: 1048576,
      maxOutputTokens: 65536,
      reasoningMode: 'gemini-thinking-level',
      reasoningEfforts: ['low', 'medium', 'high'],
    })
    expect(getModelConfig('deepseek-flash', 'openai-compatible')).toMatchObject({
      contextWindow: 1000000,
      maxOutputTokens: 384000,
      supportsVision: true,
      reasoningMode: 'deepseek-thinking',
    })
    expect(getModelConfig('claude-opus-5', 'anthropic')).toMatchObject({
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      supportsVision: true,
    })
    expect(getModelConfig('gemini-3.6-flash', 'google')).toMatchObject({
      contextWindow: 1048576,
      supportsTools: true,
    })
    expect(getModelConfig('deepseek-v4-flash-vision-exp', 'openai-compatible')).toMatchObject({
      supportsVision: true,
      deprecated: true,
    })
    expect(getModelConfig('kimi-k3', 'openai-compatible')).toMatchObject({
      contextWindow: 1000000,
      reasoningMode: 'openai-effort',
      reasoningEfforts: ['low', 'high', 'max'],
    })
    expect(getModelConfig('grok-4.6', 'openai-compatible')).toMatchObject({
      contextWindow: 500000,
      supportsVision: true,
    })
    expect(getModelConfig('gemma-4-31b', 'openai-compatible')).toMatchObject({
      contextWindow: 131000,
      maxOutputTokens: 40000,
      supportsVision: true,
    })
    expect(getModelConfig('gpt-5.6-cyber', 'openai')).toMatchObject({
      contextWindow: 400000,
      maxOutputTokens: 128000,
      preferredEndpoint: 'responses',
    })
    expect(getModelConfig('gemini-3.7-flash', 'google')).toMatchObject({
      contextWindow: 1048576,
      maxOutputTokens: 65536,
      supportsVision: true,
    })
    expect(getModelConfig('gemini-3.1-flash-lite', 'google')).toMatchObject({
      contextWindow: 1048576,
      maxOutputTokens: 65536,
      reasoningMode: 'gemini-thinking-level',
    })
    expect(getModelConfig('gemini-3.1-flash-image', 'google')).toMatchObject({
      contextWindow: 131072,
      maxOutputTokens: 32768,
      chatCompatible: false,
    })
    expect(getModelConfig('gemini-2.0-flash', 'google')).toMatchObject({
      deprecated: true,
    })
    expect(getModelConfig('grok-code-fast-1', 'openai-compatible')).toMatchObject({
      contextWindow: 256000,
      reasoningMode: 'xai-reasoning-effort',
    })
    expect(getModelConfig('command-a-03-2025', 'openai-compatible')).toMatchObject({
      contextWindow: 256000,
      supportsVision: false,
    })
    expect(getModelConfig('glm-4.6v', 'openai-compatible')).toMatchObject({
      contextWindow: 128000,
      maxOutputTokens: 32000,
      supportsVision: true,
    })
    expect(getModelConfig('command-a-translate-08-2025', 'openai-compatible')).toMatchObject({
      contextWindow: 8192,
      maxOutputTokens: 8192,
    })
  })

  it('keeps retired compatibility IDs visible but deprecated', () => {
    expect(getModelConfig('deepseek-chat', 'openai-compatible').deprecated).toBe(true)
    expect(getModelConfig('kimi-k2-turbo-preview', 'openai-compatible').deprecated).toBe(true)
    expect(getModelConfig('mimo-v2-flash', 'xiaomi-mimo').deprecated).toBe(true)
    expect(getModelConfig('kimi-k2.5', 'openai-compatible').deprecated).toBe(true)
    expect(getModelConfig('moonshot-v1-128k', 'openai-compatible').deprecated).toBe(true)
    expect(getModelConfig('deepseek-v4-flash', 'openai-compatible').deprecated).toBe(true)
  })
})
