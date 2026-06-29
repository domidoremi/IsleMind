import type { AgentFailureCode, AgentPendingAction, AgentRunStatus, AgentStep, AgentWorkflowRun } from '@/services/agent/agentToolTypes'

export const AGENT_WORKFLOW_RUNTIME_SCHEMA = 'islemind.agent.workflow-runtime.v1'

export type AgentWorkflowRuntimeTransitionReason =
  | 'plan-ready'
  | 'direct-chat'
  | 'definition-invalid'
  | 'cancelled'
  | 'permission-required'
  | 'tool-error'
  | 'step-limit'
  | 'evidence-insufficient'
  | 'completed'

export interface AgentWorkflowRuntimeTransition {
  from: AgentRunStatus
  to: AgentRunStatus
  reason: AgentWorkflowRuntimeTransitionReason
  at: number
  failureCode?: AgentFailureCode
  pendingActionReason?: AgentPendingAction['reason']
  stepId?: string
  stepTitle?: string
  stepStatus?: AgentStep['status']
}

export interface AgentWorkflowRuntimeState {
  schema: typeof AGENT_WORKFLOW_RUNTIME_SCHEMA
  runId: string
  goalHash: string
  status: AgentRunStatus
  startedAt: number
  updatedAt: number
  stepCount: number
  completedStepCount: number
  failedStepCount: number
  cancelledStepCount: number
  pendingActionReason?: AgentPendingAction['reason']
  failureCode?: AgentFailureCode
  transitions: AgentWorkflowRuntimeTransition[]
}

export function createAgentWorkflowRuntime(run: Pick<AgentWorkflowRun, 'id' | 'goal' | 'status' | 'startedAt'>): AgentWorkflowRuntimeState {
  return {
    schema: AGENT_WORKFLOW_RUNTIME_SCHEMA,
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

export function advanceAgentWorkflowRuntime(
  runtime: AgentWorkflowRuntimeState,
  input: {
    status: AgentRunStatus
    reason: AgentWorkflowRuntimeTransitionReason
    at?: number
    failureCode?: AgentFailureCode
    pendingAction?: AgentPendingAction
    step?: AgentStep
  }
): AgentWorkflowRuntimeState {
  assertAgentWorkflowTransition(runtime.status, input.status)
  const at = input.at ?? Date.now()
  runtime.transitions.push({
    from: runtime.status,
    to: input.status,
    reason: input.reason,
    at,
    failureCode: input.failureCode,
    pendingActionReason: input.pendingAction?.reason,
    stepId: input.step?.id,
    stepTitle: input.step?.title,
    stepStatus: input.step?.status,
  })
  runtime.status = input.status
  runtime.updatedAt = at
  runtime.failureCode = input.failureCode
  runtime.pendingActionReason = input.pendingAction?.reason
  return runtime
}

export function observeAgentWorkflowRuntimeStep(runtime: AgentWorkflowRuntimeState, steps: AgentStep[]): AgentWorkflowRuntimeState {
  runtime.stepCount = steps.length
  runtime.completedStepCount = steps.filter((step) => step.status === 'done').length
  runtime.failedStepCount = steps.filter((step) => step.status === 'error').length
  runtime.cancelledStepCount = steps.filter((step) => step.status === 'cancelled').length
  return runtime
}

export function applyAgentWorkflowRuntimeToRun(run: AgentWorkflowRun, runtime: AgentWorkflowRuntimeState): AgentWorkflowRun {
  run.status = runtime.status
  return run
}

export function agentWorkflowRuntimeTraceMetadata(runtime: AgentWorkflowRuntimeState): Record<string, unknown> {
  const lastTransition = runtime.transitions.at(-1)
  return {
    agentWorkflowRuntimeSchema: runtime.schema,
    agentWorkflowRuntimeRunId: runtime.runId,
    agentWorkflowRuntimeGoalHash: runtime.goalHash,
    agentWorkflowRuntimeStatus: runtime.status,
    agentWorkflowRuntimeTransitionCount: runtime.transitions.length,
    agentWorkflowRuntimeLastReason: lastTransition?.reason,
    agentWorkflowRuntimeLastFrom: lastTransition?.from,
    agentWorkflowRuntimeLastTo: lastTransition?.to,
    agentWorkflowRuntimeStepCount: runtime.stepCount,
    agentWorkflowRuntimeCompletedStepCount: runtime.completedStepCount,
    agentWorkflowRuntimeFailedStepCount: runtime.failedStepCount,
    agentWorkflowRuntimeCancelledStepCount: runtime.cancelledStepCount,
    agentWorkflowRuntimePendingActionReason: runtime.pendingActionReason,
    agentWorkflowRuntimeFailureCode: runtime.failureCode,
    agentWorkflowRuntimeTransitions: runtime.transitions.slice(-8),
  }
}

function assertAgentWorkflowTransition(from: AgentRunStatus, to: AgentRunStatus): void {
  if (from === to) return
  const allowed = allowedAgentWorkflowTransitions[from] ?? []
  if (allowed.includes(to)) return
  throw new Error(`Invalid agent workflow runtime transition: ${from} -> ${to}`)
}

const allowedAgentWorkflowTransitions: Record<AgentRunStatus, AgentRunStatus[]> = {
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
