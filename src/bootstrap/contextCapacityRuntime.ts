import {
  createSqliteAssistantRunPersistence,
  projectContextCapacity,
  type ContextCapacityView,
} from '@/modules/assistant-runtime'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'

const runPersistence = createSqliteAssistantRunPersistence(createExpoSqliteDatabaseProvider())

export type ContextCapacityLoadResult =
  | { readonly kind: 'ready'; readonly view: ContextCapacityView }
  /** The conversation has no run that captured a context receipt yet. */
  | { readonly kind: 'empty' }
  /** The stored receipt could not be decoded. Diagnostic data only, so the caller degrades. */
  | { readonly kind: 'unreadable' }

/**
 * Reads the most recent durable context receipt for a conversation and projects
 * it for the Chat context capacity card. The receipt is captured before the
 * first provider dispatch of a run, so this describes the last request that was
 * sent, not the request a pending draft would produce.
 */
export async function loadContextCapacity(
  conversationId: string,
): Promise<ContextCapacityLoadResult> {
  if (!conversationId.trim()) return { kind: 'empty' }
  let captured
  try {
    captured = await runPersistence.getLatestContextReceipt(conversationId)
  } catch {
    return { kind: 'unreadable' }
  }
  if (!captured) return { kind: 'empty' }
  return {
    kind: 'ready',
    view: projectContextCapacity({
      runId: captured.runId,
      capturedAt: captured.capturedAt,
      receipt: captured.receipt,
    }),
  }
}
