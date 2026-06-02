import type { ProviderFailoverCandidate, ProviderFailoverTrigger } from '@/services/ai/providerFailover'

export type ProviderHealthStatus =
  | 'unknown'
  | 'healthy'
  | 'degraded'
  | 'cooldown'
  | 'circuit-open'

export interface ProviderHealthRouteKey {
  providerId: string
  model?: string
  credentialGroupId?: string
  region?: string
}

export interface ProviderHealthRecord extends ProviderHealthRouteKey {
  status: ProviderHealthStatus
  successes: number
  failures: number
  consecutiveFailures: number
  lastSuccessAtMs?: number
  lastFailureAtMs?: number
  lastFailureTrigger?: ProviderFailoverTrigger
  cooldownUntilMs?: number
  circuitOpenUntilMs?: number
  averageLatencyMs?: number
}

export interface ProviderHealthPolicy {
  failureThreshold?: number
  circuitOpenMs?: number
  defaultCooldownMs?: number
  triggerCooldownMs?: Partial<Record<ProviderFailoverTrigger, number>>
}

export interface ProviderHealthSuccessInput {
  key: ProviderHealthRouteKey
  nowMs: number
  latencyMs?: number
}

export interface ProviderHealthFailureInput {
  key: ProviderHealthRouteKey
  trigger: ProviderFailoverTrigger
  nowMs: number
  latencyMs?: number
  retryAfterMs?: number
}

const DEFAULT_HEALTH_POLICY: Required<Pick<ProviderHealthPolicy, 'failureThreshold' | 'circuitOpenMs' | 'defaultCooldownMs'>> = {
  failureThreshold: 3,
  circuitOpenMs: 60_000,
  defaultCooldownMs: 15_000,
}

const DEFAULT_TRIGGER_COOLDOWN_MS: Partial<Record<ProviderFailoverTrigger, number>> = {
  timeout: 10_000,
  network_error: 10_000,
  rate_limited: 60_000,
  server_error: 20_000,
  model_unavailable: 30_000,
  overloaded: 20_000,
  credential_unhealthy: 120_000,
}

export function providerHealthKey(key: ProviderHealthRouteKey): string {
  return [
    key.providerId,
    key.model ?? '*',
    key.credentialGroupId ?? '*',
    key.region ?? '*',
  ].join('|')
}

export function createProviderHealthRecord(key: ProviderHealthRouteKey): ProviderHealthRecord {
  return {
    ...key,
    status: 'unknown',
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
  }
}

export function recordProviderSuccess(record: ProviderHealthRecord | undefined, input: ProviderHealthSuccessInput): ProviderHealthRecord {
  const base = record ?? createProviderHealthRecord(input.key)
  return {
    ...base,
    ...input.key,
    status: 'healthy',
    successes: base.successes + 1,
    consecutiveFailures: 0,
    lastSuccessAtMs: input.nowMs,
    cooldownUntilMs: undefined,
    circuitOpenUntilMs: undefined,
    averageLatencyMs: updateAverageLatency(base.averageLatencyMs, input.latencyMs, base.successes),
  }
}

export function recordProviderFailure(
  record: ProviderHealthRecord | undefined,
  input: ProviderHealthFailureInput,
  policy: ProviderHealthPolicy = {},
): ProviderHealthRecord {
  const base = record ?? createProviderHealthRecord(input.key)
  const consecutiveFailures = base.consecutiveFailures + 1
  const cooldownMs = input.retryAfterMs ?? cooldownMsForTrigger(input.trigger, policy)
  const cooldownUntilMs = cooldownMs > 0 ? input.nowMs + cooldownMs : undefined
  const failureThreshold = policy.failureThreshold ?? DEFAULT_HEALTH_POLICY.failureThreshold
  const circuitOpenMs = policy.circuitOpenMs ?? DEFAULT_HEALTH_POLICY.circuitOpenMs
  const circuitOpenUntilMs = consecutiveFailures >= failureThreshold ? input.nowMs + circuitOpenMs : undefined

  return {
    ...base,
    ...input.key,
    status: circuitOpenUntilMs ? 'circuit-open' : cooldownUntilMs ? 'cooldown' : 'degraded',
    failures: base.failures + 1,
    consecutiveFailures,
    lastFailureAtMs: input.nowMs,
    lastFailureTrigger: input.trigger,
    cooldownUntilMs,
    circuitOpenUntilMs,
    averageLatencyMs: updateAverageLatency(base.averageLatencyMs, input.latencyMs, base.successes),
  }
}

export function indexProviderHealthRecords(records: ProviderHealthRecord[]): Record<string, ProviderHealthRecord> {
  return records.reduce<Record<string, ProviderHealthRecord>>((index, record) => {
    index[providerHealthKey(record)] = record
    return index
  }, {})
}

export function providerHealthActiveStatus(record: ProviderHealthRecord | undefined, nowMs: number): ProviderHealthStatus {
  if (!record) return 'unknown'
  if (record.circuitOpenUntilMs && record.circuitOpenUntilMs > nowMs) return 'circuit-open'
  if (record.cooldownUntilMs && record.cooldownUntilMs > nowMs) return 'cooldown'
  if (record.status === 'circuit-open' || record.status === 'cooldown') return 'degraded'
  return record.status
}

export function annotateFailoverCandidatesWithHealth(
  candidates: ProviderFailoverCandidate[],
  records: Record<string, ProviderHealthRecord>,
  nowMs: number,
): ProviderFailoverCandidate[] {
  return candidates.map((candidate) => {
    const record = findProviderHealthRecord(candidate, records)
    const status = providerHealthActiveStatus(record, nowMs)
    return {
      ...candidate,
      healthy: status === 'healthy' || status === 'unknown' ? candidate.healthy : false,
      cooldownActive: status === 'cooldown' || status === 'circuit-open' || candidate.cooldownActive === true,
      healthScore: providerHealthScore(record, status),
      latencyMs: candidate.latencyMs ?? record?.averageLatencyMs,
      lastSuccessAtMs: candidate.lastSuccessAtMs ?? record?.lastSuccessAtMs,
      lastFailureAtMs: candidate.lastFailureAtMs ?? record?.lastFailureAtMs,
    }
  })
}

export function findProviderHealthRecord(
  key: ProviderHealthRouteKey,
  records: Record<string, ProviderHealthRecord>,
): ProviderHealthRecord | undefined {
  const candidates: ProviderHealthRouteKey[] = [
    key,
    { providerId: key.providerId, model: key.model, credentialGroupId: key.credentialGroupId },
    { providerId: key.providerId, model: key.model, region: key.region },
    { providerId: key.providerId, model: key.model },
    { providerId: key.providerId, credentialGroupId: key.credentialGroupId },
    { providerId: key.providerId },
  ]
  for (const candidate of candidates) {
    const record = records[providerHealthKey(candidate)]
    if (record) return record
  }
  return undefined
}

function cooldownMsForTrigger(trigger: ProviderFailoverTrigger, policy: ProviderHealthPolicy): number {
  return policy.triggerCooldownMs?.[trigger]
    ?? DEFAULT_TRIGGER_COOLDOWN_MS[trigger]
    ?? policy.defaultCooldownMs
    ?? DEFAULT_HEALTH_POLICY.defaultCooldownMs
}

function updateAverageLatency(current: number | undefined, next: number | undefined, successCount: number): number | undefined {
  if (typeof next !== 'number') return current
  if (typeof current !== 'number' || successCount <= 0) return next
  return Math.round((current * successCount + next) / (successCount + 1))
}

function providerHealthScore(record: ProviderHealthRecord | undefined, status: ProviderHealthStatus): number {
  if (!record) return 50
  if (status === 'healthy') return Math.max(70, 100 - record.consecutiveFailures * 10)
  if (status === 'unknown') return 50
  if (status === 'degraded') return Math.max(10, 40 - record.consecutiveFailures * 10)
  return 0
}
