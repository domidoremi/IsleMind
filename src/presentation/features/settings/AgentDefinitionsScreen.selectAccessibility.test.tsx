import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { Platform } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { createAgentDefinition } from '@/modules/assistant-runtime'
import { AgentDefinitionsScreen } from './AgentDefinitionsScreen'
import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'
import zh from '@/i18n/resources/zh-CN.json'

let mockLanguage: 'en' | 'ja' | 'zh-CN' = 'en'
const mockResources = { en, ja, 'zh-CN': zh }
const mockTranslate = (key: string, values?: Record<string, unknown>) => {
  const result = key.split('.').reduce<unknown>((value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined, mockResources[mockLanguage])
  if (typeof result !== 'string') return key
  return result.replace(/\{\{(\w+)\}\}/g, (match, name) => values?.[name] === undefined ? match : String(values[name]))
}
const mockProviders = [
  { id: 'provider-a', name: 'Connection A', type: 'openai-compatible', apiKey: '', enabled: true, baseUrl: '', modelCatalogKnown: true, models: ['model-a'] },
  { id: 'provider-b', name: 'Connection B', type: 'openai-compatible', apiKey: '', enabled: true, baseUrl: '', modelCatalogKnown: true, models: ['model-b'] },
]
const mockState = { providers: mockProviders, settings: { hapticsEnabled: false } }
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: (select: (state: unknown) => unknown) => select(mockState) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 24, left: 0 }) }))
jest.mock('@/components/ui/isle', () => ({ ...jest.requireActual('@/components/ui/isle'), useIsleDialog: () => ({ confirm: jest.fn().mockResolvedValue(true), toast: jest.fn() }) }))

jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: jest.fn() }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))

const originalPlatform = Platform.OS
beforeEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' }))
afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform }))
const cases = (['zh-CN', 'en', 'ja'] as const).flatMap(language => (['light', 'dark'] as const).map(mode => ({ language, mode })))

it.each(cases)('names all four native agent selectors and reports actual chosen values in $language $mode', async ({ language, mode }) => {
  mockLanguage = language
  const colors = getColors(mode, 'animal-island-ui')
  jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design!, canonicalThemeId: 'animal-island-ui', mode, isDark: mode === 'dark' } as ReturnType<typeof useAppTheme>)
  const management = {
    list: jest.fn().mockResolvedValue([]), get: jest.fn().mockResolvedValue(undefined), save: jest.fn(), remove: jest.fn(), clear: jest.fn(),
    newDraft: jest.fn((input) => createAgentDefinition({ ...input, id: 'new-agent' })), importDraft: jest.fn(), exportSaved: jest.fn(),
  }
  const screen = await render(<IsleThemeProvider><AgentDefinitionsScreen management={management} /></IsleThemeProvider>)
  await fireEvent.press(screen.getByRole('button', { name: mockTranslate('agents.create') }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: mockTranslate('agents.fields.providerId') })).toBeTruthy())
  await fireEvent.press(screen.getByRole('button', { name: mockTranslate('settingsWorkspace.advanced') }))
  const fields = ['agents.fields.providerId', 'agents.fields.modelId', 'agents.actionCapability', 'agents.reviewer']
  for (const key of fields) {
    const label = mockTranslate(key)
    expect(label).not.toBe(key)
    expect(screen.getByRole('combobox', { name: label })).toBeTruthy()
  }
  expect(screen.getByRole('combobox', { name: mockTranslate('agents.fields.providerId') })).toHaveAccessibilityValue({ text: 'Connection A' })
  expect(screen.getByRole('combobox', { name: mockTranslate('agents.fields.modelId') })).toHaveAccessibilityValue({ text: 'model-a' })
  expect(screen.getByRole('combobox', { name: mockTranslate('agents.actionCapability') })).toHaveAccessibilityValue({ text: mockTranslate('agents.capabilities.text_only') })
  expect(screen.getByRole('combobox', { name: mockTranslate('agents.reviewer') })).toHaveAccessibilityValue({ text: mockTranslate('agents.reviewerModes.off') })
  await fireEvent.press(screen.getByRole('combobox', { name: mockTranslate('agents.fields.providerId') }))
  await fireEvent.press(screen.getByRole('option', { name: 'Connection B' }))
  expect(screen.getByRole('combobox', { name: mockTranslate('agents.fields.providerId') })).toHaveAccessibilityValue({ text: 'Connection B' })
  await fireEvent.press(screen.getByRole('combobox', { name: mockTranslate('agents.fields.modelId') }))
  await fireEvent.press(screen.getByRole('option', { name: 'model-b' }))
  expect(screen.getByRole('combobox', { name: mockTranslate('agents.fields.modelId') })).toHaveAccessibilityValue({ text: 'model-b' })
  await fireEvent.press(screen.getByRole('combobox', { name: mockTranslate('agents.reviewer') }))
  await fireEvent.press(screen.getByRole('option', { name: mockTranslate('agents.reviewerModes.read_only') }))
  expect(screen.getByRole('combobox', { name: mockTranslate('agents.reviewer') })).toHaveAccessibilityValue({ text: mockTranslate('agents.reviewerModes.read_only') })
  expect(management.save).not.toHaveBeenCalled()
  expect(management.newDraft).toHaveBeenCalledTimes(1)
  await screen.unmount()
})
