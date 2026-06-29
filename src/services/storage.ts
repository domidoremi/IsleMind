import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AIProvider, Conversation, McpServerConfig, MessageStatus, ProcessTrace, Settings, SkillDefinition } from '@/types'
import { getModelConfig } from '@/types'
import { exportContextSnapshot, importContextSnapshot, importMemoriesForReview, type ContextSnapshot } from '@/services/contextStore'
import { localDataStore } from '@/services/localDataStore'
import { clearHistoricalInjectedGroupModels, clearHistoricalInjectedProviderModels, hasRemoteProviderModelEvidence } from '@/utils/providerModels'
import { exportMemoriesAsMem0, importMem0Memories, type Mem0MemoryEnvelope } from '@/utils/mem0Interop'
import { defaultProviderCredentialMode, defaultProviderTokenPlanRegion, defaultProviderWireProtocol } from '@/services/ai/providerProtocolPolicy'
import { sanitizeAttachmentsForPersistence } from '@/services/attachmentContract'
import { clearKnownObservabilitySecureKeys, clearKnownSearchSecureKeys, deleteSecureApiKey, deleteSecureCredentialGroupKey, setSecureApiKey, setSecureCredentialGroupKey } from '@/services/ai/secureKey'
import { clearProviderHealthSnapshot } from '@/services/ai/providerHealthStore'
import { PROVIDER_PLATFORM_DEFAULT_TEMPERATURE } from '@/services/ai/providerParameterDefaults'
import { clearAllCompactStates } from '@/services/ai/compact/compactStateStore'
import { clearCompactUsageRecords } from '@/services/ai/compact/compactUsage'
import { clearRuntimeLog } from '@/services/runtimeLog'
import { clearLocalEmbeddingModelState, deleteDownloadedLocalEmbeddingModel, LOCAL_EMBEDDING_MODELS } from '@/services/localEmbeddingModels'
import { clearStagedApkDownloads } from '@/services/apkInstallCache'
import { normalizeMcpServerUrl } from '@/services/mcpUrlPolicy'
import { redactSensitiveText } from '@/services/agent/agentTrace'
import { sanitizeSkillForBackup } from '@/utils/skillSafety'
import { sanitizeTraceMetadata } from '@/utils/traceSafety'
import { sanitizeProviderBaseUrl } from '@/types'
import { sanitizeSettingsUrlFields } from '@/services/settingsUrlPolicy'
import { logStorageOperationFailure } from '@/services/runtimeHealthLog'
import {
  clearLanguagePreferenceSource,
  isLanguagePreferenceSource,
  loadLanguagePreferenceSource,
  saveLanguagePreferenceSource,
  type LanguagePreferenceSource,
} from '@/i18n/languagePreference'

const KEYS = {
  CONVERSATIONS: '@islemind/conversations',
  SETTINGS: '@islemind/settings',
  PROVIDERS: '@islemind/providers',
  ACTIVE_CONVERSATION: '@islemind/active-conversation',
  SKILLS: '@islemind/skills',
  MCP_SERVERS: '@islemind/mcp-servers',
}

export interface ExportPayload {
  app: 'islemind'
  version: 1
  conversations: Conversation[]
  settings: Settings | null
  languagePreferenceSource?: LanguagePreferenceSource
  providers: AIProvider[]
  skills?: SkillDefinition[]
  mcpServers?: McpServerConfig[]
  context?: ContextSnapshot
  mem0?: Mem0MemoryEnvelope
  exportedAt: number
}

export type ImportAllDataResult =
  | { ok: true; kind: 'islemind'; conversations: number }
  | { ok: true; kind: 'mem0'; memories: number }
  | { ok: false; kind: 'invalid'; reason?: 'file_too_large' }

export async function loadData<T>(key: keyof typeof KEYS): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS[key])
    return raw ? JSON.parse(raw) : null
  } catch (error) {
    await logStorageOperationFailure({ operation: 'load', storageKey: key, error })
    return null
  }
}

export async function saveData<T>(key: keyof typeof KEYS, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS[key], JSON.stringify(data))
  } catch (error) {
    await logStorageOperationFailure({ operation: 'save', storageKey: key, error })
  }
}

export async function removeData(key: keyof typeof KEYS): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEYS[key])
  } catch (error) {
    await logStorageOperationFailure({ operation: 'remove', storageKey: key, error })
  }
}

export async function clearAllData(): Promise<void> {
  try {
    const providers = await loadData<AIProvider[]>('PROVIDERS')
    await Promise.all([
      clearLanguagePreferenceSource(),
      AsyncStorage.multiRemove([...Object.values(KEYS), '@islemind/provider-health', '@islemind/local-embedding-models']),
      localDataStore.clearConversations(),
      clearProviderHealthSnapshot(),
      clearContextArtifacts(),
      clearLocalEmbeddingArtifacts(),
      clearCompactStateArtifacts(),
      clearStagedApkDownloads(),
      clearRuntimeLog(),
      clearImportedProviderSecrets(providers ?? []),
      clearKnownSearchSecureKeys(),
      clearKnownObservabilitySecureKeys(),
    ])
  } catch (error) {
    await logStorageOperationFailure({ operation: 'clear', detail: 'clearAllData', error })
  }
}

export async function exportAllData(): Promise<string> {
  const [sqliteConversations, cachedConversations, settings, providers, skills, mcpServers, languagePreferenceSource] = await Promise.all([
    localDataStore.loadConversations(),
    loadData<Conversation[]>('CONVERSATIONS'),
    loadData<Settings>('SETTINGS'),
    loadData<AIProvider[]>('PROVIDERS'),
    loadData<SkillDefinition[]>('SKILLS'),
    loadData<McpServerConfig[]>('MCP_SERVERS'),
    loadLanguagePreferenceSource(),
  ])
  const context = await exportContextSnapshot()
  const conversations = sqliteConversations.length ? sqliteConversations : cachedConversations ?? []
  const exportedAt = Date.now()
  const normalizedSettings = settings ? sanitizeSettingsUrlFields(settings) : null
  return JSON.stringify(
    {
      app: 'islemind',
      version: 1,
      conversations: conversations.map(normalizeConversation),
      settings: normalizedSettings,
      languagePreferenceSource,
      providers: (providers ?? []).filter(isProviderLike).map(normalizeProvider),
      skills: (skills ?? []).map(normalizeSkill).filter((skill): skill is SkillDefinition => Boolean(skill)),
      mcpServers: mcpServers ?? [],
      context,
      mem0: exportMemoriesAsMem0(context.memories, { app_id: 'islemind' }, new Date(exportedAt).toISOString()),
      exportedAt,
    } satisfies ExportPayload,
    null,
    2
  )
}

export async function importAllData(json: string): Promise<boolean> {
  return (await importAllDataDetailed(json)).ok
}

export async function importAllDataDetailed(json: string): Promise<ImportAllDataResult> {
  try {
    const data = JSON.parse(json)
    if (isExportPayload(data)) {
      const normalizedProviders = data.providers.map(normalizeProvider)
      const existingProviders = await loadData<AIProvider[]>('PROVIDERS')
      await clearRestoreRuntimeArtifacts()
      await saveData('CONVERSATIONS', data.conversations.map(normalizeConversation))
      await localDataStore.saveConversations(data.conversations.map(normalizeConversation))
      await saveData('SETTINGS', data.settings ? sanitizeSettingsUrlFields({ ...data.settings, observabilitySinkApiKeyConfigured: false }) : null)
      if (isLanguagePreferenceSource(data.languagePreferenceSource)) await saveLanguagePreferenceSource(data.languagePreferenceSource)
      else await clearLanguagePreferenceSource()
      await persistImportedProviderSecrets(data.providers, existingProviders ?? [])
      await saveData('PROVIDERS', normalizedProviders)
      await saveData('SKILLS', Array.isArray(data.skills) ? data.skills.map(normalizeSkill).filter(Boolean) : [])
      await saveData('MCP_SERVERS', Array.isArray(data.mcpServers) ? data.mcpServers.map(normalizeMcpServer).filter(Boolean) : [])
      await importContextSnapshot(data.context ?? {})
      return { ok: true, kind: 'islemind', conversations: data.conversations.length }
    }
    if (!isMem0ImportPayload(data)) return { ok: false, kind: 'invalid' }
    const memories = importMem0Memories(data, { defaultStatus: 'pending' })
    if (!memories.length) return { ok: false, kind: 'invalid' }
    await importMemoriesForReview(memories)
    return { ok: true, kind: 'mem0', memories: memories.length }
  } catch (error) {
    await logStorageOperationFailure({ operation: 'import', detail: 'importAllDataDetailed', error })
    return { ok: false, kind: 'invalid' }
  }
}

function isMem0ImportPayload(value: unknown): value is Parameters<typeof importMem0Memories>[0] {
  if (Array.isArray(value)) return true
  if (!value || typeof value !== 'object') return false
  const data = value as { schema?: unknown; memories?: unknown; results?: unknown }
  if (data.schema === 'islemind.mem0.v1') return Array.isArray(data.memories)
  return Array.isArray(data.memories) || Array.isArray(data.results)
}

function isExportPayload(value: unknown): value is ExportPayload {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<ExportPayload>
  if (data.app !== 'islemind') return false
  if (data.version !== 1) return false
  if (!Array.isArray(data.conversations)) return false
  if (!Array.isArray(data.providers)) return false
  if (data.skills !== undefined && !Array.isArray(data.skills)) return false
  if (data.mcpServers !== undefined && !Array.isArray(data.mcpServers)) return false
  if (data.settings !== null && data.settings !== undefined && typeof data.settings !== 'object') return false
  return data.conversations.every(isConversationLike) && data.providers.every(isProviderLike)
}

function isConversationLike(value: unknown): value is Conversation {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<Conversation>
  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.providerId === 'string' &&
    typeof item.model === 'string' &&
    Array.isArray(item.messages) &&
    item.messages.every(isMessageLike)
  )
}

function isMessageLike(value: unknown): value is Conversation['messages'][number] {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<Conversation['messages'][number]>
  return (
    typeof item.id === 'string' &&
    (item.role === 'user' || item.role === 'assistant') &&
    typeof item.content === 'string' &&
    typeof item.timestamp === 'number'
  )
}

function isProviderLike(value: unknown): value is AIProvider {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<AIProvider>
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    (item.type === 'openai' || item.type === 'anthropic' || item.type === 'google' || item.type === 'openai-compatible' || item.type === 'xiaomi-mimo') &&
    Array.isArray(item.models)
  )
}

function normalizeConversation(conversation: Conversation): Conversation {
  const normalized: Conversation = {
    ...conversation,
    providerModelMode: conversation.providerModelMode ?? 'inherited',
    skillIds: Array.isArray(conversation.skillIds) ? conversation.skillIds.filter((item) => typeof item === 'string') : undefined,
    skillSnapshot: conversation.skillSnapshot && typeof conversation.skillSnapshot === 'object' ? conversation.skillSnapshot : undefined,
    enabledTools: Array.isArray(conversation.enabledTools) ? conversation.enabledTools.filter((item) => typeof item === 'string') : undefined,
    knowledgeSources: Array.isArray(conversation.knowledgeSources) ? conversation.knowledgeSources.filter((item) => typeof item === 'string') : undefined,
    commandRefs: Array.isArray(conversation.commandRefs) ? conversation.commandRefs : undefined,
    systemPrompt: conversation.systemPrompt ?? '',
    temperature: Number.isFinite(conversation.temperature) ? conversation.temperature : PROVIDER_PLATFORM_DEFAULT_TEMPERATURE,
    topP: Number.isFinite(conversation.topP) ? conversation.topP : 1,
    reasoningEffort: conversation.reasoningEffort ?? 'medium',
    maxTokens: Number.isFinite(conversation.maxTokens) ? conversation.maxTokens : 4096,
    messages: conversation.messages.map((message) => ({
      ...message,
      status: normalizeMessageStatus(message.status),
      responseText: typeof message.responseText === 'string' ? message.responseText : undefined,
      reasoning: normalizeTraces(message.reasoning),
      toolCalls: normalizeTraces(message.toolCalls),
      retrievalTrace: normalizeTraces(message.retrievalTrace),
      attachments: sanitizeAttachmentsForPersistence(message.attachments),
      usage: normalizeUsage(message.usage),
      durationMs: finiteNumber(message.durationMs),
      startedAt: finiteNumber(message.startedAt),
      completedAt: finiteNumber(message.completedAt),
      estimatedTokens: !!message.estimatedTokens || message.usage?.source === 'estimated',
    })),
    createdAt: conversation.createdAt ?? Date.now(),
    updatedAt: conversation.updatedAt ?? Date.now(),
  }
  if (Object.prototype.hasOwnProperty.call(conversation, 'generationParameterOverrides')) {
    normalized.generationParameterOverrides = normalizeGenerationParameterOverrides(conversation.generationParameterOverrides) ?? {}
  } else {
    delete normalized.generationParameterOverrides
  }
  return normalized
}

function normalizeGenerationParameterOverrides(overrides: Conversation['generationParameterOverrides']): Conversation['generationParameterOverrides'] {
  if (!overrides || typeof overrides !== 'object') return undefined
  const normalized: Conversation['generationParameterOverrides'] = {}
  if (overrides.temperature === true) normalized.temperature = true
  if (overrides.topP === true) normalized.topP = true
  if (overrides.topK === true) normalized.topK = true
  if (overrides.maxTokens === true) normalized.maxTokens = true
  return Object.keys(normalized).length ? normalized : undefined
}

function normalizeSkill(skill: SkillDefinition): SkillDefinition | null {
  if (!skill || typeof skill !== 'object') return null
  if (skill.schema !== 'islemind.skill.v1' || typeof skill.id !== 'string' || typeof skill.name !== 'string') return null
  const now = Date.now()
  const safeSkill = sanitizeSkillForBackup(skill)
  return {
    ...safeSkill,
    layer: ['base', 'advanced', 'adaptive'].includes(skill.layer) ? skill.layer : 'base',
    tags: Array.isArray(safeSkill.tags) ? safeSkill.tags.filter((item) => typeof item === 'string') : [],
    priority: Number.isFinite(skill.priority) ? skill.priority : 0,
    systemPrompt: typeof safeSkill.systemPrompt === 'string' ? safeSkill.systemPrompt : '',
    variables: Array.isArray(safeSkill.variables) ? safeSkill.variables : undefined,
    enabledTools: Array.isArray(safeSkill.enabledTools) ? safeSkill.enabledTools.filter((item) => typeof item === 'string') : undefined,
    knowledgeSources: Array.isArray(safeSkill.knowledgeSources) ? safeSkill.knowledgeSources.filter((item) => typeof item === 'string') : undefined,
    createdAt: Number.isFinite(skill.createdAt) ? skill.createdAt : now,
    updatedAt: Number.isFinite(skill.updatedAt) ? skill.updatedAt : now,
  }
}

function normalizeMcpServer(server: McpServerConfig): McpServerConfig | null {
  if (!server || typeof server !== 'object') return null
  if (typeof server.id !== 'string' || typeof server.name !== 'string' || typeof server.url !== 'string') return null
  const url = normalizeMcpServerUrl({ id: server.id, url: server.url })
  if (!url) return null
  const now = Date.now()
  return {
    ...server,
    transport: server.transport === 'websocket' ? 'websocket' : 'sse',
    enabled: !!server.enabled,
    status: ['disconnected', 'connecting', 'connected', 'error'].includes(server.status) ? server.status : 'disconnected',
    manifestTtlMs: Number.isFinite(server.manifestTtlMs) ? server.manifestTtlMs : 6 * 60 * 60 * 1000,
    tools: Array.isArray(server.tools) ? server.tools : [],
    resources: Array.isArray(server.resources) ? server.resources : [],
    prompts: Array.isArray(server.prompts) ? server.prompts : [],
    approvedToolNames: Array.isArray(server.approvedToolNames) ? server.approvedToolNames.filter((item) => typeof item === 'string') : [],
    url,
    createdAt: Number.isFinite(server.createdAt) ? server.createdAt : now,
    updatedAt: Number.isFinite(server.updatedAt) ? server.updatedAt : now,
  }
}

function normalizeTraces(traces: ProcessTrace[] | undefined): ProcessTrace[] | undefined {
  if (!Array.isArray(traces)) return undefined
  const normalized = traces
    .filter((trace) => trace && typeof trace.id === 'string' && typeof trace.title === 'string')
    .map((trace) => ({
      id: trace.id,
      type: ['reasoning', 'tool', 'retrieval', 'search', 'memory', 'knowledge', 'system'].includes(trace.type) ? trace.type : 'system',
      title: redactSensitiveText(trace.title),
      content: typeof trace.content === 'string' ? redactSensitiveText(trace.content) : undefined,
      status: ['pending', 'running', 'done', 'error', 'skipped', 'cancelled'].includes(trace.status) ? trace.status : 'done',
      startedAt: finiteNumber(trace.startedAt),
      completedAt: finiteNumber(trace.completedAt),
      durationMs: finiteNumber(trace.durationMs),
      metadata: sanitizeTraceMetadata(trace.metadata),
    }))
  return normalized.length ? normalized : undefined
}

function normalizeUsage(usage: Conversation['messages'][number]['usage']) {
  if (!usage || (usage.source !== 'provider' && usage.source !== 'estimated')) return undefined
  const cachedInputTokens = finiteNumber(usage.cachedInputTokens)
  const reasoningTokens = finiteNumber(usage.reasoningTokens)
  return {
    inputTokens: finiteNumber(usage.inputTokens),
    outputTokens: finiteNumber(usage.outputTokens),
    totalTokens: finiteNumber(usage.totalTokens),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    source: usage.source,
  }
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeMessageStatus(status: MessageStatus | undefined): MessageStatus {
  return status && ['sending', 'streaming', 'done', 'error', 'cancelled'].includes(status) ? status : 'done'
}

function normalizeProvider(provider: AIProvider): AIProvider {
  const models = normalizeProviderModels(provider)
  const manualModels = normalizeProviderManualModels(provider, models)
  const modelAliases = normalizeProviderModelAliases(provider)
  return {
    ...provider,
    apiKey: '',
    enabled: provider.enabled ?? false,
    baseUrl: sanitizeProviderBaseUrl(provider.baseUrl),
    models,
    manualModels,
    modelAliases,
    credentialMode: provider.type === 'xiaomi-mimo' ? defaultProviderCredentialMode(provider.credentialMode) : provider.credentialMode,
    tokenPlanRegion: provider.type === 'xiaomi-mimo' ? defaultProviderTokenPlanRegion(provider.tokenPlanRegion) : provider.tokenPlanRegion,
    wireProtocol: provider.type === 'xiaomi-mimo' ? defaultProviderWireProtocol(provider.wireProtocol) : provider.wireProtocol,
    modelConfigs: uniqueStrings([...models, ...manualModels, ...modelAliases.map((item) => item.model)]).map((modelId) => getModelConfig(modelId, provider.type, provider.modelConfigs)),
    credentialGroups: provider.credentialGroups?.map((group, index) => ({
      ...group,
      apiKey: '',
      id: group.id || `group-${index + 1}`,
      availableModels: group.availableModels?.length ? clearHistoricalInjectedGroupModels(group, provider) : [],
      enabled: group.enabled ?? true,
    })),
    lastTestStatus: provider.lastTestStatus ?? 'idle',
    lastModelSyncStatus: provider.lastModelSyncStatus ?? 'idle',
  }
}

async function persistImportedProviderSecrets(providers: AIProvider[], existingProviders: AIProvider[]): Promise<void> {
  const importedIds = new Set(providers.map((provider) => provider.id))
  const tasks: Promise<void>[] = []

  for (const existing of existingProviders) {
    if (!importedIds.has(existing.id)) {
      tasks.push(deleteSecureApiKey(existing.id))
      for (const group of existing.credentialGroups ?? []) {
        tasks.push(deleteSecureCredentialGroupKey(existing.id, group.id))
      }
    }
  }

  for (const provider of providers) {
    const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey.trim() : ''
    tasks.push(apiKey ? setSecureApiKey(provider.id, apiKey) : deleteSecureApiKey(provider.id))

    const importedGroupIds = new Set<string>()
    for (const [index, group] of (provider.credentialGroups ?? []).entries()) {
      const groupId = group.id || `group-${index + 1}`
      importedGroupIds.add(groupId)
      const groupKey = typeof group.apiKey === 'string' ? group.apiKey.trim() : ''
      tasks.push(groupKey ? setSecureCredentialGroupKey(provider.id, groupId, groupKey) : deleteSecureCredentialGroupKey(provider.id, groupId))
    }

    const previous = existingProviders.find((item) => item.id === provider.id)
    for (const group of previous?.credentialGroups ?? []) {
      if (!importedGroupIds.has(group.id)) {
        tasks.push(deleteSecureCredentialGroupKey(provider.id, group.id))
      }
    }
  }

  await Promise.all(tasks)
}

async function clearImportedProviderSecrets(providers: AIProvider[]): Promise<void> {
  const tasks: Promise<void>[] = []
  for (const provider of providers) {
    tasks.push(deleteSecureApiKey(provider.id))
    for (const group of provider.credentialGroups ?? []) {
      tasks.push(deleteSecureCredentialGroupKey(provider.id, group.id))
    }
  }
  await Promise.all(tasks)
}

async function clearContextArtifacts(): Promise<void> {
  await importContextSnapshot({ memories: [], documents: [], chunks: [] })
}

async function clearLocalEmbeddingArtifacts(): Promise<void> {
  await Promise.all(LOCAL_EMBEDDING_MODELS.map((model) => deleteDownloadedLocalEmbeddingModel(model.id).catch(() => undefined)))
  await clearLocalEmbeddingModelState()
}

async function clearCompactStateArtifacts(): Promise<void> {
  clearCompactUsageRecords()
  await clearAllCompactStates()
}

async function clearRestoreRuntimeArtifacts(): Promise<void> {
  await Promise.all([
    clearProviderHealthSnapshot(),
    clearAllCompactStates(),
    clearKnownSearchSecureKeys(),
    clearKnownObservabilitySecureKeys(),
    clearRuntimeLog(),
  ])
  clearCompactUsageRecords()
}

function normalizeProviderModels(provider: AIProvider): string[] {
  const models = clearHistoricalInjectedProviderModels(provider)
  const existing = models.filter((model) => {
    const config = getModelConfig(model, provider.type, provider.modelConfigs)
    return !config.deprecated
  })
  const seen = new Set<string>()
  return existing.filter((model) => {
    if (seen.has(model)) return false
    seen.add(model)
    return true
  })
}

function normalizeProviderManualModels(provider: AIProvider, normalizedModels: string[]): string[] {
  const source = Array.isArray(provider.manualModels) ? provider.manualModels : hasRemoteProviderModelEvidence(provider) ? [] : normalizedModels
  const cleaned = clearHistoricalInjectedProviderModels({ ...provider, models: source })
  return uniqueStrings(cleaned.filter((model) => !getModelConfig(model, provider.type, provider.modelConfigs).deprecated))
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

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  return values
    .map((value) => value.trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false
      seen.add(value)
      return true
    })
}
