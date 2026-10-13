import { measureJsonCharacters } from '@/core'
import type { AssistantRunId, TaskId } from '@/core'
import type { Task, TaskEffectIntent, TaskEffectReceipt, TaskJournalEntry } from '../contracts'

export const MAX_TASK_EFFECTS = 64
export const TASK_EFFECT_JSON_LIMIT = 16_384

export interface TaskEffectActivity {
  taskId: TaskId
  toolId: string
  startedAt: number
  intent: TaskEffectIntent
  receipt?: TaskEffectReceipt
  /** Missing evidence is never projected as success, even for a terminal task. */
  state: 'running' | 'uncertain' | TaskEffectReceipt['status']
}
export interface TaskEffectCursor { createdAt: number; taskId: string; sequence: number }
export interface TaskEffectPage { entries: readonly TaskEffectActivity[]; before?: TaskEffectCursor }
export interface TaskEffectHistory {
  listEffects(runId: AssistantRunId, before?: TaskEffectCursor): Promise<TaskEffectPage>
}

export function projectTaskEffect(task: Pick<Task, 'id' | 'toolId' | 'status' | 'cancellationRequestedAt'>,
  startedAt: number, intent: TaskEffectIntent, receipt?: TaskEffectReceipt): TaskEffectActivity {
  return { taskId: task.id, toolId: task.toolId, startedAt, intent, ...(receipt ? { receipt } : {}),
    state: receipt?.status ?? (task.status === 'running' && task.cancellationRequestedAt === undefined ? 'running' : 'uncertain') }
}

/** Compact feedback is separate from full local evidence, so model truncation
 * cannot erase receipts or turn a cancelled/partial write into a safe retry. */
export function summarizeTaskEffects(task: Task, journal: readonly TaskJournalEntry[]): string | undefined {
  const effects = new Map<string, TaskEffectReceipt | undefined>()
  for (const entry of journal) {
    if (entry.type === 'task.effect-started') {
      const intent = freezeTaskEffectIntent(entry.data?.intent)
      if (effects.has(intent.id) || effects.size >= MAX_TASK_EFFECTS) throw new Error('Invalid effect history')
      effects.set(intent.id, undefined)
    } else if (entry.type === 'task.effect-settled') {
      const receipt = freezeTaskEffectReceipt(entry.data?.receipt)
      if (!effects.has(receipt.id) || effects.get(receipt.id)) throw new Error('Unpaired effect receipt')
      effects.set(receipt.id, receipt)
    }
  }
  if (!effects.size) return undefined
  const counts = { applied: 0, partial: 0, uncertain: 0, none: 0, succeeded: 0, failed: 0, cancelled: 0, skipped: 0, missing: 0 }
  for (const receipt of effects.values()) {
    if (!receipt) { counts.missing++; counts.uncertain++ }
    else { counts[receipt.effect]++; counts[receipt.status]++ }
  }
  return `Durable local effects for task ${task.id} (task status: ${task.status}): ${JSON.stringify(counts)}. `
    + 'Task cancellation does not undo applied effects. Missing receipts are uncertain, not evidence of no change. '
    + 'Inspect the per-operation Tasks ledger before any retry; this summary is not permission to replay.'
}

export function freezeTaskEffectIntent(input: unknown): TaskEffectIntent {
  const value = copyRecord(input)
  if (!only(value, ['id', 'kind', 'action', 'sourceUri', 'sourceParentUri', 'targetParentUri', 'targetName'])
    || !identity(value.id) || value.kind !== 'file' || !['mkdir', 'copy', 'move', 'rename'].includes(String(value.action))
    || !['sourceUri', 'sourceParentUri', 'targetParentUri'].every(key => value[key] === undefined || uri(value[key]))
    || value.targetName !== undefined && (typeof value.targetName !== 'string' || !value.targetName || value.targetName.length > 255)) {
    throw new Error('Invalid task effect intent')
  }
  return Object.freeze(value) as unknown as TaskEffectIntent
}

export function freezeTaskEffectReceipt(input: unknown): TaskEffectReceipt {
  const value = copyRecord(input)
  if (!only(value, ['id', 'status', 'effect', 'targetUri', 'bytesCopied', 'completedSteps', 'reason'])
    || !identity(value.id) || !['succeeded', 'failed', 'cancelled', 'skipped'].includes(String(value.status))
    || !['none', 'applied', 'partial', 'uncertain'].includes(String(value.effect))
    || value.targetUri !== undefined && !uri(value.targetUri)
    || typeof value.bytesCopied !== 'number' || !Number.isSafeInteger(value.bytesCopied) || value.bytesCopied < 0 || value.bytesCopied > 64 * 1024 * 1024
    || value.reason !== undefined && (typeof value.reason !== 'string' || value.reason.length > 100)
    || value.completedSteps !== undefined && (!Array.isArray(value.completedSteps) || value.completedSteps.length > 2
      || value.completedSteps.some(step => !['created', 'copied', 'moved', 'renamed'].includes(step)))
    || value.status === 'succeeded' && (value.effect === 'partial' || value.effect === 'uncertain')
    || value.status === 'skipped' && value.effect !== 'none'
    || value.effect === 'none' && (value.bytesCopied !== 0 || Array.isArray(value.completedSteps) && value.completedSteps.length !== 0)) throw new Error('Invalid task effect receipt')
  if (Array.isArray(value.completedSteps)) Object.freeze(value.completedSteps)
  return Object.freeze(value) as unknown as TaskEffectReceipt
}

function copyRecord(value: unknown): Record<string, unknown> {
  measureJsonCharacters(value, TASK_EFFECT_JSON_LIMIT, 80)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid task effect')
  return JSON.parse(JSON.stringify(value))
}
function only(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).every(key => keys.includes(key)) }
function identity(value: unknown) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) }
function uri(value: unknown) { return typeof value === 'string' && value.startsWith('content://') && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value) }
