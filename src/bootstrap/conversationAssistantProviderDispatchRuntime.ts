import {
  createAssistantConversationProviderDispatchRuntime,
} from '@/modules/assistant-runtime'
import type { ProviderRuntimeChatRequest } from '@/modules/providers'
import type { Attachment, Conversation } from '@/types/chatContracts'
import type { RetrievalSource } from '@/types/contextContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings, WebSearchMode } from '@/types/settingsContracts'
import type { ProcessTrace, ReasoningEffort } from '@/core'
import { conversationProviderStreamingRuntime } from '@/bootstrap/conversationProviderStreamingRuntime'
import { sanitizeTrace } from '@/services/chatTraceUtils'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import { st } from '@/i18n/service'

type ProviderStreamingInput = Parameters<
  typeof conversationProviderStreamingRuntime.start
>[0]
type ProviderStreamingLifecycle = Pick<
  ProviderStreamingInput,
  'complete' | 'completionFailed' | 'providerFailed' | 'startFailed'
>
type ProviderStreamingOutcome = Awaited<ReturnType<
  typeof conversationProviderStreamingRuntime.start
>>

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const conversationAssistantProviderDispatchRuntime =
  createAssistantConversationProviderDispatchRuntime<
    Conversation,
    AIProvider,
    Settings,
    Attachment,
    ProviderRuntimeChatRequest['messages'][number],
    RetrievalSource,
    WebSearchMode,
    AIProvider[],
    ProviderRuntimeChatRequest['remoteCompactFallback'],
    ProviderRuntimeChatRequest['providerToolDeclarations'],
    ReasoningEffort,
    ProviderStreamingLifecycle,
    ProviderStreamingOutcome
  >({
    generateTraceId(prefix) {
      return `${prefix}-${generateId()}`
    },
    now: Date.now,
    modelRequestTitle() {
      return st('chatRunner.trace.modelRequestTitle')
    },
    recordTrace({ conversationId, assistantMessageId, trace }) {
      const safeTrace = sanitizeTrace(trace as ProcessTrace)
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
    },
    startStreaming(input) {
      return conversationProviderStreamingRuntime.start(input)
    },
  })
