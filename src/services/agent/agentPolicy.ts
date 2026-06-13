import type {
  AgentPermissionContext,
  AgentPermissionDecision,
  AgentRunLimits,
  AgentSchemaValidationResult,
  AgentToolManifest,
} from '@/services/agent/agentToolTypes'
import type { Settings } from '@/types'
import { createAgentTrace } from '@/services/agent/agentTrace'

export const DEFAULT_AGENT_RUN_LIMITS: AgentRunLimits = {
  maxSteps: 3,
  maxToolCallsPerStep: 1,
  allowReadOnlyTools: true,
  allowReadWriteTools: 'visible',
  allowDestructiveTools: 'confirm',
  allowBackgroundContinuation: false,
  requireTrace: true,
  outputCharLimit: 4800,
}

type AgentWorkflowLimitSettings = Pick<
  Settings,
  | 'agentWorkflowMaxSteps'
  | 'agentWorkflowMaxToolCallsPerStep'
  | 'agentWorkflowAllowReadOnlyTools'
  | 'agentWorkflowAllowReadWriteTools'
  | 'agentWorkflowAllowDestructiveTools'
  | 'agentWorkflowOutputCharLimit'
>

const AGENT_WORKFLOW_NUMERIC_LIMITS = {
  maxSteps: { min: 1, max: 8 },
  maxToolCallsPerStep: { min: 1, max: 3 },
  outputCharLimit: { min: 512, max: 12000 },
} as const

export function resolveAgentRunLimits(input?: Partial<AgentRunLimits>): AgentRunLimits {
  const limits = { ...DEFAULT_AGENT_RUN_LIMITS, ...input }
  return {
    ...limits,
    maxSteps: normalizeDirectIntegerLimit(
      input?.maxSteps,
      DEFAULT_AGENT_RUN_LIMITS.maxSteps,
      AGENT_WORKFLOW_NUMERIC_LIMITS.maxSteps.min,
      AGENT_WORKFLOW_NUMERIC_LIMITS.maxSteps.max
    ),
    maxToolCallsPerStep: normalizeDirectIntegerLimit(
      input?.maxToolCallsPerStep,
      DEFAULT_AGENT_RUN_LIMITS.maxToolCallsPerStep,
      AGENT_WORKFLOW_NUMERIC_LIMITS.maxToolCallsPerStep.min,
      AGENT_WORKFLOW_NUMERIC_LIMITS.maxToolCallsPerStep.max
    ),
    outputCharLimit: normalizeDirectIntegerLimit(
      input?.outputCharLimit,
      DEFAULT_AGENT_RUN_LIMITS.outputCharLimit,
      AGENT_WORKFLOW_NUMERIC_LIMITS.outputCharLimit.min,
      AGENT_WORKFLOW_NUMERIC_LIMITS.outputCharLimit.max
    ),
    allowBackgroundContinuation: DEFAULT_AGENT_RUN_LIMITS.allowBackgroundContinuation,
    requireTrace: DEFAULT_AGENT_RUN_LIMITS.requireTrace,
  }
}

export function resolveSettingsAgentRunLimits(settings?: Partial<AgentWorkflowLimitSettings>): AgentRunLimits {
  return resolveAgentRunLimits({
    maxSteps: clampInteger(
      settings?.agentWorkflowMaxSteps,
      DEFAULT_AGENT_RUN_LIMITS.maxSteps,
      AGENT_WORKFLOW_NUMERIC_LIMITS.maxSteps.min,
      AGENT_WORKFLOW_NUMERIC_LIMITS.maxSteps.max
    ),
    maxToolCallsPerStep: clampInteger(
      settings?.agentWorkflowMaxToolCallsPerStep,
      DEFAULT_AGENT_RUN_LIMITS.maxToolCallsPerStep,
      AGENT_WORKFLOW_NUMERIC_LIMITS.maxToolCallsPerStep.min,
      AGENT_WORKFLOW_NUMERIC_LIMITS.maxToolCallsPerStep.max
    ),
    allowReadOnlyTools: typeof settings?.agentWorkflowAllowReadOnlyTools === 'boolean'
      ? settings.agentWorkflowAllowReadOnlyTools
      : DEFAULT_AGENT_RUN_LIMITS.allowReadOnlyTools,
    allowReadWriteTools: normalizeReadWriteToolPolicy(settings?.agentWorkflowAllowReadWriteTools),
    allowDestructiveTools: normalizeDestructiveToolPolicy(settings?.agentWorkflowAllowDestructiveTools),
    allowBackgroundContinuation: DEFAULT_AGENT_RUN_LIMITS.allowBackgroundContinuation,
    requireTrace: DEFAULT_AGENT_RUN_LIMITS.requireTrace,
    outputCharLimit: clampInteger(
      settings?.agentWorkflowOutputCharLimit,
      DEFAULT_AGENT_RUN_LIMITS.outputCharLimit,
      AGENT_WORKFLOW_NUMERIC_LIMITS.outputCharLimit.min,
      AGENT_WORKFLOW_NUMERIC_LIMITS.outputCharLimit.max
    ),
  })
}

export function decideAgentToolPermission(tool: AgentToolManifest, context: AgentPermissionContext = {}): AgentPermissionDecision {
  const limits = resolveAgentRunLimits(context.limits)
  const startedAt = Date.now()

  if (!tool.enabled) {
    return decision('deny', 'tool_unavailable', `${tool.name} is disabled.`, tool, startedAt)
  }

  if ((context.stepIndex ?? 0) >= limits.maxSteps) {
    return decision('deny', 'step_limit_reached', 'The workflow step limit was reached.', tool, startedAt, context, limits)
  }

  if ((context.toolCallIndex ?? 0) >= limits.maxToolCallsPerStep) {
    return decision('deny', 'step_limit_reached', 'The tool call limit for this step was reached.', tool, startedAt, context, limits)
  }

  if (tool.permission === 'read-only') {
    return limits.allowReadOnlyTools
      ? decision('allow', undefined, 'Read-only tool execution is allowed.', tool, startedAt, context, limits, 'read-only-allowed')
      : decision('deny', 'permission_required', 'Read-only tool execution is disabled by policy.', tool, startedAt, context, limits)
  }

  if (tool.permission === 'read-write') {
    if (limits.allowReadWriteTools === true) {
      return decision('allow', undefined, 'Read-write tool execution is allowed.', tool, startedAt, context, limits, 'policy-allow-read-write')
    }
    if (limits.allowReadWriteTools === 'visible' && context.intentVisible) {
      return decision('allow', undefined, 'Read-write tool execution is visible to the user.', tool, startedAt, context, limits, 'visible-action')
    }
    return decision('confirm', 'permission_required', 'Read-write tool execution requires a visible planned action.', tool, startedAt, context, limits)
  }

  if (limits.allowDestructiveTools === true || (limits.allowDestructiveTools === 'confirm' && context.userConfirmed)) {
    return decision(
      'allow',
      undefined,
      'Destructive tool execution was explicitly confirmed.',
      tool,
      startedAt,
      context,
      limits,
      limits.allowDestructiveTools === true ? 'policy-allow-destructive' : 'user-confirmed'
    )
  }

  return decision('confirm', 'permission_required', 'Destructive tool execution requires explicit confirmation.', tool, startedAt, context, limits)
}

export function validateAgentToolInput(schema: Record<string, unknown> | undefined, args: Record<string, unknown> = {}): AgentSchemaValidationResult {
  if (!schema) return { ok: true, errors: [] }
  const errors: string[] = []
  const type = schema.type
  if (type && type !== 'object') {
    errors.push('Only object input schemas are supported.')
    return { ok: false, errors }
  }

  const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : []
  for (const key of required) {
    if (args[key] === undefined || args[key] === null) errors.push(`${key} is required.`)
  }

  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties as Record<string, Record<string, unknown>>
    : {}
  if (schema.additionalProperties === false) {
    const knownKeys = new Set(Object.keys(properties))
    for (const key of Object.keys(args)) {
      if (!knownKeys.has(key)) errors.push(`${key} is not allowed.`)
    }
  }
  for (const [key, rules] of Object.entries(properties)) {
    const value = args[key]
    if (value === undefined || value === null) continue
    validateAgentSchemaValue(key, value, rules, errors)
  }

  return { ok: errors.length === 0, errors }
}

function validateAgentSchemaValue(path: string, value: unknown, rules: Record<string, unknown>, errors: string[]): void {
  const ruleType = rules.type
  const allowedTypes = Array.isArray(ruleType)
    ? ruleType.filter((item): item is string => typeof item === 'string')
    : typeof ruleType === 'string'
      ? [ruleType]
      : []
  if (allowedTypes.length && !allowedTypes.some((type) => matchesJsonType(value, type))) {
    errors.push(`${path} must be ${allowedTypes.join(' or ')}.`)
  }

  if (Array.isArray(rules.enum) && !rules.enum.includes(value)) {
    errors.push(`${path} must be one of ${rules.enum.map(String).join(', ')}.`)
  }

  if (typeof value === 'number') {
    if (typeof rules.minimum === 'number' && value < rules.minimum) errors.push(`${path} must be >= ${rules.minimum}.`)
    if (typeof rules.maximum === 'number' && value > rules.maximum) errors.push(`${path} must be <= ${rules.maximum}.`)
  }

  if (typeof value === 'string') {
    if (typeof rules.minLength === 'number' && value.length < rules.minLength) errors.push(`${path} must be at least ${rules.minLength} characters.`)
    if (typeof rules.maxLength === 'number' && value.length > rules.maxLength) errors.push(`${path} must be at most ${rules.maxLength} characters.`)
    if (typeof rules.pattern === 'string') {
      try {
        if (!new RegExp(rules.pattern).test(value)) errors.push(`${path} must match pattern ${rules.pattern}.`)
      } catch {
        errors.push(`${path} has an invalid schema pattern.`)
      }
    }
  }

  if (Array.isArray(value)) {
    if (typeof rules.minItems === 'number' && value.length < rules.minItems) errors.push(`${path} must include at least ${rules.minItems} item(s).`)
    if (typeof rules.maxItems === 'number' && value.length > rules.maxItems) errors.push(`${path} must include at most ${rules.maxItems} item(s).`)
    const itemRules = rules.items && typeof rules.items === 'object' && !Array.isArray(rules.items)
      ? rules.items as Record<string, unknown>
      : undefined
    if (itemRules) {
      value.forEach((item, index) => validateAgentSchemaValue(`${path}[${index}]`, item, itemRules, errors))
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const nestedProperties = rules.properties && typeof rules.properties === 'object' && !Array.isArray(rules.properties)
      ? rules.properties as Record<string, Record<string, unknown>>
      : {}
    const objectValue = value as Record<string, unknown>
    if (rules.additionalProperties === false) {
      const knownKeys = new Set(Object.keys(nestedProperties))
      for (const key of Object.keys(objectValue)) {
        if (!knownKeys.has(key)) errors.push(`${path}.${key} is not allowed.`)
      }
    }
    const required = Array.isArray(rules.required) ? rules.required.filter((item): item is string => typeof item === 'string') : []
    for (const key of required) {
      if (objectValue[key] === undefined || objectValue[key] === null) errors.push(`${path}.${key} is required.`)
    }
    for (const [key, nestedRules] of Object.entries(nestedProperties)) {
      const nestedValue = objectValue[key]
      if (nestedValue === undefined || nestedValue === null) continue
      validateAgentSchemaValue(`${path}.${key}`, nestedValue, nestedRules, errors)
    }
  }
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function normalizeDirectIntegerLimit(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const integer = Math.trunc(value)
  if (integer < min) return fallback
  return Math.min(max, integer)
}

function normalizeReadWriteToolPolicy(value: unknown): AgentRunLimits['allowReadWriteTools'] {
  if (value === true || value === 'visible') return 'visible'
  if (value === false) return false
  return DEFAULT_AGENT_RUN_LIMITS.allowReadWriteTools
}

function normalizeDestructiveToolPolicy(value: unknown): AgentRunLimits['allowDestructiveTools'] {
  if (value === true || value === 'confirm') return 'confirm'
  if (value === false) return false
  return DEFAULT_AGENT_RUN_LIMITS.allowDestructiveTools
}

function matchesJsonType(value: unknown, type: string): boolean {
  if (type === 'array') return Array.isArray(value)
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'string') return typeof value === 'string'
  if (type === 'null') return value === null
  return true
}

function decision(
  result: AgentPermissionDecision['decision'],
  code: AgentPermissionDecision['code'],
  reason: string,
  tool: AgentToolManifest,
  startedAt: number,
  context: AgentPermissionContext = {},
  limits: AgentRunLimits = DEFAULT_AGENT_RUN_LIMITS,
  allowReason?: string
): AgentPermissionDecision {
  const status = result === 'allow' ? 'done' : result === 'confirm' || code === 'tool_unavailable' ? 'skipped' : 'error'
  return {
    decision: result,
    code,
    reason,
    trace: createAgentTrace({
      id: `agent-policy-${tool.id}-${startedAt}`,
      type: 'system',
      title: `Agent policy ${tool.name}`,
      content: reason,
      status,
      startedAt,
      metadata: {
        toolId: tool.id,
        source: tool.source,
        permission: tool.permission,
        decision: result,
        code,
        allowReason,
        intentVisible: Boolean(context.intentVisible),
        userConfirmed: Boolean(context.userConfirmed),
        stepIndex: context.stepIndex,
        toolCallIndex: context.toolCallIndex,
        maxStepCount: limits.maxSteps,
        maxToolCallsPerStep: limits.maxToolCallsPerStep,
        readWriteToolPolicy: limits.allowReadWriteTools,
        destructiveToolPolicy: limits.allowDestructiveTools,
      },
    }),
  }
}
