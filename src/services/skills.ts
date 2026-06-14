import type { Conversation, SkillDefinition, SkillSnapshot } from '@/types'
import { loadData, saveData } from '@/services/storage'
import { st } from '@/i18n/service'
import { sanitizeSkillForPortable } from '@/utils/skillSafety'

export interface SkillImportResult {
  ok: boolean
  skill?: SkillDefinition
  message: string
  manifest?: PortableSkillManifest
}

export interface SkillApplyInput {
  conversation?: Conversation
  skills: SkillDefinition[]
  variables?: Record<string, string | number | boolean>
}

export interface SkillApplyResult {
  snapshot: SkillSnapshot
  conversationUpdates: Partial<Conversation>
}

const SKILL_SCHEMA = 'islemind.skill.v1'
const PORTABLE_SKILL_ENVELOPE_SCHEMA = 'islemind.skill.portable.v2'

export interface PortableSkillManifest {
  schema: typeof PORTABLE_SKILL_ENVELOPE_SCHEMA
  exportedAt: number
  source: 'islemind'
  kind: 'skill' | 'agent-workflow-skill'
  skillId: string
  skillName: string
  version: string
  tagCount: number
  hasProviderBinding: boolean
  hasModelBinding: boolean
  providerBindingOmitted: boolean
  modelBindingOmitted: boolean
  hasKnowledgeSources: boolean
  hasEnabledTools: boolean
  workflow?: {
    id?: string
    importedReviewRequired: boolean
    approvalInherited: false
    state: 'disabled'
  }
}

export interface PortableSkillEnvelope {
  schema: typeof PORTABLE_SKILL_ENVELOPE_SCHEMA
  manifest: PortableSkillManifest
  skill: SkillDefinition
}

export async function listSkills(): Promise<SkillDefinition[]> {
  return loadData<SkillDefinition[]>('SKILLS').then((items) => (items ?? []).map(normalizeSkill).filter(isSkillDefinition))
}

export async function saveSkills(skills: SkillDefinition[]): Promise<void> {
  await saveData('SKILLS', skills.map(normalizeSkill).filter(isSkillDefinition))
}

export async function upsertSkill(skill: SkillDefinition): Promise<SkillDefinition> {
  const normalized = requireSkill(skill)
  const skills = await listSkills()
  const updated = [normalized, ...skills.filter((item) => item.id !== normalized.id)]
  await saveSkills(updated)
  return normalized
}

export async function deleteSkill(id: string): Promise<void> {
  const skills = await listSkills()
  await saveSkills(skills.filter((item) => item.id !== id))
}

export function exportSkill(skill: SkillDefinition): string {
  const sourceSkill = requireSkill(skill)
  const safeSkill = sanitizeSkillForPortable(sourceSkill)
  const envelope: PortableSkillEnvelope = {
    schema: PORTABLE_SKILL_ENVELOPE_SCHEMA,
    manifest: buildPortableSkillManifest(safeSkill, sourceSkill),
    skill: safeSkill,
  }
  return JSON.stringify(envelope, null, 2)
}

export function importSkill(raw: string): SkillImportResult {
  try {
    const parsed = JSON.parse(raw)
    const envelope = parsePortableSkillEnvelope(parsed)
    const skill = normalizeSkill(envelope?.skill ?? parsed)
    if (!skill) return { ok: false, message: st('skills.importInvalidFormat') }
    const safeSkill = sanitizeSkillForPortable(skill)
    return {
      ok: true,
      skill: safeSkill,
      manifest: envelope?.manifest ?? buildPortableSkillManifest(safeSkill, skill),
      message: st('skills.importRecognized', { name: safeSkill.name }),
    }
  } catch {
    return { ok: false, message: st('skills.importJsonFailed') }
  }
}

export function createBaseSkill(input: Pick<SkillDefinition, 'name' | 'systemPrompt'> & Partial<SkillDefinition>): SkillDefinition {
  const now = Date.now()
  return requireSkill({
    schema: SKILL_SCHEMA,
    id: input.id || `skill-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    layer: input.layer ?? 'base',
    version: input.version ?? '1.0.0',
    description: input.description,
    tags: input.tags ?? [],
    priority: input.priority ?? 0,
    systemPrompt: input.systemPrompt,
    variables: input.variables,
    model: input.model,
    providerId: input.providerId,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    enabledTools: input.enabledTools,
    knowledgeSources: input.knowledgeSources,
    firstUserMessage: input.firstUserMessage,
    expectedReplyFormat: input.expectedReplyFormat,
    stackPolicy: input.stackPolicy ?? 'append',
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  })
}

export function applySkillStack(input: SkillApplyInput): SkillApplyResult {
  const variables = input.variables ?? {}
  const ordered = [...input.skills].map(requireSkill).sort((a, b) => a.priority - b.priority)
  const promptParts: string[] = []
  const toolSet = new Set<string>()
  const sourceSet = new Set<string>()
  let providerId: string | undefined
  let model: string | undefined
  let temperature: number | undefined
  let maxTokens: number | undefined
  let firstUserMessage: string | undefined
  let expectedReplyFormat: string | undefined

  for (const skill of ordered) {
    const renderedPrompt = renderSkillTemplate(skill.systemPrompt, variables).trim()
    if (renderedPrompt) {
      if (skill.stackPolicy === 'override') {
        promptParts.splice(0, promptParts.length, renderedPrompt)
      } else {
        promptParts.push(renderedPrompt)
      }
    }
    for (const tool of skill.enabledTools ?? []) toolSet.add(tool)
    for (const source of skill.knowledgeSources ?? []) sourceSet.add(source)
    providerId = skill.providerId ?? providerId
    model = skill.model ?? model
    temperature = typeof skill.temperature === 'number' ? skill.temperature : temperature
    maxTokens = typeof skill.maxTokens === 'number' ? skill.maxTokens : maxTokens
    firstUserMessage = skill.firstUserMessage ? renderSkillTemplate(skill.firstUserMessage, variables) : firstUserMessage
    expectedReplyFormat = skill.expectedReplyFormat ? renderSkillTemplate(skill.expectedReplyFormat, variables) : expectedReplyFormat
  }

  const systemPrompt = promptParts.join('\n\n')
  const snapshot: SkillSnapshot = {
    skillIds: ordered.map((skill) => skill.id),
    names: ordered.map((skill) => skill.name),
    systemPrompt,
    variables,
    enabledTools: toolSet.size ? [...toolSet] : undefined,
    knowledgeSources: sourceSet.size ? [...sourceSet] : undefined,
    providerId,
    model,
    temperature,
    maxTokens,
    firstUserMessage,
    expectedReplyFormat,
  }
  const conversationUpdates: Partial<Conversation> = {
    skillIds: snapshot.skillIds,
    skillSnapshot: snapshot,
    systemPrompt,
    enabledTools: snapshot.enabledTools,
    knowledgeSources: snapshot.knowledgeSources,
  }
  if (providerId) conversationUpdates.providerId = providerId
  if (model) conversationUpdates.model = model
  if (typeof temperature === 'number') conversationUpdates.temperature = Math.max(0, Math.min(2, temperature))
  if (typeof maxTokens === 'number') conversationUpdates.maxTokens = Math.max(128, Math.min(128000, maxTokens))
  return { snapshot, conversationUpdates }
}

export function extractSkillVariables(skill: SkillDefinition): string[] {
  const explicit = skill.variables?.map((item) => item.name) ?? []
  const templateNames = [...`${skill.systemPrompt}\n${skill.firstUserMessage ?? ''}\n${skill.expectedReplyFormat ?? ''}`.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)]
    .map((match) => match[1])
  return [...new Set([...explicit, ...templateNames])]
}

export function renderSkillTemplate(template: string, variables: Record<string, string | number | boolean>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, name: string) => {
    const value = variables[name]
    return value === undefined || value === null ? '' : String(value)
  })
}

function requireSkill(value: SkillDefinition): SkillDefinition {
  const skill = normalizeSkill(value)
  if (!skill) throw new Error('Invalid Skill definition')
  return skill
}

function normalizeSkill(value: unknown): SkillDefinition | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<SkillDefinition>
  if (item.schema !== SKILL_SCHEMA) return null
  if (!item.id || !item.name || typeof item.systemPrompt !== 'string') return null
  const now = Date.now()
  return {
    schema: SKILL_SCHEMA,
    id: String(item.id),
    name: String(item.name),
    layer: item.layer === 'advanced' || item.layer === 'adaptive' ? item.layer : 'base',
    version: item.version ? String(item.version) : '1.0.0',
    description: item.description ? String(item.description) : undefined,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    priority: Number.isFinite(item.priority) ? Number(item.priority) : 0,
    systemPrompt: item.systemPrompt,
    variables: Array.isArray(item.variables) ? item.variables : undefined,
    model: typeof item.model === 'string' ? item.model : undefined,
    providerId: typeof item.providerId === 'string' ? item.providerId : undefined,
    temperature: typeof item.temperature === 'number' ? item.temperature : undefined,
    maxTokens: typeof item.maxTokens === 'number' ? item.maxTokens : undefined,
    enabledTools: Array.isArray(item.enabledTools) ? item.enabledTools.filter((tool): tool is string => typeof tool === 'string') : undefined,
    knowledgeSources: Array.isArray(item.knowledgeSources) ? item.knowledgeSources.filter((source): source is string => typeof source === 'string') : undefined,
    firstUserMessage: typeof item.firstUserMessage === 'string' ? item.firstUserMessage : undefined,
    expectedReplyFormat: typeof item.expectedReplyFormat === 'string' ? item.expectedReplyFormat : undefined,
    stackPolicy: item.stackPolicy === 'override' ? 'override' : 'append',
    createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : now,
    updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : now,
  }
}

function parsePortableSkillEnvelope(value: unknown): PortableSkillEnvelope | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Partial<PortableSkillEnvelope>
  if (record.schema !== PORTABLE_SKILL_ENVELOPE_SCHEMA || !record.skill || typeof record.manifest !== 'object') return undefined
  const skill = normalizeSkill(record.skill)
  if (!skill) return undefined
  const safeSkill = sanitizeSkillForPortable(skill)
  return {
    schema: PORTABLE_SKILL_ENVELOPE_SCHEMA,
    manifest: normalizePortableSkillManifest(record.manifest, safeSkill, skill),
    skill: safeSkill,
  }
}

function buildPortableSkillManifest(skill: SkillDefinition, sourceSkill: SkillDefinition = skill): PortableSkillManifest {
  const workflowId = extractWorkflowId(skill.tags)
  const workflow = skill.tags.includes('agent-workflow')
    ? {
        id: workflowId,
        importedReviewRequired: skill.tags.includes('workflow-import:review-required'),
        approvalInherited: false as const,
        state: 'disabled' as const,
      }
    : undefined
  return {
    schema: PORTABLE_SKILL_ENVELOPE_SCHEMA,
    exportedAt: Date.now(),
    source: 'islemind',
    kind: workflow ? 'agent-workflow-skill' : 'skill',
    skillId: skill.id,
    skillName: skill.name,
    version: skill.version,
    tagCount: skill.tags.length,
    hasProviderBinding: !!skill.providerId,
    hasModelBinding: !!skill.model,
    providerBindingOmitted: !!sourceSkill.providerId && !skill.providerId,
    modelBindingOmitted: !!sourceSkill.model && !skill.model,
    hasKnowledgeSources: !!skill.knowledgeSources?.length,
    hasEnabledTools: !!skill.enabledTools?.length,
    workflow,
  }
}

function normalizePortableSkillManifest(value: unknown, skill: SkillDefinition, sourceSkill: SkillDefinition = skill): PortableSkillManifest {
  const fallback = buildPortableSkillManifest(skill, sourceSkill)
  if (!value || typeof value !== 'object') return fallback
  const record = value as Partial<PortableSkillManifest>
  const workflow = fallback.workflow
  return {
    ...fallback,
    exportedAt: Number.isFinite(record.exportedAt) ? Number(record.exportedAt) : fallback.exportedAt,
    source: 'islemind',
    kind: fallback.kind,
    skillId: fallback.skillId,
    skillName: fallback.skillName,
    version: fallback.version,
    tagCount: fallback.tagCount,
    hasProviderBinding: fallback.hasProviderBinding,
    hasModelBinding: fallback.hasModelBinding,
    providerBindingOmitted: fallback.providerBindingOmitted || record.providerBindingOmitted === true,
    modelBindingOmitted: fallback.modelBindingOmitted || record.modelBindingOmitted === true,
    hasKnowledgeSources: fallback.hasKnowledgeSources,
    hasEnabledTools: fallback.hasEnabledTools,
    workflow: workflow
      ? {
          ...workflow,
          importedReviewRequired: true,
          approvalInherited: false,
          state: 'disabled',
        }
      : undefined,
  }
}

function extractWorkflowId(tags: string[]): string | undefined {
  const tag = tags.find((item) => item.startsWith('workflow:'))
  return tag?.slice('workflow:'.length) || undefined
}

function isSkillDefinition(value: SkillDefinition | null): value is SkillDefinition {
  return !!value
}
