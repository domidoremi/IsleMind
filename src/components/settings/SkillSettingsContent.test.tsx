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
const mockDelete = jest.fn()
const mockClipboardWrite = jest.fn()
const mockFileWrite = jest.fn()
const mockFileDelete = jest.fn()
const mockShareAvailable = jest.fn()
const mockShare = jest.fn()
const mockPicker = jest.fn()
const mockImportRead = jest.fn()
const mockImportCleanup = jest.fn()
const mockReferences = jest.fn()
jest.mock('expo-router', () => ({ useNavigation: jest.fn() }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('expo-clipboard', () => ({ getStringAsync: () => mockClipboard(), setStringAsync: (raw: string) => mockClipboardWrite(raw) }))
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///owned-cache/', documentDirectory: 'file:///documents/', EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: (...args: unknown[]) => mockFileWrite(...args), deleteAsync: (...args: unknown[]) => mockFileDelete(...args),
}))
jest.mock('expo-sharing', () => ({ isAvailableAsync: () => mockShareAvailable(), shareAsync: (...args: unknown[]) => mockShare(...args) }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockPicker(...args) }))
jest.mock('@/platform/native/boundedImportFile', () => ({
  MAX_IMPORT_TEXT_FILE_BYTES: 20 * 1024 * 1024,
  isFileTooLargeError: (error: unknown) => error instanceof Error && error.message === 'error.fileTooLarge',
  readUtf8ImportFile: (...args: unknown[]) => mockImportRead(...args),
  deleteTemporaryImportCopy: (...args: unknown[]) => mockImportCleanup(...args),
}))
jest.mock('@/presentation/features/conversations/conversationSkillCommand', () => ({
  listSkills: () => mockList(), upsertSkill: (skill: unknown, options?: unknown) => options === undefined ? mockUpsert(skill) : mockUpsert(skill, options),
  deleteSkill: (id: string, options?: unknown) => mockDelete(id, options),
  exportSkill: () => 'portable skill',
  createBaseSkill: (skill: any) => ({ ...skill, id: skill.id ?? 'new', updatedAt: 2 }), importSkill: (raw: string) => mockImport(raw),
}))
jest.mock('@/bootstrap/androidWorkflowCatalog', () => ({ androidWorkflowCatalog: { list: () => [] } }))
jest.mock('@/bootstrap/conversationToolCatalog', () => ({ listStaticConversationToolManifests: () => [] }))
jest.mock('@/bootstrap/settingsReferenceCatalog', () => ({ loadCapabilityReferenceCatalog: () => mockReferences() }))
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
  const { View, Pressable: MockPressable, Text, TextInput } = require('react-native')
  return { ISLE_MIN_TOUCH_TARGET: 44, IslePressable: MockPressable, IsleChip: Text, IsleInput: TextInput,
    IsleSelect: ({ options, onChange, disabled }: any) => <View>{options.map((option: any) => <MockPressable key={option.value} accessibilityLabel={option.label} disabled={disabled} onPress={() => onChange(option.value)}><Text>{option.label}</Text></MockPressable>)}</View>,
    IsleToggle: () => null, IsleListItem: ({ title, trailing }: any) => <View><Text>{title}</Text>{trailing}</View>,
    IsleButton: ({ label, ...props }: any) => <MockPressable accessibilityRole="button" {...props} accessibilityLabel={label}><Text>{label}</Text></MockPressable>,
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
  mockDelete.mockResolvedValue(undefined)
  mockClipboardWrite.mockResolvedValue(undefined)
  mockFileWrite.mockResolvedValue(undefined)
  mockFileDelete.mockResolvedValue(undefined)
  mockShareAvailable.mockResolvedValue(true)
  mockShare.mockResolvedValue(undefined)
  mockPicker.mockResolvedValue({ canceled: true })
  mockImportRead.mockResolvedValue('payload')
  mockImportCleanup.mockResolvedValue(undefined)
  mockReferences.mockReset().mockResolvedValue({ tools: [], knowledge: [] })
  mockSkills = [{ id: 'existing', name: 'Saved skill', systemPrompt: 'Existing prompt', tags: [], layer: 'base', priority: 0, updatedAt: 1 }]
  mockUpsert.mockImplementation(async skill => { mockSkills = [...mockSkills.filter(item => item.id !== skill.id), skill]; return skill })
})

it('does not reuse a previous successful reference catalog while a reopened editor reload is pending or failed', async () => {
  mockReferences.mockResolvedValueOnce({ tools: [{ value: 'old-tool', label: 'Previously available tool' }], knowledge: [] })
  let reject!: (error: Error) => void
  const pending = new Promise((_resolve, no) => { reject = no })
  mockReferences.mockReturnValueOnce(pending)
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-edit'))
  const advanced = () => screen.getByRole('button', { name: /^settingsWorkspace\.advanced\./ })
  await fireEvent.press(advanced())
  expect(screen.getByLabelText('Previously available tool')).toBeEnabled()
  await fireEvent.press(advanced())
  await fireEvent.press(advanced())
  expect(mockReferences).toHaveBeenCalledTimes(2)
  expect(screen.getByText('common.loading')).toBeTruthy()
  expect(screen.getByLabelText('Previously available tool')).toBeDisabled()
  await act(async () => { reject(new Error('read unavailable')); await pending.catch(() => undefined) })
  expect(screen.getByRole('alert')).toHaveTextContent('settingsSubsystem.loadFailed')
  expect(screen.getByLabelText('Previously available tool')).toBeDisabled()
  mockReferences.mockResolvedValueOnce({ tools: [{ value: 'old-tool', label: 'Previously available tool' }], knowledge: [] })
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  expect(screen.getByLabelText('Previously available tool')).toBeEnabled()
  await screen.unmount()
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
  expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'new', name: 'New skill' }),
    expect.objectContaining({ expectedSkill: null, signal: expect.anything() }))
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
  expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'p', model: 'Friendly model' }),
    expect.objectContaining({ expectedSkill: null, signal: expect.anything() }))
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

it('does not persist clipboard input that arrives after its screen unmounts', async () => {
  let resolve!: (raw: string) => void
  mockClipboard.mockImplementationOnce(() => new Promise<string>(settle => { resolve = settle }))
  mockImport.mockReturnValue({ ok: true, skill: { ...mockSkills[0], id: 'imported' } })
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-import'))
  await fireEvent.press(screen.getByLabelText('skills.importClipboard'))
  await screen.unmount()
  await act(async () => { resolve('late payload'); await Promise.resolve() })
  expect(mockUpsert).not.toHaveBeenCalled()
})

it('does not delete a skill after the pending confirmation loses its screen lifetime', async () => {
  let resolve!: (approved: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(settle => { resolve = settle }))
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-saved'))
  await fireEvent.press(screen.getByLabelText('common.delete'))
  const options = mockConfirm.mock.calls[0][0]
  await screen.unmount()
  await act(async () => { resolve(true); await Promise.resolve() })
  expect(mockDelete).not.toHaveBeenCalled()
  expect(options.signal?.aborted).toBe(true)
})

it('requires an explicit cancelable confirmation before an import replaces a saved ID', async () => {
  mockClipboard.mockResolvedValue('payload')
  mockImport.mockReturnValue({ ok: true, skill: { ...mockSkills[0], systemPrompt: 'Imported replacement' } })
  mockConfirm.mockResolvedValue(false)
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-import'))
  await fireEvent.press(screen.getByLabelText('skills.importClipboard'))
  expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }))
  expect(mockUpsert).not.toHaveBeenCalled()
  expect(mockSkills[0].systemPrompt).toBe('Existing prompt')
})

it('passes the captured saved skill to the canonical mutation boundary and keeps a conflict retryable', async () => {
  const original = { ...mockSkills[0], tags: [...mockSkills[0].tags] }
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-saved'))
  await fireEvent.press(screen.getByLabelText('common.edit'))
  await fireEvent.changeText(screen.getByLabelText('skills.systemPrompt'), 'Unsaved revision')
  mockUpsert.mockRejectedValueOnce(Object.assign(new Error('changed'), { name: 'ConversationSkillConflictError' }))
  await fireEvent.press(screen.getByLabelText('skills.saveSkill'))
  expect(mockUpsert).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'existing', systemPrompt: 'Unsaved revision' }),
    expect.objectContaining({ expectedSkill: original, signal: expect.anything() }),
  )
  expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.conflict')
  expect(screen.getByLabelText('skills.systemPrompt').props.value).toBe('Unsaved revision')
})

it('does not replace a current saved summary with a late initial catalog read', async () => {
  let resolve!: (skills: any[]) => void
  mockList.mockImplementationOnce(() => new Promise<any[]>(settle => { resolve = settle }))
  mockClipboard.mockResolvedValue('payload')
  mockImport.mockReturnValue({ ok: true, skill: { ...mockSkills[0], id: 'imported', name: 'Imported skill' } })
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-import'))
  await fireEvent.press(screen.getByLabelText('skills.importClipboard'))
  await act(async () => { resolve([]); await Promise.resolve() })
  await fireEvent.press(screen.getByLabelText('common.back'))
  await fireEvent.press(screen.getByTestId('settings-task-saved'))
  expect(screen.getByText('Imported skill')).toBeTruthy()
  expect(screen.getByText('Saved skill')).toBeTruthy()
})

it('keeps a newly saved skill visible when the initial catalog read finishes late', async () => {
  let resolve!: (skills: any[]) => void
  mockList.mockImplementationOnce(() => new Promise<any[]>(settle => { resolve = settle }))
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-edit'))
  await fireEvent.changeText(screen.getByLabelText('skills.name'), 'New saved skill')
  await fireEvent.changeText(screen.getByLabelText('skills.systemPrompt'), 'Saved prompt')
  await fireEvent.press(screen.getByLabelText('skills.saveSkill'))
  await act(async () => { resolve([]); await Promise.resolve() })
  await fireEvent.press(screen.getByTestId('settings-task-saved'))
  expect(screen.getByText('New saved skill')).toBeTruthy()
})

it('does not start file export or sharing after a pending clipboard copy loses its screen lifetime', async () => {
  let resolve!: () => void
  mockClipboardWrite.mockImplementationOnce(() => new Promise<void>(settle => { resolve = settle }))
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-saved'))
  await fireEvent.press(screen.getByLabelText('common.share'))
  await screen.unmount()
  await act(async () => { resolve(); await Promise.resolve() })
  expect(mockFileWrite).not.toHaveBeenCalled()
  expect(mockShare).not.toHaveBeenCalled()
})

it('cleans its bounded temporary export and never opens sharing after a cancelled file write', async () => {
  let resolve!: () => void
  mockFileWrite.mockImplementationOnce(() => new Promise<void>(settle => { resolve = settle }))
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-saved'))
  await fireEvent.press(screen.getByLabelText('common.share'))
  const uri = mockFileWrite.mock.calls[0][0]
  expect(uri).toMatch(/^file:\/\/\/owned-cache\/Saved-skill-[\w.-]+\.isleskill$/)
  await screen.unmount()
  await act(async () => { resolve(); await Promise.resolve() })
  expect(mockShare).not.toHaveBeenCalled()
  expect(mockFileDelete).toHaveBeenCalledWith(uri, { idempotent: true })
})

it('cleans a late picker-owned copy without reading or saving it after unmount', async () => {
  let resolve!: (result: unknown) => void
  mockPicker.mockImplementationOnce(() => new Promise(settle => { resolve = settle }))
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-import'))
  await fireEvent.press(screen.getByLabelText('settings.chooseFile'))
  await screen.unmount()
  await act(async () => { resolve({ canceled: false, assets: [{ uri: 'file:///owned-cache/import.json', name: 'import.json' }] }); await Promise.resolve() })
  expect(mockImportRead).not.toHaveBeenCalled()
  expect(mockUpsert).not.toHaveBeenCalled()
  expect(mockImportCleanup).toHaveBeenCalledWith('file:///owned-cache/import.json', { assumeTemporaryCopy: true })
})

it('keeps an import replacement conflict visible and preserves the competing skill', async () => {
  const original = { ...mockSkills[0], tags: [...mockSkills[0].tags] }
  mockClipboard.mockResolvedValue('payload')
  mockImport.mockReturnValue({ ok: true, skill: { ...original, systemPrompt: 'Imported replacement' } })
  let resolve!: (approved: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(settle => { resolve = settle }))
  mockUpsert.mockRejectedValueOnce(Object.assign(new Error('changed'), { name: 'ConversationSkillConflictError' }))
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-import'))
  await fireEvent.press(screen.getByLabelText('skills.importClipboard'))
  mockSkills = [{ ...original, systemPrompt: 'Competing edit' }]
  await act(async () => { resolve(true); await Promise.resolve() })
  expect(mockUpsert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ expectedSkill: original }))
  expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.conflict')
  expect(mockSkills[0].systemPrompt).toBe('Competing edit')
})

it('keeps a failed file-import save retryable instead of reporting it as malformed JSON', async () => {
  mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///owned-cache/import.json', name: 'import.json' }] })
  mockImport.mockReturnValue({ ok: true, skill: { ...mockSkills[0], id: 'imported' } })
  mockUpsert.mockRejectedValueOnce(new Error('disk full'))
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-import'))
  await fireEvent.press(screen.getByLabelText('settings.chooseFile'))
  expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.saveFailed')
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'skills.importJsonFailed' }))
  expect(mockImportCleanup).toHaveBeenCalledWith('file:///owned-cache/import.json', { assumeTemporaryCopy: true })
  await fireEvent.press(screen.getByLabelText('settings.chooseFile'))
  expect(screen.queryByRole('alert')).toBeNull()
})

it('does not export outside its owned directory when an imported skill has an unsafe fallback ID', async () => {
  mockSkills = [{ ...mockSkills[0], name: '?', id: '../../private/data' }]
  const screen = await render(<SettingsEditBoundary><SkillSettingsContent /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-saved'))
  await fireEvent.press(screen.getByLabelText('common.share'))
  const uri = mockFileWrite.mock.calls[0][0]
  expect(uri).toMatch(/^file:\/\/\/owned-cache\/[\w.-]+\.isleskill$/)
  expect(uri).not.toContain('../')
  expect(mockFileDelete).toHaveBeenCalledWith(uri, { idempotent: true })
})
