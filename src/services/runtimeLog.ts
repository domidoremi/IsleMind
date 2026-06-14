import * as FileSystem from 'expo-file-system/legacy'

const SCHEMA = 'islemind.runtime-log.v1'
const DEFAULT_MAX_BYTES = 1048576
const LOG_FILE_NAME = 'islemind-runtime.jsonl'
const REDACTED = '[redacted]'
const MAX_STRING_LENGTH = 160

export type RuntimeLogEvent =
  | 'upstream.request'
  | 'upstream.response'
  | 'upstream.error'
  | 'upstream.retry'
  | 'circuit.breaker'
  | 'transport.fallback'
  | 'session.lease'
  | 'compact.request'
  | 'compact.usage'
  | 'payload.rule'
  | 'provider.conformance'
  | 'route.decision'
  | 'fallback.decision'
  | 'request.rectification'
  | 'access.policy'
  | 'proxy.policy'
  | 'android.operation.audit'

export interface RuntimeLogOptions {
  enabled?: boolean
  maxBytes?: number
}

export interface RuntimeLogEntry {
  schema: typeof SCHEMA
  ts: string
  event: RuntimeLogEvent
  [key: string]: unknown
}

export interface RuntimeLogInfo {
  path: string
  exists: boolean
  size: number
}

export function getRuntimeLogPath(): string {
  return `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ''}${LOG_FILE_NAME}`
}

export async function getRuntimeLogInfo(): Promise<RuntimeLogInfo> {
  const path = getRuntimeLogPath()
  try {
    const info = await FileSystem.getInfoAsync(path)
    return {
      path,
      exists: info.exists,
      size: info.exists && 'size' in info && typeof info.size === 'number' ? info.size : 0,
    }
  } catch {
    return { path, exists: false, size: 0 }
  }
}

export async function readRuntimeLogText(maxBytes = 12000): Promise<string> {
  const path = getRuntimeLogPath()
  const normalizedMax = normalizeMaxBytes(maxBytes)
  try {
    const info = await FileSystem.getInfoAsync(path)
    if (!info.exists) return ''
    const size = 'size' in info && typeof info.size === 'number' ? info.size : 0
    const position = Math.max(0, size - normalizedMax)
    return await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.UTF8,
      position,
      length: normalizedMax,
    })
  } catch {
    return ''
  }
}

export async function clearRuntimeLog(): Promise<void> {
  const path = getRuntimeLogPath()
  try {
    const info = await FileSystem.getInfoAsync(path)
    if (!info.exists) return
    await FileSystem.deleteAsync(path, { idempotent: true })
  } catch {
    // Log maintenance must not block settings interactions.
  }
}

export async function appendRuntimeLog(event: RuntimeLogEvent, data: Record<string, unknown>, options: RuntimeLogOptions = {}): Promise<void> {
  if (!options.enabled) return
  const root = FileSystem.documentDirectory ?? FileSystem.cacheDirectory
  if (!root) return
  const uri = `${root}${LOG_FILE_NAME}`
  const maxBytes = normalizeMaxBytes(options.maxBytes)
  const redactedData = redactRuntimeLogRecord(data)
  const entry: RuntimeLogEntry = {
    schema: SCHEMA,
    ts: new Date().toISOString(),
    event,
    ...redactedData,
  }
  try {
    await writeRuntimeLogLine(uri, `${JSON.stringify(entry)}\n`, maxBytes)
  } catch {
    // Logging must not change the chat request result.
  }
}

export function redactRuntimeLogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactRuntimeLogValue)
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactString(value) : value
  }
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      output[key] = REDACTED
      continue
    }
    if (isPayloadBodyKey(key)) {
      output[key] = summarizePayloadBody(item)
      continue
    }
    output[key] = redactRuntimeLogValue(item)
  }
  return output
}

function redactRuntimeLogRecord(value: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactRuntimeLogValue(value)
  return redacted && typeof redacted === 'object' && !Array.isArray(redacted) ? redacted as Record<string, unknown> : {}
}

function normalizeMaxBytes(value: number | undefined): number {
  return Number.isFinite(value) && value! > 0 ? Math.max(4096, Math.floor(value!)) : DEFAULT_MAX_BYTES
}

async function writeRuntimeLogLine(uri: string, line: string, maxBytes: number): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri)
  const existing = info.exists && 'size' in info && typeof info.size === 'number' && info.size < maxBytes
    ? await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 }).catch(() => '')
    : ''
  const combined = trimToMaxBytes(`${existing}${line}`, maxBytes)
  await FileSystem.writeAsStringAsync(uri, combined, { encoding: FileSystem.EncodingType.UTF8 })
}

function trimToMaxBytes(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value
  const lines = value.split('\n').filter(Boolean)
  const kept: string[] = []
  let size = 0
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = `${lines[index]}\n`
    const lineSize = utf8ByteLength(line)
    if (size + lineSize > maxBytes && kept.length) break
    size += lineSize
    kept.unshift(line)
  }
  return kept.join('')
}

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0
    if (codePoint <= 0x7f) bytes += 1
    else if (codePoint <= 0x7ff) bytes += 2
    else if (codePoint <= 0xffff) bytes += 3
    else bytes += 4
  }
  return bytes
}

function isSensitiveKey(key: string): boolean {
  return /authorization|api[-_]?key|token|secret|password|credential|bearer/i.test(key)
}

function isPayloadBodyKey(key: string): boolean {
  return /body|payload|prompt|message|content|response|base64|file_data|image_url/i.test(key)
}

function summarizePayloadBody(value: unknown): unknown {
  if (typeof value === 'string') {
    return { redacted: true, length: value.length, keys: parseJsonKeys(value) }
  }
  if (Array.isArray(value)) return { redacted: true, itemCount: value.length }
  if (value && typeof value === 'object') return { redacted: true, keys: Object.keys(value as Record<string, unknown>).sort() }
  return value
}

function parseJsonKeys(value: string): string[] | undefined {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.keys(parsed).sort()
      : undefined
  } catch {
    return undefined
  }
}

function redactString(value: string): string {
  let next = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/g, 'Bearer [redacted]')
    .replace(/\b(?:sk|tp)-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g, REDACTED)
    .replace(/\bAIza[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\bya29\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
  if (next.length > MAX_STRING_LENGTH) next = `${next.slice(0, MAX_STRING_LENGTH)}...`
  return next
}
