import type { AIModel, AIProvider } from '@/types/providerContracts'
import type { WebSearchMode } from '@/types/settingsContracts'
import type {
  GenerationParameterKey,
  GenerationParameterSource,
  GenerationParameterSources,
  ReasoningEffort,
} from '@/core'

export interface ProviderRequestParameterInput {
  provider: AIProvider
  model: string
  reasoningEffort?: ReasoningEffort
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
  generationParameterSources: GenerationParameterSources
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
  endpoint?: ProviderRequestParameterEndpoint
  maxTokensRequired?: boolean
}

export type ProviderRequestParameterEndpoint =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic'
  | 'google'

export type ProviderRequestParameterDecision = 'included' | 'omitted'

export type ProviderRequestParameterReason =
  | 'explicit-value'
  | 'internal-policy-value'
  | 'required-endpoint-fallback'
  | 'provider-default'
  | 'unsupported-model'
  | 'unsupported-endpoint'
  | 'reasoning-conflict'
  | 'invalid-value'

export interface ProviderRequestParameterPlanEntry {
  parameter: GenerationParameterKey
  decision: ProviderRequestParameterDecision
  source: GenerationParameterSource
  reason: ProviderRequestParameterReason
  wirePath?: readonly string[]
  value?: number
}

export const PROVIDER_REQUEST_PARAMETER_PLAN_SCHEMA = 'islemind.provider-request-parameter-plan.v1'

export interface ProviderRequestParameterPlan {
  schema: typeof PROVIDER_REQUEST_PARAMETER_PLAN_SCHEMA
  endpoint: ProviderRequestParameterEndpoint
  entries: Readonly<Record<GenerationParameterKey, ProviderRequestParameterPlanEntry>>
}

export interface ProviderRequestParameterSupportEntry {
  supported: boolean
  reason: 'supported' | 'unsupported-model' | 'unsupported-endpoint'
  wirePath?: readonly string[]
}

export interface ProviderRequestParameterSupport {
  endpoint: ProviderRequestParameterEndpoint
  entries: Readonly<Record<GenerationParameterKey, ProviderRequestParameterSupportEntry>>
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
  parameterPlan: ProviderRequestParameterPlan
  samplingControlsSupported: boolean
  temperatureSupported: boolean
  topPSupported: boolean
  topKSupported: boolean
  maxTokensSupported: boolean
}

export interface ProviderRequestParameterRange {
  min: number
  max: number
  defaultValue?: number
}

export interface ProviderRequestParameterLimits {
  defaultTemperature: number
  minTemperature: number
  maxTemperature: number
  anthropicMaxTemperature: number
  xiaomiMimoMaxTemperature: number
  defaultTopP: number
  minTopP: number
  maxTopP: number
  minTopK: number
  maxTopK: number
  minOutputTokens: number
}

export interface ProviderRequestParameterPolicyDependencies {
  limits: ProviderRequestParameterLimits
  resolveModelConfig(model: string, provider: AIProvider): AIModel
  modelSupportsSamplingControls(provider: AIProvider, model: string, reasoningEffort?: ReasoningEffort): boolean
  isXiaomiMimoReasoningModel(provider: AIProvider, model: string): boolean
  isMiniMaxProvider(provider: AIProvider): boolean
  providerCompatibilityReasoningExplicitlyDeclaredForModel(provider: AIProvider, modelConfig: AIModel): boolean
  providerCompatibilityCapabilityCanBeSentForProvider(
    provider: AIProvider,
    capability: 'reasoning',
    explicitDeclaration?: boolean,
  ): boolean
}

export interface ProviderRequestParameterPolicy {
  normalizeXiaomiMimoThinking(request: ProviderRequestParameterInput): { type: 'enabled' | 'disabled' } | undefined
  isXiaomiMimoThinkingActive(request: ProviderRequestParameterInput): boolean
  supportsSamplingControls(request: ProviderRequestParameterInput): boolean
  normalizeTemperature(request: ProviderRequestParameterInput): number | undefined
  clampMaxTokens(request: ProviderRequestParameterInput): number
  resolveProviderRequestParameters(
    request: ProviderRequestParameterInput,
    options?: ProviderRequestParameterOptions,
  ): ProviderResolvedRequestParameters
}

export function createProviderRequestParameterPolicy(
  dependencies: ProviderRequestParameterPolicyDependencies,
): ProviderRequestParameterPolicy {
  const { limits } = dependencies

  function providerReasoningCanBeSent(request: ProviderRequestParameterInput): boolean {
    const modelConfig = dependencies.resolveModelConfig(request.model, request.provider)
    const explicitDeclaration = dependencies.providerCompatibilityReasoningExplicitlyDeclaredForModel(request.provider, modelConfig)
    return dependencies.providerCompatibilityCapabilityCanBeSentForProvider(request.provider, 'reasoning', explicitDeclaration)
  }

  function hasXiaomiMimoToolContext(request: ProviderRequestParameterInput): boolean {
    return request.webSearchMode === 'native' ||
      Boolean(request.providerToolDeclarations?.length) ||
      Boolean(request.messages?.some((message) => message.role === 'tool' || message.toolCalls?.length))
  }

  function normalizeXiaomiMimoThinking(
    request: ProviderRequestParameterInput,
  ): { type: 'enabled' | 'disabled' } | undefined {
    if (!providerReasoningCanBeSent(request)) return undefined
    if (!dependencies.isXiaomiMimoReasoningModel(request.provider, request.model)) return undefined
    if (!request.reasoningEffort && hasXiaomiMimoToolContext(request)) return { type: 'disabled' }
    if (!request.reasoningEffort) return undefined
    return request.reasoningEffort === 'none' ? { type: 'disabled' } : undefined
  }

  function isXiaomiMimoThinkingActive(request: ProviderRequestParameterInput): boolean {
    if (!providerReasoningCanBeSent(request)) return false
    if (!dependencies.isXiaomiMimoReasoningModel(request.provider, request.model)) return false
    if (request.reasoningEffort) return false
    if (hasXiaomiMimoToolContext(request)) return false
    return false
  }

  function supportsSamplingControls(request: ProviderRequestParameterInput): boolean {
    return dependencies.modelSupportsSamplingControls(request.provider, request.model, request.reasoningEffort)
  }

  function fallbackDefaultTemperature(request: ProviderRequestParameterInput): number {
    return dependencies.isMiniMaxProvider(request.provider) ? 1 : limits.defaultTemperature
  }

  function fallbackMaxTemperature(request: ProviderRequestParameterInput): number {
    if (request.provider.type === 'xiaomi-mimo') return limits.xiaomiMimoMaxTemperature
    if (request.provider.type === 'anthropic' || request.provider.wireProtocol === 'anthropic-compatible') {
      return limits.anthropicMaxTemperature
    }
    return limits.maxTemperature
  }

  function resolveTemperatureRange(
    request: ProviderRequestParameterInput,
    config: AIModel,
  ): ProviderRequestParameterRange {
    return {
      min: limits.minTemperature,
      max: config.maxTemperature ?? fallbackMaxTemperature(request),
      defaultValue: config.defaultTemperature ?? fallbackDefaultTemperature(request),
    }
  }

  function normalizeTemperature(request: ProviderRequestParameterInput): number | undefined {
    if (!supportsSamplingControls(request)) return undefined
    if (request.provider.type === 'xiaomi-mimo' && isXiaomiMimoThinkingActive(request)) return undefined
    const config = dependencies.resolveModelConfig(request.model, request.provider)
    if (!modelParameterCanBeSent(config, ['temperature'])) return undefined
    const range = resolveTemperatureRange(request, config)
    const requested = request.temperature ?? range.defaultValue ?? limits.defaultTemperature
    return clampToRange(requested, range)
  }

  function clampMaxTokens(request: ProviderRequestParameterInput): number {
    const config = dependencies.resolveModelConfig(request.model, request.provider)
    const requested = request.maxTokens ?? config.defaultMaxTokens
    return Math.max(limits.minOutputTokens, Math.min(config.maxOutputTokens, requested))
  }

  function resolveProviderRequestParameters(
    request: ProviderRequestParameterInput,
    options: ProviderRequestParameterOptions = {},
  ): ProviderResolvedRequestParameters {
    const config = dependencies.resolveModelConfig(request.model, request.provider)
    const endpoint = options.endpoint ?? inferRequestParameterEndpoint(request.provider, config)
    const endpointSupport = resolveProviderRequestParameterSupport(
      request.provider,
      config,
      endpoint,
      options.maxTokenParameterNames,
    )
    const samplingControlsSupported = !options.omitSampling && supportsSamplingControls(request)
    const temperatureSupported = samplingControlsSupported && endpointSupport.entries.temperature.supported
    const topPSupported = samplingControlsSupported && endpointSupport.entries.topP.supported
    const topKSupported = samplingControlsSupported && endpointSupport.entries.topK.supported
    const maxTokensSupported = endpointSupport.entries.maxTokens.supported
    const topKRange = topKSupported ? resolveTopKRange(limits) : undefined
    const temperatureRange = temperatureSupported ? resolveTemperatureRange(request, config) : undefined
    const topPRange = topPSupported ? resolveTopPRange(limits) : undefined
    const maxTokensRange = maxTokensSupported ? resolveMaxTokensRange(config, limits) : undefined
    const parameterPlan = buildParameterPlan({
      request,
      options,
      endpoint,
      config,
      supported: {
        temperature: temperatureSupported,
        topP: topPSupported,
        topK: topKSupported,
        maxTokens: maxTokensSupported,
      },
      ranges: {
        temperature: temperatureRange,
        topP: topPRange,
        topK: topKRange,
        maxTokens: maxTokensRange,
      },
      limits,
    })
    const ranges = options.includeRanges ? {
      ...(temperatureRange ? { temperatureRange } : {}),
      ...(topPRange ? { topPRange } : {}),
      ...(topKRange ? { topKRange } : {}),
      ...(maxTokensRange ? { maxTokensRange } : {}),
    } : {}

    return {
      ...includedParameterValues(parameterPlan),
      ...ranges,
      parameterPlan,
      samplingControlsSupported,
      temperatureSupported,
      topPSupported,
      topKSupported,
      maxTokensSupported,
    }
  }

  return {
    normalizeXiaomiMimoThinking,
    isXiaomiMimoThinkingActive,
    supportsSamplingControls,
    normalizeTemperature,
    clampMaxTokens,
    resolveProviderRequestParameters,
  }
}

interface ParameterPlanInput {
  request: ProviderRequestParameterInput
  options: ProviderRequestParameterOptions
  endpoint: ProviderRequestParameterEndpoint
  config: AIModel
  supported: Record<GenerationParameterKey, boolean>
  ranges: Partial<Record<GenerationParameterKey, ProviderRequestParameterRange>>
  limits: ProviderRequestParameterLimits
}

function buildParameterPlan(input: ParameterPlanInput): ProviderRequestParameterPlan {
  const entries = {} as Record<GenerationParameterKey, ProviderRequestParameterPlanEntry>
  for (const parameter of ['temperature', 'topP', 'topK', 'maxTokens'] as const) {
    entries[parameter] = planParameter(input, parameter)
  }
  return {
    schema: PROVIDER_REQUEST_PARAMETER_PLAN_SCHEMA,
    endpoint: input.endpoint,
    entries,
  }
}

function planParameter(
  input: ParameterPlanInput,
  parameter: GenerationParameterKey,
): ProviderRequestParameterPlanEntry {
  let source = resolveParameterSource(input.request, parameter)
  const rawValue = input.request[parameter]
  const wirePath = parameterWirePath(input.endpoint, parameter, input.options.maxTokenParameterNames)

  if (parameter !== 'maxTokens' && input.options.omitSampling) {
    return { parameter, decision: 'omitted', source, reason: 'reasoning-conflict', ...(wirePath ? { wirePath } : {}) }
  }
  if (!endpointSupportsParameter(input.endpoint, parameter)) {
    return { parameter, decision: 'omitted', source, reason: 'unsupported-endpoint' }
  }
  if (!input.supported[parameter]) {
    return { parameter, decision: 'omitted', source, reason: 'unsupported-model', ...(wirePath ? { wirePath } : {}) }
  }
  if (source === 'provider-default') {
    if (parameter !== 'maxTokens' || input.options.maxTokensRequired !== true) {
      return { parameter, decision: 'omitted', source, reason: 'provider-default', ...(wirePath ? { wirePath } : {}) }
    }
    source = 'internal-policy'
    const value = Math.floor(clampToRange(input.config.defaultMaxTokens, input.ranges.maxTokens!))
    return { parameter, decision: 'included', source, reason: 'required-endpoint-fallback', wirePath: wirePath!, value }
  }

  const value = resolveParameterValue(input, parameter, rawValue, source)
  if (value === undefined) {
    return { parameter, decision: 'omitted', source, reason: 'invalid-value', ...(wirePath ? { wirePath } : {}) }
  }
  return {
    parameter,
    decision: 'included',
    source,
    reason: source === 'explicit' ? 'explicit-value' : 'internal-policy-value',
    wirePath: wirePath!,
    value,
  }
}

function resolveParameterSource(
  request: ProviderRequestParameterInput,
  parameter: GenerationParameterKey,
): GenerationParameterSource {
  return request.generationParameterSources?.[parameter] ?? 'provider-default'
}

function resolveParameterValue(
  input: ParameterPlanInput,
  parameter: GenerationParameterKey,
  rawValue: number | undefined,
  source: GenerationParameterSource,
): number | undefined {
  const range = input.ranges[parameter]
  if (!range) return undefined
  let value = rawValue
  if (value === undefined && source === 'internal-policy') {
    if (parameter === 'topP' && input.options.includeDefaultTopP) value = input.limits.defaultTopP
    else if (parameter === 'temperature') value = range.defaultValue ?? input.limits.defaultTemperature
    else if (parameter === 'maxTokens') value = range.defaultValue ?? input.config.defaultMaxTokens
  }
  if (value === undefined || !Number.isFinite(value)) return undefined
  const clamped = clampToRange(value, range)
  return parameter === 'topK' || parameter === 'maxTokens' ? Math.floor(clamped) : clamped
}

function includedParameterValues(
  plan: ProviderRequestParameterPlan,
): Pick<ProviderResolvedRequestParameters, 'temperature' | 'topP' | 'topK' | 'maxTokens'> {
  const values: Partial<Record<GenerationParameterKey, number>> = {}
  for (const parameter of ['temperature', 'topP', 'topK', 'maxTokens'] as const) {
    const entry = plan.entries[parameter]
    if (entry.decision === 'included' && entry.value !== undefined) values[parameter] = entry.value
  }
  return values
}

function inferRequestParameterEndpoint(
  provider: AIProvider,
  config: AIModel,
): ProviderRequestParameterEndpoint {
  if (provider.type === 'google') return 'google'
  if (provider.type === 'anthropic' || provider.wireProtocol === 'anthropic-compatible') return 'anthropic'
  if (config.preferredEndpoint === 'responses' && provider.capabilities?.responsesApi !== false) return 'openai-responses'
  return 'openai-chat'
}

export function resolveProviderRequestParameterSupport(
  provider: AIProvider,
  config: AIModel,
  endpoint: ProviderRequestParameterEndpoint = inferRequestParameterEndpoint(provider, config),
  maxTokenParameterNames: readonly string[] = defaultMaxTokenParameterNames(endpoint),
): ProviderRequestParameterSupport {
  const modelSupport: Record<GenerationParameterKey, boolean> = {
    temperature: modelParameterCanBeSent(config, ['temperature']),
    topP: provider.capabilities?.topP !== false && modelParameterCanBeSent(config, ['top_p', 'topP']),
    topK: modelParameterCanBeSent(
      config,
      ['top_k', 'topK'],
      endpoint === 'anthropic' || endpoint === 'google',
    ),
    maxTokens: modelParameterCanBeSent(config, maxTokenParameterNames),
  }
  const entries = {} as Record<GenerationParameterKey, ProviderRequestParameterSupportEntry>
  for (const parameter of ['temperature', 'topP', 'topK', 'maxTokens'] as const) {
    const wirePath = parameterWirePath(endpoint, parameter, maxTokenParameterNames)
    entries[parameter] = !endpointSupportsParameter(endpoint, parameter)
      ? { supported: false, reason: 'unsupported-endpoint' }
      : !modelSupport[parameter]
        ? { supported: false, reason: 'unsupported-model', ...(wirePath ? { wirePath } : {}) }
        : { supported: true, reason: 'supported', ...(wirePath ? { wirePath } : {}) }
  }
  return { endpoint, entries }
}

function defaultMaxTokenParameterNames(endpoint: ProviderRequestParameterEndpoint): readonly string[] {
  if (endpoint === 'google') return ['maxOutputTokens', 'generationConfig.maxOutputTokens']
  if (endpoint === 'openai-responses') return ['max_output_tokens', 'maxOutputTokens']
  if (endpoint === 'openai-chat') return ['max_tokens', 'maxTokens', 'max_completion_tokens', 'maxCompletionTokens']
  return ['max_tokens', 'maxTokens']
}

function endpointSupportsParameter(
  endpoint: ProviderRequestParameterEndpoint,
  parameter: GenerationParameterKey,
): boolean {
  return endpoint !== 'openai-responses' || parameter !== 'topK'
}

function parameterWirePath(
  endpoint: ProviderRequestParameterEndpoint,
  parameter: GenerationParameterKey,
  maxTokenParameterNames?: readonly string[],
): readonly string[] | undefined {
  if (!endpointSupportsParameter(endpoint, parameter)) return undefined
  if (endpoint === 'google') {
    return ['generationConfig', ({ temperature: 'temperature', topP: 'topP', topK: 'topK', maxTokens: 'maxOutputTokens' } as const)[parameter]]
  }
  if (parameter === 'topP') return ['top_p']
  if (parameter === 'topK') return ['top_k']
  if (parameter === 'maxTokens') {
    if (endpoint === 'openai-chat' && maxTokenParameterNames?.[0]) return maxTokenParameterNames[0].split('.')
    return [endpoint === 'openai-responses' ? 'max_output_tokens' : 'max_tokens']
  }
  return ['temperature']
}

function resolveTopPRange(limits: ProviderRequestParameterLimits): ProviderRequestParameterRange {
  return {
    min: limits.minTopP,
    max: limits.maxTopP,
    defaultValue: limits.defaultTopP,
  }
}

function resolveTopKRange(limits: ProviderRequestParameterLimits): ProviderRequestParameterRange {
  return {
    min: limits.minTopK,
    max: limits.maxTopK,
  }
}

function resolveMaxTokensRange(
  config: AIModel,
  limits: ProviderRequestParameterLimits,
): ProviderRequestParameterRange {
  return {
    min: limits.minOutputTokens,
    max: config.maxOutputTokens,
    defaultValue: Math.min(config.defaultMaxTokens, config.maxOutputTokens),
  }
}

function clampToRange(value: number, range: ProviderRequestParameterRange): number {
  return Math.max(range.min, Math.min(range.max, value))
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function modelParameterCanBeSent(
  config: AIModel,
  names: readonly string[],
  defaultAllowed = true,
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
