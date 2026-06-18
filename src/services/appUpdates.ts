import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Application from 'expo-application'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { st } from '@/i18n/service'
import { sha256File } from '@/services/localEmbeddingModels'
import { appendRuntimeLog, readStoredRuntimeLogOptions } from '@/services/runtimeLog'
import { discardDownloadedApk, markDownloadedApkForCleanup } from '@/services/apkInstallCache'
import { safeHttpUrl } from '@/utils/networkUrlSafety'

export type ApkUpdateStatus = 'available' | 'unavailable' | 'downloaded' | 'unsupported' | 'error'
export type ApkUpdateReason = 'network' | 'rate_limited' | 'manifest_invalid' | 'checksum_mismatch' | 'installer_failed'
export type ApkAssetVariant = 'no-model' | 'with-model-small' | 'universal'

export interface VersionSnapshot {
  appVersion: string
  buildVersion: string
  updateMode: 'apk'
  hotUpdateMode: 'disabled'
}

export interface ApkReleaseInfo {
  version: string
  versionCode?: number
  tagName: string
  name: string
  htmlUrl: string
  apkUrl: string
  apkName: string
  publishedAt: string | null
  sha256?: string
  sizeBytes?: number
  abi?: string
  variant?: ApkAssetVariant
}

export interface ApkUpdateResult {
  status: ApkUpdateStatus
  message: string
  release?: ApkReleaseInfo
  localUri?: string
  reason?: ApkUpdateReason
}

export interface ApkManifestAsset {
  abi: string
  variant: ApkAssetVariant
  name: string
  url: string
  sha256?: string
  sizeBytes?: number
}

interface ApkUpdateManifest {
  versionName: string
  versionCode?: number
  publishedAt: string | null
  releaseUrl: string
  assets: ApkManifestAsset[]
}

export const APK_UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/domidoremi/IsleMind/main/updates/android.json'
const GITHUB_RELEASE_API = 'https://api.github.com/repos/domidoremi/IsleMind/releases/latest'
const APK_MIME_TYPE = 'application/vnd.android.package-archive'
const ANDROID_GRANT_READ_URI_PERMISSION = 1
export const APK_AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

class ApkUpdateError extends Error {
  constructor(readonly reason: ApkUpdateReason, message: string) {
    super(message)
    this.name = 'ApkUpdateError'
  }
}

export function getVersionSnapshot(): VersionSnapshot {
  return {
    appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '1.0.0',
    buildVersion: Application.nativeBuildVersion ?? String(Constants.platform?.android?.versionCode ?? '1'),
    updateMode: 'apk',
    hotUpdateMode: 'disabled',
  }
}

export function shouldAutoCheckApkUpdate(lastCheckedAt: number | undefined, now = Date.now()): boolean {
  if (!lastCheckedAt) return true
  return now - lastCheckedAt >= APK_AUTO_CHECK_INTERVAL_MS
}

export function shouldRecordApkUpdateCheck(result: ApkUpdateResult): boolean {
  return result.status === 'available' || result.status === 'unavailable'
}

export async function checkLatestApkReleaseSilently(): Promise<ApkUpdateResult> {
  const result = await checkLatestApkRelease()
  if (result.status === 'available') return result
  return { ...result, release: undefined }
}

export function formatUpdateCheckTime(value: number | undefined): string {
  if (!value) return st('updates.never')
  try {
    return new Date(value).toLocaleString()
  } catch {
    return st('updates.unknown')
  }
}

export async function checkLatestApkRelease(): Promise<ApkUpdateResult> {
  if (Platform.OS !== 'android') {
    const result = { status: 'unsupported', message: st('updates.androidOnly') } satisfies ApkUpdateResult
    await logAppUpdateEvent('check', result)
    return result
  }

  try {
    const release = await fetchLatestRelease()
    if (!release) {
      const result = { status: 'unavailable', message: st('updates.noInstallableApk') } satisfies ApkUpdateResult
      await logAppUpdateEvent('check', result)
      return result
    }

    const snapshot = getVersionSnapshot()
    const currentVersion = normalizeVersion(snapshot.appVersion)
    if (compareReleaseToSnapshot(release, snapshot) <= 0) {
      const result = {
        status: 'unavailable',
        message: st('updates.alreadyLatest', { version: currentVersion }),
        release,
      } satisfies ApkUpdateResult
      await logAppUpdateEvent('check', result)
      return result
    }

    const result = {
      status: 'available',
      message: st('updates.available', { version: release.version, build: release.versionCode ?? '' }),
      release,
    } satisfies ApkUpdateResult
    await logAppUpdateEvent('check', result)
    return result
  } catch (error) {
    const reason = getUpdateReason(error) ?? 'network'
    const result = {
      status: 'error',
      reason,
      message: formatUpdateErrorMessage(reason, error),
    } satisfies ApkUpdateResult
    await logAppUpdateEvent('check', result, error)
    return result
  }
}

export async function downloadAndOpenApkInstaller(release: ApkReleaseInfo): Promise<ApkUpdateResult> {
  if (Platform.OS !== 'android') {
    const result = { status: 'unsupported', message: st('updates.androidOnly'), release } satisfies ApkUpdateResult
    await logAppUpdateEvent('install', result)
    return result
  }

  const cacheDirectory = FileSystem.cacheDirectory
  if (!cacheDirectory) {
    const result = { status: 'error', message: st('updates.cacheUnavailable'), release } satisfies ApkUpdateResult
    await logAppUpdateEvent('install', result)
    return result
  }

  let localUri: string | undefined
  let installerPhase = false
  try {
    const apkUrl = safeHttpUrl(release.apkUrl)
    if (!apkUrl) {
      const result = {
        status: 'error',
        reason: 'manifest_invalid',
        message: st('updates.releaseManifestInvalid', { error: 'apkUrl must be an explicit HTTP(S) URL' }),
        release,
      } satisfies ApkUpdateResult
      await logAppUpdateEvent('install', result)
      return result
    }
    const safeName = release.apkName.replace(/[^\w.-]+/g, '-')
    localUri = `${cacheDirectory}${safeName}`
    const download = await FileSystem.downloadAsync(apkUrl, localUri)
    if (download.status < 200 || download.status >= 300) {
      await discardDownloadedApk(download.uri)
      const result = {
        status: 'error',
        reason: 'network',
        message: st('updates.downloadFailedHttp', { status: download.status }),
        release,
      } satisfies ApkUpdateResult
      await logAppUpdateEvent('install', result)
      return result
    }

    const verificationFailure = await verifyDownloadedApk(release, download.uri)
    if (verificationFailure) {
      await logAppUpdateEvent('install', verificationFailure)
      return verificationFailure
    }

    installerPhase = true
    const contentUri = await FileSystem.getContentUriAsync(download.uri)
    await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
      data: contentUri,
      type: APK_MIME_TYPE,
      flags: ANDROID_GRANT_READ_URI_PERMISSION,
    })

    const result = {
      status: 'downloaded',
      message: st('updates.installerOpenedMessage'),
      release,
      localUri: download.uri,
    } satisfies ApkUpdateResult
    await logAppUpdateEvent('install', result)
    await markDownloadedApkForCleanup(download.uri)
    return result
  } catch (error) {
    if (localUri) {
      await discardDownloadedApk(localUri)
    }
    const reason = installerPhase ? 'installer_failed' : 'network'
    const result = {
      status: 'error',
      reason,
      message: reason === 'installer_failed'
        ? st('updates.installerFailed', { error: formatError(error) })
        : st('updates.downloadOrOpenFailed', { error: formatError(error) }),
      release,
    } satisfies ApkUpdateResult
    await logAppUpdateEvent('install', result, error)
    return result
  }
}

async function fetchLatestRelease(): Promise<ApkReleaseInfo | null> {
  try {
    return await fetchLatestManifestRelease()
  } catch (error) {
    if (getUpdateReason(error) === 'manifest_invalid') throw error
    return fetchLatestGithubRelease()
  }
}

async function fetchLatestManifestRelease(): Promise<ApkReleaseInfo | null> {
  const response = await fetch(APK_UPDATE_MANIFEST_URL, {
    headers: {
      Accept: 'application/json',
    },
  })
  if (!response.ok) {
    throw createUpdateError(reasonForHttpStatus(response.status), `Update manifest ${response.status}`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    throw createUpdateError('manifest_invalid', formatError(error))
  }

  return normalizeApkUpdateManifest(payload, getSupportedCpuArchitectures())
}

async function fetchLatestGithubRelease(): Promise<ApkReleaseInfo | null> {
  const response = await fetch(GITHUB_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  })
  if (!response.ok) {
    throw createUpdateError(reasonForHttpStatus(response.status), `GitHub API ${response.status}`)
  }

  const payload = await response.json() as {
    tag_name?: string
    name?: string
    html_url?: string
    published_at?: string | null
    assets?: Array<{
      name?: string
      browser_download_url?: string
      content_type?: string
      size?: number
    }>
  }

  const assets = payload.assets
    ?.map((item) => normalizeGithubAsset(item))
    .filter((item): item is ApkManifestAsset => Boolean(item)) ?? []
  const asset = selectApkAsset(assets, getSupportedCpuArchitectures())

  if (!asset) return null

  return {
    version: normalizeVersion(payload.tag_name ?? payload.name ?? '0.0.0'),
    tagName: payload.tag_name ?? '',
    name: payload.name ?? payload.tag_name ?? 'IsleMind Release',
    htmlUrl: payload.html_url ?? 'https://github.com/domidoremi/IsleMind/releases/latest',
    apkUrl: asset.url,
    apkName: asset.name,
    publishedAt: payload.published_at ?? null,
    abi: asset.abi,
    variant: asset.variant,
    sizeBytes: asset.sizeBytes,
  }
}

function normalizeApkUpdateManifest(payload: unknown, supportedCpuArchitectures: readonly string[]): ApkReleaseInfo | null {
  const manifest = parseApkUpdateManifest(payload)
  const asset = selectApkAsset(manifest.assets, supportedCpuArchitectures)
  if (!asset) return null
  return {
    version: normalizeVersion(manifest.versionName),
    versionCode: manifest.versionCode,
    tagName: `v${normalizeVersion(manifest.versionName)}`,
    name: `IsleMind ${normalizeVersion(manifest.versionName)}`,
    htmlUrl: manifest.releaseUrl,
    apkUrl: asset.url,
    apkName: asset.name,
    publishedAt: manifest.publishedAt,
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
    abi: asset.abi,
    variant: asset.variant,
  }
}

function parseApkUpdateManifest(payload: unknown): ApkUpdateManifest {
  const record = asRecord(payload)
  const versionName = readRequiredString(record, 'versionName')
  const releaseUrl = readRequiredWebUrl(record, 'releaseUrl')
  const versionCode = readRequiredPositiveInteger(record, 'versionCode')
  const publishedAt = typeof record.publishedAt === 'string' ? record.publishedAt : null
  if (!Array.isArray(record.assets)) {
    throw createUpdateError('manifest_invalid', 'assets must be an array')
  }
  const assets = record.assets.map((asset) => parseManifestAsset(asset))
  if (assets.length === 0) {
    throw createUpdateError('manifest_invalid', 'assets must include at least one APK')
  }
  return { versionName, versionCode, publishedAt, releaseUrl, assets }
}

function parseManifestAsset(payload: unknown): ApkManifestAsset {
  const record = asRecord(payload)
  const abi = readRequiredString(record, 'abi')
  const variant = readVariant(record.variant)
  const url = readRequiredWebUrl(record, 'url')
  const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : apkNameFromUrl(url)
  const sha256 = readRequiredSha256(record, 'sha256')
  const sizeBytes = readRequiredPositiveInteger(record, 'sizeBytes')
  return { abi, variant, name, url, sha256, sizeBytes }
}

function normalizeGithubAsset(asset: { name?: string; browser_download_url?: string; size?: number }): ApkManifestAsset | null {
  const url = safeHttpUrl(asset.browser_download_url)
  if (!asset.name?.toLowerCase().endsWith('.apk') || !url) return null
  return {
    abi: inferApkAbi(asset.name),
    variant: inferApkVariant(asset.name),
    name: asset.name,
    url,
    sizeBytes: readOptionalPositiveInteger(asset.size),
  }
}

function selectApkAsset(assets: readonly ApkManifestAsset[], supportedCpuArchitectures: readonly string[]): ApkManifestAsset | null {
  const candidates = assets.filter((asset) => asset.url && asset.name)
  if (!candidates.length) return null

  const preferredAbis = normalizeSupportedAbis(supportedCpuArchitectures)
  const preferredVariant: ApkAssetVariant = 'no-model'
  for (const abi of preferredAbis) {
    const match = candidates.find((asset) => asset.abi === abi && asset.variant === preferredVariant)
    if (match) return match
  }

  const universalNoModel = candidates.find((asset) => asset.abi === 'universal-64' && asset.variant === preferredVariant)
  if (universalNoModel) return universalNoModel

  for (const abi of preferredAbis) {
    const match = candidates.find((asset) => asset.abi === abi)
    if (match) return match
  }

  const universal = candidates.find((asset) => asset.abi === 'universal-64')
  if (universal) return universal

  return candidates.find((asset) => asset.variant === preferredVariant) ?? candidates[0]
}

function normalizeSupportedAbis(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]
}

function getSupportedCpuArchitectures(): string[] {
  let architectures: string[] | null | undefined
  try {
    architectures = (require('expo-device') as { supportedCpuArchitectures?: string[] | null }).supportedCpuArchitectures
  } catch {
    architectures = null
  }
  return Array.isArray(architectures) ? normalizeSupportedAbis(architectures.map((item) => String(item))) : []
}

function compareReleaseToSnapshot(release: ApkReleaseInfo, snapshot: VersionSnapshot): number {
  const releaseCode = readOptionalPositiveInteger(release.versionCode)
  const currentCode = readOptionalPositiveInteger(Number.parseInt(snapshot.buildVersion, 10))
  if (releaseCode != null && currentCode != null) return releaseCode - currentCode
  return compareVersions(normalizeVersion(release.version), normalizeVersion(snapshot.appVersion))
}

async function verifyDownloadedApk(release: ApkReleaseInfo, uri: string): Promise<ApkUpdateResult | null> {
  const info = await FileSystem.getInfoAsync(uri)
  if (!info.exists) {
    await discardDownloadedApk(uri)
    return {
      status: 'error',
      reason: 'checksum_mismatch',
      message: st('updates.downloadedFileMissing'),
      release,
    }
  }

  if (release.sizeBytes != null && info.size !== release.sizeBytes) {
    await discardDownloadedApk(uri)
    return {
      status: 'error',
      reason: 'checksum_mismatch',
      message: st('updates.apkSizeMismatch', {
        expected: formatApkSizeBytes(release.sizeBytes),
        actual: formatApkSizeBytes(info.size),
      }),
      release,
    }
  }

  if (release.sha256) {
    const actualSha256 = await sha256File(uri)
    if (actualSha256.toLowerCase() !== release.sha256.toLowerCase()) {
      await discardDownloadedApk(uri)
      return {
        status: 'error',
        reason: 'checksum_mismatch',
        message: st('updates.checksumMismatch'),
        release,
      }
    }
  }

  return null
}

function reasonForHttpStatus(status: number): ApkUpdateReason {
  return status === 403 || status === 429 ? 'rate_limited' : 'network'
}

function createUpdateError(reason: ApkUpdateReason, message: string): ApkUpdateError {
  return new ApkUpdateError(reason, message)
}

function getUpdateReason(error: unknown): ApkUpdateReason | undefined {
  return error instanceof ApkUpdateError ? error.reason : undefined
}

function formatUpdateErrorMessage(reason: ApkUpdateReason, error: unknown): string {
  if (reason === 'rate_limited') return st('updates.releaseCheckRateLimited')
  if (reason === 'manifest_invalid') return st('updates.releaseManifestInvalid', { error: formatError(error) })
  if (reason === 'network') return st('updates.releaseCheckNetworkFailed', { error: formatError(error) })
  return st('updates.releaseCheckFailed', { error: formatError(error) })
}

export function formatApkSizeBytes(sizeBytes: number | undefined): string {
  if (sizeBytes == null || !Number.isFinite(sizeBytes) || sizeBytes < 0) return st('updates.unknown')
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
  if (sizeBytes >= 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${sizeBytes} B`
}

export function normalizeApkUpdateManifestForTest(payload: unknown, supportedCpuArchitectures: readonly string[] = []): ApkReleaseInfo | null {
  return normalizeApkUpdateManifest(payload, supportedCpuArchitectures)
}

export function selectApkAssetForTest(assets: readonly ApkManifestAsset[], supportedCpuArchitectures: readonly string[] = []): ApkManifestAsset | null {
  return selectApkAsset(assets, supportedCpuArchitectures)
}

export function compareReleaseToSnapshotForTest(release: ApkReleaseInfo, snapshot: VersionSnapshot): number {
  return compareReleaseToSnapshot(release, snapshot)
}

function normalizeVersion(version: string): string {
  const cleaned = version.trim().replace(/^v/i, '')
  const match = cleaned.match(/\d+(?:\.\d+){0,2}/)
  return match?.[0] ?? '0.0.0'
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createUpdateError('manifest_invalid', 'payload must be an object')
  }
  return payload as Record<string, unknown>
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw createUpdateError('manifest_invalid', `${key} must be a non-empty string`)
  }
  return value.trim()
}

function readRequiredWebUrl(record: Record<string, unknown>, key: string): string {
  const value = readRequiredString(record, key)
  const url = safeHttpUrl(value)
  if (!url) {
    throw createUpdateError('manifest_invalid', `${key} must be an explicit HTTP(S) URL`)
  }
  return url
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return undefined
  return value
}

function readRequiredPositiveInteger(record: Record<string, unknown>, key: string): number {
  const value = readOptionalPositiveInteger(record[key])
  if (value == null) {
    throw createUpdateError('manifest_invalid', `${key} must be a positive integer`)
  }
  return value
}

function readOptionalSha256(value: unknown): string | undefined {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value.trim())) {
    throw createUpdateError('manifest_invalid', 'sha256 must be a 64-character hex string')
  }
  return value.trim().toLowerCase()
}

function readRequiredSha256(record: Record<string, unknown>, key: string): string {
  const value = readOptionalSha256(record[key])
  if (!value) {
    throw createUpdateError('manifest_invalid', `${key} must be a 64-character hex string`)
  }
  return value
}

function readVariant(value: unknown): ApkAssetVariant {
  if (value === 'no-model' || value === 'with-model-small' || value === 'universal') return value
  throw createUpdateError('manifest_invalid', 'variant must be no-model, with-model-small, or universal')
}

function apkNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const name = pathname.split('/').filter(Boolean).at(-1)
    return name ? decodeURIComponent(name) : 'IsleMind.apk'
  } catch {
    return 'IsleMind.apk'
  }
}

function inferApkAbi(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('arm64-v8a')) return 'arm64-v8a'
  if (lower.includes('armeabi-v7a')) return 'armeabi-v7a'
  if (lower.includes('universal-64')) return 'universal-64'
  if (lower.includes('universal')) return 'universal'
  if (lower.includes('x86_64')) return 'x86_64'
  if (lower.includes('x86')) return 'x86'
  return 'universal-64'
}

function inferApkVariant(name: string): ApkAssetVariant {
  const lower = name.toLowerCase()
  if (lower.includes('with-model-small') || lower.includes('with-model')) return 'with-model-small'
  if (lower.includes('no-model')) return 'no-model'
  if (lower.includes('universal')) return 'universal'
  return 'no-model'
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function logAppUpdateEvent(phase: 'check' | 'install', result: ApkUpdateResult, error?: unknown): Promise<void> {
  const options = await readStoredRuntimeLogOptions()
  return appendRuntimeLog('app.update', {
    phase,
    status: result.status,
    reason: result.reason,
    message: result.message,
    release: summarizeReleaseForLog(result.release),
    localUri: result.localUri,
    errorName: error instanceof Error ? error.name : undefined,
    errorText: error instanceof Error ? error.message : undefined,
  }, options)
}

function summarizeReleaseForLog(release: ApkReleaseInfo | undefined): Record<string, unknown> | undefined {
  if (!release) return undefined
  return {
    version: release.version,
    versionCode: release.versionCode,
    tagName: release.tagName,
    apkName: release.apkName,
    apkUrl: release.apkUrl,
    htmlUrl: release.htmlUrl,
    abi: release.abi,
    variant: release.variant,
    sizeBytes: release.sizeBytes,
  }
}
