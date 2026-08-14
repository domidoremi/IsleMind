import type { SkillDefinition, SkillSnapshot } from '@/types/skillContracts'
import type {
  WorkflowDefinitionDecodeResult,
  WorkflowDefinitionPermission,
  WorkflowDefinitionPolicy,
  WorkflowDefinitionRecord,
  WorkflowDefinitionToolManifest,
  WorkflowDefinitionToolRequest,
  WorkflowDefinitionValidationResult,
} from './workflowDefinitionPolicy'
import type { WorkflowIntent } from './workflowIntentClassifier'
import type { WorkflowExecutionRun } from './workflowExecutionRunContracts'
import {
  createWorkflowSkillFormattingPolicy,
  type WorkflowSkillFormattingPolicyDependencies,
} from './workflowSkillFormattingPolicy'

export type WorkflowSkillIntent = WorkflowIntent

export type WorkflowSkillSuggestionRun = Pick<
  WorkflowExecutionRun,
  'goal' | 'intent' | 'status' | 'steps'
>

export interface WorkflowSkillSuggestion {
  ok: boolean
  requiresUserApproval: true
  workflow: WorkflowDefinitionRecord
  validation: WorkflowDefinitionValidationResult
  skill?: SkillDefinition
  approvalSummary: string
}

export interface WorkflowSkillSavePreview {
  workflowId: string
  name: string
  enabled: boolean
  permissionCeiling: WorkflowDefinitionPermission
  expectedOutput: NonNullable<WorkflowDefinitionRecord['expectedOutput']> | 'reply'
  stepCount: number
  requiredTools: string[]
  ragProfileRequirements: string[]
  acceptanceChecks: string[]
  errorCount: number
  warningCount: number
  approvalSummary: string
}

export interface WorkflowSkillSelection {
  workflow: WorkflowDefinitionRecord
  validation: WorkflowDefinitionValidationResult
  reason: 'single-selected' | 'matched-trigger'
  availableCount: number
}

export type WorkflowRuntimeBlockReason = 'workflow-disabled' | 'workflow-review-required' | 'workflow-invalid'

export interface WorkflowRuntimeBlockState {
  workflowId: string
  reason: WorkflowRuntimeBlockReason
}

export interface SelectWorkflowDefinitionOptions {
  enabledWorkflowIds?: Iterable<string>
}

export interface CreateWorkflowSkillSuggestionInput {
  workflow: WorkflowDefinitionRecord
  manifests: WorkflowDefinitionToolManifest[]
  priority?: number
  now?: number
}

export interface CreateWorkflowSkillSuggestionFromRunInput {
  run: WorkflowSkillSuggestionRun
  manifests: WorkflowDefinitionToolManifest[]
  priority?: number
  now?: number
}

export interface WorkflowSkillApproval {
  approved: boolean
  approvedBy?: string
  approvedAt?: number
  visibleSummary?: string
}

export interface SaveWorkflowSkillSuggestionInput {
  suggestion: WorkflowSkillSuggestion
  approval?: WorkflowSkillApproval
  now?: number
}

export interface SaveWorkflowSkillSuggestionResult {
  ok: boolean
  status: 'saved' | 'already_saved' | 'blocked'
  requiresUserApproval: true
  skill?: SkillDefinition
  reason?: 'approval_required' | 'invalid_workflow' | 'missing_skill' | 'payload_too_large' | 'skill_id_conflict'
  approvalSummary: string
}

export type WorkflowSkillState = 'enabled' | 'disabled'

export interface SaveWorkflowSkillStateInput {
  skill: SkillDefinition
  state: WorkflowSkillState
  approval?: WorkflowSkillApproval
  manifests?: WorkflowDefinitionToolManifest[]
  now?: number
}

export interface SaveWorkflowSkillStateResult {
  ok: boolean
  status: 'saved' | 'blocked'
  requiresUserApproval: true
  skill?: SkillDefinition
  reason?: 'approval_required' | 'not_agent_workflow' | 'missing_skill' | 'invalid_workflow'
}

export interface ListWorkflowSkillsOptions {
  includeDisabled?: boolean
}

export interface WorkflowSkillPolicyDependencies
  extends WorkflowSkillFormattingPolicyDependencies {
  workflowDefinitionPolicy: WorkflowDefinitionPolicy
  persistence: WorkflowSkillPersistencePort
  now(): number
  redactSensitiveText(value: string): string
  clampWorkflowOutput(value: string, limit: number): string
  formatToolRequestIdentity(request: WorkflowDefinitionToolRequest | undefined): string
  resolveUniqueManifest(
    request: WorkflowDefinitionToolRequest,
    manifests: readonly WorkflowDefinitionToolManifest[],
  ): WorkflowDefinitionToolManifest | null | undefined
}

export interface WorkflowSkillPersistencePort {
  listSkills(): Promise<SkillDefinition[]>
  upsertSkill(skill: SkillDefinition): Promise<SkillDefinition>
}

export interface WorkflowSkillPolicy {
  createWorkflowSkillSuggestion(
    input: CreateWorkflowSkillSuggestionInput,
  ): WorkflowSkillSuggestion
  buildWorkflowSkillSavePreview(
    suggestion: WorkflowSkillSuggestion,
  ): WorkflowSkillSavePreview
  extractWorkflowDefinitionsFromSkillSnapshot(
    snapshot: Pick<SkillSnapshot, 'systemPrompt'> | undefined,
  ): WorkflowDefinitionRecord[]
  hasWorkflowDefinitionCandidatesInSkillSnapshot(
    snapshot: Pick<SkillSnapshot, 'systemPrompt'> | undefined,
  ): boolean
  selectWorkflowDefinitionFromSkillSnapshot(
    snapshot: Pick<SkillSnapshot, 'systemPrompt'> | undefined,
    content: string,
    manifests: WorkflowDefinitionToolManifest[],
    options?: SelectWorkflowDefinitionOptions,
  ): WorkflowSkillSelection | undefined
  listEnabledWorkflowIdsForSkillSnapshot(
    snapshot: Pick<SkillSnapshot, 'skillIds' | 'systemPrompt'> | undefined,
  ): Promise<string[]>
  listBlockedWorkflowStatesForSkillSnapshot(
    snapshot: Pick<SkillSnapshot, 'skillIds' | 'systemPrompt'> | undefined,
    manifests?: WorkflowDefinitionToolManifest[],
  ): Promise<WorkflowRuntimeBlockState[]>
  createWorkflowSkillSuggestionFromRun(
    input: CreateWorkflowSkillSuggestionFromRunInput,
  ): WorkflowSkillSuggestion | undefined
  saveApprovedWorkflowSkillSuggestion(
    input: SaveWorkflowSkillSuggestionInput,
  ): Promise<SaveWorkflowSkillSuggestionResult>
  getWorkflowSkillState(
    skill: Pick<SkillDefinition, 'tags'>,
  ): WorkflowSkillState
  isWorkflowSkillImportReviewRequired(
    skill: Pick<SkillDefinition, 'tags'>,
  ): boolean
  isWorkflowSkill(skill: Pick<SkillDefinition, 'tags'>): boolean
  isWorkflowSkillLocallyApproved(
    skill: Pick<SkillDefinition, 'tags'>,
  ): boolean
  isWorkflowSkillReviewRequired(
    skill: Pick<SkillDefinition, 'tags'>,
  ): boolean
  isWorkflowSkillEnabled(
    skill: Pick<SkillDefinition, 'tags'>,
  ): boolean
  isSkillSelectableWithWorkflowSkillState(
    skill: Pick<SkillDefinition, 'tags'>,
  ): boolean
  extractWorkflowIdFromSkill(
    skill: Pick<SkillDefinition, 'tags' | 'id'>,
  ): string | undefined
  mergeWorkflowSkillEditTags(
    existingSkill: Pick<SkillDefinition, 'tags'> | undefined,
    requestedTags: string[] | undefined,
  ): string[] | undefined
  buildWorkflowSkillReviewRequiredEdit(
    existingSkill: SkillDefinition | undefined,
    editedSkill: SkillDefinition,
  ): SkillDefinition
  listWorkflowSkills(
    options?: ListWorkflowSkillsOptions,
  ): Promise<SkillDefinition[]>
  saveApprovedWorkflowSkillState(
    input: SaveWorkflowSkillStateInput,
  ): Promise<SaveWorkflowSkillStateResult>
  buildWorkflowApprovalSummary(
    workflow: WorkflowDefinitionRecord,
    validation: Pick<WorkflowDefinitionValidationResult, 'ok' | 'errors' | 'warnings'>,
  ): string
  collectWorkflowRagProfileRequirements(
    workflow: WorkflowDefinitionRecord,
  ): string[]
}

const WORKFLOW_SKILL_PAYLOAD_CHAR_LIMIT = 24000
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
  workflow: WorkflowDefinitionRecord
  skill: SkillDefinition
  approvalSummary: string
}

export function createWorkflowSkillPolicy(
  dependencies: WorkflowSkillPolicyDependencies,
): WorkflowSkillPolicy {
  const workflowDefinitionPolicy = dependencies.workflowDefinitionPolicy
  const listSkills = dependencies.persistence.listSkills
  const upsertSkill = dependencies.persistence.upsertSkill
  const redactSensitiveText = dependencies.redactSensitiveText
  const clampWorkflowOutput = dependencies.clampWorkflowOutput
  const formatToolRequestIdentity = dependencies.formatToolRequestIdentity
  const resolveUniqueToolManifest = dependencies.resolveUniqueManifest
  const {
    buildWorkflowApprovalSummary,
    collectWorkflowRagProfileRequirements,
  } = createWorkflowSkillFormattingPolicy(dependencies)

function isWorkflowSkillControlTag(tag: string): boolean {
  return tag === 'agent-workflow' ||
    tag.startsWith('workflow:') ||
    tag.startsWith('workflow-status:') ||
    tag.startsWith('workflow-import:') ||
    tag.startsWith('approval:') ||
    tag.startsWith('approved-by:') ||
    tag.startsWith('approved-at:')
}

function createWorkflowSkillSuggestion(input: CreateWorkflowSkillSuggestionInput): WorkflowSkillSuggestion {
  const validation = workflowDefinitionPolicy.validate(input.workflow, input.manifests)
  const workflow = validation.definition ?? input.workflow
  const approvalSummary = buildWorkflowApprovalSummary(workflow, validation)
  if (!validation.ok) {
    return {
      ok: false,
      requiresUserApproval: true,
      workflow,
      validation,
      approvalSummary,
    }
  }

  const now = input.now ?? dependencies.now()
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

function buildWorkflowSkillSavePreview(suggestion: WorkflowSkillSuggestion): WorkflowSkillSavePreview {
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

function extractWorkflowDefinitionsFromSkillSnapshot(
  snapshot: Pick<SkillSnapshot, 'systemPrompt'> | undefined
): WorkflowDefinitionRecord[] {
  return decodeWorkflowDefinitionsFromSkillSnapshot(snapshot)
    .filter((result): result is Extract<WorkflowDefinitionDecodeResult, { ok: true }> => result.ok)
    .map((result) => result.definition)
}

function hasWorkflowDefinitionCandidatesInSkillSnapshot(
  snapshot: Pick<SkillSnapshot, 'systemPrompt'> | undefined,
): boolean {
  return decodeWorkflowDefinitionsFromSkillSnapshot(snapshot).length > 0
}

function decodeWorkflowDefinitionsFromSkillSnapshot(
  snapshot: Pick<SkillSnapshot, 'systemPrompt'> | undefined,
): WorkflowDefinitionDecodeResult[] {
  if (!snapshot?.systemPrompt) return []
  return extractJsonObjectsAfterMarker(snapshot.systemPrompt, WORKFLOW_DEFINITION_MARKER)
    .map((value) => workflowDefinitionPolicy.decode(value))
}

function selectWorkflowDefinitionFromSkillSnapshot(
  snapshot: Pick<SkillSnapshot, 'systemPrompt'> | undefined,
  content: string,
  manifests: WorkflowDefinitionToolManifest[],
  options: SelectWorkflowDefinitionOptions = {}
): WorkflowSkillSelection | undefined {
  const enabledWorkflowIds = options.enabledWorkflowIds ? new Set(options.enabledWorkflowIds) : undefined
  const workflows = extractWorkflowDefinitionsFromSkillSnapshot(snapshot)
  const valid = workflows
    .map((workflow) => ({ workflow, validation: workflowDefinitionPolicy.validate(workflow, manifests) }))
    .filter((item) => item.validation.ok && item.validation.definition?.enabled)
    .filter((item) => !enabledWorkflowIds || enabledWorkflowIds.has(item.validation.definition!.id))
    .map((item) => ({ workflow: item.validation.definition!, validation: item.validation }))

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

async function listEnabledWorkflowIdsForSkillSnapshot(
  snapshot: Pick<SkillSnapshot, 'skillIds' | 'systemPrompt'> | undefined
): Promise<string[]> {
  if (!extractWorkflowDefinitionsFromSkillSnapshot(snapshot).length) return []
  const snapshotSkillIds = new Set(snapshot?.skillIds ?? [])
  if (!snapshotSkillIds.size) return []
  const skills = await listSkills()
  return skills
    .filter((skill) => snapshotSkillIds.has(skill.id) && isWorkflowSkillEnabled(skill))
    .map((skill) => extractWorkflowIdFromSkill(skill))
    .filter((workflowId): workflowId is string => Boolean(workflowId))
}

async function listBlockedWorkflowStatesForSkillSnapshot(
  snapshot: Pick<SkillSnapshot, 'skillIds' | 'systemPrompt'> | undefined,
  manifests: WorkflowDefinitionToolManifest[] = []
): Promise<WorkflowRuntimeBlockState[]> {
  const decodeResults = decodeWorkflowDefinitionsFromSkillSnapshot(snapshot)
  if (!decodeResults.length) return []
  const workflows = decodeResults
    .filter((result): result is Extract<WorkflowDefinitionDecodeResult, { ok: true }> => result.ok)
    .map((result) => result.definition)
  const workflowById = new Map(workflows.map((workflow) => [workflow.id, workflow]))
  const snapshotSkillIds = new Set(snapshot?.skillIds ?? [])
  if (!snapshotSkillIds.size) return []
  const skills = await listSkills()
  return skills
    .filter((skill) => snapshotSkillIds.has(skill.id) && isWorkflowSkill(skill))
    .map((skill): WorkflowRuntimeBlockState | undefined => {
      const workflowId = extractWorkflowIdFromSkill(skill)
      if (!workflowId) return undefined
      if (isWorkflowSkillReviewRequired(skill)) {
        return { workflowId, reason: 'workflow-review-required' }
      }
      if (!isWorkflowSkillEnabled(skill)) {
        return { workflowId, reason: 'workflow-disabled' }
      }
      const workflow = workflowById.get(workflowId)
      if (!workflow || !workflowDefinitionPolicy.validate(workflow, manifests).ok) {
        return { workflowId, reason: 'workflow-invalid' }
      }
      return undefined
    })
    .filter((state): state is WorkflowRuntimeBlockState => Boolean(state))
}

function createWorkflowSkillSuggestionFromRun(input: CreateWorkflowSkillSuggestionFromRunInput): WorkflowSkillSuggestion | undefined {
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
  const now = input.now ?? dependencies.now()
  const workflow = workflowDefinitionPolicy.create({
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
  return createWorkflowSkillSuggestion({
    workflow,
    manifests,
    priority: input.priority,
    now,
  })
}

async function saveApprovedWorkflowSkillSuggestion(
  input: SaveWorkflowSkillSuggestionInput
): Promise<SaveWorkflowSkillSuggestionResult> {
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

  const now = input.now ?? dependencies.now()
  const approvedSkill: SkillDefinition = {
    ...normalized.skill,
    tags: buildApprovedWorkflowSkillTags(normalized.skill, input.approval),
    description: buildApprovedWorkflowSkillDescription(normalized.skill, input.approval),
    updatedAt: now,
  }
  const existingSkill = await findExistingWorkflowSkill(approvedSkill.id)
  if (existingSkill) {
    if (isSameWorkflowSkill(existingSkill, normalized.workflow.id)) {
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
  if (JSON.stringify(approvedSkill).length > WORKFLOW_SKILL_PAYLOAD_CHAR_LIMIT) {
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

function getWorkflowSkillState(skill: Pick<SkillDefinition, 'tags'>): WorkflowSkillState {
  return skill.tags.includes('workflow-status:disabled') ? 'disabled' : 'enabled'
}

function isWorkflowSkillImportReviewRequired(skill: Pick<SkillDefinition, 'tags'>): boolean {
  return isWorkflowSkill(skill) && skill.tags.includes('workflow-import:review-required')
}

function isWorkflowSkill(skill: Pick<SkillDefinition, 'tags'>): boolean {
  return skill.tags.includes('agent-workflow')
}

function isWorkflowSkillLocallyApproved(skill: Pick<SkillDefinition, 'tags'>): boolean {
  return isWorkflowSkill(skill) && skill.tags.includes('approval:user-visible')
}

function isWorkflowSkillReviewRequired(skill: Pick<SkillDefinition, 'tags'>): boolean {
  return isWorkflowSkill(skill) && (
    isWorkflowSkillImportReviewRequired(skill) ||
    !isWorkflowSkillLocallyApproved(skill)
  )
}

function isWorkflowSkillEnabled(skill: Pick<SkillDefinition, 'tags'>): boolean {
  return isWorkflowSkill(skill) && getWorkflowSkillState(skill) === 'enabled' && !isWorkflowSkillReviewRequired(skill)
}

function isSkillSelectableWithWorkflowSkillState(skill: Pick<SkillDefinition, 'tags'>): boolean {
  return !isWorkflowSkill(skill) || isWorkflowSkillEnabled(skill)
}

function extractWorkflowIdFromSkill(skill: Pick<SkillDefinition, 'tags' | 'id'>): string | undefined {
  return skill.tags.find((tag) => tag.startsWith('workflow:'))?.slice('workflow:'.length)
    ?? (skill.id.startsWith('skill-agent-workflow-') ? skill.id.slice('skill-'.length) : undefined)
}

function buildWorkflowSkillStateUpdate(
  skill: SkillDefinition,
  state: WorkflowSkillState,
  now = dependencies.now(),
  approval?: WorkflowSkillApproval
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

function mergeWorkflowSkillEditTags(
  existingSkill: Pick<SkillDefinition, 'tags'> | undefined,
  requestedTags: string[] | undefined
): string[] | undefined {
  const requested = [...new Set((requestedTags ?? []).map((tag) => tag.trim()).filter(Boolean))]
  const editableTags = requested.filter((tag) => !isWorkflowSkillControlTag(tag))
  if (!existingSkill || !isWorkflowSkill(existingSkill)) {
    return editableTags.length ? editableTags : undefined
  }
  const preservedControlTags = existingSkill.tags.filter(isWorkflowSkillControlTag)
  return [...new Set([...editableTags, ...preservedControlTags])].map((tag) => tag.slice(0, 80))
}

function buildWorkflowSkillReviewRequiredEdit(
  existingSkill: SkillDefinition | undefined,
  editedSkill: SkillDefinition
): SkillDefinition {
  if (!existingSkill || !isWorkflowSkill(existingSkill)) return editedSkill
  if (!hasWorkflowSkillDefinitionEdit(existingSkill, editedSkill)) return editedSkill
  return {
    ...editedSkill,
    tags: markWorkflowSkillReviewRequired(editedSkill.tags),
    description: buildWorkflowReviewRequiredDescription(editedSkill.description),
  }
}

async function listWorkflowSkills(options: ListWorkflowSkillsOptions = {}): Promise<SkillDefinition[]> {
  const skills = await listSkills()
  return skills.filter((skill) => {
    if (!isWorkflowSkill(skill)) return false
    if (options.includeDisabled) return true
    return isWorkflowSkillEnabled(skill)
  })
}

async function saveApprovedWorkflowSkillState(
  input: SaveWorkflowSkillStateInput
): Promise<SaveWorkflowSkillStateResult> {
  if (!input.approval?.approved) {
    return buildBlockedStateResult('approval_required')
  }
  if (!isWorkflowSkill(input.skill)) {
    return buildBlockedStateResult('not_agent_workflow')
  }
  const existingSkill = await findExistingWorkflowSkill(input.skill.id)
  if (!existingSkill || !isSameWorkflowSkill(existingSkill, extractWorkflowIdFromSkill(input.skill) ?? '')) {
    return buildBlockedStateResult('missing_skill')
  }
  if (input.state === 'enabled' && !validateWorkflowSkillEnableRequest(existingSkill, input.manifests ?? []).ok) {
    return buildBlockedStateResult('invalid_workflow')
  }
  const now = input.now ?? dependencies.now()
  const approval: WorkflowSkillApproval = {
    ...input.approval,
    approvedAt: input.approval.approvedAt ?? now,
  }
  const skill = buildWorkflowSkillStateUpdate(existingSkill, input.state, now, approval)
  const saved = await upsertSkill(skill)
  return {
    ok: true,
    status: 'saved',
    requiresUserApproval: true,
    skill: saved,
  }
}

function buildWorkflowSkillTags(workflow: WorkflowDefinitionRecord): string[] {
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
  workflow: WorkflowDefinitionRecord
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

function buildApprovedWorkflowSkillTags(skill: SkillDefinition, approval: WorkflowSkillApproval): string[] {
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

function isSameWorkflowSkill(skill: SkillDefinition, workflowId: string): boolean {
  return isWorkflowSkill(skill) && extractWorkflowIdFromSkill(skill) === workflowId
}

function validateWorkflowSkillEnableRequest(
  skill: SkillDefinition,
  manifests: WorkflowDefinitionToolManifest[]
): WorkflowDefinitionValidationResult {
  const workflowId = extractWorkflowIdFromSkill(skill)
  const workflow = workflowId
    ? extractWorkflowDefinitionsFromSkillSnapshot(skill).find((item) => item.id === workflowId)
    : undefined
  if (!workflow) {
    return {
      ok: false,
      errors: ['workflow definition is missing.'],
      warnings: [],
    }
  }
  return workflowDefinitionPolicy.validate(workflow, manifests)
}

function normalizeWorkflowSkillSuggestionForSave(
  suggestion: WorkflowSkillSuggestion
): NormalizedWorkflowSkillSuggestionForSave | undefined {
  if (!suggestion.validation.ok || !suggestion.validation.definition || !suggestion.skill) return undefined
  const workflow = sanitizeWorkflowDefinitionForSave(suggestion.workflow)
  const validationWorkflow = sanitizeWorkflowDefinitionForSave(suggestion.validation.definition)
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
    approvalSummary: buildWorkflowApprovalSummary(workflow, suggestion.validation),
  }
}

function sanitizeWorkflowDefinitionForSave(value: WorkflowDefinitionRecord | undefined): WorkflowDefinitionRecord | undefined {
  if (!value || typeof value !== 'object') return undefined
  const decoded = workflowDefinitionPolicy.decode(value)
  return decoded.ok ? decoded.definition : undefined
}

function sameWorkflowDefinition(left: WorkflowDefinitionRecord, right: WorkflowDefinitionRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isWorkflowSuggestionSkillBoundToDefinition(skill: SkillDefinition, workflow: WorkflowDefinitionRecord): boolean {
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

function workflowMatchesContent(workflow: WorkflowDefinitionRecord, normalizedContent: string): boolean {
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

function replaceWorkflowStateTags(tags: string[], state: WorkflowSkillState): string[] {
  return [
    ...tags.filter((tag) => (
      !tag.startsWith('workflow-status:') &&
      (state !== 'enabled' || tag !== 'workflow-import:review-required')
    )),
    `workflow-status:${state}`,
  ]
}

function markWorkflowSkillReviewRequired(tags: string[]): string[] {
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

function hasWorkflowSkillDefinitionEdit(existingSkill: SkillDefinition, editedSkill: SkillDefinition): boolean {
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
  approval: WorkflowSkillApproval
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

function buildWorkflowSkillPrompt(workflow: WorkflowDefinitionRecord): string {
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
    workflowDefinitionPolicy.serialize(workflow),
  ].filter(Boolean).join('\n')
}

function safeWorkflowPromptText(value: string, limit: number): string {
  return clampWorkflowOutput(redactSensitiveText(value.replace(/\s+/g, ' ').trim()), limit)
    .replace(/\n\[output truncated\]$/, ' [truncated]')
    .trim()
}

function safeWorkflowPromptList(values: readonly string[], limit: number): string[] {
  return values.map((value) => safeWorkflowPromptText(value, limit)).filter(Boolean)
}

function safeWorkflowPreviewText(value: string, limit: number): string {
  return clampWorkflowOutput(redactSensitiveText(value.replace(/\s+/g, ' ').trim()), limit)
    .replace(/\n\[output truncated\]$/, ' [truncated]')
    .trim()
}

function safeWorkflowPreviewList(values: readonly string[], limit: number): string[] {
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

function collectWorkflowToolRefs(workflow: WorkflowDefinitionRecord): string[] {
  const refs = workflow.steps
    .map((step) => step.toolRequest)
    .filter((request): request is WorkflowDefinitionToolRequest => Boolean(request))
    .map(formatToolRequest)
    .filter(Boolean)
  return [...new Set(refs)]
}

function formatToolRequest(request?: WorkflowDefinitionToolRequest): string {
  return formatToolRequestIdentity(request)
}

function isRagContextPackToolRequest(
  request?: WorkflowDefinitionToolRequest,
): request is WorkflowDefinitionToolRequest {
  return request?.toolId === RAG_CONTEXT_PACK_TOOL_ID || request?.name === RAG_CONTEXT_PACK_TOOL_NAME
}

function sanitizeWorkflowRagProfileRequirement(value: string): string {
  return clampWorkflowOutput(redactSensitiveText(value.replace(/\s+/g, ' ').trim()), WORKFLOW_RAG_PROFILE_REQUIREMENT_LIMIT)
    .replace(/\n\[output truncated\]$/, ' [truncated]')
    .trim()
}

function sanitizeWorkflowToolRequest(
  request?: WorkflowDefinitionToolRequest,
  observation?: WorkflowSkillSuggestionRun['steps'][number]['observation']
): WorkflowDefinitionToolRequest | undefined {
  if (!request) return undefined
  const safeRequest: WorkflowDefinitionToolRequest = {
    toolId: request.toolId,
    name: request.name,
    source: request.source,
    serverId: request.serverId,
  }
  const safeArguments = collectReusableWorkflowToolArguments(request, observation)
  return safeArguments ? { ...safeRequest, arguments: safeArguments } : safeRequest
}

function collectReusableWorkflowToolArguments(
  request: WorkflowDefinitionToolRequest,
  observation: WorkflowSkillSuggestionRun['steps'][number]['observation'] | undefined
): Record<string, unknown> | undefined {
  if (!isRagContextPackToolRequest(request)) return undefined
  const output = parseObservationOutputRecord(observation?.output)
  const profile = readReusableRagProfile(
    request.arguments?.profile,
    observation?.diagnostic.metadata?.profile,
    output?.profile
  )
  const profileReason = readReusableRagProfileReason(
    request.arguments?.profileReason,
    observation?.diagnostic.metadata?.profileReason,
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

function buildWorkflowNameFromRun(run: WorkflowSkillSuggestionRun): string {
  const label = run.intent ? intentLabel(run.intent) : 'Agent workflow'
  const goal = run.goal.trim().replace(/\s+/g, ' ')
  const suffix = goal ? `: ${goal}` : ''
  return clampWorkflowOutput(redactSensitiveText(`${label}${suffix}`), 72).replace(/\n\[output truncated\]$/, '')
}

function buildWorkflowDescriptionFromRun(run: WorkflowSkillSuggestionRun): string {
  return [
    'Saved from a visible agent run.',
    'Run-specific tool arguments are not persisted; review the workflow before reuse.',
    `Original goal: ${clampWorkflowOutput(redactSensitiveText(run.goal.trim()), 360)}`,
    `Steps: ${run.steps.length}`,
  ].join('\n')
}

function buildWorkflowTriggerHints(run: WorkflowSkillSuggestionRun): string[] {
  const hints = [
    run.intent ?? '',
    ...run.goal.split(/[\s,，。.;；:：!?！？/\\|()[\]{}"'`]+/).map((item) => item.trim()).filter((item) => item.length >= 2),
  ]
  return [...new Set(hints)].slice(0, 6)
}

function expectedOutputForIntent(
  intent: WorkflowIntent | undefined,
): WorkflowDefinitionRecord['expectedOutput'] {
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

function resolvePermissionCeiling(
  requests: Array<WorkflowDefinitionToolRequest | undefined>,
  manifests: WorkflowDefinitionToolManifest[],
): WorkflowDefinitionPermission {
  return requests
    .map((request) => resolveWorkflowToolManifest(request, manifests)?.permission ?? 'read-only')
    .reduce((highest, permission) => permissionRank(permission) > permissionRank(highest) ? permission : highest, 'read-only' as WorkflowDefinitionPermission)
}

function resolveWorkflowToolManifest(
  request: WorkflowDefinitionToolRequest | undefined,
  manifests: WorkflowDefinitionToolManifest[],
): WorkflowDefinitionToolManifest | undefined {
  if (!request) return undefined
  return resolveUniqueToolManifest(request, manifests) ?? undefined
}

function permissionRank(permission: WorkflowDefinitionPermission): number {
  if (permission === 'destructive') return 2
  if (permission === 'read-write') return 1
  return 0
}

function intentLabel(intent: WorkflowIntent): string {
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
  suggestion: WorkflowSkillSuggestion,
  reason: SaveWorkflowSkillSuggestionResult['reason']
): SaveWorkflowSkillSuggestionResult {
  return {
    ok: false,
    status: 'blocked',
    requiresUserApproval: true,
    reason,
    approvalSummary: suggestion.approvalSummary,
  }
}

function buildBlockedStateResult(reason: SaveWorkflowSkillStateResult['reason']): SaveWorkflowSkillStateResult {
  return {
    ok: false,
    status: 'blocked',
    requiresUserApproval: true,
    reason,
  }
}

  return {
    createWorkflowSkillSuggestion,
    buildWorkflowSkillSavePreview,
    extractWorkflowDefinitionsFromSkillSnapshot,
    hasWorkflowDefinitionCandidatesInSkillSnapshot,
    selectWorkflowDefinitionFromSkillSnapshot,
    listEnabledWorkflowIdsForSkillSnapshot,
    listBlockedWorkflowStatesForSkillSnapshot,
    createWorkflowSkillSuggestionFromRun,
    saveApprovedWorkflowSkillSuggestion,
    getWorkflowSkillState,
    isWorkflowSkillImportReviewRequired,
    isWorkflowSkill,
    isWorkflowSkillLocallyApproved,
    isWorkflowSkillReviewRequired,
    isWorkflowSkillEnabled,
    isSkillSelectableWithWorkflowSkillState,
    extractWorkflowIdFromSkill,
    mergeWorkflowSkillEditTags,
    buildWorkflowSkillReviewRequiredEdit,
    listWorkflowSkills,
    saveApprovedWorkflowSkillState,
    buildWorkflowApprovalSummary,
    collectWorkflowRagProfileRequirements,
  }
}
