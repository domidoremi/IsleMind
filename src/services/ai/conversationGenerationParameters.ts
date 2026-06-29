import type { AIProvider, Conversation, ConversationGenerationParameterKey, Settings } from '@/types'
import { getModelConfig } from '@/types'
import {
  PROVIDER_PLATFORM_DEFAULT_TEMPERATURE,
  PROVIDER_PLATFORM_DEFAULT_TOP_P,
  PROVIDER_PLATFORM_MAX_TEMPERATURE,
  PROVIDER_PLATFORM_MAX_TOP_K,
  PROVIDER_PLATFORM_MAX_TOP_P,
  PROVIDER_PLATFORM_MIN_OUTPUT_TOKENS,
  PROVIDER_PLATFORM_MIN_TEMPERATURE,
  PROVIDER_PLATFORM_MIN_TOP_K,
  PROVIDER_PLATFORM_MIN_TOP_P,
} from '@/services/ai/providerParameterDefaults'
import { resolveProviderRequestParameters, type ProviderRequestParameterRange } from '@/services/ai/providerRequestParameters'

export interface ConversationGenerationParameterRanges {
  temperature: ProviderRequestParameterRange
  topP: ProviderRequestParameterRange
  topK: ProviderRequestParameterRange
  maxTokens: ProviderRequestParameterRange
}

export interface ConversationGenerationParameterDefaultOverrides {
  temperature?: number
  maxTokens?: number
}

export interface ConversationGenerationParameterRangeInput {
  provider?: AIProvider | null
  model: string
  reasoningEffort?: Conversation['reasoningEffort']
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
  modelConfig?: ReturnType<typeof getModelConfig>
}

export interface ConversationGenerationParameterRequestInput {
  provider?: AIProvider | null
  conversation: Pick<Conversation, 'model' | 'reasoningEffort' | 'temperature' | 'topP' | 'topK' | 'maxTokens'>
  settings?: Pick<Settings, 'defaultTemperature' | 'defaultMaxTokens'>
  model?: string
  modelConfig?: ReturnType<typeof getModelConfig>
  temperatureCap?: number
}

export interface ConversationGenerationParameterRequest {
  temperature: number
  topP?: number
  topK?: number
  maxTokens: number
}

export function resolveConversationGenerationParameterRanges(
  input: ConversationGenerationParameterRangeInput
): ConversationGenerationParameterRanges {
  const config = input.modelConfig ?? getModelConfig(input.model, input.provider?.type, input.provider?.modelConfigs)
  const resolved = input.provider ? resolveProviderRequestParameters({
    provider: input.provider,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    temperature: input.temperature,
    topP: input.topP,
    topK: input.topK,
    maxTokens: input.maxTokens,
  }, { includeRanges: true, includeDefaultTopP: true }) : undefined

  return {
    temperature: resolved?.temperatureRange ?? {
      min: PROVIDER_PLATFORM_MIN_TEMPERATURE,
      max: config.maxTemperature ?? PROVIDER_PLATFORM_MAX_TEMPERATURE,
      defaultValue: config.defaultTemperature ?? PROVIDER_PLATFORM_DEFAULT_TEMPERATURE,
    },
    topP: resolved?.topPRange ?? {
      min: PROVIDER_PLATFORM_MIN_TOP_P,
      max: PROVIDER_PLATFORM_MAX_TOP_P,
      defaultValue: PROVIDER_PLATFORM_DEFAULT_TOP_P,
    },
    topK: resolved?.topKRange ?? {
      min: PROVIDER_PLATFORM_MIN_TOP_K,
      max: PROVIDER_PLATFORM_MAX_TOP_K,
    },
    maxTokens: resolved?.maxTokensRange ?? {
      min: PROVIDER_PLATFORM_MIN_OUTPUT_TOKENS,
      max: config.maxOutputTokens,
      defaultValue: Math.min(config.defaultMaxTokens, config.maxOutputTokens),
    },
  }
}

export function resolveConversationGenerationParameterDefault(
  key: ConversationGenerationParameterKey,
  ranges: ConversationGenerationParameterRanges,
  overrides: ConversationGenerationParameterDefaultOverrides = {}
): number | undefined {
  switch (key) {
    case 'temperature':
      return clampToParameterRange(overrides.temperature ?? ranges.temperature.defaultValue ?? PROVIDER_PLATFORM_DEFAULT_TEMPERATURE, ranges.temperature)
    case 'topP':
      return clampToParameterRange(ranges.topP.defaultValue ?? PROVIDER_PLATFORM_DEFAULT_TOP_P, ranges.topP)
    case 'topK':
      return undefined
    case 'maxTokens':
      return Math.floor(clampToParameterRange(overrides.maxTokens ?? ranges.maxTokens.defaultValue ?? ranges.maxTokens.max, ranges.maxTokens))
  }
}

export function clampConversationGenerationParameter(
  key: ConversationGenerationParameterKey,
  value: number | undefined,
  ranges: ConversationGenerationParameterRanges
): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  switch (key) {
    case 'temperature':
      return clampToParameterRange(value, ranges.temperature)
    case 'topP':
      return clampToParameterRange(value, ranges.topP)
    case 'topK':
      return Math.floor(clampToParameterRange(value, ranges.topK))
    case 'maxTokens':
      return Math.floor(clampToParameterRange(value, ranges.maxTokens))
  }
}

export function conversationGenerationParameterDiffersFromDefault(
  key: ConversationGenerationParameterKey,
  value: number | undefined,
  ranges: ConversationGenerationParameterRanges,
  overrides: ConversationGenerationParameterDefaultOverrides = {}
): boolean {
  if (key === 'topK') return value !== undefined && Number.isFinite(value)
  if (value === undefined || !Number.isFinite(value)) return false
  const defaultValue = resolveConversationGenerationParameterDefault(key, ranges, overrides)
  if (defaultValue === undefined) return true
  if (key === 'maxTokens') return Math.floor(value) !== Math.floor(defaultValue)
  return !numbersClose(value, defaultValue)
}

export function resolveConversationGenerationParameterRequest(
  input: ConversationGenerationParameterRequestInput
): ConversationGenerationParameterRequest {
  const model = input.model ?? input.conversation.model
  const ranges = resolveConversationGenerationParameterRanges({
    provider: input.provider,
    model,
    reasoningEffort: input.conversation.reasoningEffort,
    temperature: input.conversation.temperature,
    topP: input.conversation.topP,
    topK: input.conversation.topK,
    maxTokens: input.conversation.maxTokens,
    modelConfig: input.modelConfig,
  })
  const requestedTemperature = typeof input.temperatureCap === 'number' && Number.isFinite(input.temperatureCap)
    ? Math.min(input.conversation.temperature, input.temperatureCap)
    : input.conversation.temperature
  return {
    temperature: clampConversationGenerationParameter('temperature', requestedTemperature, ranges) ??
      resolveConversationGenerationParameterDefault('temperature', ranges, { temperature: input.settings?.defaultTemperature }) ??
      input.conversation.temperature,
    topP: input.conversation.topP === undefined ? undefined : clampConversationGenerationParameter('topP', input.conversation.topP, ranges),
    topK: input.conversation.topK === undefined ? undefined : clampConversationGenerationParameter('topK', input.conversation.topK, ranges),
    maxTokens: clampConversationGenerationParameter('maxTokens', input.conversation.maxTokens, ranges) ??
      resolveConversationGenerationParameterDefault('maxTokens', ranges, { maxTokens: input.settings?.defaultMaxTokens }) ??
      input.conversation.maxTokens,
  }
}

export function clampToParameterRange(value: number, range: ProviderRequestParameterRange): number {
  return Math.max(range.min, Math.min(range.max, value))
}

function numbersClose(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.000001
}
