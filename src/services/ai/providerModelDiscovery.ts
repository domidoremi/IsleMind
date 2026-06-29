import type { AIModel, AIProvider, ModelReasoningMode, ProviderPresetId, ProviderType, ReasoningEffort } from '@/types'
import { getModelConfig, getProviderConfigIssue, mergeModelConfig, sortModelConfigs } from '@/types'
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
  preferred_endpoint?: string
  preferredEndpoint?: string
  endpoint?: string
  endpoints?: unknown
  supported_endpoints?: unknown
  supportedEndpoints?: unknown
  input_modalities?: string[]
  output_modalities?: string[]
  modalities?: unknown
  architecture?: {
    input_modalities?: string[]
    inputModalities?: string[]
    modality?: string
    modalities?: unknown
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
const OPENAI_COMPATIBLE_REASONING_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high']
const DASHSCOPE_THINKING_EFFORTS: ReasoningEffort[] = ['none', 'low', 'medium', 'high']
const METADATA_GATED_OPENAI_COMPATIBLE_PRESETS = new Set<ProviderPresetId>([
  'openrouter',
  'newapi',
  'sub2api',
  'custom-openai-compatible',
])

export function mapOpenAICompatibleModels(json: OpenAIModelListResponse, providerType: ProviderType, options: OpenAIModelMappingOptions = {}): AIModel[] {
  const items = json.data?.filter((item) => isString(item.id)) ?? []
  const gateKnownDefaults = shouldGateOpenAICompatibleKnownDefaults(providerType, options)
  const itemsById = new Map<string, OpenAIModelListItem>()
  for (const item of items) {
    const id = normalizeRemoteModelId(item.id!, providerType)
    if (!itemsById.has(id)) itemsById.set(id, item)
  }
  return sortModelConfigs(
    Array.from(itemsById.entries()).map(([id, remote]) => {
      const reasoningMode = openAICompatibleReasoningModeFromModel(remote, options)
      const supportsVision = supportsVisionFromOpenAIModel(remote)
      const supportsFiles = supportsFilesFromOpenAIModel(remote)
      const supportsTools = supportsToolsFromOpenAIModel(remote)
      const supportedParameters = supportedParametersFromOpenAIModel(remote)
      const preferredEndpoint = preferredEndpointFromOpenAIModel(remote)
      const merged = mergeModelConfig(id, providerType, {
        name: normalizeRemoteModelDisplayName(remote?.id ?? id, id, remote, providerType),
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
        supportsVision,
        supportsFiles,
        supportsTools,
        supportedParameters,
        preferredEndpoint,
        ...(reasoningMode ? {
          reasoningMode,
          reasoningEfforts: openAICompatibleReasoningEffortsFromMode(reasoningMode),
        } : {}),
        source: 'remote',
      })
      if (!gateKnownDefaults) return merged
      return {
        ...merged,
        supportsVision: supportsVision ?? false,
        supportsFiles: supportsFiles ?? false,
        supportsTools: supportsTools ?? false,
        preferredEndpoint: preferredEndpoint ?? 'chat-completions',
        reasoningMode,
        reasoningEfforts: reasoningMode ? openAICompatibleReasoningEffortsFromMode(reasoningMode) : undefined,
      }
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
  const itemsById = new Map<string, AnthropicModelListItem>()
  for (const item of json.data ?? []) {
    if (!isString(item.id) || itemsById.has(item.id)) continue
    itemsById.set(item.id, item)
  }
  return sortModelConfigs(
    Array.from(itemsById.entries()).map(([id, remote]) => {
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
  const remoteModelsById = new Map<string, { id: string; name?: string; contextWindow?: number; maxOutputTokens?: number }>()
  for (const model of json.models ?? []) {
    if (!model.supportedGenerationMethods?.some((method) => method.includes('generateContent'))) continue
    const id = model.name?.replace(/^models\//, '')
    if (!isString(id)) continue
    if (remoteModelsById.has(id)) continue
    remoteModelsById.set(id, {
      id,
      name: model.displayName,
      contextWindow: model.inputTokenLimit,
      maxOutputTokens: model.outputTokenLimit,
    })
  }
  return sortModelConfigs(
    Array.from(remoteModelsById.entries()).map(([id, remote]) => {
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
  const technicalId = extractTrailingTechnicalModelId(trimmed) ?? trimmed
  if (providerType === 'xiaomi-mimo' && technicalId.startsWith('xiaomi/')) {
    return technicalId.split('/').at(-1) ?? technicalId
  }
  return technicalId
}

function normalizeRemoteModelDisplayName(rawModelId: string, normalizedModelId: string, model: OpenAIModelListItem | undefined, providerType: ProviderType): string | undefined {
  const explicitName = firstStringValue(model?.display_name, model?.name)
  const knownName = knownRemoteModelDisplayName(normalizedModelId, providerType)
  if (extractTrailingTechnicalModelId(rawModelId) && knownName) return knownName

  const source = explicitName ?? rawModelId
  const canonical = canonicalizeRemoteModelDisplayName(stripTrailingTechnicalModelId(source))
  if (!canonical) return undefined
  if (!explicitName && !remoteModelIdLooksLikeDisplayLabel(rawModelId)) return undefined
  if (knownName && modelNameLooksLikeTechnicalId(canonical)) return knownName
  if (!knownName && modelNameLooksLikeTechnicalId(canonical) && canonical === canonical.toLowerCase()) return undefined
  return canonical
}

function knownRemoteModelDisplayName(modelId: string, providerType: ProviderType): string | undefined {
  const known = getModelConfig(modelId, providerType)
  return known.source === 'built-in' ? known.name : undefined
}

function canonicalizeRemoteModelDisplayName(value: string): string {
  const providerStripped = stripRedundantProviderPrefix(
    value
      .replace(/[\t\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
  return providerStripped
    .replace(/\bDeep\s*Seek\b|\bDeepseek\b/gi, 'DeepSeek')
    .replace(/\bMoonshot\s*AI\b|\bMoonshotai\b/gi, 'Moonshot AI')
    .replace(/\bZ[\s.-]*AI\b/gi, 'Z.ai')
    .replace(/\bMini\s*Max\b|\bMinimax\b/gi, 'MiniMax')
    .replace(/\bMulti\s+Agent\b/gi, 'Multi-Agent')
    .replace(/\bNon\s+Reasoning\b/gi, 'Non-Reasoning')
    .replace(/\bXhigh\b/gi, 'XHigh')
    .replace(/\bGLM\s*[- ]\s*(\d)/gi, 'GLM-$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripRedundantProviderPrefix(value: string): string {
  const match = value.match(/^([^/]+?)\s*\/\s*(.+)$/)
  if (!match) return value
  const prefix = match[1]?.trim() ?? ''
  const modelName = match[2]?.trim() ?? ''
  if (isKnownProviderPrefix(prefix) && isRecognizedModelFamilyName(modelName)) return modelName
  return value.replace(/\s*\/\s*/g, ' / ')
}

function remoteModelIdLooksLikeDisplayLabel(rawModelId: string): boolean {
  const stripped = stripTrailingTechnicalModelId(rawModelId)
  if (stripped !== rawModelId) return true
  const match = stripped.match(/^([^/]+?)\s*\/\s*(.+)$/)
  return Boolean(match && isKnownProviderPrefix(match[1] ?? '') && isRecognizedModelFamilyName(match[2] ?? ''))
}

function isKnownProviderPrefix(value: string): boolean {
  return [
    'anthropic',
    'dashscope',
    'deepseek',
    'google',
    'minimax',
    'moonshot',
    'moonshotai',
    'openai',
    'xai',
    'zai',
    'zhipuai',
  ].includes(value.replace(/[\s._-]+/g, '').toLowerCase())
}

function isRecognizedModelFamilyName(value: string): boolean {
  return /^(?:claude|deep\s*seek|deepseek|gemini|glm|gpt|grok|kimi|mini\s*max|minimax|mimo|moonshot|qwen)\b/i.test(value.trim())
}

function modelNameLooksLikeTechnicalId(value: string): boolean {
  return /^[a-z0-9._:/-]+$/i.test(value.trim()) && /[-_/:]/.test(value)
}

function stripTrailingTechnicalModelId(value: string): string {
  const technicalId = extractTrailingTechnicalModelId(value)
  if (!technicalId) return value.trim()
  return value.replace(/\s*\([^()]+\)\s*$/, '').trim()
}

function extractTrailingTechnicalModelId(value: string): string | undefined {
  const candidate = value.trim().match(/\(([^()]+)\)\s*$/)?.[1]?.trim()
  if (!candidate) return undefined
  if (/\s/.test(candidate)) return undefined
  if (!/[a-z0-9]/i.test(candidate)) return undefined
  if (!/[._:/-]/.test(candidate)) return undefined
  if (!/^[a-z0-9][a-z0-9._:/+-]*[a-z0-9]$/i.test(candidate)) return undefined
  return candidate
}

function firstStringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function supportsVisionFromOpenAIModel(model?: OpenAIModelListItem): boolean | undefined {
  const tags = openAIModelTags(model)
  if (tags.has('vision') || tags.has('vlm')) return true
  const modalities = openAIModelInputModalities(model)
  if (modalities.length) {
    return modalities.some((modality) => ['image', 'vision', 'video', 'multimodal'].includes(modality.toLowerCase()))
  }
  const id = model?.id?.toLowerCase() ?? ''
  if (!id) return undefined
  if (id.includes('mimo-v2.5') && !id.includes('tts')) return true
  if (id.includes('mimo-v2-omni')) return true
  return undefined
}

export function supportsFilesFromOpenAIModel(model?: OpenAIModelListItem): boolean | undefined {
  const tags = openAIModelTags(model)
  if (tags.has('file') || tags.has('files') || tags.has('pdf') || tags.has('document')) return true
  const supportedParameters = openAIModelSupportedParameterSet(model)
  if (['file_data', 'file_url', 'input_file', 'attachments', 'attachment'].some((item) => supportedParameters.has(item))) return true
  const modalities = openAIModelInputModalities(model)
  if (modalities.length) {
    return modalities.some((modality) => ['file', 'files', 'pdf', 'document', 'input_file'].includes(modality.toLowerCase()))
  }
  return undefined
}

export function supportsToolsFromOpenAIModel(model?: OpenAIModelListItem): boolean | undefined {
  const tags = openAIModelTags(model)
  if (tags.has('function-calling') || tags.has('function_calling') || tags.has('tools') || tags.has('tool-calling')) return true
  const supportedParameters = openAIModelSupportedParameterSet(model)
  if (['tools', 'tool_choice', 'functions', 'function_call', 'function_calling'].some((item) => supportedParameters.has(item))) return true
  return undefined
}

function supportedParametersFromOpenAIModel(model?: OpenAIModelListItem): string[] | undefined {
  if (!Array.isArray(model?.supported_parameters)) return undefined
  const values = model.supported_parameters
    .map((value) => typeof value === 'string' ? normalizeSupportedParameter(value) : '')
    .filter(Boolean)
  return values.length ? [...new Set(values)] : undefined
}

function openAICompatibleReasoningModeFromModel(model: OpenAIModelListItem | undefined, options: OpenAIModelMappingOptions): ModelReasoningMode | undefined {
  const supportedParameters = openAIModelSupportedParameterSet(model)
  if (options.providerPresetId === 'deepinfra') {
    const tags = openAIModelTags(model)
    if (tags.has('reasoning_effort') || tags.has('reasoning') || supportedParameters.has('reasoning_effort')) return 'deepinfra-reasoning-effort'
  }
  if (supportedParameters.has('enable_thinking') || supportedParameters.has('thinking_budget')) return 'dashscope-thinking'
  if (supportedParameters.has('reasoning_effort')) return 'openai-effort'
  return undefined
}

function openAICompatibleReasoningEffortsFromMode(mode: ModelReasoningMode): ReasoningEffort[] {
  if (mode === 'deepinfra-reasoning-effort') return DEEPINFRA_REASONING_EFFORTS
  if (mode === 'dashscope-thinking') return DASHSCOPE_THINKING_EFFORTS
  return OPENAI_COMPATIBLE_REASONING_EFFORTS
}

function preferredEndpointFromOpenAIModel(model?: OpenAIModelListItem): AIModel['preferredEndpoint'] | undefined {
  const preferred = endpointPreferenceFromValue(model?.preferred_endpoint) ??
    endpointPreferenceFromValue(model?.preferredEndpoint) ??
    endpointPreferenceFromValue(model?.endpoint) ??
    endpointPreferenceFromValue(model?.metadata?.preferred_endpoint) ??
    endpointPreferenceFromValue(model?.metadata?.preferredEndpoint) ??
    endpointPreferenceFromValue(model?.metadata?.endpoint)
  if (preferred) return preferred
  return endpointPreferenceFromSupportedValues([
    ...endpointValues(model?.supported_endpoints),
    ...endpointValues(model?.supportedEndpoints),
    ...endpointValues(model?.endpoints),
    ...endpointValues(model?.metadata?.supported_endpoints),
    ...endpointValues(model?.metadata?.supportedEndpoints),
    ...endpointValues(model?.metadata?.endpoints),
  ])
}

function endpointPreferenceFromValue(value: unknown): AIModel['preferredEndpoint'] | undefined {
  const values = endpointValues(value)
  if (values.some(isResponsesEndpointValue)) return 'responses'
  if (values.some(isChatCompletionsEndpointValue)) return 'chat-completions'
  return undefined
}

function endpointPreferenceFromSupportedValues(values: string[]): AIModel['preferredEndpoint'] | undefined {
  const hasResponses = values.some(isResponsesEndpointValue)
  const hasChatCompletions = values.some(isChatCompletionsEndpointValue)
  if (hasResponses && !hasChatCompletions) return 'responses'
  if (hasChatCompletions) return 'chat-completions'
  return undefined
}

function endpointValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(endpointValues)
  if (typeof value === 'string') return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean)
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .flatMap(([key, entry]) => entry === false || entry === null ? [] : [key, ...endpointValues(entry)])
  }
  return []
}

function isResponsesEndpointValue(value: string): boolean {
  return /(?:^|[/_-])responses?(?:$|[/_-])|response-api|responses-api/i.test(value)
}

function isChatCompletionsEndpointValue(value: string): boolean {
  return /chat[_/-]?completions?|chat-completion|\/chat\/completions/i.test(value)
}

function shouldGateOpenAICompatibleKnownDefaults(providerType: ProviderType, options: OpenAIModelMappingOptions): boolean {
  return providerType === 'openai-compatible' &&
    options.providerPresetId !== undefined &&
    METADATA_GATED_OPENAI_COMPATIBLE_PRESETS.has(options.providerPresetId)
}

function openAIModelSupportedParameterSet(model?: OpenAIModelListItem): Set<string> {
  return new Set(supportedParametersFromOpenAIModel(model) ?? [])
}

function normalizeSupportedParameter(value: string): string {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
  const key = normalized.replace(/[._]/g, '')
  if (key === 'responseformat') return 'response_format'
  if (key === 'structuredoutput' || key === 'structuredoutputs') return 'structured_outputs'
  if (key === 'textformat') return 'text.format'
  if (key === 'websearch') return 'web_search'
  if (key === 'websearchpreview') return 'web_search_preview'
  if (key === 'websearchoptions') return 'web_search_options'
  if (key === 'reasoningeffort') return 'reasoning_effort'
  if (key === 'toolchoice') return 'tool_choice'
  if (key === 'functioncalling') return 'function_calling'
  if (key === 'functioncall') return 'function_call'
  if (key === 'filedata') return 'file_data'
  if (key === 'fileurl') return 'file_url'
  if (key === 'inputfile') return 'input_file'
  if (key === 'enablethinking') return 'enable_thinking'
  if (key === 'thinkingbudget') return 'thinking_budget'
  return normalized
}

function openAIModelInputModalities(model?: OpenAIModelListItem): string[] {
  return [
    ...modalityValues(model?.architecture?.input_modalities),
    ...modalityValues(model?.architecture?.inputModalities),
    ...modalityValues(model?.architecture?.modality),
    ...inputModalityValues(model?.architecture?.modalities),
    ...modalityValues(model?.input_modalities),
    ...inputModalityValues(model?.modalities),
    ...modalityValues(model?.metadata?.input_modalities),
    ...modalityValues(model?.metadata?.inputModalities),
    ...inputModalityValues(model?.metadata?.modalities),
  ].map((item) => item.toLowerCase())
}

function inputModalityValues(value: unknown): string[] {
  if (Array.isArray(value) || typeof value === 'string') return modalityValues(value)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return [
      ...modalityValues(record.input),
      ...modalityValues(record.input_modalities),
      ...modalityValues(record.inputModalities),
    ]
  }
  return []
}

function modalityValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(modalityValues)
  if (typeof value === 'string') return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean)
  return []
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

function anthropicCapabilitiesIncludeThinking(capabilities: AnthropicModelListItem['capabilities']): boolean {
  if (Array.isArray(capabilities)) return capabilities.some((item) => /thinking|reasoning/i.test(item))
  if (capabilities && typeof capabilities === 'object') {
    return Object.entries(capabilities).some(([key, value]) => /thinking|reasoning/i.test(key) && value !== false)
  }
  return false
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
