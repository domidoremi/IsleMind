import type { AssistantRunId, Result } from '@/core'
import {
  type WorkflowCheckpoint,
  type WorkflowCheckpointErrorCode,
  type WorkflowCheckpointEvidence,
  type WorkflowCheckpointFailureEvidence,
  type WorkflowCheckpointPendingAction,
  type WorkflowCheckpointStatus,
  type WorkflowCheckpointStore,
  type WorkflowCheckpointTask,
  type WorkflowCheckpointTrace,
  type WorkflowCompletedStep,
} from './workflowCheckpoint'
import {
  createWorkflowCheckpointRecorder,
  type WorkflowCheckpointRecorder,
} from './workflowCheckpointRecorder'

export type WorkflowCheckpointProjectionStatus =
  | 'planning'
  | 'running'
  | 'waiting'
  | 'done'
  | 'error'
  | 'cancelled'

export type WorkflowCheckpointProjectionStepStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'error'
  | 'skipped'
  | 'cancelled'

export interface WorkflowCheckpointProjectionStep {
  id: string
  title: string
  status: WorkflowCheckpointProjectionStepStatus
  toolRequest?: {
    toolId?: string
    name?: string
    source?: string
    serverId?: string
  }
  observation?: {
    output?: string
    errorCode?: string
    metadata?: Readonly<Record<string, unknown>>
  }
  startedAt?: number
  completedAt?: number
}

export interface WorkflowCheckpointProjectionRun {
  id: string
  status: WorkflowCheckpointProjectionStatus
  steps: readonly WorkflowCheckpointProjectionStep[]
  startedAt: number
  completedAt?: number
  failureCode?: string
  finalOutput?: string
  pendingAction?: {
    id: string
    reason: WorkflowCheckpointPendingAction['reason']
    title: string
    summary: string
    confirmable: boolean
    stepId?: string
    createdAt: number
  }
}

export interface WorkflowCheckpointProjectionSession {
  initialize(signal: AbortSignal): Promise<void>
  recordStarted(occurredAt: number, signal: AbortSignal): Promise<void>
  recordStep(step: WorkflowCheckpointProjectionStep, signal: AbortSignal): Promise<void>
  recordTerminal(run: WorkflowCheckpointProjectionRun, signal: AbortSignal): Promise<void>
}

export type WorkflowCheckpointProjectionPhase = 'initialize' | 'started' | 'step' | 'terminal'

export class WorkflowCheckpointProjectionError extends Error {
  readonly code: WorkflowCheckpointErrorCode
  readonly phase: WorkflowCheckpointProjectionPhase
  readonly retryable: boolean

  constructor(input: {
    code: WorkflowCheckpointErrorCode
    phase: WorkflowCheckpointProjectionPhase
    message: string
    retryable: boolean
  }) {
    super(`Workflow checkpoint ${input.phase} failed: ${input.message}`)
    this.name = 'WorkflowCheckpointProjectionError'
    this.code = input.code
    this.phase = input.phase
    this.retryable = input.retryable
  }
}

export function createWorkflowCheckpointProjectionSession(input: {
  store: WorkflowCheckpointStore
  runId: AssistantRunId
  goal: string
  startedAt: number
  now: () => number
  redactText: (value: string) => string
}): WorkflowCheckpointProjectionSession {
  const recorder = createWorkflowCheckpointRecorder({
    store: input.store,
    runId: input.runId,
    goalHash: `workflow-goal-${hashText(input.goal)}`,
    startedAt: input.startedAt,
  })
  return {
    async initialize(signal) {
      assertCheckpointResult(await recorder.initialize(signal), 'initialize')
    },
    async recordStarted(occurredAt, signal) {
      await recordStarted(recorder, occurredAt, signal)
    },
    async recordStep(step, signal) {
      await recordStep(recorder, step, signal, input.now, input.redactText)
    },
    async recordTerminal(run, signal) {
      await recordTerminal(recorder, run, signal, input.now, input.redactText)
    },
  }
}

export function mapWorkflowCheckpointProjectionStatus(
  status: WorkflowCheckpointProjectionStatus,
): WorkflowCheckpointStatus {
  if (status === 'done') return 'succeeded'
  if (status === 'error') return 'failed'
  return status
}

async function recordStarted(
  recorder: WorkflowCheckpointRecorder,
  occurredAt: number,
  signal: AbortSignal,
): Promise<void> {
  assertCheckpointResult(await recorder.record({
    status: 'running',
    occurredAt,
    traces: [{
      id: 'agent-workflow-started',
      type: 'planning',
      status: 'done',
      title: 'Agent workflow plan',
      startedAt: occurredAt,
      completedAt: occurredAt,
      summary: 'The bounded Agent plan is ready for execution.',
    }],
  }, signal), 'started')
}

async function recordStep(
  recorder: WorkflowCheckpointRecorder,
  step: WorkflowCheckpointProjectionStep,
  signal: AbortSignal,
  now: () => number,
  redactText: (value: string) => string,
): Promise<void> {
  const current = requireCurrentCheckpoint(recorder, 'step')
  const recordedAt = Math.max(step.completedAt ?? step.startedAt ?? now(), current.updatedAt)
  const task = checkpointTask(step, recordedAt, redactText)
  const evidence = step.observation ? checkpointEvidence(step, task?.taskId, recordedAt, redactText) : undefined
  const completedStep: WorkflowCompletedStep = {
    id: boundedText(step.id, 256, `step-${current.revision}`, redactText),
    title: boundedText(step.title, 512, 'Agent step', redactText),
    outcome: stepOutcome(step.status),
    completedAt: recordedAt,
    taskIds: task ? [task.taskId] : [],
    evidenceIds: evidence ? [evidence.id] : [],
    summary: summary(step.observation?.output, step.title, 2_000, redactText),
  }
  const trace: WorkflowCheckpointTrace = {
    id: boundedText(`checkpoint-trace-${completedStep.id}`, 256, `checkpoint-trace-${recordedAt}`, redactText),
    type: task ? 'task' : 'step',
    status: traceStatus(step.status),
    title: completedStep.title,
    startedAt: Math.min(step.startedAt ?? recordedAt, recordedAt),
    completedAt: recordedAt,
    stepId: completedStep.id,
    ...(task ? { taskId: task.taskId } : {}),
    summary: completedStep.summary,
  }
  assertCheckpointResult(await recorder.record({
    status: 'running',
    occurredAt: recordedAt,
    completedSteps: [completedStep],
    ...(task ? { tasks: [task] } : {}),
    ...(evidence ? { evidence: [evidence] } : {}),
    traces: [trace],
  }, signal), 'step')
}

async function recordTerminal(
  recorder: WorkflowCheckpointRecorder,
  run: WorkflowCheckpointProjectionRun,
  signal: AbortSignal,
  now: () => number,
  redactText: (value: string) => string,
): Promise<void> {
  const current = requireCurrentCheckpoint(recorder, 'terminal')
  const status = mapWorkflowCheckpointProjectionStatus(run.status)
  const occurredAt = Math.max(run.completedAt ?? now(), current.updatedAt)
  const pendingAction = status === 'waiting' ? pendingActionRecord(run, redactText) : undefined
  const failureEvidence = status === 'failed' ? failureRecord(run, current, occurredAt, redactText) : undefined
  const trace: WorkflowCheckpointTrace = {
    id: `agent-workflow-terminal-${current.revision + 1}`,
    type: status === 'failed' ? 'failure' : 'step',
    status: status === 'succeeded' ? 'done' : status === 'cancelled' ? 'cancelled' : status === 'waiting' ? 'pending' : 'error',
    title: 'Agent workflow',
    startedAt: Math.min(run.startedAt, occurredAt),
    completedAt: occurredAt,
    summary: summary(run.finalOutput, status, 4_000, redactText),
  }
  assertCheckpointResult(await recorder.record({
    status,
    occurredAt,
    traces: [trace],
    ...(pendingAction ? { pendingAction } : {}),
    ...(failureEvidence ? { failureEvidence } : {}),
  }, signal), 'terminal')
}

function assertCheckpointResult(
  result: Result<WorkflowCheckpoint, WorkflowCheckpointErrorCode>,
  phase: WorkflowCheckpointProjectionPhase,
): void {
  if (result.ok) return
  throw new WorkflowCheckpointProjectionError({
    code: result.error.code,
    phase,
    message: result.error.message,
    retryable: result.error.retryable,
  })
}

function requireCurrentCheckpoint(
  recorder: WorkflowCheckpointRecorder,
  phase: WorkflowCheckpointProjectionPhase,
): WorkflowCheckpoint {
  const current = recorder.current()
  if (current) return current
  throw new WorkflowCheckpointProjectionError({
    code: 'invalid_transition',
    phase,
    message: 'Workflow checkpoint is not initialized.',
    retryable: false,
  })
}

function stepOutcome(status: WorkflowCheckpointProjectionStepStatus): WorkflowCompletedStep['outcome'] {
  if (status === 'done') return 'succeeded'
  if (status === 'error') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return 'skipped'
}

function traceStatus(status: WorkflowCheckpointProjectionStepStatus): WorkflowCheckpointTrace['status'] {
  if (status === 'done') return 'done'
  if (status === 'error') return 'error'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'running') return 'running'
  if (status === 'pending') return 'pending'
  return 'done'
}

function checkpointTask(
  step: WorkflowCheckpointProjectionStep,
  recordedAt: number,
  redactText: (value: string) => string,
): WorkflowCheckpointTask | undefined {
  const taskId = taskIdFromStep(step, redactText)
  const status = terminalTaskStatus(
    step.observation?.metadata?.taskStatus ?? step.observation?.metadata?.vnextTaskStatus,
  )
  if (!taskId || !status) return undefined
  return {
    taskId,
    stepId: boundedText(step.id, 256, 'agent-step', redactText),
    status,
    recordedAt,
    artifactIds: textArray(step.observation?.metadata?.artifactIds, 32, 256, redactText),
    summary: summary(step.observation?.output, step.title, 2_000, redactText),
  }
}

function taskIdFromStep(
  step: WorkflowCheckpointProjectionStep | undefined,
  redactText: (value: string) => string,
): string | undefined {
  const value = step?.observation?.metadata?.taskId ?? step?.observation?.metadata?.vnextTaskId
  return typeof value === 'string' && value.trim()
    ? boundedText(value, 256, '', redactText) || undefined
    : undefined
}

function terminalTaskStatus(value: unknown): WorkflowCheckpointTask['status'] | undefined {
  return value === 'succeeded' || value === 'failed' || value === 'cancelled' || value === 'expired' ? value : undefined
}

function checkpointEvidence(
  step: WorkflowCheckpointProjectionStep,
  taskId: string | undefined,
  recordedAt: number,
  redactText: (value: string) => string,
): WorkflowCheckpointEvidence {
  const stepId = boundedText(step.id, 256, 'agent-step', redactText)
  const toolRef = [step.toolRequest?.source, step.toolRequest?.serverId, step.toolRequest?.toolId ?? step.toolRequest?.name]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .join(':')
  return {
    id: boundedText(`${stepId}:observation`, 256, `evidence-${recordedAt}`, redactText),
    kind: step.observation?.errorCode ? 'failure' : step.toolRequest ? 'tool-result' : 'diagnostic',
    summary: summary(step.observation?.output, step.title, 4_000, redactText),
    recordedAt,
    stepId,
    ...(taskId ? { taskId } : {}),
    ...(toolRef ? { sourceRef: boundedText(toolRef, 2_048, 'agent-tool', redactText) } : {}),
  }
}

function pendingActionRecord(
  run: WorkflowCheckpointProjectionRun,
  redactText: (value: string) => string,
): WorkflowCheckpointPendingAction | undefined {
  const action = run.pendingAction
  if (!action) return undefined
  const taskId = taskIdFromStep(run.steps[run.steps.length - 1], redactText)
  return {
    id: boundedText(action.id, 256, `pending-${run.id}`, redactText),
    reason: action.reason,
    title: boundedText(action.title, 512, 'Agent workflow action', redactText),
    summary: summary(action.summary, 'Agent workflow is waiting for an action.', 2_000, redactText),
    createdAt: action.createdAt,
    resumePolicy: taskId ? 'reconcile-task-before-resume' : 'human-review-only',
    requiresUserConfirmation: action.confirmable,
    ...(action.stepId ? { stepId: boundedText(action.stepId, 256, 'agent-step', redactText) } : {}),
    ...(taskId ? { taskId } : {}),
  }
}

function failureRecord(
  run: WorkflowCheckpointProjectionRun,
  current: NonNullable<ReturnType<WorkflowCheckpointRecorder['current']>>,
  recordedAt: number,
  redactText: (value: string) => string,
): WorkflowCheckpointFailureEvidence {
  const lastStep = run.steps[run.steps.length - 1]
  const taskId = taskIdFromStep(lastStep, redactText)
  return {
    code: boundedText(run.failureCode ?? 'execution_failed', 128, 'execution_failed', redactText),
    message: summary(run.finalOutput, 'Agent workflow failed.', 2_000, redactText),
    recordedAt,
    retryable: run.failureCode === 'provider_unavailable' || run.failureCode === 'execution_failed',
    ...(lastStep ? { stepId: boundedText(lastStep.id, 256, 'agent-step', redactText) } : {}),
    ...(taskId ? { taskId } : {}),
    evidenceIds: (current.lastCompletedStep?.evidenceIds ?? []).slice(0, 32),
  }
}

function summary(
  value: string | undefined,
  fallback: string,
  limit: number,
  redactText: (value: string) => string,
): string {
  const safe = redactText(value?.trim() || fallback)
  const bounded = safe.length <= limit
    ? safe
    : safe.slice(0, Math.max(0, limit - 32)).trimEnd()
  return bounded.trim() || fallback.slice(0, limit)
}

function boundedText(
  value: string,
  limit: number,
  fallback: string,
  redactText: (value: string) => string,
): string {
  const safe = redactText(value).trim().slice(0, limit)
  return safe || fallback.slice(0, limit)
}

function textArray(
  value: unknown,
  countLimit: number,
  textLimit: number,
  redactText: (value: string) => string,
): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => boundedText(item, textLimit, '', redactText))
    .filter(Boolean))]
    .slice(0, countLimit)
}

function hashText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
