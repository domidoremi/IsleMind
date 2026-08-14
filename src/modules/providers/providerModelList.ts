import type { AIModel, AIProvider, ProviderOperationCode } from '@/types/providerContracts'
import { failure, success, type ProviderOperationResult } from './providerOperationResult'

export interface ProviderModelListOptions {
  timeoutMs?: number
  signal?: AbortSignal
  forceRefresh?: boolean
}

export interface ProviderModelListIssue {
  code: ProviderOperationCode
  message: string
}

export interface ProviderModelListMessages {
  saveApiKeyFirst: string
  emptyModels: string
  modelsFetched(count: number): string
}

export interface ProviderModelListDependencies {
  defaultTimeoutMs: number
  messages: ProviderModelListMessages
  configurationIssue(provider: AIProvider, apiKey: string): ProviderModelListIssue | undefined
  hostedIssue(provider: AIProvider): ProviderModelListIssue | undefined
  credentialGroupId(provider: AIProvider, apiKey: string): string | undefined
  fetchModels(provider: AIProvider, timeoutMs: number, signal?: AbortSignal): Promise<AIModel[]>
  fetchFailure(error: unknown, credentialGroupId?: string): ProviderOperationResult<AIModel[]>
  now?: () => number
  cacheTtlMs?: (provider: AIProvider) => number
}

export interface ProviderModelList {
  listDetailed(
    provider: AIProvider,
    apiKey: string,
    options?: ProviderModelListOptions,
  ): Promise<ProviderOperationResult<AIModel[]>>
  list(provider: AIProvider, apiKey: string, options?: ProviderModelListOptions): Promise<AIModel[]>
  listIds(provider: AIProvider, apiKey: string, options?: ProviderModelListOptions): Promise<string[]>
  invalidate(providerId?: string): void
}

export const PROVIDER_MODEL_CACHE_TTL_MS = 5 * 60 * 1000
export const PROVIDER_RELAY_MODEL_CACHE_TTL_MS = 60 * 1000
export const PROVIDER_LOCAL_MODEL_CACHE_TTL_MS = 30 * 1000

/** Owns model-list admission, credential attribution, and normalized results. */
export function createProviderModelList(
  dependencies: ProviderModelListDependencies,
): ProviderModelList {
  const now = dependencies.now ?? Date.now
  const snapshots = new Map<string, { providerId: string; expiresAt: number; result: ProviderOperationResult<AIModel[]> }>()
  const pending = new Map<string, Promise<ProviderOperationResult<AIModel[]>>>()
  const generations = new Map<string, number>()

  async function listDetailed(
    provider: AIProvider,
    apiKey: string,
    options: ProviderModelListOptions = {},
  ): Promise<ProviderOperationResult<AIModel[]>> {
    const normalizedApiKey = apiKey.trim()
    if (!normalizedApiKey) return failure<AIModel[]>('missing_key', dependencies.messages.saveApiKeyFirst)

    const configuredProvider = { ...provider, apiKey: normalizedApiKey }
    const configurationIssue = dependencies.configurationIssue(configuredProvider, normalizedApiKey)
    if (configurationIssue) {
      return failure<AIModel[]>(configurationIssue.code, configurationIssue.message)
    }

    // All cache identity decisions must use the same normalized credential that
    // is sent to discovery. This keeps whitespace-only input from splitting a
    // provider snapshot into a second cache entry.
    const credentialGroupId = dependencies.credentialGroupId(provider, normalizedApiKey)
    const hostedIssue = dependencies.hostedIssue(configuredProvider)
    if (hostedIssue) {
      return withCredentialGroup(
        failure<AIModel[]>(hostedIssue.code, hostedIssue.message),
        credentialGroupId,
      )
    }

    const cacheKey = providerModelCacheKey(configuredProvider, normalizedApiKey, credentialGroupId)
    const current = snapshots.get(cacheKey)
    if (options.forceRefresh !== true && current && current.expiresAt > now()) {
      return cloneProviderModelListResult(current.result)
    }
    const inFlight = pending.get(cacheKey)
    if (inFlight && options.forceRefresh !== true) {
      return cloneProviderModelListResult(await inFlight)
    }

    const generation = (generations.get(cacheKey) ?? 0) + 1
    generations.set(cacheKey, generation)
    const request = fetchProviderModels(configuredProvider, credentialGroupId, options).then((result) => {
      if (result.ok && generations.get(cacheKey) === generation) {
        const ttlMs = boundedModelCacheTtl(
          dependencies.cacheTtlMs?.(configuredProvider) ?? defaultProviderModelCacheTtlMs(configuredProvider),
        )
        snapshots.set(cacheKey, {
          providerId: configuredProvider.id,
          expiresAt: now() + ttlMs,
          result: cloneProviderModelListResult(result),
        })
      }
      return result
    }).finally(() => {
      if (pending.get(cacheKey) === request) pending.delete(cacheKey)
    })
    pending.set(cacheKey, request)
    return cloneProviderModelListResult(await request)
  }

  async function fetchProviderModels(
    configuredProvider: AIProvider,
    credentialGroupId: string | undefined,
    options: ProviderModelListOptions,
  ): Promise<ProviderOperationResult<AIModel[]>> {
    try {
      const models = await dependencies.fetchModels(
        configuredProvider,
        options.timeoutMs ?? dependencies.defaultTimeoutMs,
        options.signal,
      )
      if (!models.length) {
        return withCredentialGroup(
          failure<AIModel[]>('empty_models', dependencies.messages.emptyModels),
          credentialGroupId,
        )
      }
      return success(
        dependencies.messages.modelsFetched(models.length),
        models,
        credentialGroupId,
      )
    } catch (error) {
      return dependencies.fetchFailure(error, credentialGroupId)
    }
  }

  async function list(
    provider: AIProvider,
    apiKey: string,
    options: ProviderModelListOptions = {},
  ): Promise<AIModel[]> {
    const result = await listDetailed(provider, apiKey, options)
    return result.ok ? result.data ?? [] : []
  }

  return {
    listDetailed,
    list,
    async listIds(provider, apiKey, options = {}) {
      return (await list(provider, apiKey, options)).map((model) => model.id)
    },
    invalidate(providerId) {
      const keys = providerId === undefined
        ? new Set([...snapshots.keys(), ...pending.keys(), ...generations.keys()])
        : new Set([
            ...[...snapshots].filter(([, value]) => value.providerId === providerId).map(([key]) => key),
            ...[...pending.keys()].filter((key) => key.startsWith(`${encodeCachePart(providerId)}|`)),
            ...[...generations.keys()].filter((key) => key.startsWith(`${encodeCachePart(providerId)}|`)),
          ])
      for (const key of keys) {
        snapshots.delete(key)
        pending.delete(key)
        generations.set(key, (generations.get(key) ?? 0) + 1)
      }
    },
  }
}

function providerModelCacheKey(
  provider: AIProvider,
  apiKey: string,
  credentialGroupId: string | undefined,
): string {
  const endpoint = normalizeProviderModelCacheEndpoint(provider.baseUrl)
  const credentialScope = credentialGroupId?.trim() || `key-${stableCredentialFingerprint(apiKey)}`
  return [
    provider.id,
    provider.type,
    endpoint,
    provider.presetId ?? provider.detectedPresetId ?? '',
    provider.wireProtocol ?? '',
    credentialScope,
  ].map(encodeCachePart).join('|')
}

function normalizeProviderModelCacheEndpoint(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/u, '')}`.toLowerCase()
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/u, '')
  }
}

function stableCredentialFingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function encodeCachePart(value: string): string {
  return encodeURIComponent(value)
}

function defaultProviderModelCacheTtlMs(provider: AIProvider): number {
  const presetId = provider.presetId ?? provider.detectedPresetId
  if (presetId && ['ollama', 'lm-studio', 'localai', 'vllm', 'sglang'].includes(presetId)) {
    return PROVIDER_LOCAL_MODEL_CACHE_TTL_MS
  }
  if (presetId && ['openrouter', 'newapi', 'sub2api'].includes(presetId)) {
    return PROVIDER_RELAY_MODEL_CACHE_TTL_MS
  }
  return PROVIDER_MODEL_CACHE_TTL_MS
}

function boundedModelCacheTtl(value: number): number {
  if (!Number.isSafeInteger(value)) return PROVIDER_MODEL_CACHE_TTL_MS
  return Math.max(5_000, Math.min(15 * 60 * 1000, value))
}

function cloneProviderModelListResult(
  result: ProviderOperationResult<AIModel[]>,
): ProviderOperationResult<AIModel[]> {
  return result.data
    ? { ...result, data: result.data.map((model) => ({ ...model })) }
    : { ...result }
}

function withCredentialGroup<T>(
  result: ProviderOperationResult<T>,
  credentialGroupId: string | undefined,
): ProviderOperationResult<T> {
  return credentialGroupId ? { ...result, credentialGroupId } : result
}
