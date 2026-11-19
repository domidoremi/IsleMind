import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import { ApiKeyPanel } from '../ApiKeyPanel'
import { useSettingsStore } from '@/store/settingsStore'
import { getProviderPreset } from '@/bootstrap/providerRegistry'
import { DEFAULT_PROVIDER_PRESET_ID } from '@/modules/providers'
import type { AIProvider, ProviderCredentialGroup } from '@/types/providerContracts'

let mockLanguage = 'zh-CN'
const mockHydrate = jest.fn()
const mockUpdate = jest.fn()
const mockSync = jest.fn()
const mockProbe = jest.fn()
const mockActivate = jest.fn()
jest.mock('expo-router', () => ({ useNavigation: jest.fn() }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('expo-clipboard', () => ({ hasStringAsync: async () => false, getStringAsync: jest.fn() }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => {
  const resources: Record<string, unknown> = {
    'zh-CN': require('@/i18n/resources/zh-CN.json'), en: require('@/i18n/resources/en.json'), ja: require('@/i18n/resources/ja.json'),
  }
  const value = key.split('.').reduce<any>((current, part) => current?.[part], resources[mockLanguage])
  return typeof value === 'string' ? value : key
} }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: ({ children }: any) => children }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { fine: 1.5, regular: 1.75, strong: 2 } }))
jest.mock('@/components/settings/SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('@/components/providers/ProviderLocalUsage', () => ({ ProviderLocalUsage: () => null }))
jest.mock('@/components/ui/isle', () => ({
  ...jest.requireActual('@/components/ui/isle'), useIsleDialog: () => ({ toast: jest.fn(), notice: jest.fn(), confirm: jest.fn() }),
}))
jest.mock('@/bootstrap/providerRegistry', () => ({
  ...jest.requireActual('@/bootstrap/providerRegistry'), probeProviderPreset: (...args: unknown[]) => mockProbe(...args),
}))
jest.mock('@/bootstrap/providerActivationRuntime', () => ({ syncAndTestProvider: (...args: unknown[]) => mockSync(...args) }))
jest.mock('@/components/providers/useProviderActivationJob', () => ({
  useProviderActivationJob: () => ({ activateProviders: mockActivate, isActivationRunning: false }),
}))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({ flushPersistedSettings: jest.fn() }))

const initial = useSettingsStore.getState()
const group = (enabled: boolean, apiKey = ''): ProviderCredentialGroup => ({ id: 'stored-key', label: 'Stored key', enabled, apiKey })
const provider = (groups: ProviderCredentialGroup[] = [group(false)]): AIProvider => ({
  id: 'credential-status-fixture', name: 'Credential status fixture', type: getProviderPreset(DEFAULT_PROVIDER_PRESET_ID).type,
  enabled: false, baseUrl: 'https://example.test/v1', apiKey: '', models: [], credentialGroups: groups,
})
function Panel({ view = 'connection' as 'connection' | 'models' }) {
  const current = useSettingsStore(state => state.providers[0])
  return <ApiKeyPanel provider={current} expanded hideHeader initialView={view} />
}
const resource = (key: string) => {
  const resources: Record<string, any> = {
    'zh-CN': require('@/i18n/resources/zh-CN.json'), en: require('@/i18n/resources/en.json'), ja: require('@/i18n/resources/ja.json'),
  }
  return key.split('.').reduce((current, part) => current?.[part], resources[mockLanguage]) as string
}
const disabledText = '已保存密钥均已停用'
beforeEach(() => {
  jest.clearAllMocks()
  mockLanguage = 'zh-CN'
  mockHydrate.mockReset().mockImplementation(async () => ({
    ...useSettingsStore.getState().providers[0],
    credentialGroups: [group(false, 'synthetic-disabled-credential')],
  }))
  useSettingsStore.setState({ ...initial, providers: [provider()], hydrateProviderKey: mockHydrate, updateProvider: mockUpdate })
})
afterEach(() => {
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(mockSync).not.toHaveBeenCalled()
  expect(mockProbe).not.toHaveBeenCalled()
  expect(mockActivate).not.toHaveBeenCalled()
  useSettingsStore.setState(initial, true)
})

it.each([
  ['zh-CN', disabledText], ['en', 'Saved keys are disabled'], ['ja', '保存済みのキーは無効です'],
])('shows saved disabled credentials in %s without presenting them as missing or usable', async (language, expected) => {
  mockLanguage = language
  const screen = await render(<Panel />)
  await waitFor(() => expect(screen.getByText(new RegExp(expected))).toBeTruthy())
  expect(screen.queryByText(new RegExp(resource('settingsSubsystem.connectionMissing')))).toBeNull()
  expect(screen.queryByText(new RegExp(resource('settingsSubsystem.connectionReady')))).toBeNull()
})

it('reports missing credentials when disabled metadata has no stored key, even with a leftover legacy key', async () => {
  mockHydrate.mockResolvedValueOnce({ ...provider(), apiKey: 'synthetic-legacy-leftover' })
  const screen = await render(<Panel />)
  await waitFor(() => expect(screen.getByText(new RegExp(`^${resource('settingsSubsystem.connectionMissing')} · `))).toBeTruthy())
  expect(screen.queryByText(new RegExp(disabledText))).toBeNull()
  expect(screen.queryByText(new RegExp(resource('settingsSubsystem.connectionReady')))).toBeNull()
})

it('distinguishes an enabled empty group from a saved disabled credential', async () => {
  const groups = [group(false), { ...group(true), id: 'empty-enabled', label: 'Empty enabled' }]
  useSettingsStore.setState({ providers: [provider(groups)] })
  mockHydrate.mockResolvedValueOnce(provider([{ ...groups[0], apiKey: 'synthetic-disabled-credential' }, groups[1]]))
  const screen = await render(<Panel />)
  await waitFor(() => expect(screen.getByText(new RegExp(disabledText))).toBeTruthy())
  expect(screen.queryByText(new RegExp(resource('settingsSubsystem.connectionReady')))).toBeNull()
})

it('reports ready when at least one enabled stored credential exists', async () => {
  mockHydrate.mockResolvedValueOnce(provider([group(false, 'synthetic-disabled'),
    { ...group(true, 'synthetic-enabled'), id: 'enabled-key' }]))
  const screen = await render(<Panel />)
  await waitFor(() => expect(screen.getByText(new RegExp(resource('settingsSubsystem.connectionReady')))).toBeTruthy())
  expect(screen.queryByText(new RegExp(disabledText))).toBeNull()
})

it('keeps legacy connections with a stored key ready', async () => {
  useSettingsStore.setState({ providers: [{ ...provider(), credentialGroups: undefined }] })
  mockHydrate.mockResolvedValueOnce({ ...provider(), credentialGroups: undefined, apiKey: 'synthetic-legacy' })
  const screen = await render(<Panel />)
  await waitFor(() => expect(screen.getByText(new RegExp(resource('settingsSubsystem.connectionReady')))).toBeTruthy())
  expect(screen.queryByText(new RegExp(disabledText))).toBeNull()
})

it('retains a secure read failure and can retry into the saved-disabled state without probing', async () => {
  mockHydrate.mockRejectedValueOnce(Error('synthetic secure-storage failure'))
  const screen = await render(<Panel />)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(new RegExp(resource('settingsSubsystem.loadFailed'))))
  await fireEvent.press(within(screen.getByRole('alert').parent!).getByRole('button', { name: resource('common.retry') }))
  await waitFor(() => expect(screen.getByText(new RegExp(disabledText))).toBeTruthy())
  expect(screen.queryByRole('alert')).toBeNull()
  expect(mockHydrate).toHaveBeenCalledTimes(2)
})

it('ignores a late disabled-credential read after leaving the connection tab', async () => {
  let finish!: (value: AIProvider) => void
  mockHydrate.mockImplementationOnce(() => new Promise<AIProvider>(resolve => { finish = resolve }))
  const screen = await render(<Panel />)
  await fireEvent.press(screen.getByRole('tab', { name: resource('apiKeyPanel.workspaceModels') }))
  await act(() => finish(provider([group(false, 'synthetic-disabled-credential')])))
  expect(screen.queryByText(new RegExp(disabledText))).toBeNull()
  expect(screen.getByText(new RegExp(resource('settingsSubsystem.savedNotVerified')))).toBeTruthy()
})
