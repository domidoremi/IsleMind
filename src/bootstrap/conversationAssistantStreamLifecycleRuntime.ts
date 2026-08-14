import {
  createAssistantConversationStreamLifecycleRuntime,
} from '@/modules/assistant-runtime'
import { conversationAssistantFinalizationRuntime } from '@/bootstrap/conversationAssistantFinalizationRuntime'
import { conversationAssistantStreamFailureRuntime } from '@/bootstrap/conversationAssistantStreamFailureRuntime'

export const conversationAssistantStreamLifecycleRuntime =
  createAssistantConversationStreamLifecycleRuntime({
    finalize: conversationAssistantFinalizationRuntime.finalize,
    failProvider: conversationAssistantFinalizationRuntime.failProvider,
    projectCompletionFailure:
      conversationAssistantStreamFailureRuntime.projectCompletionFailure,
    projectStartFailure:
      conversationAssistantStreamFailureRuntime.projectStartFailure,
  })
