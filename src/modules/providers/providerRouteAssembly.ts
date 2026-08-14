import type { Settings } from '@/types/settingsContracts'
import type { AIProvider } from '@/types/providerContracts'
import { getProviderEffectiveBaseUrl } from '@/types/providerBaseUrls'
import { isBedrockMantleBaseUrl, normalizeBedrockMantleBaseUrl } from './providerAwsBedrockRouting'
import { isAzureOpenAIProvider, normalizeAzureOpenAIBaseUrl } from './providerAzureRouting'
import { isGitHubModelsProvider, isNovitaProvider, isPerplexityProvider } from './providerIdentityPolicy'

export type ProviderUpstreamTransport = 'http_sse' | 'responses_websocket'
export interface ProviderTransportSelection {
  transport: ProviderUpstreamTransport
  requestedMode: NonNullable<Settings['transportMode']>
  fallbackReason?: 'http_forced' | 'streaming_disabled' | 'non_responses_request' | 'provider_capability_missing' | 'websocket_runtime_missing'
}
export interface ProviderEndpointInput { provider: AIProvider; model: string; stream: boolean; usesResponsesApi?: boolean }
export interface ProviderRouteAssemblyInput extends ProviderEndpointInput { settings?: Pick<Settings, 'transportMode'>; hasWebSocketRuntime?: boolean }
export interface ProviderRouteAssembly { endpoint: string; transportSelection: ProviderTransportSelection }
export interface ProviderRouteAssemblyDependencies {
  compatibilityCapabilityCanBeSent(provider: AIProvider, capability: 'responsesApi' | 'responsesWebSocket', explicitDeclaration: boolean): boolean
}

export function createProviderRouteAssemblyPolicy(dependencies: ProviderRouteAssemblyDependencies) {
  function canSend(provider: AIProvider, capability: 'responsesApi' | 'responsesWebSocket', explicitDeclaration: boolean): boolean {
    return dependencies.compatibilityCapabilityCanBeSent(provider, capability, explicitDeclaration)
  }
  function selectTransport(input: ProviderRouteAssemblyInput): ProviderTransportSelection {
    const requestedMode = input.settings?.transportMode ?? 'auto'
    if (requestedMode === 'http') return { transport: 'http_sse', requestedMode, fallbackReason: 'http_forced' }
    if (!input.usesResponsesApi) return { transport: 'http_sse', requestedMode, fallbackReason: 'non_responses_request' }
    if (input.stream === false) return { transport: 'http_sse', requestedMode, fallbackReason: 'streaming_disabled' }
    const supported = input.provider.capabilities?.responsesApi === true && input.provider.capabilities?.responsesWebSocket === true
      && canSend(input.provider, 'responsesApi', true) && canSend(input.provider, 'responsesWebSocket', true)
    if (!supported) return { transport: 'http_sse', requestedMode, fallbackReason: 'provider_capability_missing' }
    if (!input.hasWebSocketRuntime) return { transport: 'http_sse', requestedMode, fallbackReason: 'websocket_runtime_missing' }
    return { transport: 'responses_websocket', requestedMode }
  }
  function resolveEndpoint(input: ProviderEndpointInput): string {
    if (input.provider.type === 'google') return getGoogleGenerateEndpoint(input.provider, input.model, input.stream)
    if (input.usesResponsesApi && canSend(input.provider, 'responsesApi', input.provider.capabilities?.responsesApi === true)
      && (input.provider.type === 'openai' || input.provider.type === 'openai-compatible')) return getOpenAIResponsesEndpoint(input.provider)
    return getProviderApiEndpoint(input.provider)
  }
  return {
    assemble(input: ProviderRouteAssemblyInput): ProviderRouteAssembly {
      return { endpoint: resolveEndpoint(input), transportSelection: selectTransport(input) }
    },
    resolveEndpoint,
    selectTransport,
  }
}

export function getProviderApiEndpoint(provider: AIProvider): string {
  if (!getProviderEffectiveBaseUrl(provider)) return ''
  switch (provider.type) {
    case 'openai': return `${normalizeProviderBaseUrl(getProviderEffectiveBaseUrl(provider))}/chat/completions`
    case 'anthropic': return `${normalizeProviderBaseUrl(getProviderEffectiveBaseUrl(provider))}/messages`
    case 'google': return getGoogleGenerateEndpoint(provider, provider.models[0] || 'gemini-2.5-flash', true)
    case 'openai-compatible':
      if (provider.wireProtocol === 'anthropic-compatible') return getAnthropicCompatibleMessagesEndpoint(provider)
      return isPerplexityProvider(provider) ? `${defaultOpenAICompatibleBaseUrl(provider)}/v1/sonar` : `${normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/chat/completions`
    case 'xiaomi-mimo':
      return provider.wireProtocol === 'anthropic-compatible' ? getXiaomiMimoAnthropicMessagesEndpoint(provider) : `${normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/chat/completions`
    default: return ''
  }
}
export function getOpenAIResponsesEndpoint(provider: AIProvider): string {
  const baseUrl = provider.type === 'openai-compatible' ? defaultOpenAICompatibleBaseUrl(provider) : getProviderEffectiveBaseUrl(provider)
  if (!baseUrl) return ''
  return `${normalizeProviderBaseUrl(baseUrl)}/responses`
}
export function isOpenAICompatibleProvider(provider: AIProvider): boolean { return provider.type === 'openai-compatible' || provider.type === 'xiaomi-mimo' }
export function defaultOpenAICompatibleBaseUrl(provider: AIProvider): string {
  const baseUrl = getProviderEffectiveBaseUrl(provider)
  if (!isOpenAICompatibleProvider(provider)) return baseUrl
  if (isPerplexityProvider(provider)) return normalizePerplexityOpenAIBaseUrl(baseUrl)
  if (isNovitaProvider(provider)) return normalizeNovitaOpenAIBaseUrl(baseUrl)
  if (isGitHubModelsProvider(provider)) return normalizeProviderBaseUrl(baseUrl)
  if (isAzureOpenAIProvider(provider)) return normalizeAzureOpenAIBaseUrl(provider.baseUrl?.trim() ?? '')
  if (isBedrockMantleBaseUrl(provider.baseUrl)) return normalizeBedrockMantleBaseUrl(provider.baseUrl?.trim() ?? '')
  try {
    const parsed = new URL(baseUrl); const path = parsed.pathname.replace(/\/+$/, '')
    const endpointPath = path.replace(/\/(?:chat\/completions|responses|messages|models|embeddings|audio\/(?:transcriptions|speech)|completions)$/i, '')
    if (!endpointPath) { parsed.pathname = '/v1'; return parsed.toString().replace(/\/+$/, '') }
    if (endpointPath !== path) { parsed.pathname = endpointPath; return parsed.toString().replace(/\/+$/, '') }
    if (!/\/v\d+(?:\/|$)/i.test(path)) { parsed.pathname = `${path}/v1`; return parsed.toString().replace(/\/+$/, '') }
  } catch { /* Invalid user endpoint is surfaced by the request. */ }
  return baseUrl
}
export function getXiaomiMimoAnthropicMessagesEndpoint(provider: AIProvider): string {
  return getAnthropicCompatibleMessagesEndpoint(provider)
}
export function getAnthropicCompatibleMessagesEndpoint(provider: AIProvider): string {
  const baseUrl = normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider))
  if (!baseUrl) return ''
  if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/messages`
  if (/\/anthropic$/i.test(baseUrl)) return `${baseUrl}/v1/messages`
  return `${baseUrl}/messages`
}
export function getGoogleGenerateEndpoint(provider: AIProvider, model: string, stream: boolean): string {
  const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent'
  return `${normalizeProviderBaseUrl(getProviderEffectiveBaseUrl(provider))}/models/${model.trim().replace(/^models\//i, '')}:${method}`
}
export function normalizeProviderBaseUrl(url: string): string { return url.replace(/\/+$/, '') }
function normalizePerplexityOpenAIBaseUrl(baseUrl: string): string {
  return normalizeProviderBaseUrl(baseUrl).replace(/\/v1\/sonar$/i, '').replace(/\/v1\/chat\/completions$/i, '').replace(/\/v1$/i, '').replace(/\/sonar$/i, '').replace(/\/chat\/completions$/i, '')
}
function normalizeNovitaOpenAIBaseUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl); const path = parsed.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|models|embeddings|rerank)$/i, '')
    if (!path || /^\/openai$/i.test(path)) { parsed.pathname = '/openai/v1'; return parsed.toString().replace(/\/+$/, '') }
    return normalizeProviderBaseUrl(parsed.toString())
  } catch { return baseUrl }
}
