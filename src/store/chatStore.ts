import { create } from 'zustand'
import type { Conversation, Message, ProcessTrace } from '@/types'
import { getModelConfig } from '@/types'
import { loadData, saveData } from '@/services/storage'
import { localDataStore } from '@/services/localDataStore'
import { useSettingsStore } from './settingsStore'

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function generateTitle(content: string): string {
  return content.slice(0, 50).replace(/\n/g, ' ') + (content.length > 50 ? '...' : '')
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
  switchConversationModel: (id: string, providerId: string, model: string) => void
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
      const currentId = await loadData<string | null>(ACTIVE_CONVERSATION_KEY)
      const selectedId = data.some((conversation) => conversation.id === currentId) ? currentId : data[0]?.id ?? null
      set({
        conversations: data,
        currentId: selectedId,
        isLoading: false,
      })
      void saveData(ACTIVE_CONVERSATION_KEY, selectedId)
      void syncSqliteConversationsInBackground(data)
    } else {
      set({ isLoading: false })
      void hydrateSqliteConversationsInBackground()
    }
  },

  create: (providerId: string, model: string) => {
    const id = generateId()
    const { settings, providers } = useSettingsStore.getState()
    const provider = providers.find((item) => item.id === providerId)
    const modelConfig = getModelConfig(model, provider?.type, provider?.modelConfigs)
    const conversation: Conversation = {
      id,
      title: '',
      providerId,
      model,
      providerModelMode: 'inherited',
      systemPrompt: '',
      temperature: settings.defaultTemperature ?? 0.7,
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
      title: '配置向导',
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
    const { providers } = useSettingsStore.getState()
    const provider = providers.find((item) => item.id === providerId)
    const modelConfig = getModelConfig(model, provider?.type, provider?.modelConfigs)
    set((state) => {
      const updated = state.conversations.map((c) => {
        if (c.id !== id) return c
        const nextMaxTokens = Math.min(c.maxTokens || modelConfig.defaultMaxTokens, modelConfig.maxOutputTokens)
        return {
          ...c,
          providerId,
          model,
          providerModelMode: 'manual' as const,
          maxTokens: nextMaxTokens || modelConfig.defaultMaxTokens,
          temperature: Math.min(c.temperature, modelConfig.maxTemperature ?? 2),
          updatedAt: Date.now(),
        }
      })
      void persistConversations(updated)
      return { conversations: updated }
    })
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
    set((state) => {
      const updated = state.conversations.map((c) => {
        if (c.id !== convId) return c
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === msgId ? { ...m, ...updates } : m
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
    set({ conversations: [], currentId: null })
    void saveData(ACTIVE_CONVERSATION_KEY, null)
    void persistConversations([])
  },

  importData: (conversations: Conversation[]) => {
    const currentId = conversations[0]?.id ?? null
    set({ conversations, currentId })
    void saveData(ACTIVE_CONVERSATION_KEY, currentId)
    void persistConversations(conversations)
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
  const snapshot = conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({ ...message })),
  }))
  asyncStorageWriteQueue = asyncStorageWriteQueue
    .catch(() => undefined)
    .then(() => saveData('CONVERSATIONS', snapshot))
  await asyncStorageWriteQueue
}

async function persistConversationsQueued(conversations: Conversation[]): Promise<void> {
  await persistConversations(conversations)
}

async function persistConversations(conversations: Conversation[]): Promise<void> {
  await Promise.all([
    localDataStore.saveConversations(conversations),
    saveAsyncStorageConversationsQueued(conversations),
  ])
}

async function syncSqliteConversationsInBackground(conversations: Conversation[]): Promise<void> {
  try {
    await localDataStore.saveConversations(conversations)
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    useChatStore.getState().setError(`SQLite 对话同步失败：${message}`)
  }
}

async function hydrateSqliteConversationsInBackground(): Promise<void> {
  try {
    const sqliteData = await localDataStore.loadConversations()
    if (!sqliteData.length) return
    const currentId = await loadData<string | null>(ACTIVE_CONVERSATION_KEY)
    const selectedId = sqliteData.some((conversation) => conversation.id === currentId) ? currentId : sqliteData[0]?.id ?? null
    useChatStore.setState({ conversations: sqliteData, currentId: selectedId })
    void saveData(ACTIVE_CONVERSATION_KEY, selectedId)
    void saveData('CONVERSATIONS', sqliteData)
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    useChatStore.getState().setError(`SQLite 对话恢复失败：${message}`)
  }
}

function upsertTraceOnMessage(message: Message, trace: ProcessTrace): Message {
  const key = getTraceMessageKey(trace.type)
  const current = message[key] ?? []
  const index = current.findIndex((item) => item.id === trace.id)
  const next = index >= 0
    ? current.map((item) => item.id === trace.id ? mergeTrace(item, trace) : item)
    : [...current, trace]
  return { ...message, [key]: next }
}

function mergeTrace(current: ProcessTrace, next: ProcessTrace): ProcessTrace {
  const shouldAppend =
    next.status === 'running' &&
    current.content &&
    next.content &&
    current.content !== next.content &&
    !current.content.endsWith(next.content)
  return {
    ...current,
    ...next,
    content: shouldAppend ? `${current.content}${next.content}` : next.content ?? current.content,
    startedAt: current.startedAt ?? next.startedAt,
    completedAt: next.completedAt ?? current.completedAt,
    durationMs: next.durationMs ?? current.durationMs,
    metadata: { ...current.metadata, ...next.metadata },
  }
}

function getTraceMessageKey(type: ProcessTrace['type']): 'reasoning' | 'toolCalls' | 'retrievalTrace' {
  if (type === 'reasoning') return 'reasoning'
  if (type === 'tool') return 'toolCalls'
  return 'retrievalTrace'
}
