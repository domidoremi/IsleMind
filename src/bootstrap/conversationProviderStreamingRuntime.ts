import {
  createAssistantConversationProviderStreamingRuntime,
  createAssistantStreamProjectionPolicy,
  type AssistantConversationProviderStreamingRuntimeInput,
} from '@/modules/assistant-runtime'
import type {
  ProviderRuntimeChatRequest,
  ProviderRuntimeCompletionResult,
} from '@/modules/providers'
import type { MessageCitation } from '@/types/contextContracts'
import type { ProcessTrace } from '@/core'
import { conversationProviderGateway } from '@/bootstrap/conversationProviderGateway'
import {
  clearActiveStream,
  getActiveStream,
  setActiveStream,
} from '@/services/chatStreamLifecycle'
import { clampTraceContent, sanitizeTrace } from '@/services/chatTraceUtils'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'

const streamProjectionPolicy = createAssistantStreamProjectionPolicy({
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs)
    return () => clearTimeout(timer)
  },
  appendContent(projection) {
    useChatStreamingStore.getState().appendContent(
      projection.conversationId,
      projection.responseMessageId,
      projection.text,
    )
  },
  upsertTrace(projection) {
    const safeTrace = sanitizeTrace(projection.trace)
    const streamingStore = useChatStreamingStore.getState()
    if (streamingStore.activeStreams.get(
      `${projection.conversationId}:${projection.responseMessageId}`,
    ) === true) {
      streamingStore.upsertTrace(
        projection.conversationId,
        projection.responseMessageId,
        safeTrace,
      )
      return
    }
    useChatStore.getState().upsertMessageTrace(
      projection.conversationId,
      projection.responseMessageId,
      safeTrace,
    )
  },
  clampTraceContent,
})

const providerStreamingRuntime =
  createAssistantConversationProviderStreamingRuntime<
    ProviderRuntimeChatRequest,
    ProviderRuntimeCompletionResult,
    Error,
    MessageCitation[],
    ProcessTrace
  >({
    createProjection: streamProjectionPolicy.start,
    dispatch(request, onChunk, onDone, onError, onCitations, onTrace) {
      return conversationProviderGateway.startRuntimeStream(request, {
        onChunk,
        onDone,
        onError,
        onCitations,
        onTrace,
      })
    },
    getActiveStream,
    setActiveStream,
    clearActiveStream,
    isMessageCancelled({ conversationId, assistantMessageId }) {
      const conversation = useChatStore.getState().conversations
        .find((item) => item.id === conversationId)
      return conversation?.messages
        .find((message) => message.id === assistantMessageId)
        ?.status === 'cancelled'
    },
  })

type ProviderStreamingInput = AssistantConversationProviderStreamingRuntimeInput<
  ProviderRuntimeChatRequest,
  ProviderRuntimeCompletionResult,
  Error,
  MessageCitation[]
>

export const conversationProviderStreamingRuntime = {
  start(input: Omit<ProviderStreamingInput, 'citations'>) {
    return providerStreamingRuntime.start({
      ...input,
      citations(citations) {
        useChatStore.getState().updateMessage(
          input.conversationId,
          input.assistantMessageId,
          { citations },
        )
      },
    })
  },
}
