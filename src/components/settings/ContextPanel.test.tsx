import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { ContextPanel } from './ContextPanel'
import { SettingsEditBoundary } from './SettingsEditBoundary'
import { SettingsSectionContext } from './SettingsSection'
import type { KnowledgeDocument } from '@/types/contextContracts'
import type { AIProvider } from '@/types/providerContracts'
import { KnowledgeRepositoryConflictError, type KnowledgeDocumentRecord } from '@/modules/knowledge/contracts'
import type { LocalEmbeddingDownloadOptions, LocalEmbeddingDownloadProgress, LocalEmbeddingModelView } from '@/bootstrap/localModelRuntime'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'
import {
  createLocalEmbeddingModelCatalogPolicy,
  LOCAL_MODEL_CATALOG_SCHEMA,
  type LocalEmbeddingModelPreference,
} from '@/modules/knowledge/application/localModelCatalogPolicy'
import {
  createLocalModelStateRepository,
  LOCAL_MODEL_STATE_STORAGE_KEY,
  type LocalModelStateRecoveryRepository,
  type LocalModelStateRecoveryReview,
} from '@/modules/knowledge/application/localModelStateRepository'
import { createAsyncStorageLocalModelStateStoragePort } from '@/platform/localModels/asyncStorageLocalModelState'

let mockSettings: Record<string, unknown>
const mockSettingsListeners = new Set<(state: { settings: Record<string, unknown> }) => void>()
const mockSettingsUnsubscribe = jest.fn()
function publishModelSettings(patch: object) {
  Object.assign(mockSettings, patch)
  for (const listener of mockSettingsListeners) listener({ settings: mockSettings })
}
let mockMotion: 'none' | 'reduced' = 'none'
let mockTheme = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockAnimations: { from?: unknown; transition?: { duration: number } }[] = []
const mockUpdate = jest.fn(publishModelSettings)
const mockGetKey = jest.fn(async () => '')
let mockCatalogKeyGetter = mockGetKey
const mockFlush = jest.fn()
const mockToast = jest.fn()
const mockNotice = jest.fn()
const mockRebuild = jest.fn()
const mockSelfTest = jest.fn()
const mockRagEvaluation = jest.fn()
const mockCacheClear = jest.fn()
let mockDiagnosticsProps: any
const mockConfirm = jest.fn()
const mockDocuments = jest.fn(async (): Promise<KnowledgeDocument[]> => [])
const mockMemoryUpdate = jest.fn()
const mockMemoryDelete = jest.fn()
const mockMemoryClear = jest.fn()
const mockDocumentDelete = jest.fn()
const mockDocumentClear = jest.fn()
const mockImportFile = jest.fn()
const mockImportPlainText = jest.fn()
const mockPrimaryProvider = jest.fn(async (..._args: unknown[]) => undefined)
const mockLocalModels = jest.fn(async (_settings?: unknown, _signal?: AbortSignal): Promise<LocalEmbeddingModelView[]> => [])
const mockModelDownload = jest.fn()
const mockModelDelete = jest.fn()
const mockReviewModelState = jest.fn(async (_signal?: AbortSignal): Promise<LocalModelStateRecoveryReview | null> => null)
const mockDispatch = jest.fn()
let mockModelPresses: Record<string, () => void> = {}
let mockMemories: any[] = []
let mockMemoryProps: any
let mockImportPresses: Record<string, () => void> = {}
let mockRemove: (event: { data: { action: unknown } }) => void
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: Object.assign((select: any) => select({
  settings: mockSettings, updateSettings: mockUpdate, getPrimaryConfiguredProvider: (...args: unknown[]) => mockPrimaryProvider(...args),
  getTavilyApiKey: mockCatalogKeyGetter, getGoogleSearchApiKey: mockGetKey, getBingSearchApiKey: mockGetKey, getCustomSearchApiKey: mockGetKey,
}), { getState: () => ({ settings: mockSettings }), subscribe: (listener: (state: { settings: Record<string, unknown> }) => void) => {
  mockSettingsListeners.add(listener)
  return () => { mockSettingsListeners.delete(listener); mockSettingsUnsubscribe() }
} }) }))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({ flushPersistedSettings: () => mockFlush() }))
jest.mock('@/bootstrap/knowledgeDocumentImportRuntime', () => ({
  importKnowledgeFile: (...args: unknown[]) => mockImportFile(...args),
  importKnowledgePlainText: (...args: unknown[]) => mockImportPlainText(...args),
}))
jest.mock('@/bootstrap/knowledgeRepository', () => ({
  knowledgeRepository: {
    listMemories: async () => mockMemories, listDocuments: () => mockDocuments(),
    updateMemoryStatus: (...args: unknown[]) => mockMemoryUpdate(...args),
    deleteMemory: (...args: unknown[]) => mockMemoryDelete(...args),
    clearMemories: (...args: unknown[]) => mockMemoryClear(...args),
  },
  deleteKnowledgeDocumentRecords: (...args: unknown[]) => mockDocumentDelete(...args),
  clearKnowledgeRecords: (...args: unknown[]) => mockDocumentClear(...args),
}))
jest.mock('@/bootstrap/localModelRuntime', () => ({
  listLocalEmbeddingModelViews: (...args: [unknown, AbortSignal?]) => mockLocalModels(...args),
  downloadLocalEmbeddingModel: (...args: unknown[]) => mockModelDownload(...args),
  deleteDownloadedLocalEmbeddingModel: (...args: unknown[]) => mockModelDelete(...args),
  reviewLocalEmbeddingModelStateRecovery: (...args: [AbortSignal?]) => mockReviewModelState(...args),
  formatModelBytes: (bytes: number) => `${bytes} bytes`,
}))
jest.mock('@/bootstrap/knowledgeRagEvaluation', () => ({
  loadRagEmbeddingJobSummary: async () => ({ running: 0, error: 0 }),
  loadRagDebugSnapshot: async () => ({ indexingJobs: [], evaluations: [] }),
  rebuildRagKnowledgeEmbeddings: (...args: unknown[]) => mockRebuild(...args),
  runRagGoldEvaluation: (...args: unknown[]) => mockRagEvaluation(...args),
  clearRagQueryCaches: (...args: unknown[]) => mockCacheClear(...args),
}))
jest.mock('@/bootstrap/providerModelAccess', () => ({}))
jest.mock('@/modules/knowledge', () => ({
  ...jest.requireActual('@/modules/knowledge/domain/knowledgeMutationGuard'),
  ...jest.requireActual('@/modules/knowledge/domain/localKnowledgeModelPolicy'),
  KnowledgeRepositoryConflictError: jest.requireActual('@/modules/knowledge/contracts').KnowledgeRepositoryConflictError,
  LocalModelStateDataError: jest.requireActual('@/modules/knowledge/application/localModelStateRepository').LocalModelStateDataError,
  LocalModelStateRecoveryConflictError: jest.requireActual('@/modules/knowledge/application/localModelStateRepository').LocalModelStateRecoveryConflictError,
}))
jest.mock('@/modules/integrations', () => ({ resolveSearchProvider: (settings: any) => settings.searchProvider ?? 'off', SEARCH_PROVIDER_OPTIONS: [] }))
jest.mock('@/services/contextSelfTest', () => ({ runContextSelfTest: (...args: unknown[]) => mockSelfTest(...args) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors(mockMode, mockTheme), canonicalThemeId: mockTheme, mode: mockMode, isDark: mockMode === 'dark' }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: mockDispatch }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: (_: boolean, callback: typeof mockRemove) => { mockRemove = callback } }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('moti', () => ({ MotiView: ({ from, animate, transition, ...props }: any) => {
  if (animate) mockAnimations.push({ from, transition })
  const { View } = require('react-native')
  return <View {...props} />
} }))
jest.mock('./SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('./SettingsSummaryStrip', () => ({ SettingsSummaryStrip: () => null }))
jest.mock('./ContextDiagnosticsSection', () => ({
  ContextDiagnosticsSection: (props: any) => { mockDiagnosticsProps = props; return null },
}))
jest.mock('./MemoryReviewSection', () => ({ MemoryReviewSection: (props: unknown) => { mockMemoryProps = props; return null } }))
jest.mock('./theme-experiences/ContextSettingsExperiences', () => ({
  MinimalContextSettingsLead: ({ toggles }: any) => toggles,
  MaterialContextSettingsLead: ({ toggles }: any) => toggles,
  MonetContextSettingsLead: ({ toggles }: any) => toggles,
  LiquidGlassContextSettingsLead: ({ toggles }: any) => toggles,
}))
jest.mock('@/components/ui/isle', () => {
  const { Pressable: MockPressable, Text, TextInput, View } = require('react-native')
  return {
    ISLE_MIN_TOUCH_TARGET: 44, IslePressable: (props: any) => {
      if (['contextPanel.localModel.download', 'contextPanel.localModel.enable', 'common.delete'].includes(props.accessibilityLabel)) {
        mockModelPresses[props.accessibilityLabel] = props.onPress
      }
      if (['contextPanel.importPastedText', 'contextPanel.cancelKnowledgeImport', 'contextPanel.knowledgeRecoveryRebuild', 'contextPanel.clearRagCache'].includes(props.accessibilityLabel)) {
        mockImportPresses[props.accessibilityLabel] = props.onPress
      }
      return <MockPressable {...props} />
    }, IsleToggle: ({ title, description }: any) => <View><Text>{title}</Text>{description ? <Text>{description}</Text> : null}</View>, IsleChip: Text, IsleProgress: jest.requireActual('@/components/ui/isle/IsleKit').IsleProgress, ThemeExpressionRegion: View,
    IsleField: ({ label, inputProps }: any) => <TextInput accessibilityLabel={label} {...inputProps} />,
    IsleButton: ({ label, ...props }: any) => {
      if (['contextPanel.localModel.cancelDownload', 'contextPanel.localModel.retrySelectionSave', 'contextPanel.localModel.reviewStateReset'].includes(label)) mockModelPresses[label] = props.onPress
      if (['contextPanel.cancelKnowledgeRebuild', 'contextPanel.cancelSelfTest', 'contextPanel.cancelRagEvaluation'].includes(label)) mockImportPresses[label] = props.onPress
      return <MockPressable accessibilityRole="button" accessibilityLabel={label} {...props}><Text>{label}</Text></MockPressable>
    },
    useIsleDialog: () => ({ toast: mockToast, confirm: mockConfirm, notice: mockNotice }),
  }
})

const label = 'contextPanel.localModel.mirrorBaseUrl'
function Page() {
  return <SettingsEditBoundary><SettingsSectionContext.Provider value={{ target: 'local-model-mirror', register: () => undefined }}><ContextPanel providers={[]} section="context" /></SettingsSectionContext.Provider></SettingsEditBoundary>
}
beforeEach(() => {
  jest.clearAllMocks()
  mockMotion = 'none'
  mockTheme = 'minimal'
  mockMode = 'light'
  mockAnimations = []
  mockSettings = { localModelDownloadMirrorBaseUrl: 'https://saved.invalid' }
  mockSettingsListeners.clear()
  mockUpdate.mockReset().mockImplementation(publishModelSettings)
  mockFlush.mockReset().mockResolvedValue(undefined)
  mockConfirm.mockReset().mockResolvedValue(true)
  mockDocuments.mockReset().mockResolvedValue([])
  mockMemories = []
  mockMemoryProps = undefined
  mockImportPresses = {}
  mockModelPresses = {}
  mockCatalogKeyGetter = mockGetKey
  mockMemoryUpdate.mockReset().mockResolvedValue(undefined)
  mockMemoryDelete.mockReset().mockResolvedValue(undefined)
  mockMemoryClear.mockReset().mockResolvedValue(undefined)
  mockDocumentDelete.mockReset().mockResolvedValue(undefined)
  mockDocumentClear.mockReset().mockResolvedValue(undefined)
  mockImportFile.mockReset().mockResolvedValue({ ok: true, message: 'Imported' })
  mockImportPlainText.mockReset().mockResolvedValue({ ok: true, message: 'Imported' })
  mockPrimaryProvider.mockReset().mockResolvedValue(undefined)
  mockLocalModels.mockReset().mockResolvedValue([])
  mockModelDownload.mockReset().mockResolvedValue(undefined)
  mockModelDelete.mockReset().mockResolvedValue(undefined)
  mockReviewModelState.mockReset().mockResolvedValue(null)
  mockRebuild.mockReset().mockResolvedValue(1)
  mockSelfTest.mockReset().mockResolvedValue({ steps: [], ok: 1, warn: 0, fail: 0 })
  mockRagEvaluation.mockReset().mockResolvedValue(ragRun)
  mockCacheClear.mockReset().mockResolvedValue(undefined)
  mockDiagnosticsProps = undefined
})

const ragRun = { id: 'owned', ranAt: 1, cases: [], averageConfidence: 0.8,
  averageCitationCoverage: 1, averageContextPrecision: 0.9, fallbackReasons: [] }

it.each(CANONICAL_THEME_IDS)('names the actual %s local-model download progress without committing a selection before settlement', async family => {
  mockTheme = family
  const model: LocalEmbeddingModelView = {
    model: {
      id: 'host-only-model', version: '1', name: 'Owned model fixture', language: 'en',
      useCase: 'Host-only accessibility fixture', dimension: 8, tokenizer: 'wordpiece',
      maxTokens: 16, sizeBytes: 100, downloadBaseUrl: 'https://model-fixture.invalid',
      bundledIn: [], files: [{ path: 'model.onnx', bytes: 100, sha256: '0'.repeat(64) }],
    },
    status: 'not-downloaded', source: 'none', active: false, downloaded: false, bundled: false, bytes: 0,
  }
  mockLocalModels.mockResolvedValue([model])
  let settle!: () => void
  const pending = new Promise<void>(resolve => { settle = resolve })
  let options!: LocalEmbeddingDownloadOptions
  mockModelDownload.mockImplementation((_id: string, captured: LocalEmbeddingDownloadOptions) => {
    options = captured
    return pending
  })
  const screen = await render(<IsleThemeProvider><Page /></IsleThemeProvider>)
  try {
    await waitFor(() => expect(screen.getByText(model.model.name)).toBeTruthy())
    await fireEvent.press(screen.getByLabelText('contextPanel.localModel.download'))
    expect(mockModelDownload).toHaveBeenCalledTimes(1)
    const progress: LocalEmbeddingDownloadProgress = {
      modelId: model.model.id, modelName: model.model.name, filePath: 'model.onnx',
      fileIndex: 1, fileCount: 1, bytesWritten: 30, totalBytes: 100,
      fileBytesWritten: 30, fileTotalBytes: 100, percent: 30, stage: 'downloading',
      sourceUrl: 'https://model-fixture.invalid/model.onnx',
    }
    await act(() => options.onProgress?.(progress))
    const name = 'Owned model fixture \u00b7 contextPanel.localModel.downloadStages.downloading'
    const bar = screen.getByRole('progressbar', { name })
    expect(bar.props['aria-valuenow'] ?? bar.props.accessibilityValue?.now).toBe(30)
    await act(() => options.onProgress?.({ ...progress, percent: 100, stage: 'verifying' }))
    const verifying = screen.getByRole('progressbar', { name: 'Owned model fixture \u00b7 contextPanel.localModel.downloadStages.verifying' })
    expect(verifying.props['aria-valuenow'] ?? verifying.props.accessibilityValue?.now).toBe(100)
    expect(screen.queryByRole('progressbar', { name })).toBeNull()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSettings.localEmbeddingModelId).toBeUndefined()
    await act(async () => { settle(); await pending })
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ localEmbeddingModelId: model.model.id, localEmbeddingModelSource: 'downloaded' }))
  } finally {
    await act(async () => { settle(); await pending })
    await screen.unmount()
  }
})

function localModelFixture(source: 'none' | 'downloaded' | 'bundled' = 'none', id = 'owned-model'): LocalEmbeddingModelView {
  return {
    model: {
      id, version: '1', name: `Model ${id}`, language: 'en', useCase: 'Isolated lifecycle fixture',
      dimension: 8, tokenizer: 'wordpiece', maxTokens: 16, sizeBytes: 100,
      downloadBaseUrl: 'https://model-lifecycle-fixture.invalid', bundledIn: [],
      files: [{ path: 'model.onnx', bytes: 100, sha256: '0'.repeat(64) }],
    },
    status: source === 'none' ? 'not-downloaded' : source, source,
    active: false, downloaded: source === 'downloaded', bundled: source === 'bundled', bytes: 100,
  }
}

function deferredModel<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const localModelAction = (kind: 'download' | 'enable' | 'delete') => kind === 'delete' ? 'common.delete' : `contextPanel.localModel.${kind}`
async function localModelScreen(kind: 'download' | 'enable' | 'delete' = 'download') {
  const view = localModelFixture(kind === 'download' ? 'none' : kind === 'enable' ? 'bundled' : 'downloaded')
  mockLocalModels.mockResolvedValue([view])
  const screen = await render(<IsleThemeProvider><Page /></IsleThemeProvider>)
  await waitFor(() => expect(screen.getByText(view.model.name)).toBeTruthy())
  return { screen, view, action: mockModelPresses[localModelAction(kind)] }
}

it.each(['download', 'delete'] as const)('owns the %s confirmation before duplicate clicks and prevents overlapping asset work', async kind => {
  const confirmation = deferredModel<boolean>()
  mockConfirm.mockReturnValue(confirmation.promise)
  const { screen, action } = await localModelScreen(kind)
  try {
    await act(async () => { action(); action(); mockDiagnosticsProps.onRunSelfTest() })
    expect(mockConfirm).toHaveBeenCalledTimes(1)
    expect(mockSelfTest).not.toHaveBeenCalled()
    expect(screen.getByLabelText(localModelAction(kind))).toBeDisabled()
    await act(async () => mockRemove({ data: { action: { type: 'GO_BACK' } } }))
    expect(mockDispatch).not.toHaveBeenCalled()
    expect(mockConfirm).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => { confirmation.resolve(false); await confirmation.promise })
    await screen.unmount()
  }
})

it.each(['download', 'enable', 'delete'] as const)('refuses retained %s callbacks while another asset operation owns the lock', async kind => {
  const repair = deferredModel<number>()
  mockRebuild.mockReturnValueOnce(repair.promise)
  const { screen, action } = await localModelScreen(kind)
  try {
    await fireEvent.press(screen.getByLabelText('contextPanel.localModel.rebuildIndex'))
    await act(async () => { action() })
    expect(mockConfirm).not.toHaveBeenCalled()
    expect(mockModelDownload).not.toHaveBeenCalled()
    expect(mockModelDelete).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  } finally {
    await act(async () => { repair.resolve(1); await repair.promise })
    await screen.unmount()
  }
})

it.each(['download', 'delete'] as const)('retires a late %s confirmation after the page unmounts', async kind => {
  const confirmation = deferredModel<boolean>()
  mockConfirm.mockReturnValueOnce(confirmation.promise)
  const { screen, action } = await localModelScreen(kind)
  await act(async () => { action() })
  const reviewed = mockConfirm.mock.calls[0][0]
  await screen.unmount()
  await act(async () => { confirmation.resolve(true); await confirmation.promise })
  expect(mockModelDownload).not.toHaveBeenCalled()
  expect(mockModelDelete).not.toHaveBeenCalled()
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(reviewed.signal).toBeInstanceOf(AbortSignal)
  expect(reviewed.signal.aborted).toBe(true)
})

it.each(['download', 'delete'] as const)('rejects a %s confirmation if its committed selection or mirror changed', async kind => {
  const confirmation = deferredModel<boolean>()
  mockConfirm.mockReturnValueOnce(confirmation.promise)
  const { screen, action } = await localModelScreen(kind)
  await act(async () => { action() })
  mockSettings = { ...mockSettings, localEmbeddingModelId: 'new-choice', localEmbeddingModelSource: 'bundled', localModelDownloadMirrorBaseUrl: 'https://new-mirror.invalid' }
  await screen.rerender(<IsleThemeProvider><Page /></IsleThemeProvider>)
  await act(async () => { confirmation.resolve(true); await confirmation.promise })
  expect(mockModelDownload).not.toHaveBeenCalled()
  expect(mockModelDelete).not.toHaveBeenCalled()
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy()
  await screen.unmount()
})

it.each(['removed', 'changed', 'changed-and-restored'] as const)('binds model deletion approval to the shown target after it is %s', async change => {
  const confirmation = deferredModel<boolean>()
  mockConfirm.mockReturnValueOnce(confirmation.promise)
  const { screen, view, action } = await localModelScreen('delete')
  await act(async () => { action() })
  mockLocalModels.mockResolvedValue(change === 'removed' ? [] : [{ ...view, model: { ...view.model, files: [{ ...view.model.files[0], sha256: '1'.repeat(64) }] } }])
  mockCatalogKeyGetter = jest.fn(async () => '')
  await screen.rerender(<IsleThemeProvider><Page /></IsleThemeProvider>)
  await waitFor(() => expect(mockLocalModels).toHaveBeenCalledTimes(2))
  if (change === 'changed-and-restored') {
    mockLocalModels.mockResolvedValue([view])
    mockCatalogKeyGetter = jest.fn(async () => '')
    await screen.rerender(<IsleThemeProvider><Page /></IsleThemeProvider>)
    await waitFor(() => expect(mockLocalModels).toHaveBeenCalledTimes(3))
  }
  await act(async () => { confirmation.resolve(true); await confirmation.promise })
  expect(mockModelDelete).not.toHaveBeenCalled()
  expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy()
  await screen.unmount()
})

it('aborts an unmounted model download and suppresses late progress, selection, notices and readback', async () => {
  const install = deferredModel<void>()
  mockModelDownload.mockReturnValueOnce(install.promise)
  const { screen, action } = await localModelScreen()
  await act(async () => { action() })
  const options = mockModelDownload.mock.calls[0][1] as LocalEmbeddingDownloadOptions
  await screen.unmount()
  await act(async () => {
    options.onProgress?.({ modelId: 'owned-model', percent: 90, stage: 'verifying' } as LocalEmbeddingDownloadProgress)
    install.resolve(); await install.promise
  })
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(mockNotice).not.toHaveBeenCalled()
  expect(mockLocalModels).toHaveBeenCalledTimes(1)
  expect(options.signal?.aborted).toBe(true)
})

it.each(['download', 'enable', 'delete'] as const)('keeps %s busy through preference persistence and catalogue readback before success', async kind => {
  const saved = deferredModel<void>()
  mockFlush.mockReturnValueOnce(saved.promise)
  const { screen, action } = await localModelScreen(kind)
  if (kind === 'delete') mockSettings = { ...mockSettings, localEmbeddingModelId: 'owned-model', localEmbeddingModelSource: 'downloaded' }
  let readback!: (models: LocalEmbeddingModelView[]) => void
  mockLocalModels.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  try {
    await act(async () => { action() })
    expect(mockFlush).toHaveBeenCalledTimes(1)
    expect(mockNotice).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'mint' }))
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'mint' }))
    expect(screen.getByLabelText(localModelAction(kind))).toBeDisabled()
    await act(async () => { saved.resolve(); await saved.promise })
    expect(mockLocalModels).toHaveBeenCalledTimes(2)
    expect(mockNotice).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'mint' }))
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'mint' }))
    await act(async () => { action(); mockDiagnosticsProps.onRunSelfTest() })
    expect(mockSelfTest).not.toHaveBeenCalled()
    await act(async () => { readback([]) })
    expect(mockNotice.mock.calls.length + mockToast.mock.calls.length).toBeGreaterThan(0)
  } finally {
    await act(async () => { saved.resolve(); await saved.promise; readback?.([]) })
    await screen.unmount()
  }
})

it.each(['download', 'delete'] as const)('keeps a newer model selection instead of overwriting it after %s acknowledgement', async kind => {
  const effect = deferredModel<void>()
  ;(kind === 'download' ? mockModelDownload : mockModelDelete).mockReturnValueOnce(effect.promise)
  if (kind === 'delete') mockSettings = { ...mockSettings, localEmbeddingModelId: 'owned-model', localEmbeddingModelSource: 'downloaded' }
  const { screen, action } = await localModelScreen(kind)
  await act(async () => { action() })
  mockSettings = { ...mockSettings, embeddingMode: 'provider', localEmbeddingModelId: 'newer-model', localEmbeddingModelSource: 'bundled' }
  await act(async () => { effect.resolve(); await effect.promise })
  expect(mockSettings.localEmbeddingModelId).toBe('newer-model')
  expect(mockSettings.localEmbeddingModelSource).toBe('bundled')
  expect(mockSettings.embeddingMode).toBe('provider')
  expect(mockUpdate).not.toHaveBeenCalled()
  await screen.unmount()
})

it.each(['download', 'enable', 'delete'] as const)('keeps %s replay closed after failed saved-state readback until explicit reload', async kind => {
  const { screen, action } = await localModelScreen(kind)
  mockLocalModels.mockRejectedValueOnce(new Error('Owned model readback failed'))
  await act(async () => { action() })
  expect(screen.getByText('settingsSubsystem.operationReadbackFailed')).toBeTruthy()
  const previous = mockUpdate.mock.calls.length + mockModelDelete.mock.calls.length + mockModelDownload.mock.calls.length
  await act(async () => { action() })
  expect(mockUpdate.mock.calls.length + mockModelDelete.mock.calls.length + mockModelDownload.mock.calls.length).toBe(previous)
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await act(async () => { mockModelPresses[localModelAction(kind)]() })
  expect(mockUpdate.mock.calls.length + mockModelDelete.mock.calls.length + mockModelDownload.mock.calls.length).toBeGreaterThan(previous)
  await screen.unmount()
})

it('cancels a model download without admitting replacement work before settlement and readback', async () => {
  const install = deferredModel<void>()
  mockModelDownload.mockReturnValueOnce(install.promise)
  const { screen, action } = await localModelScreen()
  try {
    await act(async () => { action() })
    const options = mockModelDownload.mock.calls[0][1] as LocalEmbeddingDownloadOptions
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.localModel.cancelDownload' }))
    expect(options.signal?.aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'contextPanel.localModel.cancellingDownload' })).toBeDisabled()
    await act(async () => { action(); mockDiagnosticsProps.onRunSelfTest() })
    expect(mockModelDownload).toHaveBeenCalledTimes(1)
    expect(mockSelfTest).not.toHaveBeenCalled()
    await act(async () => { install.resolve(); await install.promise })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockNotice).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'mint' }))
    expect(screen.getByText('contextPanel.localModel.downloadCancelled')).toBeTruthy()
  } finally {
    await act(async () => { install.resolve(); await install.promise })
    await screen.unmount()
  }
})

it('retries a failed model preference save without repeating files or overwriting a later choice', async () => {
  mockFlush.mockRejectedValueOnce(new Error('Owned preference disk unavailable'))
  const { screen, action } = await localModelScreen()
  await act(async () => { action() })
  expect(screen.getByText('contextPanel.localModel.selectionSaveFailed')).toBeTruthy()
  expect(mockModelDownload).toHaveBeenCalledTimes(1)
  await act(async () => { action() })
  expect(mockModelDownload).toHaveBeenCalledTimes(1)
  mockSettings = { ...mockSettings, localEmbeddingModelId: 'later-saved-choice', localEmbeddingModelSource: 'bundled', embeddingMode: 'provider', defaultProvider: 'configured-provider', memoryEnabled: false }
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.localModel.retrySelectionSave' }))
  expect(mockModelDownload).toHaveBeenCalledTimes(1)
  expect(mockModelDelete).not.toHaveBeenCalled()
  expect(mockFlush).toHaveBeenCalledTimes(2)
  expect(mockSettings).toEqual(expect.objectContaining({ localEmbeddingModelId: 'later-saved-choice', localEmbeddingModelSource: 'bundled', embeddingMode: 'provider', defaultProvider: 'configured-provider', memoryEnabled: false }))
  expect(screen.queryByText('contextPanel.localModel.selectionSaveFailed')).toBeNull()
  await screen.unmount()
})

it.each(['download', 'delete'] as const)('does not reuse %s consent after settings change and restore within one commit', async kind => {
  const confirmation = deferredModel<boolean>()
  mockConfirm.mockReturnValueOnce(confirmation.promise)
  const { screen, action } = await localModelScreen(kind)
  try {
    await act(async () => { action() })
    const original = { ...mockSettings }
    await act(async () => {
      publishModelSettings({ localEmbeddingModelId: 'temporary-choice', localModelDownloadMirrorBaseUrl: 'https://temporary.invalid' })
      publishModelSettings({ ...original, localEmbeddingModelId: undefined })
      confirmation.resolve(true); await confirmation.promise
    })
    expect(mockModelDownload).not.toHaveBeenCalled()
    expect(mockModelDelete).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy()
  } finally {
    await act(async () => { confirmation.resolve(false); await confirmation.promise })
    await screen.unmount()
  }
})

it.each(['download', 'delete'] as const)('keeps a newer changed-and-restored choice after %s starts without publishing its own preference', async kind => {
  const effect = deferredModel<void>()
  ;(kind === 'download' ? mockModelDownload : mockModelDelete).mockReturnValueOnce(effect.promise)
  if (kind === 'delete') mockSettings = { ...mockSettings, localEmbeddingModelId: 'owned-model', localEmbeddingModelSource: 'downloaded' }
  const { screen, action } = await localModelScreen(kind)
  try {
    await act(async () => { action() })
    const original = { ...mockSettings }
    await act(async () => {
      publishModelSettings({ localEmbeddingModelId: 'temporary-choice', localEmbeddingModelSource: 'bundled' })
      publishModelSettings({ ...original, localEmbeddingModelId: original.localEmbeddingModelId, localEmbeddingModelSource: original.localEmbeddingModelSource })
      effect.resolve(); await effect.promise
    })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSettings).toEqual(original)
  } finally {
    await act(async () => { effect.resolve(); await effect.promise })
    await screen.unmount()
  }
})

it('waits for the later current preference save instead of finishing after only the earlier download save', async () => {
  const earlier = deferredModel<void>()
  const later = deferredModel<void>()
  mockFlush.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise)
  const { screen, action } = await localModelScreen()
  try {
    await act(async () => { action() })
    await act(async () => {
      publishModelSettings({ localEmbeddingModelId: 'later-choice', localEmbeddingModelSource: 'bundled', embeddingMode: 'provider' })
      earlier.resolve(); await earlier.promise
    })
    expect(mockFlush).toHaveBeenCalledTimes(2)
    expect(mockNotice).not.toHaveBeenCalled()
    expect(screen.getByLabelText('contextPanel.localModel.download')).toBeDisabled()
    expect(mockLocalModels).toHaveBeenCalledTimes(1)
    await act(async () => { later.resolve(); await later.promise })
    expect(mockSettings.localEmbeddingModelId).toBe('later-choice')
    expect(mockLocalModels).toHaveBeenCalledTimes(2)
    expect(mockNotice).toHaveBeenCalledWith(expect.objectContaining({ tone: 'mint' }))
  } finally {
    await act(async () => { earlier.resolve(); later.resolve(); await Promise.all([earlier.promise, later.promise]) })
    await screen.unmount()
  }
})

it('does not announce a stale catalog read after a later preference changes during readback', async () => {
  const readback = deferredModel<LocalEmbeddingModelView[]>()
  const laterSave = deferredModel<void>()
  const { screen, action } = await localModelScreen()
  mockLocalModels.mockReturnValueOnce(readback.promise)
  try {
    await act(async () => { action() })
    mockFlush.mockReturnValueOnce(laterSave.promise)
    await act(async () => {
      publishModelSettings({ localEmbeddingModelId: 'during-readback', localEmbeddingModelSource: 'bundled' })
      readback.resolve([]); await readback.promise
    })
    expect(mockNotice).not.toHaveBeenCalled()
    expect(mockFlush).toHaveBeenCalledTimes(2)
    await act(async () => { laterSave.resolve(); await laterSave.promise })
    expect(mockLocalModels).toHaveBeenCalledTimes(3)
    expect(mockLocalModels.mock.calls[2][0]).toEqual(expect.objectContaining({ localEmbeddingModelId: 'during-readback' }))
    expect(mockNotice).toHaveBeenCalledWith(expect.objectContaining({ tone: 'mint' }))
  } finally {
    await act(async () => { readback.resolve([]); laterSave.resolve(); await Promise.all([readback.promise, laterSave.promise]) })
    await screen.unmount()
  }
})

it('keeps readback failure ownership after an unrelated successful catalog refresh', async () => {
  const { screen, action } = await localModelScreen()
  mockLocalModels.mockRejectedValueOnce(new Error('Owned readback failed'))
  await act(async () => { action() })
  mockCatalogKeyGetter = jest.fn(async () => '')
  await screen.rerender(<IsleThemeProvider><Page /></IsleThemeProvider>)
  await waitFor(() => expect(mockLocalModels).toHaveBeenCalledTimes(3))
  await act(async () => { action(); mockDiagnosticsProps.onRunSelfTest() })
  expect(mockModelDownload).toHaveBeenCalledTimes(1)
  expect(mockSelfTest).not.toHaveBeenCalled()
  expect(screen.getByText('settingsSubsystem.operationReadbackFailed')).toBeTruthy()
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  expect(screen.queryByText('settingsSubsystem.operationReadbackFailed')).toBeNull()
  await screen.unmount()
})

it('keeps preference-save failure ownership through catalog-only retry and blocks navigation', async () => {
  mockFlush.mockRejectedValueOnce(new Error('Owned preference failed'))
  const { screen, action } = await localModelScreen()
  await act(async () => { action() })
  mockCatalogKeyGetter = jest.fn(async () => '')
  await screen.rerender(<IsleThemeProvider><Page /></IsleThemeProvider>)
  await waitFor(() => expect(mockLocalModels).toHaveBeenCalledTimes(3))
  await act(async () => { action(); mockRemove({ data: { action: { type: 'GO_BACK' } } }) })
  expect(mockModelDownload).toHaveBeenCalledTimes(1)
  expect(mockDispatch).not.toHaveBeenCalled()
  expect(mockConfirm).toHaveBeenCalledTimes(1)
  expect(screen.getByText('contextPanel.localModel.selectionSaveFailed')).toBeTruthy()
  await screen.unmount()
})

it('serializes repeated preference-save retries without repeating download or deleting files', async () => {
  mockFlush.mockRejectedValueOnce(new Error('Owned preference failed'))
  const { screen, action } = await localModelScreen()
  await act(async () => { action() })
  const saving = deferredModel<void>()
  mockFlush.mockReturnValueOnce(saving.promise)
  const retry = mockModelPresses['contextPanel.localModel.retrySelectionSave']
  try {
    await act(async () => { retry(); retry(); action(); mockDiagnosticsProps.onRunSelfTest() })
    expect(mockFlush).toHaveBeenCalledTimes(2)
    expect(mockModelDownload).toHaveBeenCalledTimes(1)
    expect(mockModelDelete).not.toHaveBeenCalled()
    expect(mockSelfTest).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'contextPanel.localModel.retrySelectionSave' })).toBeDisabled()
    await act(async () => { saving.resolve(); await saving.promise })
    expect(screen.queryByText('contextPanel.localModel.selectionSaveFailed')).toBeNull()
  } finally {
    await act(async () => { saving.resolve(); await saving.promise })
    await screen.unmount()
  }
})

it('retains preference-save debt after a repeated failure and enqueues the current snapshot on another retry', async () => {
  mockFlush.mockRejectedValueOnce(new Error('First disk failure'))
  const { screen, action } = await localModelScreen()
  await act(async () => { action() })
  mockFlush.mockRejectedValueOnce(new Error('Second disk failure'))
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.localModel.retrySelectionSave' }))
  expect(screen.getByText('contextPanel.localModel.selectionSaveFailed')).toBeTruthy()
  publishModelSettings({ localEmbeddingModelId: 'last-choice', localEmbeddingModelSource: 'bundled', defaultProvider: 'untouched-provider' })
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.localModel.retrySelectionSave' }))
  expect(mockUpdate.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ localEmbeddingModelId: 'last-choice', defaultProvider: 'untouched-provider' }))
  expect(mockModelDownload).toHaveBeenCalledTimes(1)
  expect(mockFlush).toHaveBeenCalledTimes(3)
  expect(screen.queryByText('contextPanel.localModel.selectionSaveFailed')).toBeNull()
  await screen.unmount()
})

it('ignores a previous cancelled download progress callback while a replacement owns the row', async () => {
  const first = deferredModel<void>()
  const second = deferredModel<void>()
  mockModelDownload.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const { screen, action, view } = await localModelScreen()
  try {
    await act(async () => { action() })
    const retired = mockModelDownload.mock.calls[0][1] as LocalEmbeddingDownloadOptions
    const retainedCancel = mockModelPresses['contextPanel.localModel.cancelDownload']
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.localModel.cancelDownload' }))
    await act(async () => { first.resolve(); await first.promise })
    await act(async () => { mockModelPresses['contextPanel.localModel.download']() })
    const current = mockModelDownload.mock.calls[1][1] as LocalEmbeddingDownloadOptions
    await act(async () => {
      retainedCancel()
      retired.onProgress?.({ modelId: view.model.id, percent: 97, stage: 'verifying' } as LocalEmbeddingDownloadProgress)
      current.onProgress?.({ modelId: 'wrong-model', percent: 88, stage: 'downloading' } as LocalEmbeddingDownloadProgress)
    })
    expect(current.signal?.aborted).toBe(false)
    expect(screen.queryByRole('progressbar')).toBeNull()
    await act(async () => current.onProgress?.({ modelId: view.model.id, percent: 21, stage: 'downloading' } as LocalEmbeddingDownloadProgress))
    expect(screen.getByRole('progressbar').props.accessibilityValue?.now).toBe(21)
  } finally {
    await act(async () => { first.resolve(); second.resolve(); await Promise.all([first.promise, second.promise]) })
    await screen.unmount()
  }
})

it('detaches accepted progress payloads and refuses late progress during preference persistence', async () => {
  const install = deferredModel<void>()
  const saving = deferredModel<void>()
  mockModelDownload.mockReturnValueOnce(install.promise)
  mockFlush.mockReturnValueOnce(saving.promise)
  const { screen, action, view } = await localModelScreen()
  try {
    await act(async () => { action() })
    const options = mockModelDownload.mock.calls[0][1] as LocalEmbeddingDownloadOptions
    const progress = { modelId: view.model.id, percent: 37, stage: 'downloading' } as LocalEmbeddingDownloadProgress
    await act(async () => options.onProgress?.(progress))
    progress.percent = 99
    await screen.rerender(<IsleThemeProvider><Page /></IsleThemeProvider>)
    expect(screen.getByRole('progressbar').props.accessibilityValue?.now).toBe(37)
    await act(async () => { install.resolve(); await install.promise })
    await act(async () => options.onProgress?.({ ...progress, stage: 'verifying' }))
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'contextPanel.localModel.cancelDownload' })).toBeNull()
  } finally {
    await act(async () => { install.resolve(); saving.resolve(); await Promise.all([install.promise, saving.promise]) })
    await screen.unmount()
  }
})

it('preserves the reviewed target after an external catalog model object changes in place', async () => {
  const confirmation = deferredModel<boolean>()
  mockConfirm.mockReturnValueOnce(confirmation.promise)
  const { screen, action, view } = await localModelScreen('delete')
  await act(async () => { action() })
  const originalId = view.model.id
  view.model.id = 'mutated-unseen-model'
  await act(async () => { confirmation.resolve(true); await confirmation.promise })
  expect(mockModelDelete).toHaveBeenCalledWith(originalId, expect.any(AbortSignal))
  await screen.unmount()
})

it('reads authoritative model status and holds the lock through a rejected deletion instead of announcing success', async () => {
  const failedRead = deferredModel<LocalEmbeddingModelView[]>()
  const { screen, action, view } = await localModelScreen('delete')
  mockModelDelete.mockRejectedValueOnce(new Error('Owned removal failed'))
  mockLocalModels.mockReturnValueOnce(failedRead.promise)
  try {
    await act(async () => { action() })
    expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy()
    expect(screen.queryByLabelText('common.delete')).toBeNull()
    expect(screen.queryByText(view.model.name)).toBeNull()
    expect(mockDiagnosticsProps.selfTestBlocked).toBe(true)
    await act(async () => { action(); mockDiagnosticsProps.onRunSelfTest() })
    expect(mockModelDelete).toHaveBeenCalledTimes(1)
    expect(mockSelfTest).not.toHaveBeenCalled()
    await act(async () => { failedRead.resolve([]); await failedRead.promise })
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'mint' }))
  } finally {
    await act(async () => { failedRead.resolve([]); await failedRead.promise })
    await screen.unmount()
  }
})

it('does not report a save failure as a repeated download failure', async () => {
  mockFlush.mockRejectedValueOnce(new Error('Owned settings save failed'))
  const { screen, action } = await localModelScreen()
  await act(async () => { action() })
  expect(mockNotice).not.toHaveBeenCalled()
  expect(screen.getByText('contextPanel.localModel.selectionSaveFailed')).toBeTruthy()
  expect(mockLocalModels).toHaveBeenCalledTimes(2)
  await screen.unmount()
})

it('does not publish preference state or notices after a model deletion settles on an unmounted page', async () => {
  const deleted = deferredModel<void>()
  mockModelDelete.mockReturnValueOnce(deleted.promise)
  mockSettings = { ...mockSettings, localEmbeddingModelId: 'owned-model', localEmbeddingModelSource: 'downloaded' }
  const { screen, action } = await localModelScreen('delete')
  await act(async () => { action() })
  const signal = mockModelDelete.mock.calls[0][1] as AbortSignal
  await screen.unmount()
  await act(async () => { deleted.resolve(); await deleted.promise })
  expect(signal.aborted).toBe(true)
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(mockToast).not.toHaveBeenCalled()
  expect(mockLocalModels).toHaveBeenCalledTimes(1)
  expect(mockSettingsUnsubscribe).toHaveBeenCalledTimes(1)
})

it.each(['download', 'enable', 'delete'] as const)('does not emit late %s success after an in-flight preference save outlives the page', async kind => {
  const saved = deferredModel<void>()
  mockFlush.mockReturnValueOnce(saved.promise)
  if (kind === 'delete') mockSettings = { ...mockSettings, localEmbeddingModelId: 'owned-model', localEmbeddingModelSource: 'downloaded' }
  const { screen, action } = await localModelScreen(kind)
  await act(async () => { action() })
  await screen.unmount()
  await act(async () => { saved.resolve(); await saved.promise })
  expect(mockLocalModels).toHaveBeenCalledTimes(1)
  expect(mockToast).not.toHaveBeenCalled()
  expect(mockNotice).not.toHaveBeenCalled()
  expect(mockFlush).toHaveBeenCalledTimes(1)
})

it('keeps a cancelled download closed until its failed authoritative readback is explicitly retried', async () => {
  const install = deferredModel<void>()
  mockModelDownload.mockReturnValueOnce(install.promise)
  const { screen, action } = await localModelScreen()
  try {
    await act(async () => { action() })
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.localModel.cancelDownload' }))
    mockLocalModels.mockRejectedValueOnce(new Error('Owned cancelled readback failed'))
    await act(async () => { install.resolve(); await install.promise })
    expect(screen.getByText('settingsSubsystem.operationReadbackFailed')).toBeTruthy()
    await act(async () => { action(); mockDiagnosticsProps.onRunSelfTest() })
    expect(mockModelDownload).toHaveBeenCalledTimes(1)
    expect(mockSelfTest).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
    expect(screen.queryByText('settingsSubsystem.operationReadbackFailed')).toBeNull()
  } finally {
    await act(async () => { install.resolve(); await install.promise })
    await screen.unmount()
  }
})

it('keeps a cancelled download cleanup failure visible and reads its partial state only once', async () => {
  const install = deferredModel<void>()
  mockModelDownload.mockReturnValueOnce(install.promise)
  const { screen, action } = await localModelScreen()
  try {
    await act(async () => { action() })
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.localModel.cancelDownload' }))
    await act(async () => { install.reject(new Error('Owned cleanup could not remove staged files')); await install.promise.catch(() => undefined) })
    expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy()
    expect(screen.getByText('contextPanel.localModel.downloadCancelled')).toBeTruthy()
    expect(mockNotice).toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.localModel.downloadFailed', tone: 'danger' }))
    expect(mockLocalModels).toHaveBeenCalledTimes(2)
    expect(mockUpdate).not.toHaveBeenCalled()
  } finally {
    await act(async () => { install.resolve(); await install.promise.catch(() => undefined) })
    await screen.unmount()
  }
})

it('does not call an ordinary aborted download rejection a cleanup failure', async () => {
  const install = deferredModel<void>()
  mockModelDownload.mockReturnValueOnce(install.promise)
  const { screen, action } = await localModelScreen()
  try {
    await act(async () => { action() })
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.localModel.cancelDownload' }))
    await act(async () => {
      const error = new Error('Owned cancellation'); error.name = 'AbortError'
      install.reject(error); await install.promise.catch(() => undefined)
    })
    expect(mockNotice).not.toHaveBeenCalled()
    expect(screen.queryByText('settingsSubsystem.operationFailed')).toBeNull()
    expect(mockLocalModels).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => { install.resolve(); await install.promise.catch(() => undefined) })
    await screen.unmount()
  }
})

it('keeps later save rejection retryable instead of announcing an earlier successful download preference', async () => {
  const earlier = deferredModel<void>()
  mockFlush.mockReturnValueOnce(earlier.promise).mockRejectedValueOnce(new Error('Later settings failed'))
  const { screen, action } = await localModelScreen()
  try {
    await act(async () => { action() })
    await act(async () => {
      publishModelSettings({ localEmbeddingModelId: 'latest-preference', localEmbeddingModelSource: 'bundled' })
      earlier.resolve(); await earlier.promise
    })
    expect(mockFlush).toHaveBeenCalledTimes(2)
    expect(mockNotice).not.toHaveBeenCalled()
    expect(screen.getByText('contextPanel.localModel.selectionSaveFailed')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.localModel.retrySelectionSave' }))
    expect(mockSettings.localEmbeddingModelId).toBe('latest-preference')
    expect(mockModelDownload).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('contextPanel.localModel.selectionSaveFailed')).toBeNull()
  } finally {
    await act(async () => { earlier.resolve(); await earlier.promise })
    await screen.unmount()
  }
})

it('keeps the retry save closed after a superseded model readback until explicit reload', async () => {
  mockFlush.mockRejectedValueOnce(new Error('Owned settings failed'))
  const { screen, action, view } = await localModelScreen()
  await act(async () => { action() })
  const ownRead = deferredModel<LocalEmbeddingModelView[]>()
  mockLocalModels.mockReturnValueOnce(ownRead.promise)
  const retry = mockModelPresses['contextPanel.localModel.retrySelectionSave']
  try {
    await act(async () => { retry() })
    mockCatalogKeyGetter = jest.fn(async () => '')
    await screen.rerender(<IsleThemeProvider><Page /></IsleThemeProvider>)
    await waitFor(() => expect(mockLocalModels).toHaveBeenCalledTimes(4))
    await act(async () => { ownRead.resolve([view]); await ownRead.promise; action() })
    expect(mockModelDownload).toHaveBeenCalledTimes(1)
    expect(mockFlush).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
    await act(async () => { mockModelPresses['contextPanel.localModel.download']() })
    expect(mockModelDownload).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => { ownRead.resolve([view]); await ownRead.promise })
    await screen.unmount()
  }
})

it('does not announce an earlier enable as active after a newer explicit model choice is persisted', async () => {
  const saving = deferredModel<void>()
  mockFlush.mockReturnValueOnce(saving.promise)
  const { screen, action } = await localModelScreen('enable')
  try {
    await act(async () => { action() })
    await act(async () => {
      publishModelSettings({ localEmbeddingModelId: 'new-active-model', localEmbeddingModelSource: 'downloaded', embeddingMode: 'local' })
      saving.resolve(); await saving.promise
    })
    expect(mockSettings.localEmbeddingModelId).toBe('new-active-model')
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.localModel.enabled', tone: 'mint' }))
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockLocalModels).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => { saving.resolve(); await saving.promise })
    await screen.unmount()
  }
})

function composeModelPreferencePersistence() {
  const command = jest.requireActual<typeof import('@/presentation/features/settings/settingsStorePersistenceCommand')>(
    '@/presentation/features/settings/settingsStorePersistenceCommand')
  const { createSettingsPersistence } = jest.requireActual<typeof import('@/modules/settings/application/settingsPersistence')>(
    '@/modules/settings/application/settingsPersistence')
  let serialized: string | null = null
  const write = jest.fn(async (settings: unknown) => { serialized = JSON.stringify(settings) })
  const persistence = {
    settings: createSettingsPersistence({
      read: async () => serialized === null ? null : JSON.parse(serialized),
      write,
    }),
    providers: { load: async () => null, save: async () => undefined },
  }
  command.bindSettingsStorePersistence(persistence)
  mockFlush.mockImplementation(() => command.flushPersistedSettings())
  mockUpdate.mockImplementation((patch: object) => {
    publishModelSettings(patch)
    const settings = { ...mockSettings } as unknown as import('@/types/settingsContracts').Settings
    void command.savePersistedSettings(settings).catch(() => undefined)
  })
  return {
    command, persistence, write,
    serialized: () => serialized,
    close: async () => {
      await command.flushPersistedSettings().catch(() => undefined)
      command.releaseSettingsStorePersistence(persistence)
    },
  }
}

const modelThemeCases = CANONICAL_THEME_IDS.flatMap(family =>
  (['light', 'dark'] as const).map(mode => [family, mode] as const))
it.each(modelThemeCases)('retains the %s/%s preference save failure and saves newer configured choices through the actual serialized queue', async (family, mode) => {
  mockTheme = family; mockMode = mode
  mockSettings = {
    ...mockSettings, defaultProvider: 'configured-provider',
    lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId: 'configured-provider', model: 'saved-alias' },
    memoryEnabled: false, knowledgeEnabled: false, mcpEnabled: false, skillsEnabled: false, webSearchEnabled: false,
  }
  const storage = composeModelPreferencePersistence()
  storage.write.mockRejectedValueOnce(new Error('Owned JSON write failed'))
  const { screen, action } = await localModelScreen()
  try {
    await act(async () => { action() })
    expect(screen.getByText('contextPanel.localModel.selectionSaveFailed')).toBeTruthy()
    expect(storage.serialized()).toBeNull()
    publishModelSettings({ localEmbeddingModelId: 'newer-configured-model', localEmbeddingModelSource: 'bundled', embeddingMode: 'provider' })
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.localModel.retrySelectionSave' }))
    const reloaded = await storage.persistence.settings.load()
    expect(reloaded).toEqual(expect.objectContaining({
      localEmbeddingModelId: 'newer-configured-model', localEmbeddingModelSource: 'bundled', embeddingMode: 'provider',
      defaultProvider: 'configured-provider', memoryEnabled: false, knowledgeEnabled: false, mcpEnabled: false,
      skillsEnabled: false, webSearchEnabled: false,
      lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId: 'configured-provider', model: 'saved-alias' },
    }))
    expect(storage.write).toHaveBeenCalledTimes(2)
    expect(mockModelDownload).toHaveBeenCalledTimes(1)
    expect(mockModelDelete).not.toHaveBeenCalled()
    expect(screen.queryByText('contextPanel.localModel.selectionSaveFailed')).toBeNull()
  } finally {
    await screen.unmount()
    await storage.close()
  }
})

it('awaits actual queued writes for a newer selection before download readback and preserves serialized paused subsystems', async () => {
  const earlier = deferredModel<void>()
  const later = deferredModel<void>()
  const earlierStarted = deferredModel<void>()
  const laterStarted = deferredModel<void>()
  const storage = composeModelPreferencePersistence()
  const write = storage.write.getMockImplementation()!
  storage.write.mockImplementationOnce(async settings => {
    earlierStarted.resolve(); await earlier.promise; await write(settings)
  }).mockImplementationOnce(async settings => {
    laterStarted.resolve(); await later.promise; await write(settings)
  })
  mockSettings = { ...mockSettings, memoryEnabled: false, knowledgeEnabled: false, defaultProvider: 'configured-provider' }
  const { screen, action } = await localModelScreen()
  try {
    await act(async () => { action(); await earlierStarted.promise })
    await act(async () => {
      mockUpdate({ localEmbeddingModelId: 'later-queued-model', localEmbeddingModelSource: 'bundled', embeddingMode: 'provider' })
      earlier.resolve(); await laterStarted.promise
    })
    expect(mockNotice).not.toHaveBeenCalled()
    expect(mockLocalModels).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('contextPanel.localModel.download')).toBeDisabled()
    await act(async () => { later.resolve(); await storage.command.flushPersistedSettings() })
    expect(await storage.persistence.settings.load()).toEqual(expect.objectContaining({
      localEmbeddingModelId: 'later-queued-model', localEmbeddingModelSource: 'bundled', embeddingMode: 'provider',
      memoryEnabled: false, knowledgeEnabled: false, defaultProvider: 'configured-provider',
    }))
    expect(mockLocalModels.mock.calls[1][0]).toEqual(expect.objectContaining({ localEmbeddingModelId: 'later-queued-model' }))
    expect(mockModelDownload).toHaveBeenCalledTimes(1)
    expect(storage.write).toHaveBeenCalledTimes(2)
  } finally {
    earlier.resolve(); later.resolve()
    await screen.unmount()
    await storage.close()
  }
})

it.each(['evaluation', 'cache'] as const)('serializes %s with all asset operations and settings busy through readback', async kind => {
  const port = kind === 'evaluation' ? mockRagEvaluation : mockCacheClear
  let finish!: () => void
  port.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(kind === 'evaluation' ? ragRun : undefined) }))
  const screen = await render(<Page />)
  const run = kind === 'evaluation' ? mockDiagnosticsProps.onRunRagEvaluation : mockImportPresses['contextPanel.clearRagCache']
  await act(async () => { run(); run() })
  expect(port).toHaveBeenCalledTimes(1)
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  await fireEvent.press(screen.getByLabelText('contextPanel.localModel.rebuildIndex'))
  expect(mockSelfTest).not.toHaveBeenCalled()
  expect(mockRebuild).not.toHaveBeenCalled()
  await act(async () => { mockRemove({ data: { action: { type: 'GO_BACK' } } }) })
  expect(mockConfirm).not.toHaveBeenCalled()
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish() })
  expect(mockNotice).not.toHaveBeenCalled()
  await act(async () => { run() })
  expect(port).toHaveBeenCalledTimes(1)
  await act(async () => { readback([]) })
  expect(mockNotice).toHaveBeenCalledTimes(1)
  expect(mockDiagnosticsProps.ragEvaluating).toBe(false)
})

it.each(['evaluation', 'cache'] as const)('rejects stale %s callbacks while rebuilding and after unmount', async kind => {
  let finish!: () => void
  mockRebuild.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<Page />)
  const run = kind === 'evaluation' ? mockDiagnosticsProps.onRunRagEvaluation : mockImportPresses['contextPanel.clearRagCache']
  await fireEvent.press(screen.getByLabelText('contextPanel.localModel.rebuildIndex'))
  await act(async () => { run() })
  const port = kind === 'evaluation' ? mockRagEvaluation : mockCacheClear
  expect(port).not.toHaveBeenCalled()
  await act(async () => { finish() })
  await screen.unmount()
  await act(async () => { run() })
  expect(port).not.toHaveBeenCalled()
})

it.each(['evaluation', 'cache'] as const)('aborts owned %s on unmount and suppresses late feedback and readback', async kind => {
  const port = kind === 'evaluation' ? mockRagEvaluation : mockCacheClear
  let finish!: () => void
  port.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(kind === 'evaluation' ? ragRun : undefined) }))
  const screen = await render(<Page />)
  await act(async () => { kind === 'evaluation' ? mockDiagnosticsProps.onRunRagEvaluation() : mockImportPresses['contextPanel.clearRagCache']() })
  const signal = kind === 'evaluation' ? port.mock.calls[0][2]?.signal : port.mock.calls[0][0]?.signal
  expect(signal).toBeDefined()
  await screen.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => { finish() })
  expect(mockNotice).not.toHaveBeenCalled()
  expect(mockDocuments).toHaveBeenCalledTimes(1)
})

it.each(['evaluation', 'cache'] as const)('blocks %s replay after failed acknowledgement readback until explicit reload', async kind => {
  const screen = await render(<Page />)
  mockDocuments.mockRejectedValueOnce(new Error('Readback unavailable'))
  const run = kind === 'evaluation' ? mockDiagnosticsProps.onRunRagEvaluation : mockImportPresses['contextPanel.clearRagCache']
  await act(async () => { run() })
  expect(mockNotice).not.toHaveBeenCalled()
  expect(screen.getByText('settingsSubsystem.operationReadbackFailed')).toBeTruthy()
  await act(async () => { run(); mockDiagnosticsProps.onRunSelfTest() })
  const port = kind === 'evaluation' ? mockRagEvaluation : mockCacheClear
  expect(port).toHaveBeenCalledTimes(1)
  expect(mockSelfTest).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await act(async () => { run() })
  expect(port).toHaveBeenCalledTimes(2)
})

it.each(['evaluation', 'cache'] as const)('reports %s failure with one partial-state readback and no successful feedback', async kind => {
  const port = kind === 'evaluation' ? mockRagEvaluation : mockCacheClear
  port.mockRejectedValueOnce(new Error('Diagnostic storage failed'))
  const screen = await render(<Page />)
  await act(async () => { kind === 'evaluation' ? mockDiagnosticsProps.onRunRagEvaluation() : mockImportPresses['contextPanel.clearRagCache']() })
  expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy()
  expect(mockDocuments).toHaveBeenCalledTimes(2)
  expect(mockNotice).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'mint' }))
})

it('captures displayed evaluation settings and retires explicit cancellation after acknowledgement', async () => {
  mockSettings.ragProfile = 'balanced'
  let finish!: () => void
  mockRagEvaluation.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(ragRun) }))
  const screen = await render(<Page />)
  await act(async () => { mockDiagnosticsProps.onRunRagEvaluation() })
  mockSettings.ragProfile = 'fast'
  expect(mockRagEvaluation.mock.calls[0][0].ragProfile).toBe('balanced')
  const cancel = mockImportPresses['contextPanel.cancelRagEvaluation']
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish() })
  expect(screen.queryByRole('button', { name: 'contextPanel.cancelRagEvaluation' })).toBeNull()
  await act(async () => { cancel() })
  expect(mockRagEvaluation.mock.calls[0][2].signal.aborted).toBe(false)
  await act(async () => { readback([]) })
})

it('holds explicit evaluation cancellation through settlement/readback without admitting a replacement', async () => {
  let finish!: () => void
  mockRagEvaluation.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(ragRun) }))
  const screen = await render(<Page />)
  const run = mockDiagnosticsProps.onRunRagEvaluation
  await act(async () => { run() })
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.cancelRagEvaluation' }))
  expect(mockRagEvaluation.mock.calls[0][2].signal.aborted).toBe(true)
  expect(screen.getByRole('button', { name: 'contextPanel.cancellingRagEvaluation' })).toBeDisabled()
  await act(async () => { run() })
  expect(mockRagEvaluation).toHaveBeenCalledTimes(1)
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish() })
  expect(mockDiagnosticsProps.ragEvaluating).toBe(true)
  await act(async () => { readback([]) })
  expect(mockDiagnosticsProps.ragEvaluating).toBe(false)
  expect(mockDiagnosticsProps.ragEvaluation).toBeNull()
  expect(mockNotice).not.toHaveBeenCalled()
  expect(screen.getByText('contextPanel.ragEvaluationCancelled')).toBeTruthy()
})

it.each(['evaluation', 'cache'] as const)('requires explicit reload after superseded %s acknowledgement readback', async kind => {
  const screen = await render(<Page />)
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  const run = kind === 'evaluation' ? mockDiagnosticsProps.onRunRagEvaluation : mockImportPresses['contextPanel.clearRagCache']
  await act(async () => { run() })
  mockCatalogKeyGetter = jest.fn(async () => '')
  await screen.rerender(<Page />)
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(3))
  await act(async () => { readback([]) })
  expect(mockNotice).not.toHaveBeenCalled()
  expect(mockDiagnosticsProps.ragEvaluationBlocked).toBe(true)
  await act(async () => { run() })
  const port = kind === 'evaluation' ? mockRagEvaluation : mockCacheClear
  expect(port).toHaveBeenCalledTimes(1)
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await act(async () => { run() })
  expect(port).toHaveBeenCalledTimes(2)
})

it('blocks cancelled evaluation after failed readback and preserves failure after cancellation', async () => {
  let fail!: () => void
  mockRagEvaluation.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = () => reject(new Error('Admitted log failed')) }))
  const screen = await render(<Page />)
  await act(async () => { mockDiagnosticsProps.onRunRagEvaluation() })
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.cancelRagEvaluation' }))
  mockDocuments.mockRejectedValueOnce(new Error('Readback failed'))
  await act(async () => { fail() })
  expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy()
  expect(mockDocuments).toHaveBeenCalledTimes(2)
  await act(async () => { mockDiagnosticsProps.onRunRagEvaluation(); mockDiagnosticsProps.onRunSelfTest() })
  expect(mockRagEvaluation).toHaveBeenCalledTimes(1)
  expect(mockSelfTest).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await act(async () => { mockDiagnosticsProps.onRunRagEvaluation() })
  expect(mockRagEvaluation).toHaveBeenCalledTimes(2)
})

it('does not let an older evaluation cancel callback cancel a replacement', async () => {
  const screen = await render(<Page />)
  let finish!: () => void
  mockRagEvaluation.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(ragRun) }))
  await act(async () => { mockDiagnosticsProps.onRunRagEvaluation() })
  const cancel = mockImportPresses['contextPanel.cancelRagEvaluation']
  await act(async () => { finish() })
  mockRagEvaluation.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(ragRun) }))
  await act(async () => { mockDiagnosticsProps.onRunRagEvaluation(); cancel() })
  expect(mockRagEvaluation.mock.calls[1][2].signal.aborted).toBe(false)
  await act(async () => { finish() })
  expect(mockNotice).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('contextPanel.ragEvaluationCancelled')).toBeNull()
})

it('keeps cache clearing disabled through readback and explicitly clears native busy after completion', async () => {
  let finish!: () => void
  mockCacheClear.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<Page />)
  await fireEvent.press(screen.getByLabelText('contextPanel.clearRagCache'))
  expect(screen.getByLabelText('contextPanel.clearRagCache').props.accessibilityState.busy).toBe(true)
  expect(screen.getByLabelText('contextPanel.clearRagCache')).toBeDisabled()
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish() })
  expect(screen.getByLabelText('contextPanel.clearRagCache').props.accessibilityState.busy).toBe(true)
  await act(async () => { readback([]) })
  expect(screen.getByLabelText('contextPanel.clearRagCache').props.accessibilityState.busy).toBe(false)
  expect(screen.getByLabelText('contextPanel.clearRagCache')).not.toBeDisabled()
})

it('serializes self-test writes and holds settings busy through successful saved-state readback', async () => {
  let finish!: () => void
  mockSelfTest.mockImplementationOnce(() => new Promise(resolve => {
    finish = () => resolve({ steps: [], ok: 1, warn: 0, fail: 0 })
  }))
  const screen = await render(<Page />)
  const run = mockDiagnosticsProps.onRunSelfTest
  await act(async () => { run(); run() })
  expect(mockSelfTest).toHaveBeenCalledTimes(1)
  expect(mockDiagnosticsProps.selfTesting).toBe(true)
  await fireEvent.press(screen.getByLabelText('contextPanel.localModel.rebuildIndex'))
  expect(mockRebuild).not.toHaveBeenCalled()
  await act(async () => { mockRemove({ data: { action: { type: 'GO_BACK' } } }) })
  expect(mockConfirm).not.toHaveBeenCalled()
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish() })
  expect(mockNotice).not.toHaveBeenCalled()
  expect(mockDiagnosticsProps.selfTesting).toBe(true)
  await act(async () => { run() })
  expect(mockSelfTest).toHaveBeenCalledTimes(1)
  await act(async () => { readback([]) })
  expect(mockNotice).toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.selfTest.done' }))
  expect(mockDiagnosticsProps.selfTesting).toBe(false)
})

it('does not start a self-test while index rebuilding owns the asset mutex', async () => {
  let finish!: () => void
  mockRebuild.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<Page />)
  await fireEvent.press(screen.getByLabelText('contextPanel.localModel.rebuildIndex'))
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  expect(mockSelfTest).not.toHaveBeenCalled()
  expect(mockDiagnosticsProps.selfTestBlocked).toBe(true)
  await act(async () => { finish() })
})

it('retires self-test admission after unmount and preserves the displayed settings snapshot', async () => {
  mockSettings.embeddingMode = 'local'
  let admit!: () => void
  mockPrimaryProvider.mockImplementationOnce(() => new Promise<undefined>(resolve => { admit = () => resolve(undefined) }))
  const screen = await render(<Page />)
  const run = mockDiagnosticsProps.onRunSelfTest
  await act(async () => { run() })
  mockSettings.embeddingMode = 'provider'
  await screen.unmount()
  await act(async () => { admit(); run() })
  expect(mockSelfTest).not.toHaveBeenCalled()
  expect(mockNotice).not.toHaveBeenCalled()
})

it('captures self-test settings before delayed provider admission and ignores old step callbacks after completion', async () => {
  mockSettings.embeddingMode = 'local'
  let admit!: () => void
  mockPrimaryProvider.mockImplementationOnce(() => new Promise<undefined>(resolve => { admit = () => resolve(undefined) }))
  await render(<Page />)
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  mockSettings.embeddingMode = 'provider'
  await act(async () => { admit() })
  expect(mockSelfTest.mock.calls[0][0].settings.embeddingMode).toBe('local')
  const before = mockDiagnosticsProps.selfTestResult
  await act(async () => { mockSelfTest.mock.calls[0][0].onStep({ name: 'Stale step', status: 'ok', detail: 'Old' }) })
  expect(mockDiagnosticsProps.selfTestResult).toBe(before)
})

it('cancels self-test before provider admission without starting the service or admitting a replacement', async () => {
  let admit!: () => void
  mockPrimaryProvider.mockImplementationOnce(() => new Promise<undefined>(resolve => { admit = () => resolve(undefined) }))
  const screen = await render(<Page />)
  const run = mockDiagnosticsProps.onRunSelfTest
  await act(async () => { run() })
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.cancelSelfTest' }))
  await act(async () => { run() })
  expect(mockSelfTest).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'contextPanel.cancellingSelfTest' })).toBeDisabled()
  await act(async () => { admit() })
  expect(mockSelfTest).not.toHaveBeenCalled()
  expect(screen.getByText('contextPanel.selfTestCancelled')).toBeTruthy()
  expect(mockDiagnosticsProps.selfTesting).toBe(false)
  expect(mockNotice).not.toHaveBeenCalled()
})

it('cancels self-test through service cleanup and one readback without accepting stale progress', async () => {
  let finish!: (result: unknown) => void
  mockSelfTest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const screen = await render(<Page />)
  const run = mockDiagnosticsProps.onRunSelfTest
  await act(async () => { run() })
  const input = mockSelfTest.mock.calls[0][0]
  await act(async () => { input.onStep({ name: 'Owned step', status: 'ok', detail: 'Current' }) })
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.cancelSelfTest' }))
  expect(input.signal.aborted).toBe(true)
  const retained = mockDiagnosticsProps.selfTestResult
  await act(async () => { input.onStep({ name: 'Late cancelled step', status: 'ok', detail: 'Ignore' }); run() })
  expect(mockDiagnosticsProps.selfTestResult).toBe(retained)
  expect(mockDocuments).toHaveBeenCalledTimes(1)
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish({ steps: [], ok: 1, warn: 0, fail: 0 }) })
  expect(mockDiagnosticsProps.selfTesting).toBe(true)
  expect(mockNotice).not.toHaveBeenCalled()
  await act(async () => { readback([]) })
  expect(mockDiagnosticsProps.selfTesting).toBe(false)
  expect(screen.getByText('contextPanel.selfTestCancelled')).toBeTruthy()
})

it.each(['failed', 'superseded'] as const)('requires explicit list reload after %s self-test acknowledgement readback', async mode => {
  const screen = await render(<Page />)
  let readback!: (documents: KnowledgeDocument[]) => void
  if (mode === 'failed') mockDocuments.mockRejectedValueOnce(new Error('Readback unavailable'))
  else mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  if (mode === 'superseded') {
    mockCatalogKeyGetter = jest.fn(async () => '')
    await screen.rerender(<Page />)
    await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(3))
    await act(async () => { readback([]) })
  }
  expect(mockNotice).not.toHaveBeenCalled()
  expect(mockDiagnosticsProps.selfTestBlocked).toBe(true)
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  expect(mockSelfTest).toHaveBeenCalledTimes(1)
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  expect(mockSelfTest).toHaveBeenCalledTimes(2)
})

it('keeps self-test cleanup failure visible after cancellation and reloads only once', async () => {
  let fail!: () => void
  mockSelfTest.mockImplementationOnce(() => new Promise((_resolve, reject) => {
    fail = () => reject(Object.assign(new Error('Cleanup failed'), { name: 'ContextSelfTestCleanupError' }))
  }))
  const screen = await render(<Page />)
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.cancelSelfTest' }))
  mockDocuments.mockRejectedValueOnce(new Error('Readback unavailable'))
  await act(async () => { fail() })
  expect(mockDocuments).toHaveBeenCalledTimes(2)
  expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy()
  expect(screen.getByText('settingsSubsystem.loadFailed')).toBeTruthy()
  expect(mockDiagnosticsProps.selfTestBlocked).toBe(true)
  expect(mockNotice).not.toHaveBeenCalled()
})

it('retires a self-test controller and all callbacks after unmount', async () => {
  let finish!: (result: unknown) => void
  mockSelfTest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const screen = await render(<Page />)
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  const input = mockSelfTest.mock.calls[0][0]
  await screen.unmount()
  expect(input.signal.aborted).toBe(true)
  await act(async () => {
    input.onStep({ name: 'Retired step', status: 'ok', detail: 'Ignore' })
    finish({ steps: [], ok: 1, warn: 0, fail: 0 })
  })
  expect(mockDocuments).toHaveBeenCalledTimes(1)
  expect(mockNotice).not.toHaveBeenCalled()
})

it('retires old self-test cancel and progress callbacks when a newer run is active', async () => {
  let first!: (result: unknown) => void, second!: (result: unknown) => void
  mockSelfTest.mockImplementationOnce(() => new Promise(resolve => { first = resolve }))
    .mockImplementationOnce(() => new Promise(resolve => { second = resolve }))
  await render(<Page />)
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  const earlier = mockSelfTest.mock.calls[0][0], cancel = mockImportPresses['contextPanel.cancelSelfTest']
  await act(async () => { first({ steps: [], ok: 1, warn: 0, fail: 0 }) })
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  const current = mockSelfTest.mock.calls[1][0], before = mockDiagnosticsProps.selfTestResult
  await act(async () => { cancel(); earlier.onStep({ name: 'Old', status: 'ok', detail: 'Ignore' }) })
  expect(current.signal.aborted).toBe(false)
  expect(mockDiagnosticsProps.selfTestResult).toBe(before)
  await act(async () => { second({ steps: [], ok: 1, warn: 0, fail: 0 }) })
  expect(mockNotice).toHaveBeenCalledTimes(2)
})

it('retires self-test cancellation after service acknowledgement enters readback', async () => {
  let finish!: (result: unknown) => void
  mockSelfTest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const screen = await render(<Page />)
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  const input = mockSelfTest.mock.calls[0][0], cancel = mockImportPresses['contextPanel.cancelSelfTest']
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish({ steps: [], ok: 1, warn: 0, fail: 0 }) })
  expect(screen.queryByLabelText('contextPanel.cancelSelfTest')).toBeNull()
  await act(async () => { cancel() })
  expect(input.signal.aborted).toBe(false)
  await act(async () => { readback([]) })
  expect(mockNotice).toHaveBeenCalledTimes(1)
})

it.each(['failed', 'superseded'] as const)('keeps mutations blocked after %s cancelled self-test readback until explicit reload', async mode => {
  let finish!: (result: unknown) => void
  mockSelfTest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  mockMemories = [reviewedMemory()]
  const screen = await render(<Page />)
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.cancelSelfTest' }))
  let readback!: (documents: KnowledgeDocument[]) => void
  if (mode === 'failed') mockDocuments.mockRejectedValueOnce(new Error('Readback unavailable'))
  else mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish({ steps: [], ok: 1, warn: 0, fail: 0 }) })
  if (mode === 'superseded') {
    mockCatalogKeyGetter = jest.fn(async () => '')
    await screen.rerender(<Page />)
    await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(3))
    await act(async () => { readback([]) })
  }
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  await fireEvent.press(screen.getByLabelText('contextPanel.localModel.rebuildIndex'))
  expect(mockSelfTest).toHaveBeenCalledTimes(1)
  expect(mockRebuild).not.toHaveBeenCalled()
  expect(mockDiagnosticsProps.selfTestBlocked).toBe(true)
  expect(mockNotice).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  expect(mockSelfTest).toHaveBeenCalledTimes(2)
})

it('contains a self-test exception, reads saved partial state once and permits a subsequent retry', async () => {
  mockSelfTest.mockRejectedValueOnce(new Error('Scenario unavailable'))
  const screen = await render(<Page />)
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy()
  expect(mockDiagnosticsProps.selfTestResult.steps[0].status).toBe('fail')
  expect(mockDocuments).toHaveBeenCalledTimes(2)
  expect(mockNotice).not.toHaveBeenCalled()
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  expect(mockSelfTest).toHaveBeenCalledTimes(2)
  expect(mockNotice).toHaveBeenCalledTimes(1)
})

it('retires cancelled self-test readback and all retained actions after unmount', async () => {
  let finish!: (result: unknown) => void
  mockSelfTest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const screen = await render(<Page />)
  const run = mockDiagnosticsProps.onRunSelfTest
  await act(async () => { run() })
  const cancel = mockImportPresses['contextPanel.cancelSelfTest']
  await act(async () => { cancel() })
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish({ steps: [], ok: 1, warn: 0, fail: 0 }) })
  await screen.unmount()
  await act(async () => { readback([]); cancel(); run() })
  expect(mockDocuments).toHaveBeenCalledTimes(2)
  expect(mockSelfTest).toHaveBeenCalledTimes(1)
  expect(mockNotice).not.toHaveBeenCalled()
})

it('holds the recovery mutex through saved-state readback and prevents retained duplicate and import callbacks', async () => {
  const document = { ...reviewedDocument(), status: 'error' as const }
  mockDocuments.mockResolvedValue([document])
  let finish!: () => void
  mockRebuild.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  const retained = mockImportPresses['contextPanel.knowledgeRecoveryRebuild']
  await act(async () => { retained(); retained() })
  expect(mockRebuild).toHaveBeenCalledTimes(1)
  expect(mockRebuild.mock.calls[0][1]).toEqual({
    signal: expect.any(AbortSignal), expectedDocuments: [document],
  })
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' }))
  expect(mockImportFile).not.toHaveBeenCalled()
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish() })
  expect(mockNotice).not.toHaveBeenCalled()
  await act(async () => { retained() })
  expect(mockRebuild).toHaveBeenCalledTimes(1)
  await act(async () => { readback([reviewedDocument()]) })
  expect(mockNotice).toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.localModel.rebuildDone' }))
})

it('retires recovery during provider admission without starting index work or feedback', async () => {
  mockDocuments.mockResolvedValue([{ ...reviewedDocument(), status: 'error' }])
  let admit!: () => void
  mockPrimaryProvider.mockImplementationOnce(() => new Promise<undefined>(resolve => { admit = () => resolve(undefined) }))
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  const retained = mockImportPresses['contextPanel.knowledgeRecoveryRebuild']
  await act(async () => { retained() })
  await screen.unmount()
  await act(async () => { admit(); retained() })
  expect(mockRebuild).not.toHaveBeenCalled()
  expect(mockNotice).not.toHaveBeenCalled()
})

it('aborts an unmounted recovery signal and suppresses later readback and success', async () => {
  mockDocuments.mockResolvedValue([{ ...reviewedDocument(), status: 'error' }])
  let finish!: () => void
  mockRebuild.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  await act(async () => { mockImportPresses['contextPanel.knowledgeRecoveryRebuild']() })
  const signal = mockRebuild.mock.calls[0][1]?.signal as AbortSignal
  expect(signal).toBeInstanceOf(AbortSignal)
  await screen.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => { finish() })
  expect(mockDocuments).toHaveBeenCalledTimes(1)
  expect(mockNotice).not.toHaveBeenCalled()
})

it('requires an explicit successful list reload before repeating acknowledged recovery with failed readback', async () => {
  mockDocuments.mockResolvedValue([{ ...reviewedDocument(), status: 'error' }])
  mockRebuild.mockImplementationOnce(async () => { mockDocuments.mockRejectedValueOnce(new Error('readback unavailable')); return 1 })
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  const retained = mockImportPresses['contextPanel.knowledgeRecoveryRebuild']
  await act(async () => { retained() })
  expect(screen.getAllByRole('alert').some(node => node.props.children === 'settingsSubsystem.operationReadbackFailed')).toBe(true)
  expect(mockNotice).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.localModel.rebuildDone' }))
  await act(async () => { retained() })
  expect(mockRebuild).toHaveBeenCalledTimes(1)
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await fireEvent.press(screen.getByLabelText('contextPanel.knowledgeRecoveryRebuild'))
  await waitFor(() => expect(mockRebuild).toHaveBeenCalledTimes(2))
})

it('shows interrupted nonempty documents in the recovery entry without claiming empty text can be rebuilt', async () => {
  mockDocuments.mockResolvedValue([{ ...reviewedDocument(), status: 'extracting' }])
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  expect(screen.getByLabelText('contextPanel.knowledgeRecoveryRebuild')).toBeTruthy()
  expect(screen.getByText('contextPanel.knowledgeRecoverySourceHint')).toBeTruthy()
})

it('retains explicit recovery readback retry when a different successful read supersedes it', async () => {
  const document = { ...reviewedDocument(), status: 'error' as const }
  mockDocuments.mockResolvedValue([document])
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { mockImportPresses['contextPanel.knowledgeRecoveryRebuild']() })
  mockCatalogKeyGetter = jest.fn(async () => '')
  await screen.rerender(<ContextPanel providers={[]} section="knowledge" />)
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(3))
  await act(async () => { readback([document]) })
  const retained = mockImportPresses['contextPanel.knowledgeRecoveryRebuild']
  await act(async () => { retained() })
  expect(mockRebuild).toHaveBeenCalledTimes(1)
  expect(mockNotice).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await act(async () => { mockImportPresses['contextPanel.knowledgeRecoveryRebuild']() })
  expect(mockRebuild).toHaveBeenCalledTimes(2)
})

it('contains recovery failure, reloads partial saved state, and allows an explicit retry', async () => {
  mockDocuments.mockResolvedValue([{ ...reviewedDocument(), status: 'error' }])
  mockRebuild.mockRejectedValueOnce(new KnowledgeRepositoryConflictError())
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  await act(async () => { mockImportPresses['contextPanel.knowledgeRecoveryRebuild']() })
  expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.conflict')
  expect(mockDocuments).toHaveBeenCalledTimes(2)
  expect(mockNotice).not.toHaveBeenCalled()
  await act(async () => { mockImportPresses['contextPanel.knowledgeRecoveryRebuild']() })
  expect(mockRebuild).toHaveBeenCalledTimes(2)
  expect(mockNotice).toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.localModel.rebuildDone' }))
})

it('captures the displayed local model selection before delayed recovery provider admission', async () => {
  mockSettings.localEmbeddingModelId = 'reviewed-model'
  mockSettings.embeddingMode = 'local'
  mockDocuments.mockResolvedValue([{ ...reviewedDocument(), status: 'error' }])
  let admit!: () => void
  mockPrimaryProvider.mockImplementationOnce(() => new Promise<undefined>(resolve => { admit = () => resolve(undefined) }))
  await render(<ContextPanel providers={[]} section="knowledge" />)
  await act(async () => { mockImportPresses['contextPanel.knowledgeRecoveryRebuild']() })
  mockSettings.localEmbeddingModelId = 'unreviewed-model'
  await act(async () => { admit() })
  expect(mockRebuild.mock.calls[0][0].localEmbeddingModelId).toBe('reviewed-model')
})

it('binds file-import provider selection and index options to displayed settings before admission waits', async () => {
  let admit!: () => void
  mockPrimaryProvider.mockImplementationOnce(() => new Promise<undefined>(resolve => { admit = () => resolve(undefined) }))
  mockSettings.embeddingMode = 'local'; mockSettings.localEmbeddingModelId = 'reviewed-local'
  const providers = [{ id: 'reviewed-provider', baseUrl: 'https://reviewed.invalid/v1' }] as AIProvider[]
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={providers} section="knowledge" /></SettingsEditBoundary>)
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(1))
  await fireEvent.press(screen.getByLabelText('contextPanel.importKnowledgeFile'))
  mockSettings.embeddingMode = 'provider'; mockSettings.localEmbeddingModelId = 'changed-local'
  providers[0].baseUrl = 'https://changed.invalid/v1'
  await act(async () => { admit() })
  expect(mockPrimaryProvider.mock.calls[0][0]).toMatchObject({
    settings: { embeddingMode: 'local', localEmbeddingModelId: 'reviewed-local' },
    providers: [{ baseUrl: 'https://reviewed.invalid/v1' }], signal: expect.any(AbortSignal),
  })
  expect(mockImportFile.mock.calls[0][2]).toMatchObject({
    settings: { embeddingMode: 'local', localEmbeddingModelId: 'reviewed-local' },
    signal: (mockPrimaryProvider.mock.calls[0][0] as { signal: AbortSignal }).signal,
  })
  await screen.unmount()
})

it('uses the displayed self-test default and provider catalog for its cancellable selection admission', async () => {
  mockSettings.defaultProvider = 'reviewed-provider'
  const providers = [{ id: 'reviewed-provider', baseUrl: 'https://reviewed.invalid/v1' }] as AIProvider[]
  const screen = await render(<SettingsEditBoundary><SettingsSectionContext.Provider value={{ target: 'local-model-mirror', register: () => undefined }}><ContextPanel providers={providers} section="context" /></SettingsSectionContext.Provider></SettingsEditBoundary>)
  await act(async () => { mockDiagnosticsProps.onRunSelfTest() })
  expect(mockPrimaryProvider.mock.calls[0][0]).toMatchObject({
    settings: { defaultProvider: 'reviewed-provider' }, providers: [{ id: 'reviewed-provider' }],
    signal: mockSelfTest.mock.calls[0][0].signal,
  })
  await screen.unmount()
})

it('uses one reviewed settings snapshot for recovery indexing and primary-provider policy admission', async () => {
  mockSettings.defaultProvider = 'reviewed-provider'; mockSettings.embeddingMode = 'local'
  mockDocuments.mockResolvedValue([{ ...reviewedDocument(), status: 'error' }])
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  await act(async () => { mockImportPresses['contextPanel.knowledgeRecoveryRebuild']() })
  expect(mockPrimaryProvider.mock.calls[0][0]).toMatchObject({
    settings: { defaultProvider: 'reviewed-provider', embeddingMode: 'local' }, providers: [],
    signal: mockRebuild.mock.calls[0][1].signal,
  })
  expect(mockRebuild.mock.calls[0][0].embeddingMode).toBe('local')
  await screen.unmount()
})

it('cancels recovery without releasing the asset mutex before adapter settlement and durable readback', async () => {
  const document = { ...reviewedDocument(), status: 'error' as const }
  mockDocuments.mockResolvedValue([document])
  let finish!: () => void
  mockRebuild.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  const rebuild = mockImportPresses['contextPanel.knowledgeRecoveryRebuild']
  await act(async () => { rebuild() })
  const signal = mockRebuild.mock.calls[0][1].signal
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.cancelKnowledgeRebuild' }))
  expect(signal.aborted).toBe(true)
  expect(screen.getByRole('button', { name: 'contextPanel.cancellingKnowledgeRebuild' })).toBeDisabled()
  await act(async () => { rebuild() })
  await fireEvent.press(screen.getByLabelText('contextPanel.importKnowledgeFile'))
  expect(mockImportFile).not.toHaveBeenCalled()
  expect(mockRebuild).toHaveBeenCalledTimes(1)
  expect(mockDocuments).toHaveBeenCalledTimes(1)
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish() })
  expect(mockDocuments).toHaveBeenCalledTimes(2)
  expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).toBeDisabled()
  expect(mockNotice).not.toHaveBeenCalled()
  await act(async () => { readback([{ ...document, status: 'ready' }]) })
  expect(screen.getByText('contextPanel.knowledgeRebuildCancelled')).toBeTruthy()
  expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).not.toBeDisabled()
  expect(mockNotice).not.toHaveBeenCalled()
})

it('cancels recovery before provider admission without starting indexing and retires repeated cancel presses', async () => {
  mockDocuments.mockResolvedValue([{ ...reviewedDocument(), status: 'error' }])
  let admit!: () => void
  mockPrimaryProvider.mockImplementationOnce(() => new Promise<undefined>(resolve => { admit = () => resolve(undefined) }))
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  await act(async () => { mockImportPresses['contextPanel.knowledgeRecoveryRebuild']() })
  const cancel = mockImportPresses['contextPanel.cancelKnowledgeRebuild']
  await act(async () => { cancel(); cancel() })
  expect(mockRebuild).not.toHaveBeenCalled()
  await act(async () => { admit() })
  expect(mockRebuild).not.toHaveBeenCalled()
  expect(mockDocuments).toHaveBeenCalledTimes(2)
  expect(screen.getByText('contextPanel.knowledgeRebuildCancelled')).toBeTruthy()
  expect(mockNotice).not.toHaveBeenCalled()
})

it('does not let an earlier recovery cancel callback stop a newer rebuild', async () => {
  mockDocuments.mockResolvedValue([{ ...reviewedDocument(), status: 'error' }])
  let first!: () => void, second!: () => void
  mockRebuild.mockImplementationOnce(() => new Promise<void>(resolve => { first = resolve }))
    .mockImplementationOnce(() => new Promise<void>(resolve => { second = resolve }))
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  await act(async () => { mockImportPresses['contextPanel.knowledgeRecoveryRebuild']() })
  const earlierCancel = mockImportPresses['contextPanel.cancelKnowledgeRebuild']
  await act(async () => { first() })
  await act(async () => { mockImportPresses['contextPanel.knowledgeRecoveryRebuild']() })
  const signal = mockRebuild.mock.calls[1][1].signal
  await act(async () => { earlierCancel() })
  expect(signal.aborted).toBe(false)
  expect(screen.getByRole('button', { name: 'contextPanel.cancelKnowledgeRebuild' })).not.toBeDisabled()
  await act(async () => { mockImportPresses['contextPanel.cancelKnowledgeRebuild']() })
  expect(signal.aborted).toBe(true)
  await act(async () => { second() })
  expect(mockNotice).toHaveBeenCalledTimes(1)
})

it('retires explicit recovery cancellation when acknowledgement has entered saved-state readback', async () => {
  mockDocuments.mockResolvedValue([{ ...reviewedDocument(), status: 'error' }])
  let finish!: () => void
  mockRebuild.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  await act(async () => { mockImportPresses['contextPanel.knowledgeRecoveryRebuild']() })
  const cancel = mockImportPresses['contextPanel.cancelKnowledgeRebuild']
  const signal = mockRebuild.mock.calls[0][1].signal
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish() })
  expect(screen.queryByLabelText('contextPanel.cancelKnowledgeRebuild')).toBeNull()
  await act(async () => { cancel() })
  expect(signal.aborted).toBe(false)
  await act(async () => { readback([reviewedDocument()]) })
  expect(mockNotice).toHaveBeenCalledTimes(1)
})

it.each(['failed', 'superseded'] as const)('requires explicit reload after %s cancelled recovery readback', async mode => {
  const document = { ...reviewedDocument(), status: 'error' as const }
  mockDocuments.mockResolvedValue([document])
  let finish!: () => void
  mockRebuild.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  const rebuild = mockImportPresses['contextPanel.knowledgeRecoveryRebuild']
  await act(async () => { rebuild() })
  await act(async () => { mockImportPresses['contextPanel.cancelKnowledgeRebuild']() })
  let readback!: (documents: KnowledgeDocument[]) => void
  if (mode === 'failed') mockDocuments.mockRejectedValueOnce(new Error('Readback unavailable'))
  else mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish() })
  if (mode === 'superseded') {
    mockCatalogKeyGetter = jest.fn(async () => '')
    await screen.rerender(<ContextPanel providers={[]} section="knowledge" />)
    await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(3))
    await act(async () => { readback([document]) })
  }
  expect(screen.getByText('contextPanel.knowledgeRebuildCancelled')).toBeTruthy()
  expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).toBeDisabled()
  await act(async () => { rebuild() })
  expect(mockRebuild).toHaveBeenCalledTimes(1)
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).not.toBeDisabled()
  await act(async () => { mockImportPresses['contextPanel.knowledgeRecoveryRebuild']() })
  expect(mockRebuild).toHaveBeenCalledTimes(2)
})

it('keeps recovery cancellation outside a folded local-model editor', async () => {
  let finish!: () => void
  mockRebuild.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<Page />)
  await fireEvent.press(screen.getByLabelText('contextPanel.localModel.rebuildIndex'))
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.localModel.title\./ }))
  expect(screen.queryByLabelText('contextPanel.localModel.rebuildIndex')).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.cancelKnowledgeRebuild' }))
  expect(mockRebuild.mock.calls[0][1].signal.aborted).toBe(true)
  await act(async () => { finish() })
  expect(screen.getByText('contextPanel.knowledgeRebuildCancelled')).toBeTruthy()
})

it('suppresses cancelled recovery feedback and retained cancel callbacks after unmount', async () => {
  mockDocuments.mockResolvedValue([{ ...reviewedDocument(), status: 'error' }])
  let finish!: () => void
  mockRebuild.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  await act(async () => { mockImportPresses['contextPanel.knowledgeRecoveryRebuild']() })
  const cancel = mockImportPresses['contextPanel.cancelKnowledgeRebuild']
  await act(async () => { cancel() })
  await screen.unmount()
  await act(async () => { cancel(); finish() })
  expect(mockDocuments).toHaveBeenCalledTimes(1)
  expect(mockNotice).not.toHaveBeenCalled()
})

it('does not hide a failed derived-index repair behind the recovery cancelled status', async () => {
  mockDocuments.mockResolvedValue([{ ...reviewedDocument(), status: 'error' }])
  let fail!: () => void
  mockRebuild.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
    fail = () => reject(new AggregateError([new Error('cancelled'), new Error('repair failed')], 'Recovery repair failed'))
  }))
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  await act(async () => { mockImportPresses['contextPanel.knowledgeRecoveryRebuild']() })
  await act(async () => { mockImportPresses['contextPanel.cancelKnowledgeRebuild']() })
  await act(async () => { fail() })
  expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy()
  expect(screen.getByText('contextPanel.knowledgeRebuildCancelled')).toBeTruthy()
  expect(mockNotice).not.toHaveBeenCalled()
})

it('keeps settings traversal busy while a cancelled rebuild and its readback are still outstanding', async () => {
  mockDocuments.mockResolvedValue([{ ...reviewedDocument(), status: 'error' }])
  let finish!: () => void
  mockRebuild.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.pasteTextKnowledge\./ }))
  await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Retained unsaved text')
  await act(async () => { mockImportPresses['contextPanel.knowledgeRecoveryRebuild']() })
  await act(async () => { mockImportPresses['contextPanel.cancelKnowledgeRebuild']() })
  await act(async () => { mockRemove({ data: { action: { type: 'GO_BACK' } } }) })
  expect(mockConfirm).not.toHaveBeenCalled()
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe('Retained unsaved text')
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish() })
  await act(async () => { mockRemove({ data: { action: { type: 'GO_BACK' } } }) })
  expect(mockConfirm).not.toHaveBeenCalled()
  await act(async () => { readback([reviewedDocument()]) })
  mockConfirm.mockResolvedValueOnce(false)
  await act(async () => { mockRemove({ data: { action: { type: 'GO_BACK' } } }) })
  expect(mockConfirm).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe('Retained unsaved text')
})

it('requires reload after cancelled repair failure and failed readback without an implicit second refresh', async () => {
  mockDocuments.mockResolvedValue([{ ...reviewedDocument(), status: 'error' }])
  let fail!: () => void
  mockRebuild.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
    fail = () => reject(new AggregateError([new Error('cancelled'), new Error('repair failed')], 'Recovery repair failed'))
  }))
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  const rebuild = mockImportPresses['contextPanel.knowledgeRecoveryRebuild']
  await act(async () => { rebuild() })
  await act(async () => { mockImportPresses['contextPanel.cancelKnowledgeRebuild']() })
  mockDocuments.mockRejectedValueOnce(new Error('Cancellation readback failed'))
  await act(async () => { fail() })
  expect(mockDocuments).toHaveBeenCalledTimes(2)
  expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy()
  expect(screen.getByText('settingsSubsystem.loadFailed')).toBeTruthy()
  expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).toBeDisabled()
  await act(async () => { rebuild() })
  expect(mockRebuild).toHaveBeenCalledTimes(1)
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).not.toBeDisabled()
  expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy()
})

it('retires an outstanding cancelled rebuild readback after unmount without feedback or reopening writes', async () => {
  mockDocuments.mockResolvedValue([{ ...reviewedDocument(), status: 'error' }])
  let finish!: () => void
  mockRebuild.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<ContextPanel providers={[]} section="knowledge" />)
  const rebuild = mockImportPresses['contextPanel.knowledgeRecoveryRebuild']
  await act(async () => { rebuild() })
  const cancel = mockImportPresses['contextPanel.cancelKnowledgeRebuild']
  await act(async () => { cancel() })
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish() })
  expect(mockDocuments).toHaveBeenCalledTimes(2)
  await screen.unmount()
  await act(async () => { readback([reviewedDocument()]); cancel(); rebuild() })
  expect(mockDocuments).toHaveBeenCalledTimes(2)
  expect(mockRebuild).toHaveBeenCalledTimes(1)
  expect(mockNotice).not.toHaveBeenCalled()
  expect(mockToast).not.toHaveBeenCalled()
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

it.each(['file', 'text'] as const)('contains %s import failures, retains drafts, and allows an explicit retry', async kind => {
  const operation = kind === 'file' ? mockImportFile : mockImportPlainText
  operation.mockRejectedValueOnce(new Error('The document text is invalid.'))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.pasteTextKnowledge\./ }))
  await fireEvent.changeText(screen.getByLabelText('contextPanel.knowledgeTitle'), 'Retained title')
  await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Retained text')
  const button = () => screen.getByRole('button', { name: kind === 'file' ? 'contextPanel.importKnowledgeFile' : 'contextPanel.importPastedText' })
  await fireEvent.press(button())
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('settingsSubsystem.operationFailed'))
  expect(button()).not.toBeDisabled()
  expect(screen.getByLabelText('contextPanel.knowledgeTitle').props.value).toBe('Retained title')
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe('Retained text')
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.knowledgeUpdated' }))
  await fireEvent.press(button())
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.knowledgeUpdated' })))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(operation).toHaveBeenCalledTimes(2)
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe(kind === 'file' ? 'Retained text' : '')
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

it.each(['confirm', 'reject'] as const)('binds pending-memory %s to the record shown before the asynchronous confirmation', async action => {
  const reviewed = {
    schema: 'islemind.knowledge-memory-record.v1', id: 'reviewed', content: 'Reviewed fact',
    status: 'pending', scope: { kind: 'user', id: 'local-user' }, sensitivity: 'normal',
    sourceKind: 'manual', sourceMessageIds: [], createdAt: 1, updatedAt: 1,
  }
  mockMemories = [reviewed]
  let answer!: (value: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve }))
  const operation = action === 'confirm' ? mockMemoryUpdate : mockMemoryDelete
  operation.mockImplementation(async (...args: any[]) => {
    const options = args[action === 'confirm' ? 2 : 1]
    if (options?.expectedMemory?.content !== mockMemories[0].content && options?.expectedMemory) {
      throw new Error('record changed during confirmation')
    }
    mockMemories = action === 'confirm'
      ? [{ ...mockMemories[0], status: 'active' }]
      : []
  })
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="memory" /></SettingsEditBoundary>)
  await act(async () => {
    if (action === 'confirm') mockMemoryProps.onConfirmPendingMemories(mockMemories)
    else mockMemoryProps.onRejectPendingMemories(mockMemories)
  })
  expect(operation).not.toHaveBeenCalled()
  mockMemories = [{ ...reviewed, content: 'Changed while the prompt was open' }]
  await act(async () => { answer(true) })
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('settingsSubsystem.operationFailed'))
  expect(mockMemories).toEqual([{ ...reviewed, content: 'Changed while the prompt was open' }])
  expect(operation).toHaveBeenCalledWith(...(action === 'confirm'
    ? [reviewed.id, 'active', expect.objectContaining({ expectedMemory: reviewed, expectedActiveMemory: null })]
    : [reviewed.id, expect.objectContaining({ expectedMemory: reviewed })]))
  expect(mockMemoryProps.confirmingMemories).toBe(false)
  expect(mockToast).not.toHaveBeenCalled()
})

it.each(['memory', 'knowledge'] as const)('binds a %s clear to the displayed collection and preserves records arriving during the prompt', async section => {
  const reviewed = section === 'memory'
    ? { schema: 'islemind.knowledge-memory-record.v1', id: 'reviewed', content: 'Reviewed fact', status: 'pending', scope: { kind: 'user', id: 'local-user' }, sensitivity: 'normal', sourceKind: 'manual', sourceMessageIds: [], createdAt: 1, updatedAt: 1 }
    : { schema: 'islemind.knowledge-document-record.v1', id: 'reviewed', title: 'Reviewed document', mimeType: 'text/plain', size: 16, chunkCount: 1, status: 'ready', createdAt: 1, updatedAt: 1 }
  const unseen = { ...reviewed, id: 'unseen' }
  let documents = [reviewed]
  if (section === 'memory') mockMemories = [reviewed]
  else mockDocuments.mockImplementation(async () => documents as KnowledgeDocument[])
  const operation = section === 'memory' ? mockMemoryClear : mockDocumentClear
  operation.mockImplementation(async options => {
    const expected = options?.[section === 'memory' ? 'expectedMemories' : 'expectedDocuments']
    if (section === 'memory') mockMemories = expected ? mockMemories.filter(item => !expected.some((target: any) => target.id === item.id)) : []
    else documents = expected ? documents.filter(item => !expected.some((target: any) => target.id === item.id)) : []
  })
  let answer!: (value: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section={section} /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByLabelText('contextPanel.clearTitle'))
  expect(operation).not.toHaveBeenCalled()
  if (section === 'memory') mockMemories = [reviewed, unseen]
  else documents = [reviewed, unseen]
  await act(async () => { answer(true) })
  await waitFor(() => expect(operation).toHaveBeenCalledTimes(1))
  expect(operation).toHaveBeenCalledWith({ [section === 'memory' ? 'expectedMemories' : 'expectedDocuments']: [reviewed], signal: expect.any(AbortSignal) })
  expect(section === 'memory' ? mockMemories : documents).toEqual([unseen])
})

it('binds individual knowledge deletion to the document whose title was confirmed', async () => {
  const reviewed = {
    schema: 'islemind.knowledge-document-record.v1', id: 'reviewed', title: 'Reviewed document',
    mimeType: 'text/plain', size: 16, chunkCount: 1, status: 'ready', createdAt: 1, updatedAt: 1,
  } as const
  mockDocuments.mockResolvedValue([reviewed])
  let answer!: (value: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByLabelText('common.delete'))
  expect(mockDocumentDelete).not.toHaveBeenCalled()
  mockDocuments.mockResolvedValue([{ ...reviewed, title: 'External replacement' }])
  await act(async () => { answer(true) })
  await waitFor(() => expect(mockDocumentDelete).toHaveBeenCalledWith(reviewed.id, { expectedDocument: reviewed, signal: expect.any(AbortSignal) }))
})

it.each(['minimal', 'material', 'monet', 'liquid-glass', 'animal-island-ui'])('locks and resets dangerous confirmations in %s without writing on cancellation', async theme => {
  mockTheme = theme
  mockDocuments.mockResolvedValue([{
    id: 'reviewed', title: 'Reviewed document', mimeType: 'text/plain', size: 16,
    chunkCount: 1, status: 'ready', createdAt: 1, updatedAt: 1,
  }])
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  for (const label of ['contextPanel.clearTitle', 'common.delete']) {
    let answer!: (value: boolean) => void
    mockConfirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve }))
    const before = mockConfirm.mock.calls.length
    await fireEvent.press(screen.getByLabelText(label))
    await fireEvent.press(screen.getByLabelText(label))
    expect(mockConfirm).toHaveBeenCalledTimes(before + 1)
    expect(screen.getByLabelText(label)).toBeDisabled()
    expect(screen.getByLabelText(label).props.accessibilityState.busy).toBe(true)
    await act(async () => { answer(false) })
    expect(screen.getByLabelText(label)).not.toBeDisabled()
    expect(screen.getByLabelText(label).props.accessibilityState.busy).toBe(false)
  }
  expect(mockMemoryUpdate).not.toHaveBeenCalled()
  expect(mockDocumentDelete).not.toHaveBeenCalled()
  expect(mockDocumentClear).not.toHaveBeenCalled()
})

it.each(['contextPanel.clearTitle', 'common.delete'])('fails closed and resets busy state if the %s confirmation cannot finish', async label => {
  mockDocuments.mockResolvedValue([{
    id: 'reviewed', title: 'Reviewed document', mimeType: 'text/plain', size: 16,
    chunkCount: 1, status: 'ready', createdAt: 1, updatedAt: 1,
  }])
  mockConfirm.mockRejectedValueOnce(new Error('dialog unavailable'))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByLabelText(label))
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ title: 'settingsSubsystem.operationFailed', tone: 'amber' }))
  expect(screen.getByLabelText(label)).not.toBeDisabled()
  expect(screen.getByLabelText(label).props.accessibilityState.busy).toBe(false)
  expect(mockDocumentDelete).not.toHaveBeenCalled()
  expect(mockDocumentClear).not.toHaveBeenCalled()
})

it('keeps the clear confirmation locked until its local persistence settles', async () => {
  mockDocuments.mockResolvedValue([{
    id: 'reviewed', title: 'Reviewed document', mimeType: 'text/plain', size: 16,
    chunkCount: 1, status: 'ready', createdAt: 1, updatedAt: 1,
  }])
  let finish!: () => void
  mockDocumentClear.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByLabelText('contextPanel.clearTitle'))
  await waitFor(() => expect(mockDocumentClear).toHaveBeenCalledTimes(1))
  await fireEvent.press(screen.getByLabelText('contextPanel.clearTitle'))
  expect(mockConfirm).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('contextPanel.clearTitle')).toBeDisabled()
  await act(async () => { finish() })
  await waitFor(() => expect(screen.getByLabelText('contextPanel.clearTitle')).not.toBeDisabled())
})

it('reports a stale memory review as a conflict, reads back current records, and never announces success', async () => {
  const reviewed = {
    schema: 'islemind.knowledge-memory-record.v1', id: 'reviewed', content: 'Reviewed fact',
    status: 'pending', scope: { kind: 'user', id: 'local-user' }, sensitivity: 'normal',
    sourceKind: 'manual', sourceMessageIds: [], createdAt: 1, updatedAt: 1,
  }
  mockMemories = [reviewed]
  mockMemoryUpdate.mockRejectedValueOnce(new KnowledgeRepositoryConflictError())
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="memory" /></SettingsEditBoundary>)
  await act(async () => { mockMemoryProps.onConfirmPendingMemories() })
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.conflict'))
  expect(mockMemoryProps.memories).toEqual([reviewed])
  expect(mockMemoryProps.confirmingMemories).toBe(false)
  expect(mockToast).not.toHaveBeenCalled()
  await act(async () => { mockMemoryProps.onConfirmPendingMemories() })
  await waitFor(() => expect(mockMemoryUpdate).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('alert')).toBeNull()
})

it('passes both shown logical facts when activating and the exact target when rejecting a memory', async () => {
  const active = {
    schema: 'islemind.knowledge-memory-record.v1', id: 'active', content: 'Use blue',
    status: 'active', scope: { kind: 'user', id: 'local-user' }, sensitivity: 'normal',
    subject: 'User', key: 'color', value: 'Blue',
    sourceKind: 'manual', sourceMessageIds: [], createdAt: 1, updatedAt: 1,
  }
  const reviewed = { ...active, id: 'reviewed', content: 'Use amber', status: 'pending', value: 'Amber', conflictWithId: active.id }
  mockMemories = [active, reviewed]
  await render(<SettingsEditBoundary><ContextPanel providers={[]} section="memory" /></SettingsEditBoundary>)
  await act(async () => { await mockMemoryProps.onToggleMemory(reviewed) })
  expect(mockMemoryUpdate).toHaveBeenCalledWith(reviewed.id, 'active', { expectedMemory: reviewed, expectedActiveMemory: active, signal: expect.any(AbortSignal) })
  await act(async () => { await mockMemoryProps.onDeleteMemory(reviewed) })
  expect(mockMemoryDelete).toHaveBeenCalledWith(reviewed.id, { expectedMemory: reviewed, signal: expect.any(AbortSignal) })
})

it('cancels a pending memory review without writing and clears its busy announcement', async () => {
  mockMemories = [{ id: 'reviewed', content: 'Reviewed fact', status: 'pending', createdAt: 1, updatedAt: 1 }]
  let answer!: (value: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve }))
  await render(<SettingsEditBoundary><ContextPanel providers={[]} section="memory" /></SettingsEditBoundary>)
  await act(async () => { mockMemoryProps.onConfirmPendingMemories() })
  expect(mockMemoryProps.confirmingMemories).toBe(true)
  await act(async () => { answer(false) })
  await waitFor(() => expect(mockMemoryProps.confirmingMemories).toBe(false))
  expect(mockMemoryUpdate).not.toHaveBeenCalled()
  expect(mockToast).not.toHaveBeenCalled()
})

const reviewedMemory = () => ({
  schema: 'islemind.knowledge-memory-record.v1', id: 'reviewed', content: 'Reviewed fact',
  status: 'pending', scope: { kind: 'user', id: 'local-user' }, sensitivity: 'normal',
  subject: 'User', key: 'color', value: 'Amber', sourceKind: 'manual',
  sourceMessageIds: ['shown-source'], createdAt: 1, updatedAt: 1,
})
const reviewedDocument = (): KnowledgeDocumentRecord => ({
  schema: 'islemind.knowledge-document-record.v1', id: 'reviewed', title: 'Reviewed document',
  mimeType: 'text/plain', size: 16, chunkCount: 1, status: 'ready', createdAt: 1, updatedAt: 1,
})

it.each(['confirm', 'reject'] as const)('ignores a late memory %s approval after the editor unmounts', async action => {
  mockMemories = [reviewedMemory()]
  let answer!: (value: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="memory" /></SettingsEditBoundary>)
  await act(async () => {
    if (action === 'confirm') mockMemoryProps.onConfirmPendingMemories()
    else mockMemoryProps.onRejectPendingMemories(mockMemories)
  })
  await screen.unmount()
  await act(async () => { answer(true) })
  expect(mockMemoryUpdate).not.toHaveBeenCalled()
  expect(mockMemoryDelete).not.toHaveBeenCalled()
  expect(mockDocuments).toHaveBeenCalledTimes(1)
  expect(mockToast).not.toHaveBeenCalled()
})

it.each(['memory', 'knowledge'] as const)('ignores a late %s clear approval after the editor unmounts', async section => {
  if (section === 'memory') mockMemories = [reviewedMemory()]
  else mockDocuments.mockResolvedValue([reviewedDocument()])
  let answer!: (value: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section={section} /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByLabelText('contextPanel.clearTitle'))
  await screen.unmount()
  await act(async () => { answer(true) })
  expect(mockMemoryClear).not.toHaveBeenCalled()
  expect(mockDocumentClear).not.toHaveBeenCalled()
  expect(mockDocuments).toHaveBeenCalledTimes(1)
  expect(mockToast).not.toHaveBeenCalled()
})

it.each(['approve', 'reject'] as const)('ignores a late knowledge delete prompt %s after unmount', async outcome => {
  mockDocuments.mockResolvedValue([reviewedDocument()])
  let answer!: (value: boolean) => void
  let reject!: (error: Error) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>((resolve, fail) => { answer = resolve; reject = fail }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByLabelText('common.delete'))
  await screen.unmount()
  await act(async () => {
    if (outcome === 'approve') answer(true)
    else reject(new Error('closed prompt'))
  })
  expect(mockDocumentDelete).not.toHaveBeenCalled()
  expect(mockDocuments).toHaveBeenCalledTimes(1)
  expect(mockToast).not.toHaveBeenCalled()
})

it('does not execute a saved memory callback after its editor has unmounted', async () => {
  const reviewed = reviewedMemory()
  mockMemories = [reviewed]
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="memory" /></SettingsEditBoundary>)
  const toggle = mockMemoryProps.onToggleMemory
  await screen.unmount()
  await act(async () => { await toggle(reviewed) })
  expect(mockMemoryUpdate).not.toHaveBeenCalled()
  expect(mockDocuments).toHaveBeenCalledTimes(1)
})

it('aborts an in-flight memory mutation and suppresses its late success readback', async () => {
  const reviewed = reviewedMemory()
  mockMemories = [reviewed]
  let finish!: () => void
  mockMemoryUpdate.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="memory" /></SettingsEditBoundary>)
  let pending!: Promise<void>
  await act(async () => { pending = mockMemoryProps.onToggleMemory(reviewed) })
  const options = mockMemoryUpdate.mock.calls[0][2]
  expect(options.signal).toBeInstanceOf(AbortSignal)
  expect(options.signal.aborted).toBe(false)
  await screen.unmount()
  expect(options.signal.aborted).toBe(true)
  await act(async () => { finish(); await pending })
  expect(mockDocuments).toHaveBeenCalledTimes(1)
  expect(mockToast).not.toHaveBeenCalled()
})

it.each(['confirm', 'reject'] as const)('detaches the memory %s target and active fact before opening the prompt', async action => {
  const reviewed = reviewedMemory()
  const active = { ...reviewedMemory(), id: 'active', status: 'active', content: 'Use blue', value: 'Blue' }
  mockMemories = [reviewed, active]
  const shown = { ...reviewed, scope: { ...reviewed.scope }, sourceMessageIds: [...reviewed.sourceMessageIds] }
  const shownActive = { ...active, scope: { ...active.scope }, sourceMessageIds: [...active.sourceMessageIds] }
  let answer!: (value: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="memory" /></SettingsEditBoundary>)
  await act(async () => {
    if (action === 'confirm') mockMemoryProps.onConfirmPendingMemories([reviewed])
    else mockMemoryProps.onRejectPendingMemories([reviewed])
  })
  reviewed.content = 'Unreviewed replacement'
  reviewed.scope.id = 'other-user'
  reviewed.sourceMessageIds.push('unseen-source')
  active.content = 'Unreviewed active replacement'
  await act(async () => { answer(true) })
  const operation = action === 'confirm' ? mockMemoryUpdate : mockMemoryDelete
  await waitFor(() => expect(operation).toHaveBeenCalledTimes(1))
  const options = operation.mock.calls[0][action === 'confirm' ? 2 : 1]
  expect(options.expectedMemory).toEqual(shown)
  if (action === 'confirm') expect(options.expectedActiveMemory).toEqual(shownActive)
  await screen.unmount()
})

it.each(['memory', 'knowledge'] as const)('detaches the displayed %s clear collection from later caller mutations', async section => {
  const memory = reviewedMemory()
  const document = reviewedDocument()
  const shownMemory = { ...memory, scope: { ...memory.scope }, sourceMessageIds: [...memory.sourceMessageIds] }
  const shownDocument = { ...document }
  if (section === 'memory') mockMemories = [memory]
  else mockDocuments.mockResolvedValue([document])
  let answer!: (value: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section={section} /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByLabelText('contextPanel.clearTitle'))
  memory.content = 'Unreviewed memory'
  memory.scope.id = 'other-user'
  document.title = 'Unreviewed document'
  await act(async () => { answer(true) })
  const operation = section === 'memory' ? mockMemoryClear : mockDocumentClear
  await waitFor(() => expect(operation).toHaveBeenCalledTimes(1))
  const options = operation.mock.calls[0][0]
  expect(options[section === 'memory' ? 'expectedMemories' : 'expectedDocuments']).toEqual([section === 'memory' ? shownMemory : shownDocument])
  await screen.unmount()
})

it.each(['file', 'text'] as const)('suppresses a late %s import result after unmount even if its adapter ignores cancellation', async kind => {
  const operation = kind === 'file' ? mockImportFile : mockImportPlainText
  let finish!: () => void
  operation.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ ok: true, message: 'Already persisted' }) }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" focus="import" /></SettingsEditBoundary>)
  if (kind === 'text') {
    await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.pasteTextKnowledge\./ }))
    await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Owned import draft')
  }
  await fireEvent.press(screen.getByLabelText(kind === 'file' ? 'contextPanel.importKnowledgeFile' : 'contextPanel.importPastedText'))
  await waitFor(() => expect(operation).toHaveBeenCalledTimes(1))
  const options = operation.mock.calls[0][kind === 'file' ? 2 : 3]
  await screen.unmount()
  expect(options.signal.aborted).toBe(true)
  await act(async () => { finish() })
  expect(mockToast).not.toHaveBeenCalled()
  expect(mockDocuments).toHaveBeenCalledTimes(1)
})

it('retains a newer knowledge text draft when an earlier import completes', async () => {
  let finish!: () => void
  mockImportPlainText.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ ok: true, message: 'Imported earlier draft' }) }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.pasteTextKnowledge\./ }))
  await fireEvent.changeText(screen.getByLabelText('contextPanel.knowledgeTitle'), 'Earlier title')
  await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Earlier text')
  await fireEvent.press(screen.getByLabelText('contextPanel.importPastedText'))
  await waitFor(() => expect(mockImportPlainText).toHaveBeenCalledTimes(1))
  await fireEvent.changeText(screen.getByLabelText('contextPanel.knowledgeTitle'), 'Newer title')
  await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Newer text')
  await act(async () => { finish() })
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.knowledgeUpdated' })))
  expect(mockImportPlainText).toHaveBeenCalledWith('Earlier title', 'Earlier text', undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  expect(screen.getByLabelText('contextPanel.knowledgeTitle').props.value).toBe('Newer title')
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe('Newer text')
})

it.each(['changed', 'changed-and-restored'])('does not import a retained text callback after its draft is %s', async change => {
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.pasteTextKnowledge\./ }))
  await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Reviewed text')
  const earlier = mockImportPresses['contextPanel.importPastedText']
  await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Replacement text')
  if (change === 'changed-and-restored') await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Reviewed text')
  await act(async () => { earlier() })
  expect(mockImportPlainText).not.toHaveBeenCalled()
  expect(mockToast).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByLabelText('contextPanel.importPastedText'))
  await waitFor(() => expect(mockImportPlainText).toHaveBeenCalledTimes(1))
  await screen.unmount()
})

it('preserves a changed-and-restored text draft when its earlier import completes', async () => {
  let finish!: () => void
  mockImportPlainText.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ ok: true, message: 'Earlier draft imported' }) }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.pasteTextKnowledge\./ }))
  await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Reviewed text')
  await fireEvent.press(screen.getByLabelText('contextPanel.importPastedText'))
  await waitFor(() => expect(mockImportPlainText).toHaveBeenCalledTimes(1))
  await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Replacement text')
  await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Reviewed text')
  await act(async () => { finish() })
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe('Reviewed text')
  await screen.unmount()
})

it.each(['file', 'text'] as const)('does not announce %s import success while saved-state readback is pending or failed', async kind => {
  const operation = kind === 'file' ? mockImportFile : mockImportPlainText
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(1))
  if (kind === 'text') {
    await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.pasteTextKnowledge\./ }))
    await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Saved text')
  }
  let fail!: (error: Error) => void
  mockDocuments.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  await fireEvent.press(screen.getByLabelText(kind === 'file' ? 'contextPanel.importKnowledgeFile' : 'contextPanel.importPastedText'))
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(2))
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.knowledgeUpdated' }))
  await act(async () => { fail(new Error('readback unavailable')) })
  await waitFor(() => expect(screen.getByText('settingsSubsystem.operationReadbackFailed')).toBeTruthy())
  expect(screen.queryByText('settingsSubsystem.operationFailed')).toBeNull()
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.knowledgeUpdated' }))
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await waitFor(() => expect(screen.queryByText('settingsSubsystem.operationReadbackFailed')).toBeNull())
  expect(operation).toHaveBeenCalledTimes(1)
  await screen.unmount()
})

it.each(['confirm', 'reject'] as const)('does not announce memory %s success when the post-write catalog cannot be read', async action => {
  mockMemories = [reviewedMemory()]
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="memory" /></SettingsEditBoundary>)
  await waitFor(() => expect(mockMemoryProps).toBeTruthy())
  mockDocuments.mockRejectedValueOnce(new Error('readback unavailable'))
  await act(async () => {
    if (action === 'confirm') mockMemoryProps.onConfirmPendingMemories()
    else mockMemoryProps.onRejectPendingMemories()
  })
  await waitFor(() => expect(screen.getByText('settingsSubsystem.operationReadbackFailed')).toBeTruthy())
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({
    title: action === 'confirm' ? 'contextPanel.pendingMemoriesConfirmed' : 'contextPanel.pendingMemoriesRejected',
  }))
  expect(screen.queryByText('settingsSubsystem.operationFailed')).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await waitFor(() => expect(mockMemoryProps.confirmingMemories).toBe(false))
  expect(action === 'confirm' ? mockMemoryUpdate : mockMemoryDelete).toHaveBeenCalledTimes(1)
  await screen.unmount()
})

it.each(['toggle', 'delete', 'clear-memory', 'clear-knowledge', 'delete-knowledge'] as const)(
  'distinguishes successful %s persistence from failed readback and retries only the read',
  async action => {
    mockMemories = [reviewedMemory()]
    mockDocuments.mockResolvedValue([reviewedDocument()])
    const memoryAction = action === 'toggle' || action === 'delete' || action === 'clear-memory'
    const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section={memoryAction ? 'memory' : 'knowledge'} /></SettingsEditBoundary>)
    await waitFor(() => expect(memoryAction ? mockMemoryProps : screen.queryByText('Reviewed document')).toBeTruthy())
    mockDocuments.mockRejectedValueOnce(new Error('readback unavailable'))
    if (action === 'toggle' || action === 'delete') {
      await act(async () => {
        if (action === 'toggle') await mockMemoryProps.onToggleMemory(mockMemories[0])
        else await mockMemoryProps.onDeleteMemory(mockMemories[0])
      })
    } else {
      await fireEvent.press(screen.getByLabelText(action === 'delete-knowledge' ? 'common.delete' : 'contextPanel.clearTitle'))
    }
    await waitFor(() => expect(screen.getByText('settingsSubsystem.operationReadbackFailed')).toBeTruthy())
    expect(screen.queryByText('settingsSubsystem.operationFailed')).toBeNull()
    const operation = action === 'toggle' ? mockMemoryUpdate : action === 'delete' ? mockMemoryDelete
      : action === 'clear-memory' ? mockMemoryClear : action === 'clear-knowledge' ? mockDocumentClear : mockDocumentDelete
    expect(operation).toHaveBeenCalledTimes(1)
    await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
    await waitFor(() => expect(screen.queryByText('settingsSubsystem.operationReadbackFailed')).toBeNull())
    expect(operation).toHaveBeenCalledTimes(1)
    await screen.unmount()
  },
)

it.each(['file', 'text'] as const)('waits for successful %s readback before success and ignores an unmounted readback', async kind => {
  const operation = kind === 'file' ? mockImportFile : mockImportPlainText
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(1))
  if (kind === 'text') {
    await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.pasteTextKnowledge\./ }))
    await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Saved text')
  }
  let finish!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await fireEvent.press(screen.getByLabelText(kind === 'file' ? 'contextPanel.importKnowledgeFile' : 'contextPanel.importPastedText'))
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(2))
  expect(mockToast).not.toHaveBeenCalled()
  expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).toBeDisabled()
  await act(async () => { finish([reviewedDocument()]) })
  await waitFor(() => expect(screen.getByText('Reviewed document')).toBeTruthy())
  expect(mockToast).toHaveBeenCalledTimes(1)
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.knowledgeUpdated' }))
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  if (kind === 'text') await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Second saved text')
  await fireEvent.press(screen.getByLabelText(kind === 'file' ? 'contextPanel.importKnowledgeFile' : 'contextPanel.importPastedText'))
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(3))
  const options = operation.mock.calls[1][kind === 'file' ? 2 : 3]
  await screen.unmount()
  expect(options.signal.aborted).toBe(true)
  await act(async () => { finish([reviewedDocument()]) })
  expect(mockToast).toHaveBeenCalledTimes(1)
})

it('does not classify a partly failed batch as a completed write even when error readback also fails', async () => {
  mockMemories = [reviewedMemory(), { ...reviewedMemory(), id: 'second' }]
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="memory" /></SettingsEditBoundary>)
  await waitFor(() => expect(mockMemoryProps).toBeTruthy())
  mockMemoryUpdate.mockRejectedValueOnce(new Error('first write failed'))
  mockDocuments.mockRejectedValueOnce(new Error('readback unavailable'))
  await act(async () => { mockMemoryProps.onConfirmPendingMemories() })
  await waitFor(() => expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy())
  expect(screen.getByText('settingsSubsystem.loadFailed')).toBeTruthy()
  expect(screen.queryByText('settingsSubsystem.operationReadbackFailed')).toBeNull()
  expect(mockToast).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await waitFor(() => expect(mockMemoryProps.confirmingMemories).toBe(false))
  expect(mockMemoryUpdate).toHaveBeenCalledTimes(2)
  expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy()
  await screen.unmount()
})

it.each(CANONICAL_THEME_IDS.flatMap(theme => (['light', 'dark'] as const).map(mode => ({ theme, mode }))))(
  'keeps the typed PDF capacity guidance in a full-message notice for $theme/$mode', async ({ theme, mode }) => {
    mockTheme = theme
    mockMode = mode
    const message = 'PDF context cannot be safely estimated. Nothing was added. Export as TXT/Markdown or paste its text to import locally.'
    mockImportFile.mockResolvedValueOnce({ ok: false, message, reason: 'pdf_capacity_unavailable' })
    const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
    await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(1))
    await fireEvent.press(screen.getByLabelText('contextPanel.importKnowledgeFile'))
    await waitFor(() => expect(mockNotice).toHaveBeenCalledWith({
      title: 'settings.importSkipped', message, tone: 'amber',
    }))
    await waitFor(() => expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).not.toBeDisabled())
    expect(mockNotice).toHaveBeenCalledTimes(1)
    expect(mockToast).not.toHaveBeenCalled()
    expect(mockDocuments).toHaveBeenCalledTimes(2)
    await screen.unmount()
  },
)

it.each(['file', 'text'] as const)('keeps an ordinary skipped %s import as a toast without classifying its message text', async kind => {
  const operation = kind === 'file' ? mockImportFile : mockImportPlainText
  operation.mockResolvedValueOnce({ ok: false, message: 'contextImport.pdfCapacityUnavailable' })
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(1))
  if (kind === 'text') {
    await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.pasteTextKnowledge\./ }))
    await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Retained local draft')
  }
  await fireEvent.press(screen.getByLabelText(kind === 'file' ? 'contextPanel.importKnowledgeFile' : 'contextPanel.importPastedText'))
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith({
    title: 'settings.importSkipped', message: 'contextImport.pdfCapacityUnavailable', tone: 'amber',
  }))
  await waitFor(() => expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).not.toBeDisabled())
  expect(mockNotice).not.toHaveBeenCalled()
  if (kind === 'text') expect(screen.getByLabelText('contextPanel.body').props.value).toBe('Retained local draft')
  await screen.unmount()
})

it.each(['cancel', 'unmount'] as const)('does not publish a late typed PDF notice after %s', async retired => {
  let finish!: (result: { ok: boolean; message: string; reason: 'pdf_capacity_unavailable' }) => void
  mockImportFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(1))
  await fireEvent.press(screen.getByLabelText('contextPanel.importKnowledgeFile'))
  await waitFor(() => expect(mockImportFile).toHaveBeenCalledTimes(1))
  if (retired === 'cancel') await fireEvent.press(screen.getByLabelText('contextPanel.cancelKnowledgeImport'))
  else await screen.unmount()
  await act(async () => { finish({ ok: false, message: 'Late PDF guidance', reason: 'pdf_capacity_unavailable' }) })
  if (retired === 'cancel') {
    await waitFor(() => expect(screen.getByText('contextPanel.knowledgeImportCancelled')).toBeTruthy())
    await waitFor(() => expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).not.toBeDisabled())
    await screen.unmount()
  }
  expect(mockNotice).not.toHaveBeenCalled()
  expect(mockToast).not.toHaveBeenCalled()
})

it.each(['file', 'text'] as const)('cancels the %s import without releasing the operation lock until its adapter and readback settle', async kind => {
  const operation = kind === 'file' ? mockImportFile : mockImportPlainText
  let finish!: (result: { ok: boolean; message: string }) => void
  operation.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(1))
  if (kind === 'text') {
    await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.pasteTextKnowledge\./ }))
    await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Retained draft')
  }
  await fireEvent.press(screen.getByLabelText(kind === 'file' ? 'contextPanel.importKnowledgeFile' : 'contextPanel.importPastedText'))
  await waitFor(() => expect(operation).toHaveBeenCalledTimes(1))
  const signal = operation.mock.calls[0][kind === 'file' ? 2 : 3].signal
  expect(signal.aborted).toBe(false)
  await fireEvent.press(screen.getByLabelText('contextPanel.cancelKnowledgeImport'))
  expect(signal.aborted).toBe(true)
  expect(screen.getByLabelText('contextPanel.cancellingKnowledgeImport')).toBeDisabled()
  expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).toBeDisabled()
  await fireEvent.press(screen.getByLabelText('contextPanel.importKnowledgeFile'))
  expect(mockImportFile).toHaveBeenCalledTimes(kind === 'file' ? 1 : 0)
  expect(mockDocuments).toHaveBeenCalledTimes(1)
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish({ ok: true, message: 'Adapter ignored cancellation; records may exist' }) })
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(2))
  expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).toBeDisabled()
  expect(mockToast).not.toHaveBeenCalled()
  await act(async () => { readback([reviewedDocument()]) })
  await waitFor(() => expect(screen.getByText('contextPanel.knowledgeImportCancelled')).toBeTruthy())
  expect(screen.getByText('Reviewed document')).toBeTruthy()
  expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).not.toBeDisabled()
  if (kind === 'text') expect(screen.getByLabelText('contextPanel.body').props.value).toBe('Retained draft')
  expect(mockToast).not.toHaveBeenCalled()
  await screen.unmount()
})

it('keeps an earlier cancel callback from aborting a later import', async () => {
  let finish!: (result: { ok: boolean; message: string }) => void
  mockImportFile.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByLabelText('contextPanel.importKnowledgeFile'))
  await waitFor(() => expect(mockImportFile).toHaveBeenCalledTimes(1))
  const earlierCancel = mockImportPresses['contextPanel.cancelKnowledgeImport']
  await act(async () => { finish({ ok: true, message: 'Imported first file' }) })
  await waitFor(() => expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).not.toBeDisabled())
  await fireEvent.press(screen.getByLabelText('contextPanel.importKnowledgeFile'))
  await waitFor(() => expect(mockImportFile).toHaveBeenCalledTimes(2))
  const signal = mockImportFile.mock.calls[1][2].signal
  await act(async () => { earlierCancel() })
  expect(signal.aborted).toBe(false)
  await fireEvent.press(screen.getByLabelText('contextPanel.cancelKnowledgeImport'))
  expect(signal.aborted).toBe(true)
  await act(async () => { finish({ ok: true, message: 'Late result' }) })
  await waitFor(() => expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).not.toBeDisabled())
  await screen.unmount()
})

it('blocks replacement imports after a cancellation readback fails until the list is successfully reloaded', async () => {
  let fail!: (error: Error) => void
  mockImportFile.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(1))
  await fireEvent.press(screen.getByLabelText('contextPanel.importKnowledgeFile'))
  await waitFor(() => expect(mockImportFile).toHaveBeenCalledTimes(1))
  await fireEvent.press(screen.getByLabelText('contextPanel.cancelKnowledgeImport'))
  mockDocuments.mockRejectedValueOnce(new Error('readback failed'))
  await act(async () => { fail(Object.assign(new Error('Stopped'), { name: 'AbortError' })) })
  await waitFor(() => expect(screen.getByText('contextPanel.knowledgeImportCancelled')).toBeTruthy())
  expect(screen.getByText('settingsSubsystem.loadFailed')).toBeTruthy()
  expect(screen.queryByText('settingsSubsystem.operationFailed')).toBeNull()
  expect(screen.queryByText('settingsSubsystem.operationReadbackFailed')).toBeNull()
  expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).toBeDisabled()
  await fireEvent.press(screen.getByLabelText('contextPanel.importKnowledgeFile'))
  expect(mockImportFile).toHaveBeenCalledTimes(1)
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await waitFor(() => expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).not.toBeDisabled())
  expect(mockImportFile).toHaveBeenCalledTimes(1)
  expect(mockToast).not.toHaveBeenCalled()
  await screen.unmount()
})

it('retires a cancel action once its import acknowledgement has entered readback', async () => {
  let finish!: (result: { ok: boolean; message: string }) => void
  mockImportFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(1))
  await fireEvent.press(screen.getByLabelText('contextPanel.importKnowledgeFile'))
  await waitFor(() => expect(mockImportFile).toHaveBeenCalledTimes(1))
  const cancel = mockImportPresses['contextPanel.cancelKnowledgeImport']
  const signal = mockImportFile.mock.calls[0][2].signal
  let readback!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { readback = resolve }))
  await act(async () => { finish({ ok: true, message: 'Committed' }) })
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(2))
  expect(screen.queryByLabelText('contextPanel.cancelKnowledgeImport')).toBeNull()
  await act(async () => { cancel() })
  expect(signal.aborted).toBe(false)
  await act(async () => { readback([reviewedDocument()]) })
  await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1))
  await screen.unmount()
})

it('cancels before provider resolution without starting the import adapter or discarding its text', async () => {
  let finish!: () => void
  mockPrimaryProvider.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(undefined) }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(1))
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.pasteTextKnowledge\./ }))
  await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Owned text')
  await fireEvent.press(screen.getByLabelText('contextPanel.importPastedText'))
  await waitFor(() => expect(mockPrimaryProvider).toHaveBeenCalledTimes(1))
  await fireEvent.press(screen.getByLabelText('contextPanel.cancelKnowledgeImport'))
  expect(mockImportPlainText).not.toHaveBeenCalled()
  expect(screen.getByLabelText('contextPanel.importPastedText')).toBeDisabled()
  await act(async () => { finish() })
  await waitFor(() => expect(screen.getByText('contextPanel.knowledgeImportCancelled')).toBeTruthy())
  expect(mockImportPlainText).not.toHaveBeenCalled()
  expect(mockDocuments).toHaveBeenCalledTimes(2)
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe('Owned text')
  expect(screen.getByLabelText('contextPanel.importPastedText')).not.toBeDisabled()
  await screen.unmount()
})

it('waits for a rejected cancelled text adapter before reading back and keeps its unchanged draft', async () => {
  let fail!: (error: Error) => void
  mockImportPlainText.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(1))
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel.pasteTextKnowledge\./ }))
  await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Owned text')
  await fireEvent.press(screen.getByLabelText('contextPanel.importPastedText'))
  await waitFor(() => expect(mockImportPlainText).toHaveBeenCalledTimes(1))
  await fireEvent.press(screen.getByLabelText('contextPanel.cancelKnowledgeImport'))
  await act(async () => { fail(Object.assign(new Error('Cancelled after write'), { name: 'AbortError' })) })
  await waitFor(() => expect(screen.getByText('contextPanel.knowledgeImportCancelled')).toBeTruthy())
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe('Owned text')
  expect(screen.queryByText('settingsSubsystem.operationFailed')).toBeNull()
  expect(mockDocuments).toHaveBeenCalledTimes(2)
  expect(mockToast).not.toHaveBeenCalled()
  await screen.unmount()
})

it('suppresses a cancelled import readback and retained cancel callback after unmount', async () => {
  let finish!: (result: { ok: boolean; message: string }) => void
  mockImportFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(1))
  await fireEvent.press(screen.getByLabelText('contextPanel.importKnowledgeFile'))
  await waitFor(() => expect(mockImportFile).toHaveBeenCalledTimes(1))
  const cancel = mockImportPresses['contextPanel.cancelKnowledgeImport']
  await fireEvent.press(screen.getByLabelText('contextPanel.cancelKnowledgeImport'))
  await screen.unmount()
  await act(async () => { cancel(); finish({ ok: true, message: 'Late cancelled result' }) })
  expect(mockDocuments).toHaveBeenCalledTimes(1)
  expect(mockToast).not.toHaveBeenCalled()
})

it('retains a retry entry when cancellation readback is superseded by a different successful catalog read', async () => {
  let finishImport!: (result: { ok: boolean; message: string }) => void
  mockImportFile.mockImplementationOnce(() => new Promise(resolve => { finishImport = resolve }))
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(1))
  await fireEvent.press(screen.getByLabelText('contextPanel.importKnowledgeFile'))
  await waitFor(() => expect(mockImportFile).toHaveBeenCalledTimes(1))
  await fireEvent.press(screen.getByLabelText('contextPanel.cancelKnowledgeImport'))
  let firstRead!: (documents: KnowledgeDocument[]) => void
  mockDocuments.mockImplementationOnce(() => new Promise(resolve => { firstRead = resolve }))
  await act(async () => { finishImport({ ok: true, message: 'Late result' }) })
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(2))
  // Changing a credential getter retriggers the existing catalog/credential effect.
  const earlierGetter = mockGetKey
  const replacementGetter = jest.fn(async () => '')
  mockCatalogKeyGetter = replacementGetter
  await screen.rerender(<SettingsEditBoundary><ContextPanel providers={[]} section="knowledge" /></SettingsEditBoundary>)
  await waitFor(() => expect(mockDocuments).toHaveBeenCalledTimes(3))
  await act(async () => { firstRead([]) })
  await waitFor(() => expect(screen.getByText('contextPanel.knowledgeImportCancelled')).toBeTruthy())
  expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).toBeDisabled()
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await waitFor(() => expect(screen.getByLabelText('contextPanel.importKnowledgeFile')).not.toBeDisabled())
  expect(mockImportFile).toHaveBeenCalledTimes(1)
  mockCatalogKeyGetter = earlierGetter
  await screen.unmount()
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

function ownedModelDirectory(raw: string) {
  const model = localModelFixture().model
  const records = new Map<string, string>([[LOCAL_MODEL_STATE_STORAGE_KEY, raw]])
  const adapter = {
    getItem: jest.fn(async (key: string) => records.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { records.set(key, value) }),
    removeItem: jest.fn(async (key: string) => { records.delete(key) }),
  }
  const repository = createLocalModelStateRepository(createAsyncStorageLocalModelStateStoragePort(adapter))
  const policy = createLocalEmbeddingModelCatalogPolicy({
    catalog: { schema: LOCAL_MODEL_CATALOG_SCHEMA, models: [model] },
    bundledModelIds: [],
    stateRepository: repository,
    availability: { verify: async () => true },
  })
  mockLocalModels.mockImplementation((settings, signal) =>
    policy.listModelViews(settings as LocalEmbeddingModelPreference, { signal }))
  mockReviewModelState.mockImplementation(signal =>
    (repository as LocalModelStateRecoveryRepository).reviewInvalidState({ signal }))
  return { model, records, adapter, repository }
}

const modelDirectoryThemeCases = CANONICAL_THEME_IDS.flatMap(family =>
  (['light', 'dark'] as const).map(mode => ({ family, mode })))

it.each(modelDirectoryThemeCases)('keeps persisted model read errors visible for $family in $mode until explicit fresh reload', async ({ family, mode }) => {
  mockTheme = family
  mockMode = mode
  mockSettings = {
    ...mockSettings, localEmbeddingModelId: 'retained-unknown-selection',
    localEmbeddingModelSource: 'downloaded', memoryEnabled: false, knowledgeEnabled: false,
  }
  const settingsBefore = JSON.stringify(mockSettings)
  const raw = '{"records":{"broken":{"modelId":"different","source":"downloaded"}},"failed":{}}'
  const f = ownedModelDirectory(raw)
  const screen = await render(<IsleThemeProvider><Page /></IsleThemeProvider>)
  await waitFor(() => expect(screen.getByText('contextPanel.localModel.loadFailed')).toBeTruthy())
  expect(screen.queryByText('settingsSubsystem.loadFailed')).toBeNull()
  expect(screen.queryByText(f.model.name)).toBeNull()
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(raw)
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(mockModelDownload).not.toHaveBeenCalled()
  expect(mockModelDelete).not.toHaveBeenCalled()
  f.records.set(LOCAL_MODEL_STATE_STORAGE_KEY, '{"records":{},"failed":{}}')
  await fireEvent.press(screen.getAllByLabelText('common.retry')[0])
  await waitFor(() => expect(screen.getByText(f.model.name)).toBeTruthy())
  expect(screen.queryByText('contextPanel.localModel.loadFailed')).toBeNull()
  expect(JSON.stringify(mockSettings)).toBe(settingsBefore)
  expect(f.adapter.getItem).toHaveBeenCalledTimes(2)
  expect(mockUpdate).not.toHaveBeenCalled()
  await screen.unmount()
})

it.each(modelDirectoryThemeCases)('requires real model-directory readback for $family in $mode without repeating committed download work', async ({ family, mode }) => {
  mockTheme = family
  mockMode = mode
  mockSettings = { ...mockSettings, memoryEnabled: false, knowledgeEnabled: false }
  const f = ownedModelDirectory('{"records":{},"failed":{}}')
  mockModelDownload.mockImplementationOnce(async (modelId: string) => {
    await f.repository.recordInstalledModel({
      modelId, source: 'downloaded', bytes: 100, sha256: { 'model.onnx': '0'.repeat(64) },
    })
    f.adapter.getItem.mockRejectedValueOnce(new Error('Owned real JSON readback failed'))
  })
  const screen = await render(<IsleThemeProvider><Page /></IsleThemeProvider>)
  await waitFor(() => expect(screen.getByText(f.model.name)).toBeTruthy())
  const retainedDownload = mockModelPresses[localModelAction('download')]
  await act(async () => { retainedDownload() })
  await waitFor(() => expect(screen.getByText('settingsSubsystem.operationReadbackFailed')).toBeTruthy())
  expect(screen.getByText('contextPanel.localModel.loadFailed')).toBeTruthy()
  expect(mockNotice).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.localModel.downloaded' }))
  const committed = f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)
  expect(JSON.parse(committed!).records[f.model.id].source).toBe('downloaded')
  await act(async () => { retainedDownload() })
  expect(mockModelDownload).toHaveBeenCalledTimes(1)
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(committed)
  await waitFor(() => expect(screen.getAllByLabelText('common.retry')[0]).not.toBeDisabled())
  await fireEvent.press(screen.getAllByLabelText('common.retry')[0])
  await waitFor(() => expect(screen.queryByText('settingsSubsystem.operationReadbackFailed')).toBeNull())
  expect(screen.queryByText('contextPanel.localModel.loadFailed')).toBeNull()
  expect(mockModelDownload).toHaveBeenCalledTimes(1)
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(committed)
  expect(mockSettings).toMatchObject({
    localEmbeddingModelId: f.model.id, localEmbeddingModelSource: 'downloaded',
    memoryEnabled: false, knowledgeEnabled: false,
  })
  await screen.unmount()
})

const modelRecoveryLabel = 'contextPanel.localModel.reviewStateReset'
const invalidModelIndex = '{"schema":"future-model-index","records":{},"failed":{},"private":"owned-index-token"}'

function modelRecoveryOwner(raw = invalidModelIndex) {
  mockSettings = {
    ...mockSettings, localEmbeddingModelId: 'retained-selected-model',
    localEmbeddingModelSource: 'downloaded', defaultProvider: 'retained-provider',
    memoryEnabled: false, knowledgeEnabled: false, mcpEnabled: false,
  }
  const f = ownedModelDirectory(raw)
  f.records.set('@islemind/settings', JSON.stringify(mockSettings))
  f.records.set('@islemind/providers', '[{"id":"retained-provider","enabled":false}]')
  f.records.set('@owned/knowledge', '[{"id":"retained-document"}]')
  f.records.set('@owned/memories', '[{"id":"retained-memory"}]')
  const settings = JSON.stringify(mockSettings)
  const unrelated = [...f.records].filter(([key]) => key !== LOCAL_MODEL_STATE_STORAGE_KEY)
  return {
    ...f,
    assertPreserved() {
      expect(JSON.stringify(mockSettings)).toBe(settings)
      expect([...f.records].filter(([key]) => key !== LOCAL_MODEL_STATE_STORAGE_KEY)).toEqual(unrelated)
      expect(mockUpdate).not.toHaveBeenCalled()
      expect(mockFlush).not.toHaveBeenCalled()
      expect(mockModelDownload).not.toHaveBeenCalled()
      expect(mockModelDelete).not.toHaveBeenCalled()
      expect(mockRebuild).not.toHaveBeenCalled()
      expect(mockMemoryDelete).not.toHaveBeenCalled()
      expect(mockMemoryClear).not.toHaveBeenCalled()
      expect(mockDocumentDelete).not.toHaveBeenCalled()
      expect(mockDocumentClear).not.toHaveBeenCalled()
    },
  }
}

it.each(modelDirectoryThemeCases)('model-index recovery keeps nonempty knowledge and memory catalogs visible for $family in $mode without discarding bad metadata', async ({ family, mode }) => {
  mockTheme = family
  mockMode = mode
  const f = modelRecoveryOwner()
  const document = { ...reviewedDocument(), title: 'Owned knowledge remains visible', status: 'ready' as const }
  const memory = { ...reviewedMemory(), content: 'Owned memory remains visible', status: 'active' as const }
  mockDocuments.mockResolvedValue([document])
  mockMemories = [memory]
  const screen = await render(<IsleThemeProvider><SettingsEditBoundary><ContextPanel providers={[]} section="all" /></SettingsEditBoundary></IsleThemeProvider>)
  await waitFor(() => expect(screen.getByText(/^(?:- )?Owned knowledge remains visible$/)).toBeTruthy())
  expect(mockMemoryProps.memories).toEqual([memory])
  expect(screen.getByText('contextPanel.localModel.loadFailed')).toBeTruthy()
  expect(screen.queryByText('settingsSubsystem.loadFailed')).toBeNull()
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(invalidModelIndex)
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  f.assertPreserved()
  await screen.unmount()
})

it.each(modelDirectoryThemeCases)('model-index recovery resets only explicitly reviewed unreadable metadata for $family in $mode and keeps files and selections', async ({ family, mode }) => {
  mockTheme = family
  mockMode = mode
  const f = modelRecoveryOwner()
  const screen = await render(<IsleThemeProvider><Page /></IsleThemeProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeTruthy())
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: modelRecoveryLabel }))
  await waitFor(() => expect(screen.getByText(f.model.name)).toBeTruthy())
  expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
    title: 'contextPanel.localModel.stateResetTitle',
    message: 'contextPanel.localModel.stateResetMessage',
    confirmLabel: 'contextPanel.localModel.resetState', cancelLabel: 'common.cancel', tone: 'danger',
  }))
  expect(mockConfirm.mock.calls[0][0].signal).toBe(mockReviewModelState.mock.calls[0][0])
  expect(f.adapter.removeItem).toHaveBeenCalledTimes(1)
  expect(f.adapter.removeItem).toHaveBeenCalledWith(LOCAL_MODEL_STATE_STORAGE_KEY)
  expect(f.records.has(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(false)
  expect(screen.queryByRole('button', { name: modelRecoveryLabel })).toBeNull()
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.localModel.stateResetDone' }))
  f.assertPreserved()
  await screen.unmount()
})

it.each(['memory', 'knowledge'] as const)('model-index recovery does not hold a nonempty %s read hostage to an unrelated pending model catalog', async section => {
  const document = { ...reviewedDocument(), title: 'Owned pending-model document', status: 'ready' as const }
  const memory = { ...reviewedMemory(), status: 'active' as const }
  mockDocuments.mockResolvedValue([document])
  mockMemories = [memory]
  const read = deferredModel<LocalEmbeddingModelView[]>()
  mockLocalModels.mockReturnValueOnce(read.promise)
  const screen = await render(<SettingsEditBoundary><ContextPanel providers={[]} section={section} /></SettingsEditBoundary>)
  try {
    if (section === 'knowledge') await waitFor(() => expect(screen.getByText(document.title)).toBeTruthy())
    else await waitFor(() => expect(mockMemoryProps?.memories).toEqual([memory]))
    expect(screen.queryByRole('button', { name: modelRecoveryLabel })).toBeNull()
    expect(mockReviewModelState).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  } finally {
    await act(async () => { read.resolve([]) })
    await screen.unmount()
  }
})

it('model-index recovery never treats a transient directory read error as permission to reset data', async () => {
  const f = modelRecoveryOwner()
  f.adapter.getItem.mockRejectedValueOnce(new Error('Owned model storage read failed'))
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByText('contextPanel.localModel.loadFailed')).toBeTruthy())
  expect(screen.queryByRole('button', { name: modelRecoveryLabel })).toBeNull()
  expect(mockReviewModelState).not.toHaveBeenCalled()
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(invalidModelIndex)
  f.assertPreserved()
})

it('model-index recovery never offers model reset as a repair for an unrelated knowledge read failure', async () => {
  mockDocuments.mockRejectedValueOnce(new Error('Owned knowledge read failure'))
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByText('settingsSubsystem.loadFailed')).toBeTruthy())
  expect(screen.queryByRole('button', { name: modelRecoveryLabel })).toBeNull()
  expect(mockReviewModelState).not.toHaveBeenCalled()
  expect(mockModelDelete).not.toHaveBeenCalled()
})

it('model-index recovery retains unreadable bytes after confirmation is cancelled', async () => {
  const f = modelRecoveryOwner()
  mockConfirm.mockResolvedValueOnce(false)
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeTruthy())
  await fireEvent.press(screen.getByRole('button', { name: modelRecoveryLabel }))
  expect(mockReviewModelState).toHaveBeenCalledTimes(1)
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(invalidModelIndex)
  expect(mockToast).not.toHaveBeenCalled()
  f.assertPreserved()
})

it('model-index recovery reloads a repair that arrived before review without confirming or removing supported state', async () => {
  const f = modelRecoveryOwner()
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeTruthy())
  const repaired = '{"records":{},"failed":{}}'
  f.records.set(LOCAL_MODEL_STATE_STORAGE_KEY, repaired)
  await fireEvent.press(screen.getByRole('button', { name: modelRecoveryLabel }))
  await waitFor(() => expect(screen.getByText(f.model.name)).toBeTruthy())
  expect(mockConfirm).not.toHaveBeenCalled()
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(repaired)
  f.assertPreserved()
})

it.each([
  ['supported', '{"records":{},"failed":{}}'],
  ['still invalid', '{"schema":"different-invalid-index"}'],
])('model-index recovery refuses %s bytes that changed while the confirmation was open', async (_description, replacement) => {
  const f = modelRecoveryOwner()
  mockConfirm.mockImplementationOnce(async () => { f.records.set(LOCAL_MODEL_STATE_STORAGE_KEY, replacement); return true })
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeTruthy())
  await fireEvent.press(screen.getByRole('button', { name: modelRecoveryLabel }))
  await waitFor(() => expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy())
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(replacement)
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  expect(mockToast).not.toHaveBeenCalled()
  f.assertPreserved()
})

it('model-index recovery refuses changed-and-restored bytes observed by the same repository during confirmation', async () => {
  const f = modelRecoveryOwner()
  mockConfirm.mockImplementationOnce(async () => {
    f.records.set(LOCAL_MODEL_STATE_STORAGE_KEY, '{"schema":"observed-change"}')
    await expect(f.repository.loadState()).rejects.toMatchObject({ name: 'LocalModelStateDataError' })
    f.records.set(LOCAL_MODEL_STATE_STORAGE_KEY, invalidModelIndex)
    await expect(f.repository.loadState()).rejects.toMatchObject({ name: 'LocalModelStateDataError' })
    return true
  })
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeTruthy())
  await fireEvent.press(screen.getByRole('button', { name: modelRecoveryLabel }))
  await waitFor(() => expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy())
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(invalidModelIndex)
  f.assertPreserved()
})

it.each(['localEmbeddingModelId', 'localModelDownloadMirrorBaseUrl'] as const)('model-index recovery rejects changed-and-restored %s consent without altering any preferences', async key => {
  const f = modelRecoveryOwner()
  mockConfirm.mockImplementationOnce(async () => {
    const initial = mockSettings[key]
    publishModelSettings({ [key]: 'changed-during-review' })
    publishModelSettings({ [key]: initial })
    return true
  })
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeTruthy())
  await fireEvent.press(screen.getByRole('button', { name: modelRecoveryLabel }))
  await waitFor(() => expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy())
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(invalidModelIndex)
  f.assertPreserved()
})

it('model-index recovery owns pending review through duplicate presses and navigation refusal', async () => {
  const f = modelRecoveryOwner()
  const read = deferredModel<void>()
  mockReviewModelState.mockImplementationOnce(async signal => {
    await read.promise
    return (f.repository as LocalModelStateRecoveryRepository).reviewInvalidState({ signal })
  })
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeTruthy())
  const retained = mockModelPresses[modelRecoveryLabel]
  try {
    await act(async () => { retained(); retained() })
    expect(mockReviewModelState).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeDisabled()
    await act(async () => mockRemove({ data: { action: { type: 'GO_BACK' } } }))
    expect(mockConfirm).not.toHaveBeenCalled()
    expect(mockDispatch).not.toHaveBeenCalled()
    expect(f.adapter.removeItem).not.toHaveBeenCalled()
  } finally {
    await act(async () => { read.resolve() })
  }
  await waitFor(() => expect(f.adapter.removeItem).toHaveBeenCalledTimes(1))
  f.assertPreserved()
})

it.each(['review', 'confirmation', 'reset-read'] as const)('model-index recovery retires an unmounted %s before removal and suppresses late feedback', async phase => {
  const f = modelRecoveryOwner()
  const pause = deferredModel<void>()
  if (phase === 'review') mockReviewModelState.mockImplementationOnce(async signal => {
    await pause.promise
    return (f.repository as LocalModelStateRecoveryRepository).reviewInvalidState({ signal })
  })
  if (phase === 'confirmation') mockConfirm.mockImplementationOnce(async () => { await pause.promise; return true })
  if (phase === 'reset-read') mockConfirm.mockImplementationOnce(async () => {
    f.adapter.getItem.mockImplementationOnce(async key => { await pause.promise; return f.records.get(key) ?? null })
    return true
  })
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeTruthy())
  try {
    await fireEvent.press(screen.getByRole('button', { name: modelRecoveryLabel }))
    if (phase === 'confirmation') await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))
    if (phase === 'reset-read') await waitFor(() => expect(f.adapter.getItem).toHaveBeenCalledTimes(3))
    await screen.unmount()
    expect(mockReviewModelState.mock.calls[0][0]!.aborted).toBe(true)
  } finally {
    await act(async () => { pause.resolve() })
  }
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  expect(mockToast).not.toHaveBeenCalled()
  expect(mockNotice).not.toHaveBeenCalled()
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(invalidModelIndex)
  f.assertPreserved()
})

it('model-index recovery does not claim an already-admitted unmounted removal was rolled back', async () => {
  const f = modelRecoveryOwner()
  const removal = deferredModel<void>()
  f.adapter.removeItem.mockImplementationOnce(async key => { await removal.promise; f.records.delete(key) })
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeTruthy())
  try {
    await fireEvent.press(screen.getByRole('button', { name: modelRecoveryLabel }))
    await waitFor(() => expect(f.adapter.removeItem).toHaveBeenCalledTimes(1))
    await screen.unmount()
  } finally {
    await act(async () => { removal.resolve() })
  }
  expect(f.records.has(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(false)
  expect(f.adapter.removeItem).toHaveBeenCalledTimes(1)
  expect(mockToast).not.toHaveBeenCalled()
  expect(mockNotice).not.toHaveBeenCalled()
  f.assertPreserved()
})

it('model-index recovery reads possible committed bytes after removal acknowledgement failure without successful feedback or replay', async () => {
  const f = modelRecoveryOwner()
  f.adapter.removeItem.mockImplementationOnce(async key => {
    f.records.delete(key)
    throw new Error('Owned reset acknowledgement failed after commit')
  })
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeTruthy())
  const retained = mockModelPresses[modelRecoveryLabel]
  await act(async () => { retained() })
  await waitFor(() => expect(screen.getByText(f.model.name)).toBeTruthy())
  expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy()
  expect(f.records.has(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(false)
  expect(f.adapter.removeItem).toHaveBeenCalledTimes(1)
  expect(mockToast).not.toHaveBeenCalled()
  await act(async () => { retained() })
  expect(f.adapter.removeItem).toHaveBeenCalledTimes(1)
  expect(mockConfirm).toHaveBeenCalledTimes(1)
  f.assertPreserved()
})

it('model-index recovery requires a fresh review and confirmation after a failed removal while retaining the original bytes', async () => {
  const f = modelRecoveryOwner()
  f.adapter.removeItem.mockRejectedValueOnce(new Error('Owned removal failed before commit'))
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeTruthy())
  await fireEvent.press(screen.getByRole('button', { name: modelRecoveryLabel }))
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).not.toBeDisabled())
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(invalidModelIndex)
  expect(mockToast).not.toHaveBeenCalled()
  expect(f.adapter.removeItem).toHaveBeenCalledTimes(1)
  await fireEvent.press(screen.getByRole('button', { name: modelRecoveryLabel }))
  await waitFor(() => expect(screen.getByText(f.model.name)).toBeTruthy())
  expect(mockReviewModelState).toHaveBeenCalledTimes(2)
  expect(mockConfirm).toHaveBeenCalledTimes(2)
  expect(f.adapter.removeItem).toHaveBeenCalledTimes(2)
  f.assertPreserved()
})

it('model-index recovery keeps failed authoritative readback debt visible and retries loading without removing metadata twice', async () => {
  const f = modelRecoveryOwner()
  f.adapter.removeItem.mockImplementationOnce(async key => {
    f.records.delete(key)
    f.adapter.getItem.mockRejectedValueOnce(new Error('Owned model reset readback failed'))
  })
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeTruthy())
  const retained = mockModelPresses[modelRecoveryLabel]
  await act(async () => { retained() })
  await waitFor(() => expect(screen.getByText('settingsSubsystem.operationReadbackFailed')).toBeTruthy())
  expect(screen.getByText('contextPanel.localModel.loadFailed')).toBeTruthy()
  expect(mockToast).not.toHaveBeenCalled()
  expect(f.adapter.removeItem).toHaveBeenCalledTimes(1)
  await act(async () => { retained() })
  expect(f.adapter.removeItem).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(screen.getAllByLabelText('common.retry')[0]).not.toBeDisabled())
  await fireEvent.press(screen.getAllByLabelText('common.retry')[0])
  await waitFor(() => expect(screen.getByText(f.model.name)).toBeTruthy())
  expect(screen.queryByText('settingsSubsystem.operationReadbackFailed')).toBeNull()
  expect(f.adapter.removeItem).toHaveBeenCalledTimes(1)
  expect(mockConfirm).toHaveBeenCalledTimes(1)
  f.assertPreserved()
})

it('model-index recovery waits for current model readback despite completed general reads and refuses retained duplicate callbacks', async () => {
  const f = modelRecoveryOwner()
  const readback = deferredModel<string | null>()
  f.adapter.removeItem.mockImplementationOnce(async key => {
    f.records.delete(key)
    f.adapter.getItem.mockImplementationOnce(async () => readback.promise)
  })
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeTruthy())
  const retained = mockModelPresses[modelRecoveryLabel]
  try {
    await act(async () => { retained() })
    await waitFor(() => expect(f.adapter.getItem).toHaveBeenCalledTimes(4))
    expect(mockDiagnosticsProps.selfTestBlocked).toBe(true)
    expect(mockToast).not.toHaveBeenCalled()
    expect(screen.queryByText(f.model.name)).toBeNull()
    await act(async () => { retained(); mockDiagnosticsProps.onRunSelfTest() })
    expect(f.adapter.removeItem).toHaveBeenCalledTimes(1)
    expect(mockReviewModelState).toHaveBeenCalledTimes(1)
    expect(mockConfirm).toHaveBeenCalledTimes(1)
    expect(mockSelfTest).not.toHaveBeenCalled()
  } finally {
    await act(async () => { readback.resolve(null) })
  }
  await waitFor(() => expect(screen.getByText(f.model.name)).toBeTruthy())
  expect(mockToast).toHaveBeenCalledTimes(1)
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.localModel.stateResetDone' }))
  f.assertPreserved()
})

it('model-index recovery retires an awaited model readback after acknowledged removal without rollback or late feedback', async () => {
  const f = modelRecoveryOwner()
  const readback = deferredModel<string | null>()
  f.adapter.removeItem.mockImplementationOnce(async key => {
    f.records.delete(key)
    f.adapter.getItem.mockImplementationOnce(async () => readback.promise)
  })
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeTruthy())
  try {
    await fireEvent.press(screen.getByRole('button', { name: modelRecoveryLabel }))
    await waitFor(() => expect(f.adapter.getItem).toHaveBeenCalledTimes(4))
    await screen.unmount()
  } finally {
    await act(async () => { readback.resolve(null) })
  }
  expect(f.records.has(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(false)
  expect(f.adapter.removeItem).toHaveBeenCalledTimes(1)
  expect(mockToast).not.toHaveBeenCalled()
  expect(mockNotice).not.toHaveBeenCalled()
  f.assertPreserved()
})

it('model-index recovery rereads current model preferences after changed-and-restored consent during removal readback without another reset or settings write', async () => {
  const f = modelRecoveryOwner()
  const readback = deferredModel<string | null>()
  f.adapter.removeItem.mockImplementationOnce(async key => {
    f.records.delete(key)
    f.adapter.getItem.mockImplementationOnce(async () => readback.promise)
  })
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeTruthy())
  try {
    await fireEvent.press(screen.getByRole('button', { name: modelRecoveryLabel }))
    await waitFor(() => expect(f.adapter.getItem).toHaveBeenCalledTimes(4))
    const selected = mockSettings.localEmbeddingModelId
    await act(async () => {
      publishModelSettings({ localEmbeddingModelId: 'newer-readback-selection' })
      publishModelSettings({ localEmbeddingModelId: selected })
    })
  } finally {
    await act(async () => { readback.resolve(null) })
  }
  await waitFor(() => expect(screen.getByText(f.model.name)).toBeTruthy())
  expect(mockLocalModels).toHaveBeenCalledTimes(3)
  expect(mockLocalModels.mock.calls[2][0]).toMatchObject({ localEmbeddingModelId: 'retained-selected-model' })
  expect(f.adapter.removeItem).toHaveBeenCalledTimes(1)
  expect(mockReviewModelState).toHaveBeenCalledTimes(1)
  expect(mockConfirm).toHaveBeenCalledTimes(1)
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'contextPanel.localModel.stateResetDone' }))
  f.assertPreserved()
})

it.each(['localEmbeddingModelId', 'localModelDownloadMirrorBaseUrl'] as const)('model-index recovery admission guard refuses changed-and-restored %s consent during awaited reset preflight', async key => {
  const f = modelRecoveryOwner()
  const preflight = deferredModel<string>()
  mockConfirm.mockImplementationOnce(async () => {
    f.adapter.getItem.mockImplementationOnce(async () => preflight.promise)
    return true
  })
  const screen = await render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: modelRecoveryLabel })).toBeTruthy())
  try {
    await fireEvent.press(screen.getByRole('button', { name: modelRecoveryLabel }))
    await waitFor(() => expect(f.adapter.getItem).toHaveBeenCalledTimes(3))
    const initial = mockSettings[key]
    await act(async () => {
      publishModelSettings({ [key]: 'changed-during-reset-preflight' })
      publishModelSettings({ [key]: initial })
    })
  } finally {
    await act(async () => { preflight.resolve(invalidModelIndex) })
  }
  await waitFor(() => expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy())
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(invalidModelIndex)
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  expect(mockToast).not.toHaveBeenCalled()
  expect(mockConfirm).toHaveBeenCalledTimes(1)
  f.assertPreserved()
})
