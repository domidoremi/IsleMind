import type {
  WorkflowRuntimeFailureCode,
  WorkflowRuntimeTransitionReason,
} from './workflowRuntimePolicy'

export interface WorkflowStepOutcomePlanStep {
  readonly id: string
  readonly title: string
}

export interface WorkflowStepOutcomeObservation {
  readonly ok: boolean
  readonly status: 'done' | 'error' | 'skipped'
  readonly output: string
  readonly errorCode?: WorkflowRuntimeFailureCode
  readonly diagnostic: {
    readonly metadata?: Readonly<Record<string, unknown>>
  }
}

export interface WorkflowStepOutcomeStep {
  readonly id: string
  readonly title: string
  readonly status: 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled'
  readonly toolRequest?: {
    readonly toolId?: string
    readonly name?: string
    readonly source?: 'mcp' | 'builtin' | 'app-action' | 'rag' | 'search' | 'work-artifact' | 'android'
    readonly serverId?: string
    readonly arguments?: Readonly<Record<string, unknown>>
  }
  readonly observation?: WorkflowStepOutcomeObservation
}

export interface WorkflowStepOutcomePendingAction {
  readonly reason: 'permission_required' | 'evidence_insufficient' | 'step_limit_reached'
  readonly blockedReason?: string
}

export interface WorkflowStepCancellationResult {
  readonly status: 'cancelled'
  readonly failureCode: 'cancelled'
  readonly finalOutput: string
  readonly progressMetadata: Readonly<object>
}

export interface WorkflowTerminalStepOutcome<
  TStep extends WorkflowStepOutcomeStep,
  TPendingAction extends WorkflowStepOutcomePendingAction,
> {
  readonly kind: 'terminal'
  readonly completion: {
    readonly status: 'cancelled' | 'waiting' | 'error'
    readonly failureCode: WorkflowRuntimeFailureCode
    readonly finalOutput: string
    readonly pendingAction?: TPendingAction
    readonly progressMetadata?: Readonly<object>
    readonly failureMetadata?: Readonly<object>
    readonly transitionReason: WorkflowRuntimeTransitionReason
    readonly transitionStep: TStep
  }
}

export interface WorkflowContinuingStepOutcome<TRuntimeState> {
  readonly kind: 'continue'
  readonly runtimeState: TRuntimeState
}

export type WorkflowStepOutcome<
  TStep extends WorkflowStepOutcomeStep,
  TPendingAction extends WorkflowStepOutcomePendingAction,
  TRuntimeState,
> =
  | WorkflowTerminalStepOutcome<TStep, TPendingAction>
  | WorkflowContinuingStepOutcome<TRuntimeState>

export interface WorkflowStepOutcomePolicyDependencies<
  TStep extends WorkflowStepOutcomeStep,
  TPendingAction extends WorkflowStepOutcomePendingAction,
  TRuntimeState,
> {
  cancel(input: {
    goal: string
    planSteps: readonly WorkflowStepOutcomePlanStep[]
    observedSteps: readonly TStep[]
    output?: string
  }): WorkflowStepCancellationResult
  buildPendingAction(runId: string, goal: string, step: TStep): TPendingAction | undefined
  formatPendingActionOutput(pendingAction: TPendingAction | undefined, fallback: string): string
  formatToolFailureDetails(step: TStep): string
  projectFailureMetadata(step: TStep): Readonly<object>
  extractRuntimeState(observation: WorkflowStepOutcomeObservation | undefined): TRuntimeState
  mergeRuntimeState(target: TRuntimeState, source: TRuntimeState): TRuntimeState
}

export interface ResolveWorkflowStepOutcomeInput<
  TStep extends WorkflowStepOutcomeStep,
  TRuntimeState,
> {
  runId: string
  goal: string
  planSteps: readonly WorkflowStepOutcomePlanStep[]
  observedSteps: readonly TStep[]
  step: TStep
  runtimeState: TRuntimeState
}

export function createWorkflowStepOutcomePolicy<
  TStep extends WorkflowStepOutcomeStep,
  TPendingAction extends WorkflowStepOutcomePendingAction,
  TRuntimeState,
>(
  dependencies: WorkflowStepOutcomePolicyDependencies<TStep, TPendingAction, TRuntimeState>,
): {
  resolve(
    input: ResolveWorkflowStepOutcomeInput<TStep, TRuntimeState>,
  ): WorkflowStepOutcome<TStep, TPendingAction, TRuntimeState>
} {
  return {
    resolve(input) {
      if (input.step.status === 'cancelled') {
        const cancellation = dependencies.cancel({
          goal: input.goal,
          planSteps: input.planSteps,
          observedSteps: input.observedSteps,
          output: input.step.observation?.output,
        })
        return {
          kind: 'terminal',
          completion: {
            status: cancellation.status,
            failureCode: cancellation.failureCode,
            finalOutput: cancellation.finalOutput,
            progressMetadata: cancellation.progressMetadata,
            transitionReason: 'cancelled',
            transitionStep: input.step,
          },
        }
      }

      const observation = input.step.observation
      const errorCode = observation?.errorCode
      if (
        observation
        && (errorCode === 'permission_required' || errorCode === 'evidence_insufficient')
      ) {
        const pendingAction = dependencies.buildPendingAction(input.runId, input.goal, input.step)
        const failureMetadata = errorCode === 'evidence_insufficient'
          ? {
              ...dependencies.projectFailureMetadata(input.step),
              ...(pendingAction?.blockedReason
                ? { repairNextStep: pendingAction.blockedReason }
                : {}),
            }
          : undefined
        return {
          kind: 'terminal',
          completion: {
            status: 'waiting',
            failureCode: errorCode,
            finalOutput: dependencies.formatPendingActionOutput(
              pendingAction,
              observation.output,
            ),
            pendingAction,
            failureMetadata,
            transitionReason: errorCode === 'evidence_insufficient'
              ? 'evidence-insufficient'
              : 'permission-required',
            transitionStep: input.step,
          },
        }
      }

      if (errorCode) {
        return {
          kind: 'terminal',
          completion: {
            status: 'error',
            failureCode: errorCode,
            finalOutput: dependencies.formatToolFailureDetails(input.step),
            failureMetadata: dependencies.projectFailureMetadata(input.step),
            transitionReason: 'tool-error',
            transitionStep: input.step,
          },
        }
      }

      return {
        kind: 'continue',
        runtimeState: dependencies.mergeRuntimeState(
          input.runtimeState,
          dependencies.extractRuntimeState(input.step.observation),
        ),
      }
    },
  }
}
