import type { RetrievalSource } from '@/types/contextContracts'
import type { SearchProviderId } from '@/types/settingsContracts'
import { useSettingsStore } from '@/store/settingsStore'
import { st } from '@/i18n/service'
import {
  BuiltInCapabilityPolicyError,
  WebSearchProviderAdapterError,
  createWebSearchProviderAdapter,
  getBingCompatibleEndpoint,
  resolveSearchProvider,
  type BuiltInWebSearchPort,
  type RemoteWebSearchProviderId,
  type WebSearchProviderConfiguration,
  type WebSearchProviderResult,
} from '@/modules/integrations'

export interface WebSearchRuntimeResult {
  sources: RetrievalSource[]
  mode: SearchProviderId
  message: string
  ok: boolean
  code?: 'disabled' | 'native' | 'empty_query' | 'missing_credentials' | 'no_results'
}

export interface WebSearchRuntimeOptions {
  signal?: AbortSignal
}

const webSearchProviderAdapter = createWebSearchProviderAdapter({
  resolveConfiguration: resolveWebSearchConfiguration,
  fetch: (input, init) => globalThis.fetch(input, init),
  now: () => new Date(),
})

export async function searchExternalWeb(
  query: string,
  limit = 5,
  options: WebSearchRuntimeOptions = {},
): Promise<WebSearchRuntimeResult> {
  const signal = options.signal ?? new AbortController().signal
  try {
    const result = await webSearchProviderAdapter.search({ query, limit }, { signal })
    return projectRuntimeResult(result)
  } catch (error) {
    if (
      error instanceof WebSearchProviderAdapterError
      && error.code === 'http_failed'
      && error.provider
      && isRemoteWebSearchProvider(error.provider)
      && error.status !== undefined
    ) {
      throw new Error(st(providerFailureStatusKey(error.provider), { status: error.status }))
    }
    throw error
  }
}

export async function searchWeb(
  query: string,
  limit = 5,
  options: WebSearchRuntimeOptions = {},
): Promise<RetrievalSource[]> {
  return (await searchExternalWeb(query, limit, options)).sources
}

export const builtInWebSearchPort: BuiltInWebSearchPort = {
  async search(input, options) {
    const result = await searchExternalWeb(input.query, input.limit, { signal: options.signal })
    if (!result.ok) {
      throw new BuiltInCapabilityPolicyError(
        'execution_failed',
        result.message || st('search.noResults'),
        true,
      )
    }
    return result.sources.flatMap((source) => source.url
      ? [{
          title: source.title,
          url: source.url,
          ...(source.excerpt || source.content ? { snippet: source.excerpt ?? source.content } : {}),
        }]
      : [])
  },
}

async function resolveWebSearchConfiguration(
  options: { signal: AbortSignal },
): Promise<WebSearchProviderConfiguration> {
  throwIfAborted(options.signal)
  const store = useSettingsStore.getState()
  const provider = resolveSearchProvider(store.settings)
  switch (provider) {
    case 'off':
    case 'native':
      return { provider }
    case 'islemind':
      return { provider }
    case 'tavily': {
      const apiKey = await store.getTavilyApiKey()
      throwIfAborted(options.signal)
      return { provider, apiKey }
    }
    case 'google': {
      const apiKey = await store.getGoogleSearchApiKey()
      throwIfAborted(options.signal)
      return {
        provider,
        apiKey,
        searchEngineId: store.settings.googleSearchCx,
      }
    }
    case 'bing': {
      const apiKey = await store.getBingSearchApiKey()
      throwIfAborted(options.signal)
      return {
        provider,
        apiKey,
        endpoint: getBingCompatibleEndpoint(store.settings),
      }
    }
    case 'custom': {
      const apiKey = await store.getCustomSearchApiKey()
      throwIfAborted(options.signal)
      return {
        provider,
        apiKey,
        endpoint: store.settings.customSearchEndpoint,
      }
    }
  }
}

function projectRuntimeResult(result: WebSearchProviderResult): WebSearchRuntimeResult {
  if (!result.ok) {
    switch (result.code) {
      case 'disabled':
        return { sources: [], mode: result.provider, message: st('search.disabled'), ok: false, code: 'disabled' }
      case 'native':
        return { sources: [], mode: result.provider, message: st('search.nativeMode'), ok: false, code: 'native' }
      case 'empty_query':
        return { sources: [], mode: result.provider, message: st('search.emptyQuery'), ok: false, code: 'empty_query' }
      case 'missing_configuration':
        return {
          sources: [],
          mode: result.provider,
          message: result.provider === 'bing' && result.missingConfiguration?.includes('endpoint')
            ? st('search.bingEndpointRequired')
            : st('search.noResults'),
          ok: false,
          code: 'missing_credentials',
        }
      case 'no_results':
        return { sources: [], mode: result.provider, message: st('search.noResults'), ok: false, code: 'no_results' }
    }
  }

  const sources = result.results.map((source): RetrievalSource => ({
    id: source.url,
    type: 'web',
    title: source.title,
    content: source.snippet ?? '',
    excerpt: source.snippet ?? '',
    url: source.url,
    ...(source.score !== undefined ? { score: source.score } : {}),
  }))
  return {
    sources,
    mode: result.provider,
    message: st(providerCompletionKey(result.provider)),
    ok: true,
  }
}

function providerCompletionKey(provider: RemoteWebSearchProviderId): string {
  switch (provider) {
    case 'islemind':
      return 'search.islemindDone'
    case 'tavily':
      return 'search.tavilyDone'
    case 'google':
      return 'search.googleDone'
    case 'bing':
      return 'search.bingDone'
    case 'custom':
      return 'search.customDone'
  }
}

function providerFailureStatusKey(provider: RemoteWebSearchProviderId): string {
  switch (provider) {
    case 'islemind':
      return 'search.islemindFailedStatus'
    case 'tavily':
      return 'search.tavilyFailedStatus'
    case 'google':
      return 'search.googleFailedStatus'
    case 'bing':
      return 'search.bingFailedStatus'
    case 'custom':
      return 'search.customFailedStatus'
  }
}

function isRemoteWebSearchProvider(provider: SearchProviderId): provider is RemoteWebSearchProviderId {
  return provider === 'islemind' || provider === 'tavily' || provider === 'google' || provider === 'bing' || provider === 'custom'
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  const error = new Error('Web search was cancelled.')
  error.name = 'AbortError'
  throw error
}
