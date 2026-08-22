import type { ProcessTrace } from '@/core'
import {
  createAssistantConversationFinalizationRuntime,
  type AssistantTaggedToolManifestLike,
  type AssistantConversationWorkspaceWritebackOutcomeProjection,
  type ContextFragment,
  type ContextWindowState,
} from '@/modules/assistant-runtime'
import type {
  ConversationAssistantProjectionSkipped,
  ConversationAssistantSuccessPlan,
} from '@/modules/conversations'
import {
  parseMcpToolRequest,
  type ConversationToolCatalogManifest,
  type ResolvedMcpConversationTool,
} from '@/modules/integrations'
import type {
  ProviderContextManagementCapabilityKind,
  ProviderContextManagementStrategy,
  ProviderRemoteCompactClassification,
  ProviderRuntimeChatMessage,
  ProviderRuntimeCompletionResult,
  ProviderRuntimeError,
  ProviderToolCall,
} from '@/modules/providers'
import { conversationAssistantDetachedWorkRegistry } from '@/bootstrap/conversationAssistantDetachedWorkRegistry'
import { conversationAssistantMessageProjection, commitConversationAssistantSuccessProjection, projectConversationAssistantFailure } from '@/bootstrap/conversationAssistantMessageProjection'
import { runConversationMemoryExtraction } from '@/bootstrap/conversationMemoryExtractionRuntime'
import { createConversationMcpToolTurnRuntime } from '@/bootstrap/conversationMcpToolTurnRuntime'
import type { ConversationProviderToolContext } from '@/bootstrap/conversationProviderToolTurnRuntime'
import { providerRemoteCompactLifecycle } from '@/bootstrap/providerRemoteCompactLifecycle'
import { conversationRagFinalizationRuntime } from '@/bootstrap/conversationRagFinalizationRuntime'
import { finalizeTavernChatWorkspaceWriteback } from '@/bootstrap/tavernWorkspace'
import { st } from '@/i18n/service'
import { classifyChatError, toUserFacingError } from '@/services/chatErrorUtils'
import { clearActiveStream, getActiveStream } from '@/services/chatStreamLifecycle'
import { completeTrace, sanitizeTrace, settleMessageTraces } from '@/services/chatTraceUtils'
import { mergeUsage } from '@/services/chatToolResultUtils'
import { useChatStore } from '@/store/chatStore'
import { mergeMessageWithStreamingTraceSnapshot, useChatStreamingStore } from '@/store/chatStreamingStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { Conversation, Message, MessageUsage } from '@/types/chatContracts'
import type {
  MessageCitation,
  RagEvaluationResult,
  RagGenerationVerification,
  RagQueryPlan,
  RetrievalSource,
} from '@/types/contextContracts'
import type { McpServerConfig } from '@/types/mcpContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { RemoteCompactMode, Settings } from '@/types/settingsContracts'
import type { RetrievedConversationKnowledgeContext } from '@/bootstrap/knowledgeContextRuntime'

type ProviderUsage = NonNullable<ProviderRuntimeCompletionResult['usage']>
type ResolvedMcpTool = ResolvedMcpConversationTool<McpServerConfig>

export const conversationAssistantFinalizationRuntime =
  createAssistantConversationFinalizationRuntime<
    MessageCitation,
    RetrievalSource,
    ProviderUsage,
    ProviderToolCall,
    Conversation,
    RetrievedConversationKnowledgeContext,
    AIProvider,
    ProviderRuntimeChatMessage,
    ResolvedMcpTool,
    ConversationProviderToolContext,
    RemoteCompactMode,
    ContextWindowState,
    ContextFragment,
    RagQueryPlan,
    RagEvaluationResult,
    RagGenerationVerification,
    Settings,
    MessageUsage,
    ConversationAssistantSuccessPlan,
    ConversationAssistantProjectionSkipped,
    ProcessTrace,
    ProviderRuntimeError,
    ProviderContextManagementStrategy,
    ProviderContextManagementCapabilityKind,
    ProviderRemoteCompactClassification
  >({
    acquireDetachedWork(input) {
      return conversationAssistantDetachedWorkRegistry.acquire(input)
    },
    flushStreamingMessage(conversationId, assistantMessageId) {
      return useChatStreamingStore.getState().flushStreamingMessage(
        conversationId,
        assistantMessageId,
      )
    },
    getActiveStream,
    clearActiveStream,
    getMessage(conversationId, assistantMessageId) {
      return getMessage(conversationId, assistantMessageId)
    },
    getConversation(conversationId) {
      return useChatStore.getState().conversations.find(
        (conversation) => conversation.id === conversationId,
      )
    },
    getSettings() {
      return useSettingsStore.getState().settings
    },
    mergeUsage,
    verifyInitialGeneration(input) {
      return conversationRagFinalizationRuntime.verifyInitialGeneration(input)
    },
    hasTaggedToolRequest(output) {
      return parseMcpToolRequest(output) !== null
    },
    reviseWithMcpTools(input) {
      const runtime = createConversationMcpToolTurnRuntime({
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        onStreamEvent: input.onStreamEvent,
      })
      return runtime.execute({
        ...input,
        manifests: input.providerTools?.manifests.filter(isTaggedExternalToolManifest),
      })
    },
    resolveSupplementalEvidence(input) {
      return conversationRagFinalizationRuntime.resolveSupplementalEvidence(input)
    },
    now: Date.now,
    buildSuccessPlan(input) {
      return conversationAssistantMessageProjection.buildSuccessPlan(input)
    },
    recordRemoteCompactCompleted(input) {
      providerRemoteCompactLifecycle.recordCompleted(input)
    },
    recordRemoteCompactFailed(input) {
      providerRemoteCompactLifecycle.recordFailed(input)
    },
    commitSuccess(input) {
      commitConversationAssistantSuccessProjection(input)
    },
    finalizeWorkspaceWriteback(input) {
      return finalizeTavernChatWorkspaceWriteback(input)
    },
    projectWorkspaceWritebackOutcome(projection) {
      projectConversationWorkspaceWritebackOutcome(projection)
    },
    updateProviderCredentialGroupHealth(providerId, credentialGroupId, healthy) {
      return useSettingsStore.getState().updateProviderCredentialGroupHealth(
        providerId,
        credentialGroupId,
        healthy,
      )
    },
    recordRagEvaluation(input) {
      conversationRagFinalizationRuntime.recordEvaluation(input)
    },
    buildTrace(input): ProcessTrace {
      return {
        ...input,
        metadata: { ...input.metadata },
      }
    },
    completeTrace,
    recordTrace(input) {
      recordConversationTrace(
        input.conversationId,
        input.assistantMessageId,
        input.trace,
      )
    },
    getMessageWithStreamingTraceState,
    settleRunningTraces(input) {
      const message = getMessageWithStreamingTraceState(
        input.conversationId,
        input.assistantMessageId,
      )
      for (const trace of settleMessageTraces(message, input)) {
        recordConversationTrace(
          input.conversationId,
          input.assistantMessageId,
          trace,
        )
      }
    },
    translate(key, parameters) {
      return st(
        key,
        parameters as Record<string, string | number | boolean | null | undefined> | undefined,
      )
    },
    extractMemory(input) {
      return runConversationMemoryExtraction(input)
    },
    projectProviderModelFailure(input) {
      const errorCode = resolveProviderErrorCode(input.error)
      recordConversationTrace(input.conversationId, input.assistantMessageId, completeTrace({
        id: input.modelTraceId,
        type: 'system',
        title: st('chatRunner.trace.modelRequestTitle'),
        content: toUserFacingError(input.error.message, errorCode),
        status: 'error',
        startedAt: getMessage(input.conversationId, input.assistantMessageId)?.startedAt ?? Date.now(),
      }))
    },
    projectProviderNativeSearchFailure(input) {
      recordConversationTrace(input.conversationId, input.assistantMessageId, completeTrace({
        id: input.nativeSearchTraceId,
        type: 'search',
        title: st('chatRunner.trace.nativeSearchTitle'),
        content: st('chatRunner.trace.nativeSearchFailedWithModel'),
        status: 'error',
        startedAt: getMessageWithStreamingTraceState(
          input.conversationId,
          input.assistantMessageId,
        )?.retrievalTrace?.find((trace) => trace.id === input.nativeSearchTraceId)?.startedAt ?? Date.now(),
        metadata: { mode: input.providerWebSearchMode },
      }))
    },
    projectProviderTerminalFailure(input) {
      const errorCode = resolveProviderErrorCode(input.error)
      projectConversationAssistantFailure({
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        content: toUserFacingError(input.error.message, errorCode),
        errorCode,
        providerId: input.providerId,
      })
    },
  })

function getMessage(conversationId: string, messageId: string): Message | null {
  return useChatStore.getState().conversations
    .find((conversation) => conversation.id === conversationId)
    ?.messages.find((message) => message.id === messageId) ?? null
}

function getMessageWithStreamingTraceState(
  conversationId: string,
  messageId: string,
): Message | null {
  const message = getMessage(conversationId, messageId)
  if (!message) return null
  const snapshot = useChatStreamingStore.getState()
    .getStreamingTraceSnapshot(conversationId, messageId)
  return mergeMessageWithStreamingTraceSnapshot(message, snapshot)
}

function recordConversationTrace(
  conversationId: string,
  assistantMessageId: string,
  trace: ProcessTrace,
): void {
  const safeTrace = sanitizeTrace(trace)
  const streamingStore = useChatStreamingStore.getState()
  if (streamingStore.activeStreams.get(
    `${conversationId}:${assistantMessageId}`,
  ) === true) {
    streamingStore.upsertTrace(conversationId, assistantMessageId, safeTrace)
    return
  }
  useChatStore.getState().upsertMessageTrace(
    conversationId,
    assistantMessageId,
    safeTrace,
  )
}

export function projectConversationWorkspaceWritebackOutcome(
  projection: AssistantConversationWorkspaceWritebackOutcomeProjection,
): void {
  const startedAt = projection.occurredAt ?? Date.now()
  recordConversationTrace(
    projection.conversationId,
    projection.assistantMessageId,
    completeTrace({
      id: `workspace-writeback:${projection.assistantRunId}`,
      type: 'system',
      title: st('chatRunner.trace.workspaceWritebackTitle'),
      content: st(workspaceWritebackContentKey(projection.status)),
      status: workspaceWritebackTraceStatus(projection.status),
      startedAt,
      ...(projection.origin === 'recovered' ? { completedAt: startedAt } : {}),
      metadata: {
        assistantRunId: projection.assistantRunId,
        workspaceId: projection.workspaceId,
        repositoryAuthorityRevision: projection.repositoryAuthorityRevision,
        status: projection.status,
        origin: projection.origin,
        ...(projection.code ? { code: projection.code } : {}),
        ...(projection.authorityRevision === undefined
          ? {}
          : { authorityRevision: projection.authorityRevision }),
        ...(projection.actualAuthorityRevision === undefined
          ? {}
          : { actualAuthorityRevision: projection.actualAuthorityRevision }),
      },
    }),
  )
}

function workspaceWritebackContentKey(
  status: AssistantConversationWorkspaceWritebackOutcomeProjection['status'],
): string {
  switch (status) {
    case 'applied':
      return 'chatRunner.trace.workspaceWritebackApplied'
    case 'replayed':
      return 'chatRunner.trace.workspaceWritebackReplayed'
    case 'no_changes':
      return 'chatRunner.trace.workspaceWritebackNoChanges'
    case 'conflict':
      return 'chatRunner.trace.workspaceWritebackConflict'
    case 'cancelled':
      return 'chatRunner.trace.workspaceWritebackCancelled'
    case 'unavailable':
    case 'failed':
    case 'unknown':
      return 'chatRunner.trace.workspaceWritebackFailed'
  }
}

function workspaceWritebackTraceStatus(
  status: AssistantConversationWorkspaceWritebackOutcomeProjection['status'],
): ProcessTrace['status'] {
  switch (status) {
    case 'applied':
    case 'replayed':
      return 'done'
    case 'no_changes':
      return 'skipped'
    case 'cancelled':
      return 'cancelled'
    case 'conflict':
    case 'unavailable':
    case 'failed':
    case 'unknown':
      return 'error'
  }
}

function resolveProviderErrorCode(error: ProviderRuntimeError) {
  return error.chatErrorCode ?? classifyChatError(error.message)
}

function isTaggedExternalToolManifest(
  manifest: ConversationToolCatalogManifest,
): manifest is ConversationToolCatalogManifest & AssistantTaggedToolManifestLike {
  return manifest.source === 'mcp'
    || manifest.source === 'builtin'
    || manifest.source === 'app-action'
    || manifest.source === 'android'
}
