import { measureJsonCharacters, sanitizeTraceMetadataValue, sanitizeTraceDisplayText, type ProcessTrace } from '@/core'
import { decodeModelOperationBatch, isModelOperationConfirmationExpired, MODEL_OPERATION_CONFIRMATION_TTL_MS, type AssistantRun } from '@/modules/assistant-runtime'
import type { TaskEffectActivity } from '@/modules/tasks'

/** Display data only; approval still submits the exact rendered continuation identity. */
export function agentConfirmationPreview(run: AssistantRun) {
  const pending = run.pendingModelOperation
  if (!pending) return undefined
  try {
    const call = pending.continuationState.call
    if (!isRecord(call) || call.operationId !== pending.operationId || !isRecord(call.arguments)) return undefined
    // Deliberately exclude providerMetadata, reasoning replay and continuation tokens.
    const display = { operationId: call.operationId, arguments: call.arguments }
    measureJsonCharacters(display, 16_000)
    const parameters = JSON.stringify(sanitizeTraceMetadataValue(call.arguments), null, 2)
    if (parameters.length > 24_000) return undefined
    const queued = pending.continuationState.operationBatch
    const batch = queued ? decodeModelOperationBatch(queued) : undefined
    if (batch && (batch.calls[batch.receipts.length]?.callId !== pending.callId
      || batch.startStepIndex + batch.receipts.length !== pending.stepIndex)) return undefined
    return { operation: sanitizeTraceDisplayText(call.operationId, 320), parameters,
      ...(batch ? { position: batch.receipts.length + 1, total: batch.calls.length } : {}) }
  } catch { return undefined }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Rejections recorded before any executor dispatch; the operation did not run. */
const NOT_EXECUTED_CODES = new Set(['confirmation_expired', 'authorization_denied', 'confirmation_state_invalid',
  'catalog_revision_mismatch', 'confirmation_already_consumed', 'step_limit_reached', 'arguments_invalid',
  'operation_unavailable', 'operation_identity_mismatch', 'schema_revision_mismatch', 'catalog_not_frozen', 'multiple_operations_requested'])

/** A run's final answer is not evidence that an unfinished operation succeeded. */
export function agentActivityState(trace: ProcessTrace, run: AssistantRun) {
  if (trace.status === 'pending') {
    if (run.status === 'cancelled') return 'cancelled'
    // A terminal run cannot approve it anymore; it never dispatched.
    return run.status === 'succeeded' || run.status === 'failed' ? 'notExecuted' : 'waiting'
  }
  if (trace.status === 'error' && NOT_EXECUTED_CODES.has(String(trace.metadata?.code ?? ''))) return 'notExecuted'
  if (trace.status !== 'running') return trace.status
  if (run.status === 'running' && !run.cancellationRequestedAt) return 'running'
  if (run.lifecycleCheckpoint?.effectCertainty === 'uncertain') return 'uncertain'
  return 'incomplete'
}

export type AgentTone = 'default' | 'mint' | 'amber' | 'danger'

/** Visual tone only; wording always comes from the actual durable state. */
export function agentRunTone(run: AssistantRun): AgentTone {
  if (run.lifecycleCheckpoint?.effectCertainty === 'uncertain' && run.status !== 'running') return 'amber'
  if (run.status === 'succeeded') return 'mint'
  if (run.status === 'failed') return 'danger'
  if (run.status === 'awaiting-confirmation' || run.status === 'paused') return 'amber'
  return 'default'
}

export function agentStateTone(state: string): AgentTone {
  if (state === 'done' || state === 'succeeded') return 'mint'
  if (state === 'error' || state === 'failed') return 'danger'
  if (['waiting', 'uncertain', 'incomplete', 'skipped', 'partial', 'notExecuted'].includes(state)) return 'amber'
  return 'default'
}

/** Paused runs whose last operation outcome is unknown can only be inspected and stopped. */
export function agentRecoveryMode(run: AssistantRun): 'resumable' | 'reconciliation' | undefined {
  if (run.status !== 'paused') return undefined
  const checkpoint = run.lifecycleCheckpoint
  if (checkpoint?.effectCertainty === 'uncertain' || checkpoint?.recovery === 'reconciliation-required') return 'reconciliation'
  return checkpoint?.recovery === 'resumable' ? 'resumable' : undefined
}

export function agentConfirmationExpiry(run: AssistantRun, now: number) {
  const pending = run.pendingModelOperation
  if (!pending) return undefined
  return { expiresAt: pending.requestedAt + MODEL_OPERATION_CONFIRMATION_TTL_MS,
    expired: isModelOperationConfirmationExpired(pending.requestedAt, now) }
}

const KNOWN_RECEIPT_CODES = new Set(['confirmation_declined', 'confirmation_expired', 'authorization_denied', 'batch_stopped',
  'confirmation_already_consumed', 'confirmation_state_invalid', 'catalog_revision_mismatch', 'execution_failed', 'cancelled',
  'permission_required', 'confirmation_required', 'step_limit_reached', 'arguments_invalid', 'operation_unavailable'])

/** Receipt codes are data; unknown codes are displayed verbatim (bounded), never mapped to success. */
export function agentReceiptCode(code: unknown): { key?: string; raw: string } | undefined {
  if (typeof code !== 'string' || !code) return undefined
  const raw = sanitizeTraceDisplayText(code, 120)
  return KNOWN_RECEIPT_CODES.has(code) ? { key: `agentTasks.code.${code}`, raw } : { raw }
}

/** Human-readable receipt rows; URIs remain selectable evidence rather than parsed display names. */
export function agentEffectRows(entry: TaskEffectActivity) {
  const { intent, receipt } = entry
  const rows: { label: string; value: string }[] = []
  const push = (label: string, value: unknown) => {
    if (typeof value === 'string' && value) rows.push({ label, value: sanitizeTraceDisplayText(value, 4096) })
  }
  push('targetName', intent.targetName)
  push('sourceUri', intent.sourceUri)
  push('sourceParentUri', intent.sourceParentUri)
  push('targetParentUri', intent.targetParentUri)
  if (receipt) {
    push('targetUri', receipt.targetUri)
    rows.push({ label: 'bytesCopied', value: String(receipt.bytesCopied) })
    if (receipt.completedSteps?.length) rows.push({ label: 'completedSteps', value: receipt.completedSteps.join(' → ') })
    push('reason', receipt.reason)
  }
  return rows
}

/** Partial, uncertain and missing receipts require target inspection before any new request. */
export function agentEffectNeedsReview(entry: TaskEffectActivity) {
  return !entry.receipt || entry.state === 'uncertain' || entry.receipt.effect === 'partial' || entry.receipt.effect === 'uncertain'
}
