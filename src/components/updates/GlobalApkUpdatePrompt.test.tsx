import { act, cleanup, render } from '@testing-library/react-native'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'
import { APP_UPDATE_QUIET_PERIOD_MS } from '@/core/appUpdateIdle'
import { useSettingsStore } from '@/store/settingsStore'
import { beginManualApkUpdateCheck, clearAutomaticApkUpdatePromptSession, markApkUpdatePromptHandled } from '@/presentation/features/settings/apkUpdateInteraction'
import type { ApkReleaseInfo, ApkUpdateResult } from '@/platform/native/androidApkUpdates'
import { GlobalApkUpdatePrompt } from './GlobalApkUpdatePrompt'

const mockPrompt = jest.fn()
const mockStartInstall = jest.fn()
const mockDialogListeners = new Set<() => void>()
let mockDialogPending = false
const mockDialog = {
  toast: jest.fn(),
  hasPendingDialogs: () => mockDialogPending,
  subscribeDialogs: (listener: () => void) => { mockDialogListeners.add(listener); return () => { mockDialogListeners.delete(listener) } },
}
const mockTranslate = (key: string) => key
jest.mock('@/components/ui/isle', () => ({ useIsleDialog: () => mockDialog }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }))
jest.mock('./useApkUpdatePrompt', () => ({ useApkUpdatePrompt: () => mockPrompt }))
jest.mock('./useAutomaticApkUpdateInstall', () => ({ useAutomaticApkUpdateInstall: () => mockStartInstall }))

const baseline = { appVersion: '1.1.0', buildVersion: '11', updateMode: 'apk' as const, hotUpdateMode: 'disabled' as const }
const target: ApkReleaseInfo = {
  version: '1.2.0', versionCode: 12, tagName: 'v1.2.0', name: 'Release',
  htmlUrl: 'https://example.test/release', apkUrl: 'https://example.test/a.apk',
  apkName: 'a.apk', publishedAt: null, sha256: 'a'.repeat(64), sizeBytes: 100,
  releaseNotes: [{ version: '1.2.0', notes: '- Original' }],
}
const initial = useSettingsStore.getState()
let resolvePrompt: (value: ApkReleaseInfo | undefined) => void

function update(release = target): ApkUpdateResult {
  return { status: 'available', message: 'Available', release, currentVersion: baseline }
}
async function tick(ms = APP_UPDATE_QUIET_PERIOD_MS) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms) })
}
function reminderPatch(patch: Partial<typeof initial.settings>) {
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, ...patch } })
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  clearAutomaticApkUpdatePromptSession()
  mockDialogPending = false
  mockDialogListeners.clear()
  appUpdateActivity.setForeground(true)
  appUpdateActivity.recordActivity()
  useSettingsStore.setState({ ...initial, settings: {
    ...initial.settings, autoUpdateCheckEnabled: true, neverRemindUpdates: false, ignoredApkUpdate: undefined,
  } }, true)
  mockPrompt.mockImplementation((_target, _baseline, options) => new Promise<ApkReleaseInfo | undefined>((resolve) => {
    resolvePrompt = resolve
    options.signal.addEventListener('abort', () => resolve(undefined), { once: true })
  }))
})
afterEach(async () => {
  await cleanup()
  clearAutomaticApkUpdatePromptSession()
  appUpdateActivity.setForeground(false)
  useSettingsStore.setState(initial, true)
  jest.useRealTimers()
})

it('waits for foreground quiet time, not merely an available hydrated target', async () => {
  await render(<GlobalApkUpdatePrompt update={update()} />)
  await tick(APP_UPDATE_QUIET_PERIOD_MS - 1)
  expect(mockPrompt).not.toHaveBeenCalled()
  await tick(1)
  expect(mockPrompt).toHaveBeenCalledTimes(1)
  expect(mockPrompt).toHaveBeenCalledWith(expect.objectContaining({ apkUrl: target.apkUrl }), baseline, expect.objectContaining({ automatic: true }))
})

it('does not accumulate idle time in the background or while a blocker is active', async () => {
  appUpdateActivity.setForeground(false)
  await render(<GlobalApkUpdatePrompt update={update()} />)
  await tick(60_000)
  expect(mockPrompt).not.toHaveBeenCalled()
  const release = appUpdateActivity.acquireBlocker('voice')
  await act(() => appUpdateActivity.setForeground(true))
  await tick(60_000)
  expect(mockPrompt).not.toHaveBeenCalled()
  await act(release)
  await tick(APP_UPDATE_QUIET_PERIOD_MS - 1)
  expect(mockPrompt).not.toHaveBeenCalled()
  await tick(1)
  expect(mockPrompt).toHaveBeenCalledTimes(1)
})

it('waits until other dialogs close rather than queuing a duplicate confirmation', async () => {
  mockDialogPending = true
  await render(<GlobalApkUpdatePrompt update={update()} />)
  await tick(60_000)
  expect(mockPrompt).not.toHaveBeenCalled()
  await act(() => {
    mockDialogPending = false
    for (const listener of mockDialogListeners) listener()
  })
  await tick()
  expect(mockPrompt).toHaveBeenCalledTimes(1)
})

it('uses refreshed notes without resetting quiet time when the artifact identity is unchanged', async () => {
  const screen = await render(<GlobalApkUpdatePrompt update={update()} />)
  await tick(4_000)
  const refreshed = { ...target, releaseNotes: [{ version: target.version, notes: '- Complete notes' }] }
  await screen.rerender(<GlobalApkUpdatePrompt update={update(refreshed)} />)
  await tick(1_000)
  expect(mockPrompt).toHaveBeenCalledTimes(1)
  expect(mockPrompt.mock.calls[0][0].releaseNotes[0].notes).toBe('- Complete notes')
  expect(Object.isFrozen(mockPrompt.mock.calls[0][0])).toBe(true)
})

it('cancels and reschedules an interrupted automatic prompt without recording an ignore', async () => {
  await render(<GlobalApkUpdatePrompt update={update()} />)
  await tick()
  const signal = mockPrompt.mock.calls[0][2].signal
  await act(() => appUpdateActivity.setForeground(false))
  expect(signal.aborted).toBe(true)
  expect(useSettingsStore.getState().settings.ignoredApkUpdate).toBeUndefined()
  await tick(60_000)
  await act(() => appUpdateActivity.setForeground(true))
  await tick()
  expect(mockPrompt).toHaveBeenCalledTimes(2)
  expect(mockStartInstall).not.toHaveBeenCalled()
})

it('gives manual checks ownership, then permits a fresh idle-time automatic attempt', async () => {
  await render(<GlobalApkUpdatePrompt update={update()} />)
  await tick()
  let finish!: () => void
  await act(() => { finish = beginManualApkUpdateCheck() })
  expect(mockPrompt.mock.calls[0][2].signal.aborted).toBe(true)
  await tick(60_000)
  expect(mockPrompt).toHaveBeenCalledTimes(1)
  await act(finish)
  await tick()
  expect(mockPrompt).toHaveBeenCalledTimes(2)
  expect(useSettingsStore.getState().settings.ignoredApkUpdate).toBeUndefined()
})

it('keeps explicit consent for A even if reminders are disabled or B arrives in the same turn', async () => {
  const screen = await render(<GlobalApkUpdatePrompt update={update()} />)
  await tick()
  const [selected, , options] = mockPrompt.mock.calls[0]
  const higher = { ...target, version: '1.3.0', versionCode: 13, apkUrl: 'https://example.test/b.apk' }
  await act(async () => {
    options.onApproved(selected)
    resolvePrompt(selected)
    reminderPatch({ neverRemindUpdates: true })
    await screen.rerender(<GlobalApkUpdatePrompt update={update(higher)} />)
  })
  expect(mockStartInstall).toHaveBeenCalledTimes(1)
  expect(mockStartInstall).toHaveBeenCalledWith(selected)
  expect(selected.apkUrl).toBe(target.apkUrl)
  expect(options.signal.aborted).toBe(false)
})

it('replaces an unapproved A with a newly discovered B without installing either automatically', async () => {
  const screen = await render(<GlobalApkUpdatePrompt update={update()} />)
  await tick()
  const signal = mockPrompt.mock.calls[0][2].signal
  const higher = { ...target, version: '1.3.0', versionCode: 13, apkUrl: 'https://example.test/b.apk' }
  await screen.rerender(<GlobalApkUpdatePrompt update={update(higher)} />)
  expect(signal.aborted).toBe(true)
  await tick()
  expect(mockPrompt.mock.calls[1][0].apkUrl).toBe(higher.apkUrl)
  expect(mockStartInstall).not.toHaveBeenCalled()
})

it('suppresses already handled targets without creating a timer or retry loop', async () => {
  markApkUpdatePromptHandled(baseline, target)
  await render(<GlobalApkUpdatePrompt update={update()} />)
  await tick(60_000)
  expect(mockPrompt).not.toHaveBeenCalled()
  expect(jest.getTimerCount()).toBe(0)
})

it('disposes pending deadlines and claims when the application root unmounts', async () => {
  const screen = await render(<GlobalApkUpdatePrompt update={update()} />)
  await tick()
  const signal = mockPrompt.mock.calls[0][2].signal
  await screen.unmount()
  expect(signal.aborted).toBe(true)
  expect(mockDialogListeners.size).toBe(0)
  expect(appUpdateActivity.getSnapshot().blocked).toBe(false)
  expect(mockStartInstall).not.toHaveBeenCalled()
})
