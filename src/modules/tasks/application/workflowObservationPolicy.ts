import type { WorkflowContinuationMetadata } from './workflowContinuationPolicy'
import type { WorkflowRuntimeFailureCode } from './workflowRuntimePolicy'
import type { WorkflowStepToolSource } from './workflowStepExecutor'

const OBSERVATION_TEXT_LIMIT = 900
const ATTRIBUTION_TEXT_LIMIT = 160
const TRUNCATION_MARKER_PATTERN = /\n\[output truncated\]$/
const TRUNCATION_MARKER = '\n[output truncated]'

export interface WorkflowObservationTrace {
  title: string
  metadata?: Readonly<Record<string, unknown>>
}

export interface WorkflowObservationToolRequest {
  toolId?: string
  name?: string
  source?: WorkflowStepToolSource
}

export interface WorkflowStepObservationProjection {
  errorCode?: WorkflowRuntimeFailureCode
  diagnostic: {
    metadata?: Readonly<Record<string, unknown>>
  }
}

export interface WorkflowObservedStep {
  id: string
  title: string
  toolRequest?: WorkflowObservationToolRequest
  observation?: WorkflowStepObservationProjection
}

export interface WorkflowStepAttribution {
  stepId?: string
  stepTitle?: string
  stepNumber?: number
  planStepCount?: number
}

export interface WorkflowFailureTraceMetadata extends WorkflowStepAttribution {
  failedStepId?: string
  failedStepTitle?: string
  failedStepNumber?: number
  failedPlanStepCount?: number
  failedToolName?: string
  failedToolId?: string
  failedToolSource?: WorkflowStepToolSource
  failedToolErrorCode?: WorkflowRuntimeFailureCode
  repairNextStep?: string
}

export interface WorkflowObservationPolicyDependencies {
  redactText(value: string): string
  clampText(value: string, limit: number): string
}

export interface WorkflowObservationPolicy {
  projectWorkflowTraceMetadata(traces: readonly WorkflowObservationTrace[]): WorkflowContinuationMetadata
  projectStepAttribution(step: WorkflowObservedStep): WorkflowStepAttribution
  projectFailureTraceMetadata(step: WorkflowObservedStep): WorkflowFailureTraceMetadata
  appendPendingActionPromptContext(
    prompt: string | undefined,
    stepAttribution: WorkflowStepAttribution,
    workflowMetadata?: WorkflowContinuationMetadata,
  ): string | undefined
}

export function createWorkflowObservationPolicy(
  dependencies: WorkflowObservationPolicyDependencies,
): WorkflowObservationPolicy {
  const formatAttributionText = (value: unknown): string | undefined => {
    if (typeof value !== 'string' || !value.trim()) return undefined
    return dependencies
      .clampText(dependencies.redactText(value.trim()), ATTRIBUTION_TEXT_LIMIT)
      .replace(TRUNCATION_MARKER_PATTERN, '')
  }

  const projectStepAttribution = (step: WorkflowObservedStep): WorkflowStepAttribution => {
    const metadata = step.observation?.diagnostic.metadata ?? {}
    const stepNumber = readPositiveInteger(metadata.stepNumber)
    const planStepCount = readPositiveInteger(metadata.planStepCount)
    return {
      stepId: step.id,
      stepTitle: formatRequiredAttributionText(step.title, dependencies),
      ...(stepNumber ? { stepNumber } : {}),
      ...(planStepCount ? { planStepCount } : {}),
    }
  }

  return {
    projectWorkflowTraceMetadata(traces) {
      const planTrace = traces.find(
        (trace) => trace.title === 'Agent plan' && trace.metadata?.source === 'agent-workflow-skill',
      )
      if (!planTrace?.metadata) return {}

      const workflowId = formatAttributionText(planTrace.metadata.workflowId)
      const workflowName = formatAttributionText(planTrace.metadata.workflowName)
      const workflowExpectedOutput = formatAttributionText(planTrace.metadata.workflowExpectedOutput)
      return {
        ...(workflowId ? { workflowId } : {}),
        ...(workflowName ? { workflowName } : {}),
        ...(workflowExpectedOutput ? { workflowExpectedOutput } : {}),
      }
    },

    projectStepAttribution,

    projectFailureTraceMetadata(step) {
      const attribution = projectStepAttribution(step)
      const toolAttribution = projectFailureToolAttribution(step, formatAttributionText)
      return {
        ...attribution,
        ...(attribution.stepId ? { failedStepId: attribution.stepId } : {}),
        ...(attribution.stepTitle ? { failedStepTitle: attribution.stepTitle } : {}),
        ...(attribution.stepNumber ? { failedStepNumber: attribution.stepNumber } : {}),
        ...(attribution.planStepCount ? { failedPlanStepCount: attribution.planStepCount } : {}),
        ...toolAttribution,
      }
    },

    appendPendingActionPromptContext(prompt, stepAttribution, workflowMetadata = {}) {
      if (!prompt) return undefined

      const safePrompt = clampTextWithExactLimit(
        dependencies.redactText(prompt).trim(),
        OBSERVATION_TEXT_LIMIT,
      ).trim()
      const safeWorkflowMetadata: WorkflowContinuationMetadata = {
        workflowId: formatAttributionText(workflowMetadata.workflowId),
        workflowName: formatAttributionText(workflowMetadata.workflowName),
        workflowExpectedOutput: formatAttributionText(workflowMetadata.workflowExpectedOutput),
      }

      const stepContext = formatPendingActionStepContext(
        formatAttributionText(stepAttribution.stepTitle),
        stepAttribution.stepNumber,
        stepAttribution.planStepCount,
      )
      const workflowContext = formatPendingActionWorkflowContext(safeWorkflowMetadata)
      const suffix = [
        workflowContext && !safePrompt.includes(workflowContext) ? workflowContext : '',
        stepContext && !safePrompt.includes(stepContext) ? stepContext : '',
      ]
        .filter(Boolean)
        .join('\n')
      if (!suffix) return safePrompt

      const suffixBlock = `\n${suffix}`
      if (suffixBlock.length >= OBSERVATION_TEXT_LIMIT) {
        return dependencies.clampText(dependencies.redactText(suffix).trim(), OBSERVATION_TEXT_LIMIT)
      }
      const body = clampTextWithExactLimit(
        safePrompt,
        OBSERVATION_TEXT_LIMIT - suffixBlock.length,
      ).trim()
      return `${body}${suffixBlock}`.trim()
    },
  }
}

function projectFailureToolAttribution(
  step: WorkflowObservedStep,
  formatAttributionText: (value: unknown) => string | undefined,
): Pick<
  WorkflowFailureTraceMetadata,
  'failedToolName' | 'failedToolId' | 'failedToolSource' | 'failedToolErrorCode'
> {
  const observation = step.observation
  const metadata = observation?.diagnostic.metadata ?? {}
  const failedToolName = formatAttributionText(
    step.toolRequest?.name ??
      step.toolRequest?.toolId ??
      readTextMetric(metadata.toolName) ??
      readTextMetric(metadata.toolId),
  )
  const failedToolId = formatAttributionText(step.toolRequest?.toolId ?? readTextMetric(metadata.toolId))
  const failedToolSource = parseToolSource(step.toolRequest?.source ?? metadata.toolSource ?? metadata.source)
  const failedToolErrorCode = parseFailureErrorCode(observation?.errorCode ?? metadata.errorCode)
  return {
    ...(failedToolName ? { failedToolName } : {}),
    ...(failedToolId ? { failedToolId } : {}),
    ...(failedToolSource ? { failedToolSource } : {}),
    ...(failedToolErrorCode ? { failedToolErrorCode } : {}),
  }
}

function formatRequiredAttributionText(
  value: string,
  dependencies: WorkflowObservationPolicyDependencies,
): string {
  return dependencies
    .clampText(dependencies.redactText(value.trim()), ATTRIBUTION_TEXT_LIMIT)
    .replace(TRUNCATION_MARKER_PATTERN, '')
}

function formatPendingActionWorkflowContext(workflowMetadata: WorkflowContinuationMetadata): string {
  return [
    workflowMetadata.workflowName ? `Workflow: ${workflowMetadata.workflowName}` : '',
    workflowMetadata.workflowId ? `Workflow id: ${workflowMetadata.workflowId}` : '',
    workflowMetadata.workflowExpectedOutput ? `Expected output: ${workflowMetadata.workflowExpectedOutput}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function formatPendingActionStepContext(
  stepTitle: string | undefined,
  stepNumber: number | undefined,
  planStepCount: number | undefined,
): string {
  const safeStepNumber = readPositiveInteger(stepNumber)
  const parsedPlanStepCount = readPositiveInteger(planStepCount)
  const safePlanStepCount =
    safeStepNumber && parsedPlanStepCount && parsedPlanStepCount >= safeStepNumber ? parsedPlanStepCount : undefined
  const progress = safeStepNumber
    ? safePlanStepCount
      ? `Step: ${safeStepNumber}/${safePlanStepCount}`
      : `Step: ${safeStepNumber}`
    : ''
  const title = stepTitle ? `Step title: ${stepTitle}` : ''
  return [progress, title].filter(Boolean).join('\n')
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function readTextMetric(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseToolSource(value: unknown): WorkflowStepToolSource | undefined {
  return value === 'mcp' ||
    value === 'builtin' ||
    value === 'app-action' ||
    value === 'rag' ||
    value === 'search' ||
    value === 'work-artifact' ||
    value === 'android'
    ? value
    : undefined
}

function parseFailureErrorCode(value: unknown): WorkflowRuntimeFailureCode | undefined {
  return value === 'provider_unavailable' ||
    value === 'tool_unavailable' ||
    value === 'permission_required' ||
    value === 'schema_invalid' ||
    value === 'rag_unavailable' ||
    value === 'evidence_insufficient' ||
    value === 'cancelled' ||
    value === 'step_limit_reached' ||
    value === 'policy_denied' ||
    value === 'execution_failed'
    ? value
    : undefined
}

function clampTextWithExactLimit(value: string, limit: number): string {
  if (value.length <= limit) return value
  if (limit <= TRUNCATION_MARKER.length) return value.slice(0, Math.max(0, limit))
  return `${value.slice(0, Math.max(0, limit - TRUNCATION_MARKER.length))}${TRUNCATION_MARKER}`
}
