import { documentRevision } from './documentRevision'
import { fallbackProvidersForRequest } from '@/modules/providers'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import type { ProviderRuntimeChatRequest } from '@/modules/providers'

const mockState = {
  providers: [] as AIProvider[], settings: {} as Settings,
  hydrateProviderKey: jest.fn(),
}
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => mockState } }))
jest.mock('@/store/chatStore', () => ({ useChatStore: { getState: () => ({ conversations: [], loadAll: jest.fn() }) } }))
jest.mock('./knowledgeRepository', () => ({ knowledgeRepository: { readLocalSource: jest.fn() } }))
jest.mock('./providerRuntime', () => ({ streamProviderChat: jest.fn() }))
const { streamProviderChat } = jest.requireMock('./providerRuntime')

beforeEach(() => {
  mockState.providers = [{ id: 'local', type: 'openai-compatible', name: 'Local test model', enabled: true,
    apiKey: '', baseUrl: 'http://127.0.0.1:18085/v1', models: ['revision-model'], manualModels: ['revision-model'],
    modelConfigs: [{ id: 'revision-model', name: 'Revision model', provider: 'openai-compatible', contextWindow: 32768, maxTokens: 32768,
      maxOutputTokens: 4096, defaultMaxTokens: 2048, supportsVision: false, supportsFiles: false, chatCompatible: true }],
  }]
  mockState.settings = { providerAllowlist: [], providerBlocklist: [], modelAllowlist: [], modelBlocklist: [],
    payloadPolicyMode: 'block', proxyMode: 'off', remoteCompactMode: 'required', sessionConcurrencyLimit: 1 } as unknown as Settings
  mockState.hydrateProviderKey.mockReset().mockImplementation(async () => ({ ...mockState.providers[0], apiKey: 'synthetic-test-only' }))
  streamProviderChat.mockReset().mockImplementation(async (_request: unknown, _chunk: unknown, done: (value: unknown) => void) => {
    done({ text: 'Proposed body' })
    return { controller: new AbortController(), done: Promise.resolve() }
  })
})

function request() {
  return { draft: { title: 'Report', body: 'Keep this status pending.' }, instruction: 'Make it concise.', sources: [], target: documentRevision.listTargets()[0] }
}

it('uses the existing provider runtime with current access/privacy/session policy and explicit single-target, no-tool/no-search settings', async () => {
  expect(await documentRevision.propose(request(), new AbortController().signal)).toBe('Proposed body')
  expect(mockState.hydrateProviderKey).toHaveBeenCalledWith('local')
  const sent: ProviderRuntimeChatRequest = streamProviderChat.mock.calls[0][0]
  expect(sent).toMatchObject({ model: 'revision-model', stream: false, allowFallback: false, webSearchMode: 'off', remoteCompactEligible: false,
    settings: { payloadPolicyMode: 'block', sessionConcurrencyLimit: 1, remoteCompactMode: 'off', upstreamMaxRetries: 0 } })
  expect(sent.providerToolDeclarations).toBeUndefined()
  expect(sent.attachments).toBeUndefined()
  expect(sent.conversationId).toBeUndefined()
  expect(sent.previousResponseId).toBeUndefined()
  expect(sent.fallbackProviders).toBeUndefined()
  expect(fallbackProvidersForRequest(sent)).toEqual([])
  expect(fallbackProvidersForRequest({ provider: mockState.providers[0], model: 'revision-model' })).toEqual(mockState.providers)
  expect(fallbackProvidersForRequest({ provider: mockState.providers[0], model: 'revision-model', fallbackProviders: [] })).toEqual(mockState.providers)
})

it('requires completion rather than accepting a partial chunk, a failure or a tool call as the proposed body', async () => {
  for (const outcome of ['partial', 'error', 'tool']) {
    streamProviderChat.mockImplementation(async (_request: unknown, chunk: (value: string) => void, done: (value: unknown) => void, error: (value: Error) => void) => {
      chunk('Partial text')
      if (outcome === 'error') { done({ text: 'Looks successful' }); error(new Error('transport failed')) }
      if (outcome === 'tool') done({ text: 'Use a tool', providerToolCalls: [{ id: 'call', name: 'external-effect', arguments: {} }] })
      return { controller: new AbortController(), done: Promise.resolve() }
    })
    await expect(documentRevision.propose(request(), new AbortController().signal)).rejects.toMatchObject({ code: 'generationFailed' })
  }
})

it('rechecks target changes during credential hydration without silently rerouting', async () => {
  mockState.hydrateProviderKey.mockImplementation(async () => {
    const original = { ...mockState.providers[0] }
    mockState.providers = [{ ...original, baseUrl: 'http://127.0.0.1:18086/v1' }]
    return original
  })
  await expect(documentRevision.propose(request(), new AbortController().signal)).rejects.toMatchObject({ code: 'targetChanged' })
  expect(streamProviderChat).not.toHaveBeenCalled()
})

it('shows the configured proxy and excludes denied/disabled models and credential-bearing destinations', () => {
  mockState.settings.proxyMode = 'custom-base-url'
  mockState.settings.proxyBaseUrl = 'http://127.0.0.1:19000/proxy'
  expect(documentRevision.listTargets()[0].proxy).toBe(mockState.settings.proxyBaseUrl)
  mockState.settings.providerBlocklist = ['local']
  expect(documentRevision.listTargets()).toEqual([])
  mockState.settings.providerBlocklist = []
  mockState.providers[0].enabled = false
  expect(documentRevision.listTargets()).toEqual([])
  mockState.providers[0].enabled = true
  mockState.providers[0].baseUrl = 'https://example.test/v1?token=synthetic-private-marker'
  expect(documentRevision.listTargets()).toEqual([])
})

it('rejects model context overflow before dispatch without removing the draft', async () => {
  mockState.providers[0].modelConfigs![0].contextWindow = 512
  await expect(documentRevision.propose(request(), new AbortController().signal)).rejects.toMatchObject({ code: 'inputTooLong' })
  expect(streamProviderChat).not.toHaveBeenCalled()
})

it('propagates cancellation to the runtime and does not accept a late terminal callback', async () => {
  const controller = new AbortController()
  streamProviderChat.mockImplementation(async (sent: ProviderRuntimeChatRequest, _chunk: unknown, done: (value: unknown) => void) => {
    controller.abort()
    expect(sent.signal?.aborted).toBe(true)
    done({ text: 'Late text' })
    return { controller: new AbortController(), done: Promise.resolve() }
  })
  await expect(documentRevision.propose(request(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})
