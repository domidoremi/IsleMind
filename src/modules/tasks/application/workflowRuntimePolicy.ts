export const WORKFLOW_RUNTIME_SCHEMA = 'islemind.workflow-runtime.v2'

export type WorkflowRuntimeStatus = 'planning' | 'running' | 'waiting' | 'done' | 'error' | 'cancelled'

export type WorkflowRuntimeStepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled'

export type WorkflowRuntimeFailureCode =
  | 'provider_unavailable'
  | 'tool_unavailable'
  | 'permission_required'
  | 'schema_invalid'
  | 'rag_unavailable'
  | 'evidence_insufficient'
  | 'cancelled'
  | 'step_limit_reached'
  | 'policy_denied'
  | 'execution_failed'

export type WorkflowRuntimePendingActionReason = Extract<
  WorkflowRuntimeFailureCode,
  'permission_required' | 'step_limit_reached' | 'evidence_insufficient'
>

export type WorkflowRuntimeTransitionReason =
  | 'plan-ready'
  | 'direct-chat'
  | 'definition-invalid'
  | 'cancelled'
  | 'permission-required'
  | 'tool-error'
  | 'step-limit'
  | 'evidence-insufficient'
  | 'completed'

export interface WorkflowRuntimeTransition {
  from: WorkflowRuntimeStatus
  to: WorkflowRuntimeStatus
  reason: WorkflowRuntimeTransitionReason
  at: number
  failureCode?: WorkflowRuntimeFailureCode
  pendingActionReason?: WorkflowRuntimePendingActionReason
  stepId?: string
  stepTitle?: string
  stepStatus?: WorkflowRuntimeStepStatus
}

export interface WorkflowRuntimeState {
  schema: typeof WORKFLOW_RUNTIME_SCHEMA
  runId: string
  goalHash: string
  status: WorkflowRuntimeStatus
  startedAt: number
  updatedAt: number
  stepCount: number
  completedStepCount: number
  failedStepCount: number
  cancelledStepCount: number
  pendingActionReason?: WorkflowRuntimePendingActionReason
  failureCode?: WorkflowRuntimeFailureCode
  transitions: WorkflowRuntimeTransition[]
}

export interface WorkflowRuntimeRunInput {
  id: string
  goal: string
  status: WorkflowRuntimeStatus
  startedAt: number
}

export interface WorkflowRuntimePendingActionInput {
  reason: WorkflowRuntimePendingActionReason
}

export interface WorkflowRuntimeStepInput {
  id: string
  title: string
  status: WorkflowRuntimeStepStatus
}

export function createWorkflowRuntime(run: WorkflowRuntimeRunInput): WorkflowRuntimeState {
  return {
    schema: WORKFLOW_RUNTIME_SCHEMA,
    runId: run.id,
    goalHash: stableWorkflowRuntimeHash(run.goal),
    status: run.status,
    startedAt: run.startedAt,
    updatedAt: run.startedAt,
    stepCount: 0,
    completedStepCount: 0,
    failedStepCount: 0,
    cancelledStepCount: 0,
    transitions: [],
  }
}

export function advanceWorkflowRuntime(
  runtime: WorkflowRuntimeState,
  input: {
    status: WorkflowRuntimeStatus
    reason: WorkflowRuntimeTransitionReason
    at: number
    failureCode?: WorkflowRuntimeFailureCode
    pendingAction?: WorkflowRuntimePendingActionInput
    step?: WorkflowRuntimeStepInput
  },
): WorkflowRuntimeState {
  assertWorkflowTransition(runtime.status, input.status)
  const transition: WorkflowRuntimeTransition = {
    from: runtime.status,
    to: input.status,
    reason: input.reason,
    at: input.at,
    failureCode: input.failureCode,
    pendingActionReason: input.pendingAction?.reason,
    stepId: input.step?.id,
    stepTitle: input.step?.title,
    stepStatus: input.step?.status,
  }
  return {
    ...runtime,
    status: input.status,
    updatedAt: input.at,
    failureCode: input.failureCode,
    pendingActionReason: input.pendingAction?.reason,
    transitions: [...runtime.transitions, transition],
  }
}

export function observeWorkflowRuntimeStep(
  runtime: WorkflowRuntimeState,
  steps: readonly WorkflowRuntimeStepInput[],
): WorkflowRuntimeState {
  return {
    ...runtime,
    stepCount: steps.length,
    completedStepCount: steps.filter((step) => step.status === 'done').length,
    failedStepCount: steps.filter((step) => step.status === 'error').length,
    cancelledStepCount: steps.filter((step) => step.status === 'cancelled').length,
  }
}

export function workflowRuntimeTraceMetadata(runtime: WorkflowRuntimeState): Record<string, unknown> {
  const lastTransition = runtime.transitions.at(-1)
  return {
    workflowRuntimeSchema: runtime.schema,
    workflowRuntimeRunId: runtime.runId,
    workflowRuntimeGoalHash: runtime.goalHash,
    workflowRuntimeStatus: runtime.status,
    workflowRuntimeTransitionCount: runtime.transitions.length,
    workflowRuntimeLastReason: lastTransition?.reason,
    workflowRuntimeLastFrom: lastTransition?.from,
    workflowRuntimeLastTo: lastTransition?.to,
    workflowRuntimeStepCount: runtime.stepCount,
    workflowRuntimeCompletedStepCount: runtime.completedStepCount,
    workflowRuntimeFailedStepCount: runtime.failedStepCount,
    workflowRuntimeCancelledStepCount: runtime.cancelledStepCount,
    workflowRuntimePendingActionReason: runtime.pendingActionReason,
    workflowRuntimeFailureCode: runtime.failureCode,
    workflowRuntimeTransitions: runtime.transitions.slice(-8).map((transition) => ({ ...transition })),
  }
}

function assertWorkflowTransition(from: WorkflowRuntimeStatus, to: WorkflowRuntimeStatus): void {
  if (from === to) return
  const allowed = allowedWorkflowTransitions[from]
  if (allowed.includes(to)) return
  throw new Error(`Invalid workflow runtime transition: ${from} -> ${to}`)
}

const allowedWorkflowTransitions: Record<WorkflowRuntimeStatus, readonly WorkflowRuntimeStatus[]> = {
  planning: ['running', 'waiting', 'done', 'error', 'cancelled'],
  running: ['waiting', 'done', 'error', 'cancelled'],
  waiting: [],
  done: [],
  error: [],
  cancelled: [],
}

function stableWorkflowRuntimeHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`
}
