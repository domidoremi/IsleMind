import type { ExecutionTimerMirror } from '@/core'

export const ANDROID_EXECUTION_TIMER_EVENT = 'AndroidAgentExecutionTimer'

export interface AndroidExecutionTimerModule {
  scheduleExecutionTimer(id: number, delayMs: number): Promise<boolean>
  cancelExecutionTimer(id: number): void
}

/** A bounded mirror, not a second executor. Native dispatch is lease-gated; the
 * ordinary JS timer races it so visible execution also works without a lease. */
export function createAndroidExecutionTimerMirror(input: {
  native: AndroidExecutionTimerModule
  subscribe(listener: (event: unknown) => void): () => void
}) {
  let nextId = 0
  const pending = new Map<number, () => void>()
  let disposed = false
  const unsubscribe = input.subscribe(event => {
    if (!event || typeof event !== 'object') return
    const id = (event as { id?: unknown }).id
    if (typeof id !== 'number' || !Number.isSafeInteger(id)) return
    const callback = pending.get(id)
    pending.delete(id)
    callback?.()
  })
  const mirror: ExecutionTimerMirror = {
    schedule(callback, delayMs) {
      if (disposed || pending.size >= 128 || nextId === Number.MAX_SAFE_INTEGER) throw new Error('Execution timer capacity unavailable')
      const id = ++nextId
      pending.set(id, callback)
      // Native refuses overflow by revoking live leases, never by extending them.
      try { void input.native.scheduleExecutionTimer(id, delayMs).catch(() => undefined) }
      catch (error) { pending.delete(id); throw error }
      let cancelled = false
      return () => {
        if (cancelled) return
        cancelled = true
        pending.delete(id)
        try { input.native.cancelExecutionTimer(id) } catch { /* Bridge teardown; native invalidation clears its queue. */ }
      }
    },
  }
  return {
    mirror,
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      for (const id of pending.keys()) input.native.cancelExecutionTimer(id)
      pending.clear()
    },
  }
}
