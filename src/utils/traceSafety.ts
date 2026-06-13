import type { ProcessTrace } from '@/types'

const SECRET_PATTERNS: RegExp[] = [
  /(api[_-]?key|authorization|bearer|password|secret|token)\s*[:=]\s*["']?[^"'\s,}]+/gi,
  /\b(sk|tp)-[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi,
]

const SAFE_TRACE_TOKEN_METADATA_KEYS = new Set([
  'estimatedtokens',
  'inputtoken',
  'inputtokens',
  'maxtokens',
  'outputtoken',
  'outputtokens',
  'tokencount',
  'tokencounts',
  'tokenbudget',
  'tokenlimit',
])

export function redactSensitiveText(input: string): string {
  return SECRET_PATTERNS.reduce((value, pattern) => value.replace(pattern, '[redacted]'), input)
}

export function containsSensitiveText(input: string): boolean {
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0
    return pattern.test(input)
  })
}

export function sanitizeTraceMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    safe[key] = isSensitiveTraceMetadataKey(key) ? '[redacted]' : sanitizeTraceMetadataValue(value)
  }
  return safe
}

export function sanitizeTraceMetadataValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSensitiveText(value)
  if (Array.isArray(value)) return value.map(sanitizeTraceMetadataValue)
  if (value && typeof value === 'object') {
    const safe: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      safe[key] = isSensitiveTraceMetadataKey(key) ? '[redacted]' : sanitizeTraceMetadataValue(child)
    }
    return safe
  }
  return value
}

export function sanitizeProcessTraceForBoundary(trace: ProcessTrace): ProcessTrace {
  return {
    ...trace,
    title: redactSensitiveText(trace.title),
    content: typeof trace.content === 'string' ? redactSensitiveText(trace.content) : undefined,
    metadata: sanitizeTraceMetadata(trace.metadata),
  }
}

export function sanitizeProcessTracesForBoundary(traces: ProcessTrace[] | undefined): ProcessTrace[] | undefined {
  if (!Array.isArray(traces)) return undefined
  return traces.map(sanitizeProcessTraceForBoundary)
}

export function isSensitiveTraceMetadataKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
  if (!normalized || SAFE_TRACE_TOKEN_METADATA_KEYS.has(normalized)) return false
  return normalized.includes('apikey') ||
    normalized.includes('authorization') ||
    normalized.includes('bearer') ||
    normalized.includes('credential') ||
    normalized.includes('password') ||
    normalized.includes('privatekey') ||
    normalized.includes('secret') ||
    normalized === 'token' ||
    normalized.endsWith('token')
}
