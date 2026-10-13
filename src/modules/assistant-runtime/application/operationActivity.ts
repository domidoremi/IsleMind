import { redactSensitiveText, sanitizeTraceDisplayText, type ProcessTrace } from '@/core'
import type { RunJournalEntry } from '../contracts'


/** Shared by Chat and the Agent task UI. Only a receipt can settle an operation. */
export function projectOperationActivity(entry: RunJournalEntry, outputLimit = 2400): ProcessTrace | undefined {
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
    : data.status === 'succeeded' ? 'done' : data.code === 'batch_stopped' ? 'skipped' : 'error'
  return {
    id: `model-operation:${entry.runId}:${step}:${callId}`,
    type: 'tool', title: redactSensitiveText(operationId), status,
    startedAt: entry.occurredAt,
    ...(!started && !pending ? { completedAt: entry.occurredAt } : {}),
    content: started ? '' : sanitizeTraceDisplayText(data.output, outputLimit),
    metadata: {
      toolId: operationId, toolName: operationId,
      errorCode: pending ? 'permission_required' : status === 'error' || cancelled ? data.code : '',
      code: started ? '' : data.code,
      ...(started ? { inputSummary: sanitizeTraceDisplayText(data.inputSummary, 2400) } : {}),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
