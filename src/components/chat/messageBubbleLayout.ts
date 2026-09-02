import type { MessageRole } from '@/types/chatContracts'
import { resolveProductMobileMessageListLayout } from '@/presentation/layout/productMobileLayout'

export type MessageBubbleRowAlignment = 'flex-start' | 'flex-end'

const MESSAGE_BUBBLE_MAX_CONTENT_WIDTH = 840

/**
 * Share of the canvas box each role may occupy. The assistant fills the reading
 * column; the user bubble keeps a small inset so its material reads as a bubble
 * rather than a second full-width surface.
 */
const MESSAGE_BUBBLE_WIDTH_RATIO = {
  assistant: 1,
  user: 0.94,
  formula: 0.97,
} as const

/**
 * Comfortable measures for turns short enough to hug their text, keyed by the
 * character count they stop serving.
 */
const MESSAGE_BUBBLE_MEASURE_TIERS = [
  { maxCharacters: 0, width: 200 },
  { maxCharacters: 20, width: 240 },
  { maxCharacters: 60, width: 360 },
  { maxCharacters: 140, width: 520 },
] as const

/**
 * Approximate advance width of one narrow glyph at the message body size. Only
 * narrow glyphs form unbreakable runs, so no wide-glyph estimate is needed.
 */
const MESSAGE_BUBBLE_NARROW_GLYPH_WIDTH = 8

/**
 * Characters that carry their own break opportunity. CJK and fullwidth text
 * wraps between glyphs, so a Chinese sentence is never one unbreakable run.
 */
const MESSAGE_BUBBLE_BREAKABLE_GLYPH_PATTERN =
  /[\sᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦　-〾]/

/** Formula and rich-content width may grow, but role direction never changes. */
export function resolveMessageBubbleRowAlignment(role: MessageRole): MessageBubbleRowAlignment {
  return role === 'user' ? 'flex-end' : 'flex-start'
}

/**
 * Resolve width against the canvas content box, not the raw viewport.
 *
 * The result is an upper bound, never a fixed width: short turns hug their text
 * and long turns wrap at a comfortable measure. The bound cannot guarantee that
 * a single unbreakable run fits, so the text style that consumes it must still
 * allow mid-run breaking; otherwise the run overflows and the row clips it.
 */
export function resolveMessageBubbleMaxWidth(
  displayText: string,
  role: MessageRole,
  processLayerVisible: boolean,
  windowWidth: number,
  displayFormulaLayout = false,
): number {
  const listLayout = resolveProductMobileMessageListLayout(windowWidth)
  // The canvas is capped at the reading column, so measure against that box
  // rather than the raw viewport. Otherwise a wide window lets the two roles
  // drift apart instead of sharing one conversation column.
  const canvasWidth = Math.min(windowWidth, listLayout.readingColumnMaxWidth)
  const availableWidth = Math.max(
    0,
    Math.min(MESSAGE_BUBBLE_MAX_CONTENT_WIDTH, canvasWidth - listLayout.horizontalPadding * 2),
  )
  const ratio = displayFormulaLayout
    ? MESSAGE_BUBBLE_WIDTH_RATIO.formula
    : role === 'user'
      ? MESSAGE_BUBBLE_WIDTH_RATIO.user
      : MESSAGE_BUBBLE_WIDTH_RATIO.assistant
  const fullWidth = Math.floor(availableWidth * ratio)
  if (displayFormulaLayout || processLayerVisible || hasWideMessageContent(displayText)) return fullWidth

  const normalizedText = displayText.trim().replace(/\s+/g, ' ')
  const characterCount = Array.from(normalizedText).length
  const tier = resolveMeasureTier(characterCount, fullWidth)
  // A run that cannot fit a narrower tier is promoted, because clamping it only
  // produces a tall column of broken words instead of a readable line.
  return Math.min(fullWidth, Math.max(tier, widestUnbreakableRunWidth(normalizedText)))
}

function resolveMeasureTier(characterCount: number, fullWidth: number): number {
  for (const tier of MESSAGE_BUBBLE_MEASURE_TIERS) {
    if (characterCount <= tier.maxCharacters) return Math.min(fullWidth, tier.width)
  }
  return fullWidth
}

/**
 * Width the widest unbreakable run needs before wrapping helps. Long
 * identifiers, URLs, and probe names are common in this product, so they decide
 * the measure rather than the total character count.
 */
function widestUnbreakableRunWidth(text: string): number {
  let widest = 0
  let current = 0
  for (const character of text) {
    if (MESSAGE_BUBBLE_BREAKABLE_GLYPH_PATTERN.test(character)) {
      if (current > widest) widest = current
      current = 0
      continue
    }
    current += 1
  }
  return Math.max(widest, current) * MESSAGE_BUBBLE_NARROW_GLYPH_WIDTH
}

export function hasWideMessageContent(displayText: string): boolean {
  if (/```|^\s*[\[{]/m.test(displayText)) return true
  const lines = displayText.split('\n')
  if (lines.length > 4) return true
  if (lines.some((line) => line.length > 88)) return true
  return lines.some((line) => /^\s*\|.+\|\s*$/.test(line))
}
