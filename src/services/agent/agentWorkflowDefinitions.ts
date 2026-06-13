import type {
  AgentToolManifest,
  AgentToolPermission,
  AgentWorkflowDefinition,
  AgentWorkflowDefinitionValidation,
} from '@/services/agent/agentToolTypes'
import { redactSensitiveText } from '@/services/agent/agentTrace'

const WORKFLOW_SCHEMA = 'islemind.agent.workflow.v1'
const WORK_ARTIFACT_QUALITY_AUDIT_ACCEPTANCE = 'quality audit passes'
const RAG_EVIDENCE_ACCEPTANCE = 'citation evidence present'
const ELEVATED_PERMISSION_GATE_ACCEPTANCE = 'visible permission gate required'
const PERMISSION_RANK: Record<AgentToolPermission, number> = {
  'read-only': 0,
  'read-write': 1,
  destructive: 2,
}

const ARBITRARY_EXECUTION_PATTERNS = [
  /\b(shell|terminal|powershell|cmd\.exe|bash|exec|spawn|eval|adb shell)\b/i,
  /\bdelete all\b/i,
  /彻底删除|永久删除|执行代码|运行命令|系统控制/,
]
const SENSITIVE_ARGUMENT_KEY_PATTERN = /(api[_-]?key|authorization|password|secret|token)/i
const ARGUMENT_REDACTION_MAX_DEPTH = 8
const BLOCKED_ARGUMENT_EXECUTION_RISK = '[blocked: arbitrary execution risk]'
const TOOL_IDENTITY_TEXT_LIMIT = 240

export interface CreateAgentWorkflowDefinitionInput {
  id?: string
  name: string
  description?: string
  enabled?: boolean
  triggerHints?: string[]
  steps: AgentWorkflowDefinition['steps']
  permissionCeiling?: AgentToolPermission
  expectedOutput?: AgentWorkflowDefinition['expectedOutput']
  acceptanceChecks?: string[]
  now?: number
}

export function createAgentWorkflowDefinition(input: CreateAgentWorkflowDefinitionInput): AgentWorkflowDefinition {
  const now = input.now ?? Date.now()
  const permissionCeiling = input.permissionCeiling ?? 'read-only'
  const expectedOutput = resolveWorkflowExpectedOutput(input.expectedOutput, input.steps)
  return {
    schema: WORKFLOW_SCHEMA,
    id: input.id ?? `agent-workflow-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    enabled: input.enabled ?? true,
    triggerHints: sanitizeList(input.triggerHints ?? []),
    steps: input.steps.map((step, index) => ({
      id: step.id || `step-${index + 1}`,
      title: step.title.trim(),
      toolRequest: step.toolRequest,
      acceptance: sanitizeList(step.acceptance ?? []),
    })),
    permissionCeiling,
    expectedOutput,
    acceptanceChecks: normalizeWorkflowAcceptanceChecks(expectedOutput, input.acceptanceChecks ?? [], input.steps, permissionCeiling),
    createdAt: now,
    updatedAt: now,
  }
}

export function validateAgentWorkflowDefinition(
  definition: AgentWorkflowDefinition,
  manifests: AgentToolManifest[]
): AgentWorkflowDefinitionValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const sanitized = sanitizeAgentWorkflowDefinition(definition)

  if (sanitized.schema !== WORKFLOW_SCHEMA) errors.push('schema must be islemind.agent.workflow.v1.')
  if (!sanitized.id.trim()) errors.push('id is required.')
  if (!sanitized.name.trim()) errors.push('name is required.')
  if (!sanitized.steps.length) errors.push('at least one workflow step is required.')
  if (!isPermission(sanitized.permissionCeiling)) errors.push('permissionCeiling is invalid.')

  sanitized.steps.forEach((step, index) => {
    if (!step.id.trim()) errors.push(`steps[${index}].id is required.`)
    if (!step.title.trim()) errors.push(`steps[${index}].title is required.`)
    if (containsArbitraryExecutionRisk(step.title)) {
      errors.push(`steps[${index}].title contains arbitrary execution risk.`)
    }
    if (!step.toolRequest) {
      warnings.push(`steps[${index}] has no tool request.`)
      return
    }
    if (workflowToolIdentityNeedsReview(step.toolRequest)) {
      errors.push(`steps[${index}].toolRequest tool identity contains sensitive or truncated text.`)
    }
    const tool = resolveWorkflowTool(step.toolRequest, manifests)
    if (!tool) {
      errors.push(`steps[${index}] references an unavailable tool.`)
      return
    }
    if (!tool.enabled) errors.push(`steps[${index}] references a disabled tool.`)
    if (!permissionWithinCeiling(tool.permission, sanitized.permissionCeiling)) {
      errors.push(`steps[${index}] exceeds permission ceiling ${sanitized.permissionCeiling}.`)
    }
    if (containsArbitraryExecutionRisk(`${tool.name} ${tool.description}`)) {
      errors.push(`steps[${index}] references a tool with arbitrary execution risk.`)
    }
    const argumentText = JSON.stringify(step.toolRequest.arguments ?? {})
    if (argumentText.includes(BLOCKED_ARGUMENT_EXECUTION_RISK) || containsArbitraryExecutionRisk(argumentText)) {
      errors.push(`steps[${index}].toolRequest.arguments contain arbitrary execution risk.`)
    }
  })
  if (sanitized.expectedOutput === 'rag-evidence' && !usesRagContextPack(sanitized.steps)) {
    errors.push('rag-evidence workflows must include rag:context_pack evidence retrieval.')
  }

  const serialized = JSON.stringify(sanitized)
  if (serialized.includes('[redacted]')) warnings.push('sensitive text was redacted.')
  if (containsArbitraryExecutionRisk(`${sanitized.name} ${sanitized.description ?? ''} ${sanitized.triggerHints.join(' ')} ${sanitized.acceptanceChecks.join(' ')}`)) {
    errors.push('workflow definition contains arbitrary execution risk.')
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    sanitized,
  }
}

export function exportAgentWorkflowDefinition(definition: AgentWorkflowDefinition, manifests: AgentToolManifest[] = []): string {
  const validation = validateAgentWorkflowDefinition(definition, manifests)
  const value = validation.sanitized ?? sanitizeAgentWorkflowDefinition(definition)
  return `${JSON.stringify(value, null, 2)}\n`
}

export function sanitizeAgentWorkflowDefinition(definition: AgentWorkflowDefinition): AgentWorkflowDefinition {
  const now = Date.now()
  const permissionCeiling = isPermission(definition.permissionCeiling) ? definition.permissionCeiling : 'read-only'
  const expectedOutput = resolveWorkflowExpectedOutput(definition.expectedOutput, definition.steps)
  return {
    schema: WORKFLOW_SCHEMA,
    id: cleanText(definition.id),
    name: cleanText(definition.name),
    description: definition.description ? cleanText(definition.description) : undefined,
    enabled: Boolean(definition.enabled),
    triggerHints: sanitizeList(definition.triggerHints),
    steps: Array.isArray(definition.steps)
      ? definition.steps.map((step, index) => ({
          id: cleanText(step.id || `step-${index + 1}`),
          title: cleanText(step.title),
          toolRequest: step.toolRequest ? sanitizeToolRequest(step.toolRequest) : undefined,
          acceptance: sanitizeList(step.acceptance ?? []),
        }))
      : [],
    permissionCeiling,
    expectedOutput,
    acceptanceChecks: normalizeWorkflowAcceptanceChecks(expectedOutput, definition.acceptanceChecks, definition.steps, permissionCeiling),
    createdAt: Number.isFinite(definition.createdAt) ? definition.createdAt : now,
    updatedAt: Number.isFinite(definition.updatedAt) ? definition.updatedAt : now,
  }
}

export function permissionWithinCeiling(permission: AgentToolPermission, ceiling: AgentToolPermission): boolean {
  return PERMISSION_RANK[permission] <= PERMISSION_RANK[ceiling]
}

function resolveWorkflowTool(request: NonNullable<AgentWorkflowDefinition['steps'][number]['toolRequest']>, manifests: AgentToolManifest[]): AgentToolManifest | undefined {
  if (request.toolId) return manifests.find((tool) => tool.id === request.toolId)
  if (!request.name) return undefined
  return manifests.find((tool) => {
    if (tool.name !== request.name) return false
    if (request.source && tool.source !== request.source) return false
    if (request.serverId && tool.serverId !== request.serverId) return false
    return true
  })
}

function normalizeWorkflowAcceptanceChecks(
  expectedOutput: AgentWorkflowDefinition['expectedOutput'],
  checks: string[] | undefined,
  steps: AgentWorkflowDefinition['steps'] = [],
  permissionCeiling: AgentToolPermission = 'read-only'
): string[] {
  const values = sanitizeList(checks ?? [])
  if (expectedOutput === 'work-artifact' && !values.includes(WORK_ARTIFACT_QUALITY_AUDIT_ACCEPTANCE)) {
    values.push(WORK_ARTIFACT_QUALITY_AUDIT_ACCEPTANCE)
  }
  if ((expectedOutput === 'rag-evidence' || usesRagContextPack(steps)) && !values.includes(RAG_EVIDENCE_ACCEPTANCE)) {
    values.push(RAG_EVIDENCE_ACCEPTANCE)
  }
  if (permissionCeiling !== 'read-only' && !values.includes(ELEVATED_PERMISSION_GATE_ACCEPTANCE)) {
    values.push(ELEVATED_PERMISSION_GATE_ACCEPTANCE)
  }
  return values
}

function resolveWorkflowExpectedOutput(
  expectedOutput: AgentWorkflowDefinition['expectedOutput'],
  steps: AgentWorkflowDefinition['steps'] | undefined
): AgentWorkflowDefinition['expectedOutput'] {
  return expectedOutput ?? (usesRagContextPack(steps) ? 'rag-evidence' : undefined)
}

function usesRagContextPack(steps: AgentWorkflowDefinition['steps'] | undefined): boolean {
  if (!Array.isArray(steps)) return false
  return steps.some((step) => (
    step.toolRequest?.toolId === 'rag:context_pack' ||
    step.toolRequest?.name === 'rag.context_pack'
  ))
}

function sanitizeArguments(args: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!args) return undefined
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    safe[key] = sanitizeArgumentValue(key, value)
  }
  return safe
}

function sanitizeArgumentValue(key: string, value: unknown, depth = 0): unknown {
  if (SENSITIVE_ARGUMENT_KEY_PATTERN.test(key)) return '[redacted]'
  if (typeof value === 'string') {
    const cleaned = cleanText(value)
    return containsArbitraryExecutionRisk(cleaned) ? BLOCKED_ARGUMENT_EXECUTION_RISK : cleaned
  }
  if (value === null || value === undefined) return value
  if (depth >= ARGUMENT_REDACTION_MAX_DEPTH) return '[redacted]'
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeArgumentValue('', item, depth + 1))
  }
  if (typeof value === 'object') {
    const safe: Record<string, unknown> = {}
    for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      safe[nestedKey] = sanitizeArgumentValue(nestedKey, nestedValue, depth + 1)
    }
    return safe
  }
  return value
}

function sanitizeToolRequest(
  request: NonNullable<AgentWorkflowDefinition['steps'][number]['toolRequest']>
): NonNullable<AgentWorkflowDefinition['steps'][number]['toolRequest']> {
  const args = sanitizeArguments(request.arguments)
  const safeRequest = {
    ...request,
    ...(request.toolId ? { toolId: cleanToolIdentity(request.toolId) } : {}),
    ...(request.name ? { name: cleanToolIdentity(request.name) } : {}),
    ...(request.serverId ? { serverId: cleanToolIdentity(request.serverId) } : {}),
  }
  if (args === undefined) {
    delete safeRequest.arguments
    return safeRequest
  }
  return { ...safeRequest, arguments: args }
}

function cleanToolIdentity(value: string): string {
  const cleaned = cleanText(value).replace(/\s+/g, ' ')
  if (cleaned.length <= TOOL_IDENTITY_TEXT_LIMIT) return cleaned
  const marker = '[output truncated]'
  return `${cleaned.slice(0, Math.max(0, TOOL_IDENTITY_TEXT_LIMIT - marker.length - 1))} ${marker}`.trim()
}

function workflowToolIdentityNeedsReview(request: NonNullable<AgentWorkflowDefinition['steps'][number]['toolRequest']>): boolean {
  return [request.toolId, request.name, request.serverId].some((value) => (
    typeof value === 'string' && (value.includes('[redacted]') || value.includes('[output truncated]'))
  ))
}

function sanitizeList(values: string[]): string[] {
  return values.map(cleanText).filter(Boolean)
}

function cleanText(value: string): string {
  return redactSensitiveText(String(value ?? '').trim()).slice(0, 2000)
}

function containsArbitraryExecutionRisk(value: string): boolean {
  return ARBITRARY_EXECUTION_PATTERNS.some((pattern) => pattern.test(value))
}

function isPermission(value: unknown): value is AgentToolPermission {
  return value === 'read-only' || value === 'read-write' || value === 'destructive'
}
