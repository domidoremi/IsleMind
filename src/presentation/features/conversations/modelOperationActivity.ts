import { redactSensitiveText, sanitizeTraceDisplayText, type ProcessTrace } from '@/core'
import type { ConversationRunProjectionEvent } from '@/modules/conversations'

/** Journal receipts, not message completion or model narration, settle an activity. */
export function modelOperationActivity(event: ConversationRunProjectionEvent): ProcessTrace | undefined {
  const entry = event.journalEntry
  if (!entry) return undefined
  const started = entry.type === 'run.checkpointed' && entry.data?.phase === 'operation'
  const result = entry.type === 'model-operation.selected' || entry.type === 'run.awaiting-confirmation'
  const data = started ? entry.data?.operation : result ? entry.data?.receipt : undefined
  if (!isRecord(data)) return undefined
  if (!started && data.schema !== 'islemind.model-operation-receipt.v1') return undefined
  const step = started ? entry.data?.stepIndex : data.stepIndex
  if (typeof step !== 'number' || !Number.isSafeInteger(step) || step < 0) return undefined
  const operationId = typeof data.operationId === 'string' ? data.operationId : 'tool'
  const callId = typeof data.callId === 'string' ? data.callId : `step-${step}`
  const pending = data.status === 'pending_confirmation'
  const cancelled = data.status === 'cancelled' || data.code === 'confirmation_declined'
  const status = started ? 'running' : pending ? 'pending' : cancelled ? 'cancelled'
    : data.status === 'succeeded' ? 'done' : 'error'
  return {
    id: `model-operation:${event.run.id}:${step}:${callId}`,
    type: 'tool',
    title: redactSensitiveText(operationId),
    status,
    startedAt: entry.occurredAt,
    ...(!started && !pending ? { completedAt: entry.occurredAt } : {}),
    ...(!started ? { content: safeResult(data.output) } : { content: '' }),
    metadata: {
      toolId: operationId,
      toolName: operationId,
      // Explicitly clear the previous pending state when the same call resumes.
      errorCode: pending ? 'permission_required' : status === 'error' || cancelled ? data.code : '',
      code: started ? '' : data.code,
      ...(started ? { inputSummary: safeResult(data.inputSummary) } : {}),
    },
  }
}

function safeResult(value: unknown): string {
  return sanitizeTraceDisplayText(value, 2400)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
