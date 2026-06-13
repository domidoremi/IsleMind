import type { McpToolPermission, ProcessTrace, RagContextPack, RagProfile, ToolContentBlock } from '@/types'

export type AgentToolPermission = McpToolPermission
export type AgentToolSource = 'mcp' | 'builtin' | 'app-action' | 'rag' | 'search' | 'work-artifact' | 'android'
export type AgentToolStatus = 'done' | 'error' | 'skipped'
export type AgentRunStatus = 'planning' | 'running' | 'waiting' | 'done' | 'error' | 'cancelled'
export type AgentStepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled'
export type AgentWorkflowIntent =
  | 'plain_chat'
  | 'settings_action'
  | 'tool_task'
  | 'rag_evidence'
  | 'work_artifact'
  | 'handoff'
  | 'diagnostic'
export type AgentRequestedOutput = 'auto' | 'reply' | 'work-artifact'

export type AgentFailureCode =
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

export interface AgentToolManifest {
  id: string
  source: AgentToolSource
  name: string
  description: string
  permission: AgentToolPermission
  inputSchema?: Record<string, unknown>
  enabled: boolean
  serverId?: string
  serverName?: string
  requiresRuntimeContext?: boolean
  metadata?: Record<string, unknown>
}

export interface AgentToolRequest {
  toolId?: string
  name?: string
  source?: AgentToolSource
  serverId?: string
  arguments?: Record<string, unknown>
}

export interface AgentPendingAction {
  id: string
  reason: Extract<AgentFailureCode, 'permission_required' | 'step_limit_reached' | 'evidence_insufficient'>
  title: string
  summary: string
  toolName?: string
  toolId?: string
  serverId?: string
  source?: AgentToolSource
  permission?: AgentToolPermission
  argumentsPreview?: string
  confirmable: boolean
  resumeToolRequest?: AgentToolRequest
  suggestedUserPrompt?: string
  blockedReason?: string
  repairStrategy?: string
  workflowId?: string
  workflowName?: string
  workflowExpectedOutput?: string
  stepId?: string
  stepTitle?: string
  stepNumber?: number
  planStepCount?: number
  completedStepCount?: number
  remainingStepCount?: number
  createdAt: number
}

export interface AgentToolResult {
  ok: boolean
  status: AgentToolStatus
  output: string
  blocks?: ToolContentBlock[]
  trace: ProcessTrace
  errorCode?: AgentFailureCode
  metadata?: Record<string, unknown>
}

export interface AgentRuntimeLogOptions {
  enabled?: boolean
  maxBytes?: number
}

export interface AgentRunLimits {
  maxSteps: number
  maxToolCallsPerStep: number
  allowReadOnlyTools: boolean
  allowReadWriteTools: boolean | 'visible'
  allowDestructiveTools: boolean | 'confirm'
  allowBackgroundContinuation: boolean
  requireTrace: boolean
  outputCharLimit: number
}

export interface AgentPermissionContext {
  intentVisible?: boolean
  userConfirmed?: boolean
  stepIndex?: number
  toolCallIndex?: number
  limits?: Partial<AgentRunLimits>
}

export interface AgentPermissionDecision {
  decision: 'allow' | 'confirm' | 'deny'
  code?: AgentFailureCode
  reason: string
  trace: ProcessTrace
}

export interface AgentStep {
  id: string
  title: string
  status: AgentStepStatus
  toolRequest?: AgentToolRequest
  observation?: AgentToolResult
  trace: ProcessTrace[]
  startedAt?: number
  completedAt?: number
}

export interface AgentWorkflowRun {
  id: string
  goal: string
  intent?: AgentWorkflowIntent
  status: AgentRunStatus
  steps: AgentStep[]
  traces: ProcessTrace[]
  startedAt: number
  completedAt?: number
  failureCode?: AgentFailureCode
  finalOutput?: string
  pendingAction?: AgentPendingAction
}

export interface AgentSchemaValidationResult {
  ok: boolean
  errors: string[]
}

export interface AgentRagContextPackRequest {
  query: string
  conversationTitle?: string
  systemPrompt?: string
  profile?: RagProfile
  profileReason?: string
  tokenBudget?: number
  maxContextItems?: number
}

export interface AgentRagRuntimeOptions {
  signal?: AbortSignal
}

export interface AgentRagRuntime {
  buildContextPack: (request: AgentRagContextPackRequest, options?: AgentRagRuntimeOptions) => Promise<RagContextPack>
}

export interface AgentWorkflowStepDefinition {
  id: string
  title: string
  toolRequest?: AgentToolRequest
  acceptance?: string[]
}

export interface AgentWorkflowDefinition {
  schema: 'islemind.agent.workflow.v1'
  id: string
  name: string
  description?: string
  enabled: boolean
  triggerHints: string[]
  steps: AgentWorkflowStepDefinition[]
  permissionCeiling: AgentToolPermission
  expectedOutput?: 'reply' | 'rag-evidence' | 'work-artifact' | 'handoff' | 'diagnostic'
  acceptanceChecks: string[]
  createdAt: number
  updatedAt: number
}

export interface AgentWorkflowDefinitionValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
  sanitized?: AgentWorkflowDefinition
}
