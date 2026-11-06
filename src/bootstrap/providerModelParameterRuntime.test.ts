import type { AIProvider } from '@/types/providerContracts'
import type { ProviderRuntimeChatRequest } from '@/modules/providers'
import { resolveProviderModelParametersForDispatch } from './providerModelParameterRuntime'
import { providerRequestSerializer } from './providerRequestBinding'

function provider(id: string, outputLimit: number, override?: number): AIProvider {
  return {
    id, name: id, type: 'openai-compatible', baseUrl: 'https://budget-fixture.invalid/v1',
    apiKey: '', enabled: true, models: ['budget-fixture'],
    modelConfigs: [{
      id: 'budget-fixture', name: 'Budget fixture', provider: 'openai-compatible',
      source: 'remote', contextWindow: 32768, maxTokens: 32768,
      maxOutputTokens: outputLimit, defaultMaxTokens: 256,
      supportsVision: false, supportsFiles: false, chatCompatible: true,
      supportedParameters: ['max_tokens'],
    }],
    ...(override === undefined ? {} : {
      modelParameterOverrides: {
        schema: 'islemind.provider-model-parameters.v1' as const,
        models: { 'budget-fixture': { maxTokens: override } },
      },
    }),
  }
}

function request(): ProviderRuntimeChatRequest {
  return {
    provider: provider('first-connection', 1024, 8192),
    model: 'budget-fixture', requestedModel: 'budget-fixture',
    messages: [{ role: 'user', content: 'Check output reservation' }],
    maxTokens: 4096, generationParameterSources: { maxTokens: 'provider-default' },
  }
}

it('uses the same declared output bound for context reservation and wire serialization', () => {
  const caller = request()
  const effective = resolveProviderModelParametersForDispatch(caller)
  expect(effective.maxTokens).toBe(1024)
  expect(providerRequestSerializer.serialize(effective).body.max_tokens).toBe(effective.maxTokens)
  expect(effective.modelParameterBaseline?.values.maxTokens).toBe(4096)
  expect(caller.maxTokens).toBe(4096)
  expect(caller.generationParameterSources.maxTokens).toBe('provider-default')
})

it.each([false, true])('uses an alias target’s output bound exactly once (prepared: %s)', prepared => {
  const caller = request()
  const effective = resolveProviderModelParametersForDispatch({
    ...caller,
    provider: {
      ...caller.provider,
      models: ['friendly-model'],
      modelAliases: [{ alias: 'friendly-model', model: 'budget-fixture' }],
      modelParameterOverrides: {
        schema: 'islemind.provider-model-parameters.v1',
        models: { 'friendly-model': { maxTokens: 8192 } },
      },
    },
    model: prepared ? 'budget-fixture' : 'friendly-model',
    requestedModel: prepared ? 'friendly-model' : undefined,
  })
  expect(effective.maxTokens).toBe(1024)
  expect(providerRequestSerializer.serialize(effective).body.max_tokens).toBe(1024)
  expect(effective.modelParameterBaseline?.values.maxTokens).toBe(4096)
})

it('recomputes a fallback bound from the caller baseline and restores omission when overrides are cleared', () => {
  const first = resolveProviderModelParametersForDispatch(request())
  const fallback = resolveProviderModelParametersForDispatch({
    ...first, provider: provider('fallback-connection', 512, 2048),
  })
  expect(fallback.maxTokens).toBe(512)
  expect(providerRequestSerializer.serialize(fallback).body.max_tokens).toBe(512)
  const inherited = resolveProviderModelParametersForDispatch({
    ...fallback, provider: provider('inherited-connection', 1024),
  })
  expect(inherited.maxTokens).toBe(4096)
  expect(inherited.generationParameterSources.maxTokens).toBe('provider-default')
  expect(providerRequestSerializer.serialize(inherited).body.max_tokens).toBeUndefined()
  expect(inherited.modelParameterBaseline?.values.maxTokens).toBe(4096)
})

it('preserves an explicit conversation output limit over a connection override', () => {
  const caller = { ...request(), maxTokens: 700, generationParameterSources: { maxTokens: 'explicit' as const } }
  const effective = resolveProviderModelParametersForDispatch(caller)
  expect(effective.maxTokens).toBe(700)
  expect(providerRequestSerializer.serialize(effective).body.max_tokens).toBe(700)
})
