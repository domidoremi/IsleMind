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
import type { Conversation, Message } from '@/types/chatContracts'
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

const reviewingOperations = new Set<string>()

export async function confirmConversationAction(
  conversationId: string,
  assistantMessageId: string,
  review?: (run: AssistantRun) => Promise<boolean | 'decline'>,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted || reviewingOperations.has(conversationId)) return false
  reviewingOperations.add(conversationId)
  try {
    const conversation = useChatStore.getState().conversations.find(item => item.id === conversationId)
    const message = conversation?.messages.find((item) => item.id === assistantMessageId)
    const runId = message ? pendingModelOperationRunId(message) : undefined
    if (runId) {
      const timestamp = message!.timestamp
      const snapshot = confirmationConversationSnapshot(conversation!)
      if (!review || !currentPendingModelOperation(conversationId, assistantMessageId, runId, timestamp, snapshot)) return false
      const run = await getLatestConversationResponseRunRuntime(conversationId, assistantMessageId)
      const pending = run?.pendingModelOperation
      if (signal?.aborted || !run || run.id !== runId || run.conversationId !== conversationId
        || run.responseMessageId !== assistantMessageId || !pending || run.status !== 'awaiting-confirmation'
        || !currentPendingModelOperation(conversationId, assistantMessageId, runId, timestamp, snapshot)) return false
      // The preview object may be caller-owned; approval binds primitive identity.
      const identity = { continuationToken: pending.continuationToken, continuationDigest: pending.continuationDigest }
      const approved = await review(run)
      if ((approved !== true && approved !== 'decline') || signal?.aborted
        || !currentPendingModelOperation(conversationId, assistantMessageId, runId, timestamp, snapshot)) return false
      if (signal) return await resumePendingConversationModelOperationRuntime(
        conversationId, assistantMessageId, runId, approved === true, identity, signal,
      )
      return await resumePendingConversationModelOperationRuntime(
        conversationId,
        assistantMessageId,
        runId,
        approved === true,
        identity,
      )
    }
    return await actionConfirmationController.confirm(conversationId, assistantMessageId, signal)
  } finally {
    reviewingOperations.delete(conversationId)
  }
}

function currentPendingModelOperation(conversationId: string, messageId: string, runId: string, timestamp: number, snapshot: string): boolean {
  const conversation = useChatStore.getState().conversations.find(item => item.id === conversationId)
  const index = conversation?.messages.findIndex(item => item.id === messageId) ?? -1
  const message = index >= 0 ? conversation!.messages[index] : undefined
  return Boolean(message && message.role === 'assistant' && message.status !== 'cancelled'
    && message.timestamp === timestamp && pendingModelOperationRunId(message) === runId
    && confirmationConversationSnapshot(conversation!) === snapshot
    && !conversation!.messages.slice(index + 1).some(item => item.status !== 'cancelled'))
}

function confirmationConversationSnapshot(conversation: Conversation): string {
  const { updatedAt: _updatedAt, ...snapshot } = conversation
  return JSON.stringify(snapshot)
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
