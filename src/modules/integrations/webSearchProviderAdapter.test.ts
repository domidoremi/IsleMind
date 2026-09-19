import { createWebSearchProviderAdapter, type WebSearchProviderConfiguration } from './webSearchProviderAdapter'

const signal = () => new AbortController().signal
const emptyRss = '<rss><channel><title>Search</title></channel></rss>'
const resultHtml = '<html><body><div class="result__body"><a class="result__a" href="https://example.com/result">IsleMind release</a><a class="result__snippet">IsleMind release details</a></div></body></html>'

function adapter(fetch: jest.Mock, provider: WebSearchProviderConfiguration = { provider: 'islemind' }) {
  return createWebSearchProviderAdapter({ resolveConfiguration: async () => provider, fetch })
}

it('does not turn a service error in an HTTP 200 envelope into no results', async () => {
  const fetch = jest.fn().mockResolvedValue(Object.assign(new Response(), {
    json: async () => ({ error: { message: 'private service diagnostics' } }),
  }))
  await expect(adapter(fetch, { provider: 'custom', endpoint: 'https://search.example.com' })
    .search({ query: 'test' }, { signal: signal() }))
    .rejects.toMatchObject({ code: 'service_rejected', retryable: false, stage: 'response' })
})

it('distinguishes a response-body network failure from invalid JSON', async () => {
  const fetch = jest.fn().mockResolvedValue(Object.assign(new Response(), {
    json: async () => { throw Object.assign(new TypeError('terminated'), { cause: { code: 'ECONNRESET' } }) },
  }))
  await expect(adapter(fetch, { provider: 'custom', endpoint: 'https://search.example.com' })
    .search({ query: 'test' }, { signal: signal() }))
    .rejects.toMatchObject({ code: 'network_failed', retryable: true, stage: 'response' })
})

it('classifies invalid JSON as malformed data, including fetch errors from another realm', async () => {
  const fetch = jest.fn().mockResolvedValue(new Response('not JSON'))
  await expect(adapter(fetch, { provider: 'custom', endpoint: 'https://search.example.com' })
    .search({ query: 'test' }, { signal: signal() }))
    .rejects.toMatchObject({ code: 'malformed_response', retryable: false, stage: 'response' })
})

it.each([
  ['ENOTFOUND', 'dns_failed', true],
  ['CERT_HAS_EXPIRED', 'tls_failed', false],
  ['ECONNRESET', 'network_failed', true],
])('preserves %s instead of claiming no results', async (code, expected, retryable) => {
  const fetch = jest.fn().mockRejectedValue(Object.assign(new TypeError('private URL and credentials'), { cause: { code } }))
  await expect(adapter(fetch).search({ query: 'IsleMind release' }, { signal: signal() }))
    .rejects.toMatchObject({ code: expected, retryable, provider: 'islemind', service: 'bing-rss', stage: 'request' })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('preserves status and Retry-After without exposing a response body', async () => {
  const fetch = jest.fn().mockResolvedValue(new Response('private response', { status: 429, headers: { 'Retry-After': '30' } }))
  await expect(adapter(fetch).search({ query: 'IsleMind release' }, { signal: signal() }))
    .rejects.toMatchObject({ code: 'http_failed', status: 429, retryable: true, retryAfterMs: 30000 })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('can recover from primary rejection through the independent fallback service', async () => {
  const fetch = jest.fn().mockResolvedValueOnce(new Response('', { status: 403 })).mockResolvedValueOnce(new Response(resultHtml))
  await expect(adapter(fetch).search({ query: 'IsleMind release' }, { signal: signal() })).resolves.toMatchObject({ ok: true })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('distinguishes a valid empty response from malformed data', async () => {
  const fetch = jest.fn().mockResolvedValueOnce(new Response(emptyRss)).mockResolvedValueOnce(new Response('<html><body>No results.</body></html>'))
  await expect(adapter(fetch).search({ query: 'IsleMind release' }, { signal: signal() })).resolves.toMatchObject({ code: 'no_results' })
  const malformed = jest.fn().mockResolvedValue(new Response('not RSS or HTML'))
  await expect(adapter(malformed).search({ query: 'IsleMind release' }, { signal: signal() })).rejects.toMatchObject({ code: 'malformed_response' })
})

it('retains caller cancellation and never attempts fallback', async () => {
  const controller = new AbortController()
  const reason = new Error('cancelled by caller')
  const fetch = jest.fn(async () => { controller.abort(reason); throw reason })
  await expect(adapter(fetch).search({ query: 'IsleMind release' }, { signal: controller.signal })).rejects.toBe(reason)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('reports attempt timeouts distinctly after bounded fallback', async () => {
  jest.useFakeTimers()
  try {
    const fetch = jest.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    }))
    const pending = expect(adapter(fetch).search({ query: 'IsleMind release' }, { signal: signal() })).rejects.toMatchObject({ code: 'timed_out', retryable: true })
    await jest.runAllTimersAsync()
    await pending
    expect(fetch).toHaveBeenCalledTimes(2)
  } finally { jest.useRealTimers() }
})

it('rejects known browser-incompatible pages before any HTTP request', async () => {
  const fetch = jest.fn()
  const browser = createWebSearchProviderAdapter({ platform: 'web', fetch, resolveConfiguration: async () => ({ provider: 'islemind' }) })
  await expect(browser.search({ query: 'test' }, { signal: signal() })).rejects.toMatchObject({ code: 'browser_transport_required', retryable: false, stage: 'transport' })
  expect(fetch).not.toHaveBeenCalled()
})

it('uses only the explicitly configured browser search service, without a proxy or UA override', async () => {
  const fetch = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Object.assign(new Response(), { json: async () => ({ results: [{ title: 'test', url: 'https://example.com/result' }] }) }))
  const browser = createWebSearchProviderAdapter({ platform: 'web', fetch,
    resolveConfiguration: async () => ({ provider: 'custom', endpoint: 'https://search.example.com/?q={query}&count={limit}' }) })
  await expect(browser.search({ query: '中文 & test', limit: 2 }, { signal: signal() })).resolves.toMatchObject({ ok: true })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0]).toBe('https://search.example.com/?q=%E4%B8%AD%E6%96%87%20%26%20test&count=2')
  expect(fetch.mock.calls[0][1]?.headers).toBeUndefined()
})
