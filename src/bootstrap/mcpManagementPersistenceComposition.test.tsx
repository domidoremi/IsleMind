import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import { McpSettingsContent } from '@/components/settings/McpSettingsContent'
import { SettingsEditBoundary } from '@/components/settings/SettingsEditBoundary'
import { IsleDialogProvider } from '@/components/ui/isle'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { useSettingsStore } from '@/store/settingsStore'
import {
  bindSettingsStorePersistence,
  flushPersistedSettings,
  releaseSettingsStorePersistence,
} from '@/presentation/features/settings/settingsStorePersistenceCommand'
import type { McpServerConfig } from '@/types/mcpContracts'
import { APPLICATION_DATA_STORAGE_KEYS } from './applicationDataRecords'
import { listMcpServers, mcpClient } from './mcpCatalog'
import { settingsStorePersistence } from './settingsStorePersistence'

jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: jest.fn() }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
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
jest.mock('@/bootstrap/taskRuntime', () => ({
  createTaskRuntime: () => ({ getTask: () => null }),
}))
jest.mock('@/bootstrap/builtInCapabilityRuntime', () => ({
  createBuiltInCapabilityRuntimeBinding: () => ({
    enabledToolNames: [], resolveAdapter: () => undefined,
  }),
  createBuiltInCapabilityTaskAdmissionPort: () => ({}),
}))
jest.mock('@/bootstrap/builtInWorkspaceFileRuntime', () => ({
  builtInWorkspaceFileReadPort: {}, builtInWritableWorkspaceFilePort: undefined,
}))
jest.mock('@/bootstrap/androidTrustedWebFetch', () => ({ androidTrustedWebFetchPorts: {} }))
jest.mock('@/bootstrap/tavilyRemoteWebCrawl', () => ({ createTavilyRemoteWebCrawlPort: () => ({}) }))
jest.mock('@/bootstrap/webSearchProviderRuntime', () => ({ builtInWebSearchPort: {} }))
jest.mock('@/bootstrap/pluginManifest', () => ({
  createPluginManifestFromMcpServer: () => ({
    mcp: [], permissions: [], requiredCapabilities: [], review: { state: 'unreviewed' },
  }),
  validatePluginManifest: () => ({ ok: true, errors: [], warnings: [] }),
}))
jest.mock('@/services/runtimeHealthLog', () => ({
  logStorageOperationFailure: jest.fn(), logMcpOperation: jest.fn(async () => undefined),
}))
jest.mock('@/bootstrap/providerModelAvailabilityRuntime', () => ({
  providerModelAvailabilityRuntime: { invalidateAll: jest.fn(async () => undefined) },
}))
jest.mock('@/platform/native/runtimeLog', () => ({
  readStoredRuntimeLogOptions: async () => ({ enabled: false }),
  appendRuntimeLog: jest.fn(async () => undefined),
}))

const initial = useSettingsStore.getState()
const records = new Map<string, string>()
const writeFailures = new Map<string, Error>()
const readFailures = new Map<string, Error>()
const mcpKey = APPLICATION_DATA_STORAGE_KEYS.MCP_SERVERS
const savedServer: McpServerConfig = {
  id: 'saved-mcp', name: 'Saved MCP', url: 'https://saved-fixture.invalid/mcp',
  transport: 'streamable-http', enabled: false, status: 'disconnected',
  manifestTtlMs: 60000, createdAt: 10, updatedAt: 20,
  tools: [{ name: 'saved-tool', permission: 'read-only', serverId: 'saved-mcp', enabled: true }],
  resources: [], prompts: [], approvedToolNames: ['saved-tool'],
}

beforeEach(async () => {
  jest.clearAllMocks()
  records.clear(); writeFailures.clear(); readFailures.clear()
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => {
    if (readFailures.has(key)) throw readFailures.get(key)
    return records.get(key) ?? null
  })
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (writeFailures.has(key)) throw writeFailures.get(key)
    records.set(key, value)
  })
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => { records.delete(key) })
  useSettingsStore.setState(initial, true)
  useSettingsStore.setState({
    settings: {
      ...initial.settings, language: 'en', theme: 'light', themeId: 'minimal',
      mcpEnabled: false, skillsEnabled: false, memoryEnabled: false,
      knowledgeEnabled: false, webSearchEnabled: false, searchProvider: 'off',
      hapticsEnabled: false, defaultProvider: 'retained-provider',
    },
    providers: [],
  })
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, JSON.stringify(useSettingsStore.getState().settings))
  records.set(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS, '[]')
  records.set(mcpKey, JSON.stringify([savedServer]))
  bindSettingsStorePersistence(settingsStorePersistence)
  await flushPersistedSettings()
  jest.mocked(AsyncStorage.setItem).mockClear()
  jest.spyOn(mcpClient, 'discover').mockRejectedValue(new Error('Supplier discovery is forbidden'))
})

afterEach(async () => {
  expect(mcpClient.discover).not.toHaveBeenCalled()
  expect(jest.mocked(AsyncStorage.setItem).mock.calls.every(([key]) => key === mcpKey)).toBe(true)
  writeFailures.clear(); readFailures.clear()
  await flushPersistedSettings().catch(() => undefined)
  releaseSettingsStorePersistence(settingsStorePersistence)
  useSettingsStore.setState(initial, true)
  jest.restoreAllMocks()
})

function managementScreen() {
  return render(<IsleThemeProvider><IsleDialogProvider><SettingsEditBoundary>
    <McpSettingsContent />
  </SettingsEditBoundary></IsleDialogProvider></IsleThemeProvider>)
}

type ManagementScreen = Awaited<ReturnType<typeof managementScreen>>

async function creationEditor(screen: ManagementScreen) {
  await fireEvent.press(screen.getByTestId('settings-task-mcp-add'))
  await fireEvent.changeText(screen.getByLabelText('mcp.name'), 'New MCP')
  await fireEvent.changeText(screen.getByLabelText('mcp.url'), 'https://new-fixture.invalid/mcp')
}

it.each([
  ['future envelope', JSON.stringify({ schema: 'islemind.mcp.future.v2', servers: [savedServer] })],
  ['string', JSON.stringify('synthetic-private-marker')],
  ['boolean', 'false'],
  ['number', '7'],
])('refuses a valid JSON %s MCP record in the actual screen and mutation boundary without replacing its bytes or draft', async (_kind, raw) => {
  records.set(mcpKey, raw)
  const beforeSettings = records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)
  const screen = await managementScreen()
  await creationEditor(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => expect(screen.queryAllByRole('alert').length).toBeGreaterThan(0))
  expect(records.get(mcpKey)).toBe(raw)
  expect(screen.getByLabelText('mcp.name').props.value).toBe('New MCP')
  expect(screen.getByLabelText('mcp.url').props.value).toBe('https://new-fixture.invalid/mcp')
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(beforeSettings)
  expect(AsyncStorage.setItem).not.toHaveBeenCalled()
  await expect(listMcpServers()).rejects.toMatchObject({ name: 'McpCatalogRecordDataError' })
  await screen.unmount()
})

it('composes nonempty MCP creation and fresh screen reload through the real catalog and JSON adapter without supplier discovery or changing configured preferences', async () => {
  const beforeSettings = records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)
  const screen = await managementScreen()
  await waitFor(() => expect(screen.getByRole('button', { name: savedServer.name })).toBeTruthy())
  await creationEditor(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => expect(screen.queryByLabelText('mcp.url')).toBeNull())
  const saved = JSON.parse(records.get(mcpKey)!) as McpServerConfig[]
  expect(saved).toHaveLength(2)
  expect(saved.find(server => server.id === savedServer.id)).toEqual(savedServer)
  expect(saved.find(server => server.id !== savedServer.id)).toMatchObject({
    name: 'New MCP', url: 'https://new-fixture.invalid/mcp', status: 'disconnected',
    tools: [], approvedToolNames: [],
  })
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(beforeSettings)
  await screen.unmount()
  const fresh = await managementScreen()
  await waitFor(() => expect(fresh.getByRole('button', { name: 'New MCP' })).toBeTruthy())
  expect(fresh.getByRole('button', { name: savedServer.name })).toBeTruthy()
  await fresh.unmount()
})

it.each(['absent', 'json-null', 'empty-array'])('retains %s MCP record creation compatibility through the actual page and JSON persistence', async kind => {
  if (kind === 'absent') records.delete(mcpKey)
  else records.set(mcpKey, kind === 'json-null' ? 'null' : '[]')
  const screen = await managementScreen()
  await creationEditor(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => expect(screen.queryByLabelText('mcp.url')).toBeNull())
  expect(JSON.parse(records.get(mcpKey)!)).toEqual([expect.objectContaining({
    name: 'New MCP', url: 'https://new-fixture.invalid/mcp', approvedToolNames: [],
  })])
  await screen.unmount()
})

const storedServers = (): McpServerConfig[] => JSON.parse(records.get(mcpKey)!)
const mcpWrites = () => jest.mocked(AsyncStorage.setItem).mock.calls.filter(([key]) => key === mcpKey)
const dialogPanel = (screen: ManagementScreen) => within(screen.getByTestId('dialog-experience-minimal'))

async function serverDetails(screen: ManagementScreen) {
  await waitFor(() => expect(screen.getByRole('button', { name: savedServer.name })).toBeTruthy())
  await fireEvent.press(screen.getByRole('button', { name: savedServer.name }))
}

it.each(['read', 'parse'])('keeps an actual MCP %s failure visible and retries the retained draft only after a supported record is available', async failure => {
  const supported = records.get(mcpKey)!
  if (failure === 'read') readFailures.set(mcpKey, new Error('synthetic-private-storage-error'))
  else records.set(mcpKey, '{synthetic-private-broken-json')
  const before = records.get(mcpKey)
  const screen = await managementScreen()
  await waitFor(() => expect(screen.getByRole('button', { name: 'common.retry' })).toBeTruthy())
  await creationEditor(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => expect(screen.queryAllByText('settingsWorkspace.saveFailed').length).toBeGreaterThan(0))
  expect(screen.getByLabelText('mcp.name').props.value).toBe('New MCP')
  expect(records.get(mcpKey)).toBe(before)
  expect(mcpWrites()).toHaveLength(0)
  expect(screen.queryByText(/synthetic-private/)).toBeNull()
  readFailures.clear()
  records.set(mcpKey, supported)
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => expect(screen.queryByLabelText('mcp.url')).toBeNull())
  expect(storedServers()).toHaveLength(2)
  expect(storedServers().find(server => server.id === savedServer.id)).toEqual(savedServer)
  await screen.unmount()
})

it('retains a real failed MCP metadata save and retries the same creation identity while preserving unrelated saved configuration', async () => {
  const original = records.get(mcpKey)
  const screen = await managementScreen()
  await creationEditor(screen)
  writeFailures.set(mcpKey, new Error('synthetic-private-write-error'))
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => expect(screen.queryAllByText('settingsWorkspace.saveFailed').length).toBeGreaterThan(0))
  expect(records.get(mcpKey)).toBe(original)
  expect(screen.getByLabelText('mcp.url').props.value).toBe('https://new-fixture.invalid/mcp')
  const attempted = JSON.parse(mcpWrites()[0][1]) as McpServerConfig[]
  const attemptedId = attempted.find(server => server.id !== savedServer.id)!.id
  expect(screen.queryByText(/synthetic-private/)).toBeNull()
  const unrelated = { ...savedServer, id: 'unrelated-mcp', name: 'Unrelated MCP', tools: [], approvedToolNames: [] }
  records.set(mcpKey, JSON.stringify([savedServer, unrelated]))
  writeFailures.clear()
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => expect(screen.queryByLabelText('mcp.url')).toBeNull())
  expect(storedServers().map(server => server.id).sort()).toEqual([savedServer.id, unrelated.id, attemptedId].sort())
  expect(storedServers().find(server => server.id === unrelated.id)).toEqual(unrelated)
  await screen.unmount()
})

it('keeps a pending MCP write single-flight and blocks leaving until actual JSON persistence settles', async () => {
  const original = records.get(mcpKey)
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const write = jest.mocked(AsyncStorage.setItem).getMockImplementation()!
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === mcpKey) await hold
    await write(key, value)
  })
  const screen = await managementScreen()
  try {
    await creationEditor(screen)
    await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
    await waitFor(() => expect(mcpWrites()).toHaveLength(1))
    await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.saving' }))
    await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.cancel' }))
    await fireEvent.press(screen.getByRole('button', { name: 'common.back' }))
    expect(mcpWrites()).toHaveLength(1)
    expect(records.get(mcpKey)).toBe(original)
    expect(screen.getByLabelText('mcp.name').props.value).toBe('New MCP')
    expect(screen.queryByText('mcp.added')).toBeNull()
    await act(async () => { release(); await hold })
    await waitFor(() => expect(screen.queryByLabelText('mcp.url')).toBeNull())
    expect(storedServers()).toHaveLength(2)
    expect(mcpWrites()).toHaveLength(1)
  } finally {
    release()
    await hold
    await screen.unmount()
  }
})

it('reads back an already-started MCP write after unmount without treating screen cancellation as storage rollback', async () => {
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const write = jest.mocked(AsyncStorage.setItem).getMockImplementation()!
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === mcpKey) await hold
    await write(key, value)
  })
  const screen = await managementScreen()
  try {
    await creationEditor(screen)
    await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
    await waitFor(() => expect(mcpWrites()).toHaveLength(1))
    const attempted = JSON.parse(mcpWrites()[0][1]) as McpServerConfig[]
    await screen.unmount()
    await act(async () => { release(); await hold })
    await waitFor(() => expect(storedServers()).toEqual(attempted))
    expect((await listMcpServers()).filter(server => server.id !== 'islemind-builtins')).toEqual(attempted)
    expect(mcpWrites()).toHaveLength(1)
  } finally {
    release()
    await hold
    await screen.unmount()
  }
})

it('saves an edited MCP endpoint with the same identity, clears old tool approvals and preserves unrelated stored servers', async () => {
  const unrelated = { ...savedServer, id: 'unrelated-mcp', name: 'Unrelated MCP', tools: [], approvedToolNames: [] }
  records.set(mcpKey, JSON.stringify([savedServer, unrelated]))
  const screen = await managementScreen()
  await serverDetails(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'settingsSubsystem.configuration' }))
  await fireEvent.changeText(screen.getByLabelText('mcp.url'), 'https://edited-fixture.invalid/mcp')
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => expect(screen.queryByLabelText('mcp.url')).toBeNull())
  expect(storedServers().find(server => server.id === savedServer.id)).toMatchObject({
    id: savedServer.id, url: 'https://edited-fixture.invalid/mcp',
    createdAt: savedServer.createdAt, tools: [], approvedToolNames: [],
  })
  expect(storedServers().find(server => server.id === unrelated.id)).toEqual(unrelated)
  await screen.unmount()
  const fresh = await managementScreen()
  await serverDetails(fresh)
  await fireEvent.press(fresh.getByRole('button', { name: 'settingsSubsystem.configuration' }))
  expect(fresh.getByLabelText('mcp.url').props.value).toBe('https://edited-fixture.invalid/mcp')
  await fresh.unmount()
})

it('retains failed endpoint edits and old approvals until a real metadata retry succeeds', async () => {
  const original = records.get(mcpKey)
  const screen = await managementScreen()
  await serverDetails(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'settingsSubsystem.configuration' }))
  await fireEvent.changeText(screen.getByLabelText('mcp.url'), 'https://retry-fixture.invalid/mcp')
  writeFailures.set(mcpKey, new Error('synthetic-private-edit-error'))
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => expect(screen.queryAllByText('settingsWorkspace.saveFailed').length).toBeGreaterThan(0))
  expect(records.get(mcpKey)).toBe(original)
  expect(screen.getByLabelText('mcp.url').props.value).toBe('https://retry-fixture.invalid/mcp')
  writeFailures.clear()
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => expect(screen.queryByLabelText('mcp.url')).toBeNull())
  expect(storedServers()).toEqual([expect.objectContaining({
    id: savedServer.id, url: 'https://retry-fixture.invalid/mcp', approvedToolNames: [], tools: [],
  })])
  await screen.unmount()
})

it('refuses an actual stale MCP edit and reloads the competing saved endpoint only after explicit draft discard', async () => {
  const screen = await managementScreen()
  await serverDetails(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'settingsSubsystem.configuration' }))
  await fireEvent.changeText(screen.getByLabelText('mcp.name'), 'Unsaved stale name')
  const competing = { ...savedServer, url: 'https://competing-fixture.invalid/mcp' }
  records.set(mcpKey, JSON.stringify([competing]))
  const before = records.get(mcpKey)
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => expect(screen.queryAllByText('settingsWorkspace.conflict').length).toBeGreaterThan(0))
  expect(records.get(mcpKey)).toBe(before)
  expect(mcpWrites()).toHaveLength(0)
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.reload' }))
  await fireEvent.press(dialogPanel(screen).getByText('settingsWorkspace.keepEditing'))
  expect(screen.getByLabelText('mcp.name').props.value).toBe('Unsaved stale name')
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.reload' }))
  await fireEvent.press(dialogPanel(screen).getByText('settingsWorkspace.discard'))
  await waitFor(() => expect(screen.getByLabelText('mcp.url').props.value).toBe(competing.url))
  expect(screen.getByLabelText('mcp.name').props.value).toBe(savedServer.name)
  expect(records.get(mcpKey)).toBe(before)
  await screen.unmount()
})

it('persists only the chosen cached MCP tool approval and reads it back without approving other imported enabled flags', async () => {
  records.set(mcpKey, JSON.stringify([{
    ...savedServer, approvedToolNames: [], tools: [
      ...savedServer.tools,
      { name: 'unapproved-tool', permission: 'destructive', serverId: savedServer.id, enabled: true },
    ],
  }]))
  const screen = await managementScreen()
  await serverDetails(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'mcp.toolsTitle. mcp.toolsCollapsedDetail' }))
  await fireEvent.press(screen.getByRole('switch', { name: 'saved-tool. mcp.noDescription' }))
  await waitFor(() => expect(storedServers()[0].approvedToolNames).toEqual(['saved-tool']))
  expect(storedServers()[0].tools.find(tool => tool.name === 'unapproved-tool')?.enabled).toBe(true)
  expect((await listMcpServers()).find(server => server.id === savedServer.id)?.approvedToolNames).toEqual(['saved-tool'])
  await screen.unmount()
})

it('composes real MCP delete cancel and confirm with JSON readback while retaining unrelated configuration', async () => {
  const unrelated = { ...savedServer, id: 'unrelated-mcp', name: 'Unrelated MCP', tools: [], approvedToolNames: [] }
  records.set(mcpKey, JSON.stringify([savedServer, unrelated]))
  const before = records.get(mcpKey)
  const screen = await managementScreen()
  await serverDetails(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'common.delete' }))
  await fireEvent.press(dialogPanel(screen).getByText('common.cancel'))
  expect(records.get(mcpKey)).toBe(before)
  expect(mcpWrites()).toHaveLength(0)
  await fireEvent.press(screen.getByRole('button', { name: 'common.delete' }))
  await fireEvent.press(dialogPanel(screen).getByText('common.delete'))
  await waitFor(() => expect(storedServers()).toEqual([unrelated]))
  expect((await listMcpServers()).some(server => server.id === savedServer.id)).toBe(false)
  await screen.unmount()
})

it('does not persist removal after the actual MCP confirmation loses its mounted screen lifetime', async () => {
  const before = records.get(mcpKey)
  const screen = await managementScreen()
  await serverDetails(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'common.delete' }))
  expect(dialogPanel(screen).getByText('mcp.deleteTitle')).toBeTruthy()
  await screen.unmount()
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  expect(records.get(mcpKey)).toBe(before)
  expect(mcpWrites()).toHaveLength(0)
})

it('refuses confirmed MCP deletion when the saved record becomes an unsupported envelope after the details were displayed', async () => {
  const screen = await managementScreen()
  await serverDetails(screen)
  const raw = JSON.stringify({ schema: 'islemind.mcp.future.v2', servers: [savedServer] })
  records.set(mcpKey, raw)
  await fireEvent.press(screen.getByRole('button', { name: 'common.delete' }))
  await fireEvent.press(dialogPanel(screen).getByText('common.delete'))
  await waitFor(() => expect(screen.queryAllByText('settingsWorkspace.saveFailed').length).toBeGreaterThan(0))
  expect(records.get(mcpKey)).toBe(raw)
  expect(mcpWrites()).toHaveLength(0)
  expect(screen.queryByText('mcp.deleted')).toBeNull()
  await screen.unmount()
})

it('rejects an invalid MCP endpoint locally without mutating the nonempty saved catalog', async () => {
  const before = records.get(mcpKey)
  const screen = await managementScreen()
  await creationEditor(screen)
  await fireEvent.changeText(screen.getByLabelText('mcp.url'), 'file:///not-an-http-endpoint')
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => expect(screen.getByText('mcp.urlRequired')).toBeTruthy())
  expect(records.get(mcpKey)).toBe(before)
  expect(mcpWrites()).toHaveLength(0)
  await screen.unmount()
})

it('retains read-only legacy array normalization without introducing a shape migration or persistence write', async () => {
  const raw = JSON.stringify([{ id: savedServer.id, name: savedServer.name, url: savedServer.url }])
  records.set(mcpKey, raw)
  const servers = await listMcpServers()
  expect(servers.find(server => server.id === savedServer.id)).toMatchObject({
    id: savedServer.id, transport: 'sse', enabled: false, status: 'disconnected',
    tools: [], resources: [], prompts: [], approvedToolNames: [],
  })
  expect(records.get(mcpKey)).toBe(raw)
  expect(mcpWrites()).toHaveLength(0)
})
