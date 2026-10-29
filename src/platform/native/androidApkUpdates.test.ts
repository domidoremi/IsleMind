import Constants from 'expo-constants'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { appendRuntimeLog, readStoredRuntimeLogOptions } from './runtimeLog'
import { discardDownloadedApk, markDownloadedApkForCleanup } from '@/services/apkInstallCache'
import { fetchGithubApkTagVersionCandidates, fetchGithubReleaseNotesSnapshot, fetchGithubTaggedAndroidReleaseSnapshot, fetchLatestGithubTagVersionSnapshot } from './githubReleaseChannel'
import {
  APK_AUTO_CHECK_INTERVAL_MS,
  checkLatestApkRelease,
  checkLatestApkReleaseSilently,
  downloadAndOpenApkInstaller,
  prepareApkRelease,
  openPreparedApkInstaller,
  discardPreparedApk,
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
jest.mock('expo-device', () => ({ supportedCpuArchitectures: ['arm64-v8a'] }))
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
  fetchGithubReleaseNotesSnapshot: jest.fn(),
  fetchGithubApkTagVersionCandidates: jest.fn(),
  GithubReleaseChannelError: class extends Error {},
}))

const extra = Constants.expoConfig!.extra!
const mockSha256File = jest.fn<Promise<string>, [string, AbortSignal?]>()
const release: ApkReleaseInfo = {
  version: '1.1.3', versionCode: 128, tagName: 'v1.1.3', name: 'IsleMind 1.1.3',
  htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.1.3',
  apkUrl: 'https://github.com/domidoremi/IsleMind/releases/download/v1.1.3/update.apk', apkName: 'update.apk', publishedAt: null,
  sha256: 'a'.repeat(64), sizeBytes: 100,
}
const downloaded = { uri: 'file:///cache/update.apk', status: 200, headers: {}, mimeType: 'application/vnd.android.package-archive' }
const currentTag = {
  versionName: '1.1.2', versionCode: 127, tagName: 'v1.1.2', name: 'IsleMind 1.1.2',
  htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.1.2', publishedAt: null,
}
const newerTag = { ...currentTag, tagName: 'v1.1.3', versionName: '1.1.3', versionCode: 128 }
const verifiedTaggedRelease = {
  tag: newerTag,
  manifest: {
    schemaVersion: 1, platform: 'android', versionName: '1.1.3', versionCode: 128,
    publishedAt: null, releaseUrl: release.htmlUrl,
    assets: [{
      abi: 'arm64-v8a', variant: 'no-model', name: release.apkName, url: release.apkUrl,
      sha256: release.sha256, sizeBytes: release.sizeBytes,
    }],
  },
  assets: [{ name: release.apkName, url: release.apkUrl }],
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
  jest.mocked(fetchGithubReleaseNotesSnapshot).mockResolvedValue({ entries: [], complete: true })
  jest.mocked(fetchGithubApkTagVersionCandidates).mockImplementation(async () => [await fetchLatestGithubTagVersionSnapshot()])
  mockDownload.mockResolvedValue(downloaded)
  mockCancel.mockResolvedValue(undefined)
  jest.mocked(FileSystem.createDownloadResumable).mockImplementation((_url, _uri, _options, progress) => {
    downloaded.uri = _uri
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

  it('prepares an immutable official APK without opening an installer or advancing installed metadata', async () => {
    const result = await prepareApkRelease(release)
    expect(result.status).toBe('prepared')
    expect(Object.isFrozen(result.prepared)).toBe(true)
    expect(Object.isFrozen(result.prepared?.release)).toBe(true)
    expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled()
    expect(getVersionSnapshot().buildVersion).toBe('127')
    await discardPreparedApk(result.prepared!)
  })

  it('requires a live handoff guard and rejects forged or revoked preparation capabilities', async () => {
    const result = await prepareApkRelease(release)
    const prepared = result.prepared!
    expect((await openPreparedApkInstaller({ ...prepared }, { canOpenInstaller: () => true })).reason).toBe('manifest_invalid')
    expect((await openPreparedApkInstaller(prepared)).status).toBe('prepared')
    expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled()
    await discardPreparedApk(prepared)
    expect((await openPreparedApkInstaller(prepared, { canOpenInstaller: () => true })).reason).toBe('manifest_invalid')
  })

  it('rechecks bytes after preparation and cannot reuse a tampered file', async () => {
    const prepared = (await prepareApkRelease(release)).prepared!
    mockSha256File.mockResolvedValueOnce('b'.repeat(64))
    expect(await openPreparedApkInstaller(prepared, { canOpenInstaller: () => true }))
      .toMatchObject({ status: 'error', reason: 'checksum_mismatch' })
    expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled()
    expect((await openPreparedApkInstaller(prepared, { canOpenInstaller: () => true })).reason).toBe('manifest_invalid')
  })

  it('retains a verified preparation if final content-URI admission detects new activity', async () => {
    const prepared = (await prepareApkRelease(release)).prepared!
    let safe = true
    const content = deferred<string>()
    jest.mocked(FileSystem.getContentUriAsync).mockReturnValueOnce(content.promise)
    const opening = openPreparedApkInstaller(prepared, { canOpenInstaller: () => safe })
    await Promise.resolve(); await Promise.resolve()
    safe = false
    content.resolve('content://cache/update.apk')
    expect((await opening).status).toBe('prepared')
    expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled()
    safe = true
    expect((await openPreparedApkInstaller(prepared, { canOpenInstaller: () => safe })).status).toBe('downloaded')
  })

  it.each(['activity', 'cancellation', 'revocation'] as const)('rechecks %s after the opening-progress callback', async (change) => {
    const prepared = (await prepareApkRelease(release)).prepared!
    const controller = new AbortController()
    let safe = true
    let cleanup: Promise<void> | undefined
    const result = await openPreparedApkInstaller(prepared, {
      signal: controller.signal, canOpenInstaller: () => safe,
      onProgress: (progress) => {
        if (progress.stage !== 'opening-installer') return
        if (change === 'activity') safe = false
        if (change === 'cancellation') controller.abort()
        if (change === 'revocation') cleanup = discardPreparedApk(prepared)
      },
    })
    await cleanup
    expect(result.status).toBe(change === 'activity' ? 'prepared' : 'cancelled')
    expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled()
    expect(getVersionSnapshot().buildVersion).toBe('127')
    await discardPreparedApk(prepared)
  })

  it('never starts preparation from an unapproved mirror origin', async () => {
    expect(await prepareApkRelease({ ...release, apkUrl: 'https://mirror.test/update.apk' }))
      .toMatchObject({ status: 'error', reason: 'manifest_invalid' })
    expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled()
  })

  it('attaches version-range notes only after the tagged APK passes availability validation', async () => {
    jest.mocked(fetchLatestGithubTagVersionSnapshot).mockResolvedValueOnce(newerTag)
    jest.mocked(fetchGithubTaggedAndroidReleaseSnapshot).mockResolvedValueOnce(verifiedTaggedRelease)
    const entries = [{ version: '1.1.3', notes: '- new features' }]
    jest.mocked(fetchGithubReleaseNotesSnapshot).mockResolvedValueOnce({ entries, complete: true })
    expect(await checkLatestApkRelease()).toMatchObject({
      status: 'available', currentVersion: { appVersion: '1.1.2', buildVersion: '127' },
      release: { version: '1.1.3', releaseNotes: entries, releaseNotesComplete: true },
    })
    expect(fetchGithubReleaseNotesSnapshot).toHaveBeenCalledWith({ version: '1.1.2', versionCode: 127 }, newerTag, { channel: 'stable' })
  })

  it('does not fetch notes for a non-installable qualification release', async () => {
    jest.mocked(fetchLatestGithubTagVersionSnapshot).mockResolvedValueOnce(newerTag)
    jest.mocked(fetchGithubTaggedAndroidReleaseSnapshot).mockResolvedValueOnce({
      tag: newerTag, manifest: null, assets: [],
    })
    expect((await checkLatestApkRelease()).status).toBe('unavailable')
    expect(fetchGithubReleaseNotesSnapshot).not.toHaveBeenCalled()
  })

  it('does not let a newer source-only tag hide a qualified older APK or advertise future source changes', async () => {
    const sourceTag = { ...newerTag, versionName: '1.1.4', versionCode: 129, tagName: 'v1.1.4' }
    jest.mocked(fetchLatestGithubTagVersionSnapshot).mockResolvedValueOnce(sourceTag)
    jest.mocked(fetchGithubTaggedAndroidReleaseSnapshot).mockResolvedValueOnce({
      tag: sourceTag, manifest: null, assets: [],
    }).mockResolvedValueOnce(verifiedTaggedRelease)
    jest.mocked(fetchGithubApkTagVersionCandidates).mockResolvedValueOnce([sourceTag, newerTag, currentTag])
    const entries = [{ version: '1.1.3', notes: '- Delivered' }]
    jest.mocked(fetchGithubReleaseNotesSnapshot).mockResolvedValueOnce({ entries, complete: true })
    expect(await checkLatestApkRelease()).toMatchObject({
      status: 'available', release: { version: '1.1.3', versionCode: 128, releaseNotes: entries },
    })
    expect(fetchGithubReleaseNotesSnapshot).toHaveBeenCalledWith({ version: '1.1.2', versionCode: 127 }, newerTag, { channel: 'stable' })
    expect(fetchGithubTaggedAndroidReleaseSnapshot).toHaveBeenLastCalledWith(newerTag, expect.objectContaining({ signal: expect.anything() }))
  })

  it('keeps a verified update available when optional release history fails', async () => {
    jest.mocked(fetchLatestGithubTagVersionSnapshot).mockResolvedValueOnce(newerTag)
    jest.mocked(fetchGithubTaggedAndroidReleaseSnapshot).mockResolvedValueOnce(verifiedTaggedRelease)
    jest.mocked(fetchGithubReleaseNotesSnapshot).mockRejectedValueOnce(new Error('history rate limited'))
    expect(await checkLatestApkRelease()).toMatchObject({
      status: 'available', release: { releaseNotes: [], releaseNotesComplete: false },
    })
  })

  it('does not let release notes bypass a tagged APK identity mismatch', async () => {
    jest.mocked(fetchLatestGithubTagVersionSnapshot).mockResolvedValueOnce(newerTag)
    jest.mocked(fetchGithubTaggedAndroidReleaseSnapshot).mockResolvedValueOnce({
      ...verifiedTaggedRelease, manifest: { ...verifiedTaggedRelease.manifest, versionCode: 127 },
    })
    expect(await checkLatestApkRelease()).toMatchObject({ status: 'error', reason: 'manifest_invalid' })
    expect(fetchGithubReleaseNotesSnapshot).not.toHaveBeenCalled()
    expect(fetchGithubApkTagVersionCandidates).toHaveBeenCalledTimes(1)
  })

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
    expect(onProgress.mock.calls.map(([p]) => p.stage)).toEqual(['downloading', 'downloading', 'downloading', 'downloading', 'verifying', 'verifying', 'opening-installer'])
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
