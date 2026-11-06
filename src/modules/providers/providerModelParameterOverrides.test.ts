import type { AIProvider } from '@/types/providerContracts'
import type { ProviderRuntimeChatRequest } from './providerRuntimeContracts'
import { applyProviderModelParameterOverrides, parseProviderModelParameterConfiguration } from './providerModelParameterOverrides'
import { extractReportedProviderExecution } from './providerReportedExecution'

const provider = (id: string, models = { first: { temperature: 0.6, maxTokens: 512 }, second: { temperature: 0.9 } }): AIProvider => ({
  id, name: id, type: 'openai-compatible', baseUrl: 'https://local-fixture.invalid/v1', apiKey: '',
  models: ['first', 'second'], enabled: true,
  modelParameterOverrides: { schema: 'islemind.provider-model-parameters.v1', models },
})
function request(): ProviderRuntimeChatRequest {
  return {
    provider: provider('connection-a'), model: 'first', requestedModel: 'first', messages: [],
    temperature: 1, maxTokens: 4096,
    generationParameterSources: { temperature: 'provider-default', topP: 'provider-default', topK: 'provider-default', maxTokens: 'provider-default' },
  }
}

it('isolates connection/model overrides and restores the original baseline before fallback resolution', () => {
  const caller = request()
  const first = applyProviderModelParameterOverrides(caller)
  expect(first).toMatchObject({ temperature: 0.6, maxTokens: 512 })
  expect(caller).toMatchObject({ temperature: 1, maxTokens: 4096 })
  const second = applyProviderModelParameterOverrides({ ...first, model: 'second', requestedModel: 'second' })
  expect(second).toMatchObject({ temperature: 0.9, maxTokens: 4096 })
  const nextConnection = provider('connection-b', { first: { temperature: 0.3, maxTokens: 1024 }, second: { temperature: 0.4 } })
  expect(applyProviderModelParameterOverrides({ ...first, provider: nextConnection })).toMatchObject({ temperature: 0.3, maxTokens: 1024 })
  expect(applyProviderModelParameterOverrides({ ...first, provider: { ...nextConnection, modelParameterOverrides: undefined } }))
    .toMatchObject({ temperature: 1, maxTokens: 4096, generationParameterSources: caller.generationParameterSources })
})

it('preserves explicit conversation values and internal capacity policy over a connection draft', () => {
  const caller = { ...request(), temperature: 0.2, maxTokens: 900, generationParameterSources: {
    ...request().generationParameterSources, temperature: 'explicit' as const, maxTokens: 'internal-policy' as const,
  } }
  expect(applyProviderModelParameterOverrides(caller)).toBe(caller)
})

it('uses omission for model defaults and validates persisted values before they can affect a request', () => {
  expect(parseProviderModelParameterConfiguration({ schema: 'islemind.provider-model-parameters.v1', models: { first: {} } })).toBeUndefined()
  expect(applyProviderModelParameterOverrides({ ...request(), provider: { ...provider('a'), modelParameterOverrides: undefined } }))
    .toMatchObject({ generationParameterSources: request().generationParameterSources })
  for (const value of [
    { first: { maxTokens: Number.MAX_SAFE_INTEGER + 1 } },
    { first: { temperature: NaN } }, { first: { topP: 2 } }, { first: { topK: 1.5 } },
    { first: { unsupported: true } }, JSON.parse('{"__proto__":{"temperature":0.1}}'),
  ]) expect(() => parseProviderModelParameterConfiguration({ schema: 'islemind.provider-model-parameters.v1', models: value })).toThrow()
})

it.each([
  [{ model: 'actual' }, { model: 'actual', source: 'response.model' }],
  [{ response: { model: 'snapshot' } }, { model: 'snapshot', source: 'response.model' }],
  [{ modelVersion: 'version' }, { model: 'version', source: 'response.modelVersion' }],
  [{ message: { model: 'anthropic-version' } }, { model: 'anthropic-version', source: 'response.message.model' }],
  [{ id: 'openai/gpt-whatever', upstreamProvider: 'OpenAI' }, undefined],
  [{ model: ' credential\n' }, undefined],
  [{ model: 'x'.repeat(241) }, undefined],
])('extracts bounded response evidence without guessing from a target or catalog: %j', (payload, expected) => {
  expect(extractReportedProviderExecution(payload)).toEqual(expected)
})
