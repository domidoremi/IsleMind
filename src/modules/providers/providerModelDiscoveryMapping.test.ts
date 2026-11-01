import { getModelConfig } from '@/types/modelCatalog'
import type { AIProvider } from '@/types/providerContracts'
import { getReasoningEffortOptions, normalizeFireworksReasoningEffort } from '@/utils/modelReasoning'
import { mapOpenAICompatibleModels } from './providerModelDiscoveryMapping'

it.each(['novita', 'fireworks', 'custom-endpoint'] as const)(
  'does not import another supplier reasoning controls into %s discovery',
  providerPresetId => {
    const [model] = mapOpenAICompatibleModels({
      data: [{ id: 'glm-5.2', features: ['reasoning'], context_size: 1048576, max_output_tokens: 131072 }],
    }, 'openai-compatible', { providerPresetId })
    expect(model?.reasoningMode).toBeUndefined()
    expect(model?.reasoningEfforts).toEqual([])
    const persisted = JSON.parse(JSON.stringify(model))
    const reloaded = getModelConfig('glm-5.2', 'openai-compatible', [persisted])
    expect(reloaded.reasoningMode).toBeUndefined()
    expect(reloaded.reasoningEfforts).toEqual([])
    expect(reloaded.maxOutputTokens).toBe(131072)
  },
)

it('preserves remote request-control evidence rather than response-side reasoning features', () => {
  const [model] = mapOpenAICompatibleModels({
    data: [{ id: 'glm-5.2', supported_parameters: ['reasoning_effort', 'max_tokens'] }],
  }, 'openai-compatible', { providerPresetId: 'custom-endpoint' })
  expect(model?.reasoningMode).toBe('openai-effort')
  expect(model?.reasoningEfforts).toEqual(['low', 'medium', 'high'])
  expect(getModelConfig('glm-5.2', 'openai-compatible', [JSON.parse(JSON.stringify(model))]).reasoningMode)
    .toBe('openai-effort')
})

it('keeps native OpenAI catalog defaults when its directory omits request parameters', () => {
  const [model] = mapOpenAICompatibleModels({ data: [{ id: 'gpt-5-mini' }] }, 'openai')
  expect(model?.reasoningMode).toBe('openai-effort')
  expect(model?.reasoningEfforts).toContain('high')
})

it.each([
  'Grok 4.20 0309 Reasoning Console',
  'Grok 4.20 Multi Agent Xhigh',
  'grok-4.20-multi-agent-high',
  'grok-4.20-multi-agent-xhigh',
])('does not treat an evidence-free compatible label as xAI wire controls: %s', id => {
  const [model] = mapOpenAICompatibleModels({ data: [{ id }] }, 'openai-compatible')
  expect(model?.reasoningMode).toBeUndefined()
  expect(model?.reasoningEfforts).toEqual([])
  const persisted = JSON.parse(JSON.stringify(model))
  expect(getModelConfig(id, 'openai-compatible', [persisted]).reasoningEfforts).toEqual([])
})

it.each(['glm-5.2', 'accounts/fireworks/models/glm-5.2'])(
  'keeps a supplier-specific effort enum when remote Fireworks metadata declares the parameter: %s',
  id => {
    const [model] = mapOpenAICompatibleModels({
      data: [{ id, supported_parameters: ['reasoning_effort'] }],
    }, 'openai-compatible', { providerPresetId: 'fireworks' })
    const provider: AIProvider = {
      id: 'fireworks-metadata-fixture', name: 'Fireworks fixture', type: 'openai-compatible',
      presetId: 'fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', apiKey: '',
      models: [id], modelConfigs: [JSON.parse(JSON.stringify(model))], enabled: true,
    }
    expect(getReasoningEffortOptions(provider, id)).toEqual(['none', 'high', 'max'])
    expect(model?.reasoningMode).toBe('fireworks-reasoning-effort')
    expect(model?.reasoningEfforts).toEqual(['none', 'high', 'max'])
    for (const effort of getReasoningEffortOptions(provider, id)) {
      expect(normalizeFireworksReasoningEffort(id, effort)).toBe(effort)
    }
  },
)

it('resolves a persisted legacy generic Fireworks enum through the same supplier wire policy', () => {
  const id = 'glm-5.2'
  const model = {
    ...getModelConfig(id, 'openai-compatible'), source: 'remote' as const,
    reasoningMode: 'openai-effort' as const, reasoningEfforts: ['low', 'medium', 'high'] as const,
  }
  const provider: AIProvider = {
    id: 'legacy-fireworks-fixture', name: 'Fireworks fixture', type: 'openai-compatible',
    presetId: 'fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', apiKey: '',
    models: [id], modelConfigs: [JSON.parse(JSON.stringify(model))], enabled: true,
  }
  expect(getReasoningEffortOptions(provider, id)).toEqual(['none', 'high', 'max'])
})
