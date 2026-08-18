import type { AIProvider } from '@/types/providerContracts'
import { ProviderHttpError } from './providerOperationResult'
import { parseProviderRetryAfterMs } from './providerProbe'
import { applyProviderClientSimulationHeaders } from './providerClientSimulationPolicy'

export const PROVIDER_USAGE_QUERY_RECIPE_SCHEMA = 'islemind.provider-usage-query-recipe.v1' as const
export const PROVIDER_USAGE_QUERY_CONFIGURATION_SCHEMA = 'islemind.provider-usage-query-configuration.v1' as const
export const PROVIDER_USAGE_QUERY_CONFIGURATION_MAX_RECIPES = 8

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024
const DEFAULT_MAX_JSON_DEPTH = 8
const DEFAULT_MAX_JSON_NODES = 1_024
const MAX_STATIC_BODY_BYTES = 16 * 1024
const MAX_STATIC_BODY_DEPTH = 8
const MAX_STATIC_BODY_NODES = 256
export const PROVIDER_USAGE_QUERY_CACHE_TTL_MS = 15 * 60 * 1000

export type ProviderUsageRecipeJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ProviderUsageRecipeJsonValue[]
  | { readonly [key: string]: ProviderUsageRecipeJsonValue }

export interface ProviderUsageQueryExtraction {
  remaining?: string | readonly string[]
  limit?: string | readonly string[]
  used?: string | readonly string[]
  resetAt?: string | readonly string[]
  unit?: string | readonly string[]
  isValid?: string | readonly string[]
}

export const PROVIDER_USAGE_QUERY_EXAMPLE = `{
  "request": {
    "url": "{{baseUrl}}/v1/usage",
    "method": "GET",
    "headers": { "Authorization": "Bearer {{apiKey}}" }
  },
  "extractor": function(response) {
    const remaining = response?.remaining ?? response?.quota?.remaining ?? response?.balance;
    const unit = response?.unit ?? response?.quota?.unit ?? "USD";
    return {
      isValid: response?.is_active ?? response?.isValid ?? true,
      remaining,
      unit
    };
  }
}` as const

/**
 * Safe data-only equivalent of PROVIDER_USAGE_QUERY_EXAMPLE. It intentionally
 * stores JSON Pointer candidates instead of persisting or evaluating code.
 */
export const PROVIDER_USAGE_QUERY_EXAMPLE_RECIPE: ProviderUsageQueryRecipe = {
  schema: PROVIDER_USAGE_QUERY_RECIPE_SCHEMA,
  method: 'GET',
  path: '/v1/usage',
  extract: {
    remaining: ['/remaining', '/quota/remaining', '/balance'],
    unit: ['/unit', '/quota/unit', '/currency'],
    isValid: ['/is_active', '/isValid', '/valid'],
  },
}

export interface ProviderUsageQueryRecipe {
  schema: typeof PROVIDER_USAGE_QUERY_RECIPE_SCHEMA
  method: 'GET' | 'POST'
  /** Relative or absolute URL. Resolution must retain the provider base origin. */
  path: string
  /** Declarative request headers; authentication headers are injected separately. */
  headers?: Readonly<Record<string, string>>
  /** Opaque SecureStore reference. Secret material is never persisted in the recipe. */
  credentialRef?: string
  /** Static JSON only. GET recipes cannot declare a body. */
  body?: ProviderUsageRecipeJsonValue
  extract: ProviderUsageQueryExtraction
  timeoutMs?: number
  maxResponseBytes?: number
  maxJsonDepth?: number
  maxJsonNodes?: number
}

export interface ProviderUsageQueryConfiguration {
  schema: typeof PROVIDER_USAGE_QUERY_CONFIGURATION_SCHEMA
  enabled: boolean
  recipes: readonly ProviderUsageQueryRecipe[]
}

export type ProviderUsageQueryRecipeV1 = ProviderUsageQueryRecipe

export interface ProviderUsageQueryCredential {
  id: string
  /** Exact HTTP(S) origin to which this credential may be sent. */
  origin: string
  headers: Readonly<Record<string, string>>
}

export interface ProviderUsageQueryInput {
  providerBaseUrl: string
  /** Provider identity used to apply the same canonical client UA as chat and discovery. */
  provider?: AIProvider
  authenticationHeaders?: Readonly<Record<string, string>>
  credentials?: readonly ProviderUsageQueryCredential[]
  recipe: ProviderUsageQueryRecipe
  signal?: AbortSignal
}

export interface ProviderUsageQueryResult {
  endpoint: string
  status: number
  remaining?: number
  limit?: number
  used?: number
  resetAt?: string | number
  exhausted?: boolean
  unit?: string
  isValid?: boolean
}

export interface ProviderUsageQueryRecipeDependencies {
  request(input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number): Promise<Response>
}

export interface ProviderUsageQueryRecipeExecutor {
  query(input: ProviderUsageQueryInput): Promise<ProviderUsageQueryResult>
}

export interface ProviderUsageQuotaSnapshot extends ProviderUsageQueryResult {
  fetchedAt: number
  expiresAt: number
}

export interface ProviderUsageQuotaSnapshotPort {
  get(
    cacheKey: string,
    input: ProviderUsageQueryInput,
    options?: { forceRefresh?: boolean },
  ): Promise<ProviderUsageQuotaSnapshot>
  invalidate(cacheKey?: string): void
}

export type ProviderUsageQueryRecipeErrorCode =
  | 'invalid_recipe'
  | 'cross_origin'
  | 'credential_unavailable'
  | 'unsafe_header'
  | 'secret_literal'
  | 'redirect_rejected'
  | 'request_too_large'
  | 'response_too_large'
  | 'invalid_json'
  | 'json_limit_exceeded'
  | 'json_pointer_invalid'
  | 'extracted_value_invalid'

export class ProviderUsageQueryRecipeError extends Error {
  constructor(
    public readonly code: ProviderUsageQueryRecipeErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderUsageQueryRecipeError'
  }
}

/** Executes bounded data-only quota recipes against the configured provider origin. */
export function createProviderUsageQueryRecipeExecutor(
  dependencies: ProviderUsageQueryRecipeDependencies,
): ProviderUsageQueryRecipeExecutor {
  return {
    async query(input) {
      throwIfUsageQueryAborted(input.signal)
      const recipe = validateProviderUsageQueryRecipe(input.recipe)
      const endpoint = resolveProviderUsageEndpoint(
        input.providerBaseUrl,
        recipe.path,
        recipe.credentialRef,
        input.credentials,
      )
      const credentialHeaders = resolveProviderUsageCredentialHeaders(
        input.providerBaseUrl,
        endpoint,
        recipe.credentialRef,
        input.authenticationHeaders,
        input.credentials,
      )
      const headers = buildProviderUsageQueryHeaders(
        credentialHeaders,
        recipe.headers,
        recipe.method,
        input.provider,
      )
      const body = recipe.method === 'POST'
        ? stringifyStaticJson(recipe.body ?? {})
        : undefined
      const response = await dependencies.request(
        endpoint,
        {
          method: recipe.method,
          headers,
          redirect: 'manual',
          ...(body === undefined ? {} : { body }),
          ...(input.signal ? { signal: input.signal } : {}),
        },
        boundedInteger(recipe.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 15_000),
      )
      throwIfUsageQueryAborted(input.signal)
      if (response.status >= 300 && response.status < 400) {
        throw recipeError('redirect_rejected', 'Provider usage query redirects are not allowed')
      }
      const responseText = await readBoundedUsageResponse(
        response,
        boundedInteger(recipe.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 1, DEFAULT_MAX_RESPONSE_BYTES),
        input.signal,
      )
      throwIfUsageQueryAborted(input.signal)
      if (!response.ok) {
        throw new ProviderHttpError(
          response.status,
          responseText,
          parseProviderRetryAfterMs(response.headers.get('retry-after')),
        )
      }
      const value = parseBoundedUsageJson(
        responseText,
        boundedInteger(recipe.maxJsonDepth, DEFAULT_MAX_JSON_DEPTH, 1, DEFAULT_MAX_JSON_DEPTH),
        boundedInteger(recipe.maxJsonNodes, DEFAULT_MAX_JSON_NODES, 1, DEFAULT_MAX_JSON_NODES),
      )
      const remaining = extractOptionalUsageNumber(value, recipe.extract.remaining, 'remaining')
      const limit = extractOptionalUsageNumber(value, recipe.extract.limit, 'limit')
      const used = extractOptionalUsageNumber(value, recipe.extract.used, 'used')
      const resetAt = extractOptionalUsageReset(value, recipe.extract.resetAt)
      const unit = extractOptionalUsageText(value, recipe.extract.unit)
      const isValid = extractOptionalUsageBoolean(value, recipe.extract.isValid)
      return {
        endpoint,
        status: response.status,
        ...(remaining === undefined ? {} : { remaining, exhausted: remaining <= 0 }),
        ...(limit === undefined ? {} : { limit }),
        ...(used === undefined ? {} : { used }),
        ...(resetAt === undefined ? {} : { resetAt }),
        ...(unit === undefined ? {} : { unit }),
        ...(isValid === undefined ? {} : { isValid }),
      }
    },
  }
}

/** Pull-based quota cache. Callers refresh on screen entry or with forceRefresh. */
export function createProviderUsageQuotaSnapshotPort(
  executor: ProviderUsageQueryRecipeExecutor,
  options: { now?: () => number; ttlMs?: number } = {},
): ProviderUsageQuotaSnapshotPort {
  const now = options.now ?? Date.now
  const ttlMs = boundedCacheTtl(options.ttlMs)
  const snapshots = new Map<string, { fingerprint: string; snapshot: ProviderUsageQuotaSnapshot }>()
  const pending = new Map<string, Promise<ProviderUsageQuotaSnapshot>>()
  const generations = new Map<string, number>()

  return {
    async get(cacheKey, input, getOptions = {}) {
      const normalizedKey = normalizeCacheKey(cacheKey)
      const recipe = validateProviderUsageQueryRecipe(input.recipe)
      const fingerprint = providerUsageQueryFingerprint(input.providerBaseUrl, recipe)
      const current = snapshots.get(normalizedKey)
      const observedAt = now()
      if (
        getOptions.forceRefresh !== true
        && current?.fingerprint === fingerprint
        && current.snapshot.expiresAt > observedAt
      ) return current.snapshot

      const inFlight = pending.get(normalizedKey)
      if (inFlight && getOptions.forceRefresh !== true) return inFlight
      const generation = (generations.get(normalizedKey) ?? 0) + 1
      generations.set(normalizedKey, generation)
      const request = executor.query({ ...input, recipe }).then((result) => {
        const fetchedAt = now()
        const snapshot = { ...result, fetchedAt, expiresAt: fetchedAt + ttlMs }
        if (generations.get(normalizedKey) === generation) {
          snapshots.set(normalizedKey, { fingerprint, snapshot })
        }
        return snapshot
      }).finally(() => {
        if (pending.get(normalizedKey) === request) pending.delete(normalizedKey)
      })
      pending.set(normalizedKey, request)
      return request
    },
    invalidate(cacheKey) {
      if (cacheKey === undefined) {
        const keys = new Set([
          ...snapshots.keys(),
          ...pending.keys(),
          ...generations.keys(),
        ])
        snapshots.clear()
        pending.clear()
        for (const key of keys) {
          generations.set(key, (generations.get(key) ?? 0) + 1)
        }
        return
      }
      const normalizedKey = normalizeCacheKey(cacheKey)
      snapshots.delete(normalizedKey)
      pending.delete(normalizedKey)
      generations.set(normalizedKey, (generations.get(normalizedKey) ?? 0) + 1)
    },
  }
}

export function validateProviderUsageQueryRecipe(
  recipe: ProviderUsageQueryRecipe,
): ProviderUsageQueryRecipe {
  assertPlainDataRecord(recipe, 'recipe')
  if (recipe.schema !== PROVIDER_USAGE_QUERY_RECIPE_SCHEMA) {
    throw recipeError('invalid_recipe', 'Unsupported provider usage query recipe schema')
  }
  if (recipe.method !== 'GET' && recipe.method !== 'POST') {
    throw recipeError('invalid_recipe', 'Provider usage query method must be GET or POST')
  }
  if (typeof recipe.path !== 'string' || !recipe.path.trim() || recipe.path.length > 1_024) {
    throw recipeError('invalid_recipe', 'Provider usage query path is invalid')
  }
  if (recipe.method === 'GET' && recipe.body !== undefined) {
    throw recipeError('invalid_recipe', 'GET provider usage recipes cannot include a body')
  }
  if (recipe.headers !== undefined) validateRecipeHeaders(recipe.headers)
  if (recipe.credentialRef !== undefined && !isCredentialReference(recipe.credentialRef)) {
    throw recipeError('invalid_recipe', 'Provider usage credential reference is invalid')
  }
  if (recipe.body !== undefined) validateStaticJson(recipe.body, MAX_STATIC_BODY_DEPTH, MAX_STATIC_BODY_NODES, 'invalid_recipe', true)
  assertPlainDataRecord(recipe.extract, 'extract')
  const extraction = recipe.extract as ProviderUsageQueryExtraction
  const pointerFields: readonly (string | readonly string[] | undefined)[] = [
    extraction.remaining,
    extraction.limit,
    extraction.used,
    extraction.resetAt,
    extraction.unit,
    extraction.isValid,
  ]
  const pointerCandidates = pointerFields.flatMap(
    (value) => value === undefined ? [] : typeof value === 'string' ? [value] : [...value],
  )
  if (!pointerCandidates.length) throw recipeError('invalid_recipe', 'Provider usage recipe must extract at least one quota field')
  pointerCandidates.forEach(validateJsonPointer)
  boundedInteger(recipe.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 15_000)
  boundedInteger(recipe.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 1, DEFAULT_MAX_RESPONSE_BYTES)
  boundedInteger(recipe.maxJsonDepth, DEFAULT_MAX_JSON_DEPTH, 1, DEFAULT_MAX_JSON_DEPTH)
  boundedInteger(recipe.maxJsonNodes, DEFAULT_MAX_JSON_NODES, 1, DEFAULT_MAX_JSON_NODES)
  return recipe
}

/**
 * Normalizes persisted provider metadata. Invalid or legacy-shaped input fails
 * closed to a disabled custom query without affecting built-in usage discovery.
 */
export function normalizeProviderUsageQueryConfiguration(
  input: unknown,
): ProviderUsageQueryConfiguration {
  if (
    !isPlainRecord(input)
    || input.schema !== PROVIDER_USAGE_QUERY_CONFIGURATION_SCHEMA
    || !Array.isArray(input.recipes)
    || input.recipes.length > PROVIDER_USAGE_QUERY_CONFIGURATION_MAX_RECIPES
  ) return disabledProviderUsageQueryConfiguration()

  try {
    const recipes = input.recipes.map((recipe) => canonicalCustomUsageQueryRecipe(recipe))
    return {
      schema: PROVIDER_USAGE_QUERY_CONFIGURATION_SCHEMA,
      enabled: input.enabled === true && recipes.length > 0,
      recipes,
    }
  } catch {
    return disabledProviderUsageQueryConfiguration()
  }
}

/** Keeps absent legacy metadata absent while replacing malformed input safely. */
export function sanitizeProviderUsageQueryConfiguration(
  input: unknown,
): ProviderUsageQueryConfiguration | undefined {
  return input === undefined
    ? undefined
    : normalizeProviderUsageQueryConfiguration(input)
}

/** Parses the safe JSON object-or-array accepted by the provider settings UI. */
export function parseProviderUsageQueryRecipesText(
  text: string,
): readonly ProviderUsageQueryRecipe[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw recipeError('invalid_recipe', 'Provider usage query configuration must be valid JSON')
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed]
  if (!entries.length || entries.length > PROVIDER_USAGE_QUERY_CONFIGURATION_MAX_RECIPES) {
    throw recipeError(
      'invalid_recipe',
      `Provider usage query configuration must contain 1-${PROVIDER_USAGE_QUERY_CONFIGURATION_MAX_RECIPES} recipes`,
    )
  }
  return entries.map((recipe) => canonicalCustomUsageQueryRecipe(recipe))
}

export function createProviderUsageQueryConfiguration(
  enabled: boolean,
  recipes: readonly ProviderUsageQueryRecipe[],
): ProviderUsageQueryConfiguration {
  if (recipes.length > PROVIDER_USAGE_QUERY_CONFIGURATION_MAX_RECIPES) {
    throw recipeError('invalid_recipe', 'Provider usage query configuration contains too many recipes')
  }
  const normalizedRecipes = recipes.map((recipe) => canonicalCustomUsageQueryRecipe(recipe))
  if (enabled && !normalizedRecipes.length) {
    throw recipeError('invalid_recipe', 'An enabled provider usage query requires at least one recipe')
  }
  return {
    schema: PROVIDER_USAGE_QUERY_CONFIGURATION_SCHEMA,
    enabled,
    recipes: normalizedRecipes,
  }
}

export function providerUsageQueryConfigurationFingerprint(input: unknown): string {
  const normalized = normalizeProviderUsageQueryConfiguration(input)
  const serialized = JSON.stringify(normalized)
  let hash = 2_166_136_261
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `${normalized.enabled ? '1' : '0'}:${normalized.recipes.length}:${(hash >>> 0).toString(36)}`
}

function disabledProviderUsageQueryConfiguration(): ProviderUsageQueryConfiguration {
  return {
    schema: PROVIDER_USAGE_QUERY_CONFIGURATION_SCHEMA,
    enabled: false,
    recipes: [],
  }
}

function canonicalCustomUsageQueryRecipe(input: unknown): ProviderUsageQueryRecipe {
  const recipe = validateProviderUsageQueryRecipe(input as ProviderUsageQueryRecipe)
  if (/^[a-z][a-z\d+.-]*:/i.test(recipe.path.trim()) || recipe.credentialRef !== undefined) {
    throw recipeError('cross_origin', 'Custom provider usage queries must use a relative provider path')
  }
  return {
    schema: PROVIDER_USAGE_QUERY_RECIPE_SCHEMA,
    method: recipe.method,
    path: recipe.path.trim(),
    ...(recipe.headers === undefined ? {} : { headers: { ...recipe.headers } }),
    ...(recipe.body === undefined ? {} : { body: cloneUsageRecipeJsonValue(recipe.body) }),
    extract: cloneUsageQueryExtraction(recipe.extract),
    ...(recipe.timeoutMs === undefined ? {} : { timeoutMs: recipe.timeoutMs }),
    ...(recipe.maxResponseBytes === undefined ? {} : { maxResponseBytes: recipe.maxResponseBytes }),
    ...(recipe.maxJsonDepth === undefined ? {} : { maxJsonDepth: recipe.maxJsonDepth }),
    ...(recipe.maxJsonNodes === undefined ? {} : { maxJsonNodes: recipe.maxJsonNodes }),
  }
}

function cloneUsageQueryExtraction(extract: ProviderUsageQueryExtraction): ProviderUsageQueryExtraction {
  const clonePointer = (value: string | readonly string[] | undefined) =>
    Array.isArray(value) ? [...value] : value
  return {
    ...(extract.remaining === undefined ? {} : { remaining: clonePointer(extract.remaining) }),
    ...(extract.limit === undefined ? {} : { limit: clonePointer(extract.limit) }),
    ...(extract.used === undefined ? {} : { used: clonePointer(extract.used) }),
    ...(extract.resetAt === undefined ? {} : { resetAt: clonePointer(extract.resetAt) }),
    ...(extract.unit === undefined ? {} : { unit: clonePointer(extract.unit) }),
    ...(extract.isValid === undefined ? {} : { isValid: clonePointer(extract.isValid) }),
  }
}

function cloneUsageRecipeJsonValue(value: ProviderUsageRecipeJsonValue): ProviderUsageRecipeJsonValue {
  if (Array.isArray(value)) return value.map(cloneUsageRecipeJsonValue)
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneUsageRecipeJsonValue(entry as ProviderUsageRecipeJsonValue)]),
    )
  }
  return value
}

export function resolveProviderUsageEndpoint(
  providerBaseUrl: string,
  path: string,
  credentialRef?: string,
  credentials: readonly ProviderUsageQueryCredential[] = [],
): string {
  const { base, endpoint } = parseProviderUsageUrls(providerBaseUrl, path)
  rejectSecretQueryLiterals(endpoint)
  if (endpoint.origin === base.origin) return endpoint.toString()
  if (!credentialRef) {
    throw recipeError('cross_origin', 'Provider credentials cannot be sent to another origin')
  }
  const credential = uniqueCredential(credentials, credentialRef)
  if (!credential || parseCredentialOrigin(credential.origin) !== endpoint.origin) {
    throw recipeError('credential_unavailable', 'No credential is bound to the provider usage endpoint origin')
  }
  return endpoint.toString()
}

export function resolveSameOriginUsageEndpoint(providerBaseUrl: string, path: string): string {
  const { base, endpoint } = parseProviderUsageUrls(providerBaseUrl, path)
  if (endpoint.origin !== base.origin) {
    throw recipeError('cross_origin', 'Provider usage recipe must remain on the provider origin')
  }
  rejectSecretQueryLiterals(endpoint)
  return endpoint.toString()
}

export function extractProviderUsageJsonPointer(value: unknown, pointer: string): unknown {
  validateJsonPointer(pointer)
  if (!pointer) return value
  let current = value
  for (const encodedSegment of pointer.slice(1).split('/')) {
    const segment = encodedSegment.replace(/~1/g, '/').replace(/~0/g, '~')
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined
      current = current[Number(segment)]
      continue
    }
    if (!isPlainRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

function buildProviderUsageQueryHeaders(
  authenticationHeaders: Readonly<Record<string, string>> | undefined,
  recipeHeaders: Readonly<Record<string, string>> | undefined,
  method: 'GET' | 'POST',
  provider: AIProvider | undefined,
): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  for (const [name, value] of Object.entries(authenticationHeaders ?? {})) {
    if (!isSafeTransportHeader(name) || !isSafeHeaderValue(value)) continue
    headers[name] = value
  }
  for (const [name, value] of Object.entries(recipeHeaders ?? {})) {
    if (!isSafeRecipeHeader(name)) {
      throw recipeError('unsafe_header', `Provider usage recipe header is not allowed: ${name}`)
    }
    if (!isSafeHeaderValue(value)) {
      throw recipeError('unsafe_header', `Provider usage recipe header value is invalid: ${name}`)
    }
    headers[name] = value
  }
  if (method === 'POST') headers['Content-Type'] = 'application/json'
  return provider
    ? applyProviderClientSimulationHeaders(headers, { provider })
    : headers
}

async function readBoundedUsageResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw recipeError('response_too_large', 'Provider usage response exceeds the byte limit')
  }
  const reader = response.body?.getReader?.()
  if (!reader) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw recipeError('response_too_large', 'Provider usage response exceeds the byte limit')
    }
    return text
  }
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      throwIfUsageQueryAborted(signal)
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw recipeError('response_too_large', 'Provider usage response exceeds the byte limit')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function parseBoundedUsageJson(text: string, maxDepth: number, maxNodes: number): unknown {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw recipeError('invalid_json', 'Provider usage response is not valid JSON')
  }
  validateStaticJson(value as ProviderUsageRecipeJsonValue, maxDepth, maxNodes, 'json_limit_exceeded', false)
  return value
}

function extractOptionalUsageNumber(
  value: unknown,
  pointer: string | readonly string[] | undefined,
  field: string,
): number | undefined {
  if (pointer === undefined) return undefined
  let found = false
  for (const candidatePointer of providerUsagePointerList(pointer)) {
    const extracted = extractProviderUsageJsonPointer(value, candidatePointer)
    if (extracted === undefined || extracted === null) continue
    found = true
    const numeric = typeof extracted === 'number'
      ? extracted
      : typeof extracted === 'string' && extracted.trim() !== ''
        ? Number(extracted)
        : Number.NaN
    if (Number.isFinite(numeric) && numeric >= 0) return numeric
  }
  if (!found) return undefined
  throw recipeError('extracted_value_invalid', `Provider usage ${field} value is invalid`)
}

function extractOptionalUsageReset(value: unknown, pointer: string | readonly string[] | undefined): string | number | undefined {
  if (pointer === undefined) return undefined
  for (const candidatePointer of providerUsagePointerList(pointer)) {
    const extracted = extractProviderUsageJsonPointer(value, candidatePointer)
    if (extracted === undefined || extracted === null) continue
    if (typeof extracted === 'number' && Number.isFinite(extracted)) return extracted
    if (typeof extracted === 'string' && extracted.trim() && extracted.length <= 256) return extracted
  }
  return undefined
}

function extractOptionalUsageText(
  value: unknown,
  pointer: string | readonly string[] | undefined,
): string | undefined {
  if (pointer === undefined) return undefined
  for (const candidatePointer of providerUsagePointerList(pointer)) {
    const extracted = extractProviderUsageJsonPointer(value, candidatePointer)
    if (extracted === undefined || extracted === null) continue
    if (typeof extracted !== 'string' || extracted.trim().length > 32) continue
    const normalized = extracted.trim()
    if (normalized) return normalized
  }
  return undefined
}

function extractOptionalUsageBoolean(
  value: unknown,
  pointer: string | readonly string[] | undefined,
): boolean | undefined {
  if (pointer === undefined) return undefined
  for (const candidatePointer of providerUsagePointerList(pointer)) {
    const extracted = extractProviderUsageJsonPointer(value, candidatePointer)
    if (extracted === undefined || extracted === null) continue
    if (typeof extracted === 'boolean') return extracted
    if (typeof extracted === 'string' && /^(?:true|false)$/i.test(extracted.trim())) {
      return extracted.trim().toLowerCase() === 'true'
    }
  }
  return undefined
}

function providerUsagePointerList(pointer: string | readonly string[]): readonly string[] {
  return typeof pointer === 'string' ? [pointer] : pointer
}

function stringifyStaticJson(value: ProviderUsageRecipeJsonValue): string {
  validateStaticJson(value, MAX_STATIC_BODY_DEPTH, MAX_STATIC_BODY_NODES, 'invalid_recipe', true)
  const text = JSON.stringify(value)
  if (new TextEncoder().encode(text).byteLength > MAX_STATIC_BODY_BYTES) {
    throw recipeError('request_too_large', 'Provider usage request body exceeds the byte limit')
  }
  return text
}

function validateStaticJson(
  value: ProviderUsageRecipeJsonValue,
  maxDepth: number,
  maxNodes: number,
  limitCode: ProviderUsageQueryRecipeErrorCode = 'invalid_recipe',
  rejectSecretLiterals = false,
): void {
  let nodes = 0
  const visit = (current: unknown, depth: number): void => {
    nodes += 1
    if (nodes > maxNodes || depth > maxDepth) {
      throw recipeError(limitCode, 'Provider usage JSON exceeds structural limits')
    }
    if (current === null || typeof current === 'boolean') return
    if (typeof current === 'string') {
      if (rejectSecretLiterals && looksLikeSecretLiteral(current)) {
        throw recipeError('secret_literal', 'Provider usage recipes cannot contain secret literals')
      }
      return
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw recipeError('invalid_recipe', 'Provider usage JSON contains a non-finite number')
      return
    }
    if (Array.isArray(current)) {
      current.forEach((item) => visit(item, depth + 1))
      return
    }
    assertPlainDataRecord(current, 'JSON value')
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(current))) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) {
        throw recipeError('invalid_recipe', 'Provider usage JSON contains an unsafe key')
      }
      if (rejectSecretLiterals && isSensitiveCredentialName(key)) {
        throw recipeError('secret_literal', 'Provider usage recipes cannot contain credential fields')
      }
      if (!('value' in descriptor)) throw recipeError('invalid_recipe', 'Provider usage JSON cannot contain accessors')
      visit(descriptor.value, depth + 1)
    }
  }
  visit(value, 0)
}

function validateRecipeHeaders(headers: Readonly<Record<string, string>>): void {
  assertPlainDataRecord(headers, 'headers')
  if (Object.keys(headers).length > 8) throw recipeError('invalid_recipe', 'Provider usage recipe has too many headers')
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(headers))) {
    if (!('value' in descriptor) || typeof descriptor.value !== 'string') {
      throw recipeError('unsafe_header', `Provider usage recipe header is invalid: ${name}`)
    }
    if (!isSafeRecipeHeader(name) || !isSafeHeaderValue(descriptor.value)) {
      throw recipeError('unsafe_header', `Provider usage recipe header is not allowed: ${name}`)
    }
    if (looksLikeSecretLiteral(descriptor.value)) {
      throw recipeError('secret_literal', 'Provider usage recipes cannot contain credential header values')
    }
  }
}

function validateJsonPointer(pointer: string): void {
  if (typeof pointer !== 'string' || pointer.length > 512 || (pointer && !pointer.startsWith('/'))) {
    throw recipeError('json_pointer_invalid', 'Provider usage JSON Pointer is invalid')
  }
  if (/(?:~(?![01]))/.test(pointer) || (pointer && pointer.split('/').length > 17)) {
    throw recipeError('json_pointer_invalid', 'Provider usage JSON Pointer is invalid')
  }
}

function assertPlainDataRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) throw recipeError('invalid_recipe', `Provider usage ${label} must be plain data`)
  const descriptors = Object.values(Object.getOwnPropertyDescriptors(value))
  if (descriptors.some((descriptor) => !('value' in descriptor) || typeof descriptor.value === 'function')) {
    throw recipeError('invalid_recipe', `Provider usage ${label} cannot contain executable values`)
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isSafeRecipeHeader(name: string): boolean {
  return /^(accept|content-type)$/i.test(name)
}

function isSafeTransportHeader(name: string): boolean {
  return /^(accept|content-type|authorization|api-key|x-api-key|x-goog-api-key|anthropic-version|x-github-api-version|user-agent|x-grok-client-version|x-grok-client-identifier|x-xai-token-auth)$/i.test(name)
}

function resolveProviderUsageCredentialHeaders(
  providerBaseUrl: string,
  endpoint: string,
  credentialRef: string | undefined,
  providerHeaders: Readonly<Record<string, string>> | undefined,
  credentials: readonly ProviderUsageQueryCredential[] | undefined,
): Readonly<Record<string, string>> | undefined {
  const providerOrigin = parseProviderUsageUrls(providerBaseUrl, providerBaseUrl).base.origin
  const endpointOrigin = new URL(endpoint).origin
  if (!credentialRef) {
    if (providerOrigin !== endpointOrigin) {
      throw recipeError('cross_origin', 'Provider credentials cannot be sent to another origin')
    }
    validateCredentialHeaders(providerHeaders)
    return providerHeaders
  }
  const credential = uniqueCredential(credentials ?? [], credentialRef)
  if (!credential || parseCredentialOrigin(credential.origin) !== endpointOrigin) {
    throw recipeError('credential_unavailable', 'No credential is bound to the provider usage endpoint origin')
  }
  validateCredentialHeaders(credential.headers)
  return credential.headers
}

function parseProviderUsageUrls(providerBaseUrl: string, path: string): { base: URL; endpoint: URL } {
  let base: URL
  let endpoint: URL
  try {
    base = new URL(providerBaseUrl)
    const resolutionBase = new URL(base.toString())
    if (!resolutionBase.pathname.endsWith('/')) resolutionBase.pathname += '/'
    endpoint = new URL(path, resolutionBase)
  } catch {
    throw recipeError('invalid_recipe', 'Provider usage recipe URL is invalid')
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw recipeError('invalid_recipe', 'Provider base URL is not an admissible HTTP origin')
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) {
    throw recipeError('invalid_recipe', 'Provider usage recipe endpoint is not admissible')
  }
  return { base, endpoint }
}

function parseCredentialOrigin(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return undefined
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) return undefined
    return parsed.origin
  } catch {
    return undefined
  }
}

function uniqueCredential(
  credentials: readonly ProviderUsageQueryCredential[],
  credentialRef: string,
): ProviderUsageQueryCredential | undefined {
  const matches = credentials.filter((credential) => credential.id === credentialRef)
  return matches.length === 1 ? matches[0] : undefined
}

function validateCredentialHeaders(headers: Readonly<Record<string, string>> | undefined): void {
  if (headers === undefined) return
  assertPlainDataRecord(headers, 'credential headers')
  if (Object.keys(headers).length > 8) {
    throw recipeError('unsafe_header', 'Provider usage credential has too many headers')
  }
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(headers))) {
    if (!('value' in descriptor) || typeof descriptor.value !== 'string' ||
      !isSafeTransportHeader(name) || !isSafeHeaderValue(descriptor.value)) {
      throw recipeError('unsafe_header', 'Provider usage credential headers are invalid')
    }
  }
}

function rejectSecretQueryLiterals(endpoint: URL): void {
  for (const [name, value] of endpoint.searchParams) {
    if (isSensitiveCredentialName(name) || looksLikeSecretLiteral(value)) {
      throw recipeError('secret_literal', 'Provider usage recipe URLs cannot contain credential literals')
    }
  }
}

function isSensitiveCredentialName(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/gu, '')
  return [
    'apikey',
    'key',
    'accesstoken',
    'auth',
    'authorization',
    'credential',
    'password',
    'secret',
    'token',
  ].includes(normalized)
}

function looksLikeSecretLiteral(value: string): boolean {
  return /\bBearer\s+\S+|\b(?:sk|key|token)[-_][A-Za-z0-9._-]{8,}\b/iu.test(value)
}

function isCredentialReference(value: string): boolean {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/u.test(value)
}

function normalizeCacheKey(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || /[\r\n\0]/u.test(value)) {
    throw recipeError('invalid_recipe', 'Provider usage cache key is invalid')
  }
  return value
}

function providerUsageQueryFingerprint(
  providerBaseUrl: string,
  recipe: ProviderUsageQueryRecipe,
): string {
  const base = parseProviderUsageUrls(providerBaseUrl, providerBaseUrl).base
  return JSON.stringify([base.origin, base.pathname, recipe])
}

function boundedCacheTtl(value: number | undefined): number {
  if (value === undefined) return PROVIDER_USAGE_QUERY_CACHE_TTL_MS
  if (!Number.isSafeInteger(value) || value < 1_000 || value > PROVIDER_USAGE_QUERY_CACHE_TTL_MS) {
    throw recipeError('invalid_recipe', 'Provider usage cache TTL is invalid')
  }
  return value
}

function isSafeHeaderValue(value: string): boolean {
  return typeof value === 'string' && value.length <= 1_024 && !/[\r\n\0]/.test(value)
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw recipeError('invalid_recipe', 'Provider usage recipe limit is out of bounds')
  }
  return value
}

function throwIfUsageQueryAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  const error = new Error('Provider usage query was cancelled')
  error.name = 'AbortError'
  throw error
}

function recipeError(code: ProviderUsageQueryRecipeErrorCode, message: string): ProviderUsageQueryRecipeError {
  return new ProviderUsageQueryRecipeError(code, message)
}
