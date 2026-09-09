import { act, renderHook, waitFor } from '@testing-library/react-native'
// Reuse the repository's CommonJS test transform for dynamic imports. Jest 29's
// Expo preset leaves import() untransformed, and VM modules conflict with its
// Reanimated setup. The hook source itself is executed unchanged.
const filename = require('node:path').join(__dirname, 'useBootstrap.ts')
const { transformTypeScriptModule } = require('../../scripts/node-ts-support')
const hookModule = { exports: {} as typeof import('./useBootstrap') }
new Function('require', 'module', 'exports', transformTypeScriptModule(
  require('node:fs').readFileSync(filename, 'utf8'), filename,
))(require, hookModule, hookModule.exports)
const { useBootstrap } = hookModule.exports

const mockLoadChats = jest.fn().mockResolvedValue(undefined)
const mockLoadSettings = jest.fn().mockResolvedValue(undefined)
const mockSetError = jest.fn()
const mockRunRecovery = jest.fn()
const mockTaskRecovery = jest.fn()

jest.mock('@/store/chatStore', () => ({
  useChatStore: Object.assign((select: (state: unknown) => unknown) => select({ load: mockLoadChats }), {
    getState: () => ({ setError: mockSetError }),
  }),
}))
jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign((select: (state: unknown) => unknown) => select({ load: mockLoadSettings }), {
    getState: () => ({ settings: { language: 'en', autoUpdateCheckEnabled: false } }),
  }),
}))
jest.mock('./useAppTheme', () => ({ useAppTheme: () => ({ colors: { surface: '#000' } }) }))
jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: jest.fn() }))
jest.mock('@/i18n', () => ({ initI18n: jest.fn() }))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))
jest.mock('@/bootstrap/portableImportRecovery', () => ({ recoverInterruptedPortableImport: jest.fn().mockResolvedValue({ status: 'none' }) }))
jest.mock('@/bootstrap/portableDataApplication', () => ({ initializePortableDataApplication: jest.fn() }))
jest.mock('@/bootstrap/conversationReplyStart', () => ({ initializeConversationReplyStart: jest.fn() }))
jest.mock('@/bootstrap/conversationSkills', () => ({ initializeConversationSkills: jest.fn() }))
jest.mock('@/bootstrap/conversationStorePersistence', () => ({ initializeConversationStorePersistence: jest.fn() }))
jest.mock('@/bootstrap/conversationComposerDrafts', () => ({ initializeConversationComposerDraftPersistence: jest.fn() }))
jest.mock('@/bootstrap/settingsStorePersistence', () => ({ initializeSettingsStorePersistence: jest.fn() }))
jest.mock('@/bootstrap/conversationAssistantDetachedWorkRegistry', () => ({ cancelAllConversationAssistantDetachedWork: jest.fn() }))
jest.mock('@/presentation/features/conversations/plainChatCommand', () => ({ recoverChatRuns: (...args: unknown[]) => mockRunRecovery(...args) }))
jest.mock('@/bootstrap/conversationRuntime', () => ({ createConversationRuntime: jest.fn() }))
jest.mock('@/bootstrap/taskRuntime', () => ({ recoverInterruptedTasks: (...args: unknown[]) => mockTaskRecovery(...args) }))
jest.mock('@/bootstrap/workflowCheckpointRecovery', () => ({ recoverWorkflowCheckpoints: jest.fn().mockResolvedValue({ completion: 'completed', failedCount: 0 }) }))
jest.mock('@/bootstrap/conversationWorkspaceWritebackRecoveryRuntime', () => ({ recoverConversationWorkspaceWritebackReceipts: jest.fn().mockResolvedValue({ status: 'completed', ambiguousReceiptCount: 0, failedReceiptCount: 0 }) }))
jest.mock('@/services/apkInstallCache', () => ({ clearStagedApkDownloads: jest.fn() }))
jest.mock('@/platform/native/androidApkUpdates', () => ({}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockLoadChats.mockReset().mockResolvedValue(undefined)
  mockLoadSettings.mockReset().mockResolvedValue(undefined)
  mockRunRecovery.mockResolvedValue([])
  mockTaskRecovery.mockResolvedValue({ ok: true, value: [] })
})

it('does not admit new Chat work while old runs or tasks are still being recovered', async () => {
  const runs = deferred<unknown[]>()
  const tasks = deferred<unknown>()
  mockRunRecovery.mockReturnValue(runs.promise)
  mockTaskRecovery.mockReturnValue(tasks.promise)
  const { result } = await renderHook(() => useBootstrap())
  await waitFor(() => expect(mockRunRecovery).toHaveBeenCalledTimes(1))
  expect(result.current.ready).toBe(false)
  await act(async () => runs.resolve([]))
  await waitFor(() => expect(mockTaskRecovery).toHaveBeenCalledTimes(1))
  expect(result.current.ready).toBe(false)
  await act(async () => tasks.resolve({ ok: true, value: [] }))
  await waitFor(() => expect(result.current.ready).toBe(true))
})

it('keeps admission closed on recovery failure and allows an explicit startup retry', async () => {
  mockTaskRecovery.mockResolvedValueOnce({ ok: false, error: { message: 'durable store unavailable' } })
  const { result } = await renderHook(() => useBootstrap())
  await waitFor(() => expect(result.current.status).toBe('blocked'))
  expect(result.current.ready).toBe(false)
  await act(async () => result.current.retry())
  await waitFor(() => expect(result.current.ready).toBe(true))
  expect(mockTaskRecovery).toHaveBeenCalledTimes(2)
})

it('does not treat failed Chat hydration as an empty store even if later runtime recovery could succeed', async () => {
  mockLoadChats.mockRejectedValueOnce(new Error('NoModificationAllowedError: storage is held by another tab'))
  const { result } = await renderHook(() => useBootstrap())
  await waitFor(() => expect(result.current.status).toBe('blocked'))
  expect(result.current.ready).toBe(false)
  expect(result.current.failure?.reference).toBe('BOOT-STARTUP')
  expect(mockRunRecovery).not.toHaveBeenCalled()
  expect(mockTaskRecovery).not.toHaveBeenCalled()
  expect(mockLoadChats).toHaveBeenCalledTimes(1)
})

it('retries failed hydration once on an explicit request and keeps admission closed until hydration and recovery finish', async () => {
  const retryLoad = deferred<void>()
  const retryTasks = deferred<unknown>()
  mockLoadChats.mockRejectedValueOnce(new Error('storage unavailable')).mockReturnValueOnce(retryLoad.promise)
  mockTaskRecovery.mockReturnValueOnce(retryTasks.promise)
  const { result } = await renderHook(() => useBootstrap())
  await waitFor(() => expect(result.current.status).toBe('blocked'))
  await act(async () => {
    result.current.retry()
    result.current.retry()
  })
  await waitFor(() => expect(mockLoadChats).toHaveBeenCalledTimes(2))
  expect(result.current.status).toBe('loading')
  expect(result.current.ready).toBe(false)
  expect(mockRunRecovery).not.toHaveBeenCalled()
  await act(async () => retryLoad.resolve())
  await waitFor(() => expect(mockTaskRecovery).toHaveBeenCalledTimes(1))
  expect(result.current.ready).toBe(false)
  await act(async () => retryTasks.resolve({ ok: true, value: [] }))
  await waitFor(() => expect(result.current.ready).toBe(true))
  expect(result.current.failure).toBeNull()
  expect(mockLoadSettings).toHaveBeenCalledTimes(2)
  expect(mockRunRecovery).toHaveBeenCalledTimes(1)
  expect(mockSetError.mock.calls.filter(([value]) => value === null)).toHaveLength(1)
})

it('preserves the existing nonblocking settings-failure policy when Chat hydration and recovery succeed', async () => {
  mockLoadSettings.mockRejectedValueOnce(new Error('optional settings unavailable'))
  const { result } = await renderHook(() => useBootstrap())
  await waitFor(() => expect(result.current.ready).toBe(true))
  expect(result.current.errorCount).toBe(1)
  expect(mockRunRecovery).toHaveBeenCalledTimes(1)
  expect(mockTaskRecovery).toHaveBeenCalledTimes(1)
})
