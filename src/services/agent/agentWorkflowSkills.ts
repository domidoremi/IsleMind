import type { SkillDefinition, SkillSnapshot } from '@/types'
import { listSkills, upsertSkill } from '@/services/skills'
import type {
  AgentToolManifest,
  AgentToolPermission,
  AgentToolRequest,
  AgentWorkflowRun,
  AgentWorkflowDefinition,
  AgentWorkflowDefinitionValidation,
  AgentWorkflowIntent,
} from '@/services/agent/agentToolTypes'
import { createAgentWorkflowDefinition, exportAgentWorkflowDefinition, sanitizeAgentWorkflowDefinition, validateAgentWorkflowDefinition } from '@/services/agent/agentWorkflowDefinitions'
import { clampAgentOutput, redactSensitiveText } from '@/services/agent/agentTrace'

export interface AgentWorkflowSkillSuggestion {
  ok: boolean
  requiresUserApproval: true
  workflow: AgentWorkflowDefinition
  validation: AgentWorkflowDefinitionValidation
  skill?: SkillDefinition
  approvalSummary: string
}

export interface AgentWorkflowSkillSavePreview {
  workflowId: string
  name: string
  enabled: boolean
  permissionCeiling: AgentToolPermission
  expectedOutput: NonNullable<AgentWorkflowDefinition['expectedOutput']> | 'reply'
  stepCount: number
  requiredTools: string[]
  ragProfileRequirements: string[]
  acceptanceChecks: string[]
  errorCount: number
  warningCount: number
  approvalSummary: string
}

export interface AgentWorkflowSkillSelection {
  workflow: AgentWorkflowDefinition
  validation: AgentWorkflowDefinitionValidation
  reason: 'single-selected' | 'matched-trigger'
  availableCount: number
}

export type AgentWorkflowRuntimeBlockReason = 'workflow-disabled' | 'workflow-review-required' | 'workflow-invalid'

export interface AgentWorkflowRuntimeBlockState {
  workflowId: string
  reason: AgentWorkflowRuntimeBlockReason
}

export interface SelectAgentWorkflowDefinitionOptions {
  enabledWorkflowIds?: Iterable<string>
}

export interface CreateAgentWorkflowSkillSuggestionInput {
  workflow: AgentWorkflowDefinition
  manifests: AgentToolManifest[]
  priority?: number
  now?: number
}

export interface CreateAgentWorkflowSkillSuggestionFromRunInput {
  run: AgentWorkflowRun
  manifests: AgentToolManifest[]
  priority?: number
  now?: number
}

export interface AgentWorkflowSkillApproval {
  approved: boolean
  approvedBy?: string
  approvedAt?: number
  visibleSummary?: string
}

export interface SaveAgentWorkflowSkillSuggestionInput {
  suggestion: AgentWorkflowSkillSuggestion
  approval?: AgentWorkflowSkillApproval
  now?: number
}

export interface SaveAgentWorkflowSkillSuggestionResult {
  ok: boolean
  status: 'saved' | 'already_saved' | 'blocked'
  requiresUserApproval: true
  skill?: SkillDefinition
  reason?: 'approval_required' | 'invalid_workflow' | 'missing_skill' | 'payload_too_large' | 'skill_id_conflict'
  approvalSummary: string
}

export type AgentWorkflowSkillState = 'enabled' | 'disabled'

export interface SaveAgentWorkflowSkillStateInput {
  skill: SkillDefinition
  state: AgentWorkflowSkillState
  approval?: AgentWorkflowSkillApproval
  manifests?: AgentToolManifest[]
  now?: number
}

export interface SaveAgentWorkflowSkillStateResult {
  ok: boolean
  status: 'saved' | 'blocked'
  requiresUserApproval: true
  skill?: SkillDefinition
  reason?: 'approval_required' | 'not_agent_workflow' | 'missing_skill' | 'invalid_workflow'
}

export interface ListAgentWorkflowSkillsOptions {
  includeDisabled?: boolean
}

const AGENT_WORKFLOW_SKILL_PAYLOAD_CHAR_LIMIT = 24000
const WORKFLOW_DEFINITION_MARKER = 'Workflow definition:'
const WORKFLOW_RAG_PROFILE_REQUIREMENT_LIMIT = 180
const WORKFLOW_SKILL_PROMPT_TEXT_LIMIT = 360
const WORKFLOW_SKILL_PROMPT_LIST_ITEM_LIMIT = 180
const WORKFLOW_SKILL_PREVIEW_TEXT_LIMIT = 180
const WORKFLOW_SKILL_PREVIEW_LIST_ITEM_LIMIT = 140
const WORKFLOW_APPROVAL_SUMMARY_LINE_LIMIT = 360
const WORKFLOW_APPROVAL_DESCRIPTION_TEXT_LIMIT = 720
const RAG_CONTEXT_PACK_TOOL_ID = 'rag:context_pack'
const RAG_CONTEXT_PACK_TOOL_NAME = 'rag.context_pack'
const RAG_PROFILE_VALUES = new Set(['fast', 'balanced', 'deep', 'offline'])

interface NormalizedWorkflowSkillSuggestionForSave {
  workflow: AgentWorkflowDefinition
  skill: SkillDefinition
  approvalSummary: string
}

function isAgentWorkflowControlTag(tag: string): boolean {
  return tag === 'agent-workflow' ||
    tag.startsWith('workflow:') ||
    tag.startsWith('workflow-status:') ||
    tag.startsWith('workflow-import:') ||
    tag.startsWith('approval:') ||
    tag.startsWith('approved-by:') ||
    tag.startsWith('approved-at:')
}

export function createAgentWorkflowSkillSuggestion(input: CreateAgentWorkflowSkillSuggestionInput): AgentWorkflowSkillSuggestion {
  const validation = validateAgentWorkflowDefinition(input.workflow, input.manifests)
  const workflow = validation.sanitized ?? input.workflow
  const approvalSummary = buildAgentWorkflowApprovalSummary(workflow, validation)
  if (!validation.ok) {
    return {
      ok: false,
      requiresUserApproval: true,
      workflow,
      validation,
      approvalSummary,
    }
  }

  const now = input.now ?? Date.now()
  return {
    ok: true,
    requiresUserApproval: true,
    workflow,
    validation,
    skill: buildWorkflowSkillDefinition({
      workflow,
      priority: input.priority,
      createdAt: now,
      updatedAt: now,
    }),
    approvalSummary,
  }
}

export function buildAgentWorkflowSkillSavePreview(suggestion: AgentWorkflowSkillSuggestion): AgentWorkflowSkillSavePreview {
  const workflow = suggestion.workflow
  return {
    workflowId: workflow.id,
    name: safeWorkflowPreviewText(workflow.name, WORKFLOW_SKILL_PREVIEW_TEXT_LIMIT) || 'Agent workflow',
    enabled: workflow.enabled,
    permissionCeiling: workflow.permissionCeiling,
    expectedOutput: workflow.expectedOutput ?? 'reply',
    stepCount: workflow.steps.length,
    requiredTools: collectWorkflowToolRefs(workflow),
    ragProfileRequirements: collectWorkflowRagProfileRequirements(workflow),
    acceptanceChecks: safeWorkflowPreviewList(workflow.acceptanceChecks, WORKFLOW_SKILL_PREVIEW_LIST_ITEM_LIMIT),
    errorCount: suggestion.validation.errors.length,
    warningCount: suggestion.validation.warnings.length,
    approvalSummary: safeWorkflowApprovalSummary(suggestion.approvalSummary),
  }
}

export function extractAgentWorkflowDefinitionsFromSkillSnapshot(
  snapshot: Pick<SkillSnapshot, 'systemPrompt'> | undefined
): AgentWorkflowDefinition[] {
  if (!snapshot?.systemPrompt) return []
  return extractJsonObjectsAfterMarker(snapshot.systemPrompt, WORKFLOW_DEFINITION_MARKER)
    .map((value) => parseAgentWorkflowDefinition(value))
    .filter((workflow): workflow is AgentWorkflowDefinition => Boolean(workflow))
}

export function selectAgentWorkflowDefinitionFromSkillSnapshot(
  snapshot: Pick<SkillSnapshot, 'systemPrompt'> | undefined,
  content: string,
  manifests: AgentToolManifest[],
  options: SelectAgentWorkflowDefinitionOptions = {}
): AgentWorkflowSkillSelection | undefined {
  const enabledWorkflowIds = options.enabledWorkflowIds ? new Set(options.enabledWorkflowIds) : undefined
  const workflows = extractAgentWorkflowDefinitionsFromSkillSnapshot(snapshot)
  const valid = workflows
    .map((workflow) => ({ workflow, validation: validateAgentWorkflowDefinition(workflow, manifests) }))
    .filter((item) => item.validation.ok && item.validation.sanitized?.enabled)
    .filter((item) => !enabledWorkflowIds || enabledWorkflowIds.has(item.validation.sanitized!.id))
    .map((item) => ({ workflow: item.validation.sanitized!, validation: item.validation }))

  if (valid.length === 1) {
    return {
      ...valid[0],
      reason: 'single-selected',
      availableCount: valid.length,
    }
  }

  const normalizedContent = normalizeWorkflowMatchText(content)
  const matched = valid.filter(({ workflow }) => workflowMatchesContent(workflow, normalizedContent))
  if (matched.length === 1) {
    return {
      ...matched[0],
      reason: 'matched-trigger',
      availableCount: valid.length,
    }
  }

  return undefined
}

export async function listEnabledAgentWorkflowIdsForSkillSnapshot(
  snapshot: Pick<SkillSnapshot, 'skillIds' | 'systemPrompt'> | undefined
): Promise<string[]> {
  if (!extractAgentWorkflowDefinitionsFromSkillSnapshot(snapshot).length) return []
  const snapshotSkillIds = new Set(snapshot?.skillIds ?? [])
  if (!snapshotSkillIds.size) return []
  const skills = await listSkills()
  return skills
    .filter((skill) => snapshotSkillIds.has(skill.id) && isAgentWorkflowSkillEnabled(skill))
    .map((skill) => extractAgentWorkflowIdFromSkill(skill))
    .filter((workflowId): workflowId is string => Boolean(workflowId))
}

export async function listBlockedAgentWorkflowStatesForSkillSnapshot(
  snapshot: Pick<SkillSnapshot, 'skillIds' | 'systemPrompt'> | undefined,
  manifests: AgentToolManifest[] = []
): Promise<AgentWorkflowRuntimeBlockState[]> {
  const workflows = extractAgentWorkflowDefinitionsFromSkillSnapshot(snapshot)
  const workflowIds = new Set(workflows.map((workflow) => workflow.id))
  if (!workflowIds.size) return []
  const workflowById = new Map(workflows.map((workflow) => [workflow.id, workflow]))
  const snapshotSkillIds = new Set(snapshot?.skillIds ?? [])
  if (!snapshotSkillIds.size) return []
  const skills = await listSkills()
  return skills
    .filter((skill) => snapshotSkillIds.has(skill.id) && isAgentWorkflowSkill(skill))
    .map((skill): AgentWorkflowRuntimeBlockState | undefined => {
      const workflowId = extractAgentWorkflowIdFromSkill(skill)
      if (!workflowId || !workflowIds.has(workflowId)) return undefined
      if (isAgentWorkflowSkillReviewRequired(skill)) {
        return { workflowId, reason: 'workflow-review-required' }
      }
      if (!isAgentWorkflowSkillEnabled(skill)) {
        return { workflowId, reason: 'workflow-disabled' }
      }
      const workflow = workflowById.get(workflowId)
      if (workflow && manifests.length && !validateAgentWorkflowDefinition(workflow, manifests).ok) {
        return { workflowId, reason: 'workflow-invalid' }
      }
      return undefined
    })
    .filter((state): state is AgentWorkflowRuntimeBlockState => Boolean(state))
}

export function createAgentWorkflowSkillSuggestionFromRun(input: CreateAgentWorkflowSkillSuggestionFromRunInput): AgentWorkflowSkillSuggestion | undefined {
  const { run, manifests } = input
  if (run.status !== 'done') return undefined
  const reusableSteps = run.steps
    .filter((step) => step.status === 'done' && step.toolRequest)
    .map((step, index) => ({
      id: `step-${index + 1}`,
      title: redactSensitiveText(step.title || `Step ${index + 1}`),
      toolRequest: sanitizeWorkflowToolRequest(step.toolRequest, step.observation),
      acceptance: [
        `tool status: ${step.observation?.status ?? step.status}`,
        'user reviews or fills runtime arguments before execution',
      ],
    }))
  if (!reusableSteps.length) return undefined

  const toolRefs = reusableSteps.map((step) => formatToolRequest(step.toolRequest)).filter(Boolean)
  const now = input.now ?? Date.now()
  const workflow = createAgentWorkflowDefinition({
    id: `agent-workflow-${hashString(`${run.intent ?? 'workflow'}:${toolRefs.join('|')}:${run.goal}`).toString(36)}`,
    name: buildWorkflowNameFromRun(run),
    description: buildWorkflowDescriptionFromRun(run),
    enabled: true,
    triggerHints: buildWorkflowTriggerHints(run),
    steps: reusableSteps,
    permissionCeiling: resolvePermissionCeiling(reusableSteps.map((step) => step.toolRequest), manifests),
    expectedOutput: expectedOutputForIntent(run.intent),
    acceptanceChecks: [
      'records trace evidence',
      'requires visible user approval before saving',
      'does not persist run-specific tool arguments',
    ],
    now,
  })
  return createAgentWorkflowSkillSuggestion({
    workflow,
    manifests,
    priority: input.priority,
    now,
  })
}

export async function saveApprovedAgentWorkflowSkillSuggestion(
  input: SaveAgentWorkflowSkillSuggestionInput
): Promise<SaveAgentWorkflowSkillSuggestionResult> {
  const { suggestion } = input
  if (!input.approval?.approved) {
    return buildBlockedSaveResult(suggestion, 'approval_required')
  }
  if (!suggestion.ok) {
    return buildBlockedSaveResult(suggestion, 'invalid_workflow')
  }
  if (!suggestion.skill) {
    return buildBlockedSaveResult(suggestion, 'missing_skill')
  }
  const normalized = normalizeWorkflowSkillSuggestionForSave(suggestion)
  if (!normalized) {
    return buildBlockedSaveResult(suggestion, 'invalid_workflow')
  }

  const now = input.now ?? Date.now()
  const approvedSkill: SkillDefinition = {
    ...normalized.skill,
    tags: buildApprovedWorkflowSkillTags(normalized.skill, input.approval),
    description: buildApprovedWorkflowSkillDescription(normalized.skill, input.approval),
    updatedAt: now,
  }
  const existingSkill = await findExistingWorkflowSkill(approvedSkill.id)
  if (existingSkill) {
    if (isSameAgentWorkflowSkill(existingSkill, normalized.workflow.id)) {
      return {
        ok: true,
        status: 'already_saved',
        requiresUserApproval: true,
        skill: existingSkill,
        approvalSummary: normalized.approvalSummary,
      }
    }
    return buildBlockedSaveResult(suggestion, 'skill_id_conflict')
  }
  if (JSON.stringify(approvedSkill).length > AGENT_WORKFLOW_SKILL_PAYLOAD_CHAR_LIMIT) {
    return buildBlockedSaveResult(suggestion, 'payload_too_large')
  }
  const saved = await upsertSkill(approvedSkill)
  return {
    ok: true,
    status: 'saved',
    requiresUserApproval: true,
    skill: saved,
    approvalSummary: normalized.approvalSummary,
  }
}

export function getAgentWorkflowSkillState(skill: Pick<SkillDefinition, 'tags'>): AgentWorkflowSkillState {
  return skill.tags.includes('workflow-status:disabled') ? 'disabled' : 'enabled'
}

export function isAgentWorkflowImportReviewRequired(skill: Pick<SkillDefinition, 'tags'>): boolean {
  return isAgentWorkflowSkill(skill) && skill.tags.includes('workflow-import:review-required')
}

export function isAgentWorkflowSkill(skill: Pick<SkillDefinition, 'tags'>): boolean {
  return skill.tags.includes('agent-workflow')
}

export function isAgentWorkflowSkillLocallyApproved(skill: Pick<SkillDefinition, 'tags'>): boolean {
  return isAgentWorkflowSkill(skill) && skill.tags.includes('approval:user-visible')
}

export function isAgentWorkflowSkillReviewRequired(skill: Pick<SkillDefinition, 'tags'>): boolean {
  return isAgentWorkflowSkill(skill) && (
    isAgentWorkflowImportReviewRequired(skill) ||
    !isAgentWorkflowSkillLocallyApproved(skill)
  )
}

export function isAgentWorkflowSkillEnabled(skill: Pick<SkillDefinition, 'tags'>): boolean {
  return isAgentWorkflowSkill(skill) && getAgentWorkflowSkillState(skill) === 'enabled' && !isAgentWorkflowSkillReviewRequired(skill)
}

export function isSkillSelectableWithAgentWorkflowState(skill: Pick<SkillDefinition, 'tags'>): boolean {
  return !isAgentWorkflowSkill(skill) || isAgentWorkflowSkillEnabled(skill)
}

export function extractAgentWorkflowIdFromSkill(skill: Pick<SkillDefinition, 'tags' | 'id'>): string | undefined {
  return skill.tags.find((tag) => tag.startsWith('workflow:'))?.slice('workflow:'.length)
    ?? (skill.id.startsWith('skill-agent-workflow-') ? skill.id.slice('skill-'.length) : undefined)
}

export function buildAgentWorkflowSkillStateUpdate(
  skill: SkillDefinition,
  state: AgentWorkflowSkillState,
  now = Date.now(),
  approval?: AgentWorkflowSkillApproval
): SkillDefinition {
  const tags = approval?.approved
    ? buildApprovedWorkflowSkillTags({ ...skill, tags: replaceWorkflowStateTags(skill.tags, state) }, approval)
    : replaceWorkflowStateTags(skill.tags, state)
  return {
    ...skill,
    tags,
    description: approval?.approved
      ? buildApprovedWorkflowSkillDescription(skill, approval)
      : skill.description,
    updatedAt: now,
  }
}

export function mergeAgentWorkflowSkillEditTags(
  existingSkill: Pick<SkillDefinition, 'tags'> | undefined,
  requestedTags: string[] | undefined
): string[] | undefined {
  const requested = [...new Set((requestedTags ?? []).map((tag) => tag.trim()).filter(Boolean))]
  const editableTags = requested.filter((tag) => !isAgentWorkflowControlTag(tag))
  if (!existingSkill || !isAgentWorkflowSkill(existingSkill)) {
    return editableTags.length ? editableTags : undefined
  }
  const preservedControlTags = existingSkill.tags.filter(isAgentWorkflowControlTag)
  return [...new Set([...editableTags, ...preservedControlTags])].map((tag) => tag.slice(0, 80))
}

export function buildAgentWorkflowSkillReviewRequiredEdit(
  existingSkill: SkillDefinition | undefined,
  editedSkill: SkillDefinition
): SkillDefinition {
  if (!existingSkill || !isAgentWorkflowSkill(existingSkill)) return editedSkill
  if (!hasAgentWorkflowDefinitionEdit(existingSkill, editedSkill)) return editedSkill
  return {
    ...editedSkill,
    tags: markAgentWorkflowSkillReviewRequired(editedSkill.tags),
    description: buildWorkflowReviewRequiredDescription(editedSkill.description),
  }
}

export async function listAgentWorkflowSkills(options: ListAgentWorkflowSkillsOptions = {}): Promise<SkillDefinition[]> {
  const skills = await listSkills()
  return skills.filter((skill) => {
    if (!isAgentWorkflowSkill(skill)) return false
    if (options.includeDisabled) return true
    return isAgentWorkflowSkillEnabled(skill)
  })
}

export async function saveApprovedAgentWorkflowSkillState(
  input: SaveAgentWorkflowSkillStateInput
): Promise<SaveAgentWorkflowSkillStateResult> {
  if (!input.approval?.approved) {
    return buildBlockedStateResult('approval_required')
  }
  if (!isAgentWorkflowSkill(input.skill)) {
    return buildBlockedStateResult('not_agent_workflow')
  }
  const existingSkill = await findExistingWorkflowSkill(input.skill.id)
  if (!existingSkill || !isSameAgentWorkflowSkill(existingSkill, extractAgentWorkflowIdFromSkill(input.skill) ?? '')) {
    return buildBlockedStateResult('missing_skill')
  }
  if (input.state === 'enabled' && !validateAgentWorkflowSkillEnableRequest(existingSkill, input.manifests ?? []).ok) {
    return buildBlockedStateResult('invalid_workflow')
  }
  const now = input.now ?? Date.now()
  const approval: AgentWorkflowSkillApproval = {
    ...input.approval,
    approvedAt: input.approval.approvedAt ?? now,
  }
  const skill = buildAgentWorkflowSkillStateUpdate(existingSkill, input.state, now, approval)
  const saved = await upsertSkill(skill)
  return {
    ok: true,
    status: 'saved',
    requiresUserApproval: true,
    skill: saved,
  }
}

export function buildAgentWorkflowApprovalSummary(
  workflow: AgentWorkflowDefinition,
  validation: Pick<AgentWorkflowDefinitionValidation, 'ok' | 'errors' | 'warnings'>
): string {
  const ragProfileRequirements = collectWorkflowRagProfileRequirements(workflow)
  const requiredTools = collectWorkflowToolRefs(workflow)
  const lines = [
    `Workflow: ${safeWorkflowPreviewText(workflow.name, WORKFLOW_SKILL_PREVIEW_TEXT_LIMIT) || 'Agent workflow'}`,
    `Enabled by default: ${workflow.enabled ? 'yes' : 'no'}`,
    `Permission ceiling: ${workflow.permissionCeiling}`,
    `Expected output: ${workflow.expectedOutput ?? 'reply'}`,
    `Steps: ${workflow.steps.length}`,
    `Required tools: ${requiredTools.join(', ') || 'none'}`,
    ragProfileRequirements.length ? `RAG profile requirements: ${ragProfileRequirements.join('; ')}` : '',
    workflow.acceptanceChecks.length ? `Acceptance checks: ${safeWorkflowPreviewList(workflow.acceptanceChecks, WORKFLOW_SKILL_PREVIEW_LIST_ITEM_LIMIT).join('; ')}` : '',
    validation.errors.length ? `Errors: ${safeWorkflowPreviewList(validation.errors, WORKFLOW_SKILL_PREVIEW_LIST_ITEM_LIMIT).join('; ')}` : '',
    validation.warnings.length ? `Warnings: ${safeWorkflowPreviewList(validation.warnings, WORKFLOW_SKILL_PREVIEW_LIST_ITEM_LIMIT).join('; ')}` : '',
  ].filter(Boolean)
  return safeWorkflowApprovalSummary(lines.join('\n'))
}

function buildWorkflowSkillTags(workflow: AgentWorkflowDefinition): string[] {
  return [
    'agent-workflow',
    `workflow:${workflow.id}`,
    workflow.enabled ? 'workflow-status:enabled' : 'workflow-status:disabled',
    `permission:${workflow.permissionCeiling}`,
    workflow.expectedOutput ? `output:${workflow.expectedOutput}` : 'output:reply',
    ...workflow.triggerHints.map((hint) => `trigger:${hint}`).slice(0, 5),
  ].map((tag) => tag.slice(0, 80))
}

function buildWorkflowSkillDefinition(input: {
  workflow: AgentWorkflowDefinition
  priority?: number
  createdAt?: number
  updatedAt?: number
}): SkillDefinition {
  const { workflow } = input
  const createdAt = isFiniteNumber(input.createdAt) ? input.createdAt : workflow.createdAt
  const updatedAt = isFiniteNumber(input.updatedAt) ? input.updatedAt : workflow.updatedAt
  return {
    schema: 'islemind.skill.v1',
    id: `skill-${workflow.id}`,
    name: workflow.name,
    layer: 'advanced',
    version: '1.0.0',
    description: workflow.description ?? `Agentic workflow: ${workflow.name}`,
    tags: buildWorkflowSkillTags(workflow),
    priority: isFiniteNumber(input.priority) ? input.priority : 50,
    systemPrompt: buildWorkflowSkillPrompt(workflow),
    enabledTools: collectWorkflowToolRefs(workflow),
    expectedReplyFormat: workflow.expectedOutput ? `agent-workflow-output:${workflow.expectedOutput}` : 'agent-workflow-output:reply',
    stackPolicy: 'append',
    createdAt,
    updatedAt,
  }
}

function buildApprovedWorkflowSkillTags(skill: SkillDefinition, approval: AgentWorkflowSkillApproval): string[] {
  const tags = [
    ...skill.tags.filter((tag) => (
      tag !== 'approval:user-visible' &&
      !tag.startsWith('approved-by:') &&
      !tag.startsWith('approved-at:')
    )),
    'approval:user-visible',
  ]
  const approvedBy = sanitizeWorkflowApprovalTagValue(approval.approvedBy)
  const approvedAt = sanitizeWorkflowApprovalTimestamp(approval.approvedAt)
  if (approvedBy) tags.push(`approved-by:${approvedBy}`)
  if (approvedAt) tags.push(`approved-at:${approvedAt}`)
  return [...new Set(tags.map((tag) => tag.slice(0, 80)))]
}

function sanitizeWorkflowApprovalTagValue(value: string | undefined): string | undefined {
  if (!value) return undefined
  const sanitized = redactSensitiveText(value)
    .trim()
    .toLocaleLowerCase()
    .replace(/[\u0000-\u001f\u007f]+/g, '-')
    .replace(/[^a-z0-9_.@-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/^-+|-+$/g, '')
  return sanitized || undefined
}

function sanitizeWorkflowApprovalTimestamp(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return String(Math.trunc(value)).slice(0, 32)
}

async function findExistingWorkflowSkill(skillId: string): Promise<SkillDefinition | undefined> {
  const skills = await listSkills()
  return skills.find((skill) => skill.id === skillId)
}

function isSameAgentWorkflowSkill(skill: SkillDefinition, workflowId: string): boolean {
  return isAgentWorkflowSkill(skill) && extractAgentWorkflowIdFromSkill(skill) === workflowId
}

function validateAgentWorkflowSkillEnableRequest(
  skill: SkillDefinition,
  manifests: AgentToolManifest[]
): AgentWorkflowDefinitionValidation {
  const workflowId = extractAgentWorkflowIdFromSkill(skill)
  const workflow = workflowId
    ? extractAgentWorkflowDefinitionsFromSkillSnapshot(skill).find((item) => item.id === workflowId)
    : undefined
  if (!workflow) {
    return {
      ok: false,
      errors: ['workflow definition is missing.'],
      warnings: [],
    }
  }
  return validateAgentWorkflowDefinition(workflow, manifests)
}

function normalizeWorkflowSkillSuggestionForSave(
  suggestion: AgentWorkflowSkillSuggestion
): NormalizedWorkflowSkillSuggestionForSave | undefined {
  if (!suggestion.validation.ok || !suggestion.validation.sanitized || !suggestion.skill) return undefined
  const workflow = sanitizeWorkflowDefinitionForSave(suggestion.workflow)
  const validationWorkflow = sanitizeWorkflowDefinitionForSave(suggestion.validation.sanitized)
  if (!workflow || !validationWorkflow || !sameWorkflowDefinition(workflow, validationWorkflow)) return undefined
  if (!isWorkflowSuggestionSkillBoundToDefinition(suggestion.skill, workflow)) return undefined
  return {
    workflow,
    skill: buildWorkflowSkillDefinition({
      workflow,
      priority: suggestion.skill.priority,
      createdAt: suggestion.skill.createdAt,
      updatedAt: suggestion.skill.updatedAt,
    }),
    approvalSummary: buildAgentWorkflowApprovalSummary(workflow, suggestion.validation),
  }
}

function sanitizeWorkflowDefinitionForSave(value: AgentWorkflowDefinition | undefined): AgentWorkflowDefinition | undefined {
  if (!value || typeof value !== 'object') return undefined
  try {
    return sanitizeAgentWorkflowDefinition(value)
  } catch {
    return undefined
  }
}

function sameWorkflowDefinition(left: AgentWorkflowDefinition, right: AgentWorkflowDefinition): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isWorkflowSuggestionSkillBoundToDefinition(skill: SkillDefinition, workflow: AgentWorkflowDefinition): boolean {
  return (
    skill.schema === 'islemind.skill.v1' &&
    skill.id === `skill-${workflow.id}` &&
    skill.name === workflow.name &&
    skill.layer === 'advanced' &&
    skill.version === '1.0.0' &&
    skill.description === (workflow.description ?? `Agentic workflow: ${workflow.name}`) &&
    skill.stackPolicy === 'append' &&
    Number.isFinite(skill.priority) &&
    Number.isFinite(skill.createdAt) &&
    Number.isFinite(skill.updatedAt) &&
    skill.systemPrompt === buildWorkflowSkillPrompt(workflow) &&
    skill.expectedReplyFormat === (workflow.expectedOutput ? `agent-workflow-output:${workflow.expectedOutput}` : 'agent-workflow-output:reply') &&
    sameStringList(skill.tags, buildWorkflowSkillTags(workflow)) &&
    sameStringList(skill.enabledTools ?? [], collectWorkflowToolRefs(workflow))
  )
}

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function extractJsonObjectsAfterMarker(input: string, marker: string): unknown[] {
  const values: unknown[] = []
  let searchFrom = 0
  while (searchFrom < input.length) {
    const markerIndex = input.indexOf(marker, searchFrom)
    if (markerIndex < 0) break
    const objectStart = input.indexOf('{', markerIndex + marker.length)
    if (objectStart < 0) break
    const objectEnd = findJsonObjectEnd(input, objectStart)
    if (objectEnd < 0) {
      searchFrom = objectStart + 1
      continue
    }
    try {
      values.push(JSON.parse(input.slice(objectStart, objectEnd + 1)))
    } catch {
      // Invalid user-edited workflow definitions are ignored and never executed.
    }
    searchFrom = objectEnd + 1
  }
  return values
}

function findJsonObjectEnd(input: string, objectStart: number): number {
  let depth = 0
  let inString = false
  let escaping = false
  for (let index = objectStart; index < input.length; index += 1) {
    const char = input[index]
    if (inString) {
      if (escaping) {
        escaping = false
      } else if (char === '\\') {
        escaping = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function parseAgentWorkflowDefinition(value: unknown): AgentWorkflowDefinition | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as AgentWorkflowDefinition
  if (record.schema !== 'islemind.agent.workflow.v1') return undefined
  return record
}

function workflowMatchesContent(workflow: AgentWorkflowDefinition, normalizedContent: string): boolean {
  if (!normalizedContent) return false
  const candidates = [
    workflow.name,
    workflow.id,
    ...workflow.triggerHints,
  ].map(normalizeWorkflowMatchText).filter((value) => value.length >= 2)
  return candidates.some((candidate) => normalizedContent.includes(candidate))
}

function normalizeWorkflowMatchText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

function replaceWorkflowStateTags(tags: string[], state: AgentWorkflowSkillState): string[] {
  return [
    ...tags.filter((tag) => (
      !tag.startsWith('workflow-status:') &&
      (state !== 'enabled' || tag !== 'workflow-import:review-required')
    )),
    `workflow-status:${state}`,
  ]
}

function markAgentWorkflowSkillReviewRequired(tags: string[]): string[] {
  const normalized = tags.filter((tag) => (
    tag !== 'approval:user-visible' &&
    !tag.startsWith('approved-by:') &&
    !tag.startsWith('approved-at:') &&
    tag !== 'workflow-import:review-required' &&
    tag !== 'workflow-status:enabled' &&
    tag !== 'workflow-status:disabled'
  ))
  return [...new Set([...normalized, 'workflow-status:disabled', 'workflow-import:review-required'])].map((tag) => tag.slice(0, 80))
}

function hasAgentWorkflowDefinitionEdit(existingSkill: SkillDefinition, editedSkill: SkillDefinition): boolean {
  return (
    existingSkill.name !== editedSkill.name ||
    existingSkill.layer !== editedSkill.layer ||
    existingSkill.priority !== editedSkill.priority ||
    existingSkill.description !== editedSkill.description ||
    existingSkill.systemPrompt !== editedSkill.systemPrompt ||
    existingSkill.providerId !== editedSkill.providerId ||
    existingSkill.model !== editedSkill.model ||
    existingSkill.temperature !== editedSkill.temperature ||
    existingSkill.maxTokens !== editedSkill.maxTokens ||
    existingSkill.firstUserMessage !== editedSkill.firstUserMessage ||
    existingSkill.expectedReplyFormat !== editedSkill.expectedReplyFormat ||
    existingSkill.stackPolicy !== editedSkill.stackPolicy ||
    JSON.stringify(existingSkill.variables ?? []) !== JSON.stringify(editedSkill.variables ?? []) ||
    !sameStringList(existingSkill.enabledTools ?? [], editedSkill.enabledTools ?? []) ||
    !sameStringList(existingSkill.knowledgeSources ?? [], editedSkill.knowledgeSources ?? [])
  )
}

function buildWorkflowReviewRequiredDescription(description: string | undefined): string | undefined {
  const base = description
    ? stripWorkflowReviewRequiredDescription(stripWorkflowApprovalDescription(description))
    : ''
  const suffix = 'Workflow edit requires local review before re-enabling.'
  return base ? `${base}\n${suffix}` : suffix
}

function stripWorkflowReviewRequiredDescription(value: string): string {
  return value.split('\n')
    .filter((line) => line.trim() !== 'Workflow edit requires local review before re-enabling.')
    .join('\n')
    .trim()
}

function buildApprovedWorkflowSkillDescription(
  skill: SkillDefinition,
  approval: AgentWorkflowSkillApproval
): string | undefined {
  const summary = safeWorkflowApprovalDescriptionText(approval.visibleSummary ?? '')
  const base = skill.description
    ? safeWorkflowApprovalDescriptionText(stripWorkflowApprovalDescription(skill.description))
    : ''
  if (!summary) return base || undefined
  const suffix = `Approval: ${summary}`
  return base ? `${base}\n${suffix}` : suffix
}

function stripWorkflowApprovalDescription(value: string): string {
  return value.split('\n')
    .filter((line) => !line.trimStart().startsWith('Approval:'))
    .join('\n')
    .trim()
}

function buildWorkflowSkillPrompt(workflow: AgentWorkflowDefinition): string {
  const ragProfileRequirements = collectWorkflowRagProfileRequirements(workflow)
  const stepLines = workflow.steps.map((step, index) => {
    const tool = formatToolRequest(step.toolRequest)
    const title = safeWorkflowPromptText(step.title, WORKFLOW_SKILL_PROMPT_TEXT_LIMIT) || `Step ${index + 1}`
    const acceptance = safeWorkflowPromptList(step.acceptance ?? [], WORKFLOW_SKILL_PROMPT_LIST_ITEM_LIMIT)
    const acceptanceLine = acceptance.length ? ` Acceptance: ${acceptance.join('; ')}.` : ''
    return `${index + 1}. ${title}${tool ? ` Tool: ${tool}.` : ''}${acceptanceLine}`
  })
  const workflowName = safeWorkflowPromptText(workflow.name, WORKFLOW_SKILL_PROMPT_TEXT_LIMIT) || 'Agent workflow'
  const description = workflow.description
    ? safeWorkflowPromptText(workflow.description, WORKFLOW_SKILL_PROMPT_TEXT_LIMIT)
    : ''
  const acceptanceChecks = safeWorkflowPromptList(workflow.acceptanceChecks, WORKFLOW_SKILL_PROMPT_LIST_ITEM_LIMIT)

  return [
    `Agentic workflow: ${workflowName}`,
    description ? `Description: ${description}` : '',
    `Permission ceiling: ${workflow.permissionCeiling}.`,
    `Expected output: ${workflow.expectedOutput ?? 'reply'}.`,
    ragProfileRequirements.length ? `RAG profile requirements: ${ragProfileRequirements.join('; ')}.` : '',
    'Execution policy: run only when the user selects, enables, or explicitly asks for this workflow. Do not create, modify, enable, or save workflows silently. Respect visible permission gates and preserve trace evidence.',
    'Steps:',
    ...stepLines,
    acceptanceChecks.length ? `Acceptance checks: ${acceptanceChecks.join('; ')}` : '',
    'Workflow definition:',
    exportAgentWorkflowDefinition(workflow),
  ].filter(Boolean).join('\n')
}

function safeWorkflowPromptText(value: string, limit: number): string {
  return clampAgentOutput(redactSensitiveText(value.replace(/\s+/g, ' ').trim()), limit)
    .replace(/\n\[output truncated\]$/, ' [truncated]')
    .trim()
}

function safeWorkflowPromptList(values: string[], limit: number): string[] {
  return values.map((value) => safeWorkflowPromptText(value, limit)).filter(Boolean)
}

function safeWorkflowPreviewText(value: string, limit: number): string {
  return clampAgentOutput(redactSensitiveText(value.replace(/\s+/g, ' ').trim()), limit)
    .replace(/\n\[output truncated\]$/, ' [truncated]')
    .trim()
}

function safeWorkflowPreviewList(values: string[], limit: number): string[] {
  return values.map((value) => safeWorkflowPreviewText(value, limit)).filter(Boolean)
}

function safeWorkflowApprovalSummary(value: string): string {
  return value.split('\n')
    .map((line) => safeWorkflowPreviewText(line, WORKFLOW_APPROVAL_SUMMARY_LINE_LIMIT))
    .filter(Boolean)
    .join('\n')
}

function safeWorkflowApprovalDescriptionText(value: string): string {
  return safeWorkflowPreviewText(value, WORKFLOW_APPROVAL_DESCRIPTION_TEXT_LIMIT)
}

export function collectWorkflowRagProfileRequirements(workflow: AgentWorkflowDefinition): string[] {
  const requirements = workflow.steps.flatMap((step) => {
    const request = step.toolRequest
    if (!isRagContextPackToolRequest(request)) return []
    const args = request.arguments
    const values: string[] = []
    const profile = typeof args?.profile === 'string' ? args.profile.trim() : ''
    if (RAG_PROFILE_VALUES.has(profile)) {
      values.push(sanitizeWorkflowRagProfileRequirement(`RAG profile: ${profile}`))
    }
    const profileReason = typeof args?.profileReason === 'string'
      ? sanitizeWorkflowRagProfileRequirement(args.profileReason)
      : ''
    if (profileReason) {
      values.push(sanitizeWorkflowRagProfileRequirement(`RAG profile reason: ${profileReason}`))
    }
    return values
  }).filter(Boolean)
  return [...new Set(requirements)]
}

function collectWorkflowToolRefs(workflow: AgentWorkflowDefinition): string[] {
  const refs = workflow.steps
    .map((step) => step.toolRequest)
    .filter((request): request is AgentToolRequest => Boolean(request))
    .map(formatToolRequest)
    .filter(Boolean)
  return [...new Set(refs)]
}

function formatToolRequest(request?: AgentToolRequest): string {
  if (!request) return ''
  if (request.toolId) return request.toolId
  if (request.serverId && request.name) return `${request.serverId}:${request.name}`
  return request.name ?? ''
}

function isRagContextPackToolRequest(request?: AgentToolRequest): request is AgentToolRequest {
  return request?.toolId === RAG_CONTEXT_PACK_TOOL_ID || request?.name === RAG_CONTEXT_PACK_TOOL_NAME
}

function sanitizeWorkflowRagProfileRequirement(value: string): string {
  return clampAgentOutput(redactSensitiveText(value.replace(/\s+/g, ' ').trim()), WORKFLOW_RAG_PROFILE_REQUIREMENT_LIMIT)
    .replace(/\n\[output truncated\]$/, ' [truncated]')
    .trim()
}

function sanitizeWorkflowToolRequest(
  request?: AgentToolRequest,
  observation?: AgentWorkflowRun['steps'][number]['observation']
): AgentToolRequest | undefined {
  if (!request) return undefined
  const safeRequest: AgentToolRequest = {
    toolId: request.toolId,
    name: request.name,
    source: request.source,
    serverId: request.serverId,
  }
  const safeArguments = collectReusableWorkflowToolArguments(request, observation)
  return safeArguments ? { ...safeRequest, arguments: safeArguments } : safeRequest
}

function collectReusableWorkflowToolArguments(
  request: AgentToolRequest,
  observation: AgentWorkflowRun['steps'][number]['observation'] | undefined
): Record<string, unknown> | undefined {
  if (!isRagContextPackToolRequest(request)) return undefined
  const output = parseObservationOutputRecord(observation?.output)
  const profile = readReusableRagProfile(
    request.arguments?.profile,
    observation?.trace.metadata?.profile,
    output?.profile
  )
  const profileReason = readReusableRagProfileReason(
    request.arguments?.profileReason,
    observation?.trace.metadata?.profileReason,
    output?.profileReason
  )
  const args: Record<string, unknown> = {}
  if (profile) args.profile = profile
  if (profileReason) args.profileReason = profileReason
  return Object.keys(args).length ? args : undefined
}

function readReusableRagProfile(...values: unknown[]): string | undefined {
  for (const value of values) {
    const profile = typeof value === 'string' ? value.trim() : ''
    if (RAG_PROFILE_VALUES.has(profile)) return profile
  }
  return undefined
}

function readReusableRagProfileReason(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const safe = sanitizeWorkflowRagProfileRequirement(value)
    if (safe) return safe
  }
  return undefined
}

function parseObservationOutputRecord(output: string | undefined): Record<string, unknown> | undefined {
  if (!output?.trim()) return undefined
  try {
    const parsed = JSON.parse(output)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function buildWorkflowNameFromRun(run: AgentWorkflowRun): string {
  const label = run.intent ? intentLabel(run.intent) : 'Agent workflow'
  const goal = run.goal.trim().replace(/\s+/g, ' ')
  const suffix = goal ? `: ${goal}` : ''
  return clampAgentOutput(redactSensitiveText(`${label}${suffix}`), 72).replace(/\n\[output truncated\]$/, '')
}

function buildWorkflowDescriptionFromRun(run: AgentWorkflowRun): string {
  return [
    'Saved from a visible agent run.',
    'Run-specific tool arguments are not persisted; review the workflow before reuse.',
    `Original goal: ${clampAgentOutput(redactSensitiveText(run.goal.trim()), 360)}`,
    `Steps: ${run.steps.length}`,
  ].join('\n')
}

function buildWorkflowTriggerHints(run: AgentWorkflowRun): string[] {
  const hints = [
    run.intent ?? '',
    ...run.goal.split(/[\s,，。.;；:：!?！？/\\|()[\]{}"'`]+/).map((item) => item.trim()).filter((item) => item.length >= 2),
  ]
  return [...new Set(hints)].slice(0, 6)
}

function expectedOutputForIntent(intent: AgentWorkflowIntent | undefined): AgentWorkflowDefinition['expectedOutput'] {
  switch (intent) {
    case 'work_artifact':
      return 'work-artifact'
    case 'rag_evidence':
      return 'rag-evidence'
    case 'handoff':
      return 'handoff'
    case 'diagnostic':
      return 'diagnostic'
    case 'plain_chat':
    case 'settings_action':
    case 'tool_task':
    case undefined:
      return 'reply'
  }
}

function resolvePermissionCeiling(requests: Array<AgentToolRequest | undefined>, manifests: AgentToolManifest[]): AgentToolPermission {
  return requests
    .map((request) => resolveWorkflowToolManifest(request, manifests)?.permission ?? 'read-only')
    .reduce((highest, permission) => permissionRank(permission) > permissionRank(highest) ? permission : highest, 'read-only' as AgentToolPermission)
}

function resolveWorkflowToolManifest(request: AgentToolRequest | undefined, manifests: AgentToolManifest[]): AgentToolManifest | undefined {
  if (!request) return undefined
  if (request.toolId) return manifests.find((tool) => tool.id === request.toolId)
  if (!request.name) return undefined
  return manifests.find((tool) => {
    if (tool.name !== request.name) return false
    if (request.source && tool.source !== request.source) return false
    if (request.serverId && tool.serverId !== request.serverId) return false
    return true
  })
}

function permissionRank(permission: AgentToolPermission): number {
  if (permission === 'destructive') return 2
  if (permission === 'read-write') return 1
  return 0
}

function intentLabel(intent: AgentWorkflowIntent): string {
  switch (intent) {
    case 'rag_evidence':
      return 'RAG evidence workflow'
    case 'work_artifact':
      return 'Work artifact workflow'
    case 'handoff':
      return 'Handoff workflow'
    case 'diagnostic':
      return 'Diagnostic workflow'
    case 'tool_task':
      return 'Tool workflow'
    case 'settings_action':
      return 'Settings workflow'
    case 'plain_chat':
      return 'Chat workflow'
  }
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash | 0)
}

function buildBlockedSaveResult(
  suggestion: AgentWorkflowSkillSuggestion,
  reason: SaveAgentWorkflowSkillSuggestionResult['reason']
): SaveAgentWorkflowSkillSuggestionResult {
  return {
    ok: false,
    status: 'blocked',
    requiresUserApproval: true,
    reason,
    approvalSummary: suggestion.approvalSummary,
  }
}

function buildBlockedStateResult(reason: SaveAgentWorkflowSkillStateResult['reason']): SaveAgentWorkflowSkillStateResult {
  return {
    ok: false,
    status: 'blocked',
    requiresUserApproval: true,
    reason,
  }
}
