import { act, fireEvent, render } from '@testing-library/react-native'
import { ContextPanel } from './ContextPanel'
import { SettingsEditBoundary } from './SettingsEditBoundary'
import { SettingsSectionContext } from './SettingsSection'

let mockSettings: Record<string, unknown>
const mockUpdate = jest.fn((patch: object) => Object.assign(mockSettings, patch))
const mockGetKey = jest.fn(async () => '')
const mockFlush = jest.fn()
const mockToast = jest.fn()
const mockConfirm = jest.fn()
let mockRemove: (event: { data: { action: unknown } }) => void
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: Object.assign((select: any) => select({
  settings: mockSettings, updateSettings: mockUpdate,
  getTavilyApiKey: mockGetKey, getGoogleSearchApiKey: mockGetKey, getBingSearchApiKey: mockGetKey, getCustomSearchApiKey: mockGetKey,
}), { getState: () => ({ settings: mockSettings }) }) }))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({ flushPersistedSettings: () => mockFlush() }))
jest.mock('@/bootstrap/knowledgeDocumentImportRuntime', () => ({}))
jest.mock('@/bootstrap/knowledgeRepository', () => ({ knowledgeRepository: { listMemories: async () => [], listDocuments: async () => [] } }))
jest.mock('@/bootstrap/localModelRuntime', () => ({ listLocalEmbeddingModelViews: async () => [] }))
jest.mock('@/bootstrap/knowledgeRagEvaluation', () => ({ loadRagEmbeddingJobSummary: async () => ({ running: 0, error: 0 }), loadRagDebugSnapshot: async () => ({ indexingJobs: [], evaluations: [] }) }))
jest.mock('@/bootstrap/providerModelAccess', () => ({}))
jest.mock('@/modules/knowledge', () => ({ splitLocalModelViews: () => ({ downloadable: [], planned: [] }) }))
jest.mock('@/modules/integrations', () => ({ resolveSearchProvider: () => 'off', SEARCH_PROVIDER_OPTIONS: [] }))
jest.mock('@/services/contextSelfTest', () => ({}))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal' }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: jest.fn() }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: (_: boolean, callback: typeof mockRemove) => { mockRemove = callback } }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('./SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('./SettingsSummaryStrip', () => ({ SettingsSummaryStrip: () => null }))
jest.mock('./ContextDiagnosticsSection', () => ({ ContextDiagnosticsSection: () => null }))
jest.mock('./theme-experiences/ContextSettingsExperiences', () => ({ MinimalContextSettingsLead: () => null }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput, View } = require('react-native')
  return {
    ISLE_MIN_TOUCH_TARGET: 44, IslePressable: Pressable, IsleToggle: View, IsleChip: Text, IsleProgress: View,
    IsleField: ({ label, inputProps }: any) => <TextInput accessibilityLabel={label} {...inputProps} />,
    IsleButton: ({ label, ...props }: any) => <Pressable accessibilityRole="button" accessibilityLabel={label} {...props}><Text>{label}</Text></Pressable>,
    useIsleDialog: () => ({ toast: mockToast, confirm: mockConfirm }),
  }
})

const label = 'contextPanel.localModel.mirrorBaseUrl'
function Page() {
  return <SettingsEditBoundary><SettingsSectionContext.Provider value={{ target: 'local-model-mirror', register: () => undefined }}><ContextPanel providers={[]} section="context" /></SettingsSectionContext.Provider></SettingsEditBoundary>
}
beforeEach(() => {
  jest.clearAllMocks()
  mockSettings = { localModelDownloadMirrorBaseUrl: 'https://saved.invalid' }
  mockFlush.mockResolvedValue(undefined)
  mockConfirm.mockResolvedValue(true)
})

it('opens the nested search target, retains mirror input through both foldouts, and discards without an unmount', async () => {
  const screen = await render(<Page />)
  await fireEvent.changeText(screen.getByLabelText(label), 'https://draft.invalid')
  await fireEvent(screen.getByLabelText(label), 'blur')
  expect(mockUpdate).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.localModel.title\./ }))
  expect(screen.queryByLabelText(label)).toBeNull()
  expect(screen.getByText(label + ': settingsWorkspace.unsaved')).toBeTruthy()
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.ragMode\./ }))
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.ragMode\./ }))
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.localModel.title\./ }))
  expect(screen.getByLabelText(label).props.value).toBe('https://draft.invalid')
  await act(async () => mockRemove({ data: { action: { type: 'GO_BACK' } } }))
  expect(mockConfirm).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText(label).props.value).toBe('https://saved.invalid')
  expect(mockUpdate).not.toHaveBeenCalled()
})

it('retains failed saves, reports errors while folded, and refuses a stale overwrite until reloaded', async () => {
  const screen = await render(<Page />)
  await fireEvent.changeText(screen.getByLabelText(label), ' https://draft.invalid ')
  mockFlush.mockRejectedValueOnce(new Error('disk unavailable'))
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  expect(mockSettings.localModelDownloadMirrorBaseUrl).toBe('https://draft.invalid')
  expect(screen.getByLabelText(label).props.value).toBe(' https://draft.invalid ')
  expect(screen.getByRole('alert').props.children).toBe('settingsWorkspace.saveFailed')
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.localModel.title\./ }))
  expect(screen.getByText(label + ': settingsWorkspace.error')).toBeTruthy()
  mockSettings.localModelDownloadMirrorBaseUrl = 'https://external.invalid'
  await screen.rerender(<Page />)
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.localModel.title\./ }))
  mockUpdate.mockClear()
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').props.children).toBe('settingsWorkspace.conflict')
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.reload' }))
  expect(screen.getByLabelText(label).props.value).toBe('https://external.invalid')
})

it('blocks duplicate saves and acknowledges success only after persistence', async () => {
  let finish!: () => void
  mockFlush.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<Page />)
  await fireEvent.changeText(screen.getByLabelText(label), 'https://draft.invalid')
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  expect(screen.getByRole('button', { name: 'settingsWorkspace.saving' })).toBeDisabled()
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.saving' }))
  expect(mockUpdate).toHaveBeenCalledTimes(1)
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'settingsWorkspace.saved' }))
  await act(async () => { finish() })
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'settingsWorkspace.saved' }))
  expect(screen.queryByRole('button', { name: 'settingsWorkspace.save' })).toBeNull()
})
