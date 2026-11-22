interface Rect { x: number; y: number; width: number; height: number }
interface Size { width: number; height: number }
interface Insets { top: number; right: number; bottom: number; left: number }

/** Anchor an island menu in the full-screen Modal's usable rectangle. */
export function resolveNativeSelectLayout(trigger: Rect | null, viewport: Size, insets: Insets, panel: Size) {
  const leftEdge = insets.left + 12
  const topEdge = insets.top + 12
  const rightEdge = viewport.width - insets.right - 12
  const bottomEdge = viewport.height - insets.bottom - 12
  const maxWidth = Math.max(1, rightEdge - leftEdge)
  const maxHeight = Math.max(1, bottomEdge - topEdge)
  const width = Math.min(panel.width, maxWidth)
  const height = Math.min(panel.height, maxHeight)
  let left = leftEdge
  let top = topEdge
  if (trigger) {
    left = trigger.x + trigger.width + 6 + width <= rightEdge
      ? trigger.x + trigger.width + 6
      : trigger.x - width - 6
    const below = bottomEdge - trigger.y - trigger.height
    const above = trigger.y - topEdge
    top = below < height && above > below
      ? trigger.y - height - 6
      : below < height || above < height
        ? trigger.y + trigger.height + 6
        : trigger.y + trigger.height / 2 - height / 2
  }
  return {
    left: Math.max(leftEdge, Math.min(left, rightEdge - width)),
    top: Math.max(topEdge, Math.min(top, bottomEdge - height)),
    maxWidth,
    maxHeight,
  }
}
