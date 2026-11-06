import {
  createSqliteAssistantRunPersistence,
  projectContextCapacity,
  type ContextCapacityView,
} from '@/modules/assistant-runtime'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'
import { loadAssistantRunUsageAttempts } from './usageStatisticsRuntime'

const runPersistence = createSqliteAssistantRunPersistence(createExpoSqliteDatabaseProvider())

export type ContextCapacityLoadResult =
  | { readonly kind: 'ready'; readonly view: ContextCapacityView; readonly reportedInput?: ContextReportedInput }
  /** The conversation has no run that captured a context receipt yet. */
  | { readonly kind: 'empty' }
  /** The stored receipt could not be decoded. Diagnostic data only, so the caller degrades. */
  | { readonly kind: 'unreadable' }

export interface ContextReportedInput {
  readonly attemptId: string
  readonly tokens: number
  readonly recordedAt: number
}

/**
 * Reads the most recent durable context receipt for a conversation and projects
 * it for the Chat context capacity card. The receipt is captured before the
 * first provider dispatch of a run. It describes the latest captured request
 * plan, not proof that a provider received or completed it.
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
  const view = projectContextCapacity({
    runId: captured.runId,
    capturedAt: captured.capturedAt,
    receipt: captured.receipt,
  })
  // Exact run counters are bounded. Missing or mismatched attribution is
  // unknown; never substitute another conversation, continuation, or estimate.
  let reportedInput: ContextReportedInput | undefined
  try {
    const { records, truncated } = await loadAssistantRunUsageAttempts(view.runId, view.providerId)
    const matches = records.filter(record => record.runId === view.runId
      && record.conversationId === conversationId && record.providerId === view.providerId
      && record.upstreamModel === view.model && record.operationSource === 'chat'
      && record.status === 'success' && record.measurementSource === 'provider'
      && record.dataSource === 'live-provider' && Number.isSafeInteger(record.tokens.inputTokens)
      && record.tokens.inputTokens! >= 0)
    if (!truncated && matches.length === 1) reportedInput = {
      attemptId: matches[0].id, tokens: matches[0].tokens.inputTokens!, recordedAt: matches[0].completedAt,
    }
  } catch {
    // Optional diagnostic usage cannot hide the durable context plan.
  }
  return {
    kind: 'ready',
    view,
    ...(reportedInput ? { reportedInput } : {}),
  }
}
