import { create } from 'zustand'
import type { Conversation, ConversationGenerationParameterKey, ConversationGenerationParameterOverrides, Message, ResponseLifecycleStage } from '@/types/chatContracts'
import type { ProcessTrace } from '@/core'
import { getModelConfig } from '@/types/modelCatalog'
import {
  loadConversationPage,
  loadConversationRecord,
  loadConversationRecords,
  readActiveConversationSelection,
  replaceConversationRecords,
  saveConversationRecord,
  writeActiveConversationSelection,
} from '@/presentation/features/conversations/conversationStorePersistenceCommand'
import {
  cancelAllConversationAssistantDetachedWork,
  cancelConversationAssistantDetachedWork,
} from '@/bootstrap/conversationAssistantDetachedWorkRegistry'
import { st } from '@/i18n/service'
import { resolveProviderModelAliasAccess } from '@/bootstrap/providerModelAccess'
import { getReasoningEffortOptions } from '@/utils/modelReasoning'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import {
  clampTraceText,
  extractUserFacingErrorDetail,
  redactSensitiveText,
  sanitizeProcessTraceForBoundary,
  sanitizeProcessTracesForBoundary,
} from '@/core'
import { sanitizeAttachmentsForPersistence } from '@/modules/conversations'
import { abortAllStreams, abortStream } from '@/services/chatStreamLifecycle'
import { sanitizeMessageInternalOutput } from '@/services/chatInternalOutputGuard'
import { PROVIDER_PLATFORM_DEFAULT_TEMPERATURE } from '@/modules/providers'
import {
  clampConversationGenerationParameter,
  resolveConversationGenerationParameterDefault,
  resolveConversationGenerationParameterRanges,
} from '@/bootstrap/providerConversationGeneration'
import type { ConversationGenerationParameterRanges } from '@/modules/providers'
import { useSettingsStore } from './settingsStore'
import {
  createResponseLifecycle,
  lifecycleStageForMessageStatus,
  lifecycleStageForTrace,
  normalizeResponseLifecycle,
  responseLifecycleTraceTimestamp,
  safeResponseLifecycleSummary,
  safeResponseLifecycleTraceSummary,
  transitionResponseLifecycle,
} from '@/services/responseLifecycle'

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

function inferGenerationParameterOverrides(
  conversation: Conversation,
): ConversationGenerationParameterOverrides | undefined {
  const inferred: ConversationGenerationParameterOverrides = {}
  for (const key of GENERATION_PARAMETER_KEYS) {
    if (getConversationGenerationParameterValue(conversation, key) !== undefined) inferred[key] = true
  }
  return compactGenerationParameterOverrides(inferred)
}

function resolveStoredGenerationParameterOverrides(
  conversation: Conversation,
): ConversationGenerationParameterOverrides | undefined {
  if (hasOwnProperty(conversation, 'generationParameterOverrides')) {
    return compactGenerationParameterOverrides(conversation.generationParameterOverrides, true)
  }
  return inferGenerationParameterOverrides(conversation)
}

function mergeGenerationParameterOverrides(
  conversation: Conversation,
  updates: Partial<Conversation>,
): ConversationGenerationParameterOverrides | undefined {
  const explicitOverrides = updates.generationParameterOverrides
  const merged: ConversationGenerationParameterOverrides = {
    ...(resolveStoredGenerationParameterOverrides(conversation) ?? {}),
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
      if (value !== undefined) merged[key] = true
    }
  }

  return compactGenerationParameterOverrides(merged, true)
}

function updateContainsGenerationParameterPatch(updates: Partial<Conversation>): boolean {
  return hasOwnProperty(updates, 'generationParameterOverrides') ||
    GENERATION_PARAMETER_KEYS.some((key) => hasOwnProperty(updates, key))
}

function buildConversationRecord(providerId: string, model: string): Conversation {
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
  const now = Date.now()
  return {
    id: generateId(),
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
    createdAt: now,
    updatedAt: now,
  }
}

interface ChatState {
  conversations: Conversation[]
  draftConversationIds: ReadonlySet<string>
  currentId: string | null
  isLoading: boolean
  error: string | null
  historyCursor: string | null
  historyHasMore: boolean
  historyLoadingMore: boolean

  load: () => Promise<void>
  loadMore: () => Promise<boolean>
  loadAll: () => Promise<void>
  create: (providerId: string, model: string) => string
  createDraft: (providerId: string, model: string) => string
  createLocalSetupConversation: () => string
  select: (id: string | null) => void
  delete: (id: string) => void
  rename: (id: string, title: string) => void
  updateConversation: (id: string, updates: Partial<Conversation>) => void
  switchConversationModel: (id: string, providerId: string, model: string) => boolean
  removeMessage: (convId: string, msgId: string) => void
  trimAfterMessage: (convId: string, msgId: string) => void
  addMessage: (
    convId: string,
    message: Message,
    options?: { readonly persist?: boolean },
  ) => Promise<void>
  updateMessage: (convId: string, msgId: string, updates: Partial<Message>) => void
  transitionMessageLifecycle: (
    convId: string,
    msgId: string,
    stage: ResponseLifecycleStage,
    options?: { readonly at?: number; readonly summary?: string; readonly traceId?: string },
  ) => void
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

const DEFAULT_CONVERSATION_TEMPERATURE = PROVIDER_PLATFORM_DEFAULT_TEMPERATURE
const DEFAULT_CONVERSATION_REASONING_EFFORT: Conversation['reasoningEffort'] = 'low'
const HISTORY_PAGE_SIZE = 40
const GENERATION_PARAMETER_KEYS = ['temperature', 'topP', 'topK', 'maxTokens'] as const satisfies readonly ConversationGenerationParameterKey[]

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  draftConversationIds: new Set<string>(),
  currentId: null,
  isLoading: false,
  error: null,
  historyCursor: null,
  historyHasMore: false,
  historyLoadingMore: false,

  load: async () => {
    set({ isLoading: true })
    const page = await loadConversationPage({ limit: HISTORY_PAGE_SIZE })
    if (page.conversations.length) {
      let conversations = prepareConversationsForStore([...page.conversations])
      const currentId = await readActiveConversationSelection()
      if (currentId && !conversations.some((conversation) => conversation.id === currentId)) {
        const activeConversation = await loadConversationRecord(currentId)
        if (activeConversation) conversations = [
          ...prepareConversationsForStore([activeConversation]),
          ...conversations,
        ]
      }
      const selectedId = resolveLoadedActiveConversationId(conversations, currentId)
      set({
        conversations,
        draftConversationIds: new Set<string>(),
        currentId: selectedId,
        isLoading: false,
        historyCursor: page.nextCursor ?? null,
        historyHasMore: page.hasMore,
        historyLoadingMore: false,
      })
      void writeActiveConversationSelection(selectedId)
      return
    }

    set({ conversations: [], draftConversationIds: new Set<string>(), currentId: null, isLoading: false })
    set({
      historyCursor: page.nextCursor ?? null,
      historyHasMore: page.hasMore,
      historyLoadingMore: false,
    })
    await writeActiveConversationSelection(null)
    void hydrateSqliteConversationsInBackground()
  },

  loadMore: async () => {
    const state = get()
    if (!state.historyHasMore || state.historyLoadingMore) return false
    set({ historyLoadingMore: true })
    try {
      const page = await loadConversationPage({
        ...(state.historyCursor ? { cursor: state.historyCursor } : {}),
        limit: HISTORY_PAGE_SIZE,
      })
      const incoming = prepareConversationsForStore([...page.conversations])
      set((current) => {
        const existingIds = new Set(current.conversations.map((conversation) => conversation.id))
        const appended = incoming.filter((conversation) => !existingIds.has(conversation.id))
        return {
          conversations: appended.length ? [...current.conversations, ...appended] : current.conversations,
          historyCursor: page.nextCursor ?? null,
          historyHasMore: page.hasMore,
          historyLoadingMore: false,
        }
      })
      return true
    } catch (error) {
      const message = extractUserFacingErrorDetail(error) || st('error.unknownError')
      set({ historyLoadingMore: false, historyHasMore: false })
      set({ error: st('storage.sqliteRestoreFailed', { message }) })
      return false
    }
  },

  loadAll: async () => {
    while (get().historyHasMore) {
      if (!(await get().loadMore())) return
    }
  },

  create: (providerId: string, model: string) => {
    const conversation = buildConversationRecord(providerId, model)
    const id = conversation.id
    set((state) => {
      const updated = [conversation, ...state.conversations]
      void persistConversations(updated, state.draftConversationIds)
      void writeActiveConversationSelection(id)
      return { conversations: updated, currentId: id }
    })
    return id
  },

  createDraft: (providerId: string, model: string) => {
    const conversation = buildConversationRecord(providerId, model)
    const id = conversation.id
    set((state) => {
      const updatedDraftConversationIds = new Set(state.draftConversationIds)
      updatedDraftConversationIds.add(id)
      const updated = [conversation, ...state.conversations]
      return {
        conversations: updated,
        draftConversationIds: updatedDraftConversationIds,
        currentId: id,
      }
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
      void persistConversations(updated, state.draftConversationIds)
      void writeActiveConversationSelection(id)
      return { conversations: updated, currentId: id }
    })
    return id
  },

  select: (id: string | null) => {
    set((state) => {
      if (!state.draftConversationIds.size || (id !== null && state.draftConversationIds.has(id))) {
        return { currentId: id }
      }
      const conversations = state.conversations.filter((conversation) => !state.draftConversationIds.has(conversation.id))
      return {
        conversations,
        draftConversationIds: new Set<string>(),
        currentId: id,
      }
    })
    if (id === null || !get().draftConversationIds.has(id)) void writeActiveConversationSelection(id)
  },

  delete: (id: string) => {
    cancelConversationAssistantDetachedWork(id)
    abortStream(id)
    set((state) => {
      const updated = state.conversations.filter((c) => c.id !== id)
      const draftConversationIds = new Set(state.draftConversationIds)
      draftConversationIds.delete(id)
      void persistConversations(updated, draftConversationIds)
      const nextCurrentId = state.currentId === id ? updated[0]?.id ?? null : state.currentId
      void writeActiveConversationSelection(nextCurrentId)
      return {
        conversations: updated,
        draftConversationIds,
        currentId: nextCurrentId,
      }
    })
  },

  rename: (id: string, title: string) => {
    set((state) => {
      const updated = state.conversations.map((c) =>
        c.id === id ? { ...c, title, updatedAt: Date.now() } : c
      )
      if (!state.draftConversationIds.has(id)) void persistConversationRecord(updated, id)
      return { conversations: updated }
    })
  },

  updateConversation: (id: string, updates: Partial<Conversation>) => {
    const shouldMergeParameterOverrides = updateContainsGenerationParameterPatch(updates)
    set((state) => {
      const updated = state.conversations.map((c) => {
        if (c.id !== id) return c
        const next: Conversation = { ...c, ...updates, updatedAt: Date.now() }
        if (shouldMergeParameterOverrides) {
          const generationParameterOverrides = mergeGenerationParameterOverrides(c, updates)
          if (generationParameterOverrides) {
            next.generationParameterOverrides = generationParameterOverrides
          } else {
            delete next.generationParameterOverrides
          }
        }
        return next
      })
      if (!state.draftConversationIds.has(id)) void persistConversationRecord(updated, id)
      return { conversations: updated }
    })
  },

  switchConversationModel: (id: string, providerId: string, model: string) => {
    const nextModel = model.trim()
    if (!nextModel) return false
    const { providers, settings } = useSettingsStore.getState()
    const provider = providers.find((item) => item.id === providerId)
    if (!provider) {
      get().setError(st('chat.providerMissingDescription', { providerId }))
      return false
    }
    const access = resolveProviderModelAliasAccess({ provider, model: nextModel, settings })
    if (!access.allowed) {
      get().setError(st('chat.modelSwitchBlockedMessage', { model: nextModel, provider: provider.name }))
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
        const currentOverrides = resolveStoredGenerationParameterOverrides(c)
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
          temperature: currentOverrides?.temperature === true,
          topP: currentOverrides?.topP === true,
          topK: currentOverrides?.topK === true,
          maxTokens: currentOverrides?.maxTokens === true,
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
      if (!state.draftConversationIds.has(id)) void persistConversationRecord(updated, id)
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
      void persistConversationRecord(updated, convId)
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
      void persistConversationRecord(updated, convId)
      return { conversations: updated }
    })
  },

  addMessage: (
    convId: string,
    message: Message,
    options: { readonly persist?: boolean } = {},
  ) => {
    let durability = Promise.resolve()
    set((state) => {
      const draftConversationIds = new Set(state.draftConversationIds)
      const wasDraft = draftConversationIds.delete(convId)
      const updated = state.conversations.map((c) => {
        if (c.id !== convId) return c
        const firstUserMsg = c.messages.length === 0 && message.role === 'user'
        const nextMessage = message.role === 'assistant'
          ? {
              ...message,
              // Render a real placeholder immediately. Runtime admission will
              // advance this from preparing to sending/waiting.
              responseLifecycle: message.responseLifecycle
                ?? createInitialAssistantResponseLifecycle(message),
            }
          : message
        return {
          ...c,
          title: c.title || (firstUserMsg ? generateTitle(message.content) : c.title),
          messages: [...c.messages, nextMessage],
          updatedAt: Date.now(),
        }
      })
      durability = options.persist === false
        ? Promise.resolve()
        : persistConversationRecord(updated, convId)
      if (wasDraft) {
        void durability
          .then(() => {
            if (get().currentId !== convId) return
            return writeActiveConversationSelection(convId)
          })
          .catch(() => undefined)
      }
      return { conversations: updated, draftConversationIds: wasDraft ? draftConversationIds : state.draftConversationIds }
    })
    return durability
  },

  updateMessage: (convId: string, msgId: string, updates: Partial<Message>) => {
    const safeUpdates = sanitizeMessageTraceUpdates(updates)
    set((state) => {
      const updated = state.conversations.map((c) => {
        if (c.id !== convId) return c
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === msgId ? applyMessageUpdateWithLifecycle(m, safeUpdates) : m
          ),
          updatedAt: Date.now(),
        }
      })
      void persistConversationRecord(updated, convId)
      return { conversations: updated }
    })
  },

  transitionMessageLifecycle: (convId, msgId, stage, options = {}) => {
    let shouldDebouncePersist = false
    set((state) => {
      let changed = false
      const updated = state.conversations.map((conversation) => {
        if (conversation.id !== convId) return conversation
        const messages = conversation.messages.map((message) => {
          if (message.id !== msgId || message.role !== 'assistant') return message
          shouldDebouncePersist = message.status === 'streaming'
          const nextLifecycle = transitionResponseLifecycle(
            message.responseLifecycle,
            stage,
            options.at ?? Date.now(),
            {
              summary: safeResponseLifecycleSummary(options.summary),
              traceId: options.traceId,
            },
          )
          if (areResponseLifecyclesEquivalent(message.responseLifecycle, nextLifecycle)) return message
          changed = true
          return { ...message, responseLifecycle: nextLifecycle }
        })
        return messages.some((message, index) => message !== conversation.messages[index])
          ? { ...conversation, messages, updatedAt: Date.now() }
          : conversation
      })
      if (changed) {
        if (shouldDebouncePersist) scheduleStreamingPersist(get, convId, msgId)
        else void persistConversationRecord(updated, convId)
      }
      return changed ? { conversations: updated } : state
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
            const safeTrace = sanitizeProcessTraceForStore(trace)
            const nextMessage = upsertTraceOnMessage(m, safeTrace)
            const lifecycleStage = lifecycleStageForTrace(safeTrace, Boolean(m.content || m.responseText))
            const nextWithLifecycle = lifecycleStage
              ? applyLifecycleTransition(nextMessage, lifecycleStage, responseLifecycleTraceTimestamp(safeTrace), {
                  summary: safeResponseLifecycleTraceSummary(safeTrace),
                  traceId: safeTrace.id,
                })
              : nextMessage
            if (nextWithLifecycle !== m) {
              conversationChanged = true
              changed = true
            }
            return nextWithLifecycle
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
        void persistConversationRecord(updated, convId)
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
    void persistStreamingConversationQueued(snapshot, convId)
  },

  flushStreamingMessage: async (convId: string, msgId: string) => {
    await flushStreamingPersist(get, convId, msgId)
  },

  setError: (error: string | null) => {
    set({ error })
  },

  clearAll: () => {
    cancelAllConversationAssistantDetachedWork()
    abortAllStreams()
    set({
      conversations: [],
      draftConversationIds: new Set<string>(),
      currentId: null,
      error: null,
      historyCursor: null,
      historyHasMore: false,
      historyLoadingMore: false,
    })
    void writeActiveConversationSelection(null)
    void persistConversations([], new Set<string>())
  },

  importData: (conversations: Conversation[]) => {
    cancelAllConversationAssistantDetachedWork()
    abortAllStreams()
    const cleaned = prepareConversationsForStore(conversations)
    const currentId = cleaned[0]?.id ?? null
    set({
      conversations: cleaned,
      draftConversationIds: new Set<string>(),
      currentId,
      error: null,
      historyCursor: null,
      historyHasMore: false,
      historyLoadingMore: false,
    })
    void writeActiveConversationSelection(currentId)
    void persistConversations(cleaned, new Set<string>())
  },

  getCurrent: () => {
    const { conversations, currentId } = get()
    return conversations.find((conversation) => conversation.id === currentId) ?? null
  },
}))

type StreamingPersistHandle = ReturnType<typeof setTimeout>

const STREAMING_PERSIST_DELAY_MS = 420
const streamingPersistTimers = new Map<string, StreamingPersistHandle>()

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
      const contentUnchanged = message.content === content && (message.responseText ?? message.content) === content
      const nextLifecycle = message.role === 'assistant'
        ? transitionResponseLifecycle(
            message.responseLifecycle,
            'generating',
            Date.now(),
          )
        : message.responseLifecycle
      if (contentUnchanged && areResponseLifecyclesEquivalent(message.responseLifecycle, nextLifecycle)) return message
      conversationChanged = true
      changed = true
      return {
        ...message,
        content,
        responseText: content,
        ...(nextLifecycle ? { responseLifecycle: nextLifecycle } : {}),
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
    void persistStreamingConversationQueued(getState().conversations, convId)
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
  await persistConversationRecord(getState().conversations, convId)
}

function persistStreamingConversationQueued(
  conversations: Conversation[],
  convId: string,
): Promise<void> {
  return persistConversationRecord(conversations, convId)
}

function persistConversationRecord(
  conversations: Conversation[],
  convId: string,
): Promise<void> {
  const sourceConversation = conversations.find((item) => item.id === convId)
  if (!sourceConversation) return Promise.resolve()
  const [conversation] = sanitizeConversationsForPersistence([sourceConversation])
  return trackConversationPersistence(saveConversationRecord(conversation))
}

function persistConversations(
  conversations: Conversation[],
  draftConversationIds: ReadonlySet<string> = useChatStore.getState().draftConversationIds,
): Promise<void> {
  const snapshot = sanitizeConversationsForPersistence(conversations)
    .filter((conversation) => !draftConversationIds.has(conversation.id))
  return trackConversationPersistence(replaceConversationRecords(snapshot))
}

function trackConversationPersistence(operation: Promise<void>): Promise<void> {
  const reported = operation.catch((error: unknown) => {
    const detail = extractUserFacingErrorDetail(error) || st('error.unknownError')
    const safeDetail = clampTraceText(redactSensitiveText(detail), 240) || st('error.unknownError')
    useChatStore.getState().setError(st('storage.sqliteSyncFailed', { message: safeDetail }))
    throw error
  })
  void reported.catch(() => undefined)
  return reported
}

function prepareConversationsForStore(conversations: Conversation[]): Conversation[] {
  return sanitizeConversationGenerationParameterOverridesForStore(sanitizeConversationInternalOutputsForStore(sanitizeConversationAttachmentsForStore(sanitizeConversationTracesForStore(conversations))))
}

async function hydrateSqliteConversationsInBackground(): Promise<void> {
  try {
    const sqliteData = await loadConversationRecords()
    if (!sqliteData.length) {
      await writeActiveConversationSelection(null)
      return
    }
    const conversations = prepareConversationsForStore([...sqliteData])
    const currentId = await readActiveConversationSelection()
    const selectedId = resolveLoadedActiveConversationId(conversations, currentId)
    const currentState = useChatStore.getState()
    if (currentState.conversations.length > 0 || currentState.draftConversationIds.size > 0) return
    useChatStore.setState({ conversations, draftConversationIds: new Set<string>(), currentId: selectedId })
    void writeActiveConversationSelection(selectedId)
  } catch (error) {
    const message = extractUserFacingErrorDetail(error) || st('error.unknownError')
    useChatStore.getState().setError(st('storage.sqliteRestoreFailed', { message }))
  }
}

function sanitizeConversationsForPersistence(conversations: Conversation[]): Conversation[] {
  return sanitizeConversationGenerationParameterOverridesForStore(sanitizeConversationInternalOutputsForStore(sanitizeConversationAttachmentsForStore(sanitizeConversationTracesForStore(conversations))))
}

function resolveLoadedActiveConversationId(
  conversations: Conversation[],
  currentId: string | null,
): string | null {
  return conversations.some((conversation) => conversation.id === currentId)
    ? currentId
    : conversations[0]?.id ?? null
}

function sanitizeConversationGenerationParameterOverridesForStore(conversations: Conversation[]): Conversation[] {
  return conversations.map((conversation) => {
    if (!hasOwnProperty(conversation, 'generationParameterOverrides')) {
      return {
        ...conversation,
        generationParameterOverrides: inferGenerationParameterOverrides(conversation) ?? {},
      }
    }
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
  const responseLifecycle = message.role === 'assistant'
    ? normalizeResponseLifecycle(
        message.responseLifecycle,
        message.startedAt ?? message.timestamp,
        message.status,
        message.completedAt,
      )
    : undefined
  return {
    ...message,
    reasoning: sanitizeProcessTracesForBoundary(message.reasoning),
    toolCalls: sanitizeProcessTracesForBoundary(message.toolCalls),
    retrievalTrace: sanitizeProcessTracesForBoundary(message.retrievalTrace),
    ...(responseLifecycle ? { responseLifecycle } : {}),
  }
}

function sanitizeMessageTraceUpdates(updates: Partial<Message>): Partial<Message> {
  const safe = { ...updates }
  if ('reasoning' in safe) safe.reasoning = sanitizeProcessTracesForBoundary(safe.reasoning)
  if ('toolCalls' in safe) safe.toolCalls = sanitizeProcessTracesForBoundary(safe.toolCalls)
  if ('retrievalTrace' in safe) safe.retrievalTrace = sanitizeProcessTracesForBoundary(safe.retrievalTrace)
  if ('responseLifecycle' in safe && safe.responseLifecycle) {
    safe.responseLifecycle = normalizeResponseLifecycle(
      safe.responseLifecycle,
      safe.responseLifecycle.startedAt,
      safe.responseLifecycle.stage === 'error'
        ? 'error'
        : safe.responseLifecycle.stage === 'cancelled'
          ? 'cancelled'
          : safe.responseLifecycle.stage === 'completed'
            ? 'done'
            : 'streaming',
    )
  }
  return safe
}

function applyMessageUpdateWithLifecycle(message: Message, updates: Partial<Message>): Message {
  const merged = { ...message, ...updates }
  if (message.role !== 'assistant') return merged
  const status = updates.status ?? message.status
  const lifecycle = updates.responseLifecycle
    ?? message.responseLifecycle
    ?? createResponseLifecycle(message.startedAt ?? message.timestamp, 'preparing')
  if (status === 'done' || status === 'error' || status === 'cancelled') {
    const terminalStage = lifecycleStageForMessageStatus(status)
    merged.responseLifecycle = transitionResponseLifecycle(
      lifecycle,
      terminalStage,
      updates.completedAt ?? Date.now(),
    )
  } else {
    merged.responseLifecycle = lifecycle
  }
  return merged
}

function createInitialAssistantResponseLifecycle(message: Message) {
  const traces = [
    ...(message.reasoning ?? []),
    ...(message.toolCalls ?? []),
    ...(message.retrievalTrace ?? []),
  ]
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const trace = traces[index]
    const stage = lifecycleStageForTrace(trace, Boolean(message.content || message.responseText))
    if (stage) {
      return createResponseLifecycle(message.startedAt ?? message.timestamp, stage, {
        traceId: trace.id,
        summary: safeResponseLifecycleTraceSummary(trace),
      })
    }
  }
  return createResponseLifecycle(message.startedAt ?? message.timestamp, 'preparing')
}

function applyLifecycleTransition(
  message: Message,
  stage: import('@/types/chatContracts').ResponseLifecycleStage,
  at: number,
  options: { readonly summary?: string; readonly traceId?: string } = {},
): Message {
  if (message.role !== 'assistant') return message
  const nextLifecycle = transitionResponseLifecycle(
    message.responseLifecycle,
    stage,
    at,
    options,
  )
  return areResponseLifecyclesEquivalent(message.responseLifecycle, nextLifecycle)
    ? message
    : { ...message, responseLifecycle: nextLifecycle }
}

function areResponseLifecyclesEquivalent(
  current: Message['responseLifecycle'],
  next: Message['responseLifecycle'],
): boolean {
  if (current === next) return true
  if (!current || !next) return false
  return current.stage === next.stage &&
    current.startedAt === next.startedAt &&
    current.stageStartedAt === next.stageStartedAt &&
    current.completedAt === next.completedAt &&
    JSON.stringify(current.history) === JSON.stringify(next.history)
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
