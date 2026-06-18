export function isAllowedAndroidApkUri(uri: string | undefined): boolean {
  if (typeof uri !== 'string') return false
  const normalized = uri.trim()
  if (!normalized) return false
  if (normalized.startsWith('file://')) return normalized.toLowerCase().split('?')[0].endsWith('.apk')
  if (!normalized.startsWith('content://')) return false
  return /\.apk(?:$|[?#])/i.test(normalized) || /\/document\/.*\.apk(?:$|[?#])/i.test(normalized)
}

export function sanitizeAndroidApkUri(uri: string | undefined): string | undefined {
  return isAllowedAndroidApkUri(uri) ? uri?.trim() : undefined
}

export const isAllowedAndroidApkUriForTest = isAllowedAndroidApkUri
export const sanitizeAndroidApkUriForTest = sanitizeAndroidApkUri
