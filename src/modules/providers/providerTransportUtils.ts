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
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImplementation(input, { ...init, signal })
  } finally {
    clearTimeout(timeout)
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
  const timeout = setTimeout(() => {
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
  finally { clearTimeout(timeout) }
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
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const body = init?.body ?? undefined
    return await fetchImplementation(input, { ...init, signal, body })
  } finally {
    clearTimeout(timeout)
  }
}

export async function safeProviderResponseText(response: Pick<Response, 'text'>): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}
