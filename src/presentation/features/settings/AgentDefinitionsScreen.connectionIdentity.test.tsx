import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { Platform } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { createAgentDefinition, type AgentDefinition, type AgentDefinitionManagement } from '@/modules/assistant-runtime'
import type { AIProvider } from '@/types/providerContracts'
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
let mockProviders: AIProvider[] = []
const mockState = { get providers() { return mockProviders }, settings: { hapticsEnabled: false } }
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
beforeEach(() => {
  mockLanguage = 'en'
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  const colors = getColors('dark', 'animal-island-ui')
  jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design!, canonicalThemeId: 'animal-island-ui', mode: 'dark', isDark: true } as ReturnType<typeof useAppTheme>)
})
afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform }))

const provider = (input: Partial<AIProvider>): AIProvider => ({
  id: 'provider-a', name: 'Same', type: 'openai-compatible', apiKey: '', baseUrl: '', enabled: true,
  modelCatalogKnown: true, models: ['model-a'], ...input,
})
const manager = (rows: AgentDefinition[] = []): AgentDefinitionManagement => ({
  list: jest.fn().mockResolvedValue(rows), get: jest.fn(async id => rows.find(row => row.id === id)), remove: jest.fn(), clear: jest.fn(),
  importDraft: jest.fn(), exportSaved: jest.fn(),
  newDraft: jest.fn(input => createAgentDefinition({ ...input, id: 'new-connection-identity' })),
  save: jest.fn(async definition => ({ ...definition, revision: definition.revision + 1 })),
})

it.each(['en', 'ja', 'zh-CN'] as const)('%s selects a distinct same-name connection without changing saved address or identity', async language => {
  mockLanguage = language
  mockProviders = [
    provider({ id: 'provider-a', baseUrl: 'https://fixture-user:fixture-pass@alpha.example:8443/private?token=fixture#hidden' }),
    provider({ id: 'provider-b', baseUrl: 'https://beta.example:8443/v1', models: ['model-b'] }),
  ]
  const originalProviders = JSON.stringify(mockProviders), management = manager()
  const screen = await render(<IsleThemeProvider><AgentDefinitionsScreen management={management} /></IsleThemeProvider>)
  await fireEvent.press(screen.getByRole('button', { name: mockTranslate('agents.create') }))
  const field = mockTranslate('agents.fields.providerId')
  await waitFor(() => expect(screen.getByRole('combobox', { name: field })).toHaveAccessibilityValue({ text: 'Same · alpha.example:8443' }))
  await fireEvent.press(screen.getByRole('combobox', { name: field }))
  expect(screen.getAllByRole('option').map(node => node.props.accessibilityLabel)).toEqual(['Same · alpha.example:8443', 'Same · beta.example:8443'])
  expect(JSON.stringify(screen.toJSON())).not.toMatch(/fixture-pass|\/private|token=fixture|#hidden/)
  await fireEvent.press(screen.getByRole('option', { name: 'Same · beta.example:8443' }))
  expect(screen.getByRole('combobox', { name: field })).toHaveAccessibilityValue({ text: 'Same · beta.example:8443' })
  expect(screen.getByRole('combobox', { name: mockTranslate('agents.fields.modelId') })).toHaveAccessibilityValue({ text: 'model-b' })
  await fireEvent.press(screen.getByRole('button', { name: mockTranslate('common.save') }))
  await waitFor(() => expect(management.save).toHaveBeenCalledTimes(1))
  expect(jest.mocked(management.save).mock.calls[0][0].modelBinding).toMatchObject({ providerId: 'provider-b', modelId: 'model-b' })
  expect(JSON.stringify(mockProviders)).toBe(originalProviders)
  await screen.unmount()
})

it.each(['en', 'ja', 'zh-CN'] as const)('%s keeps saved same-host connection ordinals aligned with exact provider IDs', async language => {
  mockLanguage = language
  mockProviders = [
    provider({ id: 'provider-z', baseUrl: 'https://api.example:8443/z', models: ['model-z'] }),
    provider({ id: 'provider-a', baseUrl: 'https://api.example:8443/a', models: ['model-a'] }),
  ]
  const definitions = [
    createAgentDefinition({ id: 'saved-z', name: 'Saved Z', providerId: 'provider-z', modelId: 'model-z' }),
    createAgentDefinition({ id: 'saved-a', name: 'Saved A', providerId: 'provider-a', modelId: 'model-a' }),
  ]
  const originalProviders = JSON.stringify(mockProviders), management = manager(definitions)
  const screen = await render(<IsleThemeProvider><AgentDefinitionsScreen management={management} /></IsleThemeProvider>)
  const textOnly = mockTranslate('agents.capabilities.text_only')
  expect(textOnly).not.toBe('agents.capabilities.text_only')
  await waitFor(() => expect(screen.getByText('Same · api.example:8443 · 2 · model-z · ' + textOnly)).toBeTruthy())
  expect(screen.getByText('Same · api.example:8443 · 1 · model-a · ' + textOnly)).toBeTruthy()
  expect(JSON.stringify(mockProviders)).toBe(originalProviders)
  expect(management.save).not.toHaveBeenCalled()
  await screen.unmount()
})
