import {
  createAssistantConversationKnowledgeContextRuntime,
  type AssistantConversationKnowledgeTraceInput,
} from '@/modules/assistant-runtime'
import {
  retrieveConversationKnowledgeContext,
  type RetrievedConversationKnowledgeContext,
} from '@/bootstrap/knowledgeContextRuntime'
import { completeTrace, sanitizeTrace } from '@/services/chatTraceUtils'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import { st } from '@/i18n/service'
import type { ProcessTrace } from '@/core'
import type { Conversation, Message } from '@/types/chatContracts'

export const conversationKnowledgeContextRuntime =
  createAssistantConversationKnowledgeContextRuntime<
    Conversation,
    Message,
    RetrievedConversationKnowledgeContext,
    ProcessTrace
  >({
    retrieve: retrieveConversationKnowledgeContext,
    createEmptyContext() {
      return { sources: [], prompt: '' }
    },
    isCancellation(error, signal) {
      return signal.aborted || (error instanceof Error && /abort|cancel/i.test(error.name))
    },
    now: Date.now,
    traceId(prefix) {
      return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    },
    buildTrace(input: AssistantConversationKnowledgeTraceInput): ProcessTrace {
      return {
        ...input,
        metadata: input.metadata ? { ...input.metadata } : undefined,
      }
    },
    completeTrace,
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
    translate: st,
  })
