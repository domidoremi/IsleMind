import { resolveConversationChatWorkflowAssistantMessage } from '@/bootstrap/conversationChatWorkflowResolutionRuntime'
import { retrieveConversationKnowledgeContext } from '@/bootstrap/knowledgeContextRuntime'
import { createVNextChatWorkflowRuntime } from '@/bootstrap/vnextChatWorkflowRuntime'
import { systemClock } from '@/core'
import { st } from '@/i18n/service'
import { createConversationChatWorkflowReplyStarter } from '@/modules/conversations'
import {
  bindConversationTaskActivityCancellation,
  finishConversationTaskActivityForMessage,
  resolveWorkflowRunLimitsFromSettings,
  startConversationTaskActivity,
} from '@/modules/tasks'
import { createConversationReplyDispatchController } from '@/presentation/features/conversations/conversationReplyDispatchController'
import {
  bindConversationMessageRuntime,
  releaseConversationMessageRuntime,
  type ConversationMessageRuntime,
} from '@/presentation/features/conversations/conversationMessageRuntimeBinding'
import {
  bindChatWorkspaceReviewRuntime,
  releaseChatWorkspaceReviewRuntime,
} from '@/presentation/features/conversations/chatWorkspaceReviewCommand'
import { startConversationAssistantReplyAfterHistoryProjection } from '@/bootstrap/conversationAssistantReplyStartRuntime'
import { resumeVNextConversationModelOperation } from '@/bootstrap/vnextConversationRuntime'
import { createVNextPlainChatProjection } from '@/presentation/features/conversations/vnextPlainChatProjection'
import {
  extractWorkflowDefinitionsFromSkillSnapshot,
  listBlockedWorkflowStatesForSkillSnapshot,
  listEnabledWorkflowIdsForSkillSnapshot,
  saveApprovedWorkflowSkillSuggestion,
} from '@/bootstrap/workflowSkills'
import { filterLocalSearchToolManifests } from '@/bootstrap/workflowSearchToolAdmission'
import { listConversationToolManifests, resolveConversationTool } from '@/bootstrap/conversationToolCatalog'
import { classifyChatError, toUserFacingError } from '@/services/chatErrorUtils'
import { normalizeUserContent } from '@/services/chatMessageUtils'
import {
  clearActiveStream,
  getActiveStream,
  registerStreamAborter,
  setActiveStream,
} from '@/services/chatStreamLifecycle'
import { buildEstimatedUsage, estimateTextTokens } from '@/services/tokenUsage'
import { stopConversationMessage } from '@/presentation/features/conversations/conversationControlCommand'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import { useSettingsStore } from '@/store/settingsStore'
import { resolveChatWorkspaceReviewRuntime } from '@/bootstrap/tavernWorkspace'
import type { Conversation } from '@/types/chatContracts'
import type { Settings } from '@/types/settingsContracts'

function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const startConversationChatWorkflowReply = createConversationChatWorkflowReplyStarter({
  clock: systemClock,
  createMessageId,
  createTraceId: (prefix) => `${prefix}-${createMessageId()}`,
  createAbortController: () => new AbortController(),
  stopConversation: stopConversationMessage,
  addMessage(conversationId, message) {
    useChatStore.getState().addMessage(conversationId, message)
  },
  getConversation(conversationId) {
    return useChatStore.getState().conversations.find((item) => item.id === conversationId)
  },
  getMessage(conversationId, messageId) {
    return useChatStore
      .getState()
      .conversations.find((item) => item.id === conversationId)
      ?.messages.find((item) => item.id === messageId)
  },
  updateMessage(conversationId, messageId, updates) {
    useChatStore.getState().updateMessage(conversationId, messageId, updates)
  },
  removeMessage(conversationId, messageId) {
    useChatStore.getState().removeMessage(conversationId, messageId)
  },
  startConversationTaskActivity(input, now) {
    startConversationTaskActivity(input, now)
  },
  bindConversationTaskCancellation(input) {
    return bindConversationTaskActivityCancellation(input)
  },
  finishConversationTaskActivity(conversationId, messageId, status, updates) {
    finishConversationTaskActivityForMessage(conversationId, messageId, status, updates)
  },
  getActiveStream,
  setActiveStream,
  clearActiveStream,
  commitStreamingText(conversationId, messageId) {
    useChatStreamingStore.getState().commitStreamingText(conversationId, messageId)
  },
  commitStreamingTraces(conversationId, messageId) {
    useChatStreamingStore.getState().commitStreamingTraces(conversationId, messageId)
  },
  clearStreaming(conversationId, messageId) {
    useChatStreamingStore.getState().clearStreaming(conversationId, messageId)
  },
  readSettings: () => useSettingsStore.getState().settings,
  resolveRunLimits: resolveWorkflowRunLimitsFromSettings,
  retrieveContext: retrieveConversationKnowledgeContext,
  createChatWorkflowRuntime: createVNextChatWorkflowRuntime,
  startChatWorkflowRun({ runtime, controller, ...input }) {
    return runtime.start({
      ...input,
      cancellationSignal: controller.signal,
    })
  },
  resolveChatWorkflowReply: resolveConversationChatWorkflowAssistantMessage,
  startOrdinaryReply: startConversationAssistantReplyAfterHistoryProjection,
  classifyChatError,
  toUserFacingError,
  sendFailedFallback: () => st('chatRunner.error.sendFailed'),
  reportError(message) {
    useChatStore.getState().setError(message)
  },
  buildEstimatedUsage,
  estimateTextTokens,
})

const conversationReplyDispatchController = createConversationReplyDispatchController({
  normalizeContent: normalizeUserContent,
  readSettings() {
    return useSettingsStore.getState().settings
  },
  async resolveDecisionContext(
    conversation: Conversation,
    settings: Settings,
  ) {
    if (!extractWorkflowDefinitionsFromSkillSnapshot(conversation.skillSnapshot).length) return {}
    const manifests = filterLocalSearchToolManifests(await listConversationToolManifests(), settings)
    const [enabledWorkflowIds, blockedWorkflowStates] = await Promise.all([
      listEnabledWorkflowIdsForSkillSnapshot(conversation.skillSnapshot),
      listBlockedWorkflowStatesForSkillSnapshot(conversation.skillSnapshot, manifests),
    ])
    return { manifests, enabledWorkflowIds, blockedWorkflowStates }
  },
  resolveWorkflowRunLimits: resolveWorkflowRunLimitsFromSettings,
  startWorkflowReply: startConversationChatWorkflowReply,
  startAssistantReply: startConversationAssistantReplyAfterHistoryProjection,
  reportError(message) {
    useChatStore.getState().setError(message)
  },
  sendFailedFallback() {
    return st('chatRunner.error.sendFailed')
  },
})

const chatWorkspaceReviewRuntimeResolver = resolveChatWorkspaceReviewRuntime
const conversationMessageRuntime: ConversationMessageRuntime = {
  dispatchAfterUserProjection: conversationReplyDispatchController.dispatch,
  startAfterHistoryProjection: startConversationAssistantReplyAfterHistoryProjection,
  startConfirmedWorkflowReply: startConversationChatWorkflowReply,
  async resumePendingModelOperation(conversationId, assistantMessageId, runId, approved) {
    const conversation = useChatStore.getState().conversations.find((item) => item.id === conversationId)
    if (!conversation) return false
    const settingsState = useSettingsStore.getState()
    const provider = settingsState.providers.find((item) => item.id === conversation.providerId)
    if (!provider) return false
    useChatStreamingStore.getState().setStreaming(conversationId, assistantMessageId)
    return resumeVNextConversationModelOperation({
      conversation,
      provider,
      settings: settingsState.settings,
      runId,
      approved,
      projection: createVNextPlainChatProjection({
        conversation,
        assistantMessageId,
        provider,
      }, () => undefined),
    })
  },
  listConversationToolManifests,
  resolveConversationTool,
  saveApprovedWorkflowSkillSuggestion,
}

let conversationReplyStartInitialized = false

/**
 * Explicitly composes the presentation commands with the temporary Chat
 * runtime after presentation has projected a user turn or selected history.
 */
export function initializeConversationReplyStart(): void {
  if (conversationReplyStartInitialized) return

  registerStreamAborter(stopConversationMessage)
  bindChatWorkspaceReviewRuntime(chatWorkspaceReviewRuntimeResolver)
  bindConversationMessageRuntime(conversationMessageRuntime)
  conversationReplyStartInitialized = true
}

type MetroHotModule = {
  hot?: {
    dispose(callback: () => void): void
  }
}

const metroHotModule = typeof module === 'undefined'
  ? undefined
  : module as unknown as MetroHotModule

if (__DEV__) {
  metroHotModule?.hot?.dispose(() => {
    releaseChatWorkspaceReviewRuntime(chatWorkspaceReviewRuntimeResolver)
    releaseConversationMessageRuntime(conversationMessageRuntime)
  })
}
