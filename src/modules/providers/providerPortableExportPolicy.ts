const PORTABLE_URL_REDACTION = '[redacted]'

export function sanitizeProviderPortableExportUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return undefined
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  if (parsed.username || parsed.password) return undefined

  const queryEntries = Array.from(parsed.searchParams.entries())
  const hasSensitiveQuery = queryEntries.some(([key]) => isSensitiveProviderPortableQueryParamKey(key))
  const hasFragment = trimmed.includes('#')
  if (!hasSensitiveQuery && !hasFragment) return trimmed

  if (hasSensitiveQuery) {
    const sanitizedQuery = new URLSearchParams()
    for (const [key, queryValue] of queryEntries) {
      sanitizedQuery.append(
        key,
        isSensitiveProviderPortableQueryParamKey(key) ? PORTABLE_URL_REDACTION : queryValue,
      )
    }
    parsed.search = sanitizedQuery.toString()
  }

  if (hasFragment) parsed.hash = ''
  return parsed.toString()
}

export function isSensitiveProviderPortableQueryParamKey(key: string): boolean {
  const normalized = key.trim().toLowerCase()
  if (!normalized) return false

  const compact = normalized.replace(/[^a-z0-9]+/g, '')
  if (compact === 'key' || compact === 'token' || compact === 'sig' || compact === 'signature') return true
  if (compact.includes('password') || compact.includes('secret') || compact.includes('credential')) return true
  if (compact.includes('apikey') || compact.includes('accesstoken') || compact.includes('refreshtoken')) return true
  if (compact.includes('authorization') || compact.includes('bearer')) return true
  if (compact === 'awsaccesskeyid' || compact === 'googleaccessid') return true
  if (compact.startsWith('xamz') && (compact.includes('signature') || compact.includes('securitytoken'))) return true
  if (compact.startsWith('xgoog') && (compact.includes('signature') || compact.includes('token'))) return true
  return false
}
