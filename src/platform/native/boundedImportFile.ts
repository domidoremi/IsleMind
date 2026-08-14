import * as FileSystem from 'expo-file-system/legacy'

import { readContentUriUtf8 } from './contentUriReader'

export const MAX_IMPORT_TEXT_FILE_BYTES = 20 * 1024 * 1024
export const MAX_IMPORT_JSON_FILE_BYTES = 64 * 1024 * 1024

export function assertImportFileSize(size: number | undefined, limitBytes: number): void {
  if (typeof size === 'number' && Number.isFinite(size) && size > limitBytes) {
    throw new Error('error.fileTooLarge')
  }
}

export async function assertImportFileSizeByUri(
  uri: string,
  options: {
    size?: number
    limitBytes: number
  },
): Promise<number | undefined> {
  const size = await resolveImportFileSize(uri, options.size)
  assertImportFileSize(size, options.limitBytes)
  return size
}

export async function readUtf8ImportFile(
  uri: string,
  options: {
    size?: number
    limitBytes: number
  },
): Promise<string> {
  const size = await assertImportFileSizeByUri(uri, options)
  try {
    const text = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 })
    assertUtf8TextSize(text, options.limitBytes)
    return text
  } catch (error) {
    if (!isContentUri(uri)) throw error
    return readUtf8ContentUri(uri, options.limitBytes, size)
  }
}

export function isFileTooLargeError(error: unknown): boolean {
  return error instanceof Error && error.message === 'error.fileTooLarge'
}

export async function deleteTemporaryImportCopy(
  uri: string | undefined | null,
  options: {
    assumeTemporaryCopy?: boolean
  } = {},
): Promise<void> {
  if (!uri) return
  if (!options.assumeTemporaryCopy && !isTemporaryImportCopyUri(uri)) return
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
}

export function formatImportSizeLimit(limitBytes: number): string {
  const megabytes = limitBytes / 1024 / 1024
  return Number.isInteger(megabytes) ? `${megabytes}MB` : `${megabytes.toFixed(1)}MB`
}

async function resolveImportFileSize(
  uri: string,
  declaredSize: number | undefined,
): Promise<number | undefined> {
  if (typeof declaredSize === 'number' && Number.isFinite(declaredSize) && declaredSize >= 0) {
    return declaredSize
  }
  try {
    const info = await FileSystem.getInfoAsync(uri)
    if (!info.exists) return undefined
    return typeof info.size === 'number' && Number.isFinite(info.size) && info.size >= 0
      ? info.size
      : undefined
  } catch {
    return undefined
  }
}

function isTemporaryImportCopyUri(uri: string | undefined | null): uri is string {
  if (!uri) return false
  const cacheDirectory = normalizeDirectoryUri(FileSystem.cacheDirectory)
  const documentDirectory = normalizeDirectoryUri(FileSystem.documentDirectory)
  const normalizedUri = normalizeDirectoryUri(uri)
  if (!cacheDirectory || !documentDirectory) return false
  return normalizedUri.startsWith(cacheDirectory) && !normalizedUri.startsWith(documentDirectory)
}

function normalizeDirectoryUri(uri: string | undefined | null): string {
  if (!uri) return ''
  return uri.replace(/\/+$/, '') + '/'
}

function isContentUri(uri: string): boolean {
  return /^content:\/\//i.test(uri)
}

async function readUtf8ContentUri(
  uri: string,
  limitBytes: number,
  size: number | undefined,
): Promise<string> {
  if (typeof size !== 'number' || !Number.isFinite(size)) {
    throw new Error('error.importReadFailed')
  }
  const text = await readContentUriUtf8(uri)
  assertUtf8TextSize(text, limitBytes)
  return text
}

function assertUtf8TextSize(text: string, limitBytes: number): void {
  if (new TextEncoder().encode(text).byteLength > limitBytes) {
    throw new Error('error.fileTooLarge')
  }
}
