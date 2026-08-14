import { err, type AssistantRunId, type Result } from '@/core'
import {
  WORKFLOW_CHECKPOINT_JOURNAL_SCHEMA,
  WORKFLOW_CHECKPOINT_SCHEMA,
  type WorkflowCheckpoint,
  type WorkflowCheckpointErrorCode,
  type WorkflowCheckpointEvidence,
  type WorkflowCheckpointFailureEvidence,
  type WorkflowCheckpointJournalEntry,
  type WorkflowCheckpointJournalEventType,
  type WorkflowCheckpointPendingAction,
  type WorkflowCheckpointStatus,
  type WorkflowCheckpointStore,
  type WorkflowCheckpointTask,
  type WorkflowCheckpointTrace,
  type WorkflowCompletedStep,
  type WorkflowRecoveryDisposition,
} from './workflowCheckpoint'

export interface WorkflowCheckpointRecorderDependencies {
  store: WorkflowCheckpointStore
  runId: AssistantRunId
  goalHash: string
  startedAt: number
}

export interface WorkflowCheckpointProgress {
  status: WorkflowCheckpointStatus
  occurredAt: number
  completedSteps?: readonly WorkflowCompletedStep[]
  tasks?: readonly WorkflowCheckpointTask[]
  evidence?: readonly WorkflowCheckpointEvidence[]
  traces?: readonly WorkflowCheckpointTrace[]
  pendingAction?: WorkflowCheckpointPendingAction
  failureEvidence?: WorkflowCheckpointFailureEvidence
}

export interface WorkflowCheckpointRecorder {
  initialize(signal: AbortSignal): Promise<Result<WorkflowCheckpoint, WorkflowCheckpointErrorCode>>
  record(
    progress: WorkflowCheckpointProgress,
    signal: AbortSignal,
  ): Promise<Result<WorkflowCheckpoint, WorkflowCheckpointErrorCode>>
  recover(signal: AbortSignal): Promise<Result<{
    checkpoint: WorkflowCheckpoint
    disposition: WorkflowRecoveryDisposition
    replaySideEffects: false
  }, WorkflowCheckpointErrorCode>>
  current(): WorkflowCheckpoint | undefined
}

/**
 * Owns revision, journal, and append-only semantics for a Chat-linked
 * workflow. The caller supplies only newly completed durable facts.
 */
export function createWorkflowCheckpointRecorder(
  dependencies: WorkflowCheckpointRecorderDependencies,
): WorkflowCheckpointRecorder {
  let current: WorkflowCheckpoint | undefined

  return {
    async initialize(signal) {
      if (current) return err('invalid_transition', 'Workflow checkpoint is already initialized.')
      const checkpoint: WorkflowCheckpoint = {
        schema: WORKFLOW_CHECKPOINT_SCHEMA,
        runId: dependencies.runId,
        revision: 1,
        journalSequence: 1,
        status: 'planning',
        goalHash: dependencies.goalHash,
        startedAt: dependencies.startedAt,
        updatedAt: dependencies.startedAt,
        completedSteps: [],
        tasks: [],
        evidence: [],
        traces: [],
      }
      const persisted = await dependencies.store.persist({
        expectedRevision: 0,
        checkpoint,
        entry: journalEntry(checkpoint, 'checkpoint.created'),
        signal,
      })
      current = persisted.ok ? persisted.value : undefined
      return persisted
    },

    async record(progress, signal) {
      if (!current) return err('invalid_transition', 'Workflow checkpoint is not initialized.')
      const occurredAt = Math.max(current.updatedAt, progress.occurredAt)
      const completedSteps = [...current.completedSteps, ...(progress.completedSteps ?? [])]
      const tasks = [...current.tasks, ...(progress.tasks ?? [])]
      const evidence = [...current.evidence, ...(progress.evidence ?? [])]
      const traces = [...current.traces, ...(progress.traces ?? [])]
      const { pendingAction: _pendingAction, failureEvidence: _failureEvidence, ...stableCurrent } = current
      const checkpoint: WorkflowCheckpoint = {
        ...stableCurrent,
        revision: current.revision + 1,
        journalSequence: current.journalSequence + 1,
        status: progress.status,
        updatedAt: occurredAt,
        completedSteps,
        tasks,
        evidence,
        traces,
        ...(completedSteps.length ? { lastCompletedStep: completedSteps[completedSteps.length - 1] } : {}),
        ...(progress.status === 'waiting' && progress.pendingAction ? { pendingAction: progress.pendingAction } : {}),
        ...(progress.status === 'failed' && progress.failureEvidence ? { failureEvidence: progress.failureEvidence } : {}),
      }
      const persisted = await dependencies.store.persist({
        expectedRevision: current.revision,
        checkpoint,
        entry: journalEntry(checkpoint, eventType(current.status, progress.status), current.status),
        signal,
      })
      current = persisted.ok ? persisted.value : undefined
      return persisted
    },

    async recover(signal) {
      const recovered = await dependencies.store.recover(dependencies.runId, signal)
      if (!recovered.ok) return recovered
      current = recovered.value.checkpoint
      return recovered
    },

    current() {
      return current
    },
  }
}

function eventType(
  previous: WorkflowCheckpointStatus,
  next: WorkflowCheckpointStatus,
): WorkflowCheckpointJournalEventType {
  if (next === 'running') return previous === 'running' ? 'workflow.progressed' : 'workflow.started'
  if (next === 'waiting') return 'workflow.waiting'
  if (next === 'succeeded') return 'workflow.succeeded'
  if (next === 'failed') return 'workflow.failed'
  if (next === 'cancelled') return 'workflow.cancelled'
  return 'workflow.progressed'
}

function journalEntry(
  checkpoint: WorkflowCheckpoint,
  type: WorkflowCheckpointJournalEventType,
  fromStatus?: WorkflowCheckpointStatus,
): WorkflowCheckpointJournalEntry {
  return {
    schema: WORKFLOW_CHECKPOINT_JOURNAL_SCHEMA,
    runId: checkpoint.runId,
    sequence: checkpoint.journalSequence,
    revision: checkpoint.revision,
    type,
    occurredAt: checkpoint.updatedAt,
    toStatus: checkpoint.status,
    ...(fromStatus ? { fromStatus } : {}),
    ...(checkpoint.lastCompletedStep ? { lastCompletedStepId: checkpoint.lastCompletedStep.id } : {}),
    ...(checkpoint.failureEvidence ? { failureCode: checkpoint.failureEvidence.code } : {}),
  }
}
