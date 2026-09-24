import { act, fireEvent, render } from '@testing-library/react-native'
import { McpSettingsContent } from './McpSettingsContent'
const mockUpsert = jest.fn()
const mockToast = jest.fn()
const mockConfirm = jest.fn()
jest.mock('expo-router', () => ({ useNavigation: jest.fn() }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('@/bootstrap/mcpCatalog', () => ({ listMcpServers: async () => [], upsertMcpServer: (value: unknown) => mockUpsert(value) }))
jest.mock('@/modules/integrations', () => ({ listMcpRemotePresets: () => [], normalizeMcpServerUrl: ({ url }: { url: string }) => url }))
jest.mock('@/bootstrap/pluginManifest', () => ({ createPluginManifestFromMcpServer: jest.fn(), validatePluginManifest: jest.fn() }))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: (select: any) => select({ settings: {}, updateSettings: jest.fn() }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal' }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('./SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('./SettingsSection', () => ({ useSettingsTarget: () => 'mcp-add', SettingsSection: ({ children }: any) => children }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput } = require('react-native')
  return { ISLE_MIN_TOUCH_TARGET: 44, IslePressable: Pressable, IsleChip: Text,
    IsleToggle: () => null, IsleListItem: () => null,
    IsleButton: ({ label, ...props }: any) => <Pressable {...props} accessibilityLabel={label}><Text>{label}</Text></Pressable>,
    IsleField: ({ label, inputProps }: any) => <TextInput accessibilityLabel={label} {...inputProps} />,
    useIsleDialog: () => ({ toast: mockToast, confirm: mockConfirm }),
  }
})
beforeEach(() => { jest.clearAllMocks(); mockConfirm.mockResolvedValue(false) })
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
  expect(screen.getByLabelText('mcp.name').props.value).toBe('Example')
  const id = mockUpsert.mock.calls[0][0].id
  mockUpsert.mockImplementationOnce(async value => value)
  await fireEvent.press(screen.getByLabelText('settingsWorkspace.save'))
  expect(mockUpsert.mock.calls[1][0].id).toBe(id)
  expect(screen.queryByLabelText('mcp.name')).toBeNull()
})
it('preserves inputs while collapsed; cancel requires an explicit discard', async () => {
  const screen = await render(<McpSettingsContent />)
  await fireEvent.changeText(screen.getByLabelText('mcp.name'), 'Unfinished')
  const disclosure = screen.getByLabelText(/mcp.addServer\./)
  await fireEvent.press(disclosure)
  await fireEvent.press(disclosure)
  expect(screen.getByLabelText('mcp.name').props.value).toBe('Unfinished')
  await fireEvent.press(screen.getByLabelText('settingsWorkspace.cancel'))
  expect(screen.getByLabelText('mcp.name').props.value).toBe('Unfinished')
  mockConfirm.mockResolvedValue(true)
  await fireEvent.press(screen.getByLabelText('settingsWorkspace.cancel'))
  expect(screen.queryByLabelText('mcp.name')).toBeNull()
})
