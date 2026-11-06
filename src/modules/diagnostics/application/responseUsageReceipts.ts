import type { UsageRecord, UsageStatisticsSummary } from '../contracts'
import { summarizeUsageRecords } from './usageSummary'

/** Bounded session cache for reply receipts. The durable ledger remains authoritative. */
export function createResponseUsageReceiptCache(limit = 500) {
  const capacity = Number.isSafeInteger(limit) ? Math.max(1, Math.min(500, limit)) : 500
  const records = new Map<string, Map<string, UsageRecord>>()
  const snapshots = new Map<string, UsageStatisticsSummary & { logicalRequestIds: readonly string[] }>()
  const incomplete = new Set<string>()
  const listeners = new Map<string, Set<() => void>>()
  const notify = (id: string) => listeners.get(id)?.forEach(listener => listener())
  return {
    record(record: UsageRecord) {
      const id = record.execution?.responseExecutionId
      if (!id) return
      const attempts = records.get(id) ?? new Map<string, UsageRecord>()
      if (attempts.size >= 500 && !attempts.has(record.attemptIdentity ?? record.id)) {
        // A partial cache cannot claim a complete receipt. Keep its memory bounded.
        incomplete.add(id)
        snapshots.delete(id)
        notify(id)
        return
      }
      attempts.set(record.attemptIdentity ?? record.id, record)
      records.set(id, attempts)
      if (!incomplete.has(id)) snapshots.set(id, {
        ...summarizeUsageRecords([...attempts.values()]),
        logicalRequestIds: [...new Set([...attempts.values()].flatMap(value =>
          value.execution ? [value.execution.logicalRequestId] : []))],
      })
      notify(id)
      while (records.size > capacity) {
        const oldest = records.keys().next().value as string
        records.delete(oldest)
        snapshots.delete(oldest)
        incomplete.delete(oldest)
        notify(oldest)
      }
    },
    get(id: string) { return snapshots.get(id) },
    subscribe(id: string, listener: () => void) {
      const group = listeners.get(id) ?? new Set()
      group.add(listener)
      listeners.set(id, group)
      return () => {
        group.delete(listener)
        if (!group.size) listeners.delete(id)
      }
    },
    clear() {
      const ids = [...snapshots.keys()]
      records.clear()
      snapshots.clear()
      incomplete.clear()
      ids.forEach(notify)
    },
  }
}
