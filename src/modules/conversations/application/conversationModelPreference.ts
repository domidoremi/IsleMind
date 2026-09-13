import type { Conversation } from '@/types/chatContracts'

/** Blank/partial legacy pairs are readable, but cannot be dispatched. */
export function hasConversationModelPreference<T extends { providerId?: string | null; model?: string | null }>(
  conversation: T,
): conversation is T & { providerId: string; model: string } {
  return typeof conversation.providerId === 'string' && !!conversation.providerId.trim()
    && typeof conversation.model === 'string' && !!conversation.model.trim()
}

/** Explicit user selection only. Runtime fallback must never call this reducer. */
export function applyConversationModelPreference(
  conversation: Conversation,
  preference: { providerId: string; model: string },
  now: number,
): Conversation {
  if (!hasConversationModelPreference(preference)) throw new TypeError('A complete provider/model preference is required.')
  return { ...conversation, providerId: preference.providerId.trim(), model: preference.model.trim(), providerModelMode: 'manual', updatedAt: now }
}
