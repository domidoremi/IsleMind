import {
  clampProviderPlatformOutputTokens,
  clampProviderPlatformTemperature,
  type ConversationGenerationParameterKey,
  type ConversationGenerationParameterRangeInput,
  type ConversationGenerationParameterRanges,
} from '@/modules/providers'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { SkillDefinition, SkillSnapshot } from '@/types/skillContracts'

export interface SkillImportResult {
  ok: boolean
  skill?: SkillDefinition
  message: string
  manifest?: PortableSkillManifest
}

export interface SkillApplyInput {
  conversation?: Conversation
  providers?: AIProvider[]
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

export interface ConversationSkillPolicyDependencies {
  now(): number
  createSkillId(now: number): string
  translate(key: string, params?: Record<string, unknown>): string
  sanitizeSkillForPortable(skill: SkillDefinition): SkillDefinition
  resolveProviderModelAlias(
    provider: Pick<AIProvider, 'modelAliases'>,
    model: string,
  ): string
  resolveGenerationParameterRanges(
    input: ConversationGenerationParameterRangeInput,
  ): ConversationGenerationParameterRanges
  clampGenerationParameter(
    key: ConversationGenerationParameterKey,
    value: number | undefined,
    ranges: ConversationGenerationParameterRanges,
  ): number | undefined
}

export interface ConversationSkillPolicy {
  normalizeSkill(value: unknown): SkillDefinition | null
  createBaseSkill(
    input: Pick<SkillDefinition, 'name' | 'systemPrompt'> & Partial<SkillDefinition>,
  ): SkillDefinition
  exportSkill(skill: SkillDefinition): string
  importSkill(raw: string): SkillImportResult
  applySkillStack(input: SkillApplyInput): SkillApplyResult
  extractSkillVariables(skill: SkillDefinition): string[]
  renderSkillTemplate(
    template: string,
    variables: Record<string, string | number | boolean>,
  ): string
}

export interface ConversationSkillRecordPort {
  read(): Promise<unknown | null>
  write(skills: readonly SkillDefinition[]): Promise<void>
}

export interface ConversationSkillRepository {
  listSkills(): Promise<SkillDefinition[]>
  saveSkills(skills: readonly SkillDefinition[]): Promise<void>
  upsertSkill(skill: SkillDefinition): Promise<SkillDefinition>
  deleteSkill(id: string): Promise<void>
}

export type ConversationSkillApplication = ConversationSkillPolicy & ConversationSkillRepository

export class ConversationSkillRecordDataError extends Error {
  constructor() {
    super('Conversation skill records are invalid.')
    this.name = 'ConversationSkillRecordDataError'
  }
}

export function createConversationSkillPolicy(
  dependencies: ConversationSkillPolicyDependencies,
): ConversationSkillPolicy {
  function normalizeSkill(value: unknown): SkillDefinition | null {
    if (!value || typeof value !== 'object') return null
    const item = value as Partial<SkillDefinition>
    if (item.schema !== SKILL_SCHEMA) return null
    if (!item.id || !item.name || typeof item.systemPrompt !== 'string') return null
    const now = dependencies.now()
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

  function requireSkill(value: SkillDefinition): SkillDefinition {
    const skill = normalizeSkill(value)
    if (!skill) throw new Error('Invalid Skill definition')
    return skill
  }

  function createBaseSkill(
    input: Pick<SkillDefinition, 'name' | 'systemPrompt'> & Partial<SkillDefinition>,
  ): SkillDefinition {
    const now = dependencies.now()
    return requireSkill({
      schema: SKILL_SCHEMA,
      id: input.id || dependencies.createSkillId(now),
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

  function exportSkill(skill: SkillDefinition): string {
    const sourceSkill = requireSkill(skill)
    const safeSkill = dependencies.sanitizeSkillForPortable(sourceSkill)
    const envelope: PortableSkillEnvelope = {
      schema: PORTABLE_SKILL_ENVELOPE_SCHEMA,
      manifest: buildPortableSkillManifest(safeSkill, sourceSkill),
      skill: safeSkill,
    }
    return JSON.stringify(envelope, null, 2)
  }

  function importSkill(raw: string): SkillImportResult {
    try {
      const parsed = JSON.parse(raw)
      const envelope = parsePortableSkillEnvelope(parsed)
      const skill = normalizeSkill(envelope?.skill ?? parsed)
      if (!skill) {
        return {
          ok: false,
          message: dependencies.translate('skills.importInvalidFormat'),
        }
      }
      const safeSkill = dependencies.sanitizeSkillForPortable(skill)
      return {
        ok: true,
        skill: safeSkill,
        manifest: envelope?.manifest ?? buildPortableSkillManifest(safeSkill, skill),
        message: dependencies.translate('skills.importRecognized', { name: safeSkill.name }),
      }
    } catch {
      return {
        ok: false,
        message: dependencies.translate('skills.importJsonFailed'),
      }
    }
  }

  function applySkillStack(input: SkillApplyInput): SkillApplyResult {
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
      firstUserMessage = skill.firstUserMessage
        ? renderSkillTemplate(skill.firstUserMessage, variables)
        : firstUserMessage
      expectedReplyFormat = skill.expectedReplyFormat
        ? renderSkillTemplate(skill.expectedReplyFormat, variables)
        : expectedReplyFormat
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
    const parameterRanges = resolveSkillGenerationParameterRanges({
      conversation: input.conversation,
      providers: input.providers,
      providerId,
      model,
      temperature,
      maxTokens,
    })
    const generationParameterOverrides: Conversation['generationParameterOverrides'] = {}
    if (typeof temperature === 'number') {
      conversationUpdates.temperature = (
        parameterRanges
          ? dependencies.clampGenerationParameter('temperature', temperature, parameterRanges)
          : undefined
      ) ?? clampProviderPlatformTemperature(temperature)
      generationParameterOverrides.temperature = true
    }
    if (typeof maxTokens === 'number') {
      conversationUpdates.maxTokens = (
        parameterRanges
          ? dependencies.clampGenerationParameter('maxTokens', maxTokens, parameterRanges)
          : undefined
      ) ?? clampProviderPlatformOutputTokens(maxTokens)
      generationParameterOverrides.maxTokens = true
    }
    if (Object.keys(generationParameterOverrides).length) {
      conversationUpdates.generationParameterOverrides = generationParameterOverrides
    }
    return { snapshot, conversationUpdates }
  }

  function resolveSkillGenerationParameterRanges(input: {
    conversation?: Conversation
    providers?: AIProvider[]
    providerId?: string
    model?: string
    temperature?: number
    maxTokens?: number
  }): ConversationGenerationParameterRanges | undefined {
    const targetProviderId = input.providerId ?? input.conversation?.providerId
    const targetProvider = targetProviderId
      ? input.providers?.find((provider) => provider.id === targetProviderId)
      : undefined
    const targetModel = input.model ?? input.conversation?.model
    if (!targetModel) return undefined
    const upstreamModel = targetProvider
      ? dependencies.resolveProviderModelAlias(targetProvider, targetModel)
      : targetModel
    return dependencies.resolveGenerationParameterRanges({
      provider: targetProvider,
      model: upstreamModel,
      reasoningEffort: input.conversation?.reasoningEffort,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    })
  }

  function extractSkillVariables(skill: SkillDefinition): string[] {
    const explicit = skill.variables?.map((item) => item.name) ?? []
    const templateNames = [...`${skill.systemPrompt}\n${skill.firstUserMessage ?? ''}\n${skill.expectedReplyFormat ?? ''}`.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)]
      .map((match) => match[1])
    return [...new Set([...explicit, ...templateNames])]
  }

  function renderSkillTemplate(
    template: string,
    variables: Record<string, string | number | boolean>,
  ): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, name: string) => {
      const value = variables[name]
      return value === undefined || value === null ? '' : String(value)
    })
  }

  function parsePortableSkillEnvelope(value: unknown): PortableSkillEnvelope | undefined {
    if (!value || typeof value !== 'object') return undefined
    const record = value as Partial<PortableSkillEnvelope>
    if (
      record.schema !== PORTABLE_SKILL_ENVELOPE_SCHEMA
      || !record.skill
      || typeof record.manifest !== 'object'
    ) return undefined
    const skill = normalizeSkill(record.skill)
    if (!skill) return undefined
    const safeSkill = dependencies.sanitizeSkillForPortable(skill)
    return {
      schema: PORTABLE_SKILL_ENVELOPE_SCHEMA,
      manifest: normalizePortableSkillManifest(record.manifest, safeSkill, skill),
      skill: safeSkill,
    }
  }

  function buildPortableSkillManifest(
    skill: SkillDefinition,
    sourceSkill: SkillDefinition = skill,
  ): PortableSkillManifest {
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
      exportedAt: dependencies.now(),
      source: 'islemind',
      kind: workflow ? 'agent-workflow-skill' : 'skill',
      skillId: skill.id,
      skillName: skill.name,
      version: skill.version ?? '1.0.0',
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

  function normalizePortableSkillManifest(
    value: unknown,
    skill: SkillDefinition,
    sourceSkill: SkillDefinition = skill,
  ): PortableSkillManifest {
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

  return Object.freeze({
    normalizeSkill,
    createBaseSkill,
    exportSkill,
    importSkill,
    applySkillStack,
    extractSkillVariables,
    renderSkillTemplate,
  })
}

export function createConversationSkillRepository(input: {
  records: ConversationSkillRecordPort
  normalizeSkill(value: unknown): SkillDefinition | null
}): ConversationSkillRepository {
  let mutationTail = Promise.resolve()

  async function listSkills(): Promise<SkillDefinition[]> {
    const persisted = await input.records.read()
    if (persisted === null) return []
    if (!Array.isArray(persisted)) throw new ConversationSkillRecordDataError()
    return persisted
      .map(input.normalizeSkill)
      .filter((skill): skill is SkillDefinition => skill !== null)
  }

  function writeNormalized(skills: readonly SkillDefinition[]): Promise<void> {
    return input.records.write(
      skills
        .map(input.normalizeSkill)
        .filter((skill): skill is SkillDefinition => skill !== null),
    )
  }

  function runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(operation, operation)
    mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  function saveSkills(skills: readonly SkillDefinition[]): Promise<void> {
    return runMutation(() => writeNormalized(skills))
  }

  function upsertSkill(skill: SkillDefinition): Promise<SkillDefinition> {
    return runMutation(async () => {
      const normalized = input.normalizeSkill(skill)
      if (!normalized) throw new ConversationSkillRecordDataError()
      const skills = await listSkills()
      await writeNormalized([
        normalized,
        ...skills.filter((item) => item.id !== normalized.id),
      ])
      return normalized
    })
  }

  function deleteSkill(id: string): Promise<void> {
    return runMutation(async () => {
      const skills = await listSkills()
      await writeNormalized(skills.filter((item) => item.id !== id))
    })
  }

  return Object.freeze({
    listSkills,
    saveSkills,
    upsertSkill,
    deleteSkill,
  })
}

export function createConversationSkillApplication(
  dependencies: ConversationSkillPolicyDependencies & {
    records: ConversationSkillRecordPort
  },
): ConversationSkillApplication {
  const policy = createConversationSkillPolicy(dependencies)
  const repository = createConversationSkillRepository({
    records: dependencies.records,
    normalizeSkill: policy.normalizeSkill,
  })
  return Object.freeze({ ...policy, ...repository })
}

function extractWorkflowId(tags: string[]): string | undefined {
  const tag = tags.find((item) => item.startsWith('workflow:'))
  return tag?.slice('workflow:'.length) || undefined
}
