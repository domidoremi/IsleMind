import {
  PROVIDER_PLATFORM_DEFAULT_TEMPERATURE,
  defaultProviderCredentialMode,
  defaultProviderTokenPlanRegion,
  defaultProviderWireProtocol,
  isProviderPresetId,
  isProviderWireProtocol,
  normalizeProviderPresetSelection,
  normalizeProviderPresetId,
  normalizeProviderClientCompatibilityMode,
  sanitizeProviderPortableExportUrl,
} from '@/modules/providers'
import {
  normalizeSettingsIdentityPreferences,
  sanitizeSettingsForPortableExport,
} from '@/modules/settings'
import {
  type TavernExportAudit,
  type TavernExportOptions,
  type TavernSnapshot,
} from '@/modules/workspaces'
import type { PortableKnowledgeSnapshot } from '@/modules/knowledge'
import {
  redactSensitiveText,
  sanitizeTraceMetadata,
  sanitizeTraceMetadataValue,
  type ProcessTrace,
} from '@/core'
import type { AIProvider } from '@/types/providerContracts'
import type { Conversation, MessageStatus } from '@/types/chatContracts'
import type {
  McpPromptManifest,
  McpResourceManifest,
  McpServerConfig,
  McpToolManifest,
} from '@/types/mcpContracts'
import type { Settings } from '@/types/settingsContracts'
import type { SkillDefinition } from '@/types/skillContracts'
import { getModelConfig } from '@/types/modelCatalog'
import { sanitizeProviderBaseUrl } from '@/types/providerBaseUrls'
import {
  buildProviderModelConfigsForStorage,
  pruneCredentialGroupModelsForStorage,
  pruneProviderModelsForStorage,
} from '@/utils/providerModelStorage'
import {
  clearHistoricalInjectedProviderModels,
  hasRemoteProviderModelEvidence,
} from '@/utils/providerModels'
import {
  exportMemoriesAsMem0,
  importMem0Memories,
  type Mem0MemoryEnvelope,
} from '@/utils/mem0Interop'
import { safeHttpUrl } from '@/utils/networkUrlSafety'
import { sanitizeSkillForBackup } from '@/utils/skillSafety'
import type {
  PortableDataExportOptions,
  PortableDataImportOptions,
  PortableDataImportResult,
  PortableDataSerializedExport,
} from '../contracts'

const MCP_PORTABLE_TEXT_LIMIT = 240
const IMPORTED_SETTINGS_URL_FIELDS = [
  'customSearchEndpoint',
  'localModelDownloadMirrorBaseUrl',
  'observabilitySinkEndpointUrl',
  'proxyBaseUrl',
] as const satisfies readonly (keyof Settings)[]

export type PortableDataLanguagePreferenceSource = 'system' | 'user'

export interface PortableDataExportPayload {
  app: 'islemind'
  version: 1
  conversations: Conversation[]
  settings: Settings | null
  languagePreferenceSource?: PortableDataLanguagePreferenceSource
  providers: AIProvider[]
  skills?: SkillDefinition[]
  mcpServers?: McpServerConfig[]
  context?: PortableKnowledgeSnapshot
  tavernSnapshots?: Record<string, TavernSnapshot>
  tavernSnapshotAudits?: Record<string, TavernExportAudit>
  tavernActiveScopes?: Record<string, string>
  mem0?: Mem0MemoryEnvelope
  exportedAt: number
}

export interface PortableDataRecordSourcePort {
  loadSettings(): Promise<Settings | null>
  loadProviders(): Promise<AIProvider[] | null>
  loadSkills(): Promise<SkillDefinition[] | null>
  loadMcpServers(): Promise<McpServerConfig[] | null>
  loadLanguagePreferenceSource(): Promise<PortableDataLanguagePreferenceSource>
}

export interface PortableDataConversationSourcePort {
  loadAll(): Promise<Conversation[]>
}

export interface PortableDataKnowledgePort {
  exportSnapshot(): Promise<PortableKnowledgeSnapshot>
  importMemoriesForReview(
    memories: ReturnType<typeof importMem0Memories>,
    options?: PortableDataImportOptions,
  ): Promise<void>
}

export interface PortableDataWorkspaceExportEntry {
  scopeId: string
  snapshot: TavernSnapshot
  exportAudit: TavernExportAudit
}

export interface PortableDataWorkspacePort {
  listScopeIds(): Promise<string[]>
  exportActiveScopeLinks(input: {
    conversationIds: readonly string[]
    scopeIds: readonly string[]
  }): Promise<Record<string, string>>
  exportSnapshots(input: TavernExportOptions & {
    includeEmptyScopeIds: readonly string[]
  }): Promise<PortableDataWorkspaceExportEntry[]>
}

export interface PortableDataApplicationImportPlan {
  readonly portableSource: string
  readonly conversations: readonly Conversation[]
  readonly settings: Settings | null
  readonly languagePreferenceSource?: PortableDataLanguagePreferenceSource
  readonly providerMetadata: readonly AIProvider[]
  readonly credentialProviders: readonly AIProvider[]
  readonly skills: readonly SkillDefinition[]
  readonly mcpServers: readonly McpServerConfig[]
  readonly knowledge: Partial<PortableKnowledgeSnapshot>
  readonly tavernEntries: readonly {
    readonly scopeId?: string
    readonly snapshot: Partial<TavernSnapshot> | undefined
  }[]
  readonly tavernActiveScopeLinks: Readonly<Record<string, string>>
  readonly conversationIds: readonly string[]
}

export interface PortableDataRecoveryPort {
  importApplication(
    plan: PortableDataApplicationImportPlan,
    options?: PortableDataImportOptions,
  ): Promise<{
    status: 'committed' | 'rolled_back' | 'recovery_required'
    cancellationObserved: boolean
  }>
}

export interface PortableDataPayloadFailure {
  operation: 'import'
  detail: string
  error: unknown
}

export interface PortableDataPayloadRuntimeDependencies {
  records: PortableDataRecordSourcePort
  conversations: PortableDataConversationSourcePort
  knowledge: PortableDataKnowledgePort
  workspaces: PortableDataWorkspacePort
  recovery: PortableDataRecoveryPort
  now(): number
  reportFailure(failure: PortableDataPayloadFailure): void | Promise<void>
}

export interface PortableDataPayloadRuntime {
  exportPayload(options?: PortableDataExportOptions): Promise<PortableDataExportPayload>
  exportJson(options?: PortableDataExportOptions): Promise<PortableDataSerializedExport>
  importJson(
    json: string,
    options?: PortableDataImportOptions,
  ): Promise<PortableDataImportResult>
}

export function createPortableDataPayloadRuntime(
  dependencies: PortableDataPayloadRuntimeDependencies,
): PortableDataPayloadRuntime {
  async function exportPayload(
    options: PortableDataExportOptions = {},
  ): Promise<PortableDataExportPayload> {
    const [
      conversations,
      settings,
      providers,
      skills,
      mcpServers,
      languagePreferenceSource,
      context,
    ] = await Promise.all([
      dependencies.conversations.loadAll(),
      dependencies.records.loadSettings(),
      dependencies.records.loadProviders(),
      dependencies.records.loadSkills(),
      dependencies.records.loadMcpServers(),
      dependencies.records.loadLanguagePreferenceSource(),
      dependencies.knowledge.exportSnapshot(),
    ])
    const conversationIds = conversations.map((conversation) => conversation.id)
    const allScopeIds = await dependencies.workspaces.listScopeIds()
    const linkedActiveScopes = await dependencies.workspaces.exportActiveScopeLinks({
      conversationIds,
      scopeIds: allScopeIds,
    })
    const workspaceEntries = await dependencies.workspaces.exportSnapshots({
      ...options.tavern,
      includeEmptyScopeIds: Object.values(linkedActiveScopes),
    })
    const exportedScopeIds = workspaceEntries.map((entry) => entry.scopeId)
    const activeScopes = await dependencies.workspaces.exportActiveScopeLinks({
      conversationIds,
      scopeIds: exportedScopeIds,
    })
    const exportedAt = dependencies.now()
    const normalizedConversations = conversations.map(normalizeConversation)
    const tavernSnapshots = workspaceEntries.length
      ? Object.fromEntries(workspaceEntries.map((entry) => [entry.scopeId, entry.snapshot]))
      : undefined
    const tavernSnapshotAudits = workspaceEntries.length
      ? Object.fromEntries(workspaceEntries.map((entry) => [entry.scopeId, entry.exportAudit]))
      : undefined

    return {
      app: 'islemind',
      version: 1,
      conversations: normalizedConversations,
      settings: settings ? sanitizeSettingsForPortableExport(settings) : null,
      languagePreferenceSource,
      providers: (providers ?? [])
        .filter(isProviderLike)
        .map(normalizeProvider)
        .map((provider) => ({
          ...provider,
          baseUrl: sanitizeProviderPortableExportUrl(provider.baseUrl),
        })),
      skills: (skills ?? [])
        .map(normalizeSkill)
        .filter((skill): skill is SkillDefinition => Boolean(skill)),
      mcpServers: (mcpServers ?? [])
        .map(sanitizeMcpServerForPortableExport)
        .filter((server): server is McpServerConfig => Boolean(server)),
      context,
      tavernSnapshots,
      tavernSnapshotAudits,
      tavernActiveScopes: Object.keys(activeScopes).length ? activeScopes : undefined,
      mem0: exportMemoriesAsMem0(
        context.memories,
        { app_id: 'islemind' },
        new Date(exportedAt).toISOString(),
      ),
      exportedAt,
    }
  }

  async function exportJson(
    options: PortableDataExportOptions = {},
  ): Promise<PortableDataSerializedExport> {
    const payload = await exportPayload(options)
    return {
      json: JSON.stringify(payload, null, 2),
      tavernSnapshotAudits: payload.tavernSnapshotAudits,
    }
  }

  async function importJson(
    json: string,
    options: PortableDataImportOptions = {},
  ): Promise<PortableDataImportResult> {
    if (options.signal?.aborted) return cancelledImportResult()

    let data: unknown
    try {
      data = JSON.parse(json)
    } catch (error) {
      await dependencies.reportFailure({
        operation: 'import',
        detail: 'portableDataPayload:parse',
        error,
      })
      return { ok: false, kind: 'invalid', reason: 'invalid_json' }
    }

    if (isExportPayload(data)) {
      try {
        throwIfPortableImportCancelled(options.signal)
        const normalizedProviders = data.providers.map(normalizeProvider)
        const normalizedConversations = data.conversations.map(normalizeConversation)
        const tavernEntries = isRecord(data.tavernSnapshots)
          ? Object.entries(data.tavernSnapshots).map(([scopeId, snapshot]) => ({
              scopeId,
              snapshot: snapshot as Partial<TavernSnapshot> | undefined,
            }))
          : []
        const recovery = await dependencies.recovery.importApplication({
          portableSource: json,
          conversations: normalizedConversations,
          settings: data.settings
            ? normalizeSettingsIdentityPreferences(
                sanitizeImportedSettingsUrls({
                  ...data.settings,
                  observabilitySinkApiKeyConfigured: false,
                }),
              )
            : null,
          languagePreferenceSource: isLanguagePreferenceSource(data.languagePreferenceSource)
            ? data.languagePreferenceSource
            : undefined,
          providerMetadata: normalizedProviders,
          credentialProviders: data.providers,
          skills: Array.isArray(data.skills)
            ? data.skills
                .map(normalizeSkill)
                .filter((skill): skill is SkillDefinition => Boolean(skill))
            : [],
          mcpServers: Array.isArray(data.mcpServers)
            ? data.mcpServers
                .map(normalizeMcpServer)
                .filter((server): server is McpServerConfig => Boolean(server))
            : [],
          knowledge: data.context ?? {},
          tavernEntries,
          tavernActiveScopeLinks: isRecord(data.tavernActiveScopes)
            ? data.tavernActiveScopes as Record<string, string>
            : {},
          conversationIds: normalizedConversations.map((conversation) => conversation.id),
        }, options)
        if (recovery.status !== 'committed') {
          await dependencies.reportFailure({
            operation: 'import',
            detail: `portableDataPayload:recovery:${recovery.status}`,
            error: new Error('The portable import recovery transaction did not commit.'),
          })
          return {
            ok: false,
            kind: 'invalid',
            reason: recovery.cancellationObserved
              ? 'operation_cancelled'
              : 'persistence_failed',
          }
        }
        return {
          ok: true,
          kind: 'islemind',
          conversations: normalizedConversations.length,
        }
      } catch (error) {
        await dependencies.reportFailure({
          operation: 'import',
          detail: 'portableDataPayload:persistence',
          error,
        })
        return isPortableImportCancellation(error, options.signal)
          ? cancelledImportResult()
          : { ok: false, kind: 'invalid', reason: 'persistence_failed' }
      }
    }

    if (!isMem0ImportPayload(data)) {
      return { ok: false, kind: 'invalid', reason: 'invalid_structure' }
    }

    let memories: ReturnType<typeof importMem0Memories>
    try {
      memories = importMem0Memories(data, { defaultStatus: 'pending' })
    } catch (error) {
      await dependencies.reportFailure({
        operation: 'import',
        detail: 'portableDataPayload:mem0-validation',
        error,
      })
      return { ok: false, kind: 'invalid', reason: 'invalid_structure' }
    }
    if (!memories.length) {
      return { ok: false, kind: 'invalid', reason: 'invalid_structure' }
    }

    try {
      throwIfPortableImportCancelled(options.signal)
      await dependencies.knowledge.importMemoriesForReview(memories, options)
      throwIfPortableImportCancelled(options.signal)
      return { ok: true, kind: 'mem0', memories: memories.length }
    } catch (error) {
      await dependencies.reportFailure({
        operation: 'import',
        detail: 'portableDataPayload:mem0-persistence',
        error,
      })
      return isPortableImportCancellation(error, options.signal)
        ? cancelledImportResult()
        : { ok: false, kind: 'invalid', reason: 'persistence_failed' }
    }
  }

  return Object.freeze({ exportPayload, exportJson, importJson })
}

function cancelledImportResult(): PortableDataImportResult {
  return { ok: false, kind: 'invalid', reason: 'operation_cancelled' }
}

function throwIfPortableImportCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('The portable data import was cancelled.')
  error.name = 'AbortError'
  throw error
}

function isPortableImportCancellation(error: unknown, signal?: AbortSignal): boolean {
  if (!signal?.aborted) return false
  return error === signal.reason || (error instanceof Error && error.name === 'AbortError')
}

function isMem0ImportPayload(
  value: unknown,
): value is Parameters<typeof importMem0Memories>[0] {
  if (Array.isArray(value)) return true
  if (!isRecord(value)) return false
  if (value.schema === 'islemind.mem0.v1') return Array.isArray(value.memories)
  return Array.isArray(value.memories) || Array.isArray(value.results)
}

function isExportPayload(value: unknown): value is PortableDataExportPayload {
  if (!isRecord(value)) return false
  if (value.app !== 'islemind' || value.version !== 1) return false
  if (!Array.isArray(value.conversations) || !value.conversations.every(isConversationLike)) return false
  if (!Array.isArray(value.providers) || !value.providers.every(isProviderLike)) return false
  if (value.skills !== undefined && !Array.isArray(value.skills)) return false
  if (value.mcpServers !== undefined && !Array.isArray(value.mcpServers)) return false
  if (value.tavernActiveScopes !== undefined && !isRecord(value.tavernActiveScopes)) return false
  if (value.settings !== null && value.settings !== undefined && !isRecord(value.settings)) return false
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isLanguagePreferenceSource(
  value: unknown,
): value is PortableDataLanguagePreferenceSource {
  return value === 'system' || value === 'user'
}

function isConversationLike(value: unknown): value is Conversation {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.providerId === 'string' &&
    typeof value.model === 'string' &&
    Array.isArray(value.messages) &&
    value.messages.every(isMessageLike)
}

function isMessageLike(value: unknown): value is Conversation['messages'][number] {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    typeof value.timestamp === 'number'
}

function isProviderLike(value: unknown): value is AIProvider {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.presetId === undefined || isProviderPresetId(value.presetId)) &&
    (value.detectedPresetId === undefined || isProviderPresetId(value.detectedPresetId)) &&
    (value.wireProtocol === undefined || isProviderWireProtocol(value.wireProtocol)) &&
    (
      value.type === 'openai' ||
      value.type === 'anthropic' ||
      value.type === 'google' ||
      value.type === 'openai-compatible' ||
      value.type === 'xiaomi-mimo'
    ) &&
    Array.isArray(value.models)
}

function normalizeConversation(conversation: Conversation): Conversation {
  const normalized: Conversation = {
    ...conversation,
    providerModelMode: conversation.providerModelMode ?? 'inherited',
    skillIds: stringArray(conversation.skillIds),
    skillSnapshot: isRecord(conversation.skillSnapshot)
      ? conversation.skillSnapshot
      : undefined,
    enabledTools: stringArray(conversation.enabledTools),
    knowledgeSources: stringArray(conversation.knowledgeSources),
    commandRefs: Array.isArray(conversation.commandRefs)
      ? conversation.commandRefs
      : undefined,
    systemPrompt: conversation.systemPrompt ?? '',
    temperature: Number.isFinite(conversation.temperature)
      ? conversation.temperature
      : PROVIDER_PLATFORM_DEFAULT_TEMPERATURE,
    topP: Number.isFinite(conversation.topP) ? conversation.topP : 1,
    reasoningEffort: conversation.reasoningEffort ?? 'medium',
    maxTokens: Number.isFinite(conversation.maxTokens) ? conversation.maxTokens : 4096,
    messages: conversation.messages.map((message) => ({
      ...message,
      status: normalizeMessageStatus(message.status),
      responseText: typeof message.responseText === 'string'
        ? message.responseText
        : undefined,
      reasoning: normalizeTraces(message.reasoning),
      toolCalls: normalizeTraces(message.toolCalls),
      retrievalTrace: normalizeTraces(message.retrievalTrace),
      attachments: sanitizeAttachmentsForPortableData(message.attachments),
      usage: normalizeUsage(message.usage),
      durationMs: finiteNumber(message.durationMs),
      startedAt: finiteNumber(message.startedAt),
      completedAt: finiteNumber(message.completedAt),
      estimatedTokens: Boolean(message.estimatedTokens || message.usage?.source === 'estimated'),
    })),
    createdAt: conversation.createdAt ?? Date.now(),
    updatedAt: conversation.updatedAt ?? Date.now(),
  }
  if (Object.prototype.hasOwnProperty.call(conversation, 'generationParameterOverrides')) {
    normalized.generationParameterOverrides =
      normalizeGenerationParameterOverrides(conversation.generationParameterOverrides) ?? {}
  } else {
    delete normalized.generationParameterOverrides
  }
  return normalized
}

function normalizeGenerationParameterOverrides(
  overrides: Conversation['generationParameterOverrides'],
): Conversation['generationParameterOverrides'] {
  if (!isRecord(overrides)) return undefined
  const normalized: NonNullable<Conversation['generationParameterOverrides']> = {}
  if (overrides.temperature === true) normalized.temperature = true
  if (overrides.topP === true) normalized.topP = true
  if (overrides.topK === true) normalized.topK = true
  if (overrides.maxTokens === true) normalized.maxTokens = true
  return Object.keys(normalized).length ? normalized : undefined
}

function sanitizeAttachmentsForPortableData(
  attachments: Conversation['messages'][number]['attachments'],
): Conversation['messages'][number]['attachments'] {
  if (!attachments?.length) return undefined
  return attachments.map((attachment) => ({
    ...attachment,
    uri: safeHttpUrl(attachment.uri) ?? '',
    base64: undefined,
  }))
}

function normalizeSkill(skill: SkillDefinition): SkillDefinition | null {
  if (!isRecord(skill)) return null
  if (
    skill.schema !== 'islemind.skill.v1' ||
    typeof skill.id !== 'string' ||
    typeof skill.name !== 'string'
  ) return null
  const now = Date.now()
  const safeSkill = sanitizeSkillForBackup(skill)
  return {
    ...safeSkill,
    layer: ['base', 'advanced', 'adaptive'].includes(skill.layer)
      ? skill.layer
      : 'base',
    tags: stringArray(safeSkill.tags) ?? [],
    priority: Number.isFinite(skill.priority) ? skill.priority : 0,
    systemPrompt: typeof safeSkill.systemPrompt === 'string' ? safeSkill.systemPrompt : '',
    variables: Array.isArray(safeSkill.variables) ? safeSkill.variables : undefined,
    enabledTools: stringArray(safeSkill.enabledTools),
    knowledgeSources: stringArray(safeSkill.knowledgeSources),
    createdAt: Number.isFinite(skill.createdAt) ? skill.createdAt : now,
    updatedAt: Number.isFinite(skill.updatedAt) ? skill.updatedAt : now,
  }
}

function normalizeMcpServer(server: McpServerConfig): McpServerConfig | null {
  if (!isRecord(server)) return null
  if (
    typeof server.id !== 'string' ||
    typeof server.name !== 'string' ||
    typeof server.url !== 'string'
  ) return null
  const url = server.id === 'islemind-builtins' ? server.url : safeHttpUrl(server.url)
  if (!url) return null
  const now = Date.now()
  return {
    ...server,
    transport: server.transport === 'websocket' || server.transport === 'streamable-http'
      ? server.transport
      : 'sse',
    enabled: Boolean(server.enabled),
    status: ['disconnected', 'connecting', 'connected', 'error'].includes(server.status)
      ? server.status
      : 'disconnected',
    manifestTtlMs: Number.isFinite(server.manifestTtlMs)
      ? server.manifestTtlMs
      : 6 * 60 * 60 * 1000,
    tools: Array.isArray(server.tools) ? server.tools : [],
    resources: Array.isArray(server.resources) ? server.resources : [],
    prompts: Array.isArray(server.prompts) ? server.prompts : [],
    approvedToolNames: stringArray(server.approvedToolNames) ?? [],
    url,
    createdAt: Number.isFinite(server.createdAt) ? server.createdAt : now,
    updatedAt: Number.isFinite(server.updatedAt) ? server.updatedAt : now,
  }
}

function sanitizeMcpServerForPortableExport(
  server: McpServerConfig,
): McpServerConfig | null {
  const normalized = normalizeMcpServer(server)
  if (!normalized) return null
  const url = sanitizeProviderPortableExportUrl(normalized.url) ?? normalized.url
  return {
    ...normalized,
    url,
    name: sanitizeMcpPortableText(normalized.name) || normalized.name,
    tools: normalized.tools.map((tool) =>
      sanitizeMcpToolForPortableExport(tool, normalized.id)),
    resources: normalized.resources.map((resource) =>
      sanitizeMcpResourceForPortableExport(resource, normalized.id)),
    prompts: normalized.prompts.map((prompt) =>
      sanitizeMcpPromptForPortableExport(prompt, normalized.id)),
    approvedToolNames: uniqueStrings(
      normalized.approvedToolNames
        .map((name) => sanitizeMcpPortableText(name))
        .filter((name): name is string => Boolean(name)),
    ),
    lastError: normalized.lastError
      ? sanitizeMcpPortableText(normalized.lastError)
      : undefined,
  }
}

function sanitizeMcpToolForPortableExport(
  tool: McpToolManifest,
  serverId: string,
): McpToolManifest {
  return {
    name: sanitizeMcpPortableText(tool.name) || tool.name,
    description: tool.description
      ? sanitizeMcpPortableText(tool.description)
      : undefined,
    inputSchema: sanitizeMcpSchemaForPortableExport(tool.inputSchema),
    permission: tool.permission === 'read-write' || tool.permission === 'destructive'
      ? tool.permission
      : 'read-only',
    serverId,
    enabled: tool.enabled !== false,
  }
}

function sanitizeMcpResourceForPortableExport(
  resource: McpResourceManifest,
  serverId: string,
): McpResourceManifest {
  const normalizedUri = sanitizeMcpPortableText(resource.uri) || resource.uri
  const uri = /^https?:/i.test(normalizedUri)
    ? sanitizeProviderPortableExportUrl(normalizedUri) ?? '[redacted]'
    : redactSensitiveText(normalizedUri)
  return {
    uri,
    name: resource.name ? sanitizeMcpPortableText(resource.name) : undefined,
    description: resource.description
      ? sanitizeMcpPortableText(resource.description)
      : undefined,
    mimeType: resource.mimeType
      ? sanitizeMcpPortableText(resource.mimeType)
      : undefined,
    serverId,
  }
}

function sanitizeMcpPromptForPortableExport(
  prompt: McpPromptManifest,
  serverId: string,
): McpPromptManifest {
  const sanitizedArguments = Array.isArray(prompt.arguments)
    ? prompt.arguments
        .map((argument) => sanitizeTraceMetadata(argument))
        .filter((argument): argument is Record<string, unknown> => Boolean(argument))
    : undefined
  return {
    name: sanitizeMcpPortableText(prompt.name) || prompt.name,
    description: prompt.description
      ? sanitizeMcpPortableText(prompt.description)
      : undefined,
    arguments: sanitizedArguments?.length ? sanitizedArguments : undefined,
    serverId,
  }
}

function sanitizeMcpSchemaForPortableExport(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const sanitized = sanitizeTraceMetadataValue(schema)
  return isRecord(sanitized) ? sanitized : undefined
}

function sanitizeMcpPortableText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const redacted = redactSensitiveText(value.replace(/\s+/g, ' ').trim())
  if (!redacted) return undefined
  return redacted.length > MCP_PORTABLE_TEXT_LIMIT
    ? `${redacted.slice(0, MCP_PORTABLE_TEXT_LIMIT - 3)}...`
    : redacted
}

function normalizeTraces(traces: ProcessTrace[] | undefined): ProcessTrace[] | undefined {
  if (!Array.isArray(traces)) return undefined
  const normalized = traces
    .filter((trace) => trace && typeof trace.id === 'string' && typeof trace.title === 'string')
    .map((trace) => ({
      id: trace.id,
      type: ['reasoning', 'tool', 'retrieval', 'search', 'memory', 'knowledge', 'system'].includes(trace.type)
        ? trace.type
        : 'system',
      title: redactSensitiveText(trace.title),
      content: typeof trace.content === 'string'
        ? redactSensitiveText(trace.content)
        : undefined,
      status: ['pending', 'running', 'done', 'error', 'skipped', 'cancelled'].includes(trace.status)
        ? trace.status
        : 'done',
      startedAt: finiteNumber(trace.startedAt),
      completedAt: finiteNumber(trace.completedAt),
      durationMs: finiteNumber(trace.durationMs),
      metadata: sanitizeTraceMetadata(trace.metadata),
    })) as ProcessTrace[]
  return normalized.length ? normalized : undefined
}

function normalizeUsage(usage: Conversation['messages'][number]['usage']) {
  if (!usage || (usage.source !== 'provider' && usage.source !== 'estimated')) return undefined
  const cacheCreationInputTokens = finiteNumber(usage.cacheCreationInputTokens)
  const cacheReadInputTokens = finiteNumber(usage.cacheReadInputTokens)
  const cachedInputTokens = finiteNumber(usage.cachedInputTokens)
  const reasoningTokens = finiteNumber(usage.reasoningTokens)
  return {
    inputTokens: finiteNumber(usage.inputTokens),
    outputTokens: finiteNumber(usage.outputTokens),
    totalTokens: finiteNumber(usage.totalTokens),
    ...(cacheCreationInputTokens === undefined ? {} : { cacheCreationInputTokens }),
    ...(cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    source: usage.source,
  }
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeMessageStatus(status: MessageStatus | undefined): MessageStatus {
  return status && ['sending', 'streaming', 'done', 'error', 'cancelled'].includes(status)
    ? status
    : 'done'
}

function normalizeProvider(provider: AIProvider): AIProvider {
  const models = normalizeProviderModels(provider)
  const manualModels = normalizeProviderManualModels(provider, models)
  const modelAliases = normalizeProviderModelAliases(provider)
  const presetSelection = normalizeProviderPresetSelection(provider)
  return {
    ...provider,
    presetId: presetSelection.presetId,
    detectedPresetId: provider.detectedPresetId
      ? normalizeProviderPresetId(provider.detectedPresetId)
      : presetSelection.presetId,
    apiKey: '',
    enabled: provider.enabled ?? false,
    baseUrl: sanitizeProviderBaseUrl(provider.baseUrl),
    models,
    manualModels,
    modelAliases,
    credentialMode: provider.type === 'xiaomi-mimo'
      ? defaultProviderCredentialMode(provider.credentialMode)
      : provider.credentialMode,
    tokenPlanRegion: provider.type === 'xiaomi-mimo'
      ? defaultProviderTokenPlanRegion(provider.tokenPlanRegion)
      : provider.tokenPlanRegion,
    wireProtocol: presetSelection.presetId === 'custom-endpoint'
      ? presetSelection.wireProtocol
      : provider.type === 'xiaomi-mimo'
        ? defaultProviderWireProtocol(provider.wireProtocol)
        : undefined,
    clientCompatibilityProfile: normalizeProviderClientCompatibilityMode(
      provider.clientCompatibilityProfile,
    ),
    modelConfigs: buildProviderModelConfigsForStorage(
      provider,
      models,
      manualModels,
      modelAliases,
    ),
    credentialGroups: provider.credentialGroups?.map((group, index) => ({
      ...group,
      apiKey: '',
      id: group.id || `group-${index + 1}`,
      availableModels: group.availableModels?.length
        ? pruneCredentialGroupModelsForStorage(group, provider)
        : [],
      enabled: group.enabled ?? true,
    })),
    lastTestStatus: provider.lastTestStatus ?? 'idle',
    lastModelSyncStatus: provider.lastModelSyncStatus ?? 'idle',
  }
}

function normalizeProviderModels(provider: AIProvider): string[] {
  const models = pruneProviderModelsForStorage(provider)
  const existing = models.filter((model) =>
    !getModelConfig(model, provider.type, provider.modelConfigs).deprecated)
  return uniqueStrings(existing)
}

function normalizeProviderManualModels(
  provider: AIProvider,
  normalizedModels: string[],
): string[] {
  const source = Array.isArray(provider.manualModels)
    ? provider.manualModels
    : hasRemoteProviderModelEvidence(provider)
      ? []
      : normalizedModels
  const cleaned = clearHistoricalInjectedProviderModels({ ...provider, models: source })
  return uniqueStrings(cleaned.filter((model) =>
    !getModelConfig(model, provider.type, provider.modelConfigs).deprecated))
}

function normalizeProviderModelAliases(provider: AIProvider) {
  const byAlias = new Map<string, { alias: string; model: string }>()
  for (const item of provider.modelAliases ?? []) {
    const alias = item.alias?.trim()
    const model = item.model?.trim()
    if (!alias || !model || alias === model) continue
    byAlias.set(alias.toLowerCase(), { alias, model })
  }
  return Array.from(byAlias.values())
}

function sanitizeImportedSettingsUrls(settings: Settings): Settings {
  let sanitized: Settings | undefined
  for (const field of IMPORTED_SETTINGS_URL_FIELDS) {
    const value = settings[field]
    const next = typeof value === 'string' ? safeHttpUrl(value) ?? '' : ''
    if (value === next) continue
    sanitized ??= { ...settings }
    ;(sanitized as unknown as Record<string, unknown>)[field] = next
  }
  return sanitized ?? settings
}

function stringArray(value: readonly string[] | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string')
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  return values
    .map((value) => value.trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false
      seen.add(value)
      return true
    })
}
