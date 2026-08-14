import type {
  BuiltInCapabilityAdmissionDecision,
  BuiltInCapabilityAdmissionRequest,
  BuiltInCapabilityOutcomeCode,
} from './builtInCapabilityContracts'

export const BUILT_IN_FILE_READ_DEFAULT_BYTES = 64 * 1024
export const BUILT_IN_FILE_READ_MAX_BYTES = 256 * 1024
export const BUILT_IN_FILE_EDIT_MAX_BYTES = 256 * 1024
export const BUILT_IN_WEB_SEARCH_MAX_RESULTS = 10
export const BUILT_IN_WEB_CRAWL_MAX_DEPTH = 3
export const BUILT_IN_WEB_CRAWL_MAX_PAGES = 12
export const BUILT_IN_WEB_CRAWL_MAX_BYTES = 2 * 1024 * 1024
export const BUILT_IN_WEB_CRAWL_PAGE_MAX_BYTES = 512 * 1024
export const BUILT_IN_WEB_REDIRECT_LIMIT = 3
export const BUILT_IN_OPERATION_TIMEOUT_MIN_MS = 1_000
export const BUILT_IN_OPERATION_TIMEOUT_MAX_MS = 15_000

const WORKSPACE_PATH_LIMIT = 512
const REVISION_LIMIT = 256
const IDEMPOTENCY_KEY_LIMIT = 512
const SAFE_ATTESTATION_TOKEN = /^[A-Za-z0-9._:-]+$/
const WEB_URL_LIMIT = 2_048
const WEB_QUERY_LIMIT = 500
const WEB_TEXT_LIMIT = 12_000
const WINDOWS_DEVICE_PATH_SEGMENT = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i

const TEXT_FILE_MIME_TYPES = new Set([
  'application/ecmascript',
  'application/graphql',
  'application/javascript',
  'application/json',
  'application/ld+json',
  'application/sql',
  'application/toml',
  'application/typescript',
  'application/x-httpd-php',
  'application/x-javascript',
  'application/x-ndjson',
  'application/x-sh',
  'application/x-yaml',
  'application/xhtml+xml',
  'application/xml',
  'application/yaml',
  'image/svg+xml',
])

const CRAWL_MIME_TYPES = new Set([
  'application/xhtml+xml',
  'text/html',
  'text/plain',
])

const PRIVATE_HOST_SUFFIXES = [
  '.home',
  '.internal',
  '.intranet',
  '.lan',
  '.local',
  '.localhost',
]

export class BuiltInCapabilityPolicyError extends Error {
  constructor(
    readonly code: Exclude<BuiltInCapabilityOutcomeCode, 'completed'>,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'BuiltInCapabilityPolicyError'
  }
}

export function assertBuiltInAdmission(
  request: BuiltInCapabilityAdmissionRequest,
  decision: BuiltInCapabilityAdmissionDecision,
): Extract<BuiltInCapabilityAdmissionDecision, { status: 'allowed' }> {
  if (decision.status !== 'allowed') {
    if (decision.status === 'confirmation_required') {
      throw new BuiltInCapabilityPolicyError(
        'confirmation_required',
        cleanPublicMessage(decision.reason) || 'This tool requires visible user confirmation.',
        true,
      )
    }
    if (decision.status === 'permission_required') {
      throw new BuiltInCapabilityPolicyError(
        'permission_required',
        cleanPublicMessage(decision.reason) || 'This tool requires a scoped permission grant.',
        true,
      )
    }
    if (decision.status === 'unavailable') {
      throw new BuiltInCapabilityPolicyError(
        'capability_unavailable',
        cleanPublicMessage(decision.reason) || 'The trusted task admission boundary is unavailable.',
        true,
      )
    }
    throw new BuiltInCapabilityPolicyError(
      'policy_denied',
      cleanPublicMessage(decision.reason) || 'Tool execution was denied by policy.',
    )
  }
  if (decision.taskId !== request.taskId || decision.toolId !== request.toolId) {
    throw new BuiltInCapabilityPolicyError(
      'policy_denied',
      'Task admission evidence does not match this tool execution.',
    )
  }
  const grants = new Set(decision.grantedPermissions)
  if (!request.requiredPermissions.every((permission) => grants.has(permission))) {
    throw new BuiltInCapabilityPolicyError(
      'permission_required',
      'Task admission is missing a required scoped permission.',
      true,
    )
  }
  if (request.requiresConfirmation) {
    if (!decision.confirmed || !isSafeAttestationToken(decision.confirmationTokenDigest)) {
      throw new BuiltInCapabilityPolicyError(
        'confirmation_required',
        'A current visible confirmation is required before this tool can change data.',
        true,
      )
    }
    if (!isSafeIdempotencyKey(decision.idempotencyKey)) {
      throw new BuiltInCapabilityPolicyError(
        'idempotency_required',
        'A trusted idempotency key is required before this tool can change data.',
        true,
      )
    }
  }
  return decision
}

export function normalizeWorkspaceRelativePath(input: unknown): string {
  if (typeof input !== 'string' || !input || input.length > WORKSPACE_PATH_LIMIT) {
    throw new BuiltInCapabilityPolicyError('schema_invalid', 'A bounded workspace-relative path is required.')
  }
  if (input.trim() !== input || /[\u0000-\u001f\u007f]/.test(input)) {
    throw new BuiltInCapabilityPolicyError('path_outside_workspace', 'The file path is not a safe workspace-relative path.')
  }
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{1,2}|~(?:[\\/]|$)|[A-Za-z][A-Za-z0-9+.-]*:)/.test(input)) {
    throw new BuiltInCapabilityPolicyError('path_outside_workspace', 'Absolute paths and URIs are outside the workspace.')
  }
  if (/[%](?:2e|2f|5c)/i.test(input) || /[\u2044\u2215\u29f8\uff0f\uff3c]/u.test(input)) {
    throw new BuiltInCapabilityPolicyError('path_outside_workspace', 'Encoded or alternate path separators are not allowed.')
  }
  const segments = input.replace(/\\/g, '/').split('/')
  const normalized: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    let decoded = segment
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      throw new BuiltInCapabilityPolicyError('path_outside_workspace', 'The file path contains invalid escaping.')
    }
    if (
      decoded === '.' || decoded === '..' ||
      decoded.includes('/') || decoded.includes('\\') ||
      /[\u0000-\u001f\u007f]/.test(decoded)
    ) {
      throw new BuiltInCapabilityPolicyError('path_outside_workspace', 'The file path escapes the workspace.')
    }
    if (decoded.includes(':') || decoded.endsWith('.') || decoded.endsWith(' ') || WINDOWS_DEVICE_PATH_SEGMENT.test(decoded)) {
      throw new BuiltInCapabilityPolicyError(
        'path_outside_workspace',
        'The file path uses a platform alias that cannot be bound to one workspace file.',
      )
    }
    normalized.push(segment)
  }
  if (!normalized.length) {
    throw new BuiltInCapabilityPolicyError('schema_invalid', 'A file path must identify a file inside the workspace.')
  }
  const path = normalized.join('/')
  if (path.length > WORKSPACE_PATH_LIMIT) {
    throw new BuiltInCapabilityPolicyError('schema_invalid', 'The normalized workspace path is too long.')
  }
  return path
}

export function normalizeRevision(input: unknown): string {
  if (
    typeof input !== 'string' || input.trim() !== input || input.length < 8 || input.length > REVISION_LIMIT ||
    !SAFE_ATTESTATION_TOKEN.test(input)
  ) {
    throw new BuiltInCapabilityPolicyError(
      'precondition_required',
      'A current safe file revision is required before editing.',
      true,
    )
  }
  return input
}

export function normalizeMimeType(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.split(';', 1)[0]?.trim().toLowerCase().slice(0, 128) ?? ''
}

export function assertTextFileMimeType(input: unknown): string {
  const mimeType = normalizeMimeType(input)
  if (!mimeType || (!mimeType.startsWith('text/') && !TEXT_FILE_MIME_TYPES.has(mimeType))) {
    throw new BuiltInCapabilityPolicyError(
      'mime_unsupported',
      'This file is not a supported UTF-8 text MIME type.',
    )
  }
  return mimeType
}

export function assertCrawlMimeType(input: unknown): string {
  const mimeType = normalizeMimeType(input)
  if (!CRAWL_MIME_TYPES.has(mimeType)) {
    throw new BuiltInCapabilityPolicyError(
      'mime_unsupported',
      'Web crawl accepts only HTML, XHTML, or plain-text pages.',
    )
  }
  return mimeType
}

export function assertBoundedByteLength(
  input: unknown,
  limit: number,
  label: string,
): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
    throw new BuiltInCapabilityPolicyError('execution_failed', `${label} did not report a valid byte length.`)
  }
  if (input > limit) {
    throw new BuiltInCapabilityPolicyError(
      'size_limit_exceeded',
      `${label} exceeds the ${limit}-byte safety limit.`,
    )
  }
  return input
}

export function utf8ByteLength(input: string): number {
  return new TextEncoder().encode(input).byteLength
}

export function boundedInteger(
  input: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(input)))
}

export function normalizeWebQuery(input: unknown): string {
  if (typeof input !== 'string') {
    throw new BuiltInCapabilityPolicyError('schema_invalid', 'A web search query is required.')
  }
  const query = input.trim().replace(/\s+/g, ' ')
  if (!query || query.length > WEB_QUERY_LIMIT || /[\u0000-\u001f\u007f]/.test(query)) {
    throw new BuiltInCapabilityPolicyError('schema_invalid', 'The web search query is empty or too long.')
  }
  return query
}

export function normalizePublicHttpsUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length > WEB_URL_LIMIT || input.trim() !== input) {
    throw new BuiltInCapabilityPolicyError('network_target_denied', 'A bounded public HTTPS URL is required.')
  }
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new BuiltInCapabilityPolicyError('network_target_denied', 'The web URL is invalid.')
  }
  if (
    parsed.protocol !== 'https:' || parsed.username || parsed.password ||
    (parsed.port && parsed.port !== '443')
  ) {
    throw new BuiltInCapabilityPolicyError(
      'network_target_denied',
      'Web tools allow public HTTPS targets on the standard TLS port only.',
    )
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!hostname || isPrivateHostname(hostname)) {
    throw new BuiltInCapabilityPolicyError(
      'network_target_denied',
      'Loopback, private, link-local, and reserved network targets are blocked.',
    )
  }
  parsed.hash = ''
  return parsed.href
}

export function publicDisplayUrl(input: string): string {
  const parsed = new URL(normalizePublicHttpsUrl(input))
  parsed.username = ''
  parsed.password = ''
  parsed.search = ''
  parsed.hash = ''
  return truncatePublicText(parsed.href, 2_048)
}

export function assertSameOriginUrl(input: string, expectedOrigin: string): string {
  const url = normalizePublicHttpsUrl(input)
  if (new URL(url).origin !== expectedOrigin) {
    throw new BuiltInCapabilityPolicyError(
      'network_target_denied',
      'Web crawl is restricted to the original public origin.',
    )
  }
  return url
}

export function resolveRedirectUrl(currentUrl: string, location: unknown): string {
  if (typeof location !== 'string' || !location.trim() || location.length > WEB_URL_LIMIT) {
    throw new BuiltInCapabilityPolicyError('redirect_denied', 'The web server returned an invalid redirect target.')
  }
  let target: string
  try {
    target = new URL(location, currentUrl).href
  } catch {
    throw new BuiltInCapabilityPolicyError('redirect_denied', 'The web server returned an invalid redirect target.')
  }
  try {
    return normalizePublicHttpsUrl(target)
  } catch {
    throw new BuiltInCapabilityPolicyError(
      'redirect_denied',
      'The web redirect target is outside the trusted public HTTPS boundary.',
    )
  }
}

export function normalizeTimeoutMs(input: unknown): number {
  return boundedInteger(
    input,
    10_000,
    BUILT_IN_OPERATION_TIMEOUT_MIN_MS,
    BUILT_IN_OPERATION_TIMEOUT_MAX_MS,
  )
}

export function truncatePublicText(input: unknown, limit = WEB_TEXT_LIMIT): string {
  if (typeof input !== 'string') return ''
  const value = input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`
}

export function stablePrivateFingerprint(input: string): string {
  let first = 2166136261
  let second = 0x9e3779b9
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    first ^= code
    first = Math.imul(first, 16777619)
    second ^= code + ((second << 6) >>> 0) + (second >>> 2)
    second >>>= 0
  }
  return `${(first >>> 0).toString(36)}${second.toString(36)}`
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof BuiltInCapabilityPolicyError && error.code === 'timed_out'
}

function isSafeAttestationToken(input: unknown): input is string {
  return typeof input === 'string' && input.length >= 8 && input.length <= 256 && SAFE_ATTESTATION_TOKEN.test(input)
}

function isSafeIdempotencyKey(input: unknown): input is string {
  return typeof input === 'string' && input.length >= 8 && input.length <= IDEMPOTENCY_KEY_LIMIT && SAFE_ATTESTATION_TOKEN.test(input)
}

function isPrivateHostname(hostname: string): boolean {
  if (
    hostname === 'localhost' || hostname === 'localhost.localdomain' || hostname.endsWith('.localhost') ||
    PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) return true
  if (isIpv4Address(hostname)) return isReservedIpv4(hostname)
  if (hostname.includes(':')) return isReservedIpv6(hostname)
  return false
}

function isIpv4Address(hostname: string): boolean {
  const parts = hostname.split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isReservedIpv4(hostname: string): boolean {
  const [a, b, c] = hostname.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
}

function isReservedIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (/^fe[89ab]/.test(normalized)) return true
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return mapped ? isReservedIpv4(mapped[1]) : false
}

function cleanPublicMessage(input: unknown): string {
  const value = truncatePublicText(input, 320)
  if (!value) return ''
  return /(?:https?:\/\/|[A-Za-z]:[\\/]|\/(?:Users|home|data|storage|sdcard)\/|api[-_]?key|token|secret|password)/i.test(value)
    ? 'The trusted boundary rejected this tool request.'
    : value
}
