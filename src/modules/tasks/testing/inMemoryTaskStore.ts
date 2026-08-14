import type { TaskId } from '@/core'
import type { Task, TaskJournalEntry, TaskPersistence } from '@/modules/tasks'

export interface InMemoryTaskStore extends TaskPersistence {
  clear(): void
}

export function createInMemoryTaskStore(): InMemoryTaskStore {
  const tasks = new Map<TaskId, Task>()
  const entriesByTask = new Map<TaskId, TaskJournalEntry[]>()

  return {
    async get(taskId) {
      const task = tasks.get(taskId)
      return task ? cloneTask(task) : undefined
    },

    async findByIdempotencyKey(idempotencyKey) {
      const task = Array.from(tasks.values()).find((item) => item.idempotencyKey === idempotencyKey)
      return task ? cloneTask(task) : undefined
    },

    async listRecoverable() {
      return Array.from(tasks.values())
        .filter((task) => task.status === 'queued' || task.status === 'running' || task.status === 'awaiting-confirmation')
        .map(cloneTask)
    },

    async save(task) {
      ensureIdempotencyIsUnique(tasks, task)
      tasks.set(task.id, cloneTask(task))
    },

    async append(entry) {
      appendEntry(entriesByTask, entry)
    },

    async appendAndSave(entry, task) {
      if (entry.taskId !== task.id || entry.sequence !== task.journalSequence) {
        throw new Error(`Task journal state is inconsistent for ${entry.taskId}.`)
      }
      ensureIdempotencyIsUnique(tasks, task)
      validateNextEntry(entriesByTask, entry)
      const entries = entriesByTask.get(entry.taskId) ?? []
      entries.push(cloneEntry(entry))
      entriesByTask.set(entry.taskId, entries)
      tasks.set(task.id, cloneTask(task))
    },

    async list(taskId) {
      return (entriesByTask.get(taskId) ?? []).map(cloneEntry)
    },

    clear() {
      tasks.clear()
      entriesByTask.clear()
    },
  }
}

function ensureIdempotencyIsUnique(tasks: Map<TaskId, Task>, task: Task): void {
  const duplicate = Array.from(tasks.values()).find((item) => item.id !== task.id && item.idempotencyKey === task.idempotencyKey)
  if (duplicate) throw new Error(`Task idempotency key is already assigned to ${duplicate.id}.`)
}

function appendEntry(entriesByTask: Map<TaskId, TaskJournalEntry[]>, entry: TaskJournalEntry): void {
  validateNextEntry(entriesByTask, entry)
  const entries = entriesByTask.get(entry.taskId) ?? []
  entries.push(cloneEntry(entry))
  entriesByTask.set(entry.taskId, entries)
}

function validateNextEntry(entriesByTask: Map<TaskId, TaskJournalEntry[]>, entry: TaskJournalEntry): void {
  const entries = entriesByTask.get(entry.taskId) ?? []
  const lastEntry = entries[entries.length - 1]
  if (lastEntry && entry.sequence !== lastEntry.sequence + 1) {
    throw new Error(`Task journal sequence is not contiguous for ${entry.taskId}.`)
  }
  if (!lastEntry && entry.sequence !== 1) {
    throw new Error(`Task journal must start at sequence 1 for ${entry.taskId}.`)
  }
}

function cloneTask(task: Task): Task {
  return {
    ...task,
    policy: { ...task.policy },
    artifacts: task.artifacts.map((artifact) => ({ ...artifact })),
    ...(task.result ? { result: { ...task.result, artifactIds: [...task.result.artifactIds] } } : {}),
    ...(task.failure ? { failure: { ...task.failure } } : {}),
  }
}

function cloneEntry(entry: TaskJournalEntry): TaskJournalEntry {
  return {
    ...entry,
    ...(entry.data ? { data: { ...entry.data } } : {}),
  }
}
