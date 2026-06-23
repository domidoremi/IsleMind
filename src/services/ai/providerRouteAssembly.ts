import type { AIProvider, Settings } from '@/types'
import { getProviderEffectiveBaseUrl } from '@/types'
import type { TransportSelection } from '@/services/ai/transport/transportSelector'
import { selectUpstreamTransport } from '@/services/ai/transport/transportSelector'
import { isGitHubModelsProvider, isNovitaProvider, isPerplexityProvider } from '@/services/ai/providerIdentity'
import { isBedrockMantleProvider, normalizeBedrockMantleBaseUrl } from '@/services/ai/providerAwsBedrockRouting'
import { isAzureOpenAIProvider, normalizeAzureOpenAIBaseUrl } from '@/services/ai/providerHostedRouting'
import { providerCompatibilityCapabilityCanBeSentForProvider } from '@/services/ai/providerCompatibilityContract'

export interface ProviderEndpointInput {
  provider: AIProvider
  model: string
  stream: boolean
  usesResponsesApi?: boolean
}

export interface ProviderRouteAssemblyInput extends ProviderEndpointInput {
  settings?: Pick<Settings, 'transportMode'>
  hasWebSocketRuntime?: boolean
}

export interface ProviderRouteAssembly {
  endpoint: string
  transportSelection: TransportSelection
}

export function assembleProviderRoute(input: ProviderRouteAssemblyInput): ProviderRouteAssembly {
  const transportSelection = selectUpstreamTransport({
    provider: input.provider,
    usesResponsesApi: input.usesResponsesApi === true,
    stream: input.stream,
    settings: input.settings,
    hasWebSocketRuntime: input.hasWebSocketRuntime,
  })
  return {
    endpoint: resolveProviderEndpoint(input),
    transportSelection,
  }
}

export function resolveProviderEndpoint(input: ProviderEndpointInput): string {
  if (input.provider.type === 'google') return getGoogleGenerateEndpoint(input.provider, input.model, input.stream)
  if (input.usesResponsesApi && providerResponsesApiCanBeSent(input.provider) && (input.provider.type === 'openai' || input.provider.type === 'openai-compatible')) return getOpenAIResponsesEndpoint(input.provider)
  return getProviderApiEndpoint(input.provider)
}

function providerResponsesApiCanBeSent(provider: AIProvider): boolean {
  return providerCompatibilityCapabilityCanBeSentForProvider(provider, 'responsesApi', provider.capabilities?.responsesApi === true)
}

export function getProviderApiEndpoint(provider: AIProvider): string {
  switch (provider.type) {
    case 'openai':
      return `${normalizeProviderBaseUrl(getProviderEffectiveBaseUrl(provider))}/chat/completions`
    case 'anthropic':
      return `${normalizeProviderBaseUrl(getProviderEffectiveBaseUrl(provider))}/messages`
    case 'google':
      return getGoogleGenerateEndpoint(provider, provider.models[0] || 'gemini-2.5-flash', true)
    case 'openai-compatible':
      if (isPerplexityProvider(provider)) return `${defaultOpenAICompatibleBaseUrl(provider)}/v1/sonar`
      return `${normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/chat/completions`
    case 'xiaomi-mimo':
      return provider.wireProtocol === 'anthropic-compatible'
        ? getXiaomiMimoAnthropicMessagesEndpoint(provider)
        : `${normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/chat/completions`
    default:
      return ''
  }
}

export function getOpenAIResponsesEndpoint(provider: AIProvider): string {
  const baseUrl = provider.type === 'openai-compatible'
    ? defaultOpenAICompatibleBaseUrl(provider)
    : getProviderEffectiveBaseUrl(provider)
  return `${normalizeProviderBaseUrl(baseUrl)}/responses`
}

export function isOpenAICompatibleProvider(provider: AIProvider): boolean {
  return provider.type === 'openai-compatible' || provider.type === 'xiaomi-mimo'
}

export function defaultOpenAICompatibleBaseUrl(provider: AIProvider): string {
  const baseUrl = getProviderEffectiveBaseUrl(provider)
  if (!isOpenAICompatibleProvider(provider)) return baseUrl
  if (isPerplexityProvider(provider)) return normalizePerplexityOpenAIBaseUrl(baseUrl)
  if (isNovitaProvider(provider)) return normalizeNovitaOpenAIBaseUrl(baseUrl)
  if (isGitHubModelsProvider(provider)) return normalizeProviderBaseUrl(baseUrl)
  if (isAzureOpenAIProvider(provider)) return normalizeAzureOpenAIBaseUrl(provider.baseUrl?.trim() ?? '')
  if (isBedrockMantleProvider(provider)) return normalizeBedrockMantleBaseUrl(provider.baseUrl?.trim() ?? '')
  try {
    const parsed = new URL(baseUrl)
    const path = parsed.pathname.replace(/\/+$/, '')
    const endpointPath = path.replace(/\/(?:chat\/completions|responses|models|embeddings|audio\/(?:transcriptions|speech)|completions)$/i, '')
    if (!endpointPath) {
      parsed.pathname = '/v1'
      return parsed.toString().replace(/\/+$/, '')
    }
    if (endpointPath !== path) {
      parsed.pathname = endpointPath
      return parsed.toString().replace(/\/+$/, '')
    }
    if (!/\/v\d+(?:\/|$)/i.test(path)) {
      parsed.pathname = `${path}/v1`
      return parsed.toString().replace(/\/+$/, '')
    }
  } catch {
    // The caller surfaces the network error for invalid user-entered endpoints.
  }
  return baseUrl
}

function normalizeNovitaOpenAIBaseUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl)
    let path = parsed.pathname.replace(/\/+$/, '')
    path = path.replace(/\/(?:chat\/completions|models|embeddings|rerank)$/i, '')
    if (!path || /^\/openai$/i.test(path)) {
      parsed.pathname = '/openai/v1'
      return parsed.toString().replace(/\/+$/, '')
    }
    return normalizeProviderBaseUrl(parsed.toString())
  } catch {
    return baseUrl
  }
}

function normalizePerplexityOpenAIBaseUrl(baseUrl: string): string {
  const normalized = normalizeProviderBaseUrl(baseUrl)
  return normalized
    .replace(/\/v1\/sonar$/i, '')
    .replace(/\/v1\/chat\/completions$/i, '')
    .replace(/\/v1$/i, '')
    .replace(/\/sonar$/i, '')
    .replace(/\/chat\/completions$/i, '')
}

export function getXiaomiMimoAnthropicMessagesEndpoint(provider: AIProvider): string {
  const baseUrl = normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider))
  return /\/anthropic$/i.test(baseUrl) ? `${baseUrl}/v1/messages` : `${baseUrl}/messages`
}

export function getGoogleGenerateEndpoint(provider: AIProvider, model: string, stream: boolean): string {
  const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent'
  const separator = method.includes('?') ? '&' : '?'
  return `${normalizeProviderBaseUrl(getProviderEffectiveBaseUrl(provider))}/models/${normalizeGoogleModelPath(model)}:${method}${separator}key=${encodeURIComponent(provider.apiKey)}`
}

export function normalizeProviderBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

function normalizeGoogleModelPath(model: string): string {
  return model.trim().replace(/^models\//i, '')
}
