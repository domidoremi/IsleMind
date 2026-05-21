import type { Conversation, SkillDefinition, SkillSnapshot } from '@/types'
import { loadData, saveData } from '@/services/storage'
import { st } from '@/i18n/service'

export interface SkillImportResult {
  ok: boolean
  skill?: SkillDefinition
  message: string
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
  return JSON.stringify(requireSkill(skill), null, 2)
}

export function importSkill(raw: string): SkillImportResult {
  try {
    const parsed = JSON.parse(raw)
    const skill = normalizeSkill(parsed)
    if (!skill) return { ok: false, message: st('skills.importInvalidFormat') }
    return { ok: true, skill, message: st('skills.importRecognized', { name: skill.name }) }
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

function isSkillDefinition(value: SkillDefinition | null): value is SkillDefinition {
  return !!value
}
