import { act, fireEvent, render } from '@testing-library/react-native'
import { SkillSettingsContent } from './SkillSettingsContent'
import { SettingsEditBoundary } from './SettingsEditBoundary'
import type { AIProvider } from '@/types/providerContracts'
import { PROVIDER_PRESETS } from '@/modules/providers'

let mockSkills: any[] = []
let mockEnabled = true
let mockProviders: AIProvider[] = []
const mockList = jest.fn()
const mockUpsert = jest.fn()
const mockConfirm = jest.fn()
const mockClipboard = jest.fn()
const mockImport = jest.fn()
const mockToast = jest.fn()
jest.mock('expo-router', () => ({ useNavigation: jest.fn() }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('expo-clipboard', () => ({ getStringAsync: () => mockClipboard() }))
jest.mock('@/presentation/features/conversations/conversationSkillCommand', () => ({
  listSkills: () => mockList(), upsertSkill: (skill: unknown) => mockUpsert(skill), createBaseSkill: (skill: any) => ({ ...skill, id: skill.id ?? 'new', updatedAt: 2 }), importSkill: (raw: string) => mockImport(raw),
}))
jest.mock('@/bootstrap/androidWorkflowCatalog', () => ({ androidWorkflowCatalog: { list: () => [] } }))
jest.mock('@/bootstrap/conversationToolCatalog', () => ({ listStaticConversationToolManifests: () => [] }))
jest.mock('@/bootstrap/settingsReferenceCatalog', () => ({ loadCapabilityReferenceCatalog: async () => ({ tools: [], knowledge: [] }) }))
jest.mock('@/bootstrap/workflowSkills', () => ({ isWorkflowSkill: () => false, isWorkflowSkillReviewRequired: () => false, mergeWorkflowSkillEditTags: (_: unknown, tags: unknown) => tags ?? [], buildWorkflowSkillReviewRequiredEdit: (_: unknown, skill: unknown) => skill }))
jest.mock('@/bootstrap/pluginManifest', () => ({}))
jest.mock('@/bootstrap/toolchainControlPlane', () => ({ buildPersistedToolchainCatalogSnapshot: async () => ({ androidControlPlane: { registeredToolCards: [] } }), createPortableSkillToolchainManifest: (skill: any) => ({ id: skill.id }) }))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: (select: any) => select({ providers: mockProviders, settings: { skillsEnabled: mockEnabled }, updateSettings: jest.fn() }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal' }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('./SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('@/components/ui/isle', () => {
  const { View, Pressable, Text, TextInput } = require('react-native')
  return { ISLE_MIN_TOUCH_TARGET: 44, IslePressable: Pressable, IsleChip: Text, IsleInput: TextInput,
    IsleSelect: ({ options, onChange, disabled }: any) => <View>{options.map((option: any) => <Pressable key={option.value} accessibilityLabel={option.label} disabled={disabled} onPress={() => onChange(option.value)}><Text>{option.label}</Text></Pressable>)}</View>,
    IsleToggle: () => null, IsleListItem: ({ title, trailing }: any) => <View><Text>{title}</Text>{trailing}</View>,
    IsleButton: ({ label, ...props }: any) => <Pressable accessibilityRole="button" {...props} accessibilityLabel={label}><Text>{label}</Text></Pressable>,
    IsleField: ({ label, inputProps }: any) => <TextInput accessibilityLabel={label} {...inputProps} />,
    useIsleDialog: () => ({ toast: mockToast, notice: mockToast, confirm: mockConfirm }),
  }
})
beforeEach(() => {
  jest.clearAllMocks()
  mockEnabled = true
  mockProviders = []
  mockList.mockReset().mockImplementation(async () => mockSkills)
  mockConfirm.mockResolvedValue(true)
  mockSkills = [{ id: 'existing', name: 'Saved skill', systemPrompt: 'Existing prompt', tags: [], layer: 'base', priority: 0, updatedAt: 1 }]
  mockUpsert.mockImplementation(async skill => { mockSkills = [...mockSkills.filter(item => item.id !== skill.id), skill]; return skill })
})
it('keeps the master pause and local read failures visible in subviews with a direct retry', async () => {
  mockEnabled = false
  mockList.mockRejectedValueOnce(new Error('local read failed'))
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-saved'))
  expect(screen.getByText('settingsSubsystem.paused')).toBeTruthy()
  expect(screen.getByRole('alert')).toHaveTextContent('settingsSubsystem.loadFailed')
  await fireEvent.press(screen.getByLabelText('common.retry'))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText('Saved skill')).toBeTruthy()
  await fireEvent.press(screen.getByLabelText('common.edit'))
  expect(screen.getByText('settingsSubsystem.paused')).toBeTruthy()
})

it('has one saved-skill entry and drops the editing object on a clean return before creation', async () => {
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  expect(screen.queryByText('Saved skill')).toBeNull()
  expect(screen.getAllByTestId('settings-task-saved')).toHaveLength(1)
  await fireEvent.press(screen.getByTestId('settings-task-saved'))
  expect(screen.getAllByText('Saved skill')).toHaveLength(1)
  await fireEvent.press(screen.getByLabelText('common.edit'))
  expect(screen.getByLabelText('skills.name').props.value).toBe('Saved skill')
  await fireEvent.press(screen.getByLabelText('common.back'))
  await fireEvent.press(screen.getByTestId('settings-task-edit'))
  expect(screen.getByLabelText('skills.name').props.value).toBe('')
  await fireEvent.changeText(screen.getByLabelText('skills.name'), 'New skill')
  await fireEvent.changeText(screen.getByLabelText('skills.systemPrompt'), 'New prompt')
  await fireEvent.press(screen.getByLabelText('skills.saveSkill'))
  expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'new', name: 'New skill' }))
  expect(mockSkills.find(item => item.id === 'existing').systemPrompt).toBe('Existing prompt')
})
it('selects discovered credential-group models and aliases even when the top-level model list is empty', async () => {
  mockProviders = [{ id: 'p', name: 'Saved provider', type: PROVIDER_PRESETS.find(preset => preset.id === 'custom-endpoint')!.type, apiKey: '', enabled: true, models: [],
    modelAliases: [{ alias: 'Friendly model', model: 'group-model' }],
    credentialGroups: [{ id: 'g', label: 'Saved key', apiKey: '', enabled: true, lastModelSyncStatus: 'ok', availableModels: ['group-model'] }] }]
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-edit'))
  await fireEvent.changeText(screen.getByLabelText('skills.systemPrompt'), 'Local skill')
  await fireEvent.press(screen.getByText('settingsWorkspace.advanced'))
  await fireEvent.press(screen.getByLabelText('Saved provider'))
  expect(screen.getByLabelText('group-model')).toBeTruthy()
  await fireEvent.press(screen.getByLabelText('Friendly model'))
  await fireEvent.press(screen.getByLabelText('skills.saveSkill'))
  expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'p', model: 'Friendly model' }))
})
it('retains unsaved edits when return is declined and keeps failed saves retryable', async () => {
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-edit'))
  await fireEvent.changeText(screen.getByLabelText('skills.systemPrompt'), 'Draft')
  mockConfirm.mockResolvedValue(false)
  await fireEvent.press(screen.getByLabelText('common.back'))
  expect(screen.getByLabelText('skills.systemPrompt').props.value).toBe('Draft')
  mockUpsert.mockRejectedValueOnce(new Error('write failed'))
  await fireEvent.press(screen.getByLabelText('skills.saveSkill'))
  expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.saveFailed')
  expect(screen.getByLabelText('skills.systemPrompt').props.value).toBe('Draft')
  await fireEvent.press(screen.getByLabelText('skills.saveSkill'))
  expect(mockUpsert.mock.calls[0][0].id).toBe(mockUpsert.mock.calls[1][0].id)
})
it('serializes clipboard imports and surfaces write failure without losing the retry entry', async () => {
  mockClipboard.mockResolvedValue('payload')
  mockImport.mockReturnValue({ ok: true, skill: { ...mockSkills[0], id: 'imported' } })
  let reject!: (error: Error) => void
  mockUpsert.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-import'))
  await fireEvent.press(screen.getByLabelText('skills.importClipboard'))
  await fireEvent.press(screen.getByLabelText('skills.importClipboard'))
  expect(mockUpsert).toHaveBeenCalledTimes(1)
  await fireEvent.press(screen.getByLabelText('common.back'))
  expect(screen.getByLabelText('skills.importClipboard')).toBeTruthy()
  await act(() => reject(new Error('disk full')))
  expect(screen.getByRole('alert')).toBeTruthy()
  await fireEvent.press(screen.getByLabelText('skills.importClipboard'))
  expect(mockUpsert).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).toBeNull()
})
