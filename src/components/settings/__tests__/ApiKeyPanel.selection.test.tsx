import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native'
import { ApiKeyPanel } from '@/components/settings/ApiKeyPanel'
import { useSettingsStore } from '@/store/settingsStore'
import { bindSettingsStorePersistence, flushPersistedSettings, releaseSettingsStorePersistence } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import { settingsStorePersistence } from '@/bootstrap/settingsStorePersistence'
import { APPLICATION_DATA_STORAGE_KEYS } from '@/bootstrap/applicationDataRecords'
import { getPolicyAllowedProviderModels } from '@/bootstrap/providerModelAccess'
import type { AIProvider } from '@/types/providerContracts'

// This guard travels with the test when it is promoted to src; no candidate setup is required.
jest.setTimeout(30000)
const selectionNetworkAttempts: string[] = []
const restoreSelectionNetwork: Array<() => void> = []
const denySelectionNetwork = (kind: string) => (): never => {
  selectionNetworkAttempts.push(kind)
  throw Error('Provider selection regression forbids network: ' + kind)
}
beforeAll(() => {
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(denySelectionNetwork('fetch'))
  restoreSelectionNetwork.push(() => fetchSpy.mockRestore())
  if (globalThis.XMLHttpRequest) {
    const xhrSpy = jest.spyOn(globalThis.XMLHttpRequest.prototype, 'send').mockImplementation(denySelectionNetwork('XHR'))
    restoreSelectionNetwork.push(() => xhrSpy.mockRestore())
  }
  for (const name of ['node:http', 'node:https']) {
    const transport = require(name)
    for (const method of ['request', 'get']) {
      const spy = jest.spyOn(transport, method).mockImplementation(denySelectionNetwork(name + '.' + method))
      restoreSelectionNetwork.push(() => spy.mockRestore())
    }
  }
  const socketSpy = jest.spyOn(require('node:net').Socket.prototype, 'connect').mockImplementation(denySelectionNetwork('socket'))
  restoreSelectionNetwork.push(() => socketSpy.mockRestore())
})
beforeEach(() => { selectionNetworkAttempts.length = 0 })
afterEach(() => { expect(selectionNetworkAttempts).toEqual([]) })
afterAll(() => { for (const restore of restoreSelectionNetwork.reverse()) restore() })

const mockToast = jest.fn()
const mockClipboardText = jest.fn()
const mockProbe = jest.fn(() => { throw Error('Unexpected provider probe') })
const mockActivation = jest.fn(() => { throw Error('Unexpected activation') })
const mockAvailabilityChange = jest.fn(async (_ids: readonly string[], mutation: () => Promise<unknown>) => mutation())
jest.mock('expo-router', () => ({ useNavigation: jest.fn() }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
jest.mock('expo-clipboard', () => ({ hasStringAsync: async () => true, getStringAsync: () => mockClipboardText() }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/settings/SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('@/components/providers/ProviderLocalUsage', () => ({ ProviderLocalUsage: () => null }))
jest.mock('@/components/ui/isle', () => ({
  ...jest.requireActual('@/components/ui/isle'),
  useIsleDialog: () => ({ toast: mockToast, notice: mockToast, confirm: jest.fn(async () => false) }),
}))
jest.mock('@/bootstrap/providerRegistry', () => ({
  ...jest.requireActual('@/bootstrap/providerRegistry'), probeProviderPreset: () => mockProbe(),
}))
jest.mock('@/components/providers/useProviderActivationJob', () => ({
  useProviderActivationJob: () => ({ isActivationRunning: false, activateProviders: () => mockActivation() }),
}))
jest.mock('@/bootstrap/providerActivationRuntime', () => ({ syncAndTestProvider: () => mockActivation() }))
jest.mock('@/bootstrap/providerModelAvailabilityRuntime', () => ({
  withProviderModelAvailabilityChanges: (...args: Parameters<typeof mockAvailabilityChange>) => mockAvailabilityChange(...args),
  providerModelAvailabilityRuntime: { invalidateAll: jest.fn(async () => undefined) },
}))
jest.mock('@/bootstrap/androidStatusNotification', () => ({
  updateAndroidStatusNotification: jest.fn(async () => ({ shown: false })), clearAndroidStatusNotification: jest.fn(async () => undefined),
}))
jest.mock('@/platform/native/runtimeLog', () => ({
  readStoredRuntimeLogOptions: async () => ({ enabled: false }), appendRuntimeLog: jest.fn(async () => undefined),
}))

const initial = useSettingsStore.getState()
const records = new Map<string, string>()
const secureRecords = new Map<string, string>()
const existingProvider: AIProvider = {
  id: 'selection-fixture', name: 'Selection fixture', type: 'openai-compatible',
  presetId: 'custom-endpoint', detectedPresetId: 'custom-endpoint',
  baseUrl: 'https://selection-fixture.invalid/v1', wireProtocol: 'openai-compatible',
  apiKey: '', enabled: false, models: ['saved-model', 'disabled-model'], manualModels: ['saved-model', 'disabled-model'],
  enabledModels: ['saved-model'],
}

beforeEach(async () => {
  jest.clearAllMocks()
  records.clear()
  secureRecords.clear()
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => records.get(key) ?? null)
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { records.set(key, value) })
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => { records.delete(key) })
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key => secureRecords.get(key) ?? null)
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { secureRecords.set(key, value) })
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async key => { secureRecords.delete(key) })
  useSettingsStore.setState(initial, true)
  expect(jest.isMockFunction(useSettingsStore.getState().updateProvider)).toBe(false)
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, JSON.stringify({
    ...initial.settings, language: 'en', defaultProvider: null, lastPreferredModel: undefined,
    webSearchEnabled: false, searchProvider: 'off', webSearchMode: 'off',
    providerAllowlist: [], modelBlocklist: [], memoryEnabled: false, knowledgeEnabled: false,
    mcpEnabled: false, skillsEnabled: false, hapticsEnabled: false, systemStatusNotificationsEnabled: false,
  }))
  records.set(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS, JSON.stringify([existingProvider]))
  records.set('@islemind/language-source', 'user')
  bindSettingsStorePersistence(settingsStorePersistence)
  await useSettingsStore.getState().load()
  await flushPersistedSettings()
  await useSettingsStore.getState().flushProviderPersistence()
})

afterEach(async () => {
  await cleanup()
  await flushPersistedSettings()
  await useSettingsStore.getState().flushProviderPersistence()
  releaseSettingsStorePersistence(settingsStorePersistence)
  useSettingsStore.setState(initial, true)
  expect(mockActivation).not.toHaveBeenCalled()
  expect(mockProbe).not.toHaveBeenCalled()
})

function Panel() {
  const provider = useSettingsStore(state => state.providers[0])
  return <ApiKeyPanel provider={provider} expanded hideHeader initialView="connection" />
}
type Screen = Awaited<ReturnType<typeof render>>
function config(enabledModels?: string[], models = ['saved-model', 'import-a', 'import-b']) {
  return JSON.stringify({ baseUrl: existingProvider.baseUrl, apiKey: 'synthetic-selection-only', models, ...(enabledModels === undefined ? {} : { enabledModels }) })
}
async function paste(screen: Screen, text: string) {
  mockClipboardText.mockResolvedValue(text)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.pasteClipboard' }))
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'providerSettings.clipboardDetected' })))
}
async function editModels(screen: Screen, value?: string) {
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceModels' }))
  await fireEvent.press(screen.getByRole('button', { name: 'common.edit' }))
  if (value !== undefined) await fireEvent.changeText(screen.getByLabelText('apiKeyPanel.customModels'), value)
}
async function addAlias(screen: Screen, alias: string, target: string) {
  await fireEvent.press(screen.getByRole('button', { name: 'apiKeyPanel.addAlias' }))
  const aliases = screen.getAllByPlaceholderText('apiKeyPanel.aliasDisplayName')
  const targets = screen.getAllByPlaceholderText('apiKeyPanel.aliasTargetModel')
  await fireEvent.changeText(aliases[aliases.length - 1], alias)
  await fireEvent.changeText(targets[targets.length - 1], target)
}
async function save(screen: Screen) {
  mockToast.mockClear()
  await fireEvent.press(screen.getAllByRole('button', { name: /^(common.save|settingsSubsystem.saveChoose)$/ })[0])
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'apiKeyPanel.providerSaved' })))
  await useSettingsStore.getState().flushProviderPersistence()
}
async function verifyAndReload(screen: Screen, selection: string[], manualModels?: string[]) {
  const current = useSettingsStore.getState().providers[0]
  expect(current.enabledModels).toEqual(selection)
  if (manualModels) expect(current.manualModels).toEqual(manualModels)
  expect(current.enabled).toBe(false)
  expect(useSettingsStore.getState().settings.defaultProvider).toBeNull()
  expect(getPolicyAllowedProviderModels(current, useSettingsStore.getState().settings).sort()).toEqual([...selection].sort())
  const persisted: AIProvider[] = JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)!)
  expect(persisted[0].enabledModels).toEqual(selection)
  await screen.unmount()
  useSettingsStore.setState({ providers: [] })
  await act(async () => { await useSettingsStore.getState().load() })
  expect(useSettingsStore.getState().providers[0].enabledModels).toEqual(selection)
}

it.each([{ selection: [] }, { selection: ['import-a'] }])('keeps explicit clipboard selection $selection with new imported IDs through Save and reload', async ({ selection }) => {
  const screen = await render(<Panel />)
  await paste(screen, config(selection))
  expect(useSettingsStore.getState().providers[0].enabledModels).toEqual(['saved-model'])
  await save(screen)
  await verifyAndReload(screen, selection, ['saved-model', 'import-a', 'import-b'])
})

it('accepts explicit selection pasted into the address field', async () => {
  const screen = await render(<Panel />)
  await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), config(['import-b']))
  await save(screen)
  await verifyAndReload(screen, ['import-b'])
})

it('imports explicit empty selection when all model IDs already exist (old regression)', async () => {
  const screen = await render(<Panel />)
  await paste(screen, config([], existingProvider.models))
  await save(screen)
  await verifyAndReload(screen, [])
})

it('retains the saved selection and auto-enables newly typed manual models', async () => {
  const screen = await render(<Panel />)
  await editModels(screen, 'saved-model\ndisabled-model\nmanual-new')
  await save(screen)
  await verifyAndReload(screen, ['saved-model', 'manual-new'])
})

it('auto-enables a manually added alias without enabling a previously disabled model', async () => {
  const screen = await render(<Panel />)
  await editModels(screen)
  await addAlias(screen, 'manual-alias', 'saved-model')
  await save(screen)
  await verifyAndReload(screen, ['saved-model', 'manual-alias'])
})

it('auto-enables manual additions after an explicit import while retaining its partial selection', async () => {
  const screen = await render(<Panel />)
  await paste(screen, config(['import-a']))
  await editModels(screen, 'saved-model\nimport-a\nimport-b\nmanual-new')
  await addAlias(screen, 'manual-alias', 'import-a')
  await save(screen)
  await verifyAndReload(screen, ['import-a', 'manual-new', 'manual-alias'])
})

it('lets an explicit empty import override manual additions made earlier in the draft', async () => {
  const screen = await render(<Panel />)
  await editModels(screen, 'saved-model\ndisabled-model\nmanual-before-import')
  await addAlias(screen, 'alias-before-import', 'saved-model')
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceConnection' }))
  await paste(screen, config([], ['saved-model', 'manual-before-import', 'import-a']))
  await save(screen)
  await verifyAndReload(screen, [])
})

it('uses the most recent explicit selection after repeated imports', async () => {
  const screen = await render(<Panel />)
  await paste(screen, config(['import-a']))
  await paste(screen, config([], ['saved-model', 'import-a', 'import-c']))
  await save(screen)
  await verifyAndReload(screen, [], ['saved-model', 'import-a', 'import-c'])
})

it('keeps auto-enable behavior for an import that omits enabledModels', async () => {
  const screen = await render(<Panel />)
  await paste(screen, config())
  await save(screen)
  await verifyAndReload(screen, ['saved-model', 'import-a', 'import-b'])
})

it('resets the addition baseline after Save so later edits preserve selection', async () => {
  const screen = await render(<Panel />)
  await paste(screen, config([]))
  await save(screen)
  await editModels(screen, 'saved-model\nimport-a\nimport-b\nmanual-later')
  await save(screen)
  await verifyAndReload(screen, ['manual-later'])
})

it('preserves explicit selection after a failed durable write and retry', async () => {
  const screen = await render(<Panel />)
  await paste(screen, config(['import-b']))
  const persist = jest.mocked(AsyncStorage.setItem).getMockImplementation()!
  let fail = true
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === APPLICATION_DATA_STORAGE_KEYS.PROVIDERS && fail) throw Error('Synthetic storage failure')
    return persist(key, value)
  })
  await fireEvent.press(screen.getByRole('button', { name: 'settingsSubsystem.saveChoose' }))
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'settingsWorkspace.saveFailed' })))
  fail = false
  await save(screen)
  await verifyAndReload(screen, ['import-b'])
})

it('enables only later manual additions after an explicit empty import', async () => {
  const screen = await render(<Panel />)
  await paste(screen, config([]))
  await editModels(screen, 'saved-model\nimport-a\nimport-b\nmanual-new')
  await addAlias(screen, 'manual-alias', 'manual-new')
  await save(screen)
  await verifyAndReload(screen, ['manual-new', 'manual-alias'])
})

it('auto-enables a manual addition when the saved selection is explicitly empty', async () => {
  await useSettingsStore.getState().updateProvider(existingProvider.id, { enabledModels: [] })
  const screen = await render(<Panel />)
  await editModels(screen, 'saved-model\ndisabled-model\nmanual-new')
  await save(screen)
  await verifyAndReload(screen, ['manual-new'])
})

it('keeps legacy undefined selection while adding a manual model', async () => {
  await useSettingsStore.getState().updateProvider(existingProvider.id, { enabledModels: undefined })
  const screen = await render(<Panel />)
  await editModels(screen, 'saved-model\ndisabled-model\nmanual-new')
  await save(screen)
  expect(useSettingsStore.getState().providers[0].enabledModels).toBeUndefined()
  expect(getPolicyAllowedProviderModels(useSettingsStore.getState().providers[0], useSettingsStore.getState().settings)).toEqual(['saved-model', 'disabled-model', 'manual-new'])
  await screen.unmount()
  useSettingsStore.setState({ providers: [] })
  await act(async () => { await useSettingsStore.getState().load() })
  expect(useSettingsStore.getState().providers[0].enabledModels).toBeUndefined()
})

it('does not auto-enable original disabled IDs restored by cancelling model editing after import', async () => {
  const screen = await render(<Panel />)
  await paste(screen, config([]))
  await editModels(screen, 'saved-model\nimport-a\nmanual-cancelled')
  await fireEvent.press(screen.getAllByRole('button', { name: 'common.cancel' })[0])
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceConnection' }))
  await save(screen)
  await verifyAndReload(screen, [], existingProvider.models)
})

it('drops an abandoned import baseline when the panel is reopened', async () => {
  const first = await render(<Panel />)
  await paste(first, config([]))
  await first.unmount()
  expect(useSettingsStore.getState().providers[0].enabledModels).toEqual(['saved-model'])
  const reopened = await render(<Panel />)
  await editModels(reopened, 'saved-model\ndisabled-model\nimport-a')
  await save(reopened)
  await verifyAndReload(reopened, ['saved-model', 'import-a'])
})

it('retains a clean external selection update when subsequently appending a manual model', async () => {
  const screen = await render(<Panel />)
  await act(async () => { await useSettingsStore.getState().updateProvider(existingProvider.id, { enabledModels: ['disabled-model'] }) })
  await editModels(screen, 'saved-model\ndisabled-model\nmanual-new')
  await save(screen)
  await verifyAndReload(screen, ['disabled-model', 'manual-new'])
})


async function addHealthCredential() {
  await useSettingsStore.getState().updateProvider(existingProvider.id, {
    credentialGroups: [{ id: 'health-key', label: 'Synthetic health key', apiKey: 'synthetic-health-key', enabled: true }],
  })
}
function healthSnapshot() {
  const group = useSettingsStore.getState().providers[0].credentialGroups!.find(item => item.id === 'health-key')!
  return { lastUsedAt: group.lastUsedAt, lastFailureAt: group.lastFailureAt, failureCount: group.failureCount }
}

it.each([{ selection: [] }, { selection: ['import-a'] }])('keeps explicit $selection and current credential health when telemetry changes after import', async ({ selection }) => {
  await addHealthCredential()
  const screen = await render(<Panel />)
  await paste(screen, config(selection))
  await act(async () => { await useSettingsStore.getState().updateProviderCredentialGroupHealth(existingProvider.id, 'health-key', false) })
  const latestHealth = healthSnapshot()
  await save(screen)
  expect(healthSnapshot()).toEqual(latestHealth)
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'settingsWorkspace.conflict' }))
  await verifyAndReload(screen, selection)
  expect(healthSnapshot()).toEqual(latestHealth)
})

it('keeps explicit selection and rebases health while Save waits in the real store admission queue', async () => {
  await addHealthCredential()
  const screen = await render(<Panel />)
  await paste(screen, config(['import-b']))
  let release!: () => void
  let admitted = false
  const pending = new Promise<void>(resolve => { release = resolve })
  mockAvailabilityChange.mockImplementationOnce(async (_ids, mutate) => {
    admitted = true
    await pending
    return mutate()
  })
  try {
    mockToast.mockClear()
    await fireEvent.press(screen.getByRole('button', { name: 'settingsSubsystem.saveChoose' }))
    await waitFor(() => expect(admitted).toBe(true))
    await act(async () => { await useSettingsStore.getState().updateProviderCredentialGroupHealth(existingProvider.id, 'health-key', false) })
    const latestHealth = healthSnapshot()
    await act(async () => { release() })
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'apiKeyPanel.providerSaved' })))
    await useSettingsStore.getState().flushProviderPersistence()
    expect(healthSnapshot()).toEqual(latestHealth)
    await verifyAndReload(screen, ['import-b'])
    expect(healthSnapshot()).toEqual(latestHealth)
  } finally { release() }
})

it('rejects a real concurrent selection edit while retaining the imported local draft', async () => {
  const screen = await render(<Panel />)
  await paste(screen, config([]))
  await act(async () => { await useSettingsStore.getState().updateProvider(existingProvider.id, { enabledModels: ['disabled-model'] }) })
  mockToast.mockClear()
  await fireEvent.press(screen.getByRole('button', { name: 'settingsSubsystem.saveChoose' }))
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'settingsWorkspace.conflict' }))
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'apiKeyPanel.providerSaved' }))
  expect(useSettingsStore.getState().providers[0].enabledModels).toEqual(['disabled-model'])
  expect(useSettingsStore.getState().providers[0].manualModels).toEqual(existingProvider.manualModels)
  await editModels(screen)
  expect(screen.getByLabelText('apiKeyPanel.customModels').props.value).toBe('saved-model\nimport-a\nimport-b')
})
