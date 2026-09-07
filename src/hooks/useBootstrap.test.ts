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

const mockLoad = jest.fn().mockResolvedValue(undefined)
const mockSetError = jest.fn()
const mockRunRecovery = jest.fn()
const mockTaskRecovery = jest.fn()

jest.mock('@/store/chatStore', () => ({
  useChatStore: Object.assign((select: (state: unknown) => unknown) => select({ load: mockLoad }), {
    getState: () => ({ setError: mockSetError }),
  }),
}))
jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign((select: (state: unknown) => unknown) => select({ load: mockLoad }), {
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
