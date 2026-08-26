import type { MessageRole } from '@/types/chatContracts'

export type MessageBubbleRowAlignment = 'flex-start' | 'flex-end'

/** Formula and rich-content width may grow, but role direction never changes. */
export function resolveMessageBubbleRowAlignment(role: MessageRole): MessageBubbleRowAlignment {
  return role === 'user' ? 'flex-end' : 'flex-start'
}
