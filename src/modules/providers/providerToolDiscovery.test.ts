import { mapOpenAICompatibleModels } from './providerModelDiscoveryMapping'
import { resolveAgentModelBinding } from '@/bootstrap/agentModelBinding'
import { buildProviderModelCapabilityMatrix } from '@/bootstrap/providerCapabilityMatrix'
import { getModelConfig } from '@/types/modelCatalog'
import type { AIProvider } from '@/types/providerContracts'

function provider(declared: boolean): AIProvider {
  return { id: 'relay', name: 'Relay', type: 'openai-compatible', presetId: 'custom-endpoint', enabled: true,
    baseUrl: 'https://relay.example', apiKey: '', models: ['gemini-2.5-flash'],
    capabilities: { nativeTools: declared } as AIProvider['capabilities'],
    modelConfigs: JSON.parse(JSON.stringify(mapOpenAICompatibleModels({ data: [{ id: 'gemini-2.5-flash' }] },
      'openai-compatible', { providerPresetId: 'custom-endpoint' }))) }
}

it('preserves unreported tool support across JSON storage without inheriting a model-name claim', () => {
  const p = provider(false)
  expect(getModelConfig(p.models[0], p.type, p.modelConfigs).supportsTools).toBeNull()
  expect(resolveAgentModelBinding(p, p.models[0]).actionCapability).toBe('text_only')
})

it('allows an explicit relay tool declaration for unreported metadata, but labels it manual', () => {
  const p = provider(true)
  expect(resolveAgentModelBinding(p, p.models[0]).actionCapability).toBe('native_tool_calling')
  expect(buildProviderModelCapabilityMatrix(p, p.models[0]).capabilities.find(x => x.capability === 'tools')?.status).toBe('manual')
})

it('never overrides an explicit model-level denial or reinterprets old false values as unknown', () => {
  const p = provider(true)
  p.modelConfigs![0].supportsTools = false
  expect(resolveAgentModelBinding(p, p.models[0]).actionCapability).toBe('text_only')
})

it('keeps an explicit remote parameter list without tools denied even with a provider declaration', () => {
  const p = provider(true)
  p.modelConfigs = mapOpenAICompatibleModels({ data: [{ id: p.models[0], supported_parameters: ['temperature'] }] },
    p.type, { providerPresetId: 'custom-endpoint' })
  expect(p.modelConfigs[0].supportsTools).toBe(false)
  expect(resolveAgentModelBinding(p, p.models[0]).actionCapability).toBe('text_only')
})
