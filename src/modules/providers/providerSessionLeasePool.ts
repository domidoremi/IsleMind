export interface ProviderSessionLeaseOptions {
  key: string
  limit?: number
  timeoutMs?: number
  now?: () => number
  signal?: AbortSignal
}

export interface ProviderSessionLease {
  key: string
  release(): void
}

export interface ProviderSessionLeasePool {
  acquire(options: ProviderSessionLeaseOptions): Promise<ProviderSessionLease>
  activeCount(key: string): number
}

export interface ProviderSessionLeasePoolDependencies {
  wait?(ms: number, signal?: AbortSignal): Promise<void>
}

const LEASE_POLL_INTERVAL_MS = 25

export function createProviderSessionLeasePool(
  dependencies: ProviderSessionLeasePoolDependencies = {},
): ProviderSessionLeasePool {
  const activeCounts = new Map<string, number>()
  const wait = dependencies.wait ?? waitForProviderSessionLease

  async function acquire(options: ProviderSessionLeaseOptions): Promise<ProviderSessionLease> {
    const limit = normalizeLimit(options.limit)
    const timeoutMs = normalizeTimeout(options.timeoutMs)
    const now = options.now ?? Date.now
    const startedAt = now()

    throwIfProviderSessionLeaseAborted(options.signal)
    while ((activeCounts.get(options.key) ?? 0) >= limit) {
      if (now() - startedAt >= timeoutMs) {
        throw new Error('session_queue_timeout')
      }
      await wait(LEASE_POLL_INTERVAL_MS, options.signal)
      throwIfProviderSessionLeaseAborted(options.signal)
    }

    throwIfProviderSessionLeaseAborted(options.signal)
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

  return {
    acquire,
    activeCount: (key) => activeCounts.get(key) ?? 0,
  }
}

function normalizeLimit(value: number | undefined): number {
  return Math.max(1, Math.min(8, Number.isFinite(value) ? Math.floor(value as number) : 1))
}

function normalizeTimeout(value: number | undefined): number {
  return Math.max(0, Math.min(30_000, Number.isFinite(value) ? Math.floor(value as number) : 1_500))
}

function throwIfProviderSessionLeaseAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const error = new Error('Provider session lease acquisition was cancelled.')
  error.name = 'AbortError'
  throw error
}

function waitForProviderSessionLease(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    try {
      throwIfProviderSessionLeaseAborted(signal)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const onAbort = () => {
      const error = new Error('Provider session lease acquisition was cancelled.')
      error.name = 'AbortError'
      finish(error)
    }
    const timer = setTimeout(() => finish(), ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
