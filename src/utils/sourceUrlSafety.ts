import { safeHttpUrl as safeNetworkHttpUrl } from '@/utils/networkUrlSafety'
export function safeHttpUrl(value: string | undefined): string | undefined {
  const safe = safeNetworkHttpUrl(value)
  if (!safe) return undefined
  return sourceUrlHasCredentialQuery(safe) ? undefined : safe
}

export function parseHttpUrl(value: string | undefined): URL | undefined {
  const raw = safeNetworkHttpUrl(value)
  if (!raw) return undefined
  try {
    return new URL(raw)
  } catch {
    return undefined
  }
}

export function isAllowedWebViewNavigation(value: string | undefined, sourceUrl?: string): boolean {
  if (!value || value === 'about:blank') return true
  const parsed = parseHttpUrl(value)
  if (!parsed) return false
  const source = parseHttpUrl(sourceUrl)
  if (!source) return true
  if (source.protocol === 'https:' && parsed.protocol !== 'https:') return false
  return parsed.hostname === source.hostname
}

export function webViewOriginWhitelist(value: string | undefined): string[] {
  const parsed = parseHttpUrl(value)
  if (!parsed) return []
  const origin = `${parsed.protocol}//${parsed.host}`
  if (parsed.protocol === 'https:') return [origin]
  const pairedProtocol = parsed.protocol === 'http:' ? 'https:' : 'http:'
  return [origin, `${pairedProtocol}//${parsed.host}`]
}

function sourceUrlHasCredentialQuery(value: string): boolean {
  try {
    const parsed = new URL(value)
    for (const key of parsed.searchParams.keys()) {
      if (/^(?:api[-_]?key|access[-_]?token|auth(?:orization)?|bearer|client[-_]?secret|code|credential|id[-_]?token|key|refresh[-_]?token|secret|session|signature|token)$/i.test(key)) {
        return true
      }
    }
  } catch {
    return true
  }
  return false
}
