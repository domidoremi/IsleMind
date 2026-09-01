import type { Message } from '@/types/chatContracts'

export interface AssistantNavigationItem {
  messageId: string
  messageIndex: number
  assistantIndex: number
  assistantCount: number
  paragraphCount: number
}

export interface AssistantNavigationScrollOptions {
  animated?: boolean
  settle?: boolean
}

/**
 * Returns a bounded set of marker indexes for the visual navigation track.
 *
 * The full assistant reply list remains the source of truth for selection and
 * accessibility. Only the decorative marker layer is sampled so a very long
 * transcript does not mount hundreds of animated views while the user scrolls.
 */
export function sampleAssistantNavigationIndices(
  itemCount: number,
  activeIndex = 0,
  maxMarkers = 28,
): number[] {
  const count = Number.isFinite(itemCount) ? Math.max(0, Math.floor(itemCount)) : 0
  if (count === 0) return []

  const markerLimit = Number.isFinite(maxMarkers) ? Math.max(3, Math.floor(maxMarkers)) : 28
  if (count <= markerLimit) return Array.from({ length: count }, (_, index) => index)

  const normalizedActiveIndex = Number.isFinite(activeIndex) ? Math.floor(activeIndex) : 0
  const safeActiveIndex = Math.max(0, Math.min(count - 1, normalizedActiveIndex))
  const selected = new Set<number>([0, count - 1, safeActiveIndex])
  const evenlySpacedCount = Math.max(0, markerLimit - selected.size)
  for (let index = 1; index <= evenlySpacedCount; index += 1) {
    const ratio = index / (evenlySpacedCount + 1)
    selected.add(Math.round(ratio * (count - 1)))
  }

  // The active marker is always retained. If rounding produced one extra
  // marker, remove the closest non-boundary/non-active item.
  while (selected.size > markerLimit) {
    const removable = [...selected]
      .filter((index) => index !== 0 && index !== count - 1 && index !== safeActiveIndex)
      .sort((left, right) => Math.abs(left - safeActiveIndex) - Math.abs(right - safeActiveIndex))[0]
    if (removable === undefined) break
    selected.delete(removable)
  }

  return [...selected].sort((left, right) => left - right)
}

export interface MessageScrollViewport {
  contentHeight: number
  viewportHeight: number
  scrollY: number
  awayFromBottom: boolean
}

export function createEmptyMessageScrollViewport(): MessageScrollViewport {
  return {
    contentHeight: 0,
    viewportHeight: 0,
    scrollY: 0,
    awayFromBottom: false,
  }
}

export function buildMessageScrollViewport(
  contentHeight: number,
  viewportHeight: number,
  scrollY: number,
  bottomPauseThreshold: number
): MessageScrollViewport {
  const distanceFromBottom = Math.max(0, contentHeight - viewportHeight - scrollY)
  return {
    contentHeight,
    viewportHeight,
    scrollY,
    awayFromBottom: distanceFromBottom > bottomPauseThreshold,
  }
}

export function shouldReplaceMessageScrollViewport(
  current: MessageScrollViewport,
  next: MessageScrollViewport,
  stableSizeTolerance = 8
): boolean {
  const stableSize =
    Math.abs(current.contentHeight - next.contentHeight) < stableSizeTolerance &&
    Math.abs(current.viewportHeight - next.viewportHeight) < stableSizeTolerance
  return !stableSize || current.awayFromBottom !== next.awayFromBottom
}

export function getMessageItemType(message: Message) {
  if (message.status === 'streaming' || message.status === 'sending') return `${message.role}:active`
  return `${message.role}:static`
}

export function buildAssistantNavigationItems(messages: Message[]): AssistantNavigationItem[] {
  // Keep one bounded intermediate array instead of map + filter. This helper
  // runs whenever a streamed message snapshot changes, so avoiding a second
  // full-list allocation matters for long conversations.
  const assistantMessages: Array<{ message: Message; messageIndex: number }> = []
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]
    if (message.role === 'assistant') assistantMessages.push({ message, messageIndex })
  }
  const assistantCount = assistantMessages.length
  return assistantMessages.map((item, index) => ({
    messageId: item.message.id,
    messageIndex: item.messageIndex,
    assistantIndex: index + 1,
    assistantCount,
    paragraphCount: countMessageParagraphs(item.message),
  }))
}

function countMessageParagraphs(message: Message): number {
  const text = (message.responseText ?? message.content).trim()
  if (!text) return 0
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .length || 1
}
