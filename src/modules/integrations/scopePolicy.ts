export interface ToolScopeGrant {
  paths?: readonly string[]
  networkHosts?: readonly string[]
}

export interface ToolScopeRequest {
  paths?: readonly string[]
  networkHosts?: readonly string[]
}

export function grantCoversRequestedScopes(
  permission: string,
  grant: ToolScopeGrant,
  requestedScopes: ToolScopeRequest | undefined,
): boolean {
  if (permission === 'files.read' || permission === 'files.write') {
    return scopeListCoversAll(grant.paths, requestedScopes?.paths, normalizeScopePath, isPathWithinScope)
  }
  if (permission === 'network.local' || permission === 'network.remote') {
    const requestedHosts = exactScopeValues(requestedScopes?.networkHosts)
    if (requestedHosts.invalid) return false
    const normalizedRequestedHosts = requestedHosts.values.map(normalizeScopeHost).filter(Boolean)
    if (permission === 'network.local' && normalizedRequestedHosts.some((host) => !isLocalNetworkHost(host))) return false
    if (permission === 'network.remote' && normalizedRequestedHosts.some((host) => isLocalNetworkHost(host))) return false
    return scopeListCoversAll(grant.networkHosts, requestedScopes?.networkHosts, normalizeScopeHost, isHostWithinScope)
  }
  return true
}

export function normalizeScopePath(value: string): string {
  const raw = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase()
  const absolute = raw.startsWith('/')
  const segments: string[] = []
  for (const segment of raw.split('/')) {
    for (const decodedSegment of decodeScopePathSegment(segment).replace(/\\/g, '/').split('/')) {
      if (!decodedSegment || decodedSegment === '.') continue
      if (decodedSegment === '..') {
        if (segments.length) segments.pop()
        continue
      }
      segments.push(decodedSegment)
    }
  }
  if (absolute && !segments.length) return '/'
  const normalized = `${absolute ? '/' : ''}${segments.join('/')}`
  return normalized.replace(/\/$/g, '')
}

export function normalizeScopeHost(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ''
  try {
    return normalizeHostLiteral(new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname)
  } catch {
    if (trimmed.includes('://')) return ''
    return normalizeHostLiteral(stripHostPort(trimmed))
  }
}

export function normalizeHostLiteral(value: string): string {
  const unwrapped = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
  const decoded = decodeScopeHostLiteral(unwrapped)
  if (!decoded) return ''
  const normalized = decoded.toLowerCase().replace(/\.$/, '')
  if (normalized === '*') return normalized
  if (/[/?#@\\\s%]/.test(normalized)) return ''
  if (normalized.startsWith('*.') && normalized.length > 2) return normalized
  if (normalized.includes('*')) return ''
  return normalized
}

export function isLocalNetworkHost(host: string): boolean {
  const value = normalizeHostLiteral(host.toLowerCase())
  if (value === 'localhost' || value === '127.0.0.1' || value === '::1' || value.endsWith('.local') || value.endsWith('.lan')) return true
  const ipv4 = parseIpv4Octets(value)
  if (ipv4) {
    if (ipv4[0] === 127) return true
    if (ipv4[0] === 10) return true
    if (ipv4[0] === 192 && ipv4[1] === 168) return true
    return ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31
  }
  const ipv6FirstHextet = parseIpv6FirstHextet(value)
  if (ipv6FirstHextet === undefined) return false
  return (ipv6FirstHextet >= 0xfc00 && ipv6FirstHextet <= 0xfdff) || (ipv6FirstHextet >= 0xfe80 && ipv6FirstHextet <= 0xfebf)
}

function scopeListCoversAll(
  allowed: readonly string[] | undefined,
  requested: readonly string[] | undefined,
  normalize: (value: string) => string,
  covers: (allowed: string, requested: string) => boolean,
): boolean {
  const requestedScopeValues = exactScopeValues(requested)
  if (requestedScopeValues.invalid) return false
  const requestedValues = requestedScopeValues.values
  if (!requestedValues.length) return true
  const normalizedRequested = requestedValues.map(normalize)
  if (normalizedRequested.some((item) => !item)) return false
  const allowedScopeValues = exactScopeValues(allowed)
  if (allowedScopeValues.invalid) return false
  const allowedValues = allowedScopeValues.values
  if (!allowedValues.length) return true
  const normalizedAllowed = allowedValues.map(normalize).filter(Boolean)
  if (!normalizedAllowed.length) return false
  return normalizedRequested.every((requestedItem) => normalizedAllowed.some((allowedItem) => covers(allowedItem, requestedItem)))
}

function exactScopeValues(input: unknown): { values: string[]; invalid: boolean } {
  if (input === undefined) return { values: [], invalid: false }
  if (!Array.isArray(input)) return { values: [], invalid: true }
  const values: string[] = []
  for (const item of input) {
    if (typeof item !== 'string' || item.trim() !== item || !item) return { values: [], invalid: true }
    if (!values.includes(item)) values.push(item)
  }
  return { values, invalid: false }
}

function isPathWithinScope(allowed: string, requested: string): boolean {
  if (!allowed || !requested) return false
  if (allowed === '/') return requested.startsWith('/')
  return requested === allowed || requested.startsWith(`${allowed}/`)
}

function isHostWithinScope(allowed: string, requested: string): boolean {
  if (!allowed || !requested) return false
  if (allowed === '*') return true
  if (allowed.startsWith('*.')) {
    const suffix = allowed.slice(1)
    return requested.endsWith(suffix) && requested !== allowed.slice(2)
  }
  return requested === allowed
}

function stripHostPort(value: string): string {
  const host = value.split(/[/?#]/, 1)[0]
  if (host.startsWith('[')) {
    const closeIndex = host.indexOf(']')
    if (closeIndex >= 0) return host.slice(1, closeIndex)
  }
  const colonCount = (host.match(/:/g) ?? []).length
  return colonCount === 1 ? host.replace(/:\d+$/, '') : host
}

function decodeScopePathSegment(input: string): string {
  let decoded = input
  for (let pass = 0; pass < 3 && decoded.includes('%'); pass += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      return decoded
    }
  }
  return decoded
}

function decodeScopeHostLiteral(input: string): string {
  let decoded = input
  for (let pass = 0; pass < 3 && decoded.includes('%'); pass += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      return ''
    }
  }
  return decoded.includes('/') || decoded.includes('\\') || decoded.includes('@') ? '' : decoded
}

function parseIpv4Octets(value: string): [number, number, number, number] | undefined {
  const parts = value.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return undefined
  const octets = parts.map((part) => Number.parseInt(part, 10))
  return octets.every((octet) => octet >= 0 && octet <= 255)
    ? octets as [number, number, number, number]
    : undefined
}

function parseIpv6FirstHextet(value: string): number | undefined {
  if (!value.includes(':')) return undefined
  const firstSegment = value.split(':', 1)[0]
  if (!/^[0-9a-f]{1,4}$/i.test(firstSegment)) return undefined
  return Number.parseInt(firstSegment, 16)
}
