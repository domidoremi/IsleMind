export interface ProviderRetryPolicyRequestLike {
  provider: {
    id: string
  }
  model: string
  settings?: {
    upstreamRequestTimeoutMs?: number
    upstreamMaxRetries?: number
    upstreamCircuitBreakerEnabled?: boolean
    upstreamCircuitBreakerFailureThreshold?: number
    upstreamCircuitBreakerCooldownMs?: number
  }
}

export interface ProviderCircuitFailureTransition {
  status: 'failure' | 'opened'
  failures: number
  threshold: number
  cooldownMs?: number
}

export class ProviderCircuitOpenError extends Error {
  readonly retryAfterMs: number

  constructor(retryAfterMs: number) {
    super('circuit_breaker_open')
    this.retryAfterMs = retryAfterMs
  }
}

const PROVIDER_CIRCUIT_STATES = new Map<string, { failures: number; openedUntil?: number }>()

export function providerCircuitKey(req: ProviderRetryPolicyRequestLike): string {
  return `${req.provider.id}:${req.model}`
}

export function resolveProviderRequestTimeoutMs(
  req: ProviderRetryPolicyRequestLike,
  fallbackMs: number,
): number {
  return clampInteger(req.settings?.upstreamRequestTimeoutMs, fallbackMs, 5000, 300000)
}

export function resolveProviderMaxRetries(req: ProviderRetryPolicyRequestLike): number {
  return clampInteger(req.settings?.upstreamMaxRetries, 1, 0, 5)
}

export function assertProviderCircuitClosed(
  req: ProviderRetryPolicyRequestLike,
  key: string,
  nowMs = Date.now(),
): void {
  if (req.settings?.upstreamCircuitBreakerEnabled === false) return
  const state = PROVIDER_CIRCUIT_STATES.get(key)
  if (!state?.openedUntil) return
  if (nowMs >= state.openedUntil) {
    PROVIDER_CIRCUIT_STATES.delete(key)
    return
  }
  throw new ProviderCircuitOpenError(Math.max(0, state.openedUntil - nowMs))
}

export function recordProviderCircuitSuccess(key: string): void {
  PROVIDER_CIRCUIT_STATES.delete(key)
}

export function recordProviderCircuitFailure(
  req: ProviderRetryPolicyRequestLike,
  key: string,
  nowMs = Date.now(),
): ProviderCircuitFailureTransition | undefined {
  if (req.settings?.upstreamCircuitBreakerEnabled === false) return undefined
  const threshold = clampInteger(req.settings?.upstreamCircuitBreakerFailureThreshold, 3, 1, 20)
  const cooldownMs = clampInteger(req.settings?.upstreamCircuitBreakerCooldownMs, 60000, 1000, 3600000)
  const current = PROVIDER_CIRCUIT_STATES.get(key) ?? { failures: 0 }
  const failures = current.failures + 1
  const opened = failures >= threshold
  PROVIDER_CIRCUIT_STATES.set(key, {
    failures,
    ...(opened ? { openedUntil: nowMs + cooldownMs } : {}),
  })
  return {
    status: opened ? 'opened' : 'failure',
    failures,
    threshold,
    ...(opened ? { cooldownMs } : {}),
  }
}

export function providerRetryDelayMs(attempt: number): number {
  return Math.min(2000, 250 * 2 ** attempt)
}

export function throwIfProviderRetryAborted(signal: AbortSignal): void {
  if (signal.aborted) throw providerRetryCancellationReason(signal)
}

export function isProviderRetryCancellation(signal: AbortSignal): boolean {
  return signal.aborted
}

export function createProviderRetryAbortError(error?: unknown): Error {
  if (error instanceof Error && error.name === 'AbortError') return error
  const abortError = new Error('AbortError')
  abortError.name = 'AbortError'
  return abortError
}

export function delayProviderRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(providerRetryCancellationReason(signal))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, Math.max(0, ms))
    const abort = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      reject(providerRetryCancellationReason(signal))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function providerRetryCancellationReason(signal: AbortSignal): unknown {
  return signal.reason === undefined ? createProviderRetryAbortError() : signal.reason
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.isFinite(value) ? Math.trunc(value!) : fallback
  return Math.max(min, Math.min(max, parsed))
}
