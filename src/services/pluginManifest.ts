import type { SkillDefinition, McpServerConfig, McpToolPermission, McpTransport } from '@/types'
import type { AgentToolPermission, AgentWorkflowDefinition } from '@/services/agent/agentToolTypes'
import { listMcpServers } from '@/services/mcp'
import { listSkills } from '@/services/skills'
import { emitRuntimeEvent, type RuntimeEventEnvelope } from '@/services/runtimeEvents'
import {
  extractAgentWorkflowDefinitionsFromSkillSnapshot,
  extractAgentWorkflowIdFromSkill,
  getAgentWorkflowSkillState,
  isAgentWorkflowImportReviewRequired,
  isAgentWorkflowSkill,
  isAgentWorkflowSkillLocallyApproved,
  isAgentWorkflowSkillReviewRequired,
} from '@/services/agent/agentWorkflowSkills'

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
  permission?: AgentToolPermission
  review?: PluginManifestReview
}

export interface PluginCommandManifest extends PluginManifestEntryBase {
  command: string
}

export interface PluginAgentManifest extends PluginManifestEntryBase {
  workflow?: AgentWorkflowDefinition
  skillId?: string
}

export interface PluginSkillManifest extends PluginManifestEntryBase {
  skillId: string
  workflow?: AgentWorkflowDefinition
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
  permissions: AgentToolPermission[]
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
  permissions: AgentToolPermission[]
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
  permissions: Record<AgentToolPermission, number>
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
const PERMISSIONS: AgentToolPermission[] = ['read-only', 'read-write', 'destructive']
const REVIEW_STATES: PluginReviewState[] = ['unreviewed', 'approved', 'rejected']
const PERMISSION_RANK: Record<AgentToolPermission, number> = {
  'read-only': 0,
  'read-write': 1,
  destructive: 2,
}

export function validatePluginManifest(input: unknown): PluginManifestValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const sanitized = sanitizePluginManifest(input, warnings)

  if (sanitized.schema !== PLUGIN_MANIFEST_SCHEMA) errors.push('schema must be islemind.plugin.v1.')
  if (!isStableId(sanitized.id)) errors.push('id must be a stable plugin id.')
  if (!sanitized.name) errors.push('name is required.')
  if (!VERSION_PATTERN.test(sanitized.version)) errors.push('version must be semver.')
  if (!sanitized.enabled && !sanitized.disabledReason) errors.push('disabled plugins must include disabledReason.')
  if (!REVIEW_STATES.includes(sanitized.review.state)) errors.push('review.state is invalid.')
  for (const permission of sanitized.permissions) {
    if (!isPermission(permission)) errors.push(`permissions contains invalid value ${permission}.`)
  }
  validateEntries('commands', sanitized.commands, errors)
  validateEntries('agents', sanitized.agents, errors)
  validateEntries('skills', sanitized.skills, errors)
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
      sourceKind: isAgentWorkflowSkill(skill) ? 'workflow-skill' as const : 'skill' as const,
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
  const workflowId = extractAgentWorkflowIdFromSkill(skill)
  const workflows = extractAgentWorkflowDefinitionsFromSkillSnapshot(skill)
  const workflow = workflowId ? workflows.find((item) => item.id === workflowId) : workflows[0]
  const reviewState: PluginReviewState = isAgentWorkflowSkillLocallyApproved(skill)
    ? 'approved'
    : isAgentWorkflowSkillReviewRequired(skill)
      ? 'unreviewed'
      : 'unreviewed'
  const disabledByState = getAgentWorkflowSkillState(skill) === 'disabled' || isAgentWorkflowImportReviewRequired(skill)
  return sanitizePluginManifest({
    schema: PLUGIN_MANIFEST_SCHEMA,
    id: `plugin:${skill.id}`,
    name: skill.name,
    version: skill.version ?? '1.0.0',
    description: skill.description,
    enabled: !disabledByState,
    disabledReason: disabledByState ? 'workflow review required or disabled' : undefined,
    permissions: [workflow?.permissionCeiling ?? 'read-only'],
    requiredCapabilities: isAgentWorkflowSkill(skill) ? ['agent-workflow'] : [],
    review: {
      state: reviewState,
      summary: isAgentWorkflowSkill(skill) ? 'Workflow skill requires visible review before hook or workflow execution.' : undefined,
      reviewedAt: reviewState === 'approved' ? now : undefined,
    },
    skills: [{
      id: `skill:${skill.id}`,
      name: skill.name,
      skillId: skill.id,
      enabled: !disabledByState,
      disabledReason: disabledByState ? 'workflow review required or disabled' : undefined,
      permission: workflow?.permissionCeiling ?? 'read-only',
      requiredCapabilities: isAgentWorkflowSkill(skill) ? ['agent-workflow'] : [],
      review: {
        state: reviewState,
        summary: isAgentWorkflowSkill(skill) ? 'Workflow skill entry imported for visible review.' : undefined,
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
  const permission = permissions.reduce<AgentToolPermission>(
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

function collectManifestPermissions(manifest: PluginManifest): AgentToolPermission[] {
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

function createEmptyPermissionCounts(): Record<AgentToolPermission, number> {
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
    commands: sanitizeList(record.commands).map((item, index) => sanitizeCommand(item, index)),
    agents: sanitizeList(record.agents).map((item, index) => sanitizeAgent(item, index)),
    skills: sanitizeList(record.skills).map((item, index) => sanitizeSkill(item, index)),
    hooks,
    mcp: sanitizeList(record.mcp).map((item, index) => sanitizeMcp(item, index)),
    settings: sanitizeList(record.settings).map((item, index) => sanitizeSetting(item, index)),
  }
}

function sanitizeCommand(input: unknown, index: number): PluginCommandManifest {
  const record = asRecord(input) ?? {}
  return { ...sanitizeBase(record, `command:${index + 1}`), command: cleanText(record.command) }
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
    transport: record.transport === 'sse' || record.transport === 'websocket' ? record.transport : undefined,
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

function sanitizeWorkflow(input: unknown): AgentWorkflowDefinition | undefined {
  const record = asRecord(input)
  return record?.schema === 'islemind.agent.workflow.v1' ? record as unknown as AgentWorkflowDefinition : undefined
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

function sanitizePermissionList(input: unknown): AgentToolPermission[] {
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

function isPermission(value: unknown): value is AgentToolPermission {
  return PERMISSIONS.includes(value as AgentToolPermission)
}

function resolveMcpServerPermission(tools: Array<{ permission: McpToolPermission }>): AgentToolPermission {
  return tools.reduce<AgentToolPermission>(
    (highest, tool) => isPermission(tool.permission) && PERMISSION_RANK[tool.permission] > PERMISSION_RANK[highest] ? tool.permission : highest,
    'read-only'
  )
}
