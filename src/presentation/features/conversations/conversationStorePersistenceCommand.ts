import type {
  ConversationStorePersistencePort,
} from '@/modules/conversations'
import type { Conversation } from '@/types/chatContracts'

export const CONVERSATION_STORE_PERSISTENCE_UNINITIALIZED_ERROR =
  'conversation_store_persistence_uninitialized'
export const CONVERSATION_STORE_PERSISTENCE_ALREADY_BOUND_ERROR =
  'conversation_store_persistence_already_bound'

let persistence: ConversationStorePersistencePort | undefined

export function bindConversationStorePersistence(
  nextPersistence: ConversationStorePersistencePort,
): void {
  if (!persistence) {
    persistence = nextPersistence
    return
  }
  if (persistence !== nextPersistence) {
    throw new Error(CONVERSATION_STORE_PERSISTENCE_ALREADY_BOUND_ERROR)
  }
}

export function releaseConversationStorePersistence(
  boundPersistence: ConversationStorePersistencePort,
): void {
  if (persistence === boundPersistence) persistence = undefined
}

export function loadConversationRecords(): Promise<readonly Conversation[]> {
  return requirePersistence().loadRecords()
}

export function saveConversationRecord(conversation: Conversation): Promise<void> {
  return requirePersistence().saveRecord(conversation)
}

export function replaceConversationRecords(
  conversations: readonly Conversation[],
): Promise<void> {
  return requirePersistence().replaceRecords(conversations)
}

export function readActiveConversationSelection(): Promise<string | null> {
  return requirePersistence().readActiveSelection()
}

export function writeActiveConversationSelection(
  conversationId: string | null,
): Promise<void> {
  return requirePersistence().writeActiveSelection(conversationId)
}

function requirePersistence(): ConversationStorePersistencePort {
  if (!persistence) throw new Error(CONVERSATION_STORE_PERSISTENCE_UNINITIALIZED_ERROR)
  return persistence
}
