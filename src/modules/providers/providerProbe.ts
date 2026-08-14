import type { AIModel, AIProvider } from '@/types/providerContracts'
import { ProviderHttpError } from './providerOperationResult'

export const PROVIDER_PROBE_EVIDENCE_SCHEMA = 'islemind.provider-probe-evidence.v1' as const

export type ProviderProbeClassification =
  | 'reachable'
  | 'credential_required'
  | 'authentication_failed'
  | 'model_unavailable'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'http_error'
  | 'network_error'
  | 'timed_out'
  | 'cancelled'
  | 'unsupported_route'
  | 'invalid_configuration'
  | 'malformed_response'

export type ProviderProbeAuthentication = 'authenticated' | 'credentialless_local'
export type ProviderProbeReachability = 'reachable' | 'unreachable' | 'unknown'
export type ProviderProbeCredentialState = 'valid' | 'rejected' | 'missing' | 'not-required' | 'unknown'
export type ProviderProbeModelAccess = 'available' | 'unavailable' | 'unknown'
export type ProviderProbeQuotaState = 'available' | 'limited' | 'exhausted' | 'unknown'
export type ProviderProbeReadiness = 'ready' | 'partial' | 'blocked'

export interface ProviderProbeIssue {
  code: 'bad_base_url' | 'credential_mismatch'
  message: string
}

export interface ProviderProbeUnsupportedIssue {
  message: string
}

export interface ProviderProbeEvidence {
  schema: typeof PROVIDER_PROBE_EVIDENCE_SCHEMA
  providerId: string
  requestedModel: string
  upstreamModel: string
  classification: ProviderProbeClassification
  authentication: ProviderProbeAuthentication
  reachability: ProviderProbeReachability
  credentialState: ProviderProbeCredentialState
  modelAccess: ProviderProbeModelAccess
  quotaState: ProviderProbeQuotaState
  durationMs: number
  modelDiscovered: boolean
  discoveredModelCount?: number
  httpStatus?: number
  retryAfterMs?: number
  redactedReason?: string
}

export interface ProviderProbeResult {
  ok: boolean
  readiness: ProviderProbeReadiness
  reachability: ProviderProbeReachability
  credentialState: ProviderProbeCredentialState
  modelAccess: ProviderProbeModelAccess
  quotaState: ProviderProbeQuotaState
  durationMs: number
  httpStatus?: number
  retryAfterMs?: number
  redactedReason?: string
  evidence: ProviderProbeEvidence
}

export interface ProviderProbeRequest {
  provider: AIProvider
  model: string
  requestedModel?: string
  apiKey?: string
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ProviderProbeDependencies {
  defaultTimeoutMs: number
  resolveUpstreamModel(provider: AIProvider, model: string): string
  configurationIssue(provider: AIProvider, apiKey: string): ProviderProbeIssue | undefined
  hostedIssue(provider: AIProvider): ProviderProbeUnsupportedIssue | undefined
  supportsModelDiscovery(provider: AIProvider): boolean
  discoverModels(provider: AIProvider, timeoutMs: number, signal?: AbortSignal): Promise<AIModel[]>
}

export interface ProviderProbePort {
  probe(request: ProviderProbeRequest): Promise<ProviderProbeResult>
}

/**
 * Performs a non-generating reachability/auth/model probe through the provider's
 * authenticated model-discovery route.
 */
export function createProviderProbe(dependencies: ProviderProbeDependencies): ProviderProbePort {
  return {
    async probe(request) {
      const startedAt = Date.now()
      const requestedModel = (request.requestedModel ?? request.model).trim()
      const upstreamModel = dependencies.resolveUpstreamModel(request.provider, request.model).trim()
      const apiKey = (request.apiKey ?? request.provider.apiKey).trim()
      const credentiallessLocal = isCredentiallessLocalProvider(request.provider)
      const authentication: ProviderProbeAuthentication = credentiallessLocal && !apiKey
        ? 'credentialless_local'
        : 'authenticated'
      const baseEvidence = {
        schema: PROVIDER_PROBE_EVIDENCE_SCHEMA,
        providerId: request.provider.id,
        requestedModel,
        upstreamModel,
        authentication,
      } satisfies Omit<
        ProviderProbeEvidence,
        | 'classification'
        | 'reachability'
        | 'credentialState'
        | 'modelAccess'
        | 'quotaState'
        | 'durationMs'
        | 'modelDiscovered'
      >

      throwIfProviderProbeAborted(request.signal)
      if (!apiKey && !credentiallessLocal) {
        return result(baseEvidence, 'credential_required', false, startedAt)
      }
      if (!upstreamModel) {
        return result(baseEvidence, 'model_unavailable', false, startedAt, {
          states: {
            reachability: 'unknown',
            credentialState: 'unknown',
            modelAccess: 'unavailable',
            quotaState: 'unknown',
          },
        })
      }

      const configuredProvider = { ...request.provider, apiKey }
      const configurationIssue = dependencies.configurationIssue(configuredProvider, apiKey)
      if (configurationIssue) {
        return result(baseEvidence, 'invalid_configuration', false, startedAt, {
          redactedReason: redactProviderProbeReason(configurationIssue.message, apiKey),
        })
      }
      const hostedIssue = dependencies.hostedIssue(configuredProvider)
      if (hostedIssue) {
        return result(baseEvidence, 'unsupported_route', false, startedAt, {
          redactedReason: redactProviderProbeReason(hostedIssue.message, apiKey),
          states: unknownProviderProbeStates(),
        })
      }
      if (!dependencies.supportsModelDiscovery(configuredProvider)) {
        return result(baseEvidence, 'unsupported_route', false, startedAt, {
          redactedReason: 'No authenticated non-generating probe route is available.',
          states: unknownProviderProbeStates(),
        })
      }

      try {
        const models = await dependencies.discoverModels(
          configuredProvider,
          boundedProbeTimeout(request.timeoutMs, dependencies.defaultTimeoutMs),
          request.signal,
        )
        throwIfProviderProbeAborted(request.signal)
        const modelDiscovered = models.some((model) => providerProbeModelIdsMatch(model.id, upstreamModel))
        return result(
          baseEvidence,
          modelDiscovered ? 'reachable' : 'model_unavailable',
          modelDiscovered,
          startedAt,
          { discoveredModelCount: models.length },
        )
      } catch (error) {
        throwIfProviderProbeAborted(request.signal)
        return classifyProviderProbeFailure(baseEvidence, error, startedAt, apiKey)
      }
    },
  }
}

export function isCredentiallessLocalProvider(
  provider: Pick<AIProvider, 'id' | 'type' | 'name' | 'baseUrl' | 'presetId' | 'detectedPresetId'>,
): boolean {
  const preset = provider.presetId ?? provider.detectedPresetId
  if (preset && ['ollama', 'lm-studio', 'localai', 'vllm', 'sglang'].includes(preset)) return true
  if (provider.type !== 'openai-compatible') return false
  try {
    const hostname = new URL(provider.baseUrl ?? '').hostname.toLowerCase()
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '::1'
      || hostname === '10.0.2.2'
      || hostname.endsWith('.localhost')
  } catch {
    return /\b(ollama|lm[-_ ]?studio|localai|vllm|sglang)\b/i.test(`${provider.id} ${provider.name}`)
  }
}

export function providerProbeModelIdsMatch(discoveredModel: string, requestedModel: string): boolean {
  const normalize = (value: string) => value.trim().replace(/^models\//i, '').replace(/\/+$/, '')
  return normalize(discoveredModel) === normalize(requestedModel)
}

export function parseProviderRetryAfterMs(
  value: string | null | undefined,
  nowMs = Date.now(),
): number | undefined {
  const normalized = value?.trim()
  if (!normalized) return undefined
  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    return boundRetryAfterMs(Math.ceil(Number(normalized) * 1000))
  }
  const timestamp = Date.parse(normalized)
  if (!Number.isFinite(timestamp)) return undefined
  return boundRetryAfterMs(Math.max(0, timestamp - nowMs))
}

function classifyProviderProbeFailure(
  baseEvidence: ProviderProbeBaseEvidence,
  error: unknown,
  startedAt: number,
  apiKey: string,
): ProviderProbeResult {
  if (error instanceof ProviderHttpError) {
    const classification = classifyProviderProbeHttpFailure(error.status, error.responseText)
    return result(baseEvidence, classification, false, startedAt, {
      httpStatus: error.status,
      retryAfterMs: error.retryAfterMs,
      redactedReason: providerProbeHttpReason(classification, error.status),
    })
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return result(baseEvidence, 'timed_out', false, startedAt, {
      redactedReason: 'The provider probe timed out.',
    })
  }
  const reason = error instanceof Error ? redactProviderProbeReason(error.message, apiKey) : undefined
  return result(baseEvidence, 'network_error', false, startedAt, { redactedReason: reason })
}

function classifyProviderProbeHttpFailure(
  status: number,
  responseText: string,
): ProviderProbeClassification {
  const text = responseText.toLowerCase()
  if (status >= 200 && status < 300) return 'malformed_response'
  if (status === 401 || status === 403 || /invalid (?:api )?key|unauthori[sz]ed|authentication failed/.test(text)) {
    return 'authentication_failed'
  }
  if (status === 404 || status === 405) return 'unsupported_route'
  if (
    status === 402
    || /insufficient[_ -]quota|quota (?:is )?(?:exhausted|exceeded)|billing|credit balance|insufficient credits/.test(text)
  ) return 'quota_exhausted'
  if (status === 429) {
    return /insufficient[_ -]quota|quota (?:is )?(?:exhausted|exceeded)|billing|credit balance|insufficient credits/.test(text)
      ? 'quota_exhausted'
      : 'rate_limited'
  }
  if (/rate[_ -]?limit|too many requests/.test(text)) return 'rate_limited'
  return 'http_error'
}

type ProviderProbeBaseEvidence = Omit<
  ProviderProbeEvidence,
  | 'classification'
  | 'reachability'
  | 'credentialState'
  | 'modelAccess'
  | 'quotaState'
  | 'durationMs'
  | 'modelDiscovered'
>

function result(
  baseEvidence: ProviderProbeBaseEvidence,
  classification: ProviderProbeClassification,
  modelDiscovered: boolean,
  startedAt: number,
  optional: Partial<Pick<ProviderProbeEvidence, 'discoveredModelCount' | 'httpStatus' | 'retryAfterMs' | 'redactedReason'>> & {
    states?: Pick<ProviderProbeEvidence, 'reachability' | 'credentialState' | 'modelAccess' | 'quotaState'>
  } = {},
): ProviderProbeResult {
  const states = optional.states ?? providerProbeStates(classification, baseEvidence.authentication)
  const durationMs = Math.max(0, Date.now() - startedAt)
  const evidence: ProviderProbeEvidence = {
    ...baseEvidence,
    classification,
    ...states,
    durationMs,
    modelDiscovered,
    ...(optional.discoveredModelCount === undefined ? {} : { discoveredModelCount: optional.discoveredModelCount }),
    ...(optional.httpStatus === undefined ? {} : { httpStatus: optional.httpStatus }),
    ...(optional.retryAfterMs === undefined ? {} : { retryAfterMs: optional.retryAfterMs }),
    ...(optional.redactedReason ? { redactedReason: optional.redactedReason } : {}),
  }
  const ok = classification === 'reachable'
  return {
    ok,
    readiness: providerProbeReadiness(classification),
    ...states,
    durationMs,
    ...(optional.httpStatus === undefined ? {} : { httpStatus: optional.httpStatus }),
    ...(optional.retryAfterMs === undefined ? {} : { retryAfterMs: optional.retryAfterMs }),
    ...(optional.redactedReason ? { redactedReason: optional.redactedReason } : {}),
    evidence,
  }
}

function providerProbeReadiness(
  classification: ProviderProbeClassification,
): ProviderProbeReadiness {
  switch (classification) {
    case 'reachable':
      return 'ready'
    case 'quota_exhausted':
    case 'rate_limited':
    case 'http_error':
    case 'network_error':
    case 'timed_out':
    case 'unsupported_route':
    case 'malformed_response':
      return 'partial'
    case 'credential_required':
    case 'authentication_failed':
    case 'model_unavailable':
    case 'cancelled':
    case 'invalid_configuration':
      return 'blocked'
  }
}

function boundedProbeTimeout(value: number | undefined, fallback: number): number {
  const candidate = Number.isFinite(value) ? Math.trunc(value!) : Math.trunc(fallback)
  return Math.max(1_000, Math.min(15_000, candidate))
}

function boundRetryAfterMs(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined
  return Math.min(24 * 60 * 60 * 1000, Math.trunc(value))
}

function boundedFailureDetail(value: string): string | undefined {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized ? normalized.slice(0, 512) : undefined
}

function providerProbeStates(
  classification: ProviderProbeClassification,
  authentication: ProviderProbeAuthentication,
): Pick<ProviderProbeEvidence, 'reachability' | 'credentialState' | 'modelAccess' | 'quotaState'> {
  const credentialOnSuccess: ProviderProbeCredentialState = authentication === 'credentialless_local'
    ? 'not-required'
    : 'valid'
  switch (classification) {
    case 'reachable':
      return { reachability: 'reachable', credentialState: credentialOnSuccess, modelAccess: 'available', quotaState: 'unknown' }
    case 'model_unavailable':
      return { reachability: 'reachable', credentialState: credentialOnSuccess, modelAccess: 'unavailable', quotaState: 'unknown' }
    case 'credential_required':
      return { reachability: 'unknown', credentialState: 'missing', modelAccess: 'unknown', quotaState: 'unknown' }
    case 'authentication_failed':
      return { reachability: 'reachable', credentialState: 'rejected', modelAccess: 'unknown', quotaState: 'unknown' }
    case 'quota_exhausted':
      return { reachability: 'reachable', credentialState: 'unknown', modelAccess: 'unknown', quotaState: 'exhausted' }
    case 'rate_limited':
      return { reachability: 'reachable', credentialState: 'unknown', modelAccess: 'unknown', quotaState: 'limited' }
    case 'malformed_response':
    case 'unsupported_route':
    case 'http_error':
      return { reachability: 'reachable', credentialState: 'unknown', modelAccess: 'unknown', quotaState: 'unknown' }
    case 'network_error':
      return { reachability: 'unreachable', credentialState: 'unknown', modelAccess: 'unknown', quotaState: 'unknown' }
    case 'timed_out':
    case 'cancelled':
    case 'invalid_configuration':
      return { reachability: 'unknown', credentialState: 'unknown', modelAccess: 'unknown', quotaState: 'unknown' }
  }
}

function unknownProviderProbeStates(): Pick<
  ProviderProbeEvidence,
  'reachability' | 'credentialState' | 'modelAccess' | 'quotaState'
> {
  return {
    reachability: 'unknown',
    credentialState: 'unknown',
    modelAccess: 'unknown',
    quotaState: 'unknown',
  }
}

function providerProbeHttpReason(classification: ProviderProbeClassification, status: number): string {
  switch (classification) {
    case 'authentication_failed': return 'The provider rejected the configured credential.'
    case 'unsupported_route': return 'The provider does not expose the configured non-generating probe route.'
    case 'quota_exhausted': return 'The provider reported exhausted quota or credit.'
    case 'rate_limited': return 'The provider temporarily rate limited the probe.'
    case 'malformed_response': return 'The provider returned an invalid model catalog response.'
    default: return `The provider probe returned HTTP ${status}.`
  }
}

function redactProviderProbeReason(value: string, apiKey: string): string | undefined {
  let normalized = value
  if (apiKey) normalized = normalized.replaceAll(apiKey, '[redacted]')
  normalized = normalized
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/giu, 'Bearer [redacted]')
    .replace(/\b(?:sk|key|token)[-_][A-Za-z0-9._-]{8,}\b/giu, '[redacted]')
    .replace(/([?&](?:api[_-]?key|key|token|access[_-]?token)=)[^&#\s]+/giu, '$1[redacted]')
    .replace(/https?:\/\/[^\s/?#]+[^\s]*/giu, (url) => {
      try {
        const parsed = new URL(url)
        parsed.username = ''
        parsed.password = ''
        parsed.search = ''
        parsed.hash = ''
        return parsed.toString()
      } catch {
        return '[redacted-url]'
      }
    })
  return boundedFailureDetail(normalized)
}

function throwIfProviderProbeAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  const error = new Error('Provider probe was cancelled')
  error.name = 'AbortError'
  throw error
}
