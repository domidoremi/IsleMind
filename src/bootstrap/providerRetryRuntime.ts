import {
  ProviderCircuitOpenError,
  assertProviderCircuitClosed as assertTargetProviderCircuitClosed,
  createProviderRetryAbortError,
  delayProviderRetry,
  isProviderRetryCancellation,
  providerCircuitKey,
  providerRetryDelayMs,
  recordProviderCircuitFailure as recordTargetProviderCircuitFailure,
  recordProviderCircuitSuccess as recordTargetProviderCircuitSuccess,
  resolveProviderMaxRetries,
  resolveProviderRequestTimeoutMs,
  throwIfProviderRetryAborted,
} from '@/modules/providers'
import { appendRuntimeLog } from '@/platform/native/runtimeLog'
import {
  runtimeLogOptions,
  type ProviderRuntimeLogRequestLike,
} from '@/bootstrap/providerRuntimeDiagnostics'

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

export {
  createProviderRetryAbortError,
  delayProviderRetry,
  isProviderRetryCancellation,
  providerCircuitKey,
  providerRetryDelayMs,
  resolveProviderMaxRetries,
  resolveProviderRequestTimeoutMs,
  throwIfProviderRetryAborted,
}

export function assertProviderCircuitClosed(req: ProviderRuntimeRetryRequestLike, key: string): void {
  try {
    assertTargetProviderCircuitClosed(req, key)
  } catch (error) {
    if (error instanceof ProviderCircuitOpenError) {
      void appendRuntimeLog('circuit.breaker', {
        conversationId: req.conversationId,
        providerId: req.provider.id,
        model: req.model,
        status: 'open',
        retryAfterMs: error.retryAfterMs,
      }, runtimeLogOptions(req))
    }
    throw error
  }
}

export function recordProviderCircuitSuccess(key: string, signal?: AbortSignal): void {
  if (signal?.aborted) return
  recordTargetProviderCircuitSuccess(key)
}

export function recordProviderCircuitFailure(
  req: ProviderRuntimeRetryRequestLike,
  key: string,
  signal?: AbortSignal,
): void {
  if (signal?.aborted) return
  const transition = recordTargetProviderCircuitFailure(req, key)
  if (!transition) return
  void appendRuntimeLog('circuit.breaker', {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    status: transition.status,
    failures: transition.failures,
    threshold: transition.threshold,
    cooldownMs: transition.cooldownMs,
  }, runtimeLogOptions(req))
}

export function logProviderRetryAttempt(
  req: ProviderRuntimeRetryRequestLike,
  attempt: number,
  maxRetries: number,
  detail: { status?: number; error?: string },
): void {
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
