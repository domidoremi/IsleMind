import type { ComposerSizeMode } from './composerLongDraftState'

export type ComposerActivityState = 'idle' | 'focused' | 'typing' | 'sending'

export const COMPOSER_SIDE_CONTROL_SIZE = 44
export const COMPOSER_INPUT_MIN_HEIGHT = 48
export const COMPOSER_LARGE_HEADER_HEIGHT = 30
export const COMPOSER_TOOLBAR_HEIGHT = 40
export const COMPOSER_TOOLBAR_BOTTOM_PADDING = 6
export const COMPOSER_LARGE_MAX_VIEWPORT_RATIO = 0.46

interface FloatingComposerGeometryInput {
  viewportWidth: number
  viewportHeight: number
  horizontalPadding: number
  /**
   * Outer width of the conversation canvas. Passed in rather than imported so
   * this module stays pure geometry: a layout import here would place a module
   * constant on the first-paint path, where Metro bundle splitting can evaluate
   * it before initialization.
   */
  readingColumnMaxWidth: number
  safeAreaTop: number
  safeAreaBottom: number
  keyboardLift: number
  measuredContentHeight: number
  lineHeight: number
  verticalPadding: number
  visualLineCount: number
  minimumMessageAreaHeight: number
  sizeMode: ComposerSizeMode
  activityState: ComposerActivityState
}

export interface FloatingComposerGeometry {
  overlayWidth: number
  horizontalInset: number
  messageInputHeight: number
  bodyViewportHeight: number
  bodyScrollEnabled: boolean
  toolbarVisible: boolean
  toolbarBottomPadding: number
  reviewExpandVisible: boolean
  largeHeightCap: number
  sideControlSize: number
  sideControlTop: number
}

interface FloatingComposerWidthInput {
  viewportWidth: number
  horizontalPadding: number
  readingColumnMaxWidth: number
  sizeMode: ComposerSizeMode
  activityState: ComposerActivityState
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

/**
 * The composer shares the canvas reading column, so a wide window keeps the
 * input aligned with the transcript instead of stretching to both screen edges.
 */
export function resolveFloatingComposerWidth({
  viewportWidth,
  horizontalPadding,
  readingColumnMaxWidth,
  sizeMode,
  activityState,
}: FloatingComposerWidthInput): number {
  const columnWidth = Math.min(viewportWidth, Math.max(0, readingColumnMaxWidth))
  const fullWidth = Math.max(0, columnWidth - Math.max(8, horizontalPadding) * 2)
  if (sizeMode !== 'compact' || activityState !== 'idle') return fullWidth
  const idleTarget = viewportWidth < 430
    ? viewportWidth - 84
    : viewportWidth * 0.58
  return Math.min(fullWidth, Math.max(248, Math.min(idleTarget, 520)))
}

export function resolveFloatingComposerGeometry(
  input: FloatingComposerGeometryInput,
): FloatingComposerGeometry {
  const overlayWidth = resolveFloatingComposerWidth(input)
  const horizontalInset = Math.max(0, (input.viewportWidth - overlayWidth) / 2)
  const contentHeight = Number.isFinite(input.measuredContentHeight) &&
    input.measuredContentHeight > 0
    ? input.measuredContentHeight
    : COMPOSER_INPUT_MIN_HEIGHT
  const compactBodyCap = input.lineHeight * 3 + input.verticalPadding
  const reviewBodyCap = input.lineHeight * 7 + input.verticalPadding
  const reviewFooterHeight = input.visualLineCount >= 4 ? 36 : 0
  const largeChromeHeight =
    COMPOSER_LARGE_HEADER_HEIGHT +
    COMPOSER_TOOLBAR_HEIGHT +
    COMPOSER_TOOLBAR_BOTTOM_PADDING
  const availableViewportHeight = Math.max(
    0,
    input.viewportHeight -
      input.safeAreaTop -
      input.safeAreaBottom -
      Math.max(0, input.keyboardLift),
  )
  const ratioCap = availableViewportHeight * COMPOSER_LARGE_MAX_VIEWPORT_RATIO
  const messageAreaCap =
    availableViewportHeight - input.minimumMessageAreaHeight - 16
  const largeHeightCap = Math.max(
    largeChromeHeight + COMPOSER_INPUT_MIN_HEIGHT,
    Math.min(ratioCap, messageAreaCap),
  )

  let messageInputHeight = COMPOSER_INPUT_MIN_HEIGHT
  let bodyViewportHeight = COMPOSER_INPUT_MIN_HEIGHT
  let bodyScrollEnabled = false
  if (input.sizeMode === 'compact') {
    bodyViewportHeight = clamp(
      contentHeight,
      COMPOSER_INPUT_MIN_HEIGHT,
      compactBodyCap,
    )
    messageInputHeight = bodyViewportHeight
  } else if (input.sizeMode === 'review') {
    bodyViewportHeight = clamp(
      contentHeight,
      COMPOSER_INPUT_MIN_HEIGHT,
      reviewBodyCap,
    )
    bodyScrollEnabled = contentHeight > bodyViewportHeight
    messageInputHeight = bodyViewportHeight + reviewFooterHeight
  } else {
    const naturalHeight =
      largeChromeHeight + Math.max(COMPOSER_INPUT_MIN_HEIGHT, contentHeight)
    messageInputHeight = Math.min(naturalHeight, largeHeightCap)
    bodyViewportHeight = Math.max(
      COMPOSER_INPUT_MIN_HEIGHT,
      messageInputHeight - largeChromeHeight,
    )
    bodyScrollEnabled = contentHeight > bodyViewportHeight
  }

  return {
    overlayWidth,
    horizontalInset,
    messageInputHeight,
    bodyViewportHeight,
    bodyScrollEnabled,
    toolbarVisible: input.sizeMode === 'large',
    toolbarBottomPadding: COMPOSER_TOOLBAR_BOTTOM_PADDING,
    reviewExpandVisible:
      input.sizeMode === 'review' && input.visualLineCount >= 4,
    largeHeightCap,
    sideControlSize: COMPOSER_SIDE_CONTROL_SIZE,
    sideControlTop: (messageInputHeight - COMPOSER_SIDE_CONTROL_SIZE) / 2,
  }
}

export interface ModelMenuAnchor {
  x: number
  y: number
  width: number
  height: number
}

interface ModelMenuPlacementInput {
  anchor: ModelMenuAnchor | null
  windowWidth: number
  windowHeight: number
  estimatedMenuHeight: number
}

export interface ModelMenuPlacement {
  left: number
  width: number
  openAbove: boolean
  top?: number
  bottom?: number
}

export function resolveModelMenuPlacement({
  anchor,
  windowWidth,
  windowHeight,
  estimatedMenuHeight,
}: ModelMenuPlacementInput): ModelMenuPlacement {
  const width = Math.min(272, Math.max(240, windowWidth - 32))
  const left = anchor
    ? clamp(anchor.x + anchor.width / 2 - width / 2, 12, windowWidth - width - 12)
    : Math.max(12, (windowWidth - width) / 2)
  const openAbove = !!anchor && anchor.y >= estimatedMenuHeight + 24
  if (openAbove && anchor) {
    return {
      left,
      width,
      openAbove: true,
      bottom: Math.max(12, windowHeight - anchor.y + 10),
    }
  }
  return {
    left,
    width,
    openAbove: false,
    top: anchor ? Math.max(12, anchor.y + anchor.height + 10) : 24,
  }
}
