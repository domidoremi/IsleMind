import Constants from 'expo-constants'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { fetchLatestGithubTagVersionSnapshot } from './githubReleaseChannel'
import {
  APK_AUTO_CHECK_INTERVAL_MS,
  checkLatestApkRelease,
  checkLatestApkReleaseSilently,
  downloadAndOpenApkInstaller,
  getVersionSnapshot,
  shouldAutoCheckApkUpdate,
  shouldRecordApkUpdateCheck,
  type ApkReleaseInfo,
} from './androidApkUpdates'

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }))
jest.mock('expo-constants', () => ({ expoConfig: { extra: { distributionChannel: 'github' } } }))
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.1.2', nativeBuildVersion: '127' }))
jest.mock('expo-file-system/legacy', () => ({ createDownloadResumable: jest.fn(), getContentUriAsync: jest.fn() }))
jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn() }))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))
jest.mock('@/platform/localModels', () => ({ createExpoLocalModelFileIntegrityPort: () => ({}) }))
jest.mock('@/platform/native/runtimeLog', () => ({ appendRuntimeLog: jest.fn(), readStoredRuntimeLogOptions: jest.fn(() => ({})) }))
jest.mock('@/services/apkInstallCache', () => ({ discardDownloadedApk: jest.fn(), markDownloadedApkForCleanup: jest.fn() }))
jest.mock('./githubReleaseChannel', () => ({
  fetchLatestGithubTagVersionSnapshot: jest.fn(),
  fetchGithubTaggedAndroidReleaseSnapshot: jest.fn(),
  GithubReleaseChannelError: class extends Error {},
}))

const extra = Constants.expoConfig!.extra!
beforeEach(() => {
  jest.clearAllMocks()
  extra.distributionChannel = 'google-play'
})

it('does not schedule GitHub checks on Play even with a migrated auto-check preference', () => {
  expect(shouldAutoCheckApkUpdate(undefined)).toBe(false)
  expect(shouldAutoCheckApkUpdate(1, APK_AUTO_CHECK_INTERVAL_MS + 2)).toBe(false)
  expect(getVersionSnapshot().updateMode).toBe('google-play')
})

it('blocks both manual and silent checks before any GitHub request', async () => {
  for (const check of [checkLatestApkRelease, checkLatestApkReleaseSilently]) {
    const result = await check()
    expect(result.status).toBe('unsupported')
    expect(result.message).toBe('updates.googlePlayManaged')
    expect(shouldRecordApkUpdateCheck(result)).toBe(false)
  }
  expect(fetchLatestGithubTagVersionSnapshot).not.toHaveBeenCalled()
})

it('blocks even a previously selected APK before filesystem, progress or installer effects', async () => {
  const onProgress = jest.fn()
  // No release fields are needed: the channel boundary must run first.
  const result = await downloadAndOpenApkInstaller({} as ApkReleaseInfo, { onProgress })
  expect(result).toEqual({ status: 'unsupported', message: 'updates.googlePlayManaged' })
  expect(onProgress).not.toHaveBeenCalled()
  expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled()
  expect(FileSystem.getContentUriAsync).not.toHaveBeenCalled()
  expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled()
})

it.each(['github', undefined])('preserves direct and legacy APK behavior for channel %s', async channel => {
  extra.distributionChannel = channel
  expect(getVersionSnapshot().updateMode).toBe('apk')
  expect(shouldAutoCheckApkUpdate(undefined)).toBe(true)
  expect(shouldAutoCheckApkUpdate(100, 101)).toBe(false)
  jest.mocked(fetchLatestGithubTagVersionSnapshot).mockResolvedValue({
    versionName: '1.1.2', versionCode: 127, tagName: 'v1.1.2', name: 'IsleMind 1.1.2',
    htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.1.2', publishedAt: null,
  })
  expect((await checkLatestApkRelease()).status).toBe('unavailable')
  expect(fetchLatestGithubTagVersionSnapshot).toHaveBeenCalledTimes(1)
})
