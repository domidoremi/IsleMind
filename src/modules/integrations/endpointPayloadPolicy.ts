import { sanitizeMcpGatewayEndpointPath } from './mcpGatewayPolicy'
import { isUnsafeRuntimePairingText } from './textSafety'

const PAYLOAD_ITEM_LIMIT = 40
const PAYLOAD_KEY_SCAN_LIMIT = 80
const TEXT_LIMIT = 420

export function sanitizeToolchainEndpointReference(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.trim() !== input || !input) return undefined
  try {
    const parsed = new URL(input)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    const origin = sanitizeEndpointOrigin(input)
    const path = sanitizeMcpGatewayEndpointPath(parsed.pathname)
    return origin ? `${origin}${path}` : undefined
  } catch {
    return undefined
  }
}

export function createTaskPayloadKeys(input: Record<string, unknown>): string[] {
  return sanitizeTaskPayloadKeyList(Object.keys(input))
}

export function sanitizeTaskPayloadKeyList(input: unknown): string[] {
  return Array.from(new Set(sanitizeList(input)
    .map(sanitizeTaskPayloadKey)
    .filter((key): key is string => Boolean(key))))
    .slice(0, PAYLOAD_ITEM_LIMIT)
}

export function sanitizeTaskPayloadKey(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.trim() !== input) return undefined
  if (!input || cleanTaskItemToken(input) !== input || isUnsafeTaskPayloadKey(input)) return undefined
  return input
}

export function sanitizePayload(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {}
  return Object.fromEntries(Object.entries(input)
    .slice(0, PAYLOAD_ITEM_LIMIT)
    .flatMap(([key, value]) => {
      const safeKey = sanitizeTaskPayloadKey(key)
      return safeKey ? [[safeKey, value] as const] : []
    }))
}

export function sanitizeRuntimeHandoffPayload(input: Record<string, unknown> | undefined): Record<string, unknown> {
  const payload = sanitizePayload(input)
  return Object.fromEntries(Object.entries(payload).flatMap(([key, value]) => {
    const safeKey = sanitizeTaskPayloadKey(key)
    return safeKey ? [[safeKey, sanitizeRuntimeHandoffPayloadValue(safeKey, value)] as const] : []
  }))
}

function sanitizeRuntimeHandoffPayloadValue(key: string, value: unknown): unknown {
  if (isSensitivePayloadKey(key)) return '[redacted]'
  if (typeof value === 'string') {
    const sanitized = sanitizeTaskLogMessage(value)
    if (!sanitized.message) return ''
    if (sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return '[redacted]'
    return cleanText(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) {
    return value.slice(0, PAYLOAD_ITEM_LIMIT)
      .map((item, index) => sanitizeRuntimeHandoffPayloadValue(`${key}.${index}`, item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, PAYLOAD_ITEM_LIMIT)
      .flatMap(([childKey, childValue]) => {
        const safeKey = sanitizeTaskPayloadKey(childKey)
        return safeKey ? [[safeKey, sanitizeRuntimeHandoffPayloadValue(safeKey, childValue)] as const] : []
      }))
  }
  return undefined
}

function sanitizeEndpointOrigin(input: unknown): string | undefined {
  const raw = cleanText(input)
  if (!raw) return undefined
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined
  } catch {
    return undefined
  }
}

function isUnsafeTaskPayloadKey(input: string): boolean {
  return (
    /sk-[A-Za-z0-9_-]{8,}/i.test(input) ||
    /[\\/]/.test(input) ||
    /:\/\//.test(input) ||
    /(?:^|[?&\s])(?:api[-_]?key|token|secret|password|authorization|credential)\s*[:=]/i.test(input) ||
    /(?:^|\s)(?:islemind|node|npm|bun|pnpm|npx|git|python|python3|sh|bash|pwsh|cmd)\s/i.test(input) ||
    /[;&|`$<>]/.test(input)
  )
}

function isSensitivePayloadKey(key: string): boolean {
  return /(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|authorization|credential|bearer|auth)/i.test(key)
}

function sanitizeList(input: unknown): unknown[] {
  return Array.isArray(input) ? input.slice(0, PAYLOAD_KEY_SCAN_LIMIT) : []
}

function cleanTaskItemToken(input: string | undefined): string {
  return cleanText(input).replace(/[^a-z0-9_.:-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 128).replace(/^-+|-+$/g, '')
}

function cleanText(input: unknown): string {
  return typeof input === 'string' ? input.trim().slice(0, TEXT_LIMIT) : ''
}

function sanitizeTaskLogMessage(input: unknown): { message: string; redacted: boolean } {
  let message = cleanText(input)
  let redacted = false
  const replacements: Array<[RegExp, string | ((substring: string, ...args: string[]) => string)]> = [
    [/(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}/gi, (_match, prefix) => { redacted = true; return `${prefix}[redacted]` }],
    [/(^|[\s,;])authorization\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, (_match, prefix) => { redacted = true; return `${prefix}[redacted]` }],
    [/(^|[\s,;])(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|credential|bearer)\s*[:=]\s*[^\s,;]+/gi, (_match, prefix) => { redacted = true; return `${prefix}[redacted]` }],
    [/\bbearer\s+[A-Za-z0-9._~+/-]{8,}/gi, () => { redacted = true; return '[redacted]' }],
    [/https?:\/\/[^\s,;)]+/gi, () => { redacted = true; return '[redacted]' }],
    [/(^|[\s([])(?:[A-Za-z]:[\\/][^\s,;)]+|\/(?:storage|sdcard|data|home|Users|var|tmp|etc|mnt|Volumes)\/[^\s,;)]+|\.{1,2}[\\/][^\s,;)]+)/gi, (_match, prefix) => { redacted = true; return `${prefix}[redacted]` }],
    [/(^|\s)islemind\s+(?:mcp|skill|git|agent|toolchain|runtime|serve|run|validate|commit-preview)\b[^\n\r]*/gi, (_match, prefix) => { redacted = true; return `${prefix}[redacted]` }],
    [/(^|\s)(?:node|npm|bun|pnpm|npx|git|python|python3|sh|bash|pwsh|cmd)\s+(?:-|\.{0,2}[\\/]|[A-Za-z]:[\\/]|[A-Za-z0-9_.:/\\-]+(?:\s|$))[^\n\r]*/gi, (_match, prefix) => { redacted = true; return `${prefix}[redacted]` }],
  ]
  for (const [pattern, replacement] of replacements) message = message.replace(pattern, replacement as string)
  return { message, redacted }
}
