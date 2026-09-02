import {
  COMPOSER_TOOLBAR_BOTTOM_PADDING,
  resolveFloatingComposerGeometry,
  resolveFloatingComposerWidth,
  resolveModelMenuPlacement,
} from './floatingComposerGeometry'

const READING_COLUMN_MAX_WIDTH = 880

const base = {
  viewportWidth: 393,
  viewportHeight: 852,
  horizontalPadding: 12,
  readingColumnMaxWidth: READING_COLUMN_MAX_WIDTH,
  safeAreaTop: 47,
  safeAreaBottom: 34,
  keyboardLift: 0,
  measuredContentHeight: 48,
  lineHeight: 22,
  verticalPadding: 16,
  visualLineCount: 1,
  minimumMessageAreaHeight: 180,
} as const

describe('resolveFloatingComposerGeometry', () => {
  it('centers a visibly compact Idle composer and expands Focused', () => {
    const idle = resolveFloatingComposerGeometry({
      ...base,
      sizeMode: 'compact',
      activityState: 'idle',
    })
    const focused = resolveFloatingComposerGeometry({
      ...base,
      sizeMode: 'compact',
      activityState: 'focused',
    })
    expect(idle.overlayWidth).toBeLessThan(focused.overlayWidth)
    expect(idle.horizontalInset).toBeCloseTo(
      (base.viewportWidth - idle.overlayWidth) / 2,
    )
    expect(focused.overlayWidth).toBe(base.viewportWidth - base.horizontalPadding * 2)
  })

  it('keeps Review full width even when activity returns to Idle', () => {
    const review = resolveFloatingComposerGeometry({
      ...base,
      sizeMode: 'review',
      activityState: 'idle',
      measuredContentHeight: 4 * 22 + 16,
      visualLineCount: 4,
    })
    expect(review.overlayWidth).toBe(base.viewportWidth - base.horizontalPadding * 2)
    expect(review.reviewExpandVisible).toBe(true)
  })

  it('lets a short Large editor fit content instead of forcing half-screen height', () => {
    const geometry = resolveFloatingComposerGeometry({
      ...base,
      sizeMode: 'large',
      activityState: 'typing',
      measuredContentHeight: 4 * 22 + 16,
      visualLineCount: 4,
    })
    expect(geometry.messageInputHeight).toBeLessThan(geometry.largeHeightCap)
    expect(geometry.bodyScrollEnabled).toBe(false)
    expect(geometry.toolbarBottomPadding).toBe(COMPOSER_TOOLBAR_BOTTOM_PADDING)
  })

  it('caps a huge draft and scrolls only its body', () => {
    const geometry = resolveFloatingComposerGeometry({
      ...base,
      sizeMode: 'large',
      activityState: 'typing',
      measuredContentHeight: 2000,
      visualLineCount: 90,
    })
    expect(geometry.messageInputHeight).toBe(geometry.largeHeightCap)
    expect(geometry.bodyScrollEnabled).toBe(true)
    expect(geometry.bodyViewportHeight).toBeLessThan(2000)
    expect(geometry.toolbarVisible).toBe(true)
  })

  it('reduces the Large cap when IME consumes available height', () => {
    const open = resolveFloatingComposerGeometry({
      ...base,
      sizeMode: 'large',
      activityState: 'typing',
      measuredContentHeight: 2000,
      visualLineCount: 90,
      keyboardLift: 310,
    })
    const closed = resolveFloatingComposerGeometry({
      ...base,
      sizeMode: 'large',
      activityState: 'typing',
      measuredContentHeight: 2000,
      visualLineCount: 90,
    })
    expect(open.largeHeightCap).toBeLessThan(closed.largeHeightCap)
  })

  it('places side surfaces on the MessageInput vertical center', () => {
    const geometry = resolveFloatingComposerGeometry({
      ...base,
      sizeMode: 'large',
      activityState: 'typing',
      measuredContentHeight: 500,
      visualLineCount: 20,
    })
    expect(geometry.sideControlTop + geometry.sideControlSize / 2)
      .toBe(geometry.messageInputHeight / 2)
  })
})

describe('resolveFloatingComposerWidth', () => {
  it('keeps a wide window inside the reading column and centers the remainder', () => {
    const wide = resolveFloatingComposerGeometry({
      ...base,
      viewportWidth: 1280,
      sizeMode: 'compact',
      activityState: 'focused',
    })
    expect(wide.overlayWidth).toBe(READING_COLUMN_MAX_WIDTH - base.horizontalPadding * 2)
    expect(wide.horizontalInset).toBeCloseTo((1280 - wide.overlayWidth) / 2)
  })

  it('leaves viewports narrower than the column untouched', () => {
    expect(resolveFloatingComposerWidth({
      viewportWidth: 393,
      horizontalPadding: 12,
      readingColumnMaxWidth: READING_COLUMN_MAX_WIDTH,
      sizeMode: 'review',
      activityState: 'idle',
    })).toBe(393 - 24)
  })

  it('tracks the column width it is given instead of a private constant', () => {
    const narrowColumn = resolveFloatingComposerWidth({
      viewportWidth: 1280,
      horizontalPadding: 12,
      readingColumnMaxWidth: 640,
      sizeMode: 'review',
      activityState: 'idle',
    })
    expect(narrowColumn).toBe(640 - 24)
  })
})

describe('resolveModelMenuPlacement', () => {
  it('anchors an upward menu by its bottom edge independent of measured height', () => {
    const anchor = { x: 20, y: 700, width: 44, height: 44 }
    const short = resolveModelMenuPlacement({
      anchor,
      windowWidth: 393,
      windowHeight: 852,
      estimatedMenuHeight: 260,
    })
    const tall = resolveModelMenuPlacement({
      anchor,
      windowWidth: 393,
      windowHeight: 852,
      estimatedMenuHeight: 400,
    })
    expect(short.openAbove).toBe(true)
    expect(short.bottom).toBe(tall.bottom)
    expect(short.top).toBeUndefined()
  })

  it('uses a stable top edge when there is no room above', () => {
    const placement = resolveModelMenuPlacement({
      anchor: { x: 20, y: 40, width: 44, height: 44 },
      windowWidth: 393,
      windowHeight: 852,
      estimatedMenuHeight: 300,
    })
    expect(placement.openAbove).toBe(false)
    expect(placement.top).toBe(94)
    expect(placement.bottom).toBeUndefined()
  })
})
