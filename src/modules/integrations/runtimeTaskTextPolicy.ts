import { isUnsafeRuntimePairingText } from './textSafety'

const TEXT_LIMIT = 420
const STABLE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,127}$/

export const RUNTIME_TASK_LOG_LEVELS = ['debug', 'info', 'warning', 'error'] as const
export const RUNTIME_TASK_ARTIFACT_KINDS = ['json', 'text', 'artifact', 'log', 'diff', 'report'] as const

export type RuntimeTaskLogLevel = typeof RUNTIME_TASK_LOG_LEVELS[number]
export type RuntimeTaskArtifactKind = typeof RUNTIME_TASK_ARTIFACT_KINDS[number]

export function sanitizeRuntimeEventTrigger(input: unknown, fallback: string): string {
  const fallbackTrigger = cleanTaskItemToken(fallback) || 'runtime-event'
  const sanitized = sanitizeTaskLogMessage(input)
  if (!sanitized.message || sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return fallbackTrigger
  return cleanTaskItemToken(sanitized.message) || fallbackTrigger
}

export function sanitizeTaskLogLevel(input: RuntimeTaskLogLevel | undefined): RuntimeTaskLogLevel {
  return RUNTIME_TASK_LOG_LEVELS.includes(input as RuntimeTaskLogLevel) ? input as RuntimeTaskLogLevel : 'info'
}

export function sanitizeTaskArtifactKind(input: RuntimeTaskArtifactKind | undefined): RuntimeTaskArtifactKind {
  return RUNTIME_TASK_ARTIFACT_KINDS.includes(input as RuntimeTaskArtifactKind) ? input as RuntimeTaskArtifactKind : 'artifact'
}

export function sanitizeTaskLogMessage(input: unknown): { message: string; redacted: boolean } {
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

export function sanitizeTaskLogSource(input: unknown, fallback: string): { source: string; redacted: boolean } {
  const sanitized = sanitizeTaskLogMessage(input)
  const fallbackSource = cleanTaskItemToken(fallback) || 'runtime'
  if (!sanitized.message) return { source: fallbackSource, redacted: false }
  if (sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return { source: fallbackSource, redacted: true }
  return {
    source: cleanTaskItemToken(sanitized.message) || fallbackSource,
    redacted: sanitized.redacted,
  }
}

export function sanitizeTaskArtifactLabel(input: unknown): string {
  const sanitized = sanitizeTaskLogMessage(input)
  if (!sanitized.message) return 'Artifact'
  if (sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return 'Artifact'
  return sanitized.message
}

export function sanitizeTaskArtifactMediaType(input: unknown): string | undefined {
  const sanitized = sanitizeTaskLogMessage(input)
  const value = sanitized.message
  if (!value || sanitized.redacted || isUnsafeArtifactMetadataText(value, true)) return undefined
  return /^[a-z0-9][a-z0-9.+-]{0,80}\/[a-z0-9][a-z0-9.+-]{0,80}(?:;\s*[a-z0-9_.+-]{1,40}=[a-z0-9_.+-]{1,80}){0,4}$/i.test(value)
    ? value
    : undefined
}

export function sanitizeTaskArtifactChecksum(input: unknown): string | undefined {
  const sanitized = sanitizeTaskLogMessage(input)
  const value = sanitized.message
  if (!value || sanitized.redacted || isUnsafeArtifactMetadataText(value, false)) return undefined
  return /^[a-z0-9][a-z0-9_.:+~=-]{0,159}$/i.test(value) ? value : undefined
}

export function createTaskItemId(prefix: string, taskId: string, now: number, index: number): string {
  return `${prefix}-${cleanTaskItemToken(taskId) || 'task'}-${now.toString(36)}-${index.toString(36)}`
}

export function sanitizeExternalTaskItemToken(input: unknown): string {
  if (typeof input !== 'string' || input.trim() !== input) return ''
  const raw = input
  if (!raw || isUnsafeRuntimePairingText(raw)) return ''
  return cleanTaskItemToken(raw) === raw && STABLE_ID_PATTERN.test(raw) ? raw : ''
}

export function cleanPublicText(input: unknown): string {
  return sanitizeTaskLogMessage(input).message
}

function cleanText(input: unknown): string {
  return typeof input === 'string' ? input.trim().slice(0, TEXT_LIMIT) : ''
}

function cleanTaskItemToken(input: string | undefined): string {
  return cleanText(input)
    .replace(/[^a-z0-9_.:-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128)
    .replace(/^-+|-+$/g, '')
}

function isUnsafeArtifactMetadataText(input: string, allowSlash: boolean): boolean {
  return (
    /(?:^|[/?&\s])(api[-_]?key|token|secret|password|authorization|credential)(?:\s*[:=]|[/?&=]|$)/i.test(input) ||
    /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}/i.test(input) ||
    (!allowSlash && /[\\/]/.test(input)) ||
    /:\/\//.test(input) ||
    /(?:^|\s)(?:islemind|node|npm|bun|pnpm|npx|git|python|python3|sh|bash|pwsh|cmd)\s/i.test(input) ||
    /[&|`$]/.test(input)
  )
}
