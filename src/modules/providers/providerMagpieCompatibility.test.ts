import { buildProviderProtocolRequestBody } from '@/bootstrap/providerRequestBinding'
import { checkProviderContextCapacity } from './providerContextCapacity'
import { mapOpenAICompatibleModels } from './providerModelDiscoveryMapping'
import { createRunBudget, reserveRunAttempt } from '@/modules/assistant-runtime'
import type { AIProvider } from '@/types/providerContracts'
import { getProviderDisplayModel } from '@/utils/providerModels'
import { buildProviderModelConfigsForStorage } from '@/utils/providerModelStorage'
import { groupProviderModelsBySource } from '@/utils/providerModelSources'
import { getReasoningEffortOptions } from '@/utils/modelReasoning'
import type { ReasoningEffort } from '@/core'

function magpieProvider(): AIProvider {
  const modelConfigs = mapOpenAICompatibleModels({
    data: [{
      id: 'auto/glm-5.3',
      display_name: 'GLM-5.3',
      magpie_label: 'GLM-5.3 · routing group',
      owned_by: 'workbuddy-ai',
      context_window: 1_048_576,
      max_output_tokens: 307_200,
      supported_parameters: ['tools', 'tool_choice', 'reasoning'],
    }, {
      id: 'workbuddy-ai/glm-5.3',
      display_name: 'GLM-5.3',
      magpie_label: 'GLM-5.3 · WorkBuddy AI',
      owned_by: 'workbuddy-ai',
      context_window: 1_048_576,
      max_output_tokens: 307_200,
      supported_parameters: ['tools', 'tool_choice', 'reasoning'],
    }, {
      id: 'workbuddy/deepseek-v4-pro',
      display_name: 'DeepSeek V4 Pro',
      magpie_label: 'DeepSeek V4 Pro · WorkBuddy',
      owned_by: 'workbuddy',
      supported_parameters: ['tools'],
    }, {
      id: 'cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6',
      display_name: 'Kimi K2.6 (Paid)',
      magpie_label: 'Kimi K2.6 (Paid) · Cloudflare Workers AI',
      owned_by: 'cloudflare-workers-ai',
      supported_parameters: ['tools', 'tool_choice'],
    }],
  }, 'openai-compatible', { providerPresetId: 'custom-endpoint' })
  return {
    id: 'magpie-fixture', name: 'Magpie', type: 'openai-compatible',
    presetId: 'custom-endpoint', baseUrl: 'http://192.168.1.2:3425/v1',
    apiKey: 'synthetic-test-only', enabled: true,
    models: modelConfigs.map(model => model.id), modelConfigs,
  }
}

it('keeps the wire output cap when Magpie lists optional capabilities without max_tokens', () => {
  const provider = magpieProvider()
  const body = buildProviderProtocolRequestBody({
    provider, model: 'auto/glm-5.3',
    messages: [{ role: 'user', content: 'Reply OK' }],
    maxTokens: 8192, temperature: 0.3, topP: 1,
    generationParameterSources: {
      maxTokens: 'internal-policy', temperature: 'provider-default', topP: 'provider-default',
    },
    stream: true,
  })
  expect(body.max_tokens).toBe(8192)
  expect(body.temperature).toBeUndefined()
  expect(body.top_p).toBeUndefined()
  const capacity = checkProviderContextCapacity({
    body, contextWindow: 1_048_576, modelMaxOutputTokens: 307_200,
  })
  expect(capacity.reservedOutputTokens).toBe(8192)
  expect(reserveRunAttempt(createRunBudget('chat'), {
    attemptId: 'first', runId: 'chat',
    inputEstimate: capacity.estimatedInputTokens,
    outputReservation: capacity.reservedOutputTokens,
  }, 0).attempts).toHaveLength(1)
})

it('does not add output parameter support to an unrelated compatible supplier', () => {
  const [model] = mapOpenAICompatibleModels({
    data: [{ id: 'other/model', supported_parameters: ['tools', 'tool_choice'] }],
  }, 'openai-compatible', { providerPresetId: 'custom-endpoint' })
  expect(model.supportedParameters).toEqual(['tools', 'tool_choice'])
  expect(model.upstreamProvider).toBeUndefined()
})

it.each<ReasoningEffort>(['low', 'high', 'max', 'ultra'])('sends Magpie’s advertised %s thinking level without replacing it', effort => {
  const modelConfigs = mapOpenAICompatibleModels({ data: [{
    id: 'gateway/thinking-model', magpie_label: 'Thinking Model · Gateway',
    reasoning: true, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'max' }, { effort: 'ultra' }],
    supported_parameters: ['tools', 'reasoning'],
  }] }, 'openai-compatible', { providerPresetId: 'custom-endpoint' })
  const provider: AIProvider = { ...magpieProvider(), models: [modelConfigs[0].id], modelConfigs }
  expect(getReasoningEffortOptions(provider, provider.models![0])).toEqual(['low', 'high', 'max', 'ultra'])
  const body = buildProviderProtocolRequestBody({
    provider, model: provider.models![0], messages: [{ role: 'user', content: 'Synthetic question' }],
    reasoningEffort: effort, maxTokens: 512, stream: true, generationParameterSources: { maxTokens: 'internal-policy' },
  })
  expect(body.reasoning_effort).toBe(effort)
  const stored = { ...provider, modelConfigs: buildProviderModelConfigsForStorage(provider, provider.models!, [], []) }
  expect(getReasoningEffortOptions(JSON.parse(JSON.stringify(stored)), provider.models![0])).toEqual(['low', 'high', 'max', 'ultra'])
})

it('uses only advertised levels and keeps unsupported thinking controls unavailable after storage', () => {
  const modelConfigs = mapOpenAICompatibleModels({ data: [
    { id: 'gateway/kimi-k3', magpie_label: 'Kimi K3 · Gateway', reasoning: true, reasoning_levels: ['max', 'low', 'unknown', 'low'] },
    { id: 'gateway/gpt-5', magpie_label: 'GPT-5 · Gateway', reasoning: true, supported_reasoning_levels: [] },
    { id: 'gateway/off', magpie_label: 'No Thinking · Gateway', reasoning: false, reasoning_levels: ['high'] },
  ] }, 'openai-compatible', { providerPresetId: 'custom-endpoint' })
  const provider: AIProvider = JSON.parse(JSON.stringify({ ...magpieProvider(), models: modelConfigs.map(model => model.id), modelConfigs }))
  expect(getReasoningEffortOptions(provider, 'gateway/kimi-k3')).toEqual(['low', 'max'])
  expect(getReasoningEffortOptions(provider, 'gateway/gpt-5')).toEqual([])
  expect(getReasoningEffortOptions(provider, 'gateway/off')).toEqual([])
})

it('persists upstream names and distinguishes automatic routing from a supplier', () => {
  const provider = magpieProvider()
  const models = JSON.parse(JSON.stringify(provider.modelConfigs)) as NonNullable<AIProvider['modelConfigs']>
  expect(models.find(model => model.id === 'auto/glm-5.3')?.upstreamProvider)
    .toEqual({ id: 'auto', name: 'routing group', automatic: true })
  expect(models.find(model => model.id === 'workbuddy-ai/glm-5.3')?.upstreamProvider)
    .toEqual({ id: 'workbuddy-ai', name: 'WorkBuddy AI' })
  expect(models.find(model => model.id === 'cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6')?.upstreamProvider)
    .toEqual({ id: 'cloudflare-workers-ai', name: 'Cloudflare Workers AI' })
  expect(models.find(model => model.id === 'workbuddy/deepseek-v4-pro')?.name).toBe('DeepSeek V4 Pro')
  expect(getProviderDisplayModel(provider, 'workbuddy/deepseek-v4-pro')).toBe('WorkBuddy / DeepSeek V4 Pro')
  const legacy = models.find(model => model.id === 'workbuddy/deepseek-v4-pro')!
  legacy.name = 'Workbuddy / DeepSeek V4 Pro'
  expect(getProviderDisplayModel({ ...provider, modelConfigs: models }, legacy.id)).toBe('WorkBuddy / DeepSeek V4 Pro')
})

it('retains a credential-only model source and output cap when persisting a gateway', () => {
  const provider = magpieProvider()
  const credentialOnlyModel = 'cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6'
  provider.credentialGroups = [{
    id: 'gateway-key', label: 'Gateway', apiKey: 'synthetic-test-only',
    enabled: true, availableModels: provider.models,
  }]
  const persisted = {
    ...provider,
    models: provider.models!.filter(id => id !== credentialOnlyModel),
    modelConfigs: buildProviderModelConfigsForStorage(
      provider, provider.models!.filter(id => id !== credentialOnlyModel), [], [],
    ),
  }
  expect(persisted.modelConfigs.find(model => model.id === credentialOnlyModel)?.supportedParameters)
    .toContain('max_tokens')
  expect(getProviderDisplayModel(persisted, credentialOnlyModel)).toBe('Cloudflare Workers AI / Kimi K2.6 (Paid)')
  expect(groupProviderModelsBySource(persisted, provider.models!))
    .toHaveLength(groupProviderModelsBySource(provider, provider.models!).length)
})
