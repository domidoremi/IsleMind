import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native'
import { Linking, ScrollView } from 'react-native'
import Constants from 'expo-constants'
import { AnimatePresence, MotiView } from 'moti'
import { THEME_MOTION_DURATIONS } from '@/theme/themeTokens'
import { SystemSettingsPanelContent } from './SystemSettingsPanelContent'
import { checkLatestApkRelease, prepareApkRelease, openPreparedApkInstaller, downloadAndOpenApkInstaller,
  type ApkReleaseInfo, type ApkUpdateResult } from '@/platform/native/androidApkUpdates'
import { useAutomaticApkUpdateInstall } from '@/components/updates/useAutomaticApkUpdateInstall'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'
import { clearAndroidStatusNotification, updateAndroidStatusNotification } from '@/bootstrap/androidStatusNotification'
import { flushPersistedSettings } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import { IsleButton } from '@/components/ui/isle'
import type { ApkUpdateIgnoreState, ThemeBackgroundMotion } from '@/types/settingsContracts'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'

const mockExportData = jest.fn()
const mockImportData = jest.fn()
const mockTranslate = (key: string) => key
const mockState = { providers: [], settings: {
  theme: 'dark', themeId: 'material', language: 'zh-CN', backgroundMotion: undefined as ThemeBackgroundMotion | undefined,
  neverRemindUpdates: false, ignoredApkUpdate: undefined as ApkUpdateIgnoreState | undefined,
  autoApkDownloadEnabled: false, apkUpdateBannerEnabled: true,
  apkUpdateChannel: 'stable' as 'stable' | 'every-release',
} }
let mockMotion = 'full'
const mockDialog = { toast: jest.fn(), confirm: jest.fn(), notice: jest.fn(), banner: jest.fn(), dismissBanner: jest.fn(),
  hasPendingDialogs: () => false, subscribeDialogs: () => () => undefined }
const mockSettingsListeners = new Set<(state: typeof mockState) => void>()
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

jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign((select: (state: unknown) => unknown) => select(mockState), {
    getState: () => ({ ...mockState, updateSettings: mockUpdateSettings }),
    subscribe: (listener: (state: typeof mockState) => void) => {
      mockSettingsListeners.add(listener)
      return () => { mockSettingsListeners.delete(listener) }
    },
  }),
}))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({
  ...jest.requireActual('@/presentation/features/settings/settingsStorePersistenceCommand'),
  flushPersistedSettings: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const family = mockState.settings.themeId
  const colors = require('@/theme/colors').getColors('dark', family)
  const backgroundEnvironment = require('@/theme/backgroundEnvironment').resolveBackgroundEnvironment({ family, mode: 'dark', motion: mockState.settings.backgroundMotion })
  return { colors, design: colors.design, canonicalThemeId: family, backgroundEnvironment, mode: 'dark', isDark: true }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/hooks/useThemeSelection', () => ({ useThemeSelection: () => jest.fn() }))
jest.mock('./usePreferenceUndo', () => ({ usePreferenceUndo: () => ({ updateSettings: mockUpdateSettings, canUndo: false, undo: jest.fn() }) }))
jest.mock('./SettingsEditBoundary', () => ({ ...jest.requireActual('./SettingsEditBoundary'), useSettingsDraft: () => jest.fn(), useSettingsLeave: () => async (action: () => void) => action() }))
jest.mock('./SettingsPageShell', () => ({ SettingsPageShell: ({ children }: { children: React.ReactNode }) => children }))
jest.mock('@/core', () => ({ userFacingErrorDetail: String }))
jest.mock('@/i18n', () => ({ changeAppLanguage: jest.fn() }))
jest.mock('@/modules/integrations', () => ({ resolveSearchProvider: () => 'off' }))
jest.mock('@/presentation/features/settings/portableDataCommand', () => ({ exportPortableDataToJsonFile: (...args: unknown[]) => mockExportData(...args), importPortableDataFromJsonFile: (...args: unknown[]) => mockImportData(...args) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }))
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }))
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }))
jest.mock('expo-constants', () => ({ expoConfig: {} }))
jest.mock('@/platform/native/androidApkUpdates', () => ({
  checkLatestApkRelease: jest.fn(), prepareApkRelease: jest.fn(), openPreparedApkInstaller: jest.fn(),
  discardPreparedApk: jest.fn(async () => undefined), downloadAndOpenApkInstaller: jest.fn(),
  getVersionSnapshot: () => ({ appVersion: '1.0.0', buildVersion: '1', updateMode: 'apk', hotUpdateMode: 'disabled' }),
  formatApkSizeBytes: (size: number) => `${size} B`,
}))
// Root progress is exercised across themes; production five-second timing has its own integration suite.
jest.mock('@/core/appUpdateIdle', () => ({
  ...jest.requireActual('@/core/appUpdateIdle'), APP_UPDATE_QUIET_PERIOD_MS: 1,
  scheduleIdleAppUpdate: (input: Parameters<typeof import('@/core/appUpdateIdle')['scheduleIdleAppUpdate']>[0]) =>
    jest.requireActual('@/core/appUpdateIdle').scheduleIdleAppUpdate({ ...input, quietPeriodMs: 1 }),
}))
jest.mock('@/bootstrap/androidStatusNotification', () => ({ clearAndroidStatusNotification: jest.fn(), updateAndroidStatusNotification: jest.fn() }))
jest.mock('animal-island-ui-rn', () => ({ ...jest.requireActual('animal-island-ui-rn'), RadioGroup: require('react-native').View }))
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
    IsleProgress: jest.requireActual('@/components/ui/isle/IsleKit').IsleProgress, IsleDisclosure: View, IsleToggle: View,
    ISLE_MIN_TOUCH_TARGET: 44, useIsleDialog: () => mockDialog,
  }
})
jest.mock('moti', () => ({
  MotiView: jest.fn((props) => require('react').createElement(require('react-native').View, props)),
  AnimatePresence: jest.fn(({ children }) => children),
}))

function UpdateRoot(props: Parameters<typeof SystemSettingsPanelContent>[0]) {
  useAutomaticApkUpdateInstall()
  return <SystemSettingsPanelContent {...props} />
}

beforeEach(() => {
  jest.clearAllMocks()
  mockMotion = 'full'
  mockState.settings.themeId = 'material'
  mockState.settings.backgroundMotion = undefined
  mockState.settings.neverRemindUpdates = false
  mockState.settings.ignoredApkUpdate = undefined
  mockState.settings.autoApkDownloadEnabled = false
  mockState.settings.apkUpdateBannerEnabled = true
  mockState.settings.apkUpdateChannel = 'stable'
  mockSettingsListeners.clear()
  appUpdateActivity.setForeground(true)
  mockUpdateSettings.mockImplementation((patch) => {
    Object.assign(mockState.settings, patch)
    for (const listener of mockSettingsListeners) listener(mockState)
  })
  Constants.expoConfig!.extra = { distributionChannel: 'github' }
  mockDialog.confirm.mockResolvedValue(true)
  jest.mocked(checkLatestApkRelease).mockReset().mockResolvedValue({ status: 'available', message: 'available', release })
  jest.mocked(prepareApkRelease).mockReset().mockImplementation(async (target) => ({
    status: 'prepared', message: 'prepared', release: target,
    prepared: { release: target, localUri: 'file:///cache/update.apk' },
  }))
  jest.mocked(openPreparedApkInstaller).mockReset().mockResolvedValue({ status: 'downloaded', message: 'opened' })
  jest.mocked(flushPersistedSettings).mockReset().mockResolvedValue(undefined)
})

it('keeps manual checks usable with never-remind enabled and the target previously ignored', async () => {
  mockState.settings.neverRemindUpdates = true
  mockState.settings.ignoredApkUpdate = {
    installedVersion: '1.0.0', installedBuildVersion: '1', targetVersion: release.version,
  }
  const screen = await render(<UpdateRoot panel="updates" />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
  expect(mockDialog.confirm).toHaveBeenCalledWith(expect.objectContaining({
    confirmLabel: 'updates.updateNow', cancelLabel: 'updates.ignoreVersion', renderBody: expect.any(Function),
  }))
  expect(prepareApkRelease).toHaveBeenCalledTimes(1)
  expect(mockUpdateSettings).not.toHaveBeenCalledWith(expect.objectContaining({ neverRemindUpdates: false }))
})

it('persists the ignored target with the actual native installed baseline without starting an installer', async () => {
  mockDialog.confirm.mockResolvedValueOnce(false)
  const screen = await render(<UpdateRoot panel="updates" />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
  expect(mockUpdateSettings).toHaveBeenCalledWith({ ignoredApkUpdate: {
    installedVersion: '1.0.0', installedBuildVersion: '1', targetVersion: release.version,
  } })
  expect(flushPersistedSettings).toHaveBeenCalled()
  expect(prepareApkRelease).not.toHaveBeenCalled()
})

it('saves the independent never-remind switch', async () => {
  const screen = await render(<UpdateRoot panel="updates" />)
  const toggle = screen.container.queryAll(node => node.props.title === 'settings.neverRemindUpdates')[0]
  expect(toggle.props.active).toBe(false)
  await fireEvent.press(toggle)
  expect(mockUpdateSettings).toHaveBeenCalledWith({ neverRemindUpdates: true })
  expect(flushPersistedSettings).toHaveBeenCalled()
  expect(mockDialog.toast).toHaveBeenCalledWith({ title: 'updates.remindersDisabled', tone: 'amber' })
})

it('shows the persisted enabled switch and reports a failed reminder-setting save', async () => {
  mockState.settings.neverRemindUpdates = true
  const screen = await render(<UpdateRoot panel="updates" />)
  const enabledToggle = screen.container.queryAll(node => node.props.title === 'settings.neverRemindUpdates')[0]
  expect(enabledToggle.props.active).toBe(true)
  jest.mocked(flushPersistedSettings).mockRejectedValueOnce(new Error('storage unavailable'))
  await fireEvent.press(enabledToggle)
  expect(mockUpdateSettings).toHaveBeenCalledWith({ neverRemindUpdates: false })
  expect(mockDialog.toast).toHaveBeenCalledWith({ title: 'settingsWorkspace.saveFailed', tone: 'danger' })
})

it.each(CANONICAL_THEME_IDS)('names actual %s APK progress, retires a percentage during verification and ignores cancelled callbacks', async family => {
  mockState.settings.themeId = family
  mockMotion = 'none'
  const check = deferred<ApkUpdateResult>()
  const install = deferred<ApkUpdateResult>()
  jest.mocked(checkLatestApkRelease).mockReturnValueOnce(check.promise)
  jest.mocked(prepareApkRelease).mockReturnValueOnce(install.promise)
  const screen = await render(<IsleThemeProvider><UpdateRoot panel="updates" /></IsleThemeProvider>)
  try {
    expect(screen.queryByRole('progressbar')).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
    const currentValue = (name: string) => {
      const bar = screen.getByRole('progressbar', { name })
      return bar.props['aria-valuenow'] ?? bar.props.accessibilityValue?.now
    }
    expect(currentValue('settings.checkingUpdate')).toBeUndefined()
    await act(async () => { check.resolve({ status: 'available', message: 'available', release }); await check.promise })
    const options = jest.mocked(prepareApkRelease).mock.calls[0][1]!
    await act(() => options.onProgress?.({ stage: 'downloading', release, percent: 25 }))
    expect(currentValue('settings.apkUpdateProgressDownloading')).toBe(25)
    await act(() => options.onProgress?.({ stage: 'verifying', release }))
    expect(currentValue('settings.apkUpdateProgressVerifying')).toBeUndefined()
    expect(screen.queryByRole('progressbar', { name: 'settings.apkUpdateProgressDownloading' })).toBeNull()
    expect(screen.queryByText('25%')).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: 'updates.cancelPending' }))
    expect(options.signal?.aborted).toBe(true)
    await act(() => options.onProgress?.({ stage: 'downloading', release, percent: 90 }))
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByText('90%')).toBeNull()
    await act(async () => { install.resolve({ status: 'cancelled', message: 'cancelled' }); await install.promise })
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(mockDialog.notice).not.toHaveBeenCalled()
  } finally {
    await screen.unmount()
    await act(async () => {
      check.resolve({ status: 'unsupported', message: 'fixture cleanup' })
      install.resolve({ status: 'cancelled', message: 'fixture cleanup' })
      await Promise.all([check.promise, install.promise])
    })
  }
})

it.each([
  ['minimal', 'Static'], ['monet', 'Subtle'], ['material', 'Static'],
  ['liquid-glass', 'Subtle'], ['animal-island-ui', 'Static'],
])('shows the resolved %s motion default without writing over an explicit choice', async (family, expected) => {
  mockState.settings.themeId = family
  const screen = await render(<SystemSettingsPanelContent panel="appearance" />)
  expect(screen.getByRole('radio', { name: `settings.backgroundMotion${expected}` })).toBeChecked()
  expect(mockUpdateSettings).not.toHaveBeenCalled()
  mockState.settings.backgroundMotion = 'immersive'
  await screen.rerender(<SystemSettingsPanelContent key="explicit-choice" panel="appearance" />)
  expect(screen.getByRole('radio', { name: 'settings.backgroundMotionImmersive' })).toBeChecked()
  expect(mockUpdateSettings).not.toHaveBeenCalled()
})

it('opens Google Play only on a user click and reports opening errors', async () => {
  Constants.expoConfig!.extra = { distributionChannel: 'google-play' }
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
  const screen = await render(<UpdateRoot panel="updates" />)
  expect(openURL).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: 'updates.openGooglePlay' }))
  expect(openURL).toHaveBeenCalledWith('https://play.google.com/store/apps/details?id=com.islemind.app')
  openURL.mockRejectedValueOnce(new Error('no handler'))
  await fireEvent.press(screen.getByRole('button', { name: 'updates.openGooglePlay' }))
  expect(mockDialog.toast).toHaveBeenCalledWith({ title: 'updates.storeOpenFailed', tone: 'danger' })
  expect(checkLatestApkRelease).not.toHaveBeenCalled()
  expect(prepareApkRelease).not.toHaveBeenCalled()
})

it('guards immediate repeated clicks before React can disable the check button', async () => {
  const pending = deferred<ApkUpdateResult>()
  jest.mocked(checkLatestApkRelease).mockReturnValueOnce(pending.promise)
  const screen = await render(<UpdateRoot panel="updates" />)
  const button = jest.mocked(IsleButton).mock.calls.findLast(([props]) => props.label === 'settings.checkApk')![0]
  const event = {} as Parameters<NonNullable<typeof button.onPress>>[0]
  await act(() => { button.onPress?.(event); button.onPress?.(event) })
  expect(checkLatestApkRelease).toHaveBeenCalledTimes(1)
  await act(() => pending.resolve({ status: 'available', message: 'available', release }))
  expect(mockDialog.confirm).toHaveBeenCalledTimes(1)
  expect(prepareApkRelease).toHaveBeenCalledTimes(1)
  expect(mockUpdateSettings).toHaveBeenCalledWith({ lastApkUpdateCheckAt: expect.any(Number), lastApkUpdateCheckChannel: 'stable' })
  expect(screen.getByRole('button', { name: 'settings.checkApk' })).toBeEnabled()
})

it('cancels download, ignores stale progress and allows retry without an error dialog', async () => {
  const pending = deferred<ApkUpdateResult>()
  jest.mocked(prepareApkRelease).mockImplementationOnce(async (_release, options) => {
    options?.onProgress?.({ stage: 'downloading', release, percent: 10 })
    return pending.promise
  })
  const screen = await render(<UpdateRoot panel="updates" />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
  const options = jest.mocked(prepareApkRelease).mock.calls[0][1]!
  await fireEvent.press(screen.getByRole('button', { name: 'updates.cancelPending' }))
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
  const screen = await render(<UpdateRoot panel="updates" />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
  expect(mockDialog.confirm).toHaveBeenCalledTimes(1)
  if (exit === 'unmount') await screen.unmount()
  else await screen.rerender(<UpdateRoot panel="appearance" />)
  await act(() => confirmation.resolve(true))
  expect(prepareApkRelease).not.toHaveBeenCalled()
  if (exit === 'panel-change') {
    await screen.rerender(<UpdateRoot panel="updates" />)
    expect(screen.getByRole('button', { name: 'settings.checkApk' })).toBeEnabled()
  }
})

it('aborts on unmount and does not publish late native progress or terminal feedback', async () => {
  const pending = deferred<ApkUpdateResult>()
  jest.mocked(prepareApkRelease).mockReturnValueOnce(pending.promise)
  const screen = await render(<UpdateRoot panel="updates" />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
  const options = jest.mocked(prepareApkRelease).mock.calls[0][1]!
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

it('keeps confirmed preparation owned by the root after navigating away from Settings', async () => {
  const pending = deferred<ApkUpdateResult>()
  jest.mocked(prepareApkRelease).mockReturnValueOnce(pending.promise)
  const screen = await render(<UpdateRoot panel="updates" />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
  const options = jest.mocked(prepareApkRelease).mock.calls[0][1]!
  await screen.rerender(<UpdateRoot panel="appearance" />)
  expect(options.signal?.aborted).toBe(false)
  await act(() => pending.resolve({
    status: 'prepared', message: 'Ready', prepared: { release, localUri: 'file:///cache/update.apk' },
  }))
  await waitFor(() => expect(openPreparedApkInstaller).toHaveBeenCalledTimes(1))
})

it('preserves synchronous consent when the panel changes before the confirmation promise settles', async () => {
  const confirmation = deferred<boolean>()
  const candidate = { ...release }
  jest.mocked(checkLatestApkRelease).mockResolvedValueOnce({ status: 'available', message: 'Available', release: candidate })
  mockDialog.confirm.mockReturnValueOnce(confirmation.promise)
  const screen = await render(<UpdateRoot panel="updates" />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
  const options = mockDialog.confirm.mock.calls[0][0]
  await act(() => options.onConfirm())
  candidate.apkUrl = 'https://example.test/replaced-after-consent.apk'
  await screen.rerender(<UpdateRoot panel="appearance" />)
  await act(() => confirmation.resolve(true))
  await waitFor(() => expect(prepareApkRelease).toHaveBeenCalledTimes(1))
  expect(jest.mocked(prepareApkRelease).mock.calls[0][0].apkUrl).toBe(release.apkUrl)
})

it('revokes an unapproved manual result when the release channel changes', async () => {
  const pending = deferred<ApkUpdateResult>()
  jest.mocked(checkLatestApkRelease).mockReturnValueOnce(pending.promise)
  const screen = await render(<UpdateRoot panel="updates" />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
  await act(() => {
    mockState.settings.apkUpdateChannel = 'every-release'
    for (const listener of mockSettingsListeners) listener(mockState)
    pending.resolve({ status: 'available', message: 'Old channel', release })
  })
  expect(mockDialog.confirm).not.toHaveBeenCalled()
  expect(prepareApkRelease).not.toHaveBeenCalled()
  expect(mockUpdateSettings).not.toHaveBeenCalled()
})

it('recovers from unexpected check exceptions without recording a successful check', async () => {
  jest.mocked(checkLatestApkRelease).mockRejectedValueOnce(new Error('unexpected failure'))
  const screen = await render(<UpdateRoot panel="updates" />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
  expect(mockDialog.notice).toHaveBeenCalledWith(expect.objectContaining({ title: 'settings.apkUpdateFailed', tone: 'danger' }))
  expect(mockUpdateSettings).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'settings.checkApk' })).toBeEnabled()
  await fireEvent.press(screen.getByRole('button', { name: 'settings.checkApk' }))
  expect(prepareApkRelease).toHaveBeenCalledTimes(1)
})
afterEach(async () => {
  await cleanup()
  expect(downloadAndOpenApkInstaller).not.toHaveBeenCalled()
  appUpdateActivity.setForeground(false)
  jest.restoreAllMocks()
})

it.each(['github', 'google-play'])('renders channel-appropriate update controls for %s', async channel => {
  Constants.expoConfig!.extra = { distributionChannel: channel }
  const screen = await render(<UpdateRoot panel="updates" />)
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

it('shows all five appearance sections on one page without task navigation', async () => {
  const screen = await render(<SystemSettingsPanelContent panel="appearance" />)
  for (const id of ['theme', 'mode', 'accent', 'background', 'language']) {
    expect(screen.getByTestId(`settings-section-${id}`)).toBeTruthy()
    expect(screen.queryByTestId(`settings-task-${id}`)).toBeNull()
  }
  expect(screen.getByTestId('settings-theme-family-group')).toBeTruthy()
  expect(screen.getByTestId('settings-theme-mode-group')).toBeTruthy()
  expect(screen.getByTestId('settings-background-motion-group')).toBeTruthy()
  expect(screen.getByLabelText('English')).toBeTruthy()
  expect(mockUpdateSettings).not.toHaveBeenCalled()
})


it('serializes data operations and exposes a retryable export failure', async () => {
  let fail!: (error: Error) => void
  mockExportData.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  const screen = await render(<SystemSettingsPanelContent panel="data" />)
  await fireEvent.press(screen.getByText('settings.exportJson'))
  expect(screen.getByRole('button', { name: 'settings.exportJson' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'settings.importJson' })).toBeDisabled()
  await fireEvent.press(screen.getByText('settings.importJson'))
  expect(mockImportData).not.toHaveBeenCalled()
  await act(async () => { fail(new Error('disk unavailable')) })
  expect(screen.getByText('settingsSubsystem.operationFailed')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'settings.exportJson' })).not.toBeDisabled()
})

it.each([
  ['selection_cancelled', 'settings.importCancelledMessage'],
  ['operation_cancelled', 'settings.importCancelledMessage'],
  ['invalid_json', 'settings.importInvalidJsonMessage'],
  ['protected_storage_required', 'settings.importProtectedStorageRequiredMessage'],
])('reports %s accurately and releases the import controls', async (reason, message) => {
  mockImportData.mockResolvedValueOnce({ ok: false, kind: 'invalid', reason })
  const screen = await render(<SystemSettingsPanelContent panel="data" />)
  await fireEvent.press(screen.getByText('settings.importJson'))
  expect(mockDialog.notice).toHaveBeenCalledWith(expect.objectContaining({ message }))
  expect(screen.getByRole('button', { name: 'settings.importJson' })).toBeEnabled()
})

it('reports a browser backup as generated without presenting an expiring blob URL as a saved file', async () => {
  mockExportData.mockResolvedValueOnce({ uri: 'blob:http://localhost/temporary-backup' })
  const screen = await render(<SystemSettingsPanelContent panel="data" />)
  await fireEvent.press(screen.getByText('settings.exportJson'))
  expect(mockDialog.notice).toHaveBeenCalledWith(expect.objectContaining({
    title: 'settings.exportReady', message: 'settings.exportBrowserReadyMessage',
  }))
  expect(screen.getByRole('button', { name: 'settings.exportJson' })).toBeEnabled()
})
