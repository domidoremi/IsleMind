const lockedConversationCounts = new Map<string, number>()
const listeners = new Set<() => void>()
let revision = 0

export const CONVERSATION_LOCK_REASON = 'conversation_locked_during_context_compression'

export function lockConversation(conversationId: string): () => void {
  const id = conversationId.trim()
  if (!id) return () => undefined
  lockedConversationCounts.set(id, (lockedConversationCounts.get(id) ?? 0) + 1)
  notify()
  let released = false
  return () => {
    if (released) return
    released = true
    const count = lockedConversationCounts.get(id) ?? 0
    if (count <= 1) lockedConversationCounts.delete(id)
    else lockedConversationCounts.set(id, count - 1)
    notify()
  }
}

export function isConversationLocked(conversationId: string): boolean {
  return (lockedConversationCounts.get(conversationId) ?? 0) > 0
}

export function assertConversationUnlocked(conversationId: string): void {
  if (isConversationLocked(conversationId)) throw new Error(CONVERSATION_LOCK_REASON)
}

export function subscribeConversationLocks(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getConversationLockRevision(): number {
  return revision
}

export function resetConversationLocksForTests(): void {
  lockedConversationCounts.clear()
  notify()
}

function notify(): void {
  revision += 1
  listeners.forEach((listener) => listener())
}
