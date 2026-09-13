import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import { resolveProviderModelAlias } from '@/utils/providerModels'

/** Kept only by the visible UI for a turn it observes; not a persisted preference. */
export interface ReplyPreferenceSnapshot {
  conversationId: string
  responseMessageId: string
  userMessageId?: string
  providerId: string
  model: string
}

export function projectReplyFallback(snapshot: ReplyPreferenceSnapshot | undefined, conversation: Conversation, providers: readonly AIProvider[]) {
  if (!snapshot || snapshot.conversationId !== conversation.id || snapshot.providerId !== conversation.providerId || snapshot.model !== conversation.model) return undefined
  if (conversation.messages.findLast((item) => item.role === 'user')?.id !== snapshot.userMessageId) return undefined
  const message = conversation.messages.find((item) => item.id === snapshot.responseMessageId)
  // A candidate approval or historical metadata is not evidence that a route produced output.
  if (!message?.generationProtocol || !message.providerId || !message.model) return undefined
  const provider = providers.find((item) => item.id === snapshot.providerId)
  const upstream = provider ? resolveProviderModelAlias(provider, snapshot.model) : snapshot.model
  if (message.providerId === snapshot.providerId && message.model === upstream) return undefined
  return { preferred: { providerId: snapshot.providerId, model: snapshot.model },
    actual: { providerId: message.providerId, model: message.model }, streaming: message.status === 'streaming' }
}
