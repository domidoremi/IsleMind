import { isUnsafeRuntimePairingText } from './textSafety'
import type {
  McpToolchainRuntimeKind,
  McpToolchainRuntimeSupport,
  McpToolchainRuntimeSupportMap,
} from './mcpToolchainManifest'

const SKILL_LIMIT = 80
const SKILL_VARIABLE_LIMIT = 24
const SKILL_TAG_LIMIT = 24
const TEXT_LIMIT = 420
const SKILL_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

export interface PortableSkillVariableInput {
  name: string
  type: string
  required?: boolean
}

export interface PortableSkillManifestInput {
  id: string
  name: string
  version?: string
  description?: string
  tags: string[]
  variables?: PortableSkillVariableInput[]
  enabledTools?: string[]
  knowledgeSources?: string[]
}

export interface PortableSkillToolchainManifest<TSchema extends string = string> {
  schema: TSchema
  id: string
  title: string
  kind: 'skill'
  version: string
  description?: string
  runtimes: McpToolchainRuntimeSupportMap
  permissions: []
  entry: {
    type: 'app-action'
    executor: 'app'
    action: string
  }
  requires: { capabilities: ['app-action'] }
  inputs?: Record<string, { type: 'string' | 'number' | 'boolean'; required: boolean }>
  outputs: { conversation: { type: 'json' } }
  diagnosticHint?: string
}

export interface PortableSkillToolchainManifestDependencies<TSchema extends string> {
  manifestSchema: TSchema
  createRuntimeSupport(
    input: Partial<Record<McpToolchainRuntimeKind, McpToolchainRuntimeSupport>>,
  ): McpToolchainRuntimeSupportMap
  stableIdentityHash(input: unknown): string
  sanitizePayloadKey(input: unknown): string | undefined
  sanitizePublicText(input: unknown): string | undefined
}

export interface PortableSkillToolchainManifestAssembly<TSchema extends string> {
  createToolchainManifestFromPortableSkill(
    skill: PortableSkillManifestInput,
  ): PortableSkillToolchainManifest<TSchema>
  createToolchainManifestsFromPortableSkills(
    skills: readonly PortableSkillManifestInput[],
  ): PortableSkillToolchainManifest<TSchema>[]
}

export function createPortableSkillToolchainManifestAssembly<TSchema extends string>(
  dependencies: PortableSkillToolchainManifestDependencies<TSchema>,
): PortableSkillToolchainManifestAssembly<TSchema> {
  function createToolchainManifestFromPortableSkill(
    skill: PortableSkillManifestInput,
  ): PortableSkillToolchainManifest<TSchema> {
    const portableSkill = skill && typeof skill === 'object'
      ? skill as Partial<PortableSkillManifestInput>
      : {}
    const skillToken = createPortableSkillToken(portableSkill, dependencies.stableIdentityHash)
    const tags = sanitizePortableSkillTagList(portableSkill.tags)
    const hasWorkflowReview = tags.some((tag) => tag === 'agent-workflow' || tag === 'workflow-import:review-required')
    const hasToolBindings = Array.isArray(portableSkill.enabledTools) && portableSkill.enabledTools.length > 0
    const hasKnowledgeBindings = Array.isArray(portableSkill.knowledgeSources) && portableSkill.knowledgeSources.length > 0
    return {
      schema: dependencies.manifestSchema,
      id: `islemind.skill.${skillToken}`,
      title: dependencies.sanitizePublicText(portableSkill.name) ?? 'Portable Skill',
      kind: 'skill',
      version: sanitizePortableSkillVersion(portableSkill.version),
      description: dependencies.sanitizePublicText(portableSkill.description),
      runtimes: dependencies.createRuntimeSupport({ 'android-app': 'supported' }),
      permissions: [],
      entry: {
        type: 'app-action',
        executor: 'app',
        action: `skill.apply:${skillToken}`,
      },
      requires: { capabilities: ['app-action'] },
      inputs: createPortableSkillInputSchema(portableSkill.variables, dependencies.sanitizePayloadKey),
      outputs: { conversation: { type: 'json' } },
      diagnosticHint: createPortableSkillDiagnosticHint({ hasWorkflowReview, hasToolBindings, hasKnowledgeBindings }),
    }
  }

  function createToolchainManifestsFromPortableSkills(
    skills: readonly PortableSkillManifestInput[],
  ): PortableSkillToolchainManifest<TSchema>[] {
    const source = Array.isArray(skills) ? skills : []
    return source.slice(0, SKILL_LIMIT).map(createToolchainManifestFromPortableSkill)
  }

  return {
    createToolchainManifestFromPortableSkill,
    createToolchainManifestsFromPortableSkills,
  }
}

function createPortableSkillToken(
  skill: Partial<PortableSkillManifestInput>,
  stableIdentityHash: (input: unknown) => string,
): string {
  const id = cleanText(skill.id)
  const name = cleanText(skill.name)
  const version = skill.version === undefined ? undefined : cleanText(skill.version)
  const rawToken = portableSkillTokenSource(id) ?? portableSkillTokenSource(name) ?? 'portable-skill'
  const token = cleanTaskItemToken(rawToken).toLowerCase() || 'portable-skill'
  const hash = stableIdentityHash({ id, name, version })
  const bounded = token.slice(0, 72).replace(/^-+|-+$/g, '') || 'portable-skill'
  return `${bounded}-${hash}`.slice(0, 96).replace(/[-.:]+$/g, '')
}

function sanitizePortableSkillVersion(input: unknown): string {
  const version = cleanText(input)
  if (isUnsafeRuntimePairingText(version)) return '1.0.0'
  return SKILL_VERSION_PATTERN.test(version) ? version : '1.0.0'
}

function sanitizePortableSkillTagList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((tag) => typeof tag === 'string' ? [tag] : []).slice(0, SKILL_TAG_LIMIT)
}

function createPortableSkillInputSchema(
  variablesInput: unknown,
  sanitizePayloadKey: (input: unknown) => string | undefined,
): PortableSkillToolchainManifest['inputs'] | undefined {
  const variables = Array.isArray(variablesInput) ? variablesInput : []
  const entries = variables.slice(0, SKILL_VARIABLE_LIMIT).flatMap((variable) => {
    const record = variable && typeof variable === 'object'
      ? variable as Partial<PortableSkillVariableInput>
      : undefined
    if (!record || typeof record.name !== 'string' || record.name.trim() !== record.name ||
      !record.name || isUnsafeRuntimePairingText(record.name)) return []
    const key = sanitizePayloadKey(record.name)
    return key ? [[key, { type: mapSkillVariableType(record.type), required: record.required === true }] as const] : []
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

function portableSkillTokenSource(input: string): string | undefined {
  if (!input || isUnsafeRuntimePairingText(input)) return undefined
  const token = cleanTaskItemToken(input).toLowerCase()
  return token && !isUnsafeRuntimePairingText(token) ? token : undefined
}

function mapSkillVariableType(type: unknown): 'string' | 'number' | 'boolean' {
  if (type === 'number') return 'number'
  if (type === 'boolean') return 'boolean'
  return 'string'
}

function createPortableSkillDiagnosticHint(input: {
  hasWorkflowReview: boolean
  hasToolBindings: boolean
  hasKnowledgeBindings: boolean
}): string {
  if (input.hasWorkflowReview) return 'Imported workflow skills remain disabled until review.'
  if (input.hasToolBindings || input.hasKnowledgeBindings) {
    return 'Skill tool and knowledge bindings are metadata; later tool calls remain governed separately.'
  }
  return 'Portable skill installs as app metadata without exposing prompt text.'
}

function cleanText(input: unknown): string {
  return typeof input === 'string' ? input.trim().slice(0, TEXT_LIMIT) : ''
}

function cleanTaskItemToken(input: string | undefined): string {
  return cleanText(input).replace(/[^a-z0-9_.:-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 128).replace(/^-+|-+$/g, '')
}
