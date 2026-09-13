import type { AIModel, AIProvider } from '@/types/providerContracts'
import { isGitHubModelsProvider } from './providerIdentityPolicy'
import { ProviderHttpError } from './providerOperationResult'
import { isCredentiallessLocalProvider, parseProviderRetryAfterMs } from './providerProbe'
import { withProviderOperationTimeout } from './providerTransportUtils'
import type { ProviderModelOperation, ProviderModelScopeIdentity } from './providerModelAvailabilityContracts'
import type { ProviderModelDiscoveryResult } from './providerModelDiscoveryEvidence'
export { canApplyProviderModelDiscoveryAbsence, type ProviderModelDiscoveryResult } from './providerModelDiscoveryEvidence'

export interface ProviderModelDiscoveryOptions {
  timeoutMs: number
  signal?: AbortSignal
  scope?: ProviderModelScopeIdentity
  operation?: ProviderModelOperation
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
  discoverDetailed(provider: AIProvider, options: ProviderModelDiscoveryOptions): Promise<ProviderModelDiscoveryResult>
}

/** Owns provider model-list routing, transport, cancellation, and boundary parsing. */
export function createProviderModelDiscoveryAdapter(
  dependencies: ProviderModelDiscoveryAdapterDependencies,
): ProviderModelDiscoveryAdapter {
  async function run(provider: AIProvider, options: ProviderModelDiscoveryOptions): Promise<{ result: ProviderModelDiscoveryResult; error?: unknown }> {
    const discoveryProvider = normalizeModelDiscoveryProvider(provider)
    const baseUrl = trimTrailingSlash(dependencies.resolveBaseUrl(discoveryProvider))
    const semantics = discoverySemantics(discoveryProvider, baseUrl)
    const result: ProviderModelDiscoveryResult = {
      schema: 'islemind.model-discovery-result.v1', providerId: provider.id, models: [], advertisedModelIds: [],
      status: 'unsupported', valid: false, completeness: 'unknown', pagination: 'unknown', truncation: 'unknown',
      ...semantics,
      ...(options.scope ? { scope: {
        providerId: options.scope.providerId, protocolAdapterId: options.scope.protocolAdapterId, endpointVariant: options.scope.endpointVariant,
        credentialSource: options.scope.credentialSource.kind === 'group' ? { kind: 'group', groupId: options.scope.credentialSource.groupId } : { kind: options.scope.credentialSource.kind },
      } } : {}),
      ...(options.operation ? { operation: { scopeId: options.operation.scopeId, epoch: options.operation.epoch, operationId: options.operation.operationId, orderToken: options.operation.orderToken, startedAt: options.operation.startedAt } } : {}),
    }
    try {
      throwIfProviderModelDiscoveryAborted(options.signal)
      const issue = dependencies.configurationIssue(provider)
      if (issue) { result.failureReason = 'invalid_configuration'; throw new Error(issue) }
      if (provider.capabilities?.modelList === false || !dependencies.supportsModelList(provider)) { result.source = 'unsupported'; return { result } }
      const usesAnthropicCompatibleProtocol = provider.type === 'openai-compatible'
        && provider.wireProtocol === 'anthropic-compatible'
      if (
        discoveryProvider.type !== 'google'
        && discoveryProvider.type !== 'anthropic'
        && discoveryProvider.type !== 'openai'
        && !dependencies.isOpenAICompatible(discoveryProvider)
      ) return { result }
      await withProviderOperationTimeout(options.timeoutMs, options.signal, async (signal, wait) => {
        const seenCursors = new Set<string>()
        let next: string | undefined
        let allValid = true
        const advertised = new Set<string>()
        do {
          throwIfProviderModelDiscoveryAborted(signal)
          let endpoint = resolveProviderModelDiscoveryEndpoint(discoveryProvider, baseUrl)
          if (next) {
            const url = new URL(endpoint)
            url.searchParams.set(discoveryProvider.type === 'google' ? 'pageToken' : 'after_id', next)
            endpoint = url.toString()
          }
          const response = await wait(dependencies.request(endpoint, {
            method: 'GET', headers: providerModelDiscoveryHeaders(discoveryProvider, dependencies.resolveHeaders(discoveryProvider)), signal,
          }, options.timeoutMs))
          let responseText: string
          try { responseText = await wait(dependencies.readResponseText(response)) }
          finally { if (signal.aborted) void response.body?.cancel().catch(() => undefined) }
          throwIfProviderModelDiscoveryAborted(signal)
          if (!response.ok) throw new ProviderHttpError(response.status, responseText, parseProviderRetryAfterMs(response.headers.get('retry-after')))
          let value: unknown
          try { value = dependencies.parseResponseJson(responseText, response, discoveryProvider) }
          catch { result.failureReason = 'malformed'; throw new ProviderHttpError(response.status, '') }
          if (isGitHubModelsProvider(provider) && Array.isArray(value)) value = { data: value }
          const envelope = asRecord(value)
          const items = envelope?.[discoveryProvider.type === 'google' ? 'models' : 'data']
          if (!Array.isArray(items)) { result.failureReason = 'malformed'; throw new ProviderHttpError(response.status, '') }
          if (semantics.source === 'openai' && envelope?.object !== 'list') allValid = false
          for (const item of items) {
            const id = asRecord(item)?.[discoveryProvider.type === 'google' ? 'name' : 'id']
            if (typeof id !== 'string' || !id.trim() || id !== id.trim() || /[\u0000-\u001f]/u.test(id)) { allValid = false; continue }
            advertised.add(id.replace(/^models\//, ''))
          }
          let page: AIModel[]
          try {
            page = discoveryProvider.type === 'google' ? dependencies.mapGoogle(value)
              : discoveryProvider.type === 'anthropic' || usesAnthropicCompatibleProtocol ? dependencies.mapAnthropic(value)
              : dependencies.mapOpenAICompatible(value, discoveryProvider)
          } catch { result.failureReason = 'malformed'; throw new ProviderHttpError(response.status, '') }
          result.models = result.models.length ? uniqueModels([...result.models, ...page]) : page
          result.advertisedModelIds = [...advertised]
          result.valid = allValid
          const pagination = readDiscoveryPagination(envelope!, discoveryProvider)
          if (response.headers.get('link')?.includes('rel="next"') && !pagination.next) pagination.status = 'incomplete'
          result.pagination = pagination.status
          const knownContract = ['openai', 'anthropic', 'google'].includes(semantics.source)
          result.truncation = envelope?.truncated === true || envelope?.capped === true
            || (typeof envelope?.total === 'number' && envelope.total > advertised.size && pagination.status === 'exhausted')
            ? 'detected' : knownContract ? 'none' : 'unknown'
          result.completeness = !allValid || result.truncation === 'detected' || pagination.status === 'incomplete' ? 'partial'
            : knownContract && pagination.status === 'exhausted' ? 'complete' : 'unknown'
          next = pagination.next
          if (next) {
            if (seenCursors.has(next) || !items.length) { result.failureReason = 'pagination'; throw new Error('Model discovery pagination did not advance') }
            seenCursors.add(next)
          }
          if (pagination.invalid) { result.failureReason = 'pagination'; throw new Error('Invalid model discovery pagination') }
        } while (next)
        result.status = 'success'
      })
      return { result }
    } catch (error) {
      result.status = options.signal?.aborted ? 'cancelled' : 'failure'
      result.completeness = result.models.length ? 'partial' : 'unknown'
      result.pagination = 'incomplete'
      if (error instanceof ProviderHttpError) { result.httpStatus = error.status; result.retryAfterMs = error.retryAfterMs }
      result.failureReason ??= options.signal?.aborted ? 'cancelled' : error instanceof ProviderHttpError ? 'http'
        : error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name) ? 'timeout' : 'network'
      return { result, error }
    }
  }
  return {
    async discover(provider, options) {
      const outcome = await run(provider, options)
      if (outcome.error !== undefined) throw outcome.error
      return outcome.result.models
    },
    async discoverDetailed(provider, options) { return (await run(provider, options)).result },
  }
}

function discoverySemantics(provider: AIProvider, baseUrl: string): Pick<ProviderModelDiscoveryResult, 'source' | 'authority' | 'coverage'> {
  let official = false
  try {
    const url = new URL(baseUrl)
    official = url.protocol === 'https:' && !url.search && !url.username && !url.password && !url.port
      && ((provider.type === 'openai' && url.hostname === 'api.openai.com' && url.pathname === '/v1')
        || (provider.type === 'anthropic' && url.hostname === 'api.anthropic.com' && url.pathname === '/v1'))
  } catch { /* An unrecognized endpoint cannot prove listing authority. */ }
  return { source: isGitHubModelsProvider(provider) ? 'github-catalog' : provider.type === 'xiaomi-mimo' ? 'mimo'
    : provider.type === 'google' ? 'google' : official ? provider.type === 'anthropic' ? 'anthropic' : 'openai' : 'compatible',
    authority: official ? 'access-authoritative' : 'catalog-only', coverage: provider.type === 'google' ? 'filtered' : official ? 'exact-scope' : 'unknown',
  }
}

function readDiscoveryPagination(value: Record<string, unknown>, provider: AIProvider): { status: ProviderModelDiscoveryResult['pagination']; next?: string; invalid?: boolean } {
  if (provider.type === 'google') {
    if (value.nextPageToken === undefined || value.nextPageToken === '') return { status: 'exhausted' }
    return typeof value.nextPageToken === 'string' && value.nextPageToken.trim() ? { status: 'incomplete', next: value.nextPageToken } : { status: 'incomplete', invalid: true }
  }
  if (provider.type === 'anthropic' || (provider.type === 'openai-compatible' && provider.wireProtocol === 'anthropic-compatible')) {
    if (value.has_more === false) return { status: 'exhausted' }
    if (value.has_more === true) return typeof value.last_id === 'string' && value.last_id.trim()
      ? { status: 'incomplete', next: value.last_id } : { status: 'incomplete', invalid: true }
    return { status: 'unknown' }
  }
  // OpenAI's official list contract is unpaginated. Undocumented vendor hints do not grant completeness.
  if (value.has_more !== undefined && typeof value.has_more !== 'boolean') return { status: 'incomplete', invalid: true }
  if (value.has_more === true || value.next_page || value.nextPageToken || value.next || value.next_cursor) return { status: 'incomplete' }
  return { status: 'exhausted' }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function uniqueModels(models: AIModel[]): AIModel[] { return [...new Map(models.map((model) => [model.id, model])).values()] }

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
