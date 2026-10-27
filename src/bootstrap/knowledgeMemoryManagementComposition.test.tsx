import AsyncStorage from '@react-native-async-storage/async-storage'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as SecureStore from 'expo-secure-store'
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import { ContextPanel } from '@/components/settings/ContextPanel'
import { SettingsEditBoundary } from '@/components/settings/SettingsEditBoundary'
import { IsleDialogProvider } from '@/components/ui/isle'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import {
  buildKnowledgeScope,
  createSqliteKnowledgeRepository,
  type KnowledgeMemoryRecord,
  type KnowledgeMemoryWrite,
} from '@/modules/knowledge'
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from '@/platform/storage'
import { useSettingsStore } from '@/store/settingsStore'
import type { AIProvider } from '@/types/providerContracts'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'
import { MAX_IMPORT_TEXT_FILE_BYTES } from '@/platform/native/boundedImportFile'
import { APPLICATION_DATA_STORAGE_KEYS } from './applicationDataRecords'
import { importKnowledgePlainText } from './knowledgeDocumentImportRuntime'
import {
  knowledgeAgenticIndex,
  knowledgeColbertIndex,
  knowledgeHybridIndex,
  knowledgeRepository,
} from './knowledgeRepository'
import { loadRagDebugSnapshot, loadRagEmbeddingJobSummary } from './knowledgeRagEvaluation'
import { loadCapabilityReferenceCatalog } from './settingsReferenceCatalog'

let mockDatabase: SqliteDatabase
const mockNavigationDispatch = jest.fn()
const mockPreventRemove = jest.fn()
const mockDeniedEffect = jest.fn((..._args: unknown[]) => {
  throw new Error('Supplier, native execution and model downloads are forbidden in this fixture')
})
const mockLocalEmbeddingResolution = jest.fn(async () => undefined)
function mockTranslate(key: string, values?: Record<string, unknown>) {
  const suffix = values?.title ?? values?.name ?? values?.count
  return suffix === undefined ? key : `${key}:${suffix}`
}
jest.mock('@/platform/storage/expoSqliteDatabase', () => ({
  ...jest.requireActual('@/platform/storage/expoSqliteDatabase'),
  createExpoSqliteDatabaseProvider: () => ({ get: async () => mockDatabase }),
}))
jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: mockNavigationDispatch }) }))
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args),
}))
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}))
jest.mock('@/i18n/service', () => ({
  ...jest.requireActual('@/i18n/service'), st: (key: string, values?: Record<string, unknown>) => mockTranslate(key, values),
}))
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => ({ width: 360, height: 640, fontScale: 1.6, scale: 1 }),
}))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('moti', () => ({
  MotiView: require('react-native').View, AnimatePresence: require('react').Fragment,
}))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/settings/SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }))
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///owned-knowledge-cache/', documentDirectory: 'file:///owned-knowledge-documents/',
  EncodingType: { UTF8: 'utf8', Base64: 'base64' }, getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(), writeAsStringAsync: jest.fn(), deleteAsync: jest.fn(),
}))
jest.mock('./providerRuntime', () => ({
  generateProviderText: (...args: unknown[]) => mockDeniedEffect(...args),
  embedProviderText: (...args: unknown[]) => mockDeniedEffect(...args),
}))
jest.mock('./knowledgeEmbeddingProvider', () => ({
  createOnnxEmbeddingProvider: (..._args: unknown[]) => mockLocalEmbeddingResolution(),
}))
jest.mock('./localModelRuntime', () => ({
  listLocalEmbeddingModelViews: jest.fn(async () => []),
  downloadLocalEmbeddingModel: (...args: unknown[]) => mockDeniedEffect(...args),
  deleteDownloadedLocalEmbeddingModel: (...args: unknown[]) => mockDeniedEffect(...args),
}))
jest.mock('./providerModelAvailabilityRuntime', () => ({
  providerModelAvailabilityRuntime: { invalidateAll: jest.fn(async () => undefined) },
}))
jest.mock('./conversationToolCatalog', () => ({
  listConversationToolManifests: jest.fn(async () => []),
}))
jest.mock('./conversationSkills', () => ({ listSkills: jest.fn(async () => []) }))
jest.mock('./agentDefinitionRepository', () => ({
  agentDefinitionRepository: { list: jest.fn(async () => []) },
}))
jest.mock('@/services/contextSelfTest', () => ({
  runContextSelfTest: (...args: unknown[]) => mockDeniedEffect(...args),
}))
jest.mock('@/services/runtimeHealthLog', () => ({
  logContextOperation: jest.fn(async () => undefined),
  logStorageOperationFailure: jest.fn(async () => undefined),
}))
jest.mock('@/platform/native/runtimeLog', () => ({
  readStoredRuntimeLogOptions: async () => ({ enabled: false }),
  appendRuntimeLog: jest.fn(async () => undefined),
}))

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// One fixture-owned database preserves singleton migration caches; every SQL entry shares its queue.
function hostDatabase() {
  const { DatabaseSync } = require('node:sqlite')
  const native = new DatabaseSync(':memory:')
  const events: { sql: string; parameters: readonly SqliteValue[] }[] = []
  const hooks: {
    beforeSql?: (sql: string, parameters: readonly SqliteValue[]) => Promise<void>
    afterSql?: (sql: string, parameters: readonly SqliteValue[]) => Promise<void>
  } = {}
  async function sql<Value>(source: string, parameters: readonly SqliteValue[], work: () => Value) {
    await hooks.beforeSql?.(source, parameters)
    events.push({ sql: source, parameters: [...parameters] })
    const result = work()
    await hooks.afterSql?.(source, parameters)
    return result
  }
  const executor: SqliteExecutor = {
    exec: source => sql(source, [], () => { native.exec(source) }),
    run: (source, parameters = []) => sql(source, parameters, () => {
      const result = native.prepare(source).run(...parameters)
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) }
    }),
    getFirst: <Row extends object>(source: string, parameters: readonly SqliteValue[] = []) =>
      sql(source, parameters, () => (native.prepare(source).get(...parameters) ?? null) as Row | null),
    getAll: <Row extends object>(source: string, parameters: readonly SqliteValue[] = []) =>
      sql(source, parameters, () => native.prepare(source).all(...parameters) as Row[]),
  }
  let tail = Promise.resolve()
  let pending = 0
  function enqueue<Value>(work: () => Promise<Value>) {
    pending += 1
    const result = tail.then(work, work)
    tail = result.then(() => { pending -= 1 }, () => { pending -= 1 })
    return result
  }
  const database: SqliteDatabase = {
    exec: source => enqueue(() => executor.exec(source)),
    run: (source, parameters) => enqueue(() => executor.run(source, parameters)),
    getFirst: (source, parameters) => enqueue(() => executor.getFirst(source, parameters)),
    getAll: (source, parameters) => enqueue(() => executor.getAll(source, parameters)),
    transaction: work => enqueue(async () => {
      native.exec('BEGIN IMMEDIATE'); events.push({ sql: 'BEGIN IMMEDIATE', parameters: [] })
      try {
        const value = await work(executor)
        native.exec('COMMIT'); events.push({ sql: 'COMMIT', parameters: [] })
        return value
      } catch (error) {
        native.exec('ROLLBACK'); events.push({ sql: 'ROLLBACK', parameters: [] })
        throw error
      }
    }),
  }
  async function idle() {
    for (;;) {
      const observed = tail
      await observed
      if (observed === tail && pending === 0) return
    }
  }
  return { native, database, provider: { get: async () => database }, events, hooks, idle, pending: () => pending }
}

const initial = useSettingsStore.getState()
const records = new Map<string, string>()
const provider: AIProvider = {
  id: 'saved-provider', name: 'Saved provider', type: 'openai-compatible', enabled: false,
  apiKey: '', baseUrl: 'https://knowledge-fixture.invalid/v1', models: [],
  modelAliases: [{ alias: 'saved-alias', model: 'group-model' }],
  credentialGroups: [{
    id: 'saved-group', label: 'Saved group', apiKey: '', enabled: true,
    lastModelSyncStatus: 'ok', availableModels: ['group-model'],
  }],
}
let host: ReturnType<typeof hostDatabase>
let originalSettings: string
let originalProviders: string
let originalRecords: [string, string][]
const screens: Awaited<ReturnType<typeof render>>[] = []
const encoder = Object.getOwnPropertyDescriptor(globalThis, 'TextEncoder')
beforeAll(async () => {
  if (!encoder) Object.defineProperty(globalThis, 'TextEncoder', {
    configurable: true, value: require('node:util').TextEncoder,
  })
  host = hostDatabase()
  mockDatabase = host.database
  await knowledgeRepository.listMemories()
  await knowledgeRepository.listDocuments()
  await knowledgeColbertIndex.synchronize([])
  await loadRagEmbeddingJobSummary()
  await loadRagDebugSnapshot()
  await host.idle()
})
afterAll(async () => {
  await host.idle()
  host.native.close()
  if (!encoder) Reflect.deleteProperty(globalThis, 'TextEncoder')
})
beforeEach(async () => {
  await host.idle()
  host.hooks.beforeSql = undefined; host.hooks.afterSql = undefined
  // Reset only this in-memory fixture, never installed application data or migration markers.
  const tables: { name: string }[] = host.native.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ).all()
  const roots = tables.filter(({ name }) =>
    !name.startsWith('platform_') && !/_(?:data|idx|content|docsize|config)$/.test(name))
  for (const { name } of roots) await host.database.exec(`DELETE FROM "${name.replaceAll('"', '""')}"`)
  host.events.length = 0
  jest.clearAllMocks()
  mockLocalEmbeddingResolution.mockResolvedValue(undefined)
  records.clear()
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => records.get(key) ?? null)
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { records.set(key, value) })
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => { records.delete(key) })
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null)
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: true, assets: null })
  jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({ exists: false, isDirectory: false, uri: '' })
  jest.mocked(FileSystem.readAsStringAsync).mockRejectedValue(new Error('Unselected native reads are forbidden'))
  jest.mocked(FileSystem.deleteAsync).mockResolvedValue(undefined)
  useSettingsStore.setState(initial, true)
  useSettingsStore.setState({
    providers: [provider], settings: {
      ...initial.settings, language: 'en', themeId: 'minimal', theme: 'light',
      hapticsEnabled: false, skillsEnabled: false, mcpEnabled: false,
      memoryEnabled: false, knowledgeEnabled: false, webSearchEnabled: false, searchProvider: 'off',
      embeddingMode: 'local', localEmbeddingModelSource: 'none',
      defaultProvider: provider.id,
      lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId: provider.id, model: 'saved-alias' },
    },
  })
  originalSettings = JSON.stringify(useSettingsStore.getState().settings)
  originalProviders = JSON.stringify(useSettingsStore.getState().providers)
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, originalSettings)
  records.set(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS, originalProviders)
  originalRecords = [...records]
})
afterEach(async () => {
  for (const screen of screens.splice(0)) await screen.unmount()
  await host.idle()
  try {
    expect(host.pending()).toBe(0)
    expect(mockDeniedEffect).not.toHaveBeenCalled()
    expect(JSON.stringify(useSettingsStore.getState().settings)).toBe(originalSettings)
    expect(JSON.stringify(useSettingsStore.getState().providers)).toBe(originalProviders)
    expect([...records]).toEqual(originalRecords)
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled()
    expect(AsyncStorage.clear).not.toHaveBeenCalled()
    expect(AsyncStorage.multiSet).not.toHaveBeenCalled()
    expect(AsyncStorage.multiRemove).not.toHaveBeenCalled()
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled()
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled()
  } finally {
    host.hooks.beforeSql = undefined; host.hooks.afterSql = undefined
    useSettingsStore.setState(initial, true)
  }
})

async function managementScreen(section: 'memory' | 'knowledge' = 'memory', focus?: 'import' | 'review') {
  const screen = await render(<IsleThemeProvider><IsleDialogProvider><SettingsEditBoundary>
    <ContextPanel providers={[provider]} section={section} focus={focus} />
  </SettingsEditBoundary></IsleDialogProvider></IsleThemeProvider>)
  screens.push(screen)
  return screen
}
type ManagementScreen = Awaited<ReturnType<typeof managementScreen>>
const dialogPanel = (screen: ManagementScreen) =>
  within(screen.getByTestId(/^(?:dialog-experience-|animal-island-dialog-panel$)/))
const freshRepository = () => createSqliteKnowledgeRepository(host.provider)
const memory = (id: string, overrides: Partial<KnowledgeMemoryWrite> = {}): KnowledgeMemoryWrite => ({
  id, content: `Reviewed memory ${id}`, status: 'pending', sourceKind: 'manual',
  createdAt: 100, updatedAt: 100, ...overrides,
})
async function seed() {
  const pending = await knowledgeRepository.saveMemory(memory('pending-main'))
  const active = await knowledgeRepository.saveMemory(memory('active-retained', { status: 'active' }))
  const disabled = await knowledgeRepository.saveMemory(memory('disabled-retained', { status: 'disabled' }))
  const imported = await importKnowledgePlainText(
    'Saved research notes', '# Research notes\nIsleMind keeps reviewed local evidence. Research remains paused.',
    undefined, { signal: new AbortController().signal, settings: useSettingsStore.getState().settings },
  )
  expect(imported.ok).toBe(true)
  const document = (await knowledgeRepository.listDocuments())[0]
  return { pending, active, disabled, document }
}
async function ready(screen: ManagementScreen, text: string) {
  await waitFor(() => expect(screen.queryByText(text) ?? screen.getByText(`- ${text}`)).toBeTruthy())
  expect(screen.queryByText('settingsSubsystem.loadFailed')).toBeNull()
}
async function pasteDraft(screen: ManagementScreen, title = 'New reviewed notes', text = 'New local knowledge without any supplier call.') {
  await fireEvent.press(screen.getByRole('button', { name: /^contextPanel\.pasteTextKnowledge\./ }))
  await fireEvent.changeText(screen.getByLabelText('contextPanel.knowledgeTitle'), title)
  await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), text)
}
function itemRow(screen: ManagementScreen, text: string) {
  let node = screen.getByText(text).parent
  while (node && !within(node).queryByLabelText('common.delete')) node = node.parent
  if (!node) throw new Error(`Missing asset row: ${text}`)
  return within(node)
}
const persistedMemory = async (id: string): Promise<KnowledgeMemoryRecord | undefined> =>
  (await freshRepository().listMemories()).find(item => item.id === id)
async function removal(_screen: ManagementScreen, action: object) {
  const [blocked, callback] = mockPreventRemove.mock.calls[mockPreventRemove.mock.calls.length - 1]
  expect(blocked).toBe(true)
  await act(async () => { callback({ data: { action } }) })
}
function selectedFile(text: string, name = 'Reviewed notes.md', mimeType = 'text/markdown', size = text.length) {
  const uri = 'file:///owned-knowledge-cache/selected-notes'
  const asset: DocumentPicker.DocumentPickerAsset = { uri, name, mimeType, size, lastModified: 1 }
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: false, assets: [asset] })
  jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({ exists: true, uri, isDirectory: false, size, modificationTime: 1 })
  jest.mocked(FileSystem.readAsStringAsync).mockImplementation(async selected => {
    if (selected !== uri) throw new Error('Unowned native read')
    return text
  })
  return uri
}
const writes = (fragment: string) => host.events.filter(event => event.sql.includes(fragment))
async function reviewQueue(screen: ManagementScreen) {
  await fireEvent.press(screen.getByTestId('memory-review-disclosure'))
  await waitFor(() => expect(screen.getByTestId('memory-review-summary')).toBeTruthy())
}
async function settledTurn() {
  await act(async () => { for (let index = 0; index < 16; index += 1) await Promise.resolve() })
}
async function importText(screen: ManagementScreen) {
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importPastedText' }))
}
async function deleteDialog(screen: ManagementScreen, name: string) {
  await fireEvent.press(itemRow(screen, name).getByLabelText('common.delete'))
  await waitFor(() => expect(screen.getByText('contextPanel.deleteItemTitle')).toBeTruthy())
}
async function confirmDelete(screen: ManagementScreen) {
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'common.delete' }))
}
async function clearDialog(screen: ManagementScreen, title: string) {
  await fireEvent.press(screen.getByLabelText(`contextPanel.clearTitle:${title}`))
  await waitFor(() => expect(screen.getByText('contextPanel.clearConfirm')).toBeTruthy())
}
function indexedChunks(documentId: string) {
  return host.native.prepare(
    'SELECT e.chunkId,e.source,e.status FROM chunk_embeddings e JOIN knowledge_chunks c ON e.chunkId = c.id WHERE c.documentId = ? ORDER BY e.chunkId',
  ).all(documentId)
}
async function seedPendingQueue() {
  const imported = await knowledgeRepository.saveMemory(memory('imported-pending', { sourceKind: 'imported', confidence: 0.45 }))
  const modeled = await knowledgeRepository.saveMemory(memory('model-pending', { sourceKind: 'model', confidence: 0.9 }))
  const active = await knowledgeRepository.saveMemory(memory('queue-active', { status: 'active' }))
  return { imported, modeled, active }
}

it('loads nonempty real memory and knowledge catalogs, SQL diagnostics and paused defaults without native or provider execution', async () => {
  const saved = await seed()
  const screen = await managementScreen()
  await ready(screen, saved.pending.content)
  for (const item of [saved.active, saved.disabled]) expect(screen.getByText(item.content)).toBeTruthy()
  expect(screen.getByTestId('memory-lifecycle-summary')).toBeTruthy()
  expect(screen.getByText('settingsSubsystem.paused')).toBeTruthy()
  expect(await freshRepository().listDocuments()).toEqual([saved.document])
  expect(await loadRagEmbeddingJobSummary()).toMatchObject({ total: 0, running: 0, error: 0 })
  const debug = await loadRagDebugSnapshot()
  expect(debug.indexingJobs.length).toBeGreaterThan(0)
  expect(debug.indexingJobs.every(job => job.status === 'done')).toBe(true)
  expect(writes('FROM embedding_jobs').length).toBeGreaterThan(0)
  expect(writes('FROM indexing_jobs').length).toBeGreaterThan(0)
})

it('confirms, disables and restores a nonempty memory through the actual page and reloads its SQLite status without enabling memory', async () => {
  const saved = await seed()
  let screen = await managementScreen()
  await ready(screen, saved.pending.content)
  await fireEvent.press(itemRow(screen, saved.pending.content).getByLabelText('contextPanel.confirmMemory'))
  await waitFor(() => expect(itemRow(screen, saved.pending.content).getByLabelText('contextPanel.disableMemory')).toBeTruthy())
  expect(await persistedMemory(saved.pending.id)).toMatchObject({ status: 'active', lastConfirmedAt: expect.any(Number) })
  await fireEvent.press(itemRow(screen, saved.pending.content).getByLabelText('contextPanel.disableMemory'))
  await waitFor(() => expect(itemRow(screen, saved.pending.content).getByLabelText('contextPanel.restoreMemory')).toBeTruthy())
  expect(await persistedMemory(saved.pending.id)).toMatchObject({ status: 'disabled' })
  await fireEvent.press(itemRow(screen, saved.pending.content).getByLabelText('contextPanel.restoreMemory'))
  await waitFor(() => expect(itemRow(screen, saved.pending.content).getByLabelText('contextPanel.disableMemory')).toBeTruthy())
  const active = await persistedMemory(saved.pending.id)
  await screen.unmount()
  screen = await managementScreen()
  await ready(screen, saved.pending.content)
  expect(await persistedMemory(saved.pending.id)).toEqual(active)
  expect(itemRow(screen, saved.pending.content).getByLabelText('contextPanel.disableMemory')).toBeTruthy()
  expect(await persistedMemory(saved.active.id)).toEqual(saved.active)
})

it('imports actual pasted text into canonical SQL records and all local indexes, clears only its saved draft and reloads cross-page references', async () => {
  const saved = await seed()
  let screen = await managementScreen('knowledge', 'import')
  await ready(screen, saved.document.title)
  await pasteDraft(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importPastedText' }))
  await waitFor(() => expect(screen.getByText('contextPanel.knowledgeUpdated')).toBeTruthy())
  expect(screen.getByLabelText('contextPanel.knowledgeTitle').props.value).toBe('')
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe('')
  const documents = await freshRepository().listDocuments()
  const added = documents.find(document => document.id !== saved.document.id)!
  expect(added).toMatchObject({ title: 'New reviewed notes', status: 'ready', chunkCount: 1, sourceUri: 'New reviewed notes' })
  const chunks = await freshRepository().listChunks(added.id)
  expect(chunks).toHaveLength(1)
  expect(chunks[0]).toMatchObject({ content: 'New local knowledge without any supplier call.', embeddingProvider: 'hash' })
  const embedding = host.native.prepare('SELECT source,status FROM chunk_embeddings WHERE chunkId = ?').get(chunks[0].id)
  expect(embedding).toEqual({ source: 'local', status: 'fallback' })
  expect(host.native.prepare('SELECT count(*) AS count FROM raptor_nodes WHERE documentId = ?').get(added.id).count).toBeGreaterThan(0)
  expect(await freshRepository().searchFts({ query: 'knowledge', limit: 8, knowledgeScope: buildKnowledgeScope([added.id]) })).not.toHaveLength(0)
  expect((await loadCapabilityReferenceCatalog()).knowledge).toEqual(expect.arrayContaining([
    { value: added.id, label: added.title }, { value: saved.document.id, label: saved.document.title },
  ]))
  expect(documents.find(document => document.id === saved.document.id)).toEqual(saved.document)
  await screen.unmount()
  screen = await managementScreen('knowledge')
  await ready(screen, added.title)
  expect(await freshRepository().listDocuments()).toEqual(documents)
  expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled()
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
})

it('fails closed on an actual SQL catalog read and retries without mutating the retained nonempty records', async () => {
  const saved = await seed()
  let fail = true
  host.hooks.beforeSql = async source => {
    if (fail && source.includes('FROM memories WHERE status')) { fail = false; throw new Error('Owned catalog read failed') }
  }
  const screen = await managementScreen()
  await waitFor(() => expect(screen.getByText('settingsSubsystem.loadFailed')).toBeTruthy())
  expect(screen.queryByText(saved.pending.content)).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await ready(screen, saved.pending.content)
  expect(await persistedMemory(saved.pending.id)).toEqual(saved.pending)
  expect(writes('DELETE FROM memories')).toHaveLength(0)
})

it('retains a reviewed memory after an actual SQL write failure and retries the same operation without overriding configured choices', async () => {
  const saved = await seed()
  const screen = await managementScreen()
  await ready(screen, saved.pending.content)
  let fail = true
  host.hooks.beforeSql = async source => {
    if (fail && source.includes('INSERT INTO memories')) { fail = false; throw new Error('Owned memory write failed') }
  }
  await fireEvent.press(itemRow(screen, saved.pending.content).getByLabelText('contextPanel.confirmMemory'))
  await waitFor(() => expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy())
  expect(await persistedMemory(saved.pending.id)).toEqual(saved.pending)
  await fireEvent.press(itemRow(screen, saved.pending.content).getByLabelText('contextPanel.confirmMemory'))
  await waitFor(() => expect(itemRow(screen, saved.pending.content).getByLabelText('contextPanel.disableMemory')).toBeTruthy())
  expect(await persistedMemory(saved.pending.id)).toMatchObject({ id: saved.pending.id, status: 'active' })
  expect(writes('ROLLBACK').length).toBeGreaterThan(0)
})

it('refuses an actual same-timestamp memory edit after page review and reads the competing value back instead of activating the stale item', async () => {
  const saved = await seed()
  const screen = await managementScreen()
  await ready(screen, saved.pending.content)
  const changed = await knowledgeRepository.saveMemory({ ...saved.pending, content: 'Concurrent unreviewed memory' })
  expect(changed.updatedAt).toBe(saved.pending.updatedAt)
  await fireEvent.press(itemRow(screen, saved.pending.content).getByLabelText('contextPanel.confirmMemory'))
  await waitFor(() => expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy())
  await ready(screen, changed.content)
  expect(await persistedMemory(saved.pending.id)).toEqual(changed)
})

it('requires the actual reviewed active logical fact and preserves supersession provenance on explicit memory confirmation', async () => {
  const active = await knowledgeRepository.saveMemory(memory('fact-active', { status: 'active', subject: 'User', key: 'color', value: 'Blue' }))
  const pending = await knowledgeRepository.saveMemory(memory('fact-pending', { subject: 'User', key: 'color', value: 'Amber' }))
  const screen = await managementScreen()
  await ready(screen, pending.content)
  await fireEvent.press(itemRow(screen, pending.content).getByLabelText('contextPanel.confirmMemory'))
  await waitFor(() => expect(itemRow(screen, pending.content).getByLabelText('contextPanel.disableMemory')).toBeTruthy())
  expect(await persistedMemory(active.id)).toMatchObject({ status: 'superseded' })
  expect(await persistedMemory(pending.id)).toMatchObject({ status: 'active', supersedesId: active.id })
  expect(await persistedMemory(pending.id)).not.toHaveProperty('conflictWithId')
  expect(screen.queryByText(active.content)).toBeNull()
})

it('guards an actual memory clear with its reviewed snapshot and retains a newly added unseen memory', async () => {
  const saved = await seed()
  const screen = await managementScreen()
  await ready(screen, saved.pending.content)
  await fireEvent.press(screen.getByLabelText('contextPanel.clearTitle:contextPanel.memoryCount:3'))
  await waitFor(() => expect(screen.getByText('contextPanel.clearConfirm')).toBeTruthy())
  const unseen = await knowledgeRepository.saveMemory(memory('unseen'))
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'contextPanel.clear' }))
  await ready(screen, unseen.content)
  expect(await freshRepository().listMemories()).toEqual([unseen])
  expect(await freshRepository().listDocuments()).toEqual([saved.document])
})

it('keeps and explicitly discards an actual pasted knowledge draft through the shared removal dialog without implicit SQL writes', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  await pasteDraft(screen)
  const action = { type: 'GO_BACK', source: 'owned-knowledge-route' }
  await removal(screen, action)
  await waitFor(() => expect(screen.getByText('settingsWorkspace.discardTitle')).toBeTruthy())
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'settingsWorkspace.keepEditing' }))
  await waitFor(() => expect(screen.queryByText('settingsWorkspace.discardTitle')).toBeNull())
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe('New local knowledge without any supplier call.')
  expect(mockNavigationDispatch).not.toHaveBeenCalled()
  await removal(screen, action)
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'settingsWorkspace.discard' }))
  await waitFor(() => expect(mockNavigationDispatch).toHaveBeenCalledWith(action))
  expect(mockNavigationDispatch).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe('')
  expect(await freshRepository().listDocuments()).toEqual([saved.document])
})

it('waits for admitted real index work after cancellation and reads its retained error document back without claiming rollback', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  await pasteDraft(screen, 'Cancelled reviewed notes')
  const entered = deferred<void>()
  const release = deferred<void>()
  host.hooks.beforeSql = async source => {
    if (source.includes('INSERT INTO chunk_embeddings')) { entered.resolve(); await release.promise }
  }
  try {
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importPastedText' }))
    await entered.promise
    const admitted = (await host.native.prepare('SELECT id,status FROM knowledge_documents WHERE title = ?').get('Cancelled reviewed notes'))
    expect(admitted.status).toBe('extracting')
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.cancelKnowledgeImport' }))
    expect(screen.getByRole('button', { name: 'contextPanel.cancellingKnowledgeImport' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).toBeDisabled()
    await removal(screen, { type: 'GO_BACK', source: 'busy-knowledge-route' })
    expect(mockNavigationDispatch).not.toHaveBeenCalled()
    expect(screen.queryByText('settingsWorkspace.discardTitle')).toBeNull()
    release.resolve()
    await waitFor(() => expect(screen.getByText('contextPanel.knowledgeImportCancelled')).toBeTruthy())
    const cancelled = (await freshRepository().listDocuments()).find(document => document.id === admitted.id)!
    expect(cancelled).toMatchObject({ title: 'Cancelled reviewed notes', status: 'error', chunkCount: 1 })
    expect(await freshRepository().listChunks(admitted.id)).toHaveLength(1)
    expect(screen.getByLabelText('contextPanel.knowledgeTitle').props.value).toBe('Cancelled reviewed notes')
    expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).not.toBeDisabled()
    expect(screen.queryByText('contextPanel.knowledgeUpdated')).toBeNull()
    expect((await freshRepository().listDocuments()).find(document => document.id === saved.document.id)).toEqual(saved.document)
  } finally { release.resolve(); await host.idle() }
})

it('imports a selected text file through the actual bounded reader and indexes while cleaning only the owned picker copy', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  const uri = selectedFile('# Selected notes\nReviewed text uses canonical local indexes.')
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' }))
  await waitFor(() => expect(screen.getByText('contextPanel.knowledgeUpdated')).toBeTruthy())
  const added = (await freshRepository().listDocuments()).find(document => document.id !== saved.document.id)!
  expect(added).toMatchObject({ title: 'Reviewed notes.md', sourceUri: 'Reviewed notes.md', status: 'ready' })
  expect(JSON.stringify(added)).not.toContain('file:///')
  expect(await freshRepository().listChunks(added.id)).toHaveLength(1)
  expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith(uri, { encoding: 'utf8' })
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1)
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true })
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled()
})

it('cancels then confirms the actual nonempty pending-memory batch and reloads both active records without execution grants', async () => {
  const saved = await seedPendingQueue()
  const screen = await managementScreen()
  await ready(screen, saved.imported.content)
  await reviewQueue(screen)
  const confirm = () => screen.getByLabelText('contextPanel.confirmPendingMemoriesTitle:2')
  await fireEvent.press(confirm())
  await waitFor(() => expect(screen.getByText('contextPanel.confirmPendingMemoriesMessage')).toBeTruthy())
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'common.cancel' }))
  await waitFor(() => expect(screen.queryByText('contextPanel.confirmPendingMemoriesMessage')).toBeNull())
  expect(await persistedMemory(saved.imported.id)).toEqual(saved.imported)
  expect(await persistedMemory(saved.modeled.id)).toEqual(saved.modeled)
  await fireEvent.press(confirm())
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'contextPanel.confirmPendingMemories:2' }))
  await waitFor(() => expect(screen.getByText('contextPanel.pendingMemoriesConfirmed:2')).toBeTruthy())
  const reloaded = await freshRepository().listMemories()
  expect(reloaded.filter(item => item.status === 'active')).toHaveLength(3)
  expect(reloaded.every(item => !('grants' in item))).toBe(true)
  expect(await persistedMemory(saved.active.id)).toEqual(saved.active)
})

it('shows partial persistence truthfully when one actual pending-memory batch item changes after review', async () => {
  const saved = await seedPendingQueue()
  const screen = await managementScreen()
  await ready(screen, saved.imported.content)
  await reviewQueue(screen)
  await fireEvent.press(screen.getByLabelText('contextPanel.confirmPendingMemoriesTitle:2'))
  await waitFor(() => expect(screen.getByText('contextPanel.confirmPendingMemoriesMessage')).toBeTruthy())
  const changed = await knowledgeRepository.saveMemory({ ...saved.modeled, sourceDetail: 'Changed after batch review' })
  expect(changed.updatedAt).toBe(saved.modeled.updatedAt)
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'contextPanel.confirmPendingMemories:2' }))
  await waitFor(() => expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy())
  expect(await persistedMemory(saved.imported.id)).toMatchObject({ status: 'active' })
  expect(await persistedMemory(saved.modeled.id)).toEqual(changed)
  expect(screen.queryByText('contextPanel.pendingMemoriesConfirmed:2')).toBeNull()
  expect(itemRow(screen, saved.modeled.content).getByLabelText('contextPanel.confirmMemory')).toBeTruthy()
})

it('rejects only the actual imported pending-memory filter after cancel and explicit confirmation', async () => {
  const saved = await seedPendingQueue()
  const screen = await managementScreen('memory', 'review')
  await ready(screen, saved.imported.content)
  expect(screen.queryByText(saved.modeled.content)).toBeNull()
  expect(screen.getByTestId('memory-review-focus')).toBeTruthy()
  const reject = () => screen.getByLabelText('contextPanel.rejectFilteredPendingMemoriesTitle:1')
  await fireEvent.press(reject())
  await waitFor(() => expect(screen.getByText('contextPanel.rejectFilteredPendingMemoriesMessage')).toBeTruthy())
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'common.cancel' }))
  expect(await persistedMemory(saved.imported.id)).toEqual(saved.imported)
  await fireEvent.press(reject())
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'contextPanel.rejectFilteredPendingMemories:1' }))
  await waitFor(() => expect(screen.getByText('contextPanel.pendingMemoriesRejected:1')).toBeTruthy())
  expect(await persistedMemory(saved.imported.id)).toBeUndefined()
  expect(await persistedMemory(saved.modeled.id)).toEqual(saved.modeled)
  expect(await persistedMemory(saved.active.id)).toEqual(saved.active)
})

it('confirms only the actual filtered imported memory and leaves the other pending queue unapproved', async () => {
  const saved = await seedPendingQueue()
  const screen = await managementScreen('memory', 'review')
  await ready(screen, saved.imported.content)
  await fireEvent.press(screen.getByLabelText('contextPanel.confirmFilteredPendingMemoriesTitle:1'))
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'contextPanel.confirmFilteredPendingMemories:1' }))
  await waitFor(() => expect(screen.getByText('contextPanel.pendingMemoriesConfirmed:1')).toBeTruthy())
  expect(await persistedMemory(saved.imported.id)).toMatchObject({ status: 'active' })
  expect(await persistedMemory(saved.modeled.id)).toEqual(saved.modeled)
  expect(await persistedMemory(saved.active.id)).toEqual(saved.active)
})

it('retires an open actual batch review on unmount without approving its persisted pending memories', async () => {
  const saved = await seedPendingQueue()
  const screen = await managementScreen()
  await ready(screen, saved.imported.content)
  await reviewQueue(screen)
  await fireEvent.press(screen.getByLabelText('contextPanel.confirmPendingMemoriesTitle:2'))
  await waitFor(() => expect(screen.getByText('contextPanel.confirmPendingMemoriesMessage')).toBeTruthy())
  await screen.unmount()
  await settledTurn()
  expect(await persistedMemory(saved.imported.id)).toEqual(saved.imported)
  expect(await persistedMemory(saved.modeled.id)).toEqual(saved.modeled)
})

it('refuses unseen or changed active logical fact authority rather than silently superseding it after memory page review', async () => {
  const pending = await knowledgeRepository.saveMemory(memory('fact-pending', { subject: 'User', key: 'color', value: 'Amber' }))
  const screen = await managementScreen()
  await ready(screen, pending.content)
  const unseen = await knowledgeRepository.saveMemory(memory('unseen-fact', {
    status: 'active', subject: 'User', key: 'color', value: 'Blue',
  }))
  await fireEvent.press(itemRow(screen, pending.content).getByLabelText('contextPanel.confirmMemory'))
  await waitFor(() => expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy())
  expect(await persistedMemory(pending.id)).toEqual(pending)
  expect(await persistedMemory(unseen.id)).toEqual(unseen)
  await ready(screen, unseen.content)
  const changed = await knowledgeRepository.saveMemory({ ...unseen, sourceDetail: 'Unreviewed fact provenance' })
  await fireEvent.press(itemRow(screen, pending.content).getByLabelText('contextPanel.confirmMemory'))
  await waitFor(() => expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy())
  await host.idle()
  expect(await persistedMemory(pending.id)).toEqual(pending)
  expect(await persistedMemory(unseen.id)).toEqual(changed)
})

it('cancels and then explicitly deletes a real memory from canonical and FTS storage while retaining the other assets', async () => {
  const saved = await seed()
  const screen = await managementScreen()
  await ready(screen, saved.pending.content)
  await deleteDialog(screen, saved.pending.content)
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'common.cancel' }))
  expect(await persistedMemory(saved.pending.id)).toEqual(saved.pending)
  await deleteDialog(screen, saved.pending.content)
  await confirmDelete(screen)
  await waitFor(() => expect(screen.queryByText(saved.pending.content)).toBeNull())
  expect(await persistedMemory(saved.pending.id)).toBeUndefined()
  expect(host.native.prepare('SELECT count(*) AS count FROM memory_fts WHERE id = ?').get(saved.pending.id).count).toBe(0)
  expect(await persistedMemory(saved.active.id)).toEqual(saved.active)
  expect(await freshRepository().listDocuments()).toEqual([saved.document])
})

it('rejects an actual memory deletion when its same-timestamp record changes during the real confirmation dialog', async () => {
  const saved = await seed()
  const screen = await managementScreen()
  await ready(screen, saved.pending.content)
  await deleteDialog(screen, saved.pending.content)
  const changed = await knowledgeRepository.saveMemory({ ...saved.pending, content: 'Concurrent deletion owner' })
  await confirmDelete(screen)
  await waitFor(() => expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy())
  await ready(screen, changed.content)
  expect(await persistedMemory(saved.pending.id)).toEqual(changed)
})

it('retires an open actual memory deletion dialog on unmount without deleting the persisted item', async () => {
  const saved = await seed()
  const screen = await managementScreen()
  await ready(screen, saved.pending.content)
  await deleteDialog(screen, saved.pending.content)
  await screen.unmount()
  await settledTurn()
  expect(await persistedMemory(saved.pending.id)).toEqual(saved.pending)
  expect(writes('DELETE FROM memories')).toHaveLength(0)
})

it('retires a confirmed memory deletion still queued behind owned SQL work when its real screen lifetime ends', async () => {
  const saved = await seed()
  const screen = await managementScreen()
  await ready(screen, saved.pending.content)
  await deleteDialog(screen, saved.pending.content)
  const entered = deferred<void>()
  const release = deferred<void>()
  const blocker = host.database.transaction(async () => { entered.resolve(); await release.promise })
  try {
    await entered.promise
    await confirmDelete(screen)
    await settledTurn()
    await screen.unmount()
    release.resolve()
    await blocker
    await host.idle()
    expect(await persistedMemory(saved.pending.id)).toEqual(saved.pending)
    expect(writes('DELETE FROM memories')).toHaveLength(0)
  } finally { release.resolve(); await blocker; await host.idle() }
})

it('cancels an actual memory clear and refuses a later clear of same-timestamp changed records without removing unchanged ones', async () => {
  const saved = await seed()
  const screen = await managementScreen()
  await ready(screen, saved.pending.content)
  await clearDialog(screen, 'contextPanel.memoryCount:3')
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'common.cancel' }))
  expect(await persistedMemory(saved.pending.id)).toEqual(saved.pending)
  await clearDialog(screen, 'contextPanel.memoryCount:3')
  const changed = await knowledgeRepository.saveMemory({ ...saved.disabled, sourceDetail: 'Changed during clear review' })
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'contextPanel.clear' }))
  await waitFor(() => expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy())
  expect(await persistedMemory(saved.pending.id)).toEqual(saved.pending)
  expect(await persistedMemory(saved.active.id)).toEqual(saved.active)
  expect(await persistedMemory(saved.disabled.id)).toEqual(changed)
})

it('distinguishes a committed memory status write from failed actual SQL readback and retries only the catalog read', async () => {
  const saved = await seed()
  const screen = await managementScreen()
  await ready(screen, saved.pending.content)
  let written = false
  let fail = true
  host.hooks.afterSql = async source => { if (source.includes('INSERT INTO memories')) written = true }
  host.hooks.beforeSql = async source => {
    if (written && fail && source.includes('FROM memories WHERE status')) { fail = false; throw new Error('Readback unavailable') }
  }
  const baseline = writes('INSERT INTO memories').length
  await fireEvent.press(itemRow(screen, saved.pending.content).getByLabelText('contextPanel.confirmMemory'))
  await waitFor(() => expect(screen.getByText('settingsSubsystem.operationReadbackFailed')).toBeTruthy())
  expect(screen.queryByText(saved.pending.content)).toBeNull()
  expect(await persistedMemory(saved.pending.id)).toMatchObject({ status: 'active' })
  expect(writes('INSERT INTO memories')).toHaveLength(baseline + 1)
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await ready(screen, saved.pending.content)
  expect(itemRow(screen, saved.pending.content).getByLabelText('contextPanel.disableMemory')).toBeTruthy()
  expect(writes('INSERT INTO memories')).toHaveLength(baseline + 1)
  expect(screen.queryByText('settingsSubsystem.operationReadbackFailed')).toBeNull()
})

it('fences an actual late memory catalog result after unmount and preserves all SQL records', async () => {
  const saved = await seed()
  const entered = deferred<void>()
  const release = deferred<void>()
  host.hooks.beforeSql = async source => {
    if (source.includes('FROM memories WHERE status')) { entered.resolve(); await release.promise }
  }
  const screen = await managementScreen()
  try {
    await entered.promise
    await screen.unmount()
    release.resolve()
    await host.idle()
    host.hooks.beforeSql = undefined
    expect(await persistedMemory(saved.pending.id)).toEqual(saved.pending)
    expect(mockNavigationDispatch).not.toHaveBeenCalled()
    expect(writes('DELETE FROM memories')).toHaveLength(0)
  } finally { release.resolve(); await host.idle() }
})

it('retains an actual pasted draft after canonical SQL save failure and explicitly retries without duplicating a committed document', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  await pasteDraft(screen)
  let fail = true
  host.hooks.beforeSql = async source => {
    if (fail && source.includes('INSERT OR REPLACE INTO knowledge_documents')) { fail = false; throw new Error('Document save failed') }
  }
  await importText(screen)
  await waitFor(() => expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy())
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe('New local knowledge without any supplier call.')
  expect(await freshRepository().listDocuments()).toEqual([saved.document])
  await waitFor(() => expect(screen.getByRole('button', { name: 'contextPanel.importPastedText' })).not.toBeDisabled())
  await importText(screen)
  await waitFor(() => expect(screen.getByText('contextPanel.knowledgeUpdated')).toBeTruthy())
  expect((await freshRepository().listDocuments()).filter(document => document.title === 'New reviewed notes')).toHaveLength(1)
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe('')
})

it('records actual failed index synchronization as a retained error document and exposes recovery without pretending import rollback', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  await pasteDraft(screen)
  let fail = true
  host.hooks.beforeSql = async source => {
    if (fail && source.includes('INSERT INTO chunk_embeddings')) { fail = false; throw new Error('Local index write failed') }
  }
  await importText(screen)
  await waitFor(() => expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy())
  const added = (await freshRepository().listDocuments()).find(document => document.id !== saved.document.id)!
  expect(added).toMatchObject({ title: 'New reviewed notes', status: 'error', error: 'Local index write failed', chunkCount: 1 })
  expect(await freshRepository().listChunks(added.id)).toHaveLength(1)
  expect(screen.getByTestId('knowledge-recovery-summary')).toBeTruthy()
  expect(screen.getByLabelText('contextPanel.knowledgeRecoveryShowFailed')).toBeTruthy()
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe('New local knowledge without any supplier call.')
  expect(screen.queryByText('contextPanel.knowledgeUpdated')).toBeNull()
})

it('does not repeat a successful actual text import when catalog readback fails and requires catalog retry before admitting another write', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  await pasteDraft(screen)
  let written = false
  let fail = true
  host.hooks.afterSql = async source => {
    if (source.includes('UPDATE knowledge_documents SET status')) written = true
  }
  host.hooks.beforeSql = async source => {
    if (written && fail && source.includes('FROM memories WHERE status')) { fail = false; throw new Error('Import readback failed') }
  }
  const baseline = writes('INSERT OR REPLACE INTO knowledge_documents').length
  await importText(screen)
  await waitFor(() => expect(screen.getByText('settingsSubsystem.operationReadbackFailed')).toBeTruthy())
  expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).toBeDisabled()
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe('')
  const added = (await freshRepository().listDocuments()).find(document => document.id !== saved.document.id)!
  expect(added.status).toBe('ready')
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await ready(screen, added.title)
  expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).not.toBeDisabled()
  expect(writes('INSERT OR REPLACE INTO knowledge_documents')).toHaveLength(baseline + 1)
  expect(screen.queryByText('contextPanel.knowledgeUpdated')).toBeNull()
})

it('keeps a changed actual pasted draft when the earlier reviewed import commits and blocks duplicate import and removal while admitted', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  await pasteDraft(screen)
  const entered = deferred<void>()
  const release = deferred<void>()
  host.hooks.beforeSql = async source => {
    if (source.includes('INSERT INTO chunk_embeddings')) { entered.resolve(); await release.promise }
  }
  try {
    await importText(screen)
    await entered.promise
    expect(screen.getByRole('button', { name: 'contextPanel.importPastedText' })).toBeDisabled()
    await importText(screen)
    await removal(screen, { type: 'GO_BACK', source: 'pending-import-route' })
    expect(mockNavigationDispatch).not.toHaveBeenCalled()
    expect(screen.queryByText('settingsWorkspace.discardTitle')).toBeNull()
    await fireEvent.changeText(screen.getByLabelText('contextPanel.knowledgeTitle'), 'Later unsaved draft')
    await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Later unreviewed text')
    release.resolve()
    await waitFor(() => expect(screen.getByText('contextPanel.knowledgeUpdated')).toBeTruthy())
    expect(screen.getByLabelText('contextPanel.knowledgeTitle').props.value).toBe('Later unsaved draft')
    expect(screen.getByLabelText('contextPanel.body').props.value).toBe('Later unreviewed text')
    const added = (await freshRepository().listDocuments()).filter(document => document.id !== saved.document.id)
    expect(added).toHaveLength(1)
    expect(added[0].title).toBe('New reviewed notes')
    expect((await freshRepository().listChunks(added[0].id))[0].content).toBe('New local knowledge without any supplier call.')
    expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled()
  } finally { release.resolve(); await host.idle() }
})

it('invalidates actual pasted-draft discard consent when the draft changes and is restored during the shared dialog', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  await pasteDraft(screen)
  const action = { type: 'GO_BACK', source: 'changed-draft-route' }
  await removal(screen, action)
  await waitFor(() => expect(screen.getByText('settingsWorkspace.discardTitle')).toBeTruthy())
  await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Changed during consent')
  await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'New local knowledge without any supplier call.')
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'settingsWorkspace.discard' }))
  await waitFor(() => expect(screen.queryByText('settingsWorkspace.discardTitle')).toBeNull())
  expect(mockNavigationDispatch).not.toHaveBeenCalled()
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe('New local knowledge without any supplier call.')
  expect(await freshRepository().listDocuments()).toEqual([saved.document])
})

it('retires a pasted import queued at its canonical SQL write on actual unmount without admitting an unreviewed new document', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  await pasteDraft(screen)
  const entered = deferred<void>()
  const release = deferred<void>()
  host.hooks.beforeSql = async source => {
    if (source.includes('INSERT OR REPLACE INTO knowledge_documents')) { entered.resolve(); await release.promise }
  }
  try {
    await importText(screen)
    await entered.promise
    await screen.unmount()
    release.resolve()
    await host.idle()
    await settledTurn()
    expect(await freshRepository().listDocuments()).toEqual([saved.document])
    expect(mockNavigationDispatch).not.toHaveBeenCalled()
  } finally { release.resolve(); await host.idle() }
})

it('does not roll back a canonical document already saved when its actual screen unmounts before the owned index work settles', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  await pasteDraft(screen)
  const entered = deferred<void>()
  const release = deferred<void>()
  host.hooks.beforeSql = async source => {
    if (source.includes('INSERT INTO chunk_embeddings')) { entered.resolve(); await release.promise }
  }
  try {
    await importText(screen)
    await entered.promise
    await screen.unmount()
    release.resolve()
    await host.idle()
    await settledTurn()
    const added = (await freshRepository().listDocuments()).find(document => document.id !== saved.document.id)!
    expect(added).toMatchObject({ title: 'New reviewed notes', status: 'error', chunkCount: 1 })
    expect(await freshRepository().listChunks(added.id)).toHaveLength(1)
    expect(mockNavigationDispatch).not.toHaveBeenCalled()
  } finally { release.resolve(); await host.idle() }
})

it('refuses a second actual pasted import until a successful catalog retry resolves committed-write readback debt', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  await pasteDraft(screen)
  let written = false
  let fail = true
  host.hooks.afterSql = async source => {
    if (source.includes('UPDATE knowledge_documents SET status')) written = true
  }
  host.hooks.beforeSql = async source => {
    if (written && fail && source.includes('FROM memories WHERE status')) {
      fail = false
      throw new Error('Committed import catalog remains unread')
    }
  }
  await importText(screen)
  await waitFor(() => expect(screen.getByText('settingsSubsystem.operationReadbackFailed')).toBeTruthy())
  await fireEvent.changeText(screen.getByLabelText('contextPanel.knowledgeTitle'), 'Second unreviewed admission')
  await fireEvent.changeText(screen.getByLabelText('contextPanel.body'), 'Second draft must wait for explicit readback')
  await importText(screen)
  await waitFor(() => expect(screen.queryByText('contextPanel.importing')).toBeNull())
  await host.idle()
  const beforeRetry = await freshRepository().listDocuments()
  expect(beforeRetry).toHaveLength(2)
  expect(beforeRetry.some(document => document.title === 'Second unreviewed admission')).toBe(false)
  expect(screen.getByLabelText('contextPanel.body').props.value).toBe('Second draft must wait for explicit readback')
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await ready(screen, 'New reviewed notes')
  await importText(screen)
  await waitFor(() => expect(screen.getByText('contextPanel.knowledgeUpdated')).toBeTruthy())
  expect(await freshRepository().listDocuments()).toHaveLength(3)
})

it.each([
  ['oversized', 'notes.md', 'text/markdown', MAX_IMPORT_TEXT_FILE_BYTES + 1, 'chat.fileTooLarge20'],
  ['unsupported', 'notes.png', 'image/png', 16, 'contextImport.unsupportedFileType'],
  ['PDF without credentials', 'notes.pdf', 'application/pdf', 16, 'contextImport.pdfNeedsKey'],
] as const)('refuses actual %s file admission without supplier execution or changing the retained SQL catalog', async (_case, name, mime, size, message) => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  const uri = selectedFile('Not imported', name, mime, size)
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' }))
  await waitFor(() => expect(screen.getByText(message)).toBeTruthy())
  expect(screen.getByText('settings.importSkipped')).toBeTruthy()
  expect(await freshRepository().listDocuments()).toEqual([saved.document])
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true })
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1)
})

it('rejects an invalid actual picker filename after owning its copy and cleans that copy without native read or SQL save', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  const uri = selectedFile('Invalid picker text', '../outside.md')
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' }))
  await waitFor(() => expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy())
  expect(await freshRepository().listDocuments()).toEqual([saved.document])
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true })
})

it('retains the actual knowledge catalog after native text-read failure and retries a separately selected file without leaking owned copies', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  const uri = selectedFile('Retry reviewed text')
  jest.mocked(FileSystem.readAsStringAsync).mockRejectedValueOnce(new Error('Owned native read failed'))
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' }))
  await waitFor(() => expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy())
  expect(await freshRepository().listDocuments()).toEqual([saved.document])
  await waitFor(() => expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).not.toBeDisabled())
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' }))
  await waitFor(() => expect(screen.getByText('contextPanel.knowledgeUpdated')).toBeTruthy())
  expect(await freshRepository().listDocuments()).toHaveLength(2)
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(2)
  expect(jest.mocked(FileSystem.deleteAsync).mock.calls.every(([selected]) => selected === uri)).toBe(true)
})

it('waits for the actual picker after cancellation and reopens admission only after cleanup and catalog readback settle', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  const uri = selectedFile('Cancelled selected text')
  const picked = jest.mocked(DocumentPicker.getDocumentAsync).getMockImplementation()!
  const entered = deferred<void>()
  const release = deferred<void>()
  jest.mocked(DocumentPicker.getDocumentAsync).mockImplementation(async options => {
    entered.resolve(); await release.promise
    return picked(options)
  })
  try {
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' }))
    await entered.promise
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.cancelKnowledgeImport' }))
    expect(screen.getByRole('button', { name: 'contextPanel.cancellingKnowledgeImport' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).toBeDisabled()
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled()
    release.resolve()
    await waitFor(() => expect(screen.getByText('contextPanel.knowledgeImportCancelled')).toBeTruthy())
    expect(await freshRepository().listDocuments()).toEqual([saved.document])
    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true })
    expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).not.toBeDisabled()
  } finally { release.resolve(); await host.idle(); await settledTurn() }
})

it('fences an actual late selected file after unmount and cleans only its owned picker copy without importing or dispatching', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  const uri = selectedFile('Retired selected text')
  const picked = jest.mocked(DocumentPicker.getDocumentAsync).getMockImplementation()!
  const entered = deferred<void>()
  const release = deferred<void>()
  const settled = deferred<void>()
  jest.mocked(DocumentPicker.getDocumentAsync).mockImplementation(async options => {
    entered.resolve(); await release.promise
    return picked(options)
  })
  jest.mocked(FileSystem.deleteAsync).mockImplementation(async selected => {
    expect(selected).toBe(uri)
    settled.resolve()
  })
  try {
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' }))
    await entered.promise
    await screen.unmount()
    release.resolve()
    await settled.promise
    await settledTurn()
    expect(await freshRepository().listDocuments()).toEqual([saved.document])
    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
    expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1)
    expect(mockNavigationDispatch).not.toHaveBeenCalled()
  } finally { release.resolve(); await host.idle(); await settledTurn() }
})

it('cancels then deletes an actual knowledge item across canonical and local indexes and removes its cross-page reference', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  expect(indexedChunks(saved.document.id)).toHaveLength(1)
  await deleteDialog(screen, saved.document.title)
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'common.cancel' }))
  expect(await freshRepository().listDocuments()).toEqual([saved.document])
  expect(indexedChunks(saved.document.id)).toHaveLength(1)
  await deleteDialog(screen, saved.document.title)
  await confirmDelete(screen)
  await waitFor(() => expect(screen.getByText('contextPanel.noKnowledgeFiles')).toBeTruthy())
  expect(await freshRepository().listDocuments()).toEqual([])
  expect(await freshRepository().listChunks(saved.document.id)).toEqual([])
  expect(host.native.prepare('SELECT count(*) AS count FROM chunk_embeddings').get().count).toBe(0)
  expect(host.native.prepare('SELECT count(*) AS count FROM colbert_embeddings').get().count).toBe(0)
  expect(host.native.prepare('SELECT count(*) AS count FROM raptor_nodes').get().count).toBe(0)
  expect(host.native.prepare('SELECT count(*) AS count FROM graph_entities').get().count).toBe(0)
  expect(host.native.prepare('SELECT count(*) AS count FROM indexing_jobs').get().count).toBe(0)
  expect((await loadCapabilityReferenceCatalog()).knowledge).toEqual([])
  expect(await persistedMemory(saved.pending.id)).toEqual(saved.pending)
})

it('refuses an actual same-timestamp knowledge deletion after dialog review before touching its local index records', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  await deleteDialog(screen, saved.document.title)
  const changed = { ...saved.document, sourceUri: 'Changed provenance after review' }
  await knowledgeRepository.saveDocument(changed, await knowledgeRepository.listChunks(saved.document.id))
  const before = indexedChunks(saved.document.id)
  const baseline = writes('DELETE FROM chunk_embeddings').length
  await confirmDelete(screen)
  await waitFor(() => expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy())
  expect(await freshRepository().listDocuments()).toEqual([changed])
  expect(indexedChunks(saved.document.id)).toEqual(before)
  expect(writes('DELETE FROM chunk_embeddings')).toHaveLength(baseline)
})

it('retires an open actual knowledge deletion dialog on unmount and retains canonical chunks and local indexes', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  const before = indexedChunks(saved.document.id)
  await deleteDialog(screen, saved.document.title)
  await screen.unmount()
  await settledTurn()
  expect(await freshRepository().listDocuments()).toEqual([saved.document])
  expect(indexedChunks(saved.document.id)).toEqual(before)
})

it('cancels an actual knowledge clear then removes only its reviewed document and retains a new unseen indexed document', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  await clearDialog(screen, 'contextPanel.knowledgeCount:1')
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'common.cancel' }))
  expect(await freshRepository().listDocuments()).toEqual([saved.document])
  await clearDialog(screen, 'contextPanel.knowledgeCount:1')
  await importKnowledgePlainText('Unseen indexed notes', 'Unseen local knowledge remains retained.', undefined, {
    signal: new AbortController().signal, settings: useSettingsStore.getState().settings,
  })
  const unseen = (await freshRepository().listDocuments()).find(document => document.id !== saved.document.id)!
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'contextPanel.clear' }))
  await ready(screen, unseen.title)
  expect(await freshRepository().listDocuments()).toEqual([unseen])
  expect(await freshRepository().listChunks(saved.document.id)).toEqual([])
  expect(indexedChunks(unseen.id)).toHaveLength(1)
  expect((await loadCapabilityReferenceCatalog()).knowledge).toEqual([{ value: unseen.id, label: unseen.title }])
  expect(await persistedMemory(saved.pending.id)).toEqual(saved.pending)
})

it('refuses a stale actual knowledge clear without removing the reviewed canonical document or its indexes', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  await clearDialog(screen, 'contextPanel.knowledgeCount:1')
  const changed = { ...saved.document, title: 'Concurrent reviewed document owner' }
  await knowledgeRepository.saveDocument(changed, await knowledgeRepository.listChunks(saved.document.id))
  const before = indexedChunks(saved.document.id)
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'contextPanel.clear' }))
  await waitFor(() => expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy())
  await ready(screen, changed.title)
  expect(await freshRepository().listDocuments()).toEqual([changed])
  expect(indexedChunks(saved.document.id)).toEqual(before)
})

it('blocks actual file import after an initial SQL catalog failure until explicit retry without opening the picker', async () => {
  const saved = await seed()
  let fail = true
  host.hooks.beforeSql = async source => {
    if (fail && source.includes('FROM memories WHERE status')) { fail = false; throw new Error('Initial catalog unavailable') }
  }
  const screen = await managementScreen('knowledge')
  await waitFor(() => expect(screen.getByText('settingsSubsystem.loadFailed')).toBeTruthy())
  expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).toBeDisabled()
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' }))
  expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await ready(screen, saved.document.title)
  expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).not.toBeDisabled()
  expect(await freshRepository().listDocuments()).toEqual([saved.document])
})

it('keeps actual import admission closed while the first nonempty SQL catalog read is still outstanding', async () => {
  const saved = await seed()
  const entered = deferred<void>()
  const release = deferred<void>()
  host.hooks.beforeSql = async source => {
    if (source.includes('FROM memories WHERE status')) { entered.resolve(); await release.promise }
  }
  const screen = await managementScreen('knowledge')
  try {
    await entered.promise
    expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).toBeDisabled()
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' }))
    expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled()
    release.resolve()
    await ready(screen, saved.document.title)
    expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).not.toBeDisabled()
    expect(await freshRepository().listDocuments()).toEqual([saved.document])
  } finally { release.resolve(); await host.idle() }
})

it('retains partial actual pending-memory persistence behind failed catalog readback and retries only the read before reopening batch admission', async () => {
  const saved = await seedPendingQueue()
  const screen = await managementScreen()
  await ready(screen, saved.imported.content)
  await reviewQueue(screen)
  await fireEvent.press(screen.getByLabelText('contextPanel.confirmPendingMemoriesTitle:2'))
  const changed = await knowledgeRepository.saveMemory({ ...saved.modeled, sourceDetail: 'Concurrent pending provenance' })
  let fail = true
  host.hooks.beforeSql = async source => {
    if (fail && source.includes('FROM memories WHERE status')) { fail = false; throw new Error('Partial batch readback unavailable') }
  }
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'contextPanel.confirmPendingMemories:2' }))
  await waitFor(() => expect(screen.getByText('settingsSubsystem.loadFailed')).toBeTruthy())
  expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy()
  expect(screen.queryByText('settingsSubsystem.operationReadbackFailed')).toBeNull()
  expect(screen.queryByText('contextPanel.pendingMemoriesConfirmed:2')).toBeNull()
  expect(await persistedMemory(saved.imported.id)).toMatchObject({ status: 'active' })
  expect(await persistedMemory(saved.modeled.id)).toEqual(changed)
  const before = writes('INSERT INTO memories').length
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await ready(screen, changed.content)
  expect(writes('INSERT INTO memories')).toHaveLength(before)
  expect(itemRow(screen, changed.content).getByLabelText('contextPanel.confirmMemory')).toBeTruthy()
})

it('keeps actual file import readback debt through a second failed catalog retry without reselecting or reimporting its committed document', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  selectedFile('File remains committed when acknowledgment cannot be read.')
  let written = false
  let remainingFailures = 2
  host.hooks.afterSql = async source => {
    if (source.includes('UPDATE knowledge_documents SET status')) written = true
  }
  host.hooks.beforeSql = async source => {
    if (written && remainingFailures > 0 && source.includes('FROM memories WHERE status')) {
      remainingFailures -= 1
      throw new Error('File catalog readback remains unavailable')
    }
  }
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' }))
  await waitFor(() => expect(screen.getByText('settingsSubsystem.operationReadbackFailed')).toBeTruthy())
  expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).toBeDisabled()
  const documents = await freshRepository().listDocuments()
  expect(documents).toHaveLength(2)
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await waitFor(() => expect(remainingFailures).toBe(0))
  await waitFor(() => expect(screen.getByText('settingsSubsystem.loadFailed')).toBeTruthy())
  expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).toBeDisabled()
  await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' }))
  expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledTimes(1)
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await ready(screen, 'Reviewed notes.md')
  expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).not.toBeDisabled()
  expect(await freshRepository().listDocuments()).toEqual(documents)
  expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledTimes(1)
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('contextPanel.knowledgeUpdated')).toBeNull()
})

it('cancels actual file reading without releasing admission before the owned native read settles and its copy is cleaned', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  const uri = selectedFile('Cancelled during actual bounded text reading.')
  const entered = deferred<void>()
  const release = deferred<void>()
  jest.mocked(FileSystem.readAsStringAsync).mockImplementation(async selected => {
    expect(selected).toBe(uri)
    entered.resolve(); await release.promise
    return 'Cancelled selected text'
  })
  try {
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' }))
    await entered.promise
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.cancelKnowledgeImport' }))
    expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'contextPanel.cancellingKnowledgeImport' })).toBeDisabled()
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled()
    release.resolve()
    await waitFor(() => expect(screen.getByText('contextPanel.knowledgeImportCancelled')).toBeTruthy())
    expect(await freshRepository().listDocuments()).toEqual([saved.document])
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true })
    expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).not.toBeDisabled()
  } finally { release.resolve(); await host.idle(); await settledTurn() }
})

it('does not release an actual successful file import until owned native-copy cleanup settles', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  const uri = selectedFile('Committed file awaiting owned cleanup.')
  const entered = deferred<void>()
  const release = deferred<void>()
  jest.mocked(FileSystem.deleteAsync).mockImplementation(async selected => {
    expect(selected).toBe(uri)
    entered.resolve(); await release.promise
  })
  try {
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' }))
    await entered.promise
    expect(await freshRepository().listDocuments()).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).toBeDisabled()
    expect(screen.queryByText('contextPanel.knowledgeUpdated')).toBeNull()
    await removal(screen, { type: 'GO_BACK', source: 'owned-cleanup-route' })
    expect(mockNavigationDispatch).not.toHaveBeenCalled()
    release.resolve()
    await waitFor(() => expect(screen.getByText('contextPanel.knowledgeUpdated')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).not.toBeDisabled()
    expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1)
  } finally { release.resolve(); await host.idle(); await settledTurn() }
})

it('keeps actual cancelled-import readback debt after its adapter settles and retries only catalog read before admitting new work', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  await pasteDraft(screen)
  const entered = deferred<void>()
  const release = deferred<void>()
  let failReadback = false
  host.hooks.beforeSql = async source => {
    if (source.includes('INSERT INTO chunk_embeddings')) { entered.resolve(); await release.promise }
    if (failReadback && source.includes('FROM memories WHERE status')) {
      failReadback = false
      throw new Error('Cancelled import readback unavailable')
    }
  }
  try {
    await importText(screen)
    await entered.promise
    failReadback = true
    await fireEvent.press(screen.getByRole('button', { name: 'contextPanel.cancelKnowledgeImport' }))
    release.resolve()
    await waitFor(() => expect(screen.getByText('contextPanel.knowledgeImportCancelled')).toBeTruthy())
    expect(screen.getByText('settingsSubsystem.loadFailed')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).toBeDisabled()
    const recordsBeforeRetry = await freshRepository().listDocuments()
    expect(recordsBeforeRetry).toHaveLength(2)
    expect(recordsBeforeRetry.find(document => document.id !== saved.document.id)?.status).toBe('error')
    const before = writes('INSERT OR REPLACE INTO knowledge_documents').length
    await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
    await ready(screen, 'New reviewed notes')
    expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).not.toBeDisabled()
    expect(await freshRepository().listDocuments()).toEqual(recordsBeforeRetry)
    expect(writes('INSERT OR REPLACE INTO knowledge_documents')).toHaveLength(before)
    expect(screen.getByLabelText('contextPanel.body').props.value).toBe('New local knowledge without any supplier call.')
  } finally { release.resolve(); await host.idle() }
})

it('repairs actual knowledge indexes when a late canonical deletion conflict wins after derived-index cleanup', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  await deleteDialog(screen, saved.document.title)
  let changed = false
  host.hooks.afterSql = async (source, parameters) => {
    if (!changed && source.includes("DELETE FROM indexing_jobs") && source.includes('raptor-lite') &&
      parameters[0] === saved.document.id) {
      changed = true
      host.native.prepare('UPDATE knowledge_documents SET sourceUri = ? WHERE id = ?').run(
        'Late canonical deletion owner', saved.document.id,
      )
    }
  }
  await confirmDelete(screen)
  await waitFor(() => expect(screen.getByText('settingsWorkspace.conflict')).toBeTruthy())
  expect(changed).toBe(true)
  expect(await freshRepository().listDocuments()).toEqual([{ ...saved.document, sourceUri: 'Late canonical deletion owner' }])
  expect(await freshRepository().listChunks(saved.document.id)).toHaveLength(1)
  expect(indexedChunks(saved.document.id)).toHaveLength(1)
  expect(host.native.prepare('SELECT count(*) AS count FROM colbert_embeddings').get().count).toBeGreaterThan(0)
  expect(host.native.prepare('SELECT count(*) AS count FROM raptor_nodes WHERE documentId = ?').get(saved.document.id).count).toBeGreaterThan(0)
  expect(mockLocalEmbeddingResolution).toHaveBeenCalled()
  expect(await persistedMemory(saved.pending.id)).toEqual(saved.pending)
})

it('distinguishes an actual canonical knowledge deletion from failed catalog readback and retries no destructive operation', async () => {
  const saved = await seed()
  const screen = await managementScreen('knowledge')
  await ready(screen, saved.document.title)
  await deleteDialog(screen, saved.document.title)
  let deleted = false
  let fail = true
  host.hooks.afterSql = async source => {
    if (source.startsWith('DELETE FROM knowledge_documents')) deleted = true
  }
  host.hooks.beforeSql = async source => {
    if (deleted && fail && source.includes('FROM memories WHERE status')) { fail = false; throw new Error('Deletion catalog readback failed') }
  }
  await confirmDelete(screen)
  await waitFor(() => expect(screen.getByText('settingsSubsystem.operationReadbackFailed')).toBeTruthy())
  expect(await freshRepository().listDocuments()).toEqual([])
  expect(screen.getByRole('button', { name: 'contextPanel.importKnowledgeFile' })).toBeDisabled()
  const before = writes('DELETE FROM knowledge_documents').length
  expect(before).toBe(1)
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await waitFor(() => expect(screen.getByText('contextPanel.noKnowledgeFiles')).toBeTruthy())
  expect(writes('DELETE FROM knowledge_documents')).toHaveLength(before)
  expect(await persistedMemory(saved.pending.id)).toEqual(saved.pending)
})

describe.each(CANONICAL_THEME_IDS)('actual %s knowledge/memory host controls', family => {
  it.each(['light', 'dark'] as const)('preserves nonempty catalogs, paused defaults and the actual %s unsaved dialog without persistence', async theme => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, themeId: family, theme } })
    originalSettings = JSON.stringify(useSettingsStore.getState().settings)
    records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, originalSettings)
    originalRecords = [...records]
    const saved = await seed()
    const memoryScreen = await managementScreen()
    await ready(memoryScreen, saved.pending.content)
    expect(memoryScreen.getByTestId('memory-lifecycle-summary')).toBeTruthy()
    expect(memoryScreen.getByText('settingsSubsystem.paused')).toBeTruthy()
    await memoryScreen.unmount()
    const screen = await managementScreen('knowledge')
    await ready(screen, saved.document.title)
    await pasteDraft(screen)
    await removal(screen, { type: 'GO_BACK', source: 'theme-knowledge-route' })
    await waitFor(() => expect(screen.getByText('settingsWorkspace.discardTitle')).toBeTruthy())
    await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'settingsWorkspace.keepEditing' }))
    await waitFor(() => expect(screen.queryByText('settingsWorkspace.discardTitle')).toBeNull())
    expect(screen.getByLabelText('contextPanel.body').props.value).toBe('New local knowledge without any supplier call.')
    expect(await freshRepository().listDocuments()).toEqual([saved.document])
    expect(mockNavigationDispatch).not.toHaveBeenCalled()
  })
})
