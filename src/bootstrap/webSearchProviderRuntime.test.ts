import { builtInWebSearchPort, searchExternalWeb } from './webSearchProviderRuntime'
import { createBuiltInCapabilityAdapter } from '@/modules/integrations'
import type { Settings } from '@/types/settingsContracts'
import type { ToolRequest, BuiltInCapabilityExecutionResult } from '@/modules/integrations'

jest.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => mockStore } }))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))

const mockStore = {
  settings: { webSearchEnabled: true, searchProvider: 'custom', customSearchEndpoint: 'https://search.example.com/?q={query}' } as Settings,
  getCustomSearchApiKey: jest.fn(async () => 'synthetic-test-key'),
  getGoogleSearchApiKey: jest.fn(async () => 'synthetic-test-key'),
  getBingSearchApiKey: jest.fn(async () => 'synthetic-test-key'),
  getTavilyApiKey: jest.fn(async () => 'synthetic-test-key'),
}
const originalFetch = globalThis.fetch
beforeEach(() => {
  mockStore.settings = { webSearchEnabled: true, searchProvider: 'custom', customSearchEndpoint: 'https://search.example.com/?q={query}' } as Settings
  for (const read of [mockStore.getCustomSearchApiKey, mockStore.getGoogleSearchApiKey, mockStore.getBingSearchApiKey, mockStore.getTavilyApiKey]) {
    read.mockReset().mockResolvedValue('synthetic-test-key')
  }
})
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
  mockStore.getGoogleSearchApiKey.mockResolvedValue('')
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

it.each(['custom', 'google', 'bing'] as const)('captures the %s endpoint fields before async credential admission', async provider => {
  let release!: (key: string) => void
  const credential = new Promise<string>(resolve => { release = resolve })
  mockStore.settings = {
    ...mockStore.settings, searchProvider: provider, googleSearchCx: 'reviewed-engine',
    customSearchEndpoint: 'https://reviewed.example.com/?q={query}',
  } as Settings
  const read = provider === 'custom' ? mockStore.getCustomSearchApiKey : provider === 'google' ? mockStore.getGoogleSearchApiKey : mockStore.getBingSearchApiKey
  read.mockReturnValueOnce(credential)
  globalThis.fetch = jest.fn(async () => Object.assign(new Response(), { json: async () => ({ results: [], items: [], webPages: { value: [] } }) }))
  const pending = searchExternalWeb('reviewed')
  mockStore.settings.customSearchEndpoint = 'https://changed.example.com/?q={query}'
  mockStore.settings.googleSearchCx = 'changed-engine'
  mockStore.settings.searchProvider = 'off'
  release('synthetic-reviewed-key')
  await pending
  const url = String(jest.mocked(globalThis.fetch).mock.calls[0][0])
  if (provider === 'google') expect(url).toContain('reviewed-engine')
  else expect(url).toContain('reviewed.example.com')
  expect(url).not.toMatch(/changed\.example|changed-engine/)
})

it('uses a detached explicit flat search configuration without reading live settings or credentials', async () => {
  const configuration = { provider: 'custom' as const, apiKey: 'synthetic-reviewed-key', endpoint: 'https://reviewed.example.com/?q={query}' }
  globalThis.fetch = jest.fn(async () => Object.assign(new Response(), { json: async () => ({ results: [] }) }))
  mockStore.settings.searchProvider = 'off'
  const pending = searchExternalWeb('reviewed', 3, { configuration })
  configuration.endpoint = 'https://changed.example.com/?q={query}'; configuration.apiKey = 'synthetic-changed-key'
  await pending
  expect(mockStore.getCustomSearchApiKey).not.toHaveBeenCalled()
  expect(String(jest.mocked(globalThis.fetch).mock.calls[0][0])).toContain('reviewed.example.com')
})

it('selects credentials from explicitly admitted settings rather than the live search provider', async () => {
  globalThis.fetch = jest.fn(async () => Object.assign(new Response(), { json: async () => ({ results: [] }) }))
  const settings: Settings = { ...mockStore.settings, searchProvider: 'tavily' }
  const pending = searchExternalWeb('reviewed', 3, { settings })
  settings.searchProvider = 'off'
  await pending
  expect(mockStore.getTavilyApiKey).toHaveBeenCalledTimes(1)
  expect(mockStore.getCustomSearchApiKey).not.toHaveBeenCalled()
  expect(String(jest.mocked(globalThis.fetch).mock.calls[0][0])).toContain('tavily')
})

it('does not resolve credentials or dispatch fetch when search is already cancelled', async () => {
  const controller = new AbortController(); controller.abort()
  globalThis.fetch = jest.fn()
  await expect(searchExternalWeb('reviewed', 3, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(mockStore.getCustomSearchApiKey).not.toHaveBeenCalled()
  expect(globalThis.fetch).not.toHaveBeenCalled()
})

it('keeps the original search signal when options change during an admitted credential read', async () => {
  let release!: (key: string) => void
  mockStore.getCustomSearchApiKey.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
  globalThis.fetch = jest.fn()
  const controller = new AbortController(), options = { signal: controller.signal }
  const pending = searchExternalWeb('reviewed', 3, options)
  const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  options.signal = new AbortController().signal; controller.abort()
  release('synthetic-reviewed-key')
  await check
  expect(globalThis.fetch).not.toHaveBeenCalled()
})
