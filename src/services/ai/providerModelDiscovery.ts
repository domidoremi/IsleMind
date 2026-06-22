import type { AIModel, AIProvider, ModelReasoningMode, ProviderPresetId, ProviderType, ReasoningEffort } from '@/types'
import { getProviderConfigIssue, mergeModelConfig, sortModelConfigs } from '@/types'
import { ProviderHttpError } from '@/services/ai/providerOperationResult'
import { fetchWithTimeout, safeResponseText } from '@/services/ai/providerHttp'
import { parseProviderJson } from '@/services/ai/providerJsonUtils'
import {
  defaultOpenAICompatibleBaseUrl,
  isOpenAICompatibleProvider,
  normalizeProviderBaseUrl,
} from '@/services/ai/providerRouteAssembly'
import { getHeaders } from '@/services/ai/providerHeaders'
import { providerCompatibilityCapabilityCanBeSentForProvider } from '@/services/ai/providerCompatibilityContract'

export type OpenAIModelListItem = {
  id?: string
  object?: string
  name?: string
  display_name?: string
  context_length?: number
  contextWindow?: number
  context_window?: number
  max_context_length?: number
  context_size?: number
  max_output_length?: number
  max_output_tokens?: number
  max_completion_tokens?: number
  max_tokens?: number
  maxOutputTokens?: number
  features?: string[]
  supported_parameters?: string[]
  input_modalities?: string[]
  output_modalities?: string[]
  architecture?: {
    input_modalities?: string[]
    modality?: string
  }
  metadata?: Record<string, unknown>
  tags?: unknown
}

export type OpenAIModelListResponse = {
  data?: OpenAIModelListItem[]
}

export type AnthropicModelListItem = {
  id?: string
  display_name?: string
  type?: string
  max_input_tokens?: number
  max_tokens?: number
  capabilities?: string[] | Record<string, unknown>
}

export type AnthropicModelListResponse = {
  data?: AnthropicModelListItem[]
}

export type GoogleModelListResponse = {
  models?: {
    name?: string
    displayName?: string
    inputTokenLimit?: number
    outputTokenLimit?: number
    supportedGenerationMethods?: string[]
  }[]
}

type OpenAIModelMappingOptions = {
  providerPresetId?: ProviderPresetId
}

const DEEPINFRA_REASONING_EFFORTS: ReasoningEffort[] = ['none', 'low', 'medium', 'high']

export function mapOpenAICompatibleModels(json: OpenAIModelListResponse, providerType: ProviderType, options: OpenAIModelMappingOptions = {}): AIModel[] {
  const items = json.data?.filter((item) => isString(item.id)) ?? []
  return sortModelConfigs(
    dedupeModelIds(items.map((item) => normalizeRemoteModelId(item.id!, providerType))).map((id) => {
      const remote = items.find((item) => normalizeRemoteModelId(item.id!, providerType) === id)
      const reasoningMode = openAICompatibleReasoningModeFromModel(remote, options)
      return mergeModelConfig(id, providerType, {
        name: remote?.display_name || remote?.name,
        contextWindow: firstNumber(
          remote?.context_length,
          remote?.contextWindow,
          remote?.context_window,
          remote?.max_context_length,
          remote?.context_size,
          getNumber(remote?.metadata, 'context_length'),
          getNumber(remote?.metadata, 'contextWindow'),
          getNumber(remote?.metadata, 'context_window'),
          getNumber(remote?.metadata, 'max_context_length'),
          getNumber(remote?.metadata, 'context_size')
        ),
        maxOutputTokens: firstNumber(
          remote?.max_output_length,
          remote?.max_output_tokens,
          remote?.maxOutputTokens,
          remote?.max_completion_tokens,
          remote?.max_tokens,
          getNumber(remote?.metadata, 'max_output_length'),
          getNumber(remote?.metadata, 'max_output_tokens'),
          getNumber(remote?.metadata, 'maxOutputTokens'),
          getNumber(remote?.metadata, 'max_completion_tokens'),
          getNumber(remote?.metadata, 'max_tokens'),
          getNumber(remote?.metadata, 'output_token_limit')
        ),
        supportsVision: supportsVisionFromOpenAIModel(remote),
        supportsTools: supportsToolsFromOpenAIModel(remote),
        supportedParameters: supportedParametersFromOpenAIModel(remote),
        ...(reasoningMode ? {
          reasoningMode,
          reasoningEfforts: DEEPINFRA_REASONING_EFFORTS,
        } : {}),
        source: 'remote',
      })
    }),
    providerType
  )
}

export function getXiaomiMimoModelDiscoveryProvider(provider: AIProvider): AIProvider {
  if (provider.wireProtocol !== 'anthropic-compatible') return provider
  const nextBaseUrl = provider.baseUrl?.replace(/\/anthropic(?:\/v1)?\/?$/i, '/v1')
  return {
    ...provider,
    wireProtocol: 'openai-compatible',
    baseUrl: nextBaseUrl,
  }
}

export function mapAnthropicModels(json: AnthropicModelListResponse): AIModel[] {
  return sortModelConfigs(
    dedupeModelIds(json.data?.map((item) => item.id).filter(isString) ?? []).map((id) => {
      const remote = json.data?.find((item) => item.id === id)
      return mergeModelConfig(id, 'anthropic', {
        name: remote?.display_name,
        contextWindow: remote?.max_input_tokens,
        maxOutputTokens: remote?.max_tokens,
        defaultMaxTokens: remote?.max_tokens ? Math.min(8192, remote.max_tokens) : undefined,
        reasoningMode: anthropicCapabilitiesIncludeThinking(remote?.capabilities) ? 'anthropic-thinking' : undefined,
        source: 'remote',
      })
    }),
    'anthropic'
  )
}

export function mapGoogleModels(json: GoogleModelListResponse): AIModel[] {
  const remoteModels: { id: string; name?: string; contextWindow?: number; maxOutputTokens?: number }[] = []
  for (const model of json.models ?? []) {
    if (!model.supportedGenerationMethods?.some((method) => method.includes('generateContent'))) continue
    const id = model.name?.replace(/^models\//, '')
    if (!isString(id)) continue
    remoteModels.push({
      id,
      name: model.displayName,
      contextWindow: model.inputTokenLimit,
      maxOutputTokens: model.outputTokenLimit,
    })
  }
  return sortModelConfigs(
    dedupeModelIds(remoteModels.map((model) => model.id)).map((id) => {
      const remote = remoteModels.find((model) => model.id === id)
      return mergeModelConfig(id, 'google', {
        name: remote?.name,
        contextWindow: remote?.contextWindow,
        maxOutputTokens: remote?.maxOutputTokens,
        defaultMaxTokens: remote?.maxOutputTokens ? Math.min(8192, remote.maxOutputTokens) : undefined,
        supportsVision: true,
        supportsFiles: true,
        source: 'remote',
      })
    }),
    'google'
  )
}

export async function fetchProviderModelConfigsFromRemote(provider: AIProvider, timeoutMs: number): Promise<AIModel[]> {
  const issue = getProviderConfigIssue(provider, provider.apiKey)
  if (issue) {
    throw new Error(issue.messageKey ?? issue.message)
  }
  if (provider.capabilities?.modelList === false) {
    return []
  }
  if (!providerCompatibilityCapabilityCanBeSentForProvider(provider, 'modelList', provider.capabilities?.modelList === true)) {
    return []
  }
  if (provider.type === 'xiaomi-mimo') {
    return fetchOpenAICompatibleModels(getXiaomiMimoModelDiscoveryProvider(provider), timeoutMs)
  }
  if (provider.type === 'google') {
    return fetchGoogleModels(provider, timeoutMs)
  }
  if (provider.type === 'anthropic') {
    return fetchAnthropicModels(provider, timeoutMs)
  }
  if (provider.type === 'openai' || isOpenAICompatibleProvider(provider)) {
    return fetchOpenAICompatibleModels(provider, timeoutMs)
  }
  return []
}

export function dedupeModelIds(models: string[]): string[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    const id = model.trim()
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function normalizeRemoteModelId(modelId: string, providerType: ProviderType): string {
  const trimmed = modelId.trim()
  if (providerType === 'xiaomi-mimo' && trimmed.startsWith('xiaomi/')) {
    return trimmed.split('/').at(-1) ?? trimmed
  }
  return trimmed
}

export function supportsVisionFromOpenAIModel(model?: OpenAIModelListItem): boolean | undefined {
  const tags = openAIModelTags(model)
  if (tags.has('vision') || tags.has('vlm')) return true
  const modalities = [
    ...(model?.architecture?.input_modalities ?? []),
    ...(model?.input_modalities ?? []),
  ]
  if (modalities.length) {
    return modalities.some((modality) => ['image', 'vision', 'video'].includes(modality.toLowerCase()))
  }
  const id = model?.id?.toLowerCase() ?? ''
  if (!id) return undefined
  if (id.includes('mimo-v2.5') && !id.includes('tts')) return true
  if (id.includes('mimo-v2-omni')) return true
  return undefined
}

export function supportsToolsFromOpenAIModel(model?: OpenAIModelListItem): boolean | undefined {
  const tags = openAIModelTags(model)
  if (tags.has('function-calling') || tags.has('function_calling') || tags.has('tools') || tags.has('tool-calling')) return true
  return undefined
}

function supportedParametersFromOpenAIModel(model?: OpenAIModelListItem): string[] | undefined {
  if (!Array.isArray(model?.supported_parameters)) return undefined
  const values = model.supported_parameters
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean)
  return values.length ? [...new Set(values)] : undefined
}

function openAICompatibleReasoningModeFromModel(model: OpenAIModelListItem | undefined, options: OpenAIModelMappingOptions): ModelReasoningMode | undefined {
  if (options.providerPresetId !== 'deepinfra') return undefined
  const tags = openAIModelTags(model)
  return tags.has('reasoning_effort') || tags.has('reasoning') ? 'deepinfra-reasoning-effort' : undefined
}

function openAIModelTags(model?: OpenAIModelListItem): Set<string> {
  return new Set([
    ...tagValues(model?.tags),
    ...tagValues(model?.features),
    ...tagValues(model?.metadata?.tags),
    ...tagValues(model?.metadata?.tag),
    ...tagValues(model?.metadata?.features),
  ].map((tag) => tag.toLowerCase()))
}

function tagValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(isString)
  if (typeof value === 'string') return value.split(/[,\s]+/).map((tag) => tag.trim()).filter(Boolean)
  return []
}

export function firstNumber(...values: (number | undefined)[]): number | undefined {
  return values.find((value) => Number.isFinite(value))
}

export function getNumber(source: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = source?.[key]
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function anthropicCapabilitiesIncludeThinking(capabilities: AnthropicModelListItem['capabilities']): boolean {
  if (Array.isArray(capabilities)) return capabilities.some((item) => /thinking|reasoning/i.test(item))
  if (capabilities && typeof capabilities === 'object') {
    return Object.entries(capabilities).some(([key, value]) => /thinking|reasoning/i.test(key) && value !== false)
  }
  return false
}

async function fetchOpenAICompatibleModels(provider: AIProvider, timeoutMs: number): Promise<AIModel[]> {
  const response = await fetchWithTimeout(`${normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/models`, {
    method: 'GET',
    headers: getHeaders(provider),
  }, timeoutMs)
  if (!response.ok) throw new ProviderHttpError(response.status, await safeResponseText(response))
  const json = parseProviderJson<OpenAIModelListResponse>(await safeResponseText(response), response, provider, '模型列表')
  return mapOpenAICompatibleModels(json, provider.type, { providerPresetId: provider.presetId ?? provider.detectedPresetId })
}

async function fetchAnthropicModels(provider: AIProvider, timeoutMs: number): Promise<AIModel[]> {
  const response = await fetchWithTimeout(`${normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/models`, {
    method: 'GET',
    headers: getHeaders(provider),
  }, timeoutMs)
  if (!response.ok) throw new ProviderHttpError(response.status, await safeResponseText(response))
  const json = (await response.json()) as AnthropicModelListResponse
  return mapAnthropicModels(json)
}

async function fetchGoogleModels(provider: AIProvider, timeoutMs: number): Promise<AIModel[]> {
  const response = await fetchWithTimeout(`${normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/models?key=${encodeURIComponent(provider.apiKey)}`, undefined, timeoutMs)
  if (!response.ok) throw new ProviderHttpError(response.status, await safeResponseText(response))
  const json = (await response.json()) as GoogleModelListResponse
  return mapGoogleModels(json)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
