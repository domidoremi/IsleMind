import { create } from 'zustand'
import type { Conversation, Message, ProcessTrace } from '@/types'
import { getModelConfig } from '@/types'
import { loadData, saveData } from '@/services/storage'
import { localDataStore } from '@/services/localDataStore'
import { st } from '@/i18n/service'
import { getOnboardingConversationDefaults, isOnboardingSystemPrompt } from '@/utils/onboardingProfile'
import { resolveProviderModelAliasAccess } from '@/services/ai/policy/providerModelAccess'
import { getReasoningEffortOptions } from '@/utils/modelReasoning'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { sanitizeProcessTraceForBoundary, sanitizeProcessTracesForBoundary } from '@/utils/traceSafety'
import { sanitizeAttachmentsForPersistence } from '@/services/attachmentContract'
import { abortAllStreams, abortStream } from '@/services/chatStreamLifecycle'
import { sanitizeMessageInternalOutput } from '@/services/chatInternalOutputGuard'
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
  setStreaming: (convId: string, msgId: string) => void
  appendContent: (convId: string, msgId: string, content: string) => void
  flushStreamingMessage: (convId: string, msgId: string) => Promise<void>
  setError: (error: string | null) => void
  clearAll: () => void
  importData: (conversations: Conversation[]) => void
  getCurrent: () => Conversation | null
}

const ACTIVE_CONVERSATION_KEY = 'ACTIVE_CONVERSATION'

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentId: null,
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true })
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
    } else {
      set({ isLoading: false })
      void hydrateSqliteConversationsInBackground()
    }
  },

  create: (providerId: string, model: string) => {
    const id = generateId()
    const { settings, providers } = useSettingsStore.getState()
    const provider = providers.find((item) => item.id === providerId)
    const upstreamModel = provider ? resolveProviderModelAlias(provider, model) : model
    const modelConfig = getModelConfig(upstreamModel, provider?.type, provider?.modelConfigs)
    const onboardingDefaults = getOnboardingConversationDefaults(settings.onboardingCompanionMode)
    const reasoningOptions = getReasoningEffortOptions(provider, upstreamModel)
    const defaultReasoningEffort = selectSupportedReasoningEffort(onboardingDefaults.reasoningEffort, reasoningOptions)
    const conversation: Conversation = {
      id,
      title: '',
      providerId,
      model,
      providerModelMode: 'inherited',
      systemPrompt: onboardingDefaults.systemPrompt,
      temperature: settings.defaultTemperature ?? onboardingDefaults.temperature,
      topP: 1,
      reasoningEffort: defaultReasoningEffort,
      maxTokens: settings.defaultMaxTokens ?? modelConfig.defaultMaxTokens,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    conversation.maxTokens = Math.min(settings.defaultMaxTokens ?? modelConfig.defaultMaxTokens, modelConfig.maxOutputTokens)
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
      temperature: 0.7,
      maxTokens: 1024,
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
    set((state) => {
      const updated = state.conversations.map((c) =>
        c.id === id ? { ...c, ...updates, updatedAt: Date.now() } : c
      )
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
        const nextMaxTokens = Math.min(c.maxTokens || modelConfig.defaultMaxTokens, modelConfig.maxOutputTokens)
        const nextReasoningEffort = selectSupportedReasoningEffort(c.reasoningEffort, reasoningOptions)
        return {
          ...c,
          providerId,
          model: nextModel,
          providerModelMode: 'manual' as const,
          maxTokens: nextMaxTokens || modelConfig.defaultMaxTokens,
          temperature: Math.min(c.temperature, modelConfig.maxTemperature ?? 2),
          topP: c.topP ?? 1,
          reasoningEffort: nextReasoningEffort,
          updatedAt: Date.now(),
        }
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
      const updated = state.conversations.map((c) => {
        if (c.id !== convId) return c
        return {
          ...c,
          messages: c.messages.map((m) =>
            {
              if (m.id !== msgId) return m
              shouldDebouncePersist = m.status === 'streaming'
              return upsertTraceOnMessage(m, trace)
            }
          ),
          updatedAt: Date.now(),
        }
      })
      if (shouldDebouncePersist) {
        scheduleStreamingPersist(get, convId, msgId)
      } else {
        void persistConversations(updated)
      }
      return { conversations: updated }
    })
  },

  setStreaming: (convId: string, msgId: string) => {
    set((state) => {
      const updated = state.conversations.map((c) => {
        if (c.id !== convId) return c
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === msgId ? { ...m, status: 'streaming' as const } : m
          ),
          updatedAt: Date.now(),
        }
      })
      void persistConversations(updated)
      return { conversations: updated }
    })
  },

  appendContent: (convId: string, msgId: string, content: string) => {
    set((state) => {
      const updated = state.conversations.map((c) => {
        if (c.id !== convId) return c
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === msgId ? { ...m, content: m.content + content, responseText: (m.responseText ?? m.content) + content } : m
          ),
          updatedAt: Date.now(),
        }
      })
      scheduleStreamingPersist(get, convId, msgId)
      return { conversations: updated }
    })
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
const streamingPersistTimers = new Map<string, StreamingPersistHandle>()
let asyncStorageWriteQueue: Promise<void> = Promise.resolve()

function streamingPersistKey(convId: string, msgId: string): string {
  return `${convId}:${msgId}`
}

function scheduleStreamingPersist(getState: () => ChatState, convId: string, msgId: string): void {
  const key = streamingPersistKey(convId, msgId)
  const existing = streamingPersistTimers.get(key)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    streamingPersistTimers.delete(key)
    void persistConversationsQueued(getState().conversations)
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
  await persistConversationsQueued(getState().conversations)
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

async function persistConversations(conversations: Conversation[]): Promise<void> {
  const snapshot = sanitizeConversationsForPersistence(conversations)
  await Promise.all([
    localDataStore.saveConversations(snapshot),
    saveAsyncStorageConversationsQueued(snapshot),
  ])
}

function stripOnboardingSystemPrompts(conversations: Conversation[]): Conversation[] {
  return conversations.map((conversation) =>
    isOnboardingSystemPrompt(conversation.systemPrompt)
      ? { ...conversation, systemPrompt: '' }
      : conversation
  )
}

function prepareConversationsForStore(conversations: Conversation[]): Conversation[] {
  return sanitizeConversationInternalOutputsForStore(sanitizeConversationAttachmentsForStore(sanitizeConversationTracesForStore(stripOnboardingSystemPrompts(conversations))))
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
    void persistConversations(conversations)
  } catch (error) {
    const message = error instanceof Error ? error.message : st('error.unknownError')
    useChatStore.getState().setError(st('storage.sqliteRestoreFailed', { message }))
  }
}

function sanitizeConversationsForPersistence(conversations: Conversation[]): Conversation[] {
  return sanitizeConversationInternalOutputsForStore(sanitizeConversationAttachmentsForStore(sanitizeConversationTracesForStore(conversations)))
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
  const next = index >= 0
    ? current.map((item) => item.id === safeTrace.id ? mergeTrace(item, safeTrace) : item)
    : [...current, safeTrace]
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
