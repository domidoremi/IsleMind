import type { Message } from '@/types/chatContracts'

export type ConversationMessageActionInput = Pick<Message, 'content' | 'responseText'>

export interface ConversationMessageActionControllerDependencies {
  writeText(text: string): Promise<unknown>
}

export interface ConversationMessageActionController {
  copyFinalText(message: ConversationMessageActionInput): Promise<void>
}

/**
 * Presentation-owned final-message actions. Clipboard access stays injected so
 * selecting the visible final text remains deterministic and platform-free.
 */
export function createConversationMessageActionController(
  dependencies: ConversationMessageActionControllerDependencies,
): ConversationMessageActionController {
  return {
    async copyFinalText(message) {
      const finalText = message.responseText ?? message.content
      if (!finalText.trim()) return

      await dependencies.writeText(finalText)
    },
  }
}
