import * as FileSystem from 'expo-file-system/legacy'

const APK_CLEANUP_MARKER_PREFIX = 'islemind-apk-cleanup-'

export async function discardDownloadedApk(uri: string): Promise<void> {
  if (!isCacheFileUri(uri)) return
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
}

export async function markDownloadedApkForCleanup(uri: string): Promise<void> {
  if (!isCacheApkUri(uri)) return
  const markerUri = stagedApkCleanupMarkerUri(uri)
  if (!markerUri) return
  try {
    await FileSystem.writeAsStringAsync(markerUri, uri, { encoding: FileSystem.EncodingType.UTF8 })
  } catch {
    // The system installer may still need the APK immediately after handoff.
    // If marker persistence fails, leave the staged file for normal cache cleanup.
  }
}

export async function clearStagedApkDownloads(): Promise<number> {
  const cacheDirectory = normalizedCacheDirectory()
  if (!cacheDirectory) return 0
  let entries: string[]
  try {
    entries = await FileSystem.readDirectoryAsync(cacheDirectory)
  } catch {
    return 0
  }
  const markers = entries
    .map((name) => cacheMarkerUri(cacheDirectory, name))
    .filter((uri): uri is string => Boolean(uri))
  let deleted = 0
  for (const markerUri of markers) {
    try {
      const stagedUri = await FileSystem.readAsStringAsync(markerUri, { encoding: FileSystem.EncodingType.UTF8 })
      if (isCacheApkUri(stagedUri)) {
        await FileSystem.deleteAsync(stagedUri, { idempotent: true }).catch(() => undefined)
        deleted += 1
      }
    } finally {
      await FileSystem.deleteAsync(markerUri, { idempotent: true }).catch(() => undefined)
    }
  }
  return deleted
}

function stagedApkCleanupMarkerUri(uri: string): string | undefined {
  const cacheDirectory = normalizedCacheDirectory()
  if (!cacheDirectory) return undefined
  return `${cacheDirectory}${APK_CLEANUP_MARKER_PREFIX}${Math.abs(hashString(uri)).toString(36)}.txt`
}

function isCacheApkUri(uri: string | undefined | null): uri is string {
  const normalizedUri = directCacheFileUri(uri)
  if (!normalizedUri) return false
  const withoutQuery = normalizedUri.split(/[?#]/)[0]
  return withoutQuery.toLowerCase().endsWith('.apk')
}

function isCacheFileUri(uri: string | undefined | null): uri is string {
  return Boolean(directCacheFileUri(uri))
}

function directCacheFileUri(uri: string | undefined | null): string {
  if (!uri) return ''
  const cacheDirectory = normalizedCacheDirectory()
  if (!cacheDirectory) return ''
  const normalizedUri = uri.trim()
  if (!normalizedUri.startsWith(cacheDirectory)) return ''
  const childName = normalizedUri.slice(cacheDirectory.length)
  if (!isDirectChildName(childName)) return ''
  return normalizedUri
}

function cacheMarkerUri(cacheDirectory: string, entryName: string): string | null {
  if (!isDirectChildName(entryName)) return null
  if (!entryName.startsWith(APK_CLEANUP_MARKER_PREFIX)) return null
  if (!entryName.endsWith('.txt')) return null
  return `${cacheDirectory}${entryName}`
}

function isDirectChildName(value: string): boolean {
  if (!value) return false
  if (value !== value.trim()) return false
  if (value === '.' || value === '..') return false
  if (/[\\/\u0000-\u001f\u007f]/.test(value)) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false
  return true
}

function normalizedCacheDirectory(): string {
  const cacheDirectory = FileSystem.cacheDirectory
  if (!cacheDirectory) return ''
  return cacheDirectory.endsWith('/') ? cacheDirectory : `${cacheDirectory}/`
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash | 0
}
