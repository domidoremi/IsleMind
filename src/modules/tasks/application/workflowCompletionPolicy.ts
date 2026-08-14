import type { WorkflowRunLimits } from './workflowRunLimitPolicy'
import {
  appendWorkflowAndroidUndoFollowUp,
  buildWorkflowAndroidUndoFollowUp,
  projectWorkflowAndroidUndoFollowUpMetadata,
} from './workflowAndroidUndoFollowUpPolicy'
import {
  advanceWorkflowRuntime,
  observeWorkflowRuntimeStep,
  type WorkflowRuntimeFailureCode,
  type WorkflowRuntimeState,
  type WorkflowRuntimeStatus,
  type WorkflowRuntimeTransitionReason,
  workflowRuntimeTraceMetadata,
} from './workflowRuntimePolicy'

export interface WorkflowCompletionStep {
  readonly id: string
  readonly title: string
  readonly status: 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled'
  readonly observation?: {
    readonly output?: string
  }
}

export interface WorkflowCompletionPendingAction {
  readonly reason: 'permission_required' | 'step_limit_reached' | 'evidence_insufficient'
}

export interface WorkflowCompletionTraceLike {
  readonly id: string
  readonly title: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface WorkflowCompletionTraceInput {
  id: string
  type: 'reasoning' | 'system'
  title: string
  content?: string
  status: 'done' | 'error' | 'skipped' | 'cancelled'
  startedAt: number
  completedAt: number
  metadata: Record<string, unknown>
}

export interface WorkflowCompletionRun<
  TTrace extends WorkflowCompletionTraceLike = WorkflowCompletionTraceLike,
> {
  readonly id: string
  readonly assistantRunId?: unknown
  readonly status: WorkflowRuntimeStatus
  readonly steps: readonly WorkflowCompletionStep[]
  readonly traces: readonly TTrace[]
  readonly startedAt: number
  readonly completedAt?: number
  readonly failureCode?: WorkflowRuntimeFailureCode
  readonly finalOutput?: string
  readonly pendingAction?: WorkflowCompletionPendingAction
}

export interface WorkflowStepStatusMetadata extends Record<string, number> {
  pendingStepCount: number
  runningStepCount: number
  doneStepCount: number
  errorStepCount: number
  cancelledStepCount: number
  skippedStepCount: number
}

export interface WorkflowCompletionPolicyDependencies<
  TTrace extends WorkflowCompletionTraceLike,
> {
  clock: {
    now(): number
  }
  redactText(value: string): string
  clampText(value: string, limit: number): string
  projectTrace(trace: WorkflowCompletionTraceInput): TTrace
  projectWorkflowTraceMetadata(traces: readonly TTrace[]): Readonly<object>
  formatFailureOutput(
    failureCode: WorkflowRuntimeFailureCode | undefined,
    finalOutput: string | undefined,
  ): string
  resolveFailureNextStep(
    failureCode: WorkflowRuntimeFailureCode | undefined,
    finalOutput: string | undefined,
  ): string
}

export interface WorkflowCompletionInput<
  TRun extends WorkflowCompletionRun<TTrace>,
  TTrace extends WorkflowCompletionTraceLike,
> {
  run: TRun
  runtime: WorkflowRuntimeState
  status: WorkflowRuntimeStatus
  failureCode?: WorkflowRuntimeFailureCode
  finalOutput?: string
  pendingAction?: WorkflowCompletionPendingAction
  limits?: WorkflowRunLimits
  progressMetadata?: Readonly<object>
  failureMetadata?: Readonly<object>
  transitionReason?: WorkflowRuntimeTransitionReason
  transitionStep?: WorkflowCompletionStep
}

export interface WorkflowCompletionPolicy<TTrace extends WorkflowCompletionTraceLike> {
  complete<
    TRun extends WorkflowCompletionRun<TTrace>,
  >(input: WorkflowCompletionInput<TRun, TTrace>): {
    run: TRun
    runtime: WorkflowRuntimeState
  }
  buildStepStatusMetadata(
    steps: readonly WorkflowCompletionStep[],
  ): WorkflowStepStatusMetadata
  finalizeOutput(
    output: string | undefined,
    outputCharLimit: number | undefined,
    requiredNextStep?: string,
  ): string | undefined
}

export function createWorkflowCompletionPolicy<
  TTrace extends WorkflowCompletionTraceLike,
>(
  dependencies: WorkflowCompletionPolicyDependencies<TTrace>,
): WorkflowCompletionPolicy<TTrace> {
  const buildStepStatusMetadata = (
    steps: readonly WorkflowCompletionStep[],
  ): WorkflowStepStatusMetadata => {
    const counts = steps.reduce((acc, step) => {
      acc[step.status] = (acc[step.status] ?? 0) + 1
      return acc
    }, {} as Record<WorkflowCompletionStep['status'], number>)
    return {
      pendingStepCount: counts.pending ?? 0,
      runningStepCount: counts.running ?? 0,
      doneStepCount: counts.done ?? 0,
      errorStepCount: counts.error ?? 0,
      cancelledStepCount: counts.cancelled ?? 0,
      skippedStepCount: counts.skipped ?? 0,
    }
  }

  const finalizeOutput = (
    output: string | undefined,
    outputCharLimit: number | undefined,
    requiredNextStep?: string,
  ): string | undefined => {
    const redacted = dependencies.redactText(output?.trim() ?? '')
    if (!redacted) return undefined
    if (
      typeof outputCharLimit !== 'number'
      || !Number.isFinite(outputCharLimit)
      || redacted.length <= outputCharLimit
    ) {
      return redacted
    }
    const androidUndoSuffix = extractAndroidUndoFollowUpSuffix(redacted)
    if (androidUndoSuffix) {
      const suffix = `\n\n${androidUndoSuffix}`
      if (suffix.length >= outputCharLimit) {
        return dependencies.clampText(androidUndoSuffix, outputCharLimit)
      }
      const body = redacted.slice(0, redacted.lastIndexOf(androidUndoSuffix)).trimEnd()
      return `${clampWithExactLimit(body, outputCharLimit - suffix.length)}${suffix}`
    }
    const nextStepLine = requiredNextStep?.trim()
      ? `Next step: ${dependencies
        .clampText(dependencies.redactText(requiredNextStep.trim()), 240)
        .replace(/\n\[output truncated\]$/, '')}`
      : ''
    if (!nextStepLine) return dependencies.clampText(redacted, outputCharLimit)
    const existingNextStepPattern = new RegExp(`^${escapeRegExp(nextStepLine)}$`, 'm')
    const suffix = `\n\n${nextStepLine}`
    if (suffix.length >= outputCharLimit) {
      return dependencies.clampText(nextStepLine, outputCharLimit)
    }
    const bodySource = existingNextStepPattern.test(redacted)
      ? redacted.replace(existingNextStepPattern, '').replace(/\n{3,}/g, '\n\n').trim()
      : redacted
    const body = clampWithExactLimit(bodySource, outputCharLimit - suffix.length)
    return `${body}${suffix}`
  }

  const complete = <
    TRun extends WorkflowCompletionRun<TTrace>,
  >(
    input: WorkflowCompletionInput<TRun, TTrace>,
  ): { run: TRun; runtime: WorkflowRuntimeState } => {
    const completedAt = dependencies.clock.now()
    const transitionReason = input.transitionReason
      ?? (input.status === 'done'
        ? 'completed'
        : input.status === 'cancelled'
          ? 'cancelled'
          : 'tool-error')
    const completedRuntime = advanceWorkflowRuntime(
      observeWorkflowRuntimeStep(input.runtime, input.run.steps),
      {
        status: input.status,
        reason: transitionReason,
        at: completedAt,
        failureCode: input.failureCode,
        pendingAction: input.pendingAction,
        step: input.transitionStep,
      },
    )
    const failureNextStep = input.status === 'error'
      ? dependencies.resolveFailureNextStep(input.failureCode, input.finalOutput)
      : undefined
    const undoFollowUp = input.status === 'done' || input.status === 'error'
      ? buildWorkflowAndroidUndoFollowUp(input.run)
      : undefined
    const stepStatusMetadata = buildStepStatusMetadata(input.run.steps)
    const workflowTraceMetadata = dependencies.projectWorkflowTraceMetadata(input.run.traces)
    const runtimeTraceMetadata = workflowRuntimeTraceMetadata(completedRuntime)
    const assistantRunTraceMetadata = input.run.assistantRunId
      ? { assistantRunId: input.run.assistantRunId }
      : {}
    const rawOutput = input.status === 'error'
      ? dependencies.formatFailureOutput(input.failureCode, input.finalOutput)
      : appendWorkflowAndroidUndoFollowUp(input.finalOutput?.trim(), undoFollowUp)
    const output = finalizeOutput(rawOutput, input.limits?.outputCharLimit, failureNextStep)
    const undoFollowUpMetadata = projectWorkflowAndroidUndoFollowUpMetadata(undoFollowUp)
    const synthesisTrace = dependencies.projectTrace({
      id: `${input.run.id}-synthesis`,
      type: 'reasoning',
      title: 'Agent synthesis',
      content: formatSynthesisTraceContent(
        input.status,
        input.failureCode,
        output,
        input.pendingAction,
        dependencies,
      ),
      status: 'done',
      startedAt: input.run.startedAt,
      completedAt,
      metadata: {
        status: input.status,
        failureCode: input.failureCode,
        outputSummary: output
          ? dependencies.clampText(dependencies.redactText(output), 420)
          : input.status,
        outputCharCount: output?.length ?? 0,
        ...stepStatusMetadata,
        ...workflowTraceMetadata,
        ...runtimeTraceMetadata,
        ...assistantRunTraceMetadata,
        pendingActionReason: input.pendingAction?.reason,
        ...(failureNextStep ? { failureNextStep } : {}),
        ...input.failureMetadata,
        ...undoFollowUpMetadata,
        ...input.progressMetadata,
      },
    })
    const completionTrace = dependencies.projectTrace({
      id: `${input.run.id}-complete`,
      type: 'system',
      title: 'Agent workflow',
      content: output || input.status,
      status: input.status === 'done'
        ? 'done'
        : input.status === 'cancelled'
          ? 'cancelled'
          : input.status === 'waiting'
            ? 'skipped'
            : 'error',
      startedAt: input.run.startedAt,
      completedAt,
      metadata: {
        status: input.status,
        failureCode: input.failureCode,
        stepCount: input.run.steps.length,
        ...stepStatusMetadata,
        ...workflowTraceMetadata,
        ...runtimeTraceMetadata,
        ...assistantRunTraceMetadata,
        ...projectRunLimitMetadata(input.limits),
        ...(failureNextStep ? { failureNextStep } : {}),
        ...input.failureMetadata,
        ...undoFollowUpMetadata,
        ...input.progressMetadata,
        pendingAction: input.pendingAction,
      },
    })
    const run = {
      ...input.run,
      status: completedRuntime.status,
      completedAt,
      failureCode: input.failureCode,
      finalOutput: output,
      pendingAction: input.pendingAction,
      traces: [...input.run.traces, synthesisTrace, completionTrace],
    } as TRun
    return { run, runtime: completedRuntime }
  }

  return {
    complete,
    buildStepStatusMetadata,
    finalizeOutput,
  }
}

function extractAndroidUndoFollowUpSuffix(output: string): string | undefined {
  const marker = 'Android undo available.'
  const start = output.lastIndexOf(marker)
  return start >= 0 ? output.slice(start).trim() : undefined
}

function clampWithExactLimit(value: string, limit: number): string {
  if (value.length <= limit) return value
  const marker = '\n[output truncated]'
  if (limit <= marker.length) return value.slice(0, Math.max(0, limit))
  return `${value.slice(0, Math.max(0, limit - marker.length))}${marker}`
}

function formatSynthesisTraceContent(
  status: WorkflowRuntimeStatus,
  failureCode: WorkflowRuntimeFailureCode | undefined,
  output: string | undefined,
  pendingAction: WorkflowCompletionPendingAction | undefined,
  dependencies: Pick<
    WorkflowCompletionPolicyDependencies<WorkflowCompletionTraceLike>,
    'redactText' | 'clampText'
  >,
): string {
  const statusLine = failureCode ? `${status}:${failureCode}` : status
  const pendingLine = pendingAction ? `Pending action: ${pendingAction.reason}.` : ''
  const outputLine = output
    ? dependencies.clampText(dependencies.redactText(output), 700)
    : 'No final output body was produced.'
  return [
    `Final response synthesis prepared for ${statusLine}.`,
    pendingLine,
    outputLine,
  ].filter(Boolean).join('\n')
}

function projectRunLimitMetadata(limits: WorkflowRunLimits | undefined): Record<string, unknown> {
  if (!limits) return {}
  return {
    maxStepCount: limits.maxSteps,
    maxToolCallsPerStep: limits.maxToolCallsPerStep,
    outputCharLimit: limits.outputCharLimit,
    readOnlyToolsAllowed: limits.allowReadOnlyTools,
    readWriteToolPolicy: limits.allowReadWriteTools,
    destructiveToolPolicy: limits.allowDestructiveTools,
    backgroundContinuationAllowed: limits.allowBackgroundContinuation,
    traceRequired: limits.requireTrace,
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
