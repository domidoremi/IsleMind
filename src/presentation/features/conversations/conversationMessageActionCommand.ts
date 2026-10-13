import * as Clipboard from 'expo-clipboard'

import { st } from '@/i18n/service'
import { getWorkflowPendingActionFromMessage } from '@/presentation/features/conversations/workflowMessageActionSelectors'
import { getWorkflowSkillSuggestionFromMessage } from '@/presentation/features/conversations/workflowSkillSuggestionSelector'
import {
  resolveWorkflowRunLimitsFromSettings,
  type WorkflowMessagePendingAction,
  type WorkflowRunLimits,
  type WorkflowStepToolRequest as ConversationToolRequest,
  type WorkflowSkillSuggestion,
  type SaveWorkflowSkillSuggestionResult,
} from '@/modules/tasks'
import type {
  ConversationToolCatalogManifest as ConversationToolManifest,
} from '@/modules/integrations'
import { stopConversationMessage } from '@/presentation/features/conversations/conversationControlCommand'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { Message } from '@/types/chatContracts'
import type { AssistantRun } from '@/modules/assistant-runtime'

import { createConversationActionConfirmationController } from './conversationActionConfirmationController'
import { createConversationWorkflowSkillSaveController } from './conversationWorkflowSkillSaveController'
import { createConversationMessageActionController } from './conversationMessageActionController'
import { formatWorkflowSaveBlockedReason, resolveConfirmedPendingActionTool } from './workflowActionPolicy'
import {
  listConversationToolManifestsRuntime,
  resolveConversationToolRuntime,
  saveApprovedConversationWorkflowSkillRuntime as saveApprovedWorkflowSkillSuggestion,
  startConfirmedConversationWorkflowReplyRuntime,
  resumePendingConversationModelOperationRuntime,
  getLatestConversationResponseRunRuntime,
} from './conversationMessageRuntimeBinding'

const messageActionController = createConversationMessageActionController({
  writeText(text) {
    return Clipboard.setStringAsync(text)
  },
})

const actionConfirmationController = createConversationActionConfirmationController<
  ConversationToolRequest,
  WorkflowMessagePendingAction,
  ConversationToolManifest,
  Partial<WorkflowRunLimits>
>({
  getConversation(conversationId) {
    return useChatStore.getState().conversations.find((conversation) => conversation.id === conversationId)
  },
  getPendingAction: getWorkflowPendingActionFromMessage,
  listToolManifests: listConversationToolManifestsRuntime,
  resolveConfirmedTool({ pendingAction, manifests }) {
    const request = pendingAction.resumeToolRequest
    if (!request) return undefined
    return resolveConfirmedPendingActionTool({
      pendingAction,
      tool: resolveConversationToolRuntime(request, manifests),
    })
  },
  getRunLimits() {
    return resolveWorkflowRunLimitsFromSettings(useSettingsStore.getState().settings)
  },
  stopConversation: stopConversationMessage,
  removeMessage(conversationId, messageId) {
    useChatStore.getState().removeMessage(conversationId, messageId)
  },
  startWorkflowReply: startConfirmedConversationWorkflowReplyRuntime,
})

const workflowSkillSaveController = createConversationWorkflowSkillSaveController<
  WorkflowSkillSuggestion,
  SaveWorkflowSkillSuggestionResult['reason']
>({
  getConversation(conversationId) {
    return useChatStore.getState().conversations.find((conversation) => conversation.id === conversationId)
  },
  getSuggestion: getWorkflowSkillSuggestionFromMessage,
  async saveApprovedSuggestion(input) {
    const result = await saveApprovedWorkflowSkillSuggestion(input)
    if (result.ok && result.skill && (result.status === 'saved' || result.status === 'already_saved')) {
      return {
        ok: true,
        status: result.status,
        skill: { name: result.skill.name },
      }
    }
    return {
      ok: false,
      status: 'blocked',
      reason: result.reason,
    }
  },
  now: Date.now,
  translate: st,
  formatBlockedReason(reason) {
    return formatWorkflowSaveBlockedReason(reason, st)
  },
})

export async function copyConversationMessageFinalText(message: Message): Promise<void> {
  await messageActionController.copyFinalText(message)
}

export function branchConversationFromMessage(conversationId: string, messageId: string): string | null {
  return useChatStore.getState().createBranchDraft(conversationId, messageId)
}

export async function confirmConversationAction(
  conversationId: string,
  assistantMessageId: string,
  review?: (run: AssistantRun) => Promise<boolean | 'decline'>,
): Promise<boolean> {
  const message = useChatStore.getState().conversations
    .find((conversation) => conversation.id === conversationId)
    ?.messages.find((item) => item.id === assistantMessageId)
  const runId = message ? pendingModelOperationRunId(message) : undefined
  if (runId) {
    const run = await getLatestConversationResponseRunRuntime(conversationId, assistantMessageId)
    const pending = run?.pendingModelOperation
    if (!review || !run || run.id !== runId || !pending || run.status !== 'awaiting-confirmation') return false
    const approved = await review(run)
    if (approved === false) return false
    return resumePendingConversationModelOperationRuntime(
      conversationId,
      assistantMessageId,
      runId,
      approved === true,
      { continuationToken: pending.continuationToken, continuationDigest: pending.continuationDigest },
    )
  }
  return actionConfirmationController.confirm(conversationId, assistantMessageId)
}

function pendingModelOperationRunId(message: Message): string | undefined {
  const traces = [...(message.reasoning ?? []), ...(message.toolCalls ?? []), ...(message.retrievalTrace ?? [])]
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const value = traces[index]?.metadata?.pendingModelOperationRunId
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

export function saveConversationWorkflowSkillFromMessage(
  conversationId: string,
  assistantMessageId: string,
) {
  return workflowSkillSaveController.saveFromMessage(conversationId, assistantMessageId)
}
