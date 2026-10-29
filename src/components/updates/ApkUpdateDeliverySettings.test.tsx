import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native'
import { useSettingsStore } from '@/store/settingsStore'
import { flushPersistedSettings } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import { clearAutomaticApkUpdatePromptSession } from '@/presentation/features/settings/apkUpdateInteraction'
import type { ApkReleaseInfo } from '@/platform/native/androidApkUpdates'
import { apkUpdateDeliverySession } from './apkUpdateDeliverySession'
import { ApkAutomaticDownloadConsent } from './ApkAutomaticDownloadConsent'
import { ApkUpdateDeliverySettings } from './ApkUpdateDeliverySettings'

const mockDialog = { confirm: jest.fn(), notice: jest.fn(), toast: jest.fn() }
jest.mock('./ApkAutomaticDownloadConsent', () => ({ ApkAutomaticDownloadConsent: () => null }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({
  colors: { text: '#111', textSecondary: '#555', primary: '#007' },
}) }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable: MockPressable, Text: MockText, View: MockView } = require('react-native')
  return {
    useIsleDialog: () => mockDialog,
    IsleButton: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) =>
      <MockPressable accessibilityRole="button" disabled={disabled} onPress={onPress}><MockText>{label}</MockText></MockPressable>,
    IsleToggle: ({ title, active, onPress }: { title: string; active: boolean; onPress: () => void }) =>
      <MockPressable accessibilityRole="switch" accessibilityState={{ checked: active }} onPress={onPress}><MockText>{title}</MockText></MockPressable>,
    IsleProgress: MockView,
  }
})
jest.mock('@/platform/native/androidApkUpdates', () => ({
  getVersionSnapshot: () => ({ appVersion: '1.1.0', buildVersion: '11', updateMode: 'apk', hotUpdateMode: 'disabled' }),
}))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({
  flushPersistedSettings: jest.fn(async () => undefined),
}))

const target: ApkReleaseInfo = {
  version: '1.2.0', versionCode: 12, tagName: 'v1.2.0', name: 'Release',
  htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.2.0',
  apkUrl: 'https://github.com/domidoremi/IsleMind/releases/download/v1.2.0/a.apk',
  apkName: 'a.apk', publishedAt: null, sha256: 'a'.repeat(64), sizeBytes: 100,
  releaseNotes: [{ version: '1.1.0', notes: '- Installed' }, { version: '1.2.0', notes: '- Pending' }],
  releaseNotesComplete: true,
}
const initial = useSettingsStore.getState()
let binding: ReturnType<typeof apkUpdateDeliverySession.bind>
const install = jest.fn()
const cancel = jest.fn()
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}
beforeEach(() => {
  jest.clearAllMocks()
  clearAutomaticApkUpdatePromptSession()
  useSettingsStore.setState({ ...initial,
    updateSettings: (patch) => useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, ...patch } }),
    settings: {
    ...initial.settings, autoApkDownloadEnabled: false, apkUpdateBannerEnabled: true, ignoredApkUpdate: undefined,
  } }, true)
  mockDialog.confirm.mockReset().mockResolvedValue(false)
  install.mockReset().mockResolvedValue(true)
  cancel.mockReset().mockImplementation(() => binding.publish({ stage: 'idle', approved: false }))
  binding = apkUpdateDeliverySession.bind({ start: install, cancel })
})
afterEach(async () => {
  await cleanup()
  binding.release()
  clearAutomaticApkUpdatePromptSession()
  useSettingsStore.setState(initial, true)
})

it('requires separate consent to enable default-off preparation and persists both independent controls', async () => {
  const screen = await render(<ApkUpdateDeliverySettings />)
  const automatic = screen.getByRole('switch', { name: 'updates.autoDownload' })
  expect(automatic).not.toBeChecked()
  await fireEvent.press(automatic)
  expect(mockDialog.confirm).toHaveBeenCalledWith(expect.objectContaining({
    title: 'updates.autoDownloadTitle', message: 'updates.autoDownloadConsent',
    confirmLabel: 'updates.enableAutoDownload', cancelLabel: 'updates.notNow',
    renderBody: expect.any(Function),
  }))
  expect(mockDialog.confirm.mock.calls[0][0].renderBody().type).toBe(ApkAutomaticDownloadConsent)
  expect(useSettingsStore.getState().settings.autoApkDownloadEnabled).toBe(false)
  mockDialog.confirm.mockResolvedValueOnce(true)
  await fireEvent.press(automatic)
  await waitFor(() => expect(useSettingsStore.getState().settings.autoApkDownloadEnabled).toBe(true))
  expect(flushPersistedSettings).toHaveBeenCalled()
  expect(install).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('switch', { name: 'updates.progressBanner' }))
  expect(useSettingsStore.getState().settings.apkUpdateBannerEnabled).toBe(false)
  expect(useSettingsStore.getState().settings.autoApkDownloadEnabled).toBe(true)
})

it('disables automatic downloads without another consent or cancelling an already approved update', async () => {
  useSettingsStore.getState().updateSettings({ autoApkDownloadEnabled: true })
  binding.publish({ stage: 'waiting', target, approved: true })
  const screen = await render(<ApkUpdateDeliverySettings />)
  await fireEvent.press(screen.getByRole('switch', { name: 'updates.autoDownload' }))
  expect(useSettingsStore.getState().settings.autoApkDownloadEnabled).toBe(false)
  expect(flushPersistedSettings).toHaveBeenCalled()
  expect(mockDialog.confirm).not.toHaveBeenCalled()
  expect(cancel).not.toHaveBeenCalled()
  expect(install).not.toHaveBeenCalled()
  expect(apkUpdateDeliverySession.getSnapshot()).toMatchObject({ stage: 'waiting', approved: true })
})

it('fences repeated enable taps and a confirmation that resolves after Settings unmounts', async () => {
  const confirmation = deferred<boolean>()
  mockDialog.confirm.mockReturnValueOnce(confirmation.promise)
  const screen = await render(<ApkUpdateDeliverySettings />)
  const automatic = screen.getByRole('switch', { name: 'updates.autoDownload' })
  await fireEvent.press(automatic)
  await fireEvent.press(automatic)
  expect(mockDialog.confirm).toHaveBeenCalledTimes(1)
  const signal: AbortSignal = mockDialog.confirm.mock.calls[0][0].signal
  await screen.unmount()
  expect(signal.aborted).toBe(true)
  await act(() => confirmation.resolve(true))
  expect(useSettingsStore.getState().settings.autoApkDownloadEnabled).toBe(false)
})

it('prepared-review cancellation neither ignores the version nor approves installation', async () => {
  binding.publish({ stage: 'prepared', target, approved: false })
  const screen = await render(<ApkUpdateDeliverySettings />)
  await fireEvent.press(screen.getByRole('button', { name: 'updates.reviewPrepared' }))
  await waitFor(() => expect(mockDialog.confirm).toHaveBeenCalledTimes(1))
  expect(mockDialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ cancelLabel: 'common.cancel' }))
  expect(useSettingsStore.getState().settings.ignoredApkUpdate).toBeUndefined()
  expect(install).not.toHaveBeenCalled()
  expect(apkUpdateDeliverySession.getSnapshot().stage).toBe('prepared')
})

it('cancels pending bytes and revokes an unfinished prepared-review request', async () => {
  binding.publish({ stage: 'prepared', target, approved: false })
  const confirmation = deferred<boolean>()
  mockDialog.confirm.mockReturnValueOnce(confirmation.promise)
  const screen = await render(<ApkUpdateDeliverySettings />)
  await fireEvent.press(screen.getByRole('button', { name: 'updates.reviewPrepared' }))
  await waitFor(() => expect(mockDialog.confirm).toHaveBeenCalledTimes(1))
  const signal: AbortSignal = mockDialog.confirm.mock.calls[0][0].signal
  await fireEvent.press(screen.getByRole('button', { name: 'updates.cancelPending' }))
  expect(signal.aborted).toBe(true)
  await act(() => confirmation.resolve(true))
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(install).not.toHaveBeenCalled()
  expect(useSettingsStore.getState().settings.ignoredApkUpdate).toBeUndefined()
})

it('preserves captured prepared-target approval across navigation without granting approval to newer metadata', async () => {
  binding.publish({ stage: 'prepared', target, approved: false })
  const confirmation = deferred<boolean>()
  mockDialog.confirm.mockReturnValueOnce(confirmation.promise)
  const screen = await render(<ApkUpdateDeliverySettings />)
  await fireEvent.press(screen.getByRole('button', { name: 'updates.reviewPrepared' }))
  await waitFor(() => expect(mockDialog.confirm).toHaveBeenCalledTimes(1))
  const options = mockDialog.confirm.mock.calls[0][0]
  await act(() => options.onConfirm())
  await screen.unmount()
  expect(options.signal.aborted).toBe(false)
  await act(() => confirmation.resolve(true))
  expect(install).toHaveBeenCalledWith(expect.objectContaining({ apkUrl: target.apkUrl, sha256: target.sha256 }))
  expect(Object.isFrozen(install.mock.calls[0][0])).toBe(true)
})

it('offers read-only cumulative notes while waiting without another consent or delivery command', async () => {
  binding.publish({ stage: 'waiting', target, approved: true })
  const screen = await render(<ApkUpdateDeliverySettings />)
  await fireEvent.press(screen.getByRole('button', { name: 'updates.releaseNotes' }))
  await waitFor(() => expect(mockDialog.notice).toHaveBeenCalledTimes(1))
  const note = mockDialog.notice.mock.calls[0][0]
  expect(note).toMatchObject({ title: 'updates.releaseNotes', renderBody: expect.any(Function) })
  const body = await render(note.renderBody())
  expect(body.getByText('- Pending')).toBeTruthy()
  expect(body.queryByText('- Installed')).toBeNull()
  expect(mockDialog.confirm).not.toHaveBeenCalled()
  expect(install).not.toHaveBeenCalled()
  expect(useSettingsStore.getState().settings.ignoredApkUpdate).toBeUndefined()
})

it('keeps cancellation available during revalidation and shows the native-settlement fence', async () => {
  binding.publish({ stage: 'validating', target, approved: true })
  const screen = await render(<ApkUpdateDeliverySettings />)
  expect(screen.getByRole('button', { name: 'updates.cancelPending' })).toBeEnabled()
  await act(() => binding.publish({ stage: 'cancelling', target, approved: false }))
  expect(screen.getByRole('button', { name: 'updates.cancelling' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'updates.reviewPrepared' })).toBeNull()
})

it.each(['en', 'zh-CN', 'ja'])('provides the preparation, consent, cancellation and live-stage strings in %s', (language) => {
  const updates = require(`@/i18n/resources/${language}.json`).updates
  for (const key of ['autoDownload', 'autoDownloadConsent', 'autoDownloadDescription', 'autoDownloadTitle',
    'enableAutoDownload', 'notNow', 'autoDownloadConditions', 'autoDownloadForeground', 'autoDownloadWifi',
    'autoDownloadProxyOff', 'autoDownloadInstallBoundary', 'autoDownloadInstallDetail', 'autoDownloadMeteredWarning',
    'autoDownloadDetails', 'autoDownloadNetworkDetail', 'autoDownloadControlDetail', 'progressBanner',
    'progressBannerDescription', 'preparedMessage', 'reviewPrepared', 'cancelPending', 'waitingForIdle',
    'invalidPreparation', 'preparedNotInstalled', 'cancelBeforeReplacing']) {
    expect(typeof updates[key]).toBe('string')
    expect(updates[key].trim()).not.toBe('')
    expect(updates[key]).not.toContain('\ufffd')
  }
  for (const stage of ['preparing', 'prepared', 'waiting', 'validating', 'cancelling', 'opening']) {
    expect(typeof updates.deliveryStage[stage]).toBe('string')
    expect(updates.deliveryStage[stage].trim()).not.toBe('')
  }
})
