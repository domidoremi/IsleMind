import {
  BuiltInCapabilityPolicyError,
  type BuiltInRemoteWebCrawlPort,
} from '@/modules/integrations'

const TAVILY_CRAWL_ENDPOINT = 'https://api.tavily.com/crawl'
const TAVILY_EXTRACT_ENDPOINT = 'https://api.tavily.com/extract'

export interface TavilyRemoteWebCrawlDependencies {
  fetch?: typeof fetch
  resolveConfiguration?: () => Promise<{ enabled: boolean; apiKey: string | null }>
}

/**
 * Bootstrap-owned vendor adapter. Tavily performs the connection remotely, so
 * its result is intentionally bound to BuiltInRemoteWebCrawlPort rather than
 * the local DNS-to-socket trust port.
 */
export function createTavilyRemoteWebCrawlPort(
  dependencies: TavilyRemoteWebCrawlDependencies = {},
): BuiltInRemoteWebCrawlPort {
  const fetchImpl = dependencies.fetch ?? fetch
  const resolveConfiguration = dependencies.resolveConfiguration ?? defaultConfiguration

  return {
    async crawl(input, options) {
      throwIfAborted(options.signal)
      const configuration = await resolveConfiguration()
      throwIfAborted(options.signal)
      if (!configuration.enabled) {
        throw new BuiltInCapabilityPolicyError(
          'capability_unavailable',
          'Remote crawl requires the configured Tavily web-search provider.',
          true,
        )
      }
      const apiKey = configuration.apiKey?.trim()
      if (!apiKey) {
        throw new BuiltInCapabilityPolicyError(
          'capability_unavailable',
          'Remote crawl requires a configured Tavily API key.',
          true,
        )
      }

      const isSinglePageExtraction = input.maxDepth === 0
      const response = await fetchImpl(
        isSinglePageExtraction ? TAVILY_EXTRACT_ENDPOINT : TAVILY_CRAWL_ENDPOINT,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(isSinglePageExtraction
            ? {
                urls: [input.url],
                include_images: false,
                extract_depth: 'basic',
                format: 'markdown',
                timeout: Math.max(1, Math.ceil(options.timeoutMs / 1_000)),
              }
            : {
                url: input.url,
                max_depth: input.maxDepth,
                max_breadth: input.maxPages,
                limit: input.maxPages,
                allow_external: false,
                include_images: false,
                extract_depth: 'basic',
                format: 'markdown',
                timeout: Math.max(10, Math.ceil(options.timeoutMs / 1_000)),
              }),
          signal: options.signal,
        },
      )
      throwIfAborted(options.signal)
      if (!response.ok) {
        throw new BuiltInCapabilityPolicyError(
          'execution_failed',
          `Tavily remote crawl returned HTTP ${response.status}.`,
          response.status === 408 || response.status === 429 || response.status >= 500,
        )
      }
      const payload = await response.json() as { results?: unknown }
      throwIfAborted(options.signal)
      if (!Array.isArray(payload.results) || payload.results.length > input.maxPages) {
        throw new BuiltInCapabilityPolicyError('execution_failed', 'Tavily remote crawl returned an invalid page set.')
      }

      return {
        pages: payload.results.map((result) => projectTavilyPage(result, input)),
      }
    },
  }
}

async function defaultConfiguration(): Promise<{ enabled: boolean; apiKey: string | null }> {
  const [{ resolveSearchProvider }, { useSettingsStore }] = await Promise.all([
    import('@/modules/integrations'),
    import('@/store/settingsStore'),
  ])
  const store = useSettingsStore.getState()
  const enabled = store.settings.webSearchEnabled === true && resolveSearchProvider(store.settings) === 'tavily'
  const apiKey = enabled ? await store.getTavilyApiKey() : null
  return { enabled, apiKey }
}

function projectTavilyPage(
  result: unknown,
  input: Parameters<BuiltInRemoteWebCrawlPort['crawl']>[0],
): { url: string; text: string; byteLength: number; depth: number } {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new BuiltInCapabilityPolicyError('execution_failed', 'Tavily remote crawl returned a malformed page.')
  }
  const candidate = result as { url?: unknown; raw_content?: unknown }
  if (typeof candidate.url !== 'string' || typeof candidate.raw_content !== 'string') {
    throw new BuiltInCapabilityPolicyError('execution_failed', 'Tavily remote crawl returned a page without text content.')
  }
  const text = candidate.raw_content.trim()
  if (!text || text.length > input.maxTextCharsPerPage) {
    throw new BuiltInCapabilityPolicyError('size_limit_exceeded', 'Tavily remote crawl returned page text beyond the configured bound.')
  }
  const byteLength = new TextEncoder().encode(text).byteLength
  if (byteLength > input.maxPageBytes) {
    throw new BuiltInCapabilityPolicyError('size_limit_exceeded', 'Tavily remote crawl returned a page beyond the configured byte limit.')
  }
  return {
    url: candidate.url,
    text,
    byteLength,
    // Tavily does not document per-page depth; the requested depth is the
    // conservative upper bound that the target adapter validates.
    depth: input.maxDepth,
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  const error = new Error('Remote web crawl was cancelled.')
  error.name = 'AbortError'
  throw error
}
