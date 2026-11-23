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
  id: 'provider-b', name: 'Connection B', type: 'openai-compatible', apiKey: '', baseUrl: '', enabled: true,
  modelCatalogKnown: true, models: [], ...input,
})
const cases = [
  { name: 'uses the next provider tested selected model', initial: 'model-a', next: provider({ models: ['model-b-first', 'model-b-tested'], lastTestStatus: 'ok', lastTestModel: 'model-b-tested' }), expected: 'model-b-tested' },
  { name: 'preserves a shared model selected by the next provider', initial: 'shared-model', next: provider({ models: ['model-b', 'shared-model'] }), expected: 'shared-model' },
  { name: 'replaces a shared model deselected by the next provider', initial: 'shared-model', next: provider({ models: ['shared-model', 'model-b'], enabledModels: ['model-b'] }), expected: 'model-b' },
  { name: 'uses a selected alias when no remote model is selected', initial: 'model-a', next: provider({ modelAliases: [{ alias: 'alias-b', model: 'upstream-b' }], enabledModels: ['alias-b'] }), expected: 'alias-b' },
  { name: 'clears the old model for a confirmed empty catalog', initial: 'model-a', next: provider({}), expected: '' },
  { name: 'clears the old model before an unknown catalog is entered manually', initial: 'model-a', next: provider({ modelCatalogKnown: false }), expected: '' },
  { name: 'uses models belonging to an enabled credential', initial: 'model-a', next: provider({ modelCatalogKnown: false, credentialGroups: [{ id: 'credential-b', label: 'Credential B', apiKey: '', enabled: true, modelCatalogKnown: true, availableModels: ['credential-model-b'] }] }), expected: 'credential-model-b' },
  { name: 'uses an explicitly selected manual model', initial: 'model-a', next: provider({ modelCatalogKnown: false, manualModels: ['manual-model-b'], enabledModels: ['manual-model-b'] }), expected: 'manual-model-b' },
  { name: 'does not revive a model from a disabled credential aggregate', initial: 'model-a', next: provider({ models: ['model-a'], credentialGroups: [{ id: 'credential-disabled', label: 'Disabled', apiKey: '', enabled: false, modelCatalogKnown: true, availableModels: ['model-a'] }] }), expected: '' },
  { name: 'preserves an imported manual model when the same provider is selected', initial: 'imported-manual-a', next: provider({ id: 'provider-a', name: 'Connection A', models: ['model-a'] }), expected: 'imported-manual-a' },
]

it.each(cases)('$name and saves the exact binding and remaining draft', async ({ initial, next, expected }) => {
  mockProviders = [provider({ id: 'provider-a', name: 'Connection A', models: ['model-a', 'shared-model'] }), next.id === 'provider-a' ? provider({ models: ['model-b'] }) : next]
  const management: AgentDefinitionManagement = {
    list: jest.fn().mockResolvedValue([]), get: jest.fn().mockResolvedValue(undefined), remove: jest.fn(), clear: jest.fn(),
    importDraft: jest.fn(), exportSaved: jest.fn(),
    newDraft: jest.fn((input): AgentDefinition => {
      const definition = createAgentDefinition({ ...input, id: 'new-provider-switch-agent' })
      return { ...definition, instructions: 'Preserve exact instructions.\nSecond line.',
        modelBinding: { ...definition.modelBinding, modelId: initial, actionCapability: 'native_tool_calling', capabilityRevision: 'original-capability-revision' },
        allowedToolIds: ['existing-tool'], knowledgeIds: ['existing-knowledge'], skillIds: ['existing-skill'], delegateAgentIds: ['existing-delegate'],
        reviewerPolicy: { mode: 'read_only', agentId: 'existing-reviewer', maxReviews: 1 },
      }
    }),
    save: jest.fn(async (definition: AgentDefinition) => ({ ...definition, revision: definition.revision + 1 })),
  }
  const screen = await render(<IsleThemeProvider><AgentDefinitionsScreen management={management} /></IsleThemeProvider>)
  await fireEvent.press(screen.getByRole('button', { name: mockTranslate('agents.create') }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: mockTranslate('agents.fields.providerId') })).toBeTruthy())
  const original = jest.mocked(management.newDraft).mock.results[0].value as AgentDefinition
  expect(screen.getByRole('combobox', { name: mockTranslate('agents.actionCapability') })).toHaveAccessibilityValue({ text: mockTranslate('agents.capabilities.native_tool_calling') })
  expect(screen.getByRole('combobox', { name: mockTranslate('agents.fields.modelId') })).toHaveAccessibilityValue({ text: initial })
  await fireEvent.press(screen.getByRole('combobox', { name: mockTranslate('agents.fields.providerId') }))
  await fireEvent.press(screen.getByRole('option', { name: next.name }))
  expect(screen.getByRole('combobox', { name: mockTranslate('agents.fields.providerId') })).toHaveAccessibilityValue({ text: next.name })
  if (expected) {
    const model = screen.getByRole('combobox', { name: mockTranslate('agents.fields.modelId') })
    expect(model).toHaveAccessibilityValue({ text: expected })
    await fireEvent.press(model)
    if (expected !== initial) expect(screen.queryByRole('option', { name: initial })).toBeNull()
    await fireEvent.press(screen.getByRole('option', { name: expected }))
  } else {
    expect(screen.queryByRole('combobox', { name: mockTranslate('agents.fields.modelId') })).toBeNull()
    expect(screen.getByLabelText(mockTranslate('agents.fields.modelId'))).toHaveDisplayValue('')
    await fireEvent.press(screen.getByRole('button', { name: mockTranslate('common.save') }))
    await waitFor(() => expect(screen.getByText(mockTranslate('agents.invalid'))).toBeTruthy())
    expect(management.save).not.toHaveBeenCalled()
    await fireEvent.changeText(screen.getByLabelText(mockTranslate('agents.fields.modelId')), 'user-entered-model-b')
  }
  expect(screen.getByRole('combobox', { name: mockTranslate('agents.actionCapability') })).toHaveAccessibilityValue({ text: mockTranslate('agents.capabilities.text_only') })
  await fireEvent.press(screen.getByRole('button', { name: mockTranslate('common.save') }))
  await waitFor(() => expect(management.save).toHaveBeenCalledTimes(1))
  const saved = jest.mocked(management.save).mock.calls[0][0]
  expect(saved.modelBinding).toEqual({ providerId: next.id, modelId: expected || 'user-entered-model-b', actionCapability: 'text_only', capabilityRevision: 'unverified' })
  expect(saved).toMatchObject({ name: original.name, instructions: original.instructions, allowedToolIds: original.allowedToolIds,
    knowledgeIds: original.knowledgeIds, skillIds: original.skillIds, delegateAgentIds: original.delegateAgentIds,
    reviewerPolicy: original.reviewerPolicy, budget: original.budget, children: original.children,
  })
  await screen.unmount()
})
