import {
  createAssistantConversationPlainChatHandoffRuntime,
} from '@/modules/assistant-runtime'
import type { ProcessTrace } from '@/core'
import { conversationAssistantDetachedWorkRegistry } from '@/bootstrap/conversationAssistantDetachedWorkRegistry'
import { createPlainChatRuntime } from '@/bootstrap/conversationRuntime'
import { projectConversationAssistantFailure } from '@/bootstrap/conversationAssistantMessageProjection'
import { runConversationMemoryExtraction } from '@/bootstrap/conversationMemoryExtractionRuntime'
import {
  isPlainChatEligible,
  tryStartPlainChatRun,
} from '@/presentation/features/conversations/plainChatCommand'
import {
  clearActiveStream,
  getActiveStream,
  setActiveStream,
} from '@/services/chatStreamLifecycle'
import { sanitizeTrace } from '@/services/chatTraceUtils'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider, ChatErrorCode } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import { st } from '@/i18n/service'

export const conversationAssistantPlainChatHandoffRuntime =
  createAssistantConversationPlainChatHandoffRuntime<
    Conversation,
    AIProvider,
    Settings,
    ChatErrorCode
  >({
    isEligible: isPlainChatEligible,
    getPersistedConversation(conversationId) {
      return useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === conversationId)
    },
    isReplyCancelled({ conversationId, assistantMessageId, controller }) {
      if (controller.signal.aborted) return true
      const conversation = useChatStore
        .getState()
        .conversations.find((item) => item.id === conversationId)
      return conversation?.messages.find(
        (message) => message.id === assistantMessageId,
      )?.status === 'cancelled'
    },
    async startPlainChatRun(input) {
      const handle = await tryStartPlainChatRun({
        ...input,
        createRuntime: createPlainChatRuntime,
      })
      if (!handle) return undefined
      return {
        done: handle.done.then(() => {
          const conversation = useChatStore
            .getState()
            .conversations.find((item) => item.id === input.conversation.id)
          const assistantMessage = conversation?.messages.find(
            (message) => message.id === input.assistantMessageId,
          )
          if (!conversation || assistantMessage?.status !== 'done') return

          const detachedWork = conversationAssistantDetachedWorkRegistry.acquire({
            conversationId: conversation.id,
            workId: `memory-extraction:${input.assistantMessageId}`,
          })
          try {
            const extraction = runConversationMemoryExtraction({
              conversationId: conversation.id,
              assistantMessageId: input.assistantMessageId,
              messages: conversation.messages,
              provider: input.provider,
              model: input.conversation.model,
              signal: detachedWork.signal,
              recordTrace(trace) {
                recordPlainChatTrace(
                  conversation.id,
                  input.assistantMessageId,
                  trace,
                )
              },
            })
            void Promise.resolve(extraction).then(
              () => detachedWork.release(),
              () => detachedWork.release(),
            )
          } catch {
            detachedWork.release()
          }
        }),
      }
    },
    setActiveStream,
    getActiveStream,
    clearActiveStream,
    projectFailure: projectConversationAssistantFailure,
    fallbackFailureMessage() {
      return st('chatRunner.error.sendFailed')
    },
    unknownErrorCode: 'unknown',
  })

function recordPlainChatTrace(
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
