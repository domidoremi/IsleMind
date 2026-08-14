import {
  createWorkflowDefinitionPolicy,
  createWorkflowSkillFormattingPolicy,
  type WorkflowDefinitionRecord,
  type WorkflowDefinitionToolRequest,
  type WorkflowDefinitionValidationResult,
  type WorkflowSkillSuggestion,
} from '@/modules/tasks'
import { formatToolRequestIdentity } from '@/modules/integrations'
import { clampTraceText, redactSensitiveText, type ProcessTrace } from '@/core'
import type { Message } from '@/types/chatContracts'
import type { SkillDefinition } from '@/types/skillContracts'

const WORKFLOW_SUGGESTION_TEXT_LIMIT = 2000
const WORKFLOW_SUGGESTION_PAYLOAD_LIMIT = 24000
const WORKFLOW_SUGGESTION_TOOL_IDENTITY_LIMIT = 240
const WORKFLOW_SUGGESTION_MAX_STEPS = 20
const WORKFLOW_SUGGESTION_MAX_LIST_ITEMS = 12
const WORKFLOW_SUGGESTION_MAX_STEP_ACCEPTANCE = 8
const BLOCKED_WORKFLOW_ARGUMENT_EXECUTION_RISK = '[blocked: arbitrary execution risk]'

const workflowDefinitionPolicy = createWorkflowDefinitionPolicy({
  clock: { now: Date.now },
  generateIdSuffix: () => Math.random().toString(36).slice(2, 8),
  redactSensitiveText,
})

const { buildWorkflowApprovalSummary } = createWorkflowSkillFormattingPolicy({
  redactSensitiveText,
  clampWorkflowOutput: clampTraceText,
  formatToolRequestIdentity,
})

export function getWorkflowSkillSuggestionFromMessage(
  message: Pick<Message, 'reasoning' | 'retrievalTrace' | 'toolCalls'>,
): WorkflowSkillSuggestion | undefined {
  const traces = collectWorkflowMessageTraces(message)
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const trace = traces[index]
    if (!isWorkflowSkillSuggestionTrace(trace)) continue
    const suggestion = sanitizeWorkflowSkillSuggestionForUi(trace.metadata?.workflowSkillSuggestion)
    if (suggestion) return suggestion
  }
  return undefined
}

function collectWorkflowMessageTraces(
  message: Pick<Message, 'reasoning' | 'retrievalTrace' | 'toolCalls'>,
): ProcessTrace[] {
  return [
    ...(message.reasoning ?? []),
    ...(message.retrievalTrace ?? []),
    ...(message.toolCalls ?? []),
  ]
    .filter((trace) => !trace.metadata?.hiddenSignature)
    .map((trace, index) => ({ trace, index, order: resolveWorkflowTraceOrder(trace, index) }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map((item) => item.trace)
}

function resolveWorkflowTraceOrder(trace: ProcessTrace, fallback: number): number {
  const timestamp = trace.completedAt ?? trace.startedAt
  return typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : fallback
}

function safeSuggestionStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function sanitizeWorkflowSkillSuggestionForUi(
  suggestion: unknown,
): WorkflowSkillSuggestion | undefined {
  if (!suggestion || typeof suggestion !== 'object') return undefined
  const record = suggestion as Record<string, unknown>
  if (
    typeof record.ok !== 'boolean' ||
    record.requiresUserApproval !== true ||
    typeof record.approvalSummary !== 'string'
  ) return undefined
  const decoded = workflowDefinitionPolicy.decode(record.workflow)
  if (!decoded.ok) return buildRejectedWorkflowSkillSuggestion(decoded.errors)
  const workflow = sanitizeWorkflowSuggestionDefinitionForUi(decoded.definition)
  if (!workflow) return buildRejectedWorkflowSkillSuggestion(['workflow definition could not be bounded safely.'])
  const validation = sanitizeWorkflowSuggestionValidation(record.validation, workflow)
  const matchingSkill = isMatchingWorkflowSuggestionSkill(record.skill, workflow)
  const unsafeReason = workflowSuggestionUnsafeReason(workflow)
  const safeValidation = unsafeReason
    ? appendWorkflowSuggestionValidationError(validation, unsafeReason)
    : validation
  const canExposeSkill = record.ok === true && safeValidation.ok && matchingSkill
  const skill = canExposeSkill ? buildSanitizedWorkflowSuggestionSkill(workflow, record.skill) : undefined
  const actionable = Boolean(skill)
  const visibleValidation = actionable ? safeValidation : { ...safeValidation, ok: false }
  return {
    ok: actionable,
    requiresUserApproval: true,
    workflow,
    validation: visibleValidation,
    ...(skill ? { skill } : {}),
    approvalSummary: clampTraceText(
      redactSensitiveText(buildWorkflowApprovalSummary(workflow, visibleValidation)),
      WORKFLOW_SUGGESTION_TEXT_LIMIT,
    ),
  }
}

function buildRejectedWorkflowSkillSuggestion(
  errors: readonly string[],
): WorkflowSkillSuggestion {
  const workflow = workflowDefinitionPolicy.create({
    id: 'agent-workflow',
    name: 'Agent workflow',
    enabled: false,
    steps: [],
    permissionCeiling: 'read-only',
    acceptanceChecks: [],
    now: 0,
  })
  const validation: WorkflowDefinitionValidationResult = {
    ok: false,
    errors: sanitizeWorkflowSuggestionStringList(
      errors.length ? errors : ['workflow definition is invalid.'],
      WORKFLOW_SUGGESTION_MAX_LIST_ITEMS,
    ),
    warnings: [],
    definition: workflow,
  }
  return {
    ok: false,
    requiresUserApproval: true,
    workflow,
    validation,
    approvalSummary: clampTraceText(
      redactSensitiveText(buildWorkflowApprovalSummary(workflow, validation)),
      WORKFLOW_SUGGESTION_TEXT_LIMIT,
    ),
  }
}

function sanitizeWorkflowSuggestionDefinitionForUi(
  workflow: WorkflowDefinitionRecord,
): WorkflowDefinitionRecord | undefined {
  const { description: _unboundedDescription, ...workflowFields } = workflow
  const description = workflow.description
    ? sanitizeWorkflowSuggestionText(workflow.description) || undefined
    : undefined
  const bounded: WorkflowDefinitionRecord = {
    ...workflowFields,
    id: sanitizeWorkflowSuggestionText(workflow.id) || 'agent-workflow',
    name: sanitizeWorkflowSuggestionText(workflow.name) || 'Agent workflow',
    ...(description ? { description } : {}),
    triggerHints: sanitizeWorkflowSuggestionStringList(workflow.triggerHints, WORKFLOW_SUGGESTION_MAX_LIST_ITEMS),
    steps: workflow.steps.slice(0, WORKFLOW_SUGGESTION_MAX_STEPS).map((step, index) => {
      const { toolRequest: _unboundedToolRequest, ...stepFields } = step
      const toolRequest = sanitizeWorkflowSuggestionToolRequest(step.toolRequest)
      return {
        ...stepFields,
        id: sanitizeWorkflowSuggestionText(step.id) || `step-${index + 1}`,
        title: sanitizeWorkflowSuggestionText(step.title) || `Step ${index + 1}`,
        ...(toolRequest ? { toolRequest } : {}),
        acceptance: sanitizeWorkflowSuggestionStringList(step.acceptance, WORKFLOW_SUGGESTION_MAX_STEP_ACCEPTANCE),
      }
    }),
    acceptanceChecks: sanitizeWorkflowSuggestionStringList(workflow.acceptanceChecks, WORKFLOW_SUGGESTION_MAX_LIST_ITEMS),
  }
  const decoded = workflowDefinitionPolicy.decode(bounded)
  return decoded.ok ? decoded.definition : undefined
}

function sanitizeWorkflowSuggestionToolRequest(value: WorkflowDefinitionToolRequest | undefined): WorkflowDefinitionToolRequest | undefined {
  if (!value) return undefined
  const args = sanitizeWorkflowSuggestionArguments(value.arguments)
  const toolId = sanitizeWorkflowSuggestionToolIdentity(value.toolId)
  const name = sanitizeWorkflowSuggestionToolIdentity(value.name)
  const serverId = sanitizeWorkflowSuggestionToolIdentity(value.serverId)
  const request: WorkflowDefinitionToolRequest = {
    ...(toolId ? { toolId } : {}),
    ...(name ? { name } : {}),
    ...(value.source ? { source: value.source } : {}),
    ...(serverId ? { serverId } : {}),
    ...(args ? { arguments: args } : {}),
  }
  return request.toolId || request.name ? request : undefined
}

function sanitizeWorkflowSuggestionToolIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const safe = clampTraceText(
    redactSensitiveText(value).trim(),
    WORKFLOW_SUGGESTION_TOOL_IDENTITY_LIMIT,
  )
    .replace(/\s+/g, ' ')
    .trim()
  return safe || undefined
}

function sanitizeWorkflowSuggestionText(value: string): string {
  return clampTraceText(
    redactSensitiveText(value).trim(),
    WORKFLOW_SUGGESTION_TEXT_LIMIT,
  ).trim()
}

function sanitizeWorkflowSuggestionArguments(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const serialized = safeSuggestionStringify(value)
  if (!serialized || serialized.length > 1200) return undefined
  try {
    return JSON.parse(serialized) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function sanitizeWorkflowSuggestionValidation(
  value: unknown,
  workflow: WorkflowDefinitionRecord,
): WorkflowDefinitionValidationResult {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      errors: ['workflow suggestion validation is missing.'],
      warnings: workflowSuggestionWarnings(workflow),
      definition: workflow,
    }
  }
  const record = value as Record<string, unknown>
  const errors = sanitizeWorkflowSuggestionStringList(record.errors, WORKFLOW_SUGGESTION_MAX_LIST_ITEMS)
  const warnings = [...new Set([
    ...sanitizeWorkflowSuggestionStringList(record.warnings, WORKFLOW_SUGGESTION_MAX_LIST_ITEMS),
    ...workflowSuggestionWarnings(workflow),
  ])]
  return {
    ok: record.ok === true && errors.length === 0,
    errors,
    warnings,
    definition: workflow,
  }
}

function workflowSuggestionWarnings(workflow: WorkflowDefinitionRecord): string[] {
  return JSON.stringify(workflow).includes('[redacted]') ? ['sensitive text was redacted.'] : []
}

function appendWorkflowSuggestionValidationError(
  validation: WorkflowDefinitionValidationResult,
  error: string,
): WorkflowDefinitionValidationResult {
  return {
    ...validation,
    ok: false,
    errors: [...new Set([...validation.errors, error])],
  }
}

function isMatchingWorkflowSuggestionSkill(value: unknown, workflow: WorkflowDefinitionRecord): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const tags = sanitizeWorkflowSuggestionStringList(record.tags, 50)
  return record.schema === 'islemind.skill.v1' &&
    record.id === `skill-${workflow.id}` &&
    tags.includes('agent-workflow') &&
    tags.includes(`workflow:${workflow.id}`)
}

function buildSanitizedWorkflowSuggestionSkill(
  workflow: WorkflowDefinitionRecord,
  value: unknown,
): SkillDefinition | undefined {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const createdAt = typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
    ? record.createdAt
    : workflow.createdAt
  const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
    ? record.updatedAt
    : workflow.updatedAt
  const skill: SkillDefinition = {
    schema: 'islemind.skill.v1',
    id: `skill-${workflow.id}`,
    name: workflow.name,
    layer: 'advanced',
    version: '1.0.0',
    description: workflow.description ?? `Agentic workflow: ${workflow.name}`,
    tags: buildWorkflowSuggestionSkillTags(workflow),
    priority: typeof record.priority === 'number' && Number.isFinite(record.priority) ? record.priority : 50,
    systemPrompt: buildWorkflowSuggestionSkillPrompt(workflow),
    enabledTools: collectWorkflowSuggestionToolRefs(workflow),
    expectedReplyFormat: workflow.expectedOutput
      ? `agent-workflow-output:${workflow.expectedOutput}`
      : 'agent-workflow-output:reply',
    stackPolicy: 'append',
    createdAt,
    updatedAt,
  }
  const serialized = safeSuggestionStringify(skill)
  return serialized && serialized.length > WORKFLOW_SUGGESTION_PAYLOAD_LIMIT ? undefined : skill
}

function buildWorkflowSuggestionSkillTags(workflow: WorkflowDefinitionRecord): string[] {
  return [
    'agent-workflow',
    `workflow:${workflow.id}`,
    workflow.enabled ? 'workflow-status:enabled' : 'workflow-status:disabled',
    `permission:${workflow.permissionCeiling}`,
    workflow.expectedOutput ? `output:${workflow.expectedOutput}` : 'output:reply',
    ...workflow.triggerHints.map((hint) => `trigger:${hint}`).slice(0, 5),
  ].map((tag) => tag.slice(0, 80))
}

function buildWorkflowSuggestionSkillPrompt(workflow: WorkflowDefinitionRecord): string {
  const stepLines = workflow.steps.map((step, index) => {
    const tool = formatWorkflowSuggestionToolRequest(step.toolRequest)
    const acceptance = step.acceptance?.length ? ` Acceptance: ${step.acceptance.join('; ')}.` : ''
    return `${index + 1}. ${step.title}${tool ? ` Tool: ${tool}.` : ''}${acceptance}`
  })

  return [
    `Agentic workflow: ${workflow.name}`,
    workflow.description ? `Description: ${workflow.description}` : '',
    `Permission ceiling: ${workflow.permissionCeiling}.`,
    `Expected output: ${workflow.expectedOutput ?? 'reply'}.`,
    'Execution policy: run only when the user selects, enables, or explicitly asks for this workflow. Do not create, modify, enable, or save workflows silently. Respect visible permission gates and preserve trace evidence.',
    'Steps:',
    ...stepLines,
    workflow.acceptanceChecks.length ? `Acceptance checks: ${workflow.acceptanceChecks.join('; ')}` : '',
    'Workflow definition:',
    workflowDefinitionPolicy.serialize(workflow),
  ].filter(Boolean).join('\n')
}

function collectWorkflowSuggestionToolRefs(workflow: WorkflowDefinitionRecord): string[] {
  const refs = workflow.steps
    .map((step) => formatWorkflowSuggestionToolRequest(step.toolRequest))
    .filter(Boolean)
  return [...new Set(refs)]
}

function formatWorkflowSuggestionToolRequest(request?: WorkflowDefinitionToolRequest): string {
  return formatToolRequestIdentity(request)
}

function sanitizeWorkflowSuggestionStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => typeof item === 'string'
      ? clampTraceText(redactSensitiveText(item).trim(), WORKFLOW_SUGGESTION_TEXT_LIMIT).trim()
      : '')
    .filter(Boolean)
    .slice(0, limit)
}

function workflowSuggestionUnsafeReason(workflow: WorkflowDefinitionRecord): string | undefined {
  if (workflow.steps.some((step) => workflowToolIdentityNeedsReview(step.toolRequest))) {
    return 'workflow tool identity contains sensitive or truncated text.'
  }
  const text = [
    workflow.name,
    workflow.description ?? '',
    ...workflow.triggerHints,
    ...workflow.acceptanceChecks,
    ...workflow.steps.map((step) => step.title),
    ...workflow.steps.map((step) => formatWorkflowSuggestionToolRequest(step.toolRequest)),
    ...workflow.steps.map((step) => safeSuggestionStringify(step.toolRequest?.arguments ?? {}) ?? ''),
  ].join(' ')
  return text.includes(BLOCKED_WORKFLOW_ARGUMENT_EXECUTION_RISK) ||
    /\b(shell|terminal|powershell|cmd\.exe|bash|exec|spawn|eval|adb shell)\b/i.test(text) ||
    /彻底删除|永久删除|执行代码|运行命令|系统控制/.test(text)
    ? 'workflow definition contains arbitrary execution risk.'
    : undefined
}

function workflowToolIdentityNeedsReview(request?: WorkflowDefinitionToolRequest): boolean {
  if (!request) return false
  return [request.toolId, request.name, request.serverId].some((value) => (
    typeof value === 'string' && (value.includes('[redacted]') || value.includes('[output truncated]'))
  ))
}

function isWorkflowSkillSuggestionTrace(trace: ProcessTrace): boolean {
  if (trace.type !== 'reasoning' && trace.type !== 'system') return false
  return trace.title === 'Agent workflow' ||
    trace.title === 'Agent synthesis' ||
    trace.title === 'Agent workflow skill'
}
