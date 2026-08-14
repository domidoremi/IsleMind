import type { AIProvider } from '@/types/providerContracts'
import { updateCredentialGroupHealth as applyCredentialGroupHealth } from './providerCredentialGroups'

export interface ProviderActivationPatch {
  id: string
  updates: Partial<AIProvider>
}

export interface ProviderActivationPatchBufferOptions {
  flushPatches: (patches: ProviderActivationPatch[], signal?: AbortSignal) => Promise<void>
  hydrateProviderKey: (id: string, signal?: AbortSignal) => Promise<AIProvider | null>
  flushLimit: number
  flushMs: number
  signal?: AbortSignal
}

export interface ProviderActivationPatchBuffer {
  enqueue(id: string, updates: Partial<AIProvider>): Promise<void>
  enqueueCredentialGroupHealth(id: string, groupId: string | undefined, ok: boolean): Promise<void>
  apply(id: string, provider: AIProvider | null): AIProvider | null
  flush(): Promise<void>
  close(): Promise<void>
  dispose(): void
}

const NO_BACKGROUND_FAILURE = Symbol('no-provider-activation-background-failure')

/**
 * Coalesces activation writes while retaining a read overlay for later hydration.
 *
 * Cancellation prevents hydration and queued/new persistence from starting. A
 * `flushPatches` call that is already running may still commit when its
 * persistence adapter cannot cancel in-flight work; the exact signal is passed
 * to the adapter so cancellable implementations can stop it.
 */
export function createProviderActivationPatchBuffer(
  options: ProviderActivationPatchBufferOptions,
): ProviderActivationPatchBuffer {
  const pending = new Map<string, Partial<AIProvider>>()
  const overlay = new Map<string, Partial<AIProvider>>()
  const flushLimit = Math.max(1, Math.floor(options.flushLimit))
  const flushMs = Math.max(0, options.flushMs)
  let timer: ReturnType<typeof setTimeout> | null = null
  let activeFlush: Promise<void> | null = null
  let backgroundFailure: unknown | typeof NO_BACKGROUND_FAILURE = NO_BACKGROUND_FAILURE
  let accepting = !options.signal?.aborted
  let closeRequested = false
  let closed = false
  let disposed = false

  const clearFlushTimer = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
  }

  const detachAbortListener = () => {
    options.signal?.removeEventListener('abort', handleAbort)
  }

  const handleAbort = () => {
    accepting = false
    clearFlushTimer()
    pending.clear()
    overlay.clear()
  }

  if (options.signal && !options.signal.aborted) {
    options.signal.addEventListener('abort', handleAbort, { once: true })
  } else if (options.signal?.aborted) {
    handleAbort()
  }

  const apply = (id: string, provider: AIProvider | null): AIProvider | null => {
    const updates = overlay.get(id)
    return provider && updates ? { ...provider, ...updates } as AIProvider : provider
  }

  const restoreFailedPatches = (patches: readonly ProviderActivationPatch[]) => {
    for (const patch of patches) {
      const newer = pending.get(patch.id)
      pending.set(patch.id, newer
        ? { ...patch.updates, ...newer }
        : patch.updates)
    }
  }

  const drainPending = async () => {
    while (pending.size) {
      throwIfAborted(options.signal)
      if (disposed) return
      const patches = Array.from(pending, ([id, updates]) => ({ id, updates }))
      pending.clear()
      try {
        await options.flushPatches(patches, options.signal)
      } catch (error) {
        if (options.signal?.aborted || disposed) {
          pending.clear()
          if (options.signal?.aborted) throw providerActivationAbortError(options.signal.reason)
          throw error
        }
        restoreFailedPatches(patches)
        throw error
      }
      if (options.signal?.aborted) {
        pending.clear()
        throw providerActivationAbortError(options.signal.reason)
      }
      if (disposed) {
        pending.clear()
        return
      }
    }
  }

  const beginFlush = (): Promise<void> => {
    if (activeFlush) return activeFlush
    const operation = drainPending()
    activeFlush = operation
    void operation.then(
      () => {
        if (activeFlush === operation) activeFlush = null
      },
      () => {
        if (activeFlush === operation) activeFlush = null
      },
    )
    return operation
  }

  const captureBackgroundFailure = (error: unknown) => {
    if (!disposed && backgroundFailure === NO_BACKGROUND_FAILURE) backgroundFailure = error
  }

  const consumeBackgroundFailure = () => {
    if (backgroundFailure === NO_BACKGROUND_FAILURE) return
    const error = backgroundFailure
    backgroundFailure = NO_BACKGROUND_FAILURE
    throw error
  }

  const awaitFlush = async () => {
    clearFlushTimer()
    consumeBackgroundFailure()
    if (disposed || closed) return
    throwIfAborted(options.signal)
    const operation = beginFlush()
    try {
      await operation
    } catch (error) {
      if (backgroundFailure === error) backgroundFailure = NO_BACKGROUND_FAILURE
      throw error
    }
  }

  const scheduleFlush = () => {
    if (timer || closeRequested || disposed || closed || options.signal?.aborted) return
    timer = setTimeout(() => {
      timer = null
      const operation = beginFlush()
      void operation.catch(captureBackgroundFailure)
    }, flushMs)
  }

  const ensureAccepting = () => {
    throwIfAborted(options.signal)
    if (!accepting || closeRequested || disposed || closed) {
      throw new Error('Provider activation patch buffer is closed')
    }
  }

  const enqueue = async (id: string, updates: Partial<AIProvider>) => {
    ensureAccepting()
    pending.set(id, { ...(pending.get(id) ?? {}), ...updates })
    overlay.set(id, { ...(overlay.get(id) ?? {}), ...updates })
    if (pending.size >= flushLimit) {
      await awaitFlush()
      return
    }
    scheduleFlush()
  }

  const close = async () => {
    if (disposed || closed) return
    accepting = false
    closeRequested = true
    clearFlushTimer()
    try {
      await awaitFlush()
      closed = true
      detachAbortListener()
    } catch (error) {
      if (options.signal?.aborted) {
        pending.clear()
        overlay.clear()
        closed = true
        detachAbortListener()
      }
      throw error
    }
  }

  const dispose = () => {
    if (disposed) return
    accepting = false
    closeRequested = true
    disposed = true
    closed = true
    clearFlushTimer()
    pending.clear()
    overlay.clear()
    backgroundFailure = NO_BACKGROUND_FAILURE
    detachAbortListener()
  }

  return {
    enqueue,
    enqueueCredentialGroupHealth: async (id, groupId, ok) => {
      if (!groupId) return
      ensureAccepting()
      const provider = apply(id, await options.hydrateProviderKey(id, options.signal))
      ensureAccepting()
      if (!provider?.credentialGroups?.some((group) => group.id === groupId)) return
      const updated = applyCredentialGroupHealth(provider, groupId, ok)
      await enqueue(id, { credentialGroups: updated.credentialGroups })
    },
    apply,
    flush: awaitFlush,
    close,
    dispose,
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw providerActivationAbortError(signal.reason)
}

function providerActivationAbortError(reason: unknown): Error {
  if (reason instanceof Error && reason.name === 'AbortError') return reason
  const error = new Error(reason instanceof Error ? reason.message : 'Provider activation was cancelled')
  error.name = 'AbortError'
  return error
}
