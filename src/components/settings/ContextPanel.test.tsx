import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { ContextPanel } from './ContextPanel'
import { SettingsEditBoundary } from './SettingsEditBoundary'
import { SettingsSectionContext } from './SettingsSection'
import type { KnowledgeDocument } from '@/types/contextContracts'

let mockSettings: Record<string, unknown>
let mockMotion: 'none' | 'reduced' = 'none'
let mockAnimations: { from?: unknown; transition?: { duration: number } }[] = []
const mockUpdate = jest.fn((patch: object) => Object.assign(mockSettings, patch))
const mockGetKey = jest.fn(async () => '')
const mockFlush = jest.fn()
const mockToast = jest.fn()
const mockConfirm = jest.fn()
const mockDocuments = jest.fn(async (): Promise<KnowledgeDocument[]> => [])
const mockMemoryUpdate = jest.fn()
let mockMemories: any[] = []
let mockMemoryProps: any
let mockRemove: (event: { data: { action: unknown } }) => void
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: Object.assign((select: any) => select({
  settings: mockSettings, updateSettings: mockUpdate,
  getTavilyApiKey: mockGetKey, getGoogleSearchApiKey: mockGetKey, getBingSearchApiKey: mockGetKey, getCustomSearchApiKey: mockGetKey,
}), { getState: () => ({ settings: mockSettings }) }) }))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({ flushPersistedSettings: () => mockFlush() }))
jest.mock('@/bootstrap/knowledgeDocumentImportRuntime', () => ({}))
jest.mock('@/bootstrap/knowledgeRepository', () => ({ knowledgeRepository: { listMemories: async () => mockMemories, listDocuments: () => mockDocuments(), updateMemoryStatus: (...args: unknown[]) => mockMemoryUpdate(...args) } }))
jest.mock('@/bootstrap/localModelRuntime', () => ({ listLocalEmbeddingModelViews: async () => [] }))
jest.mock('@/bootstrap/knowledgeRagEvaluation', () => ({ loadRagEmbeddingJobSummary: async () => ({ running: 0, error: 0 }), loadRagDebugSnapshot: async () => ({ indexingJobs: [], evaluations: [] }) }))
jest.mock('@/bootstrap/providerModelAccess', () => ({}))
jest.mock('@/modules/knowledge', () => ({ splitLocalModelViews: () => ({ downloadable: [], planned: [] }) }))
jest.mock('@/modules/integrations', () => ({ resolveSearchProvider: (settings: any) => settings.searchProvider ?? 'off', SEARCH_PROVIDER_OPTIONS: [] }))
jest.mock('@/services/contextSelfTest', () => ({}))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal' }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: jest.fn() }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: (_: boolean, callback: typeof mockRemove) => { mockRemove = callback } }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('moti', () => ({ MotiView: ({ from, animate, transition, ...props }: any) => {
  if (animate) mockAnimations.push({ from, transition })
  const { View } = require('react-native')
  return <View {...props} />
} }))
jest.mock('./SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('./SettingsSummaryStrip', () => ({ SettingsSummaryStrip: () => null }))
jest.mock('./ContextDiagnosticsSection', () => ({ ContextDiagnosticsSection: () => null }))
jest.mock('./MemoryReviewSection', () => ({ MemoryReviewSection: (props: unknown) => { mockMemoryProps = props; return null } }))
jest.mock('./theme-experiences/ContextSettingsExperiences', () => ({ MinimalContextSettingsLead: ({ toggles }: any) => toggles }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput, View } = require('react-native')
  return {
    ISLE_MIN_TOUCH_TARGET: 44, IslePressable: Pressable, IsleToggle: ({ title, description }: any) => <View><Text>{title}</Text>{description ? <Text>{description}</Text> : null}</View>, IsleChip: Text, IsleProgress: View, ThemeExpressionRegion: View,
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
  mockMotion = 'none'
  mockAnimations = []
  mockSettings = { localModelDownloadMirrorBaseUrl: 'https://saved.invalid' }
  mockFlush.mockReset().mockResolvedValue(undefined)
  mockConfirm.mockReset().mockResolvedValue(true)
  mockDocuments.mockReset().mockResolvedValue([])
  mockMemories = []
  mockMemoryProps = undefined
  mockMemoryUpdate.mockReset().mockResolvedValue(undefined)
})

it('opens search with only relevant credentials and keeps it separate from the RAG editor', async () => {
  mockSettings.searchProvider = 'custom'
  const page = <SettingsEditBoundary><ContextPanel providers={[]} section="context" /></SettingsEditBoundary>
  const screen = await render(page)
  expect(screen.queryByLabelText('contextPanel.customSearchEndpoint')).toBeNull()
  await fireEvent.press(screen.getByTestId('settings-task-search-provider'))
  expect(screen.getByLabelText('contextPanel.customSearchEndpoint')).toBeTruthy()
  expect(screen.queryByTestId('settings-task-editor-rag-profile')).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'common.back' }))
  await fireEvent.press(screen.getByTestId('settings-task-rag-profile'))
  expect(screen.getByTestId('settings-task-editor-rag-profile')).toBeTruthy()
  expect(screen.queryByLabelText('contextPanel.customSearchEndpoint')).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'common.back' }))
  mockSettings.searchProvider = 'off'
  await screen.rerender(<SettingsEditBoundary><ContextPanel providers={[]} section="context" /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('settings-task-search-provider'))
  expect(screen.getByTestId('settings-task-editor-search-provider')).toBeTruthy()
  expect(screen.queryByLabelText('contextPanel.customSearchEndpoint')).toBeNull()
  expect(screen.queryByLabelText('contextPanel.saveSearchConfig')).toBeNull()
})

it.each(['none', 'reduced'] as const)('keeps context disclosures still with %s motion', async motion => {
  mockMotion = motion
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByLabelText(label)).toBeTruthy())
  expect(mockAnimations.length).toBeGreaterThan(1)
  for (const animation of mockAnimations) {
    expect(animation.from).toBeUndefined()
    expect(animation.transition?.duration).toBe(0)
  }
})

it.each(['memory', 'knowledge'] as const)('makes the disabled %s master switch explicit without claiming saved items are in use', async section => {
  mockSettings[`${section}Enabled`] = false
  const screen = await render(<ContextPanel providers={[]} section={section} />)
  expect(screen.getByText('settingsSubsystem.paused')).toBeTruthy()
  mockSettings[`${section}Enabled`] = true
  await screen.rerender(<ContextPanel providers={[]} section={section} />)
  expect(screen.queryByText('settingsSubsystem.paused')).toBeNull()
})

it('distinguishes catalog read failure from an empty knowledge library and retries locally', async () => {
  mockDocuments.mockRejectedValueOnce(new Error('database unavailable'))
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  expect(screen.getByRole('alert')).toHaveTextContent('settingsSubsystem.loadFailed')
  expect(screen.queryByText('contextPanel.noKnowledgeFiles')).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText('contextPanel.noKnowledgeFiles')).toBeTruthy()
  expect(mockDocuments).toHaveBeenCalledTimes(2)
})

it.each(['ready', 'error'] as const)('lets knowledge filters close and reopen without losing the query or %s document status', async status => {
  mockDocuments.mockResolvedValue([{ id: 'qa-document', title: 'QA knowledge', mimeType: 'text/plain', size: 24, chunkCount: status === 'ready' ? 1 : 0, status, error: status === 'error' ? 'QA indexing failed' : undefined, createdAt: 1, updatedAt: 1 }])
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  const disclosure = () => screen.getByRole('button', { name: /^contextPanel.knowledgeTools\./ })
  if (status === 'ready') await fireEvent.press(disclosure())
  expect(disclosure().props.accessibilityState.expanded).toBe(true)
  await fireEvent.changeText(screen.getByLabelText('contextPanel.knowledgeFilter'), 'QA')
  await fireEvent.press(disclosure())
  expect(disclosure().props.accessibilityState.expanded).toBe(false)
  expect(screen.queryByLabelText('contextPanel.knowledgeFilter')).toBeNull()
  expect(screen.getByTestId('knowledge-filter-summary')).toBeTruthy()
  expect(screen.getByText('QA knowledge')).toBeTruthy()
  await fireEvent.press(disclosure())
  expect(screen.getByLabelText('contextPanel.knowledgeFilter').props.value).toBe('QA')
  if (status === 'error') expect(screen.getByTestId('knowledge-readiness-warning')).toBeTruthy()
})

it('serializes memory writes and keeps persistence failure retryable instead of claiming success', async () => {
  const memory = { id: 'm', content: 'Remembered fact', status: 'active', createdAt: 1, updatedAt: 1 }
  mockMemories = [memory]
  let fail!: (error: Error) => void
  mockMemoryUpdate.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="memory" /></SettingsEditBoundary>)
  let pending!: Promise<void>
  await act(async () => { pending = mockMemoryProps.onToggleMemory(memory) })
  await act(async () => { await mockMemoryProps.onToggleMemory(memory) })
  expect(mockMemoryUpdate).toHaveBeenCalledTimes(1)
  expect(mockMemoryProps.confirmingMemories).toBe(true)
  await act(async () => { fail(new Error('write failed')); await pending })
  expect(screen.getByRole('alert')).toHaveTextContent('settingsSubsystem.operationFailed')
  expect(mockMemoryProps.memories[0].status).toBe('active')
  await act(async () => { await mockMemoryProps.onToggleMemory(memory) })
  expect(mockMemoryUpdate).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('waits for every batch write and reads back partial results before enabling retry', async () => {
  mockMemories = ['first', 'second'].map(id => ({ id, content: id, status: 'pending', createdAt: 1, updatedAt: 1 }))
  let finish!: () => void
  mockMemoryUpdate.mockRejectedValueOnce(new Error('first write failed')).mockImplementationOnce(() => new Promise<void>(resolve => {
    finish = () => { mockMemories[1] = { ...mockMemories[1], status: 'active' }; resolve() }
  }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="memory" /></SettingsEditBoundary>)
  await act(async () => { mockMemoryProps.onConfirmPendingMemories(mockMemories) })
  expect(mockMemoryUpdate).toHaveBeenCalledTimes(2)
  expect(mockMemoryProps.confirmingMemories).toBe(true)
  expect(mockDocuments).toHaveBeenCalledTimes(1)
  await act(async () => { finish() })
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('settingsSubsystem.operationFailed'))
  expect(mockMemoryProps.memories.map((item: any) => item.status)).toEqual(['pending', 'active'])
  expect(mockMemoryProps.confirmingMemories).toBe(false)
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.pendingMemoriesConfirmed' }))
})

it('opens a nested target, retains folded mirror input, guards task exit and discards without an unmount', async () => {
  const screen = await render(<Page />)
  await fireEvent.changeText(screen.getByLabelText(label), 'https://draft.invalid')
  await fireEvent(screen.getByLabelText(label), 'blur')
  expect(mockUpdate).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.localModel.title\./ }))
  expect(screen.queryByLabelText(label)).toBeNull()
  expect(screen.getByText(label + ': settingsWorkspace.unsaved')).toBeTruthy()
  mockConfirm.mockResolvedValueOnce(false)
  await fireEvent.press(screen.getByRole('button', { name: 'common.back' }))
  expect(screen.getByTestId('settings-task-editor-rag-profile')).toBeTruthy()
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.localModel.title\./ }))
  expect(screen.getByLabelText(label).props.value).toBe('https://draft.invalid')
  await act(async () => mockRemove({ data: { action: { type: 'GO_BACK' } } }))
  expect(mockConfirm).toHaveBeenCalledTimes(2)
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
