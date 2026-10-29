import { act, fireEvent, render } from '@testing-library/react-native'
import { McpSettingsContent } from './McpSettingsContent'
import { SettingsEditBoundary } from './SettingsEditBoundary'
import { McpCatalogConflictError } from '@/modules/integrations/mcpCatalogPolicy'
const mockUpsert = jest.fn()
const mockRemove = jest.fn()
let mockServers: any[] = []
let mockPresets: any[] = []
let mockTarget: string | undefined = 'mcp-add'
let mockEnabled = true
let mockButtonPresses: Record<string, () => void> = {}
const mockRefreshManifest = jest.fn()
const mockToast = jest.fn()
const mockConfirm = jest.fn()
const mockNotice = jest.fn()
const mockList = jest.fn(async (_options?: unknown) => mockServers)
jest.mock('expo-router', () => ({ useNavigation: jest.fn() }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('@/bootstrap/mcpCatalog', () => ({ listMcpServers: (...args: unknown[]) => mockList(...args), refreshMcpManifest: (...args: unknown[]) => mockRefreshManifest(...args), upsertMcpServer: (...args: unknown[]) => mockUpsert(...args), removeMcpServer: (...args: unknown[]) => mockRemove(...args) }))
jest.mock('@/modules/integrations', () => ({ listMcpRemotePresets: () => mockPresets, normalizeMcpServerUrl: ({ url }: { url: string }) => url, McpCatalogConflictError: require('@/modules/integrations/mcpCatalogPolicy').McpCatalogConflictError }))
jest.mock('@/bootstrap/pluginManifest', () => ({ createPluginManifestFromMcpServer: () => ({ mcp: [], permissions: [], requiredCapabilities: [], review: { state: 'pending' } }), validatePluginManifest: () => ({ ok: true, errors: [], warnings: [] }) }))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: (select: any) => select({ settings: { mcpEnabled: mockEnabled }, updateSettings: jest.fn() }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal' }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: any) => key === 'settingsSubsystem.remoteSummary' ? `remote: ${values.enabled} enabled, ${values.disabled} disabled` : key }) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('./SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('./SettingsSection', () => ({ ...jest.requireActual('./SettingsSection'), useSettingsTarget: () => mockTarget, SettingsSection: ({ children }: any) => children }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable: MockPressable, Text, TextInput } = require('react-native')
  return { ISLE_MIN_TOUCH_TARGET: 44, IslePressable: MockPressable, IsleChip: Text,
    IsleToggle: ({ title, active, onPress }: any) => <MockPressable accessibilityRole="switch" accessibilityLabel={title} accessibilityState={{ checked: active }} onPress={onPress}><Text>{title}</Text></MockPressable>, IsleListItem: ({ trailing }: any) => trailing ?? null,
    IsleButton: ({ label, ...props }: any) => {
      mockButtonPresses[label] = props.onPress
      return <MockPressable testID={`mcp-button-${label}`} {...props} accessibilityLabel={label}><Text>{label}</Text></MockPressable>
    },
    IsleField: ({ label, inputProps }: any) => <TextInput accessibilityLabel={label} {...inputProps} />,
    useIsleDialog: () => ({ toast: mockToast, confirm: mockConfirm, notice: mockNotice }),
  }
})
beforeEach(() => { mockServers = []; mockPresets = []; mockTarget = 'mcp-add'; mockEnabled = true; mockButtonPresses = {}; jest.clearAllMocks(); mockList.mockReset().mockImplementation(async () => mockServers); mockConfirm.mockReset().mockResolvedValue(false) })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

function remoteServer() {
  return { id: 'remote', name: 'Example MCP', url: 'https://example.invalid/mcp', transport: 'streamable-http', enabled: true, status: 'disconnected', tools: [], resources: [], prompts: [], approvedToolNames: [], createdAt: 12 }
}
it('keeps a failed draft, prevents duplicate submit, and retries the same creation identity', async () => {
  let reject!: (reason: Error) => void
  mockUpsert.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  const screen = await render(<McpSettingsContent />)
  await fireEvent.changeText(screen.getByLabelText('mcp.name'), 'Example')
  await fireEvent.changeText(screen.getByLabelText('mcp.url'), 'https://example.invalid/mcp')
  await fireEvent.press(screen.getByLabelText('settingsWorkspace.save'))
  await fireEvent.press(screen.getByLabelText('settingsWorkspace.saving'))
  expect(mockUpsert).toHaveBeenCalledTimes(1)
  await act(() => reject(new Error('write failed')))
  expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.saveFailed')
  expect(screen.getByLabelText('mcp.name').props.value).toBe('Example')
  const id = mockUpsert.mock.calls[0][0].id
  mockUpsert.mockImplementationOnce(async value => value)
  await fireEvent.press(screen.getByLabelText('settingsWorkspace.save'))
  expect(mockUpsert.mock.calls[1][0].id).toBe(id)
  expect(screen.queryByLabelText('mcp.name')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})
it('preserves inputs after refused task exit; cancel requires an explicit discard', async () => {
  const screen = await render(<SettingsEditBoundary><McpSettingsContent /></SettingsEditBoundary>)
  await fireEvent.changeText(screen.getByLabelText('mcp.name'), 'Unfinished')
  await fireEvent.press(screen.getByLabelText('common.back'))
  expect(screen.getByLabelText('mcp.name').props.value).toBe('Unfinished')
  await fireEvent.press(screen.getByLabelText('settingsWorkspace.cancel'))
  expect(screen.getByLabelText('mcp.name').props.value).toBe('Unfinished')
  mockConfirm.mockResolvedValue(true)
  await fireEvent.press(screen.getByLabelText('settingsWorkspace.cancel'))
  expect(screen.queryByLabelText('mcp.name')).toBeNull()
})

it('keeps a changed MCP endpoint when an older cancel prompt is accepted', async () => {
  const pending = deferred<boolean>()
  mockConfirm.mockReturnValueOnce(pending.promise)
  const screen = await render(<SettingsEditBoundary><McpSettingsContent /></SettingsEditBoundary>)
  await fireEvent.changeText(screen.getByLabelText('mcp.name'), 'Reviewed')
  await fireEvent.changeText(screen.getByLabelText('mcp.url'), 'https://reviewed.invalid/mcp')
  await fireEvent.press(screen.getByLabelText('settingsWorkspace.cancel'))
  await fireEvent.changeText(screen.getByLabelText('mcp.url'), 'https://changed.invalid/mcp')
  await act(async () => { pending.resolve(true); await pending.promise })
  expect(screen.getByLabelText('mcp.url').props.value).toBe('https://changed.invalid/mcp')
  expect(mockUpsert).not.toHaveBeenCalled()
  mockConfirm.mockResolvedValueOnce(true)
  await fireEvent.press(screen.getByLabelText('settingsWorkspace.cancel'))
  expect(screen.queryByLabelText('mcp.url')).toBeNull()
})


it('shows saved servers before setup and never treats opening the page as a connection request', async () => {
  mockTarget = undefined
  mockServers = [{ id: 'remote', name: 'Example MCP', url: 'https://example.invalid/mcp', transport: 'streamable-http', enabled: false, status: 'connected', tools: [], resources: [], prompts: [], approvedToolNames: [] }]
  const screen = await render(<McpSettingsContent />)
  expect(screen.getByText('Example MCP')).toBeTruthy()
  expect(screen.getByText('remote: 0 enabled, 1 disabled')).toBeTruthy()
  expect(screen.queryByLabelText('mcp.url')).toBeNull()
  expect(mockRefreshManifest).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByLabelText('Example MCP'))
  expect(screen.getByLabelText('mcp.enableServer')).toBeTruthy()
  expect(screen.queryByLabelText('mcp.enabled')).toBeNull()
})

it('edits an existing endpoint without carrying tool approvals across servers', async () => {
  mockTarget = undefined
  mockServers = [{ id: 'remote', name: 'Example MCP', url: 'https://example.invalid/mcp', transport: 'streamable-http', enabled: true, status: 'connected', tools: [{ name: 'old-tool', enabled: true }], resources: [], prompts: [], approvedToolNames: ['old-tool'], createdAt: 12 }]
  mockUpsert.mockImplementation(async value => value)
  const screen = await render(<McpSettingsContent />)
  await fireEvent.press(screen.getByLabelText('Example MCP'))
  await fireEvent.press(screen.getByLabelText('settingsSubsystem.configuration'))
  expect(screen.getByLabelText('mcp.url').props.keyboardType).toBe('url')
  await fireEvent.changeText(screen.getByLabelText('mcp.url'), 'https://other.invalid/mcp')
  await fireEvent.press(screen.getByLabelText('settingsWorkspace.save'))
  expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'remote', createdAt: 12, url: 'https://other.invalid/mcp', status: 'disconnected', approvedToolNames: [], tools: [] }), { expectedServer: mockServers[0], signal: expect.any(AbortSignal) })
  expect(mockRefreshManifest).not.toHaveBeenCalled()
})


it.each([false, true])('installs presets locally (enabled=%s), reports persistence failure, and retries without probing', async enabledOnInstall => {
  mockTarget = undefined
  mockPresets = [{ id: 'fixture', name: 'Fixture', url: 'https://example.invalid/mcp', transport: 'streamable-http', enabledOnInstall }]
  mockUpsert.mockRejectedValueOnce(new Error('write failed'))
  const screen = await render(<McpSettingsContent />)
  await fireEvent.press(screen.getByTestId('settings-task-mcp-presets'))
  await fireEvent.press(screen.getByLabelText('mcp.installPreset'))
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'settingsWorkspace.saveFailed' }))
  expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.saveFailed')
  expect(mockRefreshManifest).not.toHaveBeenCalled()
  mockUpsert.mockImplementationOnce(async value => { mockServers = [value]; return value })
  await fireEvent.press(screen.getByLabelText('mcp.installPreset'))
  expect(mockUpsert).toHaveBeenCalledTimes(2)
  expect(mockUpsert).toHaveBeenLastCalledWith(expect.objectContaining({
    enabled: enabledOnInstall, status: 'disconnected', tools: [], resources: [], prompts: [], approvedToolNames: [],
  }), { expectedServer: null, signal: expect.any(AbortSignal) })
  expect(mockRefreshManifest).not.toHaveBeenCalled()
  expect(screen.getByLabelText('settingsSubsystem.refreshManifest')).toBeTruthy()
})

it('keeps the saved connection failure and global pause visible in server details', async () => {
  mockTarget = undefined
  mockEnabled = false
  mockServers = [{ id: 'remote', name: 'Failed MCP', url: 'https://example.invalid/mcp', transport: 'streamable-http', enabled: true, status: 'error', lastError: 'MCP request timed out', tools: [], resources: [], prompts: [], approvedToolNames: [] }]
  const screen = await render(<McpSettingsContent />)
  await fireEvent.press(screen.getByLabelText('Failed MCP'))
  expect(screen.getByRole('alert')).toHaveTextContent(/MCP request timed out/)
  expect(screen.getByText('settingsSubsystem.paused')).toBeTruthy()
  expect(screen.getByLabelText('settingsSubsystem.refreshManifest')).toBeTruthy()
})

it('approves only the chosen tool, not other enabled but unapproved cached tools', async () => {
  mockTarget = undefined
  mockServers = [{ id: 'remote', name: 'Tools MCP', url: 'https://example.invalid/mcp', transport: 'streamable-http', enabled: true, status: 'connected', tools: [{ name: 'chosen', enabled: true }, { name: 'unreviewed', enabled: true }], resources: [], prompts: [], approvedToolNames: [] }]
  mockUpsert.mockImplementation(async value => { mockServers = [value]; return value })
  const screen = await render(<McpSettingsContent />)
  await fireEvent.press(screen.getByLabelText('Tools MCP'))
  await fireEvent.press(screen.getByLabelText('mcp.toolsTitle. mcp.toolsCollapsedDetail'))
  expect(screen.getByRole('switch', { name: 'chosen' }).props.accessibilityState.checked).toBe(false)
  await fireEvent.press(screen.getByRole('switch', { name: 'chosen' }))
  expect(mockUpsert.mock.calls.at(-1)).toEqual([expect.objectContaining({ approvedToolNames: ['chosen'] }), { expectedServer: expect.objectContaining({ approvedToolNames: [] }), signal: expect.any(AbortSignal) }])
  expect(screen.getByRole('switch', { name: 'chosen' }).props.accessibilityState.checked).toBe(true)
  expect(screen.getByRole('switch', { name: 'unreviewed' }).props.accessibilityState.checked).toBe(false)
  await fireEvent.press(screen.getByRole('switch', { name: 'chosen' }))
  expect(mockUpsert.mock.calls.at(-1)).toEqual([expect.objectContaining({ approvedToolNames: [] }), { expectedServer: expect.objectContaining({ approvedToolNames: ['chosen'] }), signal: expect.any(AbortSignal) }])
  expect(mockRefreshManifest).not.toHaveBeenCalled()
})

it('keeps a conflicted connection draft without reporting a successful save or connecting', async () => {
  mockTarget = undefined
  const original = { id: 'remote', name: 'Example MCP', url: 'https://example.invalid/mcp', transport: 'streamable-http', enabled: true, status: 'connected', tools: [], resources: [], prompts: [], approvedToolNames: [], createdAt: 12 }
  mockServers = [original]
  const screen = await render(<McpSettingsContent />)
  await fireEvent.press(screen.getByLabelText('Example MCP'))
  await fireEvent.press(screen.getByLabelText('settingsSubsystem.configuration'))
  await fireEvent.changeText(screen.getByLabelText('mcp.name'), 'My unsaved edit')
  mockServers = [{ ...original, name: 'Concurrent saved edit', enabled: false }]
  mockUpsert.mockRejectedValueOnce(new McpCatalogConflictError('remote'))
  await fireEvent.press(screen.getByLabelText('settingsWorkspace.save'))
  expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ name: 'My unsaved edit' }), { expectedServer: original, signal: expect.any(AbortSignal) })
  expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.conflict')
  expect(screen.getByLabelText('mcp.name').props.value).toBe('My unsaved edit')
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'settingsWorkspace.saved' }))
  expect(mockRefreshManifest).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByLabelText('settingsWorkspace.reload'))
  expect(screen.getByLabelText('mcp.name').props.value).toBe('My unsaved edit')
  mockConfirm.mockResolvedValueOnce(true)
  await fireEvent.press(screen.getByLabelText('settingsWorkspace.reload'))
  expect(screen.getByLabelText('mcp.name').props.value).toBe('Concurrent saved edit')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(mockUpsert).toHaveBeenCalledTimes(1)
  expect(mockRefreshManifest).not.toHaveBeenCalled()
})

it('cancels removal without a write and binds approved deletion to the displayed snapshot', async () => {
  mockTarget = undefined
  const original = { id: 'remote', name: 'Example MCP', url: 'https://example.invalid/mcp', transport: 'streamable-http', enabled: true, status: 'connected', tools: [], resources: [], prompts: [], approvedToolNames: [], createdAt: 12 }
  mockServers = [original]
  const screen = await render(<McpSettingsContent />)
  await fireEvent.press(screen.getByLabelText('Example MCP'))
  await fireEvent.press(screen.getByLabelText('common.delete'))
  expect(mockRemove).not.toHaveBeenCalled()
  mockConfirm.mockResolvedValueOnce(true)
  mockRemove.mockRejectedValueOnce(new McpCatalogConflictError('remote'))
  await fireEvent.press(screen.getByLabelText('common.delete'))
  expect(mockRemove).toHaveBeenCalledWith('remote', { expectedServer: original, signal: expect.any(AbortSignal) })
  expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.conflict')
  expect(mockServers).toEqual([original])
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'mcp.deleted' }))
})

it('does not turn a late removal approval after unmount into a catalog mutation', async () => {
  mockTarget = undefined
  mockServers = [remoteServer()]
  const confirmation = deferred<boolean>()
  mockConfirm.mockReturnValueOnce(confirmation.promise)
  const screen = await render(<McpSettingsContent />)
  await fireEvent.press(screen.getByLabelText('Example MCP'))
  await fireEvent.press(screen.getByLabelText('common.delete'))
  const options = mockConfirm.mock.calls.at(-1)![0]
  await screen.unmount()
  await act(async () => { confirmation.resolve(true) })
  expect(mockRemove).not.toHaveBeenCalled()
  expect(options.signal).toBeInstanceOf(AbortSignal)
  expect(options.signal.aborted).toBe(true)
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'mcp.deleted' }))
})

it('owns the removal prompt before awaiting approval and rejects duplicate clicks', async () => {
  mockTarget = undefined
  mockServers = [remoteServer()]
  const confirmation = deferred<boolean>()
  mockConfirm.mockReturnValue(confirmation.promise)
  const screen = await render(<McpSettingsContent />)
  await fireEvent.press(screen.getByLabelText('Example MCP'))
  await fireEvent.press(screen.getByLabelText('common.delete'))
  await fireEvent.press(screen.getByLabelText('common.delete'))
  expect(mockConfirm).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('common.delete')).toBeDisabled()
  await act(async () => { confirmation.resolve(false) })
  expect(mockRemove).not.toHaveBeenCalled()
  expect(screen.getByLabelText('common.delete')).toBeEnabled()
})

it('cancels explicit discovery on unmount without a late success notice or follow-up read', async () => {
  mockTarget = undefined
  mockServers = [remoteServer()]
  const discovery = deferred<any>()
  mockRefreshManifest.mockReturnValueOnce(discovery.promise)
  const screen = await render(<McpSettingsContent />)
  await fireEvent.press(screen.getByLabelText('Example MCP'))
  await fireEvent.press(screen.getByLabelText('settingsSubsystem.refreshManifest'))
  const options = mockRefreshManifest.mock.calls.at(-1)![1]
  const reads = mockList.mock.calls.length
  await screen.unmount()
  await act(async () => { discovery.resolve({ ...remoteServer(), status: 'connected' }) })
  expect(options?.signal).toBeInstanceOf(AbortSignal)
  expect(options.signal.aborted).toBe(true)
  expect(mockList).toHaveBeenCalledTimes(reads)
  expect(mockNotice).not.toHaveBeenCalled()
})

it('keeps a successfully saved server when an older initial catalog read finishes later', async () => {
  const initial = deferred<any[]>()
  mockList.mockReturnValueOnce(initial.promise)
  mockUpsert.mockImplementationOnce(async value => { mockServers = [value]; return value })
  const screen = await render(<McpSettingsContent />)
  await fireEvent.changeText(screen.getByLabelText('mcp.name'), 'Saved current server')
  await fireEvent.changeText(screen.getByLabelText('mcp.url'), 'https://example.invalid/current')
  await fireEvent.press(screen.getByLabelText('settingsWorkspace.save'))
  expect(screen.getByLabelText('settingsSubsystem.refreshManifest')).toBeTruthy()
  await act(async () => { initial.resolve([]) })
  expect(screen.getByLabelText('settingsSubsystem.refreshManifest')).toBeTruthy()
  expect(mockRefreshManifest).not.toHaveBeenCalled()
})

it('shares mutation exclusion between connection saves and preset installation', async () => {
  mockPresets = [{ id: 'fixture', name: 'Fixture', url: 'https://example.invalid/mcp', transport: 'streamable-http', enabledOnInstall: false }]
  const install = deferred<any>()
  const screen = await render(<McpSettingsContent />)
  await fireEvent.changeText(screen.getByLabelText('mcp.url'), 'https://example.invalid/stale-save')
  const staleSave = mockButtonPresses['settingsWorkspace.save']
  mockConfirm.mockResolvedValueOnce(true)
  await fireEvent.press(screen.getByLabelText('common.back'))
  await fireEvent.press(screen.getByTestId('settings-task-mcp-presets'))
  mockUpsert.mockReturnValueOnce(install.promise)
  await fireEvent.press(screen.getByLabelText('mcp.installPreset'))
  await act(() => staleSave())
  const writes = mockUpsert.mock.calls.length
  await act(async () => { install.resolve({ ...remoteServer(), id: 'mcp-preset-fixture', enabled: false }) })
  expect(writes).toBe(1)
})

it('fails a rejected removal prompt closed and permits a subsequent cancel without a write', async () => {
  mockTarget = undefined
  mockServers = [remoteServer()]
  mockConfirm.mockRejectedValueOnce(new Error('dialog unavailable'))
  const screen = await render(<McpSettingsContent />)
  await fireEvent.press(screen.getByLabelText('Example MCP'))
  await fireEvent.press(screen.getByLabelText('common.delete'))
  expect(mockRemove).not.toHaveBeenCalled()
  expect(screen.getByLabelText('common.delete')).toBeEnabled()
  await fireEvent.press(screen.getByLabelText('common.delete'))
  expect(mockConfirm).toHaveBeenCalledTimes(2)
  expect(mockRemove).not.toHaveBeenCalled()
})

it('reads a fresh catalog after save so invalidating the initial read does not leave loading forever', async () => {
  const initial = deferred<any[]>()
  mockList.mockReturnValueOnce(initial.promise)
  mockUpsert.mockImplementationOnce(async value => { mockServers = [value]; return value })
  const screen = await render(<McpSettingsContent />)
  await fireEvent.changeText(screen.getByLabelText('mcp.url'), 'https://example.invalid/current')
  await fireEvent.press(screen.getByLabelText('settingsWorkspace.save'))
  await act(() => initial.resolve([]))
  await fireEvent.press(screen.getByLabelText('settingsUx.allOptions'))
  await fireEvent.press(screen.getByLabelText('common.back'))
  expect(screen.queryByText('common.loading')).toBeNull()
  expect(screen.getByText('remote: 1 enabled, 0 disabled')).toBeTruthy()
  expect(mockList).toHaveBeenCalledTimes(2)
})
