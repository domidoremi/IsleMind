import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import { Keyboard, Platform, ScrollView, StyleSheet, TextInput, type KeyboardEvent, type View } from 'react-native'
import type { useKeyboardScrollViewport } from '@/presentation/layout/useKeyboardScrollViewport'
import { ChatOptionsPanel } from './ChatOptionsPanel'
import { useSettingsStore } from '@/store/settingsStore'
import { getColors } from '@/theme/colors'
import { getSettingsModelIdentityKey, SETTINGS_MODEL_FAVORITE_LIMIT } from '@/modules/settings'
import { resolveProviderEndpointVariant, type ProviderModelCurrent } from '@/modules/providers'
import { getModelConfig } from '@/types/modelCatalog'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import { bindSettingsStorePersistence, flushPersistedSettings, releaseSettingsStorePersistence, type SettingsStorePersistence } from '@/presentation/features/settings/settingsStorePersistenceCommand'

let mockKeyboardViewport: ReturnType<typeof useKeyboardScrollViewport> | undefined
const mockGetProviderParameterEntry = jest.fn()
const mockResolveRequestParameters = jest.fn()

let mockThemeId: CanonicalThemeId = 'minimal'
let mockNetwork = { isConnected: true, isInternetReachable: true }
const mockListModels = jest.fn(async (_input: { providerId: string; modelId: string; limit: number }): Promise<readonly ProviderModelCurrent[]> => [])
const mockRefresh = jest.fn()
const mockRetest = jest.fn()
const mockUpdateConversation = jest.fn()
const mockI18n = { language: 'en', resolvedLanguage: undefined as string | undefined }
jest.mock('react-i18next', () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t, i18n: mockI18n }) }
})
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
}))
jest.mock('@/presentation/layout/useKeyboardScrollViewport', () => ({
  useKeyboardScrollViewport: (key: string) => {
    const viewport = jest.requireActual('@/presentation/layout/useKeyboardScrollViewport').useKeyboardScrollViewport(key)
    mockKeyboardViewport = viewport
    return viewport
  },
}))
jest.mock('expo-network', () => ({ useNetworkState: () => mockNetwork }))
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: jest.requireActual('@/theme/colors').getColors('light', mockThemeId),
    canonicalThemeId: mockThemeId, isLiquidGlass: mockThemeId === 'liquid-glass', isMonet: mockThemeId === 'monet',
  }),
}))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { strong: 2 } }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, View, Text } = jest.requireActual('react-native')
  return { ISLE_MIN_TOUCH_TARGET: 44, IslePressable: Pressable, IsleChip: Text,
    IslePanel: ({ children, style, contentStyle }: { children: React.ReactNode; style: object; contentStyle: object }) => <View style={[style, contentStyle]}>{children}</View> }
})
jest.mock('@/store/chatStore', () => ({ useChatStore: (select: (state: unknown) => unknown) => select({ updateConversation: mockUpdateConversation }) }))
jest.mock('@/bootstrap/providerModelAvailabilityRuntime', () => ({
  providerModelAvailabilityPort: { listCurrentModels: (input: Parameters<typeof mockListModels>[0]) => mockListModels(input), refresh: mockRefresh, retest: mockRetest },
  providerModelAvailabilityIntegrationProfile: { pageSize: 50 },
  providerModelAvailabilityRuntime: { invalidateAll: jest.fn(), clear: jest.fn() },
  withProviderModelAvailabilityChanges: async (_ids: string[], mutate: () => Promise<unknown>) => mutate(),
}))
jest.mock('@/bootstrap/providerRequestBinding', () => ({ resolveProviderProtocolAdapter: () => ({ id: 'openai-chat' }) }))
jest.mock('@/bootstrap/providerConversationGeneration', () => ({
  getConversationReasoningEffortOptions: () => [],
  resolveConversationGenerationParameterRanges: () => ({
    temperature: { min: 0, max: 2 }, topP: { min: 0, max: 1 }, topK: { min: 0, max: 100 }, maxTokens: { min: 1, max: 4096 },
  }),
}))
jest.mock('@/bootstrap/providerRequestPolicies', () => ({ resolveProviderRequestParameters: () => mockResolveRequestParameters() }))
jest.mock('@/bootstrap/providerParameterMatrix', () => ({ getProviderParameterEntry: () => mockGetProviderParameterEntry() }))
jest.mock('@/bootstrap/conversationProviderNativeSearchAdmission', () => ({ providerSupportsNativeSearch: () => false }))
jest.mock('@/services/chatProviderNativeToolUtils', () => ({
  providerSupportsVisionInput: () => false, resolveProviderNativeToolSupport: () => ({ supported: false }),
}))

const initial = useSettingsStore.getState()
let persistence: SettingsStorePersistence
let saveSettings: jest.Mock
function provider(id: string, overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id, name: 'Team gateway', type: 'openai-compatible', presetId: 'custom-endpoint', wireProtocol: 'openai-compatible',
    apiKey: '', enabled: true, baseUrl: `https://${id}.example.invalid/v1`,
    models: ['upstream-shared'], manualModels: ['upstream-shared'], lastModelSyncStatus: 'ok',
    modelAliases: [{ alias: 'routing-alias', model: 'upstream-shared' }],
    modelConfigs: [{ ...getModelConfig('upstream-shared', 'openai-compatible'), name: 'Shared model',
      upstreamProvider: { id: 'vendor', name: 'Upstream Vendor' } }],
    ...overrides,
  }
}
const a = provider('connection-a')
const b = provider('connection-b')
function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'chat', title: 'Fixture chat', providerId: a.id, model: 'routing-alias', messages: [],
    systemPrompt: '', temperature: 1, maxTokens: 4096, createdAt: 1, updatedAt: 1, ...overrides,
  }
}
function evidence(modelProvider: AIProvider, modelId: string, availability: ProviderModelCurrent['availability'] = 'available'): ProviderModelCurrent {
  return {
    providerId: modelProvider.id, modelId, credentialSource: { kind: 'primary' }, protocolAdapterId: 'openai-chat',
    endpointVariant: resolveProviderEndpointVariant(modelProvider), scopeId: 'fixture-scope', epoch: 'fixture-epoch',
    availability, advertisement: 'present', lastAppliedOrder: 1, updatedAt: 10, invalidated: false,
  }
}
const optionId = (providerId: string, modelId = 'routing-alias') => `chat-model-option-${getSettingsModelIdentityKey(providerId, modelId)}`
const favoriteId = (providerId: string, modelId = 'routing-alias') => `chat-model-favorite-${getSettingsModelIdentityKey(providerId, modelId)}`
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}
async function panel(options: { providers?: AIProvider[]; chat?: Conversation; settings?: Parameters<typeof ChatOptionsPanel>[0]['settings'] } = {}) {
  const providers = options.providers ?? [a, b]
  useSettingsStore.setState({ providers })
  const chat = options.chat ?? conversation()
  const onSwitchModel = jest.fn()
  const view = await render(<ChatOptionsPanel conversation={chat} provider={providers.find((item) => item.id === chat.providerId)}
    switchableProviders={providers} colors={getColors('light', mockThemeId)} maxHeight={780} placement="sheet" scope="essential"
    onSwitchModel={onSwitchModel} onClose={jest.fn()} settings={options.settings} />)
  return { view, onSwitchModel, chat }
}

it('selects an explicit routing plan and keeps the active snapshot after its template is removed', async () => {
  const plan = { schema: 'islemind.model-routing-plan.v1' as const, id: 'stable', name: 'Stable', mode: 'fallback' as const,
    primary: { providerId: a.id, model: 'routing-alias' }, backup: { providerId: b.id, model: 'routing-alias' }, crossProvider: 'ask' as const }
  useSettingsStore.setState({ settings: { ...initial.settings, modelRoutingPlans: [plan] } })
  const { view, onSwitchModel } = await panel({ chat: conversation({ routingPlan: plan }) })
  await fireEvent.press(view.getByTestId('routing-plan-choice-stable-0'))
  expect(onSwitchModel).toHaveBeenCalledWith(a, 'routing-alias', plan)
  await act(() => useSettingsStore.setState({ settings: { ...initial.settings, modelRoutingPlans: [] } }))
  expect(view.getByTestId('routing-plan-choice-stable-0')).toBeTruthy()
  expect(view.getByText('routing.snapshotHint')).toBeTruthy()
})

beforeEach(() => {
  jest.clearAllMocks()
  mockGetProviderParameterEntry.mockReset()
  mockResolveRequestParameters.mockReset()
  mockThemeId = 'minimal'
  mockI18n.language = 'en'
  mockI18n.resolvedLanguage = undefined
  mockNetwork = { isConnected: true, isInternetReachable: true }
  mockListModels.mockResolvedValue([])
  saveSettings = jest.fn(async () => undefined)
  persistence = { settings: { load: async () => null, save: saveSettings }, providers: { load: async () => [], save: async () => undefined } }
  bindSettingsStorePersistence(persistence)
  useSettingsStore.setState({ ...initial, settings: { ...initial.settings, modelFavorites: [] }, providers: [a, b] }, true)
})
afterEach(async () => {
  await flushPersistedSettings().catch(() => undefined)
  releaseSettingsStorePersistence(persistence)
  useSettingsStore.setState(initial, true)
})

it.each(CANONICAL_THEME_IDS)('keeps all/favorites, current identity, and independent favorite/selection actions in %s', async (themeId) => {
  mockThemeId = themeId
  const { view, onSwitchModel } = await panel()
  expect(view.getByTestId(`chat-model-picker-${themeId}`).children.length).toBeGreaterThan(0)
  expect(view.getByTestId('chat-model-scope-all').props.accessibilityState.selected).toBe(true)
  expect(view.getByTestId(optionId(a.id)).props.accessibilityState.selected).toBe(true)
  expect(view.getByTestId(optionId(b.id)).props.accessibilityState.selected).toBe(false)
  const star = view.getByTestId(favoriteId(b.id))
  expect(StyleSheet.flatten(star.props.style)).toMatchObject({ width: 44, height: 44 })
  expect(StyleSheet.flatten(view.getByTestId(optionId(b.id)).props.style).minHeight).toBeGreaterThanOrEqual(44)
  await fireEvent.press(star)
  await flushPersistedSettings()
  await waitFor(() => expect(view.getByTestId(favoriteId(b.id)).props.accessibilityState.selected).toBe(true))
  expect(onSwitchModel).not.toHaveBeenCalled()
  expect(mockUpdateConversation).not.toHaveBeenCalled()
  expect(useSettingsStore.getState().settings.modelFavorites).toEqual([{ providerId: b.id, modelId: 'routing-alias' }])
  await fireEvent.press(view.getByTestId(optionId(b.id)))
  expect(onSwitchModel).toHaveBeenCalledWith(b, 'routing-alias')
  expect(mockRefresh).not.toHaveBeenCalled()
  expect(mockRetest).not.toHaveBeenCalled()
})

it('searches across connections by requested alias and keeps empty results recoverable', async () => {
  const { view } = await panel()
  const search = view.getByLabelText('chat.searchProviderOrModel')
  expect(search.props.autoFocus).toBeUndefined()
  await fireEvent.changeText(search, 'connection-b routing-alias')
  expect(view.queryByTestId(optionId(a.id))).toBeNull()
  expect(view.getByTestId(optionId(b.id))).toBeTruthy()
  await fireEvent.changeText(search, 'no-match-anywhere')
  expect(view.getByText('chat.noProviderModelMatches')).toBeTruthy()
  expect(view.getByTestId('chat-model-scope-all')).toBeTruthy()
  expect(view.getByTestId('chat-model-scope-favorites')).toBeTruthy()
  await fireEvent.press(view.getByLabelText('chat.clearModelSearch'))
  expect(view.getByTestId(optionId(a.id))).toBeTruthy()
  expect(view.getByTestId(optionId(b.id))).toBeTruthy()
})

it('shares local evidence reads between aliases and avoids new reads when only a star changes', async () => {
  const { view } = await panel()
  await waitFor(() => expect(mockListModels).toHaveBeenCalledTimes(2))
  expect(mockListModels.mock.calls.map(([input]) => [input.providerId, input.modelId])).toEqual([
    [a.id, 'upstream-shared'], [b.id, 'upstream-shared'],
  ])
  mockListModels.mockClear()
  await fireEvent.press(view.getByTestId(favoriteId(b.id)))
  await flushPersistedSettings()
  await waitFor(() => expect(view.getByTestId(favoriteId(b.id)).props.accessibilityState.selected).toBe(true))
  expect(mockListModels).not.toHaveBeenCalled()
  expect(mockRefresh).not.toHaveBeenCalled()
  expect(mockRetest).not.toHaveBeenCalled()
})

it('keeps canonical upstream labels alongside colliding custom display names', async () => {
  useSettingsStore.setState((state) => ({ settings: { ...state.settings, modelDisplayAliases: [
    { providerId: a.id, modelId: 'routing-alias', displayName: 'Friendly' },
    { providerId: b.id, modelId: 'routing-alias', displayName: 'Friendly' },
  ] } }))
  const { view } = await panel()
  expect(within(view.getByTestId(optionId(a.id))).getByText('routing-alias (upstream-shared)')).toBeTruthy()
  expect(within(view.getByTestId(optionId(b.id))).getByText('routing-alias (upstream-shared)')).toBeTruthy()
})

it('keeps the current model first inside its original credential group', async () => {
  const grouped = provider(a.id, {
    models: [], manualModels: [], modelAliases: [], modelConfigs: [],
    credentialGroups: [
      { id: 'first', label: 'Other credential group', enabled: true, availableModels: ['other-model'], lastModelSyncStatus: 'ok' },
      { id: 'current', label: 'Current credential group', enabled: true, availableModels: ['before-current', 'current-model'], lastModelSyncStatus: 'ok' },
    ],
  })
  const { view } = await panel({ providers: [grouped], chat: conversation({ model: 'current-model' }) })
  const rows = view.getAllByRole('button').filter((node) => node.props.testID?.startsWith('chat-model-option-'))
  expect(rows[0].props.testID).toBe(optionId(a.id, 'current-model'))
  expect(rows[0].props.accessibilityLabel).toContain('Current credential group')
})

it('applies a source filter only to the selected connection and resets it on all-model browsing', async () => {
  const withSources = provider(b.id, { manualModels: ['upstream-shared', 'manual-other'] })
  const { view } = await panel({ providers: [a, withSources] })
  expect(view.queryByTestId('provider-model-source-filter')).toBeNull()
  await fireEvent.press(view.getByLabelText(`Team gateway · ${b.id}`))
  expect(view.queryByTestId(optionId(a.id))).toBeNull()
  await fireEvent.press(view.getByTestId('provider-model-source-filter'))
  await fireEvent.press(view.getByLabelText('Upstream Vendor'))
  expect(view.getByTestId(optionId(b.id))).toBeTruthy()
  expect(view.queryByTestId(optionId(b.id, 'manual-other'))).toBeNull()
  await fireEvent.press(view.getByTestId('chat-model-scope-all'))
  expect(view.queryByTestId('provider-model-source-filter')).toBeNull()
  expect(view.getByTestId(optionId(b.id, 'manual-other'))).toBeTruthy()
})

it('renders at most one 24-model page and resets pagination when the query changes', async () => {
  const large = provider(a.id, {
    models: Array.from({ length: 60 }, (_, index) => `model-${index}`), manualModels: [], modelAliases: [], modelConfigs: [],
  })
  const { view } = await panel({ providers: [large], chat: conversation({ model: 'model-59' }) })
  const rows = () => view.getAllByRole('button').filter((node) => node.props.testID?.startsWith('chat-model-option-'))
  expect(rows()).toHaveLength(24)
  expect(rows()[0].props.testID).toBe(optionId(a.id, 'model-59'))
  await fireEvent.press(view.getByLabelText('providerSettings.nextModelPage'))
  expect(rows()).toHaveLength(24)
  expect(view.queryByTestId(optionId(a.id, 'model-59'))).toBeNull()
  await fireEvent.changeText(view.getByLabelText('chat.searchProviderOrModel'), 'model-59')
  expect(rows()).toHaveLength(1)
  expect(view.queryByLabelText('providerSettings.nextModelPage')).toBeNull()
})

it('keeps policy, disabled-connection, and active-reply selection blocks while allowing favorites', async () => {
  const disabled = provider(b.id, { enabled: false })
  const { view, onSwitchModel } = await panel({ providers: [a, disabled], settings: { modelBlocklist: ['upstream-shared'] } })
  expect(view.getByTestId(optionId(a.id)).props.accessibilityState.disabled).toBe(true)
  expect(view.getByTestId(optionId(b.id)).props.accessibilityState.disabled).toBe(true)
  await fireEvent.press(view.getByTestId(optionId(a.id)))
  expect(onSwitchModel).not.toHaveBeenCalled()
  await fireEvent.press(view.getByTestId(favoriteId(b.id)))
  await flushPersistedSettings()
  expect(useSettingsStore.getState().settings.modelFavorites).toEqual([{ providerId: b.id, modelId: 'routing-alias' }])
  await view.unmount()
  const active = await panel({ chat: conversation({ messages: [{ id: 'active', role: 'assistant', content: '', timestamp: 1, status: 'streaming' }] }) })
  expect(active.view.getByTestId(optionId(a.id)).props.accessibilityState.disabled).toBe(true)
  expect(active.view.getByTestId(favoriteId(a.id)).props.accessibilityState.disabled).toBe(false)
})

it('shows cached offline/auth-failure models without turning an operational label into retirement', async () => {
  mockNetwork = { isConnected: false, isInternetReachable: false }
  const operational = provider(a.id, { lastTestStatus: 'bad', lastTestCode: 'bad_auth' })
  const { view } = await panel({ providers: [operational] })
  const row = view.getByTestId(optionId(a.id))
  expect(within(row).getByText(/modelStatus\.offline/)).toBeTruthy()
  expect(within(row).getByText(/modelStatus\.credentialBlocked/)).toBeTruthy()
  expect(row.props.accessibilityState.disabled).toBe(false)
  expect(within(row).queryByText(/modelStatus\.retired/)).toBeNull()
})

it('queries evidence for the exact visible target even beyond the first provider evidence page', async () => {
  const large = provider(a.id, {
    models: [...Array.from({ length: 60 }, (_, index) => `model-${index}`), 'retired-tail'], manualModels: [], modelAliases: [], modelConfigs: [],
  })
  mockListModels.mockImplementation(async (input) => input.modelId === 'retired-tail' ? [evidence(large, 'retired-tail', 'retired')] : [])
  const { view, onSwitchModel } = await panel({ providers: [large], chat: conversation({ model: 'model-0' }) })
  await fireEvent.changeText(view.getByLabelText('chat.searchProviderOrModel'), 'retired-tail')
  await waitFor(() => expect(view.getByTestId(optionId(a.id, 'retired-tail')).props.accessibilityState.disabled).toBe(true))
  expect(mockListModels).toHaveBeenCalledWith({ providerId: a.id, modelId: 'retired-tail', limit: 50 })
  await fireEvent.press(view.getByTestId(optionId(a.id, 'retired-tail')))
  expect(onSwitchModel).not.toHaveBeenCalled()
  expect(view.getByTestId(favoriteId(a.id, 'retired-tail')).props.accessibilityState.disabled).toBe(false)
})

it('keeps successful evidence visible when another target read fails', async () => {
  mockListModels.mockImplementation(async (input) => {
    if (input.providerId === a.id) throw new Error('fixture read failed')
    return [evidence(b, input.modelId)]
  })
  const { view } = await panel()
  await waitFor(() => expect(within(view.getByTestId(optionId(a.id))).getByText('modelStatus.readFailed')).toBeTruthy())
  expect(within(view.getByTestId(optionId(b.id))).getByText(/modelStatus\.available/)).toBeTruthy()
  expect(view.getByTestId(optionId(b.id)).props.accessibilityState.disabled).toBe(false)
})

it('updates evidence dates when the app language changes without rereading model status', async () => {
  const connections = [a, b]
  const observedAt = 0
  const updatedAt = Date.UTC(2026, 10, 12, 7, 8, 9)
  mockListModels.mockImplementation(async input => [{
    ...evidence(input.providerId === a.id ? a : b, input.modelId),
    updatedAt,
    ...(input.providerId === a.id ? { evidence: {
      schema: 'islemind.model-availability-evidence.v1' as const, source: 'generation' as const, observedAt,
      evidence: { kind: 'operational' as const, reason: 'server_error' as const },
    } } : {}),
  }])
  const { view, chat } = await panel({ providers: connections })
  await waitFor(() => expect(within(view.getByTestId(optionId(a.id)))
    .getByText(new RegExp(new Date(observedAt).toLocaleString('en').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy())
  const reads = mockListModels.mock.calls.length
  for (const language of ['ja', 'zh-CN', 'en']) {
    mockI18n.language = language
    mockI18n.resolvedLanguage = language
    await view.rerender(<ChatOptionsPanel conversation={chat} provider={a} switchableProviders={connections}
      colors={getColors('light', mockThemeId)} maxHeight={780} placement="sheet" scope="essential"
      onSwitchModel={jest.fn()} onClose={jest.fn()} />)
    for (const [connection, date] of [[a, observedAt], [b, updatedAt]] as const) {
      const expected = new Date(date).toLocaleString(language)
      expect(within(view.getByTestId(optionId(connection.id)))
        .getByText(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy()
    }
  }
  expect(mockListModels).toHaveBeenCalledTimes(reads)
})

it('ignores late evidence from an obsolete search instead of applying it to the new page', async () => {
  const oldRead = deferred<readonly ProviderModelCurrent[]>()
  mockListModels.mockImplementation(async (input) => input.providerId === a.id ? oldRead.promise : [evidence(b, input.modelId)])
  const { view } = await panel()
  await fireEvent.changeText(view.getByLabelText('chat.searchProviderOrModel'), 'connection-b')
  await waitFor(() => expect(within(view.getByTestId(optionId(b.id))).getByText(/modelStatus\.available/)).toBeTruthy())
  await act(async () => { oldRead.resolve([evidence(a, 'upstream-shared', 'retired')]); await oldRead.promise })
  expect(view.queryByTestId(optionId(a.id))).toBeNull()
  expect(view.getByTestId(optionId(b.id)).props.accessibilityState.disabled).toBe(false)
  expect(within(view.getByTestId(optionId(b.id))).queryByText(/modelStatus\.retired/)).toBeNull()
})

it('removes only the chosen favorite and leaves the empty favorites scope usable', async () => {
  useSettingsStore.setState((state) => ({ settings: { ...state.settings, modelFavorites: [{ providerId: b.id, modelId: 'routing-alias' }] } }))
  const { view } = await panel()
  await fireEvent.press(view.getByTestId('chat-model-scope-favorites'))
  expect(view.queryByTestId(optionId(a.id))).toBeNull()
  expect(view.queryByTestId(optionId(b.id, 'upstream-shared'))).toBeNull()
  await fireEvent.press(view.getByTestId(favoriteId(b.id)))
  await flushPersistedSettings()
  expect(view.getByText('chat.noFavoriteModels')).toBeTruthy()
  expect(useSettingsStore.getState().settings.modelFavorites).toEqual([])
  await fireEvent.press(view.getByTestId('chat-model-scope-all'))
  expect(view.getByTestId(optionId(b.id))).toBeTruthy()
})

it('surfaces a favorite write failure, retries it, and never selects the model as a side effect', async () => {
  saveSettings.mockRejectedValueOnce(new Error('fixture save failed'))
  const { view, onSwitchModel } = await panel()
  await fireEvent.press(view.getByTestId(favoriteId(b.id)))
  await waitFor(() => expect(view.getByTestId('chat-model-favorite-save-error')).toBeTruthy())
  expect(view.getByTestId(favoriteId(b.id)).props.accessibilityState.selected).toBe(true)
  await fireEvent.press(view.getByLabelText('chat.retryModelFavoriteSave'))
  await waitFor(() => expect(view.queryByTestId('chat-model-favorite-save-error')).toBeNull())
  expect(saveSettings).toHaveBeenCalledTimes(2)
  expect(saveSettings.mock.calls[1][0].modelFavorites).toEqual([{ providerId: b.id, modelId: 'routing-alias' }])
  expect(onSwitchModel).not.toHaveBeenCalled()
})

it('reports a full favorite collection without silently evicting another model', async () => {
  const full = Array.from({ length: SETTINGS_MODEL_FAVORITE_LIMIT }, (_, index) => ({ providerId: 'saved', modelId: `model-${index}` }))
  useSettingsStore.setState((state) => ({ settings: { ...state.settings, modelFavorites: full } }))
  const { view } = await panel()
  await fireEvent.press(view.getByTestId(favoriteId(b.id)))
  await waitFor(() => expect(view.getByText('chat.modelFavoriteLimit')).toBeTruthy())
  expect(useSettingsStore.getState().settings.modelFavorites).toEqual(full)
  expect(view.queryByLabelText('chat.retryModelFavoriteSave')).toBeNull()
  expect(saveSettings).not.toHaveBeenCalled()
})

it('does not recreate a deleted connection favorite through a delayed save retry', async () => {
  saveSettings.mockRejectedValueOnce(new Error('fixture save failed'))
  const { view } = await panel()
  await fireEvent.press(view.getByTestId(favoriteId(b.id)))
  await waitFor(() => expect(view.getByLabelText('chat.retryModelFavoriteSave')).toBeTruthy())
  await act(async () => {
    useSettingsStore.setState((state) => ({
      providers: state.providers.filter((item) => item.id !== b.id),
      settings: { ...state.settings, modelFavorites: [] },
    }))
  })
  await fireEvent.press(view.getByLabelText('chat.retryModelFavoriteSave'))
  await waitFor(() => expect(view.getByText('chat.modelFavoriteConnectionRemoved')).toBeTruthy())
  expect(view.queryByLabelText('chat.retryModelFavoriteSave')).toBeNull()
  expect(useSettingsStore.getState().settings.modelFavorites).toEqual([])
  expect(saveSettings).toHaveBeenCalledTimes(1)
})

describe('Android parameter keyboard visibility', () => {
  const listeners = new Map<string, Set<(event: KeyboardEvent) => void>>()
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  let focused: ReturnType<typeof TextInput.State.currentlyFocusedInput> | null = null
  const keyboardEvent: KeyboardEvent = {
    duration: 0, easing: 'keyboard',
    endCoordinates: { screenX: 0, screenY: 550, width: 390, height: 300 },
  }
  const layout = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } })
  const scroll = (y: number) => ({ nativeEvent: { contentOffset: { x: 0, y } } })
  async function flushFrame() {
    await act(() => {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback(0)
    })
  }
  async function emit(name: string) {
    await act(() => { for (const callback of listeners.get(name) ?? []) callback(keyboardEvent) })
    await flushFrame()
  }
  beforeEach(() => {
    listeners.clear(); frames.clear(); frameId = 0; focused = null; mockKeyboardViewport = undefined
    jest.replaceProperty(Platform, 'OS', 'android')
    jest.spyOn(Keyboard, 'metrics').mockReturnValue(undefined)
    jest.spyOn(Keyboard, 'addListener').mockImplementation((name, callback) => {
      const callbacks = listeners.get(name) ?? new Set()
      callbacks.add(callback); listeners.set(name, callbacks)
      return { remove: () => { callbacks.delete(callback) } } as ReturnType<typeof Keyboard.addListener>
    })
    jest.spyOn(TextInput.State, 'currentlyFocusedInput').mockImplementation(() => focused!)
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
      frames.set(++frameId, callback)
      return frameId
    })
    jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(id => { if (typeof id === 'number') frames.delete(id) })
  })
  afterEach(() => { jest.restoreAllMocks() })

  async function keyboardPanel() {
    mockGetProviderParameterEntry.mockReturnValue({ status: 'sendable' })
    mockResolveRequestParameters.mockReturnValue({ temperatureSupported: true, maxTokensSupported: true, topPSupported: true, topKSupported: false })
    const screen = await render(<ChatOptionsPanel
      conversation={conversation({ temperature: 0.3, topP: 1, maxTokens: 2048, generationParameterOverrides: {} })}
      provider={a} switchableProviders={[a, b]} colors={getColors('light', 'minimal')}
      maxHeight={780} placement="sheet" embedded onSwitchModel={jest.fn()} onClose={jest.fn()}
    />)
    const scrollViews = screen.container.queryAll(node => node.props.keyboardShouldPersistTaps === 'handled')
    expect(scrollViews).toHaveLength(1)
    const sheetScroll = scrollViews[0]
    let offset = 120, inputTop = 700
    const input = {
      measureInWindow: jest.fn((callback: (x: number, y: number, width: number, height: number) => void) => callback(0, inputTop, 340, 46)),
      focus: jest.fn(), setSelection: jest.fn(), setNativeProps: jest.fn(),
    }
    focused = input as unknown as NonNullable<typeof focused>
    const scrollTo = jest.fn(({ y }: { y: number }) => {
      inputTop -= y - offset
      offset = y
      sheetScroll.props.onScroll?.(scroll(y))
    })
    if (mockKeyboardViewport) {
      mockKeyboardViewport.frameRef.current = {
        measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(0, 110, 390, 740),
      } as unknown as View
      mockKeyboardViewport.scrollRef.current = { scrollTo } as unknown as ScrollView
    }
    const temperature = screen.getByLabelText('chat.temperature')
    await fireEvent.changeText(temperature, '0.8')
    await act(() => {
      sheetScroll.props.onScroll?.(scroll(offset))
      sheetScroll.props.onLayout?.(layout(740))
    })
    await fireEvent(temperature, 'focus')
    // Native focus bubbles to the scroll viewport; fireEvent invokes only the nearest handler.
    await act(() => sheetScroll.props.onFocus?.({ nativeEvent: { target: 1 } }))
    await flushFrame()
    return { screen, sheetScroll, temperature, scrollTo, input }
  }

  it('reveals a numeric draft after resize and keeps it uncommitted until blur', async () => {
    const f = await keyboardPanel()
    await emit('keyboardDidShow')
    expect(StyleSheet.flatten(f.sheetScroll.props.style)?.marginBottom ?? 0).toBe(300)
    expect(f.scrollTo).not.toHaveBeenCalled()
    await act(() => f.sheetScroll.props.onLayout?.(layout(440)))
    await flushFrame()
    expect(f.scrollTo).toHaveBeenLastCalledWith({ y: 328, animated: false })
    expect(f.screen.getByLabelText('chat.temperature')).toBe(f.temperature)
    expect(f.temperature.props.value).toBe('0.8')
    expect(mockUpdateConversation).not.toHaveBeenCalled()
    await emit('keyboardDidHide')
    await act(() => f.sheetScroll.props.onLayout?.(layout(740)))
    await flushFrame()
    expect(f.scrollTo).toHaveBeenLastCalledWith({ y: 120, animated: false })
    expect(f.temperature.props.value).toBe('0.8')
    await fireEvent(f.temperature, 'blur')
    expect(mockUpdateConversation).toHaveBeenCalledTimes(1)
    expect(mockUpdateConversation).toHaveBeenLastCalledWith('chat', { temperature: 0.8, generationParameterOverrides: { temperature: true } })
    expect(f.screen.getByLabelText('chat.maxTokens').props.value).toBe('')
    expect(f.screen.getByLabelText('chat.topP').props.value).toBe('')
    expect(saveSettings).not.toHaveBeenCalled()
    expect(f.input.focus).not.toHaveBeenCalled()
    expect(f.input.setSelection).not.toHaveBeenCalled()
    expect(f.input.setNativeProps).not.toHaveBeenCalled()
    await f.screen.unmount()
  })

  it('retains a deliberate scroll and the same numeric draft when the keyboard closes', async () => {
    const f = await keyboardPanel()
    await emit('keyboardDidShow')
    await act(() => f.sheetScroll.props.onLayout?.(layout(440)))
    await flushFrame()
    expect(f.scrollTo).toHaveBeenLastCalledWith({ y: 328, animated: false })
    f.scrollTo.mockClear()
    await act(() => {
      f.sheetScroll.props.onScrollBeginDrag?.()
      f.sheetScroll.props.onScroll?.(scroll(400))
    })
    await emit('keyboardDidHide')
    await act(() => f.sheetScroll.props.onLayout?.(layout(740)))
    await flushFrame()
    expect(f.scrollTo).not.toHaveBeenCalled()
    expect(f.screen.getByLabelText('chat.temperature')).toBe(f.temperature)
    expect(f.temperature.props.value).toBe('0.8')
    expect(mockUpdateConversation).not.toHaveBeenCalled()
    await f.screen.unmount()
  })
})

describe('pending parameter drafts at close', () => {
  const events: string[] = []
  beforeEach(() => {
    events.length = 0
    mockGetProviderParameterEntry.mockReturnValue({ status: 'sendable' })
    mockResolveRequestParameters.mockReturnValue({ temperatureSupported: true, maxTokensSupported: true, topPSupported: true, topKSupported: false })
    mockUpdateConversation.mockImplementation(() => { events.push('save') })
    jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => { events.push('blur') })
  })
  afterEach(() => { jest.restoreAllMocks(); mockUpdateConversation.mockReset() })
  async function draftPanel() {
    const onClose = jest.fn(() => { events.push('close') })
    const onManageProviders = jest.fn(() => { events.push('providers') })
    const tree = (id = 'chat') => <ChatOptionsPanel
      conversation={conversation({ id, temperature: 0.3, topP: 1, maxTokens: 2048, generationParameterOverrides: { temperature: true } })}
      provider={a} switchableProviders={[a, b]} colors={getColors('light', 'minimal')}
      maxHeight={780} placement="sheet" embedded onSwitchModel={jest.fn()} onClose={onClose} onManageProviders={onManageProviders}
    />
    const screen = await render(tree())
    return { screen, tree, onClose, onManageProviders }
  }

  it.each([
    ['0.6', { temperature: 0.6, generationParameterOverrides: { temperature: true } }],
    ['9', { temperature: 2, generationParameterOverrides: { temperature: true } }],
    ['', { generationParameterOverrides: { temperature: false } }],
    ['.', undefined],
  ] as const)('finishes numeric draft %j before closing without waiting for native blur', async (draft, patch) => {
    const f = await draftPanel()
    await fireEvent.changeText(f.screen.getByLabelText('chat.temperature'), draft)
    expect(mockUpdateConversation).not.toHaveBeenCalled()
    await fireEvent.press(f.screen.getByLabelText('dialog.closeLayer'))
    if (patch) expect(mockUpdateConversation).toHaveBeenCalledWith('chat', patch)
    else expect(mockUpdateConversation).not.toHaveBeenCalled()
    expect(events).toEqual(patch ? ['save', 'blur', 'close'] : ['blur', 'close'])
    expect(f.onClose).toHaveBeenCalledTimes(1)
    expect(f.screen.getByLabelText('chat.maxTokens').props.value).toBe('')
    expect(f.screen.getByLabelText('chat.topP').props.value).toBe('')
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('finishes the draft before switching to provider management', async () => {
    const f = await draftPanel()
    await fireEvent.changeText(f.screen.getByLabelText('chat.temperature'), '0.6')
    await fireEvent.press(f.screen.getByLabelText('settings.providerManagement'))
    expect(mockUpdateConversation).toHaveBeenCalledWith('chat', { temperature: 0.6, generationParameterOverrides: { temperature: true } })
    expect(events).toEqual(['save', 'blur', 'providers'])
    expect(f.onClose).not.toHaveBeenCalled()
  })

  it('does not save a parameter twice after a completed blur', async () => {
    const f = await draftPanel()
    const input = f.screen.getByLabelText('chat.temperature')
    await fireEvent.changeText(input, '0.6')
    await fireEvent(input, 'blur')
    await fireEvent.press(f.screen.getByLabelText('dialog.closeLayer'))
    expect(mockUpdateConversation).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['save', 'blur', 'close'])
  })

  it('does not carry an uncommitted parameter into another conversation', async () => {
    const f = await draftPanel()
    await fireEvent.changeText(f.screen.getByLabelText('chat.temperature'), '0.6')
    await f.screen.rerender(f.tree('other-chat'))
    expect(f.screen.getByLabelText('chat.temperature').props.value).toBe('0.3')
    await fireEvent.press(f.screen.getByLabelText('dialog.closeLayer'))
    expect(mockUpdateConversation).not.toHaveBeenCalled()
    expect(events).toEqual(['blur', 'close'])
  })
})
