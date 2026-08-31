export const PRODUCT_MOBILE_LAYOUT_AUDIT_VIEWPORTS = [320, 360, 390] as const
export const PRODUCT_MOBILE_VISUAL_AUDIT_HEIGHTS = [568, 640, 844] as const

export type ProductMobileLayoutBreakpoint = 'tight' | 'compact' | 'regular'

export interface ProductMobileTopBarLayout {
  breakpoint: ProductMobileLayoutBreakpoint
  horizontalInset: number
  height: number
  actionSize: number
  gap: number
  centerPadding: number
  availableWidth: number
  availableCenterWidth: number
  modeWheelWidth: number
  modeWheelSlotWidth: number
  modeWheelItemWidth: number
  selectedScale: number
  selectedLabelFontSize: number
  inactiveLabelFontSize: number
  labelLineHeight: number
  indicatorWidth: number
  badgeSingleSize: number
  badgeMultiSize: number
}

export interface ProductMobileStarterLayout {
  setupContentMaxWidth: number
  emptyContentMaxWidth: number
  actionMinWidth: number
  statusPillGlyphSize: number
}

export interface ProductMobileChatSetupLayout {
  compactLandscape: boolean
  contentHeaderGap: number
  showIntroDecoration: boolean
  showIntroDescription: boolean
}

export interface ProductMobileChatConfigurationSheetLayoutInput {
  safeAreaTop?: number
}

export interface ProductMobileChatConfigurationSheetLayout {
  height: number
  availableHeight: number
  compact: boolean
}

export interface ProductMobileComposerLayoutInput {
  composerHeight?: number
  safeAreaBottom?: number
  keyboardLift?: number
}

export interface ProductMobileComposerLayout {
  minimumHeight: number
  horizontalPadding: number
  innerTopPadding: number
  innerBottomPadding: number
  safeBottomPadding: number
  floatingBottomOffset: number
  bottomInset: number
  messageListGap: number
  messageListBottomPadding: number
}

export interface ProductMobileComposerToolsLayoutInput {
  entryCount?: number
  unavailableEntryCount?: number
}

export interface ProductMobileComposerToolsLayout {
  panelHorizontalPadding: number
  chipGap: number
  chipMinWidth: number
  chipMaxWidth: number
  chipMinHeight: number
  chipsPerRow: number
  rowCount: number
  capabilityNoticeHeight: number
  estimatedPanelHeight: number
}

export interface ProductMobileMessageListLayoutInput {
  topChromeInset?: number
  chromeHeight?: number
}

export interface ProductMobileMessageListLayout {
  horizontalPadding: number
  topInset: number
  conversationHeaderTopPadding: number
  emptyConversationTopPadding: number
  /**
   * Outer width of the conversation canvas, including its gutters. The canvas
   * owns the reading column so both roles measure against the same box; on
   * mobile it always exceeds the viewport and changes nothing.
   */
  readingColumnMaxWidth: number
}

export interface ProductMobilePagerTransitionInput {
  motionFull?: boolean
}

export interface ProductMobilePagerTransition {
  persistentTopBarOffset: number
  swipePageThreshold: number
  swipeVelocityThreshold: number
  activeHorizontalOffset: number
  failVerticalOffset: number
  horizontalDominanceRatio: number
  minHorizontalDrag: number
  settleMs: number
  revealMs: number
  modeWheelTimingMs: number
  settingsSpinMs: number
  settingsReleaseMs: number
  settingsSettleMs: number
  settingsWashMs: number
  pageZIndexBase: number
  pageZIndexStep: number
}

export interface ProductMobileVisualAuditFrameInput extends ProductMobileComposerLayoutInput, ProductMobileMessageListLayoutInput {
  viewportHeight?: number
  starterCount?: number
}

export interface ProductMobileVisualAuditFrame {
  viewportWidth: number
  viewportHeight: number
  topBarReservedHeight: number
  composerReservedHeight: number
  emptyStateTopPadding: number
  availableEmptyStateHeight: number
  starterActionStackHeight: number
  boundaryActionHeight: number
  setupStackHeight: number
  conversationEmptyStackHeight: number
  setupFitsWithoutScroll: boolean
  conversationEmptyFitsWithoutScroll: boolean
  composerOverlapRisk: boolean
  scrollFallbackExpected: boolean
}

export interface ProductMobileLayout {
  viewportWidth: number
  breakpoint: ProductMobileLayoutBreakpoint
  compact: boolean
  tight: boolean
  topBar: ProductMobileTopBarLayout
  starter: ProductMobileStarterLayout
}

const MIN_TOUCH_TARGET = 44
export const PRODUCT_MOBILE_COMPOSER_COLLAPSED_MIN_HEIGHT = 112
export const PRODUCT_MOBILE_COMPOSER_COMPACT_BREAKPOINT = 400
export const PRODUCT_MOBILE_CONVERSATION_NAVIGATION_BREAKPOINT = 720
const PRODUCT_MOBILE_COMPOSER_BOTTOM_EXTRA = 4
const PRODUCT_MOBILE_COMPOSER_INNER_BOTTOM_EXTRA = 6
const PRODUCT_MOBILE_COMPOSER_INNER_TOP_PADDING = 2
const PRODUCT_MOBILE_SAFE_BOTTOM_FLOOR = 10
const PRODUCT_MOBILE_MESSAGE_LIST_CHROME_GAP = 8
const PRODUCT_MOBILE_MESSAGE_LIST_CHROME_OVERLAY = 0
const PRODUCT_MOBILE_MESSAGE_LIST_CHROME_UNDERLAP = 0
const PRODUCT_MOBILE_MESSAGE_LIST_TIGHT_BREAKPOINT = 340
const PRODUCT_MOBILE_MESSAGE_LIST_MOBILE_BREAKPOINT = 600
/**
 * Widest the conversation canvas grows on large viewports. Both roles align to
 * this column, so a desktop window reads as one conversation instead of two
 * columns drifting toward opposite screen edges.
 */
export const PRODUCT_MOBILE_READING_COLUMN_MAX_WIDTH = 880
const PRODUCT_MOBILE_MESSAGE_LIST_COMPOSER_GAP = 12
const PRODUCT_MOBILE_EMPTY_CONVERSATION_DEFAULT_TOP_PADDING = 20
const PRODUCT_MOBILE_PAGER_PAGE_SETTLE_MS = 176
const PRODUCT_MOBILE_REDUCED_MOTION_SETTLE_MS = 80
const PRODUCT_MOBILE_PAGER_REVEAL_EXTRA_MS = 48
const PRODUCT_MOBILE_SETTINGS_TRANSITION_SPIN_MS = 416
const PRODUCT_MOBILE_SETTINGS_TRANSITION_RELEASE_MS = 112
const PRODUCT_MOBILE_SETTINGS_TRANSITION_SETTLE_MS = 560
const PRODUCT_MOBILE_SETTINGS_WASH_MS = 260
const PRODUCT_MOBILE_EMPTY_STATE_INTRO_HEIGHT = 56
const PRODUCT_MOBILE_SETUP_INTRO_HEIGHT = 102
const PRODUCT_MOBILE_EMPTY_STATE_ACTION_ROW_HEIGHT = 44
const PRODUCT_MOBILE_EMPTY_STATE_SECTION_GAP = 10
const PRODUCT_MOBILE_BOUNDARY_ACTION_HEIGHT = 44
const PRODUCT_MOBILE_CHAT_SETUP_COMPACT_LANDSCAPE_MAX_HEIGHT = 360
const PRODUCT_MOBILE_CHAT_SETUP_COMPACT_HEADER_GAP = 4
const PRODUCT_MOBILE_CHAT_CONFIGURATION_SHEET_MIN_HEIGHT = 360
const PRODUCT_MOBILE_CHAT_CONFIGURATION_SHEET_HEIGHT_RATIO = 0.92
const PRODUCT_MOBILE_CHAT_CONFIGURATION_SHEET_TOP_GAP = 12
const PRODUCT_MOBILE_COMPOSER_TOOL_PANEL_TOP_PADDING = 10
const PRODUCT_MOBILE_COMPOSER_TOOL_PANEL_HORIZONTAL_PADDING = 12
const PRODUCT_MOBILE_COMPOSER_TOOL_TITLE_HEIGHT = 14
const PRODUCT_MOBILE_COMPOSER_TOOL_NOTICE_HEIGHT = 30
const PRODUCT_MOBILE_COMPOSER_TOOL_CHIP_HEIGHT = 44
const PRODUCT_MOBILE_COMPOSER_TOOL_GAP = 8

export function resolveProductMobileLayout(viewportWidth: number): ProductMobileLayout {
  const width = normalizeViewportWidth(viewportWidth)
  const tight = width < 340
  const compact = width < 380
  const breakpoint: ProductMobileLayoutBreakpoint = tight ? 'tight' : compact ? 'compact' : 'regular'
  const topBarHorizontalInset = tight ? 10 : compact ? 12 : 14
  const topBarGap = tight ? 4 : 6
  const topBarCenterPadding = tight ? 0 : 2
  const topBarAvailableWidth = Math.max(0, width - topBarHorizontalInset * 2)
  const topBarAvailableCenterWidth = Math.max(
    174,
    topBarAvailableWidth - MIN_TOUCH_TARGET * 2 - topBarGap * 2 - topBarCenterPadding * 2,
  )
  const modeWheelMaxWidth = tight ? 204 : compact ? 246 : 286
  const modeWheelWidth = Math.min(modeWheelMaxWidth, topBarAvailableCenterWidth)
  const modeWheelSlotWidth = modeWheelWidth / 3
  const modeWheelItemWidth = Math.max(tight ? 58 : 68, Math.min(compact ? 82 : 88, modeWheelSlotWidth))

  return {
    viewportWidth: width,
    breakpoint,
    compact,
    tight,
    topBar: {
      breakpoint,
      horizontalInset: topBarHorizontalInset,
      height: 50,
      actionSize: MIN_TOUCH_TARGET,
      gap: topBarGap,
      centerPadding: topBarCenterPadding,
      availableWidth: topBarAvailableWidth,
      availableCenterWidth: topBarAvailableCenterWidth,
      modeWheelWidth,
      modeWheelSlotWidth,
      modeWheelItemWidth,
      selectedScale: 1.08,
      selectedLabelFontSize: tight ? 14 : compact ? 15 : 16.5,
      inactiveLabelFontSize: tight ? 12.5 : compact ? 13.5 : 14.5,
      labelLineHeight: tight ? 18 : compact ? 19 : 21,
      indicatorWidth: tight ? 18 : compact ? 20 : 22,
      badgeSingleSize: 8,
      badgeMultiSize: 12,
    },
    starter: {
      setupContentMaxWidth: Math.max(260, Math.min(compact ? 320 : 330, width - (tight ? 40 : 48))),
      emptyContentMaxWidth: Math.max(260, Math.min(compact ? 320 : 360, width - 40)),
      actionMinWidth: Math.max(132, Math.min(148, width * 0.38)),
      statusPillGlyphSize: tight ? 8.5 : 9,
    },
  }
}

export function resolveProductMobileChatSetupLayout(
  viewportWidth: number,
  viewportHeight: number,
): ProductMobileChatSetupLayout {
  const width = normalizeViewportExtent(
    viewportWidth,
    PRODUCT_MOBILE_LAYOUT_AUDIT_VIEWPORTS[0],
  )
  const height = normalizeViewportExtent(
    viewportHeight,
    PRODUCT_MOBILE_VISUAL_AUDIT_HEIGHTS[1],
  )
  const compactLandscape =
    width > height &&
    height <= PRODUCT_MOBILE_CHAT_SETUP_COMPACT_LANDSCAPE_MAX_HEIGHT

  return {
    compactLandscape,
    contentHeaderGap: compactLandscape
      ? PRODUCT_MOBILE_CHAT_SETUP_COMPACT_HEADER_GAP
      : 0,
    showIntroDecoration: !compactLandscape,
    showIntroDescription: !compactLandscape,
  }
}

export function resolveProductMobileChatConfigurationSheetLayout(
  viewportHeight: number,
  input: ProductMobileChatConfigurationSheetLayoutInput = {},
): ProductMobileChatConfigurationSheetLayout {
  const height = normalizeViewportExtent(
    viewportHeight,
    PRODUCT_MOBILE_VISUAL_AUDIT_HEIGHTS[1],
  )
  const safeAreaTop = Number.isFinite(input.safeAreaTop)
    ? Math.max(0, Math.round(input.safeAreaTop ?? 0))
    : 0
  const topClearance = Math.max(
    PRODUCT_MOBILE_CHAT_CONFIGURATION_SHEET_TOP_GAP,
    safeAreaTop,
  )
  const availableHeight = Math.max(
    1,
    height - Math.min(topClearance, height - 1),
  )
  const compact = availableHeight < PRODUCT_MOBILE_CHAT_CONFIGURATION_SHEET_MIN_HEIGHT
  const preferredHeight = Math.round(
    height * PRODUCT_MOBILE_CHAT_CONFIGURATION_SHEET_HEIGHT_RATIO,
  )
  const minimumHeight = Math.min(
    PRODUCT_MOBILE_CHAT_CONFIGURATION_SHEET_MIN_HEIGHT,
    availableHeight,
  )

  return {
    height: Math.min(
      availableHeight,
      Math.max(minimumHeight, preferredHeight),
    ),
    availableHeight,
    compact,
  }
}

export function resolveProductMobileComposerLayout(
  viewportWidth: number,
  input: ProductMobileComposerLayoutInput = {},
): ProductMobileComposerLayout {
  const width = normalizeViewportWidth(viewportWidth)
  const tight = width < 340
  const safeBottomPadding = Math.max(PRODUCT_MOBILE_SAFE_BOTTOM_FLOOR, Math.round(input.safeAreaBottom ?? 0))
  const keyboardLift = Math.max(0, Math.round(input.keyboardLift ?? 0))
  const composerHeight = Math.max(
    PRODUCT_MOBILE_COMPOSER_COLLAPSED_MIN_HEIGHT,
    Math.round(input.composerHeight ?? PRODUCT_MOBILE_COMPOSER_COLLAPSED_MIN_HEIGHT),
  )
  const bottomInset = Math.max(
    PRODUCT_MOBILE_COMPOSER_COLLAPSED_MIN_HEIGHT,
    composerHeight + safeBottomPadding + PRODUCT_MOBILE_COMPOSER_BOTTOM_EXTRA,
  )

  return {
    minimumHeight: PRODUCT_MOBILE_COMPOSER_COLLAPSED_MIN_HEIGHT,
    horizontalPadding: tight ? 12 : 14,
    innerTopPadding: PRODUCT_MOBILE_COMPOSER_INNER_TOP_PADDING,
    innerBottomPadding: safeBottomPadding + PRODUCT_MOBILE_COMPOSER_INNER_BOTTOM_EXTRA,
    safeBottomPadding,
    floatingBottomOffset: keyboardLift,
    bottomInset,
    messageListGap: PRODUCT_MOBILE_MESSAGE_LIST_COMPOSER_GAP,
    messageListBottomPadding: PRODUCT_MOBILE_MESSAGE_LIST_COMPOSER_GAP + bottomInset + keyboardLift,
  }
}

export function resolveProductMobileComposerToolsLayout(
  viewportWidth: number,
  input: ProductMobileComposerToolsLayoutInput = {},
): ProductMobileComposerToolsLayout {
  const width = normalizeViewportWidth(viewportWidth)
  const tight = width < 340
  const compact = width < 380
  const composer = resolveProductMobileComposerLayout(width)
  const entryCount = Math.max(0, Math.round(input.entryCount ?? 6))
  const unavailableEntryCount = Math.max(0, Math.round(input.unavailableEntryCount ?? 0))
  const chipMinWidth = tight ? 80 : compact ? 88 : 92
  const chipMaxWidth = tight ? 118 : compact ? 126 : 136
  const panelContentWidth = Math.max(
    chipMinWidth,
    width - composer.horizontalPadding * 2 - PRODUCT_MOBILE_COMPOSER_TOOL_PANEL_HORIZONTAL_PADDING * 2,
  )
  const chipsPerRow = Math.max(
    1,
    Math.min(
      entryCount || 1,
      Math.floor((panelContentWidth + PRODUCT_MOBILE_COMPOSER_TOOL_GAP) / (chipMinWidth + PRODUCT_MOBILE_COMPOSER_TOOL_GAP)),
    ),
  )
  const rowCount = entryCount ? Math.ceil(entryCount / chipsPerRow) : 0
  const capabilityNoticeHeight = unavailableEntryCount > 0 ? PRODUCT_MOBILE_COMPOSER_TOOL_NOTICE_HEIGHT : 0
  const chipRowsHeight = rowCount
    ? rowCount * PRODUCT_MOBILE_COMPOSER_TOOL_CHIP_HEIGHT + Math.max(0, rowCount - 1) * PRODUCT_MOBILE_COMPOSER_TOOL_GAP
    : 0
  const estimatedPanelHeight =
    PRODUCT_MOBILE_COMPOSER_TOOL_PANEL_TOP_PADDING +
    PRODUCT_MOBILE_COMPOSER_TOOL_TITLE_HEIGHT +
    PRODUCT_MOBILE_COMPOSER_TOOL_GAP +
    capabilityNoticeHeight +
    (capabilityNoticeHeight ? PRODUCT_MOBILE_COMPOSER_TOOL_GAP : 0) +
    chipRowsHeight

  return {
    panelHorizontalPadding: PRODUCT_MOBILE_COMPOSER_TOOL_PANEL_HORIZONTAL_PADDING,
    chipGap: PRODUCT_MOBILE_COMPOSER_TOOL_GAP,
    chipMinWidth,
    chipMaxWidth,
    chipMinHeight: PRODUCT_MOBILE_COMPOSER_TOOL_CHIP_HEIGHT,
    chipsPerRow,
    rowCount,
    capabilityNoticeHeight,
    estimatedPanelHeight,
  }
}

export function resolveProductMobileMessageListLayout(
  viewportWidth: number,
  input: ProductMobileMessageListLayoutInput = {},
): ProductMobileMessageListLayout {
  const width = normalizeViewportWidth(viewportWidth)
  const topChromeInset = Math.max(0, Math.round(input.topChromeInset ?? 0))
  const chromeHeight = Math.max(0, Math.round(input.chromeHeight ?? 0))
  const topInset = Math.max(
    topChromeInset,
    chromeHeight - PRODUCT_MOBILE_MESSAGE_LIST_CHROME_OVERLAY + PRODUCT_MOBILE_MESSAGE_LIST_CHROME_GAP,
  )
  return {
    horizontalPadding:
      width < PRODUCT_MOBILE_MESSAGE_LIST_TIGHT_BREAKPOINT
        ? 12
        : width < PRODUCT_MOBILE_MESSAGE_LIST_MOBILE_BREAKPOINT
          ? 14
          : 16,
    topInset,
    conversationHeaderTopPadding: Math.max(0, topInset - PRODUCT_MOBILE_MESSAGE_LIST_CHROME_UNDERLAP),
    emptyConversationTopPadding: Math.max(
      PRODUCT_MOBILE_EMPTY_CONVERSATION_DEFAULT_TOP_PADDING,
      topInset - PRODUCT_MOBILE_MESSAGE_LIST_CHROME_UNDERLAP + 6,
    ),
    readingColumnMaxWidth: PRODUCT_MOBILE_READING_COLUMN_MAX_WIDTH,
  }
}

export function resolveProductMobilePagerTransition(
  viewportWidth: number,
  input: ProductMobilePagerTransitionInput = {},
): ProductMobilePagerTransition {
  const width = normalizeViewportWidth(viewportWidth)
  const motionFull = input.motionFull !== false
  const settleMs = motionFull ? PRODUCT_MOBILE_PAGER_PAGE_SETTLE_MS : PRODUCT_MOBILE_REDUCED_MOTION_SETTLE_MS
  return {
    persistentTopBarOffset: 68,
    swipePageThreshold: 0.18,
    swipeVelocityThreshold: width < 340 ? 500 : 520,
    activeHorizontalOffset: 18,
    failVerticalOffset: 36,
    horizontalDominanceRatio: 1.35,
    minHorizontalDrag: width < 340 ? 22 : 24,
    settleMs,
    revealMs: settleMs + PRODUCT_MOBILE_PAGER_REVEAL_EXTRA_MS,
    modeWheelTimingMs: motionFull ? 224 : PRODUCT_MOBILE_REDUCED_MOTION_SETTLE_MS,
    settingsSpinMs: motionFull ? PRODUCT_MOBILE_SETTINGS_TRANSITION_SPIN_MS : PRODUCT_MOBILE_REDUCED_MOTION_SETTLE_MS,
    settingsReleaseMs: motionFull ? PRODUCT_MOBILE_SETTINGS_TRANSITION_RELEASE_MS : 1,
    settingsSettleMs: motionFull ? PRODUCT_MOBILE_SETTINGS_TRANSITION_SETTLE_MS : PRODUCT_MOBILE_REDUCED_MOTION_SETTLE_MS,
    settingsWashMs: motionFull ? PRODUCT_MOBILE_SETTINGS_WASH_MS : 1,
    pageZIndexBase: 20,
    pageZIndexStep: 8,
  }
}

export function resolveProductMobileVisualAuditFrame(
  viewportWidth: number,
  input: ProductMobileVisualAuditFrameInput = {},
): ProductMobileVisualAuditFrame {
  const width = normalizeViewportWidth(viewportWidth)
  const viewportHeight = normalizeViewportHeight(input.viewportHeight)
  const starterCount = Math.min(1, Math.max(0, Math.round(input.starterCount ?? 1)))
  const composer = resolveProductMobileComposerLayout(width, input)
  const messageList = resolveProductMobileMessageListLayout(width, input)
  const transition = resolveProductMobilePagerTransition(width, { motionFull: true })
  const starterActionStackHeight = starterCount * PRODUCT_MOBILE_EMPTY_STATE_ACTION_ROW_HEIGHT
  const boundaryActionHeight = PRODUCT_MOBILE_BOUNDARY_ACTION_HEIGHT
  const setupStackHeight =
    PRODUCT_MOBILE_SETUP_INTRO_HEIGHT +
    PRODUCT_MOBILE_EMPTY_STATE_SECTION_GAP +
    boundaryActionHeight +
    PRODUCT_MOBILE_EMPTY_STATE_SECTION_GAP +
    Math.max(starterActionStackHeight, PRODUCT_MOBILE_EMPTY_STATE_ACTION_ROW_HEIGHT)
  const conversationEmptyStackHeight =
    PRODUCT_MOBILE_EMPTY_STATE_INTRO_HEIGHT +
    PRODUCT_MOBILE_EMPTY_STATE_SECTION_GAP +
    boundaryActionHeight +
    (starterActionStackHeight ? PRODUCT_MOBILE_EMPTY_STATE_SECTION_GAP + starterActionStackHeight : 0)
  const availableEmptyStateHeight = Math.max(
    0,
    viewportHeight - transition.persistentTopBarOffset - messageList.emptyConversationTopPadding - composer.messageListBottomPadding,
  )
  const setupFitsWithoutScroll = setupStackHeight <= availableEmptyStateHeight
  const conversationEmptyFitsWithoutScroll = conversationEmptyStackHeight <= availableEmptyStateHeight

  return {
    viewportWidth: width,
    viewportHeight,
    topBarReservedHeight: transition.persistentTopBarOffset,
    composerReservedHeight: composer.messageListBottomPadding,
    emptyStateTopPadding: messageList.emptyConversationTopPadding,
    availableEmptyStateHeight,
    starterActionStackHeight,
    boundaryActionHeight,
    setupStackHeight,
    conversationEmptyStackHeight,
    setupFitsWithoutScroll,
    conversationEmptyFitsWithoutScroll,
    composerOverlapRisk: composer.messageListBottomPadding < composer.bottomInset + composer.messageListGap,
    scrollFallbackExpected: !setupFitsWithoutScroll || !conversationEmptyFitsWithoutScroll,
  }
}

function normalizeViewportWidth(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return PRODUCT_MOBILE_LAYOUT_AUDIT_VIEWPORTS[0]
  return Math.max(PRODUCT_MOBILE_LAYOUT_AUDIT_VIEWPORTS[0], Math.round(value))
}

function normalizeViewportHeight(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) return PRODUCT_MOBILE_VISUAL_AUDIT_HEIGHTS[1]
  return Math.max(PRODUCT_MOBILE_VISUAL_AUDIT_HEIGHTS[0], Math.round(value))
}

function normalizeViewportExtent(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.max(1, Math.round(value))
}
