import * as Clipboard from 'expo-clipboard'
import type { AIProvider, Attachment, ChatErrorCode, Conversation, McpServerConfig, McpToolManifest, Message, ProcessTrace, RemoteCompactMode, RetrievalSource, ToolContentBlock } from '@/types'
import { getModelConfig, getProviderConfigIssue } from '@/types'
import { streamChat, type ChatCompletionResult, type ProviderRuntimeError, type StreamHandle } from '@/services/ai/base'
import { extractMemories, retrieveContext, retrieveFlareContext, searchWeb, type RetrievedContext } from '@/services/context'
import { verifyRagGeneration } from '@/services/rag'
import { buildSystemPrompt } from '@/services/promptEngineering'
import { buildEstimatedUsage, estimateTextTokens, mergeUsageWithEstimate } from '@/services/tokenUsage'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { packChatMessages } from '@/services/contextPacker'
import { resolveSearchProvider } from '@/services/searchPolicy'
import { callMcpTool, listMcpServers, truncateToolBlocks } from '@/services/mcp'
import { localDataStore } from '@/services/localDataStore'
import { routeLocalAppCommand, type LocalAppCommandResult } from '@/services/appCommandRouter'
import { st } from '@/i18n/service'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { getPolicyAllowedProviderModels } from '@/services/ai/policy/providerModelAccess'
import { decideRemoteCompact, estimateRemoteCompactSavedTokens } from '@/services/ai/compact/remoteCompact'
import { recordCompactUsage } from '@/services/ai/compact/compactUsage'
import { listActiveCompactStates, saveCompactState } from '@/services/ai/compact/compactStateStore'
import { appendRuntimeLog } from '@/services/runtimeLog'

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function traceId(prefix: string): string {
  return `${prefix}-${generateId()}`
}

interface SendMessageInput {
  conversation: Conversation
  content: string
  attachments?: Attachment[]
}

const activeControllers = new Map<string, { controller: AbortController; messageId: string; flush?: () => void; done?: Promise<void> }>()
const STREAM_TEXT_FLUSH_MS = 64
const STREAM_TEXT_MAX_BUFFER = 128
const STREAM_TRACE_FLUSH_MS = 180
const STREAM_TRACE_MAX_BUFFER = 6
const MCP_CALL_TAG = 'islemind_mcp_call'

interface ResolvedMcpTool {
  server: McpServerConfig
  tool: McpToolManifest
}

interface McpContextResolution {
  prompt: string
  traces: ProcessTrace[]
  tools: ResolvedMcpTool[]
}

interface McpToolRequest {
  serverId?: string
  toolName: string
  arguments: Record<string, unknown>
}

export function isConversationStreaming(conversationId: string): boolean {
  return activeControllers.has(conversationId)
}

export function recoverStaleStreamingMessages(conversationId: string): void {
  if (activeControllers.has(conversationId)) return
  const conversation = useChatStore.getState().conversations.find((item) => item.id === conversationId)
  const staleMessages = conversation?.messages.filter((message) => message.role === 'assistant' && (message.status === 'streaming' || message.status === 'sending')) ?? []
  if (!staleMessages.length) return
  const completedAt = Date.now()
  for (const message of staleMessages) {
    const outputText = message.responseText ?? message.content ?? ''
    const inputMessages = conversation?.messages.filter((item) => item.id !== message.id && item.status !== 'error') ?? []
    useChatStore.getState().updateMessage(conversationId, message.id, {
      status: 'cancelled',
      responseText: outputText,
      content: outputText,
      completedAt,
      durationMs: message.startedAt ? completedAt - message.startedAt : message.durationMs,
      usage: buildEstimatedUsage(inputMessages, outputText),
      estimatedTokens: true,
      tokenCount: estimateTextTokens(outputText),
    })
    upsertTrace(conversationId, message.id, completeTrace({
      id: traceId('recovered-stream'),
      type: 'system',
      title: st('chatRunner.trace.recoveredTitle'),
      content: st('chatRunner.trace.recoveredContent'),
      status: 'done',
      startedAt: completedAt,
    }))
    settleRunningTraces(conversationId, message.id, {
      fallbackStatus: outputText.trim() ? 'done' : 'skipped',
      fallbackContent: outputText.trim() ? st('chatRunner.trace.recoveredStopped') : st('chatRunner.trace.recoveredEmpty'),
    })
    void useChatStore.getState().flushStreamingMessage(conversationId, message.id)
  }
}

export async function copyMessageText(content: string): Promise<void> {
  if (content.trim()) {
    await Clipboard.setStringAsync(content)
  }
}

export async function copyMessageFinalText(message: Message): Promise<void> {
  await copyMessageText(message.responseText ?? message.content)
}

export function stopMessage(conversationId: string) {
  const active = activeControllers.get(conversationId)
  if (!active) return
  active.flush?.()
  active.controller.abort()
  activeControllers.delete(conversationId)
  const current = getMessage(conversationId, active.messageId)
  const conversation = useChatStore.getState().conversations.find((item) => item.id === conversationId)
  const inputMessages = conversation?.messages.filter((message) => message.id !== active.messageId && message.status !== 'error') ?? []
  const completedAt = Date.now()
  useChatStore.getState().updateMessage(conversationId, active.messageId, {
    status: 'cancelled',
    completedAt,
    durationMs: current?.startedAt ? completedAt - current.startedAt : current?.durationMs,
    usage: buildEstimatedUsage(inputMessages, current?.responseText ?? current?.content ?? ''),
    estimatedTokens: true,
    tokenCount: estimateTextTokens(current?.responseText ?? current?.content ?? ''),
  })
  upsertTrace(conversationId, active.messageId, completeTrace({
    id: traceId('stop'),
    type: 'system',
    title: st('chatRunner.trace.stopTitle'),
    content: st('chatRunner.trace.stopContent'),
    status: 'done',
    startedAt: completedAt,
  }))
  void useChatStore.getState().flushStreamingMessage(conversationId, active.messageId)
}

export async function sendMessage({ conversation, content, attachments = [] }: SendMessageInput) {
  const text = normalizeUserContent(content)
  if (!text && attachments.length === 0) return

  const userMessage: Message = {
    id: generateId(),
    role: 'user',
    content: text,
    attachments,
    timestamp: Date.now(),
    status: 'done',
  }

  useChatStore.getState().setError(null)
  useChatStore.getState().addMessage(conversation.id, userMessage)
  if (attachments.length === 0) {
    const localCommand = await routeLocalAppCommand(text)
    if (localCommand) {
      addLocalAppCommandReply(conversation.id, userMessage, localCommand)
      return
    }
  }
  void createAssistantReply(conversation.id).catch((error) => {
    const message = error instanceof Error ? error.message : st('chatRunner.error.sendFailed')
    useChatStore.getState().setError(message)
  })
}

function addLocalAppCommandReply(conversationId: string, userMessage: Message, command: LocalAppCommandResult): void {
  const now = Date.now()
  const assistantMessage: Message = {
    id: generateId(),
    role: 'assistant',
    content: command.message,
    responseText: command.message,
    timestamp: now,
    status: command.ok ? 'done' : 'error',
    errorCode: command.ok ? undefined : 'unknown',
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    toolCalls: [command.trace],
    usage: buildEstimatedUsage([userMessage], command.message),
    estimatedTokens: true,
    tokenCount: estimateTextTokens(command.message),
  }
  useChatStore.getState().addMessage(conversationId, assistantMessage)
}

function normalizeUserContent(content: string): string {
  return content.replace(/%20/g, ' ').trim()
}

export async function retryMessage(conversationId: string, assistantMessageId: string) {
  const store = useChatStore.getState()
  const conversation = store.conversations.find((item) => item.id === conversationId)
  if (!conversation) return
  const assistantIndex = conversation.messages.findIndex((message) => message.id === assistantMessageId)
  const previousUser = [...conversation.messages.slice(0, assistantIndex)]
    .reverse()
    .find((message) => message.role === 'user')
  if (!previousUser) return
  store.trimAfterMessage(conversationId, previousUser.id)
  void createAssistantReply(conversationId).catch((error) => {
    useChatStore.getState().setError(error instanceof Error ? error.message : st('chatRunner.error.retryFailed'))
  })
}

export async function regenerateLastAssistant(conversationId: string) {
  const store = useChatStore.getState()
  const conversation = store.conversations.find((item) => item.id === conversationId)
  if (!conversation) return
  const lastMessage = conversation.messages.at(-1)
  const lastAssistant = lastMessage?.role === 'assistant' ? lastMessage : null
  if (!lastAssistant) return
  store.removeMessage(conversationId, lastAssistant.id)
  void createAssistantReply(conversationId).catch((error) => {
    useChatStore.getState().setError(error instanceof Error ? error.message : st('chatRunner.error.regenerateFailed'))
  })
}

async function createAssistantReply(conversationId: string) {
  stopMessage(conversationId)

  const chatStore = useChatStore.getState()
  const conversation = chatStore.conversations.find((item) => item.id === conversationId)
  if (!conversation) return

  const assistantMessage: Message = {
    id: generateId(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    status: 'streaming',
    startedAt: Date.now(),
  }

  chatStore.addMessage(conversationId, assistantMessage)
  const requestController = new AbortController()
  activeControllers.set(conversationId, { controller: requestController, messageId: assistantMessage.id })

  const resolvedRuntime = await resolveRuntimeConversation(conversation)
  const runtimeConversation = resolvedRuntime?.conversation ?? conversation
  if (isReplyCancelled(conversationId, assistantMessage.id, requestController)) return
  if (runtimeConversation.providerId === 'local-setup') {
    finishWithError(conversationId, assistantMessage.id, buildSetupGuide(), 'missing_key')
    return
  }
  if (!resolvedRuntime) {
    finishWithRuntimeResolutionError(conversationId, assistantMessage.id, runtimeConversation)
    return
  }
  const provider = await useSettingsStore.getState().hydrateProviderKey(resolvedRuntime.provider.id)
  if (!provider || !provider.enabled) {
    finishWithError(conversationId, assistantMessage.id, st('chatRunner.error.providerDisabled'), 'disabled_provider', runtimeConversation.providerId)
    return
  }

  if (!provider.apiKey) {
    finishWithError(conversationId, assistantMessage.id, st('chatRunner.error.missingKey'), 'missing_key', provider.id)
    return
  }

  const configIssue = getProviderConfigIssue(provider, provider.apiKey)
  if (configIssue) {
    finishWithError(conversationId, assistantMessage.id, st(configIssue.messageKey ?? configIssue.message, undefined, configIssue.message), configIssue.code, provider.id)
    return
  }

  const upstreamModel = resolveProviderModelAlias(provider, runtimeConversation.model)
  const modelConfig = getModelConfig(upstreamModel, provider.type, provider.modelConfigs)
  if (runtimeConversation.maxTokens > modelConfig.maxOutputTokens) {
    finishWithError(conversationId, assistantMessage.id, st('chatRunner.error.maxTokensExceeded', { current: runtimeConversation.maxTokens, model: runtimeConversation.model, limit: modelConfig.maxOutputTokens }), 'max_tokens_exceeded', provider.id)
    return
  }

  const latestConversation = useChatStore
    .getState()
    .conversations.find((item) => item.id === conversationId)
  const lastUserMessage = [...(latestConversation?.messages ?? [])].reverse().find((message) => message.role === 'user')
  const settings = useSettingsStore.getState().settings
  let fallbackProviders: AIProvider[] = [provider]
  try {
    fallbackProviders = await useSettingsStore.getState().getConfiguredProviders()
  } catch {
    fallbackProviders = [provider]
  }
  const contextTraceId = traceId('context')
  upsertTrace(conversationId, assistantMessage.id, {
    id: contextTraceId,
    type: 'retrieval',
    title: st('chatRunner.trace.contextTitle'),
    status: 'running',
    startedAt: Date.now(),
    metadata: {
      memoryEnabled: useSettingsStore.getState().settings.memoryEnabled,
      knowledgeEnabled: useSettingsStore.getState().settings.knowledgeEnabled,
      ragMode: useSettingsStore.getState().settings.ragMode,
    },
  })
  let context: RetrievedContext = { sources: [] as RetrievalSource[], prompt: '' }
  if (lastUserMessage) {
    const startedAt = Date.now()
    try {
      context = await retrieveContext(runtimeConversation, lastUserMessage)
      if (isReplyCancelled(conversationId, assistantMessage.id, requestController)) return
      const memoryCount = context.sources.filter((source) => source.type === 'memory').length
      const knowledgeCount = context.sources.filter((source) => source.type === 'knowledge').length
      upsertTrace(conversationId, assistantMessage.id, completeTrace({
        id: contextTraceId,
        type: 'retrieval',
        title: st('chatRunner.trace.contextTitle'),
        content: context.sources.length
          ? st('chatRunner.trace.contextHits', { total: context.sources.length, memories: memoryCount, knowledge: knowledgeCount })
          : st('chatRunner.trace.contextNoHits'),
        status: 'done',
        startedAt,
        metadata: { memoryCount, knowledgeCount, sourceCount: context.sources.length, ragPlan: context.plan, ragQuality: context.quality },
      }))
      for (const ragTrace of context.trace ?? []) {
        upsertTrace(conversationId, assistantMessage.id, completeTrace({
          id: ragTrace.id,
          type: 'retrieval',
          title: ragTrace.title,
          content: ragTrace.content,
          status: ragTrace.status,
          startedAt: ragTrace.startedAt,
          completedAt: ragTrace.completedAt,
          durationMs: ragTrace.durationMs,
          metadata: {
            stage: ragTrace.stage,
            ...(ragTrace.metadata ?? {}),
          },
        }))
      }
      if (memoryCount) {
        upsertTrace(conversationId, assistantMessage.id, completeTrace({
          id: traceId('memory'),
          type: 'memory',
          title: st('chatRunner.trace.memoryHitTitle'),
          content: context.sources.filter((source) => source.type === 'memory').map((source) => source.title || source.excerpt || source.content.slice(0, 80)).join('\n'),
          status: 'done',
          startedAt,
          metadata: { count: memoryCount },
        }))
      }
      if (knowledgeCount) {
        upsertTrace(conversationId, assistantMessage.id, completeTrace({
          id: traceId('knowledge'),
          type: 'knowledge',
          title: st('chatRunner.trace.knowledgeHitTitle'),
          content: context.sources.filter((source) => source.type === 'knowledge').map((source) => source.title).join('\n'),
          status: 'done',
          startedAt,
          metadata: { count: knowledgeCount },
        }))
      }
    } catch (error) {
      upsertTrace(conversationId, assistantMessage.id, completeTrace({
        id: contextTraceId,
        type: 'retrieval',
        title: st('chatRunner.trace.contextTitle'),
        content: error instanceof Error ? error.message : st('chatRunner.trace.contextFailed'),
        status: 'error',
        startedAt,
      }))
    }
  } else {
    upsertTrace(conversationId, assistantMessage.id, completeTrace({
      id: contextTraceId,
      type: 'retrieval',
      title: st('chatRunner.trace.contextTitle'),
      content: st('chatRunner.trace.contextNoUserMessage'),
      status: 'skipped',
      startedAt: Date.now(),
    }))
  }
  let webSources: RetrievalSource[] = []
  const searchProvider = resolveSearchProvider(settings)
  if (searchProvider !== 'off' && searchProvider !== 'native' && lastUserMessage?.content) {
    const startedAt = Date.now()
    const webTraceId = traceId('web')
    upsertTrace(conversationId, assistantMessage.id, {
      id: webTraceId,
      type: 'search',
      title: st('chatRunner.trace.webAdapterTitle'),
      status: 'running',
      startedAt,
      metadata: { mode: searchProvider },
    })
    try {
      webSources = await searchWeb(lastUserMessage.content, 4)
      if (isReplyCancelled(conversationId, assistantMessage.id, requestController)) return
      upsertTrace(conversationId, assistantMessage.id, completeTrace({
        id: webTraceId,
        type: 'search',
        title: st('chatRunner.trace.webAdapterTitle'),
        content: webSources.length ? webSources.map((source) => source.title).join('\n') : st('chatRunner.trace.webNoSources'),
        status: 'done',
        startedAt,
        metadata: { count: webSources.length, mode: searchProvider },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : st('chatRunner.trace.webFailed')
      useChatStore.getState().setError(message)
      upsertTrace(conversationId, assistantMessage.id, completeTrace({
        id: webTraceId,
        type: 'search',
        title: st('chatRunner.trace.webAdapterTitle'),
        content: message,
        status: 'error',
        startedAt,
        metadata: { mode: searchProvider },
      }))
    }
  } else {
    upsertTrace(conversationId, assistantMessage.id, completeTrace({
      id: traceId('web-skip'),
      type: 'search',
      title: st('chatRunner.trace.webSearchTitle'),
      content: settings.webSearchEnabled
        ? searchProvider === 'native'
          ? st('chatRunner.trace.nativeSearchProviderSide')
          : st('chatRunner.trace.localSearchSkipped')
        : st('chatRunner.trace.webDisabled'),
      status: settings.webSearchEnabled ? 'skipped' : 'skipped',
      startedAt: Date.now(),
    }))
  }
  const retrievalSources = [...context.sources, ...webSources]
  const mcpContext = await resolveMcpContext(runtimeConversation)
  for (const trace of mcpContext.traces) {
    upsertTrace(conversationId, assistantMessage.id, trace)
  }
  const hasAttachments = !!lastUserMessage?.attachments?.length
  const providerWebSearchMode = searchProvider === 'native' && !hasAttachments ? 'native' : 'off'
  const nativeSearchTraceId = traceId('native-search')
  upsertTrace(conversationId, assistantMessage.id, completeTrace({
    id: nativeSearchTraceId,
    type: 'search',
    title: st('chatRunner.trace.nativeSearchTitle'),
    content: providerWebSearchMode === 'native'
      ? st('chatRunner.trace.nativeSearchRequested')
      : hasAttachments && searchProvider === 'native'
        ? st('chatRunner.trace.nativeSearchSkippedForAttachments')
        : st('chatRunner.trace.nativeSearchDisabled'),
    status: providerWebSearchMode === 'native' ? 'running' : 'skipped',
    startedAt: Date.now(),
    metadata: { mode: providerWebSearchMode },
  }))
  const systemPrompt = buildSystemPrompt({
    baseSystemPrompt: runtimeConversation.systemPrompt,
    expectedReplyFormat: runtimeConversation.skillSnapshot?.expectedReplyFormat,
    language: settings.language,
    modelConfig,
    hasMemory: context.sources.some((source) => source.type === 'memory'),
    hasKnowledge: context.sources.some((source) => source.type === 'knowledge'),
    hasWeb: webSources.length > 0 || providerWebSearchMode === 'native',
    retrievalSources,
  })
  const packedPrompt = packChatMessages({
    messages: latestConversation?.messages.filter((message) => message.id !== assistantMessage.id) ?? [],
    contextPrompt: [context.prompt, webSources.length ? formatWebPrompt(webSources) : '', mcpContext.prompt].filter(Boolean).join('\n\n'),
    modelContextWindow: modelConfig.contextWindow,
    maxOutputTokens: runtimeConversation.maxTokens,
    systemPrompt,
    reasoningEffort: runtimeConversation.reasoningEffort,
    providerType: provider.type,
    model: upstreamModel,
  })
  const compactDecision = decideRemoteCompact({
    provider,
    model: upstreamModel,
    contextPrompt: packedPrompt.contextPrompt,
    messages: packedPrompt.messages,
    budgetTokens: packedPrompt.budgetTokens,
    estimatedInputTokens: packedPrompt.estimatedInputTokens,
    settings,
  })
  void appendRuntimeLog('compact.request', {
    conversationId,
    providerId: provider.id,
    model: runtimeConversation.model,
    upstreamModel,
    mode: compactDecision.mode,
    enabled: compactDecision.enabled,
    required: compactDecision.required,
    supported: compactDecision.supported,
    reason: compactDecision.reason,
    pressureRatio: compactDecision.pressureRatio,
  }, { enabled: settings.runtimeLogEnabled, maxBytes: settings.runtimeLogMaxBytes })
  const compactRecord = recordCompactUsage({
    mode: compactDecision.mode,
    providerId: provider.id,
    model: runtimeConversation.model,
    upstreamModel,
    inputTokens: compactDecision.enabled ? packedPrompt.estimatedInputTokens : undefined,
    outputTokens: undefined,
    estimatedSavedTokens: undefined,
    failureCode: compactDecision.required && !compactDecision.supported ? 'provider_capability_missing' : undefined,
    fallbackLocal: compactDecision.mode === 'auto' && !compactDecision.enabled && packedPrompt.compressionTriggered,
  })
  void appendRuntimeLog('compact.usage', {
    conversationId,
    providerId: provider.id,
    model: runtimeConversation.model,
    upstreamModel,
    mode: compactRecord.mode,
    inputTokens: compactRecord.inputTokens,
    outputTokens: compactRecord.outputTokens,
    estimatedSavedTokens: compactRecord.estimatedSavedTokens,
    failureCode: compactRecord.failureCode,
    fallbackLocal: compactRecord.fallbackLocal,
  }, { enabled: settings.runtimeLogEnabled, maxBytes: settings.runtimeLogMaxBytes })
  upsertTrace(conversationId, assistantMessage.id, completeTrace({
    id: traceId('compact'),
    type: 'system',
    title: st('chatRunner.trace.compactPolicyTitle'),
    content: compactDecision.enabled
      ? st('chatRunner.trace.compactRemoteEligible')
      : compactDecision.reason,
    status: compactDecision.required && !compactDecision.supported ? 'error' : 'done',
    startedAt: Date.now(),
    metadata: {
      compactMode: compactDecision.enabled ? 'remote' : packedPrompt.compressionTriggered ? 'local' : 'off',
      remoteCompactMode: compactDecision.mode,
      supported: compactDecision.supported,
      reason: compactDecision.reason,
      pressureRatio: compactDecision.pressureRatio,
      inputTokens: compactRecord.inputTokens,
      failureCode: compactRecord.failureCode,
      fallbackLocal: compactRecord.fallbackLocal,
    },
  }))
  if (compactDecision.required && !compactDecision.supported) {
    finishWithError(conversationId, assistantMessage.id, st('chatRunner.error.remoteCompactRequiredFailed'), 'unknown', provider.id)
    return
  }
  const previousResponseId = compactDecision.enabled
    ? await resolvePreviousCompactResponseId(conversationId, provider.id, runtimeConversation.model, settings)
    : undefined
  if (packedPrompt.trimmedCount) {
    upsertTrace(conversationId, assistantMessage.id, completeTrace({
      id: traceId('context-pack'),
      type: 'system',
      title: st('chatRunner.trace.contextPackTitle'),
      content: st('chatRunner.trace.contextPackContent', {
        kept: packedPrompt.messages.length,
        trimmed: packedPrompt.trimmedCount,
        estimated: packedPrompt.estimatedInputTokens,
        budget: packedPrompt.budgetTokens,
      }),
      status: 'done',
      startedAt: Date.now(),
      metadata: {
        trimmedCount: packedPrompt.trimmedCount,
        estimatedInputTokens: packedPrompt.estimatedInputTokens,
        budgetTokens: packedPrompt.budgetTokens,
        fixedTokens: packedPrompt.fixedTokens,
        messageTokens: packedPrompt.messageTokens,
        modelBudgetTokens: packedPrompt.modelBudgetTokens,
        reservedOutputTokens: packedPrompt.reservedOutputTokens,
        reasoningReserveTokens: packedPrompt.reasoningReserveTokens,
        compressionTriggered: packedPrompt.compressionTriggered,
        truncatedSingleMessage: packedPrompt.truncatedSingleMessage,
      },
    }))
  }
  const chunkBuffer = createStreamingChunkBuffer(conversationId, assistantMessage.id)
  const traceBuffer = createStreamingTraceBuffer(conversationId, assistantMessage.id)
  const flushStreamingBuffers = () => {
    chunkBuffer.flush()
    traceBuffer.flush()
  }
  activeControllers.set(conversationId, { controller: requestController, messageId: assistantMessage.id, flush: flushStreamingBuffers })
  const modelTraceId = traceId('model')
  upsertTrace(conversationId, assistantMessage.id, {
    id: modelTraceId,
    type: 'system',
    title: st('chatRunner.trace.modelRequestTitle'),
    content: `${provider.name} · ${runtimeConversation.model}`,
    status: 'running',
    startedAt: Date.now(),
    metadata: {
      providerId: provider.id,
      model: runtimeConversation.model,
      upstreamModel,
      maxTokens: runtimeConversation.maxTokens,
      temperature: runtimeConversation.temperature,
    },
  })

  let handle: StreamHandle | null = null
  try {
    handle = await streamChat(
      {
        provider,
        model: runtimeConversation.model,
        requestedModel: runtimeConversation.model,
        systemPrompt,
        temperature: runtimeConversation.temperature,
        topP: runtimeConversation.topP,
        reasoningEffort: runtimeConversation.reasoningEffort,
        maxTokens: runtimeConversation.maxTokens,
        attachments: lastUserMessage?.attachments ?? [],
        messages: packedPrompt.messages,
        contextPrompt: packedPrompt.contextPrompt,
        retrievalSources,
        webSearchMode: providerWebSearchMode,
        signal: requestController.signal,
        conversationId,
        sessionId: conversationId,
        settings,
        fallbackProviders,
        remoteCompactEligible: compactDecision.enabled,
        previousResponseId,
      },
      (chunk) => {
        chunkBuffer.push(chunk)
      },
      (result) => {
        void finalizeAssistantResult({
          conversationId,
          assistantMessageId: assistantMessage.id,
          result,
          context,
          runtimeConversation,
          provider,
          modelTraceId,
          nativeSearchTraceId,
          providerWebSearchMode,
          systemPrompt,
          packedMessages: packedPrompt.messages,
          baseContextPrompt: packedPrompt.contextPrompt,
          retrievalSources,
          mcpTools: mcpContext.tools,
          requestController,
          chunkFlush: flushStreamingBuffers,
          upstreamModel,
          remoteCompactEligible: compactDecision.enabled,
          remoteCompactMode: compactDecision.mode,
          remoteCompactInputTokens: compactDecision.enabled ? packedPrompt.estimatedInputTokens : undefined,
          previousResponseId,
        })
      },
      (error) => {
        flushStreamingBuffers()
        if (activeControllers.get(conversationId)?.messageId === assistantMessage.id) {
          activeControllers.delete(conversationId)
        }
        upsertTrace(conversationId, assistantMessage.id, completeTrace({
          id: modelTraceId,
          type: 'system',
          title: st('chatRunner.trace.modelRequestTitle'),
          content: toUserFacingError(error.message),
          status: 'error',
          startedAt: getMessage(conversationId, assistantMessage.id)?.startedAt ?? Date.now(),
        }))
        if (providerWebSearchMode === 'native') {
          upsertTrace(conversationId, assistantMessage.id, completeTrace({
            id: nativeSearchTraceId,
            type: 'search',
            title: st('chatRunner.trace.nativeSearchTitle'),
            content: st('chatRunner.trace.nativeSearchFailedWithModel'),
            status: 'error',
            startedAt: getMessage(conversationId, assistantMessage.id)?.retrievalTrace?.find((trace) => trace.id === nativeSearchTraceId)?.startedAt ?? Date.now(),
            metadata: { mode: providerWebSearchMode },
          }))
        }
        finishWithError(conversationId, assistantMessage.id, toUserFacingError(error.message), classifyChatError(error.message), provider.id)
        void useSettingsStore.getState().updateProviderCredentialGroupHealth(provider.id, (error as ProviderRuntimeError).credentialGroupId, false)
      },
      (citations) => {
        useChatStore.getState().updateMessage(conversationId, assistantMessage.id, { citations })
      },
      (trace) => {
        traceBuffer.push(trace)
      }
    )
    if (requestController.signal.aborted || getMessage(conversationId, assistantMessage.id)?.status === 'cancelled') {
      handle.controller.abort()
      void handle.done.catch(() => undefined)
      return
    }
    activeControllers.set(conversationId, { controller: handle.controller, messageId: assistantMessage.id, flush: flushStreamingBuffers, done: handle.done })
    void handle.done.finally(() => {
      flushStreamingBuffers()
      if (activeControllers.get(conversationId)?.messageId === assistantMessage.id) {
        activeControllers.delete(conversationId)
      }
    })
  } catch (error) {
    flushStreamingBuffers()
    if (error instanceof Error && error.name === 'AbortError') {
      return
    }
    if (getMessage(conversationId, assistantMessage.id)?.status === 'cancelled') {
      return
    }
    const message = error instanceof Error ? error.message : st('chatRunner.error.sendFailed')
    upsertTrace(conversationId, assistantMessage.id, completeTrace({
      id: modelTraceId,
      type: 'system',
      title: st('chatRunner.trace.modelRequestTitle'),
      content: toUserFacingError(message),
      status: 'error',
      startedAt: getMessage(conversationId, assistantMessage.id)?.startedAt ?? Date.now(),
    }))
    finishWithError(conversationId, assistantMessage.id, toUserFacingError(message), classifyChatError(message), provider.id)
  }
}

function createStreamingChunkBuffer(conversationId: string, messageId: string) {
  let pendingText = ''
  let timer: ReturnType<typeof setTimeout> | null = null

  function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!pendingText) return
    const text = pendingText
    pendingText = ''
    useChatStore.getState().appendContent(conversationId, messageId, text)
  }

  function push(chunk: string) {
    if (!chunk) return
    pendingText += chunk
    if (pendingText.length >= STREAM_TEXT_MAX_BUFFER) {
      flush()
      return
    }
    if (!timer) {
      timer = setTimeout(flush, STREAM_TEXT_FLUSH_MS)
    }
  }

  return { push, flush }
}

function createStreamingTraceBuffer(conversationId: string, messageId: string) {
  const pending = new Map<string, ProcessTrace>()
  let timer: ReturnType<typeof setTimeout> | null = null

  function traceKey(trace: ProcessTrace): string {
    return trace.id || `${trace.type}:${trace.title}`
  }

  function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending.size) return
    const traces = Array.from(pending.values())
    pending.clear()
    for (const trace of traces) {
      upsertTrace(conversationId, messageId, trace)
    }
  }

  function push(trace: ProcessTrace) {
    const key = traceKey(trace)
    const current = pending.get(key)
    pending.set(key, current ? mergeBufferedTrace(current, trace) : trace)
    if (pending.size >= STREAM_TRACE_MAX_BUFFER || trace.status === 'done' || trace.status === 'error' || trace.status === 'skipped') {
      flush()
      return
    }
    if (!timer) {
      timer = setTimeout(flush, STREAM_TRACE_FLUSH_MS)
    }
  }

  return { push, flush }
}

function mergeBufferedTrace(current: ProcessTrace, next: ProcessTrace): ProcessTrace {
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
    content: content ? clampTraceContent(content, next.type) : undefined,
    startedAt: current.startedAt ?? next.startedAt,
    completedAt: next.completedAt ?? current.completedAt,
    durationMs: next.durationMs ?? current.durationMs,
    metadata: { ...current.metadata, ...next.metadata },
  }
}

async function finalizeAssistantResult(input: {
  conversationId: string
  assistantMessageId: string
  result: ChatCompletionResult
  context: RetrievedContext
  runtimeConversation: Conversation
  provider: AIProvider
  modelTraceId: string
  nativeSearchTraceId: string
  providerWebSearchMode: 'native' | 'off'
  systemPrompt: string
  packedMessages: { role: 'user' | 'assistant'; content: string | { type: 'text'; text: string }[] }[]
  baseContextPrompt: string
  retrievalSources: RetrievalSource[]
  mcpTools: ResolvedMcpTool[]
  requestController: AbortController
  chunkFlush: () => void
  upstreamModel: string
  remoteCompactEligible?: boolean
  remoteCompactMode?: RemoteCompactMode
  remoteCompactInputTokens?: number
  previousResponseId?: string
}) {
  input.chunkFlush()
  if (activeControllers.get(input.conversationId)?.messageId === input.assistantMessageId) {
    activeControllers.delete(input.conversationId)
  }
  const current = getMessage(input.conversationId, input.assistantMessageId)
  if (current?.status !== 'streaming') return
  const firstOutput = input.result.text || current.content
  const firstCitations = input.result.citations?.length ? input.result.citations : current.citations ?? []
  const verification = verifyRagGeneration({
    answer: firstOutput,
    query: input.runtimeConversation.messages.at(-1)?.content ?? input.runtimeConversation.title,
    citations: firstCitations,
    quality: input.context.quality,
  })
  upsertTrace(input.conversationId, input.assistantMessageId, completeTrace({
    id: traceId('rag-generation-verify'),
    type: 'retrieval',
    title: st('chatRunner.trace.ragVerifyTitle'),
    content: st('chatRunner.trace.ragVerifyContent', {
      confidence: Math.round(verification.confidence * 100),
      claims: verification.factualClaimCount,
      unsupported: verification.unsupportedClaimCount,
    }),
    status: verification.needsFlare ? 'skipped' : 'done',
    startedAt: Date.now(),
    metadata: { ...verification },
  }))

  let finalResult = input.result
  let finalOutput = firstOutput
  let finalCitations = firstCitations
  let flareSources: RetrievalSource[] = []

  if (input.mcpTools.length && !input.requestController.signal.aborted) {
    const mcpRevision = await resolveMcpToolRevision({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      provider: input.provider,
      conversation: input.runtimeConversation,
      systemPrompt: input.systemPrompt,
      messages: input.packedMessages,
      baseContextPrompt: input.baseContextPrompt,
      firstOutput: finalOutput,
      tools: input.mcpTools,
      signal: input.requestController.signal,
    })
    if (mcpRevision?.text.trim()) {
      finalOutput = mcpRevision.text
      finalResult = {
        ...finalResult,
        text: mcpRevision.text,
        usage: mergeUsage(finalResult.usage, mcpRevision.usage),
      }
    }
  }

  if (
    verification.needsFlare &&
    input.context.plan?.enabledTechniques.includes('flare') &&
    input.runtimeConversation.messages.at(-1)?.role === 'user' &&
    !input.requestController.signal.aborted
  ) {
    const flareStartedAt = Date.now()
    try {
      const flare = await retrieveFlareContext({
        conversation: input.runtimeConversation,
        query: input.context.plan.query,
        followupQuery: verification.followupQuery ?? input.context.plan.query,
        excludeChunkIds: input.context.sources.map((source) => source.chunkId).filter((id): id is string => !!id),
        limit: 4,
      })
      flareSources = flare.sources
      for (const ragTrace of flare.trace) {
        upsertTrace(input.conversationId, input.assistantMessageId, completeTrace({
          id: ragTrace.id,
          type: 'retrieval',
          title: ragTrace.title,
          content: ragTrace.content,
          status: ragTrace.status,
          startedAt: ragTrace.startedAt,
          completedAt: ragTrace.completedAt,
          durationMs: ragTrace.durationMs,
          metadata: { stage: ragTrace.stage, ...(ragTrace.metadata ?? {}) },
        }))
      }
      if (flare.prompt && flare.sources.length) {
        const revisedText = await reviseAnswerWithFlare({
          provider: input.provider,
          conversation: input.runtimeConversation,
          systemPrompt: input.systemPrompt,
          messages: input.packedMessages,
          contextPrompt: [input.baseContextPrompt, flare.prompt].filter(Boolean).join('\n\n'),
          originalAnswer: firstOutput,
          sources: [...input.retrievalSources, ...flare.sources],
          signal: input.requestController.signal,
        })
        if (revisedText.trim()) {
          finalOutput = revisedText
          finalCitations = dedupeMessageCitations([...finalCitations, ...flare.sources])
          finalResult = {
            ...input.result,
            text: revisedText,
            citations: finalCitations,
          }
          upsertTrace(input.conversationId, input.assistantMessageId, completeTrace({
            id: traceId('flare-revise'),
            type: 'retrieval',
            title: st('chatRunner.trace.flareTitle'),
            content: st('chatRunner.trace.flareRevised', { count: flare.sources.length }),
            status: 'done',
            startedAt: flareStartedAt,
            metadata: { sourceCount: flare.sources.length, reasons: verification.reasons },
          }))
        }
      }
    } catch (error) {
      upsertTrace(input.conversationId, input.assistantMessageId, completeTrace({
        id: traceId('flare-error'),
        type: 'retrieval',
        title: st('chatRunner.trace.flareTitle'),
        content: error instanceof Error ? error.message : st('chatRunner.trace.flareFailed'),
        status: 'error',
        startedAt: flareStartedAt,
        metadata: { reasons: verification.reasons },
      }))
    }
  }

  const completedAt = Date.now()
  const latest = useChatStore.getState().conversations.find((item) => item.id === input.conversationId)
  const inputMessages = latest?.messages.filter((message) => message.id !== input.assistantMessageId && message.status !== 'error') ?? []
  const usage = mergeUsageWithEstimate(finalResult.usage, inputMessages, finalOutput)
  if (input.remoteCompactEligible) {
    recordCompletedRemoteCompact({
      conversationId: input.conversationId,
      provider: input.provider,
      model: input.runtimeConversation.model,
      upstreamModel: input.upstreamModel,
      mode: input.remoteCompactMode ?? 'auto',
      result: finalResult,
      inputTokens: input.remoteCompactInputTokens ?? usage.inputTokens,
      outputTokens: finalResult.usage?.outputTokens,
      messageCount: inputMessages.length,
      settings: useSettingsStore.getState().settings,
      previousResponseId: input.previousResponseId,
    })
  }
  useChatStore.getState().updateMessage(input.conversationId, input.assistantMessageId, {
    status: 'done',
    content: finalOutput,
    responseText: finalOutput,
    citations: finalCitations.length ? finalCitations : current.citations,
    completedAt,
    durationMs: current.startedAt ? completedAt - current.startedAt : undefined,
    usage,
    estimatedTokens: usage.source === 'estimated',
    tokenCount: usage.outputTokens ?? estimateTextTokens(finalOutput),
  })
  void useSettingsStore.getState().updateProviderCredentialGroupHealth(input.provider.id, finalResult.credentialGroupId, true)
  void localDataStore.logRagEvaluation({
    query: input.context.plan?.query ?? input.runtimeConversation.title,
    plan: input.context.plan,
    quality: {
      ...(input.context.quality ?? {
        sourceCount: input.context.sources.length,
        citationCoverage: finalCitations.length ? 1 : 0,
        contextPrecision: 0,
        compressionRatio: 1,
        confidence: verification.confidence,
        activeRetrievals: 1,
        missingEvidence: false,
        warnings: [],
      }),
      generationConfidence: verification.confidence,
      factualClaimCount: verification.factualClaimCount,
      citedClaimCount: verification.citedClaimCount,
      unsupportedClaimCount: verification.unsupportedClaimCount,
      flareTriggered: flareSources.length > 0,
    },
    sourceCount: input.context.sources.length + flareSources.length,
    flareTriggered: flareSources.length > 0,
    fallbackReasons: input.context.quality?.fallbackReasons,
  })
  upsertTrace(input.conversationId, input.assistantMessageId, completeTrace({
    id: traceId('rag-evaluate'),
    type: 'retrieval',
    title: st('chatRunner.trace.ragEvaluateTitle'),
    content: st('chatRunner.trace.ragEvaluateContent', {
      sources: input.context.sources.length + flareSources.length,
      confidence: Math.round(verification.confidence * 100),
      flare: flareSources.length > 0 ? st('chatRunner.trace.flareYes') : st('chatRunner.trace.flareNo'),
    }),
    status: 'done',
    startedAt: Date.now(),
    metadata: {
      stage: 'evaluate',
      sourceCount: input.context.sources.length + flareSources.length,
      confidence: verification.confidence,
      flareTriggered: flareSources.length > 0,
      fallbackReasons: input.context.quality?.fallbackReasons,
    },
  }))
  upsertTrace(input.conversationId, input.assistantMessageId, completeTrace({
    id: input.modelTraceId,
    type: 'system',
    title: st('chatRunner.trace.modelRequestTitle'),
    content: finalOutput.trim() ? st('chatRunner.trace.modelReturnedText') : st('chatRunner.trace.modelNoFinalText'),
    status: finalOutput.trim() || finalResult.traces?.length ? 'done' : 'error',
    startedAt: current.startedAt ?? Date.now(),
    metadata: { textLength: finalOutput.length, providerUsage: finalResult.usage?.source === 'provider' },
  }))
  if (input.providerWebSearchMode === 'native') {
    const providerCitationCount = finalCitations.filter((citation) => citation.type === 'web').length
    upsertTrace(input.conversationId, input.assistantMessageId, completeTrace({
      id: input.nativeSearchTraceId,
      type: 'search',
      title: st('chatRunner.trace.nativeSearchTitle'),
      content: providerCitationCount
        ? st('chatRunner.trace.nativeSearchSourceCount', { count: providerCitationCount })
        : st('chatRunner.trace.nativeSearchNoSources'),
      status: 'done',
      startedAt: getMessage(input.conversationId, input.assistantMessageId)?.retrievalTrace?.find((trace) => trace.id === input.nativeSearchTraceId)?.startedAt ?? current.startedAt ?? Date.now(),
      metadata: { mode: input.providerWebSearchMode, providerCitationCount },
    }))
  }
  settleRunningTraces(input.conversationId, input.assistantMessageId, {
    fallbackStatus: finalOutput.trim() ? 'done' : 'skipped',
    fallbackContent: finalOutput.trim() ? st('chatRunner.trace.stepCompletedWithModel') : st('chatRunner.trace.stepStoppedNoText'),
  })
  const updated = useChatStore.getState().conversations.find((item) => item.id === input.conversationId)
  if (updated) {
    void extractMemoriesWithTrace(input.conversationId, input.assistantMessageId, updated.messages, input.provider, input.upstreamModel)
  }
  void useChatStore.getState().flushStreamingMessage(input.conversationId, input.assistantMessageId)
}

function recordCompletedRemoteCompact(input: {
  conversationId: string
  provider: AIProvider
  model: string
  upstreamModel?: string
  mode: RemoteCompactMode
  result: ChatCompletionResult
  inputTokens?: number
  outputTokens?: number
  messageCount: number
  settings: { runtimeLogEnabled?: boolean; runtimeLogMaxBytes?: number }
  previousResponseId?: string
}) {
  const estimatedSavedTokens = estimateRemoteCompactSavedTokens(input.inputTokens, input.outputTokens)
  const record = recordCompactUsage({
    mode: input.mode,
    providerId: input.provider.id,
    model: input.model,
    upstreamModel: input.upstreamModel ?? input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    estimatedSavedTokens,
  })
  void appendRuntimeLog('compact.usage', {
    conversationId: input.conversationId,
    providerId: input.provider.id,
    model: input.model,
    upstreamModel: input.upstreamModel ?? input.model,
    mode: record.mode,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    estimatedSavedTokens: record.estimatedSavedTokens,
    responseId: input.result.responseId,
    previousResponseId: input.previousResponseId,
    status: 'completed',
  }, { enabled: input.settings.runtimeLogEnabled, maxBytes: input.settings.runtimeLogMaxBytes })
  if (!input.result.responseId) return
  const now = Date.now()
  void saveCompactState({
    id: `compact-state-${input.result.responseId}`,
    conversationId: input.conversationId,
    providerId: input.provider.id,
    model: input.model,
    responseId: input.result.responseId,
    sessionId: input.conversationId,
    compactItemJson: JSON.stringify({
      type: 'responses_context_management',
      responseId: input.result.responseId,
      previousResponseId: input.previousResponseId,
      recordedAt: now,
    }),
    sourceMessageStartIndex: 0,
    sourceMessageEndIndex: Math.max(0, input.messageCount - 1),
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    estimatedSavedTokens,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }).catch(() => undefined)
}

async function resolveMcpToolRevision(input: {
  conversationId: string
  assistantMessageId: string
  provider: AIProvider
  conversation: Conversation
  systemPrompt: string
  messages: { role: 'user' | 'assistant'; content: string | { type: 'text'; text: string }[] }[]
  baseContextPrompt: string
  firstOutput: string
  tools: ResolvedMcpTool[]
  signal: AbortSignal
}): Promise<{ text: string; usage?: ChatCompletionResult['usage'] } | null> {
  const request = parseMcpToolRequest(input.firstOutput)
  if (!request) return null
  const resolved = findMcpTool(input.tools, request)
  if (!resolved) {
    upsertTrace(input.conversationId, input.assistantMessageId, completeTrace({
      id: traceId('mcp-unmatched'),
      type: 'tool',
      title: st('chatRunner.trace.mcpToolRequestTitle'),
      content: st('chatRunner.trace.mcpToolUnavailable', { tool: request.toolName }),
      status: 'error',
      startedAt: Date.now(),
      metadata: { requestedTool: request.toolName, serverId: request.serverId },
    }))
    return { text: st('mcpRuntime.toolUnavailable', { tool: request.toolName }) }
  }

  upsertTrace(input.conversationId, input.assistantMessageId, {
    id: traceId('mcp-call-start'),
    type: 'tool',
    title: st('chatRunner.trace.mcpToolRequestTitle'),
    content: st('chatRunner.trace.mcpToolRequested', { server: resolved.server.name, tool: resolved.tool.name }),
    status: 'running',
    startedAt: Date.now(),
    metadata: { serverId: resolved.server.id, tool: resolved.tool.name, permission: resolved.tool.permission },
  })

  const result = await callMcpTool(resolved.server, resolved.tool.name, request.arguments)
  upsertTrace(input.conversationId, input.assistantMessageId, result.trace)
  if (input.signal.aborted) return null

  const blocks = truncateToolBlocks(result.content)
  const toolOutput = formatToolBlocks(blocks)
  if (!toolOutput.trim()) {
    return { text: result.error ?? st('mcpRuntime.emptyOutput') }
  }

  try {
    const revision = await generateAnswerWithMcpToolResult({
      ...input,
      request,
      tool: resolved,
      toolOutput,
      ok: result.ok,
    })
    if (revision.text.trim()) return revision
  } catch (error) {
    upsertTrace(input.conversationId, input.assistantMessageId, completeTrace({
      id: traceId('mcp-revise-error'),
      type: 'tool',
      title: st('chatRunner.trace.mcpToolResultTitle'),
      content: error instanceof Error ? error.message : st('mcpRuntime.callFailed'),
      status: 'error',
      startedAt: Date.now(),
      metadata: { serverId: resolved.server.id, tool: resolved.tool.name },
    }))
  }

  return {
    text: [
      st('chatRunner.trace.mcpToolResultTitle'),
      '',
      toolOutput,
    ].join('\n'),
  }
}

async function generateAnswerWithMcpToolResult(input: {
  provider: AIProvider
  conversation: Conversation
  systemPrompt: string
  messages: { role: 'user' | 'assistant'; content: string | { type: 'text'; text: string }[] }[]
  baseContextPrompt: string
  firstOutput: string
  request: McpToolRequest
  tool: ResolvedMcpTool
  toolOutput: string
  ok: boolean
  signal: AbortSignal
}): Promise<{ text: string; usage?: ChatCompletionResult['usage'] }> {
  let text = ''
  let usage: ChatCompletionResult['usage']
  let failure: Error | null = null
  const handle = await streamChat(
    {
      provider: input.provider,
      model: input.conversation.model,
      systemPrompt: [
        input.systemPrompt,
        '你正在根据 MCP 工具结果生成最终回复。不要暴露工具请求 JSON；只基于工具输出和已有上下文回答用户。如果工具失败，请明确说明失败状态和可继续的下一步。',
      ].filter(Boolean).join('\n\n'),
      messages: [
        ...input.messages,
        { role: 'assistant', content: stripMcpCallBlocks(input.firstOutput) },
        {
          role: 'user',
          content: [
            `MCP 工具：${input.tool.server.name}/${input.tool.tool.name}`,
            `调用状态：${input.ok ? 'ok' : 'failed'}`,
            `请求参数：${JSON.stringify(input.request.arguments)}`,
            '',
            '工具输出：',
            input.toolOutput,
            '',
            '请生成最终回复。',
          ].join('\n'),
        },
      ],
      contextPrompt: input.baseContextPrompt,
      temperature: Math.min(input.conversation.temperature, 0.4),
      topP: input.conversation.topP,
      reasoningEffort: input.conversation.reasoningEffort,
      maxTokens: input.conversation.maxTokens,
      stream: false,
      signal: input.signal,
      conversationId: input.conversation.id,
      sessionId: input.conversation.id,
      settings: useSettingsStore.getState().settings,
      remoteCompactEligible: false,
    },
    (chunk) => {
      text += chunk
    },
    (result) => {
      text = result.text || text
      usage = result.usage
    },
    (error) => {
      failure = error
    }
  )
  await handle.done
  if (failure) throw failure
  return { text, usage }
}

function parseMcpToolRequest(output: string): McpToolRequest | null {
  const text = output.trim()
  if (!text) return null
  const match = text.match(new RegExp(`<${MCP_CALL_TAG}>\\s*([\\s\\S]*?)\\s*<\\/${MCP_CALL_TAG}>`, 'i'))
  const raw = match?.[1] ?? (looksLikeMcpRequestJson(text) ? text : '')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const toolValue = typeof parsed.tool === 'string'
      ? parsed.tool
      : typeof parsed.toolName === 'string'
        ? parsed.toolName
        : typeof parsed.name === 'string'
          ? parsed.name
          : ''
    if (!toolValue.trim()) return null
    const split = splitToolReference(toolValue)
    const serverId = typeof parsed.serverId === 'string' && parsed.serverId.trim()
      ? parsed.serverId.trim()
      : split.serverId
    return {
      serverId,
      toolName: split.toolName,
      arguments: normalizeMcpArguments(parsed.arguments ?? parsed.args ?? parsed.input),
    }
  } catch {
    return null
  }
}

function looksLikeMcpRequestJson(text: string): boolean {
  return text.startsWith('{') && /"(tool|toolName|name)"\s*:/.test(text) && /"(arguments|args|input)"\s*:/.test(text)
}

function splitToolReference(value: string): { serverId?: string; toolName: string } {
  const trimmed = value.trim()
  const separator = trimmed.includes('/') ? '/' : trimmed.includes(':') ? ':' : ''
  if (!separator) return { toolName: trimmed }
  const [serverId, ...rest] = trimmed.split(separator)
  const toolName = rest.join(separator).trim()
  return toolName ? { serverId: serverId.trim(), toolName } : { toolName: trimmed }
}

function normalizeMcpArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function findMcpTool(tools: ResolvedMcpTool[], request: McpToolRequest): ResolvedMcpTool | undefined {
  return tools.find(({ server, tool }) => {
    if (request.serverId && server.id !== request.serverId && server.name !== request.serverId) return false
    return tool.name === request.toolName || `${server.id}:${tool.name}` === request.toolName || `${server.id}/${tool.name}` === request.toolName
  }) ?? tools.find(({ tool }) => !request.serverId && tool.name === request.toolName)
}

function stripMcpCallBlocks(output: string): string {
  return output.replace(new RegExp(`<${MCP_CALL_TAG}>[\\s\\S]*?<\\/${MCP_CALL_TAG}>`, 'gi'), '').trim()
}

function formatToolBlocks(blocks: ToolContentBlock[]): string {
  return blocks.map((block) => {
    if (block.type === 'text') return block.text ?? ''
    if (block.type === 'resource') return [block.uri, block.text].filter(Boolean).join('\n')
    if (block.type === 'image') return block.mimeType ? `[image:${block.mimeType}]` : '[image]'
    return ''
  }).filter(Boolean).join('\n\n')
}

function mergeUsage(base: ChatCompletionResult['usage'], extra: ChatCompletionResult['usage']): ChatCompletionResult['usage'] {
  if (!base) return extra
  if (!extra) return base
  return {
    source: base.source === 'provider' && extra.source === 'provider' ? 'provider' : 'estimated',
    inputTokens: addOptionalNumbers(base.inputTokens, extra.inputTokens),
    outputTokens: addOptionalNumbers(base.outputTokens, extra.outputTokens),
    reasoningTokens: addOptionalNumbers(base.reasoningTokens, extra.reasoningTokens),
    totalTokens: addOptionalNumbers(base.totalTokens, extra.totalTokens) ?? addOptionalNumbers(addOptionalNumbers(base.inputTokens, base.outputTokens), addOptionalNumbers(extra.inputTokens, extra.outputTokens)),
  }
}

function addOptionalNumbers(a?: number, b?: number): number | undefined {
  if (typeof a !== 'number') return b
  if (typeof b !== 'number') return a
  return a + b
}

async function resolvePreviousCompactResponseId(
  conversationId: string,
  providerId: string,
  model: string,
  settings: { runtimeLogEnabled?: boolean; runtimeLogMaxBytes?: number }
): Promise<string | undefined> {
  try {
    const [state] = await listActiveCompactStates(conversationId, providerId, model)
    if (!state?.responseId) return undefined
    void appendRuntimeLog('compact.request', {
      conversationId,
      providerId,
      model,
      previousResponseId: state.responseId,
      compactStateId: state.id,
      status: 'state_reused',
    }, { enabled: settings.runtimeLogEnabled, maxBytes: settings.runtimeLogMaxBytes })
    return state.responseId
  } catch {
    return undefined
  }
}

async function reviseAnswerWithFlare(input: {
  provider: AIProvider
  conversation: Conversation
  systemPrompt: string
  messages: { role: 'user' | 'assistant'; content: string | { type: 'text'; text: string }[] }[]
  contextPrompt: string
  originalAnswer: string
  sources: RetrievalSource[]
  signal: AbortSignal
}): Promise<string> {
  let text = ''
  let failure: Error | null = null
  const handle = await streamChat(
    {
      provider: input.provider,
      model: input.conversation.model,
      systemPrompt: [
        input.systemPrompt,
        '你正在执行 FLARE 修订。保留原答案中有证据的部分；只用新增证据修订低置信或缺引用内容；保持简洁，并使用 [1] [2] 形式引用。',
      ].filter(Boolean).join('\n\n'),
      messages: [
        ...input.messages,
        { role: 'assistant', content: input.originalAnswer },
        { role: 'user', content: '请基于 FLARE 补充证据修订上一条回答。' },
      ],
      contextPrompt: input.contextPrompt,
      retrievalSources: input.sources,
      temperature: Math.min(input.conversation.temperature, 0.4),
      topP: input.conversation.topP,
      reasoningEffort: input.conversation.reasoningEffort,
      maxTokens: input.conversation.maxTokens,
      stream: false,
      signal: input.signal,
      conversationId: input.conversation.id,
      sessionId: input.conversation.id,
      settings: useSettingsStore.getState().settings,
      remoteCompactEligible: false,
    },
    (chunk) => {
      text += chunk
    },
    (result) => {
      text = result.text || text
    },
    (error) => {
      failure = error
    }
  )
  await handle.done
  if (failure) throw failure
  return text
}

function dedupeMessageCitations(citations: RetrievalSource[] | NonNullable<Message['citations']>): NonNullable<Message['citations']> {
  const map = new Map<string, NonNullable<Message['citations']>[number]>()
  for (const citation of citations) {
    const key = citation.chunkId ?? citation.url ?? citation.id
    if (!map.has(key)) map.set(key, citation)
  }
  return Array.from(map.values())
}

function isReplyCancelled(conversationId: string, messageId: string, controller: AbortController): boolean {
  if (controller.signal.aborted) return true
  const current = getMessage(conversationId, messageId)
  return current?.status === 'cancelled'
}

function formatWebPrompt(sources: { title: string; content: string; url?: string }[]): string {
  return [
    '以下是联网搜索结果。请优先引用来源 URL，并避免编造未出现的信息。',
    ...sources.map((source, index) => `[W${index + 1}] ${source.title}${source.url ? `\n${source.url}` : ''}\n${source.content}`),
  ].join('\n\n')
}

async function resolveRuntimeConversation(conversation: Conversation): Promise<{ conversation: Conversation; provider: AIProvider } | null> {
  const settings = useSettingsStore.getState().settings
  const currentProvider = useSettingsStore.getState().providers.find((item) => item.id === conversation.providerId)
  if ((conversation.providerModelMode ?? 'inherited') !== 'inherited') {
    return currentProvider && getPolicyAllowedProviderModels(currentProvider, settings).includes(conversation.model) ? { conversation, provider: currentProvider } : null
  }
  if (currentProvider && currentProvider.enabled && getPolicyAllowedProviderModels(currentProvider, settings).includes(conversation.model)) {
    return { conversation, provider: currentProvider }
  }
  return null
}

function finishWithRuntimeResolutionError(conversationId: string, messageId: string, conversation: Conversation) {
  const provider = useSettingsStore.getState().providers.find((item) => item.id === conversation.providerId)
  if (provider && !provider.enabled) {
    finishWithError(conversationId, messageId, st('chatRunner.error.providerDisabled'), 'disabled_provider', provider.id)
    return
  }
  finishWithError(conversationId, messageId, st('chatRunner.userError.modelUnavailable'), 'model_unavailable', provider?.id ?? conversation.providerId)
}

async function resolveMcpContext(conversation: Conversation): Promise<McpContextResolution> {
  const settings = useSettingsStore.getState().settings
  const startedAt = Date.now()
  if (!settings.mcpEnabled) {
    return {
      prompt: '',
      tools: [],
      traces: [completeTrace({
        id: traceId('mcp-disabled'),
        type: 'tool',
        title: st('chatRunner.trace.mcpTitle'),
        content: st('chatRunner.trace.mcpDisabled'),
        status: 'skipped',
        startedAt,
      })],
    }
  }
  const enabledTools = conversation.enabledTools ?? conversation.skillSnapshot?.enabledTools ?? []
  const servers = await listMcpServers()
  const tools = servers
    .filter((server) => server.enabled)
    .flatMap((server) => server.tools.filter((tool) => tool.enabled).map((tool) => ({ server, tool })))
  const selected = enabledTools.length
    ? tools.filter((item) => enabledTools.includes(item.tool.name) || enabledTools.includes(`${item.server.id}:${item.tool.name}`))
    : tools
  if (!selected.length) {
    return {
      prompt: '',
      tools: [],
      traces: [completeTrace({
        id: traceId('mcp-empty'),
        type: 'tool',
        title: st('chatRunner.trace.mcpTitle'),
        content: st('chatRunner.trace.mcpNoTools'),
        status: 'skipped',
        startedAt,
      })],
    }
  }
  const connected = selected.filter((item) => item.server.status === 'connected')
  const offline = selected.filter((item) => item.server.status !== 'connected')
  const prompt = connected.length
    ? [
        '当前可用 MCP 工具清单。普通回答不需要调用工具时请直接回答。',
        `如果必须调用工具，请只输出一个 <${MCP_CALL_TAG}>JSON</${MCP_CALL_TAG}> 块，不要输出其它正文。`,
        'JSON 格式：{"serverId":"server-id","tool":"tool-name","arguments":{}}。',
        '工具执行后，系统会把工具结果交给你生成最终回复。',
        ...connected.map(({ server, tool }) => `- ${server.id}/${tool.name} (${server.name}) [${tool.permission}]: ${tool.description ?? 'No description'}${tool.inputSchema ? `\n  inputSchema: ${JSON.stringify(tool.inputSchema).slice(0, 600)}` : ''}`),
      ].join('\n')
    : ''
  return {
    prompt,
    tools: connected,
    traces: [completeTrace({
      id: traceId('mcp-manifest'),
      type: 'tool',
      title: st('chatRunner.trace.mcpManifestTitle'),
      content: [
        connected.length ? st('chatRunner.trace.mcpConnectedTools', { count: connected.length, tools: connected.map((item) => `${item.server.name}/${item.tool.name}`).join(', ') }) : st('chatRunner.trace.mcpNoOnlineTools'),
        offline.length ? st('chatRunner.trace.mcpOfflineTools', { count: offline.length, tools: offline.map((item) => `${item.server.name}/${item.tool.name}`).join(', ') }) : '',
      ].filter(Boolean).join('\n'),
      status: connected.length ? 'done' : 'skipped',
      startedAt,
      metadata: { connected: connected.length, offline: offline.length },
    })],
  }
}

function finishWithError(conversationId: string, messageId: string, content: string, errorCode: ChatErrorCode = 'unknown', providerId?: string) {
  const active = activeControllers.get(conversationId)
  if (active?.messageId === messageId) {
    activeControllers.delete(conversationId)
  }
  const current = getMessage(conversationId, messageId)
  const conversation = useChatStore.getState().conversations.find((item) => item.id === conversationId)
  const inputMessages = conversation?.messages.filter((message) => message.id !== messageId && message.status !== 'error') ?? []
  const completedAt = Date.now()
  const outputText = content || current?.content || ''
  useChatStore.getState().updateMessage(conversationId, messageId, {
    status: 'error',
    content: outputText,
    responseText: outputText,
    errorCode,
    errorProviderId: providerId,
    completedAt,
    durationMs: current?.startedAt ? completedAt - current.startedAt : current?.durationMs,
    usage: buildEstimatedUsage(inputMessages, outputText),
    estimatedTokens: true,
    tokenCount: estimateTextTokens(outputText),
  })
  useChatStore.getState().setError(content)
  void useChatStore.getState().flushStreamingMessage(conversationId, messageId)
}

function upsertTrace(conversationId: string, messageId: string, trace: ProcessTrace) {
  useChatStore.getState().upsertMessageTrace(conversationId, messageId, sanitizeTrace(trace))
}

function completeTrace(trace: ProcessTrace): ProcessTrace {
  const completedAt = trace.completedAt ?? Date.now()
  return {
    ...trace,
    completedAt,
    durationMs: trace.startedAt ? completedAt - trace.startedAt : trace.durationMs,
  }
}

function sanitizeTrace(trace: ProcessTrace): ProcessTrace {
  const content = trace.content?.trim()
  const status = trace.status === 'running' && trace.completedAt ? 'done' : trace.status
  return {
    ...trace,
    status,
    content: content ? clampTraceContent(content, trace.type) : undefined,
  }
}

function clampTraceContent(content: string, type: ProcessTrace['type']): string {
  const limit = type === 'tool' ? 520 : type === 'reasoning' ? 760 : 1400
  return content.length > limit ? `${content.slice(0, limit)}...` : content
}

function settleRunningTraces(
  conversationId: string,
  messageId: string,
  options: { fallbackStatus: ProcessTrace['status']; fallbackContent: string }
) {
  const message = getMessage(conversationId, messageId)
  const traces = [
    ...(message?.retrievalTrace ?? []),
    ...(message?.reasoning ?? []),
    ...(message?.toolCalls ?? []),
  ]
  for (const trace of traces) {
    if (trace.status !== 'running' && trace.status !== 'pending') continue
    upsertTrace(conversationId, messageId, completeTrace({
      ...trace,
      status: options.fallbackStatus,
      content: trace.content ?? options.fallbackContent,
    }))
  }
}

async function extractMemoriesWithTrace(conversationId: string, messageId: string, messages: Message[], provider: AIProvider, model: string) {
  const settings = useSettingsStore.getState().settings
  const startedAt = Date.now()
  const id = traceId('memory-extract')
  if (!settings.memoryEnabled) {
    upsertTrace(conversationId, messageId, completeTrace({
      id,
      type: 'memory',
      title: st('chatRunner.trace.memoryExtractTitle'),
      content: st('chatRunner.trace.memoryExtractDisabled'),
      status: 'skipped',
      startedAt,
    }))
    return
  }
  if (!provider.apiKey) {
    upsertTrace(conversationId, messageId, completeTrace({
      id,
      type: 'memory',
      title: st('chatRunner.trace.memoryExtractTitle'),
      content: st('chatRunner.trace.memoryExtractMissingKey'),
      status: 'skipped',
      startedAt,
    }))
    return
  }
  upsertTrace(conversationId, messageId, {
    id,
    type: 'memory',
    title: st('chatRunner.trace.memoryExtractTitle'),
    content: st('chatRunner.trace.memoryExtractRunning'),
    status: 'running',
    startedAt,
  })
  try {
    const added = await extractMemories(conversationId, messages, provider, model)
    upsertTrace(conversationId, messageId, completeTrace({
      id,
      type: 'memory',
      title: st('chatRunner.trace.memoryExtractTitle'),
      content: added.length
        ? st('chatRunner.trace.memoryExtractAdded', { count: added.length, items: added.slice(0, 3).join('; ') })
        : st('chatRunner.trace.memoryExtractNone'),
      status: 'done',
      startedAt,
      metadata: { addedCount: added.length },
    }))
  } catch (error) {
    upsertTrace(conversationId, messageId, completeTrace({
      id,
      type: 'memory',
      title: st('chatRunner.trace.memoryExtractTitle'),
      content: error instanceof Error ? error.message : st('chatRunner.trace.memoryExtractFailed'),
      status: 'error',
      startedAt,
    }))
  }
}

function buildSetupGuide(): string {
  return [
    st('chatRunner.setup.noProvider'),
    '',
    st('chatRunner.setup.stepProvider'),
    st('chatRunner.setup.stepKey'),
    st('chatRunner.setup.stepModel'),
  ].join('\n')
}

function classifyChatError(message: string): ChatErrorCode {
  const text = message.toLowerCase()
  if (text.includes('401') || text.includes('403') || text.includes('unauthorized') || text.includes('invalid api key') || text.includes('permission')) {
    return 'bad_auth'
  }
  if (text.includes('credential_mismatch') || text.includes('token plan') || text.includes('tp-') || text.includes('sk-')) {
    return 'credential_mismatch'
  }
  if (text.includes('aborterror') || text.includes('timeout') || text.includes('timed out') || text.includes('超时')) {
    return 'timeout'
  }
  if (text.includes('no response body') || text.includes('empty response') || text.includes('模型返回为空')) {
    return 'network_error'
  }
  if (text.includes('rate limit') || text.includes('too many requests') || text.includes('429') || text.includes('quota') || text.includes('额度')) return 'rate_limited'
  if (text.includes('max_tokens') || text.includes('max_completion_tokens') || text.includes('too many tokens') || text.includes('context length') || text.includes('输出上限')) return 'max_tokens_exceeded'
  if (text.includes('404') || text.includes('model') || text.includes('not found')) {
    return 'model_unavailable'
  }
  if (text.includes('failed to fetch') || text.includes('network') || text.includes('timeout')) {
    return 'network_error'
  }
  if (text.includes('api error 400') || text.includes('base url') || text.includes('unsupported url')) {
    return 'bad_base_url'
  }
  return 'unknown'
}

function toUserFacingError(message: string): string {
  const code = classifyChatError(message)
  switch (code) {
    case 'bad_auth':
      return st('chatRunner.userError.badAuth')
    case 'credential_mismatch':
      return message || st('chatRunner.userError.credentialMismatch')
    case 'model_unavailable':
      return st('chatRunner.userError.modelUnavailable')
    case 'network_error':
      return message.toLowerCase().includes('no response body') || message.toLowerCase().includes('empty response')
        ? st('chatRunner.userError.emptyResponse')
        : st('chatRunner.userError.network')
    case 'timeout':
      return st('chatRunner.userError.timeout')
    case 'rate_limited':
      return st('chatRunner.userError.rateLimited')
    case 'max_tokens_exceeded':
      return message || st('chatRunner.userError.maxTokens')
    case 'bad_base_url':
      return st('chatRunner.userError.badBaseUrl')
    case 'missing_key':
    case 'disabled_provider':
    case 'unknown':
      return message || st('chatRunner.error.sendFailed')
  }
}

function getMessage(conversationId: string, messageId: string): Message | null {
  const conversation = useChatStore.getState().conversations.find((item) => item.id === conversationId)
  return conversation?.messages.find((message) => message.id === messageId) ?? null
}
