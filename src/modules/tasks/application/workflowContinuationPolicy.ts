import type { Clock } from '@/core'

const CONTINUATION_TEXT_LIMIT = 900
const STEP_TITLE_LIMIT = 160
const WORKFLOW_TEXT_LIMIT = 160
const TRUNCATION_MARKER = '\n[output truncated]'

export const WORKFLOW_STEP_LIMIT_BLOCKED_REASON =
  'Continuation requires a visible continue action before additional workflow steps can run.'

export interface WorkflowContinuationPlannedStep {
  id: string
  title: string
}

export interface WorkflowContinuationObservedStep {
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled'
}

export interface WorkflowContinuationMetadata {
  workflowId?: string
  workflowName?: string
  workflowExpectedOutput?: string
}

export interface WorkflowCancellationProgressMetadata {
  planStepCount: number
  completedStepCount: number
  remainingStepCount: number
  cancelledAtStepTitle?: string
  cancelledAtStepNumber?: number
  nextStepTitle?: string
  nextStepNumber?: number
  cancelledContinuationPrompt: string
}

export interface WorkflowCancellationResult {
  status: 'cancelled'
  failureCode: 'cancelled'
  finalOutput: string
  progressMetadata: WorkflowCancellationProgressMetadata
  pendingAction?: never
}

export interface WorkflowStepLimitPendingAction extends WorkflowContinuationMetadata {
  id: string
  reason: 'step_limit_reached'
  title: string
  summary: string
  confirmable: false
  resumeToolRequest?: never
  blockedReason: typeof WORKFLOW_STEP_LIMIT_BLOCKED_REASON
  suggestedUserPrompt?: string
  stepId?: string
  stepTitle?: string
  stepNumber?: number
  planStepCount: number
  completedStepCount: number
  remainingStepCount: number
  createdAt: number
}

export interface WorkflowStepLimitPauseResult {
  status: 'waiting'
  failureCode: 'step_limit_reached'
  finalOutput: string
  pendingAction: WorkflowStepLimitPendingAction
}

export interface WorkflowContinuationPolicyDependencies {
  clock: Clock
  redactText(value: string): string
}

export interface BuildWorkflowCancellationInput {
  goal: string
  planSteps?: readonly WorkflowContinuationPlannedStep[]
  observedSteps: readonly WorkflowContinuationObservedStep[]
  output?: string
}

export interface BuildWorkflowStepLimitPauseInput {
  runId: string
  goal: string
  planSteps: readonly WorkflowContinuationPlannedStep[]
  attemptedStepCount: number
  workflowMetadata?: WorkflowContinuationMetadata
}

export interface WorkflowContinuationPolicy {
  cancel(input: BuildWorkflowCancellationInput): WorkflowCancellationResult
  pauseAtStepLimit(input: BuildWorkflowStepLimitPauseInput): WorkflowStepLimitPauseResult
}

export function createWorkflowContinuationPolicy(
  dependencies: WorkflowContinuationPolicyDependencies,
): WorkflowContinuationPolicy {
  return {
    cancel(input) {
      const planSteps = input.planSteps ?? []
      const planStepCount = planSteps.length
      const completedStepCount = Math.min(
        planStepCount,
        input.observedSteps.filter((step) => step.status === 'done').length,
      )
      const remainingStepCount = Math.max(0, planStepCount - completedStepCount)
      const nextStep = planSteps[completedStepCount]
      const nextStepTitle = nextStep
        ? formatBoundedText(nextStep.title, STEP_TITLE_LIMIT, dependencies.redactText)
        : undefined
      const progressMetadata: WorkflowCancellationProgressMetadata = {
        planStepCount,
        completedStepCount,
        remainingStepCount,
        ...(nextStepTitle ? { cancelledAtStepTitle: nextStepTitle } : {}),
        ...(nextStep ? { cancelledAtStepNumber: completedStepCount + 1 } : {}),
        ...(nextStepTitle ? { nextStepTitle } : {}),
        ...(nextStep ? { nextStepNumber: completedStepCount + 1 } : {}),
        cancelledContinuationPrompt: buildCancelledContinuationPrompt(
          input.goal,
          planStepCount,
          completedStepCount,
          remainingStepCount,
          dependencies.redactText,
        ),
      }

      return {
        status: 'cancelled',
        failureCode: 'cancelled',
        finalOutput: formatCancelledOutput(input.output, progressMetadata, dependencies.redactText),
        progressMetadata,
      }
    },

    pauseAtStepLimit(input) {
      const planStepCount = input.planSteps.length
      const attemptedStepCount = clampInteger(input.attemptedStepCount, 0, planStepCount)
      const remainingStepCount = Math.max(0, planStepCount - attemptedStepCount)
      const nextStep = input.planSteps[attemptedStepCount]
      const workflowMetadata = sanitizeWorkflowMetadata(input.workflowMetadata, dependencies.redactText)
      const stepAttribution = buildPlannedStepAttribution(
        nextStep,
        attemptedStepCount,
        planStepCount,
        dependencies.redactText,
      )
      const suggestedUserPrompt = nextStep
        ? buildStepLimitSuggestedPrompt(
          input.goal,
          planStepCount,
          attemptedStepCount,
          remainingStepCount,
          workflowMetadata,
          stepAttribution,
          dependencies.redactText,
        )
        : undefined
      const pendingAction: WorkflowStepLimitPendingAction = {
        id: `agent-pending-step-limit-${stableHash(`${input.runId}:${planStepCount}:${attemptedStepCount}`)}`,
        reason: 'step_limit_reached',
        title: 'Workflow step limit reached',
        summary: clampText(dependencies.redactText([
          `Goal: ${input.goal}`,
          workflowMetadata.workflowName ? `Workflow: ${workflowMetadata.workflowName}` : '',
          workflowMetadata.workflowExpectedOutput ? `Expected output: ${workflowMetadata.workflowExpectedOutput}` : '',
          `Completed steps: ${attemptedStepCount}/${planStepCount}`,
          `Remaining steps: ${remainingStepCount}`,
        ].filter(Boolean).join('\n')), CONTINUATION_TEXT_LIMIT),
        confirmable: false,
        blockedReason: WORKFLOW_STEP_LIMIT_BLOCKED_REASON,
        ...(suggestedUserPrompt ? { suggestedUserPrompt } : {}),
        ...workflowMetadata,
        ...stepAttribution,
        planStepCount,
        completedStepCount: attemptedStepCount,
        remainingStepCount,
        createdAt: dependencies.clock.now(),
      }

      return {
        status: 'waiting',
        failureCode: 'step_limit_reached',
        finalOutput: formatStepLimitOutput(pendingAction, dependencies.redactText),
        pendingAction,
      }
    },
  }
}

function buildCancelledContinuationPrompt(
  goal: string,
  planStepCount: number,
  completedStepCount: number,
  remainingStepCount: number,
  redactText: (value: string) => string,
): string {
  return clampText(redactText([
    'Review the cancelled agentic workflow from the visible trace.',
    `Original goal: ${goal}`,
    `Completed steps: ${completedStepCount}/${planStepCount}.`,
    `Remaining steps: ${remainingStepCount}.`,
    'Continue only unresolved safe steps, keep every tool action visible, and pause again for permissions, evidence gaps, or step limits.',
  ].join('\n')), CONTINUATION_TEXT_LIMIT)
}

function formatCancelledOutput(
  output: string | undefined,
  progress: WorkflowCancellationProgressMetadata,
  redactText: (value: string) => string,
): string {
  const base = redactText(output?.trim() || 'Agent workflow execution was cancelled.')
  const suffix = [
    `Completed steps: ${progress.completedStepCount}/${progress.planStepCount}`,
    `Remaining steps: ${progress.remainingStepCount}`,
    'Continuation requires a visible user action before additional workflow steps can run.',
  ].join('\n')
  return appendBoundedSuffix(base, suffix, CONTINUATION_TEXT_LIMIT)
}

function buildStepLimitSuggestedPrompt(
  goal: string,
  planStepCount: number,
  attemptedStepCount: number,
  remainingStepCount: number,
  workflowMetadata: WorkflowContinuationMetadata,
  stepAttribution: Pick<WorkflowStepLimitPendingAction, 'stepTitle' | 'stepNumber' | 'planStepCount'>,
  redactText: (value: string) => string,
): string {
  const prompt = clampText(redactText([
    'Continue the paused agentic workflow from the visible trace.',
    `Original goal: ${goal}`,
    workflowMetadata.workflowName ? `Workflow: ${workflowMetadata.workflowName}` : '',
    workflowMetadata.workflowId ? `Workflow id: ${workflowMetadata.workflowId}` : '',
    workflowMetadata.workflowExpectedOutput ? `Expected output: ${workflowMetadata.workflowExpectedOutput}` : '',
    `Completed steps: ${attemptedStepCount}/${planStepCount}.`,
    `Remaining steps: ${remainingStepCount}.`,
    'Run only the remaining safe steps, keep every tool action visible, and pause again if permission, evidence, or step limits require user action.',
  ].join('\n')), CONTINUATION_TEXT_LIMIT)
  const workflowContext = [
    workflowMetadata.workflowName ? `Workflow: ${workflowMetadata.workflowName}` : '',
    workflowMetadata.workflowId ? `Workflow id: ${workflowMetadata.workflowId}` : '',
    workflowMetadata.workflowExpectedOutput ? `Expected output: ${workflowMetadata.workflowExpectedOutput}` : '',
  ].filter(Boolean).join('\n')
  const stepContext = [
    stepAttribution.stepNumber
      ? `Step: ${stepAttribution.stepNumber}/${stepAttribution.planStepCount}`
      : '',
    stepAttribution.stepTitle ? `Step title: ${stepAttribution.stepTitle}` : '',
  ].filter(Boolean).join('\n')
  const suffix = [
    workflowContext && !prompt.includes(workflowContext) ? workflowContext : '',
    stepContext && !prompt.includes(stepContext) ? stepContext : '',
  ].filter(Boolean).join('\n')
  return suffix
    ? appendBoundedSuffix(prompt, suffix, CONTINUATION_TEXT_LIMIT)
    : prompt
}

function formatStepLimitOutput(
  pendingAction: WorkflowStepLimitPendingAction,
  redactText: (value: string) => string,
): string {
  return clampText(redactText([
    'Agentic workflow paused at the configured step limit.',
    pendingAction.stepTitle ? `Next step: ${pendingAction.stepTitle}` : '',
    `Completed steps: ${pendingAction.completedStepCount}/${pendingAction.planStepCount}`,
    `Remaining steps: ${pendingAction.remainingStepCount}`,
    `Continuation unavailable: ${pendingAction.blockedReason}`,
    '',
    pendingAction.summary,
  ].filter(Boolean).join('\n')), CONTINUATION_TEXT_LIMIT)
}

function buildPlannedStepAttribution(
  step: WorkflowContinuationPlannedStep | undefined,
  stepIndex: number,
  planStepCount: number,
  redactText: (value: string) => string,
): Pick<WorkflowStepLimitPendingAction, 'stepId' | 'stepTitle' | 'stepNumber' | 'planStepCount'> {
  if (!step) return { planStepCount }
  return {
    stepId: step.id,
    stepTitle: formatBoundedText(step.title, STEP_TITLE_LIMIT, redactText),
    stepNumber: stepIndex + 1,
    planStepCount,
  }
}

function sanitizeWorkflowMetadata(
  metadata: WorkflowContinuationMetadata | undefined,
  redactText: (value: string) => string,
): WorkflowContinuationMetadata {
  const workflowId = formatOptionalBoundedText(metadata?.workflowId, WORKFLOW_TEXT_LIMIT, redactText)
  const workflowName = formatOptionalBoundedText(metadata?.workflowName, WORKFLOW_TEXT_LIMIT, redactText)
  const workflowExpectedOutput = formatOptionalBoundedText(
    metadata?.workflowExpectedOutput,
    WORKFLOW_TEXT_LIMIT,
    redactText,
  )
  return {
    ...(workflowId ? { workflowId } : {}),
    ...(workflowName ? { workflowName } : {}),
    ...(workflowExpectedOutput ? { workflowExpectedOutput } : {}),
  }
}

function formatOptionalBoundedText(
  value: string | undefined,
  limit: number,
  redactText: (value: string) => string,
): string | undefined {
  if (!value?.trim()) return undefined
  return formatBoundedText(value, limit, redactText)
}

function formatBoundedText(
  value: string,
  limit: number,
  redactText: (value: string) => string,
): string {
  return clampText(redactText(value.trim()), limit).replace(/\n\[output truncated\]$/, '')
}

function appendBoundedSuffix(body: string, suffix: string, limit: number): string {
  const suffixBlock = `\n${suffix}`
  if (suffixBlock.length >= limit) return clampText(suffix.trim(), limit)
  return `${clampTextExact(body.trim(), limit - suffixBlock.length)}${suffixBlock}`.trim()
}

function clampText(value: string, limit: number): string {
  const max = Math.max(0, limit)
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 32)).trimEnd()}${TRUNCATION_MARKER}`
}

function clampTextExact(value: string, limit: number): string {
  const max = Math.max(0, limit)
  if (value.length <= max) return value
  if (max <= TRUNCATION_MARKER.length) return value.slice(0, max)
  return `${value.slice(0, max - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash | 0)
}
