import type { AssistantRunId } from '@/core'
import type {
  AssistantRun,
  AssistantRunPersistence,
  RunJournalEntry,
} from '@/modules/assistant-runtime'

export interface InMemoryRunStore extends AssistantRunPersistence {
  clear(): void
}

export function createInMemoryRunStore(): InMemoryRunStore {
  const runs = new Map<AssistantRunId, AssistantRun>()
  const entriesByRun = new Map<AssistantRunId, RunJournalEntry[]>()

  return {
    async get(runId) {
      const run = runs.get(runId)
      return run ? cloneRun(run) : undefined
    },

    async listRecoverable() {
      return Array.from(runs.values())
        .filter((run) => run.status === 'queued' || run.status === 'running' || run.status === 'awaiting-confirmation')
        .map(cloneRun)
    },

    async save(run) {
      const storedRun = cloneRun(run)
      runs.set(storedRun.id, storedRun)
    },

    async append(entry) {
      appendEntry(entriesByRun, entry)
    },

    async appendAndSave(entry, run) {
      if (entry.runId !== run.id || entry.sequence !== run.journalSequence) {
        throw new Error(`Run journal state is inconsistent for ${entry.runId}.`)
      }
      const storedRun = cloneRun(run)
      appendEntry(entriesByRun, entry)
      runs.set(storedRun.id, storedRun)
    },

    async list(runId) {
      return (entriesByRun.get(runId) ?? []).map(cloneEntry)
    },

    clear() {
      runs.clear()
      entriesByRun.clear()
    },
  }
}

function appendEntry(entriesByRun: Map<AssistantRunId, RunJournalEntry[]>, entry: RunJournalEntry): void {
      const entries = entriesByRun.get(entry.runId) ?? []
      const lastEntry = entries[entries.length - 1]
      if (lastEntry && entry.sequence !== lastEntry.sequence + 1) {
        throw new Error(`Run journal sequence is not contiguous for ${entry.runId}.`)
      }
      if (!lastEntry && entry.sequence !== 1) {
        throw new Error(`Run journal must start at sequence 1 for ${entry.runId}.`)
      }
      entries.push(cloneEntry(entry))
      entriesByRun.set(entry.runId, entries)
}

function cloneRun(run: AssistantRun): AssistantRun {
  if (run.kind !== 'chat') {
    throw new Error('In-memory assistant runs must be owned by Chat.')
  }
  return {
    ...run,
    ...(run.checkpoint ? { checkpoint: { ...run.checkpoint } } : {}),
    ...(run.result ? { result: { ...run.result } } : {}),
    ...(run.failure ? { failure: { ...run.failure } } : {}),
  }
}

function cloneEntry(entry: RunJournalEntry): RunJournalEntry {
  return {
    ...entry,
    ...(entry.data ? { data: { ...entry.data } } : {}),
  }
}
