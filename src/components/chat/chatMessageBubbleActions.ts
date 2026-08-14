import type { TFunction } from 'i18next'
import * as Clipboard from 'expo-clipboard'

import {
  confirmConversationAction,
  copyConversationMessageFinalText,
  saveConversationWorkflowSkillFromMessage,
} from '@/presentation/features/conversations/conversationMessageActionCommand'
import { buildAndroidUndoPromptContext } from '@/services/chatAndroidUndoPrompt'
import type { Message } from '@/types/chatContracts'
import { summarizeWorkArtifact } from '@/utils/workArtifact'

import {
  buildWorkflowContinuationPrompt,
  buildWorkflowEvidenceRepairPrompt,
  buildWorkflowSkillSaveConfirmOptions,
  readCompletedWorkArtifactTraceFollowUpPrompt,
  readValidatedWorkArtifactBodyFollowUpPrompt,
} from './workflowPresentation'
import { collectVisibleProcessTraces, formatProcessTraceForCopy } from './tracePresentation'

type ChatMessageActionDialog = {
  toast: (options: { title: string; message?: string; tone: 'mint' | 'amber' | 'danger' }) => void
  confirm: (options: {
    title: string
    message: string
    confirmLabel: string
    cancelLabel: string
    tone: 'mint' | 'danger'
    chips?: Array<{ label: string; tone?: 'default' | 'mint' | 'amber' | 'danger' }>
    metrics?: Array<{ label: string; before?: string; after?: string; tone?: 'default' | 'mint' | 'amber' | 'danger' }>
  }) => Promise<boolean>
}

type ApplyStarterDraft = (draft: string) => void

export function copyChatMessageText({
  dialog,
  message,
  t,
}: {
  dialog: ChatMessageActionDialog
  message: Message
  t: TFunction
}) {
  void copyConversationMessageFinalText(message)
    .then(() => dialog.toast({ title: t('common.copied'), message: t('chat.messageCopied'), tone: 'mint' }))
    .catch(() => dialog.toast({ title: t('common.copyFailed'), message: t('chat.clipboardUnavailable'), tone: 'danger' }))
}

export function copyChatMessageProcessTrace({
  dialog,
  message,
  t,
}: {
  dialog: ChatMessageActionDialog
  message: Message
  t: TFunction
}) {
  const traceText = collectVisibleProcessTraces(message).map(formatProcessTraceForCopy).filter(Boolean).join('\n\n')
  if (!traceText.trim()) {
    dialog.toast({ title: t('messageBubble.copyProcessTraceEmpty'), tone: 'amber' })
    return
  }
  void Clipboard.setStringAsync(traceText)
    .then(() => dialog.toast({ title: t('common.copied'), message: t('messageBubble.copyProcessTraceCopied'), tone: 'mint' }))
    .catch(() => dialog.toast({ title: t('common.copyFailed'), message: t('chat.clipboardUnavailable'), tone: 'danger' }))
}

export function copyChatMessageWorkArtifact({
  dialog,
  message,
  t,
}: {
  dialog: ChatMessageActionDialog
  message: Message
  t: TFunction
}) {
  const workArtifact = summarizeWorkArtifact(message.responseText ?? message.content)
  if (!workArtifact.hasWorkArtifact || !workArtifact.handoffText.trim()) {
    dialog.toast({ title: t('messageBubble.copyWorkArtifactEmpty'), tone: 'amber' })
    return
  }
  void Clipboard.setStringAsync(workArtifact.handoffText)
    .then(() => dialog.toast({ title: t('common.copied'), message: t('messageBubble.copyWorkArtifactCopied'), tone: 'mint' }))
    .catch(() => dialog.toast({ title: t('common.copyFailed'), message: t('chat.clipboardUnavailable'), tone: 'danger' }))
}

export function continueChatMessageWorkArtifact({
  dialog,
  message,
  onApplyStarter,
  t,
}: {
  dialog: ChatMessageActionDialog
  message: Message
  onApplyStarter: ApplyStarterDraft
  t: TFunction
}) {
  const traceFollowUpPrompt = readCompletedWorkArtifactTraceFollowUpPrompt(message)
  const bodyFollowUpPrompt = readValidatedWorkArtifactBodyFollowUpPrompt(message)
  const continuePrompt = traceFollowUpPrompt || bodyFollowUpPrompt
  if (!continuePrompt) {
    dialog.toast({ title: t('messageBubble.copyWorkArtifactEmpty'), tone: 'amber' })
    return
  }
  onApplyStarter(continuePrompt)
  dialog.toast({ title: t('messageBubble.continueWorkArtifactInserted'), tone: 'mint' })
}

export function continueChatAgentWorkflow({
  dialog,
  message,
  onApplyStarter,
  t,
}: {
  dialog: ChatMessageActionDialog
  message: Message
  onApplyStarter: ApplyStarterDraft
  t: TFunction
}) {
  onApplyStarter(buildWorkflowContinuationPrompt(message, t))
  dialog.toast({ title: t('messageBubble.continueAgentWorkflowInserted'), tone: 'mint' })
}

export function prepareAndroidUndoDraft({
  dialog,
  message,
  onApplyStarter,
  t,
}: {
  dialog: ChatMessageActionDialog
  message: Message
  onApplyStarter: ApplyStarterDraft
  t: TFunction
}) {
  const undoPrompt = t('messageBubble.prepareAndroidUndoPrompt', {
    context: buildAndroidUndoPromptContext(message, t('messageBubble.emptyResponse')),
  })
  onApplyStarter(undoPrompt)
  dialog.toast({ title: t('messageBubble.prepareAndroidUndoInserted'), tone: 'mint' })
}

export function repairAgentEvidenceDraft({
  dialog,
  message,
  onApplyStarter,
  t,
}: {
  dialog: ChatMessageActionDialog
  message: Message
  onApplyStarter: ApplyStarterDraft
  t: TFunction
}) {
  onApplyStarter(buildWorkflowEvidenceRepairPrompt(message, t))
  dialog.toast({ title: t('messageBubble.repairAgentEvidenceInserted'), tone: 'mint' })
}

export function confirmActionForMessage({
  conversationId,
  dialog,
  message,
  t,
}: {
  conversationId: string
  dialog: ChatMessageActionDialog
  message: Message
  t: TFunction
}) {
  void confirmConversationAction(conversationId, message.id)
    .then((confirmed) => {
      dialog.toast({
        title: confirmed ? t('messageBubble.confirmAgentActionQueued') : t('messageBubble.confirmAgentActionUnavailable'),
        tone: confirmed ? 'mint' : 'amber',
      })
    })
    .catch((error) => dialog.toast({
      title: t('messageBubble.confirmAgentActionFailed'),
      message: error instanceof Error ? error.message : t('messageBubble.confirmAgentActionFailedMessage'),
      tone: 'danger',
    }))
}

export function saveWorkflowSkillFromMessage({
  conversationId,
  dialog,
  message,
  refreshSkills,
  t,
}: {
  conversationId: string
  dialog: ChatMessageActionDialog
  message: Message
  refreshSkills: () => Promise<void>
  t: TFunction
}) {
  const confirmOptions = buildWorkflowSkillSaveConfirmOptions(message, t)
  void dialog.confirm({
    title: t('messageBubble.saveAgentWorkflowTitle'),
    message: confirmOptions.message,
    confirmLabel: t('messageBubble.saveAgentWorkflow'),
    cancelLabel: t('common.cancel'),
    tone: 'mint',
    chips: confirmOptions.chips,
    metrics: confirmOptions.metrics,
  }).then((confirmed) => {
    if (!confirmed) return
    return saveConversationWorkflowSkillFromMessage(conversationId, message.id)
      .then(async (result) => {
        if (result.ok) await refreshSkills()
        dialog.toast({
          title: result.ok
            ? result.status === 'already_saved'
              ? t('messageBubble.saveAgentWorkflowAlreadySaved')
              : t('messageBubble.saveAgentWorkflowSaved')
            : t('messageBubble.saveAgentWorkflowUnavailable'),
          message: result.ok ? result.skillName : result.reason,
          tone: result.ok ? 'mint' : 'amber',
        })
      })
  }).catch((error) => dialog.toast({
    title: t('messageBubble.saveAgentWorkflowFailed'),
    message: error instanceof Error ? error.message : t('messageBubble.saveAgentWorkflowFailedMessage'),
    tone: 'danger',
  }))
}

export function deleteChatMessageWithConfirmation({
  conversationId,
  dialog,
  message,
  removeMessage,
  t,
}: {
  conversationId: string
  dialog: ChatMessageActionDialog
  message: Message
  removeMessage: (conversationId: string, messageId: string) => void
  t: TFunction
}) {
  void dialog.confirm({
    title: t('messageBubble.deleteConfirmTitle'),
    message: t('messageBubble.deleteConfirmMessage'),
    confirmLabel: t('common.delete'),
    cancelLabel: t('common.cancel'),
    tone: 'danger',
  }).then((confirmed) => {
    if (confirmed) removeMessage(conversationId, message.id)
  }).catch(() => {})
}
