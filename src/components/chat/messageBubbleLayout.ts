import type { MessageRole } from '@/types/chatContracts'
import { resolveProductMobileMessageListLayout } from '@/presentation/layout/productMobileLayout'

export type MessageBubbleRowAlignment = 'flex-start' | 'flex-end'

const MESSAGE_BUBBLE_MAX_CONTENT_WIDTH = 840

/** Formula and rich-content width may grow, but role direction never changes. */
export function resolveMessageBubbleRowAlignment(role: MessageRole): MessageBubbleRowAlignment {
  return role === 'user' ? 'flex-end' : 'flex-start'
}

/** Resolve width against the list's padded content box, not the raw viewport. */
export function resolveMessageBubbleMaxWidth(
  displayText: string,
  role: MessageRole,
  processLayerVisible: boolean,
  windowWidth: number,
  displayFormulaLayout = false,
): number {
  const horizontalPadding = resolveProductMobileMessageListLayout(windowWidth).horizontalPadding
  const availableWidth = Math.max(
    0,
    Math.min(MESSAGE_BUBBLE_MAX_CONTENT_WIDTH, windowWidth - horizontalPadding * 2),
  )
  const isUser = role === 'user'
  const fullWidth = Math.floor(availableWidth * (displayFormulaLayout ? 0.97 : isUser ? 0.92 : 0.98))
  if (displayFormulaLayout || isUser || processLayerVisible || hasWideMessageContent(displayText)) return fullWidth

  const normalizedText = displayText.trim().replace(/\s+/g, ' ')
  const charCount = Array.from(normalizedText).length
  if (charCount <= 0) return Math.min(fullWidth, 180)
  if (charCount <= 18) return Math.min(fullWidth, 220)
  if (charCount <= 56) return Math.min(fullWidth, 320)
  if (charCount <= 120) return Math.min(fullWidth, 430)
  return fullWidth
}

export function hasWideMessageContent(displayText: string): boolean {
  if (/```|^\s*[\[{]/m.test(displayText)) return true
  const lines = displayText.split('\n')
  if (lines.length > 4) return true
  if (lines.some((line) => line.length > 88)) return true
  return lines.some((line) => /^\s*\|.+\|\s*$/.test(line))
}
