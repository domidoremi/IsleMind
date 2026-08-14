import type {
  ConversationStorePersistencePort,
} from '@/modules/conversations'
import {
  bindConversationStorePersistence,
  releaseConversationStorePersistence,
} from '@/presentation/features/conversations/conversationStorePersistenceCommand'
import {
  readApplicationDataRecord,
  writeApplicationDataRecord,
} from './applicationDataRecords'
import { conversationPersistence } from './conversationPersistence'

export const conversationStorePersistence: ConversationStorePersistencePort =
  Object.freeze<ConversationStorePersistencePort>({
    loadRecords: () => conversationPersistence.loadAll(),
    saveRecord: (conversation) => conversationPersistence.save(conversation),
    replaceRecords: (conversations) => conversationPersistence.replaceAll(conversations),
    readActiveSelection: () =>
      readApplicationDataRecord<string | null>('ACTIVE_CONVERSATION'),
    writeActiveSelection: (conversationId) =>
      writeApplicationDataRecord('ACTIVE_CONVERSATION', conversationId),
  })

let initialized = false

export function initializeConversationStorePersistence(): void {
  if (initialized) return
  bindConversationStorePersistence(conversationStorePersistence)
  initialized = true
}

type MetroHotModule = {
  hot?: {
    dispose(callback: () => void): void
  }
}

const metroHotModule = typeof module === 'undefined'
  ? undefined
  : module as unknown as MetroHotModule

if (__DEV__) {
  metroHotModule?.hot?.dispose(() => {
    releaseConversationStorePersistence(conversationStorePersistence)
    initialized = false
  })
}
