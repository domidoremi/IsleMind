import {
  DEFAULT_WORKFLOW_RUN_LIMITS,
  resolveWorkflowRunLimits,
  type WorkflowRunLimits,
} from './workflowRunLimitPolicy'

export type WorkflowToolPermission = 'read-only' | 'read-write' | 'destructive'
export type WorkflowToolRisk = 'low' | 'sensitive-read' | 'state-changing' | 'destructive'
export type WorkflowToolOutputBoundary = 'mode-session' | 'agent-trace' | 'external-system' | 'local-state'
export type WorkflowToolPermissionPolicyCode =
  | 'tool_unavailable'
  | 'permission_required'
  | 'evidence_insufficient'
  | 'step_limit_reached'
  | 'policy_denied'

export interface WorkflowToolPermissionContext {
  intentVisible?: boolean
  userConfirmed?: boolean
  evidenceSources?: readonly string[]
  evidenceSummary?: string
  stepIndex?: number
  toolCallIndex?: number
  limits?: Partial<WorkflowRunLimits>
}

export interface WorkflowToolPermissionManifest {
  id: string
  source: string
  name: string
  permission: WorkflowToolPermission
  enabled: boolean
  riskLevel?: WorkflowToolRisk
  requiresConfirmation?: boolean
  outputBoundary?: WorkflowToolOutputBoundary
  metadata?: Readonly<Record<string, unknown>>
}

export interface WorkflowToolPermissionEvidence {
  ready: boolean
  reliable: boolean
  sources: string[]
  reliableSources: string[]
  kinds: string[]
  summary?: string
}

export interface WorkflowToolPermissionPolicyResult {
  decision: 'allow' | 'confirm' | 'deny'
  code?: WorkflowToolPermissionPolicyCode
  reason: string
  allowReason?: string
  evidence: WorkflowToolPermissionEvidence
}

export interface WorkflowToolExecutionPolicy {
  riskLevel: WorkflowToolRisk
  requiresConfirmation: boolean
  outputBoundary: WorkflowToolOutputBoundary
}

export interface WorkflowToolPermissionTrace {
  id: string
  type: 'reasoning' | 'tool' | 'retrieval' | 'search' | 'memory' | 'knowledge' | 'system'
  title: string
  content?: string
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled'
  startedAt?: number
  completedAt?: number
  durationMs?: number
  metadata?: Record<string, unknown>
}

export interface WorkflowToolPermissionDecision {
  decision: 'allow' | 'confirm' | 'deny'
  code?: WorkflowToolPermissionPolicyCode
  reason: string
  trace: WorkflowToolPermissionTrace
}

export interface WorkflowToolInputValidationResult {
  ok: boolean
  errors: string[]
}

export interface WorkflowToolPermissionPolicyDependencies {
  now: () => number
  projectTrace: (trace: WorkflowToolPermissionTrace) => WorkflowToolPermissionTrace
  decidePermission: (
    tool: WorkflowToolPermissionManifest,
    context: WorkflowToolPermissionContext,
    limits: WorkflowRunLimits,
  ) => WorkflowToolPermissionPolicyResult
  resolveEvidence: (context: WorkflowToolPermissionContext) => WorkflowToolPermissionEvidence
  resolveExecutionPolicy: (tool: WorkflowToolPermissionManifest) => WorkflowToolExecutionPolicy
  validateInput: (
    schema: Record<string, unknown> | undefined,
    args?: Record<string, unknown>,
  ) => WorkflowToolInputValidationResult
}

export interface WorkflowToolPermissionPolicy {
  decideWorkflowToolPermission: (
    tool: WorkflowToolPermissionManifest,
    context?: WorkflowToolPermissionContext,
  ) => WorkflowToolPermissionDecision
  validateWorkflowToolInput: (
    schema: Record<string, unknown> | undefined,
    args?: Record<string, unknown>,
  ) => WorkflowToolInputValidationResult
}

export function createWorkflowToolPermissionPolicy(
  dependencies: WorkflowToolPermissionPolicyDependencies,
): WorkflowToolPermissionPolicy {
  return {
    decideWorkflowToolPermission(tool, context = {}) {
      const {
        mode: _ignoredLegacyMode,
        ...modeFreeContext
      } = context as WorkflowToolPermissionContext & { mode?: unknown }
      const limits = resolveWorkflowRunLimits(modeFreeContext.limits)
      const startedAt = dependencies.now()
      const policyDecision = dependencies.decidePermission(tool, modeFreeContext, limits)
      const traceContext = policyDecision.code === 'tool_unavailable' ? {} : modeFreeContext
      const traceLimits = policyDecision.code === 'tool_unavailable'
        ? DEFAULT_WORKFLOW_RUN_LIMITS
        : limits
      return projectPermissionDecision(
        policyDecision,
        tool,
        startedAt,
        traceContext,
        traceLimits,
        dependencies.projectTrace,
        policyDecision.code === 'tool_unavailable'
          ? dependencies.resolveEvidence(modeFreeContext)
          : policyDecision.evidence,
        dependencies.resolveExecutionPolicy,
      )
    },
    validateWorkflowToolInput(schema, args = {}) {
      return dependencies.validateInput(schema, args)
    },
  }
}

function projectPermissionDecision(
  policyDecision: WorkflowToolPermissionPolicyResult,
  tool: WorkflowToolPermissionManifest,
  startedAt: number,
  context: WorkflowToolPermissionContext,
  limits: WorkflowRunLimits,
  projectTrace: WorkflowToolPermissionPolicyDependencies['projectTrace'],
  evidence: WorkflowToolPermissionEvidence,
  resolveExecutionPolicy: WorkflowToolPermissionPolicyDependencies['resolveExecutionPolicy'],
): WorkflowToolPermissionDecision {
  const { decision, code, reason, allowReason } = policyDecision
  const status = decision === 'allow'
    ? 'done'
    : decision === 'confirm' || code === 'tool_unavailable'
      ? 'skipped'
      : 'error'
  const executionPolicy = resolveExecutionPolicy(tool)
  return {
    decision,
    code,
    reason,
    trace: projectTrace({
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
        decision,
        code,
        allowReason,
        riskLevel: executionPolicy.riskLevel,
        outputBoundary: executionPolicy.outputBoundary,
        requiresConfirmation: executionPolicy.requiresConfirmation,
        intentVisible: Boolean(context.intentVisible),
        userConfirmed: Boolean(context.userConfirmed),
        evidenceReady: evidence.ready,
        evidenceReliable: evidence.reliable,
        evidenceSourceCount: evidence.sources.length,
        evidenceReliableSourceCount: evidence.reliableSources.length,
        evidenceKinds: evidence.kinds,
        evidenceSources: evidence.sources,
        evidenceReliableSources: evidence.reliableSources,
        evidenceSummary: evidence.summary,
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
