import {
  createConversationComposerDraftPersistence,
  type ConversationComposerDraftEnvelope,
} from '@/modules/conversations'
import {
  bindConversationComposerDraftPersistence,
  notifyConversationComposerDraftReset,
  releaseConversationComposerDraftPersistence,
} from '@/presentation/features/conversations/conversationComposerDraftCommand'
import {
  readApplicationDataRecord,
  removeApplicationDataRecord,
  writeApplicationDataRecord,
} from './applicationDataRecords'

export const conversationComposerDraftPersistence = createConversationComposerDraftPersistence({
  storage: {
    read: () => readApplicationDataRecord<ConversationComposerDraftEnvelope>('COMPOSER_DRAFTS'),
    write: (envelope) => writeApplicationDataRecord('COMPOSER_DRAFTS', envelope),
    remove: () => removeApplicationDataRecord('COMPOSER_DRAFTS'),
  },
})

let initialized = false

export function initializeConversationComposerDraftPersistence(): void {
  if (initialized) return
  bindConversationComposerDraftPersistence(conversationComposerDraftPersistence)
  initialized = true
}

export async function clearConversationComposerDraftPersistence(): Promise<void> {
  // Cancel mounted write timers before the serialized storage clear starts.
  // Otherwise a timer that fires while removal is pending could enqueue a stale write after reset.
  notifyConversationComposerDraftReset()
  await conversationComposerDraftPersistence.clear()
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
    releaseConversationComposerDraftPersistence(conversationComposerDraftPersistence)
    initialized = false
  })
}
