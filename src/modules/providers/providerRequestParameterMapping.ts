import type { AIModel, AIProvider } from '@/types/providerContracts'
import {
  resolveModelCapabilityProfile,
  type ModelCapabilityProfile,
  type ModelRequestParameterCapability,
} from './modelCapabilityPolicy'
import type { ProviderRequestParameterEndpoint } from './providerRequestParameterPolicy'

export const PROVIDER_REQUEST_PARAMETER_MAPPING_SCHEMA = 'islemind.provider-request-parameter-mapping.v1' as const

export type ProviderRequestParameterValue =
  | number
  | string
  | readonly string[]
  | Readonly<Record<string, unknown>>

export interface ProviderResponseFormatValue {
  type: 'json_object' | 'json_schema'
  name?: string
  schema?: Readonly<Record<string, unknown>>
  strict?: boolean
}

export type ProviderRequestParameterValues = Partial<
  Readonly<Record<ModelRequestParameterCapability, ProviderRequestParameterValue>>
>

export interface ProviderRequestParameterMappingInput {
  provider: Pick<AIProvider, 'type' | 'wireProtocol'>
  endpoint: ProviderRequestParameterEndpoint
  model: AIModel | ModelCapabilityProfile
  values: ProviderRequestParameterValues
  maxTokensWireName?: string
}

export type ProviderRequestParameterMappingDecision = 'included' | 'omitted'

export type ProviderRequestParameterMappingReason =
  | 'included'
  | 'unsupported-model'
  | 'unsupported-endpoint'
  | 'unknown-capability'
  | 'invalid-value'

export interface ProviderRequestParameterMappingEntry {
  parameter: ModelRequestParameterCapability
  decision: ProviderRequestParameterMappingDecision
  reason: ProviderRequestParameterMappingReason
  wirePath?: readonly string[]
  value?: ProviderRequestParameterValue
}

export interface ProviderRequestParameterMappingResult {
  schema: typeof PROVIDER_REQUEST_PARAMETER_MAPPING_SCHEMA
  endpoint: ProviderRequestParameterEndpoint
  body: Readonly<Record<string, unknown>>
  entries: Readonly<Record<ModelRequestParameterCapability, ProviderRequestParameterMappingEntry>>
}

const PARAMETER_ORDER: readonly ModelRequestParameterCapability[] = [
  'temperature',
  'topP',
  'topK',
  'maxTokens',
  'frequencyPenalty',
  'presencePenalty',
  'stop',
  'seed',
  'responseFormat',
  'reasoningEffort',
  'thinkingBudget',
]

/**
 * Maps only capability-proven request parameters to provider wire paths.
 * Unknown model capabilities are deliberately omitted; provider protocol
 * support alone is not enough to justify sending a model-specific field.
 */
export function mapProviderRequestParameters(
  input: ProviderRequestParameterMappingInput,
): ProviderRequestParameterMappingResult {
  const profile = isModelCapabilityProfile(input.model)
    ? input.model
    : resolveModelCapabilityProfile(input.model)
  const body: Record<string, unknown> = {}
  const entries = {} as Record<ModelRequestParameterCapability, ProviderRequestParameterMappingEntry>

  for (const parameter of PARAMETER_ORDER) {
    const requested = input.values[parameter]
    const wirePath = providerParameterWirePath(input.endpoint, parameter, input.maxTokensWireName)
    if (requested === undefined) {
      entries[parameter] = {
        parameter,
        decision: 'omitted',
        reason: 'invalid-value',
        ...(wirePath ? { wirePath } : {}),
      }
      continue
    }

    const support = profile.parameters[parameter].support
    if (support === 'unknown') {
      entries[parameter] = { parameter, decision: 'omitted', reason: 'unknown-capability', ...(wirePath ? { wirePath } : {}) }
      continue
    }
    if (support !== 'supported') {
      entries[parameter] = { parameter, decision: 'omitted', reason: 'unsupported-model', ...(wirePath ? { wirePath } : {}) }
      continue
    }
    if (!wirePath) {
      entries[parameter] = { parameter, decision: 'omitted', reason: 'unsupported-endpoint' }
      continue
    }

    const mapped = mapParameterValue(input.endpoint, parameter, requested)
    if (!mapped) {
      entries[parameter] = { parameter, decision: 'omitted', reason: 'invalid-value', wirePath }
      continue
    }
    setPath(body, wirePath, mapped.value)
    entries[parameter] = {
      parameter,
      decision: 'included',
      reason: 'included',
      wirePath,
      value: requested,
    }
  }

  return {
    schema: PROVIDER_REQUEST_PARAMETER_MAPPING_SCHEMA,
    endpoint: input.endpoint,
    body,
    entries,
  }
}

export function providerParameterWirePath(
  endpoint: ProviderRequestParameterEndpoint,
  parameter: ModelRequestParameterCapability,
  maxTokensWireName?: string,
): readonly string[] | undefined {
  if (endpoint === 'openai-responses') {
    if (parameter === 'topK' || parameter === 'stop' || parameter === 'frequencyPenalty' || parameter === 'presencePenalty') return undefined
    if (parameter === 'maxTokens') return [maxTokensWireName ?? 'max_output_tokens']
    if (parameter === 'responseFormat') return ['text', 'format']
    if (parameter === 'reasoningEffort') return ['reasoning', 'effort']
    if (parameter === 'thinkingBudget') return undefined
    return [openAIWireName(parameter)]
  }
  if (endpoint === 'anthropic') {
    if (['frequencyPenalty', 'presencePenalty', 'seed', 'responseFormat', 'reasoningEffort'].includes(parameter)) return undefined
    if (parameter === 'maxTokens') return ['max_tokens']
    if (parameter === 'stop') return ['stop_sequences']
    if (parameter === 'thinkingBudget') return ['thinking', 'budget_tokens']
    return [anthropicWireName(parameter)]
  }
  if (endpoint === 'google') {
    if (parameter === 'frequencyPenalty' || parameter === 'presencePenalty' || parameter === 'reasoningEffort') return undefined
    if (parameter === 'responseFormat') return ['generationConfig']
    if (parameter === 'thinkingBudget') return ['generationConfig', 'thinkingConfig', 'thinkingBudget']
    return ['generationConfig', googleWireName(parameter)]
  }
  if (parameter === 'maxTokens') return [maxTokensWireName ?? 'max_tokens']
  if (parameter === 'responseFormat') return ['response_format']
  if (parameter === 'reasoningEffort') return ['reasoning_effort']
  if (parameter === 'thinkingBudget') return ['thinking_budget']
  return [openAIWireName(parameter)]
}

function mapParameterValue(
  endpoint: ProviderRequestParameterEndpoint,
  parameter: ModelRequestParameterCapability,
  value: ProviderRequestParameterValue,
): { value: unknown } | undefined {
  if (parameter === 'responseFormat') return mapResponseFormat(endpoint, value)
  if (parameter === 'stop') {
    if (typeof value === 'string' && value.length) return { value: endpoint === 'google' ? [value] : value }
    if (Array.isArray(value) && value.length && value.every((item) => typeof item === 'string' && item.length)) return { value: [...value] }
    return undefined
  }
  if (parameter === 'reasoningEffort') return typeof value === 'string' && value.trim() ? { value: value.trim() } : undefined
  if (parameter === 'thinkingBudget') return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? { value: Math.floor(value) } : undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (['topK', 'maxTokens', 'seed'].includes(parameter)) return Number.isSafeInteger(value) ? { value: Math.floor(value) } : undefined
  return { value }
}

function mapResponseFormat(
  endpoint: ProviderRequestParameterEndpoint,
  value: ProviderRequestParameterValue,
): { value: unknown } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const format = value as unknown as ProviderResponseFormatValue
  if (format.type !== 'json_object' && format.type !== 'json_schema') return undefined
  if (format.type === 'json_schema') {
    if (!format.schema || typeof format.schema !== 'object' || Array.isArray(format.schema)) return undefined
    if ((endpoint === 'openai-chat' || endpoint === 'openai-responses') && !format.name?.trim()) return undefined
  }
  if (endpoint === 'google') {
    return {
      value: {
        ...(format.type === 'json_object' || format.type === 'json_schema' ? { responseMimeType: 'application/json' } : {}),
        ...(format.schema ? { responseSchema: format.schema } : {}),
      },
    }
  }
  if (endpoint === 'openai-responses') {
    return {
      value: {
        type: format.type,
        ...(format.name ? { name: format.name.trim() } : {}),
        ...(format.schema ? { schema: format.schema } : {}),
        ...(format.strict !== undefined ? { strict: format.strict } : {}),
      },
    }
  }
  if (endpoint === 'openai-chat') {
    if (format.type === 'json_object') return { value: { type: 'json_object' } }
    return {
      value: {
        type: 'json_schema',
        json_schema: {
          name: format.name!.trim(),
          schema: format.schema,
          ...(format.strict !== undefined ? { strict: format.strict } : {}),
        },
      },
    }
  }
  return undefined
}

function openAIWireName(parameter: ModelRequestParameterCapability): string {
  return ({
    temperature: 'temperature',
    topP: 'top_p',
    topK: 'top_k',
    maxTokens: 'max_tokens',
    frequencyPenalty: 'frequency_penalty',
    presencePenalty: 'presence_penalty',
    stop: 'stop',
    seed: 'seed',
    responseFormat: 'response_format',
    reasoningEffort: 'reasoning_effort',
    thinkingBudget: 'thinking_budget',
  } as const)[parameter]
}

function anthropicWireName(parameter: ModelRequestParameterCapability): string {
  const names: Partial<Record<ModelRequestParameterCapability, string>> = {
    temperature: 'temperature',
    topP: 'top_p',
    topK: 'top_k',
    maxTokens: 'max_tokens',
    stop: 'stop_sequences',
    thinkingBudget: 'budget_tokens',
  }
  return names[parameter] ?? parameter
}

function googleWireName(parameter: ModelRequestParameterCapability): string {
  const names: Partial<Record<ModelRequestParameterCapability, string>> = {
    temperature: 'temperature',
    topP: 'topP',
    topK: 'topK',
    maxTokens: 'maxOutputTokens',
    stop: 'stopSequences',
    seed: 'seed',
  }
  return names[parameter] ?? parameter
}

function setPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let current = target
  for (const segment of path.slice(0, -1)) {
    const next = current[segment]
    if (!next || typeof next !== 'object' || Array.isArray(next)) current[segment] = {}
    current = current[segment] as Record<string, unknown>
  }
  const leaf = path[path.length - 1]!
  const existing = current[leaf]
  if (
    existing &&
    value &&
    typeof existing === 'object' &&
    typeof value === 'object' &&
    !Array.isArray(existing) &&
    !Array.isArray(value)
  ) {
    current[leaf] = { ...(existing as Record<string, unknown>), ...(value as Record<string, unknown>) }
  } else {
    current[leaf] = value
  }
}

function isModelCapabilityProfile(value: AIModel | ModelCapabilityProfile): value is ModelCapabilityProfile {
  return 'schema' in value && value.schema === 'islemind.model-capability-profile.v1'
}
