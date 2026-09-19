import { builtInWebSearchPort, searchExternalWeb } from './webSearchProviderRuntime'
import { createBuiltInCapabilityAdapter } from '@/modules/integrations'
import type { Settings } from '@/types/settingsContracts'
import type { ToolRequest, BuiltInCapabilityExecutionResult } from '@/modules/integrations'

jest.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => mockStore } }))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))

const mockStore = {
  settings: { webSearchEnabled: true, searchProvider: 'custom', customSearchEndpoint: 'https://search.example.com/?q={query}' } as Settings,
  getCustomSearchApiKey: async () => 'synthetic-test-key',
}
const originalFetch = globalThis.fetch
beforeEach(() => { mockStore.settings.searchProvider = 'custom' })
afterEach(() => { globalThis.fetch = originalFetch })

it.each([
  [401, 'authentication_failed', false], [403, 'service_rejected', false],
  [429, 'rate_limited', true], [500, 'upstream_error', true], [504, 'timed_out', true],
])('propagates HTTP %s through the actual tool receipt', async (status, code, retryable) => {
  globalThis.fetch = jest.fn(async () => new Response('secret response body', { status: Number(status), headers: { 'Retry-After': '10' } }))
  const adapter = createBuiltInCapabilityAdapter('search_web', {
    admission: { admit: async request => ({ status: 'allowed', taskId: request.taskId, toolId: request.toolId, grantedPermissions: ['network.remote'], confirmed: false }) },
    webSearch: builtInWebSearchPort,
  })
  const result = await adapter.execute({ taskId: 'test-task', tool: adapter.definition, arguments: { query: 'test' } } as unknown as ToolRequest,
    { signal: new AbortController().signal }) as BuiltInCapabilityExecutionResult
  expect(result.observation.ok).toBe(false)
  expect(result.capabilityOutcome).toMatchObject({ code, retryable, details: { stage: 'response', service: 'custom', httpStatus: status, retryAfterMs: 10000 } })
  expect(result.observation.metadata).toMatchObject({ capabilityOutcome: code, failureDetails: { httpStatus: status }, retryable })
  expect(JSON.stringify(result)).not.toMatch(/secret response|synthetic-test-key|search\.example/)
})

it('reports disabled and missing configuration as non-retryable, not empty results', async () => {
  mockStore.settings.searchProvider = 'off'
  await expect(builtInWebSearchPort.search({ query: 'test', limit: 5 }, { signal: new AbortController().signal, timeoutMs: 1000 }))
    .rejects.toMatchObject({ code: 'capability_unavailable', retryable: false })
  mockStore.settings.searchProvider = 'google'
  Object.assign(mockStore, { getGoogleSearchApiKey: async () => '' })
  await expect(builtInWebSearchPort.search({ query: 'test', limit: 5 }, { signal: new AbortController().signal, timeoutMs: 1000 }))
    .rejects.toMatchObject({ code: 'configuration_required', retryable: false })
})

it('returns an empty tool result only for a successful search with no matches', async () => {
  // Node's Response.json parses in the host realm; the adapter deliberately
  // accepts plain objects from its own runtime, as browser/native fetch returns.
  globalThis.fetch = jest.fn(async () => Object.assign(new Response(), { json: async () => ({ results: [] }) }))
  await expect(builtInWebSearchPort.search({ query: 'test', limit: 5 }, { signal: new AbortController().signal, timeoutMs: 1000 })).resolves.toEqual([])
})

it('keeps opaque browser network failures distinct from confirmed CORS restrictions', async () => {
  globalThis.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch https://secret.example') })
  await expect(searchExternalWeb('test')).rejects.toMatchObject({ code: 'network_failed', details: { stage: 'request' } })
})
