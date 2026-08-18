import type { AIProvider } from '@/types/providerContracts'
import {
  createProviderUsageQueryRecipeExecutor,
  getProviderRequestHeaders,
  normalizeProviderUsageQueryConfiguration,
  providerUsageQueryConfigurationFingerprint,
  type ProviderUsageQueryCredential,
  type ProviderUsageQueryRecipe,
  type ProviderUsageQueryResult,
} from '@/modules/providers'
import { providerCredentialStorage } from './secureCredentialStorage'
import { providerTransport } from './providerTransport'

const PROVIDER_USAGE_CACHE_TTL_MS = 15 * 60 * 1000
const PROVIDER_USAGE_QUERY_TIMEOUT_MS = 5_000
const PROVIDER_USAGE_QUERY_DEADLINE_MS = 20_000

const DEFAULT_USAGE_PATHS = [
  '/v1/usage',
  '/usage',
  '/api/usage',
  '/api/v1/usage',
  '/v1/quota',
  '/quota',
  '/v1/credits',
  '/credits',
  '/v1/account/balance',
  '/account/balance',
  '/v1/account/usage',
  '/account/usage',
  '/v1/account',
  '/account',
  '/v1/user/balance',
  '/user/balance',
  '/api/v1/user/balance',
  '/v1/user/info',
  '/user/info',
  '/v1/users/me',
  '/users/me',
  '/v1/key',
  '/key',
  '/v1/billing/usage',
  '/billing/usage',
  '/v1/billing/credit_grants',
  '/dashboard/billing/credit_grants',
  '/v1/organization/usage',
  '/organization/usage',
] as const

const DEFAULT_USAGE_EXTRACTION = {
  remaining: [
    '/remaining',
    '/quota/remaining',
    '/quota/available',
    '/balance',
    '/balance/remaining',
    '/balance/amount',
    '/balance/value',
    '/credits/remaining',
    '/credits/balance',
    '/data/remaining',
    '/data/quota/remaining',
    '/data/balance',
    '/data/balance/amount',
    '/data/balance/value',
    '/data/available',
    '/data/available_balance',
    '/data/balance_remaining',
    '/data/limit_remaining',
    '/available_balance',
    '/remaining_balance',
    '/available',
    '/limit_remaining',
    '/total_available',
    '/balance_infos/0/total_balance',
    '/result/remaining',
    '/result/balance',
    '/response/remaining',
    '/usage/remaining',
    '/usage/quota/remaining',
    '/total_remaining',
  ],
  limit: [
    '/limit',
    '/quota/limit',
    '/credits/limit',
    '/data/limit',
    '/usage/limit',
    '/total',
    '/total_granted',
    '/total_limit',
    '/max',
    '/data/total',
    '/result/limit',
  ],
  used: [
    '/used',
    '/quota/used',
    '/credits/used',
    '/data/used',
    '/usage/used',
    '/consumed',
    '/total_used',
    '/usage',
    '/data/usage',
    '/data/consumed',
    '/result/used',
  ],
  resetAt: ['/reset_at', '/resetAt', '/reset_time', '/quota/reset_at', '/usage/reset_at', '/data/reset_at'],
  unit: ['/unit', '/quota/unit', '/currency', '/data/unit', '/data/currency', '/usage/unit', '/balance_infos/0/currency'],
  isValid: ['/is_active', '/isValid', '/valid', '/active', '/is_available', '/data/is_active', '/data/isValid', '/result/isValid'],
} as const satisfies ProviderUsageQueryRecipe['extract']

interface CachedUsage {
  expiresAt: number
  result: ProviderUsageQueryResult | null
}

const usageCache = new Map<string, CachedUsage>()

/** Queries a provider's configured or conventional usage endpoints without evaluating remote code. */
export async function queryProviderUsage(
  provider: AIProvider,
  options: { forceRefresh?: boolean; signal?: AbortSignal } = {},
): Promise<ProviderUsageQueryResult | null> {
  const baseUrl = provider.baseUrl?.trim()
  if (!baseUrl || !provider.enabled) return null
  const cacheKey = `${provider.id}:${baseUrl}:${providerUsageQueryConfigurationFingerprint(provider.usageQueryConfiguration)}`
  const cached = usageCache.get(cacheKey)
  if (options.forceRefresh !== true && cached && cached.expiresAt > Date.now()) return cached.result

  const credentials = await loadProviderUsageCredentials(provider)
  if (!credentials.length) {
    usageCache.set(cacheKey, { expiresAt: Date.now() + PROVIDER_USAGE_CACHE_TTL_MS, result: null })
    return null
  }

  const executor = createProviderUsageQueryRecipeExecutor({
    request: providerTransport.request,
  })
  const recipes = providerUsageRecipes(provider)
  let result: ProviderUsageQueryResult | null = null
  for (const credential of credentials) {
    const deadline = Date.now() + PROVIDER_USAGE_QUERY_DEADLINE_MS
    const credentialProvider = { ...provider, apiKey: credential.apiKey }
    const authenticationHeaders = getProviderRequestHeaders(credentialProvider)
    for (const recipe of recipes) {
      if (options.signal?.aborted) return null
      const remainingMs = deadline - Date.now()
      if (remainingMs < 1_000) break
      try {
        const candidate = await executor.query({
          providerBaseUrl: baseUrl,
          provider: credentialProvider,
          authenticationHeaders,
          credentials,
          recipe: {
            ...recipe,
            timeoutMs: Math.min(recipe.timeoutMs ?? PROVIDER_USAGE_QUERY_TIMEOUT_MS, remainingMs),
          },
          signal: options.signal,
        })
        if (candidate.isValid === false || !hasUsageValue(candidate)) continue
        result = candidate
        break
      } catch {
        // Unsupported usage endpoints are expected across compatible gateways.
      }
    }
    if (result) break
  }

  usageCache.set(cacheKey, { expiresAt: Date.now() + PROVIDER_USAGE_CACHE_TTL_MS, result })
  return result
}

export function invalidateProviderUsage(providerId?: string): void {
  if (!providerId) {
    usageCache.clear()
    return
  }
  for (const key of usageCache.keys()) {
    if (key.startsWith(`${providerId}:`)) usageCache.delete(key)
  }
}

function providerUsageRecipes(provider: AIProvider): ProviderUsageQueryRecipe[] {
  const configured = normalizeProviderUsageQueryConfiguration(provider.usageQueryConfiguration)
  if (configured.enabled) return [...configured.recipes]
  const recipes: ProviderUsageQueryRecipe[] = []
  for (const path of DEFAULT_USAGE_PATHS) {
    recipes.push({
      schema: 'islemind.provider-usage-query-recipe.v1',
      method: 'GET',
      path,
      extract: DEFAULT_USAGE_EXTRACTION,
      timeoutMs: PROVIDER_USAGE_QUERY_TIMEOUT_MS,
    })
    // Also resolve /v1 endpoints relative to gateways whose base URL already
    // contains a deployment prefix such as /api/v1.
    if (path.startsWith('/v1/')) {
      recipes.push({
        schema: 'islemind.provider-usage-query-recipe.v1',
        method: 'GET',
        path: path.slice('/v1/'.length),
        extract: DEFAULT_USAGE_EXTRACTION,
        timeoutMs: PROVIDER_USAGE_QUERY_TIMEOUT_MS,
      })
    }
  }
  return recipes
}

function hasUsageValue(result: ProviderUsageQueryResult): boolean {
  return result.remaining !== undefined || result.limit !== undefined || result.used !== undefined
}

async function loadProviderUsageCredentials(provider: AIProvider): Promise<Array<ProviderUsageQueryCredential & { apiKey: string }>> {
  const entries: Array<ProviderUsageQueryCredential & { apiKey: string }> = []
  const providerKey = await providerCredentialStorage.getProviderCredential(provider.id).catch(() => null)
  if (providerKey?.trim()) {
    entries.push({
      id: 'provider',
      apiKey: providerKey.trim(),
      origin: providerOrigin(provider.baseUrl),
      headers: getProviderRequestHeaders({ ...provider, apiKey: providerKey.trim() }),
    })
  }
  for (const group of provider.credentialGroups ?? []) {
    if (!group.enabled) continue
    const groupKey = await providerCredentialStorage.getCredentialGroupCredential(provider.id, group.id).catch(() => null)
    if (!groupKey?.trim()) continue
    entries.push({
      id: group.id,
      apiKey: groupKey.trim(),
      origin: providerOrigin(provider.baseUrl),
      headers: getProviderRequestHeaders({ ...provider, apiKey: groupKey.trim() }),
    })
  }
  if (!entries.length && provider.apiKey?.trim()) {
    const apiKey = provider.apiKey.trim()
    entries.push({
      id: 'provider',
      apiKey,
      origin: providerOrigin(provider.baseUrl),
      headers: getProviderRequestHeaders({ ...provider, apiKey }),
    })
  }
  return entries
}

function providerOrigin(baseUrl: string | undefined): string {
  try {
    return new URL(baseUrl ?? '').origin
  } catch {
    return ''
  }
}
