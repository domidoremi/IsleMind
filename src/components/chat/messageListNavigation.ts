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
  const assistantMessages = messages
    .map((message, messageIndex) => ({ message, messageIndex }))
    .filter((item) => item.message.role === 'assistant')
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
