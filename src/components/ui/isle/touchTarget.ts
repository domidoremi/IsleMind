export interface TouchTargetStyleDimensions {
  height?: unknown
  minHeight?: unknown
}

/**
 * Keep a control's physical target accessible without discarding a larger
 * layout requested by a feature surface.
 */
export function resolveMinimumTouchTargetHeight(
  baseHeight: number,
  style: TouchTargetStyleDimensions | null | undefined,
  minimumTarget: number,
): number {
  const requestedHeight = typeof style?.height === 'number' ? style.height : 0
  const requestedMinimum = typeof style?.minHeight === 'number' ? style.minHeight : 0
  return Math.max(baseHeight, minimumTarget, requestedHeight, requestedMinimum)
}
