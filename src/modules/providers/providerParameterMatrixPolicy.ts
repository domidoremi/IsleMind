import type { AIModel, AIProvider } from '@/types/providerContracts'
import type { GenerationParameterKey } from '@/core'
import {
  getProviderCompatibilityEvidenceForProvider,
  providerCompatibilityCapabilityCanBeSentForProvider,
  providerCompatibilityReasoningExplicitlyDeclaredForModel,
} from './providerCompatibilityCatalog'
import { resolveProviderStreamingPolicy } from './providerStreamingPolicy'
import { resolveProviderRequestParameterSupport } from './providerRequestParameterPolicy'

export const PROVIDER_PARAMETER_MATRIX_SCHEMA = 'islemind.provider-parameter-matrix.v1'

export type ProviderParameterFamily =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'openai-compatible'
  | 'anthropic-compatible'
  | 'unknown'

export type ProviderParameterCapability =
  | 'reasoning'
  | 'reasoning-summary'
  | 'context-continuity'
  | 'remote-compact'
  | 'streaming'
  | 'tool-calling'
  | 'structured-output'
  | 'multimodal-input'
  | 'audio-input'
  | 'audio-transcription'
  | 'speech-output'
  | 'embeddings'
  | 'rerank'
  | 'sampling'
  | 'token-budget'
  | 'native-search'

export type ProviderParameterSupportStatus =
  | 'sendable'
  | 'blocked'
  | 'manual'
  | 'unknown'

export type ProviderParameterEvidenceSource =
  | 'official-docs'
  | 'official-sdk'
  | 'runtime-shaping'
  | 'provider-contract'
  | 'model-metadata'
  | 'manual-declaration'
  | 'unsupported-contract'

export interface ProviderParameterEvidence {
  source: ProviderParameterEvidenceSource
  title: string
  url?: string
  checkedAt: string
}

export interface ProviderParameterMatrixEntry {
  capability: ProviderParameterCapability
  status: ProviderParameterSupportStatus
  requestPath: string[]
  valueShape: string
  docEvidence: ProviderParameterEvidence[]
  runtimeEvidence: string[]
  uiControl: string
  failureBehavior: string
  parameters?: readonly ProviderParameterMatrixFieldSupport[]
  notes?: string
}

export interface ProviderParameterMatrixFieldSupport {
  parameter: GenerationParameterKey
  status: 'sendable' | 'blocked'
  requestPath: readonly string[]
  reason: 'supported' | 'unsupported-model' | 'unsupported-endpoint'
}

export interface ProviderParameterMatrix {
  schema: typeof PROVIDER_PARAMETER_MATRIX_SCHEMA
  providerId: string
  modelId: string
  resolvedModelId: string
  family: ProviderParameterFamily
  preferredEndpoint?: AIModel['preferredEndpoint']
  entries: ProviderParameterMatrixEntry[]
}

export type ProviderParameterMatrixModelCapability =
  | 'streaming'
  | 'tools'
  | 'responseFormat'
  | 'nativeSearch'

export interface ProviderParameterMatrixNativeToolSupport {
  supported: boolean
  reason: string
}

export interface ProviderParameterMatrixPolicyDependencies {
  getModelConfig(modelId: string, providerType?: AIProvider['type'], modelConfigs?: AIModel[]): AIModel
  resolveProviderModelAlias(provider: AIProvider, modelId: string): string
  providerModelCapabilityCanBeSent(
    provider: AIProvider,
    modelId: string,
    capability: ProviderParameterMatrixModelCapability,
  ): boolean
  resolveProviderNativeToolSupport(provider: AIProvider, modelConfig: AIModel): ProviderParameterMatrixNativeToolSupport
  providerSupportsReasoning(provider: AIProvider, modelId: string): boolean
  providerSupportsVisionInput(provider: AIProvider, modelConfig: AIModel): boolean
  providerSupportsFileInput(provider: AIProvider, modelConfig: AIModel): boolean
}

export interface ProviderParameterMatrixPolicy {
  buildProviderParameterMatrix(provider: AIProvider, modelId: string): ProviderParameterMatrix
  getProviderParameterEntry(
    provider: AIProvider,
    modelId: string,
    capability: ProviderParameterCapability,
  ): ProviderParameterMatrixEntry | undefined
  providerParameterCanBeSent(
    provider: AIProvider,
    modelId: string,
    capability: ProviderParameterCapability,
  ): boolean
}

const DOC_CHECKED_AT = '2026-07-04'

const OPENAI_REASONING_DOC: ProviderParameterEvidence = {
  source: 'official-docs',
  title: 'OpenAI reasoning guide',
  url: 'https://developers.openai.com/api/docs/guides/reasoning',
  checkedAt: DOC_CHECKED_AT,
}

const OPENAI_RESPONSES_DOC: ProviderParameterEvidence = {
  source: 'official-docs',
  title: 'OpenAI Responses API guide',
  url: 'https://developers.openai.com/api/docs/guides/responses-vs-chat-completions',
  checkedAt: DOC_CHECKED_AT,
}

const OPENAI_API_REFERENCE_DOC: ProviderParameterEvidence = {
  source: 'official-docs',
  title: 'OpenAI Responses API reference',
  url: 'https://developers.openai.com/api/reference/responses/create',
  checkedAt: DOC_CHECKED_AT,
}

const OPENAI_EMBEDDINGS_API_REFERENCE_DOC: ProviderParameterEvidence = {
  source: 'official-docs',
  title: 'OpenAI embeddings API reference',
  url: 'https://platform.openai.com/docs/api-reference/embeddings/create',
  checkedAt: DOC_CHECKED_AT,
}

const OPENAI_AUDIO_API_REFERENCE_DOC: ProviderParameterEvidence = {
  source: 'official-docs',
  title: 'OpenAI Audio API reference',
  url: 'https://developers.openai.com/api/reference/audio',
  checkedAt: DOC_CHECKED_AT,
}

const ANTHROPIC_THINKING_DOC: ProviderParameterEvidence = {
  source: 'official-docs',
  title: 'Anthropic extended thinking guide',
  url: 'https://platform.claude.com/docs/en/build-with-claude/extended-thinking',
  checkedAt: DOC_CHECKED_AT,
}

const ANTHROPIC_TOOL_DOC: ProviderParameterEvidence = {
  source: 'official-docs',
  title: 'Anthropic tool use guide',
  url: 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview',
  checkedAt: DOC_CHECKED_AT,
}

const ANTHROPIC_SDK_EVIDENCE: ProviderParameterEvidence = {
  source: 'official-sdk',
  title: 'Anthropic TypeScript SDK Messages params',
  url: 'https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts',
  checkedAt: DOC_CHECKED_AT,
}

const ANTHROPIC_MESSAGES_API_DOC: ProviderParameterEvidence = {
  source: 'official-docs',
  title: 'Anthropic Messages API reference',
  url: 'https://platform.claude.com/docs/en/api/messages/create',
  checkedAt: DOC_CHECKED_AT,
}

const ANTHROPIC_COMPACTION_DOC: ProviderParameterEvidence = {
  source: 'official-docs',
  title: 'Anthropic server-side compaction guide',
  url: 'https://platform.claude.com/docs/en/build-with-claude/compaction',
  checkedAt: DOC_CHECKED_AT,
}

const GEMINI_THINKING_DOC: ProviderParameterEvidence = {
  source: 'official-docs',
  title: 'Gemini thinking guide',
  url: 'https://ai.google.dev/gemini-api/docs/thinking',
  checkedAt: DOC_CHECKED_AT,
}

const GEMINI_OPENAI_DOC: ProviderParameterEvidence = {
  source: 'official-docs',
  title: 'Gemini OpenAI compatibility guide',
  url: 'https://ai.google.dev/gemini-api/docs/openai',
  checkedAt: DOC_CHECKED_AT,
}

const GEMINI_STRUCTURED_OUTPUT_DOC: ProviderParameterEvidence = {
  source: 'official-docs',
  title: 'Gemini structured output guide',
  url: 'https://ai.google.dev/gemini-api/docs/structured-output',
  checkedAt: DOC_CHECKED_AT,
}

const GEMINI_GENERATE_CONTENT_DOC: ProviderParameterEvidence = {
  source: 'official-docs',
  title: 'Gemini GenerateContent API reference',
  url: 'https://ai.google.dev/api/generate-content',
  checkedAt: DOC_CHECKED_AT,
}

const GEMINI_EMBEDDINGS_DOC: ProviderParameterEvidence = {
  source: 'official-docs',
  title: 'Gemini embeddings guide',
  url: 'https://ai.google.dev/gemini-api/docs/embeddings',
  checkedAt: DOC_CHECKED_AT,
}

const GEMINI_CACHING_DOC: ProviderParameterEvidence = {
  source: 'official-docs',
  title: 'Gemini context caching guide',
  url: 'https://ai.google.dev/gemini-api/docs/caching',
  checkedAt: DOC_CHECKED_AT,
}

export function createProviderParameterMatrixPolicy(
  dependencies: ProviderParameterMatrixPolicyDependencies,
): ProviderParameterMatrixPolicy {
function buildProviderParameterMatrix(provider: AIProvider, modelId: string): ProviderParameterMatrix {
  const resolvedModelId = dependencies.resolveProviderModelAlias(provider, modelId)
  const modelConfig = dependencies.getModelConfig(resolvedModelId, provider.type, provider.modelConfigs)
  const family = inferParameterFamily(provider)
  const entries = [
    buildReasoningEntry(provider, modelConfig, family),
    buildReasoningSummaryEntry(provider, modelConfig, family),
    buildContextContinuityEntry(provider, modelConfig, family),
    buildRemoteCompactEntry(provider, modelConfig, family),
    buildStreamingEntry(provider, modelConfig, family),
    buildToolCallingEntry(provider, modelConfig, family),
    buildStructuredOutputEntry(provider, modelConfig, family),
    buildMultimodalInputEntry(provider, modelConfig, family),
    buildAudioInputEntry(provider, modelConfig, family),
    buildAudioTranscriptionEntry(provider, modelConfig, family),
    buildSpeechOutputEntry(provider, modelConfig, family),
    buildEmbeddingsEntry(provider, modelConfig, family),
    buildRerankEntry(provider, family),
    buildSamplingEntry(provider, modelConfig, family),
    buildTokenBudgetEntry(provider, modelConfig, family),
    buildNativeSearchEntry(provider, modelConfig, family),
  ]
  return {
    schema: PROVIDER_PARAMETER_MATRIX_SCHEMA,
    providerId: provider.id,
    modelId,
    resolvedModelId,
    family,
    preferredEndpoint: modelConfig.preferredEndpoint,
    entries,
  }
}

function getProviderParameterEntry(
  provider: AIProvider,
  modelId: string,
  capability: ProviderParameterCapability,
): ProviderParameterMatrixEntry | undefined {
  return buildProviderParameterMatrix(provider, modelId).entries.find((entry) => entry.capability === capability)
}

function providerParameterCanBeSent(
  provider: AIProvider,
  modelId: string,
  capability: ProviderParameterCapability,
): boolean {
  return getProviderParameterEntry(provider, modelId, capability)?.status === 'sendable'
}

function buildReasoningEntry(
  provider: AIProvider,
  modelConfig: AIModel,
  family: ProviderParameterFamily,
): ProviderParameterMatrixEntry {
  const explicitReasoning = providerCompatibilityReasoningExplicitlyDeclaredForModel(provider, modelConfig)
  const contractAllowed = providerCompatibilityCapabilityCanBeSentForProvider(provider, 'reasoning', explicitReasoning)
  const supported = contractAllowed && dependencies.providerSupportsReasoning(provider, modelConfig.id)
  if (family === 'openai') {
    return entry({
      capability: 'reasoning',
      status: supported ? 'sendable' : 'blocked',
      requestPath: ['reasoning', 'effort'],
      valueShape: 'Reasoning effort enum; runtime normalizes unsupported values before request.',
      docEvidence: [OPENAI_REASONING_DOC],
      runtimeEvidence: ['normalizeOpenAIReasoningEffort', 'buildOpenAIResponsesReasoning', 'buildOpenAIResponsesBody'],
      uiControl: supported ? 'Show reasoning effort segmented control.' : 'Hide reasoning controls for this model.',
      failureBehavior: 'Block reasoning.effort when contract or model metadata does not prove support.',
    })
  }
  if (family === 'anthropic' || family === 'anthropic-compatible') {
    const adaptive = /claude-(fable-5|mythos-5|mythos-preview|opus-4-[678]|sonnet-4-6)/i.test(modelConfig.id)
    return entry({
      capability: 'reasoning',
      status: supported ? 'sendable' : 'blocked',
      requestPath: adaptive ? ['thinking', 'type'] : ['thinking', 'budget_tokens'],
      valueShape: adaptive ? 'Adaptive thinking plus output_config.effort when model supports it.' : 'thinking={ type: "enabled", budget_tokens: number }',
      docEvidence: [ANTHROPIC_THINKING_DOC, ANTHROPIC_SDK_EVIDENCE],
      runtimeEvidence: ['normalizeAnthropicThinking', 'buildAnthropicBody'],
      uiControl: supported ? 'Show reasoning effort control and derive token budget.' : 'Hide reasoning controls for this model.',
      failureBehavior: 'Do not emit thinking when selected model lacks Anthropic thinking evidence.',
    })
  }
  if (family === 'google') {
    const level = modelConfig.reasoningMode === 'gemini-thinking-level'
    return entry({
      capability: 'reasoning',
      status: supported ? 'sendable' : 'blocked',
      requestPath: level ? ['generationConfig', 'thinkingConfig', 'thinkingLevel'] : ['generationConfig', 'thinkingConfig', 'thinkingBudget'],
      valueShape: level ? 'Gemini thinking level enum.' : 'Gemini thinking budget integer; -1 keeps dynamic budget where supported.',
      docEvidence: [GEMINI_THINKING_DOC, GEMINI_OPENAI_DOC],
      runtimeEvidence: ['normalizeGoogleThinkingConfig', 'createGoogleRequestBodyBuilder'],
      uiControl: supported ? 'Show reasoning effort control using Gemini-specific mapping.' : 'Hide reasoning controls for this model.',
      failureBehavior: 'Do not emit thinkingConfig when model metadata does not prove Gemini thinking support.',
    })
  }
  return genericParameterEntry('reasoning', supported, ['reasoning_effort'], 'Provider-specific reasoning parameter requires explicit provider or model evidence.')
}

function buildReasoningSummaryEntry(
  provider: AIProvider,
  modelConfig: AIModel,
  family: ProviderParameterFamily,
): ProviderParameterMatrixEntry {
  const supported = family === 'openai' && dependencies.providerSupportsReasoning(provider, modelConfig.id)
  if (family === 'openai') {
    return entry({
      capability: 'reasoning-summary',
      status: supported ? 'sendable' : 'blocked',
      requestPath: ['reasoning', 'summary'],
      valueShape: 'summary="auto" for OpenAI reasoning models.',
      docEvidence: [OPENAI_REASONING_DOC],
      runtimeEvidence: ['buildOpenAIResponsesReasoning'],
      uiControl: 'No primary UI control; runtime requests summaries for trace diagnostics.',
      failureBehavior: 'Omit reasoning.summary outside OpenAI Responses reasoning requests.',
    })
  }
  if (family === 'google') {
    return entry({
      capability: 'reasoning-summary',
      status: dependencies.providerSupportsReasoning(provider, modelConfig.id) ? 'sendable' : 'blocked',
      requestPath: ['generationConfig', 'thinkingConfig', 'includeThoughts'],
      valueShape: 'includeThoughts=true when non-minimal Gemini reasoning is selected.',
      docEvidence: [GEMINI_THINKING_DOC, GEMINI_OPENAI_DOC],
      runtimeEvidence: ['withGoogleThoughtSummaries', 'normalizeGoogleThinkingConfig'],
      uiControl: 'No standalone UI control; follows selected reasoning effort.',
      failureBehavior: 'Omit includeThoughts when reasoning is disabled or minimal.',
    })
  }
  return entry({
    capability: 'reasoning-summary',
    status: 'unknown',
    requestPath: [],
    valueShape: 'No shared reasoning-summary request parameter.',
    docEvidence: [],
    runtimeEvidence: [],
    uiControl: 'Do not expose reasoning-summary controls.',
    failureBehavior: 'Keep summaries disabled until provider docs and runtime parser support are mapped.',
  })
}

function buildContextContinuityEntry(
  provider: AIProvider,
  modelConfig: AIModel,
  family: ProviderParameterFamily,
): ProviderParameterMatrixEntry {
  const openAIResponses = family === 'openai' && modelConfig.preferredEndpoint === 'responses'
  const explicitResponses = provider.capabilities?.responsesApi === true || modelConfig.preferredEndpoint === 'responses'
  const responsesAllowed = providerCompatibilityCapabilityCanBeSentForProvider(provider, 'responsesApi', explicitResponses)
  if (family === 'openai' || family === 'openai-compatible') {
    return entry({
      capability: 'context-continuity',
      status: openAIResponses || (family === 'openai-compatible' && responsesAllowed) ? 'sendable' : 'blocked',
      requestPath: ['previous_response_id'],
      valueShape: 'Previous stored response id used only when remote compact or Responses continuation is active.',
      docEvidence: [OPENAI_RESPONSES_DOC],
      runtimeEvidence: ['buildOpenAIResponsesBody', 'providerRemoteCompactLifecycle.resolvePreviousState', 'saveCompactState'],
      uiControl: 'No direct user control; governed by remote compact settings.',
      failureBehavior: 'Omit previous_response_id when Responses routing is not contract-allowed.',
    })
  }
  if (family === 'google') {
    return entry({
      capability: 'context-continuity',
      status: 'unknown',
      requestPath: ['previous_interaction_id'],
      valueShape: 'Gemini Interactions continuity exists in docs but is not wired to current chat runtime.',
      docEvidence: [GEMINI_OPENAI_DOC],
      runtimeEvidence: [],
      uiControl: 'Do not expose until runtime uses the Interactions endpoint.',
      failureBehavior: 'Keep local context packing as fallback.',
    })
  }
  return genericParameterEntry('context-continuity', false, [], 'Remote provider context continuity is not mapped for this family.')
}

function buildRemoteCompactEntry(
  provider: AIProvider,
  modelConfig: AIModel,
  family: ProviderParameterFamily,
): ProviderParameterMatrixEntry {
  const evidenceId = getProviderCompatibilityEvidenceForProvider(provider).id
  const directOpenAI = evidenceId === 'openai' && provider.type === 'openai' && provider.wireProtocol === undefined
  const directAnthropic = evidenceId === 'anthropic' && provider.type === 'anthropic' && provider.wireProtocol === undefined
  const responsesCapabilityDeclared = provider.capabilities?.responsesApi === true
  const responsesDeclared = responsesCapabilityDeclared || modelConfig.preferredEndpoint === 'responses'
  const remoteCompactDeclared = provider.capabilities?.remoteCompact === true
  const responsesAllowed = providerCompatibilityCapabilityCanBeSentForProvider(provider, 'responsesApi', responsesDeclared)
  const remoteCompactAllowed = providerCompatibilityCapabilityCanBeSentForProvider(provider, 'remoteCompact', remoteCompactDeclared)
  const responsesRouted = (directOpenAI || evidenceId === 'openrouter' || evidenceId === 'xai') && modelConfig.preferredEndpoint === 'responses'
  const openAISendable = responsesRouted && responsesCapabilityDeclared && remoteCompactDeclared && responsesAllowed && remoteCompactAllowed
  const anthropicSendable = directAnthropic && remoteCompactDeclared && remoteCompactAllowed

  if (directOpenAI) {
    return entry({
      capability: 'remote-compact',
      status: openAISendable ? 'sendable' : 'blocked',
      requestPath: openAISendable ? ['context_management', 'compact_threshold'] : [],
      valueShape: openAISendable
        ? 'Responses context_management compaction item with an absolute compact_threshold token limit.'
        : 'OpenAI Responses compaction is native only on the direct Responses route with an explicit capability declaration.',
      docEvidence: [OPENAI_API_REFERENCE_DOC],
      runtimeEvidence: ['decideRemoteCompact', 'resolveProviderContextManagement', 'buildOpenAIResponsesBody', 'providerRemoteCompactLifecycle.resolvePreviousState'],
      uiControl: 'Allow remote compact auto/required modes; native only when Responses compact is declared.',
      failureBehavior: 'Classify remote-unavailable or remote-failed first; only then allow local structured packing when privacy permits. Required mode fails closed.',
      notes: 'Official: https://platform.openai.com/docs/guides/compaction',
    })
  }

  if (directAnthropic) {
    return entry({
      capability: 'remote-compact',
      status: anthropicSendable ? 'sendable' : 'blocked',
      requestPath: anthropicSendable ? ['context_management', 'edits'] : [],
      valueShape: anthropicSendable
        ? 'Messages context_management.edits compact_20260112 with input_tokens trigger; anthropic-beta compact-2026-01-12.'
        : 'Anthropic Messages compaction is native only on the direct Messages route with an explicit capability declaration.',
      docEvidence: [ANTHROPIC_MESSAGES_API_DOC, ANTHROPIC_COMPACTION_DOC],
      runtimeEvidence: ['decideRemoteCompact', 'buildAnthropicBody', 'getProviderRequestHeaders'],
      uiControl: 'Allow remote compact auto/required for Anthropic when remoteCompact is declared.',
      failureBehavior: 'Classify remote-unavailable or remote-failed first; only then allow local structured packing when privacy permits. Required mode fails closed.',
      notes: 'Official: https://platform.claude.com/docs/en/build-with-claude/compaction',
    })
  }

  if (family === 'google' || evidenceId === 'google') {
    return entry({
      capability: 'remote-compact',
      status: 'blocked',
      requestPath: [],
      valueShape: 'Gemini context caching is a caching capability, not a native context-compaction request.',
      docEvidence: [GEMINI_CACHING_DOC],
      runtimeEvidence: ['resolveProviderContextManagement'],
      uiControl: 'Do not expose Gemini caching as remote compaction.',
      failureBehavior: 'Treat remote compaction as unavailable; permit local packing only after that classification and privacy approval.',
      notes: 'Official: https://ai.google.dev/gemini-api/docs/caching',
    })
  }

  if (evidenceId === 'xai' || evidenceId === 'openrouter') {
    return entry({
      capability: 'remote-compact',
      status: 'unknown',
      requestPath: [],
      valueShape: 'Provider context-window behavior or message transforms are documented, but no native compaction request contract is evidenced.',
      docEvidence: [],
      runtimeEvidence: ['resolveProviderContextManagement'],
      uiControl: 'Keep native compaction controls hidden until a provider-specific request contract is evidenced.',
      failureBehavior: 'Classify remote compaction as unknown/unavailable; permit local packing only after explicit classification and privacy approval.',
      notes: 'Unknown is not sendable compaction; do not infer native support from Responses compatibility or upstream transforms.',
    })
  }

  return entry({
    capability: 'remote-compact',
    status: 'blocked',
    requestPath: [],
    valueShape: 'Generic compatible endpoints have no evidenced native compaction contract.',
    docEvidence: [],
    runtimeEvidence: ['decideRemoteCompact', 'resolveProviderContextManagement', 'packChatMessages'],
    uiControl: 'Keep native compaction controls hidden for generic compatible endpoints.',
    failureBehavior: 'Classify remote compaction as unsupported; permit local packing only after explicit unavailable/failed classification and privacy approval.',
  })
}

function buildStreamingEntry(
  provider: AIProvider,
  modelConfig: AIModel,
  family: ProviderParameterFamily,
): ProviderParameterMatrixEntry {
  const policy = resolveProviderStreamingPolicy({
    provider,
    modelSupportsStreaming: modelConfig.supportsStreaming,
  })
  const contractAllowed = providerCompatibilityCapabilityCanBeSentForProvider(provider, 'streaming')
  const modelAllowed = modelCapabilitySendable(provider, modelConfig.id, 'streaming')
  const status: ProviderParameterSupportStatus = !policy.stream
    ? 'blocked'
    : contractAllowed && modelAllowed
      ? 'sendable'
      : provider.capabilities?.streaming === true && modelAllowed
        ? 'manual'
        : 'unknown'
  const requestPath = family === 'google'
    ? ['endpoint', ':streamGenerateContent', 'alt=sse']
    : ['stream']
  return entry({
    capability: 'streaming',
    status,
    requestPath,
    valueShape: family === 'google'
      ? 'Gemini selects SSE through :streamGenerateContent?alt=sse rather than a JSON stream field.'
      : 'stream=true; runtime parses bounded SSE events and falls back to a non-streaming request when disabled.',
    docEvidence: streamingParameterEvidence(family),
    runtimeEvidence: ['resolveProviderStreamingPolicy', 'prepareProviderRuntimePipeline', 'assembleProviderRoute', 'parseProviderStreamChunk'],
    uiControl: status === 'sendable'
      ? 'Stream responses by default; keep the effective provider/model decision visible in diagnostics.'
      : status === 'manual'
        ? 'Keep streaming diagnostic-only until source-backed provider evidence is added.'
        : 'Do not request streaming; use the non-streaming runtime path.',
    failureBehavior: policy.reason === 'provider-disabled'
      ? 'Provider configuration explicitly disables streaming, so route and payload assembly force stream=false.'
      : policy.reason === 'model-disabled'
        ? 'Model metadata disables streaming, so route and payload assembly force stream=false.'
        : policy.reason === 'request-disabled'
          ? 'Caller selected non-streaming mode, so no SSE transport is requested.'
          : status === 'manual'
            ? 'Do not elevate an explicit relay declaration to verified behavior without source-backed compatibility evidence.'
            : 'Keep streaming disabled until provider compatibility and model evidence agree.',
  })
}

function buildToolCallingEntry(
  provider: AIProvider,
  modelConfig: AIModel,
  family: ProviderParameterFamily,
): ProviderParameterMatrixEntry {
  const support = dependencies.resolveProviderNativeToolSupport(provider, modelConfig)
  const sendable = support.supported && modelCapabilitySendable(provider, modelConfig.id, 'tools')
  const requestPath = family === 'google' ? ['tools'] : family === 'anthropic' || family === 'anthropic-compatible' ? ['tools', 'tool_choice'] : ['tools', 'tool_choice']
  return entry({
    capability: 'tool-calling',
    status: sendable ? 'sendable' : 'blocked',
    requestPath,
    valueShape: 'Function/tool declarations with bounded schema and runtime permission ceiling.',
    docEvidence: family === 'google'
      ? [GEMINI_OPENAI_DOC]
      : family === 'anthropic' || family === 'anthropic-compatible'
        ? [ANTHROPIC_TOOL_DOC, ANTHROPIC_SDK_EVIDENCE]
        : [OPENAI_RESPONSES_DOC],
    runtimeEvidence: ['contractProviderToolDeclarations', 'createAssistantProviderToolTurnRuntime', 'executeExternalTaskBoundTool'],
    uiControl: sendable ? 'Enable tool-capable actions according to mode policy.' : 'Hide native tool controls and use app-side tools only.',
    failureBehavior: support.supported ? 'Block if model capability matrix says tools cannot be sent.' : `Block native tools: ${support.reason}.`,
  })
}

function buildStructuredOutputEntry(
  provider: AIProvider,
  modelConfig: AIModel,
  family: ProviderParameterFamily,
): ProviderParameterMatrixEntry {
  const sendable = modelCapabilitySendable(provider, modelConfig.id, 'responseFormat')
  if (family === 'google') {
    return entry({
      capability: 'structured-output',
      status: sendable ? 'sendable' : 'blocked',
      requestPath: ['generationConfig', 'responseMimeType', 'responseSchema'],
      valueShape: 'application/json MIME type with optional JSON schema.',
      docEvidence: [GEMINI_STRUCTURED_OUTPUT_DOC],
      runtimeEvidence: ['buildGoogleStructuredOutputConfig'],
      uiControl: sendable ? 'Allow JSON/schema output mode when workflow requests it.' : 'Hide schema controls.',
      failureBehavior: 'Omit responseSchema unless provider contract maps Google schema output.',
    })
  }
  if (family === 'anthropic' || family === 'anthropic-compatible') {
    return entry({
      capability: 'structured-output',
      status: sendable ? 'sendable' : 'blocked',
      requestPath: ['tools', 'input_schema', 'tool_choice'],
      valueShape: 'Structured output is represented as a forced tool with input_schema.',
      docEvidence: [ANTHROPIC_TOOL_DOC],
      runtimeEvidence: ['buildAnthropicStructuredOutputTool'],
      uiControl: sendable ? 'Allow schema output through tool schema.' : 'Hide schema controls.',
      failureBehavior: 'Fall back to plain text when tool-schema structured output is not contract-mapped.',
    })
  }
  return entry({
    capability: 'structured-output',
    status: sendable ? 'sendable' : 'blocked',
    requestPath: modelConfig.preferredEndpoint === 'responses' ? ['text', 'format'] : ['response_format'],
    valueShape: 'JSON object or JSON schema response format according to endpoint contract.',
    docEvidence: [OPENAI_RESPONSES_DOC],
    runtimeEvidence: ['buildOpenAIResponsesTextConfig', 'buildOpenAIResponsesResponseFormat'],
    uiControl: sendable ? 'Allow JSON/schema output mode when workflow requests it.' : 'Hide schema controls.',
    failureBehavior: 'Omit structured output fields when model capability matrix does not prove response_format support.',
  })
}

function buildMultimodalInputEntry(
  provider: AIProvider,
  modelConfig: AIModel,
  family: ProviderParameterFamily,
): ProviderParameterMatrixEntry {
  const vision = dependencies.providerSupportsVisionInput(provider, modelConfig)
  const files = dependencies.providerSupportsFileInput(provider, modelConfig)
  const sendable = vision || files
  const requestPath = family === 'google'
    ? ['contents', 'parts', 'inline_data']
    : family === 'anthropic' || family === 'anthropic-compatible'
      ? ['messages', 'content', 'source']
      : modelConfig.preferredEndpoint === 'responses'
        ? ['input', 'content', 'input_image|input_file']
        : ['messages', 'content', 'image_url|file']
  return entry({
    capability: 'multimodal-input',
    status: sendable ? 'sendable' : 'blocked',
    requestPath,
    valueShape: 'Image and file parts are filtered by provider contract before request shaping.',
    docEvidence: family === 'google'
      ? [GEMINI_OPENAI_DOC]
      : family === 'anthropic' || family === 'anthropic-compatible'
        ? [ANTHROPIC_TOOL_DOC]
        : [OPENAI_RESPONSES_DOC],
    runtimeEvidence: ['filterSendableAttachments', 'contractSendableAttachments'],
    uiControl: sendable ? 'Allow supported attachments in composer.' : 'Hide or reject unsupported attachments.',
    failureBehavior: 'Drop unsupported attachment parts before the provider request is built.',
  })
}

function buildAudioInputEntry(
  provider: AIProvider,
  _modelConfig: AIModel,
  family: ProviderParameterFamily,
): ProviderParameterMatrixEntry {
  const contractAllowed = providerCompatibilityCapabilityCanBeSentForProvider(provider, 'audio', provider.capabilities?.audioInput === true)
  const sendable = provider.capabilities?.audioInput === true && contractAllowed
  return entry({
    capability: 'audio-input',
    status: sendable ? 'sendable' : 'blocked',
    requestPath: family === 'google'
      ? ['contents', 'parts', 'inline_data']
      : family === 'anthropic' || family === 'anthropic-compatible'
        ? []
        : ['messages', 'content', 'input_audio|audio_url'],
    valueShape: 'Audio input parts are allowed only when provider flags and compatibility contract both prove audio support.',
    docEvidence: audioParameterEvidence(family),
    runtimeEvidence: ['filterSendableAttachments', 'transcribeProviderAudio'],
    uiControl: sendable ? 'Allow audio capture or audio attachment flows.' : 'Hide or reject audio input controls.',
    failureBehavior: 'Reject audio input before request shaping when provider audio support is not contract-backed.',
  })
}

function buildAudioTranscriptionEntry(
  provider: AIProvider,
  _modelConfig: AIModel,
  family: ProviderParameterFamily,
): ProviderParameterMatrixEntry {
  const declared = provider.capabilities?.audioTranscription === true || (family === 'google' && provider.capabilities?.audioInput === true)
  const sendable = declared && providerCompatibilityCapabilityCanBeSentForProvider(provider, 'audio', true)
  return entry({
    capability: 'audio-transcription',
    status: sendable ? 'sendable' : 'blocked',
    requestPath: family === 'google' ? ['contents', 'parts', 'inline_data'] : ['audio', 'transcriptions'],
    valueShape: family === 'google'
      ? 'Audio file part plus transcription prompt through GenerateContent.'
      : 'Multipart audio transcription request with model and file.',
    docEvidence: audioParameterEvidence(family),
    runtimeEvidence: ['transcribeProviderAudio', 'assertImportFileSizeByUri'],
    uiControl: sendable ? 'Allow microphone transcription action.' : 'Disable transcription and explain provider requirement.',
    failureBehavior: 'Throw audio_transcription_unavailable before network calls when capability or contract evidence is missing.',
  })
}

function buildSpeechOutputEntry(
  provider: AIProvider,
  _modelConfig: AIModel,
  family: ProviderParameterFamily,
): ProviderParameterMatrixEntry {
  const endpointRouted = family === 'openai' || family === 'openai-compatible'
  const sendable = endpointRouted && provider.capabilities?.speech === true && providerCompatibilityCapabilityCanBeSentForProvider(provider, 'audio', true)
  return entry({
    capability: 'speech-output',
    status: sendable ? 'sendable' : 'blocked',
    requestPath: endpointRouted ? ['audio', 'speech'] : [],
    valueShape: 'Speech request with model, voice, input text, and response_format.',
    docEvidence: audioParameterEvidence(family),
    runtimeEvidence: ['synthesizeProviderSpeech', 'speakText', 'clearActiveProviderAudioFile'],
    uiControl: sendable ? 'Allow remote speech playback with local cleanup.' : 'Use local device speech fallback only.',
    failureBehavior: 'Throw speech_unavailable or fall back to local speech when remote speech is not contract-backed.',
  })
}

function buildEmbeddingsEntry(
  provider: AIProvider,
  _modelConfig: AIModel,
  family: ProviderParameterFamily,
): ProviderParameterMatrixEntry {
  const endpointRouted = provider.type === 'openai' || provider.type === 'openai-compatible' || provider.type === 'xiaomi-mimo'
  const declared = provider.capabilities?.embeddings === true
  const contractAllowed = providerCompatibilityCapabilityCanBeSentForProvider(provider, 'embeddings', declared)
  const sendable = endpointRouted && declared && contractAllowed
  const docs = embeddingParameterEvidence(provider, family)
  if (endpointRouted || family === 'openai-compatible') {
    return entry({
      capability: 'embeddings',
      status: sendable ? 'sendable' : 'blocked',
      requestPath: ['embeddings', 'model', 'input'],
      valueShape: 'OpenAI-compatible embeddings request; runtime sends selected embedding model and bounded text input.',
      docEvidence: docs,
      runtimeEvidence: ['embedProviderText', 'createProviderEmbeddingAdapter', 'resolveProviderEmbeddingModel'],
      uiControl: sendable ? 'Allow provider-first RAG embedding strategy.' : 'Use local ONNX or hash embedding fallback.',
      failureBehavior: 'Throw embeddings_endpoint_unavailable or embeddings_unsupported_by_contract before request when route evidence is missing.',
    })
  }
  if (family === 'google') {
    return entry({
      capability: 'embeddings',
      status: 'blocked',
      requestPath: ['models', 'embedContent|batchEmbedContents'],
      valueShape: 'Gemini embeddings endpoint exists, but IsleMind has no native Gemini embedding adapter yet.',
      docEvidence: docs,
      runtimeEvidence: ['embedProviderText'],
      uiControl: 'Keep provider embedding disabled until Gemini embedding routing and tests are added.',
      failureBehavior: 'Use local ONNX or hash embedding fallback.',
    })
  }
  return entry({
    capability: 'embeddings',
    status: family === 'unknown' ? 'unknown' : 'blocked',
    requestPath: [],
    valueShape: 'Provider embedding request shape is not mapped for this family.',
    docEvidence: docs,
    runtimeEvidence: ['embedProviderText'],
    uiControl: 'Use local ONNX or hash embedding fallback.',
    failureBehavior: 'Do not send embedding requests without a routed endpoint and contract evidence.',
  })
}

function buildRerankEntry(
  provider: AIProvider,
  family: ProviderParameterFamily,
): ProviderParameterMatrixEntry {
  const declared = provider.capabilities?.rerank === true
  const contractAllowed = providerCompatibilityCapabilityCanBeSentForProvider(provider, 'rerank', declared)
  const docs = providerOfficialDocsMatching(provider, /rerank|reranker|rank/i, 'rerank')
  const knownRoute = declared || contractAllowed || docs.length > 0
  return entry({
    capability: 'rerank',
    status: knownRoute || family !== 'unknown' ? 'blocked' : 'unknown',
    requestPath: knownRoute ? ['rerank', 'model', 'query', 'documents'] : [],
    valueShape: 'Provider-native rerank request shapes vary; IsleMind has not enabled a provider rerank adapter or parser.',
    docEvidence: docs,
    runtimeEvidence: ['rerankRetrievalSources', 'rerankAgenticCandidates'],
    uiControl: 'Keep provider rerank disabled; use local statistical, cross-encoder fallback, or ColBERT-lite ordering.',
    failureBehavior: 'Do not send native rerank requests until request shaping, model selection, response parsing, and fixtures are mapped.',
  })
}

function buildSamplingEntry(
  provider: AIProvider,
  modelConfig: AIModel,
  family: ProviderParameterFamily,
): ProviderParameterMatrixEntry {
  const support = resolveProviderRequestParameterSupport(provider, modelConfig)
  const parameters = (['temperature', 'topP', 'topK'] as const).map((parameter) => ({
    parameter,
    status: support.entries[parameter].supported ? 'sendable' as const : 'blocked' as const,
    requestPath: support.entries[parameter].wirePath ?? [],
    reason: support.entries[parameter].reason,
  }))
  const supportsSampling = parameters.some((parameter) => parameter.status === 'sendable')
  return entry({
    capability: 'sampling',
    status: supportsSampling ? 'sendable' : 'blocked',
    requestPath: [...new Set(parameters.flatMap((parameter) => parameter.requestPath))],
    valueShape: 'Temperature/top-p/top-k controls are clamped to provider and model ranges.',
    docEvidence: generationControlEvidence(family),
    runtimeEvidence: ['resolveProviderRequestParameters', 'modelSupportsSamplingControls'],
    uiControl: supportsSampling ? 'Show supported sampling controls.' : 'Hide sampling controls when reasoning/model constraints disallow them.',
    failureBehavior: 'Omit sampling fields for reasoning modes or models that disallow sampling.',
    parameters,
  })
}

function buildTokenBudgetEntry(
  provider: AIProvider,
  modelConfig: AIModel,
  family: ProviderParameterFamily,
): ProviderParameterMatrixEntry {
  const support = resolveProviderRequestParameterSupport(provider, modelConfig)
  const maxTokens = support.entries.maxTokens
  return entry({
    capability: 'token-budget',
    status: maxTokens.supported ? 'sendable' : 'blocked',
    requestPath: [...(maxTokens.wirePath ?? [])],
    valueShape: `Integer clamped to model max output ${modelConfig.maxOutputTokens}.`,
    docEvidence: generationControlEvidence(family),
    runtimeEvidence: ['resolveProviderRequestParameters', 'clampMaxTokens'],
    uiControl: maxTokens.supported ? 'Show max output token control when model allows generation.' : 'Hide max output token control when the model or endpoint does not accept it.',
    failureBehavior: maxTokens.supported ? 'Clamp to provider minimum and model max before sending.' : 'Omit unsupported token-budget fields.',
    parameters: [{
      parameter: 'maxTokens',
      status: maxTokens.supported ? 'sendable' : 'blocked',
      requestPath: maxTokens.wirePath ?? [],
      reason: maxTokens.reason,
    }],
  })
}

function buildNativeSearchEntry(
  provider: AIProvider,
  modelConfig: AIModel,
  family: ProviderParameterFamily,
): ProviderParameterMatrixEntry {
  const sendable = modelCapabilitySendable(provider, modelConfig.id, 'nativeSearch')
  const requestPath = family === 'google'
    ? ['tools', 'google_search']
    : family === 'anthropic' || family === 'anthropic-compatible'
      ? ['tools', 'web_search']
      : family === 'openai'
        ? ['tools', 'web_search']
        : ['tools', 'web_search_preview|web_search']
  return entry({
    capability: 'native-search',
    status: sendable ? 'sendable' : 'blocked',
    requestPath,
    valueShape: 'Provider-native search tool declaration; app-side web search remains fallback.',
    docEvidence: family === 'google'
      ? [GEMINI_OPENAI_DOC]
      : family === 'anthropic' || family === 'anthropic-compatible'
        ? [ANTHROPIC_TOOL_DOC]
        : [OPENAI_RESPONSES_DOC],
    runtimeEvidence: ['openAIResponsesNativeWebSearchTool', 'anthropicNativeWebSearchTool', 'googleNativeWebSearchTool'],
    uiControl: sendable ? 'Allow native search mode.' : 'Route search through IsleMind app-side search tools.',
    failureBehavior: 'Do not send provider-native search fields without contract or model evidence.',
  })
}

function genericParameterEntry(
  capability: ProviderParameterCapability,
  supported: boolean,
  requestPath: string[],
  notes: string,
): ProviderParameterMatrixEntry {
  return entry({
    capability,
    status: supported ? 'manual' : 'unknown',
    requestPath,
    valueShape: notes,
    docEvidence: [],
    runtimeEvidence: [],
    uiControl: supported ? 'Expose only from explicit provider metadata.' : 'Hide by default.',
    failureBehavior: 'Do not send until provider-specific docs or manual capability metadata exists.',
    notes,
  })
}

function generationControlEvidence(family: ProviderParameterFamily): ProviderParameterEvidence[] {
  if (family === 'google') return [GEMINI_GENERATE_CONTENT_DOC]
  if (family === 'anthropic' || family === 'anthropic-compatible') return [ANTHROPIC_MESSAGES_API_DOC, ANTHROPIC_SDK_EVIDENCE]
  if (family === 'openai' || family === 'openai-compatible') return [OPENAI_API_REFERENCE_DOC]
  return []
}

function streamingParameterEvidence(family: ProviderParameterFamily): ProviderParameterEvidence[] {
  if (family === 'google') return [GEMINI_GENERATE_CONTENT_DOC]
  if (family === 'anthropic' || family === 'anthropic-compatible') return [ANTHROPIC_MESSAGES_API_DOC, ANTHROPIC_SDK_EVIDENCE]
  if (family === 'openai' || family === 'openai-compatible') return [OPENAI_API_REFERENCE_DOC]
  return []
}

function audioParameterEvidence(family: ProviderParameterFamily): ProviderParameterEvidence[] {
  if (family === 'google') return [GEMINI_GENERATE_CONTENT_DOC]
  if (family === 'openai' || family === 'openai-compatible') return [OPENAI_AUDIO_API_REFERENCE_DOC]
  if (family === 'anthropic' || family === 'anthropic-compatible') return [ANTHROPIC_MESSAGES_API_DOC]
  return []
}

function embeddingParameterEvidence(provider: AIProvider, family: ProviderParameterFamily): ProviderParameterEvidence[] {
  const providerDocs = providerOfficialDocsMatching(provider, /embedding|embeddings|embed/i, 'embeddings')
  if (providerDocs.length) return providerDocs
  if (family === 'google') return [GEMINI_EMBEDDINGS_DOC]
  if (family === 'openai' || family === 'openai-compatible') return [OPENAI_EMBEDDINGS_API_REFERENCE_DOC]
  return []
}

function providerOfficialDocsMatching(provider: AIProvider, pattern: RegExp, label: string): ProviderParameterEvidence[] {
  const evidence = getProviderCompatibilityEvidenceForProvider(provider)
  return evidence.officialDocs
    .filter((url) => pattern.test(url))
    .slice(0, 3)
    .map((url) => ({
      source: 'official-docs',
      title: `${evidence.id} ${label} docs`,
      url,
      checkedAt: DOC_CHECKED_AT,
    }))
}

function entry(input: ProviderParameterMatrixEntry): ProviderParameterMatrixEntry {
  return input
}

function inferParameterFamily(provider: AIProvider): ProviderParameterFamily {
  if (provider.type === 'openai') return 'openai'
  if (provider.type === 'anthropic') return 'anthropic'
  if (provider.type === 'google') return 'google'
  if (provider.wireProtocol === 'anthropic-compatible') return 'anthropic-compatible'
  if (provider.type === 'openai-compatible' || provider.type === 'xiaomi-mimo') return 'openai-compatible'
  return 'unknown'
}

function modelCapabilitySendable(provider: AIProvider, modelId: string, capability: ProviderParameterMatrixModelCapability): boolean {
  if (provider.type === 'openai-compatible') return dependencies.providerModelCapabilityCanBeSent(provider, modelId, capability)
  if (provider.type === 'xiaomi-mimo') return dependencies.providerModelCapabilityCanBeSent(provider, modelId, capability)
  return true
}

return {
  buildProviderParameterMatrix,
  getProviderParameterEntry,
  providerParameterCanBeSent,
}
}
