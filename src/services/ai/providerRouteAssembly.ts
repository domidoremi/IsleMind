import type { AIProvider, Settings } from '@/types'
import { getProviderEffectiveBaseUrl } from '@/types'
import type { TransportSelection } from '@/services/ai/transport/transportSelector'
import { selectUpstreamTransport } from '@/services/ai/transport/transportSelector'

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
  if (input.usesResponsesApi && input.provider.type === 'openai') return getOpenAIResponsesEndpoint(input.provider)
  return getProviderApiEndpoint(input.provider)
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
  return `${normalizeProviderBaseUrl(getProviderEffectiveBaseUrl(provider))}/responses`
}

export function isOpenAICompatibleProvider(provider: AIProvider): boolean {
  return provider.type === 'openai-compatible' || provider.type === 'xiaomi-mimo'
}

export function defaultOpenAICompatibleBaseUrl(provider: AIProvider): string {
  const baseUrl = getProviderEffectiveBaseUrl(provider)
  if (!isOpenAICompatibleProvider(provider)) return baseUrl
  try {
    const parsed = new URL(baseUrl)
    const path = parsed.pathname.replace(/\/+$/, '')
    if (!path) {
      parsed.pathname = '/v1'
      return parsed.toString().replace(/\/+$/, '')
    }
  } catch {
    // The caller surfaces the network error for invalid user-entered endpoints.
  }
  return baseUrl
}

export function getXiaomiMimoAnthropicMessagesEndpoint(provider: AIProvider): string {
  const baseUrl = normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider))
  return /\/anthropic$/i.test(baseUrl) ? `${baseUrl}/v1/messages` : `${baseUrl}/messages`
}

export function getGoogleGenerateEndpoint(provider: AIProvider, model: string, stream: boolean): string {
  const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent'
  const separator = method.includes('?') ? '&' : '?'
  return `${normalizeProviderBaseUrl(getProviderEffectiveBaseUrl(provider))}/models/${model}:${method}${separator}key=${encodeURIComponent(provider.apiKey)}`
}

export function normalizeProviderBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}
