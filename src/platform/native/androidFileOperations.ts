export type AndroidNativeFileAction = 'scan' | 'mkdir' | 'copy' | 'move' | 'rename'
export type AndroidFileEffect = 'none' | 'applied' | 'partial' | 'uncertain'

export interface AndroidFileOperationReceipt {
  requestId: string
  action: AndroidNativeFileAction
  status: 'succeeded' | 'failed' | 'cancelled'
  effect: AndroidFileEffect
  reason?: string
  targetUri?: string
  /** Confirmed completed writes only; a failed stream write may have written more. */
  bytesCopied: number
  /** Provider-confirmed steps remain known even if a subsequent mutation is uncertain. */
  completedSteps?: readonly ('created' | 'copied' | 'moved' | 'renamed')[]
  data?: Record<string, unknown>
}

export interface AndroidFileOperationsNativeModule {
  fileOperationVersion: number
  executeFileOperation(id: string, action: AndroidNativeFileAction, input: Record<string, unknown>, timeoutMs: number): Promise<unknown>
  cancelFileOperation(id: string): Promise<unknown>
}

export interface AndroidFileOperationsPort {
  isAvailable(): boolean
  execute(action: AndroidNativeFileAction, input: Record<string, unknown>, signal?: AbortSignal,
    beforeDispatch?: (requestId: string) => Promise<void>): Promise<AndroidFileOperationReceipt>
}

interface Dependencies {
  os: string
  nativeModule?: AndroidFileOperationsNativeModule
}

let sequence = 0
const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/** No legacy write fallback: the old bridge cannot represent partial effects or cancellation. */
export function createAndroidFileOperationsPort(dependencies?: Dependencies): AndroidFileOperationsPort {
  let resolved = dependencies
  const runtime = () => {
    if (!resolved) {
      const { NativeModules, Platform } = require('react-native') as typeof import('react-native')
      resolved = { os: Platform.OS, nativeModule: NativeModules.AndroidDeviceTools }
    }
    return resolved
  }
  const isAvailable = () => {
    const { os, nativeModule } = runtime()
    return os === 'android' && nativeModule?.fileOperationVersion === 1
      && typeof nativeModule.executeFileOperation === 'function' && typeof nativeModule.cancelFileOperation === 'function'
  }
  return {
    isAvailable,
    async execute(action, input, signal, beforeDispatch) {
      const requestId = `saf-${sessionId}-${++sequence}`
      const failure = (reason: string, effect: AndroidFileEffect = 'none'): AndroidFileOperationReceipt => ({
        requestId, action, status: reason === 'cancelled' ? 'cancelled' : 'failed', effect, reason, bytesCopied: 0,
      })
      if (signal?.aborted) return failure('cancelled')
      if (!isAvailable()) return failure('unavailable')
      // This callback is the host's durable intent barrier. Never turn a failed
      // barrier into a bridge error or enter native execution without awaiting it.
      if (beforeDispatch) await beforeDispatch(requestId)
      if (signal?.aborted) return failure('cancelled')
      const native = runtime().nativeModule!
      const cancel = () => {
        // Do not race the native completion: it contains the actual (possibly partial) effect.
        try { void native.cancelFileOperation(requestId).catch(() => undefined) } catch { /* Receipt remains authoritative. */ }
      }
      try {
        const pending = native.executeFileOperation(requestId, action, input, 60_000)
        signal?.addEventListener('abort', cancel, { once: true })
        if (signal?.aborted) cancel()
        const value = await pending
        const receipt = parseReceipt(value, requestId, action)
        if (!receipt) return failure('invalid_receipt', action === 'scan' ? 'none' : 'uncertain')
        // Aborting while the result crosses the bridge must not erase a completed write.
        return receipt
      } catch {
        // A bridge rejection after dispatch provides no evidence that a write did not happen.
        return failure('bridge_error', action === 'scan' ? 'none' : 'uncertain')
      } finally {
        signal?.removeEventListener('abort', cancel)
      }
    },
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseReceipt(value: unknown, id: string, action: AndroidNativeFileAction): AndroidFileOperationReceipt | undefined {
  if (!record(value) || value.requestId !== id || value.action !== action
    || !['succeeded', 'failed', 'cancelled'].includes(String(value.status))
    || !['none', 'applied', 'partial', 'uncertain'].includes(String(value.effect))
    || typeof value.bytesCopied !== 'number' || !Number.isSafeInteger(value.bytesCopied) || value.bytesCopied < 0
    || value.bytesCopied > 64 * 1024 * 1024
    || value.effect === 'none' && (value.bytesCopied !== 0 || Array.isArray(value.completedSteps) && value.completedSteps.length !== 0)
    || (value.targetUri != null && (typeof value.targetUri !== 'string' || !value.targetUri.startsWith('content://') || value.targetUri.length > 4096))
    || (value.reason != null && (typeof value.reason !== 'string' || value.reason.length > 100))
    || (value.completedSteps != null && (!Array.isArray(value.completedSteps) || value.completedSteps.length > 2
      || value.completedSteps.some(step => !['created', 'copied', 'moved', 'renamed'].includes(step))))
  ) return undefined
  const data = record(value.data) ? value.data : undefined
  if (value.status === 'succeeded') {
    if (!data || value.effect === 'partial' || value.effect === 'uncertain') return undefined
    if (action === 'scan' && (!Array.isArray(data.entries) || data.entries.length > 1000 || typeof data.directoryUri !== 'string')) return undefined
    if (action === 'mkdir' && (typeof data.uri !== 'string' || !['created', 'existing'].includes(String(data.status)))) return undefined
    if (action !== 'scan' && action !== 'mkdir' && !['done', 'skipped'].includes(String(data.status))) return undefined
    const applied = action === 'mkdir' ? data.status === 'created' : data.status === 'done'
    if (action === 'scan') {
      if (value.effect !== 'none') return undefined
    } else if (value.effect !== (applied ? 'applied' : 'none')
      || data.ok !== (action === 'mkdir' || applied)
      || (applied && (typeof value.targetUri !== 'string'
        || (action === 'mkdir' ? data.uri : data.targetUri) !== value.targetUri))) return undefined
  }
  return {
    requestId: id, action, status: value.status as AndroidFileOperationReceipt['status'],
    effect: value.effect as AndroidFileEffect, bytesCopied: value.bytesCopied,
    reason: value.reason as string | undefined ?? undefined,
    targetUri: value.targetUri as string | undefined ?? undefined, data,
    completedSteps: value.completedSteps as AndroidFileOperationReceipt['completedSteps'],
  }
}
