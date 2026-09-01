import type { ProviderHealthFailureKind, ProviderHealthRecord } from './providerHealth'

export const PROVIDER_HEALTH_CHECK_POLICY_SCHEMA = 'islemind.provider-health-check-policy.v1' as const

export type ProviderHealthCheckErrorKind = ProviderHealthFailureKind

export type ProviderHealthCheckEvidenceSource = 'explicit' | 'status' | 'error_code' | 'message' | 'unknown'

export interface ProviderHealthCheckErrorInput {
  status?: number
  errorName?: string
  errorCode?: string
  errorMessage?: string
  connectionTimedOut?: boolean
  requestTimedOut?: boolean
  timedOut?: boolean
  networkError?: boolean
}

export interface ProviderHealthCheckClassification {
  kind: ProviderHealthCheckErrorKind
  retryable: boolean
  failoverEligible: boolean
  source: ProviderHealthCheckEvidenceSource
  reason: string
  status?: number
  errorCode?: string
}

export type ProviderProjectedHealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'recovering'

export interface ProviderHealthProjectionInput {
  record?: Pick<
    ProviderHealthRecord,
    'status' | 'consecutiveFailures' | 'lastFailureAtMs' | 'lastSuccessAtMs' | 'circuitOpenUntilMs' | 'cooldownUntilMs'
  >
  nowMs?: number
  recoveryThreshold?: number
}

const RETRYABLE_KINDS = new Set<ProviderHealthCheckErrorKind>([
  'network_error',
  'dns_error',
  'connection_timeout',
  'request_timeout',
  'rate_limit',
  'server_error',
  'provider_unavailable',
])

const FAILOVER_KINDS = new Set<ProviderHealthCheckErrorKind>([
  'network_error',
  'dns_error',
  'tls_error',
  'connection_timeout',
  'request_timeout',
  'rate_limit',
  'server_error',
  'provider_unavailable',
])

export function classifyProviderHealthCheckError(
  input: ProviderHealthCheckErrorInput,
): ProviderHealthCheckClassification {
  const status = finiteStatus(input.status)
  const errorCode = normalize(input.errorCode)
  const message = normalize(`${input.errorName ?? ''} ${input.errorMessage ?? ''}`)

  if (input.connectionTimedOut) return classification('connection_timeout', 'explicit', input, 'Connection establishment exceeded the configured timeout.')
  if (input.requestTimedOut || input.timedOut) return classification('request_timeout', 'explicit', input, 'The provider request exceeded the configured timeout.')
  if (input.networkError) return classification('network_error', 'explicit', input, 'The network adapter reported a transient transport failure.')

  const codeKind = classifyErrorCode(errorCode, message)
  if (codeKind) return classification(codeKind, 'error_code', input, reasonForKind(codeKind))

  // Error payloads often carry a more specific cause than the transport
  // status (for example model_not_found wrapped in a 503 relay response).
  // Use that evidence before falling back to the generic status category.
  const messageKind = classifyErrorMessage(message)
  if (messageKind) return classification(messageKind, 'message', input, reasonForKind(messageKind))

  const statusKind = classifyStatus(status, message)
  if (statusKind) return classification(statusKind, 'status', input, reasonForKind(statusKind))

  return classification('unknown', 'unknown', input, 'The provider failure did not include enough evidence for a safe classification.')
}

export function isProviderHealthCheckRetryable(
  input: ProviderHealthCheckErrorInput | ProviderHealthCheckClassification,
): boolean {
  return 'kind' in input ? input.retryable : classifyProviderHealthCheckError(input).retryable
}

export function isProviderHealthCheckFailoverEligible(
  input: ProviderHealthCheckErrorInput | ProviderHealthCheckClassification,
): boolean {
  return 'kind' in input ? input.failoverEligible : classifyProviderHealthCheckError(input).failoverEligible
}

export function projectProviderHealthStatus(
  input: ProviderHealthProjectionInput,
): ProviderProjectedHealthStatus {
  const record = input.record
  if (!record) return 'degraded'
  const nowMs = input.nowMs ?? Date.now()
  const recoveryThreshold = Math.max(1, Math.floor(input.recoveryThreshold ?? 2))
  const circuitOpen = typeof record.circuitOpenUntilMs === 'number' && record.circuitOpenUntilMs > nowMs
  if (circuitOpen || record.status === 'circuit-open') {
    if (record.lastSuccessAtMs !== undefined && record.lastSuccessAtMs > (record.lastFailureAtMs ?? -Infinity)) return 'recovering'
    return 'unavailable'
  }
  const cooldown = typeof record.cooldownUntilMs === 'number' && record.cooldownUntilMs > nowMs
  if (cooldown && record.status !== 'healthy') return 'degraded'
  if (record.status === 'healthy' && record.consecutiveFailures < 1) return 'healthy'
  if (record.lastSuccessAtMs !== undefined && record.lastSuccessAtMs > (record.lastFailureAtMs ?? -Infinity)) {
    return record.consecutiveFailures < recoveryThreshold ? 'recovering' : 'healthy'
  }
  if (record.status === 'degraded' || record.status === 'cooldown') return 'degraded'
  return 'degraded'
}

function classification(
  kind: ProviderHealthCheckErrorKind,
  source: ProviderHealthCheckEvidenceSource,
  input: ProviderHealthCheckErrorInput,
  reason: string,
): ProviderHealthCheckClassification {
  return {
    kind,
    retryable: RETRYABLE_KINDS.has(kind),
    failoverEligible: FAILOVER_KINDS.has(kind),
    source,
    reason,
    ...(finiteStatus(input.status) !== undefined ? { status: finiteStatus(input.status) } : {}),
    ...(typeof input.errorCode === 'string' && input.errorCode.trim() ? { errorCode: input.errorCode.trim() } : {}),
  }
}

function classifyErrorCode(code: string, message: string): ProviderHealthCheckErrorKind | undefined {
  if (!code) return undefined
  if (/enotfound|eai_again|dns|name_not_resolved/.test(code)) return 'dns_error'
  if (/cert|tls|ssl|x509|handshake/.test(code)) return 'tls_error'
  if (/econnrefused|econnreset|epipe|network|socket/.test(code)) return 'network_error'
  if (/timeout|etimedout|abort/.test(code)) return message.includes('connect') ? 'connection_timeout' : 'request_timeout'
  if (/unauthori[sz]ed|forbidden|invalid[_ -]?api[_ -]?key|authentication|credential/.test(code)) return 'auth_error'
  if (/invalid[_ -]?(endpoint|url)|bad[_ -]?base[_ -]?url/.test(code)) return 'invalid_endpoint'
  if (/model.*(not[_ -]?found|unavailable)|not[_ -]?found/.test(code)) return 'model_not_found'
  return undefined
}

function classifyStatus(status: number | undefined, message: string): ProviderHealthCheckErrorKind | undefined {
  if (status === undefined) return undefined
  if (status === 408) return 'request_timeout'
  if (status === 401 || status === 403) return 'auth_error'
  if (status === 404 || status === 410) return message.includes('endpoint') || message.includes('url') ? 'invalid_endpoint' : 'model_not_found'
  if (status === 429) return 'rate_limit'
  if (status >= 500 && status <= 599) return status === 502 || status === 503 || status === 504 ? 'provider_unavailable' : 'server_error'
  if (status >= 400 && status <= 499) return 'client_error'
  return undefined
}

function classifyErrorMessage(message: string): ProviderHealthCheckErrorKind | undefined {
  if (!message) return undefined
  if (/dns|name[_ -]?not[_ -]?resolved|enotfound|eai_again/.test(message)) return 'dns_error'
  if (/tls|ssl|certificate|x509|handshake/.test(message)) return 'tls_error'
  if (/connect(?:ion)?[_ -]?(?:timeout|timed out)|econnrefused/.test(message)) return 'connection_timeout'
  if (/request[_ -]?(?:timeout|timed out)|timed out|aborterror/.test(message)) return 'request_timeout'
  if (/invalid[_ -]?(?:api[_ -]?key|token)|unauthori[sz]ed|forbidden|authentication/.test(message)) return 'auth_error'
  if (/invalid[_ -]?(?:api[_ -]?endpoint|base[_ -]?url|endpoint|url)|bad[_ -]?url|failed to (?:parse|construct).+url/.test(message)) return 'invalid_endpoint'
  if (/model.+(?:not[_ -]?found|does not exist|unavailable)/.test(message)) return 'model_not_found'
  if (/rate[_ -]?limit|too many requests|quota/.test(message)) return 'rate_limit'
  if (/provider.+(?:unavailable|down|offline)|service unavailable/.test(message)) return 'provider_unavailable'
  if (/network|fetch failed|socket/.test(message)) return 'network_error'
  return undefined
}

function reasonForKind(kind: ProviderHealthCheckErrorKind): string {
  switch (kind) {
    case 'auth_error': return 'Authentication or authorization evidence is present; do not retry blindly.'
    case 'invalid_endpoint': return 'The configured endpoint is invalid; configuration must be corrected before retrying.'
    case 'model_not_found': return 'The selected model was not found; choose a model that the provider exposes.'
    case 'rate_limit': return 'The provider applied a rate limit or quota response; respect retry-after/cooldown evidence.'
    case 'provider_unavailable': return 'The provider reported a temporary unavailable service condition.'
    case 'server_error': return 'The provider returned a transient 5xx response.'
    case 'connection_timeout': return 'The connection could not be established within the configured timeout.'
    case 'request_timeout': return 'The request did not complete within the configured timeout.'
    case 'dns_error': return 'DNS resolution failed or the host could not be resolved.'
    case 'tls_error': return 'TLS certificate or handshake validation failed.'
    case 'network_error': return 'A transient network transport error interrupted the request.'
    case 'client_error': return 'The provider rejected the request as a client-side error.'
    default: return 'The provider failure could not be classified safely.'
  }
}

function finiteStatus(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}
