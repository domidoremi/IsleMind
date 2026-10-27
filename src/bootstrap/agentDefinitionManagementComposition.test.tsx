import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import { IsleDialogProvider } from '@/components/ui/isle'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { AgentDefinitionsScreen } from '@/presentation/features/settings/AgentDefinitionsScreen'
import { useSettingsStore } from '@/store/settingsStore'
import {
  createAgentDefinition,
  createAgentDefinitionManagement,
  createSqliteAgentDefinitionRepository,
  encodeAgentDefinition,
  type AgentDefinitionRepository,
} from '@/modules/assistant-runtime'
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from '@/platform/storage'
import type { AIProvider } from '@/types/providerContracts'
import { loadSettingsReferenceCatalog } from './settingsReferenceCatalog'

const mockDispatch = jest.fn()
const mockPreventRemove = jest.fn()
let mockReferenceRepository: AgentDefinitionRepository
jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: mockDispatch }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: { name?: string }) => values?.name ? `${key}:${values.name}` : key }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('./agentDefinitionRepository', () => ({ agentDefinitionRepository: {
  list: (options: Parameters<AgentDefinitionRepository['list']>[0]) => mockReferenceRepository.list(options),
} }))
jest.mock('./conversationToolCatalog', () => ({ listConversationToolManifests: jest.fn(async () => [
  { id: 'builtin:info', name: 'App information' },
]) }))
jest.mock('./knowledgeRepository', () => ({ knowledgeRepository: { listDocuments: jest.fn(async () => [
  { id: 'doc-1', title: 'Project notes' },
]) } }))
jest.mock('./conversationSkills', () => ({ listSkills: jest.fn(async () => [
  { id: 'skill-1', name: 'Research notes' },
]) }))

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>(yes => { resolve = yes })
  return { promise, resolve }
}

// Match the platform's serialized SQL operations; :memory: is host evidence only.
function hostDatabase() {
  const { DatabaseSync } = require('node:sqlite')
  const native = new DatabaseSync(':memory:')
  const events: string[] = []
  const hooks: {
    beforeSql?: (sql: string) => Promise<void>
    afterSql?: (sql: string) => Promise<void>
  } = {}
  async function sql<Value>(source: string, work: () => Value) {
    await hooks.beforeSql?.(source)
    events.push(source)
    const result = work()
    await hooks.afterSql?.(source)
    return result
  }
  const executor: SqliteExecutor = {
    exec: source => sql(source, () => { native.exec(source) }),
    run: (source, parameters = []) => sql(source, () => {
      const result = native.prepare(source).run(...parameters)
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) }
    }),
    getFirst: <Row extends object>(source: string, parameters: readonly SqliteValue[] = []) =>
      sql(source, () => (native.prepare(source).get(...parameters) ?? null) as Row | null),
    getAll: <Row extends object>(source: string, parameters: readonly SqliteValue[] = []) =>
      sql(source, () => native.prepare(source).all(...parameters) as Row[]),
  }
  let tail = Promise.resolve()
  function enqueue<Value>(work: () => Promise<Value>) {
    const result = tail.then(work, work)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
  const database: SqliteDatabase = {
    exec: source => enqueue(() => executor.exec(source)),
    run: (source, parameters) => enqueue(() => executor.run(source, parameters)),
    getFirst: (source, parameters) => enqueue(() => executor.getFirst(source, parameters)),
    getAll: (source, parameters) => enqueue(() => executor.getAll(source, parameters)),
    transaction: work => enqueue(async () => {
      native.exec('BEGIN IMMEDIATE')
      events.push('BEGIN IMMEDIATE')
      try {
        const value = await work(executor)
        native.exec('COMMIT'); events.push('COMMIT')
        return value
      } catch (error) {
        native.exec('ROLLBACK'); events.push('ROLLBACK')
        throw error
      }
    }),
  }
  return { native, database, provider: { get: async () => database }, events, hooks, idle: () => tail }
}

const initial = useSettingsStore.getState()
const themeCases = (['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'] as const)
  .flatMap(family => (['light', 'dark'] as const).map(mode => [family, mode] as const))
const provider: AIProvider = {
  id: 'provider', name: 'Configured provider', type: 'openai-compatible',
  apiKey: '', baseUrl: 'https://fixture.invalid/v1', models: ['saved-alias'], enabled: false,
}
beforeEach(() => {
  jest.clearAllMocks()
  useSettingsStore.setState({ providers: [provider], settings: {
    ...initial.settings, themeId: 'minimal', hapticsEnabled: false, defaultProvider: provider.id,
    lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId: provider.id, model: 'saved-alias' },
  } })
})
afterEach(() => { useSettingsStore.setState(initial, true) })

async function fixture(additional = false) {
  const host = hostDatabase()
  const repository = createSqliteAgentDefinitionRepository(host.provider)
  const original = await repository.save({
    ...createAgentDefinition({ id: 'agent-main', name: 'Research', providerId: provider.id, modelId: 'saved-alias' }),
    knowledgeIds: ['missing-doc'],
  })
  if (additional) {
    await repository.save(createAgentDefinition({ id: 'agent-delegate', name: 'Delegate', providerId: provider.id, modelId: 'saved-alias' }))
    await repository.save(createAgentDefinition({ id: 'agent-reviewer', name: 'Reviewer', providerId: provider.id, modelId: 'saved-alias' }))
  }
  const files = {
    selectJsonFile: jest.fn(async () => ({ ok: true as const, json: encodeAgentDefinition({ ...original, id: 'outside-source', name: 'Imported Research' }) })),
    exportJsonFile: jest.fn(async (_json: string) => ({ uri: 'fixture-only-export' })),
  }
  const management = createAgentDefinitionManagement({ repository, files, newId: () => 'agent-imported' })
  mockReferenceRepository = repository
  return { ...host, repository, original, files, management }
}
function screen(management: ReturnType<typeof createAgentDefinitionManagement>) {
  return render(<IsleThemeProvider><IsleDialogProvider>
    <AgentDefinitionsScreen management={management} loadReferences={loadSettingsReferenceCatalog} />
  </IsleDialogProvider></IsleThemeProvider>)
}
async function openOriginal(view: Awaited<ReturnType<typeof screen>>) {
  await waitFor(() => expect(view.getByRole('button', { name: 'agents.editNamed:Research' })).toBeTruthy())
  await fireEvent.press(view.getByRole('button', { name: 'agents.editNamed:Research' }))
  await waitFor(() => expect(view.getByLabelText('agents.fields.name')).toBeTruthy())
}

it('saves real Agent reference selections in SQLite and reloads them through fresh management and screen instances without granting execution', async () => {
  const host = await fixture(true)
  const settingsBefore = useSettingsStore.getState().settings
  let view = await screen(host.management)
  try {
    await openOriginal(view)
    await fireEvent.changeText(view.getByLabelText('agents.fields.name'), 'Reviewed Research')
    await fireEvent.press(view.getByRole('button', { name: 'agents.capabilities.text_only' }))
    await fireEvent.press(view.getByLabelText('agents.capabilities.native_tool_calling'))
    await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.advanced' }))
    await waitFor(() => expect(view.getByText('missing-doc · agents.unresolved')).toBeTruthy())
    const choose = async (index: number, label: string) => {
      await fireEvent.press(view.getAllByRole('button', { name: 'settingsReferences.choose' })[index])
      await fireEvent.press(view.getByLabelText(label))
    }
    await choose(0, 'App information')
    await choose(1, 'Project notes')
    await choose(2, 'Research notes')
    await choose(3, 'Delegate')
    await fireEvent.press(view.getByRole('button', { name: 'agents.reviewerModes.off' }))
    await fireEvent.press(view.getByLabelText('agents.reviewerModes.read_only'))
    await choose(4, 'Reviewer')
    expect(await host.repository.get(host.original.id)).toEqual(host.original)
    await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(view.getByText('agents.saved')).toBeTruthy())
    const saved = await host.repository.get(host.original.id)
    expect(saved).toMatchObject({
      name: 'Reviewed Research', revision: 2, knowledgeIds: ['missing-doc', 'doc-1'],
      allowedToolIds: ['builtin:info'], skillIds: ['skill-1'], delegateAgentIds: ['agent-delegate'],
      reviewerPolicy: { mode: 'read_only', agentId: 'agent-reviewer', maxReviews: 1 },
      modelBinding: { providerId: provider.id, modelId: 'saved-alias', actionCapability: 'native_tool_calling' },
    })
    const row = host.native.prepare('SELECT definitionJson FROM assistant_agent_definitions WHERE id = ?').get(host.original.id)
    expect(JSON.parse(row.definitionJson)).toEqual(saved)
    expect(saved).not.toHaveProperty('grants')
    expect(host.files.selectJsonFile).not.toHaveBeenCalled()
    expect(host.files.exportJsonFile).not.toHaveBeenCalled()
    expect(useSettingsStore.getState().settings).toBe(settingsBefore)
    await view.unmount()
    const reopened = createSqliteAgentDefinitionRepository(host.provider)
    mockReferenceRepository = reopened
    view = await screen(createAgentDefinitionManagement({ repository: reopened, files: host.files, newId: () => 'unused' }))
    await waitFor(() => expect(view.getByRole('button', { name: 'agents.editNamed:Reviewed Research' })).toBeTruthy())
    await fireEvent.press(view.getByRole('button', { name: 'agents.editNamed:Reviewed Research' }))
    await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.advanced' }))
    await waitFor(() => expect(view.getByText('Project notes')).toBeTruthy())
    for (const label of ['App information', 'Research notes', 'Delegate', 'Reviewer', 'missing-doc · agents.unresolved']) {
      expect(view.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(view.getByRole('button', { name: 'common.save' })).toBeDisabled()
    expect(await reopened.get(host.original.id)).toEqual(saved)
  } finally { await view.unmount(); await host.idle(); host.native.close() }
})

it('keeps a stale real Agent draft and refuses a confirmed deletion when the stored revision changes', async () => {
  const host = await fixture()
  const view = await screen(host.management)
  try {
    await openOriginal(view)
    await fireEvent.changeText(view.getByLabelText('agents.fields.name'), 'My local draft')
    const concurrent = await host.repository.save({ ...host.original, name: 'Concurrent owner' }, host.original.revision)
    await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(view.getByText('agents.conflict')).toBeTruthy())
    expect(view.getByLabelText('agents.fields.name').props.value).toBe('My local draft')
    expect(await host.repository.get(host.original.id)).toEqual(concurrent)
    await fireEvent.press(view.getByRole('button', { name: 'common.delete' }))
    expect(view.getByText('agents.deleteTitle')).toBeTruthy()
    await fireEvent.press(view.getByText('common.confirm'))
    await waitFor(() => expect(view.getByText('agents.conflict')).toBeTruthy())
    await host.idle()
    expect(await host.repository.get(host.original.id)).toEqual(concurrent)
    expect(view.queryByText('agents.deleted')).toBeNull()
    expect(view.getByLabelText('agents.fields.name').props.value).toBe('My local draft')
  } finally { await view.unmount(); await host.idle(); host.native.close() }
})

it('retires a confirmed Agent deletion that is still waiting in the real platform-shaped SQL queue when the screen unmounts', async () => {
  const host = await fixture()
  const view = await screen(host.management)
  const entered = deferred<void>()
  const release = deferred<void>()
  let blocker: Promise<void> | undefined
  try {
    await waitFor(() => expect(view.getByText('Research')).toBeTruthy())
    await fireEvent.press(view.getByRole('button', { name: 'common.delete' }))
    blocker = host.database.transaction(async () => { entered.resolve(); await release.promise })
    await entered.promise
    await fireEvent.press(view.getByText('common.confirm'))
    await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() })
    await view.unmount()
    release.resolve()
    await blocker
    await host.idle()
    expect(await host.repository.get(host.original.id)).toEqual(host.original)
    expect(host.events.filter(sql => sql.startsWith('DELETE FROM assistant_agent_definitions'))).toEqual([])
  } finally {
    release.resolve(); await blocker
    await view.unmount(); await host.idle(); host.native.close()
  }
})

it('keeps an already-executed Agent deletion successful when cancellation arrives before its receipt returns', async () => {
  const host = await fixture()
  const controller = new AbortController()
  try {
    host.hooks.afterSql = async sql => { if (sql.startsWith('DELETE FROM assistant_agent_definitions')) controller.abort() }
    await expect(host.repository.remove(host.original.id, host.original.revision, controller.signal)).resolves.toBeUndefined()
    expect(controller.signal.aborted).toBe(true)
    expect(await host.repository.get(host.original.id)).toBeUndefined()
    expect(host.events.filter(sql => sql.startsWith('DELETE FROM assistant_agent_definitions'))).toHaveLength(1)
  } finally { await host.idle(); host.native.close() }
})

it('rolls back a pending real Agent save when its screen lifetime ends and leaves the previous SQLite definition unchanged', async () => {
  const host = await fixture()
  const view = await screen(host.management)
  const entered = deferred<void>()
  const release = deferred<void>()
  try {
    await openOriginal(view)
    await fireEvent.changeText(view.getByLabelText('agents.fields.name'), 'Retired draft')
    host.hooks.beforeSql = async sql => {
      if (sql.includes('INSERT INTO assistant_agent_definitions')) { entered.resolve(); await release.promise }
    }
    await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
    await entered.promise
    await view.unmount()
    release.resolve()
    await host.idle()
    expect(await host.repository.get(host.original.id)).toEqual(host.original)
    expect(host.events.at(-2)).toBe('ROLLBACK')
  } finally { release.resolve(); await view.unmount(); await host.idle(); host.native.close() }
})

it('composes real import preview, explicit SQLite save and confirmed export of saved rather than unsaved Agent data', async () => {
  const host = await fixture()
  const view = await screen(host.management)
  try {
    await fireEvent.press(view.getByRole('button', { name: 'agents.import' }))
    await waitFor(() => expect(view.getByText('agents.importPreview')).toBeTruthy())
    expect(await host.repository.list()).toEqual([host.original])
    await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(view.getByText('agents.saved')).toBeTruthy())
    const imported = await host.repository.get('agent-imported')
    expect(imported).toEqual({ ...host.original, id: 'agent-imported', name: 'Imported Research' })
    await fireEvent.changeText(view.getByLabelText('agents.fields.name'), 'Unexported draft')
    await fireEvent.press(view.getAllByRole('button', { name: 'agents.export' })[0])
    await fireEvent.press(within(view.getByTestId('dialog-experience-minimal')).getByText('common.cancel'))
    expect(host.files.exportJsonFile).not.toHaveBeenCalled()
    await fireEvent.press(view.getAllByRole('button', { name: 'agents.export' })[0])
    await fireEvent.press(view.getByText('common.confirm'))
    await waitFor(() => expect(host.files.exportJsonFile).toHaveBeenCalledTimes(1))
    expect(JSON.parse(host.files.exportJsonFile.mock.calls[0][0])).toEqual(imported)
    expect(view.getByLabelText('agents.fields.name').props.value).toBe('Unexported draft')
    expect(await host.repository.get('agent-imported')).toEqual(imported)
  } finally { await view.unmount(); await host.idle(); host.native.close() }
})

it('composes the real Agent unsaved dialog with single-flight native leave consent without mutating saved data', async () => {
  const host = await fixture()
  const view = await screen(host.management)
  try {
    await openOriginal(view)
    await fireEvent.changeText(view.getByLabelText('agents.fields.name'), 'Unsaved Research')
    const [, remove] = mockPreventRemove.mock.calls.at(-1)!
    const action = { type: 'GO_BACK' }
    await act(async () => { remove({ data: { action } }); remove({ data: { action } }) })
    expect(view.getAllByText('agents.discardTitle')).toHaveLength(1)
    await fireEvent.press(within(view.getByTestId('dialog-experience-minimal')).getByText('common.cancel'))
    expect(mockDispatch).not.toHaveBeenCalled()
    expect(view.getByLabelText('agents.fields.name').props.value).toBe('Unsaved Research')
    await act(async () => { remove({ data: { action } }) })
    await fireEvent.press(view.getByText('common.confirm'))
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith(action))
    expect(await host.repository.get(host.original.id)).toEqual(host.original)
  } finally { await view.unmount(); await host.idle(); host.native.close() }
})

it.each(themeCases)('saves and reloads %s %s Agent references and settles real delete dialogs against SQLite without altering global preferences', async (family, mode) => {
  const host = await fixture()
  useSettingsStore.setState(state => ({ settings: { ...state.settings, themeId: family, theme: mode, fontSize: 24 } }))
  const settingsBefore = useSettingsStore.getState().settings
  let view = await screen(host.management)
  try {
    await fireEvent.press(view.getByRole('button', { name: 'agents.create' }))
    await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.advanced' }))
    await waitFor(() => expect(view.queryByText('common.loading')).toBeNull())
    await fireEvent.press(view.getAllByText('settingsReferences.choose')[1])
    await fireEvent.press(view.getByText('Project notes'))
    expect(await host.repository.get('agent-imported')).toBeUndefined()
    await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(view.getByText('agents.saved')).toBeTruthy())
    const saved = await host.repository.get('agent-imported')
    expect(saved).toMatchObject({ knowledgeIds: ['doc-1'], modelBinding: { actionCapability: 'text_only' } })
    await view.unmount()
    const reopened = createSqliteAgentDefinitionRepository(host.provider)
    mockReferenceRepository = reopened
    view = await screen(createAgentDefinitionManagement({ repository: reopened, files: host.files, newId: () => 'unused' }))
    await waitFor(() => expect(view.getByRole('button', { name: 'agents.editNamed:agents.newName' })).toBeTruthy())
    await fireEvent.press(view.getByRole('button', { name: 'agents.editNamed:agents.newName' }))
    await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.advanced' }))
    await waitFor(() => expect(view.getByText('Project notes')).toBeTruthy())
    const dialog = () => within(view.getByTestId(family === 'animal-island-ui' ? 'animal-island-dialog-panel' : `dialog-experience-${family}`))
    await fireEvent.press(view.getAllByRole('button', { name: 'common.delete' })[0])
    await fireEvent.press(dialog().getByText('common.cancel'))
    expect(await reopened.get('agent-imported')).toEqual(saved)
    await fireEvent.press(view.getAllByRole('button', { name: 'common.delete' })[0])
    await fireEvent.press(dialog().getByText('common.confirm'))
    await waitFor(() => expect(view.getByText('agents.deleted')).toBeTruthy())
    expect(await reopened.get('agent-imported')).toBeUndefined()
    expect(await reopened.get(host.original.id)).toEqual(host.original)
    expect(useSettingsStore.getState().settings).toBe(settingsBefore)
    expect(host.files.selectJsonFile).not.toHaveBeenCalled()
    expect(host.files.exportJsonFile).not.toHaveBeenCalled()
  } finally { await view.unmount(); await host.idle(); host.native.close() }
})
