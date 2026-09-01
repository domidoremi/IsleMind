import type { UsageAttemptReason } from '../contracts'

/**
 * A small, provider-neutral attribution record that explains where a usage
 * attempt started and where it was actually sent.  The record is intentionally
 * flat when projected into UsageRecord so older consumers can keep reading the
 * existing providerId/upstreamModel fields.
 */
export interface UsageRouteAttributionInput {
  actualProviderId: string
  actualModel: string
  originalProviderId?: string
  originalModel?: string
  attempt?: number
  attemptReason?: UsageAttemptReason
  retryCount?: number
  failoverCount?: number
  attemptIdentity?: string
}

export interface UsageRouteAttribution {
  originalProviderId: string
  originalModel: string
  actualProviderId: string
  actualModel: string
  retryCount: number
  failoverCount: number
  attemptIdentity: string
  routeChanged: boolean
}

const MAX_ID_LENGTH = 256
const MAX_RETRY_COUNT = 128
const MAX_FAILOVER_COUNT = 32

/**
 * Resolve attribution without guessing missing provider data.  Unknown
 * optional values fall back to the actual route, while counters are bounded so
 * malformed runtime input cannot inflate statistics or create giant IDs.
 */
export function resolveUsageRouteAttribution(
  input: UsageRouteAttributionInput,
): UsageRouteAttribution {
  const actualProviderId = normalizeId(input.actualProviderId, 'unknown-provider')
  const actualModel = normalizeId(input.actualModel, 'unknown-model')
  const originalProviderId = normalizeId(input.originalProviderId, actualProviderId)
  const originalModel = normalizeId(input.originalModel, actualModel)
  const attempt = clampInteger(input.attempt, 0, 0, MAX_RETRY_COUNT)
  const attemptReason = input.attemptReason ?? 'initial'
  const routeChanged = originalProviderId !== actualProviderId || originalModel !== actualModel
  const retryCount = clampInteger(
    input.retryCount,
    attemptReason === 'retry' || attemptReason === 'rectification' ? attempt : 0,
    0,
    MAX_RETRY_COUNT,
  )
  const failoverCount = clampInteger(
    input.failoverCount,
    routeChanged || attemptReason === 'fallback' ? 1 : 0,
    0,
    MAX_FAILOVER_COUNT,
  )
  const attemptIdentity = normalizeId(
    input.attemptIdentity,
    buildAttemptIdentity({
      originalProviderId,
      originalModel,
      actualProviderId,
      actualModel,
      attempt,
      attemptReason,
    }),
  )

  return {
    originalProviderId,
    originalModel,
    actualProviderId,
    actualModel,
    retryCount,
    failoverCount,
    attemptIdentity,
    routeChanged,
  }
}

function buildAttemptIdentity(input: {
  originalProviderId: string
  originalModel: string
  actualProviderId: string
  actualModel: string
  attempt: number
  attemptReason: UsageAttemptReason
}): string {
  return [
    input.originalProviderId,
    input.originalModel,
    input.actualProviderId,
    input.actualModel,
    input.attemptReason,
    input.attempt,
  ].map((value) => encodeURIComponent(String(value))).join(':').slice(0, MAX_ID_LENGTH)
}

function normalizeId(value: string | undefined, fallback: string): string {
  const normalized = typeof value === 'string' ? value.trim().slice(0, MAX_ID_LENGTH) : ''
  return normalized || fallback
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
  return Math.max(min, Math.min(max, candidate))
}
