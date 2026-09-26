import { act, fireEvent, render } from '@testing-library/react-native'
import { Linking, ScrollView } from 'react-native'
import Constants from 'expo-constants'
import { AnimatePresence, MotiView } from 'moti'
import { THEME_MOTION_DURATIONS } from '@/theme/themeTokens'
import { SystemSettingsPanelContent } from './SystemSettingsPanelContent'
import { checkLatestApkRelease, downloadAndOpenApkInstaller, type ApkReleaseInfo, type ApkUpdateResult } from '@/platform/native/androidApkUpdates'
import { clearAndroidStatusNotification, updateAndroidStatusNotification } from '@/bootstrap/androidStatusNotification'
import { IsleButton } from '@/components/ui/isle'

const mockTranslate = (key: string) => key
const mockState = { providers: [], settings: { theme: 'dark', themeId: 'material', language: 'zh-CN' } }
let mockMotion = 'full'
const mockDialog = { toast: jest.fn(), confirm: jest.fn(), notice: jest.fn(), banner: jest.fn(), dismissBanner: jest.fn() }
const mockUpdateSettings = jest.fn()
const release: ApkReleaseInfo = {
  version: '1.1.3', tagName: 'v1.1.3', name: 'IsleMind 1.1.3', htmlUrl: 'https://example.test/release',
  apkName: 'update.apk', apkUrl: 'https://example.test/update.apk', publishedAt: null, sizeBytes: 100,
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

jest.mock('@/store/settingsStore', () => ({ useSettingsStore: (select: (state: unknown) => unknown) => select(mockState) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors('dark', 'material')
  return { colors, design: colors.design, canonicalThemeId: 'material' }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/hooks/useThemeSelection', () => ({ useThemeSelection: () => jest.fn() }))
jest.mock('./usePreferenceUndo', () => ({ usePreferenceUndo: () => ({ updateSettings: mockUpdateSettings, canUndo: false, undo: jest.fn() }) }))
jest.mock('./SettingsEditBoundary', () => ({ useSettingsDraft: () => jest.fn() }))
jest.mock('./SettingsPageShell', () => ({ SettingsPageShell: ({ children }: { children: React.ReactNode }) => children }))
jest.mock('@/core', () => ({ userFacingErrorDetail: String }))
jest.mock('@/i18n', () => ({ changeAppLanguage: jest.fn() }))
jest.mock('@/modules/integrations', () => ({ resolveSearchProvider: () => 'off' }))
jest.mock('@/presentation/features/settings/portableDataCommand', () => ({}))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }))
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }))
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }))
jest.mock('expo-constants', () => ({ expoConfig: {} }))
jest.mock('@/platform/native/androidApkUpdates', () => ({ checkLatestApkRelease: jest.fn(), downloadAndOpenApkInstaller: jest.fn() }))
jest.mock('@/bootstrap/androidStatusNotification', () => ({ clearAndroidStatusNotification: jest.fn(), updateAndroidStatusNotification: jest.fn() }))
jest.mock('animal-island-ui-rn', () => ({ RadioGroup: require('react-native').View }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('@/components/navigation/AnimatedNavigationTrigger', () => ({ AnimatedNavigationTrigger: () => null }))
jest.mock('@/components/settings/SettingsThemeAccentControl', () => ({ SettingsThemeAccentControl: () => null }))
jest.mock('@/components/ui/isle/GlassSurface', () => ({ GlassSurface: require('react-native').View }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput, View } = require('react-native')
  const React = require('react')
  return {
    IslePressable: Pressable, IsleSearchField: TextInput, IsleField: TextInput,
    IsleChip: Text, IsleButton: jest.fn(({ label, ...props }: { label: string }) => React.createElement(Pressable, { accessibilityRole: 'button', ...props }, React.createElement(Text, null, label))),
    IsleProgress: View, IsleDisclosure: View, IsleToggle: View,
    ISLE_MIN_TOUCH_TARGET: 44, useIsleDialog: () => mockDialog,
  }
})
jest.mock('moti', () => ({
  MotiView: jest.fn((props) => require('react').createElement(require('react-native').View, props)),
  AnimatePresence: jest.fn(({ children }) => children),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockMotion = 'full'
  Constants.expoConfig!.extra = { distributionChannel: 'github' }
  mockDialog.confirm.mockResolvedValue(true)
  jest.mocked(checkLatestApkRelease).mockReset().mockResolvedValue({ status: 'available', message: 'available', release })
  jest.mocked(downloadAndOpenApkInstaller).mockReset().mockResolvedValue({ status: 'downloaded', message: 'opened' })
})

it('opens Google Play only on a user click and reports opening errors', async () => {
  Constants.expoConfig!.extra = { distributionChannel: 'google-play' }
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
  const screen = await render(<SystemSettingsPanelContent panel="updates" />)
  expect(openURL).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: 'updates.openGooglePlay' }))
  expect(openURL).toHaveBeenCalledWith('https://play.google.com/store/apps/details?id=com.islemind.app')
  openURL.mockRejectedValueOnce(new Error('no handler'))
  await fireEvent.press(screen.getByRole('button', { name: 'updates.openGooglePlay' }))
  expect(mockDialog.toast).toHaveBeenCalledWith({ title: 'updates.storeOpenFailed', tone: 'danger' })
  expect(checkLatestApkRelease).not.toHaveBeenCalled()
  expect(downloadAndOpenApkInstaller).not.toHaveBeenCalled()
})

it('guards immediate repeated clicks before React can disable the check button', async () => {
  const pending = deferred<ApkUpdateResult>()
  jest.mocked(checkLatestApkRelease).mockReturnValueOnce(pending.promise)
  const screen = await render(<SystemSettingsPanelContent panel="updates" />)
  const button = jest.mocked(IsleButton).mock.calls.findLast(([props]) => props.label === 'settings.checkApk')![0]
  const event = {} as Parameters<NonNullable<typeof button.onPress>>[0]
  await act(() => { button.onPress?.(event); button.onPress?.(event) })
  expect(checkLatestApkRelease).toHaveBeenCalledTimes(1)
  await act(() => pending.resolve({ status: 'available', message: 'available', release }))
  expect(mockDialog.confirm).toHaveBeenCalledTimes(1)
  expect(downloadAndOpenApkInstaller).toHaveBeenCalledTimes(1)
  expect(mockUpdateSettings).toHaveBeenCalledWith({ lastApkUpdateCheckAt: expect.any(Number) })
  expect(screen.getByRole('button', { name: 'settings.checkApk' })).toBeEnabled()
})

it('cancels download, ignores stale progress and allows retry without an error dialog', async () => {
  const pending = deferred<ApkUpdateResult>()
  jest.mocked(downloadAndOpenApkInstaller).mockImplementationOnce(async (_release, options) => {
    options?.onProgress?.({ stage: 'downloading', release, percent: 10 })
    return pending.promise
  })
  const screen = await render(<SystemSettingsPanelContent panel="updates" />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
  const options = jest.mocked(downloadAndOpenApkInstaller).mock.calls[0][1]!
  await fireEvent.press(screen.getByRole('button', { name: 'updates.cancelDownload' }))
  expect(options.signal?.aborted).toBe(true)
  expect(screen.getByRole('button', { name: 'updates.cancelling' })).toBeDisabled()
  const banners = mockDialog.banner.mock.calls.length
  await act(() => options.onProgress?.({ stage: 'verifying', release }))
  expect(mockDialog.banner).toHaveBeenCalledTimes(banners)
  await act(() => pending.resolve({ status: 'cancelled', message: 'cancelled' }))
  expect(mockDialog.notice).not.toHaveBeenCalled()
  expect(mockDialog.toast).toHaveBeenCalledWith({ title: 'updates.cancelled', tone: 'amber' })
  expect(clearAndroidStatusNotification).toHaveBeenCalledWith({ owner: expect.stringMatching(/^apk-update:/) })
  expect(screen.queryByRole('button', { name: 'updates.cancelling' })).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
  expect(checkLatestApkRelease).toHaveBeenCalledTimes(2)
})

it.each(['unmount', 'panel-change'] as const)('never starts an installer after leaving a pending confirmation: %s', async exit => {
  const confirmation = deferred<boolean>()
  mockDialog.confirm.mockReturnValueOnce(confirmation.promise)
  const screen = await render(<SystemSettingsPanelContent panel="updates" />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
  expect(mockDialog.confirm).toHaveBeenCalledTimes(1)
  if (exit === 'unmount') await screen.unmount()
  else await screen.rerender(<SystemSettingsPanelContent panel="appearance" />)
  await act(() => confirmation.resolve(true))
  expect(downloadAndOpenApkInstaller).not.toHaveBeenCalled()
  if (exit === 'panel-change') {
    await screen.rerender(<SystemSettingsPanelContent panel="updates" />)
    expect(screen.getByRole('button', { name: 'settings.checkApk' })).toBeEnabled()
  }
})

it('aborts on unmount and does not publish late native progress or terminal feedback', async () => {
  const pending = deferred<ApkUpdateResult>()
  jest.mocked(downloadAndOpenApkInstaller).mockReturnValueOnce(pending.promise)
  const screen = await render(<SystemSettingsPanelContent panel="updates" />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
  const options = jest.mocked(downloadAndOpenApkInstaller).mock.calls[0][1]!
  await screen.unmount()
  expect(options.signal?.aborted).toBe(true)
  const notifications = jest.mocked(updateAndroidStatusNotification).mock.calls.length
  await act(() => {
    options.onProgress?.({ stage: 'downloading', release, percent: 50 })
    pending.resolve({ status: 'cancelled', message: 'cancelled' })
  })
  expect(updateAndroidStatusNotification).toHaveBeenCalledTimes(notifications)
  expect(mockDialog.notice).not.toHaveBeenCalled()
  expect(mockDialog.toast).not.toHaveBeenCalled()
})

it('recovers from unexpected check exceptions without recording a successful check', async () => {
  jest.mocked(checkLatestApkRelease).mockRejectedValueOnce(new Error('unexpected failure'))
  const screen = await render(<SystemSettingsPanelContent panel="updates" />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
  expect(mockDialog.notice).toHaveBeenCalledWith(expect.objectContaining({ title: 'settings.apkUpdateFailed', tone: 'danger' }))
  expect(mockUpdateSettings).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'settings.checkApk' })).toBeEnabled()
  await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
  expect(downloadAndOpenApkInstaller).toHaveBeenCalledTimes(1)
})
afterEach(() => jest.restoreAllMocks())

it.each(['github', 'google-play'])('renders channel-appropriate update controls for %s', async channel => {
  Constants.expoConfig!.extra = { distributionChannel: channel }
  const screen = await render(<SystemSettingsPanelContent panel="updates" />)
  if (channel === 'google-play') {
    expect(screen.getByText('updates.googlePlayManaged')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'settings.checkApk' })).toBeNull()
    expect(screen.queryByText('settings.lastCheck')).toBeNull()
    expect(screen.container.queryAll(node => node.props.title === 'settings.autoCheck')).toHaveLength(0)
  } else {
    expect(screen.queryByText('updates.googlePlayManaged')).toBeNull()
    expect(screen.getByRole('button', { name: 'settings.checkApk' })).toBeTruthy()
    expect(screen.getByText('settings.lastCheck')).toBeTruthy()
    expect(screen.container.queryAll(node => node.props.title === 'settings.autoCheck')).not.toHaveLength(0)
  }
})

it.each(['full', 'reduced'])('uses a visible %s transition instead of a one-millisecond swap', async (motion) => {
  mockMotion = motion
  await render(<SystemSettingsPanelContent panel="appearance" />)
  const props = jest.mocked(MotiView).mock.calls.findLast(([props]) => props.testID === 'settings-appearance-foldout')![0]
  expect(props.transition).toMatchObject({ type: 'timing', duration: motion === 'full' ? THEME_MOTION_DURATIONS.material.panel : 120 })
  const readableFrame = motion === 'full'
    ? { opacity: 0.65, translateX: 6, translateY: 0, scale: 0.99 }
    : { opacity: 0.65, translateX: 0, translateY: 0, scale: 1 }
  expect(props.from).toEqual(readableFrame)
  const catalog = jest.mocked(MotiView).mock.calls.findLast(([props]) => typeof props.from === 'object' && props.from.opacity === 0.65)![0]
  expect(catalog.from).toEqual(readableFrame)
})

it('keeps the appearance controls on parent-only renders', async () => {
  const screen = await render(<SystemSettingsPanelContent panel="appearance" />)
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo')
  scrollTo.mockClear()
  await screen.rerender(<SystemSettingsPanelContent panel="appearance" />)
  expect(screen.getByTestId('settings-appearance-foldout')).toBeTruthy()
  expect(scrollTo).not.toHaveBeenCalled()
})

it.each([[1, '47%'], [2, '100%']] as const)('sizes theme previews for %sx system text', async (fontScale, flexBasis) => {
  jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: 390, height: 844, scale: 1, fontScale })
  const screen = await render(<SystemSettingsPanelContent panel="appearance" />)
  expect(screen.getByTestId('settings-theme-family-minimal')).toHaveStyle({ flexBasis })
})
