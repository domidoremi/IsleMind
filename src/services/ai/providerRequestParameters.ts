import type { AIProvider, ReasoningEffort, WebSearchMode } from '@/types'
import { getModelConfig } from '@/types'
import { isXiaomiMimoReasoningModel, modelSupportsSamplingControls } from '@/utils/modelReasoning'
import { isMiniMaxProvider } from '@/services/ai/providerIdentity'
import { providerCompatibilityCapabilityCanBeSentForProvider, providerCompatibilityReasoningExplicitlyDeclaredForModel } from '@/services/ai/providerCompatibilityContract'
import { clamp01 } from '@/services/ai/providerNumberUtils'
import {
  PROVIDER_PLATFORM_ANTHROPIC_MAX_TEMPERATURE,
  PROVIDER_PLATFORM_DEFAULT_TEMPERATURE,
  PROVIDER_PLATFORM_DEFAULT_TOP_P,
  PROVIDER_PLATFORM_MAX_TEMPERATURE,
  PROVIDER_PLATFORM_MAX_TOP_K,
  PROVIDER_PLATFORM_MAX_TOP_P,
  PROVIDER_PLATFORM_MIN_OUTPUT_TOKENS,
  PROVIDER_PLATFORM_MIN_TEMPERATURE,
  PROVIDER_PLATFORM_MIN_TOP_K,
  PROVIDER_PLATFORM_MIN_TOP_P,
  PROVIDER_PLATFORM_XIAOMI_MIMO_MAX_TEMPERATURE,
} from '@/services/ai/providerParameterDefaults'

export interface ProviderRequestParameterInput {
  provider: AIProvider
  model: string
  reasoningEffort?: ReasoningEffort
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
  webSearchMode?: WebSearchMode
  providerToolDeclarations?: readonly unknown[]
  messages?: {
    role: 'user' | 'assistant' | 'tool'
    reasoningContent?: string
    toolCalls?: readonly unknown[]
  }[]
}

export interface ProviderRequestParameterOptions {
  omitSampling?: boolean
  includeDefaultTopP?: boolean
  includeRanges?: boolean
  maxTokenParameterNames?: readonly string[]
}

export interface ProviderResolvedRequestParameters {
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
  temperatureRange?: ProviderRequestParameterRange
  topPRange?: ProviderRequestParameterRange
  topKRange?: ProviderRequestParameterRange
  maxTokensRange?: ProviderRequestParameterRange
  samplingControlsSupported: boolean
  temperatureSupported: boolean
  topPSupported: boolean
  topKSupported: boolean
}

export interface ProviderRequestParameterRange {
  min: number
  max: number
  defaultValue?: number
}

export function normalizeXiaomiMimoThinking(req: ProviderRequestParameterInput): { type: 'enabled' | 'disabled' } | undefined {
  if (!providerReasoningCanBeSent(req)) return undefined
  if (!isXiaomiMimoReasoningModel(req.provider, req.model)) return undefined
  if (!req.reasoningEffort && hasXiaomiMimoToolContext(req)) return { type: 'disabled' }
  if (!req.reasoningEffort) return undefined
  return req.reasoningEffort === 'none' ? { type: 'disabled' } : undefined
}

export function isXiaomiMimoThinkingActive(req: ProviderRequestParameterInput): boolean {
  if (!providerReasoningCanBeSent(req)) return false
  if (!isXiaomiMimoReasoningModel(req.provider, req.model)) return false
  if (req.reasoningEffort) return false
  if (hasXiaomiMimoToolContext(req)) return false
  return false
}

function hasXiaomiMimoToolContext(req: ProviderRequestParameterInput): boolean {
  return req.webSearchMode === 'native' ||
    Boolean(req.providerToolDeclarations?.length) ||
    Boolean(req.messages?.some((msg) => msg.role === 'tool' || msg.toolCalls?.length))
}

function providerReasoningCanBeSent(req: ProviderRequestParameterInput): boolean {
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  const explicitDeclaration = providerCompatibilityReasoningExplicitlyDeclaredForModel(req.provider, modelConfig)
  return providerCompatibilityCapabilityCanBeSentForProvider(req.provider, 'reasoning', explicitDeclaration)
}

export function supportsSamplingControls(req: ProviderRequestParameterInput): boolean {
  return modelSupportsSamplingControls(req.provider, req.model, req.reasoningEffort)
}

export function normalizeTemperature(req: ProviderRequestParameterInput): number | undefined {
  if (!supportsSamplingControls(req)) return undefined
  if (req.provider.type === 'xiaomi-mimo' && isXiaomiMimoThinkingActive(req)) return undefined
  const config = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  if (!modelParameterCanBeSent(config, ['temperature'])) return undefined
  const range = resolveTemperatureRange(req, config)
  const requested = req.temperature ?? range.defaultValue ?? PROVIDER_PLATFORM_DEFAULT_TEMPERATURE
  return clampToRange(requested, range)
}

export function clampMaxTokens(req: ProviderRequestParameterInput): number {
  const config = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  const requested = req.maxTokens ?? config.defaultMaxTokens
  return Math.max(PROVIDER_PLATFORM_MIN_OUTPUT_TOKENS, Math.min(config.maxOutputTokens, requested))
}

export function resolveProviderRequestParameters(
  req: ProviderRequestParameterInput,
  options: ProviderRequestParameterOptions = {}
): ProviderResolvedRequestParameters {
  const config = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  const samplingControlsSupported = !options.omitSampling && supportsSamplingControls(req)
  const temperatureSupported = samplingControlsSupported && modelParameterCanBeSent(config, ['temperature'])
  const topPSupported = samplingControlsSupported && req.provider.capabilities?.topP !== false && modelParameterCanBeSent(config, ['top_p', 'topP'])
  const topKSupported = samplingControlsSupported && modelParameterCanBeSent(config, ['top_k', 'topK'], false)
  const maxTokensSupported = modelParameterCanBeSent(
    config,
    options.maxTokenParameterNames ?? ['max_tokens', 'maxTokens', 'max_completion_tokens', 'maxCompletionTokens', 'max_output_tokens', 'maxOutputTokens', 'generationConfig.maxOutputTokens'],
  )
  const topPSource = req.topP ?? (options.includeDefaultTopP ? PROVIDER_PLATFORM_DEFAULT_TOP_P : undefined)
  const topK = req.topK !== undefined && Number.isFinite(req.topK) ? Math.max(PROVIDER_PLATFORM_MIN_TOP_K, Math.floor(req.topK)) : undefined
  const topKRange = topKSupported ? resolveTopKRange() : undefined
  const ranges = options.includeRanges ? {
    ...(temperatureSupported ? { temperatureRange: resolveTemperatureRange(req, config) } : {}),
    ...(topPSupported ? { topPRange: resolveTopPRange() } : {}),
    ...(topKRange ? { topKRange } : {}),
    ...(maxTokensSupported ? { maxTokensRange: resolveMaxTokensRange(config) } : {}),
  } : {}
  return {
    temperature: temperatureSupported ? normalizeTemperature(req) : undefined,
    topP: topPSupported && topPSource !== undefined ? clamp01(topPSource) : undefined,
    topK: topKSupported && topK !== undefined && topKRange ? Math.floor(clampToRange(topK, topKRange)) : undefined,
    maxTokens: maxTokensSupported ? clampMaxTokens(req) : undefined,
    ...ranges,
    samplingControlsSupported,
    temperatureSupported,
    topPSupported,
    topKSupported,
  }
}

function resolveTemperatureRange(
  req: ProviderRequestParameterInput,
  config: ReturnType<typeof getModelConfig>
): ProviderRequestParameterRange {
  return {
    min: PROVIDER_PLATFORM_MIN_TEMPERATURE,
    max: config.maxTemperature ?? fallbackMaxTemperature(req),
    defaultValue: config.defaultTemperature ?? fallbackDefaultTemperature(req),
  }
}

function fallbackDefaultTemperature(req: ProviderRequestParameterInput): number {
  return isMiniMaxProvider(req.provider) ? 1 : PROVIDER_PLATFORM_DEFAULT_TEMPERATURE
}

function fallbackMaxTemperature(req: ProviderRequestParameterInput): number {
  if (req.provider.type === 'xiaomi-mimo') return PROVIDER_PLATFORM_XIAOMI_MIMO_MAX_TEMPERATURE
  if (req.provider.type === 'anthropic' || req.provider.wireProtocol === 'anthropic-compatible') return PROVIDER_PLATFORM_ANTHROPIC_MAX_TEMPERATURE
  return PROVIDER_PLATFORM_MAX_TEMPERATURE
}

function resolveTopPRange(): ProviderRequestParameterRange {
  return {
    min: PROVIDER_PLATFORM_MIN_TOP_P,
    max: PROVIDER_PLATFORM_MAX_TOP_P,
    defaultValue: PROVIDER_PLATFORM_DEFAULT_TOP_P,
  }
}

function resolveTopKRange(): ProviderRequestParameterRange {
  return {
    min: PROVIDER_PLATFORM_MIN_TOP_K,
    max: PROVIDER_PLATFORM_MAX_TOP_K,
  }
}

function resolveMaxTokensRange(config: ReturnType<typeof getModelConfig>): ProviderRequestParameterRange {
  return {
    min: PROVIDER_PLATFORM_MIN_OUTPUT_TOKENS,
    max: config.maxOutputTokens,
    defaultValue: Math.min(config.defaultMaxTokens, config.maxOutputTokens),
  }
}

function clampToRange(value: number, range: ProviderRequestParameterRange): number {
  return Math.max(range.min, Math.min(range.max, value))
}

function modelParameterCanBeSent(
  config: ReturnType<typeof getModelConfig>,
  names: readonly string[],
  defaultAllowed = true
): boolean {
  if (!config.supportedParameters?.length) return defaultAllowed
  const supported = new Set(config.supportedParameters.map(normalizeRequestParameterName))
  return names.some((name) => supported.has(normalizeRequestParameterName(name)))
}

function normalizeRequestParameterName(value: string): string {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
  const key = normalized.replace(/[._]/g, '')
  if (key === 'topp') return 'top_p'
  if (key === 'topk') return 'top_k'
  if (key === 'maxtokens') return 'max_tokens'
  if (key === 'maxcompletiontokens') return 'max_completion_tokens'
  if (key === 'maxoutputtokens') return 'max_output_tokens'
  return normalized
}
