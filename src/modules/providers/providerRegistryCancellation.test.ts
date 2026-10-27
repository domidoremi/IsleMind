import { createProviderRegistry } from './providerRegistry'

const registry = createProviderRegistry({
  translate: (_key, _variables, fallback) => fallback ?? 'local fixture',
  configurationIssue: () => null,
  resolveModelAccess: () => ({ allowed: true }),
  fetch: jest.fn() as unknown as typeof fetch,
})
const input = { baseUrl: 'https://probe.invalid/v1', apiKey: 'local-placeholder', name: 'Local probe' }

it('rejects an already cancelled interface probe without calling its transport', async () => {
  const abort = new AbortController()
  const reason = new Error('cancel before dispatch')
  abort.abort(reason)
  const fetcher = jest.fn()
  await expect(registry.probeProviderPreset(input, { fetch: fetcher as unknown as typeof fetch, signal: abort.signal })).rejects.toBe(reason)
  expect(fetcher).not.toHaveBeenCalled()
})

it('stops protocol fallback when a pending interface probe is cancelled', async () => {
  const abort = new AbortController()
  const reason = new Error('cancel active dispatch')
  const fetcher = jest.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('transport abort')); return }
    options.signal?.addEventListener('abort', () => reject(new Error('transport abort')), { once: true })
  }))
  const probing = registry.probeProviderPreset(input, { fetch: fetcher as unknown as typeof fetch, signal: abort.signal })
  const outcome = probing.catch(error => error)
  expect(fetcher).toHaveBeenCalledTimes(1)
  abort.abort(reason)
  expect(await outcome).toBe(reason)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('does not accept catalog parsing completed after cancellation as a successful probe', async () => {
  const abort = new AbortController()
  let parse!: (value: { data: unknown[] }) => void
  const parsed = new Promise<{ data: unknown[] }>(resolve => { parse = resolve })
  const fetcher = jest.fn(async () => ({ ok: true, status: 200, json: () => parsed }))
  const probing = registry.probeProviderPreset(input, { fetch: fetcher as unknown as typeof fetch, signal: abort.signal })
  const outcome = probing.catch(error => error)
  await Promise.resolve()
  const reason = new Error('cancel response parsing')
  abort.abort(reason)
  parse({ data: [] })
  expect(await outcome).toBe(reason)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
