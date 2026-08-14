import { sanitizeTaskPayloadKey, sanitizeToolchainEndpointReference } from './endpointPayloadPolicy'
import { isUnsafeRuntimePairingText } from './textSafety'
import {
  TOOLCHAIN_MANIFEST_SCHEMA,
  TOOLCHAIN_PERMISSIONS,
  TOOLCHAIN_RUNTIME_SUPPORT_VALUES,
  TOOLCHAIN_TOOL_KINDS,
} from './toolchainContracts'
import {
  TOOLCHAIN_RUNTIME_CAPABILITIES,
  TOOLCHAIN_RUNTIME_KINDS,
  TOOLCHAIN_TRANSPORTS,
} from './toolchainRuntimeTrust'

const MANIFEST_SCHEMA = TOOLCHAIN_MANIFEST_SCHEMA
const INVALID_MANIFEST_SCHEMA = 'islemind.toolchain-manifest.invalid'
const RUNTIME_KINDS = TOOLCHAIN_RUNTIME_KINDS
const RUNTIME_SUPPORT_VALUES = TOOLCHAIN_RUNTIME_SUPPORT_VALUES
const TRANSPORTS = TOOLCHAIN_TRANSPORTS
const TOOL_KINDS = TOOLCHAIN_TOOL_KINDS
const PERMISSIONS = TOOLCHAIN_PERMISSIONS
const RUNTIME_CAPABILITIES = TOOLCHAIN_RUNTIME_CAPABILITIES

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const STABLE_COMMAND_REFERENCE_PATTERN = /^islemind(?:[.:][a-z0-9][a-z0-9_-]*){1,8}$/i
const SENSITIVE_COMMAND_REFERENCE_SEGMENT_PATTERN = /^(?:api[-_]?key|access[-_]?token|refresh[-_]?token|auth|authorization|bearer|key|token|secret|password|credential)$/i
const STABLE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,127}$/
const TEXT_LIMIT = 420

export type AdmittedToolKind = typeof TOOL_KINDS[number]
export type AdmittedToolPermission = typeof PERMISSIONS[number]
export type AdmittedRuntimeCapability = typeof RUNTIME_CAPABILITIES[number]
export type AdmittedRuntimeKind = typeof RUNTIME_KINDS[number]
export type AdmittedRuntimeSupport = typeof RUNTIME_SUPPORT_VALUES[number]
export type AdmittedToolTransport = typeof TRANSPORTS[number]

export interface AdmittedToolEntry {
  type: AdmittedToolKind
  command?: string
  action?: string
  mcpToolName?: string
  transport?: AdmittedToolTransport
  endpoint?: string
  executor?: 'app' | 'cli' | 'mcp' | 'remote'
}

export interface AdmittedToolManifest {
  schema: typeof MANIFEST_SCHEMA
  id: string
  title: string
  kind: AdmittedToolKind
  version: string
  description?: string
  runtimes: Record<AdmittedRuntimeKind, AdmittedRuntimeSupport>
  permissions: AdmittedToolPermission[]
  entry: AdmittedToolEntry
  requires?: {
    capabilities?: AdmittedRuntimeCapability[]
    dependencies?: Record<string, string>
    memoryMb?: number
  }
  inputs?: Record<string, { type: 'string' | 'path' | 'boolean' | 'number' | 'json'; required?: boolean }>
  outputs?: Record<string, { type: 'json' | 'text' | 'artifact' | 'log' }>
  diagnosticHint?: string
}

export interface ToolManifestAdmissionResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  sanitized: AdmittedToolManifest
}

export function validateToolchainManifest(input: unknown): ToolManifestAdmissionResult {
  const errors: string[] = []
  const warnings: string[] = []
  const record = asRecord(input) ?? {}
  const entryRecord = asRecord(record.entry) ?? {}
  const rawSchema = typeof record.schema === 'string' ? record.schema : ''
  const rawId = typeof record.id === 'string' ? record.id : ''
  const rawKind = typeof record.kind === 'string' ? record.kind : ''
  const rawVersion = typeof record.version === 'string' && record.version ? record.version : '0.0.0'
  const rawEntryType = typeof entryRecord.type === 'string' ? entryRecord.type : ''
  const sanitized = sanitizeToolchainManifest(input, warnings)
  if (rawSchema !== MANIFEST_SCHEMA) errors.push('schema must be islemind.toolchain-manifest.v0.')
  if (sanitizeManifestId(rawId) !== rawId) errors.push('id must be a stable safe tool id.')
  if (!sanitized.title) errors.push('title is required.')
  if (!isToolKind(rawKind)) errors.push('kind is invalid.')
  if (!VERSION_PATTERN.test(rawVersion) || isUnsafeRuntimePairingText(rawVersion)) errors.push('version must be semver.')
  if (!isToolKind(rawEntryType)) errors.push('entry.type is invalid.')
  if (sanitized.entry.type === 'cli' && !sanitized.entry.command) errors.push('cli entries require command.')
  if (sanitized.entry.type !== 'cli' && sanitized.entry.executor === 'cli' && !sanitized.entry.command) {
    errors.push(`${sanitized.entry.type} entries using cli executor require command.`)
  }
  if (sanitized.entry.type === 'app-action') {
    if (!sanitized.entry.action) errors.push('app-action entries require action.')
    else if (!sanitizeAppActionReference(sanitized.entry.action)) errors.push('app-action entries require a stable safe action reference.')
  }
  if (sanitized.entry.type === 'mcp' && !sanitized.entry.transport) errors.push('mcp entries require transport.')
  if (sanitized.entry.type === 'mcp' && sanitized.entry.executor === 'mcp' && !sanitized.entry.mcpToolName) {
    errors.push('mcp executor entries require tool name.')
  }
  if (sanitized.entry.type === 'skill' && !sanitized.entry.executor) errors.push('skill entries require executor.')
  if (!Object.values(sanitized.runtimes).some((value) => value === 'supported')) errors.push('at least one runtime must be supported.')
  for (const permission of sanitized.permissions) {
    if (!PERMISSIONS.includes(permission)) errors.push(`permissions contains invalid value ${permission}.`)
  }
  for (const capability of sanitized.requires?.capabilities ?? []) {
    if (!RUNTIME_CAPABILITIES.includes(capability)) errors.push(`requires.capabilities contains invalid value ${capability}.`)
  }
  if (sanitized.entry.type === 'cli' && sanitized.runtimes['android-app'] === 'supported') {
    errors.push('android-app cannot directly execute cli entries.')
  }
  if (sanitized.entry.transport === 'stdio' && sanitized.runtimes['android-app'] === 'supported') {
    errors.push('android-app cannot directly host stdio MCP transport.')
  }
  if (warnings.includes('requires.dependencies contained invalid entries.')) {
    errors.push('requires.dependencies contains invalid dependency reference.')
  }
  if (sanitized.permissions.includes('secrets.use') && !(sanitized.requires?.capabilities ?? []).includes('secrets')) {
    warnings.push('secrets.use tools should declare the secrets runtime capability.')
  }
  return { ok: errors.length === 0, errors, warnings, sanitized }
}

export function sanitizeToolchainManifest(input: unknown, warnings: string[]): AdmittedToolManifest {
  const record = asRecord(input) ?? {}
  return {
    schema: record.schema === MANIFEST_SCHEMA ? MANIFEST_SCHEMA : INVALID_MANIFEST_SCHEMA as typeof MANIFEST_SCHEMA,
    id: sanitizeManifestId(record.id),
    title: sanitizeManifestPublicText(record.title) ?? '',
    kind: isToolKind(record.kind) ? record.kind : 'cli',
    version: sanitizeManifestVersion(record.version),
    description: sanitizeManifestPublicText(record.description),
    runtimes: sanitizeRuntimeSupport(record.runtimes),
    permissions: sanitizePermissionList(record.permissions),
    entry: sanitizeEntry(record.entry),
    requires: sanitizeRequires(record.requires, warnings),
    inputs: sanitizeIoMap(record.inputs, ['string', 'path', 'boolean', 'number', 'json']),
    outputs: sanitizeIoMap(record.outputs, ['json', 'text', 'artifact', 'log']),
    diagnosticHint: sanitizeManifestPublicText(record.diagnosticHint),
  }
}

export function sanitizePermissionList(input: unknown): AdmittedToolPermission[] {
  return Array.from(new Set(sanitizeList(input).filter(isPermission)))
}

export function sanitizeCapabilityList(input: unknown): AdmittedRuntimeCapability[] {
  return Array.from(new Set(sanitizeList(input).filter(isRuntimeCapability)))
}

export function sanitizeAppActionReference(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.trim() !== input) return undefined
  const value = input
  if (!value || isUnsafeRuntimePairingText(value)) return undefined
  return cleanTaskItemToken(value) === value ? value : undefined
}

export function sanitizeToolCommandReference(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.trim() !== input) return undefined
  const value = input
  if (!value) return undefined
  if (
    /[\\/]|:\/\//.test(value) ||
    /[;&|`$<>]/.test(value) ||
    /(?:^|[?&\s])(?:api[-_]?key|token|secret|password|authorization|credential)(?:\s*[:=]|[?&=]|$)/i.test(value) ||
    /sk-[A-Za-z0-9_-]{8,}/i.test(value)
  ) return undefined
  return isStableToolCommandReference(value) ? value : undefined
}

export function sanitizeMcpToolReference(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.trim() !== input) return undefined
  const value = input
  if (!value || isUnsafeRuntimePairingText(value)) return undefined
  return cleanTaskItemToken(value) === value ? value : undefined
}

function isStableToolCommandReference(input: string): boolean {
  if (!STABLE_COMMAND_REFERENCE_PATTERN.test(input)) return false
  const segments = input.split(/[.:]/).slice(1)
  return segments.every((segment) => !SENSITIVE_COMMAND_REFERENCE_SEGMENT_PATTERN.test(segment))
}

function sanitizeManifestPublicText(input: unknown): string | undefined {
  const sanitized = sanitizeTaskLogMessage(input)
  if (!sanitized.message || sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return undefined
  return sanitized.message
}

function sanitizeRuntimeSupport(input: unknown): Record<AdmittedRuntimeKind, AdmittedRuntimeSupport> {
  const record = asRecord(input) ?? {}
  return {
    'android-app': sanitizeSupport(record['android-app']) ?? 'unsupported',
    termux: sanitizeSupport(record.termux) ?? 'unsupported',
    desktop: sanitizeSupport(record.desktop) ?? 'unsupported',
    remote: sanitizeSupport(record.remote) ?? 'unsupported',
  }
}

function sanitizeSupport(input: unknown): AdmittedRuntimeSupport | undefined {
  return RUNTIME_SUPPORT_VALUES.includes(input as AdmittedRuntimeSupport) ? input as AdmittedRuntimeSupport : undefined
}

function sanitizeEntry(input: unknown): AdmittedToolEntry {
  const record = asRecord(input) ?? {}
  const executor = typeof record.executor === 'string' ? record.executor : ''
  return {
    type: isToolKind(record.type) ? record.type : 'cli',
    command: sanitizeToolCommandReference(record.command),
    action: sanitizeAppActionReference(record.action),
    mcpToolName: sanitizeMcpToolReference(record.mcpToolName),
    transport: TRANSPORTS.includes(record.transport as AdmittedToolTransport) ? record.transport as AdmittedToolTransport : undefined,
    endpoint: sanitizeToolchainEndpointReference(record.endpoint),
    executor: ['app', 'cli', 'mcp', 'remote'].includes(executor) ? executor as AdmittedToolEntry['executor'] : undefined,
  }
}

function sanitizeManifestId(input: unknown): string {
  const raw = typeof input === 'string' ? input : ''
  if (!raw || isUnsafeRuntimePairingText(raw)) return 'tool-untrusted'
  return sanitizeExactStableIdToken(raw) ?? 'tool-untrusted'
}

function sanitizeManifestVersion(input: unknown): string {
  const version = typeof input === 'string' && input.trim() === input && input ? input : '0.0.0'
  return VERSION_PATTERN.test(version) && !isUnsafeRuntimePairingText(version) ? version : '0.0.0'
}

function sanitizeRequires(input: unknown, warnings: string[]): AdmittedToolManifest['requires'] | undefined {
  const record = asRecord(input)
  if (!record) return undefined
  const capabilities = sanitizeCapabilityList(record.capabilities)
  const dependencies = sanitizeDependencyMap(record.dependencies, warnings)
  const memoryMb = typeof record.memoryMb === 'number' && Number.isFinite(record.memoryMb) ? Math.max(0, Math.round(record.memoryMb)) : undefined
  return { capabilities, dependencies, memoryMb }
}

function sanitizeIoMap<T extends string>(
  input: unknown,
  allowedTypes: readonly T[],
): Record<string, { type: T; required?: boolean }> | undefined {
  const record = asRecord(input)
  if (!record) return undefined
  const output: Record<string, { type: T; required?: boolean }> = {}
  for (const [key, value] of Object.entries(record).slice(0, 24)) {
    const child = asRecord(value)
    if (!child) continue
    const type = allowedTypes.includes(child.type as T) ? child.type as T : undefined
    if (!type) continue
    const ioKey = sanitizeManifestIoKey(key)
    if (!ioKey) continue
    output[ioKey] = { type, required: child.required === true }
  }
  return Object.keys(output).length ? output : undefined
}

function sanitizeDependencyMap(input: unknown, warnings?: string[]): Record<string, string> {
  const record = asRecord(input)
  if (!record) return {}
  const entries = Object.entries(record)
  if (entries.length > 12) warnings?.push('requires.dependencies was truncated.')
  let invalid = false
  const dependencies: Record<string, string> = {}
  for (const [key, value] of entries.slice(0, 12)) {
    if (typeof value !== 'string' || key.trim() !== key || value.trim() !== value) {
      invalid = true
      continue
    }
    const valid = isSafeDependencyReference(key, value)
    if (!valid && (key || value)) invalid = true
    if (valid) dependencies[key] = value
  }
  if (invalid) warnings?.push('requires.dependencies contained invalid entries.')
  return dependencies
}

function isSafeDependencyReference(name: string, range: string): boolean {
  if (!name || !range) return false
  if (isUnsafeRuntimePairingText(name) || isUnsafeRuntimePairingText(range)) return false
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(name) && /^(?:>=)?[A-Za-z0-9_.:+~-]{1,64}$/.test(range)
}

function sanitizeManifestIoKey(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.trim() !== input) return undefined
  const sanitized = sanitizeTaskLogMessage(input)
  if (!sanitized.message || sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return undefined
  return sanitizeTaskPayloadKey(sanitized.message)
}

function isPermission(value: unknown): value is AdmittedToolPermission {
  return PERMISSIONS.includes(value as AdmittedToolPermission)
}

function isRuntimeCapability(value: unknown): value is AdmittedRuntimeCapability {
  return RUNTIME_CAPABILITIES.includes(value as AdmittedRuntimeCapability)
}

function isToolKind(value: unknown): value is AdmittedToolKind {
  return TOOL_KINDS.includes(value as AdmittedToolKind)
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : undefined
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

function sanitizeList(input: unknown): unknown[] {
  return Array.isArray(input) ? input.slice(0, 80) : []
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

function sanitizeExactStableIdToken(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.trim() !== input) return undefined
  const token = input
  if (
    !token ||
    cleanTaskItemToken(token) !== token ||
    !STABLE_ID_PATTERN.test(token) ||
    /(?:^|[._:-])sk-[A-Za-z0-9_-]{8,}/i.test(token) ||
    /(?:^|[._:-])(?:api[-_]?key|token|secret|password|authorization|credential)(?:[._:-]|$)/i.test(token)
  ) return undefined
  return token
}
