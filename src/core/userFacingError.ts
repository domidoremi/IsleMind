/**
 * Localized error presentation primitives.
 *
 * User-facing error copy must follow the selected app language. Upstream provider
 * payloads and internal invariant messages are English by construction, so they are
 * demoted to a parenthesized detail behind a localized sentence instead of being
 * surfaced as the whole message. Translation is injected so this stays pure.
 */

export const USER_FACING_ERROR_DETAIL_LIMIT = 240

/** Minimal shape shared by the React (`t`) and service (`st`) translators. */
export type UserFacingErrorTranslate = (key: string) => string

export const USER_FACING_ERROR_UNKNOWN_KEY = 'error.unknownError'

const USER_FACING_ERROR_CODE_TITLE_NAMESPACE = 'messageBubble.error'
const USER_FACING_ERROR_CODE_DESCRIPTION_NAMESPACE = 'messageBubble.errorDescription'

/** Trailing `(detail)` line written by `composeUserFacingError`. */
const COMPOSED_USER_FACING_ERROR_DETAIL = /\n\((.+)\)$/

/** Error codes that have localized copy in every resource bundle. */
const USER_FACING_ERROR_CODES = [
  'missing_key',
  'disabled_provider',
  'credential_mismatch',
  'bad_auth',
  'bad_base_url',
  'model_unavailable',
  'models_endpoint_unavailable',
  'empty_models',
  'network_error',
  'timeout',
  'rate_limited',
  'max_tokens_exceeded',
  'provider_conformance_blocked',
] as const

export type UserFacingErrorCode = (typeof USER_FACING_ERROR_CODES)[number]

export function isUserFacingErrorCode(code: unknown): code is UserFacingErrorCode {
  return typeof code === 'string' && (USER_FACING_ERROR_CODES as readonly string[]).includes(code)
}

/** Resolves the localized headline/description key for a provider or chat error code. */
export function userFacingErrorCodeKey(code: unknown, kind: 'title' | 'description' = 'title'): string {
  const namespace = kind === 'title'
    ? USER_FACING_ERROR_CODE_TITLE_NAMESPACE
    : USER_FACING_ERROR_CODE_DESCRIPTION_NAMESPACE
  return `${namespace}.${isUserFacingErrorCode(code) ? code : 'default'}`
}

/** Reads the raw technical detail out of an unknown throw value. */
export function extractUserFacingErrorDetail(error: unknown): string {
  if (error === null || error === undefined) return ''
  if (error instanceof Error) return normalizeDetail(error.message)
  if (typeof error === 'string') return normalizeDetail(error)
  if (typeof error === 'number' || typeof error === 'boolean') return String(error)
  return normalizeDetail(safeStringify(error))
}

/**
 * Joins a localized sentence with untranslatable technical detail.
 * The detail is dropped when it is empty, opaque, or already covered by the sentence.
 */
export function composeUserFacingError(message: string, detail?: string): string {
  const headline = (message ?? '').trim()
  const clamped = clampDetail(detail)
  if (!clamped) return headline
  if (!headline) return clamped
  if (headline === clamped || headline.includes(clamped)) return headline
  return `${headline}\n(${clamped})`
}

/**
 * Parenthesized technical detail for a UI slot whose headline is already localized
 * (a toast title, a field label). Empty when there is nothing worth showing, which
 * every renderer treats as "omit the line".
 */
export function userFacingErrorDetail(error: unknown): string {
  const detail = clampDetail(extractUserFacingErrorDetail(error))
  return detail ? `(${detail})` : ''
}

/**
 * Rebuilds a stored error sentence in the language that is selected right now.
 *
 * A failed reply persists the sentence that was rendered when it failed, so replaying
 * it verbatim would keep speaking the language of that moment. A known code carries the
 * whole localized meaning, so its stale sentence is replaced outright and only the
 * parenthesized upstream detail survives. An unknown code has no copy to rebuild from,
 * so the stale text is demoted to detail instead of being discarded.
 */
export function relocalizeUserFacingError(
  content: string,
  code: unknown,
  translate: UserFacingErrorTranslate,
): string {
  const stored = (content ?? '').trim()
  const envelopeDetail = COMPOSED_USER_FACING_ERROR_DETAIL.exec(stored)?.[1]
  const headline = translateUserFacingCopy(translate, userFacingErrorCodeKey(code))
  if (!headline) return stored
  const guidance = translateUserFacingCopy(translate, userFacingErrorCodeKey(code, 'description'))
  return composeUserFacingError(
    guidance ? `${headline}\n${guidance}` : headline,
    envelopeDetail ?? (isUserFacingErrorCode(code) ? '' : stored),
  )
}

/** Localized sentence for an unknown throw value, with its raw detail appended. */
export function describeUserFacingError(
  error: unknown,
  translate: UserFacingErrorTranslate,
  options: { headlineKey?: string } = {},
): string {
  return composeUserFacingError(
    translate(options.headlineKey ?? USER_FACING_ERROR_UNKNOWN_KEY),
    extractUserFacingErrorDetail(error),
  )
}

/** Reads localized copy, treating a missing bundle entry (the key echoed back) as absent. */
function translateUserFacingCopy(translate: UserFacingErrorTranslate, key: string): string {
  const copy = translate(key)?.trim() ?? ''
  return copy === key ? '' : copy
}

function clampDetail(detail?: string): string {
  const normalized = normalizeDetail(detail ?? '')
  if (!normalized) return ''
  return normalized.length > USER_FACING_ERROR_DETAIL_LIMIT
    ? `${normalized.slice(0, USER_FACING_ERROR_DETAIL_LIMIT - 1).trimEnd()}…`
    : normalized
}

function normalizeDetail(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  if (!collapsed || collapsed === '[object Object]' || collapsed === 'undefined' || collapsed === 'null') return ''
  return collapsed
}

function safeStringify(value: unknown): string {
  try {
    return String(value)
  } catch {
    return ''
  }
}
