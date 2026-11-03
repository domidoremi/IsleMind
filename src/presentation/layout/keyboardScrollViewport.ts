export interface KeyboardViewportFrame {
  top: number
  height: number
}

export function resolveKeyboardViewportInset(frame: KeyboardViewportFrame, keyboardTop: number | null): number {
  if (keyboardTop === null || !Number.isFinite(keyboardTop)
    || !Number.isFinite(frame.top) || !Number.isFinite(frame.height) || frame.height <= 0) return 0
  return Math.min(frame.height, Math.max(0, frame.top + frame.height - keyboardTop))
}

export function resolveFocusedInputScroll({
  viewport,
  input,
  offset,
  gap = 12,
}: {
  viewport: KeyboardViewportFrame
  input: KeyboardViewportFrame
  offset: number
  gap?: number
}): number {
  const current = Number.isFinite(offset) ? Math.max(0, offset) : 0
  if (![viewport.top, viewport.height, input.top, input.height].every(Number.isFinite)
    || viewport.height <= 0 || input.height <= 0) return current
  const margin = Math.min(viewport.height / 4, Math.max(0, gap))
  const top = viewport.top + margin
  const bottom = viewport.top + viewport.height - margin
  let delta = 0
  if (input.height > bottom - top) {
    // Never reveal a tall multiline field by pushing its beginning off-screen.
    delta = input.top - top
  } else if (input.top < top) delta = input.top - top
  else if (input.top + input.height > bottom) delta = input.top + input.height - bottom
  return Math.max(0, current + delta)
}
