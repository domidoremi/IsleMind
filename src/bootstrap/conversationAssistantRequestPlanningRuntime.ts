import type { ProcessTrace } from '@/core'
import {
  createAssistantConversationRequestPlanningRuntime,
  type ContextFragment,
  type ContextPlan,
  type ContextPlanningMessage,
  type ContextPlannerSource,
  type ContextPlanningPackedChatMessages,
  type ContextPlanningRequestMessage,
} from '@/modules/assistant-runtime'
import {
  resolveProviderContextManagement,
  type CompactUsageRecord,
  type ProviderConversationNativeSearchAdmissionOutcome,
  type ProviderRemoteCompactFragmentIdentity,
  type ProviderRemoteCompactPreviousState,
  type RemoteCompactDecision,
} from '@/modules/providers'
import {
  buildChatContextRuntime,
  type ChatContextRuntimeArtifact,
} from '@/bootstrap/contextContributionRuntime'
import { planChatContext } from '@/bootstrap/contextPlanning'
import { conversationProviderNativeSearchAdmission } from '@/bootstrap/conversationProviderNativeSearchAdmission'
import { runApplicationContextSummary } from '@/bootstrap/providerApplicationContextSummary'
import { usesOpenAIResponses } from '@/bootstrap/providerRequestPolicies'
import { providerRemoteCompactLifecycle } from '@/bootstrap/providerRemoteCompactLifecycle'
import { recordCompactUsage } from '@/bootstrap/providerCompactUsage'
import { projectConversationAssistantFailure } from '@/bootstrap/conversationAssistantMessageProjection'
import { st } from '@/i18n/service'
import { buildSystemPrompt } from '@/services/promptEngineering'
import { completeTrace, sanitizeTrace } from '@/services/chatTraceUtils'
import { emitRuntimeEvent } from '@/services/runtimeEvents'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import type { Attachment, Conversation, Message } from '@/types/chatContracts'
import type { RetrievalSource } from '@/types/contextContracts'
import type { AIModel, AIProvider } from '@/types/providerContracts'
import type { RemoteCompactMode, SearchProviderId, Settings } from '@/types/settingsContracts'
import type { TavernContextPack } from '@/modules/workspaces'
import type { RetrievedConversationKnowledgeContext } from '@/bootstrap/knowledgeContextRuntime'

export const conversationAssistantRequestPlanningRuntime =
  createAssistantConversationRequestPlanningRuntime<
    RetrievedConversationKnowledgeContext,
    RetrievalSource[],
    TavernContextPack,
    AIProvider,
    AIModel,
    SearchProviderId,
    ProviderConversationNativeSearchAdmissionOutcome['webSearchMode'],
    Attachment,
    Conversation,
    Settings,
    ContextPlanningMessage<Attachment>,
    RetrievalSource[],
    ContextPlannerSource[],
    ChatContextRuntimeArtifact,
    ProviderConversationNativeSearchAdmissionOutcome,
    ProviderRemoteCompactFragmentIdentity,
    ProviderRemoteCompactPreviousState,
    ContextPlanningRequestMessage,
    ContextPlanningPackedChatMessages,
    ContextPlanningPackedChatMessages,
    RemoteCompactMode,
    RemoteCompactDecision,
    ContextFragment,
    ContextPlan,
    CompactUsageRecord,
    ProcessTrace
  >({
    assembleContext(input) {
      return buildChatContextRuntime({
        retrievedContext: input.retrievedContext,
        webSources: input.webSources,
        mcpPrompt: input.mcpPrompt,
        mcpToolCount: input.mcpToolCount,
        tavernContext: input.workspaceContext,
      })
    },
    admitNativeSearch: conversationProviderNativeSearchAdmission.admit,
    resolveUsesOpenAIResponses(input) {
      return usesOpenAIResponses({
        provider: input.provider,
        model: input.model,
        webSearchMode: input.webSearchMode,
        attachments: input.attachments as Attachment[],
      })
    },
    buildSystemPrompt,
    resolvePreviousCompactState(input) {
      const contextManagement = resolveProviderContextManagement({
        provider: input.provider,
        settings: input.settings,
        ...(input.usesOpenAIResponses === undefined
          ? {}
          : { usesOpenAIResponses: input.usesOpenAIResponses }),
      })
      return providerRemoteCompactLifecycle.resolvePreviousState({
        conversationId: input.conversationId,
        providerId: input.providerId,
        model: input.model,
        settings: input.settings,
        strategy: contextManagement.strategy,
        capabilityKind: contextManagement.capabilityKind,
        remoteClassification: contextManagement.remoteClassification,
      })
    },
    planContext: planChatContext,
    runApplicationContextSummary(input) {
      return runApplicationContextSummary({
        provider: input.provider,
        model: input.model,
        messages: input.messages,
        contextPrompt: input.contextPrompt,
        settings: input.settings,
        conversationId: input.conversationId,
        signal: input.signal,
      })
    },
    emitRuntimeEvent,
    recordCompactUsage,
    traceId(prefix) {
      return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    },
    now: Date.now,
    translate(key, parameters) {
      return st(
        key,
        parameters as Record<string, string | number | boolean | null | undefined> | undefined,
      )
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
    projectTerminalFailure: projectConversationAssistantFailure,
  })

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
