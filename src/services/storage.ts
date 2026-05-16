import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AIProvider, Conversation, MessageStatus, ProcessTrace, Settings } from '@/types'
import { getDefaultProviderModelIds, getModelConfig } from '@/types'
import { exportContextSnapshot, importContextSnapshot, type ContextSnapshot } from '@/services/contextStore'
import { localDataStore } from '@/services/localDataStore'

const KEYS = {
  CONVERSATIONS: '@islemind/conversations',
  SETTINGS: '@islemind/settings',
  PROVIDERS: '@islemind/providers',
  ACTIVE_CONVERSATION: '@islemind/active-conversation',
}

export interface ExportPayload {
  app: 'islemind'
  version: 1
  conversations: Conversation[]
  settings: Settings | null
  providers: AIProvider[]
  context?: ContextSnapshot
  exportedAt: number
}

export async function loadData<T>(key: keyof typeof KEYS): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS[key])
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function saveData<T>(key: keyof typeof KEYS, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS[key], JSON.stringify(data))
  } catch {
    // silently fail
  }
}

export async function removeData(key: keyof typeof KEYS): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEYS[key])
  } catch {
    // silently fail
  }
}

export async function clearAllData(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(Object.values(KEYS))
    await localDataStore.clearConversations()
  } catch {
    // silently fail
  }
}

export async function exportAllData(): Promise<string> {
  const [sqliteConversations, cachedConversations, settings, providers] = await Promise.all([
    localDataStore.loadConversations(),
    loadData<Conversation[]>('CONVERSATIONS'),
    loadData<Settings>('SETTINGS'),
    loadData<AIProvider[]>('PROVIDERS'),
  ])
  const context = await exportContextSnapshot()
  const conversations = sqliteConversations.length ? sqliteConversations : cachedConversations ?? []
  return JSON.stringify(
    {
      app: 'islemind',
      version: 1,
      conversations,
      settings,
      providers: providers ?? [],
      context,
      exportedAt: Date.now(),
    } satisfies ExportPayload,
    null,
    2
  )
}

export async function importAllData(json: string): Promise<boolean> {
  try {
    const data = JSON.parse(json)
    if (!isExportPayload(data)) {
      return false
    }
    await saveData('CONVERSATIONS', data.conversations.map(normalizeConversation))
    await localDataStore.saveConversations(data.conversations.map(normalizeConversation))
    if (data.settings) await saveData('SETTINGS', data.settings)
    await saveData('PROVIDERS', data.providers.map(normalizeProvider))
    if (data.context) await importContextSnapshot(data.context)
    return true
  } catch {
    return false
  }
}

function isExportPayload(value: unknown): value is ExportPayload {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<ExportPayload>
  if (data.app !== 'islemind') return false
  if (data.version !== 1) return false
  if (!Array.isArray(data.conversations)) return false
  if (!Array.isArray(data.providers)) return false
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
  return {
    ...conversation,
    providerModelMode: conversation.providerModelMode ?? 'inherited',
    systemPrompt: conversation.systemPrompt ?? '',
    temperature: Number.isFinite(conversation.temperature) ? conversation.temperature : 0.7,
    maxTokens: Number.isFinite(conversation.maxTokens) ? conversation.maxTokens : 4096,
    messages: conversation.messages.map((message) => ({
      ...message,
      status: normalizeMessageStatus(message.status),
      responseText: typeof message.responseText === 'string' ? message.responseText : undefined,
      reasoning: normalizeTraces(message.reasoning),
      toolCalls: normalizeTraces(message.toolCalls),
      retrievalTrace: normalizeTraces(message.retrievalTrace),
      attachments: message.attachments ?? undefined,
      usage: normalizeUsage(message.usage),
      durationMs: finiteNumber(message.durationMs),
      startedAt: finiteNumber(message.startedAt),
      completedAt: finiteNumber(message.completedAt),
      estimatedTokens: !!message.estimatedTokens || message.usage?.source === 'estimated',
    })),
    createdAt: conversation.createdAt ?? Date.now(),
    updatedAt: conversation.updatedAt ?? Date.now(),
  }
}

function normalizeTraces(traces: ProcessTrace[] | undefined): ProcessTrace[] | undefined {
  if (!Array.isArray(traces)) return undefined
  const normalized = traces
    .filter((trace) => trace && typeof trace.id === 'string' && typeof trace.title === 'string')
    .map((trace) => ({
      id: trace.id,
      type: ['reasoning', 'tool', 'retrieval', 'search', 'memory', 'knowledge', 'system'].includes(trace.type) ? trace.type : 'system',
      title: trace.title,
      content: typeof trace.content === 'string' ? trace.content : undefined,
      status: ['pending', 'running', 'done', 'error', 'skipped'].includes(trace.status) ? trace.status : 'done',
      startedAt: finiteNumber(trace.startedAt),
      completedAt: finiteNumber(trace.completedAt),
      durationMs: finiteNumber(trace.durationMs),
      metadata: trace.metadata && typeof trace.metadata === 'object' ? trace.metadata : undefined,
    }))
  return normalized.length ? normalized : undefined
}

function normalizeUsage(usage: Conversation['messages'][number]['usage']) {
  if (!usage || (usage.source !== 'provider' && usage.source !== 'estimated')) return undefined
  return {
    inputTokens: finiteNumber(usage.inputTokens),
    outputTokens: finiteNumber(usage.outputTokens),
    totalTokens: finiteNumber(usage.totalTokens),
    reasoningTokens: finiteNumber(usage.reasoningTokens),
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
  return {
    ...provider,
    apiKey: '',
    enabled: provider.enabled ?? false,
    baseUrl: provider.baseUrl?.trim() || undefined,
    models,
    credentialMode: provider.type === 'xiaomi-mimo' ? provider.credentialMode ?? 'token-plan' : provider.credentialMode,
    tokenPlanRegion: provider.type === 'xiaomi-mimo' ? provider.tokenPlanRegion ?? 'cn' : provider.tokenPlanRegion,
    wireProtocol: provider.type === 'xiaomi-mimo' ? provider.wireProtocol ?? 'openai-compatible' : provider.wireProtocol,
    modelConfigs: models.map((modelId) => getModelConfig(modelId, provider.type, provider.modelConfigs)),
    lastTestStatus: provider.lastTestStatus ?? 'idle',
    lastModelSyncStatus: provider.lastModelSyncStatus ?? 'idle',
  }
}

function normalizeProviderModels(provider: AIProvider): string[] {
  const defaultModels = provider.type === 'openai-compatible' && provider.id !== 'deepseek' ? [] : getDefaultProviderModelIds(provider.type)
  if (!provider.models.length) return defaultModels
  const defaultSet = new Set(defaultModels)
  const existing = provider.models.filter((model) => {
    const config = getModelConfig(model, provider.type, provider.modelConfigs)
    return !config.deprecated || defaultSet.has(model) || !defaultSet.size
  })
  const seen = new Set<string>()
  return [...defaultModels, ...existing].filter((model) => {
    if (seen.has(model)) return false
    seen.add(model)
    return true
  })
}
