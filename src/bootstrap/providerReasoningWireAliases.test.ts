import { mapOpenAICompatibleModels } from '@/modules/providers'
import type { AIProvider } from '@/types/providerContracts'
import { getModelConfig } from '@/types/modelCatalog'
import { buildProviderModelConfigsForStorage } from '@/utils/providerModelStorage'
import { getConversationReasoningEffortOptions } from './providerConversationGeneration'
import { providerRequestSerializer } from './providerRequestBinding'
import { providerConformancePolicy } from './providerConformance'

const model = 'our-free-model/deepseek-v4.1-flash-free'
const wireValues = { low: 'light', medium: 'balanced', high: 'deep' }

function gateway(objects = false): AIProvider {
  return {
    id: 'wire-alias-gateway', name: 'Magpie', type: 'openai-compatible', presetId: 'custom-endpoint',
    baseUrl: 'https://example.invalid/v1', apiKey: 'synthetic-only', enabled: true, models: [model],
    modelAliases: [{ alias: 'reasoner', model }],
    modelConfigs: mapOpenAICompatibleModels({ data: [{
      id: model, magpie_label: 'DeepSeek Flash Free · Our Free Model', reasoning: true,
      ...(objects ? { supported_reasoning_levels: Object.values(wireValues).map(effort => ({ effort })) }
        : { reasoning_levels: Object.values(wireValues) }),
      supported_parameters: ['reasoning'],
    }] }, 'openai-compatible', { providerPresetId: 'custom-endpoint' }),
  }
}

it.each([false, true])('preserves supplier effort names through discovery, storage and serialization (objects: %s)', objects => {
  const provider = gateway(objects)
  provider.modelConfigs = JSON.parse(JSON.stringify(buildProviderModelConfigsForStorage(
    provider, provider.models, [], provider.modelAliases ?? [],
  )))
  const config = getModelConfig(model, provider.type, provider.modelConfigs)
  expect(config.reasoningEfforts).toEqual(['low', 'medium', 'high'])
  expect(config.reasoningEffortWireValues).toEqual(wireValues)
  expect(getConversationReasoningEffortOptions(provider, 'reasoner')).toEqual(['low', 'medium', 'high'])
  for (const effort of ['low', 'medium', 'high'] as const) {
    const request = { provider, model: 'reasoner', messages: [{ role: 'user' as const, content: 'Fixture' }],
      reasoningEffort: effort, generationParameterSources: {} }
    const before = JSON.stringify(request)
    const serialized = providerRequestSerializer.serialize(request)
    expect(serialized.body.reasoning_effort).toBe(wireValues[effort])
    expect(serialized.conformance.reasoning).toMatchObject({ effective: effort, providerValue: wireValues[effort] })
    expect(serialized.conformance.adjustedParams.reasoning_effort).toBe(wireValues[effort])
    expect(JSON.stringify(request)).toBe(before)
    const repeated = providerConformancePolicy.resolveAndHardenProviderRequest({ ...request, model }, serialized.body)
    expect(repeated.body.reasoning_effort).toBe(wireValues[effort])
  }
})

it('keeps model default unset and respects an explicit supplier denial with aliases present', () => {
  const provider = gateway()
  const request = { provider, model, messages: [{ role: 'user' as const, content: 'Fixture' }], generationParameterSources: {} }
  expect(providerRequestSerializer.serialize(request).body.reasoning_effort).toBeUndefined()
  const denied: AIProvider = { ...provider, capabilities: {
    chat: true, streaming: true, reasoningEffort: false, responsesApi: true, modelList: true,
    vision: true, files: true, audioInput: false, audioTranscription: false, speech: false, nativeSearch: true, topP: true,
  } }
  expect(getConversationReasoningEffortOptions(denied, model)).toEqual([])
  expect(providerRequestSerializer.serialize({ ...request, provider: denied, reasoningEffort: 'high' }).body.reasoning_effort)
    .toBeUndefined()
})

it('uses the supplier wire value in Responses while retaining other reasoning properties', () => {
  const provider = gateway()
  provider.capabilities = {
    chat: true, streaming: true, reasoningEffort: true, responsesApi: true, modelList: true,
    vision: true, files: true, audioInput: false, audioTranscription: false, speech: false, nativeSearch: true, topP: true,
  }
  provider.modelConfigs![0].preferredEndpoint = 'responses'
  const request = { provider, model, messages: [{ role: 'user' as const, content: 'Fixture' }],
    reasoningEffort: 'high' as const, generationParameterSources: {} }
  const serialized = providerRequestSerializer.serialize(request)
  expect(serialized.conformance.manifest.reasoning.requestShape).toBe('openai-responses-reasoning')
  expect(serialized.body.reasoning).toMatchObject({ effort: 'deep' })
  expect(serialized.conformance.reasoning.providerValue).toBe('deep')
  const body = { ...serialized.body, reasoning: { effort: 'high', summary: 'auto' } }
  const before = JSON.stringify(body)
  const hardened = providerConformancePolicy.resolveAndHardenProviderRequest({
    ...request, protocolAdapterId: 'openai-compatible-responses',
  }, body)
  expect(hardened.body.reasoning).toEqual({ effort: 'deep', summary: 'auto' })
  expect(hardened.conformance.adjustedParams['reasoning.effort']).toBe('deep')
  expect(JSON.stringify(body)).toBe(before)
})

it('prefers an advertised canonical name when a supplier also declares its synonym', () => {
  const [config] = mapOpenAICompatibleModels({ data: [{
    id: model, magpie_label: 'Fixture · Our Free Model', reasoning: true,
    reasoning_levels: ['deep', 'high', 'balanced', 'light'], supported_parameters: ['reasoning'],
  }] }, 'openai-compatible', { providerPresetId: 'custom-endpoint' })
  expect(config.reasoningEfforts).toEqual(['low', 'medium', 'high'])
  expect(config.reasoningEffortWireValues).toEqual({ low: 'light', medium: 'balanced' })
})

it('does not infer alternate wire names from an unrecognized compatible directory', () => {
  const [config] = mapOpenAICompatibleModels({ data: [{
    id: model, reasoning_levels: ['light', 'balanced', 'deep'], supported_parameters: ['reasoning'],
  }] }, 'openai-compatible', { providerPresetId: 'custom-endpoint' })
  expect(config.reasoningEfforts).toEqual([])
  expect(config.reasoningEffortWireValues).toBeUndefined()
})
