import type { ReasoningEffort } from '@/core'
import type { AIModel, ModelReasoningMode, ProviderType } from '@/types/providerContracts'

export const MODEL_CAPABILITY_PROFILE_SCHEMA = 'islemind.model-capability-profile.v1' as const

export type ModelCapabilitySupport = 'supported' | 'unsupported' | 'unknown'

export type ModelCapabilityConfidence =
  | 'verified'
  | 'declared'
  | 'inferred'
  | 'unknown'

export type ModelCapabilityEvidenceSource =
  | 'official-model-doc'
  | 'remote-model-metadata'
  | 'built-in-catalog'
  | 'inferred-default'
  | 'missing-evidence'

export type ModelInputModality = 'text' | 'image' | 'audio' | 'video' | 'file'
export type ModelOutputModality = 'text' | 'image' | 'audio'

export type ModelFeatureCapability =
  | 'chat'
  | 'streaming'
  | 'toolCalling'
  | 'structuredOutput'
  | 'vision'
  | 'audioInput'
  | 'audioOutput'
  | 'reasoning'
  | 'promptCache'
  | 'responseFormat'

export type ModelRequestParameterCapability =
  | 'temperature'
  | 'topP'
  | 'topK'
  | 'maxTokens'
  | 'frequencyPenalty'
  | 'presencePenalty'
  | 'stop'
  | 'seed'
  | 'responseFormat'
  | 'reasoningEffort'
  | 'thinkingBudget'

export interface ModelCapabilityEvidence {
  source: ModelCapabilityEvidenceSource
  confidence: ModelCapabilityConfidence
  reason: string
  sourceUrl?: string
  verifiedAt?: string
}

export interface ModelCapabilityStatus {
  support: ModelCapabilitySupport
  evidence: ModelCapabilityEvidence
}

export interface ModelCapabilityLimit {
  value?: number
  confidence: ModelCapabilityConfidence
  evidence: ModelCapabilityEvidence
}

export interface ModelReasoningCapability extends ModelCapabilityStatus {
  mode?: ModelReasoningMode
  efforts: readonly ReasoningEffort[]
}

export interface ModelCapabilityProfile {
  schema: typeof MODEL_CAPABILITY_PROFILE_SCHEMA
  modelId: string
  provider: ProviderType
  modelSource: NonNullable<AIModel['source']>
  limits: {
    contextWindow: ModelCapabilityLimit
    maxOutputTokens: ModelCapabilityLimit
    defaultMaxOutputTokens: ModelCapabilityLimit
  }
  inputModalities: Readonly<Record<ModelInputModality, ModelCapabilityStatus>>
  outputModalities: Readonly<Record<ModelOutputModality, ModelCapabilityStatus>>
  features: Readonly<Record<ModelFeatureCapability, ModelCapabilityStatus>>
  parameters: Readonly<Record<ModelRequestParameterCapability, ModelCapabilityStatus>>
  reasoning: ModelReasoningCapability
}

const INPUT_MODALITIES = ['text', 'image', 'audio', 'video', 'file'] as const
const OUTPUT_MODALITIES = ['text', 'image', 'audio'] as const
const FEATURE_CAPABILITIES = [
  'chat',
  'streaming',
  'toolCalling',
  'structuredOutput',
  'vision',
  'audioInput',
  'audioOutput',
  'reasoning',
  'promptCache',
  'responseFormat',
] as const
const REQUEST_PARAMETER_CAPABILITIES = [
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
] as const

const PARAMETER_ALIASES: Readonly<Record<ModelRequestParameterCapability, readonly string[]>> = {
  temperature: ['temperature'],
  topP: ['top_p', 'topP'],
  topK: ['top_k', 'topK'],
  maxTokens: [
    'max_tokens',
    'maxTokens',
    'max_completion_tokens',
    'maxCompletionTokens',
    'max_output_tokens',
    'maxOutputTokens',
    'generationConfig.maxOutputTokens',
  ],
  frequencyPenalty: ['frequency_penalty', 'frequencyPenalty'],
  presencePenalty: ['presence_penalty', 'presencePenalty'],
  stop: ['stop', 'stop_sequences', 'stopSequences'],
  seed: ['seed'],
  responseFormat: ['response_format', 'responseFormat', 'structured_outputs', 'json_schema', 'text.format'],
  reasoningEffort: ['reasoning_effort', 'reasoningEffort', 'thinking_level', 'thinkingLevel'],
  thinkingBudget: ['thinking_budget', 'thinkingBudget', 'budget_tokens', 'budgetTokens'],
}

/**
 * Builds a model-only capability view. Provider and endpoint support are kept
 * separate, so an unknown model capability can never be promoted by a broad
 * provider default. Callers should combine this profile with the existing
 * provider capability and request-shaping policies before emitting fields.
 */
export function resolveModelCapabilityProfile(model: AIModel): ModelCapabilityProfile {
  const modelSource = model.source ?? 'inferred'
  const baseEvidence = evidenceForModel(model)
  const supportedParameters = normalizedSupportedParameters(model.supportedParameters)
  const hasParameterDeclaration = Array.isArray(model.supportedParameters)
  const reasoning = resolveReasoningCapability(model, baseEvidence)
  const vision = documentedBooleanCapability(model, model.supportsVision, 'vision', baseEvidence)
  const files = documentedBooleanCapability(model, model.supportsFiles, 'file input', baseEvidence)
  const chat = optionalBooleanCapability(model, model.chatCompatible, 'chat generation', baseEvidence, true)
  const streaming = optionalBooleanCapability(model, model.supportsStreaming, 'streaming', baseEvidence)
  const tools = optionalBooleanCapability(model, model.supportsTools, 'tool calling', baseEvidence)
  const responseFormat = parameterCapability(
    'responseFormat',
    supportedParameters,
    hasParameterDeclaration,
    baseEvidence,
  )

  const features = emptyCapabilityRecord(FEATURE_CAPABILITIES)
  features.chat = chat
  features.streaming = streaming
  features.toolCalling = tools
  features.structuredOutput = responseFormat
  features.vision = vision
  features.audioInput = unknownCapability('No model-level audio input evidence is present in AIModel metadata.')
  features.audioOutput = unknownCapability('No model-level audio output evidence is present in AIModel metadata.')
  features.reasoning = statusFromReasoning(reasoning)
  features.promptCache = unknownCapability('Prompt cache support is provider-specific and is not declared by AIModel metadata.')
  features.responseFormat = responseFormat

  const parameters = emptyCapabilityRecord(REQUEST_PARAMETER_CAPABILITIES)
  for (const parameter of REQUEST_PARAMETER_CAPABILITIES) {
    parameters[parameter] = parameterCapability(
      parameter,
      supportedParameters,
      hasParameterDeclaration,
      baseEvidence,
    )
  }
  if (reasoning.support === 'supported') {
    if (reasoning.efforts.length) {
      parameters.reasoningEffort = capability(
        'supported',
        baseEvidence,
        'Model metadata declares supported reasoning effort values.',
      )
    }
    if (reasoningModeUsesBudget(reasoning.mode)) {
      parameters.thinkingBudget = capability(
        'supported',
        baseEvidence,
        'Model reasoning mode maps to a provider-specific thinking budget.',
      )
    }
  }

  const inputModalities = emptyCapabilityRecord(INPUT_MODALITIES)
  inputModalities.text = chat
  inputModalities.image = vision
  inputModalities.file = files
  inputModalities.audio = features.audioInput
  inputModalities.video = unknownCapability('No model-level video input evidence is present in AIModel metadata.')

  const outputModalities = emptyCapabilityRecord(OUTPUT_MODALITIES)
  outputModalities.text = chat
  outputModalities.image = unknownCapability('No model-level image output evidence is present in AIModel metadata.')
  outputModalities.audio = features.audioOutput

  return {
    schema: MODEL_CAPABILITY_PROFILE_SCHEMA,
    modelId: model.id,
    provider: model.provider,
    modelSource,
    limits: {
      contextWindow: capabilityLimit(model.contextWindow, baseEvidence, modelSource),
      maxOutputTokens: capabilityLimit(model.maxOutputTokens, baseEvidence, modelSource),
      defaultMaxOutputTokens: capabilityLimit(model.defaultMaxTokens, baseEvidence, modelSource),
    },
    inputModalities,
    outputModalities,
    features,
    parameters,
    reasoning,
  }
}

export function modelCapabilityIsSupported(
  profile: ModelCapabilityProfile,
  capabilityName: ModelFeatureCapability,
): boolean {
  return profile.features[capabilityName].support === 'supported'
}

export function modelParameterIsSupported(
  profile: ModelCapabilityProfile,
  parameter: ModelRequestParameterCapability,
): boolean {
  return profile.parameters[parameter].support === 'supported'
}

function resolveReasoningCapability(
  model: AIModel,
  baseEvidence: ModelCapabilityEvidence,
): ModelReasoningCapability {
  if (model.reasoningMode === 'none') {
    return {
      support: 'unsupported',
      evidence: withReason(baseEvidence, 'Model metadata explicitly disables reasoning.'),
      mode: 'none',
      efforts: [],
    }
  }
  if (!model.reasoningMode) {
    return {
      support: 'unknown',
      evidence: missingEvidence('Model metadata does not declare a reasoning mode.'),
      efforts: [],
    }
  }
  if (baseEvidence.confidence === 'inferred' || baseEvidence.confidence === 'unknown') {
    return {
      support: 'unknown',
      evidence: withReason(baseEvidence, 'An inferred reasoning mode is not sufficient proof of support.'),
      mode: model.reasoningMode,
      efforts: [...(model.reasoningEfforts ?? [])],
    }
  }
  return {
    support: 'supported',
    evidence: withReason(baseEvidence, 'Model metadata declares a provider-specific reasoning mode.'),
    mode: model.reasoningMode,
    efforts: [...(model.reasoningEfforts ?? [])],
  }
}

function statusFromReasoning(reasoning: ModelReasoningCapability): ModelCapabilityStatus {
  return { support: reasoning.support, evidence: reasoning.evidence }
}

function optionalBooleanCapability(
  model: AIModel,
  value: boolean | undefined,
  label: string,
  baseEvidence: ModelCapabilityEvidence,
  defaultWhenDocumented = false,
): ModelCapabilityStatus {
  if (value === undefined && !defaultWhenDocumented) {
    return unknownCapability(`Model metadata does not declare ${label} support.`)
  }
  return documentedBooleanCapability(model, value ?? true, label, baseEvidence)
}

function documentedBooleanCapability(
  model: AIModel,
  value: boolean,
  label: string,
  baseEvidence: ModelCapabilityEvidence,
): ModelCapabilityStatus {
  if (model.source === 'inferred' || baseEvidence.confidence === 'inferred' || baseEvidence.confidence === 'unknown') {
    return unknownCapability(`The ${label} value comes from an inferred provider default, not model evidence.`)
  }
  return capability(
    value ? 'supported' : 'unsupported',
    baseEvidence,
    `Model metadata ${value ? 'declares' : 'does not declare'} ${label} support.`,
  )
}

function parameterCapability(
  parameter: ModelRequestParameterCapability,
  supported: ReadonlySet<string>,
  hasDeclaration: boolean,
  baseEvidence: ModelCapabilityEvidence,
): ModelCapabilityStatus {
  if (!hasDeclaration) {
    return unknownCapability(`Model metadata does not publish support for ${parameter}.`)
  }
  const aliases = PARAMETER_ALIASES[parameter]
  const included = aliases.some((alias) => supported.has(normalizeParameterName(alias)))
  return capability(
    included ? 'supported' : 'unsupported',
    baseEvidence,
    included
      ? `Remote or catalog metadata lists ${parameter} as supported.`
      : `The model's explicit supported-parameter list omits ${parameter}.`,
  )
}

function capabilityLimit(
  value: number | undefined,
  evidence: ModelCapabilityEvidence,
  source: NonNullable<AIModel['source']>,
): ModelCapabilityLimit {
  const validValue = typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
  if (source === 'inferred') {
    const inferred = withReason(evidence, 'Limit comes from a provider-family fallback and must not be treated as verified.')
    return { value: validValue, confidence: 'inferred', evidence: inferred }
  }
  if (validValue === undefined) {
    const missing = missingEvidence('Model metadata does not contain a valid positive token limit.')
    return { confidence: 'unknown', evidence: missing }
  }
  return { value: validValue, confidence: evidence.confidence, evidence }
}

function evidenceForModel(model: AIModel): ModelCapabilityEvidence {
  if (model.source === 'inferred' || model.source === undefined) {
    return {
      source: 'inferred-default',
      confidence: 'inferred',
      reason: 'Model metadata was inferred from provider-family defaults.',
    }
  }
  if (model.sourceUrl && model.verifiedAt) {
    return {
      source: 'official-model-doc',
      confidence: 'verified',
      reason: 'Model catalog entry records an official source and verification date.',
      sourceUrl: model.sourceUrl,
      verifiedAt: model.verifiedAt,
    }
  }
  if (model.source === 'remote') {
    return {
      source: 'remote-model-metadata',
      confidence: 'declared',
      reason: 'Capability value comes from provider model-list metadata.',
    }
  }
  return {
    source: 'built-in-catalog',
    confidence: 'declared',
    reason: 'Capability value is declared by the built-in catalog without source-backed verification metadata.',
  }
}

function capability(
  support: ModelCapabilitySupport,
  evidence: ModelCapabilityEvidence,
  reason: string,
): ModelCapabilityStatus {
  return { support, evidence: withReason(evidence, reason) }
}

function unknownCapability(reason: string): ModelCapabilityStatus {
  return { support: 'unknown', evidence: missingEvidence(reason) }
}

function missingEvidence(reason: string): ModelCapabilityEvidence {
  return { source: 'missing-evidence', confidence: 'unknown', reason }
}

function withReason(evidence: ModelCapabilityEvidence, reason: string): ModelCapabilityEvidence {
  return { ...evidence, reason }
}

function emptyCapabilityRecord<TKey extends string>(
  keys: readonly TKey[],
): Record<TKey, ModelCapabilityStatus> {
  return Object.fromEntries(
    keys.map((key) => [key, unknownCapability(`No ${key} capability evidence is available.`)]),
  ) as Record<TKey, ModelCapabilityStatus>
}

function normalizedSupportedParameters(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).map(normalizeParameterName).filter(Boolean))
}

function normalizeParameterName(value: string): string {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
  const compact = normalized.replace(/[._]/g, '')
  if (compact === 'topp') return 'top_p'
  if (compact === 'topk') return 'top_k'
  if (compact === 'maxtokens') return 'max_tokens'
  if (compact === 'maxcompletiontokens') return 'max_completion_tokens'
  if (compact === 'maxoutputtokens' || compact === 'generationconfigmaxoutputtokens') return 'max_output_tokens'
  if (compact === 'frequencypenalty') return 'frequency_penalty'
  if (compact === 'presencepenalty') return 'presence_penalty'
  if (compact === 'stopsequences') return 'stop_sequences'
  if (compact === 'responseformat') return 'response_format'
  if (compact === 'structuredoutputs') return 'structured_outputs'
  if (compact === 'jsonschema') return 'json_schema'
  if (compact === 'textformat') return 'text.format'
  if (compact === 'reasoningeffort') return 'reasoning_effort'
  if (compact === 'thinkinglevel') return 'thinking_level'
  if (compact === 'thinkingbudget') return 'thinking_budget'
  if (compact === 'budgettokens') return 'budget_tokens'
  return normalized
}

function reasoningModeUsesBudget(mode: ModelReasoningMode | undefined): boolean {
  return mode === 'gemini-thinking-budget' ||
    mode === 'anthropic-thinking' ||
    mode === 'dashscope-thinking' ||
    mode === 'siliconflow-thinking-budget'
}
