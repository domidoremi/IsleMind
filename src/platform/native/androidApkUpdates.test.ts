import Constants from 'expo-constants'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { appendRuntimeLog, readStoredRuntimeLogOptions } from './runtimeLog'
import { discardDownloadedApk, markDownloadedApkForCleanup } from '@/services/apkInstallCache'
import { fetchLatestGithubTagVersionSnapshot } from './githubReleaseChannel'
import {
  APK_AUTO_CHECK_INTERVAL_MS,
  checkLatestApkRelease,
  checkLatestApkReleaseSilently,
  downloadAndOpenApkInstaller,
  getVersionSnapshot,
  shouldAutoCheckApkUpdate,
  shouldRecordApkUpdateCheck,
  selectApkAssetForTest,
  type ApkManifestAsset,
  type ApkInstallProgress,
  type ApkReleaseInfo,
} from './androidApkUpdates'

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }))
jest.mock('expo-constants', () => ({ expoConfig: { extra: { distributionChannel: 'github' } } }))
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.1.2', nativeBuildVersion: '127' }))
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/', createDownloadResumable: jest.fn(),
  downloadAsync: jest.fn(), getContentUriAsync: jest.fn(), getInfoAsync: jest.fn(),
}))
jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn() }))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))
jest.mock('@/platform/localModels', () => ({ createExpoLocalModelFileIntegrityPort: () => ({
  sha256File: (uri: string, signal?: AbortSignal) => mockSha256File(uri, signal),
}) }))
jest.mock('@/platform/native/runtimeLog', () => ({ appendRuntimeLog: jest.fn(), readStoredRuntimeLogOptions: jest.fn(() => ({})) }))
jest.mock('@/services/apkInstallCache', () => ({ discardDownloadedApk: jest.fn(), markDownloadedApkForCleanup: jest.fn() }))
jest.mock('./githubReleaseChannel', () => ({
  fetchLatestGithubTagVersionSnapshot: jest.fn(),
  fetchGithubTaggedAndroidReleaseSnapshot: jest.fn(),
  GithubReleaseChannelError: class extends Error {},
}))

const extra = Constants.expoConfig!.extra!
const mockSha256File = jest.fn<Promise<string>, [string, AbortSignal?]>()
const release: ApkReleaseInfo = {
  version: '1.1.3', versionCode: 128, tagName: 'v1.1.3', name: 'IsleMind 1.1.3',
  htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.1.3',
  apkUrl: 'https://example.test/update.apk', apkName: 'update.apk', publishedAt: null,
  sha256: 'a'.repeat(64), sizeBytes: 100,
}
const downloaded = { uri: 'file:///cache/update.apk', status: 200, headers: {}, mimeType: 'application/vnd.android.package-archive' }
const currentTag = {
  versionName: '1.1.2', versionCode: 127, tagName: 'v1.1.2', name: 'IsleMind 1.1.2',
  htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.1.2', publishedAt: null,
}
const mockDownload = jest.fn<Promise<FileSystem.FileSystemDownloadResult | undefined>, []>()
const mockCancel = jest.fn<Promise<void>, []>()
let nativeProgress: FileSystem.FileSystemNetworkTaskProgressCallback<FileSystem.DownloadProgressData>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(() => {
  jest.resetAllMocks()
  extra.distributionChannel = 'google-play'
  jest.mocked(fetchLatestGithubTagVersionSnapshot).mockResolvedValue(currentTag)
  mockDownload.mockResolvedValue(downloaded)
  mockCancel.mockResolvedValue(undefined)
  jest.mocked(FileSystem.createDownloadResumable).mockImplementation((_url, _uri, _options, progress) => {
    nativeProgress = progress!
    return { downloadAsync: mockDownload, cancelAsync: mockCancel } as unknown as FileSystem.DownloadResumable
  })
  jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({ exists: true, isDirectory: false, size: 100, uri: downloaded.uri, modificationTime: 0 })
  jest.mocked(FileSystem.getContentUriAsync).mockResolvedValue('content://cache/update.apk')
  mockSha256File.mockResolvedValue(release.sha256!)
})
afterEach(() => jest.restoreAllMocks())

it('does not schedule GitHub checks on Play even with a migrated auto-check preference', () => {
  expect(shouldAutoCheckApkUpdate(undefined)).toBe(false)
  expect(shouldAutoCheckApkUpdate(1, APK_AUTO_CHECK_INTERVAL_MS + 2)).toBe(false)
  expect(getVersionSnapshot().updateMode).toBe('google-play')
})

describe('direct APK update lifecycle', () => {
  beforeEach(() => { extra.distributionChannel = 'github' })

  it('coalesces concurrent startup/manual checks and retries after a failed check', async () => {
    const request = deferred<typeof currentTag>()
    jest.mocked(fetchLatestGithubTagVersionSnapshot).mockReturnValueOnce(request.promise)
    const manual = checkLatestApkRelease()
    const startup = checkLatestApkReleaseSilently()
    expect(fetchLatestGithubTagVersionSnapshot).toHaveBeenCalledTimes(1)
    request.reject(new Error('offline'))
    expect((await manual).status).toBe('error')
    expect((await startup).status).toBe('error')
    expect((await checkLatestApkRelease()).status).toBe('unavailable')
    expect(fetchLatestGithubTagVersionSnapshot).toHaveBeenCalledTimes(2)
  })

  it('does not start any download or progress for an already aborted request', async () => {
    const controller = new AbortController()
    controller.abort()
    const onProgress = jest.fn()
    expect((await downloadAndOpenApkInstaller(release, { signal: controller.signal, onProgress })).status).toBe('cancelled')
    expect(onProgress).not.toHaveBeenCalled()
    expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled()
    expect(discardDownloadedApk).not.toHaveBeenCalled()
  })

  it('treats an undefined native result as cancellation, not a second download', async () => {
    mockDownload.mockResolvedValueOnce(undefined)
    expect((await downloadAndOpenApkInstaller(release)).status).toBe('cancelled')
    expect(FileSystem.downloadAsync).not.toHaveBeenCalled()
    expect(mockSha256File).not.toHaveBeenCalled()
    expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled()
    expect(discardDownloadedApk).toHaveBeenCalledWith(downloaded.uri)
    expect((await downloadAndOpenApkInstaller(release)).status).toBe('downloaded')
  })

  it('keeps the install lock until both native download and cancellation settle', async () => {
    const pending = deferred<FileSystem.FileSystemDownloadResult | undefined>()
    const cancelled = deferred<void>()
    mockDownload.mockReturnValueOnce(pending.promise)
    mockCancel.mockReturnValueOnce(cancelled.promise)
    const controller = new AbortController()
    const install = downloadAndOpenApkInstaller(release, { signal: controller.signal })
    controller.abort()
    controller.abort()
    expect(mockCancel).toHaveBeenCalledTimes(1)
    expect((await downloadAndOpenApkInstaller(release)).status).toBe('busy')
    pending.resolve(undefined)
    expect((await downloadAndOpenApkInstaller(release)).status).toBe('busy')
    expect(discardDownloadedApk).not.toHaveBeenCalled()
    cancelled.resolve()
    expect((await install).status).toBe('cancelled')
    expect(discardDownloadedApk).toHaveBeenCalledWith(downloaded.uri)
    expect(mockSha256File).not.toHaveBeenCalled()
    expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled()
    expect((await downloadAndOpenApkInstaller(release)).status).toBe('downloaded')
  })

  it('does not release the lock early when native cancellation rejects', async () => {
    const pending = deferred<FileSystem.FileSystemDownloadResult | undefined>()
    mockDownload.mockReturnValueOnce(pending.promise)
    mockCancel.mockRejectedValueOnce(new Error('native cancellation failed'))
    const controller = new AbortController()
    const install = downloadAndOpenApkInstaller(release, { signal: controller.signal })
    controller.abort()
    expect((await downloadAndOpenApkInstaller(release)).status).toBe('busy')
    pending.resolve(downloaded)
    expect((await install).status).toBe('cancelled')
    expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled()
  })

  it.each(['hash', 'content-uri'] as const)('blocks installer handoff when cancelled during %s', async phase => {
    const entered = deferred<void>()
    const pending = deferred<string>()
    const operation = phase === 'hash' ? mockSha256File : jest.mocked(FileSystem.getContentUriAsync)
    operation.mockImplementationOnce(() => { entered.resolve(); return pending.promise })
    const controller = new AbortController()
    const install = downloadAndOpenApkInstaller(release, { signal: controller.signal })
    await entered.promise
    controller.abort()
    pending.resolve(phase === 'hash' ? release.sha256! : 'content://cache/update.apk')
    expect((await install).status).toBe('cancelled')
    expect(mockSha256File).toHaveBeenCalledWith(downloaded.uri, controller.signal)
    expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled()
    expect(discardDownloadedApk).toHaveBeenCalledWith(downloaded.uri)
  })

  it('does not claim cancellation or delete the APK after system installer handoff', async () => {
    const controller = new AbortController()
    jest.mocked(IntentLauncher.startActivityAsync).mockImplementationOnce(async () => {
      controller.abort()
      return { resultCode: 0 }
    })
    expect((await downloadAndOpenApkInstaller(release, { signal: controller.signal })).status).toBe('downloaded')
    expect(discardDownloadedApk).not.toHaveBeenCalled()
    expect(markDownloadedApkForCleanup).toHaveBeenCalledWith(downloaded.uri)
  })

  it.each([
    { sha256: undefined }, { sha256: 'invalid' }, { sizeBytes: undefined },
    { sizeBytes: 0 }, { sizeBytes: Number.MAX_SAFE_INTEGER + 1 }, { apkName: '../../update.apk' },
    { apkName: 'update.txt' }, { apkUrl: 'file:///update.apk' },
  ])('rejects invalid effect-boundary metadata before download: %j', async metadata => {
    expect(await downloadAndOpenApkInstaller({ ...release, ...metadata })).toMatchObject({ status: 'error', reason: 'manifest_invalid' })
    expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled()
    expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled()
  })

  it.each(['http', 'missing-file', 'size', 'checksum'] as const)('rejects %s failures before opening the installer', async failure => {
    if (failure === 'http') mockDownload.mockResolvedValueOnce({ ...downloaded, status: 503 })
    if (failure === 'missing-file') jest.mocked(FileSystem.getInfoAsync).mockResolvedValueOnce({ exists: false, uri: downloaded.uri, isDirectory: false })
    if (failure === 'size') jest.mocked(FileSystem.getInfoAsync).mockResolvedValueOnce({ exists: true, size: 99, uri: downloaded.uri, isDirectory: false, modificationTime: 0 })
    if (failure === 'checksum') mockSha256File.mockResolvedValueOnce('b'.repeat(64))
    expect(await downloadAndOpenApkInstaller(release)).toMatchObject({ status: 'error', reason: failure === 'http' ? 'network' : 'checksum_mismatch' })
    expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled()
    expect(markDownloadedApkForCleanup).not.toHaveBeenCalled()
    expect(discardDownloadedApk).toHaveBeenCalledWith(downloaded.uri)
  })

  it.each(['content-uri', 'intent'] as const)('classifies %s failures as installer errors', async phase => {
    const failing = phase === 'content-uri' ? jest.mocked(FileSystem.getContentUriAsync) : jest.mocked(IntentLauncher.startActivityAsync)
    failing.mockRejectedValueOnce(new Error('no installer'))
    expect(await downloadAndOpenApkInstaller(release)).toMatchObject({ status: 'error', reason: 'installer_failed' })
    expect(discardDownloadedApk).toHaveBeenCalledWith(downloaded.uri)
  })

  it.each(['options', 'append'] as const)('keeps the handed-off APK when diagnostic %s logging fails', async phase => {
    if (phase === 'options') jest.mocked(readStoredRuntimeLogOptions).mockRejectedValueOnce(new Error('storage failed'))
    else jest.mocked(appendRuntimeLog).mockRejectedValueOnce(new Error('storage failed'))
    expect((await downloadAndOpenApkInstaller(release)).status).toBe('downloaded')
    expect(discardDownloadedApk).not.toHaveBeenCalled()
    expect(markDownloadedApkForCleanup).toHaveBeenCalledWith(downloaded.uri)
  })

  it('throttles intermediate progress, retains completion and ignores late callbacks', async () => {
    let now = 1000
    jest.spyOn(Date, 'now').mockImplementation(() => now)
    const pending = deferred<FileSystem.FileSystemDownloadResult>()
    mockDownload.mockReturnValueOnce(pending.promise)
    const onProgress = jest.fn<void, [ApkInstallProgress]>()
    const install = downloadAndOpenApkInstaller(release, { onProgress })
    const emit = (bytes: number) => nativeProgress({ totalBytesWritten: bytes, totalBytesExpectedToWrite: -1 })
    emit(1)
    now += 100
    emit(2)
    now += 150
    emit(3)
    emit(100)
    emit(100)
    expect(onProgress.mock.calls.flatMap(([p]) => p.bytesWritten == null ? [] : [p.bytesWritten])).toEqual([1, 3, 100])
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ bytesExpected: 100, percent: 100 }))
    pending.resolve(downloaded)
    expect((await install).status).toBe('downloaded')
    const count = onProgress.mock.calls.length
    now += 500
    emit(50)
    expect(onProgress).toHaveBeenCalledTimes(count)
    expect(onProgress.mock.calls.map(([p]) => p.stage)).toEqual(['downloading', 'downloading', 'downloading', 'downloading', 'verifying', 'opening-installer'])
  })

  it('ignores download progress after abort', async () => {
    const pending = deferred<FileSystem.FileSystemDownloadResult | undefined>()
    mockDownload.mockReturnValueOnce(pending.promise)
    const onProgress = jest.fn()
    const controller = new AbortController()
    const install = downloadAndOpenApkInstaller(release, { onProgress, signal: controller.signal })
    controller.abort()
    nativeProgress({ totalBytesWritten: 50, totalBytesExpectedToWrite: 100 })
    pending.resolve(undefined)
    await install
    expect(onProgress).toHaveBeenCalledTimes(1)
  })
})

describe('device-compatible asset selection', () => {
  const asset = (abi: string, variant: ApkManifestAsset['variant'] = 'no-model'): ApkManifestAsset => ({
    abi, variant, name: `${abi}-${variant}.apk`, url: `https://example.test/${abi}-${variant}.apk`,
  })
  const assets = [asset('universal-64'), asset('x86_64'), asset('arm64-v8a', 'with-model-small'), asset('arm64-v8a')]
  it.each(['arm64-v8a', 'x86_64'])('prefers exact no-model asset for %s', abi => {
    expect(selectApkAssetForTest(assets, [abi])).toEqual(asset(abi))
  })
  it.each(['arm64-v8a', 'x86_64'])('uses universal-64 only for supported 64-bit devices: %s', abi => {
    expect(selectApkAssetForTest([asset('universal-64')], [abi])).toEqual(asset('universal-64'))
  })
  it.each([[], ['riscv64'], ['armeabi-v7a'], ['x86']])('rejects incompatible fallback for %j', (...abis) => {
    expect(selectApkAssetForTest(assets, abis)).toBeNull()
  })
  it('does not select a wrong-architecture split when no universal asset exists', () => {
    expect(selectApkAssetForTest([asset('arm64-v8a')], ['x86_64'])).toBeNull()
  })
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
