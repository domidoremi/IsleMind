import type { ProviderFailoverRoute, ProviderFailureClassification, ProviderFailureClassificationInput } from '@/services/ai/providerFailover'
import { classifyProviderFailure } from '@/services/ai/providerFailover'
import type { ProviderHealthRecord, ProviderHealthStatus } from '@/services/ai/providerHealth'
import { findProviderHealthRecord, indexProviderHealthRecords, providerHealthActiveStatus, providerHealthKey, recordProviderFailure, recordProviderSuccess } from '@/services/ai/providerHealth'
import { loadProviderHealthSnapshot, mergeProviderHealthRecords } from '@/services/ai/providerHealthStore'
import { retryAfterMsFromFailure, routeForRuntimeFallback, type ProviderRuntimeFallbackRequest } from '@/services/ai/providerRuntimeFallback'

export const PROVIDER_RUNTIME_HEALTH_VIEW_SCHEMA = 'islemind.provider-runtime-health-view.v1'

export interface ProviderRuntimeHealthRequest extends ProviderRuntimeFallbackRequest {
  conversationId?: string
  requestedModel?: string
}

export interface ProviderRuntimeHealthView {
  schema: typeof PROVIDER_RUNTIME_HEALTH_VIEW_SCHEMA
  status: ProviderHealthStatus
  successes: number
  failures: number
  consecutiveFailures: number
  cooldownUntilMs?: number
  circuitOpenUntilMs?: number
  lastSuccessAtMs?: number
  lastFailureAtMs?: number
}

export interface ProviderRuntimeHealthSuccessInput {
  req: ProviderRuntimeHealthRequest
  credentialGroupId?: string
  nowMs?: number
  latencyMs?: number
}

export interface ProviderRuntimeHealthFailureInput extends ProviderFailureClassificationInput {
  req: ProviderRuntimeHealthRequest
  credentialGroupId?: string
  nowMs?: number
  latencyMs?: number
  responseText?: string
  error?: unknown
  retryAfterMs?: number
}

export function providerRuntimeHealthRoute(
  req: ProviderRuntimeHealthRequest,
  credentialGroupId?: string
): ProviderFailoverRoute {
  return routeForRuntimeFallback(req, credentialGroupId)
}

export async function resolveProviderRuntimeHealthView(
  route: ProviderFailoverRoute,
  nowMs = Date.now()
): Promise<ProviderRuntimeHealthView | undefined> {
  try {
    const snapshot = await loadProviderHealthSnapshot({ nowMs })
    const record = findProviderHealthRecord(route, indexProviderHealthRecords(snapshot.records))
    return record ? providerRuntimeHealthView(record, nowMs) : undefined
  } catch {
    return undefined
  }
}

export async function recordProviderRuntimeSuccess(input: ProviderRuntimeHealthSuccessInput): Promise<void> {
  await recordProviderRuntimeRouteSuccess(providerRuntimeHealthRoute(input.req, input.credentialGroupId), input)
}

export async function recordProviderRuntimeFailure(input: ProviderRuntimeHealthFailureInput): Promise<ProviderFailureClassification> {
  const classification = classifyRuntimeFailure(input)
  await recordProviderRuntimeRouteFailure(providerRuntimeHealthRoute(input.req, input.credentialGroupId), {
    ...input,
    trigger: classification.trigger,
  })
  return classification
}

export async function recordProviderRuntimeRouteSuccess(
  route: ProviderFailoverRoute,
  input: Omit<ProviderRuntimeHealthSuccessInput, 'req' | 'credentialGroupId'> = {}
): Promise<void> {
  try {
    const nowMs = input.nowMs ?? Date.now()
    const existing = await loadExactProviderHealthRecord(route, nowMs)
    await mergeProviderHealthRecords([
      recordProviderSuccess(existing, {
        key: route,
        nowMs,
        latencyMs: input.latencyMs,
      }),
    ], { nowMs })
  } catch {
    // Health telemetry must not block provider responses.
  }
}

export async function recordProviderRuntimeRouteFailure(
  route: ProviderFailoverRoute,
  input: Omit<ProviderRuntimeHealthFailureInput, 'req' | 'credentialGroupId'> & { trigger?: ProviderFailureClassification['trigger'] }
): Promise<ProviderFailureClassification> {
  const classification = input.trigger
    ? { trigger: input.trigger, retryable: true, source: 'explicit' as const, evidence: { status: input.status, errorName: input.errorName, errorCode: input.errorCode } }
    : classifyRuntimeFailure(input)
  try {
    const nowMs = input.nowMs ?? Date.now()
    const existing = await loadExactProviderHealthRecord(route, nowMs)
    await mergeProviderHealthRecords([
      recordProviderFailure(existing, {
        key: route,
        trigger: classification.trigger,
        nowMs,
        latencyMs: input.latencyMs,
        retryAfterMs: input.retryAfterMs ?? retryAfterMsFromFailure(input.status),
      }),
    ], { nowMs })
  } catch {
    // Health telemetry must not block provider responses.
  }
  return classification
}

function providerRuntimeHealthView(record: ProviderHealthRecord, nowMs: number): ProviderRuntimeHealthView {
  return {
    schema: PROVIDER_RUNTIME_HEALTH_VIEW_SCHEMA,
    status: providerHealthActiveStatus(record, nowMs),
    successes: record.successes,
    failures: record.failures,
    consecutiveFailures: record.consecutiveFailures,
    cooldownUntilMs: record.cooldownUntilMs,
    circuitOpenUntilMs: record.circuitOpenUntilMs,
    lastSuccessAtMs: record.lastSuccessAtMs,
    lastFailureAtMs: record.lastFailureAtMs,
  }
}

async function loadExactProviderHealthRecord(route: ProviderFailoverRoute, nowMs: number): Promise<ProviderHealthRecord | undefined> {
  const snapshot = await loadProviderHealthSnapshot({ nowMs })
  const key = providerHealthKey(route)
  return snapshot.records.find((record) => providerHealthKey(record) === key)
}

function classifyRuntimeFailure(input: ProviderRuntimeHealthFailureInput | Omit<ProviderRuntimeHealthFailureInput, 'req' | 'credentialGroupId'>): ProviderFailureClassification {
  const error = input.error
  return classifyProviderFailure({
    ...input,
    errorName: input.errorName ?? (error instanceof Error ? error.name : undefined),
    errorMessage: input.errorMessage ?? input.responseText ?? (error instanceof Error ? error.message : undefined),
  })
}
