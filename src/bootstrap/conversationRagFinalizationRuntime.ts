import {
  createConversationRagFinalizationRuntime,
  verifyRagGeneration,
} from '@/modules/knowledge'
import type { ProcessTrace } from '@/core'
import type { Conversation } from '@/types/chatContracts'
import type {
  MessageCitation,
  RagEvaluationResult,
  RagGenerationVerification,
  RagQueryPlan,
  RagTraceStep,
  RetrievalSource,
} from '@/types/contextContracts'
import { retrieveConversationFlareContext } from '@/bootstrap/knowledgeContextRuntime'
import { ragEvaluationRepository } from '@/bootstrap/ragEvaluationRepository'
import { st } from '@/i18n/service'
import { completeTrace, sanitizeTrace } from '@/services/chatTraceUtils'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'

export const conversationRagFinalizationRuntime =
  createConversationRagFinalizationRuntime<
    Conversation,
    MessageCitation,
    RetrievalSource,
    RagQueryPlan,
    RagEvaluationResult,
    RagGenerationVerification,
    RagTraceStep,
    ProcessTrace
  >({
    verifyGeneration: verifyRagGeneration,
    retrieveSupplementalEvidence: retrieveConversationFlareContext,
    logEvaluation: ragEvaluationRepository.log,
    now: Date.now,
    traceId(prefix) {
      return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    },
    buildTrace(input): ProcessTrace {
      return {
        ...input,
        metadata: input.metadata ? { ...input.metadata } : undefined,
      }
    },
    completeTrace,
    recordTrace(input) {
      const safeTrace = sanitizeTrace(input.trace)
      const streamingStore = useChatStreamingStore.getState()
      if (streamingStore.activeStreams.get(
        `${input.conversationId}:${input.assistantMessageId}`,
      ) === true) {
        streamingStore.upsertTrace(
          input.conversationId,
          input.assistantMessageId,
          safeTrace,
        )
        return
      }
      useChatStore.getState().upsertMessageTrace(
        input.conversationId,
        input.assistantMessageId,
        safeTrace,
      )
    },
    translate(key, parameters, fallback) {
      return st(
        key,
        parameters as Record<string, string | number | boolean | null | undefined> | undefined,
        fallback,
      )
    },
  })
