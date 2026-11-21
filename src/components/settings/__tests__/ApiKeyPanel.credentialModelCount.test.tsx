import { render, waitFor } from '@testing-library/react-native'
import { ApiKeyPanel } from '../ApiKeyPanel'
import { useSettingsStore } from '@/store/settingsStore'
import type { AIProvider, ProviderCredentialGroup } from '@/types/providerContracts'

let mockLanguage: 'zh-CN' | 'en' | 'ja' = 'zh-CN'
const mockWrite = jest.fn()
const mockExternal = jest.fn()
jest.mock('expo-router', () => ({ useNavigation: jest.fn() }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => {
  const resources = {
    'zh-CN': require('@/i18n/resources/zh-CN.json'),
    en: require('@/i18n/resources/en.json'),
    ja: require('@/i18n/resources/ja.json'),
  }
  const text = key.split('.').reduce((value, part) => value?.[part], resources[mockLanguage])
  return typeof text === 'string' ? text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values?.[name] ?? '')) : key
} }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { fine: 1.5, regular: 1.75, strong: 2 } }))
jest.mock('@/components/settings/SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('@/components/providers/ProviderLocalUsage', () => ({ ProviderLocalUsage: () => null }))
jest.mock('@/bootstrap/providerRegistry', () => ({ ...jest.requireActual('@/bootstrap/providerRegistry'),
  probeProviderPreset: (...args: unknown[]) => mockExternal(...args),
}))
jest.mock('@/bootstrap/providerActivationRuntime', () => ({ syncAndTestProvider: (...args: unknown[]) => mockExternal(...args) }))
jest.mock('@/components/providers/useProviderActivationJob', () => ({
  useProviderActivationJob: () => ({ activateProviders: mockExternal, isActivationRunning: false }),
}))

const initialState = useSettingsStore.getState()
const cases: { name: string; catalog: Partial<ProviderCredentialGroup>; known: boolean; count: number }[] = [
  { name: 'never fetched', catalog: {}, known: false, count: 0 },
  { name: 'first fetch failed', catalog: { availableModels: [], lastModelSyncStatus: 'bad' }, known: false, count: 0 },
  { name: 'confirmed empty', catalog: { availableModels: [], modelCatalogKnown: true }, known: true, count: 0 },
  { name: 'successful empty legacy catalog', catalog: { availableModels: [], lastModelSyncStatus: 'ok' }, known: true, count: 0 },
  { name: 'failed refresh of known empty catalog', catalog: { availableModels: [], modelCatalogKnown: true, lastModelSyncStatus: 'bad' }, known: true, count: 0 },
  { name: 'failed refresh retaining populated catalog', catalog: { availableModels: ['a', 'b'], lastModelSyncStatus: 'bad' }, known: true, count: 2 },
]

beforeEach(() => {
  jest.clearAllMocks()
  useSettingsStore.setState({ ...initialState, updateProvider: mockWrite, flushProviderPersistence: mockWrite })
})
afterEach(() => {
  expect(mockExternal).not.toHaveBeenCalled()
  expect(mockWrite).not.toHaveBeenCalled()
  useSettingsStore.setState(initialState, true)
})

describe.each(['zh-CN', 'en', 'ja'] as const)('%s credential model catalog status', language => {
  it.each(cases)('distinguishes $name in connection editing without changing configuration', async ({ catalog, known, count }) => {
    mockLanguage = language
    const provider: AIProvider = {
      id: 'catalog-fixture', name: 'Catalog fixture', type: 'openai-compatible', wireProtocol: 'openai-compatible',
      enabled: false, baseUrl: 'https://catalog.example.test/v1', apiKey: '', models: [],
      credentialGroups: [{ id: 'catalog-key', label: 'Catalog key', apiKey: '', enabled: true, ...catalog }],
    }
    useSettingsStore.setState({ providers: [provider] })
    const resources = require(`@/i18n/resources/${language}.json`)
    const countLabel = resources.apiKeyPanel.modelCount.replace('{{count}}', String(count))
    const unknownLabel = { 'zh-CN': '模型未获取', en: 'Models not fetched', ja: 'モデル未取得' }[language]
    const panel = await render(<ApiKeyPanel provider={provider} expanded hideHeader initialView="connection" />)
    await waitFor(() => expect(panel.getByText(known ? countLabel : unknownLabel)).toBeTruthy())
    expect(panel.queryByText(known ? unknownLabel : countLabel)).toBeNull()
    expect(useSettingsStore.getState().providers).toEqual([provider])
  })
})
