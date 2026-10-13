import { act, fireEvent, render } from '@testing-library/react-native'
import { McpSettingsContent } from './McpSettingsContent'
import { SettingsEditBoundary } from './SettingsEditBoundary'
const mockUpsert = jest.fn()
let mockServers: any[] = []
let mockPresets: any[] = []
let mockTarget: string | undefined = 'mcp-add'
let mockEnabled = true
const mockRefreshManifest = jest.fn()
const mockToast = jest.fn()
const mockConfirm = jest.fn()
jest.mock('expo-router', () => ({ useNavigation: jest.fn() }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('@/bootstrap/mcpCatalog', () => ({ listMcpServers: async () => mockServers, refreshMcpManifest: (...args: unknown[]) => mockRefreshManifest(...args), upsertMcpServer: (value: unknown) => mockUpsert(value) }))
jest.mock('@/modules/integrations', () => ({ listMcpRemotePresets: () => mockPresets, normalizeMcpServerUrl: ({ url }: { url: string }) => url }))
jest.mock('@/bootstrap/pluginManifest', () => ({ createPluginManifestFromMcpServer: () => ({ mcp: [], permissions: [], requiredCapabilities: [], review: { state: 'pending' } }), validatePluginManifest: () => ({ ok: true, errors: [], warnings: [] }) }))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: (select: any) => select({ settings: { mcpEnabled: mockEnabled }, updateSettings: jest.fn() }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal' }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: any) => key === 'settingsSubsystem.remoteSummary' ? `remote: ${values.enabled} enabled, ${values.disabled} disabled` : key }) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('./SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('./SettingsSection', () => ({ ...jest.requireActual('./SettingsSection'), useSettingsTarget: () => mockTarget, SettingsSection: ({ children }: any) => children }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput } = require('react-native')
  return { ISLE_MIN_TOUCH_TARGET: 44, IslePressable: Pressable, IsleChip: Text,
    IsleToggle: ({ title, active, onPress }: any) => <Pressable accessibilityRole="switch" accessibilityLabel={title} accessibilityState={{ checked: active }} onPress={onPress}><Text>{title}</Text></Pressable>, IsleListItem: ({ trailing }: any) => trailing ?? null,
    IsleButton: ({ label, ...props }: any) => <Pressable {...props} accessibilityLabel={label}><Text>{label}</Text></Pressable>,
    IsleField: ({ label, inputProps }: any) => <TextInput accessibilityLabel={label} {...inputProps} />,
    useIsleDialog: () => ({ toast: mockToast, confirm: mockConfirm }),
  }
})
beforeEach(() => { mockServers = []; mockPresets = []; mockTarget = 'mcp-add'; mockEnabled = true; jest.clearAllMocks(); mockConfirm.mockResolvedValue(false) })
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
  expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'remote', createdAt: 12, url: 'https://other.invalid/mcp', status: 'disconnected', approvedToolNames: [], tools: [] }))
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
  }))
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
  expect(mockUpsert).toHaveBeenLastCalledWith(expect.objectContaining({ approvedToolNames: ['chosen'] }))
  expect(screen.getByRole('switch', { name: 'chosen' }).props.accessibilityState.checked).toBe(true)
  expect(screen.getByRole('switch', { name: 'unreviewed' }).props.accessibilityState.checked).toBe(false)
  await fireEvent.press(screen.getByRole('switch', { name: 'chosen' }))
  expect(mockUpsert).toHaveBeenLastCalledWith(expect.objectContaining({ approvedToolNames: [] }))
  expect(mockRefreshManifest).not.toHaveBeenCalled()
})
