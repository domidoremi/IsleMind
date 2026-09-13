import type { Message } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'

export interface MessageProviderIdentityInput {
  message: Pick<Message, 'providerId' | 'model'>
  conversationProvider: AIProvider | undefined
  conversationModel: string
  providers: readonly AIProvider[]
}

export interface MessageProviderIdentity {
  provider: AIProvider | undefined
  model: string
}

/**
 * Resolves the model identity captured at generation time. Historical rows
 * written before message-level identity existed remain unknown. Never borrow
 * the current Conversation's model to label historical output.
 */
export function resolveMessageProviderIdentity({
  message,
  conversationProvider,
  providers,
}: MessageProviderIdentityInput): MessageProviderIdentity {
  const providerId = message.providerId?.trim()
  const provider = providerId
    ? providers.find((item) => item.id === providerId)
      ?? (conversationProvider?.id === providerId ? conversationProvider : undefined)
    : undefined
  return {
    provider,
    model: message.model?.trim() || '',
  }
}
