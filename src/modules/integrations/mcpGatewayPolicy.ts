import { isLocalNetworkHost, normalizeHostLiteral } from './scopePolicy'
import { isUnsafeRuntimePairingText } from './textSafety'

const TEXT_LIMIT = 420

export type McpGatewayTransport = 'streamable-http' | 'http'

export interface McpGatewayEndpoint {
  transport: McpGatewayTransport
  origin: string
  host: string
  port?: number
  path: string
  url: string
  localNetwork: boolean
}

export function resolveMcpGatewayTransport(transport: string | undefined): McpGatewayTransport | undefined {
  return transport === 'streamable-http' || transport === 'http' ? transport : undefined
}

export function sanitizeMcpGatewayEndpoint(
  input: unknown,
  transport: McpGatewayTransport,
): McpGatewayEndpoint | undefined {
  if (typeof input !== 'string' || input.trim() !== input) return undefined
  const raw = input
  if (!raw) return undefined
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  const host = normalizeHostLiteral(parsed.hostname.toLowerCase())
  if (!host) return undefined
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : undefined
  const path = sanitizeMcpGatewayEndpointPath(parsed.pathname)
  const origin = parsed.origin
  return {
    transport,
    origin,
    host,
    port: Number.isFinite(port) ? port : undefined,
    path,
    url: `${origin}${path}`,
    localNetwork: isLocalNetworkHost(host),
  }
}

export function sanitizeMcpGatewayEndpointPath(input: string): string {
  const path = (cleanText(input) || '/').split(/[?#]/, 1)[0] || '/'
  const sanitized = sanitizeSensitiveEndpointPathSegments(sanitizeTaskLogMessage(path).message)
  return sanitized.startsWith('/') ? sanitized : `/${sanitized}`
}

function sanitizeSensitiveEndpointPathSegments(input: string): string {
  const rawSegments = input.split('/')
  const sanitizedSegments: string[] = []
  let previousDecodedSegment = ''
  rawSegments.forEach((segment) => {
    const decodedPathSegment = decodeEndpointPathSegment(segment).replace(/\\/g, '/')
    if (/:\/\//.test(decodedPathSegment)) {
      sanitizedSegments.push('[redacted]')
      previousDecodedSegment = decodedPathSegment
      return
    }
    const decodedSegments = decodedPathSegment.split('/')
    decodedSegments.forEach((decodedSegment) => {
      const previousSegment = previousDecodedSegment
      previousDecodedSegment = decodedSegment
      if (!decodedSegment || decodedSegment === '.') return
      if (isSensitiveEndpointPathKey(previousSegment)) {
        sanitizedSegments.push('[redacted]')
        return
      }
      const keyValueMatch = decodedSegment.match(/^([^=:/]+)([:=])(.+)$/)
      if (keyValueMatch && isSensitiveEndpointPathKey(keyValueMatch[1])) {
        sanitizedSegments.push(`${cleanEndpointPathSegment(keyValueMatch[1])}${keyValueMatch[2]}[redacted]`)
        return
      }
      if (isSensitiveEndpointPathValue(decodedSegment)) {
        sanitizedSegments.push('[redacted]')
        return
      }
      if (isSensitiveEndpointPathKey(decodedSegment)) {
        sanitizedSegments.push(cleanEndpointPathSegment(decodedSegment))
        return
      }
      const sanitizedSegment = sanitizeTaskLogMessage(decodedSegment)
      if (sanitizedSegment.redacted || isUnsafeRuntimePairingText(sanitizedSegment.message)) {
        sanitizedSegments.push('[redacted]')
        return
      }
      if (decodedSegment === '..') {
        sanitizedSegments.pop()
        return
      }
      sanitizedSegments.push(cleanEndpointPathSegment(sanitizedSegment.message))
    })
  })
  return `/${sanitizedSegments.join('/')}`
}

function decodeEndpointPathSegment(input: string): string {
  let current = input
  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(current)
      if (decoded === current) return decoded
      current = decoded
    } catch {
      return current
    }
  }
  return current
}

function cleanEndpointPathSegment(input: string): string {
  return cleanText(input).replace(/[^a-z0-9_.:-]+/gi, '-').slice(0, 64) || 'segment'
}

function isSensitiveEndpointPathKey(input: string): boolean {
  return /^(?:api[-_]?key|access[-_]?token|refresh[-_]?token|auth|authorization|bearer|key|token|secret|password|credential|signature|sig)$/i.test(cleanText(input))
}

function isSensitiveEndpointPathValue(input: string): boolean {
  return /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}/i.test(cleanText(input))
}

function cleanText(input: unknown): string {
  return typeof input === 'string' ? input.trim().slice(0, TEXT_LIMIT) : ''
}

function sanitizeTaskLogMessage(input: unknown): { message: string; redacted: boolean } {
  let message = cleanText(input)
  let redacted = false
  const replacements: Array<[RegExp, string | ((substring: string, ...args: string[]) => string)]> = [
    [/(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}/gi, (_match, prefix) => {
      redacted = true
      return `${prefix}[redacted]`
    }],
    [/(^|[\s,;])authorization\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, (_match, prefix) => {
      redacted = true
      return `${prefix}[redacted]`
    }],
    [/(^|[\s,;])(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|credential|bearer)\s*[:=]\s*[^\s,;]+/gi, (_match, prefix) => {
      redacted = true
      return `${prefix}[redacted]`
    }],
    [/\bbearer\s+[A-Za-z0-9._~+/-]{8,}/gi, () => {
      redacted = true
      return '[redacted]'
    }],
    [/https?:\/\/[^\s,;)]+/gi, () => {
      redacted = true
      return '[redacted]'
    }],
    [/(^|[\s([])(?:[A-Za-z]:[\\/][^\s,;)]+|\/(?:storage|sdcard|data|home|Users|var|tmp|etc|mnt|Volumes)\/[^\s,;)]+|\.{1,2}[\\/][^\s,;)]+)/gi, (_match, prefix) => {
      redacted = true
      return `${prefix}[redacted]`
    }],
    [/(^|\s)islemind\s+(?:mcp|skill|git|agent|toolchain|runtime|serve|run|validate|commit-preview)\b[^\n\r]*/gi, (_match, prefix) => {
      redacted = true
      return `${prefix}[redacted]`
    }],
    [/(^|\s)(?:node|npm|bun|pnpm|npx|git|python|python3|sh|bash|pwsh|cmd)\s+(?:-|\.{0,2}[\\/]|[A-Za-z]:[\\/]|[A-Za-z0-9_.:/\\-]+(?:\s|$))[^\n\r]*/gi, (_match, prefix) => {
      redacted = true
      return `${prefix}[redacted]`
    }],
  ]
  for (const [pattern, replacement] of replacements) {
    message = message.replace(pattern, replacement as string)
  }
  return { message, redacted }
}
