import { appendRuntimeLog } from '@/services/runtimeLog'
import { runtimeLogOptions, type ProviderRuntimeLogRequestLike } from '@/services/ai/providerRuntimeDiagnostics'
import { clampInteger } from '@/services/ai/providerNumberUtils'

interface ProviderRuntimeRetryRequestLike extends ProviderRuntimeLogRequestLike {
  conversationId?: string
  provider: {
    id: string
  }
  model: string
  requestedModel?: string
  settings?: ProviderRuntimeLogRequestLike['settings'] & {
    upstreamRequestTimeoutMs?: number
    upstreamMaxRetries?: number
    upstreamCircuitBreakerEnabled?: boolean
    upstreamCircuitBreakerFailureThreshold?: number
    upstreamCircuitBreakerCooldownMs?: number
  }
}

interface ProviderRuntimeRetryError extends Error {
  credentialGroupId?: string
}

const PROVIDER_CIRCUIT_STATES = new Map<string, { failures: number; openedUntil?: number }>()

export function providerCircuitKey(req: ProviderRuntimeRetryRequestLike): string {
  return `${req.provider.id}:${req.model}`
}

export function resolveProviderRequestTimeoutMs(req: ProviderRuntimeRetryRequestLike, fallbackMs: number): number {
  return clampInteger(req.settings?.upstreamRequestTimeoutMs, fallbackMs, 5000, 300000)
}

export function resolveProviderMaxRetries(req: ProviderRuntimeRetryRequestLike): number {
  return clampInteger(req.settings?.upstreamMaxRetries, 1, 0, 5)
}

export function assertProviderCircuitClosed(req: ProviderRuntimeRetryRequestLike, key: string): void {
  if (req.settings?.upstreamCircuitBreakerEnabled === false) return
  const state = PROVIDER_CIRCUIT_STATES.get(key)
  if (!state?.openedUntil) return
  if (Date.now() >= state.openedUntil) {
    PROVIDER_CIRCUIT_STATES.delete(key)
    return
  }
  void appendRuntimeLog('circuit.breaker', {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    status: 'open',
    retryAfterMs: Math.max(0, state.openedUntil - Date.now()),
  }, runtimeLogOptions(req))
  throw providerCircuitOpenError()
}

export function recordProviderCircuitSuccess(key: string): void {
  PROVIDER_CIRCUIT_STATES.delete(key)
}

export function recordProviderCircuitFailure(req: ProviderRuntimeRetryRequestLike, key: string): void {
  if (req.settings?.upstreamCircuitBreakerEnabled === false) return
  const threshold = clampInteger(req.settings?.upstreamCircuitBreakerFailureThreshold, 3, 1, 20)
  const cooldownMs = clampInteger(req.settings?.upstreamCircuitBreakerCooldownMs, 60000, 1000, 3600000)
  const current = PROVIDER_CIRCUIT_STATES.get(key) ?? { failures: 0 }
  const failures = current.failures + 1
  const openedUntil = failures >= threshold ? Date.now() + cooldownMs : undefined
  PROVIDER_CIRCUIT_STATES.set(key, { failures, openedUntil })
  void appendRuntimeLog('circuit.breaker', {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    status: openedUntil ? 'opened' : 'failure',
    failures,
    threshold,
    cooldownMs: openedUntil ? cooldownMs : undefined,
  }, runtimeLogOptions(req))
}

export function providerRetryDelayMs(attempt: number): number {
  return Math.min(2000, 250 * 2 ** attempt)
}

export function logProviderRetryAttempt(req: ProviderRuntimeRetryRequestLike, attempt: number, maxRetries: number, detail: { status?: number; error?: string }): void {
  void appendRuntimeLog('upstream.retry', {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    requestedModel: req.requestedModel,
    upstreamModel: req.model,
    attempt,
    maxRetries,
    status: detail.status,
    error: detail.error,
  }, runtimeLogOptions(req))
}

export function delayProviderRetry(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function providerCircuitOpenError(): ProviderRuntimeRetryError {
  const error = new Error('circuit_breaker_open') as ProviderRuntimeRetryError
  error.credentialGroupId = undefined
  return error
}
