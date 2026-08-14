import {
  asAssistantRunId,
  err,
  ok,
  type AssistantRunId,
  type JsonRecord,
  type JsonValue,
  type Result,
} from '@/core'

export const WORKFLOW_CHECKPOINT_SCHEMA = 'islemind.workflow-checkpoint.v2'
export const WORKFLOW_CHECKPOINT_JOURNAL_SCHEMA = 'islemind.workflow-checkpoint-journal.v2'

export const WORKFLOW_CHECKPOINT_LIMITS = {
  completedSteps: 64,
  tasks: 128,
  evidence: 128,
  traces: 128,
  evidenceReferences: 32,
  metadataDepth: 4,
  metadataEntries: 128,
  metadataCollectionSize: 32,
  metadataKeyLength: 128,
  metadataStringLength: 4_000,
  serializedCharacters: 1_000_000,
  journalSnapshots: 16,
} as const

export type WorkflowCheckpointStatus =
  | 'planning'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type WorkflowCheckpointErrorCode =
  | 'invalid_transition'
  | 'not_found'
  | 'conflict'
  | 'cancelled'
  | 'invalid_record'
  | 'corruption'
  | 'persistence_failed'

export type WorkflowCheckpointPersistenceErrorCode = Exclude<
  WorkflowCheckpointErrorCode,
  'invalid_transition' | 'not_found'
>

export interface WorkflowCompletedStep {
  id: string
  title: string
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'skipped'
  completedAt: number
  taskIds: readonly string[]
  evidenceIds: readonly string[]
  summary?: string
}

/**
 * A terminal task receipt, not an executable task request. Recovery may
 * reconcile it by ID but must never replay a side effect from this record.
 */
export interface WorkflowCheckpointTask {
  taskId: string
  stepId: string
  status: 'succeeded' | 'failed' | 'cancelled' | 'expired'
  recordedAt: number
  idempotencyKeyHash?: string
  artifactIds: readonly string[]
  summary?: string
}

export interface WorkflowCheckpointEvidence {
  id: string
  kind: 'tool-result' | 'citation' | 'artifact' | 'diagnostic' | 'failure'
  summary: string
  recordedAt: number
  stepId?: string
  taskId?: string
  sourceRef?: string
  metadata?: JsonRecord
}

export interface WorkflowCheckpointTrace {
  id: string
  type: 'planning' | 'step' | 'task' | 'evidence' | 'recovery' | 'failure'
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled'
  title: string
  startedAt: number
  completedAt?: number
  stepId?: string
  taskId?: string
  summary?: string
  metadata?: JsonRecord
}

export interface WorkflowCheckpointPendingAction {
  id: string
  reason: 'permission_required' | 'step_limit_reached' | 'evidence_insufficient' | 'human_review' | 'required_input'
  title: string
  summary: string
  createdAt: number
  resumePolicy: 'reconcile-task-before-resume' | 'human-review-only'
  requiresUserConfirmation: boolean
  stepId?: string
  taskId?: string
  confirmationId?: string
  details?: JsonRecord
}

export interface WorkflowCheckpointFailureEvidence {
  code: string
  message: string
  recordedAt: number
  retryable: boolean
  stepId?: string
  taskId?: string
  evidenceIds: readonly string[]
  details?: JsonRecord
}

export interface WorkflowCheckpoint {
  schema: typeof WORKFLOW_CHECKPOINT_SCHEMA
  runId: AssistantRunId
  revision: number
  journalSequence: number
  status: WorkflowCheckpointStatus
  goalHash: string
  startedAt: number
  updatedAt: number
  completedSteps: readonly WorkflowCompletedStep[]
  tasks: readonly WorkflowCheckpointTask[]
  evidence: readonly WorkflowCheckpointEvidence[]
  traces: readonly WorkflowCheckpointTrace[]
  lastCompletedStep?: WorkflowCompletedStep
  pendingAction?: WorkflowCheckpointPendingAction
  failureEvidence?: WorkflowCheckpointFailureEvidence
}

export type WorkflowCheckpointJournalEventType =
  | 'checkpoint.created'
  | 'workflow.started'
  | 'workflow.progressed'
  | 'workflow.waiting'
  | 'workflow.succeeded'
  | 'workflow.failed'
  | 'workflow.cancelled'
  | 'recovery.failure-retained'

export interface WorkflowCheckpointJournalEntry {
  schema: typeof WORKFLOW_CHECKPOINT_JOURNAL_SCHEMA
  runId: AssistantRunId
  sequence: number
  revision: number
  type: WorkflowCheckpointJournalEventType
  occurredAt: number
  toStatus: WorkflowCheckpointStatus
  fromStatus?: WorkflowCheckpointStatus
  lastCompletedStepId?: string
  failureCode?: string
  data?: JsonRecord
}

export interface AppendWorkflowCheckpointInput {
  expectedRevision: number
  checkpoint: WorkflowCheckpoint
  entry: WorkflowCheckpointJournalEntry
  signal: AbortSignal
}

export interface RecoveredWorkflowCheckpointRecord {
  checkpoint: WorkflowCheckpoint
  source: 'current' | 'journal'
}

export interface WorkflowCheckpointRepository {
  load(
    runId: AssistantRunId,
    signal: AbortSignal,
  ): Promise<Result<WorkflowCheckpoint | undefined, WorkflowCheckpointPersistenceErrorCode>>
  appendAndSave(
    input: AppendWorkflowCheckpointInput,
  ): Promise<Result<WorkflowCheckpoint, WorkflowCheckpointPersistenceErrorCode>>
  recover(
    runId: AssistantRunId,
    signal: AbortSignal,
  ): Promise<Result<RecoveredWorkflowCheckpointRecord | undefined, WorkflowCheckpointPersistenceErrorCode>>
}

export interface PersistWorkflowCheckpointInput {
  expectedRevision: number
  checkpoint: unknown
  entry: unknown
  signal: AbortSignal
}

export type WorkflowRecoveryDisposition =
  | 'terminal'
  | 'awaiting-action'
  | 'reconcile-before-resume'
  | 'failed-with-evidence'

export interface WorkflowCheckpointRecovery {
  checkpoint: WorkflowCheckpoint
  source: 'current' | 'journal'
  disposition: WorkflowRecoveryDisposition
  replaySideEffects: false
  lastSafeStepId?: string
  failureEvidence?: WorkflowCheckpointFailureEvidence
}

export interface WorkflowCheckpointStore {
  get(
    runId: AssistantRunId,
    signal: AbortSignal,
  ): Promise<Result<WorkflowCheckpoint, WorkflowCheckpointErrorCode>>
  persist(
    input: PersistWorkflowCheckpointInput,
  ): Promise<Result<WorkflowCheckpoint, WorkflowCheckpointErrorCode>>
  recover(
    runId: AssistantRunId,
    signal: AbortSignal,
  ): Promise<Result<WorkflowCheckpointRecovery, WorkflowCheckpointErrorCode>>
}

export function createWorkflowCheckpointStore(
  repository: WorkflowCheckpointRepository,
): WorkflowCheckpointStore {
  return {
    async get(runId, signal) {
      if (signal.aborted) return cancelledResult()
      if (!isBoundedText(runId, 256)) return err('invalid_record', 'Assistant run ID is invalid.')
      const loaded = await repository.load(runId, signal)
      if (!loaded.ok) return loaded
      if (!loaded.value) return err('not_found', 'Workflow checkpoint was not found.')
      return ok(loaded.value)
    },

    async persist(input) {
      if (input.signal.aborted) return cancelledResult()
      if (!isNonNegativeInteger(input.expectedRevision)) {
        return err('invalid_record', 'Expected checkpoint revision is invalid.')
      }
      const checkpoint = parseWorkflowCheckpoint(input.checkpoint)
      if (!checkpoint.ok) return checkpoint
      const entry = parseWorkflowCheckpointJournalEntry(input.entry)
      if (!entry.ok) return entry

      const loaded = await repository.load(checkpoint.value.runId, input.signal)
      if (!loaded.ok) return loaded
      if ((loaded.value?.revision ?? 0) !== input.expectedRevision) {
        return err('conflict', 'Workflow checkpoint revision changed.', {
          retryable: true,
          details: {
            expectedRevision: input.expectedRevision,
            actualRevision: loaded.value?.revision ?? 0,
          },
        })
      }
      const transition = validateWorkflowCheckpointTransition(
        loaded.value,
        checkpoint.value,
        entry.value,
      )
      if (!transition.ok) return transition
      if (input.signal.aborted) return cancelledResult()

      return repository.appendAndSave({
        expectedRevision: input.expectedRevision,
        checkpoint: checkpoint.value,
        entry: entry.value,
        signal: input.signal,
      })
    },

    async recover(runId, signal) {
      if (signal.aborted) return cancelledResult()
      if (!isBoundedText(runId, 256)) return err('invalid_record', 'Assistant run ID is invalid.')
      const recovered = await repository.recover(runId, signal)
      if (!recovered.ok) return recovered
      if (!recovered.value) return err('not_found', 'Workflow checkpoint was not found.')

      const checkpoint = recovered.value.checkpoint
      const failureEvidence = checkpoint.failureEvidence
      const disposition: WorkflowRecoveryDisposition = failureEvidence
        ? 'failed-with-evidence'
        : checkpoint.status === 'waiting'
          ? 'awaiting-action'
          : checkpoint.status === 'planning' || checkpoint.status === 'running'
            ? 'reconcile-before-resume'
            : 'terminal'
      return ok({
        checkpoint,
        source: recovered.value.source,
        disposition,
        replaySideEffects: false,
        ...(checkpoint.lastCompletedStep ? { lastSafeStepId: checkpoint.lastCompletedStep.id } : {}),
        ...(failureEvidence ? { failureEvidence } : {}),
      })
    },
  }
}

export function parseWorkflowCheckpoint(
  value: unknown,
): Result<WorkflowCheckpoint, 'invalid_record'> {
  try {
    const parsed = parseCheckpoint(value)
    return parsed.ok ? ok(parsed.value) : err('invalid_record', parsed.message)
  } catch {
    return err('invalid_record', 'Workflow checkpoint could not be inspected safely.')
  }
}

export function parseWorkflowCheckpointJournalEntry(
  value: unknown,
): Result<WorkflowCheckpointJournalEntry, 'invalid_record'> {
  try {
    const parsed = parseJournalEntry(value)
    return parsed.ok ? ok(parsed.value) : err('invalid_record', parsed.message)
  } catch {
    return err('invalid_record', 'Workflow checkpoint journal entry could not be inspected safely.')
  }
}

/**
 * Validates the self-contained checkpoint and journal snapshot metadata used
 * as the recovery anchor after older journal rows have been pruned.
 */
export function validateWorkflowCheckpointJournalSnapshot(
  checkpoint: WorkflowCheckpoint,
  entry: WorkflowCheckpointJournalEntry,
): Result<void, 'invalid_transition'> {
  if (entry.runId !== checkpoint.runId || entry.revision !== checkpoint.revision ||
    entry.sequence !== checkpoint.journalSequence || entry.occurredAt !== checkpoint.updatedAt ||
    entry.toStatus !== checkpoint.status) {
    return invalidTransition('Checkpoint journal metadata does not match the saved checkpoint.')
  }
  if (entry.lastCompletedStepId !== checkpoint.lastCompletedStep?.id) {
    return invalidTransition('Checkpoint journal last-completed-step does not match the saved checkpoint.')
  }
  if (entry.failureCode !== checkpoint.failureEvidence?.code) {
    return invalidTransition('Checkpoint journal failure evidence does not match the saved checkpoint.')
  }
  if (!journalEventMatchesSnapshot(checkpoint, entry)) {
    return invalidTransition('Checkpoint journal event does not describe its saved checkpoint.')
  }
  return ok(undefined)
}

export function validateWorkflowCheckpointTransition(
  previous: WorkflowCheckpoint | undefined,
  next: WorkflowCheckpoint,
  entry: WorkflowCheckpointJournalEntry,
): Result<void, 'invalid_transition'> {
  const snapshot = validateWorkflowCheckpointJournalSnapshot(next, entry)
  if (!snapshot.ok) return snapshot

  if (!previous) {
    if (next.revision !== 1 || next.journalSequence !== 1 || next.status !== 'planning' ||
      entry.type !== 'checkpoint.created' || entry.fromStatus !== undefined) {
      return invalidTransition('An initial checkpoint must be a revision-one planning record.')
    }
    return ok(undefined)
  }

  if (previous.runId !== next.runId || previous.goalHash !== next.goalHash || previous.startedAt !== next.startedAt) {
    return invalidTransition('Immutable workflow checkpoint identity changed.')
  }
  if (next.revision !== previous.revision + 1 || next.journalSequence !== previous.journalSequence + 1) {
    return invalidTransition('Checkpoint revision and journal sequence must be contiguous.')
  }
  if (next.updatedAt < previous.updatedAt || entry.fromStatus !== previous.status) {
    return invalidTransition('Checkpoint time or source status moved backwards.')
  }
  if (!allowedTransitions[previous.status].includes(next.status)) {
    return invalidTransition(`Invalid workflow checkpoint transition: ${previous.status} -> ${next.status}.`)
  }
  if (!isAppendOnly(previous.completedSteps, next.completedSteps) ||
    !isAppendOnly(previous.tasks, next.tasks) ||
    !isAppendOnly(previous.evidence, next.evidence) ||
    !isAppendOnly(previous.traces, next.traces)) {
    return invalidTransition('Durable workflow evidence cannot be removed or rewritten.')
  }
  if (previous.failureEvidence && !sameValue(previous.failureEvidence, next.failureEvidence)) {
    return invalidTransition('Retained workflow failure evidence cannot be removed or rewritten.')
  }
  if (!journalEventMatchesTransition(previous, next, entry.type)) {
    return invalidTransition('Checkpoint journal event does not describe the workflow transition.')
  }
  return ok(undefined)
}

const allowedTransitions: Record<WorkflowCheckpointStatus, readonly WorkflowCheckpointStatus[]> = {
  planning: ['planning', 'running', 'waiting', 'succeeded', 'failed', 'cancelled'],
  running: ['running', 'waiting', 'succeeded', 'failed', 'cancelled'],
  waiting: ['waiting', 'running', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
}

function journalEventMatchesTransition(
  previous: WorkflowCheckpoint,
  next: WorkflowCheckpoint,
  type: WorkflowCheckpointJournalEventType,
): boolean {
  if (type === 'workflow.started') return next.status === 'running' && previous.status !== 'running'
  if (type === 'workflow.progressed') return next.status === 'planning' || next.status === 'running'
  if (type === 'workflow.waiting') return next.status === 'waiting'
  if (type === 'workflow.succeeded') return next.status === 'succeeded'
  if (type === 'workflow.failed') return next.status === 'failed' && Boolean(next.failureEvidence)
  if (type === 'workflow.cancelled') return next.status === 'cancelled'
  if (type === 'recovery.failure-retained') return next.status === 'failed' && Boolean(next.failureEvidence)
  return false
}

function journalEventMatchesSnapshot(
  checkpoint: WorkflowCheckpoint,
  entry: WorkflowCheckpointJournalEntry,
): boolean {
  if (entry.type === 'checkpoint.created') {
    return checkpoint.revision === 1 && checkpoint.status === 'planning' && entry.fromStatus === undefined
  }
  if (entry.fromStatus === undefined) return false
  if (!allowedTransitions[entry.fromStatus].includes(checkpoint.status)) return false
  if (entry.type === 'workflow.started') return checkpoint.status === 'running' && entry.fromStatus !== 'running'
  if (entry.type === 'workflow.progressed') return checkpoint.status === 'planning' || checkpoint.status === 'running'
  if (entry.type === 'workflow.waiting') return checkpoint.status === 'waiting'
  if (entry.type === 'workflow.succeeded') return checkpoint.status === 'succeeded'
  if (entry.type === 'workflow.failed') return checkpoint.status === 'failed' && Boolean(checkpoint.failureEvidence)
  if (entry.type === 'workflow.cancelled') return checkpoint.status === 'cancelled'
  if (entry.type === 'recovery.failure-retained') return checkpoint.status === 'failed' && Boolean(checkpoint.failureEvidence)
  return false
}

function parseCheckpoint(value: unknown): ParseResult<WorkflowCheckpoint> {
  const object = strictRecord(value, checkpointKeys, 'Workflow checkpoint')
  if (!object.ok) return object
  if (object.value.schema !== WORKFLOW_CHECKPOINT_SCHEMA) return invalid('Checkpoint schema is invalid.')
  if (!isBoundedText(object.value.runId, 256)) return invalid('Checkpoint run ID is invalid.')
  if (!isPositiveInteger(object.value.revision) || object.value.revision !== object.value.journalSequence) {
    return invalid('Checkpoint revision and journal sequence are invalid.')
  }
  if (!isCheckpointStatus(object.value.status) || !isBoundedText(object.value.goalHash, 256) ||
    !isTimestamp(object.value.startedAt) || !isTimestamp(object.value.updatedAt) ||
    object.value.updatedAt < object.value.startedAt) {
    return invalid('Checkpoint lifecycle metadata is invalid.')
  }

  const completedSteps = parseBoundedArray(
    object.value.completedSteps,
    WORKFLOW_CHECKPOINT_LIMITS.completedSteps,
    parseCompletedStep,
    'completed steps',
  )
  if (!completedSteps.ok) return completedSteps
  const tasks = parseBoundedArray(object.value.tasks, WORKFLOW_CHECKPOINT_LIMITS.tasks, parseTask, 'tasks')
  if (!tasks.ok) return tasks
  const evidence = parseBoundedArray(
    object.value.evidence,
    WORKFLOW_CHECKPOINT_LIMITS.evidence,
    parseEvidence,
    'evidence records',
  )
  if (!evidence.ok) return evidence
  const traces = parseBoundedArray(object.value.traces, WORKFLOW_CHECKPOINT_LIMITS.traces, parseTrace, 'trace records')
  if (!traces.ok) return traces
  if (!hasUnique(completedSteps.value, (item) => item.id) || !hasUnique(tasks.value, (item) => item.taskId) ||
    !hasUnique(evidence.value, (item) => item.id) || !hasUnique(traces.value, (item) => item.id)) {
    return invalid('Checkpoint collections contain duplicate IDs.')
  }

  const lastCompletedStep = parseOptional(object.value, 'lastCompletedStep', parseCompletedStep)
  if (!lastCompletedStep.ok) return lastCompletedStep
  const actualLast = completedSteps.value[completedSteps.value.length - 1]
  if ((actualLast === undefined) !== (lastCompletedStep.value === undefined) ||
    (actualLast && !sameValue(actualLast, lastCompletedStep.value))) {
    return invalid('Checkpoint last completed step is not the final completed-step record.')
  }
  const pendingAction = parseOptional(object.value, 'pendingAction', parsePendingAction)
  if (!pendingAction.ok) return pendingAction
  const failureEvidence = parseOptional(object.value, 'failureEvidence', parseFailureEvidence)
  if (!failureEvidence.ok) return failureEvidence
  if ((object.value.status === 'waiting') !== Boolean(pendingAction.value)) {
    return invalid('Only waiting checkpoints must contain a pending action.')
  }
  if ((object.value.status === 'failed') !== Boolean(failureEvidence.value)) {
    return invalid('Only failed checkpoints must retain failure evidence.')
  }
  const evidenceIds = new Set(evidence.value.map((item) => item.id))
  if (completedSteps.value.some((step) => step.evidenceIds.some((id) => !evidenceIds.has(id))) ||
    failureEvidence.value?.evidenceIds.some((id) => !evidenceIds.has(id))) {
    return invalid('Checkpoint evidence references are not resolvable.')
  }
  const taskIds = new Set(tasks.value.map((item) => item.taskId))
  if (completedSteps.value.some((step) => step.taskIds.some((id) => !taskIds.has(id)))) {
    return invalid('Checkpoint task references are not resolvable.')
  }

  const checkpoint: WorkflowCheckpoint = {
    schema: WORKFLOW_CHECKPOINT_SCHEMA,
    runId: asAssistantRunId(object.value.runId),
    revision: object.value.revision,
    journalSequence: object.value.journalSequence as number,
    status: object.value.status,
    goalHash: object.value.goalHash,
    startedAt: object.value.startedAt,
    updatedAt: object.value.updatedAt,
    completedSteps: completedSteps.value,
    tasks: tasks.value,
    evidence: evidence.value,
    traces: traces.value,
    ...(lastCompletedStep.value ? { lastCompletedStep: lastCompletedStep.value } : {}),
    ...(pendingAction.value ? { pendingAction: pendingAction.value } : {}),
    ...(failureEvidence.value ? { failureEvidence: failureEvidence.value } : {}),
  }
  if (JSON.stringify(checkpoint).length > WORKFLOW_CHECKPOINT_LIMITS.serializedCharacters) {
    return invalid('Checkpoint exceeds the durable record retention limit.')
  }
  return valid(checkpoint)
}

function parseJournalEntry(value: unknown): ParseResult<WorkflowCheckpointJournalEntry> {
  const object = strictRecord(value, journalKeys, 'Workflow checkpoint journal entry')
  if (!object.ok) return object
  if (object.value.schema !== WORKFLOW_CHECKPOINT_JOURNAL_SCHEMA ||
    !isBoundedText(object.value.runId, 256) || !isPositiveInteger(object.value.sequence) ||
    !isPositiveInteger(object.value.revision) || object.value.sequence !== object.value.revision ||
    !isJournalEventType(object.value.type) || !isTimestamp(object.value.occurredAt) ||
    !isCheckpointStatus(object.value.toStatus)) {
    return invalid('Checkpoint journal metadata is invalid.')
  }
  const fromStatus = optionalPick(object.value, 'fromStatus', isCheckpointStatus, 'Journal source status is invalid.')
  if (!fromStatus.ok) return fromStatus
  const lastCompletedStepId = optionalText(object.value, 'lastCompletedStepId', 256)
  if (!lastCompletedStepId.ok) return lastCompletedStepId
  const failureCode = optionalText(object.value, 'failureCode', 128)
  if (!failureCode.ok) return failureCode
  const data = optionalJsonRecord(object.value, 'data')
  if (!data.ok) return data
  return valid({
    schema: WORKFLOW_CHECKPOINT_JOURNAL_SCHEMA,
    runId: asAssistantRunId(object.value.runId),
    sequence: object.value.sequence,
    revision: object.value.revision,
    type: object.value.type,
    occurredAt: object.value.occurredAt,
    toStatus: object.value.toStatus,
    ...(fromStatus.value ? { fromStatus: fromStatus.value } : {}),
    ...(lastCompletedStepId.value ? { lastCompletedStepId: lastCompletedStepId.value } : {}),
    ...(failureCode.value ? { failureCode: failureCode.value } : {}),
    ...(data.value ? { data: data.value } : {}),
  })
}

function parseCompletedStep(value: unknown): ParseResult<WorkflowCompletedStep> {
  const object = strictRecord(value, completedStepKeys, 'Completed step')
  if (!object.ok) return object
  if (!isBoundedText(object.value.id, 256) || !isBoundedText(object.value.title, 512) ||
    !isCompletedStepOutcome(object.value.outcome) || !isTimestamp(object.value.completedAt)) {
    return invalid('Completed step metadata is invalid.')
  }
  const taskIds = parseTextArray(object.value.taskIds, 32, 256, 'Completed-step task IDs')
  if (!taskIds.ok) return taskIds
  const evidenceIds = parseTextArray(object.value.evidenceIds, 32, 256, 'Completed-step evidence IDs')
  if (!evidenceIds.ok) return evidenceIds
  const summary = optionalText(object.value, 'summary', 2_000)
  if (!summary.ok) return summary
  return valid({
    id: object.value.id,
    title: object.value.title,
    outcome: object.value.outcome,
    completedAt: object.value.completedAt,
    taskIds: taskIds.value,
    evidenceIds: evidenceIds.value,
    ...(summary.value ? { summary: summary.value } : {}),
  })
}

function parseTask(value: unknown): ParseResult<WorkflowCheckpointTask> {
  const object = strictRecord(value, taskKeys, 'Checkpoint task receipt')
  if (!object.ok) return object
  if (!isBoundedText(object.value.taskId, 256) || !isBoundedText(object.value.stepId, 256) ||
    !isTerminalTaskStatus(object.value.status) || !isTimestamp(object.value.recordedAt)) {
    return invalid('Checkpoint task receipt is invalid.')
  }
  const idempotencyKeyHash = optionalText(object.value, 'idempotencyKeyHash', 256)
  if (!idempotencyKeyHash.ok) return idempotencyKeyHash
  const artifactIds = parseTextArray(object.value.artifactIds, 32, 256, 'Task artifact IDs')
  if (!artifactIds.ok) return artifactIds
  const summary = optionalText(object.value, 'summary', 2_000)
  if (!summary.ok) return summary
  return valid({
    taskId: object.value.taskId,
    stepId: object.value.stepId,
    status: object.value.status,
    recordedAt: object.value.recordedAt,
    ...(idempotencyKeyHash.value ? { idempotencyKeyHash: idempotencyKeyHash.value } : {}),
    artifactIds: artifactIds.value,
    ...(summary.value ? { summary: summary.value } : {}),
  })
}

function parseEvidence(value: unknown): ParseResult<WorkflowCheckpointEvidence> {
  const object = strictRecord(value, evidenceKeys, 'Checkpoint evidence')
  if (!object.ok) return object
  if (!isBoundedText(object.value.id, 256) || !isEvidenceKind(object.value.kind) ||
    !isBoundedText(object.value.summary, 4_000) || !isTimestamp(object.value.recordedAt)) {
    return invalid('Checkpoint evidence is invalid.')
  }
  const stepId = optionalText(object.value, 'stepId', 256)
  if (!stepId.ok) return stepId
  const taskId = optionalText(object.value, 'taskId', 256)
  if (!taskId.ok) return taskId
  const sourceRef = optionalText(object.value, 'sourceRef', 2_048)
  if (!sourceRef.ok) return sourceRef
  const metadata = optionalJsonRecord(object.value, 'metadata')
  if (!metadata.ok) return metadata
  return valid({
    id: object.value.id,
    kind: object.value.kind,
    summary: object.value.summary,
    recordedAt: object.value.recordedAt,
    ...(stepId.value ? { stepId: stepId.value } : {}),
    ...(taskId.value ? { taskId: taskId.value } : {}),
    ...(sourceRef.value ? { sourceRef: sourceRef.value } : {}),
    ...(metadata.value ? { metadata: metadata.value } : {}),
  })
}

function parseTrace(value: unknown): ParseResult<WorkflowCheckpointTrace> {
  const object = strictRecord(value, traceKeys, 'Checkpoint trace')
  if (!object.ok) return object
  if (!isBoundedText(object.value.id, 256) || !isTraceType(object.value.type) ||
    !isTraceStatus(object.value.status) || !isBoundedText(object.value.title, 512) ||
    !isTimestamp(object.value.startedAt)) {
    return invalid('Checkpoint trace is invalid.')
  }
  const completedAt = optionalPick(object.value, 'completedAt', isTimestamp, 'Trace completion time is invalid.')
  if (!completedAt.ok || (completedAt.value !== undefined && completedAt.value < object.value.startedAt)) return invalid('Trace completion time is invalid.')
  const stepId = optionalText(object.value, 'stepId', 256)
  if (!stepId.ok) return stepId
  const taskId = optionalText(object.value, 'taskId', 256)
  if (!taskId.ok) return taskId
  const summary = optionalText(object.value, 'summary', 4_000)
  if (!summary.ok) return summary
  const metadata = optionalJsonRecord(object.value, 'metadata')
  if (!metadata.ok) return metadata
  return valid({
    id: object.value.id,
    type: object.value.type,
    status: object.value.status,
    title: object.value.title,
    startedAt: object.value.startedAt,
    ...(completedAt.value === undefined ? {} : { completedAt: completedAt.value }),
    ...(stepId.value ? { stepId: stepId.value } : {}),
    ...(taskId.value ? { taskId: taskId.value } : {}),
    ...(summary.value ? { summary: summary.value } : {}),
    ...(metadata.value ? { metadata: metadata.value } : {}),
  })
}

function parsePendingAction(value: unknown): ParseResult<WorkflowCheckpointPendingAction> {
  const object = strictRecord(value, pendingActionKeys, 'Checkpoint pending action')
  if (!object.ok) return object
  if (!isBoundedText(object.value.id, 256) || !isPendingActionReason(object.value.reason) ||
    !isBoundedText(object.value.title, 512) || !isBoundedText(object.value.summary, 2_000) ||
    !isTimestamp(object.value.createdAt) || !isResumePolicy(object.value.resumePolicy) ||
    typeof object.value.requiresUserConfirmation !== 'boolean') {
    return invalid('Checkpoint pending action is invalid.')
  }
  const stepId = optionalText(object.value, 'stepId', 256)
  if (!stepId.ok) return stepId
  const taskId = optionalText(object.value, 'taskId', 256)
  if (!taskId.ok) return taskId
  const confirmationId = optionalText(object.value, 'confirmationId', 256)
  if (!confirmationId.ok) return confirmationId
  const details = optionalJsonRecord(object.value, 'details')
  if (!details.ok) return details
  if (object.value.resumePolicy === 'reconcile-task-before-resume' && !taskId.value) {
    return invalid('A task reconciliation pending action must identify its durable task.')
  }
  return valid({
    id: object.value.id,
    reason: object.value.reason,
    title: object.value.title,
    summary: object.value.summary,
    createdAt: object.value.createdAt,
    resumePolicy: object.value.resumePolicy,
    requiresUserConfirmation: object.value.requiresUserConfirmation,
    ...(stepId.value ? { stepId: stepId.value } : {}),
    ...(taskId.value ? { taskId: taskId.value } : {}),
    ...(confirmationId.value ? { confirmationId: confirmationId.value } : {}),
    ...(details.value ? { details: details.value } : {}),
  })
}

function parseFailureEvidence(value: unknown): ParseResult<WorkflowCheckpointFailureEvidence> {
  const object = strictRecord(value, failureEvidenceKeys, 'Checkpoint failure evidence')
  if (!object.ok) return object
  if (!isBoundedText(object.value.code, 128) || !isBoundedText(object.value.message, 2_000) ||
    !isTimestamp(object.value.recordedAt) || typeof object.value.retryable !== 'boolean') {
    return invalid('Checkpoint failure evidence is invalid.')
  }
  const stepId = optionalText(object.value, 'stepId', 256)
  if (!stepId.ok) return stepId
  const taskId = optionalText(object.value, 'taskId', 256)
  if (!taskId.ok) return taskId
  const evidenceIds = parseTextArray(
    object.value.evidenceIds,
    WORKFLOW_CHECKPOINT_LIMITS.evidenceReferences,
    256,
    'Failure evidence IDs',
  )
  if (!evidenceIds.ok) return evidenceIds
  const details = optionalJsonRecord(object.value, 'details')
  if (!details.ok) return details
  return valid({
    code: object.value.code,
    message: object.value.message,
    recordedAt: object.value.recordedAt,
    retryable: object.value.retryable,
    ...(stepId.value ? { stepId: stepId.value } : {}),
    ...(taskId.value ? { taskId: taskId.value } : {}),
    evidenceIds: evidenceIds.value,
    ...(details.value ? { details: details.value } : {}),
  })
}

type ParseResult<Value> = { ok: true; value: Value } | { ok: false; message: string }

function valid<Value>(value: Value): ParseResult<Value> {
  return { ok: true, value }
}

function invalid<Value = never>(message: string): ParseResult<Value> {
  return { ok: false, message }
}

function invalidTransition(message: string): Result<never, 'invalid_transition'> {
  return err('invalid_transition', message)
}

function cancelledResult(): Result<never, 'cancelled'> {
  return err('cancelled', 'Workflow checkpoint operation was cancelled.')
}

function strictRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  label: string,
): ParseResult<Record<string, unknown>> {
  const inspected = inspectPlainDataRecord(value, label)
  if (!inspected.ok) return inspected
  const keys = Object.keys(inspected.value)
  if (keys.some((key) => !allowedKeys.has(key))) return invalid(`${label} contains unknown fields.`)
  return inspected
}

function parseBoundedArray<Value>(
  value: unknown,
  limit: number,
  parser: (item: unknown) => ParseResult<Value>,
  label: string,
): ParseResult<readonly Value[]> {
  if (!Array.isArray(value) || value.length > limit) return invalid(`Checkpoint ${label} are invalid or exceed retention limits.`)
  const output: Value[] = []
  for (const item of value) {
    const parsed = parser(item)
    if (!parsed.ok) return parsed
    output.push(parsed.value)
  }
  return valid(output)
}

function parseTextArray(value: unknown, limit: number, textLimit: number, label: string): ParseResult<readonly string[]> {
  if (!Array.isArray(value) || value.length > limit || value.some((item) => !isBoundedText(item, textLimit))) {
    return invalid(`${label} are invalid or exceed retention limits.`)
  }
  if (new Set(value).size !== value.length) return invalid(`${label} contain duplicates.`)
  return valid(value as string[])
}

function parseOptional<Value>(
  object: Record<string, unknown>,
  key: string,
  parser: (value: unknown) => ParseResult<Value>,
): ParseResult<Value | undefined> {
  if (!Object.prototype.hasOwnProperty.call(object, key)) return valid(undefined)
  return parser(object[key])
}

function optionalText(object: Record<string, unknown>, key: string, limit: number): ParseResult<string | undefined> {
  return optionalPick(object, key, (value): value is string => isBoundedText(value, limit), `${key} is invalid.`)
}

function optionalPick<Value>(
  object: Record<string, unknown>,
  key: string,
  predicate: (value: unknown) => value is Value,
  message: string,
): ParseResult<Value | undefined> {
  if (!Object.prototype.hasOwnProperty.call(object, key)) return valid(undefined)
  return predicate(object[key]) ? valid(object[key]) : invalid(message)
}

function optionalJsonRecord(object: Record<string, unknown>, key: string): ParseResult<JsonRecord | undefined> {
  if (!Object.prototype.hasOwnProperty.call(object, key)) return valid(undefined)
  const budget = { entries: 0 }
  const parsed = parseBoundedJsonValue(object[key], 0, budget)
  return parsed.ok && isPlainRecord(parsed.value) ? valid(parsed.value as JsonRecord) : invalid(`${key} is not bounded JSON data.`)
}

function parseBoundedJsonValue(value: unknown, depth: number, budget: { entries: number }): ParseResult<JsonValue> {
  budget.entries += 1
  if (budget.entries > WORKFLOW_CHECKPOINT_LIMITS.metadataEntries ||
    depth > WORKFLOW_CHECKPOINT_LIMITS.metadataDepth) return invalid('JSON metadata exceeds retention limits.')
  if (value === null || typeof value === 'boolean') return valid(value)
  if (typeof value === 'number') return Number.isFinite(value) ? valid(value) : invalid('JSON metadata contains a non-finite number.')
  if (typeof value === 'string') {
    return value.length <= WORKFLOW_CHECKPOINT_LIMITS.metadataStringLength
      ? valid(value)
      : invalid('JSON metadata text exceeds retention limits.')
  }
  const array = inspectJsonDataArray(value)
  if (array !== undefined) {
    if (!array.ok) return array
    if (array.value.length > WORKFLOW_CHECKPOINT_LIMITS.metadataCollectionSize) return invalid('JSON metadata array is too large.')
    const output: JsonValue[] = []
    for (const item of array.value) {
      const parsed = parseBoundedJsonValue(item, depth + 1, budget)
      if (!parsed.ok) return parsed
      output.push(parsed.value)
    }
    return valid(output)
  }
  const object = inspectPlainDataRecord(value, 'JSON metadata object')
  if (!object.ok) return invalid('JSON metadata contains an unsupported or unsafe value.')
  const keys = Object.keys(object.value)
  if (keys.length > WORKFLOW_CHECKPOINT_LIMITS.metadataCollectionSize ||
    keys.some((key) => key.length === 0 || key.length > WORKFLOW_CHECKPOINT_LIMITS.metadataKeyLength)) {
    return invalid('JSON metadata object is too large.')
  }
  const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
  for (const key of keys) {
    const parsed = parseBoundedJsonValue(object.value[key], depth + 1, budget)
    if (!parsed.ok) return parsed
    output[key] = parsed.value
  }
  return valid(output)
}

function inspectPlainDataRecord(value: unknown, label: string): ParseResult<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return invalid(`${label} must be a plain object.`)
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return invalid(`${label} must be a plain object.`)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const ownKeys = Reflect.ownKeys(descriptors)
    if (ownKeys.some((key) => typeof key !== 'string')) return invalid(`${label} contains unsupported fields.`)
    const output: Record<string, unknown> = Object.create(null)
    for (const key of ownKeys as string[]) {
      const descriptor = descriptors[key]
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return invalid(`${label} must not contain accessor fields.`)
      }
      output[key] = descriptor.value
    }
    return valid(output)
  } catch {
    return invalid(`${label} could not be inspected safely.`)
  }
}

function inspectJsonDataArray(value: unknown): ParseResult<readonly unknown[]> | undefined {
  let array: boolean
  try {
    array = Array.isArray(value)
  } catch {
    return invalid('JSON metadata array could not be inspected safely.')
  }
  if (!array) return undefined
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const lengthDescriptor = descriptors.length
    if (!lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
      !isNonNegativeInteger(lengthDescriptor.value)) {
      return invalid('JSON metadata array length is invalid.')
    }
    const length = lengthDescriptor.value
    const ownKeys = Reflect.ownKeys(descriptors)
    if (ownKeys.some((key) => typeof key !== 'string' || (key !== 'length' && !isArrayIndexKey(key, length)))) {
      return invalid('JSON metadata array contains unsupported fields.')
    }
    const output: unknown[] = []
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)]
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return invalid('JSON metadata array must not contain holes or accessor fields.')
      }
      output.push(descriptor.value)
    }
    return valid(output)
  } catch {
    return invalid('JSON metadata array could not be inspected safely.')
  }
}

function isArrayIndexKey(key: string, length: number): boolean {
  if (!/^(0|[1-9]\d*)$/.test(key)) return false
  const index = Number(key)
  return Number.isSafeInteger(index) && index >= 0 && index < length
}

function isAppendOnly<Value>(previous: readonly Value[], next: readonly Value[]): boolean {
  return next.length >= previous.length && previous.every((value, index) => sameValue(value, next[index]))
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function hasUnique<Value>(values: readonly Value[], key: (value: Value) => string): boolean {
  return new Set(values.map(key)).size === values.length
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isBoundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit
}

function isTimestamp(value: unknown): value is number {
  return isNonNegativeInteger(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isCheckpointStatus(value: unknown): value is WorkflowCheckpointStatus {
  return value === 'planning' || value === 'running' || value === 'waiting' ||
    value === 'succeeded' || value === 'failed' || value === 'cancelled'
}

function isCompletedStepOutcome(value: unknown): value is WorkflowCompletedStep['outcome'] {
  return value === 'succeeded' || value === 'failed' || value === 'cancelled' || value === 'skipped'
}

function isTerminalTaskStatus(value: unknown): value is WorkflowCheckpointTask['status'] {
  return value === 'succeeded' || value === 'failed' || value === 'cancelled' || value === 'expired'
}

function isEvidenceKind(value: unknown): value is WorkflowCheckpointEvidence['kind'] {
  return value === 'tool-result' || value === 'citation' || value === 'artifact' || value === 'diagnostic' || value === 'failure'
}

function isTraceType(value: unknown): value is WorkflowCheckpointTrace['type'] {
  return value === 'planning' || value === 'step' || value === 'task' ||
    value === 'evidence' || value === 'recovery' || value === 'failure'
}

function isTraceStatus(value: unknown): value is WorkflowCheckpointTrace['status'] {
  return value === 'pending' || value === 'running' || value === 'done' || value === 'error' || value === 'cancelled'
}

function isPendingActionReason(value: unknown): value is WorkflowCheckpointPendingAction['reason'] {
  return value === 'permission_required' || value === 'step_limit_reached' || value === 'evidence_insufficient' ||
    value === 'human_review' || value === 'required_input'
}

function isResumePolicy(value: unknown): value is WorkflowCheckpointPendingAction['resumePolicy'] {
  return value === 'reconcile-task-before-resume' || value === 'human-review-only'
}

function isJournalEventType(value: unknown): value is WorkflowCheckpointJournalEventType {
  return value === 'checkpoint.created' || value === 'workflow.started' || value === 'workflow.progressed' ||
    value === 'workflow.waiting' || value === 'workflow.succeeded' || value === 'workflow.failed' ||
    value === 'workflow.cancelled' || value === 'recovery.failure-retained'
}

const checkpointKeys = new Set([
  'schema', 'runId', 'revision', 'journalSequence', 'status', 'goalHash', 'startedAt', 'updatedAt',
  'completedSteps', 'tasks', 'evidence', 'traces', 'lastCompletedStep', 'pendingAction', 'failureEvidence',
])
const journalKeys = new Set([
  'schema', 'runId', 'sequence', 'revision', 'type', 'occurredAt', 'toStatus', 'fromStatus',
  'lastCompletedStepId', 'failureCode', 'data',
])
const completedStepKeys = new Set(['id', 'title', 'outcome', 'completedAt', 'taskIds', 'evidenceIds', 'summary'])
const taskKeys = new Set(['taskId', 'stepId', 'status', 'recordedAt', 'idempotencyKeyHash', 'artifactIds', 'summary'])
const evidenceKeys = new Set(['id', 'kind', 'summary', 'recordedAt', 'stepId', 'taskId', 'sourceRef', 'metadata'])
const traceKeys = new Set(['id', 'type', 'status', 'title', 'startedAt', 'completedAt', 'stepId', 'taskId', 'summary', 'metadata'])
const pendingActionKeys = new Set([
  'id', 'reason', 'title', 'summary', 'createdAt', 'resumePolicy', 'requiresUserConfirmation',
  'stepId', 'taskId', 'confirmationId', 'details',
])
const failureEvidenceKeys = new Set([
  'code', 'message', 'recordedAt', 'retryable', 'stepId', 'taskId', 'evidenceIds', 'details',
])
