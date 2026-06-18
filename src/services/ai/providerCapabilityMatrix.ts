import type { AIProvider } from '@/types'
import { getProviderPreset } from '@/services/ai/providerRegistry'
import { isPerplexityProvider } from '@/services/ai/providerIdentity'
import { getBedrockRuntimeSupportIssue, isBedrockMantleProvider, isBedrockRuntimeProvider } from '@/services/ai/providerAwsBedrockRouting'
import { isBedrockProvider } from '@/services/ai/providerRequestOptimization'
import { isAzureOpenAIProvider, isAzureOpenAIV1Provider } from '@/services/ai/providerHostedRouting'
import { getHostedProviderSupportIssue, isAwsBedrockHostedProvider, isHostedProviderGap, isVertexAIOpenAICompatibleProvider, isVertexAIProvider } from '@/services/ai/providerHostedBoundary'

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
  | 'modelCatalog'
  | 'protocol'
  | 'transport'
  | 'remoteCompact'
  | 'cache'
  | 'tools'
  | 'multimodal'
  | 'complexChain'

export interface ProviderCapabilityStatus {
  area: ProviderCapabilityArea
  level: ProviderSupportLevel
  reason: string
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
    buildModelCatalogStatus(provider, hostingProfile),
    buildProtocolStatus(provider, hostingProfile),
    buildTransportStatus(provider, hostingProfile),
    buildRemoteCompactStatus(provider, hostingProfile),
    buildCacheStatus(provider, hostingProfile),
    buildToolStatus(provider, hostingProfile),
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
  if (provider.type === 'openai' || provider.type === 'anthropic' || provider.type === 'google' || provider.type === 'xiaomi-mimo') return 'official'
  if (['openrouter', 'newapi', 'sub2api'].includes(presetId ?? '')) return 'aggregator'
  if (['ollama', 'lm-studio', 'localai', 'vllm', 'sglang'].includes(presetId ?? '')) return 'local-runtime'
  if (/azure\.com|openai\.azure\.com|bedrock|amazonaws\.com|vertexai|aiplatform\.googleapis\.com|generativelanguage\.googleapis\.com\/v1beta\/projects\//.test(text)) return 'cloud-hosted'
  return 'relay'
}

function buildResponseStatus(provider: AIProvider, hostingProfile: ProviderHostingProfile): ProviderCapabilityStatus {
  if (hostingProfile === 'cloud-hosted' && isAzureOpenAIV1Provider(provider)) {
    return { area: 'response', level: 'full', reason: 'Azure OpenAI v1 chat and Responses paths are routed through the /openai/v1 namespace with Azure API-key auth' }
  }
  if (hostingProfile === 'cloud-hosted' && isVertexAIOpenAICompatibleProvider(provider)) {
    return { area: 'response', level: 'partial', reason: 'Vertex AI OpenAI-compatible chat routes through the hosted /endpoints/openapi namespace with Google Cloud access-token auth' }
  }
  if (hostingProfile === 'cloud-hosted' && isBedrockMantleProvider(provider)) {
    return { area: 'response', level: 'partial', reason: 'AWS Bedrock Mantle uses the OpenAI-compatible /v1 chat or Responses endpoints with Bedrock API-key bearer auth' }
  }
  if (hostingProfile === 'cloud-hosted' && isBedrockRuntimeProvider(provider) && !getBedrockRuntimeSupportIssue(provider)) {
    return { area: 'response', level: 'partial', reason: 'AWS Bedrock Runtime InvokeModel request preparation and SigV4 signing are available for non-streaming Anthropic-style chat; streaming and Converse remain planned' }
  }
  const hostedIssue = hostingProfile === 'cloud-hosted' ? getHostedProviderSupportIssue(provider, 'chat') : null
  if (hostedIssue) {
    return { area: 'response', level: 'planned', reason: hostedIssue.message }
  }
  return { area: 'response', level: 'full', reason: 'chat request path is available through the current provider runtime' }
}

function buildModelCatalogStatus(provider: AIProvider, hostingProfile: ProviderHostingProfile): ProviderCapabilityStatus {
  if (provider.capabilities?.modelList === false) {
    return { area: 'modelCatalog', level: 'partial', reason: 'generic model-list sync is intentionally disabled for this provider shape' }
  }
  if (hostingProfile === 'cloud-hosted' && isAzureOpenAIV1Provider(provider)) {
    return { area: 'modelCatalog', level: 'partial', reason: 'Azure OpenAI v1 model-list routing is available, but deployment and model availability can still be resource-specific' }
  }
  if (hostingProfile === 'cloud-hosted' && isVertexAIOpenAICompatibleProvider(provider)) {
    return { area: 'modelCatalog', level: 'partial', reason: 'Vertex AI OpenAI-compatible model-list routing is available through /endpoints/openapi/models, but project, region, and access-token scope still apply' }
  }
  if (hostingProfile === 'cloud-hosted' && isBedrockMantleProvider(provider)) {
    return { area: 'modelCatalog', level: 'partial', reason: 'AWS Bedrock Mantle model-list routing is available through /v1/models, but region, model access, and Bedrock API key scope still apply' }
  }
  const hostedIssue = hostingProfile === 'cloud-hosted' ? getHostedProviderSupportIssue(provider, 'modelList') : null
  if (hostedIssue) {
    return { area: 'modelCatalog', level: 'planned', reason: hostedIssue.message }
  }
  return { area: 'modelCatalog', level: 'full', reason: 'provider can use the current model discovery and alias lifecycle flow' }
}

function buildProtocolStatus(provider: AIProvider, hostingProfile: ProviderHostingProfile): ProviderCapabilityStatus {
  if (hostingProfile === 'cloud-hosted' && isAzureOpenAIV1Provider(provider)) {
    return { area: 'protocol', level: 'partial', reason: 'Azure OpenAI v1 follows OpenAI-compatible request shapes, while deployment and Foundry resource semantics remain provider-specific' }
  }
  if (hostingProfile === 'cloud-hosted' && isVertexAIOpenAICompatibleProvider(provider)) {
    return { area: 'protocol', level: 'partial', reason: 'Vertex AI OpenAI-compatible endpoints use OpenAI chat-completions shapes, while native Gemini Vertex paths remain provider-specific' }
  }
  if (hostingProfile === 'cloud-hosted' && isBedrockMantleProvider(provider)) {
    return { area: 'protocol', level: 'partial', reason: 'AWS Bedrock Mantle exposes OpenAI-compatible Chat Completions, Responses, and Models APIs, while Bedrock Runtime Invoke/Converse still needs SigV4 routing' }
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
  const hostedIssue = hostingProfile === 'cloud-hosted' ? getHostedProviderSupportIssue(provider, 'chat') : null
  if (hostedIssue) {
    return { area: 'transport', level: 'planned', reason: hostedIssue.message }
  }
  if (hostingProfile === 'cloud-hosted' && isBedrockRuntimeProvider(provider)) {
    return { area: 'transport', level: 'partial', reason: 'AWS Bedrock Runtime currently supports signed non-streaming InvokeModel preparation; response streaming requires InvokeModelWithResponseStream or ConverseStream support' }
  }
  if (provider.capabilities?.responsesWebSocket === true) {
    return { area: 'transport', level: 'full', reason: 'provider declares Responses WebSocket support in addition to HTTP streaming' }
  }
  return { area: 'transport', level: 'partial', reason: 'provider currently relies on HTTP or SSE transport without declared WebSocket support' }
}

function buildRemoteCompactStatus(provider: AIProvider, hostingProfile: ProviderHostingProfile): ProviderCapabilityStatus {
  if (provider.capabilities?.remoteCompact === true && provider.capabilities?.responsesApi === true) {
    return { area: 'remoteCompact', level: 'full', reason: 'provider declares Responses-based remote compact support' }
  }
  if (hostingProfile === 'cloud-hosted' && isAzureOpenAIV1Provider(provider) && provider.capabilities?.responsesApi === true) {
    return { area: 'remoteCompact', level: 'partial', reason: 'Azure OpenAI v1 Responses routing is available, but remote compact depends on model, region, and resource support' }
  }
  const hostedIssue = hostingProfile === 'cloud-hosted' ? getHostedProviderSupportIssue(provider, 'remoteCompact') : null
  if (hostedIssue) {
    return { area: 'remoteCompact', level: 'planned', reason: hostedIssue.message }
  }
  if (hostingProfile === 'cloud-hosted' && isBedrockMantleProvider(provider)) {
    return { area: 'remoteCompact', level: 'partial', reason: 'AWS Bedrock Mantle Responses routing exists, but remote compact eligibility still depends on model and account support; local compression remains fallback' }
  }
  if (hostingProfile === 'cloud-hosted' && isVertexAIOpenAICompatibleProvider(provider)) {
    return { area: 'remoteCompact', level: 'partial', reason: 'Vertex AI OpenAI-compatible chat can run without remote compact; local compression remains the fallback until Responses compact is declared' }
  }
  if (provider.capabilities?.responsesApi === true) {
    return { area: 'remoteCompact', level: 'partial', reason: 'Responses path exists, but remote compact is not explicitly declared' }
  }
  return { area: 'remoteCompact', level: 'partial', reason: 'provider falls back to local compression because remote compact is not declared' }
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

function buildToolStatus(provider: AIProvider, hostingProfile: ProviderHostingProfile): ProviderCapabilityStatus {
  const hostedIssue = hostingProfile === 'cloud-hosted' ? getHostedProviderSupportIssue(provider, 'tools') : null
  if (hostedIssue) {
    return { area: 'tools', level: 'planned', reason: hostedIssue.message }
  }
  if (provider.capabilities?.nativeTools === true) {
    if (isBedrockMantleProvider(provider)) {
      return { area: 'tools', level: 'partial', reason: 'AWS Bedrock Mantle can pass OpenAI-compatible tool declarations, while model-specific native tool behavior must still be verified per model' }
    }
    return { area: 'tools', level: 'full', reason: 'provider declares native tool support and can also use IsleMind MCP/tool runtime' }
  }
  return { area: 'tools', level: 'partial', reason: 'provider can still use IsleMind tool runtime, but provider-native tool semantics are limited' }
}

function buildMultimodalStatus(provider: AIProvider): ProviderCapabilityStatus {
  const capabilities = provider.capabilities
  const multimodalCount = [capabilities?.vision, capabilities?.files, capabilities?.audioInput, capabilities?.audioTranscription, capabilities?.speech].filter(Boolean).length
  if (multimodalCount >= 3) {
    return { area: 'multimodal', level: 'full', reason: 'provider declares multiple multimodal input or output capabilities' }
  }
  if (multimodalCount > 0) {
    return { area: 'multimodal', level: 'partial', reason: 'provider supports some multimodal paths, but the surface is not comprehensive' }
  }
  return { area: 'multimodal', level: 'partial', reason: 'provider currently behaves as text-first in the access layer' }
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
