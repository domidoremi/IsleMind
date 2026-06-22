import type { AIProvider, ProviderPresetId } from '@/types'
import { getModelConfig } from '@/types'
import { getProviderPreset } from '@/services/ai/providerRegistry'
import { isPerplexityProvider } from '@/services/ai/providerIdentity'
import { getBedrockRuntimeSupportIssue, isBedrockMantleProvider, isBedrockRuntimeProvider } from '@/services/ai/providerAwsBedrockRouting'
import { isBedrockProvider } from '@/services/ai/providerRequestOptimization'
import { isAzureOpenAIProvider, isAzureOpenAIV1Provider } from '@/services/ai/providerHostedRouting'
import { getHostedProviderSupportIssue, isAwsBedrockHostedProvider, isHostedProviderGap, isVertexAIOpenAICompatibleProvider, isVertexAIProvider } from '@/services/ai/providerHostedBoundary'
import { providerSupportsFileInput, providerSupportsVisionInput } from '@/services/chatProviderNativeToolUtils'
import { providerSupportsReasoning } from '@/utils/modelReasoning'
import {
  explainProviderCompatibilityCapabilityStatus,
  getProviderCompatibilityEvidenceForProvider,
  providerCompatibilityCapabilityCanBeSentForProvider,
  resolveProviderCompatibilityCapabilitySendPolicy,
  resolveProviderCompatibilityCapabilityStatus,
  type ProviderCompatibilityBehavior,
  type ProviderCompatibilityCapabilityStatus,
} from '@/services/ai/providerCompatibilityContract'

export type ProviderHostingProfile =
  | 'official'
  | 'aggregator'
  | 'relay'
  | 'local-runtime'
  | 'cloud-hosted'

export type ProviderSupportLevel =
  | 'full'
  | 'partial'
  | 'planned'
  | 'unsupported'

export type ProviderCapabilityArea =
  | 'response'
  | 'streaming'
  | 'modelCatalog'
  | 'contextLimit'
  | 'systemPromptPolicy'
  | 'safetyPolicy'
  | 'errors'
  | 'rateLimits'
  | 'deprecation'
  | 'citations'
  | 'vision'
  | 'files'
  | 'audio'
  | 'nativeSearch'
  | 'reasoning'
  | 'embeddings'
  | 'rerank'
  | 'routingTopology'
  | 'protocol'
  | 'transport'
  | 'remoteCompact'
  | 'cache'
  | 'retryPolicy'
  | 'tools'
  | 'structuredOutput'
  | 'multimodal'
  | 'complexChain'

export interface ProviderCapabilityStatus {
  area: ProviderCapabilityArea
  level: ProviderSupportLevel
  reason: string
  contractStatus?: ProviderCompatibilityCapabilityStatus
}

export interface ProviderCapabilityMatrix {
  hostingProfile: ProviderHostingProfile
  providerFamily: string
  summaryLevel: ProviderSupportLevel
  statuses: ProviderCapabilityStatus[]
}

export function buildProviderCapabilityMatrix(provider: AIProvider): ProviderCapabilityMatrix {
  const preset = getProviderPreset(provider.presetId ?? provider.detectedPresetId)
  const family = provider.presetId ?? provider.detectedPresetId ?? preset.id
  const hostingProfile = inferHostingProfile(provider)
  const statuses: ProviderCapabilityStatus[] = [
    buildResponseStatus(provider, hostingProfile),
    buildStreamingStatus(provider),
    buildModelCatalogStatus(provider, hostingProfile),
    buildContextLimitStatus(provider),
    buildSystemPromptPolicyStatus(provider),
    buildSafetyPolicyStatus(provider),
    buildErrorStatus(provider),
    buildRateLimitStatus(provider),
    buildDeprecationStatus(provider),
    buildCitationStatus(provider),
    buildVisionStatus(provider),
    buildFileStatus(provider),
    buildAudioStatus(provider),
    buildNativeSearchStatus(provider),
    buildReasoningStatus(provider),
    buildEmbeddingStatus(provider),
    buildRerankStatus(provider),
    buildRoutingTopologyStatus(provider, hostingProfile),
    buildProtocolStatus(provider, hostingProfile),
    buildTransportStatus(provider, hostingProfile),
    buildRemoteCompactStatus(provider, hostingProfile),
    buildCacheStatus(provider, hostingProfile),
    buildRetryPolicyStatus(provider),
    buildToolStatus(provider, hostingProfile),
    buildStructuredOutputStatus(provider, hostingProfile),
    buildMultimodalStatus(provider),
    buildComplexChainStatus(provider, hostingProfile),
  ]
  return {
    hostingProfile,
    providerFamily: family,
    summaryLevel: summarizeSupportLevel(statuses),
    statuses,
  }
}

function inferHostingProfile(provider: AIProvider): ProviderHostingProfile {
  const presetId = provider.presetId ?? provider.detectedPresetId
  const text = [provider.id, provider.name, provider.baseUrl, presetId].filter(Boolean).join(' ').toLowerCase()
  if (isAzureOpenAIProvider(provider)) return 'cloud-hosted'
  if (isAwsBedrockHostedProvider(provider) || isVertexAIProvider(provider)) return 'cloud-hosted'
  if (presetId === 'custom-openai-compatible' || presetId === 'custom-anthropic-compatible') return 'relay'
  if (provider.type === 'openai' || provider.type === 'anthropic' || provider.type === 'google' || provider.type === 'xiaomi-mimo') return 'official'
  if (['openrouter', 'newapi', 'sub2api'].includes(presetId ?? '')) return 'aggregator'
  if (['ollama', 'lm-studio', 'localai', 'vllm', 'sglang'].includes(presetId ?? '')) return 'local-runtime'
  if (/azure\.com|openai\.azure\.com|bedrock|amazonaws\.com|vertexai|aiplatform\.googleapis\.com|generativelanguage\.googleapis\.com\/v1beta\/projects\//.test(text)) return 'cloud-hosted'
  return 'relay'
}

function buildResponseStatus(provider: AIProvider, hostingProfile: ProviderHostingProfile): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'chat')
  if (hostingProfile === 'cloud-hosted' && isAzureOpenAIV1Provider(provider)) {
    return { area: 'response', level: 'full', contractStatus, reason: 'Azure OpenAI v1 chat and Responses paths are routed through the /openai/v1 namespace with Azure API-key auth' }
  }
  if (hostingProfile === 'cloud-hosted' && isVertexAIOpenAICompatibleProvider(provider)) {
    return { area: 'response', level: 'partial', contractStatus, reason: 'Vertex AI OpenAI-compatible chat routes through the hosted /endpoints/openapi namespace with Google Cloud access-token auth' }
  }
  if (hostingProfile === 'cloud-hosted' && isBedrockMantleProvider(provider)) {
    return { area: 'response', level: 'partial', contractStatus, reason: 'AWS Bedrock Mantle uses the OpenAI-compatible /v1 chat endpoint with Bedrock API-key bearer auth; Responses remains unclaimed until current AWS docs or live smoke prove it' }
  }
  if (hostingProfile === 'cloud-hosted' && isBedrockRuntimeProvider(provider) && !getBedrockRuntimeSupportIssue(provider)) {
    return { area: 'response', level: 'partial', contractStatus, reason: 'AWS Bedrock Runtime InvokeModel request preparation and SigV4 signing are available for non-streaming Anthropic-style chat; streaming and Converse remain planned' }
  }
  const hostedIssue = hostingProfile === 'cloud-hosted' ? getHostedProviderSupportIssue(provider, 'chat') : null
  if (hostedIssue) {
    return { area: 'response', level: 'planned', contractStatus, reason: hostedIssue.message }
  }
  return { area: 'response', level: 'full', contractStatus, reason: 'chat request path is available through the current provider runtime' }
}

function buildStreamingStatus(provider: AIProvider): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'streaming')
  if (provider.capabilities?.streaming === false) {
    return { area: 'streaming', level: 'partial', contractStatus, reason: 'provider configuration disables streaming; runtime falls back to non-streaming requests even when the provider contract has streaming evidence' }
  }
  const nonStreamingModels = providerKnownModelIds(provider)
    .filter((modelId) => getModelConfig(modelId, provider.type, provider.modelConfigs).supportsStreaming === false)
  if (nonStreamingModels.length) {
    return { area: 'streaming', level: 'partial', contractStatus, reason: `streaming is contract-aware, but ${nonStreamingModels.slice(0, 3).join(', ')} ${nonStreamingModels.length === 1 ? 'is' : 'are'} model-cataloged as non-streaming so runtime and fallback use non-streaming requests for those models` }
  }
  if (contractStatus === 'supported') {
    return { area: 'streaming', level: 'full', contractStatus, reason: 'provider streaming is contract-backed and still narrowed by model catalog metadata before requests are sent' }
  }
  if (contractStatus === 'requiresLiveKey') {
    return { area: 'streaming', level: 'partial', contractStatus, reason: 'streaming is documented for this provider family, but live smoke is still required before streaming behavior is treated as verified' }
  }
  if (contractStatus === 'partial') {
    return { area: 'streaming', level: 'partial', contractStatus, reason: 'streaming stays partially verified; runtime can fall back to non-streaming requests when model or endpoint evidence is missing' }
  }
  return { area: 'streaming', level: 'partial', contractStatus, reason: 'streaming is unclaimed by the provider contract; runtime should avoid provider-specific streaming assumptions and keep non-streaming fallback available' }
}

function providerKnownModelIds(provider: AIProvider): string[] {
  return Array.from(new Set([
    ...provider.models,
    ...(provider.manualModels ?? []),
    ...(provider.modelConfigs ?? []).map((model) => model.id),
    ...(provider.modelAliases ?? []).map((alias) => alias.model),
  ].map((model) => model.trim()).filter(Boolean)))
}

function buildModelCatalogStatus(provider: AIProvider, hostingProfile: ProviderHostingProfile): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'modelList')
  if (provider.capabilities?.modelList === false) {
    return { area: 'modelCatalog', level: 'partial', contractStatus, reason: 'generic model-list sync is intentionally disabled for this provider shape' }
  }
  if (hostingProfile === 'cloud-hosted' && isAzureOpenAIV1Provider(provider)) {
    return { area: 'modelCatalog', level: 'partial', contractStatus, reason: 'Azure OpenAI v1 model-list routing is available, but deployment and model availability can still be resource-specific' }
  }
  if (hostingProfile === 'cloud-hosted' && isVertexAIOpenAICompatibleProvider(provider)) {
    return { area: 'modelCatalog', level: 'partial', contractStatus, reason: 'Vertex AI OpenAI-compatible automatic model-list routing is not claimed by the current contract; keep model ids manual until Google Cloud docs or live smoke prove /models support' }
  }
  if (hostingProfile === 'cloud-hosted' && isBedrockMantleProvider(provider)) {
    return { area: 'modelCatalog', level: 'partial', contractStatus, reason: 'AWS Bedrock Mantle model-list routing is available through /v1/models, but region, model access, and Bedrock API key scope still apply' }
  }
  const hostedIssue = hostingProfile === 'cloud-hosted' ? getHostedProviderSupportIssue(provider, 'modelList') : null
  if (hostedIssue) {
    return { area: 'modelCatalog', level: 'planned', contractStatus, reason: hostedIssue.message }
  }
  const modelListAllowed = providerCompatibilityCapabilityCanBeSentForProvider(provider, 'modelList', provider.capabilities?.modelList === true)
  if (!modelListAllowed) {
    return { area: 'modelCatalog', level: 'partial', contractStatus, reason: 'model-list sync remains manual until the provider compatibility contract or explicit protocol-reference declaration allows /models requests' }
  }
  if (contractStatus !== 'supported') {
    return { area: 'modelCatalog', level: 'partial', contractStatus, reason: 'model-list sync is explicitly allowed for this provider, but compatibility evidence is not conformance-ready yet' }
  }
  return { area: 'modelCatalog', level: 'full', contractStatus, reason: 'provider can use the current model discovery and alias lifecycle flow' }
}

function buildContextLimitStatus(provider: AIProvider): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'contextLimit')
  if (contractStatus === 'supported') {
    return { area: 'contextLimit', level: 'full', contractStatus, reason: 'provider context and output limits flow through model catalog metadata and provider conformance clamps before requests are sent' }
  }
  if (contractStatus === 'requiresLiveKey') {
    return { area: 'contextLimit', level: 'partial', contractStatus, reason: 'context-limit policy exists, but this provider family still needs live smoke before limits can be treated as verified' }
  }
  if (contractStatus === 'partial') {
    return { area: 'contextLimit', level: 'partial', contractStatus, reason: 'context-limit policy uses configured or discovered model metadata; provider-specific limits remain partial until endpoint evidence is verified' }
  }
  return { area: 'contextLimit', level: 'partial', contractStatus, reason: 'context-limit policy falls back to local model defaults until provider evidence proves limits' }
}

function buildSystemPromptPolicyStatus(provider: AIProvider): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'systemPromptPolicy')
  if (contractStatus === 'supported') {
    return { area: 'systemPromptPolicy', level: 'full', contractStatus, reason: 'system prompt is built once with provider-aware capability rules, counted in context budgeting, and emitted through the provider-specific request shape' }
  }
  if (contractStatus === 'requiresLiveKey') {
    return { area: 'systemPromptPolicy', level: 'partial', contractStatus, reason: 'system prompt policy is mapped in the shared runtime, but this provider family still needs live smoke to verify provider-specific instruction handling' }
  }
  if (contractStatus === 'partial') {
    return { area: 'systemPromptPolicy', level: 'partial', contractStatus, reason: 'system prompt policy uses the shared prompt builder and provider-specific request shapes; endpoint-specific instruction semantics remain partial until verified' }
  }
  return { area: 'systemPromptPolicy', level: 'partial', contractStatus, reason: 'system prompt policy falls back to generic prompt packing until provider evidence proves instruction semantics' }
}

function buildSafetyPolicyStatus(provider: AIProvider): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'safetyPolicy')
  if (contractStatus === 'supported') {
    return { area: 'safetyPolicy', level: 'full', contractStatus, reason: 'runtime applies provider-aware capability boundaries, conformance blockers, payload-policy checks, and non-retryable safety-refusal classification before fallback decisions' }
  }
  if (contractStatus === 'requiresLiveKey') {
    return { area: 'safetyPolicy', level: 'partial', contractStatus, reason: 'runtime safety guardrails are available, but this provider family still needs live smoke to verify provider-specific refusal and policy behavior' }
  }
  if (contractStatus === 'partial') {
    return { area: 'safetyPolicy', level: 'partial', contractStatus, reason: 'runtime safety guardrails are available through generic conformance and payload policy; provider-specific safety settings remain partially verified' }
  }
  return { area: 'safetyPolicy', level: 'partial', contractStatus, reason: 'runtime safety guardrails fall back to generic conformance and payload policy until provider evidence proves safety semantics' }
}

function buildErrorStatus(provider: AIProvider): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'errors')
  if (contractStatus === 'supported') {
    return { area: 'errors', level: 'full', contractStatus, reason: 'provider HTTP failures are normalized through shared status classification, safe error-detail extraction, chat error mapping, upstream.error logging, and fallback diagnostics' }
  }
  if (contractStatus === 'requiresLiveKey') {
    return { area: 'errors', level: 'partial', contractStatus, reason: 'generic provider error classification is available, but this provider family still needs live smoke to verify provider-specific error payloads' }
  }
  if (contractStatus === 'partial') {
    return { area: 'errors', level: 'partial', contractStatus, reason: 'generic provider error classification and safe detail extraction are available; provider-specific error shapes remain partially verified' }
  }
  return { area: 'errors', level: 'partial', contractStatus, reason: 'provider errors fall back to generic HTTP and message classification until provider evidence proves error payload semantics' }
}

function buildRateLimitStatus(provider: AIProvider): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'rateLimits')
  if (contractStatus === 'supported') {
    return { area: 'rateLimits', level: 'full', contractStatus, reason: '429 and documented rate-limit failures map to rate_limited, bounded retry/backoff, provider-health cooldown, circuit-breaker logging, and runtime fallback decisions' }
  }
  if (contractStatus === 'requiresLiveKey') {
    return { area: 'rateLimits', level: 'partial', contractStatus, reason: 'generic 429 and rate-limit handling is available, but this provider family still needs live smoke to verify quota, reset, and retry-after behavior' }
  }
  if (contractStatus === 'partial') {
    return { area: 'rateLimits', level: 'partial', contractStatus, reason: 'generic 429 and rate-limit text handling is available; provider-specific quota, reset, and retry-after semantics remain partially verified' }
  }
  return { area: 'rateLimits', level: 'partial', contractStatus, reason: 'rate-limit handling falls back to generic 429 detection and local cooldown until provider evidence proves rate-limit semantics' }
}

function buildDeprecationStatus(provider: AIProvider): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'deprecation')
  const deprecatedModels = providerKnownModelIds(provider)
    .map((modelId) => ({ modelId, config: getModelConfig(modelId, provider.type, provider.modelConfigs) }))
    .filter((item) => item.config.deprecated === true)
  if (deprecatedModels.length) {
    const examples = deprecatedModels
      .slice(0, 3)
      .map((item) => item.config.deprecatedReason ? `${item.modelId}: ${item.config.deprecatedReason}` : item.modelId)
      .join('; ')
    return { area: 'deprecation', level: 'partial', contractStatus, reason: `model catalog marks ${deprecatedModels.length} configured model(s) as deprecated; fallback rejects those models before retrying candidates. ${examples}` }
  }
  if (contractStatus === 'supported') {
    return { area: 'deprecation', level: 'full', contractStatus, reason: 'model deprecation state is contract-backed through model catalog metadata and fallback candidate rejection' }
  }
  if (contractStatus === 'requiresLiveKey') {
    return { area: 'deprecation', level: 'partial', contractStatus, reason: 'deprecation handling exists in the model catalog and fallback planner, but this provider family still needs live smoke or upstream model metadata to verify current model retirement state' }
  }
  if (contractStatus === 'partial') {
    return { area: 'deprecation', level: 'partial', contractStatus, reason: 'model deprecation handling falls back to local catalog metadata until provider-specific retirement metadata is verified' }
  }
  return { area: 'deprecation', level: 'partial', contractStatus, reason: 'model deprecation behavior is unclaimed by the provider contract; fallback only uses local catalog metadata and explicit configured model flags' }
}

function buildCitationStatus(provider: AIProvider): ProviderCapabilityStatus {
  const evidence = getProviderCompatibilityEvidenceForProvider(provider)
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(evidence.id, 'citations')
  const parserBacked = providerNativeCitationParserCovered(evidence.id)
  if (contractStatus === 'supported' && parserBacked) {
    return { area: 'citations', level: 'full', contractStatus, reason: 'provider-native citation payloads are contract-backed and parsed with local RAG/retrieval-source citations as fallback evidence' }
  }
  if (contractStatus === 'supported') {
    return { area: 'citations', level: 'partial', contractStatus, reason: 'citation behavior is source-backed in the provider contract, but provider-native citation payload parsing still needs provider-specific fixtures before full runtime support' }
  }
  if (contractStatus === 'requiresLiveKey') {
    return { area: 'citations', level: 'partial', contractStatus, reason: 'citation behavior is documented, but provider-native citation payload parsing still needs live smoke before it can be treated as verified' }
  }
  if (contractStatus === 'partial') {
    return { area: 'citations', level: 'partial', contractStatus, reason: 'local RAG and retrieval-source citations are available; provider-native citation payload shapes remain partially verified' }
  }
  return { area: 'citations', level: 'partial', contractStatus, reason: 'provider-native citation payloads are unclaimed; IsleMind keeps local RAG, web, and retrieval-source citations as fallback evidence' }
}

function providerNativeCitationParserCovered(evidenceId: ProviderPresetId): boolean {
  return evidenceId === 'anthropic' ||
    evidenceId === 'google' ||
    evidenceId === 'perplexity' ||
    evidenceId === 'xiaomi-mimo'
}

function buildVisionStatus(provider: AIProvider): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'vision')
  const modelIds = providerKnownModelIds(provider)
  const visionModels = modelIds
    .map((modelId) => ({ modelId, config: getModelConfig(modelId, provider.type, provider.modelConfigs) }))
    .filter((item) => providerSupportsVisionInput(provider, item.config))
  if (visionModels.length) {
    const sourceBacked = visionModels.some((item) => item.config.source === 'remote' || item.config.sourceUrl)
    const examples = visionModels.slice(0, 3).map((item) => item.modelId).join(', ')
    if (contractStatus === 'supported' && sourceBacked) {
      return { area: 'vision', level: 'full', contractStatus, reason: `vision input is contract-backed and model-catalog gated for ${examples}` }
    }
    return { area: 'vision', level: 'partial', contractStatus, reason: `vision input is allowed for ${examples}, but endpoint/model evidence is not complete enough to treat every configured model as vision-capable` }
  }
  if (provider.capabilities?.vision === true) {
    return { area: 'vision', level: 'partial', contractStatus, reason: 'provider configuration declares vision, but model metadata or the compatibility contract does not allow image input for the configured models' }
  }
  if (contractStatus === 'supported') {
    return { area: 'vision', level: 'partial', contractStatus, reason: 'provider contract includes vision, but no configured model currently proves image input support through model catalog metadata' }
  }
  if (contractStatus === 'requiresLiveKey') {
    return { area: 'vision', level: 'partial', contractStatus, reason: 'vision input is documented for this provider family, but live smoke or remote model metadata is still required before image parameters are treated as verified' }
  }
  if (contractStatus === 'partial') {
    return { area: 'vision', level: 'partial', contractStatus, reason: 'vision input remains partially verified; image attachments stay model-metadata gated before request payloads include image_url parts' }
  }
  return { area: 'vision', level: 'partial', contractStatus, reason: 'vision input is unclaimed by the provider contract; image attachments remain disabled unless endpoint evidence or remote model metadata proves support' }
}

function buildFileStatus(provider: AIProvider): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'files')
  const modelIds = providerKnownModelIds(provider)
  const fileModels = modelIds
    .map((modelId) => ({ modelId, config: getModelConfig(modelId, provider.type, provider.modelConfigs) }))
    .filter((item) => providerSupportsFileInput(provider, item.config))
  if (fileModels.length) {
    const sourceBacked = fileModels.some((item) => item.config.source === 'remote' || item.config.sourceUrl)
    const modelMetadataBacked = fileModels.some((item) => item.config.supportsFiles === true)
    const examples = fileModels.slice(0, 3).map((item) => item.modelId).join(', ')
    if (contractStatus === 'supported' && sourceBacked && modelMetadataBacked) {
      return { area: 'files', level: 'full', contractStatus, reason: `file input is contract-backed and model-catalog gated for ${examples}` }
    }
    if (contractStatus === 'supported' && sourceBacked) {
      return { area: 'files', level: 'partial', contractStatus, reason: `file input is contract-backed for ${examples}, but the configured model metadata does not prove file attachment support yet` }
    }
    return { area: 'files', level: 'partial', contractStatus, reason: `file input is allowed for ${examples}, but endpoint/model evidence is not complete enough to treat every configured model as file-capable` }
  }
  if (provider.capabilities?.files === true) {
    return { area: 'files', level: 'partial', contractStatus, reason: 'provider configuration declares files, but model metadata or the compatibility contract does not allow file attachments for the configured models' }
  }
  if (contractStatus === 'supported') {
    return { area: 'files', level: 'partial', contractStatus, reason: 'provider contract includes files, but no configured model currently proves file attachment support through model catalog metadata' }
  }
  if (contractStatus === 'requiresLiveKey') {
    return { area: 'files', level: 'partial', contractStatus, reason: 'file input is documented for this provider family, but live smoke or remote model metadata is still required before file_data or file_url parameters are treated as verified' }
  }
  if (contractStatus === 'partial') {
    return { area: 'files', level: 'partial', contractStatus, reason: 'file input remains partially verified; file attachments stay model-metadata gated before request payloads include file_data or file_url parts' }
  }
  return { area: 'files', level: 'partial', contractStatus, reason: 'file input is unclaimed by the provider contract; file attachments remain disabled unless endpoint evidence or remote model metadata proves support' }
}

function buildAudioStatus(provider: AIProvider): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'audio')
  const declarations = [
    { label: 'chat audio input', enabled: provider.capabilities?.audioInput === true },
    { label: 'audio transcription', enabled: provider.capabilities?.audioTranscription === true },
    { label: 'speech output', enabled: provider.capabilities?.speech === true },
  ].filter((item) => item.enabled)
  const sendable = providerCompatibilityCapabilityCanBeSentForProvider(provider, 'audio', true)
  if (declarations.length && sendable) {
    const labels = declarations.map((item) => item.label).join(', ')
    if (contractStatus === 'supported') {
      return { area: 'audio', level: 'full', contractStatus, reason: `audio is contract-backed for ${labels}; transcription and speech requests are still gated by explicit provider flags before runtime sends audio endpoints` }
    }
    if (contractStatus === 'requiresLiveKey') {
      return { area: 'audio', level: 'partial', contractStatus, reason: `audio is declared for ${labels}, but live smoke is still required before audio endpoints are treated as verified` }
    }
    return { area: 'audio', level: 'partial', contractStatus, reason: `audio is explicitly declared for ${labels}, but provider-specific endpoint behavior still needs fixture or live-smoke evidence before full support` }
  }
  if (declarations.length) {
    const labels = declarations.map((item) => item.label).join(', ')
    return { area: 'audio', level: 'partial', contractStatus, reason: `provider configuration declares ${labels}, but the compatibility contract does not allow audio parameters or audio endpoints for this provider family yet` }
  }
  if (contractStatus === 'supported') {
    return { area: 'audio', level: 'partial', contractStatus, reason: 'provider contract includes audio, but no configured audio input, transcription, or speech capability is enabled for runtime requests' }
  }
  if (contractStatus === 'requiresLiveKey') {
    return { area: 'audio', level: 'partial', contractStatus, reason: 'audio is documented for this provider family, but live smoke and explicit provider audio flags are still required before runtime sends audio endpoints' }
  }
  if (contractStatus === 'partial') {
    return { area: 'audio', level: 'partial', contractStatus, reason: 'audio remains partially verified; runtime keeps audio input, transcription, and speech disabled unless provider flags and contract evidence agree' }
  }
  return { area: 'audio', level: 'partial', contractStatus, reason: 'audio is unclaimed by the provider contract; runtime omits audio input, transcription, and speech endpoints unless endpoint evidence proves support' }
}

function buildNativeSearchStatus(provider: AIProvider): ProviderCapabilityStatus {
  const evidence = getProviderCompatibilityEvidenceForProvider(provider)
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(evidence.id, 'nativeSearch')
  const explicitDeclaration = provider.capabilities?.nativeSearch === true
  const sendPolicy = resolveProviderCompatibilityCapabilitySendPolicy(provider, 'nativeSearch', explicitDeclaration)
  const allowed = sendPolicy.allowed
  if (allowed && contractStatus === 'supported') {
    const reason = sendPolicy.sendSource === 'explicit_declaration'
      ? 'provider-native search is explicitly declared and contract-allowed; runtime may emit provider-specific search tools while fallback keeps native-search requirements visible'
      : 'provider-native search is identity-bound and contract-backed; runtime may emit provider-specific search tools while fallback keeps native-search requirements visible'
    return { area: 'nativeSearch', level: 'full', contractStatus, reason }
  }
  if (allowed && contractStatus === 'requiresLiveKey') {
    return { area: 'nativeSearch', level: 'partial', contractStatus, reason: 'provider-native search is declared and may be sent, but this provider family still needs live smoke to verify provider-specific search tool behavior' }
  }
  if (allowed && explicitDeclaration) {
    return { area: 'nativeSearch', level: 'partial', contractStatus, reason: 'provider-native search is explicitly declared and allowed as a protocol-reference capability; endpoint behavior still needs fixture or live-smoke evidence before full support' }
  }
  if (explicitDeclaration) {
    return { area: 'nativeSearch', level: 'partial', contractStatus, reason: 'provider configuration declares native search, but the compatibility contract does not allow provider-native search parameters for this provider family yet' }
  }
  if (contractStatus === 'supported' || contractStatus === 'requiresLiveKey') {
    return { area: 'nativeSearch', level: 'partial', contractStatus, reason: 'provider-native search is documented, but this provider identity or endpoint has not explicitly proven it can receive native search parameters' }
  }
  if (contractStatus === 'partial') {
    return { area: 'nativeSearch', level: 'partial', contractStatus, reason: 'native search evidence is partial; web search stays on app-side tools until provider-specific request fields are verified' }
  }
  return { area: 'nativeSearch', level: 'partial', contractStatus, reason: 'provider-native search is unclaimed; web search falls back to IsleMind app-side search tools instead of provider-specific request parameters' }
}

function buildReasoningStatus(provider: AIProvider): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'reasoning')
  const reasoningModels = providerKnownModelIds(provider)
    .map((modelId) => ({ modelId, config: getModelConfig(modelId, provider.type, provider.modelConfigs) }))
    .filter((item) => providerSupportsReasoning(provider, item.modelId))
  if (reasoningModels.length) {
    const sourceBacked = reasoningModels.some((item) => item.config.source === 'remote' || item.config.sourceUrl)
    const modelMetadataBacked = reasoningModels.some((item) => Boolean(item.config.reasoningMode || item.config.reasoningEfforts?.length))
    const examples = reasoningModels.slice(0, 3).map((item) => item.modelId).join(', ')
    if (contractStatus === 'supported' && sourceBacked && modelMetadataBacked) {
      return { area: 'reasoning', level: 'full', contractStatus, reason: `reasoning controls are contract-backed and model-catalog gated for ${examples}` }
    }
    if (contractStatus === 'supported' && sourceBacked) {
      return { area: 'reasoning', level: 'partial', contractStatus, reason: `reasoning controls are contract-backed for ${examples}, but the configured model metadata does not prove reasoning request shape yet` }
    }
    return { area: 'reasoning', level: 'partial', contractStatus, reason: `reasoning controls are allowed for ${examples}, but endpoint/model evidence is not complete enough to treat every configured model as reasoning-capable` }
  }
  if (provider.capabilities?.reasoningEffort === true) {
    return { area: 'reasoning', level: 'partial', contractStatus, reason: 'provider configuration declares reasoning controls, but model metadata or the compatibility contract does not allow reasoning parameters for the configured models' }
  }
  if (contractStatus === 'supported') {
    return { area: 'reasoning', level: 'partial', contractStatus, reason: 'provider contract includes reasoning, but no configured model currently proves reasoning controls through model catalog metadata' }
  }
  if (contractStatus === 'requiresLiveKey') {
    return { area: 'reasoning', level: 'partial', contractStatus, reason: 'reasoning controls are documented for this provider family, but live smoke or remote model metadata is still required before reasoning_effort or thinking parameters are treated as verified' }
  }
  if (contractStatus === 'partial') {
    return { area: 'reasoning', level: 'partial', contractStatus, reason: 'reasoning controls remain partially verified; request parameters stay model-metadata gated before runtime emits reasoning_effort or provider thinking fields' }
  }
  return { area: 'reasoning', level: 'partial', contractStatus, reason: 'reasoning controls are unclaimed by the provider contract; runtime omits reasoning_effort and provider thinking parameters unless endpoint evidence or remote model metadata proves support' }
}

function buildEmbeddingStatus(provider: AIProvider): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'embeddings')
  const explicitDeclaration = provider.capabilities?.embeddings === true
  const allowed = providerCompatibilityCapabilityCanBeSentForProvider(provider, 'embeddings', explicitDeclaration)
  if (allowed && contractStatus === 'supported') {
    return { area: 'embeddings', level: 'full', contractStatus, reason: 'provider embeddings can be sent through the contract-backed /embeddings route and used as a RAG quality upgrade' }
  }
  if (allowed) {
    return { area: 'embeddings', level: 'partial', contractStatus, reason: 'provider embeddings are explicitly declared and can be sent, but provider/model availability remains endpoint-specific' }
  }
  if (explicitDeclaration) {
    return { area: 'embeddings', level: 'partial', contractStatus, reason: 'provider configuration declares embeddings, but the compatibility contract does not allow /embeddings requests for this provider family yet' }
  }
  if (contractStatus === 'partial') {
    return { area: 'embeddings', level: 'partial', contractStatus, reason: 'provider docs mention embeddings, but IsleMind waits for an explicit endpoint/model declaration before sending provider embedding requests' }
  }
  return { area: 'embeddings', level: 'partial', contractStatus, reason: 'provider embeddings are unclaimed; RAG falls back to local ONNX or hash embeddings' }
}

function buildRerankStatus(provider: AIProvider): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'rerank')
  const explicitDeclaration = provider.capabilities?.rerank === true
  const allowed = providerCompatibilityCapabilityCanBeSentForProvider(provider, 'rerank', explicitDeclaration)
  if (allowed) {
    return { area: 'rerank', level: 'partial', contractStatus, reason: 'provider rerank is allowed by the compatibility contract, but IsleMind RAG still needs a provider rerank adapter and fixtures before replacing local rerank fallbacks' }
  }
  if (explicitDeclaration) {
    return { area: 'rerank', level: 'partial', contractStatus, reason: 'provider configuration declares rerank, but the compatibility contract does not allow provider rerank requests; RAG keeps local statistical, cross-encoder fallback, or ColBERT-lite ordering' }
  }
  if (contractStatus === 'partial') {
    return { area: 'rerank', level: 'partial', contractStatus, reason: 'provider rerank evidence is partial; RAG keeps local rerank ordering until request shape, model selection, and response parsing are covered' }
  }
  return { area: 'rerank', level: 'partial', contractStatus, reason: 'provider rerank is unclaimed; RAG uses local statistical, cross-encoder fallback, or ColBERT-lite ordering' }
}

function buildRoutingTopologyStatus(provider: AIProvider, hostingProfile: ProviderHostingProfile): ProviderCapabilityStatus {
  const evidence = getProviderCompatibilityEvidenceForProvider(provider)
  if (hostingProfile === 'local-runtime') {
    const contractStatus = resolveProviderCompatibilityCapabilityStatus(evidence.id, 'localRuntime')
    if (contractStatus === 'supported') {
      return { area: 'routingTopology', level: 'full', contractStatus, reason: 'local runtime routing is contract-backed; requests still depend on the reachable local server, installed model, and declared local capabilities' }
    }
    if (contractStatus === 'requiresLiveKey') {
      return { area: 'routingTopology', level: 'partial', contractStatus, reason: 'local runtime routing is documented, but reachability and installed-model behavior still need live smoke before requests are treated as verified' }
    }
    return { area: 'routingTopology', level: 'partial', contractStatus, reason: 'local runtime routing is unclaimed by the provider contract; keep capabilities manual or discovered before sending provider-specific parameters' }
  }
  if (hostingProfile === 'cloud-hosted') {
    const contractStatus = resolveProviderCompatibilityCapabilityStatus(evidence.id, 'hostedRouting')
    if (contractStatus === 'supported') {
      return { area: 'routingTopology', level: 'partial', contractStatus, reason: 'hosted routing is contract-backed, but resource, region, deployment, and account-scope differences remain provider-specific' }
    }
    if (contractStatus === 'requiresLiveKey') {
      return { area: 'routingTopology', level: 'partial', contractStatus, reason: 'hosted routing is documented but still needs live smoke for the configured cloud resource, region, deployment, and credentials' }
    }
    return { area: 'routingTopology', level: 'partial', contractStatus, reason: 'hosted routing is not claimed by the compatibility contract for this provider shape; requests stay behind hosted-boundary checks and provider-specific route detection' }
  }
  if (hostingProfile === 'aggregator' || hostingProfile === 'relay') {
    const contractStatus = resolveProviderCompatibilityCapabilityStatus(evidence.id, 'relayRouting')
    if (contractStatus === 'supported') {
      return { area: 'routingTopology', level: 'partial', contractStatus, reason: 'relay routing is contract-backed, while upstream model/provider capability differences still require model metadata, explicit declarations, or fallback planning' }
    }
    if (contractStatus === 'requiresLiveKey') {
      return { area: 'routingTopology', level: 'partial', contractStatus, reason: 'relay routing requires live smoke or explicit endpoint declarations before upstream capabilities can be trusted' }
    }
    return { area: 'routingTopology', level: 'partial', contractStatus, reason: 'relay routing is only protocol-referenced; keep optional provider parameters disabled until endpoint evidence, model metadata, or explicit declarations prove them' }
  }
  return { area: 'routingTopology', level: 'full', contractStatus: 'unsupported', reason: 'official direct provider routing is modeled without hosted, relay, or local-runtime indirection' }
}

function buildProtocolStatus(provider: AIProvider, hostingProfile: ProviderHostingProfile): ProviderCapabilityStatus {
  if (hostingProfile === 'cloud-hosted' && isAzureOpenAIV1Provider(provider)) {
    return { area: 'protocol', level: 'partial', reason: 'Azure OpenAI v1 follows OpenAI-compatible request shapes, while deployment and Foundry resource semantics remain provider-specific' }
  }
  if (hostingProfile === 'cloud-hosted' && isVertexAIOpenAICompatibleProvider(provider)) {
    return { area: 'protocol', level: 'partial', reason: 'Vertex AI OpenAI-compatible endpoints use OpenAI chat-completions shapes, while native Gemini Vertex paths remain provider-specific' }
  }
  if (hostingProfile === 'cloud-hosted' && isBedrockMantleProvider(provider)) {
    return { area: 'protocol', level: 'partial', reason: 'AWS Bedrock Mantle exposes OpenAI-compatible Chat Completions and Models APIs, while Responses and Bedrock Runtime Converse remain unclaimed until source-backed' }
  }
  if (hostingProfile === 'cloud-hosted' && isBedrockRuntimeProvider(provider) && !getBedrockRuntimeSupportIssue(provider)) {
    return { area: 'protocol', level: 'partial', reason: 'AWS Bedrock Runtime can prepare signed InvokeModel requests with Bedrock Anthropic Messages payloads; Converse and model-family transforms remain incomplete' }
  }
  const hostedIssue = hostingProfile === 'cloud-hosted' ? getHostedProviderSupportIssue(provider, 'chat') : null
  if (hostedIssue) {
    return { area: 'protocol', level: 'planned', reason: hostedIssue.message }
  }
  if (provider.wireProtocol === 'anthropic-compatible') {
    return { area: 'protocol', level: 'partial', reason: 'Anthropic-compatible protocol is supported, but not all OpenAI Responses semantics apply' }
  }
  return { area: 'protocol', level: 'full', reason: 'provider routes through a known official or compatible protocol family' }
}

function buildTransportStatus(provider: AIProvider, hostingProfile: ProviderHostingProfile): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'responsesWebSocket')
  const hostedIssue = hostingProfile === 'cloud-hosted' ? getHostedProviderSupportIssue(provider, 'chat') : null
  if (hostedIssue) {
    return { area: 'transport', level: 'planned', contractStatus, reason: hostedIssue.message }
  }
  if (hostingProfile === 'cloud-hosted' && isBedrockRuntimeProvider(provider)) {
    return { area: 'transport', level: 'partial', contractStatus, reason: 'AWS Bedrock Runtime currently supports signed non-streaming InvokeModel preparation; response streaming requires InvokeModelWithResponseStream or ConverseStream support' }
  }
  if (provider.capabilities?.responsesWebSocket === true && contractStatus === 'supported' && providerCompatibilityCapabilityCanBeSentForProvider(provider, 'responsesWebSocket', true)) {
    return { area: 'transport', level: 'full', contractStatus, reason: 'provider declares contract-backed Responses WebSocket support in addition to HTTP streaming' }
  }
  if (provider.capabilities?.responsesWebSocket === true) {
    return { area: 'transport', level: 'partial', contractStatus, reason: 'provider configuration declares WebSocket support, but the compatibility contract does not allow this route yet' }
  }
  return { area: 'transport', level: 'partial', contractStatus, reason: 'provider currently relies on HTTP or SSE transport without declared WebSocket support' }
}

function buildRemoteCompactStatus(provider: AIProvider, hostingProfile: ProviderHostingProfile): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'remoteCompact')
  if (provider.capabilities?.remoteCompact === true && provider.capabilities?.responsesApi === true && contractStatus === 'supported' && providerCompatibilityCapabilityCanBeSentForProvider(provider, 'remoteCompact', true)) {
    return { area: 'remoteCompact', level: 'full', contractStatus, reason: 'provider declares contract-backed Responses-based remote compact support' }
  }
  if (provider.capabilities?.remoteCompact === true) {
    return { area: 'remoteCompact', level: 'partial', contractStatus, reason: 'provider configuration declares remote compact, but the compatibility contract does not allow this route yet' }
  }
  if (hostingProfile === 'cloud-hosted' && isAzureOpenAIV1Provider(provider) && provider.capabilities?.responsesApi === true) {
    return { area: 'remoteCompact', level: 'partial', contractStatus, reason: 'Azure OpenAI v1 Responses routing is available, but remote compact depends on model, region, and resource support' }
  }
  const hostedIssue = hostingProfile === 'cloud-hosted' ? getHostedProviderSupportIssue(provider, 'remoteCompact') : null
  if (hostedIssue) {
    return { area: 'remoteCompact', level: 'planned', contractStatus, reason: hostedIssue.message }
  }
  if (hostingProfile === 'cloud-hosted' && isBedrockMantleProvider(provider)) {
    return { area: 'remoteCompact', level: 'partial', contractStatus, reason: 'AWS Bedrock Mantle Responses routing is not claimed by the current compatibility contract; local compression remains fallback until current AWS docs or live smoke prove Responses compact support' }
  }
  if (hostingProfile === 'cloud-hosted' && isVertexAIOpenAICompatibleProvider(provider)) {
    return { area: 'remoteCompact', level: 'partial', contractStatus, reason: 'Vertex AI OpenAI-compatible chat can run without remote compact; local compression remains the fallback because Responses and model-list routing are not claimed' }
  }
  if (provider.capabilities?.responsesApi === true) {
    return { area: 'remoteCompact', level: 'partial', contractStatus, reason: 'Responses path exists, but remote compact is not explicitly declared' }
  }
  return { area: 'remoteCompact', level: 'partial', contractStatus, reason: 'provider falls back to local compression because remote compact is not declared' }
}

function buildCacheStatus(provider: AIProvider, hostingProfile: ProviderHostingProfile): ProviderCapabilityStatus {
  const hostedIssue = hostingProfile === 'cloud-hosted' ? getHostedProviderSupportIssue(provider, 'chat') : null
  if (hostedIssue) {
    return { area: 'cache', level: 'planned', reason: hostedIssue.message }
  }
  if (isBedrockMantleProvider(provider)) {
    return { area: 'cache', level: 'partial', reason: 'AWS Bedrock Mantle can route OpenAI-compatible requests, while prompt-cache semantics remain model/provider-specific and require runtime observation' }
  }
  if (isBedrockProvider(provider)) {
    return { area: 'cache', level: 'partial', reason: 'Bedrock-style cache injection is implemented through request optimization, not generic provider cache detection' }
  }
  return { area: 'cache', level: 'partial', reason: 'cache behavior is provider-specific and only partially implemented outside Bedrock-style paths' }
}

function buildRetryPolicyStatus(provider: AIProvider): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'retryPolicy')
  if (contractStatus === 'supported') {
    return { area: 'retryPolicy', level: 'full', contractStatus, reason: 'runtime applies timeout, retry, retry-delay, and circuit-breaker policy before provider fallback decisions' }
  }
  if (contractStatus === 'requiresLiveKey') {
    return { area: 'retryPolicy', level: 'partial', contractStatus, reason: 'runtime retry policy is available, but this provider family still needs live smoke to verify rate-limit and transient-error behavior' }
  }
  if (contractStatus === 'partial') {
    return { area: 'retryPolicy', level: 'partial', contractStatus, reason: 'runtime retry policy is available with generic transient-status handling; provider-specific retry and rate-limit semantics remain partially verified' }
  }
  return { area: 'retryPolicy', level: 'partial', contractStatus, reason: 'runtime retry policy falls back to generic transient-error handling until provider evidence proves retry semantics' }
}

function buildToolStatus(provider: AIProvider, hostingProfile: ProviderHostingProfile): ProviderCapabilityStatus {
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(getProviderCompatibilityEvidenceForProvider(provider).id, 'tools')
  const hostedIssue = hostingProfile === 'cloud-hosted' ? getHostedProviderSupportIssue(provider, 'tools') : null
  if (hostedIssue) {
    return { area: 'tools', level: 'planned', contractStatus, reason: hostedIssue.message }
  }
  if (provider.capabilities?.nativeTools === true && contractStatus === 'supported' && providerCompatibilityCapabilityCanBeSentForProvider(provider, 'tools', true)) {
    if (isBedrockMantleProvider(provider)) {
      return { area: 'tools', level: 'partial', contractStatus, reason: 'AWS Bedrock Mantle can pass OpenAI-compatible tool declarations, while model-specific native tool behavior must still be verified per model' }
    }
    return { area: 'tools', level: 'full', contractStatus, reason: 'provider declares contract-backed native tool support and can also use IsleMind MCP/tool runtime' }
  }
  if (provider.capabilities?.nativeTools === true) {
    return { area: 'tools', level: 'partial', contractStatus, reason: 'provider configuration declares native tools, but the compatibility contract does not allow native tool request fields yet' }
  }
  return { area: 'tools', level: 'partial', contractStatus, reason: 'provider can still use IsleMind tool runtime, but provider-native tool semantics are limited' }
}

function buildStructuredOutputStatus(provider: AIProvider, hostingProfile: ProviderHostingProfile): ProviderCapabilityStatus {
  const evidence = getProviderCompatibilityEvidenceForProvider(provider)
  const contractStatus = resolveProviderCompatibilityCapabilityStatus(evidence.id, 'structuredOutput')
  if (evidence.id === 'openai') {
    return {
      area: 'structuredOutput',
      level: 'partial',
      contractStatus,
      reason: 'provider contract has source-backed OpenAI Responses text.format and Chat Completions response_format controls for JSON object/schema output; live model behavior still needs optional smoke coverage',
    }
  }
  if (evidence.id === 'anthropic') {
    return {
      area: 'structuredOutput',
      level: 'partial',
      contractStatus,
      reason: 'provider contract has source-backed Anthropic tool input_schema controls for JSON object/schema output; live model behavior still needs optional smoke coverage',
    }
  }
  if (evidence.id === 'google') {
    return {
      area: 'structuredOutput',
      level: 'partial',
      contractStatus,
      reason: 'provider contract has source-backed Gemini generationConfig responseMimeType/responseSchema controls for JSON object/schema output; live model behavior still needs optional smoke coverage',
    }
  }
  if (evidence.id === 'deepseek') {
    return {
      area: 'structuredOutput',
      level: 'partial',
      contractStatus,
      reason: 'provider contract has source-backed DeepSeek response_format JSON object mode; JSON Schema request controls are intentionally unsupported until official docs add them',
    }
  }
  if (evidence.id === 'xai') {
    return {
      area: 'structuredOutput',
      level: 'partial',
      contractStatus,
      reason: 'provider contract has source-backed xAI response_format controls for JSON object/schema output on Chat and Responses routes; live model behavior still needs optional smoke coverage',
    }
  }
  if (evidence.id === 'openrouter') {
    return {
      area: 'structuredOutput',
      level: 'partial',
      contractStatus,
      reason: 'provider contract has source-backed OpenRouter response_format controls, gated by remote model supported_parameters when available; live upstream behavior still needs optional smoke coverage',
    }
  }
  if (evidence.id === 'cerebras' || evidence.id === 'sambanova') {
    return {
      area: 'structuredOutput',
      level: 'partial',
      contractStatus,
      reason: 'provider contract has source-backed OpenAI-compatible response_format controls for JSON object/schema output; model-specific schema behavior still needs provider conformance fixtures',
    }
  }
  if (providerCompatibilityCapabilityCanBeSentForProvider(provider, 'structuredOutput')) {
    return {
      area: 'structuredOutput',
      level: 'partial',
      contractStatus,
      reason: 'provider contract claims structured-output docs, but the generic chat runtime does not emit response_format or schema request controls yet',
    }
  }
  if (hostingProfile === 'relay' || evidence.auditState === 'protocol-reference') {
    return {
      area: 'structuredOutput',
      level: 'partial',
      contractStatus,
      reason: 'structured output is unclaimed until the endpoint, remote model metadata, or manual capability configuration declares a supported schema request shape',
    }
  }
  return {
    area: 'structuredOutput',
    level: 'partial',
    contractStatus,
    reason: 'structured output is not claimed by this provider contract until official docs and runtime request controls are mapped together',
  }
}

function buildMultimodalStatus(provider: AIProvider): ProviderCapabilityStatus {
  const capabilities = provider.capabilities
  const declarations = [
    { capability: 'vision' as const, enabled: capabilities?.vision === true, label: 'vision' },
    { capability: 'files' as const, enabled: capabilities?.files === true, label: 'files' },
    { capability: 'audio' as const, enabled: capabilities?.audioInput === true, label: 'audio input' },
    { capability: 'audio' as const, enabled: capabilities?.audioTranscription === true, label: 'audio transcription' },
    { capability: 'audio' as const, enabled: capabilities?.speech === true, label: 'speech output' },
  ].filter((item) => item.enabled)
  const sendable = declarations.filter((item) => providerCompatibilityCapabilityCanBeSentForProvider(provider, item.capability, true))
  const blocked = declarations.filter((item) => !providerCompatibilityCapabilityCanBeSentForProvider(provider, item.capability, true))
  const contractStatus = summarizeMultimodalContractStatus(provider, declarations.map((item) => item.capability))
  if (sendable.length >= 3 && blocked.length === 0 && contractStatus === 'supported') {
    return { area: 'multimodal', level: 'full', contractStatus, reason: 'provider declares multiple multimodal paths and each declared modality is allowed by the compatibility contract' }
  }
  if (sendable.length > 0) {
    const blockedText = blocked.length ? `; blocked declarations: ${blocked.map((item) => item.label).join(', ')}` : ''
    return { area: 'multimodal', level: 'partial', contractStatus, reason: `provider has ${sendable.length} contract-allowed multimodal path(s)${blockedText}` }
  }
  if (declarations.length > 0) {
    return { area: 'multimodal', level: 'partial', contractStatus, reason: 'provider configuration declares multimodal paths, but the compatibility contract does not allow those request parameters yet' }
  }
  return { area: 'multimodal', level: 'partial', contractStatus, reason: 'provider currently behaves as text-first in the access layer' }
}

function summarizeMultimodalContractStatus(
  provider: AIProvider,
  capabilities: readonly ProviderCompatibilityBehavior[],
): ProviderCompatibilityCapabilityStatus {
  const evidence = getProviderCompatibilityEvidenceForProvider(provider)
  const uniqueCapabilities = Array.from(new Set(capabilities))
  if (!uniqueCapabilities.length) return 'unsupported'
  const statuses = uniqueCapabilities.map((capability) => resolveProviderCompatibilityCapabilityStatus(evidence.id, capability))
  if (statuses.includes('docsChanged')) return 'docsChanged'
  const sendableCount = uniqueCapabilities.filter((capability) => providerCompatibilityCapabilityCanBeSentForProvider(provider, capability, true)).length
  if (sendableCount === uniqueCapabilities.length && statuses.every((status) => status === 'supported')) return 'supported'
  if (sendableCount > 0) return 'partial'
  if (statuses.includes('requiresLiveKey')) return 'requiresLiveKey'
  if (statuses.includes('partial')) return 'partial'
  return 'unsupported'
}

function buildComplexChainStatus(provider: AIProvider, hostingProfile: ProviderHostingProfile): ProviderCapabilityStatus {
  if (hostingProfile === 'aggregator') {
    return { area: 'complexChain', level: 'partial', reason: 'aggregator chains are supported through explicit capability declaration and runtime fallbacks' }
  }
  if (hostingProfile === 'relay') {
    return { area: 'complexChain', level: 'partial', reason: 'relay chains work when they declare compatible semantics, but automatic probing is still incomplete' }
  }
  const hostedIssue = hostingProfile === 'cloud-hosted' ? getHostedProviderSupportIssue(provider, 'chat') : null
  if (hostedIssue) {
    return { area: 'complexChain', level: 'planned', reason: hostedIssue.message }
  }
  if (hostingProfile === 'cloud-hosted' && isBedrockMantleProvider(provider)) {
    return { area: 'complexChain', level: 'partial', reason: 'AWS Bedrock Mantle is a modeled hosted compatibility chain; Bedrock Runtime and third-party relays still require explicit capability declarations' }
  }
  if (hostingProfile === 'local-runtime') {
    return { area: 'complexChain', level: 'partial', reason: 'local runtimes work through compatible endpoints, but upstream relay semantics depend on the gateway in front of them' }
  }
  return { area: 'complexChain', level: 'full', reason: 'official provider path is directly modeled by the current runtime' }
}

function summarizeSupportLevel(statuses: ProviderCapabilityStatus[]): ProviderSupportLevel {
  if (statuses.some((status) => status.level === 'unsupported')) return 'unsupported'
  if (statuses.some((status) => status.level === 'planned')) return 'planned'
  if (statuses.some((status) => status.level === 'partial')) return 'partial'
  return 'full'
}

export function summarizeProviderCapabilityMatrix(matrix: ProviderCapabilityMatrix): string {
  return `${matrix.hostingProfile} · ${matrix.summaryLevel}`
}

export function summarizeProviderCapabilityMatrixDetails(
  provider: AIProvider,
  matrix: ProviderCapabilityMatrix = buildProviderCapabilityMatrix(provider),
  limit = 2,
): string {
  const evidence = getProviderCompatibilityEvidenceForProvider(provider)
  const priority: Record<ProviderSupportLevel, number> = {
    planned: 0,
    unsupported: 1,
    partial: 2,
    full: 3,
  }
  return matrix.statuses
    .filter((status) => status.level !== 'full')
    .sort((a, b) => priority[a.level] - priority[b.level])
    .slice(0, Math.max(1, limit))
    .map((status) => {
      const contract = status.contractStatus ? `/${status.contractStatus}` : ''
      const explanation = status.contractStatus
        ? explainProviderCompatibilityCapabilityStatus(status.contractStatus, evidence.auditState)
        : undefined
      const explanationText = explanation ? ` ${explanation.limitationReason}/${explanation.degradationPath}` : ''
      return `${status.area}:${status.level}${contract}${explanationText}`
    })
    .join(' · ')
}

export function describeProviderCapabilityStatus(matrix: ProviderCapabilityMatrix, area: ProviderCapabilityArea): string | undefined {
  return matrix.statuses.find((status) => status.area === area)?.reason
}

export function buildProviderCoverageBuckets(providers: AIProvider[]): Record<ProviderHostingProfile, number> {
  return providers.reduce<Record<ProviderHostingProfile, number>>((acc, provider) => {
    const profile = buildProviderCapabilityMatrix(provider).hostingProfile
    acc[profile] = (acc[profile] ?? 0) + 1
    return acc
  }, {
    official: 0,
    aggregator: 0,
    relay: 0,
    'local-runtime': 0,
    'cloud-hosted': 0,
  })
}

export function providerNeedsHostedCompatibilityWork(provider: AIProvider): boolean {
  return isHostedProviderGap(provider)
}

export function providerSuppressesGenericModelList(provider: AIProvider): boolean {
  return provider.capabilities?.modelList === false || isPerplexityProvider(provider)
}
