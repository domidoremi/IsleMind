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
  const forwardAbort = () => controller.abort(init?.signal?.reason)
  if (init?.signal?.aborted) controller.abort(init.signal.reason)
  init?.signal?.addEventListener('abort', forwardAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImplementation(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    init?.signal?.removeEventListener('abort', forwardAbort)
  }
}

/** Fetches a streaming request while preserving runtimes that require an explicit body field. */
export async function fetchProviderStreamWithTimeout(
  fetchImplementation: (input: string, init?: RequestInit) => Promise<Response>,
  input: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(init?.signal?.reason)
  if (init?.signal?.aborted) controller.abort(init.signal.reason)
  init?.signal?.addEventListener('abort', forwardAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const body = init?.body ?? undefined
    return await fetchImplementation(input, { ...init, signal: controller.signal, body })
  } finally {
    clearTimeout(timeout)
    init?.signal?.removeEventListener('abort', forwardAbort)
  }
}

export async function safeProviderResponseText(response: Pick<Response, 'text'>): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}
