import { fireEvent, render, within } from '@testing-library/react-native'
import { createInstance } from 'i18next'
import { ProviderImportReviewCard } from './ProviderImportReviewCard'
import type { AIProvider, ProviderCredentialGroup } from '@/types/providerContracts'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'
import zh from '@/i18n/resources/zh-CN.json'

const mockI18n = createInstance()
let mockTheme: CanonicalThemeId = 'minimal'
let mockMode = 'light'
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => mockI18n.t(key, options) }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors(mockMode, mockTheme) }) }))
jest.mock('@/components/ui/AppText', () => ({ Text: require('react-native').Text }))
jest.mock('@/modules/providers', () => ({
  hasCredentialModelCatalog: jest.requireActual('@/modules/providers/providerModelCatalog').hasCredentialModelCatalog,
  normalizeProviderCredentialGroups: jest.requireActual('@/modules/providers/providerCredentialGroups').normalizeProviderCredentialGroups,
  providerSettingsEndpointOrigin: jest.requireActual('@/modules/providers/providerSettingsList').providerSettingsEndpointOrigin,
}))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text } = require('react-native')
  return { IsleButton: ({ label, ...props }: any) => <Pressable accessibilityRole="button" accessibilityLabel={label} {...props}><Text>{label}</Text></Pressable> }
})

const languages = ['zh-CN', 'en', 'ja'] as const
const group = (extra: Partial<ProviderCredentialGroup> = {}): ProviderCredentialGroup => ({
  id: 'reviewed-key', label: 'Reviewed key', apiKey: 'synthetic-card-key', enabled: true, availableModels: [], ...extra,
})
const provider = (extra: Partial<AIProvider> = {}): AIProvider => ({
  id: 'reviewed-connection', type: 'openai', name: 'Reviewed connection', apiKey: '', enabled: false,
  baseUrl: 'https://synthetic-address-user:synthetic-address-password@example.invalid/v1?token=synthetic-address-query#synthetic-address-fragment',
  models: [], credentialGroups: [group()], ...extra,
})
const tree = (value: AIProvider) => <ProviderImportReviewCard provider={value} protocolLabel="Anthropic compatible" />
const tr = (key: string, values?: Record<string, unknown>) => {
  const value = String(mockI18n.t(key, values))
  expect(value).not.toBe(key)
  return value
}
beforeAll(async () => { await mockI18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: en }, ja: { translation: ja }, 'zh-CN': { translation: zh } }, interpolation: { escapeValue: false } }) })
beforeEach(() => { mockTheme = 'minimal'; mockMode = 'light' })

it.each(languages.flatMap(language => [undefined, false].map(known => [language, known] as const)))('shows the successful empty legacy catalog in %s with known=%s', async (language, known) => {
  await mockI18n.changeLanguage(language)
  const value = provider({ credentialGroups: [group({ lastModelSyncStatus: 'ok', modelCatalogKnown: known })] })
  const before = JSON.stringify(value)
  const screen = await render(tree(value))
  const row = within(screen.getByTestId('provider-import-key-review'))
  expect(row.getByText(tr('apiKeyPanel.modelCount', { count: 0 }))).toBeTruthy()
  expect(row.queryByText(tr('providerSettings.importCatalogUnknown'))).toBeNull()
  expect(JSON.stringify(value)).toBe(before)
})

it.each(languages)('keeps a previously confirmed empty catalog after a failed refresh in %s', async language => {
  await mockI18n.changeLanguage(language)
  const screen = await render(tree(provider({ credentialGroups: [group({ modelCatalogKnown: true, lastModelSyncStatus: 'bad' })] })))
  const row = within(screen.getByTestId('provider-import-key-review'))
  expect(row.getByText(tr('apiKeyPanel.modelCount', { count: 0 }))).toBeTruthy()
  expect(row.queryByText(tr('providerSettings.importCatalogUnknown'))).toBeNull()
})

it.each(languages)('keeps an unconfirmed empty catalog distinct from zero models in %s', async language => {
  await mockI18n.changeLanguage(language)
  const screen = await render(tree(provider({ credentialGroups: [group({ lastModelSyncStatus: 'bad', modelCatalogKnown: false })] })))
  const row = within(screen.getByTestId('provider-import-key-review'))
  expect(row.getByText(tr('providerSettings.importCatalogUnknown'))).toBeTruthy()
  expect(row.queryByText(tr('apiKeyPanel.modelCount', { count: 0 }))).toBeNull()
})

it.each(languages)('shows each owner, selection, disabled state and preference without copying a manual model into an unknown catalog in %s', async language => {
  await mockI18n.changeLanguage(language)
  const value = provider({ models: ['Model', 'model'], manualModels: ['manual', 'Model'], enabledModels: ['manual', 'missing'],
    credentialGroups: [group({ id: 'paused', label: 'Paused owner', enabled: false, availableModels: ['Model'], modelCatalogKnown: true }),
      group({ id: 'preferred', label: 'Empty preferred owner', modelCatalogKnown: true }), group({ id: 'unknown', label: 'Unknown owner' })],
    credentialSelection: { strategy: 'least-recently-used', preferredGroupId: 'preferred' },
  })
  const before = JSON.stringify(value)
  const screen = await render(tree(value))
  expect(screen.getByText(tr('apiKeyPanel.modelsSelectedCount', { selected: 1, total: 3 }))).toBeTruthy()
  expect(screen.getByText(tr('providerSettings.importCredentialState', { enabled: 2, disabled: 1 }))).toBeTruthy()
  const rows = screen.getAllByTestId('provider-import-key-review').map(row => within(row))
  expect(rows[0].getByText(tr('apiKeyPanel.disabledState'))).toBeTruthy()
  expect(rows[0].getByText(tr('apiKeyPanel.modelCount', { count: 1 }))).toBeTruthy()
  expect(rows[0].queryByText(tr('apiKeyPanel.preferredCredential'))).toBeNull()
  expect(rows[1].getByText(tr('apiKeyPanel.preferredCredential'))).toBeTruthy()
  expect(rows[1].getByText(tr('apiKeyPanel.modelCount', { count: 0 }))).toBeTruthy()
  expect(rows[2].getByText(tr('providerSettings.importCatalogUnknown'))).toBeTruthy()
  expect(screen.getByText('Anthropic compatible')).toBeTruthy()
  expect(screen.getByText('https://example.invalid')).toBeTruthy()
  expect(screen.queryByText(/synthetic-/)).toBeNull()
  expect(JSON.stringify(value)).toBe(before)
})

it.each(languages)('retains the single legacy primary key and its confirmed zero-model catalog in %s', async language => {
  await mockI18n.changeLanguage(language)
  const value = provider({ credentialGroups: undefined, apiKey: 'synthetic-card-primary', lastModelSyncStatus: 'ok' })
  const before = JSON.stringify(value)
  const screen = await render(tree(value))
  expect(screen.getByText(language === 'en' ? '1 key · hidden' : tr('providerSettings.importCredentialSummary', { count: 1 }))).toBeTruthy()
  expect(screen.getByText(tr('providerSettings.importCredentialState', { enabled: 1, disabled: 0 }))).toBeTruthy()
  expect(within(screen.getByTestId('provider-import-key-review')).getByText(tr('apiKeyPanel.modelCount', { count: 0 }))).toBeTruthy()
  expect(screen.queryByText(/synthetic-/)).toBeNull()
  expect(JSON.stringify(value)).toBe(before)
})

it.each(languages)('keeps a manual-only legacy primary key catalog unknown in %s', async language => {
  await mockI18n.changeLanguage(language)
  const value = provider({ credentialGroups: [], apiKey: 'synthetic-card-primary', models: ['manual'], manualModels: ['manual'] })
  const screen = await render(tree(value))
  const row = within(screen.getByTestId('provider-import-key-review'))
  expect(row.getByText(tr('providerSettings.importCatalogUnknown'))).toBeTruthy()
  expect(row.queryByText(tr('apiKeyPanel.modelCount', { count: 1 }))).toBeNull()
})

it.each(languages)('expands all thirteen reviewed keys without changing their configuration in %s', async language => {
  await mockI18n.changeLanguage(language)
  const value = provider({ credentialGroups: Array.from({ length: 13 }, (_, index) => group({ id: 'review-' + index, label: 'Reviewed owner ' + index, modelCatalogKnown: true })) })
  const before = JSON.stringify(value)
  const screen = await render(tree(value))
  expect(screen.getAllByTestId('provider-import-key-review')).toHaveLength(3)
  await fireEvent.press(screen.getByRole('button', { name: tr('providerSettings.importShowMoreKeys') }))
  expect(screen.getAllByTestId('provider-import-key-review')).toHaveLength(11)
  await fireEvent.press(screen.getByRole('button', { name: tr('providerSettings.importShowMoreKeys') }))
  expect(screen.getAllByTestId('provider-import-key-review')).toHaveLength(13)
  expect(screen.queryByRole('button', { name: tr('providerSettings.importShowMoreKeys') })).toBeNull()
  expect(JSON.stringify(value)).toBe(before)
})

it('preserves reviewed identity and catalog values through all five themes and both modes', async () => {
  await mockI18n.changeLanguage('en')
  const value = provider({ credentialGroups: [group({ modelCatalogKnown: true })] })
  const screen = await render(tree(value))
  const original = screen.getByTestId('provider-import-connection-review')
  for (const theme of CANONICAL_THEME_IDS) for (const mode of ['light', 'dark']) {
    mockTheme = theme; mockMode = mode
    await screen.rerender(tree(value))
    expect(screen.getByTestId('provider-import-connection-review')).toBe(original)
    expect(screen.getByText(value.name)).toBeTruthy()
    expect(within(screen.getByTestId('provider-import-key-review')).getByText(tr('apiKeyPanel.modelCount', { count: 0 }))).toBeTruthy()
  }
})
