import { resolveConversationChatWorkflowAssistantMessage } from '@/bootstrap/conversationChatWorkflowResolutionRuntime'
import { retrieveConversationKnowledgeContextInLocalJob } from '@/bootstrap/knowledgeContextRuntime'
import { createChatWorkflowRuntime } from '@/bootstrap/chatWorkflowRuntime'
import { systemClock } from '@/core'
import { assistantExecutionHost } from '@/bootstrap/assistantExecutionHostRuntime'
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
import { cancelConversationResponseRun, getLatestConversationResponseRun, resumeConversationModelOperation, resumePausedConversationRun } from '@/bootstrap/conversationRuntime'
import { HARNESS_ENGINE_VERSION } from '@/modules/assistant-runtime'
import { getPausedConversationResponseAction, type PausedConversationResponseIdentity } from '@/presentation/features/conversations/pausedConversationResponseAction'
import { createPlainChatProjection, recoverChatProjection } from '@/presentation/features/conversations/plainChatProjection'
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
import { assertProviderConfiguration, snapshotProviderConfiguration } from '@/modules/providers'
import type { ConversationRunProjection } from '@/modules/conversations'
import type { Message } from '@/types/chatContracts'

function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const startConversationChatWorkflowReply = createConversationChatWorkflowReplyStarter({
  clock: systemClock,
  createMessageId,
  createAbortController: () => new AbortController(),
  stopConversation: stopConversationMessage,
  addMessage(conversationId, message) {
    useChatStore.getState().addMessage(conversationId, message)
  },
  projectLifecycleStage({ conversationId, assistantMessageId, stage }) {
    useChatStore.getState().transitionMessageLifecycle(
      conversationId,
      assistantMessageId,
      stage,
    )
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
  // The task-bound RAG adapter admits this whole workflow job once.
  retrieveContext: retrieveConversationKnowledgeContextInLocalJob,
  createChatWorkflowRuntime: createChatWorkflowRuntime,
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

// Only explicit send/retry/confirmed-workflow entry points recheck a latched
// resource pause. Automatic continuations and workflow fallback stay fenced.
async function startUserRequestedAssistantReply(conversationId: string): Promise<void> {
  assistantExecutionHost.prepareUserResume()
  await startConversationAssistantReplyAfterHistoryProjection(conversationId)
}

const startUserRequestedChatWorkflowReply: typeof startConversationChatWorkflowReply = async (...args) => {
  assistantExecutionHost.prepareUserResume()
  await startConversationChatWorkflowReply(...args)
}
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
  startWorkflowReply: startUserRequestedChatWorkflowReply,
  startAssistantReply: startUserRequestedAssistantReply,
  reportError(message) {
    useChatStore.getState().setError(message)
  },
  sendFailedFallback() {
    return st('chatRunner.error.sendFailed')
  },
})

const chatWorkspaceReviewRuntimeResolver = resolveChatWorkspaceReviewRuntime
const restoringModelOperations = new Set<string>()

function pendingResponse(conversation: Conversation | undefined, messageId: string, runId: string): Message | undefined {
  const index = conversation?.messages.findIndex(message => message.id === messageId) ?? -1
  const message = index >= 0 ? conversation!.messages[index] : undefined
  if (!message || message.role !== 'assistant' || message.status === 'cancelled'
    || conversation!.messages.slice(index + 1).some(item => item.status !== 'cancelled')) return undefined
  const traces = [...(message.reasoning ?? []), ...(message.toolCalls ?? []), ...(message.retrievalTrace ?? [])]
  const owner = traces.findLast(trace => typeof trace.metadata?.pendingModelOperationRunId === 'string')
  return owner?.metadata?.pendingModelOperationRunId === runId ? message : undefined
}

function pausedResponse(conversation: Conversation | undefined, messageId: string, identity: PausedConversationResponseIdentity): Message | undefined {
  const index = conversation?.messages.findIndex(message => message.id === messageId) ?? -1
  const message = index >= 0 ? conversation!.messages[index] : undefined
  if (!message || conversation!.messages.slice(index + 1).some(item => item.status !== 'cancelled')) return undefined
  const action = getPausedConversationResponseAction(message)
  return action?.runId === identity.runId && action.journalSequence === identity.journalSequence ? message : undefined
}

function sameResumeSnapshot(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => sameResumeSnapshot(item, right[index]))
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  const keys = Object.keys(a).filter(key => a[key] !== undefined)
  return keys.length === Object.keys(b).filter(key => b[key] !== undefined).length
    && keys.every(key => sameResumeSnapshot(a[key], b[key]))
}

const conversationMessageRuntime: ConversationMessageRuntime = {
  dispatchAfterUserProjection: conversationReplyDispatchController.dispatch,
  startAfterHistoryProjection: startUserRequestedAssistantReply,
  startConfirmedWorkflowReply: startUserRequestedChatWorkflowReply,
  getLatestResponseRun: getLatestConversationResponseRun,
  cancelResponseRun: cancelConversationResponseRun,
  async resumePausedResponse(conversationId, assistantMessageId, identity, signal) {
    if (signal?.aborted || restoringModelOperations.has(conversationId) || getActiveStream(conversationId)) return false
    const selected = { runId: identity.runId, journalSequence: identity.journalSequence }
    const current = useChatStore.getState().conversations.find(item => item.id === conversationId)
    const target = pausedResponse(current, assistantMessageId, selected)
    if (!target || !current?.providerId?.trim() || !current.model?.trim()) return false
    restoringModelOperations.add(conversationId)
    const timestamp = target.timestamp
    const controller = new AbortController()
    const cancel = () => controller.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    let admitted = false
    let projected = false
    let released = false
    let projection: ConversationRunProjection | undefined
    const ownsProjection = () => {
      const active = getActiveStream(conversationId)
      if (active && active.controller !== controller) return false
      const conversation = useChatStore.getState().conversations.find(item => item.id === conversationId)
      const index = conversation?.messages.findIndex(item => item.id === assistantMessageId) ?? -1
      const message = index >= 0 ? conversation!.messages[index] : undefined
      return !!message && message.role === 'assistant' && message.timestamp === timestamp
        && !conversation!.messages.slice(index + 1).some(item => item.status !== 'cancelled')
    }
    const release = async () => {
      if (released) return
      released = true
      try {
        if (projected && ownsProjection()) await useChatStreamingStore.getState().flushStreamingMessage(
          conversationId, assistantMessageId, ownsProjection,
        )
      } finally {
        if (getActiveStream(conversationId)?.controller === controller) clearActiveStream(conversationId)
        restoringModelOperations.delete(conversationId)
        signal?.removeEventListener('abort', cancel)
      }
    }
    try {
      const settingsState = useSettingsStore.getState()
      const conversation = snapshotProviderConfiguration(current)
      const settings = snapshotProviderConfiguration(settingsState.settings)
      const providers = snapshotProviderConfiguration(settingsState.providers)
      const run = await getLatestConversationResponseRun(conversationId, assistantMessageId)
      const checkpoint = run?.lifecycleCheckpoint
      if (signal?.aborted || !run || run.id !== selected.runId || run.journalSequence !== selected.journalSequence
        || run.conversationId !== conversationId || run.responseMessageId !== assistantMessageId
        || run.status !== 'paused' || run.parentRunId || run.pendingModelOperation || run.engineVersion !== HARNESS_ENGINE_VERSION
        || checkpoint?.recovery !== 'resumable' || checkpoint.phase === 'operation' || checkpoint.phase === 'confirmation'
        || checkpoint.phase === 'complete' || !checkpoint.request
        || !run.providerId?.trim() || !run.model?.trim() || checkpoint.request.conversationId !== conversationId
        || checkpoint.request.providerId !== run.providerId || checkpoint.request.model !== run.model) return false
      const expectedProvider = providers.find(provider => provider.id === run.providerId)
      if (!expectedProvider?.enabled) return false
      const stillSelected = () => !controller.signal.aborted && !getActiveStream(conversationId)
        && !!pausedResponse(useChatStore.getState().conversations.find(item => item.id === conversationId), assistantMessageId, selected)
        && sameResumeSnapshot(conversation, useChatStore.getState().conversations.find(item => item.id === conversationId))
        && sameResumeSnapshot(settings, useSettingsStore.getState().settings)
      if (!stillSelected()) return false
      const hydrated = await settingsState.hydrateProviderKey(run.providerId)
      if (!hydrated?.enabled || hydrated.id !== expectedProvider.id || !stillSelected()) return false
      try {
        assertProviderConfiguration(useSettingsStore.getState().providers.find(provider => provider.id === expectedProvider.id), expectedProvider)
      } catch {
        return false
      }
      const provider = snapshotProviderConfiguration(hydrated)
      return await resumePausedConversationRun({
        conversation: { ...conversation, providerId: run.providerId, model: run.model },
        provider, settings, runId: run.id, expectedJournalSequence: selected.journalSequence,
        cancellationSignal: controller.signal,
        projection: async event => {
          if (event.run.id !== run.id || event.run.conversationId !== conversationId
            || event.run.responseMessageId !== assistantMessageId) return
          if (!ownsProjection()) { controller.abort(); return }
          if (!projection) {
            if (event.run.status === 'succeeded' || event.run.status === 'failed'
              || event.run.status === 'cancelled' || event.run.status === 'paused') {
              projected = true
              await recoverChatProjection(event.run, ownsProjection)
              return
            }
            // Only the committed resume event opens streaming and Stop. A click,
            // credential read or catalog refresh cannot grant generation state.
            if (event.journalEntry?.type !== 'run.resumed') return
            if (!stillSelected()) { controller.abort(); return }
            admitted = true
            setActiveStream(conversationId, { controller, messageId: assistantMessageId })
            projection = createPlainChatProjection({ conversation, assistantMessageId, provider }, () => undefined, ownsProjection)
            projected = true
          }
          await projection(event)
        },
        onSettled: async result => {
          try {
            if (admitted && !result.ok && ownsProjection() && !controller.signal.aborted) {
              useChatStore.getState().setError(st('messageBubble.resumeFailed'))
            }
          } finally {
            await release()
          }
        },
      })
    } catch (error) {
      controller.abort()
      await release()
      throw error
    } finally {
      // resume() acknowledges admission before completion; keep its controller,
      // cancellation lifetime and duplicate fence until the invocation settles.
      if (!admitted) await release()
    }
  },
  async resumePendingModelOperation(conversationId, assistantMessageId, runId, approved, identity, signal) {
    if (signal?.aborted || restoringModelOperations.has(conversationId) || getActiveStream(conversationId)) return false
    restoringModelOperations.add(conversationId)
    let projection: ConversationRunProjection | undefined
    let projected = false
    let timestamp: number | undefined
    const ownsProjection = () => {
      if (getActiveStream(conversationId)) return false
      const conversation = useChatStore.getState().conversations.find(item => item.id === conversationId)
      const message = conversation?.messages.find(item => item.id === assistantMessageId)
      if (!message || message.role !== 'assistant' || message.timestamp !== timestamp) return false
      const traces = [...(message.reasoning ?? []), ...(message.toolCalls ?? []), ...(message.retrievalTrace ?? [])]
      return !traces.some(trace => typeof trace.metadata?.pendingModelOperationRunId === 'string'
        && trace.metadata.pendingModelOperationRunId !== runId)
    }
    try {
      const current = useChatStore.getState().conversations.find(item => item.id === conversationId)
      const target = pendingResponse(current, assistantMessageId, runId)
      if (!current?.providerId?.trim() || !current.model?.trim() || !target) return false
      timestamp = target.timestamp
      const settingsState = useSettingsStore.getState()
      const conversation = snapshotProviderConfiguration(current)
      const settings = snapshotProviderConfiguration(settingsState.settings)
      const providers = snapshotProviderConfiguration(settingsState.providers)
      const reviewedIdentity = { continuationToken: identity.continuationToken, continuationDigest: identity.continuationDigest }
      const run = await getLatestConversationResponseRun(conversationId, assistantMessageId)
      if (signal?.aborted || !run || run.id !== runId || run.conversationId !== conversationId
        || run.responseMessageId !== assistantMessageId || run.status !== 'awaiting-confirmation'
        || !run.providerId?.trim() || !run.model?.trim()
        || run.pendingModelOperation?.continuationToken !== reviewedIdentity.continuationToken
        || run.pendingModelOperation?.continuationDigest !== reviewedIdentity.continuationDigest) return false
      // A previously confirmed fallback route belongs to the durable run, not
      // the user's still-retained preferred provider/model for later turns.
      const providerId = run.providerId
      const model = run.model
      const expectedProvider = providers.find(provider => provider.id === providerId)
      if (!expectedProvider?.enabled
        || !sameResumeSnapshot(conversation, useChatStore.getState().conversations.find(item => item.id === conversationId))
        || !sameResumeSnapshot(settings, useSettingsStore.getState().settings)) return false
      // Restore only local credentials; an awaited read cannot retain old metadata.
      const hydrated = await settingsState.hydrateProviderKey(providerId)
      if (signal?.aborted || getActiveStream(conversationId) || !hydrated?.enabled || hydrated.id !== expectedProvider.id) return false
      const latestConversation = useChatStore.getState().conversations.find(item => item.id === conversationId)
      const latestSettings = useSettingsStore.getState()
      if (!pendingResponse(latestConversation, assistantMessageId, runId)
        || !sameResumeSnapshot(conversation, latestConversation)
        || !sameResumeSnapshot(settings, latestSettings.settings)) return false
      try {
        assertProviderConfiguration(latestSettings.providers.find(provider => provider.id === expectedProvider.id), expectedProvider)
      } catch {
        return false
      }
      const provider = snapshotProviderConfiguration(hydrated)
      const executionConversation = { ...conversation, providerId, model }
      return await resumeConversationModelOperation({
        conversation: executionConversation,
        provider,
        settings,
        runId,
        approved,
        ...reviewedIdentity,
        ...(signal ? { cancellationSignal: signal } : {}),
        // Waiting/streaming is evidence of durable admission, not an optimistic click.
        projection: async event => {
          if (event.run.id !== runId || event.run.conversationId !== conversationId
            || event.run.responseMessageId !== assistantMessageId || !ownsProjection()) return
          if (!projection) {
            if (event.run.status === 'succeeded' || event.run.status === 'failed' || event.run.status === 'cancelled') {
              projected = true
              await recoverChatProjection(event.run, ownsProjection)
              return
            }
            if (signal?.aborted || !pendingResponse(
              useChatStore.getState().conversations.find(item => item.id === conversationId), assistantMessageId, runId,
            )) return
            projection = createPlainChatProjection({ conversation, assistantMessageId, provider }, () => undefined, ownsProjection)
            projected = true
            useChatStreamingStore.getState().setStreaming(conversationId, assistantMessageId)
          }
          await projection(event)
        },
      })
    } finally {
      try {
        if (projected && ownsProjection()) {
          // The flush owns conditional clearing; later chunks can arrive while it persists.
          await useChatStreamingStore.getState().flushStreamingMessage(conversationId, assistantMessageId, ownsProjection)
        }
      } finally {
        restoringModelOperations.delete(conversationId)
      }
    }
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
