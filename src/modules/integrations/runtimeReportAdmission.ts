import { isUnsafeRuntimePairingText } from './textSafety'

const LOG_LEVELS = ['debug', 'info', 'warning', 'error'] as const
const ARTIFACT_KINDS = ['json', 'text', 'artifact', 'log', 'diff', 'report'] as const
const TEXT_LIMIT = 420
const STABLE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,127}$/

export interface PersistedTaskIdentity {
  taskId: string
  runtimeKind: string
  updatedAt: number
}

export interface PersistedTaskLogEntry {
  id: string
  ts: number
  level: typeof LOG_LEVELS[number]
  source: string
  message: string
  redacted: boolean
}

export interface PersistedTaskArtifact {
  artifactId: string
  label: string
  kind: typeof ARTIFACT_KINDS[number]
  createdAt: number
  sizeBytes?: number
  mediaType?: string
  checksum?: string
}

export function isTrustedTaskLifecycleLogEntry(
  log: PersistedTaskLogEntry,
  task: PersistedTaskIdentity,
): boolean {
  const record = asRecord(log)
  if (!record || !hasTrustedTaskLifecycleLogEntryFields(record)) return false
  const sanitizedMessage = sanitizeTaskLogMessage(log.message)
  const sanitizedSource = sanitizeTaskLogSource(log.source, task.runtimeKind)
  return (
    STABLE_ID_PATTERN.test(log.id) &&
    sanitizeExternalTaskItemToken(log.id) === log.id &&
    log.id.startsWith(`log-${cleanTaskItemToken(task.taskId)}-`) &&
    Number.isFinite(log.ts) &&
    log.ts <= task.updatedAt &&
    LOG_LEVELS.includes(log.level) &&
    sanitizedSource.source === log.source &&
    (!sanitizedSource.redacted || log.redacted === true) &&
    sanitizedMessage.message === log.message &&
    typeof log.redacted === 'boolean'
  )
}

export function isTrustedTaskLifecycleArtifact(
  artifact: PersistedTaskArtifact,
  task: PersistedTaskIdentity,
): boolean {
  const record = asRecord(artifact)
  if (!record || !hasTrustedTaskLifecycleArtifactFields(record)) return false
  return (
    STABLE_ID_PATTERN.test(artifact.artifactId) &&
    sanitizeExternalTaskItemToken(artifact.artifactId) === artifact.artifactId &&
    Number.isFinite(artifact.createdAt) &&
    artifact.createdAt <= task.updatedAt &&
    sanitizeTaskArtifactLabel(artifact.label) === artifact.label &&
    ARTIFACT_KINDS.includes(artifact.kind) &&
    (artifact.sizeBytes === undefined || sanitizeOptionalNonNegativeNumber(artifact.sizeBytes) === artifact.sizeBytes) &&
    (artifact.mediaType === undefined || sanitizeTaskArtifactMediaType(artifact.mediaType) === artifact.mediaType) &&
    (artifact.checksum === undefined || sanitizeTaskArtifactChecksum(artifact.checksum) === artifact.checksum)
  )
}

export function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

function hasTrustedTaskLifecycleLogEntryFields(record: Record<string, unknown>): boolean {
  return Object.keys(record).every((key) => (
    key === 'id' || key === 'ts' || key === 'level' || key === 'source' || key === 'message' || key === 'redacted'
  ))
}

function hasTrustedTaskLifecycleArtifactFields(record: Record<string, unknown>): boolean {
  return Object.keys(record).every((key) => (
    key === 'artifactId' || key === 'label' || key === 'kind' || key === 'createdAt' ||
    key === 'sizeBytes' || key === 'mediaType' || key === 'checksum'
  ))
}

function sanitizeOptionalNonNegativeNumber(input: number | undefined): number | undefined {
  if (typeof input !== 'number' || !Number.isFinite(input)) return undefined
  return Math.max(0, Math.floor(input))
}

function sanitizeExternalTaskItemToken(input: unknown): string {
  if (typeof input !== 'string' || input.trim() !== input) return ''
  const raw = input
  if (!raw || isUnsafeRuntimePairingText(raw)) return ''
  return cleanTaskItemToken(raw) === raw && STABLE_ID_PATTERN.test(raw) ? raw : ''
}

function sanitizeTaskArtifactLabel(input: unknown): string {
  const sanitized = sanitizeTaskLogMessage(input)
  if (!sanitized.message) return 'Artifact'
  if (sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return 'Artifact'
  return sanitized.message
}

function sanitizeTaskArtifactMediaType(input: unknown): string | undefined {
  const sanitized = sanitizeTaskLogMessage(input)
  const value = sanitized.message
  if (!value || sanitized.redacted || isUnsafeArtifactMetadataText(value, true)) return undefined
  return /^[a-z0-9][a-z0-9.+-]{0,80}\/[a-z0-9][a-z0-9.+-]{0,80}(?:;\s*[a-z0-9_.+-]{1,40}=[a-z0-9_.+-]{1,80}){0,4}$/i.test(value)
    ? value
    : undefined
}

function sanitizeTaskArtifactChecksum(input: unknown): string | undefined {
  const sanitized = sanitizeTaskLogMessage(input)
  const value = sanitized.message
  if (!value || sanitized.redacted || isUnsafeArtifactMetadataText(value, false)) return undefined
  return /^[a-z0-9][a-z0-9_.:+~=-]{0,159}$/i.test(value) ? value : undefined
}

function sanitizeTaskLogSource(input: unknown, fallback: string): { source: string; redacted: boolean } {
  const sanitized = sanitizeTaskLogMessage(input)
  const fallbackSource = cleanTaskItemToken(fallback) || 'runtime'
  if (!sanitized.message) return { source: fallbackSource, redacted: false }
  if (sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return { source: fallbackSource, redacted: true }
  return {
    source: cleanTaskItemToken(sanitized.message) || fallbackSource,
    redacted: sanitized.redacted,
  }
}

function isUnsafeArtifactMetadataText(input: string, allowSlash: boolean): boolean {
  return (
    /(?:^|[/?&\s])(api[-_]?key|token|secret|password|authorization|credential)(?:\s*[:=]|[/?&=]|$)/i.test(input) ||
    /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}/i.test(input) ||
    (!allowSlash && /[\\/]/.test(input)) || /:\/\//.test(input) ||
    /(?:^|\s)(?:islemind|node|npm|bun|pnpm|npx|git|python|python3|sh|bash|pwsh|cmd)\s/i.test(input) ||
    /[&|`$]/.test(input)
  )
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : undefined
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
