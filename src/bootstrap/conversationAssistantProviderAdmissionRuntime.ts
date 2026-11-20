import type { ProcessTrace } from '@/core'
import {
  createAssistantConversationProviderAdmissionRuntime,
} from '@/modules/assistant-runtime'
import { conversationProviderAdmissionRuntime } from '@/bootstrap/conversationProviderAdmissionRuntime'
import { projectConversationAssistantFailure } from '@/bootstrap/conversationAssistantMessageProjection'
import { createProviderCompatibilityTrace } from '@/bootstrap/providerRuntimeDiagnostics'
import { st } from '@/i18n/service'
import { buildSetupGuide } from '@/services/chatErrorUtils'
import { sanitizeTrace } from '@/services/chatTraceUtils'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import { getActiveStream } from '@/services/chatStreamLifecycle'
import { stopConversationMessage } from '@/presentation/features/conversations/conversationControlCommand'
import type { BoundConversation, Conversation } from '@/types/chatContracts'
import { getModelConfig } from '@/types/modelCatalog'
import type { AIProvider, ChatErrorCode } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'

export const conversationAssistantProviderAdmissionRuntime =
  createAssistantConversationProviderAdmissionRuntime<
    Conversation,
    AIProvider,
    readonly AIProvider[],
    Settings,
    ReturnType<typeof getModelConfig>,
    ChatErrorCode,
    ProcessTrace,
    BoundConversation
  >({
    async admitConversation(input) {
      const outcome = await conversationProviderAdmissionRuntime.admitConversation(input)
      if (outcome.kind !== 'rejected' || outcome.reason !== 'confirmation_declined') return outcome
      // A superseded confirmation must never stop a newer turn in this conversation.
      if (getActiveStream(input.conversation.id)?.controller.signal === input.signal) {
        await stopConversationMessage(input.conversation.id)
      }
      return { kind: 'cancelled' as const }
    },
    buildSetupGuide,
    translate(key, parameters, fallback) {
      return st(
        key,
        parameters as Record<string, string | number | boolean | null | undefined> | undefined,
        fallback,
      )
    },
    projectTerminalFailure: projectConversationAssistantFailure,
    buildCompatibilityTrace: createProviderCompatibilityTrace,
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
    missingKeyErrorCode: 'missing_key',
  })
