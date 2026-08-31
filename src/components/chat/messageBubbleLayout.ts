import type { MessageRole } from '@/types/chatContracts'
import { resolveProductMobileMessageListLayout } from '@/presentation/layout/productMobileLayout'

export type MessageBubbleRowAlignment = 'flex-start' | 'flex-end'

const MESSAGE_BUBBLE_MAX_CONTENT_WIDTH = 840
/** Approximate advance width of one CJK glyph at the message body size. */
const MESSAGE_BUBBLE_GLYPH_WIDTH = 15

/** Formula and rich-content width may grow, but role direction never changes. */
export function resolveMessageBubbleRowAlignment(role: MessageRole): MessageBubbleRowAlignment {
  return role === 'user' ? 'flex-end' : 'flex-start'
}

/**
 * Resolve width against the list's padded content box, not the raw viewport.
 *
 * The result is an upper bound, never a fixed width: short turns hug their
 * text, long turns wrap at a comfortable measure. A turn whose longest
 * unbreakable token cannot fit a narrower tier is promoted to the full content
 * width, because clamping it only produces a tall narrow column of broken
 * words instead of a readable line.
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
  // rather than the raw viewport. Otherwise a wide window would let the two
  // roles drift apart instead of sharing one conversation column.
  const canvasWidth = Math.min(windowWidth, listLayout.readingColumnMaxWidth)
  const availableWidth = Math.max(
    0,
    Math.min(MESSAGE_BUBBLE_MAX_CONTENT_WIDTH, canvasWidth - listLayout.horizontalPadding * 2),
  )
  const isUser = role === 'user'
  const fullWidth = Math.floor(availableWidth * (displayFormulaLayout ? 0.97 : isUser ? 0.94 : 1))
  if (displayFormulaLayout || processLayerVisible || hasWideMessageContent(displayText)) return fullWidth

  const normalizedText = displayText.trim().replace(/\s+/g, ' ')
  const charCount = Array.from(normalizedText).length
  if (charCount <= 0) return Math.min(fullWidth, 200)
  const tier = charCount <= 20
    ? 240
    : charCount <= 60
      ? 360
      : charCount <= 140
        ? 520
        : fullWidth
  return Math.min(fullWidth, Math.max(tier, longestTokenWidth(normalizedText)))
}

/**
 * Width a single unbreakable run needs before wrapping helps. Long identifiers,
 * URLs, and probe names are common in this product, so they decide the measure
 * rather than the total character count.
 */
function longestTokenWidth(text: string): number {
  let longest = 0
  for (const token of text.split(' ')) {
    const length = Array.from(token).length
    if (length > longest) longest = length
  }
  return longest * MESSAGE_BUBBLE_GLYPH_WIDTH
}

export function hasWideMessageContent(displayText: string): boolean {
  if (/```|^\s*[\[{]/m.test(displayText)) return true
  const lines = displayText.split('\n')
  if (lines.length > 4) return true
  if (lines.some((line) => line.length > 88)) return true
  return lines.some((line) => /^\s*\|.+\|\s*$/.test(line))
}
