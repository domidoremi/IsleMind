import { setExecutionTimeout, clearExecutionTimeout } from '@/core/executionTimers'
export function providerEndpointHost(url: string): string | undefined {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

export function toProviderWebSocketUrl(url: string): string {
  const parsed = new URL(url)
  parsed.protocol = parsed.protocol === 'http:' ? 'ws:' : 'wss:'
  return parsed.toString()
}

export async function fetchProviderWithTimeout(
  fetchImplementation: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  // Keep caller/whole-operation cancellation connected after headers, as for streams.
  const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal
  const timeout = setExecutionTimeout(() => controller.abort(), timeoutMs)
  try {
    // Never forward provider credentials or prompt bodies to a redirect target.
    // Manual callers (e.g. quota queries) inspect the original 3xx themselves.
    return await fetchImplementation(input, { ...init, signal, redirect: init?.redirect === 'manual' ? 'manual' : 'error' })
  } finally {
    clearExecutionTimeout(timeout)
  }
}

/** One configured deadline for headers, body consumption and every page of an operation. */
export async function withProviderOperationTimeout<T>(
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal, wait: <Value>(pending: Promise<Value>) => Promise<Value>) => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid provider operation timeout')
  const controller = new AbortController()
  const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal
  const timeout = setExecutionTimeout(() => {
    const error = new Error('The provider operation timed out')
    error.name = 'TimeoutError'
    controller.abort(error)
  }, timeoutMs)
  const wait = <Value>(pending: Promise<Value>) => new Promise<Value>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Provider operation aborted'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
  try { return await wait(operation(signal, wait)) }
  finally { clearExecutionTimeout(timeout) }
}

/** Fetches a streaming request while preserving runtimes that require an explicit body field. */
export async function fetchProviderStreamWithTimeout(
  fetchImplementation: (input: string, init?: RequestInit) => Promise<Response>,
  input: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  // Only the timeout ends at headers. Caller cancellation must still reach
  // the native request while its body is open: Expo reader.cancel() alone
  // can leave Android's socket read blocked. Expo installs AbortSignal.any.
  const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal
  const timeout = setExecutionTimeout(() => controller.abort(), timeoutMs)
  try {
    const body = init?.body ?? undefined
    return await fetchImplementation(input, { ...init, signal, body, redirect: init?.redirect === 'manual' ? 'manual' : 'error' })
  } finally {
    clearExecutionTimeout(timeout)
  }
}

export const MAX_PROVIDER_RESPONSE_CHARACTERS = 4 * 1024 * 1024
export class ProviderResponseLimitError extends Error {
  constructor() { super('Provider response exceeds the text parsing limit'); this.name = 'ProviderResponseLimitError' }
}

export async function safeProviderResponseText(response: Pick<Response, 'text'> & Partial<Pick<Response, 'body' | 'headers'>>): Promise<string> {
  const contentLength = Number(response.headers?.get('content-length'))
  if (contentLength > MAX_PROVIDER_RESPONSE_CHARACTERS * 4) {
    void response.body?.cancel().catch(() => undefined)
    throw new ProviderResponseLimitError()
  }
  const reader = response.body?.getReader?.()
  try {
    if (!reader) {
      // Older RN transports buffer natively. Reject before JSON parsing even
      // when their native allocation cannot be interrupted from JavaScript.
      const text = await response.text()
      if (text.length > MAX_PROVIDER_RESPONSE_CHARACTERS) throw new ProviderResponseLimitError()
      return text
    }
    const decoder = new TextDecoder()
    const chunks: string[] = []
    let characters = 0
    let pending = ''
    let reads = 0
    while (true) {
      const { done, value } = await reader.read()
      if (value && value.byteLength > MAX_PROVIDER_RESPONSE_CHARACTERS * 4) throw new ProviderResponseLimitError()
      const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true })
      characters += chunk.length
      if (characters > MAX_PROVIDER_RESPONSE_CHARACTERS) throw new ProviderResponseLimitError()
      // Network chunk boundaries are untrusted. Coalesce small/empty chunks so
      // the retained array is bounded by text size, not packet fragmentation.
      pending += chunk
      if (pending.length >= 4096 || done) { if (pending) chunks.push(pending); pending = '' }
      if (done) return chunks.join('')
      if (++reads % 16 === 0) await new Promise<void>((resolve) => setExecutionTimeout(resolve, 0))
    }
  } catch (error) {
    if (reader) await reader.cancel().catch(() => undefined)
    if (error instanceof ProviderResponseLimitError) throw error
    return ''
  } finally {
    reader?.releaseLock()
  }
}
