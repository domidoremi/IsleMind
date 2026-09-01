import type { AIModel } from '@/types/providerContracts'
import {
  modelCapabilityIsSupported,
  modelParameterIsSupported,
  resolveModelCapabilityProfile,
} from './modelCapabilityPolicy'

function model(overrides: Partial<AIModel> = {}): AIModel {
  return {
    id: 'example-model',
    name: 'Example Model',
    provider: 'openai-compatible',
    contextWindow: 32_768,
    maxTokens: 32_768,
    maxOutputTokens: 4_096,
    defaultMaxTokens: 2_048,
    supportsVision: false,
    supportsFiles: false,
    source: 'inferred',
    ...overrides,
  }
}

describe('model capability profile', () => {
  it('keeps inferred provider defaults unknown while retaining their numeric hint', () => {
    const profile = resolveModelCapabilityProfile(model({
      supportsVision: true,
      supportsFiles: true,
    }))

    expect(profile.limits.contextWindow).toMatchObject({ value: 32_768, confidence: 'inferred' })
    expect(profile.features.vision.support).toBe('unknown')
    expect(profile.inputModalities.file.support).toBe('unknown')
    expect(modelCapabilityIsSupported(profile, 'vision')).toBe(false)
    expect(modelParameterIsSupported(profile, 'temperature')).toBe(false)
  })

  it('records source-backed catalog capabilities and reasoning metadata', () => {
    const profile = resolveModelCapabilityProfile(model({
      id: 'documented-model',
      source: 'built-in',
      sourceUrl: 'https://provider.example/models/documented-model',
      verifiedAt: '2026-08-01',
      supportsVision: true,
      supportsFiles: false,
      supportsTools: true,
      supportsStreaming: false,
      reasoningMode: 'anthropic-thinking',
      reasoningEfforts: ['low', 'high'],
    }))

    expect(profile.features.vision.support).toBe('supported')
    expect(profile.features.toolCalling.support).toBe('supported')
    expect(profile.features.streaming.support).toBe('unsupported')
    expect(profile.reasoning).toMatchObject({
      support: 'supported',
      mode: 'anthropic-thinking',
      efforts: ['low', 'high'],
    })
    expect(profile.parameters.reasoningEffort.support).toBe('supported')
    expect(profile.parameters.thinkingBudget.support).toBe('supported')
  })

  it('treats an explicit supported-parameter list as a closed model-level declaration', () => {
    const profile = resolveModelCapabilityProfile(model({
      source: 'remote',
      supportedParameters: [
        'temperature',
        'max_output_tokens',
        'frequency_penalty',
        'text.format',
      ],
    }))

    expect(profile.parameters.temperature.support).toBe('supported')
    expect(profile.parameters.maxTokens.support).toBe('supported')
    expect(profile.parameters.frequencyPenalty.support).toBe('supported')
    expect(profile.parameters.responseFormat.support).toBe('supported')
    expect(profile.parameters.topP.support).toBe('unsupported')
    expect(profile.parameters.seed.support).toBe('unsupported')
    expect(profile.features.structuredOutput.support).toBe('supported')
    expect(profile.features.audioInput.support).toBe('unknown')
  })
})
