import { useSyncExternalStore } from 'react'

import {
  getConversationLockRevision,
  isConversationLocked,
  subscribeConversationLocks,
} from '@/services/conversationLock'

export function useConversationLock(conversationId: string | undefined): boolean {
  return useSyncExternalStore(
    subscribeConversationLocks,
    () => {
      getConversationLockRevision()
      return conversationId ? isConversationLocked(conversationId) : false
    },
    () => false,
  )
}
