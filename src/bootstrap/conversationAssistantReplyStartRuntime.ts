import { createAssistantConversationReplyStartRuntime } from '@/modules/assistant-runtime'
import { filterSendableAttachments } from '@/modules/conversations'
import { conversationAssistantContextAcquisitionRuntime } from '@/bootstrap/conversationAssistantContextAcquisitionRuntime'
import { projectConversationAssistantFailure } from '@/bootstrap/conversationAssistantMessageProjection'
import { conversationAssistantPlainChatHandoffRuntime } from '@/bootstrap/conversationAssistantPlainChatHandoffRuntime'
import { conversationAssistantProviderAdmissionRuntime } from '@/bootstrap/conversationAssistantProviderAdmissionRuntime'
import {
  allocateConversationAssistantRunId,
  conversationAssistantDurableExecutionRuntime,
} from '@/bootstrap/conversationAssistantDurableExecutionRuntime'
import { conversationAssistantProviderToolAdmissionRuntime } from '@/bootstrap/conversationAssistantProviderToolAdmissionRuntime'
import { conversationAssistantReplySessionRuntime } from '@/bootstrap/conversationAssistantReplySessionRuntime'
import { conversationAssistantRequestPlanningRuntime } from '@/bootstrap/conversationAssistantRequestPlanningRuntime'
import { conversationAssistantStreamLifecycleRuntime } from '@/bootstrap/conversationAssistantStreamLifecycleRuntime'
import { createConversationModelOperationSession } from '@/bootstrap/conversationModelOperationRuntime'
import { saveConversationRecord } from '@/presentation/features/conversations/conversationStorePersistenceCommand'
import {
  conversationAssistantWorkspaceSourceRuntime,
  conversationAssistantWorkspaceWritebackHandoffRuntime,
} from '@/bootstrap/tavernWorkspace'
import { st } from '@/i18n/service'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'

export const conversationAssistantReplyStartRuntime =
  createAssistantConversationReplyStartRuntime({
    projectLifecycleStage(input) {
      useChatStore.getState().transitionMessageLifecycle(
        input.conversationId,
        input.assistantMessageId,
        input.stage,
      )
    },
    allocateAssistantRunId: allocateConversationAssistantRunId,
    workspaceSourceRuntime: conversationAssistantWorkspaceSourceRuntime,
    workspaceWritebackHandoffRuntime:
      conversationAssistantWorkspaceWritebackHandoffRuntime,
    projectWorkspaceWritebackHandoffTerminal(input) {
      if (input.outcome.kind === 'cancelled') return
      projectConversationAssistantFailure({
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        content: st('chatRunner.error.sendFailed'),
        providerId: input.providerId,
      })
    },
    replySessionRuntime: conversationAssistantReplySessionRuntime,
    providerAdmissionRuntime: conversationAssistantProviderAdmissionRuntime,
    persistAdmissionConversation({ conversation }) {
      // Admission normalizes provider-owned conversation fields, while a
      // concurrent stop/recovery command may have already terminalized the
      // placeholder in the live store. Persist the admitted identity with
      // the latest message projection so an older streaming snapshot cannot
      // overwrite cancellation or recovery state in the queued mutation.
      const latestConversation = useChatStore
        .getState()
        .conversations
        .find((item) => item.id === conversation.id)
      const snapshot = latestConversation
        ? {
            ...conversation,
            title: latestConversation.title,
            messages: latestConversation.messages,
            updatedAt: latestConversation.updatedAt,
          }
        : conversation
      return saveConversationRecord(snapshot)
    },
    projectAdmissionPersistenceFailure({
      conversationId,
      assistantMessageId,
      providerId,
    }) {
      const message = useChatStore.getState().conversations
        .find((conversation) => conversation.id === conversationId)
        ?.messages.find((item) => item.id === assistantMessageId)
      if (message?.status === 'cancelled') return
      projectConversationAssistantFailure({
        conversationId,
        assistantMessageId,
        content: st('chatRunner.error.sendFailed'),
        errorCode: 'unknown',
        providerId,
      })
    },
    plainChatHandoffRuntime: conversationAssistantPlainChatHandoffRuntime,
    contextAcquisitionRuntime: conversationAssistantContextAcquisitionRuntime,
    providerToolAdmissionRuntime:
      conversationAssistantProviderToolAdmissionRuntime,
    requestPlanningRuntime: conversationAssistantRequestPlanningRuntime,
    streamLifecycleRuntime: {
      build(input) {
        return conversationAssistantStreamLifecycleRuntime.build(
          input as unknown as Parameters<
            typeof conversationAssistantStreamLifecycleRuntime.build
          >[0],
        )
      },
    },
    durableDispatchRuntime: {
      dispatch(input) {
        return conversationAssistantDurableExecutionRuntime.dispatch(
          input as unknown as Parameters<
            typeof conversationAssistantDurableExecutionRuntime.dispatch
          >[0],
        )
      },
    },
    getProviderSettingsState() {
      const state = useSettingsStore.getState()
      return {
        providers: state.providers,
        settings: state.settings,
      }
    },
    getLatestConversation(conversationId) {
      return useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === conversationId)
    },
    getSettings() {
      return useSettingsStore.getState().settings
    },
    createModelOperationSession(input) {
      return createConversationModelOperationSession({
        conversation: input.conversation,
        provider: input.provider,
        settings: input.settings,
        allowConfirmation: false,
      })
    },
    filterSendableAttachments,
  })

export async function startConversationAssistantReplyAfterHistoryProjection(
  conversationId: string,
): Promise<void> {
  await conversationAssistantReplyStartRuntime.start({
    conversationId,
  })
}
