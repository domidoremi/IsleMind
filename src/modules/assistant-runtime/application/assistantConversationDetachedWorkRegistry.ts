/**
 * A lease for work that continues after the request that produced a reply has
 * completed. The signal belongs to this lease and must not be replaced by the
 * request signal; release/settle only detaches this exact lease.
 */
export interface AssistantConversationDetachedWorkLease {
  readonly signal: AbortSignal
  release(): void
  /** Alias for callers that model completion as settling a detached job. */
  settle(): void
}

export interface AssistantConversationDetachedWorkRegistration {
  readonly conversationId: string
  readonly workId: string
}

export interface AssistantConversationDetachedWorkRegistry {
  /**
   * Registers (or replaces) one detached job. Replacing the same conversation
   * and work ID aborts the previous job before exposing the new lease.
   */
  acquire(
    input: AssistantConversationDetachedWorkRegistration,
  ): AssistantConversationDetachedWorkLease
  /** Cancel and remove every detached job owned by one conversation. */
  cancelConversation(conversationId: string): void
  /** Cancel and remove every detached job, for shutdown or data replacement. */
  cancelAll(): void
}

interface DetachedWorkEntry {
  readonly controller: AbortController
  readonly conversationId: string
  readonly workId: string
}

/**
 * Creates an instance-owned registry for post-reply assistant work.
 *
 * There is intentionally no module-level registry: bootstrap owns the
 * instance and can cancel it when the app shuts down or replaces its data.
 */
export function createAssistantConversationDetachedWorkRegistry(): AssistantConversationDetachedWorkRegistry {
  const active = new Map<string, Map<string, DetachedWorkEntry>>()

  function acquire(
    input: AssistantConversationDetachedWorkRegistration,
  ): AssistantConversationDetachedWorkLease {
    const conversationWork = active.get(input.conversationId)
      ?? new Map<string, DetachedWorkEntry>()
    const previous = conversationWork.get(input.workId)
    if (previous) {
      previous.controller.abort()
    }

    const entry: DetachedWorkEntry = {
      controller: new AbortController(),
      conversationId: input.conversationId,
      workId: input.workId,
    }
    conversationWork.set(input.workId, entry)
    active.set(input.conversationId, conversationWork)

    let released = false
    const release = (): void => {
      if (released) return
      released = true

      // A late release from a replaced/cancelled job must never remove the
      // newer lease that now owns the same conversation/work key.
      if (conversationWork.get(entry.workId) !== entry) return
      conversationWork.delete(entry.workId)
      if (conversationWork.size === 0) {
        active.delete(entry.conversationId)
      }
    }

    return {
      signal: entry.controller.signal,
      release,
      settle: release,
    }
  }

  function cancelConversation(conversationId: string): void {
    const conversationWork = active.get(conversationId)
    if (!conversationWork) return
    active.delete(conversationId)
    for (const entry of conversationWork.values()) {
      entry.controller.abort()
    }
  }

  function cancelAll(): void {
    const conversationWork = [...active.values()]
    active.clear()
    for (const work of conversationWork) {
      for (const entry of work.values()) {
        entry.controller.abort()
      }
    }
  }

  return { acquire, cancelConversation, cancelAll }
}
