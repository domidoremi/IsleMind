import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Application from 'expo-application'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'

export type ApkUpdateStatus = 'available' | 'unavailable' | 'downloaded' | 'unsupported' | 'error'

export interface VersionSnapshot {
  appVersion: string
  buildVersion: string
  updateMode: 'apk'
}

export interface ApkReleaseInfo {
  version: string
  tagName: string
  name: string
  htmlUrl: string
  apkUrl: string
  apkName: string
  publishedAt: string | null
}

export interface ApkUpdateResult {
  status: ApkUpdateStatus
  message: string
  release?: ApkReleaseInfo
  localUri?: string
}

const GITHUB_RELEASE_API = 'https://api.github.com/repos/domidoremi/IsleMind/releases/latest'
const APK_MIME_TYPE = 'application/vnd.android.package-archive'
const ANDROID_GRANT_READ_URI_PERMISSION = 1

export function getVersionSnapshot(): VersionSnapshot {
  return {
    appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '1.0.0',
    buildVersion: Application.nativeBuildVersion ?? String(Constants.platform?.android?.versionCode ?? '1'),
    updateMode: 'apk',
  }
}

export async function checkLatestApkRelease(): Promise<ApkUpdateResult> {
  if (Platform.OS !== 'android') {
    return { status: 'unsupported', message: 'APK 更新只适用于 Android。' }
  }

  try {
    const release = await fetchLatestRelease()
    if (!release) {
      return { status: 'unavailable', message: 'GitHub Release 中没有找到可安装 APK。' }
    }

    const currentVersion = normalizeVersion(getVersionSnapshot().appVersion)
    const latestVersion = normalizeVersion(release.version)
    if (compareVersions(latestVersion, currentVersion) <= 0) {
      return {
        status: 'unavailable',
        message: `当前已是最新 APK 版本：${currentVersion}。`,
        release,
      }
    }

    return {
      status: 'available',
      message: `发现新版 APK：${release.version}。`,
      release,
    }
  } catch (error) {
    return {
      status: 'error',
      message: `检查 GitHub Release 失败：${formatError(error)}`,
    }
  }
}

export async function downloadAndOpenApkInstaller(release: ApkReleaseInfo): Promise<ApkUpdateResult> {
  if (Platform.OS !== 'android') {
    return { status: 'unsupported', message: 'APK 更新只适用于 Android。', release }
  }

  const cacheDirectory = FileSystem.cacheDirectory
  if (!cacheDirectory) {
    return { status: 'error', message: '无法访问应用缓存目录，下载已取消。', release }
  }

  try {
    const safeName = release.apkName.replace(/[^\w.-]+/g, '-')
    const localUri = `${cacheDirectory}${safeName}`
    const download = await FileSystem.downloadAsync(release.apkUrl, localUri)
    if (download.status < 200 || download.status >= 300) {
      return {
        status: 'error',
        message: `APK 下载失败，HTTP ${download.status}。`,
        release,
      }
    }

    const contentUri = await FileSystem.getContentUriAsync(download.uri)
    await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
      data: contentUri,
      type: APK_MIME_TYPE,
      flags: ANDROID_GRANT_READ_URI_PERMISSION,
    })

    return {
      status: 'downloaded',
      message: 'APK 已下载，已打开 Android 系统安装器。请在系统弹窗中确认安装。',
      release,
      localUri: download.uri,
    }
  } catch (error) {
    return {
      status: 'error',
      message: `下载或打开安装器失败：${formatError(error)}`,
      release,
    }
  }
}

async function fetchLatestRelease(): Promise<ApkReleaseInfo | null> {
  const response = await fetch(GITHUB_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}`)
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
    }>
  }

  const asset = payload.assets
    ?.filter((item) => item.name?.toLowerCase().endsWith('.apk') && item.browser_download_url)
    .sort((a, b) => apkAssetPriority(b.name ?? '') - apkAssetPriority(a.name ?? ''))[0]

  if (!asset?.browser_download_url || !asset.name) return null

  return {
    version: normalizeVersion(payload.tag_name ?? payload.name ?? '0.0.0'),
    tagName: payload.tag_name ?? '',
    name: payload.name ?? payload.tag_name ?? 'IsleMind Release',
    htmlUrl: payload.html_url ?? 'https://github.com/domidoremi/IsleMind/releases/latest',
    apkUrl: asset.browser_download_url,
    apkName: asset.name,
    publishedAt: payload.published_at ?? null,
  }
}

function apkAssetPriority(name: string): number {
  const lower = name.toLowerCase()
  if (lower.includes('universal')) return 100
  if (lower.includes('arm64-v8a')) return 90
  if (lower.includes('armeabi-v7a')) return 80
  if (lower.includes('x86_64')) return 70
  if (lower.includes('debug')) return 10
  return 20
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
