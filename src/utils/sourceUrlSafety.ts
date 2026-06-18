import { safeHttpUrl as safeNetworkHttpUrl } from '@/utils/networkUrlSafety'

export function safeHttpUrl(value: string | undefined): string | undefined {
  return safeNetworkHttpUrl(value) ?? undefined
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

export function isAllowedWebViewNavigation(value: string | undefined): boolean {
  if (!value || value === 'about:blank') return true
  return Boolean(parseHttpUrl(value))
}
