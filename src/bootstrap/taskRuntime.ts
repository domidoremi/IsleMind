import { asAssistantRunId, systemClock, type IdGenerator } from '@/core'
import {
  createSqliteTaskPersistence,
  createTaskRuntime as createOwnedTaskRuntime,
  type TaskPolicyEvaluator,
  type TaskRuntime,
  type TaskEffectCursor,
} from '@/modules/tasks'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'

const databaseProvider = createExpoSqliteDatabaseProvider()
// Tasks queued before this JavaScript process started cannot still be owned by it.
const processStartedAt = systemClock.now()
const taskPersistence = createSqliteTaskPersistence(databaseProvider)
const evidenceListeners = new Set<(runId: string) => void>()
export const taskEffectHistory = {
  list: (runId: string, before?: TaskEffectCursor) => taskPersistence.listEffects(asAssistantRunId(runId), before),
  subscribe(listener: (runId: string) => void) {
    evidenceListeners.add(listener)
    return () => { evidenceListeners.delete(listener) }
  },
}
let idSequence = 0

const ids: IdGenerator = {
  next(prefix) {
    idSequence += 1
    return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  },
}

export function createTaskRuntime(policyEvaluator: TaskPolicyEvaluator): TaskRuntime {
  return createOwnedTaskRuntime({
    clock: systemClock,
    ids,
    persistence: taskPersistence,
    policyEvaluator,
    onRecorded(_entry, task) {
      if (task.runId) for (const listener of evidenceListeners) {
        try { listener(task.runId) } catch { /* A view is not an execution owner. */ }
      }
    },
  })
}

/**
 * Recovery does not evaluate new task policy; the evaluator is present only
 * because the runtime contract also supports creation. Interrupted tasks are
 * terminalized from their durable state without re-running a side effect.
 */
export function recoverInterruptedTasks() {
  const runtime = createTaskRuntime({
    async evaluate() {
      return { outcome: 'denied', reasonCode: 'recovery_does_not_create_tasks' }
    },
  })
  return runtime.recoverInterruptedTasks({ staleQueuedBefore: processStartedAt })
}
