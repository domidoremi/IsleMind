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
  sanitizeProviderUsageQueryConfiguration,
  sanitizeProviderPortableExportUrl,
} from '@/modules/providers'
import {
  parseUsagePortableSnapshot,
  type UsagePortableSnapshot,
  type UsagePortableSnapshotRepository,
} from '@/modules/diagnostics'
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
import { normalizeResponseLifecycle } from '@/modules/conversations'
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
} from '@/utils/mem0Interop'
import { safeHttpUrl } from '@/utils/networkUrlSafety'
import { sanitizeSkillForBackup } from '@/utils/skillSafety'
import type {
  PortableBackupCategory,
  PortableBackupSelection,
  PortableDataExportOptions,
  PortableDataExportPayload,
  PortableDataImportOptions,
  PortableDataImportResult,
  PortableDataLanguagePreferenceSource,
  PortableDataSerializedExport,
} from '../contracts'
import {
  createPortableBackupEnvelope,
  migratePortableBackup,
  normalizePortableBackupSelection,
  planPortableBackupRestore,
  selectPortableDataPayload,
} from './portableBackupPolicy'

const MCP_PORTABLE_TEXT_LIMIT = 240
const IMPORTED_SETTINGS_URL_FIELDS = [
  'customSearchEndpoint',
  'localModelDownloadMirrorBaseUrl',
  'observabilitySinkEndpointUrl',
  'proxyBaseUrl',
] as const satisfies readonly (keyof Settings)[]

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
  readonly selection: Required<PortableBackupSelection>
  readonly preserveSecureState: boolean
  readonly conversations: readonly Conversation[]
  readonly settings: Settings | null
  readonly languagePreferenceSource?: PortableDataLanguagePreferenceSource
  readonly providerMetadata: readonly AIProvider[]
  readonly credentialProviders: readonly AIProvider[]
  readonly skills: readonly SkillDefinition[]
  readonly mcpServers: readonly McpServerConfig[]
  readonly knowledge: Partial<PortableKnowledgeSnapshot>
  readonly usage?: UsagePortableSnapshot
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
  usage: UsagePortableSnapshotRepository
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
    const selection = normalizePortableBackupSelection(options.selection)
    const includeUsage = selection.mode === 'full' || selection.categories.includes('usage')
    const [
      conversations,
      settings,
      providers,
      skills,
      mcpServers,
      languagePreferenceSource,
      context,
      usage,
    ] = await Promise.all([
      dependencies.conversations.loadAll(),
      dependencies.records.loadSettings(),
      dependencies.records.loadProviders(),
      dependencies.records.loadSkills(),
      dependencies.records.loadMcpServers(),
      dependencies.records.loadLanguagePreferenceSource(),
      dependencies.knowledge.exportSnapshot(),
      includeUsage ? dependencies.usage.load() : Promise.resolve(undefined),
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

    const payload: PortableDataExportPayload = {
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
      ...(usage ? { usage } : {}),
      exportedAt,
    }
    return selectPortableDataPayload(payload, options.selection)
  }

  async function exportJson(
    options: PortableDataExportOptions = {},
  ): Promise<PortableDataSerializedExport> {
    const payload = await exportPayload(options)
    const serialized = options.selection
      ? createPortableBackupEnvelope(payload, options.selection, payload.exportedAt)
      : payload
    return {
      json: JSON.stringify(serialized, null, 2),
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

    const backup = migratePortableBackup(data)
    if (backup && isExportPayload(backup.payload)) {
      const payload = backup.payload
      const selection = normalizePortableBackupSelection(backup.selection)
      let importedUsage: UsagePortableSnapshot | undefined
      try {
        importedUsage = payload.usage === undefined
          ? undefined
          : parseUsagePortableSnapshot(payload.usage)
        if (
          selection.mode === 'selective' &&
          selection.categories.includes('usage') &&
          importedUsage === undefined
        ) {
          throw new Error('The selected usage snapshot is missing.')
        }
      } catch (error) {
        await dependencies.reportFailure({
          operation: 'import',
          detail: 'portableDataPayload:usage-validation',
          error,
        })
        return { ok: false, kind: 'invalid', reason: 'invalid_structure' }
      }
      try {
        throwIfPortableImportCancelled(options.signal)
        const selective = selection.mode === 'selective'
        const has = (category: PortableBackupCategory) => selection.categories.includes(category)
        const importedProviders = payload.providers.map(normalizeProvider)
        const importedConversations = payload.conversations.map(normalizeConversation)
        const importedSettings = payload.settings
          ? normalizeSettingsIdentityPreferences(
              sanitizeImportedSettingsUrls({
                ...payload.settings,
                observabilitySinkApiKeyConfigured: false,
              }),
            )
          : null
        const importedSkills = Array.isArray(payload.skills)
          ? payload.skills
              .map(normalizeSkill)
              .filter((skill): skill is SkillDefinition => Boolean(skill))
          : []
        const importedMcpServers = Array.isArray(payload.mcpServers)
          ? payload.mcpServers
              .map(normalizeMcpServer)
              .filter((server): server is McpServerConfig => Boolean(server))
          : []
        const importedTavernEntries = isRecord(payload.tavernSnapshots)
          ? Object.entries(payload.tavernSnapshots).map(([scopeId, snapshot]) => ({
              scopeId,
              snapshot: snapshot as Partial<TavernSnapshot> | undefined,
            }))
          : []

        const restoreBaseline = options.confirmRestore
          ? await loadPortableRestoreBaseline(dependencies)
          : undefined
        if (options.confirmRestore) {
          const preview = planPortableBackupRestore({
            backup,
            existing: {
              providerIds: restoreBaseline?.providers.map((provider) => provider.id),
              modelIds: restoreBaseline?.providers.flatMap(providerModelIds),
              conversationIds: restoreBaseline?.conversations.map((conversation) => conversation.id),
              workspaceIds: restoreBaseline?.workspaceIds,
              skillIds: restoreBaseline?.skills.map((skill) => skill.id),
              mcpServerIds: restoreBaseline?.mcpServers.map((server) => server.id),
            },
            conflictMode: selection.mode === 'full' ? 'replace' : 'merge',
          })
          const confirmed = await options.confirmRestore(preview)
          throwIfPortableImportCancelled(options.signal)
          if (!confirmed) return cancelledImportResult()
        }

        const [currentSettings, currentProviders, currentSkills, currentMcpServers, currentLanguageSource] = selective
          ? await Promise.all([
              has('settings') ? dependencies.records.loadSettings() : Promise.resolve(null),
              has('providers') || has('models')
                ? Promise.resolve(restoreBaseline?.providers ?? await dependencies.records.loadProviders())
                : Promise.resolve(null),
              has('skills')
                ? Promise.resolve(restoreBaseline?.skills ?? await dependencies.records.loadSkills())
                : Promise.resolve(null),
              has('mcp')
                ? Promise.resolve(restoreBaseline?.mcpServers ?? await dependencies.records.loadMcpServers())
                : Promise.resolve(null),
              has('settings') ? dependencies.records.loadLanguagePreferenceSource() : Promise.resolve('system' as const),
            ])
          : [null, null, null, null, 'system' as const]

        const normalizedProviders = selective
          ? mergeProvidersForSelectiveRestore(currentProviders ?? [], importedProviders, selection)
          : importedProviders
        const normalizedConversations = selective && has('conversations')
          ? mergeById(restoreBaseline?.conversations ?? await dependencies.conversations.loadAll(), importedConversations)
              .map(normalizeConversation)
          : importedConversations
        const settings = selective && has('settings') && importedSettings
          ? { ...(currentSettings ?? {}), ...importedSettings } as Settings
          : importedSettings
        const skills = selective && has('skills')
          ? mergeById(currentSkills ?? [], importedSkills)
          : importedSkills
        const mcpServers = selective && has('mcp')
          ? mergeById(currentMcpServers ?? [], importedMcpServers)
          : importedMcpServers
        const knowledge = selective && has('knowledge')
          ? mergeKnowledgeSnapshots(
              await dependencies.knowledge.exportSnapshot(),
              payload.context ?? {},
            )
          : payload.context ?? {}

        let tavernEntries: PortableDataApplicationImportPlan['tavernEntries'][number][] =
          importedTavernEntries
        let tavernActiveScopeLinks = isRecord(payload.tavernActiveScopes)
          ? payload.tavernActiveScopes as Record<string, string>
          : {}
        if (selective && has('workspaces')) {
          const scopeIds = restoreBaseline?.workspaceIds ?? await dependencies.workspaces.listScopeIds()
          const currentConversationIds = normalizedConversations.map((conversation) => conversation.id)
          const currentLinks = await dependencies.workspaces.exportActiveScopeLinks({
            conversationIds: currentConversationIds,
            scopeIds,
          })
          const currentEntries = await dependencies.workspaces.exportSnapshots({
            includeHiddenMemory: true,
            includePendingWritebacks: true,
            includeEmptyScopeIds: Object.values(currentLinks),
          })
          tavernEntries = mergeWorkspaceEntries(currentEntries, importedTavernEntries)
          tavernActiveScopeLinks = { ...currentLinks, ...tavernActiveScopeLinks }
        }
        const recovery = await dependencies.recovery.importApplication({
          portableSource: json,
          selection,
          preserveSecureState: selective,
          conversations: normalizedConversations,
          settings,
          languagePreferenceSource: isLanguagePreferenceSource(payload.languagePreferenceSource)
            ? payload.languagePreferenceSource
            : selective && has('settings')
              ? currentLanguageSource
              : undefined,
          providerMetadata: normalizedProviders,
          credentialProviders: payload.providers,
          skills,
          mcpServers,
          knowledge,
          usage: importedUsage,
          tavernEntries,
          tavernActiveScopeLinks,
          conversationIds: normalizedConversations.map((conversation) => conversation.id),
        }, options.signal ? { signal: options.signal } : undefined)
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

interface PortableRestoreBaseline {
  providers: AIProvider[]
  conversations: Conversation[]
  workspaceIds: string[]
  skills: SkillDefinition[]
  mcpServers: McpServerConfig[]
}

async function loadPortableRestoreBaseline(
  dependencies: PortableDataPayloadRuntimeDependencies,
): Promise<PortableRestoreBaseline> {
  const [providers, conversations, workspaceIds, skills, mcpServers] = await Promise.all([
    dependencies.records.loadProviders(),
    dependencies.conversations.loadAll(),
    dependencies.workspaces.listScopeIds(),
    dependencies.records.loadSkills(),
    dependencies.records.loadMcpServers(),
  ])
  return {
    providers: providers ?? [],
    conversations,
    workspaceIds,
    skills: skills ?? [],
    mcpServers: mcpServers ?? [],
  }
}

function providerModelIds(provider: AIProvider): string[] {
  return Array.from(new Set([
    ...provider.models,
    ...(provider.manualModels ?? []),
    ...(provider.modelConfigs ?? []).map((model) => model.id),
  ]))
}

function mergeProvidersForSelectiveRestore(
  currentProviders: readonly AIProvider[],
  importedProviders: readonly AIProvider[],
  selection: Required<PortableBackupSelection>,
): AIProvider[] {
  const restoreProviders = selection.categories.includes('providers')
  const restoreModels = selection.categories.includes('models')
  const current = currentProviders.filter(isProviderLike).map(normalizeProvider)
  if (!restoreProviders && !restoreModels) return current

  const byId = new Map(current.map((provider) => [provider.id, provider]))
  for (const imported of importedProviders) {
    const existing = byId.get(imported.id)
    if (restoreProviders && restoreModels) {
      byId.set(imported.id, imported)
      continue
    }
    if (restoreProviders) {
      byId.set(imported.id, preserveProviderModels(imported, existing))
      continue
    }
    if (existing) byId.set(imported.id, replaceProviderModels(existing, imported))
  }
  return [...byId.values()]
}

function preserveProviderModels(imported: AIProvider, existing?: AIProvider): AIProvider {
  const existingGroups = new Map(
    (existing?.credentialGroups ?? []).map((group) => [group.id, group]),
  )
  return {
    ...imported,
    models: [...(existing?.models ?? [])],
    manualModels: existing?.manualModels ? [...existing.manualModels] : undefined,
    modelAliases: existing?.modelAliases ? [...existing.modelAliases] : undefined,
    modelAvailability: existing?.modelAvailability
      ? [...existing.modelAvailability]
      : undefined,
    modelConfigs: existing?.modelConfigs ? [...existing.modelConfigs] : undefined,
    credentialGroups: imported.credentialGroups?.map((group) => ({
      ...group,
      availableModels: existingGroups.get(group.id)?.availableModels
        ? [...existingGroups.get(group.id)!.availableModels!]
        : [],
    })),
  }
}

function replaceProviderModels(existing: AIProvider, imported: AIProvider): AIProvider {
  return {
    ...existing,
    models: [...imported.models],
    manualModels: imported.manualModels ? [...imported.manualModels] : undefined,
    modelAliases: imported.modelAliases ? [...imported.modelAliases] : undefined,
    modelAvailability: imported.modelAvailability
      ? [...imported.modelAvailability]
      : undefined,
    modelConfigs: imported.modelConfigs ? [...imported.modelConfigs] : undefined,
  }
}

function mergeKnowledgeSnapshots(
  current: PortableKnowledgeSnapshot,
  imported: Partial<PortableKnowledgeSnapshot>,
): PortableKnowledgeSnapshot {
  return {
    memories: mergeById(current.memories, imported.memories ?? []),
    documents: mergeById(current.documents, imported.documents ?? []),
    chunks: mergeById(current.chunks, imported.chunks ?? []),
  }
}

function mergeWorkspaceEntries(
  current: readonly PortableDataWorkspaceExportEntry[],
  imported: readonly PortableDataApplicationImportPlan['tavernEntries'][number][],
): PortableDataApplicationImportPlan['tavernEntries'][number][] {
  const byId = new Map<string, PortableDataApplicationImportPlan['tavernEntries'][number]>()
  for (const entry of current) byId.set(entry.scopeId, entry)
  for (const entry of imported) {
    if (entry.scopeId) byId.set(entry.scopeId, entry)
  }
  return [...byId.values()]
}

function mergeById<T extends { id: string }>(
  current: readonly T[],
  imported: readonly T[],
): T[] {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of imported) byId.set(item.id, item)
  return [...byId.values()]
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
    messages: conversation.messages.map((message) => {
      const status = normalizeMessageStatus(message.status)
      const startedAt = finiteNumber(message.startedAt)
      const completedAt = finiteNumber(message.completedAt)
      const responseLifecycle = message.role === 'assistant'
        ? normalizeResponseLifecycle(
            message.responseLifecycle,
            startedAt ?? message.timestamp,
            status,
            completedAt,
          )
        : undefined
      return {
        ...message,
        status,
        responseText: typeof message.responseText === 'string'
          ? message.responseText
          : undefined,
        reasoning: normalizeTraces(message.reasoning),
        toolCalls: normalizeTraces(message.toolCalls),
        retrievalTrace: normalizeTraces(message.retrievalTrace),
        attachments: sanitizeAttachmentsForPortableData(message.attachments),
        usage: normalizeUsage(message.usage),
        durationMs: finiteNumber(message.durationMs),
        startedAt,
        completedAt,
        estimatedTokens: Boolean(message.estimatedTokens || message.usage?.source === 'estimated'),
        ...(responseLifecycle ? { responseLifecycle } : {}),
      }
    }),
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
    usageQueryConfiguration: sanitizeProviderUsageQueryConfiguration(
      provider.usageQueryConfiguration,
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
