import type { McpServerConfig, McpToolPermission, McpTransport } from '@/types/mcpContracts'
import type { SkillDefinition } from '@/types/skillContracts'
import type { ConversationToolCatalogManifest as ConversationToolManifest } from '@/modules/integrations'
import {
  decodeWorkflowDefinition,
  type WorkflowDefinitionPermission,
  type WorkflowDefinitionRecord,
} from '@/modules/tasks'
import { redactSensitiveText } from '@/core'
import { listMcpServers } from '@/bootstrap/mcpCatalog'
import { listSkills } from '@/bootstrap/conversationSkills'
import { emitRuntimeEvent, type RuntimeEventEnvelope } from '@/services/runtimeEvents'
import {
  extractWorkflowDefinitionsFromSkillSnapshot,
  extractWorkflowIdFromSkill,
  getWorkflowSkillState,
  isWorkflowSkill,
  isWorkflowSkillImportReviewRequired,
  isWorkflowSkillLocallyApproved,
  isWorkflowSkillReviewRequired,
} from '@/bootstrap/workflowSkills'
export const PLUGIN_MANIFEST_SCHEMA = 'islemind.plugin.v1'
export const PLUGIN_MANIFEST_CATALOG_SCHEMA = 'islemind.plugin-catalog.v1'

export const PLUGIN_HOOK_POINTS = [
  'chat.beforeSend',
  'context.afterPlan',
  'provider.beforeRequest',
  'provider.afterResponse',
  'tool.beforeCall',
  'tool.afterResult',
  'context.afterCompact',
  'chat.afterComplete',
] as const

export type PluginManifestSchema = typeof PLUGIN_MANIFEST_SCHEMA
export type PluginManifestCatalogSchema = typeof PLUGIN_MANIFEST_CATALOG_SCHEMA
export type PluginHookPoint = typeof PLUGIN_HOOK_POINTS[number]
export type PluginReviewState = 'unreviewed' | 'approved' | 'rejected'
export type PluginManifestSourceKind = 'skill' | 'workflow-skill' | 'mcp-server' | 'manual'

export interface PluginManifestReview {
  state: PluginReviewState
  summary?: string
  reviewedAt?: number
  reviewedBy?: string
}

export interface PluginManifestEntryBase {
  id: string
  name: string
  description?: string
  enabled?: boolean
  disabledReason?: string
  requiredCapabilities?: string[]
  permission?: WorkflowDefinitionPermission
  review?: PluginManifestReview
}

export type PluginCommandInputSchema = NonNullable<ConversationToolManifest['inputSchema']>

export interface PluginCommandManifest extends PluginManifestEntryBase {
  command: string
  /**
   * A bounded subset of the Agent tool input-schema contract. Command hosts
   * must validate arguments with validateWorkflowToolInput before invocation.
   */
  inputSchema?: PluginCommandInputSchema
}

export interface PluginAgentManifest extends PluginManifestEntryBase {
  workflow?: WorkflowDefinitionRecord
  skillId?: string
}

export interface PluginSkillManifest extends PluginManifestEntryBase {
  skillId: string
  workflow?: WorkflowDefinitionRecord
  tags?: string[]
}

export interface PluginHookManifest extends PluginManifestEntryBase {
  point: PluginHookPoint
  handlerRef: string
  execution: 'noop'
}

export interface PluginMcpManifest extends PluginManifestEntryBase {
  serverId: string
  transport?: McpTransport
}

export interface PluginSettingManifest extends PluginManifestEntryBase {
  key: string
  valueType: 'string' | 'number' | 'boolean' | 'json'
  defaultValue?: unknown
}

export interface PluginManifest {
  schema: PluginManifestSchema
  id: string
  name: string
  version: string
  description?: string
  enabled: boolean
  disabledReason?: string
  permissions: WorkflowDefinitionPermission[]
  requiredCapabilities: string[]
  review: PluginManifestReview
  commands: PluginCommandManifest[]
  agents: PluginAgentManifest[]
  skills: PluginSkillManifest[]
  hooks: PluginHookManifest[]
  mcp: PluginMcpManifest[]
  settings: PluginSettingManifest[]
}

export interface PluginManifestValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
  sanitized: PluginManifest
}

export interface PluginManifestCatalogEntry {
  manifestId: string
  name: string
  sourceKind: PluginManifestSourceKind
  sourceId: string
  enabled: boolean
  reviewState: PluginReviewState
  permissions: WorkflowDefinitionPermission[]
  requiredCapabilities: string[]
  hookCount: number
  noopHookCount: number
  executableHookCount: number
  errorCount: number
  warningCount: number
  errors: string[]
  warnings: string[]
}

export interface PluginManifestCatalogSnapshot {
  schema: PluginManifestCatalogSchema
  generatedAt: number
  counts: {
    total: number
    valid: number
    invalid: number
    enabled: number
    disabled: number
    hooks: number
    noopHooks: number
    executableHooks: number
    errors: number
    warnings: number
  }
  reviewStates: Record<PluginReviewState, number>
  permissions: Record<WorkflowDefinitionPermission, number>
  requiredCapabilities: Record<string, number>
  entries: PluginManifestCatalogEntry[]
}

export interface BuildPluginManifestCatalogInput {
  skills?: SkillDefinition[]
  mcpServers?: McpServerConfig[]
  manifests?: Array<{
    manifest: PluginManifest
    sourceKind?: PluginManifestSourceKind
    sourceId?: string
  }>
  now?: number
}

type AnyRecord = Record<string, unknown>

const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,127}$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const TEXT_LIMIT = 360
const LIST_LIMIT = 32
const CATALOG_ENTRY_LIMIT = 80
const CATALOG_MESSAGE_LIMIT = 6
const CATALOG_RUNTIME_CAPABILITY_LIMIT = 12
const PLUGIN_COMMAND_SCHEMA_DEPTH_LIMIT = 4
const PLUGIN_COMMAND_SCHEMA_PROPERTY_LIMIT = 32
const PLUGIN_COMMAND_SCHEMA_PROPERTY_NAME_LIMIT = 96
const PLUGIN_COMMAND_SCHEMA_REQUIRED_LIMIT = 32
const PLUGIN_COMMAND_SCHEMA_ENUM_LIMIT = 16
const PLUGIN_COMMAND_SCHEMA_TEXT_LIMIT = 160
const PLUGIN_COMMAND_SCHEMA_PATTERN_LIMIT = 160
const PLUGIN_COMMAND_SCHEMA_TYPE_LIMIT = 4
const PERMISSIONS: WorkflowDefinitionPermission[] = ['read-only', 'read-write', 'destructive']
const REVIEW_STATES: PluginReviewState[] = ['unreviewed', 'approved', 'rejected']
const PLUGIN_COMMAND_SCHEMA_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'] as const
const PERMISSION_RANK: Record<WorkflowDefinitionPermission, number> = {
  'read-only': 0,
  'read-write': 1,
  destructive: 2,
}

export function validatePluginManifest(input: unknown): PluginManifestValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const sanitized = sanitizePluginManifest(input, warnings)
  const rawManifest = asRecord(input) ?? {}
  const rawCommands = sanitizeList(rawManifest.commands)
  const rawAgents = sanitizeList(rawManifest.agents)
  const rawSkills = sanitizeList(rawManifest.skills)

  if (sanitized.schema !== PLUGIN_MANIFEST_SCHEMA) errors.push('schema must be islemind.plugin.v1.')
  if (!isStableId(sanitized.id)) errors.push('id must be a stable plugin id.')
  if (!sanitized.name) errors.push('name is required.')
  if (!VERSION_PATTERN.test(sanitized.version)) errors.push('version must be semver.')
  if (!sanitized.enabled && !sanitized.disabledReason) errors.push('disabled plugins must include disabledReason.')
  if (!REVIEW_STATES.includes(sanitized.review.state)) errors.push('review.state is invalid.')
  for (const permission of sanitized.permissions) {
    if (!isPermission(permission)) errors.push(`permissions contains invalid value ${permission}.`)
  }
  for (const [index, command] of sanitized.commands.entries()) {
    validateEntry('commands', command, errors)
    if (!command.command) errors.push(`commands.${command.id}.command is required.`)
    validatePluginCommandInputSchema(rawCommands[index], command, errors, warnings)
  }
  validateEntries('agents', sanitized.agents, errors)
  validateEntries('skills', sanitized.skills, errors)
  validatePluginWorkflowEntries('agents', rawAgents, sanitized.agents, errors)
  validatePluginWorkflowEntries('skills', rawSkills, sanitized.skills, errors)
  const workflowEntries = [...sanitized.agents, ...sanitized.skills]
  if (
    sanitized.requiredCapabilities.includes('agent-workflow')
    && !workflowEntries.some((entry) => entry.workflow)
    && !workflowEntries.some((entry) => entry.requiredCapabilities?.includes('agent-workflow'))
  ) {
    errors.push('agent-workflow plugins must include a valid workflow definition.')
  }
  validateEntries('settings', sanitized.settings, errors)
  for (const hook of sanitized.hooks) {
    validateEntry('hooks', hook, errors)
    if (!PLUGIN_HOOK_POINTS.includes(hook.point)) errors.push(`hooks.${hook.id}.point is invalid.`)
    if (hook.enabled) errors.push(`hooks.${hook.id} must stay disabled until hook execution is reviewed.`)
    if (hook.execution !== 'noop') errors.push(`hooks.${hook.id}.execution must be noop.`)
    if (!hook.handlerRef) errors.push(`hooks.${hook.id}.handlerRef is required.`)
  }
  for (const server of sanitized.mcp) {
    validateEntry('mcp', server, errors)
    if (!isStableId(server.serverId)) errors.push(`mcp.${server.id}.serverId must be stable.`)
    if (!server.permission) errors.push(`mcp.${server.id}.permission is required.`)
  }
  for (const skill of sanitized.skills) {
    if (!isStableId(skill.skillId)) errors.push(`skills.${skill.id}.skillId must be stable.`)
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    sanitized,
  }
}

export async function loadPluginManifestCatalogSnapshot(now = Date.now()): Promise<PluginManifestCatalogSnapshot> {
  const [skills, mcpServers] = await Promise.all([listSkills(), listMcpServers()])
  return buildPluginManifestCatalogSnapshot({ skills, mcpServers, now })
}

export function buildPluginManifestCatalogSnapshot(input: BuildPluginManifestCatalogInput = {}): PluginManifestCatalogSnapshot {
  const now = input.now ?? Date.now()
  const generated: Array<{ manifest: PluginManifest; sourceKind: PluginManifestSourceKind; sourceId: string }> = [
    ...(input.skills ?? []).map((skill) => ({
      manifest: createPluginManifestFromWorkflowSkill(skill, now),
      sourceKind: isWorkflowSkill(skill) ? 'workflow-skill' as const : 'skill' as const,
      sourceId: skill.id,
    })),
    ...(input.mcpServers ?? []).map((server) => ({
      manifest: createPluginManifestFromMcpServer(server, now),
      sourceKind: 'mcp-server' as const,
      sourceId: server.id,
    })),
    ...(input.manifests ?? []).map((item) => ({
      manifest: item.manifest,
      sourceKind: item.sourceKind ?? 'manual' as const,
      sourceId: item.sourceId ?? item.manifest.id,
    })),
  ]
  const allEntries = generated.map((item) => summarizeManifestForCatalog(item.manifest, item.sourceKind, item.sourceId))
    .sort((a, b) => a.manifestId.localeCompare(b.manifestId))
  const reviewStates = createEmptyReviewStateCounts()
  const permissions = createEmptyPermissionCounts()
  const requiredCapabilities: Record<string, number> = {}
  const counts = {
    total: allEntries.length,
    valid: 0,
    invalid: 0,
    enabled: 0,
    disabled: 0,
    hooks: 0,
    noopHooks: 0,
    executableHooks: 0,
    errors: 0,
    warnings: 0,
  }
  for (const entry of allEntries) {
    if (entry.errorCount) counts.invalid += 1
    else counts.valid += 1
    if (entry.enabled) counts.enabled += 1
    else counts.disabled += 1
    counts.hooks += entry.hookCount
    counts.noopHooks += entry.noopHookCount
    counts.executableHooks += entry.executableHookCount
    counts.errors += entry.errorCount
    counts.warnings += entry.warningCount
    reviewStates[entry.reviewState] += 1
    for (const permission of entry.permissions) permissions[permission] += 1
    for (const capability of entry.requiredCapabilities) {
      requiredCapabilities[capability] = (requiredCapabilities[capability] ?? 0) + 1
    }
  }
  return {
    schema: PLUGIN_MANIFEST_CATALOG_SCHEMA,
    generatedAt: now,
    counts,
    reviewStates,
    permissions,
    requiredCapabilities,
    entries: allEntries.slice(0, CATALOG_ENTRY_LIMIT),
  }
}

export function buildPluginManifestCatalogRuntimeEventData(snapshot: PluginManifestCatalogSnapshot, trigger: string): Record<string, unknown> {
  return {
    trigger,
    catalogSchema: snapshot.schema,
    generatedAt: snapshot.generatedAt,
    entryCount: snapshot.entries.length,
    entryLimit: CATALOG_ENTRY_LIMIT,
    entryLimitApplied: snapshot.counts.total > snapshot.entries.length,
    counts: snapshot.counts,
    reviewStates: snapshot.reviewStates,
    permissions: snapshot.permissions,
    requiredCapabilityKeys: Object.entries(snapshot.requiredCapabilities)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, CATALOG_RUNTIME_CAPABILITY_LIMIT)
      .map(([capability]) => capability),
    sourceKinds: countPluginCatalogSourceKinds(snapshot.entries),
  }
}

export async function emitPluginManifestCatalogSnapshotEvent(
  snapshot: PluginManifestCatalogSnapshot,
  trigger = 'diagnostics-refresh'
): Promise<RuntimeEventEnvelope> {
  return emitRuntimeEvent({
    event: 'plugin.catalog.snapshot.created',
    data: buildPluginManifestCatalogRuntimeEventData(snapshot, trigger),
  })
}

export function createPluginManifestFromWorkflowSkill(skill: SkillDefinition, now = Date.now()): PluginManifest {
  const workflowId = extractWorkflowIdFromSkill(skill)
  const workflows = extractWorkflowDefinitionsFromSkillSnapshot(skill)
  const workflow = workflowId ? workflows.find((item) => item.id === workflowId) : workflows[0]
  const reviewState: PluginReviewState = isWorkflowSkillLocallyApproved(skill)
    ? 'approved'
    : isWorkflowSkillReviewRequired(skill)
      ? 'unreviewed'
      : 'unreviewed'
  const disabledByState = getWorkflowSkillState(skill) === 'disabled' || isWorkflowSkillImportReviewRequired(skill)
  return sanitizePluginManifest({
    schema: PLUGIN_MANIFEST_SCHEMA,
    id: `plugin:${skill.id}`,
    name: skill.name,
    version: skill.version ?? '1.0.0',
    description: skill.description,
    enabled: !disabledByState,
    disabledReason: disabledByState ? 'workflow review required or disabled' : undefined,
    permissions: [workflow?.permissionCeiling ?? 'read-only'],
    requiredCapabilities: isWorkflowSkill(skill) ? ['agent-workflow'] : [],
    review: {
      state: reviewState,
      summary: isWorkflowSkill(skill) ? 'Workflow skill requires visible review before hook or workflow execution.' : undefined,
      reviewedAt: reviewState === 'approved' ? now : undefined,
    },
    skills: [{
      id: `skill:${skill.id}`,
      name: skill.name,
      skillId: skill.id,
      enabled: !disabledByState,
      disabledReason: disabledByState ? 'workflow review required or disabled' : undefined,
      permission: workflow?.permissionCeiling ?? 'read-only',
      requiredCapabilities: isWorkflowSkill(skill) ? ['agent-workflow'] : [],
      review: {
        state: reviewState,
        summary: isWorkflowSkill(skill) ? 'Workflow skill entry imported for visible review.' : undefined,
      },
      workflow,
      tags: skill.tags,
    }],
  }, [])
}

export function createPluginManifestFromMcpServer(server: McpServerConfig, now = Date.now()): PluginManifest {
  const permissions = Array.from(new Set([
    resolveMcpServerPermission(server.tools),
    ...server.tools.map((tool) => tool.permission).filter(isPermission),
  ]))
  const permission = permissions.reduce<WorkflowDefinitionPermission>(
    (highest, current) => PERMISSION_RANK[current] > PERMISSION_RANK[highest] ? current : highest,
    'read-only'
  )
  return sanitizePluginManifest({
    schema: PLUGIN_MANIFEST_SCHEMA,
    id: `plugin:${server.id}`,
    name: server.name,
    version: server.version && VERSION_PATTERN.test(server.version) ? server.version : '1.0.0',
    enabled: server.enabled,
    disabledReason: server.enabled ? undefined : 'mcp server disabled',
    permissions,
    requiredCapabilities: ['mcp'],
    review: {
      state: server.enabled ? 'approved' : 'unreviewed',
      summary: 'MCP server manifest reference remains permission-bound.',
      reviewedAt: server.enabled ? now : undefined,
    },
    mcp: [{
      id: `mcp:${server.id}`,
      name: server.name,
      description: server.url,
      enabled: server.enabled,
      disabledReason: server.enabled ? undefined : 'mcp server disabled',
      permission,
      requiredCapabilities: ['mcp'],
      review: {
        state: server.enabled ? 'approved' : 'unreviewed',
        summary: `${server.tools.length} tools, ${server.resources.length} resources, ${server.prompts.length} prompts`,
      },
      serverId: server.id,
      transport: server.transport,
    }],
  }, [])
}

function summarizeManifestForCatalog(manifest: PluginManifest, sourceKind: PluginManifestSourceKind, sourceId: string): PluginManifestCatalogEntry {
  const validation = validatePluginManifest(manifest)
  const sanitized = validation.sanitized
  const permissions = collectManifestPermissions(sanitized)
  const requiredCapabilities = collectManifestRequiredCapabilities(sanitized)
  const hookCount = sanitized.hooks.length
  const noopHookCount = sanitized.hooks.filter((hook) => hook.execution === 'noop').length
  return {
    manifestId: sanitized.id,
    name: sanitized.name,
    sourceKind,
    sourceId: cleanText(sourceId),
    enabled: sanitized.enabled,
    reviewState: sanitized.review.state,
    permissions,
    requiredCapabilities,
    hookCount,
    noopHookCount,
    executableHookCount: sanitized.hooks.filter((hook) => hook.enabled && hook.execution !== 'noop').length,
    errorCount: validation.errors.length,
    warningCount: validation.warnings.length,
    errors: validation.errors.slice(0, CATALOG_MESSAGE_LIMIT),
    warnings: validation.warnings.slice(0, CATALOG_MESSAGE_LIMIT),
  }
}

function collectManifestPermissions(manifest: PluginManifest): WorkflowDefinitionPermission[] {
  return Array.from(new Set([
    ...manifest.permissions,
    ...manifest.commands.map((entry) => entry.permission).filter(isPermission),
    ...manifest.agents.map((entry) => entry.permission).filter(isPermission),
    ...manifest.skills.map((entry) => entry.permission).filter(isPermission),
    ...manifest.hooks.map((entry) => entry.permission).filter(isPermission),
    ...manifest.mcp.map((entry) => entry.permission).filter(isPermission),
    ...manifest.settings.map((entry) => entry.permission).filter(isPermission),
  ])).sort((a, b) => PERMISSION_RANK[a] - PERMISSION_RANK[b])
}

function collectManifestRequiredCapabilities(manifest: PluginManifest): string[] {
  return Array.from(new Set([
    ...manifest.requiredCapabilities,
    ...manifest.commands.flatMap((entry) => entry.requiredCapabilities ?? []),
    ...manifest.agents.flatMap((entry) => entry.requiredCapabilities ?? []),
    ...manifest.skills.flatMap((entry) => entry.requiredCapabilities ?? []),
    ...manifest.hooks.flatMap((entry) => entry.requiredCapabilities ?? []),
    ...manifest.mcp.flatMap((entry) => entry.requiredCapabilities ?? []),
    ...manifest.settings.flatMap((entry) => entry.requiredCapabilities ?? []),
  ].map(cleanText).filter(Boolean))).slice(0, LIST_LIMIT)
}

function createEmptyReviewStateCounts(): Record<PluginReviewState, number> {
  return { unreviewed: 0, approved: 0, rejected: 0 }
}

function createEmptyPermissionCounts(): Record<WorkflowDefinitionPermission, number> {
  return { 'read-only': 0, 'read-write': 0, destructive: 0 }
}

function countPluginCatalogSourceKinds(entries: PluginManifestCatalogEntry[]): Record<PluginManifestSourceKind, number> {
  const counts: Record<PluginManifestSourceKind, number> = {
    skill: 0,
    'workflow-skill': 0,
    'mcp-server': 0,
    manual: 0,
  }
  for (const entry of entries) counts[entry.sourceKind] += 1
  return counts
}

function sanitizePluginManifest(input: unknown, warnings: string[]): PluginManifest {
  const record = asRecord(input) ?? {}
  const enabled = record.enabled !== false
  const hooks = sanitizeList(record.hooks).map((item, index) => sanitizeHook(item, index, warnings))
  return {
    schema: cleanText(record.schema) === PLUGIN_MANIFEST_SCHEMA ? PLUGIN_MANIFEST_SCHEMA : cleanText(record.schema) as PluginManifestSchema,
    id: cleanText(record.id),
    name: cleanText(record.name),
    version: cleanText(record.version) || '0.0.0',
    description: optionalText(record.description),
    enabled,
    disabledReason: optionalText(record.disabledReason),
    permissions: sanitizePermissionList(record.permissions),
    requiredCapabilities: sanitizeStringList(record.requiredCapabilities),
    review: sanitizeReview(record.review),
    commands: sanitizeList(record.commands).map((item, index) => sanitizeCommand(item, index, warnings)),
    agents: sanitizeList(record.agents).map((item, index) => sanitizeAgent(item, index)),
    skills: sanitizeList(record.skills).map((item, index) => sanitizeSkill(item, index)),
    hooks,
    mcp: sanitizeList(record.mcp).map((item, index) => sanitizeMcp(item, index)),
    settings: sanitizeList(record.settings).map((item, index) => sanitizeSetting(item, index)),
  }
}

function sanitizeCommand(input: unknown, index: number, warnings: string[]): PluginCommandManifest {
  const record = asRecord(input) ?? {}
  const hasInputSchema = Object.prototype.hasOwnProperty.call(record, 'inputSchema')
  return {
    ...sanitizeBase(record, `command:${index + 1}`),
    command: cleanText(record.command),
    inputSchema: hasInputSchema
      ? sanitizePluginCommandInputSchema(record.inputSchema, warnings, `commands[${index}].inputSchema`)
      : undefined,
  }
}

interface PluginCommandSchemaBudget {
  propertyCount: number
}

function sanitizePluginCommandInputSchema(
  input: unknown,
  warnings: string[],
  path: string
): PluginCommandInputSchema | undefined {
  const record = asRecord(input)
  if (!record) {
    warnings.push(`${path} was omitted because command input schemas must be objects.`)
    return undefined
  }
  const sanitized = sanitizePluginCommandSchemaRules(record, warnings, path, 0, { propertyCount: 0 })
  // Keep any catalog or UI consumer safe even when the submitted manifest is
  // invalid. validatePluginManifest still rejects a raw non-object root.
  return { ...sanitized, type: 'object' }
}

function sanitizePluginCommandSchemaRules(
  record: AnyRecord,
  warnings: string[],
  path: string,
  depth: number,
  budget: PluginCommandSchemaBudget
): PluginCommandInputSchema {
  const output: PluginCommandInputSchema = {}
  const type = sanitizePluginCommandSchemaType(record.type, warnings, `${path}.type`)
  if (type) output.type = type

  const properties = asRecord(record.properties)
  if (record.properties !== undefined && !properties) {
    warnings.push(`${path}.properties was omitted because it must be an object.`)
  }
  if (properties) {
    if (depth >= PLUGIN_COMMAND_SCHEMA_DEPTH_LIMIT) {
      warnings.push(`${path}.properties was omitted because command schema depth is limited to ${PLUGIN_COMMAND_SCHEMA_DEPTH_LIMIT}.`)
    } else {
      const sanitizedProperties: Record<string, PluginCommandInputSchema> = {}
      let propertyLimitReached = false
      for (const rawKey in properties) {
        if (!Object.prototype.hasOwnProperty.call(properties, rawKey)) continue
        if (budget.propertyCount >= PLUGIN_COMMAND_SCHEMA_PROPERTY_LIMIT) {
          if (!propertyLimitReached) {
            warnings.push(`${path}.properties was truncated to ${PLUGIN_COMMAND_SCHEMA_PROPERTY_LIMIT} declared properties.`)
            propertyLimitReached = true
          }
          break
        }
        const key = cleanPluginCommandSchemaKey(rawKey)
        if (!key) {
          warnings.push(`${path}.properties contains an empty or oversized property name that was omitted.`)
          continue
        }
        if (sanitizedProperties[key]) {
          warnings.push(`${path}.properties.${key} was duplicated after normalization and the later entry was omitted.`)
          continue
        }
        budget.propertyCount += 1
        const propertyRules = asRecord(properties[rawKey])
        if (!propertyRules) {
          warnings.push(`${path}.properties.${key} was normalized to an unconstrained property schema.`)
          sanitizedProperties[key] = {}
          continue
        }
        sanitizedProperties[key] = sanitizePluginCommandSchemaRules(propertyRules, warnings, `${path}.properties.${key}`, depth + 1, budget)
      }
      if (Object.keys(sanitizedProperties).length) output.properties = sanitizedProperties
    }
  }

  const required = sanitizePluginCommandSchemaRequired(record.required, output.properties, warnings, `${path}.required`)
  if (required.length) output.required = required

  if (typeof record.additionalProperties === 'boolean') output.additionalProperties = record.additionalProperties
  else if (record.additionalProperties !== undefined) warnings.push(`${path}.additionalProperties was omitted because it must be boolean.`)

  const enumValues = sanitizePluginCommandSchemaEnum(record.enum, warnings, `${path}.enum`)
  if (enumValues.length) output.enum = enumValues

  copyFiniteSchemaNumber(record, output, 'minimum', warnings, path)
  copyFiniteSchemaNumber(record, output, 'maximum', warnings, path)
  copySchemaLength(record, output, 'minLength', warnings, path)
  copySchemaLength(record, output, 'maxLength', warnings, path)
  copySchemaLength(record, output, 'minItems', warnings, path)
  copySchemaLength(record, output, 'maxItems', warnings, path)

  if (typeof record.pattern === 'string') {
    output.pattern = clampPluginCommandSchemaText(record.pattern, PLUGIN_COMMAND_SCHEMA_PATTERN_LIMIT, warnings, `${path}.pattern`)
  } else if (record.pattern !== undefined) {
    warnings.push(`${path}.pattern was omitted because it must be a string.`)
  }

  const itemRules = asRecord(record.items)
  if (record.items !== undefined && !itemRules) {
    warnings.push(`${path}.items was omitted because it must be an object.`)
  } else if (itemRules) {
    if (depth >= PLUGIN_COMMAND_SCHEMA_DEPTH_LIMIT) {
      warnings.push(`${path}.items was omitted because command schema depth is limited to ${PLUGIN_COMMAND_SCHEMA_DEPTH_LIMIT}.`)
    } else {
      output.items = sanitizePluginCommandSchemaRules(itemRules, warnings, `${path}.items`, depth + 1, budget)
    }
  }

  return output
}

function validatePluginCommandInputSchema(
  rawCommand: unknown,
  command: PluginCommandManifest,
  errors: string[],
  warnings: string[]
): void {
  const record = asRecord(rawCommand)
  if (!record || !Object.prototype.hasOwnProperty.call(record, 'inputSchema')) return
  const path = `commands.${command.id}.inputSchema`
  const schema = asRecord(record.inputSchema)
  if (!schema || schema.type !== 'object') {
    errors.push(`${path} must have an object root (type: object).`)
    return
  }
  validatePluginCommandSchemaRules(schema, path, 0, { propertyCount: 0 }, errors, warnings)
}

function validatePluginCommandSchemaRules(
  record: AnyRecord,
  path: string,
  depth: number,
  budget: PluginCommandSchemaBudget,
  errors: string[],
  warnings: string[]
): void {
  if (depth > PLUGIN_COMMAND_SCHEMA_DEPTH_LIMIT) {
    warnings.push(`${path} exceeds the command schema depth limit and will be omitted.`)
    return
  }
  validatePluginCommandSchemaType(record.type, `${path}.type`, errors)
  validatePluginCommandSchemaNumber(record, 'minimum', path, errors)
  validatePluginCommandSchemaNumber(record, 'maximum', path, errors)
  validatePluginCommandSchemaLength(record, 'minLength', path, errors)
  validatePluginCommandSchemaLength(record, 'maxLength', path, errors)
  validatePluginCommandSchemaLength(record, 'minItems', path, errors)
  validatePluginCommandSchemaLength(record, 'maxItems', path, errors)
  validatePluginCommandSchemaRange(record, 'minimum', 'maximum', path, errors)
  validatePluginCommandSchemaRange(record, 'minLength', 'maxLength', path, errors)
  validatePluginCommandSchemaRange(record, 'minItems', 'maxItems', path, errors)

  if (record.additionalProperties !== undefined && typeof record.additionalProperties !== 'boolean') {
    errors.push(`${path}.additionalProperties must be boolean.`)
  }
  if (record.pattern !== undefined) {
    if (typeof record.pattern !== 'string') {
      errors.push(`${path}.pattern must be a string.`)
    } else {
      if (record.pattern.length > PLUGIN_COMMAND_SCHEMA_PATTERN_LIMIT) warnings.push(`${path}.pattern will be truncated to ${PLUGIN_COMMAND_SCHEMA_PATTERN_LIMIT} characters.`)
      try {
        new RegExp(record.pattern.slice(0, PLUGIN_COMMAND_SCHEMA_PATTERN_LIMIT))
      } catch {
        errors.push(`${path}.pattern must be a valid regular expression.`)
      }
    }
  }

  validatePluginCommandSchemaEnum(record.enum, `${path}.enum`, errors, warnings)

  const properties = record.properties === undefined ? undefined : asRecord(record.properties)
  if (record.properties !== undefined && !properties) errors.push(`${path}.properties must be an object.`)
  if (properties) {
    let propertyLimitReached = false
    for (const rawKey in properties) {
      if (!Object.prototype.hasOwnProperty.call(properties, rawKey)) continue
      if (budget.propertyCount >= PLUGIN_COMMAND_SCHEMA_PROPERTY_LIMIT) {
        if (!propertyLimitReached) {
          warnings.push(`${path}.properties exceeds ${PLUGIN_COMMAND_SCHEMA_PROPERTY_LIMIT} declared properties and will be truncated.`)
          propertyLimitReached = true
        }
        break
      }
      budget.propertyCount += 1
      const propertyRules = asRecord(properties[rawKey])
      if (!propertyRules) {
        errors.push(`${path}.properties.${cleanPluginCommandSchemaKey(rawKey) || 'property'} must be an object.`)
        continue
      }
      validatePluginCommandSchemaRules(propertyRules, `${path}.properties.${cleanPluginCommandSchemaKey(rawKey) || 'property'}`, depth + 1, budget, errors, warnings)
    }
  }

  validatePluginCommandSchemaRequired(record.required, properties, `${path}.required`, errors, warnings)

  const items = record.items === undefined ? undefined : asRecord(record.items)
  if (record.items !== undefined && !items) errors.push(`${path}.items must be an object.`)
  if (items) validatePluginCommandSchemaRules(items, `${path}.items`, depth + 1, budget, errors, warnings)

  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key) || isSupportedPluginCommandSchemaKey(key)) continue
    warnings.push(`${path}.${key} is not supported by Agent tool input validation and was omitted.`)
  }
}

function sanitizePluginCommandSchemaType(input: unknown, warnings: string[], path: string): string | string[] | undefined {
  if (isPluginCommandSchemaType(input)) return input
  if (Array.isArray(input)) {
    const types = Array.from(new Set(input.filter(isPluginCommandSchemaType))).slice(0, PLUGIN_COMMAND_SCHEMA_TYPE_LIMIT)
    if (types.length !== input.length) warnings.push(`${path} was reduced to supported Agent input types.`)
    return types.length ? types : undefined
  }
  if (input !== undefined) warnings.push(`${path} was omitted because it is not a supported Agent input type.`)
  return undefined
}

function validatePluginCommandSchemaType(input: unknown, path: string, errors: string[]): void {
  if (input === undefined) return
  if (isPluginCommandSchemaType(input)) return
  if (Array.isArray(input) && input.length && input.length <= PLUGIN_COMMAND_SCHEMA_TYPE_LIMIT && input.every(isPluginCommandSchemaType)) return
  errors.push(`${path} must be a supported JSON type or a bounded list of supported JSON types.`)
}

function sanitizePluginCommandSchemaRequired(
  input: unknown,
  properties: unknown,
  warnings: string[],
  path: string
): string[] {
  if (input === undefined) return []
  if (!Array.isArray(input)) {
    warnings.push(`${path} was omitted because it must be an array.`)
    return []
  }
  const known = properties && typeof properties === 'object' && !Array.isArray(properties)
    ? new Set(Object.keys(properties))
    : new Set<string>()
  const required: string[] = []
  for (let index = 0; index < input.length && index < PLUGIN_COMMAND_SCHEMA_REQUIRED_LIMIT; index += 1) {
    const key = cleanPluginCommandSchemaKey(input[index])
    if (!key || !known.has(key)) {
      warnings.push(`${path}[${index}] was omitted because it does not name a declared property.`)
      continue
    }
    if (!required.includes(key)) required.push(key)
  }
  if (input.length > PLUGIN_COMMAND_SCHEMA_REQUIRED_LIMIT) warnings.push(`${path} was truncated to ${PLUGIN_COMMAND_SCHEMA_REQUIRED_LIMIT} entries.`)
  return required
}

function validatePluginCommandSchemaRequired(
  input: unknown,
  properties: AnyRecord | undefined,
  path: string,
  errors: string[],
  warnings: string[]
): void {
  if (input === undefined) return
  if (!Array.isArray(input)) {
    errors.push(`${path} must be an array of declared property names.`)
    return
  }
  for (let index = 0; index < input.length && index < PLUGIN_COMMAND_SCHEMA_REQUIRED_LIMIT; index += 1) {
    const key = input[index]
    if (typeof key !== 'string' || !key.trim()) {
      errors.push(`${path}[${index}] must be a non-empty property name.`)
      continue
    }
    if (!properties || !Object.prototype.hasOwnProperty.call(properties, key)) {
      errors.push(`${path}[${index}] must reference a declared property.`)
    }
  }
  if (input.length > PLUGIN_COMMAND_SCHEMA_REQUIRED_LIMIT) warnings.push(`${path} exceeds ${PLUGIN_COMMAND_SCHEMA_REQUIRED_LIMIT} entries and will be truncated.`)
}

function sanitizePluginCommandSchemaEnum(input: unknown, warnings: string[], path: string): Array<string | number | boolean | null> {
  if (input === undefined) return []
  if (!Array.isArray(input)) {
    warnings.push(`${path} was omitted because it must be an array.`)
    return []
  }
  const values: Array<string | number | boolean | null> = []
  for (let index = 0; index < input.length && index < PLUGIN_COMMAND_SCHEMA_ENUM_LIMIT; index += 1) {
    const value = input[index]
    if (!isPluginCommandSchemaLiteral(value)) {
      warnings.push(`${path}[${index}] was omitted because enum values must be JSON primitives.`)
      continue
    }
    const normalized = typeof value === 'string'
      ? clampPluginCommandSchemaText(value, PLUGIN_COMMAND_SCHEMA_TEXT_LIMIT, warnings, `${path}[${index}]`)
      : value
    if (!values.some((item) => Object.is(item, normalized))) values.push(normalized)
  }
  if (input.length > PLUGIN_COMMAND_SCHEMA_ENUM_LIMIT) warnings.push(`${path} was truncated to ${PLUGIN_COMMAND_SCHEMA_ENUM_LIMIT} entries.`)
  return values
}

function validatePluginCommandSchemaEnum(input: unknown, path: string, errors: string[], warnings: string[]): void {
  if (input === undefined) return
  if (!Array.isArray(input)) {
    errors.push(`${path} must be an array.`)
    return
  }
  for (let index = 0; index < input.length && index < PLUGIN_COMMAND_SCHEMA_ENUM_LIMIT; index += 1) {
    if (!isPluginCommandSchemaLiteral(input[index])) errors.push(`${path}[${index}] must be a JSON primitive.`)
    if (typeof input[index] === 'string' && input[index].length > PLUGIN_COMMAND_SCHEMA_TEXT_LIMIT) {
      warnings.push(`${path}[${index}] will be truncated to ${PLUGIN_COMMAND_SCHEMA_TEXT_LIMIT} characters.`)
    }
  }
  if (input.length > PLUGIN_COMMAND_SCHEMA_ENUM_LIMIT) warnings.push(`${path} exceeds ${PLUGIN_COMMAND_SCHEMA_ENUM_LIMIT} entries and will be truncated.`)
}

function copyFiniteSchemaNumber(record: AnyRecord, output: PluginCommandInputSchema, key: 'minimum' | 'maximum', warnings: string[], path: string): void {
  if (typeof record[key] === 'number' && Number.isFinite(record[key])) output[key] = record[key]
  else if (record[key] !== undefined) warnings.push(`${path}.${key} was omitted because it must be a finite number.`)
}

function copySchemaLength(
  record: AnyRecord,
  output: PluginCommandInputSchema,
  key: 'minLength' | 'maxLength' | 'minItems' | 'maxItems',
  warnings: string[],
  path: string
): void {
  const value = record[key]
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    output[key] = value
  } else if (value !== undefined) {
    warnings.push(`${path}.${key} was omitted because it must be a non-negative integer.`)
  }
}

function validatePluginCommandSchemaNumber(record: AnyRecord, key: 'minimum' | 'maximum', path: string, errors: string[]): void {
  if (record[key] !== undefined && (typeof record[key] !== 'number' || !Number.isFinite(record[key]))) {
    errors.push(`${path}.${key} must be a finite number.`)
  }
}

function validatePluginCommandSchemaLength(
  record: AnyRecord,
  key: 'minLength' | 'maxLength' | 'minItems' | 'maxItems',
  path: string,
  errors: string[]
): void {
  const value = record[key]
  if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
    errors.push(`${path}.${key} must be a non-negative integer.`)
  }
}

function validatePluginCommandSchemaRange(
  record: AnyRecord,
  minimumKey: 'minimum' | 'minLength' | 'minItems',
  maximumKey: 'maximum' | 'maxLength' | 'maxItems',
  path: string,
  errors: string[]
): void {
  const minimum = record[minimumKey]
  const maximum = record[maximumKey]
  if (typeof minimum === 'number' && typeof maximum === 'number' && Number.isFinite(minimum) && Number.isFinite(maximum) && minimum > maximum) {
    errors.push(`${path}.${minimumKey} cannot exceed ${maximumKey}.`)
  }
}

function cleanPluginCommandSchemaKey(input: unknown): string {
  return typeof input === 'string' ? input.trim().slice(0, PLUGIN_COMMAND_SCHEMA_PROPERTY_NAME_LIMIT) : ''
}

function clampPluginCommandSchemaText(input: string, limit: number, warnings: string[], path: string): string {
  if (input.length <= limit) return input
  warnings.push(`${path} was truncated to ${limit} characters.`)
  return input.slice(0, limit)
}

function isPluginCommandSchemaLiteral(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
}

function isPluginCommandSchemaType(value: unknown): value is typeof PLUGIN_COMMAND_SCHEMA_TYPES[number] {
  return typeof value === 'string' && (PLUGIN_COMMAND_SCHEMA_TYPES as readonly string[]).includes(value)
}

function isSupportedPluginCommandSchemaKey(key: string): boolean {
  return [
    'type',
    'properties',
    'required',
    'additionalProperties',
    'enum',
    'minimum',
    'maximum',
    'minLength',
    'maxLength',
    'pattern',
    'minItems',
    'maxItems',
    'items',
  ].includes(key)
}

function sanitizeAgent(input: unknown, index: number): PluginAgentManifest {
  const record = asRecord(input) ?? {}
  return {
    ...sanitizeBase(record, `agent:${index + 1}`),
    workflow: sanitizeWorkflow(record.workflow),
    skillId: optionalText(record.skillId),
  }
}

function sanitizeSkill(input: unknown, index: number): PluginSkillManifest {
  const record = asRecord(input) ?? {}
  return {
    ...sanitizeBase(record, `skill:${index + 1}`),
    skillId: cleanText(record.skillId),
    workflow: sanitizeWorkflow(record.workflow),
    tags: sanitizeStringList(record.tags),
  }
}

function sanitizeHook(input: unknown, index: number, warnings: string[]): PluginHookManifest {
  const record = asRecord(input) ?? {}
  if (record.enabled === true) warnings.push(`hooks[${index}] was disabled because hook execution is not enabled.`)
  return {
    ...sanitizeBase(record, `hook:${index + 1}`),
    point: cleanText(record.point) as PluginHookPoint,
    handlerRef: cleanText(record.handlerRef),
    enabled: false,
    disabledReason: optionalText(record.disabledReason) ?? 'hook execution is disabled pending permission and performance review',
    execution: 'noop',
  }
}

function sanitizeMcp(input: unknown, index: number): PluginMcpManifest {
  const record = asRecord(input) ?? {}
  return {
    ...sanitizeBase(record, `mcp:${index + 1}`),
    serverId: cleanText(record.serverId),
    transport: record.transport === 'sse' || record.transport === 'streamable-http' || record.transport === 'websocket' ? record.transport : undefined,
  }
}

function sanitizeSetting(input: unknown, index: number): PluginSettingManifest {
  const record = asRecord(input) ?? {}
  const valueType = ['string', 'number', 'boolean', 'json'].includes(cleanText(record.valueType))
    ? cleanText(record.valueType) as PluginSettingManifest['valueType']
    : 'json'
  return {
    ...sanitizeBase(record, `setting:${index + 1}`),
    key: cleanText(record.key),
    valueType,
    defaultValue: record.defaultValue,
  }
}

function sanitizeBase(record: AnyRecord, fallbackId: string): PluginManifestEntryBase {
  const enabled = record.enabled !== false
  return {
    id: cleanText(record.id) || fallbackId,
    name: cleanText(record.name),
    description: optionalText(record.description),
    enabled,
    disabledReason: optionalText(record.disabledReason),
    requiredCapabilities: sanitizeStringList(record.requiredCapabilities),
    permission: isPermission(record.permission) ? record.permission : undefined,
    review: sanitizeReview(record.review),
  }
}

function sanitizeReview(input: unknown): PluginManifestReview {
  const record = asRecord(input) ?? {}
  const state = REVIEW_STATES.includes(record.state as PluginReviewState) ? record.state as PluginReviewState : 'unreviewed'
  return {
    state,
    summary: optionalText(record.summary),
    reviewedAt: typeof record.reviewedAt === 'number' && Number.isFinite(record.reviewedAt) ? record.reviewedAt : undefined,
    reviewedBy: optionalText(record.reviewedBy),
  }
}

function sanitizeWorkflow(input: unknown): WorkflowDefinitionRecord | undefined {
  const decoded = decodeWorkflowDefinition(input, { redactSensitiveText })
  return decoded.ok ? decoded.definition : undefined
}

function validatePluginWorkflowEntries(
  section: 'agents' | 'skills',
  rawEntries: unknown[],
  sanitizedEntries: PluginManifestEntryBase[],
  errors: string[],
): void {
  for (let index = 0; index < rawEntries.length; index += 1) {
    const rawEntry = asRecord(rawEntries[index])
    const sanitizedEntry = sanitizedEntries[index]
    const path = `${section}[${index}].workflow`
    const hasWorkflow = Boolean(rawEntry) && Object.prototype.hasOwnProperty.call(rawEntry, 'workflow')

    if (hasWorkflow) {
      const decoded = decodeWorkflowDefinition(rawEntry?.workflow, { redactSensitiveText })
      if (!decoded.ok) {
        const details = decoded.errors.length ? decoded.errors : ['definition is invalid.']
        errors.push(...details.map((error) => `${path} ${error}`))
      }
      continue
    }

    if (sanitizedEntry?.requiredCapabilities?.includes('agent-workflow')) {
      errors.push(`${path} is required when agent-workflow capability is declared.`)
    }
  }
}

function validateEntries(section: string, entries: PluginManifestEntryBase[], errors: string[]): void {
  for (const entry of entries) validateEntry(section, entry, errors)
}

function validateEntry(section: string, entry: PluginManifestEntryBase, errors: string[]): void {
  if (!isStableId(entry.id)) errors.push(`${section}.${entry.id || 'entry'}.id must be stable.`)
  if (!entry.name) errors.push(`${section}.${entry.id}.name is required.`)
  if (entry.enabled === false && !entry.disabledReason) errors.push(`${section}.${entry.id} disabled entries must include disabledReason.`)
  if (entry.permission && !isPermission(entry.permission)) errors.push(`${section}.${entry.id}.permission is invalid.`)
}

function sanitizePermissionList(input: unknown): WorkflowDefinitionPermission[] {
  return Array.from(new Set(sanitizeList(input).filter(isPermission)))
}

function sanitizeStringList(input: unknown): string[] {
  return Array.from(new Set(sanitizeList(input).map(cleanText).filter(Boolean))).slice(0, LIST_LIMIT)
}

function sanitizeList(input: unknown): unknown[] {
  return Array.isArray(input) ? input.slice(0, LIST_LIMIT) : []
}

function cleanText(input: unknown): string {
  return typeof input === 'string' ? input.trim().slice(0, TEXT_LIMIT) : ''
}

function optionalText(input: unknown): string | undefined {
  const value = cleanText(input)
  return value || undefined
}

function asRecord(input: unknown): AnyRecord | undefined {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as AnyRecord : undefined
}

function isStableId(value: string | undefined): boolean {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

function isPermission(value: unknown): value is WorkflowDefinitionPermission {
  return PERMISSIONS.includes(value as WorkflowDefinitionPermission)
}

function resolveMcpServerPermission(tools: Array<{ permission: McpToolPermission }>): WorkflowDefinitionPermission {
  return tools.reduce<WorkflowDefinitionPermission>(
    (highest, tool) => isPermission(tool.permission) && PERMISSION_RANK[tool.permission] > PERMISSION_RANK[highest] ? tool.permission : highest,
    'read-only'
  )
}
