import * as Clipboard from 'expo-clipboard'
import type { AIProvider, Attachment, ChatErrorCode, Conversation, Message, ProcessTrace, RetrievalSource } from '@/types'
import { getModelConfig, getProviderConfigIssue } from '@/types'
import { streamChat, type StreamHandle } from '@/services/ai/base'
import { extractMemories, retrieveContext, searchWeb } from '@/services/context'
import { buildSystemPrompt } from '@/services/promptEngineering'
import { buildEstimatedUsage, estimateTextTokens, mergeUsageWithEstimate } from '@/services/tokenUsage'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'

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
      title: '恢复未完成生成',
      content: '检测到没有活动请求的流式消息，已保留已有正文并退出生成状态。',
      status: 'done',
      startedAt: completedAt,
    }))
    settleRunningTraces(conversationId, message.id, {
      fallbackStatus: outputText.trim() ? 'done' : 'skipped',
      fallbackContent: outputText.trim() ? '请求已恢复为已停止状态。' : '请求已恢复，未发现可保留正文。',
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
    title: '停止生成',
    content: '用户手动停止了当前流式请求，已保留已生成正文。',
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
  void createAssistantReply(conversation.id).catch((error) => {
    const message = error instanceof Error ? error.message : '发送失败，请稍后重试。'
    useChatStore.getState().setError(message)
  })
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
    useChatStore.getState().setError(error instanceof Error ? error.message : '重试失败，请稍后重试。')
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
    useChatStore.getState().setError(error instanceof Error ? error.message : '重新生成失败，请稍后重试。')
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

  const provider = await useSettingsStore.getState().hydrateProviderKey(conversation.providerId)
  if (isReplyCancelled(conversationId, assistantMessage.id, requestController)) return
  if (conversation.providerId === 'local-setup') {
    finishWithError(conversationId, assistantMessage.id, buildSetupGuide(), 'missing_key')
    return
  }
  if (!provider || !provider.enabled) {
    finishWithError(conversationId, assistantMessage.id, '当前服务商未启用，请在设置中启用后重试。', 'disabled_provider', conversation.providerId)
    return
  }

  if (!provider.apiKey) {
    finishWithError(conversationId, assistantMessage.id, '请先在设置中为当前服务商保存 API Key。', 'missing_key', provider.id)
    return
  }

  const configIssue = getProviderConfigIssue(provider, provider.apiKey)
  if (configIssue) {
    finishWithError(conversationId, assistantMessage.id, configIssue.message, configIssue.code, provider.id)
    return
  }

  const modelConfig = getModelConfig(conversation.model, provider.type, provider.modelConfigs)
  if (conversation.maxTokens > modelConfig.maxOutputTokens) {
    finishWithError(conversationId, assistantMessage.id, `当前 Max Tokens 为 ${conversation.maxTokens}，超过 ${conversation.model} 的输出上限 ${modelConfig.maxOutputTokens}。请降低输出长度后重试。`, 'max_tokens_exceeded', provider.id)
    return
  }

  const latestConversation = useChatStore
    .getState()
    .conversations.find((item) => item.id === conversationId)

  const promptMessages =
    latestConversation?.messages
      .filter((message) => message.id !== assistantMessage.id && message.status !== 'error' && message.status !== 'cancelled')
      .map((message) => ({ role: message.role, content: message.responseText ?? message.content })) ?? []
  const lastUserMessage = [...(latestConversation?.messages ?? [])].reverse().find((message) => message.role === 'user')
  const settings = useSettingsStore.getState().settings
  const contextTraceId = traceId('context')
  upsertTrace(conversationId, assistantMessage.id, {
    id: contextTraceId,
    type: 'retrieval',
    title: '检索本机上下文',
    status: 'running',
    startedAt: Date.now(),
    metadata: {
      memoryEnabled: useSettingsStore.getState().settings.memoryEnabled,
      knowledgeEnabled: useSettingsStore.getState().settings.knowledgeEnabled,
      ragMode: useSettingsStore.getState().settings.ragMode,
    },
  })
  let context = { sources: [] as RetrievalSource[], prompt: '' }
  if (lastUserMessage) {
    const startedAt = Date.now()
    try {
      context = await retrieveContext(conversation, lastUserMessage)
      if (isReplyCancelled(conversationId, assistantMessage.id, requestController)) return
      const memoryCount = context.sources.filter((source) => source.type === 'memory').length
      const knowledgeCount = context.sources.filter((source) => source.type === 'knowledge').length
      upsertTrace(conversationId, assistantMessage.id, completeTrace({
        id: contextTraceId,
        type: 'retrieval',
        title: '检索本机上下文',
        content: context.sources.length
          ? `命中 ${context.sources.length} 条上下文：记忆 ${memoryCount} 条，知识库 ${knowledgeCount} 条。`
          : '检索已执行，但本轮没有命中记忆或知识库。功能已运行，不是跳过。',
        status: 'done',
        startedAt,
        metadata: { memoryCount, knowledgeCount, sourceCount: context.sources.length },
      }))
      if (memoryCount) {
        upsertTrace(conversationId, assistantMessage.id, completeTrace({
          id: traceId('memory'),
          type: 'memory',
          title: '记忆命中',
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
          title: '知识库命中',
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
        title: '检索本机上下文',
        content: error instanceof Error ? error.message : '上下文检索失败，已跳过。',
        status: 'error',
        startedAt,
      }))
    }
  } else {
    upsertTrace(conversationId, assistantMessage.id, completeTrace({
      id: contextTraceId,
      type: 'retrieval',
      title: '检索本机上下文',
      content: '还没有用户消息，跳过上下文检索。',
      status: 'skipped',
      startedAt: Date.now(),
    }))
  }
  let webSources: RetrievalSource[] = []
  if (settings.webSearchEnabled && settings.webSearchMode === 'tavily' && lastUserMessage?.content) {
    const startedAt = Date.now()
    const webTraceId = traceId('web')
    upsertTrace(conversationId, assistantMessage.id, {
      id: webTraceId,
      type: 'search',
      title: 'Tavily 联网搜索',
      status: 'running',
      startedAt,
      metadata: { mode: 'tavily' },
    })
    try {
      webSources = await searchWeb(lastUserMessage.content, 4)
      if (isReplyCancelled(conversationId, assistantMessage.id, requestController)) return
      upsertTrace(conversationId, assistantMessage.id, completeTrace({
        id: webTraceId,
        type: 'search',
        title: 'Tavily 联网搜索',
        content: webSources.length ? webSources.map((source) => source.title).join('\n') : 'Tavily 请求已执行，但没有返回可用网页来源。',
        status: 'done',
        startedAt,
        metadata: { count: webSources.length },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : '联网搜索失败，已跳过搜索上下文。'
      useChatStore.getState().setError(message)
      upsertTrace(conversationId, assistantMessage.id, completeTrace({
        id: webTraceId,
        type: 'search',
        title: 'Tavily 联网搜索',
        content: message,
        status: 'error',
        startedAt,
      }))
    }
  } else {
    upsertTrace(conversationId, assistantMessage.id, completeTrace({
      id: traceId('web-skip'),
      type: 'search',
      title: '联网搜索',
      content: settings.webSearchEnabled
        ? settings.webSearchMode === 'native'
          ? '使用服务商原生联网能力时，搜索过程由模型侧返回；如果服务商未返回来源，会显示为降级。'
          : '当前搜索模式不会在本地发起 Tavily 请求。'
        : '联网搜索未开启。',
      status: settings.webSearchEnabled ? 'skipped' : 'skipped',
      startedAt: Date.now(),
    }))
  }
  const retrievalSources = [...context.sources, ...webSources]
  const hasAttachments = !!lastUserMessage?.attachments?.length
  const providerWebSearchMode = settings.webSearchEnabled && settings.webSearchMode === 'native' && !hasAttachments ? 'native' : 'off'
  const nativeSearchTraceId = traceId('native-search')
  upsertTrace(conversationId, assistantMessage.id, completeTrace({
    id: nativeSearchTraceId,
    type: 'search',
    title: '服务商原生搜索',
    content: providerWebSearchMode === 'native'
      ? '已请求服务商启用原生搜索/grounding；实际来源以服务商返回为准。'
      : hasAttachments && settings.webSearchEnabled && settings.webSearchMode === 'native'
        ? '本轮包含附件，为避免协议冲突已跳过原生搜索。'
        : '未启用服务商原生搜索。',
    status: providerWebSearchMode === 'native' ? 'running' : 'skipped',
    startedAt: Date.now(),
    metadata: { mode: providerWebSearchMode },
  }))
  const systemPrompt = buildSystemPrompt({
    baseSystemPrompt: conversation.systemPrompt,
    language: settings.language,
    modelConfig,
    hasMemory: context.sources.some((source) => source.type === 'memory'),
    hasKnowledge: context.sources.some((source) => source.type === 'knowledge'),
    hasWeb: webSources.length > 0 || providerWebSearchMode === 'native',
    retrievalSources,
  })
  const chunkBuffer = createStreamingChunkBuffer(conversationId, assistantMessage.id)
  activeControllers.set(conversationId, { controller: requestController, messageId: assistantMessage.id, flush: chunkBuffer.flush })
  const modelTraceId = traceId('model')
  upsertTrace(conversationId, assistantMessage.id, {
    id: modelTraceId,
    type: 'system',
    title: '请求模型',
    content: `${provider.name} · ${conversation.model}`,
    status: 'running',
    startedAt: Date.now(),
    metadata: {
      providerId: provider.id,
      model: conversation.model,
      maxTokens: conversation.maxTokens,
      temperature: conversation.temperature,
    },
  })

  let handle: StreamHandle | null = null
  try {
    handle = await streamChat(
      {
        provider,
        model: conversation.model,
        systemPrompt,
        temperature: conversation.temperature,
        maxTokens: conversation.maxTokens,
        attachments: lastUserMessage?.attachments ?? [],
        messages: promptMessages,
        contextPrompt: [context.prompt, webSources.length ? formatWebPrompt(webSources) : ''].filter(Boolean).join('\n\n'),
        retrievalSources,
        webSearchMode: providerWebSearchMode,
        signal: requestController.signal,
      },
      (chunk) => {
        chunkBuffer.push(chunk)
      },
      (result) => {
        chunkBuffer.flush()
        if (activeControllers.get(conversationId)?.messageId === assistantMessage.id) {
          activeControllers.delete(conversationId)
        }
        const current = getMessage(conversationId, assistantMessage.id)
        if (current?.status === 'streaming') {
          const completedAt = Date.now()
          const latest = useChatStore.getState().conversations.find((item) => item.id === conversationId)
          const inputMessages = latest?.messages.filter((message) => message.id !== assistantMessage.id && message.status !== 'error') ?? []
          const outputText = result.text || current.content
          const usage = mergeUsageWithEstimate(result.usage, inputMessages, outputText)
          useChatStore.getState().updateMessage(conversationId, assistantMessage.id, {
            status: 'done',
            content: outputText,
            responseText: outputText,
            citations: result.citations?.length ? result.citations : current.citations,
            completedAt,
            durationMs: current.startedAt ? completedAt - current.startedAt : undefined,
            usage,
            estimatedTokens: usage.source === 'estimated',
            tokenCount: usage.outputTokens ?? estimateTextTokens(outputText),
          })
          upsertTrace(conversationId, assistantMessage.id, completeTrace({
            id: modelTraceId,
            type: 'system',
            title: '请求模型',
            content: outputText.trim() ? '模型已返回最终正文。' : '模型没有返回最终正文，过程面板中可能有服务商返回的摘要或工具事件。',
            status: outputText.trim() || result.traces?.length ? 'done' : 'error',
            startedAt: current.startedAt ?? Date.now(),
            metadata: { textLength: outputText.length, providerUsage: result.usage?.source === 'provider' },
          }))
          if (providerWebSearchMode === 'native') {
            const providerCitationCount = (result.citations ?? current.citations ?? []).filter((citation) => citation.type === 'web').length
            upsertTrace(conversationId, assistantMessage.id, completeTrace({
              id: nativeSearchTraceId,
              type: 'search',
              title: '服务商原生搜索',
              content: providerCitationCount
                ? `服务商返回了 ${providerCitationCount} 条网页来源。`
                : '服务商原生搜索请求已随模型完成，但没有返回可展示的网页来源。',
              status: 'done',
              startedAt: getMessage(conversationId, assistantMessage.id)?.retrievalTrace?.find((trace) => trace.id === nativeSearchTraceId)?.startedAt ?? current.startedAt ?? Date.now(),
              metadata: { mode: providerWebSearchMode, providerCitationCount },
            }))
          }
          settleRunningTraces(conversationId, assistantMessage.id, {
            fallbackStatus: outputText.trim() ? 'done' : 'skipped',
            fallbackContent: outputText.trim() ? '步骤已随模型请求完成。' : '模型未返回正文，步骤已停止等待。',
          })
          const updated = useChatStore.getState().conversations.find((item) => item.id === conversationId)
          if (updated) {
            void extractMemoriesWithTrace(conversationId, assistantMessage.id, updated.messages, provider, conversation.model)
          }
          void useChatStore.getState().flushStreamingMessage(conversationId, assistantMessage.id)
        }
      },
      (error) => {
        chunkBuffer.flush()
        if (activeControllers.get(conversationId)?.messageId === assistantMessage.id) {
          activeControllers.delete(conversationId)
        }
        upsertTrace(conversationId, assistantMessage.id, completeTrace({
          id: modelTraceId,
          type: 'system',
          title: '请求模型',
          content: toUserFacingError(error.message),
          status: 'error',
          startedAt: getMessage(conversationId, assistantMessage.id)?.startedAt ?? Date.now(),
        }))
        if (providerWebSearchMode === 'native') {
          upsertTrace(conversationId, assistantMessage.id, completeTrace({
            id: nativeSearchTraceId,
            type: 'search',
            title: '服务商原生搜索',
            content: '模型请求失败，原生搜索未完成。',
            status: 'error',
            startedAt: getMessage(conversationId, assistantMessage.id)?.retrievalTrace?.find((trace) => trace.id === nativeSearchTraceId)?.startedAt ?? Date.now(),
            metadata: { mode: providerWebSearchMode },
          }))
        }
        finishWithError(conversationId, assistantMessage.id, toUserFacingError(error.message), classifyChatError(error.message), provider.id)
      },
      (citations) => {
        useChatStore.getState().updateMessage(conversationId, assistantMessage.id, { citations })
      },
      (trace) => {
        upsertTrace(conversationId, assistantMessage.id, trace)
      }
    )
    if (requestController.signal.aborted || getMessage(conversationId, assistantMessage.id)?.status === 'cancelled') {
      handle.controller.abort()
      void handle.done.catch(() => undefined)
      return
    }
    activeControllers.set(conversationId, { controller: handle.controller, messageId: assistantMessage.id, flush: chunkBuffer.flush, done: handle.done })
    void handle.done.finally(() => {
      if (activeControllers.get(conversationId)?.messageId === assistantMessage.id) {
        activeControllers.delete(conversationId)
      }
    })
  } catch (error) {
    chunkBuffer.flush()
    if (error instanceof Error && error.name === 'AbortError') {
      return
    }
    if (getMessage(conversationId, assistantMessage.id)?.status === 'cancelled') {
      return
    }
    const message = error instanceof Error ? error.message : '发送失败，请稍后重试。'
    upsertTrace(conversationId, assistantMessage.id, completeTrace({
      id: modelTraceId,
      type: 'system',
      title: '请求模型',
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
    const shouldFlushNow = pendingText.length >= 18 || /[\n。！？!?；;，,.、：:]$/.test(pendingText)
    if (shouldFlushNow) {
      flush()
      return
    }
    if (!timer) {
      timer = setTimeout(flush, 28)
    }
  }

  return { push, flush }
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
    content: content ? (content.length > 1400 ? `${content.slice(0, 1400)}...` : content) : undefined,
  }
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
      title: '记忆抽取',
      content: '记忆功能未开启，跳过长期记忆抽取。',
      status: 'skipped',
      startedAt,
    }))
    return
  }
  if (!provider.apiKey) {
    upsertTrace(conversationId, messageId, completeTrace({
      id,
      type: 'memory',
      title: '记忆抽取',
      content: '当前服务商缺少 API Key，跳过长期记忆抽取。',
      status: 'skipped',
      startedAt,
    }))
    return
  }
  upsertTrace(conversationId, messageId, {
    id,
    type: 'memory',
    title: '记忆抽取',
    content: '正在从最近对话中抽取可确认的长期记忆。',
    status: 'running',
    startedAt,
  })
  try {
    const added = await extractMemories(conversationId, messages, provider, model)
    upsertTrace(conversationId, messageId, completeTrace({
      id,
      type: 'memory',
      title: '记忆抽取',
      content: added.length
        ? `已写入 ${added.length} 条待确认记忆：${added.slice(0, 3).join('；')}`
        : '记忆抽取已执行，本轮没有发现新的长期记忆。',
      status: 'done',
      startedAt,
      metadata: { addedCount: added.length },
    }))
  } catch (error) {
    upsertTrace(conversationId, messageId, completeTrace({
      id,
      type: 'memory',
      title: '记忆抽取',
      content: error instanceof Error ? error.message : '记忆抽取失败，已跳过。',
      status: 'error',
      startedAt,
    }))
  }
}

function buildSetupGuide(): string {
  return [
    '还没有可用的 AI 服务商，所以这条消息没有发送到任何网络接口。',
    '',
    '你可以先完成三步：',
    '1. 打开设置，选择一个服务商。',
    '2. 保存 API Key，并确认 Base URL/计费模式匹配。',
    '3. 获取模型并测试当前模型，然后回到首页继续对话。',
    '',
    '如果你只是想整理本机资料，也可以先导入知识库；IsleMind 会在本机保存索引和检索缓存，API Key 不会进入 JSON 导出。'
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
      return '服务商拒绝了当前密钥，请检查 API Key、账户权限或服务商启用状态。'
    case 'credential_mismatch':
      return message || '服务商密钥类型与调用地址不匹配，请检查计费模式和 Base URL。'
    case 'model_unavailable':
      return '当前模型不可用，可能是模型 ID 错误或账号没有权限。'
    case 'network_error':
      return message.toLowerCase().includes('no response body') || message.toLowerCase().includes('empty response')
        ? '服务商没有返回可读取的响应正文，请先测试当前模型；如果测试也失败，请检查 Base URL、协议类型和模型权限。'
        : '网络请求失败或超时，请检查网络、代理或服务商地址。'
    case 'timeout':
      return '请求超时，请检查网络、代理或服务商地址。'
    case 'rate_limited':
      return '服务商限流或额度不足，请稍后重试，或检查订阅/计费状态。'
    case 'max_tokens_exceeded':
      return message || '当前输出长度超过模型上限，请降低 Max Tokens 后重试。'
    case 'bad_base_url':
      return '服务商地址或请求参数可能不正确，请检查 Base URL 和模型配置。'
    case 'missing_key':
    case 'disabled_provider':
    case 'unknown':
      return message || '发送失败，请稍后重试。'
  }
}

function getMessage(conversationId: string, messageId: string): Message | null {
  const conversation = useChatStore.getState().conversations.find((item) => item.id === conversationId)
  return conversation?.messages.find((message) => message.id === messageId) ?? null
}
