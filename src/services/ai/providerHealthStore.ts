import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ProviderHealthRecord, ProviderHealthStatus } from '@/services/ai/providerHealth'
import { providerHealthKey } from '@/services/ai/providerHealth'

export const PROVIDER_HEALTH_STORAGE_KEY = '@islemind/provider-health'
export const PROVIDER_HEALTH_SNAPSHOT_VERSION = 1

export interface ProviderHealthSnapshot {
  version: typeof PROVIDER_HEALTH_SNAPSHOT_VERSION
  updatedAtMs: number
  records: ProviderHealthRecord[]
}

export interface ProviderHealthSnapshotOptions {
  nowMs?: number
  maxAgeMs?: number
  maxRecords?: number
}

const DEFAULT_MAX_RECORDS = 500
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const HEALTH_STATUSES = new Set<ProviderHealthStatus>(['unknown', 'healthy', 'degraded', 'cooldown', 'circuit-open'])

export async function loadProviderHealthSnapshot(options: ProviderHealthSnapshotOptions = {}): Promise<ProviderHealthSnapshot> {
  const raw = await AsyncStorage.getItem(PROVIDER_HEALTH_STORAGE_KEY)
  if (!raw) return emptyProviderHealthSnapshot(options.nowMs)
  try {
    return normalizeProviderHealthSnapshot(JSON.parse(raw), options)
  } catch {
    return emptyProviderHealthSnapshot(options.nowMs)
  }
}

export async function saveProviderHealthRecords(
  records: ProviderHealthRecord[],
  options: ProviderHealthSnapshotOptions = {},
): Promise<ProviderHealthSnapshot> {
  const snapshot = normalizeProviderHealthSnapshot({
    version: PROVIDER_HEALTH_SNAPSHOT_VERSION,
    updatedAtMs: options.nowMs ?? Date.now(),
    records,
  }, options)
  await AsyncStorage.setItem(PROVIDER_HEALTH_STORAGE_KEY, JSON.stringify(snapshot))
  return snapshot
}

export async function mergeProviderHealthRecords(
  updates: ProviderHealthRecord[],
  options: ProviderHealthSnapshotOptions = {},
): Promise<ProviderHealthSnapshot> {
  const current = await loadProviderHealthSnapshot(options)
  const byKey = new Map(current.records.map((record) => [providerHealthKey(record), record]))
  for (const update of updates) {
    const sanitized = sanitizeProviderHealthRecord(update)
    if (!sanitized) continue
    byKey.set(providerHealthKey(sanitized), sanitized)
  }
  return saveProviderHealthRecords(Array.from(byKey.values()), options)
}

export async function clearProviderHealthSnapshot(): Promise<void> {
  await AsyncStorage.removeItem(PROVIDER_HEALTH_STORAGE_KEY)
}

export async function removeProviderHealthRecordsByProviderId(
  providerId: string,
  options: ProviderHealthSnapshotOptions = {},
): Promise<ProviderHealthSnapshot> {
  const normalizedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
  if (!normalizedProviderId) {
    return loadProviderHealthSnapshot(options)
  }
  const current = await loadProviderHealthSnapshot({
    ...options,
    maxAgeMs: Number.MAX_SAFE_INTEGER,
  })
  const records = current.records.filter((record) => record.providerId !== normalizedProviderId)
  if (records.length === current.records.length) return current
  return saveProviderHealthRecords(records, {
    ...options,
    maxAgeMs: Number.MAX_SAFE_INTEGER,
  })
}

export function normalizeProviderHealthSnapshot(value: unknown, options: ProviderHealthSnapshotOptions = {}): ProviderHealthSnapshot {
  const data = value && typeof value === 'object' ? value as Partial<ProviderHealthSnapshot> : {}
  const nowMs = options.nowMs ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
  const minTimestamp = nowMs - maxAgeMs
  const records = Array.isArray(data.records)
    ? data.records
        .map(sanitizeProviderHealthRecord)
        .filter((record): record is ProviderHealthRecord => !!record)
        .filter((record) => (record.lastSuccessAtMs ?? record.lastFailureAtMs ?? nowMs) >= minTimestamp)
        .sort((left, right) => mostRecentTimestamp(right) - mostRecentTimestamp(left))
        .slice(0, maxRecords)
    : []
  return {
    version: PROVIDER_HEALTH_SNAPSHOT_VERSION,
    updatedAtMs: typeof data.updatedAtMs === 'number' && Number.isFinite(data.updatedAtMs) ? data.updatedAtMs : nowMs,
    records,
  }
}

export function sanitizeProviderHealthRecord(value: unknown): ProviderHealthRecord | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Partial<ProviderHealthRecord>
  if (typeof record.providerId !== 'string' || !record.providerId.trim()) return undefined
  const status = HEALTH_STATUSES.has(record.status as ProviderHealthStatus) ? record.status as ProviderHealthStatus : 'unknown'
  return {
    providerId: record.providerId.trim(),
    model: stringOrUndefined(record.model),
    credentialGroupId: stringOrUndefined(record.credentialGroupId),
    region: stringOrUndefined(record.region),
    status,
    successes: nonNegativeInteger(record.successes),
    failures: nonNegativeInteger(record.failures),
    consecutiveFailures: nonNegativeInteger(record.consecutiveFailures),
    lastSuccessAtMs: finiteNumberOrUndefined(record.lastSuccessAtMs),
    lastFailureAtMs: finiteNumberOrUndefined(record.lastFailureAtMs),
    lastFailureTrigger: record.lastFailureTrigger,
    cooldownUntilMs: finiteNumberOrUndefined(record.cooldownUntilMs),
    circuitOpenUntilMs: finiteNumberOrUndefined(record.circuitOpenUntilMs),
    averageLatencyMs: finiteNumberOrUndefined(record.averageLatencyMs),
  }
}

function emptyProviderHealthSnapshot(nowMs = Date.now()): ProviderHealthSnapshot {
  return {
    version: PROVIDER_HEALTH_SNAPSHOT_VERSION,
    updatedAtMs: nowMs,
    records: [],
  }
}

function mostRecentTimestamp(record: ProviderHealthRecord): number {
  return Math.max(record.lastSuccessAtMs ?? 0, record.lastFailureAtMs ?? 0)
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function finiteNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}
