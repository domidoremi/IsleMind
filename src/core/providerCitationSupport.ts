import { sha256Hex } from './contentDigest'

export const PROVIDER_CITATION_SUPPORT_SCHEMA = 'islemind.provider-citation-support.v1'
export const PROVIDER_CITATION_SUPPORT_LIMITS = {
  answerChars: 262_144,
  passages: 16,
  passageChars: 2_048,
  totalPassageChars: 8_192,
} as const

/** Provider-local UTF-8 byte ranges, never offsets into flattened/rendered Chat text. */
export interface ProviderCitationPassage {
  text: string
  partIndex: number
  startByte: number
  endByte: number
}

/** Untrusted provider declarations, not a factuality verdict or source-read authority. */
export interface ProviderCitationSupport {
  schema: typeof PROVIDER_CITATION_SUPPORT_SCHEMA
  provider: 'google'
  answerSha256: string
  passages: ProviderCitationPassage[]
}

export function parseProviderCitationPassage(value: unknown): ProviderCitationPassage | undefined {
  const record = asRecord(value)
  if (!record || typeof record.text !== 'string' || !record.text.trim() ||
    record.text.length > PROVIDER_CITATION_SUPPORT_LIMITS.passageChars ||
    !isIndex(record.partIndex) || !isIndex(record.startByte) || !isIndex(record.endByte) ||
    record.endByte <= record.startByte ||
    record.endByte - record.startByte !== utf8Length(record.text)) return undefined
  return { text: record.text, partIndex: record.partIndex, startByte: record.startByte, endByte: record.endByte }
}

/** Validate optional persisted/imported metadata before presenting it. Unknown versions stay unknown. */
export function parseProviderCitationSupport(value: unknown): ProviderCitationSupport | undefined {
  const record = asRecord(value)
  if (!record || record.schema !== PROVIDER_CITATION_SUPPORT_SCHEMA || record.provider !== 'google' ||
    typeof record.answerSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.answerSha256) ||
    !Array.isArray(record.passages) || !record.passages.length ||
    record.passages.length > PROVIDER_CITATION_SUPPORT_LIMITS.passages) return undefined
  const passages: ProviderCitationPassage[] = []
  let chars = 0
  for (const value of record.passages) {
    const passage = parseProviderCitationPassage(value)
    if (!passage) return undefined
    chars += passage.text.length
    if (chars > PROVIDER_CITATION_SUPPORT_LIMITS.totalPassageChars) return undefined
    passages.push(passage)
  }
  return { schema: PROVIDER_CITATION_SUPPORT_SCHEMA, provider: 'google', answerSha256: record.answerSha256, passages }
}

/** Hash one final answer at most once, even when it has many captured sources. */
export function createProviderCitationSupportBinder(answer: string) {
  const canBind = Boolean(answer) && answer.length <= PROVIDER_CITATION_SUPPORT_LIMITS.answerChars && utf8Length(answer) >= 0
  let answerSha256: string | undefined
  return (passages: readonly ProviderCitationPassage[]): ProviderCitationSupport | undefined => {
    if (!canBind) return undefined
    const retained = boundedPassages(passages.filter((passage) => answer.includes(passage.text)))
    if (!retained.length) return undefined
    answerSha256 ??= sha256Hex(answer)
    return { schema: PROVIDER_CITATION_SUPPORT_SCHEMA, provider: 'google', answerSha256, passages: retained }
  }
}

export function isProviderCitationSupportCurrent(support: ProviderCitationSupport, answer: string): boolean {
  return answer.length <= PROVIDER_CITATION_SUPPORT_LIMITS.answerChars &&
    utf8Length(answer) >= 0 &&
    support.answerSha256 === sha256Hex(answer) && support.passages.every((passage) => answer.includes(passage.text))
}

/** One bounded snapshot per source. A later provider answer replaces, never rebinds, the old one. */
export function mergeProviderCitationSupport(base: unknown, extra: unknown): ProviderCitationSupport | undefined {
  const first = parseProviderCitationSupport(base)
  const next = parseProviderCitationSupport(extra)
  if (!first) return next
  if (!next) return first
  if (first.answerSha256 !== next.answerSha256) return next
  return { ...first, passages: boundedPassages([...first.passages, ...next.passages]) }
}

function boundedPassages(values: readonly ProviderCitationPassage[]): ProviderCitationPassage[] {
  const result: ProviderCitationPassage[] = []
  const seen = new Set<string>()
  let chars = 0
  for (const value of values) {
    if (result.length >= PROVIDER_CITATION_SUPPORT_LIMITS.passages) break
    const passage = parseProviderCitationPassage(value)
    if (!passage || chars + passage.text.length > PROVIDER_CITATION_SUPPORT_LIMITS.totalPassageChars) continue
    const key = JSON.stringify(passage)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(passage)
    chars += passage.text.length
  }
  return result
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 0x7fffffff
}

function utf8Length(text: string): number {
  let length = 0
  for (const character of text) {
    const point = character.codePointAt(0)!
    // An unpaired surrogate is not valid provider UTF-8 evidence.
    if (point >= 0xd800 && point <= 0xdfff) return -1
    length += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4
  }
  return length
}
