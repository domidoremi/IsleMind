import { systemClock, type IdGenerator } from '@/core'
import {
  createSqliteTaskPersistence,
  createTaskRuntime,
  type TaskPolicyEvaluator,
  type TaskRuntime,
} from '@/modules/tasks'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'

const databaseProvider = createExpoSqliteDatabaseProvider()
const taskPersistence = createSqliteTaskPersistence(databaseProvider)
let idSequence = 0

const ids: IdGenerator = {
  next(prefix) {
    idSequence += 1
    return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  },
}

export function createVNextTaskRuntime(policyEvaluator: TaskPolicyEvaluator): TaskRuntime {
  return createTaskRuntime({
    clock: systemClock,
    ids,
    persistence: taskPersistence,
    policyEvaluator,
  })
}

/**
 * Recovery does not evaluate new task policy; the evaluator is present only
 * because the runtime contract also supports creation. Interrupted tasks are
 * terminalized from their durable state without re-running a side effect.
 */
export function recoverVNextInterruptedTasks() {
  const runtime = createVNextTaskRuntime({
    async evaluate() {
      return { outcome: 'denied', reasonCode: 'recovery_does_not_create_tasks' }
    },
  })
  return runtime.recoverInterruptedTasks()
}
