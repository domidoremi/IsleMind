import type {
  ConversationPage,
  ConversationPageInput,
  ConversationStorePersistencePort,
} from '@/modules/conversations'
import type { Conversation } from '@/types/chatContracts'
import { conversationScenePlanRevision, copyConversationScenePlanPreferences, CONVERSATION_SCENE_PLAN_CONFLICT, CONVERSATION_SCENE_PLAN_MISSING } from '@/modules/conversations'

export const CONVERSATION_STORE_PERSISTENCE_UNINITIALIZED_ERROR =
  'conversation_store_persistence_uninitialized'
export const CONVERSATION_STORE_PERSISTENCE_ALREADY_BOUND_ERROR =
  'conversation_store_persistence_already_bound'

let persistence: ConversationStorePersistencePort | undefined
let mutationTail: Promise<void> = Promise.resolve()
let activeSelectionMutationTail: Promise<void> = Promise.resolve()

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

export function loadConversationPage(input?: ConversationPageInput): Promise<ConversationPage> {
  return requirePersistence().loadPage(input)
}

export function loadConversationRecord(conversationId: string): Promise<Conversation | undefined> {
  const boundPersistence = requirePersistence()
  // An addressed read requested after deletion must observe that queued write.
  return mutationTail.then(() => boundPersistence.loadRecord(conversationId))
}

export function saveConversationRecord(conversation: Conversation): Promise<void> {
  const boundPersistence = requirePersistence()
  return enqueueConversationMutation(() => boundPersistence.saveRecord(conversation))
}

export function deleteConversationRecord(conversationId: string): Promise<void> {
  const boundPersistence = requirePersistence()
  return enqueueConversationMutation(() => boundPersistence.deleteRecord(conversationId))
}

/** Compare after earlier queued saves/deletes, immediately before the canonical save. */
export function saveConversationScenePlanRecord(
  conversation: Conversation, expectedRevision: string, validate: () => Promise<boolean>,
): Promise<void> {
  const boundPersistence = requirePersistence()
  return enqueueConversationMutation(async () => {
    const current = await boundPersistence.loadRecord(conversation.id)
    if (!current) throw new Error(CONVERSATION_SCENE_PLAN_MISSING)
    if (conversationScenePlanRevision(current) !== expectedRevision || !await validate()) throw new Error(CONVERSATION_SCENE_PLAN_CONFLICT)
    await boundPersistence.saveRecord(copyConversationScenePlanPreferences(current, conversation))
  })
}

export function replaceConversationRecords(
  conversations: readonly Conversation[],
): Promise<void> {
  const boundPersistence = requirePersistence()
  return enqueueConversationMutation(() => boundPersistence.replaceRecords(conversations))
}

export function readActiveConversationSelection(): Promise<string | null> {
  return requirePersistence().readActiveSelection()
}

export function writeActiveConversationSelection(
  conversationId: string | null,
): Promise<void> {
  const boundPersistence = requirePersistence()
  return enqueueActiveSelectionMutation(() => boundPersistence.writeActiveSelection(conversationId))
}

function requirePersistence(): ConversationStorePersistencePort {
  if (!persistence) throw new Error(CONVERSATION_STORE_PERSISTENCE_UNINITIALIZED_ERROR)
  return persistence
}

function enqueueConversationMutation(operation: () => Promise<void>): Promise<void> {
  const result = mutationTail.then(operation, operation)
  mutationTail = result.catch(() => undefined)
  return result
}

function enqueueActiveSelectionMutation(operation: () => Promise<void>): Promise<void> {
  const result = activeSelectionMutationTail.then(operation, operation)
  activeSelectionMutationTail = result.catch(() => undefined)
  return result
}
