import type { AssistantRunId, Clock, ProcessTrace } from '@/core'
import type { WorkflowRunLimits } from './workflowRunLimitPolicy'
import type { AndroidWorkflowRuntimeState } from './androidWorkflowRuntimeStatePolicy'
import type {
  WorkflowCheckpointProjectionSession,
} from './workflowCheckpointProjectionSession'
import type { WorkflowCheckpointStore } from './workflowCheckpoint'
import type {
  WorkflowCompletionPolicy,
} from './workflowCompletionPolicy'
import type { WorkflowContinuationPolicy } from './workflowContinuationPolicy'
import type {
  WorkflowDefinitionRecord,
  WorkflowDefinitionToolManifest,
  WorkflowDefinitionValidationResult,
} from './workflowDefinitionPolicy'
import type { WorkflowRagEvidencePolicy } from './workflowRagEvidencePolicy'
import type {
  WorkflowPermissionEvidence,
  WorkflowPermissionEvidenceInput,
} from './workflowPermissionEvidencePolicy'
import type {
  WorkflowPlannerPlan,
  WorkflowPlannerRequestedOutput,
} from './workflowPlanner'
import type {
  WorkflowExecutionRun,
  WorkflowExecutionRuntimeLogOptions,
} from './workflowExecutionRunContracts'
import {
  advanceWorkflowRuntime,
  createWorkflowRuntime,
  observeWorkflowRuntimeStep,
} from './workflowRuntimePolicy'
import type {
  WorkflowStep,
  WorkflowStepExecutor,
  WorkflowStepRuntimeOptions,
  WorkflowStepToolRequest,
} from './workflowStepExecutor'
import type {
  ResolveWorkflowStepOutcomeInput,
  WorkflowStepOutcome,
} from './workflowStepOutcomePolicy'
import { bindAndroidWorkflowRuntimeState } from './androidWorkflowRuntimeStatePolicy'
import { resolveWorkflowRunLimits } from './workflowRunLimitPolicy'

export interface WorkflowOrchestratorInput<
  TManifest extends WorkflowDefinitionToolManifest,
  TRagRuntime,
> {
  goal: string
  assistantRunId?: AssistantRunId
  workflowCheckpointStore?: WorkflowCheckpointStore
  content?: string
  toolRequest?: WorkflowStepToolRequest
  requestedOutput?: WorkflowPlannerRequestedOutput
  workflowDefinition?: WorkflowDefinitionRecord
  manifests?: TManifest[]
  ragRuntime?: TRagRuntime
  runtimeLog?: WorkflowExecutionRuntimeLogOptions
  limits?: Partial<WorkflowRunLimits>
  intentVisible?: boolean
  userConfirmed?: boolean
  signal?: AbortSignal
  now?: number
}

export interface WorkflowStepRuntimeDependencyInput<
  TManifest extends WorkflowDefinitionToolManifest,
  TRagRuntime,
> {
  manifests?: readonly TManifest[]
  ragRuntime?: TRagRuntime
  runtimeLog?: WorkflowExecutionRuntimeLogOptions
}

export interface WorkflowOrchestratorDependencies<
  TManifest extends WorkflowDefinitionToolManifest,
  TRagRuntime,
  TStepRuntimeOptions extends WorkflowStepRuntimeOptions,
> {
  clock: Clock
  validateWorkflowDefinition(
    workflow: unknown,
    manifests: readonly TManifest[],
  ): WorkflowDefinitionValidationResult
  createPlan(input: {
    goal: string
    content?: string
    toolRequest?: WorkflowStepToolRequest
    requestedOutput?: WorkflowPlannerRequestedOutput
    workflowDefinition?: WorkflowDefinitionRecord
    now?: number
  }): WorkflowPlannerPlan<WorkflowStepToolRequest>
  buildStepRuntimeOptions(
    input: WorkflowStepRuntimeDependencyInput<TManifest, TRagRuntime>,
  ): TStepRuntimeOptions
  executeStep: WorkflowStepExecutor<WorkflowStepToolRequest, TStepRuntimeOptions>
  createCheckpointSession(input: {
    store: WorkflowCheckpointStore
    runId: AssistantRunId
    goal: string
    startedAt: number
  }): WorkflowCheckpointProjectionSession
  continuationPolicy: WorkflowContinuationPolicy
  resolveStepOutcome(
    input: ResolveWorkflowStepOutcomeInput<WorkflowStep, AndroidWorkflowRuntimeState>,
  ): WorkflowStepOutcome<
    WorkflowStep,
    NonNullable<WorkflowExecutionRun['pendingAction']>,
    AndroidWorkflowRuntimeState
  >
  buildPermissionEvidence(
    input: WorkflowPermissionEvidenceInput<
      WorkflowStepToolRequest,
      WorkflowDefinitionRecord
    >,
  ): WorkflowPermissionEvidence
  projectWorkflowTraceMetadata(traces: readonly ProcessTrace[]): Readonly<object>
  resolveRagEvidencePause: WorkflowRagEvidencePolicy['resolvePause']
  completeRun: WorkflowCompletionPolicy<ProcessTrace>['complete']
}

export interface WorkflowOrchestrator<
  TManifest extends WorkflowDefinitionToolManifest,
  TRagRuntime,
> {
  run(input: WorkflowOrchestratorInput<TManifest, TRagRuntime>): Promise<WorkflowExecutionRun>
}

export function createWorkflowOrchestrator<
  TManifest extends WorkflowDefinitionToolManifest,
  TRagRuntime,
  TStepRuntimeOptions extends WorkflowStepRuntimeOptions,
>(
  dependencies: WorkflowOrchestratorDependencies<
    TManifest,
    TRagRuntime,
    TStepRuntimeOptions
  >,
): WorkflowOrchestrator<TManifest, TRagRuntime> {
  return {
    async run(input) {
      const startedAt = input.now ?? dependencies.clock.now()
      const limits = resolveWorkflowRunLimits(input.limits)
      const run: WorkflowExecutionRun = {
        id: `workflow-run-${hashString(`${input.goal}:${startedAt}`).toString(36)}`,
        ...(input.assistantRunId ? { assistantRunId: input.assistantRunId } : {}),
        goal: input.goal,
        status: 'planning',
        steps: [],
        traces: [],
        startedAt,
      }
      let runtime = createWorkflowRuntime(run)
      const checkpointSignal = input.signal ?? new AbortController().signal
      const checkpointSession = input.assistantRunId && input.workflowCheckpointStore
        ? dependencies.createCheckpointSession({
            store: input.workflowCheckpointStore,
            runId: input.assistantRunId,
            goal: input.goal,
            startedAt,
          })
        : undefined
      await checkpointSession?.initialize(checkpointSignal)
      const finish = async (completed: WorkflowExecutionRun): Promise<WorkflowExecutionRun> => {
        await checkpointSession?.recordTerminal(completed, checkpointSignal)
        return completed
      }

      if (input.signal?.aborted) {
        const cancellation = dependencies.continuationPolicy.cancel({
          goal: input.goal,
          planSteps: [],
          observedSteps: run.steps,
          output: 'Agent workflow execution was cancelled before planning.',
        })
        return finish(dependencies.completeRun({
          run,
          runtime,
          status: cancellation.status,
          failureCode: cancellation.failureCode,
          finalOutput: cancellation.finalOutput,
          limits,
          progressMetadata: cancellation.progressMetadata,
          transitionReason: 'cancelled',
        }).run)
      }

      const workflowDefinition = resolveExecutableWorkflowDefinition(
        input.workflowDefinition,
        input.manifests,
        dependencies,
      )
      if (input.workflowDefinition && !workflowDefinition) {
        return finish(dependencies.completeRun({
          run,
          runtime,
          status: 'error',
          failureCode: 'schema_invalid',
          finalOutput: 'Agent workflow definition failed validation.',
          limits,
          transitionReason: 'definition-invalid',
        }).run)
      }

      const plan = dependencies.createPlan({
        goal: input.goal,
        content: input.content,
        toolRequest: input.toolRequest,
        requestedOutput: input.requestedOutput,
        workflowDefinition,
        now: startedAt,
      })
      run.intent = plan.intent
      run.traces.push(plan.classification.trace)
      run.traces.push(plan.trace)
      if (!plan.shouldRunWorkflow) {
        return finish(dependencies.completeRun({
          run,
          runtime,
          status: 'done',
          finalOutput: 'Direct chat path selected by intent classification.',
          limits,
          transitionReason: 'direct-chat',
        }).run)
      }
      runtime = advanceWorkflowRuntime(runtime, {
        status: 'running',
        reason: 'plan-ready',
        at: startedAt,
      })
      run.status = runtime.status
      await checkpointSession?.recordStarted(startedAt, checkpointSignal)
      let runtimeState: AndroidWorkflowRuntimeState = {}

      for (let index = 0; index < Math.min(plan.steps.length, limits.maxSteps); index += 1) {
        if (input.signal?.aborted) {
          const cancellation = dependencies.continuationPolicy.cancel({
            goal: input.goal,
            planSteps: plan.steps,
            observedSteps: run.steps,
            output: 'Agent workflow execution was cancelled.',
          })
          return finish(dependencies.completeRun({
            run,
            runtime,
            status: cancellation.status,
            failureCode: cancellation.failureCode,
            finalOutput: cancellation.finalOutput,
            limits,
            progressMetadata: cancellation.progressMetadata,
            transitionReason: 'cancelled',
          }).run)
        }

        const planned = plan.steps[index]
        const bound = bindAndroidWorkflowRuntimeState(planned.toolRequest, runtimeState)
        const stepEvidence = dependencies.buildPermissionEvidence({
          planId: plan.id,
          planIntent: plan.intent,
          planned,
          workflowDefinition,
          previousStepCount: run.steps.length,
        })
        const step = await dependencies.executeStep({
          id: planned.id,
          title: planned.title,
          ...(input.assistantRunId ? { assistantRunId: input.assistantRunId } : {}),
          toolRequest: bound.toolRequest,
          intentVisible: input.intentVisible,
          userConfirmed: input.userConfirmed,
          evidenceSources: stepEvidence.sources,
          evidenceSummary: stepEvidence.summary,
          stepIndex: index,
          planStepCount: plan.steps.length,
          toolCallIndex: 0,
          limits,
          signal: input.signal,
          options: dependencies.buildStepRuntimeOptions({
            manifests: input.manifests,
            ragRuntime: input.ragRuntime,
            runtimeLog: input.runtimeLog,
          }),
        })
        run.steps.push(step)
        runtime = observeWorkflowRuntimeStep(runtime, run.steps)
        run.traces.push(...step.trace)
        await checkpointSession?.recordStep(step, checkpointSignal)

        const stepOutcome = dependencies.resolveStepOutcome({
          runId: run.id,
          goal: input.goal,
          planSteps: plan.steps,
          observedSteps: run.steps,
          step,
          runtimeState,
        })
        if (stepOutcome.kind === 'terminal') {
          return finish(dependencies.completeRun({
            run,
            runtime,
            limits,
            ...stepOutcome.completion,
          }).run)
        }
        runtimeState = stepOutcome.runtimeState
      }

      if (plan.steps.length > limits.maxSteps) {
        const pause = dependencies.continuationPolicy.pauseAtStepLimit({
          runId: run.id,
          goal: input.goal,
          planSteps: plan.steps,
          attemptedStepCount: run.steps.length,
          workflowMetadata: dependencies.projectWorkflowTraceMetadata(run.traces),
        })
        return finish(dependencies.completeRun({
          run,
          runtime,
          status: pause.status,
          failureCode: pause.failureCode,
          finalOutput: pause.finalOutput,
          pendingAction: pause.pendingAction,
          limits,
          transitionReason: 'step-limit',
        }).run)
      }

      const finalOutput = run.steps.map((step) => step.observation?.output).filter(Boolean).join('\n\n')
      const ragEvidencePause = dependencies.resolveRagEvidencePause({
        run,
        rawOutput: finalOutput,
        outputCharLimit: limits.outputCharLimit,
      })
      if (ragEvidencePause) {
        return finish(dependencies.completeRun({
          run,
          runtime,
          status: ragEvidencePause.status,
          failureCode: ragEvidencePause.failureCode,
          finalOutput: ragEvidencePause.finalOutput,
          pendingAction: ragEvidencePause.pendingAction,
          limits,
          failureMetadata: ragEvidencePause.failureMetadata,
          transitionReason: ragEvidencePause.transitionReason,
        }).run)
      }
      return finish(dependencies.completeRun({
        run,
        runtime,
        status: 'done',
        finalOutput: finalOutput || 'Agent workflow completed.',
        limits,
        transitionReason: 'completed',
      }).run)
    },
  }
}

function resolveExecutableWorkflowDefinition<
  TManifest extends WorkflowDefinitionToolManifest,
  TRagRuntime,
  TStepRuntimeOptions extends WorkflowStepRuntimeOptions,
>(
  workflow: WorkflowDefinitionRecord | undefined,
  manifests: readonly TManifest[] | undefined,
  dependencies: WorkflowOrchestratorDependencies<TManifest, TRagRuntime, TStepRuntimeOptions>,
): WorkflowDefinitionRecord | undefined {
  if (!workflow) return undefined
  const validation = dependencies.validateWorkflowDefinition(workflow, manifests ?? [])
  if (!validation.ok || !validation.definition?.enabled) return undefined
  return validation.definition
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash | 0)
}
