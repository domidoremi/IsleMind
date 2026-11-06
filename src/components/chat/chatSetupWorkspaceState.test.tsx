import { act, renderHook } from '@testing-library/react-native'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { AIProvider } from '@/types/providerContracts'
import { useChatSetupWorkspaceState } from './chatSetupWorkspaceState'

jest.mock('@/bootstrap/providerModelAccess', () => ({
  ...jest.requireActual('@/bootstrap/providerModelAccess'),
  getProviderModelDisplayCandidates: ({ providers }: { providers: AIProvider[] }) => providers.map(provider => ({ provider })),
  hasProviderModelAccessRules: () => false,
  resolveProviderModelAliasAccess: ({ model }: { model: string }) => ({ allowed: model !== 'blocked' }),
}))
jest.mock('./chatModelSelection', () => ({
  ...jest.requireActual('./chatModelSelection'),
  pickReadyProviderForNewConversation: (providers: AIProvider[]) => providers[0],
  getPolicyAllowedProviderModels: (provider: AIProvider, _settings: unknown, options?: { limit?: number }) =>
    (provider.models ?? []).slice(0, options?.limit),
  getPolicyPreferredProviderModel: (provider: AIProvider) => provider.models?.[0],
}))

const provider = {
  id: 'one',
  name: 'Local fixture',
  type: 'openai',
  baseUrl: 'https://unused.invalid/v1',
  enabled: true,
  lastModelSyncStatus: 'ok',
  models: ['model-a', 'model-b'],
} as AIProvider

function options(providers: AIProvider[] = [provider]) {
  return {
    active: true,
    providers,
    settings: useSettingsStore.getState().settings,
    conversation: null,
    composerOutputMode: 'auto' as const,
    modelAccessSettings: {},
    dialog: {
      toast: jest.fn(),
      confirm: jest.fn(),
      notice: jest.fn(),
      banner: jest.fn(),
      dismissBanner: jest.fn(),
      hasPendingDialogs: jest.fn(() => false),
      subscribeDialogs: jest.fn(),
    },
    applyQuickStartDraft: jest.fn(),
    createConversation: jest.fn(),
    markChromeActive: jest.fn(),
    setComposerPanel: jest.fn(),
    setShowOptions: jest.fn(),
    updateConversation: jest.fn(),
    t: ((key: string) => key) as never,
  }
}

afterEach(() => jest.restoreAllMocks())

it('carries the selected plan to a newly created conversation and clears it for a regular model', async () => {
  jest.spyOn(useChatStore.getState(), 'select').mockImplementation(() => undefined)
  jest.spyOn(useSettingsStore.getState(), 'rememberPreferredModel').mockResolvedValue(undefined)
  const plan = { schema: 'islemind.model-routing-plan.v1' as const, id: 'stable', name: 'Stable', mode: 'fixed' as const,
    primary: { providerId: provider.id, model: 'model-b' }, crossProvider: 'ask' as const }
  const input = options(); input.createConversation.mockReturnValue('new-plan-chat')
  const screen = await renderHook(() => useChatSetupWorkspaceState(input))
  await act(() => { expect(screen.result.current.switchSetupProviderModel(provider, 'model-b', plan)).toBe(true) })
  expect(screen.result.current.setupConversation.routingPlan).toEqual(plan)
  await act(async () => { await screen.result.current.submitSetup('hello', []) })
  expect(input.updateConversation).toHaveBeenCalledWith('new-plan-chat', expect.objectContaining({ routingPlan: plan }))
  await act(() => { screen.result.current.switchSetupProviderModel(provider, 'model-a') })
  expect(screen.result.current.setupConversation.routingPlan).toBeUndefined()
})

it('returns setup selection success without creating a conversation or emitting a success toast', async () => {
  const remember = jest.spyOn(useSettingsStore.getState(), 'rememberPreferredModel').mockResolvedValue(undefined)
  const input = options()
  const screen = await renderHook(() => useChatSetupWorkspaceState(input))
  await act(() => {
    expect(screen.result.current.switchSetupProviderModel(provider, 'model-b')).toBe(true)
  })
  expect(screen.result.current.setupConversation.model).toBe('model-b')
  expect(remember).toHaveBeenCalledWith(provider.id, 'model-b')
  expect(input.dialog.toast).not.toHaveBeenCalled()
  expect(input.createConversation).not.toHaveBeenCalled()
})

it('returns rejection without changing setup selection or preferences', async () => {
  const remember = jest.spyOn(useSettingsStore.getState(), 'rememberPreferredModel').mockResolvedValue(undefined)
  const input = options()
  const screen = await renderHook(() => useChatSetupWorkspaceState(input))
  const before = screen.result.current.setupConversation.model
  await act(() => {
    expect(screen.result.current.switchSetupProviderModel(provider, 'blocked')).toBe(false)
  })
  expect(screen.result.current.setupConversation.model).toBe(before)
  expect(remember).not.toHaveBeenCalled()
  expect(input.dialog.toast).not.toHaveBeenCalled()
})

it('preserves the warning when saving a new-chat preference fails after local selection', async () => {
  jest.spyOn(useSettingsStore.getState(), 'rememberPreferredModel').mockRejectedValue(new Error('disk unavailable'))
  const input = options()
  const screen = await renderHook(() => useChatSetupWorkspaceState(input))
  await act(async () => {
    expect(screen.result.current.switchSetupModel('model-b')).toBe(true)
    await Promise.resolve()
  })
  expect(screen.result.current.setupConversation.model).toBe('model-b')
  expect(input.dialog.toast).toHaveBeenCalledTimes(1)
  expect(input.dialog.toast).toHaveBeenCalledWith({ title: 'chat.preferredModelSaveFailed', tone: 'amber' })
})

it('cannot select a setup model without an available provider', async () => {
  const input = options([])
  const screen = await renderHook(() => useChatSetupWorkspaceState(input))
  expect(screen.result.current.switchSetupModel('model-b')).toBe(false)
  expect(input.dialog.toast).not.toHaveBeenCalled()
})

it('preserves a model beyond both samples when creating a new chat', async () => {
  jest.spyOn(useSettingsStore.getState(), 'rememberPreferredModel').mockResolvedValue(undefined)
  jest.spyOn(useChatStore.getState(), 'select').mockImplementation(() => undefined)
  const gateway = {
    ...provider,
    models: Array.from({ length: 213 }, (_, index) => `supplier/model-${index}`),
  }
  const selectedModel = gateway.models[200]!
  const input = options([gateway])
  input.createConversation.mockReturnValue('large-catalog-selection')
  const screen = await renderHook(() => useChatSetupWorkspaceState(input))

  await act(() => {
    expect(screen.result.current.switchSetupProviderModel(gateway, selectedModel)).toBe(true)
  })
  expect(screen.result.current.setupConversation.model).toBe(selectedModel)

  await act(async () => {
    await screen.result.current.submitSetup('hello', [])
  })
  expect(input.createConversation).toHaveBeenCalledWith(gateway.id, selectedModel)
})
