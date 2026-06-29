import AsyncStorage from '@react-native-async-storage/async-storage'
import * as FileSystem from 'expo-file-system/legacy'
import type { Settings } from '@/types'

const SCHEMA = 'islemind.runtime-log.v1'
const DEFAULT_MAX_BYTES = 1048576
const LOG_FILE_NAME = 'islemind-runtime.jsonl'
const REDACTED = '[redacted]'
const MAX_STRING_LENGTH = 160
const MAX_URL_STRING_LENGTH = 2048
const SENSITIVE_QUERY_PARAM_PATTERN = /([?&]([^=&#\s]+)=)([^&#\s]+)/gi
const SENSITIVE_ASSIGNMENT_PATTERN = /((?:^|[\s,;])(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|token|password|credential)\s*[:=]\s*)(["']?)([A-Za-z0-9._~+/=-]{8,})/gi
const SETTINGS_STORAGE_KEY = '@islemind/settings'
let runtimeLogMutationChain: Promise<unknown> = Promise.resolve()

export type RuntimeLogEvent =
  | 'upstream.request'
  | 'upstream.response'
  | 'upstream.error'
  | 'upstream.retry'
  | 'circuit.breaker'
  | 'transport.fallback'
  | 'session.lease'
  | 'session.affinity'
  | 'compact.request'
  | 'compact.usage'
  | 'payload.rule'
  | 'provider.compatibility'
  | 'provider.conformance'
  | 'route.decision'
  | 'route.snapshot'
  | 'fallback.decision'
  | 'request.rectification'
  | 'access.policy'
  | 'proxy.policy'
  | 'app.update'
  | 'mcp.operation'
  | 'context.operation'
  | 'storage.operation'
  | 'render.error'
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

export async function readStoredRuntimeLogOptions(): Promise<RuntimeLogOptions> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return { enabled: false }
    const settings = JSON.parse(raw) as Partial<Settings>
    return {
      enabled: settings.runtimeLogEnabled === true,
      maxBytes: typeof settings.runtimeLogMaxBytes === 'number' ? settings.runtimeLogMaxBytes : undefined,
    }
  } catch {
    return { enabled: false }
  }
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
    const text = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.UTF8,
      position,
      length: normalizedMax,
    })
    return position > 0 ? trimLeadingPartialLine(text) : text
  } catch {
    return ''
  }
}

export async function clearRuntimeLog(): Promise<void> {
  const path = getRuntimeLogPath()
  try {
    await enqueueRuntimeLogMutation(async () => {
      const info = await FileSystem.getInfoAsync(path)
      if (!info.exists) return
      await FileSystem.deleteAsync(path, { idempotent: true })
    })
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
    await enqueueRuntimeLogMutation(() => writeRuntimeLogLine(uri, `${JSON.stringify(entry)}\n`, maxBytes))
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

function trimLeadingPartialLine(value: string): string {
  if (!value) return ''
  const newlineIndex = value.indexOf('\n')
  if (newlineIndex < 0) return ''
  return value.slice(newlineIndex + 1)
}

function enqueueRuntimeLogMutation<T>(task: () => Promise<T>): Promise<T> {
  const run = runtimeLogMutationChain.catch(() => undefined).then(task)
  runtimeLogMutationChain = run.then(() => undefined, () => undefined)
  return run
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
  if (/^credential[-_ ]?group[-_ ]?ids?$/i.test(key)) return false
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
  if (value && typeof value === 'object') {
    const existingSummary = value as Record<string, unknown>
    if (
      existingSummary.redacted === true &&
      (Array.isArray(existingSummary.keys) || typeof existingSummary.length === 'number' || typeof existingSummary.itemCount === 'number')
    ) {
      return value
    }
    return { redacted: true, keys: Object.keys(existingSummary).sort() }
  }
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

function redactSensitiveQueryParams(value: string): string {
  return value.replace(
    SENSITIVE_QUERY_PARAM_PATTERN,
    (match: string, prefix: string, rawKey: string) => (isSensitiveQueryParamKey(rawKey) ? `${prefix}[redacted]` : match)
  )
}

function redactSensitiveAssignments(value: string): string {
  return value.replace(SENSITIVE_ASSIGNMENT_PATTERN, (_match, prefix: string, quote: string) => `${prefix}${quote}[redacted]${quote}`)
}

function redactUrlUserInfo(value: string): string {
  return value.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^/\s@]+)@/gi, (_match, scheme: string) => `${scheme}[redacted]@`)
}

function redactString(value: string): string {
  let next = redactUrlUserInfo(redactSensitiveAssignments(redactSensitiveQueryParams(value)))
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}(?=$|[^A-Za-z0-9._~+/=-])/gi, '$1 [redacted]')
    .replace(/\b(Basic)\s+[A-Za-z0-9+/=-]{8,}(?=$|[^A-Za-z0-9+/=-])/gi, '$1 [redacted]')
    .replace(/\b(?:sk|tp)-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g, REDACTED)
    .replace(/\bAIza[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\bya29\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
  const maxLength = isLikelyUrl(next) ? MAX_URL_STRING_LENGTH : MAX_STRING_LENGTH
  if (next.length > maxLength) next = `${next.slice(0, maxLength)}...`
  return next
}

function isSensitiveQueryParamKey(key: string): boolean {
  const normalized = key.trim().toLowerCase()
  if (!normalized) return false
  if (normalized === 'key' || normalized === 'token' || normalized === 'sig' || normalized === 'signature') return true
  if (normalized.includes('password') || normalized.includes('secret') || normalized.includes('credential')) return true
  if (normalized.includes('api') && normalized.includes('key')) return true
  if (normalized.includes('access') && normalized.includes('token')) return true
  if (normalized.includes('refresh') && normalized.includes('token')) return true
  if (normalized.startsWith('x-amz-') && (normalized.endsWith('credential') || normalized.endsWith('signature') || normalized.endsWith('security-token'))) return true
  if (normalized.startsWith('x-goog-') && (normalized.endsWith('credential') || normalized.endsWith('signature') || normalized.endsWith('token'))) return true
  return false
}

function isLikelyUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
}
