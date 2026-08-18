import type {
  ConversationComposerDraftPersistence,
  ConversationComposerDraftRecord,
} from '@/modules/conversations'

export const CONVERSATION_COMPOSER_DRAFT_PERSISTENCE_UNINITIALIZED_ERROR =
  'conversation_composer_draft_persistence_uninitialized'
export const CONVERSATION_COMPOSER_DRAFT_PERSISTENCE_ALREADY_BOUND_ERROR =
  'conversation_composer_draft_persistence_already_bound'

let persistence: ConversationComposerDraftPersistence | undefined
const resetListeners = new Set<() => void>()

export function bindConversationComposerDraftPersistence(
  nextPersistence: ConversationComposerDraftPersistence,
): void {
  if (!persistence) {
    persistence = nextPersistence
    return
  }
  if (persistence !== nextPersistence) {
    throw new Error(CONVERSATION_COMPOSER_DRAFT_PERSISTENCE_ALREADY_BOUND_ERROR)
  }
}

export function releaseConversationComposerDraftPersistence(
  boundPersistence: ConversationComposerDraftPersistence,
): void {
  if (persistence === boundPersistence) persistence = undefined
}

export function subscribeConversationComposerDraftReset(listener: () => void): () => void {
  resetListeners.add(listener)
  return () => {
    resetListeners.delete(listener)
  }
}

export function notifyConversationComposerDraftReset(): void {
  for (const listener of [...resetListeners]) {
    try {
      listener()
    } catch {
      // One mounted Composer must not prevent the remaining reset listeners.
    }
  }
}

export function loadConversationComposerDraft(
  key: string,
): Promise<ConversationComposerDraftRecord | null> {
  return requirePersistence().load(key)
}

export function saveConversationComposerDraft(
  key: string,
  content: string,
): Promise<void> {
  return requirePersistence().save(key, content)
}

export function removeConversationComposerDraft(key: string): Promise<void> {
  return requirePersistence().remove(key)
}

function requirePersistence(): ConversationComposerDraftPersistence {
  if (!persistence) throw new Error(CONVERSATION_COMPOSER_DRAFT_PERSISTENCE_UNINITIALIZED_ERROR)
  return persistence
}
