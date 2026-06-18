import type { Message, ProcessTrace } from '@/types'
import { clampAgentOutput, redactSensitiveText } from '@/services/agent/agentTrace'

const ANDROID_UNDO_OPERATIONS_PROMPT_LIMIT = 2400
const ANDROID_UNDO_OPERATION_PROMPT_ITEM_LIMIT = 1200
const ANDROID_UNDO_OPERATION_PROMPT_MAX_ITEMS = 20
const ANDROID_UNDO_PROMPT_TEXT_LIMIT = 1400
const ANDROID_UNDO_PROMPT_FIELD_LIMIT = 360

export function buildAndroidUndoPromptContext(message: Message, emptyResponse: string): string {
  const undoTrace = findAndroidUndoFollowUpTrace(message)
  const metadata = undoTrace?.metadata
  const summary = safeChatPromptText(metadata?.androidUndoSummary, ANDROID_UNDO_PROMPT_FIELD_LIMIT)
  const undoOperations = collectAndroidUndoOperationsFromMessage(message)
  const undoOperationsJson = undoOperations.length
    ? safeChatPromptText(JSON.stringify(undoOperations, null, 2), ANDROID_UNDO_OPERATIONS_PROMPT_LIMIT)
    : ''
  const previousResult = boundedAndroidUndoResult(message) || emptyResponse
  const toolName = metadata?.androidUndoToolName === 'android.files.undo_operations'
    ? metadata.androidUndoToolName
    : 'android.files.undo_operations'
  return [
    `Undo tool: ${toolName}`,
    undoOperations.length ? `Undo operations: ${undoOperations.length}` : typeof metadata?.androidUndoOperationCount === 'number' ? `Undo operations: ${Math.max(0, Math.floor(metadata.androidUndoOperationCount))}` : '',
    undoOperationsJson ? 'Undo operations JSON:' : '',
    undoOperationsJson,
    metadata?.androidUndoRequiresVisibleConfirmation === true ? 'Visible confirmation required: yes' : 'Visible confirmation required: required before applying',
    'Delete-based rollback: unsupported',
    summary ? `Trace summary: ${summary}` : '',
    '',
    'Previous result:',
    previousResult,
  ].filter((line) => line !== '').join('\n')
}

export function boundedAndroidUndoResult(message: Message): string {
  return safeChatPromptText(message.responseText ?? message.content, ANDROID_UNDO_PROMPT_TEXT_LIMIT)
}

export function safeChatPromptText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  return clampAgentOutput(redactSensitiveText(value.trim()), limit).trim()
}

function collectAndroidUndoOperationsFromMessage(message: Message): unknown[] {
  for (const trace of collectMessageTracesForAndroidUndo(message)) {
    if (!isAndroidUndoOperationManifestTrace(trace)) continue
    const parsed = parseJsonObject(trace.content)
    const undoOperations = parsed ? readArray(parsed.undoOperations) : undefined
    const safeOperations = sanitizeAndroidUndoOperationsForPrompt(undoOperations)
    if (safeOperations.length) return safeOperations
  }
  return []
}

function findAndroidUndoFollowUpTrace(message: Message): ProcessTrace | undefined {
  return collectMessageTracesForAndroidUndo(message).find(isAndroidUndoFollowUpTrace)
}

function collectMessageTracesForAndroidUndo(message: Message): ProcessTrace[] {
  return [
    ...(message.retrievalTrace ?? []),
    ...(message.reasoning ?? []),
    ...(message.toolCalls ?? []),
  ]
    .map((trace, index) => ({ trace, index, order: resolveTraceOrder(trace, index) }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map((item) => item.trace)
}

function resolveTraceOrder(trace: ProcessTrace, fallback: number): number {
  const timestamp = trace.completedAt ?? trace.startedAt
  return typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : fallback
}

function isAndroidUndoFollowUpTrace(trace: ProcessTrace): boolean {
  const metadata = trace.metadata
  return isAgentWorkflowEnvelopeTrace(trace) &&
    typeof metadata?.androidUndoOperationCount === 'number' &&
    metadata.androidUndoOperationCount > 0 &&
    metadata.androidUndoToolName === 'android.files.undo_operations' &&
    metadata.androidUndoRequiresVisibleConfirmation === true
}

function isAndroidUndoOperationManifestTrace(trace: ProcessTrace): boolean {
  const metadata = trace.metadata
  return trace.type === 'tool' &&
    metadata?.source === 'android' &&
    metadata?.toolId === 'android:files.apply_operations'
}

function isAgentWorkflowEnvelopeTrace(trace: ProcessTrace): boolean {
  return isAgentSynthesisTrace(trace) ||
    isAgentWorkflowCompletionTrace(trace) ||
    isAgentWorkflowSkillTrace(trace)
}

function isAgentSynthesisTrace(trace: ProcessTrace): boolean {
  return trace.type === 'reasoning' && trace.title === 'Agent synthesis'
}

function isAgentWorkflowCompletionTrace(trace: ProcessTrace): boolean {
  return isAgentWorkflowEnvelopeType(trace) && trace.title === 'Agent workflow'
}

function isAgentWorkflowSkillTrace(trace: ProcessTrace): boolean {
  return isAgentWorkflowEnvelopeType(trace) && trace.title === 'Agent workflow skill'
}

function isAgentWorkflowEnvelopeType(trace: ProcessTrace): boolean {
  return trace.type === 'reasoning' || trace.type === 'system'
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value?.trim()) return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function readArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function sanitizeAndroidUndoOperationsForPrompt(value: unknown[] | undefined): unknown[] {
  if (!value?.length) return []
  return value
    .map(sanitizeAndroidUndoOperationForPrompt)
    .filter((operation): operation is Record<string, unknown> => Boolean(operation))
    .slice(0, ANDROID_UNDO_OPERATION_PROMPT_MAX_ITEMS)
}

function sanitizeAndroidUndoOperationForPrompt(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const sanitized = sanitizeAndroidUndoPromptValue(value, 0)
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) return undefined
  const serialized = JSON.stringify(sanitized)
  if (serialized.length <= ANDROID_UNDO_OPERATION_PROMPT_ITEM_LIMIT) return sanitized as Record<string, unknown>
  const record = sanitized as Record<string, unknown>
  return {
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    ...(typeof record.action === 'string' ? { action: record.action } : {}),
    ...(typeof record.sourceName === 'string' ? { sourceName: record.sourceName } : {}),
    ...(typeof record.targetName === 'string' ? { targetName: record.targetName } : {}),
    requiresUserConfirmation: record.requiresUserConfirmation === true,
    truncated: true,
  }
}

function sanitizeAndroidUndoPromptValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return safeChatPromptText(value, ANDROID_UNDO_PROMPT_FIELD_LIMIT)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) {
    if (depth >= 3) return '[redacted]'
    return value.slice(0, ANDROID_UNDO_OPERATION_PROMPT_MAX_ITEMS).map((item) => sanitizeAndroidUndoPromptValue(item, depth + 1))
  }
  if (value && typeof value === 'object') {
    if (depth >= 3) return '[redacted]'
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value).slice(0, 32)) {
      const safeKey = safeChatPromptText(key, 80)
      if (!safeKey) continue
      result[safeKey] = isSensitivePromptKey(safeKey) ? '[redacted]' : sanitizeAndroidUndoPromptValue(child, depth + 1)
    }
    return result
  }
  return undefined
}

function isSensitivePromptKey(value: string): boolean {
  return /(api[_-]?key|authorization|bearer|password|secret|token)/i.test(value)
}
