export interface SessionLeaseOptions {
  key: string
  limit?: number
  timeoutMs?: number
  now?: () => number
}

export interface SessionLease {
  key: string
  release: () => void
}

const activeCounts = new Map<string, number>()

export async function acquireSessionLease(options: SessionLeaseOptions): Promise<SessionLease> {
  const limit = normalizeLimit(options.limit)
  const timeoutMs = normalizeTimeout(options.timeoutMs)
  const now = options.now ?? Date.now
  const startedAt = now()
  while ((activeCounts.get(options.key) ?? 0) >= limit) {
    if (now() - startedAt >= timeoutMs) {
      throw new Error('session_queue_timeout')
    }
    await delay(25)
  }
  activeCounts.set(options.key, (activeCounts.get(options.key) ?? 0) + 1)
  let released = false
  return {
    key: options.key,
    release: () => {
      if (released) return
      released = true
      const next = Math.max(0, (activeCounts.get(options.key) ?? 1) - 1)
      if (next) activeCounts.set(options.key, next)
      else activeCounts.delete(options.key)
    },
  }
}

export function activeSessionLeaseCount(key: string): number {
  return activeCounts.get(key) ?? 0
}

function normalizeLimit(value: number | undefined): number {
  return Math.max(1, Math.min(8, Number.isFinite(value) ? Math.floor(value!) : 1))
}

function normalizeTimeout(value: number | undefined): number {
  return Math.max(0, Math.min(30000, Number.isFinite(value) ? Math.floor(value!) : 1500))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
