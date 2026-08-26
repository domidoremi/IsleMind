import { getModelConfig } from './modelCatalog'

describe('current provider model catalog', () => {
  it('contains the current official flagship entries', () => {
    expect(getModelConfig('gpt-5.6-sol', 'openai')).toMatchObject({
      contextWindow: 1050000,
      maxOutputTokens: 128000,
      preferredEndpoint: 'responses',
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
      supportsVision: true,
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
  })
})
