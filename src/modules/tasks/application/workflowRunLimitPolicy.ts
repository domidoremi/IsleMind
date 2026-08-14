export interface WorkflowRunLimits {
  maxSteps: number
  maxToolCallsPerStep: number
  allowReadOnlyTools: boolean
  allowReadWriteTools: boolean | 'visible'
  allowDestructiveTools: boolean | 'confirm'
  allowBackgroundContinuation: boolean
  requireTrace: boolean
  outputCharLimit: number
}

export interface WorkflowRunLimitSettings {
  agentWorkflowMaxSteps?: number
  agentWorkflowMaxToolCallsPerStep?: number
  agentWorkflowAllowReadOnlyTools?: boolean
  agentWorkflowAllowReadWriteTools?: boolean | 'visible'
  agentWorkflowAllowDestructiveTools?: boolean | 'confirm'
  agentWorkflowOutputCharLimit?: number
}

export const DEFAULT_WORKFLOW_RUN_LIMITS: WorkflowRunLimits = {
  maxSteps: 3,
  maxToolCallsPerStep: 1,
  allowReadOnlyTools: true,
  allowReadWriteTools: 'visible',
  allowDestructiveTools: 'confirm',
  allowBackgroundContinuation: false,
  requireTrace: true,
  outputCharLimit: 4800,
}

const WORKFLOW_NUMERIC_LIMITS = {
  maxSteps: { min: 1, max: 8 },
  maxToolCallsPerStep: { min: 1, max: 3 },
  outputCharLimit: { min: 512, max: 12000 },
} as const

export function resolveWorkflowRunLimits(
  input?: Partial<WorkflowRunLimits>,
): WorkflowRunLimits {
  const limits = { ...DEFAULT_WORKFLOW_RUN_LIMITS, ...input }
  return {
    ...limits,
    maxSteps: normalizeDirectIntegerLimit(
      input?.maxSteps,
      DEFAULT_WORKFLOW_RUN_LIMITS.maxSteps,
      WORKFLOW_NUMERIC_LIMITS.maxSteps.min,
      WORKFLOW_NUMERIC_LIMITS.maxSteps.max,
    ),
    maxToolCallsPerStep: normalizeDirectIntegerLimit(
      input?.maxToolCallsPerStep,
      DEFAULT_WORKFLOW_RUN_LIMITS.maxToolCallsPerStep,
      WORKFLOW_NUMERIC_LIMITS.maxToolCallsPerStep.min,
      WORKFLOW_NUMERIC_LIMITS.maxToolCallsPerStep.max,
    ),
    outputCharLimit: normalizeDirectIntegerLimit(
      input?.outputCharLimit,
      DEFAULT_WORKFLOW_RUN_LIMITS.outputCharLimit,
      WORKFLOW_NUMERIC_LIMITS.outputCharLimit.min,
      WORKFLOW_NUMERIC_LIMITS.outputCharLimit.max,
    ),
    allowBackgroundContinuation: DEFAULT_WORKFLOW_RUN_LIMITS.allowBackgroundContinuation,
    requireTrace: DEFAULT_WORKFLOW_RUN_LIMITS.requireTrace,
  }
}

export function resolveWorkflowRunLimitsFromSettings(
  settings?: Partial<WorkflowRunLimitSettings>,
): WorkflowRunLimits {
  return resolveWorkflowRunLimits({
    maxSteps: clampInteger(
      settings?.agentWorkflowMaxSteps,
      DEFAULT_WORKFLOW_RUN_LIMITS.maxSteps,
      WORKFLOW_NUMERIC_LIMITS.maxSteps.min,
      WORKFLOW_NUMERIC_LIMITS.maxSteps.max,
    ),
    maxToolCallsPerStep: clampInteger(
      settings?.agentWorkflowMaxToolCallsPerStep,
      DEFAULT_WORKFLOW_RUN_LIMITS.maxToolCallsPerStep,
      WORKFLOW_NUMERIC_LIMITS.maxToolCallsPerStep.min,
      WORKFLOW_NUMERIC_LIMITS.maxToolCallsPerStep.max,
    ),
    allowReadOnlyTools: typeof settings?.agentWorkflowAllowReadOnlyTools === 'boolean'
      ? settings.agentWorkflowAllowReadOnlyTools
      : DEFAULT_WORKFLOW_RUN_LIMITS.allowReadOnlyTools,
    allowReadWriteTools: normalizeReadWriteToolPolicy(
      settings?.agentWorkflowAllowReadWriteTools,
    ),
    allowDestructiveTools: normalizeDestructiveToolPolicy(
      settings?.agentWorkflowAllowDestructiveTools,
    ),
    allowBackgroundContinuation: DEFAULT_WORKFLOW_RUN_LIMITS.allowBackgroundContinuation,
    requireTrace: DEFAULT_WORKFLOW_RUN_LIMITS.requireTrace,
    outputCharLimit: clampInteger(
      settings?.agentWorkflowOutputCharLimit,
      DEFAULT_WORKFLOW_RUN_LIMITS.outputCharLimit,
      WORKFLOW_NUMERIC_LIMITS.outputCharLimit.min,
      WORKFLOW_NUMERIC_LIMITS.outputCharLimit.max,
    ),
  })
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function normalizeDirectIntegerLimit(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const integer = Math.trunc(value)
  if (integer < min) return fallback
  return Math.min(max, integer)
}

function normalizeReadWriteToolPolicy(value: unknown): WorkflowRunLimits['allowReadWriteTools'] {
  if (value === true || value === 'visible') return 'visible'
  if (value === false) return false
  return DEFAULT_WORKFLOW_RUN_LIMITS.allowReadWriteTools
}

function normalizeDestructiveToolPolicy(value: unknown): WorkflowRunLimits['allowDestructiveTools'] {
  if (value === true || value === 'confirm') return 'confirm'
  if (value === false) return false
  return DEFAULT_WORKFLOW_RUN_LIMITS.allowDestructiveTools
}
