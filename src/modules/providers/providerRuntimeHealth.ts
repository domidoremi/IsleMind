import type {
  ProviderFailoverRoute,
  ProviderFailureClassification,
  ProviderFailureClassificationInput,
} from './providerFailoverPolicy'
import { classifyProviderFailure } from './providerFailoverPolicy'
import {
  findProviderHealthRecord,
  indexProviderHealthRecords,
  providerHealthActiveStatus,
  providerHealthKey,
  recordProviderFailure,
  recordProviderSuccess,
  type ProviderHealthRecord,
  type ProviderHealthStatus,
} from './providerHealth'
import type { ProviderHealthRepository } from './providerHealthRepository'
import {
  retryAfterMsFromFailure,
  routeForRuntimeFallback,
  type ProviderRuntimeFallbackRequest,
} from './providerRuntimeFallback'

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

export type ProviderRuntimeRouteHealthSuccessInput = Omit<
  ProviderRuntimeHealthSuccessInput,
  'req' | 'credentialGroupId'
>

export type ProviderRuntimeRouteHealthFailureInput = Omit<
  ProviderRuntimeHealthFailureInput,
  'req' | 'credentialGroupId'
> & {
  trigger?: ProviderFailureClassification['trigger']
}

export interface ProviderRuntimeHealth {
  providerRuntimeHealthRoute(req: ProviderRuntimeHealthRequest, credentialGroupId?: string): ProviderFailoverRoute
  resolveProviderRuntimeHealthView(route: ProviderFailoverRoute, nowMs?: number): Promise<ProviderRuntimeHealthView | undefined>
  recordProviderRuntimeSuccess(input: ProviderRuntimeHealthSuccessInput): Promise<void>
  recordProviderRuntimeFailure(input: ProviderRuntimeHealthFailureInput): Promise<ProviderFailureClassification>
  recordProviderRuntimeRouteSuccess(route: ProviderFailoverRoute, input?: ProviderRuntimeRouteHealthSuccessInput): Promise<void>
  recordProviderRuntimeRouteFailure(route: ProviderFailoverRoute, input: ProviderRuntimeRouteHealthFailureInput): Promise<ProviderFailureClassification>
}

export function createProviderRuntimeHealth(
  repository: Pick<ProviderHealthRepository, 'load' | 'merge'>,
): ProviderRuntimeHealth {
  function providerRuntimeHealthRoute(
    req: ProviderRuntimeHealthRequest,
    credentialGroupId?: string,
  ): ProviderFailoverRoute {
    return routeForRuntimeFallback(req, credentialGroupId)
  }

  async function resolveProviderRuntimeHealthView(
    route: ProviderFailoverRoute,
    nowMs = Date.now(),
  ): Promise<ProviderRuntimeHealthView | undefined> {
    try {
      const snapshot = await repository.load({ nowMs })
      const record = findProviderHealthRecord(route, indexProviderHealthRecords(snapshot.records))
      return record ? providerRuntimeHealthView(record, nowMs) : undefined
    } catch {
      return undefined
    }
  }

  async function recordProviderRuntimeSuccess(input: ProviderRuntimeHealthSuccessInput): Promise<void> {
    await recordProviderRuntimeRouteSuccess(providerRuntimeHealthRoute(input.req, input.credentialGroupId), input)
  }

  async function recordProviderRuntimeFailure(
    input: ProviderRuntimeHealthFailureInput,
  ): Promise<ProviderFailureClassification> {
    const classification = classifyRuntimeFailure(input)
    await recordProviderRuntimeRouteFailure(providerRuntimeHealthRoute(input.req, input.credentialGroupId), {
      ...input,
      trigger: classification.trigger,
    })
    return classification
  }

  async function recordProviderRuntimeRouteSuccess(
    route: ProviderFailoverRoute,
    input: ProviderRuntimeRouteHealthSuccessInput = {},
  ): Promise<void> {
    try {
      const nowMs = input.nowMs ?? Date.now()
      const existing = await loadExactProviderHealthRecord(route, nowMs)
      await repository.merge([
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

  async function recordProviderRuntimeRouteFailure(
    route: ProviderFailoverRoute,
    input: ProviderRuntimeRouteHealthFailureInput,
  ): Promise<ProviderFailureClassification> {
    const classification = input.trigger
      ? {
          trigger: input.trigger,
          retryable: true,
          source: 'explicit' as const,
          evidence: { status: input.status, errorName: input.errorName, errorCode: input.errorCode },
        }
      : classifyRuntimeFailure(input)
    try {
      const nowMs = input.nowMs ?? Date.now()
      const existing = await loadExactProviderHealthRecord(route, nowMs)
      await repository.merge([
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

  async function loadExactProviderHealthRecord(
    route: ProviderFailoverRoute,
    nowMs: number,
  ): Promise<ProviderHealthRecord | undefined> {
    const snapshot = await repository.load({ nowMs })
    const key = providerHealthKey(route)
    return snapshot.records.find((record) => providerHealthKey(record) === key)
  }

  return {
    providerRuntimeHealthRoute,
    resolveProviderRuntimeHealthView,
    recordProviderRuntimeSuccess,
    recordProviderRuntimeFailure,
    recordProviderRuntimeRouteSuccess,
    recordProviderRuntimeRouteFailure,
  }
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

function classifyRuntimeFailure(
  input: ProviderRuntimeHealthFailureInput | ProviderRuntimeRouteHealthFailureInput,
): ProviderFailureClassification {
  const error = input.error
  return classifyProviderFailure({
    ...input,
    errorName: input.errorName ?? (error instanceof Error ? error.name : undefined),
    errorMessage: input.errorMessage ?? input.responseText ?? (error instanceof Error ? error.message : undefined),
  })
}
