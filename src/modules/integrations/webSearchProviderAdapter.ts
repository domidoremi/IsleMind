import { XMLParser } from 'fast-xml-parser'
import type { BuiltInWebSearchResult } from './builtInCapabilityContracts'
import {
  boundedInteger,
  BUILT_IN_WEB_SEARCH_MAX_RESULTS,
  normalizePublicHttpsUrl,
  normalizeWebQuery,
  publicDisplayUrl,
  truncatePublicText,
} from './builtInCapabilityPolicy'

export const WEB_SEARCH_PROVIDER_IDS = [
  'off',
  'islemind',
  'native',
  'tavily',
  'google',
  'bing',
  'custom',
] as const

export type WebSearchProviderId = typeof WEB_SEARCH_PROVIDER_IDS[number]
export type RemoteWebSearchProviderId = Exclude<WebSearchProviderId, 'off' | 'native'>

export type WebSearchProviderConfiguration =
  | { provider: 'off' }
  | { provider: 'islemind' }
  | { provider: 'native' }
  | { provider: 'tavily'; apiKey?: string | null }
  | { provider: 'google'; apiKey?: string | null; searchEngineId?: string | null }
  | { provider: 'bing'; apiKey?: string | null; endpoint?: string | null }
  | { provider: 'custom'; apiKey?: string | null; endpoint?: string | null }

export interface WebSearchProviderSource extends BuiltInWebSearchResult {
  score?: number
}

export type WebSearchProviderResult =
  | {
      ok: true
      code: 'completed'
      provider: RemoteWebSearchProviderId
      results: readonly WebSearchProviderSource[]
    }
  | {
      ok: false
      code: 'disabled' | 'native' | 'empty_query' | 'missing_configuration' | 'no_results'
      provider: WebSearchProviderId
      results: readonly []
      missingConfiguration?: readonly WebSearchProviderConfigurationField[]
    }

export type WebSearchProviderConfigurationField =
  | 'api_key'
  | 'search_engine_id'
  | 'endpoint'

export type WebSearchProviderAdapterErrorCode =
  | 'invalid_configuration'
  | 'http_failed'
  | 'malformed_response'

export class WebSearchProviderAdapterError extends Error {
  constructor(
    readonly code: WebSearchProviderAdapterErrorCode,
    message: string,
    readonly provider?: WebSearchProviderId,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'WebSearchProviderAdapterError'
  }
}

export interface WebSearchProviderAdapter {
  search(
    input: { query: string; limit?: number },
    options: { signal: AbortSignal },
  ): Promise<WebSearchProviderResult>
}

export interface WebSearchProviderAdapterDependencies {
  resolveConfiguration(options: { signal: AbortSignal }): Promise<WebSearchProviderConfiguration>
  fetch: typeof globalThis.fetch
  now?: () => Date
}

const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search'
const TAVILY_MAX_RESULTS = 20
const GOOGLE_CUSTOM_SEARCH_ENDPOINT = 'https://www.googleapis.com/customsearch/v1'
const ISLEMIND_SEARCH_ENDPOINT = 'https://global.bing.com/search'
const ISLEMIND_SEARCH_FALLBACK_ENDPOINT = 'https://html.duckduckgo.com/html/'
const ISLEMIND_SEARCH_FALLBACK_USER_AGENT = 'IsleMind/1.0'
const ISLEMIND_SEARCH_RESPONSE_TEXT_LIMIT = 512_000
const PROVIDER_RESULT_SCAN_LIMIT = BUILT_IN_WEB_SEARCH_MAX_RESULTS * 3
const PROVIDER_ENDPOINT_LIMIT = 2_048
const PROVIDER_TITLE_LIMIT = 300
const PROVIDER_SNIPPET_LIMIT = 4_000
const ISLEMIND_SEARCH_REFINEMENT_LIMIT = 2
const ISLEMIND_SEARCH_RELEVANCE_THRESHOLD = 0.75
const ISLEMIND_SEARCH_PRIMARY_TIMEOUT_MS = 2_500
const ISLEMIND_SEARCH_FALLBACK_TIMEOUT_MS = 6_000
const ISLEMIND_SEARCH_REFINEMENT_TIMEOUT_MS = 1_500
const ISLEMIND_SEARCH_FRESHNESS_TIMEOUT_MS = 2_500
const ISLEMIND_SEARCH_ENGLISH_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const
const islemindSearchXmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  processEntities: false,
  trimValues: true,
})
const islemindSearchHtmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  processEntities: false,
  trimValues: true,
  unpairedTags: [
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
    'param', 'source', 'track', 'wbr',
  ],
})

export function createWebSearchProviderAdapter(
  dependencies: WebSearchProviderAdapterDependencies,
): WebSearchProviderAdapter {
  const fetchImplementation = dependencies.fetch
  if (typeof fetchImplementation !== 'function') {
    throw new Error('Web search provider adapter requires fetch.')
  }
  const now = dependencies.now ?? (() => new Date())

  return {
    async search(input, options) {
      throwIfAborted(options.signal)
      const configuration = await dependencies.resolveConfiguration({ signal: options.signal })
      throwIfAborted(options.signal)
      const provider = assertProviderConfiguration(configuration)
      if (provider.provider === 'off') return terminalResult('disabled', 'off')
      if (provider.provider === 'native') return terminalResult('native', 'native')
      if (typeof input.query !== 'string' || !input.query.trim()) {
        return terminalResult('empty_query', provider.provider)
      }

      const query = normalizeWebQuery(input.query)
      const limit = boundedInteger(input.limit, 5, 1, PROVIDER_RESULT_SCAN_LIMIT)
      const missingConfiguration = findMissingConfiguration(provider)
      if (missingConfiguration.length) {
        return terminalResult('missing_configuration', provider.provider, missingConfiguration)
      }

      if (provider.provider === 'islemind') {
        let initialResults: WebSearchProviderSource[] = []
        try {
          const payload = await requestProviderResults(
            provider,
            query,
            limit,
            fetchImplementation,
            options.signal,
            ISLEMIND_SEARCH_ENDPOINT,
            ISLEMIND_SEARCH_PRIMARY_TIMEOUT_MS,
          )
          throwIfAborted(options.signal)
          initialResults = normalizeProviderResults(provider.provider, payload, limit)
        } catch (error) {
          if (options.signal.aborted) throw error
          if (error instanceof WebSearchProviderAdapterError && !error.retryable) throw error
        }

        const results = await refineIsleMindSearchResults({
            configuration: provider,
            fetchImplementation,
            initialQuery: query,
            initialResults,
            limit,
            now,
            signal: options.signal,
          })
        if (!results.length) return terminalResult('no_results', provider.provider)
        return {
          ok: true,
          code: 'completed',
          provider: provider.provider,
          results,
        }
      }

      const payload = await requestProviderResults(
        provider,
        query,
        limit,
        fetchImplementation,
        options.signal,
      )
      throwIfAborted(options.signal)
      const results = normalizeProviderResults(provider.provider, payload, limit)
      if (!results.length) return terminalResult('no_results', provider.provider)
      return {
        ok: true,
        code: 'completed',
        provider: provider.provider,
        results,
      }
    },
  }
}

async function refineIsleMindSearchResults(input: {
  configuration: Extract<WebSearchProviderConfiguration, { provider: 'islemind' }>
  fetchImplementation: typeof globalThis.fetch
  initialQuery: string
  initialResults: WebSearchProviderSource[]
  limit: number
  now: () => Date
  signal: AbortSignal
}): Promise<WebSearchProviderSource[]> {
  let bestResults = input.initialResults
  let bestCoverage = resultQueryCoverage(input.initialQuery, bestResults)
  if (bestCoverage >= ISLEMIND_SEARCH_RELEVANCE_THRESHOLD) return bestResults

  try {
    const payload = await requestProviderResults(
      input.configuration,
      input.initialQuery,
      input.limit,
      input.fetchImplementation,
      input.signal,
      ISLEMIND_SEARCH_FALLBACK_ENDPOINT,
      ISLEMIND_SEARCH_FALLBACK_TIMEOUT_MS,
    )
    throwIfAborted(input.signal)
    const results = normalizeProviderResults('islemind', payload, input.limit)
    const coverage = resultQueryCoverage(input.initialQuery, results)
    if (coverage > bestCoverage) {
      bestCoverage = coverage
      bestResults = results
    }
  } catch (error) {
    if (input.signal.aborted) throw error
  }
  if (bestCoverage >= ISLEMIND_SEARCH_RELEVANCE_THRESHOLD) return bestResults

  for (const query of buildSearchSuffixRefinements(input.initialQuery)) {
    throwIfAborted(input.signal)
    let payload: Record<string, unknown>
    try {
      payload = await requestProviderResults(
        input.configuration,
        query,
        input.limit,
        input.fetchImplementation,
        input.signal,
        ISLEMIND_SEARCH_FALLBACK_ENDPOINT,
        ISLEMIND_SEARCH_REFINEMENT_TIMEOUT_MS,
      )
    } catch (error) {
      if (input.signal.aborted) throw error
      break
    }
    throwIfAborted(input.signal)
    const results = normalizeProviderResults('islemind', payload, input.limit)
    const coverage = resultQueryCoverage(query, results)
    if (coverage > bestCoverage) {
      bestCoverage = coverage
      bestResults = results
    }
    if (bestCoverage >= ISLEMIND_SEARCH_RELEVANCE_THRESHOLD) break
  }

  if (bestCoverage < ISLEMIND_SEARCH_RELEVANCE_THRESHOLD && isNewsIntentQuery(input.initialQuery)) {
    try {
      const query = buildFreshNewsQuery(input.initialQuery, input.now())
      const payload = await requestProviderResults(
        input.configuration,
        query,
        input.limit,
        input.fetchImplementation,
        input.signal,
        ISLEMIND_SEARCH_ENDPOINT,
        ISLEMIND_SEARCH_FRESHNESS_TIMEOUT_MS,
      )
      throwIfAborted(input.signal)
      const results = normalizeProviderResults('islemind', payload, input.limit)
      const coverage = resultQueryCoverage(query, results)
      if (coverage > bestCoverage) bestResults = results
    } catch (error) {
      if (input.signal.aborted) throw error
    }
  }
  return bestResults
}

function isNewsIntentQuery(query: string): boolean {
  const normalized = query.normalize('NFKC').toLocaleLowerCase()
  const tokens = uniqueSearchTokens(normalized)
  return tokens.some((token) => (
    token === 'news'
    || token === 'headline'
    || token === 'headlines'
    || token === 'breaking'
  )) || /(?:最新|新闻|消息|动态|近况)/u.test(normalized)
}

function buildFreshNewsQuery(query: string, now: Date): string {
  const timestamp = now.getTime()
  if (!Number.isFinite(timestamp)) return query
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const freshness = /\p{Script=Han}/u.test(query)
    ? `${year}年${month + 1}月`
    : `${ISLEMIND_SEARCH_ENGLISH_MONTHS[month]} ${year}`
  return normalizeWebQuery(`${query} ${freshness}`)
}

function buildSearchSuffixRefinements(query: string): string[] {
  const parts = query.split(/\s+/).filter(Boolean)
  const refinements: string[] = []
  const entityAnchorIndex = parts.findIndex(isSearchEntityAnchor)
  const maximumDrop = Math.min(
    ISLEMIND_SEARCH_REFINEMENT_LIMIT,
    parts.length - 2,
    entityAnchorIndex >= 0 ? entityAnchorIndex : Number.POSITIVE_INFINITY,
  )
  for (let drop = 1; drop <= maximumDrop; drop += 1) {
    refinements.push(parts.slice(drop).join(' '))
  }
  return refinements
}

function isSearchEntityAnchor(token: string): boolean {
  const normalized = token
    .normalize('NFKC')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  if (!normalized) return false
  if (/\p{N}/u.test(normalized)) return true

  const letters = normalized.match(/\p{L}/gu)?.join('') ?? ''
  if (Array.from(letters).length < 2) return false
  if (/^\p{Lu}+$/u.test(letters)) return true
  if (!/\p{Lu}/u.test(letters) || !/\p{Ll}/u.test(letters)) return false
  return !/^\p{Lu}\p{Ll}+$/u.test(normalized)
}

function resultQueryCoverage(query: string, results: readonly WebSearchProviderSource[]): number {
  const tokens = uniqueSearchTokens(query)
  if (!tokens.length || !results.length) return 0
  const primaryResult = results[0]
  const searchableText = `${primaryResult.title} ${primaryResult.snippet ?? ''} ${primaryResult.url}`
    .normalize('NFKC')
    .toLocaleLowerCase()
  const matched = tokens.filter((token) => searchableText.includes(token)).length
  return matched / tokens.length
}

function uniqueSearchTokens(query: string): string[] {
  return [...new Set(query
    .normalize('NFKC')
    .toLocaleLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((token) => Array.from(token).length >= 2))]
}

async function requestProviderResults(
  configuration: Extract<WebSearchProviderConfiguration, { provider: RemoteWebSearchProviderId }>,
  query: string,
  limit: number,
  fetchImplementation: typeof globalThis.fetch,
  signal: AbortSignal,
  isleMindEndpoint = ISLEMIND_SEARCH_ENDPOINT,
  attemptTimeoutMs?: number,
): Promise<Record<string, unknown>> {
  const attempt = createSearchAttemptSignal(signal, attemptTimeoutMs)
  try {
    const request = buildProviderRequest(configuration, query, limit, attempt.signal, isleMindEndpoint)
    const response = await fetchImplementation(request.url, request.init)
    throwIfSearchAttemptUnavailable(signal, attempt)
    if (!response.ok) {
      throw new WebSearchProviderAdapterError(
        'http_failed',
        `${configuration.provider} web search returned HTTP ${response.status}.`,
        configuration.provider,
        response.status,
        response.status === 408 || response.status === 429 || response.status >= 500,
      )
    }

    if (configuration.provider === 'islemind') {
      const contentLength = Number(response.headers.get('Content-Length'))
      if (Number.isFinite(contentLength) && contentLength > ISLEMIND_SEARCH_RESPONSE_TEXT_LIMIT) {
        throw malformedResponse(configuration.provider, 'response exceeded the bounded RSS size')
      }
      const xml = await response.text()
      throwIfSearchAttemptUnavailable(signal, attempt)
      if (xml.length > ISLEMIND_SEARCH_RESPONSE_TEXT_LIMIT) {
        throw malformedResponse(configuration.provider, 'response exceeded the bounded RSS size')
      }
      return isleMindEndpoint === ISLEMIND_SEARCH_FALLBACK_ENDPOINT
        ? parseIsleMindSearchHtml(xml)
        : parseIsleMindSearchRss(xml)
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch (error) {
      throwIfSearchAttemptUnavailable(signal, attempt)
      if (isAbortError(error)) throw error
      throw new WebSearchProviderAdapterError(
        'malformed_response',
        `${configuration.provider} web search returned invalid JSON.`,
        configuration.provider,
      )
    }
    throwIfSearchAttemptUnavailable(signal, attempt)
    if (!isPlainRecord(payload)) {
      throw new WebSearchProviderAdapterError(
        'malformed_response',
        `${configuration.provider} web search returned a non-object payload.`,
        configuration.provider,
      )
    }
    return payload
  } catch (error) {
    throwIfSearchAttemptUnavailable(signal, attempt)
    throw error
  } finally {
    attempt.dispose()
  }
}

function createSearchAttemptSignal(
  parentSignal: AbortSignal,
  timeoutMs: number | undefined,
): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  if (timeoutMs === undefined) {
    return { signal: parentSignal, timedOut: () => false, dispose: () => undefined }
  }

  const controller = new AbortController()
  let timedOut = false
  const abortFromParent = (): void => controller.abort(parentSignal.reason)
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('Web search provider attempt timed out.'))
  }, timeoutMs)
  parentSignal.addEventListener('abort', abortFromParent, { once: true })
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      parentSignal.removeEventListener('abort', abortFromParent)
    },
  }
}

function throwIfSearchAttemptUnavailable(
  parentSignal: AbortSignal,
  attempt: { timedOut: () => boolean },
): void {
  throwIfAborted(parentSignal)
  if (attempt.timedOut()) {
    throw new WebSearchProviderAdapterError(
      'http_failed',
      'islemind web search provider attempt timed out.',
      'islemind',
      undefined,
      true,
    )
  }
}

function buildProviderRequest(
  configuration: Extract<WebSearchProviderConfiguration, { provider: RemoteWebSearchProviderId }>,
  query: string,
  limit: number,
  signal: AbortSignal,
  isleMindEndpoint = ISLEMIND_SEARCH_ENDPOINT,
): { url: string; init: RequestInit } {
  switch (configuration.provider) {
    case 'islemind': {
      const url = new URL(isleMindEndpoint)
      url.searchParams.set('q', query)
      if (isleMindEndpoint === ISLEMIND_SEARCH_ENDPOINT) {
        url.searchParams.set('format', 'rss')
        url.searchParams.set('count', String(limit))
      }
      return {
        url: url.href,
        init: {
          headers: {
            Accept: isleMindEndpoint === ISLEMIND_SEARCH_FALLBACK_ENDPOINT
              ? 'text/html, application/xhtml+xml;q=0.9'
              : 'application/rss+xml, application/xml;q=0.9',
            ...(isleMindEndpoint === ISLEMIND_SEARCH_FALLBACK_ENDPOINT
              ? { 'User-Agent': ISLEMIND_SEARCH_FALLBACK_USER_AGENT }
              : {}),
          },
          signal,
        },
      }
    }
    case 'tavily':
      return {
        url: TAVILY_SEARCH_ENDPOINT,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${requiredConfigurationText(configuration.apiKey, 'tavily', 'api key')}`,
          },
          body: JSON.stringify({
            query,
            max_results: Math.min(TAVILY_MAX_RESULTS, limit),
            search_depth: 'basic',
            include_raw_content: false,
          }),
          signal,
        },
      }
    case 'google': {
      const url = new URL(GOOGLE_CUSTOM_SEARCH_ENDPOINT)
      url.searchParams.set('key', requiredConfigurationText(configuration.apiKey, 'google', 'api key'))
      url.searchParams.set('cx', requiredConfigurationText(configuration.searchEngineId, 'google', 'search engine id'))
      url.searchParams.set('q', query)
      url.searchParams.set('num', String(Math.min(BUILT_IN_WEB_SEARCH_MAX_RESULTS, limit)))
      return { url: url.href, init: { signal } }
    }
    case 'bing': {
      const url = new URL(normalizeBingEndpoint(configuration.endpoint))
      url.searchParams.set('q', query)
      url.searchParams.set('count', String(limit))
      return {
        url: url.href,
        init: {
          headers: {
            'Ocp-Apim-Subscription-Key': requiredConfigurationText(configuration.apiKey, 'bing', 'api key'),
          },
          signal,
        },
      }
    }
    case 'custom': {
      const endpoint = normalizeCustomEndpointTemplate(configuration.endpoint)
      const url = endpoint
        .replace(/\{query\}/g, encodeURIComponent(query))
        .replace(/\{limit\}/g, String(limit))
      assertPublicHttpsEndpoint(url, 'custom')
      const apiKey = optionalConfigurationText(configuration.apiKey, 'custom', 'api key')
      return {
        url,
        init: {
          ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
          signal,
        },
      }
    }
  }
}

function normalizeProviderResults(
  provider: RemoteWebSearchProviderId,
  payload: Record<string, unknown>,
  limit: number,
): WebSearchProviderSource[] {
  const items = readProviderItems(provider, payload)
  const results: WebSearchProviderSource[] = []
  const seenUrls = new Set<string>()
  for (const item of items.slice(0, PROVIDER_RESULT_SCAN_LIMIT)) {
    if (!isPlainRecord(item)) continue
    const result = normalizeProviderResult(provider, item)
    if (!result) continue
    if (seenUrls.has(result.url)) continue
    seenUrls.add(result.url)
    results.push(result)
    if (results.length >= limit) break
  }
  return results
}

function readProviderItems(
  provider: RemoteWebSearchProviderId,
  payload: Record<string, unknown>,
): readonly unknown[] {
  switch (provider) {
    case 'islemind':
      return requiredResultArray(payload.results, provider, 'results')
    case 'tavily':
      return requiredResultArray(payload.results, provider, 'results')
    case 'google':
      return optionalResultArray(payload.items, provider, 'items')
    case 'bing': {
      if (payload.webPages === undefined) return []
      if (!isPlainRecord(payload.webPages)) {
        throw malformedResultContainer(provider, 'webPages')
      }
      return requiredResultArray(payload.webPages.value, provider, 'webPages.value')
    }
    case 'custom':
      if (payload.results !== undefined) return requiredResultArray(payload.results, provider, 'results')
      return optionalResultArray(payload.items, provider, 'items')
  }
}

function normalizeProviderResult(
  provider: RemoteWebSearchProviderId,
  item: Record<string, unknown>,
): WebSearchProviderSource | undefined {
  const rawUrl = provider === 'google' ? item.link : item.url ?? item.link
  let url: string
  try {
    url = normalizePublicHttpsUrl(rawUrl)
  } catch {
    return undefined
  }
  const rawTitle = provider === 'bing'
    ? item.name
    : item.title ?? item.name
  const rawSnippet = provider === 'tavily'
    ? item.content ?? item.snippet
    : item.content ?? item.snippet ?? item.description
  const title = truncatePublicText(rawTitle, PROVIDER_TITLE_LIMIT) || publicDisplayUrl(url)
  const snippet = truncatePublicText(rawSnippet, PROVIDER_SNIPPET_LIMIT)
  const score = typeof item.score === 'number' && Number.isFinite(item.score)
    ? item.score
    : undefined
  return {
    title,
    url,
    ...(snippet ? { snippet } : {}),
    ...(score !== undefined ? { score } : {}),
  }
}

function findMissingConfiguration(
  configuration: Extract<WebSearchProviderConfiguration, { provider: RemoteWebSearchProviderId }>,
): WebSearchProviderConfigurationField[] {
  switch (configuration.provider) {
    case 'islemind':
      return []
    case 'tavily':
      return hasConfigurationText(configuration.apiKey) ? [] : ['api_key']
    case 'google':
      return [
        ...(hasConfigurationText(configuration.apiKey) ? [] : ['api_key'] as const),
        ...(hasConfigurationText(configuration.searchEngineId) ? [] : ['search_engine_id'] as const),
      ]
    case 'bing':
      return [
        ...(hasConfigurationText(configuration.apiKey) ? [] : ['api_key'] as const),
        ...(hasConfigurationText(configuration.endpoint) ? [] : ['endpoint'] as const),
      ]
    case 'custom':
      return hasConfigurationText(configuration.endpoint) ? [] : ['endpoint']
  }
}

function assertProviderConfiguration(input: unknown): WebSearchProviderConfiguration {
  if (!isPlainRecord(input) || !WEB_SEARCH_PROVIDER_IDS.includes(input.provider as WebSearchProviderId)) {
    throw new WebSearchProviderAdapterError(
      'invalid_configuration',
      'Web search configuration did not select a supported provider.',
    )
  }
  return input as unknown as WebSearchProviderConfiguration
}

function normalizeBingEndpoint(input: string | null | undefined): string {
  const endpoint = boundedEndpointTemplate(input, 'bing')
  return assertPublicHttpsEndpoint(endpoint, 'bing')
}

function normalizeCustomEndpointTemplate(input: string | null | undefined): string {
  const endpoint = boundedEndpointTemplate(input, 'custom')
  const validationUrl = endpoint
    .replace(/\{query\}/g, 'islemind-search')
    .replace(/\{limit\}/g, '1')
  assertPublicHttpsEndpoint(validationUrl, 'custom')
  return endpoint
}

function boundedEndpointTemplate(
  input: string | null | undefined,
  provider: 'bing' | 'custom',
): string {
  const endpoint = requiredConfigurationText(input, provider, 'endpoint')
  if (endpoint.length > PROVIDER_ENDPOINT_LIMIT) {
    throw invalidConfiguration(provider, 'endpoint is too long')
  }
  return endpoint
}

function assertPublicHttpsEndpoint(
  endpoint: string,
  provider: 'bing' | 'custom',
): string {
  try {
    return normalizePublicHttpsUrl(endpoint)
  } catch {
    throw invalidConfiguration(provider, 'endpoint must be a public HTTPS URL on the standard TLS port')
  }
}

function requiredConfigurationText(
  input: string | null | undefined,
  provider: RemoteWebSearchProviderId,
  label: string,
): string {
  const value = optionalConfigurationText(input, provider, label)
  if (!value) throw invalidConfiguration(provider, `${label} is required`)
  return value
}

function optionalConfigurationText(
  input: string | null | undefined,
  provider: RemoteWebSearchProviderId,
  label: string,
): string {
  if (input === undefined || input === null) return ''
  if (typeof input !== 'string') throw invalidConfiguration(provider, `${label} must be text`)
  const value = input.trim()
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw invalidConfiguration(provider, `${label} contains unsafe characters`)
  }
  return value
}

function hasConfigurationText(input: unknown): boolean {
  return typeof input === 'string' && Boolean(input.trim())
}

function terminalResult(
  code: Exclude<WebSearchProviderResult['code'], 'completed'>,
  provider: WebSearchProviderId,
  missingConfiguration?: readonly WebSearchProviderConfigurationField[],
): Extract<WebSearchProviderResult, { ok: false }> {
  return {
    ok: false,
    code,
    provider,
    results: [],
    ...(missingConfiguration?.length ? { missingConfiguration: [...missingConfiguration] } : {}),
  }
}

function requiredResultArray(
  input: unknown,
  provider: RemoteWebSearchProviderId,
  field: string,
): readonly unknown[] {
  if (!Array.isArray(input)) throw malformedResultContainer(provider, field)
  return input
}

function optionalResultArray(
  input: unknown,
  provider: RemoteWebSearchProviderId,
  field: string,
): readonly unknown[] {
  if (input === undefined) return []
  return requiredResultArray(input, provider, field)
}

function malformedResultContainer(
  provider: RemoteWebSearchProviderId,
  field: string,
): WebSearchProviderAdapterError {
  return new WebSearchProviderAdapterError(
    'malformed_response',
    `${provider} web search returned an invalid ${field} result container.`,
    provider,
  )
}

function parseIsleMindSearchRss(xml: string): Record<string, unknown> {
  let payload: unknown
  try {
    payload = islemindSearchXmlParser.parse(xml)
  } catch {
    throw malformedResponse('islemind', 'returned invalid RSS XML')
  }
  if (!isPlainRecord(payload) || !isPlainRecord(payload.rss) || !isPlainRecord(payload.rss.channel)) {
    throw malformedResponse('islemind', 'returned an invalid RSS channel')
  }
  const items = payload.rss.channel.item
  if (items === undefined) return { results: [] }
  if (Array.isArray(items)) return { results: items.map(normalizeIsleMindSearchRssItem) }
  if (isPlainRecord(items)) return { results: [normalizeIsleMindSearchRssItem(items)] }
  throw malformedResponse('islemind', 'returned an invalid RSS item collection')
}

function parseIsleMindSearchHtml(html: string): Record<string, unknown> {
  let payload: unknown
  try {
    payload = islemindSearchHtmlParser.parse(html)
  } catch {
    throw malformedResponse('islemind', 'returned invalid search HTML')
  }
  if (!isPlainRecord(payload) || !isPlainRecord(payload.html)) {
    throw malformedResponse('islemind', 'returned an invalid search document')
  }
  const results: unknown[] = []
  collectIsleMindSearchHtmlResults(payload.html, results)
  return { results }
}

function collectIsleMindSearchHtmlResults(input: unknown, results: unknown[]): void {
  if (results.length >= PROVIDER_RESULT_SCAN_LIMIT) return
  if (Array.isArray(input)) {
    for (const item of input) collectIsleMindSearchHtmlResults(item, results)
    return
  }
  if (!isPlainRecord(input)) return
  if (hasHtmlClass(input, 'result__body')) {
    const titleNode = findHtmlNodeByClass(input, 'result__a')
    const snippetNode = findHtmlNodeByClass(input, 'result__snippet')
    if (titleNode) {
      results.push({
        title: htmlNodeText(titleNode),
        link: unwrapDuckDuckGoResultUrl(titleNode['@_href']),
        description: htmlNodeText(snippetNode),
      })
    }
    return
  }
  for (const child of Object.values(input)) collectIsleMindSearchHtmlResults(child, results)
}

function findHtmlNodeByClass(input: unknown, className: string): Record<string, unknown> | undefined {
  if (Array.isArray(input)) {
    for (const item of input) {
      const match = findHtmlNodeByClass(item, className)
      if (match) return match
    }
    return undefined
  }
  if (!isPlainRecord(input)) return undefined
  if (hasHtmlClass(input, className)) return input
  for (const child of Object.values(input)) {
    const match = findHtmlNodeByClass(child, className)
    if (match) return match
  }
  return undefined
}

function hasHtmlClass(input: Record<string, unknown>, className: string): boolean {
  return typeof input['@_class'] === 'string' && input['@_class'].split(/\s+/).includes(className)
}

function htmlNodeText(input: unknown): string {
  if (typeof input === 'string') {
    const decoded = decodeXmlNamedEntities(input)
    return typeof decoded === 'string' ? decoded : ''
  }
  if (Array.isArray(input)) return input.map(htmlNodeText).filter(Boolean).join(' ')
  if (!isPlainRecord(input)) return ''
  return Object.entries(input)
    .filter(([key]) => !key.startsWith('@_'))
    .map(([, child]) => htmlNodeText(child))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function unwrapDuckDuckGoResultUrl(input: unknown): unknown {
  if (typeof input !== 'string') return input
  const decoded = decodeXmlNamedEntities(input)
  if (typeof decoded !== 'string') return input
  try {
    const url = new URL(decoded, 'https://duckduckgo.com')
    if (url.hostname === 'duckduckgo.com' && url.pathname === '/l/') {
      return url.searchParams.get('uddg') ?? decoded
    }
  } catch {
    return input
  }
  return decoded
}

function normalizeIsleMindSearchRssItem(input: unknown): unknown {
  if (!isPlainRecord(input)) return input
  return {
    ...input,
    title: decodeXmlNamedEntities(input.title),
    link: decodeXmlNamedEntities(input.link),
    description: decodeXmlNamedEntities(input.description),
  }
}

function decodeXmlNamedEntities(input: unknown): unknown {
  if (typeof input !== 'string') return input
  return input.replace(/&(amp|lt|gt|quot|apos);/g, (entity, name: string) => ({
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  })[name] ?? entity)
}

function malformedResponse(
  provider: RemoteWebSearchProviderId,
  reason: string,
): WebSearchProviderAdapterError {
  return new WebSearchProviderAdapterError(
    'malformed_response',
    `${provider} web search ${reason}.`,
    provider,
  )
}

function invalidConfiguration(
  provider: RemoteWebSearchProviderId,
  reason: string,
): WebSearchProviderAdapterError {
  return new WebSearchProviderAdapterError(
    'invalid_configuration',
    `${provider} web search ${reason}.`,
    provider,
  )
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const prototype = Object.getPrototypeOf(input)
  return prototype === Object.prototype || prototype === null
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  const error = new Error('Web search was cancelled.')
  error.name = 'AbortError'
  throw error
}
