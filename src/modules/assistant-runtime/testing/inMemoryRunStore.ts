import {
  freezeChatRequest,
  isChatRequest,
  type AssistantRunId,
} from '@/core'
import type {
  AssistantRun,
  AssistantRunCapturedRequestSnapshot,
  AssistantRunPersistence,
  RunJournalEntry,
} from '@/modules/assistant-runtime'
import {
  cloneAssistantContextPlanReceipt,
  isAssistantContextPlanReceipt,
} from '@/modules/assistant-runtime'
import {
  buildAssistantCapabilityRevision,
  buildAssistantRequestHash,
  isAssistantCapabilityRevision,
  isAssistantRequestHash,
} from '@/modules/assistant-runtime'

export interface InMemoryRunStore extends AssistantRunPersistence {
  clear(): Promise<void>
}

export function createInMemoryRunStore(): InMemoryRunStore {
  const runs = new Map<AssistantRunId, AssistantRun>()
  const entriesByRun = new Map<AssistantRunId, RunJournalEntry[]>()
  const requestSnapshots = new Map<AssistantRunId, AssistantRunCapturedRequestSnapshot>()

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

    async appendAndSave(entry, run, requestSnapshot) {
      if (entry.runId !== run.id || entry.sequence !== run.journalSequence) {
        throw new Error(`Run journal state is inconsistent for ${entry.runId}.`)
      }
      const storedRun = cloneRun(run)
      const storedRequestSnapshot = requestSnapshot
        ? cloneRequestSnapshot(requestSnapshot)
        : undefined
      if (storedRequestSnapshot && (
        entry.type !== 'run.created' || entry.sequence !== 1 ||
        storedRequestSnapshot.runId !== entry.runId ||
        storedRequestSnapshot.capturedAt !== entry.occurredAt ||
        storedRequestSnapshot.request.conversationId !== run.conversationId ||
        storedRequestSnapshot.request.providerId !== run.providerId ||
        storedRequestSnapshot.request.model !== run.model ||
        !hasMatchingSnapshotSchema(storedRequestSnapshot) ||
        requestSnapshots.has(entry.runId)
      )) {
        throw new Error(`Run request snapshot is inconsistent for ${entry.runId}.`)
      }
      appendEntry(entriesByRun, entry)
      runs.set(storedRun.id, storedRun)
      if (storedRequestSnapshot) requestSnapshots.set(storedRun.id, storedRequestSnapshot)
    },

    async list(runId) {
      return (entriesByRun.get(runId) ?? []).map(cloneEntry)
    },

    async getRequestSnapshot(runId) {
      const snapshot = requestSnapshots.get(runId)
      return snapshot ? cloneRequestSnapshot(snapshot) : undefined
    },

    async getLatestContextReceipt(conversationId) {
      if (!conversationId.trim()) return undefined
      let latest: { runId: AssistantRunId; capturedAt: number; receipt: unknown } | undefined
      for (const snapshot of requestSnapshots.values()) {
        const run = runs.get(snapshot.runId)
        if (!run || run.conversationId !== conversationId) continue
        const receipt = 'contextReceipt' in snapshot ? snapshot.contextReceipt : undefined
        if (!receipt) continue
        if (latest && latest.capturedAt >= snapshot.capturedAt) continue
        latest = { runId: snapshot.runId, capturedAt: snapshot.capturedAt, receipt }
      }
      if (!latest || !isAssistantContextPlanReceipt(latest.receipt)) return undefined
      return {
        runId: latest.runId,
        capturedAt: latest.capturedAt,
        receipt: cloneAssistantContextPlanReceipt(latest.receipt),
      }
    },

    async clear() {
      runs.clear()
      entriesByRun.clear()
      requestSnapshots.clear()
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
    ...(run.pendingModelOperation
      ? { pendingModelOperation: clonePendingModelOperation(run.pendingModelOperation) }
      : {}),
    ...(run.result ? { result: { ...run.result } } : {}),
    ...(run.failure ? {
      failure: {
        ...run.failure,
        ...(run.failure.continuation
          ? { continuation: { ...run.failure.continuation } }
          : {}),
      },
    } : {}),
  }
}

function clonePendingModelOperation(
  pending: NonNullable<AssistantRun['pendingModelOperation']>,
): NonNullable<AssistantRun['pendingModelOperation']> {
  const cloned = JSON.parse(JSON.stringify(pending)) as typeof pending
  return {
    ...cloned,
    continuationRequest: freezeChatRequest(cloned.continuationRequest),
    continuationState: deepFreeze(cloned.continuationState),
  }
}

function cloneEntry(entry: RunJournalEntry): RunJournalEntry {
  return {
    ...entry,
    ...(entry.data ? { data: { ...entry.data } } : {}),
  }
}

function cloneRequestSnapshot(
  snapshot: AssistantRunCapturedRequestSnapshot,
): AssistantRunCapturedRequestSnapshot {
  const request = snapshot.schema === 'islemind.assistant-run-request-snapshot.v1'
    ? freezeChatRequest(snapshot.request)
    : JSON.parse(JSON.stringify(snapshot.request))
  const contextReceipt = snapshot.schema === 'islemind.assistant-run-request-snapshot.v1'
    ? snapshot.contextReceipt
    : undefined
  return Object.freeze({
    ...snapshot,
    request: deepFreeze(request),
    ...(contextReceipt
      ? { contextReceipt: deepFreeze(cloneAssistantContextPlanReceipt(contextReceipt)) }
      : {}),
  }) as AssistantRunCapturedRequestSnapshot
}

function hasMatchingSnapshotSchema(
  snapshot: AssistantRunCapturedRequestSnapshot,
): boolean {
  const capabilityInput = snapshot.schema === 'islemind.assistant-run-activity-request-snapshot.v1'
    ? snapshot.request.payload
    : snapshot.request
  const identityValid = (
    (snapshot.capabilityRevision === undefined && snapshot.requestHash === undefined) ||
    (
      isAssistantCapabilityRevision(snapshot.capabilityRevision) &&
      isAssistantRequestHash(snapshot.requestHash) &&
      snapshot.capabilityRevision === buildAssistantCapabilityRevision(capabilityInput) &&
      snapshot.requestHash === buildAssistantRequestHash(snapshot.request)
    )
  )
  if (!identityValid) return false
  return (
    snapshot.schema === 'islemind.assistant-run-request-snapshot.v1'
    && isChatRequest(snapshot.request)
    && (snapshot.contextReceipt === undefined || isAssistantContextPlanReceipt(snapshot.contextReceipt))
  ) || (
    snapshot.schema === 'islemind.assistant-run-activity-request-snapshot.v1'
    && snapshot.request.schema === 'islemind.assistant-activity-request-evidence.v1'
    && (snapshot.request.contextReceipt === undefined || isAssistantContextPlanReceipt(snapshot.request.contextReceipt))
  )
}

function deepFreeze<Value>(value: Value): Value {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}
