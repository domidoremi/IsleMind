import { render, within } from '@testing-library/react-native'
import { createInstance } from 'i18next'
import { ProviderImportReviewCard } from './ProviderImportReviewCard'
import type { AIProvider } from '@/types/providerContracts'
import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'
import zh from '@/i18n/resources/zh-CN.json'

const mockI18n = createInstance()
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => mockI18n.t(key, options) }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal') }) }))
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
const cases = [
  { name: 'credential path and userinfo', url: 'https://fixture-user:fixture-password@review.invalid:8443/endpoint-owned-key/v1?token=fixture-query#fixture-fragment', origin: 'https://review.invalid:8443' },
  { name: 'local HTTP path', url: 'http://127.0.0.1:18081/endpoint-owned-key/v1?token=fixture-query#fixture-fragment', origin: 'http://127.0.0.1:18081' },
  { name: 'IPv6 path', url: 'http://[::1]:18081/endpoint-owned-key/v1', origin: 'http://[::1]:18081' },
  { name: 'encoded credential path', url: 'https://review.invalid/private%2Fendpoint-owned-key%2Fv1', origin: 'https://review.invalid' },
  { name: 'bare local address', url: 'localhost:11434/endpoint-owned-key/v1', origin: 'https://localhost:11434' },
  { name: 'non-HTTP address', url: 'file:///private/endpoint-owned-key/v1', origin: undefined },
  { name: 'invalid address', url: 'not a valid address', origin: undefined },
]
const reviewCopy = {
  'zh-CN': { preferred: '首选', disabled: '已停用', selected: '已选 1 / 1', strategy: '轮换使用', models: '1 个模型' },
  en: { preferred: 'Preferred', disabled: 'Disabled', selected: '1 of 1 selected', strategy: 'Least recently used', models: '1 model' },
  ja: { preferred: '優先', disabled: '無効', selected: '1 件中 1 件選択', strategy: '使用間隔順', models: '1 モデル' },
}
const fixture = (baseUrl: string): AIProvider => ({
  id: 'endpoint-review-fixture', name: 'Endpoint review fixture', type: 'openai', enabled: false,
  apiKey: 'endpoint-owned-key', baseUrl, models: ['Model'], enabledModels: ['Model'],
  credentialGroups: [{ id: 'endpoint-owner', label: 'Endpoint owner', apiKey: 'endpoint-owned-key', enabled: false,
    availableModels: ['Model'], modelCatalogKnown: true }],
  credentialSelection: { strategy: 'least-recently-used', preferredGroupId: 'endpoint-owner' },
})
beforeAll(async () => {
  await mockI18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: en }, ja: { translation: ja }, 'zh-CN': { translation: zh } }, interpolation: { escapeValue: false } })
})
it.each(languages.flatMap(language => cases.map(item => ({ language, ...item }))))(
  'keeps only the connection origin in $language for $name and preserves the complete request configuration',
  async ({ language, url, origin }) => {
    await mockI18n.changeLanguage(language)
    const value = fixture(url), before = JSON.stringify(value)
    const screen = await render(<ProviderImportReviewCard provider={value} protocolLabel="OpenAI compatible" />)
    expect(screen.getByText(origin ?? String(mockI18n.t('providerSettings.baseUrl')))).toBeTruthy()
    expect(screen.queryByText(/endpoint-owned-key|fixture-user|fixture-password|fixture-query|fixture-fragment|private/)).toBeNull()
    expect(screen.getByText(value.name)).toBeTruthy()
    const key = within(screen.getByTestId('provider-import-key-review'))
    expect(key.getByText(reviewCopy[language].preferred)).toBeTruthy()
    expect(key.getByText(reviewCopy[language].disabled)).toBeTruthy()
    expect(key.getByText(reviewCopy[language].models)).toBeTruthy()
    expect(screen.getByText(reviewCopy[language].selected)).toBeTruthy()
    expect(screen.getByText(reviewCopy[language].strategy)).toBeTruthy()
    expect(screen.queryByText(/apiKeyPanel\.|providerSettings\./)).toBeNull()
    expect(JSON.stringify(value)).toBe(before)
    expect(value.baseUrl).toBe(url)
    expect(value.apiKey).toBe('endpoint-owned-key')
    expect(value.credentialGroups?.[0].apiKey).toBe('endpoint-owned-key')
  },
)
