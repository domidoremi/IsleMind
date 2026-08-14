const STABLE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,127}$/
const TEXT_LIMIT = 420

export function cleanText(input: unknown): string {
  return typeof input === 'string' ? input.trim().slice(0, TEXT_LIMIT) : ''
}

export function optionalText(input: unknown): string | undefined {
  const value = cleanText(input)
  return value || undefined
}

export function cleanTaskItemToken(input: string | undefined): string {
  return cleanText(input)
    .replace(/[^a-z0-9_.:-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128)
    .replace(/^-+|-+$/g, '')
}

export function sanitizeList(input: unknown): unknown[] {
  return Array.isArray(input) ? input.slice(0, 80) : []
}

export function uniqueCleanList(input: readonly string[] | undefined): string[] {
  return Array.from(new Set((input ?? []).map(cleanText).filter(Boolean)))
}

export function uniqueTypedList<T extends string>(input: readonly T[], allowed: readonly T[]): T[] {
  return Array.from(new Set(input.filter((item) => allowed.includes(item))))
}

export function sanitizeOptionalNonNegativeNumber(input: number | undefined): number | undefined {
  if (typeof input !== 'number' || !Number.isFinite(input)) return undefined
  return Math.max(0, Math.floor(input))
}

export function sanitizeNonNegativeCount(input: unknown): number {
  return sanitizeOptionalNonNegativeNumber(typeof input === 'number' ? input : undefined) ?? 0
}

export function isNonNegativeInteger(input: unknown): input is number {
  return typeof input === 'number' && Number.isInteger(input) && input >= 0
}

export function sanitizeOptionalTimestamp(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined
}

export function sanitizeEndpointOrigin(input: unknown): string | undefined {
  const raw = cleanText(input)
  if (!raw) return undefined
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined
  } catch {
    return undefined
  }
}

export function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : undefined
}

export function isStableId(value: string | undefined): boolean {
  return typeof value === 'string' && STABLE_ID_PATTERN.test(value)
}
