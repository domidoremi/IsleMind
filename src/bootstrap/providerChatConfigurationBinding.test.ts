import { conversationProviderAdmissionRuntime } from './conversationProviderAdmissionRuntime'
import { providerChatResolutionRuntime } from './providerChatResolutionRuntime'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'

const mockOnline = jest.fn()
const mockHydrate = jest.fn()
const mockConfirm = jest.fn()
const mockAvailability = jest.fn()
let mockProviders: AIProvider[]
let mockSettings: Settings

jest.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => ({
  providers: mockProviders, settings: mockSettings, hydrateProviderKey: mockHydrate,
}) } }))
jest.mock('expo-network', () => ({ getNetworkStateAsync: (...args: unknown[]) => mockOnline(...args) }))
jest.mock('@/modules/providers', () => ({
  ...jest.requireActual('@/modules/providers/providerChatResolution'),
  ...jest.requireActual('@/modules/providers/providerConversationAdmissionRuntime'),
  ...jest.requireActual('@/modules/providers/providerConfigurationMutation'),
  indexProviderHealthRecords: () => ({}),
  resolveProviderEndpointVariant: () => 'native',
  requiredFallbackCapabilities: () => ['text'],
  requestProviderFallbackConfirmation: (...args: unknown[]) => mockConfirm(...args),
}))
jest.mock('./providerFallbackCandidates', () => ({
  buildProviderFallbackCandidates: jest.requireActual('@/modules/providers/providerFallbackCandidates')
    .createProviderFallbackCandidateBuilder({
      projectModel: (_provider: unknown, model: string) => ({ deprecated: false, upstreamModel: model, capabilities: ['text'] }),
    }),
}))
jest.mock('@/bootstrap/providerModelAccess', () => ({
  providerHasPolicyModel: () => true,
  resolveProviderModelAliasAccess: (input: { provider: AIProvider; model: string; settings?: Settings }) => ({
    allowed: !input.settings?.modelBlocklist?.includes(input.model),
  }),
}))
jest.mock('@/bootstrap/providerConversationGeneration', () => ({
  resolveConversationGenerationParameterRequest: (input: { conversation: Conversation }) => ({
    temperature: input.conversation.temperature, maxTokens: input.conversation.maxTokens,
  }),
}))
jest.mock('@/types/modelCatalog', () => ({ getModelConfig: () => ({}) }))
jest.mock('@/types/providerBaseUrls', () => ({ getProviderConfigIssue: () => null }))
jest.mock('@/utils/providerModels', () => ({ resolveProviderModelAlias: (_provider: AIProvider, model: string) => model }))
jest.mock('./providerHealthRepository', () => ({ loadProviderHealthSnapshot: async () => ({ records: [] }) }))
jest.mock('./providerModelAvailabilityRuntime', () => ({
  captureProviderModelDispatchEvidence: () => () => undefined,
  providerModelAvailabilityRuntime: { captureConfiguration: () => () => undefined,
    getAvailability: (...args: unknown[]) => mockAvailability(...args) },
}))
jest.mock('./providerRequestBinding', () => ({ resolveProviderProtocolAdapter: () => ({ id: 'openai-chat' }) }))
jest.mock('./providerRuntimeHealth', () => ({
  resolveProviderRuntimeHealthView: async () => undefined,
  captureProviderRuntimeHealthDispatch: () => () => undefined,
}))
jest.mock('./providerPolicies', () => ({ getHostedProviderSupportIssue: () => null }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail })
  return { promise, resolve, reject }
}
const tick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }
function provider(id: string): AIProvider {
  return { id, name: id, type: 'openai', enabled: true, models: ['one', 'two'],
    apiKey: '', apiKeySource: { kind: 'none' } }
}
function input() {
  return { conversation: { id: 'conversation', title: 'Original', providerId: 'a', model: 'one',
    messages: [], systemPrompt: '', temperature: 0, maxTokens: 8, createdAt: 1, updatedAt: 1 } as Conversation,
  settings: mockSettings, providers: mockProviders.slice(), signal: new AbortController().signal }
}
beforeEach(() => {
  jest.clearAllMocks()
  mockProviders = [provider('a'), provider('b')]
  mockSettings = { modelBlocklist: [] } as unknown as Settings
  mockOnline.mockImplementation(async () => ({ isConnected: true, isInternetReachable: true }))
  mockConfirm.mockImplementation(async () => true)
  mockAvailability.mockImplementation(async (identity: { providerId: string }) => ({
    scope: { scopeId: identity.providerId, epoch: 'epoch-1' }, availability: 'unknown',
  }))
  mockHydrate.mockImplementation(async (id: string, options?: { providers?: readonly AIProvider[] }) => {
    const selected = (options?.providers ?? mockProviders).find(value => value.id === id)
    return selected ? { ...selected, apiKey: `fixture-${id}`, apiKeySource: { kind: 'primary' } } : null
  })
})

it('passes the conversation-admitted catalog to secure hydration instead of selecting a later store catalog', async () => {
  const online = deferred<{ isConnected: boolean; isInternetReachable: boolean }>()
  mockOnline.mockImplementationOnce(() => online.promise)
  const admitted = input()
  const pending = conversationProviderAdmissionRuntime.admitConversation(admitted)
  mockProviders = [provider('later-only')]
  online.resolve({ isConnected: true, isInternetReachable: true })
  await expect(pending).resolves.toMatchObject({ kind: 'ready', provider: { id: 'a', apiKey: 'fixture-a' } })
  expect(mockHydrate.mock.calls.map(([id]) => id)).toEqual(['a', 'b'])
  for (const [, options] of mockHydrate.mock.calls) {
    expect(options).toMatchObject({ providers: [provider('a'), provider('b')], signal: admitted.signal })
  }
})

it('captures an old caller catalog once and forwards its original signal before the first secure read', async () => {
  const read = deferred<AIProvider>()
  mockHydrate.mockImplementationOnce(() => read.promise)
  const signal = new AbortController().signal
  const pending = providerChatResolutionRuntime.resolvePreferred({ preferred: { providerId: 'a', model: 'one' }, signal })
  await tick()
  mockProviders.push(provider('later-provider'))
  read.resolve({ ...provider('a'), apiKey: 'fixture-a', apiKeySource: { kind: 'primary' } })
  await expect(pending).resolves.toMatchObject({ kind: 'ready', selection: { provider: { id: 'a' } } })
  expect(mockHydrate.mock.calls.map(([id]) => id)).toEqual(['a', 'b'])
  for (const [, options] of mockHydrate.mock.calls) {
    expect(options).toMatchObject({ providers: [provider('a'), provider('b')], signal })
  }
})

it('settles the original secure read and does not hydrate another provider after cancellation', async () => {
  const read = deferred<AIProvider>()
  mockHydrate.mockImplementationOnce(() => read.promise)
  const controller = new AbortController()
  const pending = providerChatResolutionRuntime.resolvePreferred({
    preferred: { providerId: 'a', model: 'one' }, providers: mockProviders.slice(),
    signal: controller.signal, settings: mockSettings,
  })
  await tick()
  controller.abort()
  read.resolve({ ...provider('a'), apiKey: 'fixture-a', apiKeySource: { kind: 'primary' } })
  await expect(pending).resolves.toEqual({ kind: 'cancelled' })
  expect(mockHydrate).toHaveBeenCalledTimes(1)
  expect(mockHydrate.mock.calls[0][1]).toMatchObject({ signal: controller.signal })
  expect(mockAvailability).not.toHaveBeenCalled()
})

it('keeps supplied settings stable without bypassing live blocklist revocation during confirmation', async () => {
  mockProviders[0].enabled = false
  const admitted = input()
  admitted.settings = { modelBlocklist: [] } as unknown as Settings
  mockConfirm.mockImplementationOnce(async () => {
    mockSettings = { ...mockSettings, modelBlocklist: ['one', 'two'] }
    return true
  })
  await expect(conversationProviderAdmissionRuntime.admitConversation(admitted)).resolves.toMatchObject({
    kind: 'rejected',
  })
  expect(mockConfirm).toHaveBeenCalledTimes(1)
})

it.each(['metadata', 'key', 'scope'] as const)('does not transfer fallback confirmation after a %s change', async change => {
  mockProviders[0].enabled = false
  const admitted = input()
  mockHydrate.mockImplementation(async (id: string, options?: { providers?: readonly AIProvider[] }) => {
    const expected = (options?.providers ?? mockProviders).find(value => value.id === id)
    const current = mockProviders.find(value => value.id === id)
    if (expected && current && expected.name !== current.name) throw new Error('provider_configuration_conflict')
    return expected ? { ...expected, apiKey: `fixture-${id}`, apiKeySource: { kind: 'primary' } } : null
  })
  mockConfirm.mockImplementationOnce(async () => {
    if (change === 'metadata') mockProviders[1] = { ...mockProviders[1], name: 'changed' }
    if (change === 'key') {
      mockHydrate.mockImplementation(async (id: string, options?: { providers?: readonly AIProvider[] }) => {
        const expected = (options?.providers ?? mockProviders).find(value => value.id === id)
        return expected ? { ...expected, apiKey: id === 'b' ? '' : 'fixture-a' } : null
      })
    }
    if (change === 'scope') mockAvailability.mockImplementation(async (identity: { providerId: string }) => ({
      scope: { scopeId: identity.providerId, epoch: 'epoch-2' }, availability: 'unknown',
    }))
    return true
  })
  const outcome = await conversationProviderAdmissionRuntime.admitConversation(admitted).catch(() => ({ kind: 'configuration-conflict' }))
  expect(outcome.kind).not.toBe('ready')
  expect(mockConfirm).toHaveBeenCalledTimes(1)
})
