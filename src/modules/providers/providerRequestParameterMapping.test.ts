import type { AIModel } from '@/types/providerContracts'
import { mapProviderRequestParameters } from './providerRequestParameterMapping'

function model(overrides: Partial<AIModel> = {}): AIModel {
  return {
    id: 'mapped-model',
    name: 'Mapped Model',
    provider: 'openai-compatible',
    contextWindow: 128_000,
    maxTokens: 128_000,
    maxOutputTokens: 8_192,
    defaultMaxTokens: 4_096,
    supportsVision: false,
    supportsFiles: false,
    source: 'remote',
    supportedParameters: [
      'temperature',
      'top_p',
      'max_tokens',
      'frequency_penalty',
      'stop',
      'seed',
      'response_format',
      'reasoning_effort',
    ],
    ...overrides,
  }
}

describe('provider request parameter mapping', () => {
  it('maps explicit OpenAI-compatible parameters and omits unsupported model fields', () => {
    const result = mapProviderRequestParameters({
      provider: { type: 'openai-compatible' },
      endpoint: 'openai-chat',
      model: model(),
      values: {
        temperature: 0.4,
        topP: 0.8,
        maxTokens: 512,
        frequencyPenalty: 0.2,
        presencePenalty: 0.3,
        stop: ['END'],
        seed: 7,
      },
    })

    expect(result.body).toEqual({
      temperature: 0.4,
      top_p: 0.8,
      max_tokens: 512,
      frequency_penalty: 0.2,
      stop: ['END'],
      seed: 7,
    })
    expect(result.entries.presencePenalty.reason).toBe('unsupported-model')
    expect(result.entries.topP.decision).toBe('included')
  })

  it('uses provider-specific nested paths for Anthropic and Google', () => {
    const anthropicModel = model({
      provider: 'anthropic',
      supportedParameters: ['max_tokens', 'top_k', 'stop_sequences', 'thinking_budget'],
    })
    const anthropic = mapProviderRequestParameters({
      provider: { type: 'anthropic' },
      endpoint: 'anthropic',
      model: anthropicModel,
      values: { maxTokens: 1024, topK: 32, stop: ['END'], thinkingBudget: 2048 },
    })
    expect(anthropic.body).toEqual({
      max_tokens: 1024,
      top_k: 32,
      stop_sequences: ['END'],
      thinking: { budget_tokens: 2048 },
    })

    const googleModel = model({
      provider: 'google',
      supportedParameters: ['temperature', 'stop_sequences', 'seed', 'response_format'],
    })
    const google = mapProviderRequestParameters({
      provider: { type: 'google' },
      endpoint: 'google',
      model: googleModel,
      values: {
        temperature: 0.2,
        stop: ['END'],
        seed: 42,
        responseFormat: { type: 'json_schema', schema: { type: 'object' } },
      },
    })
    expect(google.body).toEqual({
      generationConfig: {
        temperature: 0.2,
        stopSequences: ['END'],
        seed: 42,
        responseMimeType: 'application/json',
        responseSchema: { type: 'object' },
      },
    })
  })

  it('does not send unknown capabilities or endpoint-incompatible fields', () => {
    const result = mapProviderRequestParameters({
      provider: { type: 'openai' },
      endpoint: 'openai-responses',
      model: model({ supportedParameters: undefined }),
      values: { temperature: 0.7, topK: 10, maxTokens: 256 },
    })
    expect(result.body).toEqual({})
    expect(result.entries.temperature.reason).toBe('unknown-capability')
    expect(result.entries.topK.reason).toBe('unknown-capability')
  })

  it('requires a complete OpenAI JSON Schema and maps its nested chat shape', () => {
    const invalid = mapProviderRequestParameters({
      provider: { type: 'openai' },
      endpoint: 'openai-chat',
      model: model(),
      values: {
        responseFormat: { type: 'json_schema', schema: { type: 'object' } },
      },
    })
    expect(invalid.body).toEqual({})
    expect(invalid.entries.responseFormat.reason).toBe('invalid-value')

    const valid = mapProviderRequestParameters({
      provider: { type: 'openai' },
      endpoint: 'openai-chat',
      model: model(),
      values: {
        responseFormat: {
          type: 'json_schema',
          name: 'result',
          schema: { type: 'object' },
          strict: true,
        },
      },
    })
    expect(valid.body).toEqual({
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'result',
          schema: { type: 'object' },
          strict: true,
        },
      },
    })
  })
})
