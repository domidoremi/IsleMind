/** Resource permits describe real work, not the lifetime of its caller's promise. */
export interface ExecutionResources {
  runLocal<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T>
  reserveText(bytes: number): () => void
  /** Existing-run pause/cancel persistence only: ignores pressure admission,
   * never the shared text cap. This does not authorize new work. */
  reserveStopText(bytes: number): () => void
  setPressure(critical: boolean): void
  assertAdmission(): void
  readonly retainedTextBytes: number
}

export class ExecutionResourceError extends Error {
  constructor(readonly code: 'memory_pressure' | 'text_budget' | 'queue_full') {
    super(code)
    this.name = 'ExecutionResourceError'
  }
}

export function createExecutionResources(options: {
  maxTextBytes?: number
  maxQueued?: number
} = {}): ExecutionResources {
  const maxBytes = positiveInteger(options.maxTextBytes ?? 8 * 1024 * 1024)
  const maxQueued = positiveInteger(options.maxQueued ?? 32)
  let bytes = 0
  let pressure = false
  let occupied = false
  type Waiter = { signal: AbortSignal; resolve: () => void; reject: (error: unknown) => void; abort: () => void }
  const queue: Waiter[] = []
  const assertAdmission = () => {
    if (pressure) throw new ExecutionResourceError('memory_pressure')
  }
  function reserveTextBytes(size: number): () => void {
    if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes - bytes) {
      throw new ExecutionResourceError('text_budget')
    }
    bytes += size
    let released = false
    return () => { if (!released) { released = true; bytes -= size } }
  }
  function release() {
    occupied = false
    const next = queue.shift()
    if (!next) return
    next.signal.removeEventListener('abort', next.abort)
    occupied = true
    next.resolve()
  }
  async function acquire(signal: AbortSignal) {
    throwIfAborted(signal)
    assertAdmission()
    if (!occupied) { occupied = true; return }
    if (queue.length >= maxQueued) throw new ExecutionResourceError('queue_full')
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { signal, resolve, reject, abort: () => {
        const index = queue.indexOf(waiter)
        if (index !== -1) queue.splice(index, 1)
        reject(signal.reason ?? new Error('Operation cancelled'))
      } }
      queue.push(waiter)
      signal.addEventListener('abort', waiter.abort, { once: true })
    })
  }
  return {
    async runLocal(signal, work) {
      await acquire(signal)
      try {
        throwIfAborted(signal)
        assertAdmission()
        // Do not race work against abort: an uninterruptible native operation
        // retains this permit until it actually settles.
        const result = await work()
        throwIfAborted(signal)
        return result
      } finally { release() }
    },
    reserveText(size) {
      assertAdmission()
      return reserveTextBytes(size)
    },
    reserveStopText: reserveTextBytes,
    setPressure(critical) {
      pressure = critical
      if (critical) {
        for (const waiter of queue.splice(0)) {
          waiter.signal.removeEventListener('abort', waiter.abort)
          waiter.reject(new ExecutionResourceError('memory_pressure'))
        }
      }
    },
    assertAdmission,
    get retainedTextBytes() { return bytes },
  }
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('Invalid resource limit')
  return value
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('Operation cancelled')
}
