import { create } from 'zustand'
import type {
  Conversation,
  ConversationGenerationParameterKey,
  ConversationGenerationParameterOverrides,
  Message,
  ProcessTrace,
} from '@/types'
import { getModelConfig } from '@/types'
import { loadData, saveData } from '@/services/storage'
import { localDataStore } from '@/services/localDataStore'
import { st } from '@/i18n/service'
import { resolveProviderModelAliasAccess } from '@/services/ai/policy/providerModelAccess'
import { getReasoningEffortOptions } from '@/utils/modelReasoning'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { sanitizeProcessTraceForBoundary, sanitizeProcessTracesForBoundary } from '@/utils/traceSafety'
import { sanitizeAttachmentsForPersistence } from '@/services/attachmentContract'
import { abortAllStreams, abortStream } from '@/services/chatStreamLifecycle'
import { sanitizeMessageInternalOutput } from '@/services/chatInternalOutputGuard'
import { PROVIDER_PLATFORM_DEFAULT_TEMPERATURE } from '@/services/ai/providerParameterDefaults'
import {
  clampConversationGenerationParameter,
  conversationGenerationParameterDiffersFromDefault,
  resolveConversationGenerationParameterDefault,
  resolveConversationGenerationParameterRanges,
  type ConversationGenerationParameterRanges,
} from '@/services/ai/conversationGenerationParameters'
import { useSettingsStore } from './settingsStore'

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function generateTitle(content: string): string {
  return content.slice(0, 50).replace(/\n/g, ' ') + (content.length > 50 ? '...' : '')
}

function selectSupportedReasoningEffort(
  requested: Conversation['reasoningEffort'],
  options: NonNullable<Conversation['reasoningEffort']>[]
): Conversation['reasoningEffort'] {
  if (!options.length) return undefined
  if (requested === undefined) return undefined
  if (requested && options.includes(requested)) return requested
  if (options.includes('medium')) return 'medium'
  return options.find((effort) => effort !== 'none' && effort !== 'minimal') ?? options[0]
}

function resolveConversationDefaultTemperature(
  settings: ReturnType<typeof useSettingsStore.getState>['settings'],
  ranges: ConversationGenerationParameterRanges
): number {
  return resolveConversationGenerationParameterDefault('temperature', ranges, { temperature: settings.defaultTemperature }) ?? DEFAULT_CONVERSATION_TEMPERATURE
}

function resolveConversationDefaultMaxTokens(
  settings: ReturnType<typeof useSettingsStore.getState>['settings'],
  ranges: ConversationGenerationParameterRanges
): number {
  return resolveConversationGenerationParameterDefault('maxTokens', ranges, { maxTokens: settings.defaultMaxTokens }) ?? ranges.maxTokens.max
}

function hasOwnProperty(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function compactGenerationParameterOverrides(
  overrides: ConversationGenerationParameterOverrides | undefined,
  preserveEmpty = false
): ConversationGenerationParameterOverrides | undefined {
  if (!overrides || typeof overrides !== 'object') return preserveEmpty ? {} : undefined
  const next: ConversationGenerationParameterOverrides = {}
  for (const key of GENERATION_PARAMETER_KEYS) {
    if (overrides[key] === true) next[key] = true
  }
  return Object.keys(next).length || preserveEmpty ? next : undefined
}

function resolveConversationParameterRanges(
  conversation: Conversation,
  providers: ReturnType<typeof useSettingsStore.getState>['providers']
): ConversationGenerationParameterRanges {
  const provider = providers.find((item) => item.id === conversation.providerId)
  const upstreamModel = provider ? resolveProviderModelAlias(provider, conversation.model) : conversation.model
  const modelConfig = getModelConfig(upstreamModel, provider?.type, provider?.modelConfigs)
  return resolveConversationGenerationParameterRanges({
    provider,
    model: upstreamModel,
    reasoningEffort: conversation.reasoningEffort,
    temperature: conversation.temperature,
    topP: conversation.topP,
    topK: conversation.topK,
    maxTokens: conversation.maxTokens,
    modelConfig,
  })
}

function getConversationGenerationParameterValue(
  conversation: Pick<Conversation, ConversationGenerationParameterKey>,
  key: ConversationGenerationParameterKey
): number | undefined {
  const value = conversation[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function generationParameterDiffersFromDefault(
  key: ConversationGenerationParameterKey,
  value: number | undefined,
  settings: ReturnType<typeof useSettingsStore.getState>['settings'],
  ranges: ConversationGenerationParameterRanges
): boolean {
  return conversationGenerationParameterDiffersFromDefault(key, value, ranges, {
    temperature: settings.defaultTemperature,
    maxTokens: settings.defaultMaxTokens,
  })
}

function inferGenerationParameterOverrides(
  conversation: Conversation,
  settings: ReturnType<typeof useSettingsStore.getState>['settings'],
  ranges: ConversationGenerationParameterRanges
): ConversationGenerationParameterOverrides | undefined {
  const inferred: ConversationGenerationParameterOverrides = {}
  for (const key of GENERATION_PARAMETER_KEYS) {
    if (generationParameterDiffersFromDefault(key, getConversationGenerationParameterValue(conversation, key), settings, ranges)) {
      inferred[key] = true
    }
  }
  return compactGenerationParameterOverrides(inferred)
}

function resolveStoredGenerationParameterOverrides(
  conversation: Conversation,
  settings: ReturnType<typeof useSettingsStore.getState>['settings'],
  ranges: ConversationGenerationParameterRanges
): ConversationGenerationParameterOverrides | undefined {
  if (hasOwnProperty(conversation, 'generationParameterOverrides')) {
    return compactGenerationParameterOverrides(conversation.generationParameterOverrides, true)
  }
  return inferGenerationParameterOverrides(conversation, settings, ranges)
}

function mergeGenerationParameterOverrides(
  conversation: Conversation,
  updates: Partial<Conversation>,
  settings: ReturnType<typeof useSettingsStore.getState>['settings'],
  providers: ReturnType<typeof useSettingsStore.getState>['providers']
): ConversationGenerationParameterOverrides | undefined {
  const ranges = resolveConversationParameterRanges(conversation, providers)
  const explicitOverrides = updates.generationParameterOverrides
  const merged: ConversationGenerationParameterOverrides = {
    ...(resolveStoredGenerationParameterOverrides(conversation, settings, ranges) ?? {}),
  }

  for (const key of GENERATION_PARAMETER_KEYS) {
    if (explicitOverrides && hasOwnProperty(explicitOverrides, key)) {
      if (explicitOverrides[key] === true) {
        merged[key] = true
      } else {
        delete merged[key]
      }
      continue
    }
    if (hasOwnProperty(updates, key)) {
      const value = getConversationGenerationParameterValue(updates as Pick<Conversation, ConversationGenerationParameterKey>, key)
      if (generationParameterDiffersFromDefault(key, value, settings, ranges)) {
        merged[key] = true
      } else {
        delete merged[key]
      }
    }
  }

  return compactGenerationParameterOverrides(merged, true)
}

function updateContainsGenerationParameterPatch(updates: Partial<Conversation>): boolean {
  return hasOwnProperty(updates, 'generationParameterOverrides') ||
    GENERATION_PARAMETER_KEYS.some((key) => hasOwnProperty(updates, key))
}

interface ChatState {
  conversations: Conversation[]
  currentId: string | null
  isLoading: boolean
  error: string | null

  load: () => Promise<void>
  create: (providerId: string, model: string) => string
  createLocalSetupConversation: () => string
  select: (id: string) => void
  delete: (id: string) => void
  rename: (id: string, title: string) => void
  updateConversation: (id: string, updates: Partial<Conversation>) => void
  switchConversationModel: (id: string, providerId: string, model: string) => boolean
  removeMessage: (convId: string, msgId: string) => void
  trimAfterMessage: (convId: string, msgId: string) => void
  addMessage: (convId: string, message: Message) => void
  updateMessage: (convId: string, msgId: string, updates: Partial<Message>) => void
  upsertMessageTrace: (convId: string, msgId: string, trace: ProcessTrace) => void
  appendContent: (convId: string, msgId: string, content: string) => void
  commitStreamingContent: (convId: string, msgId: string, content: string) => void
  commitStreamingTraceSnapshot: (
    convId: string,
    msgId: string,
    traces: Pick<Message, 'reasoning' | 'toolCalls' | 'retrievalTrace'>
  ) => void
  persistStreamingContentSnapshot: (convId: string, msgId: string, content: string) => void
  flushStreamingMessage: (convId: string, msgId: string) => Promise<void>
  setError: (error: string | null) => void
  clearAll: () => void
  importData: (conversations: Conversation[]) => void
  getCurrent: () => Conversation | null
}

const ACTIVE_CONVERSATION_KEY = 'ACTIVE_CONVERSATION'
const DEFAULT_CONVERSATION_TEMPERATURE = PROVIDER_PLATFORM_DEFAULT_TEMPERATURE
const DEFAULT_CONVERSATION_REASONING_EFFORT: Conversation['reasoningEffort'] = 'low'
const GENERATION_PARAMETER_KEYS = ['temperature', 'topP', 'topK', 'maxTokens'] as const satisfies readonly ConversationGenerationParameterKey[]

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentId: null,
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true })
    const sqliteData = await localDataStore.loadConversations()
    if (sqliteData.length) {
      const conversations = prepareConversationsForStore(sqliteData)
      const currentId = await loadData<string | null>(ACTIVE_CONVERSATION_KEY)
      const selectedId = conversations.some((conversation) => conversation.id === currentId) ? currentId : conversations[0]?.id ?? null
      set({
        conversations,
        currentId: selectedId,
        isLoading: false,
      })
      void saveData(ACTIVE_CONVERSATION_KEY, selectedId)
      return
    }

    const data = await loadData<Conversation[]>('CONVERSATIONS')
    if (data?.length) {
      const conversations = prepareConversationsForStore(data)
      const currentId = await loadData<string | null>(ACTIVE_CONVERSATION_KEY)
      const selectedId = conversations.some((conversation) => conversation.id === currentId) ? currentId : conversations[0]?.id ?? null
      set({
        conversations,
        currentId: selectedId,
        isLoading: false,
      })
      void saveData(ACTIVE_CONVERSATION_KEY, selectedId)
      void persistConversations(conversations)
      return
    }

    set({ isLoading: false })
    void hydrateSqliteConversationsInBackground()
  },

  create: (providerId: string, model: string) => {
    const id = generateId()
    const { settings, providers } = useSettingsStore.getState()
    const provider = providers.find((item) => item.id === providerId)
    const upstreamModel = provider ? resolveProviderModelAlias(provider, model) : model
    const modelConfig = getModelConfig(upstreamModel, provider?.type, provider?.modelConfigs)
    const reasoningOptions = getReasoningEffortOptions(provider, upstreamModel)
    const defaultReasoningEffort = selectSupportedReasoningEffort(DEFAULT_CONVERSATION_REASONING_EFFORT, reasoningOptions)
    const parameterRanges = resolveConversationGenerationParameterRanges({
      provider,
      model: upstreamModel,
      reasoningEffort: defaultReasoningEffort,
      modelConfig,
    })
    const conversation: Conversation = {
      id,
      title: '',
      providerId,
      model,
      providerModelMode: 'inherited',
      systemPrompt: '',
      temperature: resolveConversationDefaultTemperature(settings, parameterRanges),
      topP: resolveConversationGenerationParameterDefault('topP', parameterRanges) ?? 1,
      reasoningEffort: defaultReasoningEffort,
      maxTokens: resolveConversationDefaultMaxTokens(settings, parameterRanges),
      generationParameterOverrides: {},
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    conversation.maxTokens = resolveConversationDefaultMaxTokens(settings, parameterRanges)
    set((state) => {
      const updated = [conversation, ...state.conversations]
      void persistConversations(updated)
      void saveData(ACTIVE_CONVERSATION_KEY, id)
      return { conversations: updated, currentId: id }
    })
    return id
  },

  createLocalSetupConversation: () => {
    const id = generateId()
    const conversation: Conversation = {
      id,
      title: st('chatRunner.setup.guideTitle'),
      providerId: 'local-setup',
      model: 'local-guide',
      providerModelMode: 'inherited',
      systemPrompt: '',
      temperature: DEFAULT_CONVERSATION_TEMPERATURE,
      maxTokens: 1024,
      generationParameterOverrides: {},
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    set((state) => {
      const updated = [conversation, ...state.conversations]
      void persistConversations(updated)
      void saveData(ACTIVE_CONVERSATION_KEY, id)
      return { conversations: updated, currentId: id }
    })
    return id
  },

  select: (id: string) => {
    set({ currentId: id })
    void saveData(ACTIVE_CONVERSATION_KEY, id)
  },

  delete: (id: string) => {
    abortStream(id)
    set((state) => {
      const updated = state.conversations.filter((c) => c.id !== id)
      void persistConversations(updated)
      const nextCurrentId = state.currentId === id ? updated[0]?.id ?? null : state.currentId
      void saveData(ACTIVE_CONVERSATION_KEY, nextCurrentId)
      return {
        conversations: updated,
        currentId: nextCurrentId,
      }
    })
  },

  rename: (id: string, title: string) => {
    set((state) => {
      const updated = state.conversations.map((c) =>
        c.id === id ? { ...c, title, updatedAt: Date.now() } : c
      )
      void persistConversations(updated)
      return { conversations: updated }
    })
  },

  updateConversation: (id: string, updates: Partial<Conversation>) => {
    const shouldMergeParameterOverrides = updateContainsGenerationParameterPatch(updates)
    const { providers, settings } = useSettingsStore.getState()
    set((state) => {
      const updated = state.conversations.map((c) => {
        if (c.id !== id) return c
        const next: Conversation = { ...c, ...updates, updatedAt: Date.now() }
        if (shouldMergeParameterOverrides) {
          const generationParameterOverrides = mergeGenerationParameterOverrides(c, updates, settings, providers)
          if (generationParameterOverrides) {
            next.generationParameterOverrides = generationParameterOverrides
          } else {
            delete next.generationParameterOverrides
          }
        }
        return next
      })
      void persistConversations(updated)
      return { conversations: updated }
    })
  },

  switchConversationModel: (id: string, providerId: string, model: string) => {
    const nextModel = model.trim()
    if (!nextModel) return false
    const { providers, settings } = useSettingsStore.getState()
    const provider = providers.find((item) => item.id === providerId)
    if (!provider) {
      set({ error: st('chat.providerMissingDescription', { providerId }) })
      return false
    }
    const access = resolveProviderModelAliasAccess({ provider, model: nextModel, settings })
    if (!access.allowed) {
      set({ error: st('chat.modelSwitchBlockedMessage', { model: nextModel, provider: provider.name }) })
      return false
    }
    const upstreamModel = resolveProviderModelAlias(provider, nextModel)
    const modelConfig = getModelConfig(upstreamModel, provider.type, provider.modelConfigs)
    const reasoningOptions = getReasoningEffortOptions(provider, upstreamModel)
    set((state) => {
      const updated = state.conversations.map((c) => {
        if (c.id !== id) return c
        const currentProvider = providers.find((item) => item.id === c.providerId)
        const currentUpstreamModel = currentProvider ? resolveProviderModelAlias(currentProvider, c.model) : c.model
        const currentModelConfig = getModelConfig(currentUpstreamModel, currentProvider?.type, currentProvider?.modelConfigs)
        const currentRanges = resolveConversationGenerationParameterRanges({
          provider: currentProvider,
          model: currentUpstreamModel,
          reasoningEffort: c.reasoningEffort,
          temperature: c.temperature,
          topP: c.topP,
          topK: c.topK,
          maxTokens: c.maxTokens,
          modelConfig: currentModelConfig,
        })
        const currentOverrides = resolveStoredGenerationParameterOverrides(c, settings, currentRanges)
        const nextReasoningEffort = selectSupportedReasoningEffort(c.reasoningEffort, reasoningOptions)
        const nextRanges = resolveConversationGenerationParameterRanges({
          provider,
          model: upstreamModel,
          reasoningEffort: nextReasoningEffort,
          temperature: c.temperature,
          topP: c.topP,
          topK: c.topK,
          maxTokens: c.maxTokens,
          modelConfig,
        })
        const nextMaxTokens = currentOverrides?.maxTokens === true
          ? clampConversationGenerationParameter('maxTokens', c.maxTokens, nextRanges) ?? resolveConversationDefaultMaxTokens(settings, nextRanges)
          : resolveConversationDefaultMaxTokens(settings, nextRanges)
        const nextTemperature = currentOverrides?.temperature === true
          ? clampConversationGenerationParameter('temperature', c.temperature, nextRanges) ?? resolveConversationDefaultTemperature(settings, nextRanges)
          : resolveConversationDefaultTemperature(settings, nextRanges)
        const nextTopP = currentOverrides?.topP === true
          ? clampConversationGenerationParameter('topP', c.topP, nextRanges) ?? resolveConversationGenerationParameterDefault('topP', nextRanges) ?? 1
          : resolveConversationGenerationParameterDefault('topP', nextRanges) ?? 1
        const nextTopK = currentOverrides?.topK === true
          ? clampConversationGenerationParameter('topK', c.topK, nextRanges)
          : undefined
        const nextGenerationParameterOverrides = compactGenerationParameterOverrides({
          temperature: currentOverrides?.temperature === true && generationParameterDiffersFromDefault('temperature', nextTemperature, settings, nextRanges),
          topP: currentOverrides?.topP === true && generationParameterDiffersFromDefault('topP', nextTopP, settings, nextRanges),
          topK: currentOverrides?.topK === true && generationParameterDiffersFromDefault('topK', nextTopK, settings, nextRanges),
          maxTokens: currentOverrides?.maxTokens === true && generationParameterDiffersFromDefault('maxTokens', nextMaxTokens, settings, nextRanges),
        }, true)
        const nextConversation: Conversation = {
          ...c,
          providerId,
          model: nextModel,
          providerModelMode: 'manual' as const,
          maxTokens: nextMaxTokens || resolveConversationDefaultMaxTokens(settings, nextRanges),
          temperature: nextTemperature,
          topP: nextTopP,
          topK: nextTopK,
          reasoningEffort: nextReasoningEffort,
          updatedAt: Date.now(),
        }
        if (nextGenerationParameterOverrides) {
          nextConversation.generationParameterOverrides = nextGenerationParameterOverrides
        } else {
          delete nextConversation.generationParameterOverrides
        }
        return nextConversation
      })
      void persistConversations(updated)
      return { conversations: updated }
    })
    return true
  },

  removeMessage: (convId: string, msgId: string) => {
    set((state) => {
      const updated = state.conversations.map((c) => {
        if (c.id !== convId) return c
        return {
          ...c,
          messages: c.messages.filter((m) => m.id !== msgId),
          updatedAt: Date.now(),
        }
      })
      void persistConversations(updated)
      return { conversations: updated }
    })
  },

  trimAfterMessage: (convId: string, msgId: string) => {
    set((state) => {
      const updated = state.conversations.map((c) => {
        if (c.id !== convId) return c
        const index = c.messages.findIndex((m) => m.id === msgId)
        return {
          ...c,
          messages: index >= 0 ? c.messages.slice(0, index + 1) : c.messages,
          updatedAt: Date.now(),
        }
      })
      void persistConversations(updated)
      return { conversations: updated }
    })
  },

  addMessage: (convId: string, message: Message) => {
    set((state) => {
      const updated = state.conversations.map((c) => {
        if (c.id !== convId) return c
        const firstUserMsg = c.messages.length === 0 && message.role === 'user'
        return {
          ...c,
          title: c.title || (firstUserMsg ? generateTitle(message.content) : c.title),
          messages: [...c.messages, message],
          updatedAt: Date.now(),
        }
      })
      void persistConversations(updated)
      return { conversations: updated }
    })
  },

  updateMessage: (convId: string, msgId: string, updates: Partial<Message>) => {
    const safeUpdates = sanitizeMessageTraceUpdates(updates)
    set((state) => {
      const updated = state.conversations.map((c) => {
        if (c.id !== convId) return c
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === msgId ? { ...m, ...safeUpdates } : m
          ),
          updatedAt: Date.now(),
        }
      })
      void persistConversations(updated)
      return { conversations: updated }
    })
  },

  upsertMessageTrace: (convId: string, msgId: string, trace: ProcessTrace) => {
    set((state) => {
      let shouldDebouncePersist = false
      let changed = false
      const updated = state.conversations.map((c) => {
        if (c.id !== convId) return c
        let conversationChanged = false
        const messages = c.messages.map((m) =>
          {
            if (m.id !== msgId) return m
            shouldDebouncePersist = m.status === 'streaming'
            const nextMessage = upsertTraceOnMessage(m, trace)
            if (nextMessage !== m) {
              conversationChanged = true
              changed = true
            }
            return nextMessage
          }
        )
        if (!conversationChanged) return c
        return {
          ...c,
          messages,
          updatedAt: Date.now(),
        }
      })
      if (!changed) return state
      if (shouldDebouncePersist) {
        scheduleStreamingPersist(get, convId, msgId)
      } else {
        void persistConversations(updated)
      }
      return { conversations: updated }
    })
  },

  appendContent: (convId: string, msgId: string, content: string) => {
    get().commitStreamingContent(convId, msgId, content)
  },

  commitStreamingContent: (convId: string, msgId: string, content: string) => {
    if (!content) return
    set((state) => {
      const updated = buildStreamingContentSnapshot(state.conversations, convId, msgId, content)
      if (!updated) return state
      scheduleStreamingPersist(get, convId, msgId)
      return { conversations: updated }
    })
  },

  commitStreamingTraceSnapshot: (convId: string, msgId: string, traces: Pick<Message, 'reasoning' | 'toolCalls' | 'retrievalTrace'>) => {
    const safeTraces = sanitizeMessageTraceUpdates(traces)
    set((state) => {
      const updated = buildStreamingTraceSnapshot(state.conversations, convId, msgId, safeTraces)
      if (!updated) return state
      return { conversations: updated }
    })
  },

  persistStreamingContentSnapshot: (convId: string, msgId: string, content: string) => {
    const snapshot = buildStreamingContentSnapshot(get().conversations, convId, msgId, content)
    if (!snapshot) return
    void persistStreamingConversationQueued(snapshot, convId, { forceAsyncStorageBackup: false })
  },

  flushStreamingMessage: async (convId: string, msgId: string) => {
    await flushStreamingPersist(get, convId, msgId)
  },

  setError: (error: string | null) => {
    set({ error })
  },

  clearAll: () => {
    abortAllStreams()
    set({ conversations: [], currentId: null })
    void saveData(ACTIVE_CONVERSATION_KEY, null)
    void persistConversations([])
  },

  importData: (conversations: Conversation[]) => {
    const cleaned = prepareConversationsForStore(conversations)
    const currentId = cleaned[0]?.id ?? null
    set({ conversations: cleaned, currentId })
    void saveData(ACTIVE_CONVERSATION_KEY, currentId)
    void persistConversations(cleaned)
  },

  getCurrent: () => {
    const { conversations, currentId } = get()
    return conversations.find((conversation) => conversation.id === currentId) ?? null
  },
}))

type StreamingPersistHandle = ReturnType<typeof setTimeout>

const STREAMING_PERSIST_DELAY_MS = 420
const STREAMING_ASYNC_STORAGE_BACKUP_MS = 8000
const streamingPersistTimers = new Map<string, StreamingPersistHandle>()
let asyncStorageWriteQueue: Promise<void> = Promise.resolve()
let lastStreamingAsyncStorageBackupAt = 0

function streamingPersistKey(convId: string, msgId: string): string {
  return `${convId}:${msgId}`
}

function buildStreamingContentSnapshot(
  conversations: Conversation[],
  convId: string,
  msgId: string,
  content: string
): Conversation[] | null {
  if (!content) return null
  let changed = false
  const updated = conversations.map((conversation) => {
    if (conversation.id !== convId) return conversation
    let conversationChanged = false
    const messages = conversation.messages.map((message) => {
      if (message.id !== msgId) return message
      if (message.content === content && (message.responseText ?? message.content) === content) return message
      conversationChanged = true
      changed = true
      return { ...message, content, responseText: content }
    })
    if (!conversationChanged) return conversation
    return {
      ...conversation,
      messages,
      updatedAt: Date.now(),
    }
  })
  return changed ? updated : null
}

function buildStreamingTraceSnapshot(
  conversations: Conversation[],
  convId: string,
  msgId: string,
  traces: Pick<Message, 'reasoning' | 'toolCalls' | 'retrievalTrace'>
): Conversation[] | null {
  let changed = false
  const updated = conversations.map((conversation) => {
    if (conversation.id !== convId) return conversation
    let conversationChanged = false
    const messages = conversation.messages.map((message) => {
      if (message.id !== msgId) return message
      if (
        areProcessTraceListsEquivalent(message.reasoning, traces.reasoning) &&
        areProcessTraceListsEquivalent(message.toolCalls, traces.toolCalls) &&
        areProcessTraceListsEquivalent(message.retrievalTrace, traces.retrievalTrace)
      ) {
        return message
      }
      conversationChanged = true
      changed = true
      return {
        ...message,
        reasoning: traces.reasoning,
        toolCalls: traces.toolCalls,
        retrievalTrace: traces.retrievalTrace,
      }
    })
    if (!conversationChanged) return conversation
    return {
      ...conversation,
      messages,
      updatedAt: Date.now(),
    }
  })
  return changed ? updated : null
}

function scheduleStreamingPersist(getState: () => ChatState, convId: string, msgId: string): void {
  const key = streamingPersistKey(convId, msgId)
  const existing = streamingPersistTimers.get(key)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    streamingPersistTimers.delete(key)
    void persistStreamingConversationQueued(getState().conversations, convId, { forceAsyncStorageBackup: false })
  }, STREAMING_PERSIST_DELAY_MS)
  streamingPersistTimers.set(key, timer)
}

async function flushStreamingPersist(getState: () => ChatState, convId: string, msgId: string): Promise<void> {
  const key = streamingPersistKey(convId, msgId)
  const timer = streamingPersistTimers.get(key)
  if (timer) {
    clearTimeout(timer)
    streamingPersistTimers.delete(key)
  }
  await persistStreamingConversationQueued(getState().conversations, convId, { forceAsyncStorageBackup: true })
}

async function saveAsyncStorageConversationsQueued(conversations: Conversation[]): Promise<void> {
  const snapshot = sanitizeConversationsForPersistence(conversations)
  asyncStorageWriteQueue = asyncStorageWriteQueue
    .catch(() => undefined)
    .then(() => saveData('CONVERSATIONS', snapshot))
  await asyncStorageWriteQueue
}

async function persistConversationsQueued(conversations: Conversation[]): Promise<void> {
  await persistConversations(conversations)
}

async function persistStreamingConversationQueued(
  conversations: Conversation[],
  convId: string,
  options: { forceAsyncStorageBackup?: boolean } = {}
): Promise<void> {
  const snapshot = sanitizeConversationsForPersistence(conversations)
  const conversation = snapshot.find((item) => item.id === convId)
  const now = Date.now()
  const shouldBackupAsyncStorage =
    options.forceAsyncStorageBackup ||
    now - lastStreamingAsyncStorageBackupAt >= STREAMING_ASYNC_STORAGE_BACKUP_MS
  if (shouldBackupAsyncStorage) lastStreamingAsyncStorageBackupAt = now
  await Promise.all([
    conversation ? localDataStore.saveConversation(conversation) : Promise.resolve(),
    shouldBackupAsyncStorage ? saveAsyncStorageConversationsQueued(snapshot) : Promise.resolve(),
  ])
}

async function persistConversations(conversations: Conversation[]): Promise<void> {
  const snapshot = sanitizeConversationsForPersistence(conversations)
  await Promise.all([
    localDataStore.saveConversations(snapshot),
    saveAsyncStorageConversationsQueued(snapshot),
  ])
}

function prepareConversationsForStore(conversations: Conversation[]): Conversation[] {
  return sanitizeConversationGenerationParameterOverridesForStore(sanitizeConversationInternalOutputsForStore(sanitizeConversationAttachmentsForStore(sanitizeConversationTracesForStore(conversations))))
}

async function hydrateSqliteConversationsInBackground(): Promise<void> {
  try {
    const sqliteData = await localDataStore.loadConversations()
    if (!sqliteData.length) return
    const conversations = prepareConversationsForStore(sqliteData)
    const currentId = await loadData<string | null>(ACTIVE_CONVERSATION_KEY)
    const selectedId = conversations.some((conversation) => conversation.id === currentId) ? currentId : conversations[0]?.id ?? null
    useChatStore.setState({ conversations, currentId: selectedId })
    void saveData(ACTIVE_CONVERSATION_KEY, selectedId)
  } catch (error) {
    const message = error instanceof Error ? error.message : st('error.unknownError')
    useChatStore.getState().setError(st('storage.sqliteRestoreFailed', { message }))
  }
}

function sanitizeConversationsForPersistence(conversations: Conversation[]): Conversation[] {
  return sanitizeConversationGenerationParameterOverridesForStore(sanitizeConversationInternalOutputsForStore(sanitizeConversationAttachmentsForStore(sanitizeConversationTracesForStore(conversations))))
}

function sanitizeConversationGenerationParameterOverridesForStore(conversations: Conversation[]): Conversation[] {
  return conversations.map((conversation) => {
    if (!hasOwnProperty(conversation, 'generationParameterOverrides')) return conversation
    return {
      ...conversation,
      generationParameterOverrides: compactGenerationParameterOverrides(conversation.generationParameterOverrides, true) ?? {},
    }
  })
}

function sanitizeConversationInternalOutputsForStore(conversations: Conversation[]): Conversation[] {
  return conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map(sanitizeMessageInternalOutput),
  }))
}

function sanitizeConversationAttachmentsForStore(conversations: Conversation[]): Conversation[] {
  return conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      attachments: sanitizeAttachmentsForPersistence(message.attachments),
    })),
  }))
}

function sanitizeConversationTracesForStore(conversations: Conversation[]): Conversation[] {
  return conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map(sanitizeMessageTracesForStore),
  }))
}

function sanitizeMessageTracesForStore(message: Message): Message {
  return {
    ...message,
    reasoning: sanitizeProcessTracesForBoundary(message.reasoning),
    toolCalls: sanitizeProcessTracesForBoundary(message.toolCalls),
    retrievalTrace: sanitizeProcessTracesForBoundary(message.retrievalTrace),
  }
}

function sanitizeMessageTraceUpdates(updates: Partial<Message>): Partial<Message> {
  const safe = { ...updates }
  if ('reasoning' in safe) safe.reasoning = sanitizeProcessTracesForBoundary(safe.reasoning)
  if ('toolCalls' in safe) safe.toolCalls = sanitizeProcessTracesForBoundary(safe.toolCalls)
  if ('retrievalTrace' in safe) safe.retrievalTrace = sanitizeProcessTracesForBoundary(safe.retrievalTrace)
  return safe
}

function sanitizeProcessTraceForStore(trace: ProcessTrace): ProcessTrace {
  return sanitizeProcessTraceForBoundary(trace)
}

function upsertTraceOnMessage(message: Message, trace: ProcessTrace): Message {
  const safeTrace = sanitizeProcessTraceForStore(trace)
  const key = getTraceMessageKey(safeTrace.type)
  const current = message[key] ?? []
  const index = current.findIndex((item) => item.id === safeTrace.id)
  if (index >= 0) {
    const previousTrace = current[index]
    const mergedTrace = mergeTrace(previousTrace, safeTrace)
    if (areProcessTracesEquivalent(previousTrace, mergedTrace)) return message
    const next = current.map((item, itemIndex) => itemIndex === index ? mergedTrace : item)
    return { ...message, [key]: next }
  }
  const next = [...current, safeTrace]
  return { ...message, [key]: next }
}

function mergeTrace(current: ProcessTrace, next: ProcessTrace): ProcessTrace {
  const shouldAppend =
    next.status === 'running' &&
    current.content &&
    next.content &&
    current.content !== next.content &&
    !current.content.endsWith(next.content)
  const content = shouldAppend ? `${current.content}${next.content}` : next.content ?? current.content
  return {
    ...current,
    ...next,
    content: content ? clampMergedTraceContent(content, next.type) : undefined,
    startedAt: current.startedAt ?? next.startedAt,
    completedAt: next.completedAt ?? current.completedAt,
    durationMs: next.durationMs ?? current.durationMs,
    metadata: { ...current.metadata, ...next.metadata },
  }
}

function clampMergedTraceContent(content: string, type: ProcessTrace['type']): string {
  const limit = type === 'tool' ? 520 : type === 'reasoning' ? 760 : 1400
  return content.length > limit ? `${content.slice(0, limit)}...` : content
}

function getTraceMessageKey(type: ProcessTrace['type']): 'reasoning' | 'toolCalls' | 'retrievalTrace' {
  if (type === 'reasoning') return 'reasoning'
  if (type === 'tool') return 'toolCalls'
  return 'retrievalTrace'
}

function areProcessTracesEquivalent(current: ProcessTrace, next: ProcessTrace): boolean {
  return current.id === next.id &&
    current.type === next.type &&
    current.title === next.title &&
    current.content === next.content &&
    current.status === next.status &&
    current.startedAt === next.startedAt &&
    current.completedAt === next.completedAt &&
    current.durationMs === next.durationMs &&
    JSON.stringify(current.metadata ?? null) === JSON.stringify(next.metadata ?? null)
}

function areProcessTraceListsEquivalent(
  current: ProcessTrace[] | undefined,
  next: ProcessTrace[] | undefined,
): boolean {
  if (current === next) return true
  if ((current?.length ?? 0) !== (next?.length ?? 0)) return false
  for (let index = 0; index < (current?.length ?? 0); index += 1) {
    const currentTrace = current?.[index]
    const nextTrace = next?.[index]
    if (!currentTrace || !nextTrace || !areProcessTracesEquivalent(currentTrace, nextTrace)) return false
  }
  return true
}
