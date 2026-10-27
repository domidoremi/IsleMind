import { isMessageResponseActive } from '@/modules/conversations'

export interface GlobalGenerationStatus {
  conversationId: string
  conversationTitle: string
  messageId: string
}

export function resolveGlobalGenerationStatus(
  conversations: ReadonlyArray<{ id: string; title?: string; messages: ReadonlyArray<{ id: string; role: string; status?: string; responseLifecycle?: { stage?: string } }> }>,
  activeStreams: ReadonlyMap<string, boolean>,
): GlobalGenerationStatus | null {
  for (const conversation of conversations) {
    const message = conversation.messages.find((item) =>
      isMessageResponseActive(item) &&
      activeStreams.get(`${conversation.id}:${item.id}`) === true,
    )
    if (!message) continue
    return {
      conversationId: conversation.id,
      conversationTitle: conversation.title?.trim() ?? '',
      messageId: message.id,
    }
  }
  return null
}
