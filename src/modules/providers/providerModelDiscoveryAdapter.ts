import type { AIModel, AIProvider } from '@/types/providerContracts'
import { isGitHubModelsProvider } from './providerIdentityPolicy'
import { ProviderHttpError } from './providerOperationResult'
import { isCredentiallessLocalProvider, parseProviderRetryAfterMs } from './providerProbe'

export interface ProviderModelDiscoveryOptions {
  timeoutMs: number
  signal?: AbortSignal
}

export interface ProviderModelDiscoveryAdapterDependencies {
  configurationIssue(provider: AIProvider): string | undefined
  supportsModelList(provider: AIProvider): boolean
  isOpenAICompatible(provider: AIProvider): boolean
  resolveBaseUrl(provider: AIProvider): string
  resolveHeaders(provider: AIProvider): Record<string, string>
  request(input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number): Promise<Response>
  readResponseText(response: Response): Promise<string>
  parseResponseJson(responseText: string, response: Response, provider: AIProvider): unknown
  mapOpenAICompatible(value: unknown, provider: AIProvider): AIModel[]
  mapAnthropic(value: unknown): AIModel[]
  mapGoogle(value: unknown): AIModel[]
}

export interface ProviderModelDiscoveryAdapter {
  discover(provider: AIProvider, options: ProviderModelDiscoveryOptions): Promise<AIModel[]>
}

/** Owns provider model-list routing, transport, cancellation, and boundary parsing. */
export function createProviderModelDiscoveryAdapter(
  dependencies: ProviderModelDiscoveryAdapterDependencies,
): ProviderModelDiscoveryAdapter {
  return {
    async discover(provider, options) {
      throwIfProviderModelDiscoveryAborted(options.signal)
      const issue = dependencies.configurationIssue(provider)
      if (issue) throw new Error(issue)
      if (provider.capabilities?.modelList === false || !dependencies.supportsModelList(provider)) return []

      const discoveryProvider = normalizeModelDiscoveryProvider(provider)
      const usesAnthropicCompatibleProtocol = provider.type === 'openai-compatible'
        && provider.wireProtocol === 'anthropic-compatible'
      if (
        discoveryProvider.type !== 'google'
        && discoveryProvider.type !== 'anthropic'
        && discoveryProvider.type !== 'openai'
        && !dependencies.isOpenAICompatible(discoveryProvider)
      ) return []

      const baseUrl = trimTrailingSlash(dependencies.resolveBaseUrl(discoveryProvider))
      const response = await dependencies.request(
        resolveProviderModelDiscoveryEndpoint(discoveryProvider, baseUrl),
        {
          method: 'GET',
          headers: providerModelDiscoveryHeaders(
            discoveryProvider,
            dependencies.resolveHeaders(discoveryProvider),
          ),
          ...(options.signal ? { signal: options.signal } : {}),
        },
        options.timeoutMs,
      )
      throwIfProviderModelDiscoveryAborted(options.signal)
      const responseText = await dependencies.readResponseText(response)
      throwIfProviderModelDiscoveryAborted(options.signal)
      if (!response.ok) {
        throw new ProviderHttpError(
          response.status,
          responseText,
          parseProviderRetryAfterMs(response.headers.get('retry-after')),
        )
      }
      try {
        const value = dependencies.parseResponseJson(responseText, response, discoveryProvider)
        if (discoveryProvider.type === 'google') return dependencies.mapGoogle(value)
        if (discoveryProvider.type === 'anthropic' || usesAnthropicCompatibleProtocol) return dependencies.mapAnthropic(value)
        return dependencies.mapOpenAICompatible(value, discoveryProvider)
      } catch (error) {
        if (options.signal?.aborted) throw error
        throw new ProviderHttpError(response.status, responseText)
      }
    },
  }
}

export function providerModelDiscoveryHeaders(
  provider: AIProvider,
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const credentiallessLocal = isCredentiallessLocalProvider(provider) && !provider.apiKey.trim()
  return Object.fromEntries(Object.entries(headers).filter(([name, value]) => {
    if (!value.trim()) return false
    if (!credentiallessLocal) return true
    if (!/^(authorization|api-key|x-api-key|x-goog-api-key)$/i.test(name)) return true
    return !/^(?:bearer\s*)?$/i.test(value.trim())
  }))
}

/** Resolves a credential-free model-list URL from an already-normalized base URL. */
export function resolveProviderModelDiscoveryEndpoint(
  provider: AIProvider,
  resolvedBaseUrl: string,
): string {
  const baseUrl = trimTrailingSlash(resolvedBaseUrl)
  if (!isGitHubModelsProvider(provider)) return `${baseUrl}/models`

  try {
    const parsed = new URL(baseUrl)
    parsed.pathname = '/catalog/models'
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return `${baseUrl.replace(/\/inference(?:\/.*)?$/i, '')}/catalog/models`
  }
}

export function normalizeModelDiscoveryProvider(provider: AIProvider): AIProvider {
  if (provider.type !== 'xiaomi-mimo' || provider.wireProtocol !== 'anthropic-compatible') return provider
  return {
    ...provider,
    wireProtocol: 'openai-compatible',
    baseUrl: provider.baseUrl?.replace(/\/anthropic(?:\/v1)?\/?$/i, '/v1'),
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function throwIfProviderModelDiscoveryAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  const error = new Error('Provider model discovery was cancelled')
  error.name = 'AbortError'
  throw error
}
