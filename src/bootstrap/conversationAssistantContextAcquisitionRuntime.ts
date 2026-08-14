import {
  createAssistantConversationContextAcquisitionRuntime,
} from '@/modules/assistant-runtime'
import type { ProcessTrace } from '@/core'
import type { Conversation, Message } from '@/types/chatContracts'
import type { AIProvider, ChatErrorCode } from '@/types/providerContracts'
import type { RetrievalSource } from '@/types/contextContracts'
import type { SearchProviderId, Settings } from '@/types/settingsContracts'
import type { TavernContextPack } from '@/modules/workspaces'
import {
  conversationMcpContextRuntime,
  type ConversationResolvedMcpTool,
} from '@/bootstrap/conversationMcpContextRuntime'
import type { RetrievedConversationKnowledgeContext } from '@/bootstrap/knowledgeContextRuntime'
import { conversationKnowledgeContextRuntime } from '@/bootstrap/conversationKnowledgeContextRuntime'
import { projectConversationAssistantFailure } from '@/bootstrap/conversationAssistantMessageProjection'
import { MCP_TOOL_CALL_TAG, resolveSearchProvider } from '@/modules/integrations'
import { sanitizeTrace } from '@/services/chatTraceUtils'
import { st } from '@/i18n/service'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import { useSettingsStore } from '@/store/settingsStore'

export const conversationAssistantContextAcquisitionRuntime =
  createAssistantConversationContextAcquisitionRuntime<
    AIProvider,
    AIProvider[],
    Conversation,
    Message,
    Settings,
    RetrievedConversationKnowledgeContext,
    TavernContextPack,
    Settings,
    SearchProviderId,
    RetrievalSource[],
    ConversationResolvedMcpTool,
    ProcessTrace,
    ChatErrorCode
  >({
    listFallbackProviders() {
      return useSettingsStore.getState().getConfiguredProviders()
    },
    getKnowledgeSettings() {
      return useSettingsStore.getState().settings
    },
    resolveKnowledgeContext(input) {
      return conversationKnowledgeContextRuntime.resolveContext(input)
    },
    isReplyCancelled(input) {
      const conversation = useChatStore.getState().conversations
        .find((item) => item.id === input.conversationId)
      const message = conversation?.messages
        .find((item) => item.id === input.assistantMessageId)
      return message?.status === 'cancelled'
    },
    resolveSearchMode: resolveSearchProvider,
    createEmptyWebSources() {
      return []
    },
    resolveMcpContext(input) {
      return conversationMcpContextRuntime.resolveConversationMcpContext({
        ...input,
        toolCallTag: MCP_TOOL_CALL_TAG,
        traceId,
      })
    },
    recordTrace(input) {
      const safeTrace = sanitizeTrace(input.trace)
      const streamingStore = useChatStreamingStore.getState()
      if (streamingStore.activeStreams.get(`${input.conversationId}:${input.assistantMessageId}`) === true) {
        streamingStore.upsertTrace(input.conversationId, input.assistantMessageId, safeTrace)
        return
      }
      useChatStore.getState().upsertMessageTrace(
        input.conversationId,
        input.assistantMessageId,
        safeTrace,
      )
    },
    mcpFailureContent() {
      return st('chatRunner.error.sendFailed')
    },
    projectTerminalFailure: projectConversationAssistantFailure,
  })

function traceId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
