import * as Clipboard from 'expo-clipboard'
import type { AIProvider, Attachment, ChatErrorCode, Conversation, Message, ProcessTrace, RemoteCompactMode, RetrievalSource, Settings } from '@/types'
import { getModelConfig, getProviderConfigIssue } from '@/types'
import { streamChat, type ChatCompletionResult, type ChatRequest, type ProviderRuntimeError, type ProviderToolCall, type StreamHandle } from '@/services/ai/base'
import { extractMemories, retrieveContext, retrieveFlareContext, searchWeb, type RetrievedContext } from '@/services/context'
import { verifyRagGeneration } from '@/services/rag'
import { buildSystemPrompt } from '@/services/promptEngineering'
import { buildEstimatedUsage, estimateTextTokens, mergeUsageWithEstimate } from '@/services/tokenUsage'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import { useSettingsStore } from '@/store/settingsStore'
import { packChatMessages } from '@/services/contextPacker'
import { resolveSearchProvider } from '@/services/searchPolicy'
import { MCP_TOOL_CALL_TAG } from '@/services/mcpToolRequest'
import { formatAgentWorkflowSaveBlockedReason, resolveConfirmedPendingActionTool } from '@/services/chatAgentActionUtils'
import { buildSetupGuide, classifyChatError, toUserFacingError } from '@/services/chatErrorUtils'
import { resolveMcpToolRevision } from '@/services/chatMcpToolRuntime'
import { dedupeMessageCitations, formatWebPrompt, normalizeUserContent } from '@/services/chatMessageUtils'
import { searchAgenticKnowledgeWithScope, searchKnowledgeWithFallback } from '@/services/knowledgeRetrievalRuntime'
import {
  buildCompletedRemoteCompactRuntimeLogPayload,
  buildCompletedRemoteCompactStateRecord,
  buildCompletedRemoteCompactUsageInput,
} from '@/services/chatRemoteCompactUtils'
import { resolveRuntimeConversation, resolveRuntimeResolutionError } from '@/services/chatRuntimeResolution'
import { createStreamingChunkBuffer, createStreamingTraceBuffer, mergeBufferedTrace } from '@/services/chatStreamingBuffers'
import { resolveMcpContext, type McpContextResolution, type ResolvedMcpTool } from '@/services/chatMcpContextUtils'
import {
  buildProviderNativeToolManifestTrace,
  buildProviderNativeToolRevisionMessages,
  buildProviderNativeToolTraceMetadata,
  findProviderToolNameMapEntry,
  providerSupportsNativeTools,
  safeProviderNativeToolText,
  PROVIDER_NATIVE_TOOL_TRACE_OUTPUT_LIMIT,
} from '@/services/chatProviderNativeToolUtils'
import { clampTraceContent, completeTrace, sanitizeTrace, settleMessageTraces, type SettleRunningTracesOptions } from '@/services/chatTraceUtils'
import { formatToolBlocks, mergeUsage, sanitizeToolRevisionAnswerText, stripMcpCallBlocks } from '@/services/chatToolResultUtils'
import { localDataStore } from '@/services/localDataStore'
import { buildKnowledgeScope, type KnowledgeScope } from '@/services/knowledgeScope'
import { routeLocalAppCommand, type LocalAppCommandResult } from '@/services/appCommandRouter'
import { st } from '@/i18n/service'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { decideRemoteCompact } from '@/services/ai/compact/remoteCompact'
import { recordCompactUsage } from '@/services/ai/compact/compactUsage'
import { listActiveCompactStates, saveCompactState } from '@/services/ai/compact/compactStateStore'
import { appendRuntimeLog } from '@/services/runtimeLog'
import { filterSendableAttachments } from '@/services/attachmentContract'
import {
  clearActiveStream,
  getActiveStream,
  hasActiveStream,
  registerStreamAborter,
  setActiveStream,
} from '@/services/chatStreamLifecycle'
import {
  decideAgentRuntimeAssistantMessage,
  extractAgentWorkflowDefinitionsFromSkillSnapshot,
  getAgentPendingActionFromMessage,
  getAgentWorkflowSkillSuggestionFromMessage,
  buildAgentToolCallTraceMetadata,
  buildAgentProviderToolAdapter,
  createAgentRagRuntime,
  executeAgentTool,
  listBlockedAgentWorkflowStatesForSkillSnapshot,
  listEnabledAgentWorkflowIdsForSkillSnapshot,
  listAgentToolManifests,
  resolveAgentProviderToolTarget,
  resolveAgentTool,
  resolveSettingsAgentRunLimits,
  resolveAgentRuntimeAssistantMessage,
  saveApprovedAgentWorkflowSkillSuggestion,
  type AgentAssistantMessagePatch,
  type AgentProviderToolAdapterResult,
  type AgentRequestedOutput,
  type AgentRunLimits,
  type AgentToolManifest,
  type AgentToolRequest,
  type AgentWorkflowRuntimeBlockState,
} from '@/services/agent'

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
  requestedOutput?: AgentRequestedOutput
}

interface AgentRuntimeReplyOptions {
  explicitToolRequest?: AgentToolRequest
  requestedOutput?: AgentRequestedOutput
  manifests?: AgentToolManifest[]
  enabledAgentWorkflowIds?: string[]
  blockedAgentWorkflowStates?: AgentWorkflowRuntimeBlockState[]
  limits?: Partial<AgentRunLimits>
  userConfirmed?: boolean
}

export interface SaveAgentWorkflowSkillFromMessageResult {
  ok: boolean
  status: 'saved' | 'already_saved' | 'unavailable' | 'blocked'
  skillName?: string
  reason?: string
}

const STREAM_TEXT_FLUSH_MS = 64
const STREAM_TEXT_MAX_BUFFER = 128
const STREAM_TRACE_FLUSH_MS = 180
const STREAM_TRACE_MAX_BUFFER = 6

interface AgentProviderToolContext {
  adapter: AgentProviderToolAdapterResult
  manifests: AgentToolManifest[]
  limits: AgentRunLimits
}

export function isConversationStreaming(conversationId: string): boolean {
  return hasActiveStream(conversationId)
}

export function recoverStaleStreamingMessages(conversationId: string): void {
  if (hasActiveStream(conversationId)) return
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
    void useChatStreamingStore.getState().flushStreamingMessage(conversationId, message.id)
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
  const active = getActiveStream(conversationId)
  if (!active) return
  active.flush?.()
  active.controller.abort()
  clearActiveStream(conversationId)
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
  void useChatStreamingStore.getState().flushStreamingMessage(conversationId, active.messageId)
}

registerStreamAborter(stopMessage)

export async function sendMessage({ conversation, content, attachments = [], requestedOutput }: SendMessageInput) {
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
  const agentDecisionContext = await resolveAgentDecisionContext(conversation)
  const settings = useSettingsStore.getState().settings
  const agentLimits = resolveSettingsAgentRunLimits(settings)
  const agentRuntimeInput = {
    conversation,
    content: text,
    attachments,
    settings,
    requestedOutput,
    manifests: agentDecisionContext.manifests,
    enabledAgentWorkflowIds: agentDecisionContext.enabledAgentWorkflowIds,
    blockedAgentWorkflowStates: agentDecisionContext.blockedAgentWorkflowStates,
    retrieveContext,
    limits: agentLimits,
    intentVisible: true,
  }
  const agentDecision = decideAgentRuntimeAssistantMessage(agentRuntimeInput)
  if (agentDecision.shouldHandle) {
    void createAgentRuntimeReply(conversation, text, {
      requestedOutput,
      manifests: agentRuntimeInput.manifests,
      enabledAgentWorkflowIds: agentRuntimeInput.enabledAgentWorkflowIds,
      blockedAgentWorkflowStates: agentRuntimeInput.blockedAgentWorkflowStates,
      limits: agentLimits,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : st('chatRunner.error.sendFailed')
      useChatStore.getState().setError(message)
    })
    return
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

export async function confirmAgentAction(conversationId: string, assistantMessageId: string): Promise<boolean> {
  const store = useChatStore.getState()
  const conversation = store.conversations.find((item) => item.id === conversationId)
  if (!conversation) return false
  const assistantIndex = conversation.messages.findIndex((message) => message.id === assistantMessageId)
  const assistantMessage = assistantIndex >= 0 ? conversation.messages[assistantIndex] : undefined
  if (!assistantMessage || assistantMessage.role !== 'assistant') return false
  if (conversation.messages.slice(assistantIndex + 1).some((message) => message.status !== 'cancelled')) return false

  const pendingAction = getAgentPendingActionFromMessage(assistantMessage)
  if (!pendingAction?.confirmable || !pendingAction.resumeToolRequest) return false
  const request = pendingAction.resumeToolRequest
  const confirmedTool = resolveConfirmedPendingActionTool({
    pendingAction,
    tool: resolveAgentTool(request, await listAgentToolManifests()),
  })
  if (!confirmedTool) return false
  const previousUser = [...conversation.messages.slice(0, assistantIndex)].reverse().find((message) => message.role === 'user')
  if (!previousUser) return false

  stopMessage(conversationId)
  store.removeMessage(conversationId, assistantMessage.id)
  const nextConversation = useChatStore.getState().conversations.find((item) => item.id === conversationId)
  if (!nextConversation) return false
  await createAgentRuntimeReply(nextConversation, previousUser.content, {
    explicitToolRequest: request,
    limits: resolveSettingsAgentRunLimits(useSettingsStore.getState().settings),
    userConfirmed: true,
  })
  return true
}

export async function saveAgentWorkflowSkillFromMessage(conversationId: string, assistantMessageId: string): Promise<SaveAgentWorkflowSkillFromMessageResult> {
  const conversation = useChatStore.getState().conversations.find((item) => item.id === conversationId)
  const assistantMessage = conversation?.messages.find((message) => message.id === assistantMessageId)
  if (!assistantMessage || assistantMessage.role !== 'assistant') {
    return { ok: false, status: 'unavailable', reason: st('chatRunner.workflowSave.messageUnavailable') }
  }
  const suggestion = getAgentWorkflowSkillSuggestionFromMessage(assistantMessage)
  if (!suggestion?.ok || !suggestion.skill) {
    return { ok: false, status: 'unavailable', reason: st('chatRunner.workflowSave.suggestionUnavailable') }
  }
  const result = await saveApprovedAgentWorkflowSkillSuggestion({
    suggestion,
    approval: {
      approved: true,
      approvedBy: 'chat-message',
      approvedAt: Date.now(),
      visibleSummary: `Saved from conversation ${conversationId}.`,
    },
  })
  if (!result.ok || !result.skill) {
    return { ok: false, status: 'blocked', reason: formatAgentWorkflowSaveBlockedReason(result.reason, st) }
  }
  return {
    ok: true,
    status: result.status === 'already_saved' ? 'already_saved' : 'saved',
    skillName: result.skill.name,
  }
}

async function createAgentRuntimeReply(conversation: Conversation, content: string, options: AgentRuntimeReplyOptions = {}): Promise<void> {
  stopMessage(conversation.id)

  const startedAt = Date.now()
  const assistantMessage: Message = {
    id: generateId(),
    role: 'assistant',
    content: '',
    responseText: '',
    timestamp: startedAt,
    status: 'streaming',
    startedAt,
    reasoning: [
      {
        id: traceId('agent-runtime'),
        type: 'system',
        title: 'Agent workflow',
        content: 'Agentic workflow is running.',
        status: 'running',
        startedAt,
      },
    ],
  }
  useChatStore.getState().addMessage(conversation.id, assistantMessage)

  const requestController = new AbortController()
  setActiveStream(conversation.id, { controller: requestController, messageId: assistantMessage.id })

  try {
    const settings = useSettingsStore.getState().settings
    const agentResolution = await resolveAgentRuntimeAssistantMessage({
      conversation,
      content,
      explicitToolRequest: options.explicitToolRequest,
      requestedOutput: options.requestedOutput,
      settings,
      manifests: options.manifests,
      enabledAgentWorkflowIds: options.enabledAgentWorkflowIds,
      blockedAgentWorkflowStates: options.blockedAgentWorkflowStates,
      limits: options.limits ?? resolveSettingsAgentRunLimits(settings),
      retrieveContext,
      startedAt,
      intentVisible: true,
      userConfirmed: options.userConfirmed,
      signal: requestController.signal,
    })
    if (isReplyCancelled(conversation.id, assistantMessage.id, requestController)) return
    if (agentResolution.handled && agentResolution.patch) {
      updateAgentRuntimeReply(conversation.id, assistantMessage.id, agentResolution.patch)
      return
    }

    clearActiveStream(conversation.id)
    useChatStore.getState().removeMessage(conversation.id, assistantMessage.id)
    void createAssistantReply(conversation.id).catch((error) => {
      const message = error instanceof Error ? error.message : st('chatRunner.error.sendFailed')
      useChatStore.getState().setError(message)
    })
  } catch (error) {
    if (requestController.signal.aborted || getMessage(conversation.id, assistantMessage.id)?.status === 'cancelled') return
    const message = error instanceof Error ? error.message : st('chatRunner.error.sendFailed')
    finishWithError(conversation.id, assistantMessage.id, toUserFacingError(message), classifyChatError(message))
  } finally {
    if (getActiveStream(conversation.id)?.messageId === assistantMessage.id) {
      clearActiveStream(conversation.id)
    }
  }
}

interface AgentDecisionContext {
  manifests?: AgentToolManifest[]
  enabledAgentWorkflowIds?: string[]
  blockedAgentWorkflowStates?: AgentWorkflowRuntimeBlockState[]
}

async function resolveAgentDecisionContext(conversation: Conversation): Promise<AgentDecisionContext> {
  if (!extractAgentWorkflowDefinitionsFromSkillSnapshot(conversation.skillSnapshot).length) return {}
  const manifests = await listAgentToolManifests()
  const [enabledAgentWorkflowIds, blockedAgentWorkflowStates] = await Promise.all([
    listEnabledAgentWorkflowIdsForSkillSnapshot(conversation.skillSnapshot),
    listBlockedAgentWorkflowStatesForSkillSnapshot(conversation.skillSnapshot, manifests),
  ])
  return { manifests, enabledAgentWorkflowIds, blockedAgentWorkflowStates }
}

function updateAgentRuntimeReply(conversationId: string, messageId: string, patch: AgentAssistantMessagePatch): void {
  const durationMs = patch.durationMs ?? 0
  useChatStore.getState().updateMessage(conversationId, messageId, {
    content: patch.content,
    responseText: patch.responseText,
    status: patch.status,
    errorCode: patch.errorCode,
    startedAt: Math.max(0, patch.completedAt - durationMs),
    completedAt: patch.completedAt,
    durationMs,
    reasoning: patch.reasoning,
    retrievalTrace: patch.retrievalTrace,
    toolCalls: patch.toolCalls,
    usage: patch.usage,
    estimatedTokens: patch.usage.source === 'estimated',
    tokenCount: patch.tokenCount,
  })
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
  setActiveStream(conversationId, { controller: requestController, messageId: assistantMessage.id })

  const settingsState = useSettingsStore.getState()
  const resolvedRuntime = resolveRuntimeConversation({
    conversation,
    providers: settingsState.providers,
    settings: settingsState.settings,
  })
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
  const sendableAttachments = filterSendableAttachments(lastUserMessage?.attachments)
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
  const mcpContext = await resolveMcpContext({
    conversation: runtimeConversation,
    mcpEnabled: settings.mcpEnabled !== false,
    toolCallTag: MCP_TOOL_CALL_TAG,
    completeTrace,
    traceId,
  })
  for (const trace of mcpContext.traces) {
    upsertTrace(conversationId, assistantMessage.id, trace)
  }
  const providerToolContext = await resolveProviderNativeToolContext({
    provider,
    model: upstreamModel,
    modelPreferredEndpoint: modelConfig.preferredEndpoint,
    settings,
  })
  if (providerToolContext) {
    upsertTrace(conversationId, assistantMessage.id, buildProviderNativeToolManifestTrace(providerToolContext, completeTrace, traceId))
  }
  const hasAttachments = sendableAttachments.length > 0
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
  const sourceMessages = latestConversation?.messages.filter((message) => message.id !== assistantMessage.id) ?? []
  const baseContextPrompt = [context.prompt, webSources.length ? formatWebPrompt(webSources) : '', mcpContext.prompt].filter(Boolean).join('\n\n')
  const remoteCompactProbe = packChatMessages({
    messages: sourceMessages,
    contextPrompt: baseContextPrompt,
    modelContextWindow: modelConfig.contextWindow,
    maxOutputTokens: runtimeConversation.maxTokens,
    systemPrompt,
    reasoningEffort: runtimeConversation.reasoningEffort,
    providerType: provider.type,
    model: upstreamModel,
    localCompression: false,
  })
  const compactDecision = decideRemoteCompact({
    provider,
    model: upstreamModel,
    contextPrompt: remoteCompactProbe.contextPrompt,
    messages: remoteCompactProbe.messages,
    budgetTokens: remoteCompactProbe.budgetTokens,
    estimatedInputTokens: remoteCompactProbe.estimatedInputTokens,
    settings,
  })
  const blocksForMissingRequiredRemote = compactDecision.required && !compactDecision.supported
  const activePrompt = compactDecision.enabled || blocksForMissingRequiredRemote
    ? remoteCompactProbe
    : packChatMessages({
      messages: sourceMessages,
      contextPrompt: baseContextPrompt,
      modelContextWindow: modelConfig.contextWindow,
      maxOutputTokens: runtimeConversation.maxTokens,
      systemPrompt,
      reasoningEffort: runtimeConversation.reasoningEffort,
      providerType: provider.type,
      model: upstreamModel,
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
    decisionReason: compactDecision.reason,
    inputTokens: compactDecision.enabled ? remoteCompactProbe.estimatedInputTokens : undefined,
    outputTokens: undefined,
    estimatedSavedTokens: undefined,
    localSourceTokens: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.sourceTokens : undefined,
    localCompressedTokens: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.compressedTokens : undefined,
    localEstimatedSavedTokens: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.estimatedSavedTokens : undefined,
    localCompressionRatio: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.compressionRatio : undefined,
    localCompressionSchemaVersion: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.schemaVersion : undefined,
    localCompressionStrategy: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.strategy : undefined,
    localCompressionTriggerReason: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.triggerReason : undefined,
    localSourceMessageCount: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.sourceMessageCount : undefined,
    localKeptMessageCount: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.keptMessageCount : undefined,
    localSourceRoleCounts: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.sourceRoleCounts : undefined,
    localKeptRoleCounts: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.keptRoleCounts : undefined,
    localSummaryTokenBudget: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.summaryTokenBudget : undefined,
    localSummaryTokens: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.summaryTokens : undefined,
    localSummarySectionCount: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.summarySectionCount : undefined,
    localSummaryItemCount: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.summaryItemCount : undefined,
    localSummarySections: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.summarySections : undefined,
    failureCode: compactDecision.required && !compactDecision.supported ? 'provider_capability_missing' : undefined,
    fallbackLocal: compactDecision.mode === 'auto' && !compactDecision.enabled && activePrompt.compressionTriggered,
  })
  void appendRuntimeLog('compact.usage', {
    conversationId,
    providerId: provider.id,
    model: runtimeConversation.model,
    upstreamModel,
    mode: compactRecord.mode,
    decisionReason: compactRecord.decisionReason,
    inputTokens: compactRecord.inputTokens,
    outputTokens: compactRecord.outputTokens,
    estimatedSavedTokens: compactRecord.estimatedSavedTokens,
    localSourceTokens: compactRecord.localSourceTokens,
    localCompressedTokens: compactRecord.localCompressedTokens,
    localEstimatedSavedTokens: compactRecord.localEstimatedSavedTokens,
    localCompressionRatio: compactRecord.localCompressionRatio,
    localCompressionSchemaVersion: compactRecord.localCompressionSchemaVersion,
    localCompressionStrategy: compactRecord.localCompressionStrategy,
    localCompressionTriggerReason: compactRecord.localCompressionTriggerReason,
    localSourceMessageCount: compactRecord.localSourceMessageCount,
    localKeptMessageCount: compactRecord.localKeptMessageCount,
    localSourceRoleCounts: compactRecord.localSourceRoleCounts,
    localKeptRoleCounts: compactRecord.localKeptRoleCounts,
    localSummaryTokenBudget: compactRecord.localSummaryTokenBudget,
    localSummaryTokens: compactRecord.localSummaryTokens,
    localSummarySectionCount: compactRecord.localSummarySectionCount,
    localSummaryItemCount: compactRecord.localSummaryItemCount,
    localSummarySections: compactRecord.localSummarySections,
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
      compactMode: compactDecision.enabled ? 'remote' : activePrompt.compressionTriggered ? 'local' : 'off',
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
  if (activePrompt.compressionTriggered) {
    upsertTrace(conversationId, assistantMessage.id, completeTrace({
      id: traceId('context-pack'),
      type: 'system',
      title: st('chatRunner.trace.contextPackTitle'),
      content: st('chatRunner.trace.contextPackContent', {
        kept: activePrompt.messages.length,
        trimmed: activePrompt.trimmedCount,
        estimated: activePrompt.estimatedInputTokens,
        budget: activePrompt.budgetTokens,
      }),
      status: 'done',
      startedAt: Date.now(),
      metadata: {
        trimmedCount: activePrompt.trimmedCount,
        estimatedInputTokens: activePrompt.estimatedInputTokens,
        budgetTokens: activePrompt.budgetTokens,
        fixedTokens: activePrompt.fixedTokens,
        messageTokens: activePrompt.messageTokens,
        modelBudgetTokens: activePrompt.modelBudgetTokens,
        reservedOutputTokens: activePrompt.reservedOutputTokens,
        reasoningReserveTokens: activePrompt.reasoningReserveTokens,
        compressionTriggered: activePrompt.compressionTriggered,
        truncatedSingleMessage: activePrompt.truncatedSingleMessage,
        compressionSchemaVersion: activePrompt.compressionMetadata.schemaVersion,
        compressionStrategy: activePrompt.compressionMetadata.strategy,
        compressionTriggerReason: activePrompt.compressionMetadata.triggerReason,
        summarySourceMessageCount: activePrompt.compressionMetadata.sourceMessageCount,
        summaryKeptMessageCount: activePrompt.compressionMetadata.keptMessageCount,
        summarySourceRoleCounts: activePrompt.compressionMetadata.sourceRoleCounts,
        summaryKeptRoleCounts: activePrompt.compressionMetadata.keptRoleCounts,
        compressionSourceTokens: activePrompt.compressionMetadata.sourceTokens,
        compressionCompressedTokens: activePrompt.compressionMetadata.compressedTokens,
        compressionEstimatedSavedTokens: activePrompt.compressionMetadata.estimatedSavedTokens,
        compressionRatio: activePrompt.compressionMetadata.compressionRatio,
        summaryTokenBudget: activePrompt.compressionMetadata.summaryTokenBudget,
        summaryTokens: activePrompt.compressionMetadata.summaryTokens,
        summarySectionCount: activePrompt.compressionMetadata.summarySectionCount,
        summaryItemCount: activePrompt.compressionMetadata.summaryItemCount,
        summarySections: activePrompt.compressionMetadata.summarySections,
      },
    }))
  }
  const chunkBuffer = createStreamingChunkBuffer({
    flushMs: STREAM_TEXT_FLUSH_MS,
    maxBuffer: STREAM_TEXT_MAX_BUFFER,
    appendContent(text) {
      useChatStreamingStore.getState().appendContent(conversationId, assistantMessage.id, text)
    },
  })
  const traceBuffer = createStreamingTraceBuffer({
    flushMs: STREAM_TRACE_FLUSH_MS,
    maxBuffer: STREAM_TRACE_MAX_BUFFER,
    upsertTrace(trace) {
      upsertTrace(conversationId, assistantMessage.id, trace)
    },
    mergeTrace(current, next) {
      return mergeBufferedTrace(current, next, clampTraceContent)
    },
  })
  const flushStreamingBuffers = () => {
    chunkBuffer.flush()
    traceBuffer.flush()
  }
  setActiveStream(conversationId, { controller: requestController, messageId: assistantMessage.id, flush: flushStreamingBuffers })
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
        attachments: sendableAttachments,
        messages: activePrompt.messages,
        contextPrompt: activePrompt.contextPrompt,
        retrievalSources,
        webSearchMode: providerWebSearchMode,
        signal: requestController.signal,
        conversationId,
        sessionId: conversationId,
        settings,
        fallbackProviders,
        remoteCompactEligible: compactDecision.enabled,
        previousResponseId,
        providerToolDeclarations: providerToolContext?.adapter.tools,
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
          packedMessages: activePrompt.messages,
          baseContextPrompt: activePrompt.contextPrompt,
          retrievalSources,
          mcpTools: mcpContext.tools,
          providerTools: providerToolContext,
          requestController,
          chunkFlush: flushStreamingBuffers,
          upstreamModel,
          remoteCompactEligible: compactDecision.enabled,
          remoteCompactMode: compactDecision.mode,
          remoteCompactInputTokens: compactDecision.enabled ? remoteCompactProbe.estimatedInputTokens : undefined,
          previousResponseId,
        })
      },
      (error) => {
        flushStreamingBuffers()
        if (getActiveStream(conversationId)?.messageId === assistantMessage.id) {
          clearActiveStream(conversationId)
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
    setActiveStream(conversationId, { controller: handle.controller, messageId: assistantMessage.id, flush: flushStreamingBuffers, done: handle.done })
    void handle.done.finally(() => {
      flushStreamingBuffers()
      if (getActiveStream(conversationId)?.messageId === assistantMessage.id) {
        clearActiveStream(conversationId)
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
  packedMessages: ChatRequest['messages']
  baseContextPrompt: string
  retrievalSources: RetrievalSource[]
  mcpTools: ResolvedMcpTool[]
  providerTools?: AgentProviderToolContext
  requestController: AbortController
  chunkFlush: () => void
  upstreamModel: string
  remoteCompactEligible?: boolean
  remoteCompactMode?: RemoteCompactMode
  remoteCompactInputTokens?: number
  previousResponseId?: string
}) {
  input.chunkFlush()
  if (getActiveStream(input.conversationId)?.messageId === input.assistantMessageId) {
    clearActiveStream(input.conversationId)
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

  if (input.result.providerToolCalls?.length && !input.requestController.signal.aborted) {
    const providerToolRevision = await resolveProviderNativeToolRevision({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      provider: input.provider,
      conversation: input.runtimeConversation,
      systemPrompt: input.systemPrompt,
      messages: input.packedMessages,
      baseContextPrompt: input.baseContextPrompt,
      firstOutput: finalOutput,
      firstReasoningContent: input.result.reasoningContent,
      firstResponseItems: input.result.responseItems,
      firstProviderContentBlocks: input.result.providerContentBlocks,
      providerTools: input.providerTools,
      calls: input.result.providerToolCalls,
      context: input.context,
      signal: input.requestController.signal,
    })
    if (providerToolRevision?.text.trim()) {
      finalOutput = providerToolRevision.text
      finalResult = {
        ...finalResult,
        text: providerToolRevision.text,
        usage: mergeUsage(finalResult.usage, providerToolRevision.usage),
      }
    }
  }

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
      completeTrace,
      traceId,
      upsertTrace(trace) {
        upsertTrace(input.conversationId, input.assistantMessageId, trace)
      },
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
    const hasProviderSources = providerCitationCount > 0
    upsertTrace(input.conversationId, input.assistantMessageId, completeTrace({
      id: input.nativeSearchTraceId,
      type: 'search',
      title: st('chatRunner.trace.nativeSearchTitle'),
      content: hasProviderSources
        ? st('chatRunner.trace.nativeSearchSourceCount', { count: providerCitationCount })
        : st('chatRunner.trace.nativeSearchNoSources'),
      status: hasProviderSources ? 'done' : 'skipped',
      startedAt: getMessage(input.conversationId, input.assistantMessageId)?.retrievalTrace?.find((trace) => trace.id === input.nativeSearchTraceId)?.startedAt ?? current.startedAt ?? Date.now(),
      metadata: { mode: input.providerWebSearchMode, providerCitationCount, sourceVerified: hasProviderSources },
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
  void useChatStreamingStore.getState().flushStreamingMessage(input.conversationId, input.assistantMessageId)
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
  const record = recordCompactUsage(buildCompletedRemoteCompactUsageInput({
    conversationId: input.conversationId,
    providerId: input.provider.id,
    model: input.model,
    upstreamModel: input.upstreamModel,
    mode: input.mode,
    responseId: input.result.responseId,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    messageCount: input.messageCount,
    previousResponseId: input.previousResponseId,
  }))
  void appendRuntimeLog(
    'compact.usage',
    buildCompletedRemoteCompactRuntimeLogPayload({
      conversationId: input.conversationId,
      record,
      responseId: input.result.responseId,
      previousResponseId: input.previousResponseId,
    }),
    { enabled: input.settings.runtimeLogEnabled, maxBytes: input.settings.runtimeLogMaxBytes }
  )
  const stateRecord = buildCompletedRemoteCompactStateRecord({
    conversationId: input.conversationId,
    record,
    responseId: input.result.responseId,
    previousResponseId: input.previousResponseId,
    messageCount: input.messageCount,
    now: Date.now(),
  })
  if (!stateRecord) return
  void saveCompactState(stateRecord).catch(() => undefined)
}

async function resolveProviderNativeToolContext(input: {
  provider: AIProvider
  model: string
  modelPreferredEndpoint?: 'chat-completions' | 'responses'
  settings: Settings
}): Promise<AgentProviderToolContext | undefined> {
  const modelConfig = getModelConfig(input.model, input.provider.type, input.provider.modelConfigs)
  if (!providerSupportsNativeTools(input.provider, modelConfig)) return undefined
  const target = resolveAgentProviderToolTarget(input.provider.type, {
    preferredEndpoint: input.modelPreferredEndpoint === 'responses' ? 'responses' : 'chat',
    assumeOpenAICompatibleTools: true,
    wireProtocol: input.provider.wireProtocol,
  })
  if (!target) return undefined
  const limits = resolveSettingsAgentRunLimits(input.settings)
  if (!limits.allowReadOnlyTools) return undefined
  const manifests = await listAgentToolManifests()
  const adapter = buildAgentProviderToolAdapter({
    manifests,
    target,
    permissionCeiling: 'read-only',
    maxTools: 24,
  })
  if (!adapter.tools.length) return undefined
  return {
    adapter,
    manifests,
    limits: {
      ...limits,
      maxToolCallsPerStep: 1,
      allowReadWriteTools: false,
      allowDestructiveTools: false,
    },
  }
}

async function resolveProviderNativeToolRevision(input: {
  conversationId: string
  assistantMessageId: string
  provider: AIProvider
  conversation: Conversation
  systemPrompt: string
  messages: ChatRequest['messages']
  baseContextPrompt: string
  firstOutput: string
  firstReasoningContent?: string
  firstResponseItems?: ChatCompletionResult['responseItems']
  firstProviderContentBlocks?: ChatCompletionResult['providerContentBlocks']
  providerTools?: AgentProviderToolContext
  calls: ProviderToolCall[]
  context: RetrievedContext
  signal: AbortSignal
}): Promise<{ text: string; usage?: ChatCompletionResult['usage'] } | null> {
  const calls = input.calls.filter((call) => call.name.trim())
  if (!calls.length) return null
  const call = calls[0]
  const toolCallIndex = 0
  const maxToolCallsPerStep = input.providerTools?.limits.maxToolCallsPerStep ?? 1
  const safeCallName = safeProviderNativeToolText(call.name, 'tool', 160)
  if (calls.length > 1) {
    upsertTrace(input.conversationId, input.assistantMessageId, completeTrace({
      id: traceId('provider-tool-limit'),
      type: 'tool',
      title: 'Provider native tool limit',
      content: `Provider requested ${calls.length} tool calls; IsleMind executed only the first call for this step.`,
      status: 'skipped',
      startedAt: Date.now(),
      metadata: buildProviderNativeToolTraceMetadata({
        call,
        provider: input.provider,
        status: 'skipped',
        errorCode: 'step_limit_reached',
        target: input.providerTools?.adapter.target,
        stepIndex: 0,
        toolCallIndex: maxToolCallsPerStep,
        requestedToolCallCount: calls.length,
        maxToolCallsPerStep,
      }),
    }))
  }

  if (!input.providerTools) {
    upsertProviderNativeToolFailureTrace({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      provider: input.provider,
      call,
      content: `Provider requested ${safeCallName}, but IsleMind did not authorize native provider tools for this request.`,
      errorCode: 'tool_unavailable',
    })
    return { text: `Provider requested ${safeCallName}, but IsleMind did not authorize native provider tools for this request.` }
  }

  const tool = findProviderToolNameMapEntry(input.providerTools.adapter.toolNameMap, call.name)
  if (!tool) {
    upsertProviderNativeToolFailureTrace({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      provider: input.provider,
      call,
      target: input.providerTools.adapter.target,
      content: `Provider requested unavailable tool ${safeCallName}.`,
      errorCode: 'tool_unavailable',
    })
    return { text: `Provider requested unavailable tool ${safeCallName}.` }
  }

  const nativeTraceId = traceId('provider-tool-call')
  const startedAt = Date.now()
  const safeToolName = safeProviderNativeToolText(tool.toolName, 'tool', 160)
  upsertTrace(input.conversationId, input.assistantMessageId, {
    id: nativeTraceId,
    type: 'tool',
    title: 'Provider native tool',
    content: `Provider requested ${safeToolName}; IsleMind is executing it through the agent tool registry.`,
    status: 'running',
    startedAt,
    metadata: buildProviderNativeToolTraceMetadata({
      call,
      provider: input.provider,
      tool,
      status: 'running',
      target: input.providerTools.adapter.target,
      stepIndex: 0,
      toolCallIndex,
      maxToolCallsPerStep: input.providerTools.limits.maxToolCallsPerStep,
    }),
  })

  const settings = useSettingsStore.getState().settings
  const result = await executeAgentTool({
    toolId: tool.toolId,
    name: tool.toolName,
    source: tool.source,
    serverId: tool.serverId,
    arguments: call.arguments,
  }, {
    manifests: input.providerTools.manifests,
    limits: input.providerTools.limits,
    intentVisible: true,
    userConfirmed: false,
    stepIndex: 0,
    toolCallIndex,
    signal: input.signal,
    runtimeLog: { enabled: settings.runtimeLogEnabled, maxBytes: settings.runtimeLogMaxBytes },
    ragRuntime: createChatRunnerAgentRagRuntime({
      conversation: input.conversation,
      settings,
      provider: input.provider,
      systemPrompt: input.systemPrompt,
      context: input.context,
    }),
  })
  upsertTrace(input.conversationId, input.assistantMessageId, result.trace)
  if (input.signal.aborted) return null

  const blocks = result.blocks?.length ? result.blocks : [{ type: 'text' as const, text: result.output }]
  const toolOutput = safeProviderNativeToolText(
    formatToolBlocks(blocks),
    result.output || `${safeToolName} returned no output.`,
    input.providerTools.limits.outputCharLimit
  )
  upsertTrace(input.conversationId, input.assistantMessageId, completeTrace({
    id: nativeTraceId,
    type: 'tool',
    title: 'Provider native tool',
    content: safeProviderNativeToolText(toolOutput, `${safeToolName} returned no output.`, PROVIDER_NATIVE_TOOL_TRACE_OUTPUT_LIMIT),
    status: result.status,
    startedAt,
    metadata: buildProviderNativeToolTraceMetadata({
      call,
      provider: input.provider,
      tool,
      status: result.status,
      errorCode: result.errorCode,
      target: input.providerTools.adapter.target,
      stepIndex: 0,
      toolCallIndex,
      maxToolCallsPerStep: input.providerTools.limits.maxToolCallsPerStep,
    }),
  }))

  if (!toolOutput.trim()) {
    return { text: safeProviderNativeToolText(result.output, `${safeToolName} returned no output.`) }
  }

  try {
    const revision = await generateAnswerWithProviderNativeToolResult({
      ...input,
      call,
      tool,
      toolOutput,
      ok: result.ok,
      firstReasoningContent: input.firstReasoningContent,
      firstResponseItems: input.firstResponseItems,
      firstProviderContentBlocks: input.firstProviderContentBlocks,
    })
    if (revision.text.trim()) return revision
  } catch (error) {
    upsertTrace(input.conversationId, input.assistantMessageId, completeTrace({
      id: traceId('provider-tool-revise-error'),
      type: 'tool',
      title: 'Provider native tool result',
      content: safeProviderNativeToolText(
        error instanceof Error ? error.message : `${safeToolName} synthesis failed.`,
        `${safeToolName} synthesis failed.`,
        PROVIDER_NATIVE_TOOL_TRACE_OUTPUT_LIMIT
      ),
      status: 'error',
      startedAt: Date.now(),
      metadata: buildProviderNativeToolTraceMetadata({
        call,
        provider: input.provider,
        tool,
        status: 'error',
        errorCode: 'execution_failed',
        target: input.providerTools.adapter.target,
        stepIndex: 0,
        toolCallIndex,
        maxToolCallsPerStep: input.providerTools.limits.maxToolCallsPerStep,
      }),
    }))
  }

  return {
    text: [
      'Provider native tool result',
      '',
      toolOutput,
    ].join('\n'),
  }
}

function upsertProviderNativeToolFailureTrace(input: {
  conversationId: string
  assistantMessageId: string
  provider: AIProvider
  call: ProviderToolCall
  content: string
  errorCode: string
  target?: AgentProviderToolAdapterResult['target']
}) {
  upsertTrace(input.conversationId, input.assistantMessageId, completeTrace({
    id: traceId('provider-tool-unavailable'),
    type: 'tool',
    title: 'Provider native tool',
    content: input.content,
    status: 'error',
    startedAt: Date.now(),
    metadata: buildProviderNativeToolTraceMetadata({
      call: input.call,
      provider: input.provider,
      status: 'error',
      errorCode: input.errorCode,
      target: input.target,
    }),
  }))
}

async function generateAnswerWithProviderNativeToolResult(input: {
  provider: AIProvider
  conversation: Conversation
  systemPrompt: string
  messages: ChatRequest['messages']
  baseContextPrompt: string
  firstOutput: string
  firstReasoningContent?: string
  firstResponseItems?: ChatCompletionResult['responseItems']
  firstProviderContentBlocks?: ChatCompletionResult['providerContentBlocks']
  call: ProviderToolCall
  tool: NonNullable<AgentProviderToolAdapterResult['toolNameMap'][number]>
  toolOutput: string
  ok: boolean
  signal: AbortSignal
}): Promise<{ text: string; usage?: ChatCompletionResult['usage'] }> {
  let text = ''
  let usage: ChatCompletionResult['usage']
  let failure: Error | null = null
  const assistantContent = stripMcpCallBlocks(input.firstOutput) || `Provider requested IsleMind tool ${input.tool.toolName}.`
  const messages = buildProviderNativeToolRevisionMessages(input, assistantContent)
  const handle = await streamChat(
    {
      provider: input.provider,
      model: input.conversation.model,
      systemPrompt: [
        input.systemPrompt,
        '你正在根据 IsleMind 受控工具结果生成最终回复。不要调用更多工具，不要暴露 provider tool call JSON；只基于工具输出和已有上下文回答用户。如果工具失败，请明确说明失败状态和可继续的下一步。',
      ].filter(Boolean).join('\n\n'),
      messages,
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
  return { text: sanitizeToolRevisionAnswerText(text), usage }
}

function createChatRunnerAgentRagRuntime(input: {
  conversation: Conversation
  settings: Settings
  provider: AIProvider
  systemPrompt: string
  context: RetrievedContext
}) {
  const knowledgeScope = buildKnowledgeScope(input.conversation.knowledgeSources ?? input.conversation.skillSnapshot?.knowledgeSources)
  return createAgentRagRuntime({
    settings: input.settings,
    conversationTitle: input.conversation.title,
    systemPrompt: input.systemPrompt,
    memorySources: input.context.sources.filter((source) => source.type === 'memory'),
    retrieveKnowledge: (query, limit, options) => {
      if (options?.signal?.aborted) return Promise.resolve([])
      return searchAgentKnowledge(query, limit, input.settings, input.provider, knowledgeScope)
    },
    retrieveAgentic: (query, plan, limit, options) => {
      if (options?.signal?.aborted) return Promise.resolve([])
      return searchAgenticKnowledgeWithScope({ query, plan, limit, knowledgeScope })
    },
  })
}

async function searchAgentKnowledge(
  query: string,
  limit: number,
  settings: Settings,
  provider: AIProvider,
  knowledgeScope?: KnowledgeScope
): Promise<RetrievalSource[]> {
  if (!settings.knowledgeEnabled || settings.ragMode === 'off') return []
  return searchKnowledgeWithFallback({
    query,
    limit,
    ragMode: settings.ragMode === 'fts' ? 'fts' : 'hybrid',
    embeddingMode: settings.embeddingMode ?? 'hybrid',
    localEmbeddingModelId: settings.localEmbeddingModelId,
    localEmbeddingModelSource: settings.localEmbeddingModelSource,
    provider,
    knowledgeScope,
  })
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
  messages: ChatRequest['messages']
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

function isReplyCancelled(conversationId: string, messageId: string, controller: AbortController): boolean {
  if (controller.signal.aborted) return true
  const current = getMessage(conversationId, messageId)
  return current?.status === 'cancelled'
}

function finishWithRuntimeResolutionError(conversationId: string, messageId: string, conversation: Conversation) {
  const error = resolveRuntimeResolutionError({
    conversation,
    providers: useSettingsStore.getState().providers,
  })
  const message = error.code === 'disabled_provider'
    ? st('chatRunner.error.providerDisabled')
    : st('chatRunner.userError.modelUnavailable')
  finishWithError(conversationId, messageId, message, error.code, error.providerId)
}

function finishWithError(conversationId: string, messageId: string, content: string, errorCode: ChatErrorCode = 'unknown', providerId?: string) {
  const active = getActiveStream(conversationId)
  if (active?.messageId === messageId) {
    clearActiveStream(conversationId)
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

function settleRunningTraces(
  conversationId: string,
  messageId: string,
  options: SettleRunningTracesOptions
) {
  const message = getMessage(conversationId, messageId)
  for (const trace of settleMessageTraces(message, options)) {
    upsertTrace(conversationId, messageId, trace)
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

function getMessage(conversationId: string, messageId: string): Message | null {
  const conversation = useChatStore.getState().conversations.find((item) => item.id === conversationId)
  return conversation?.messages.find((message) => message.id === messageId) ?? null
}
