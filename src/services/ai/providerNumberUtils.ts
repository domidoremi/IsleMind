export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.isFinite(value) ? Math.trunc(value!) : fallback
  return Math.max(min, Math.min(max, parsed))
}
