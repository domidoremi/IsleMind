export type NumericDraftKind = 'decimal' | 'integer'

export interface NumericDraftRange {
  min: number
  max: number
}

export function acceptNumericDraft(
  current: string,
  next: string,
  kind: NumericDraftKind,
): string {
  const pattern = kind === 'integer' ? /^\d*$/ : /^\d*(?:\.\d*)?$/
  return pattern.test(next) ? next : current
}

export function commitNumericDraft(
  draft: string,
  range: NumericDraftRange,
  kind: NumericDraftKind,
): number | undefined {
  const normalized = draft.trim()
  if (!normalized || normalized === '.') return undefined
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return undefined
  const clamped = Math.max(range.min, Math.min(range.max, parsed))
  return kind === 'integer' ? Math.floor(clamped) : clamped
}
