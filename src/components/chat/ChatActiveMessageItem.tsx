import { memo, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { MotiView } from 'moti'

import type { useIsleDialog } from '@/components/ui/isle'
import { resolveProviderBrand } from '@/components/ui/ProviderBrandIcon'
import type { MotionIntensity } from '@/hooks/useMotionPreference'
import {
  regenerateLastConversationAssistant,
  retryConversationMessage,
} from '@/presentation/features/conversations/conversationControlCommand'
import { speakText } from '@/services/speech'
import type { Attachment, Message } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'

import { MessageBubble } from './MessageBubble'
import type { ChatActiveWorkspaceActions } from './chatActiveWorkspaceActions'
import {
  continueChatAgentWorkflow,
  continueChatMessageWorkArtifact,
  copyChatMessageProcessTrace,
  copyChatMessageText,
  copyChatMessageWorkArtifact,
  deleteChatMessageWithConfirmation,
  prepareAndroidUndoDraft,
  saveWorkflowSkillFromMessage,
} from './chatMessageBubbleActions'

type ApplyStarterDraft = (draft: string, attachments?: Attachment[], restoreIfEmpty?: boolean) => void

export interface ChatActiveMessageItemProps {
  conversationId: string
  message: Message
  index: number
  motion: MotionIntensity
  viewportHeight: number
  provider: AIProvider | undefined
  modelId: string
  regenerableAssistantId?: string
  actionSheetActive: boolean
  onActionMessageChange: Dispatch<SetStateAction<string | null>>
  multiSelectActive: boolean
  selected: boolean
  onToggleSelected: (message: Message) => void
  onLayoutChangeRequest: () => void
  dialog: ReturnType<typeof useIsleDialog>
  onApplyStarter: ApplyStarterDraft
  refreshSkills: () => Promise<void>
  removeMessage: (convId: string, msgId: string) => void
  openAgentWorkflowSettings: (message: Message) => void
  repairAgentEvidenceFromMessage: ChatActiveWorkspaceActions['repairAgentEvidenceFromMessage']
  confirmActionFromMessage: ChatActiveWorkspaceActions['confirmActionFromMessage']
  quoteMessage: (message: Message) => void
  editUserMessage: (message: Message) => void
  startMessageMultiSelect: (message: Message) => void
  isRewinding?: boolean
}

export const ChatActiveMessageItem = memo(function ChatActiveMessageItem({
  conversationId,
  message,
  index,
  motion,
  viewportHeight,
  provider,
  modelId,
  regenerableAssistantId,
  actionSheetActive,
  onActionMessageChange,
  multiSelectActive,
  selected,
  onToggleSelected,
  onLayoutChangeRequest,
  dialog,
  onApplyStarter,
  refreshSkills,
  removeMessage,
  openAgentWorkflowSettings,
  repairAgentEvidenceFromMessage,
  confirmActionFromMessage,
  quoteMessage,
  editUserMessage,
  startMessageMultiSelect,
  isRewinding = false,
}: ChatActiveMessageItemProps) {
  const { t } = useTranslation()

  return (
    <MotiView
      animate={isRewinding
        ? { opacity: 0, translateY: motion === 'full' ? -8 : 0, scale: motion === 'full' ? 0.985 : 1 }
        : { opacity: 1, translateY: 0, scale: 1 }}
      transition={{ type: 'timing', duration: isRewinding && motion === 'full' ? 160 : 1 }}
      style={{ width: '100%' }}
    >
      <MessageBubble
        conversationId={conversationId}
        message={message}
        index={index}
        motion={motion}
        viewportHeight={viewportHeight}
        providerBrand={resolveProviderBrand(provider, modelId)}
        isLastAssistant={message.id === regenerableAssistantId}
        activeActionMessageId={actionSheetActive ? message.id : null}
        onActionMessageChange={onActionMessageChange}
        multiSelectActive={multiSelectActive}
        selected={selected}
        onToggleSelected={onToggleSelected}
        onLayoutChangeRequest={onLayoutChangeRequest}
        onCopy={(item) => copyChatMessageText({ dialog, message: item, t })}
        onCopyProcessTrace={(item) => copyChatMessageProcessTrace({ dialog, message: item, t })}
        onCopyWorkArtifact={(item) => copyChatMessageWorkArtifact({ dialog, message: item, t })}
        onContinueWorkArtifact={(item) => continueChatMessageWorkArtifact({ dialog, message: item, onApplyStarter, t })}
        onContinueAgentWorkflow={(item) => continueChatAgentWorkflow({ dialog, message: item, onApplyStarter, t })}
        onRepairAgentEvidence={repairAgentEvidenceFromMessage}
        onConfirmAction={confirmActionFromMessage}
        onPrepareAndroidUndo={(item) => prepareAndroidUndoDraft({ dialog, message: item, onApplyStarter, t })}
        onSaveWorkflowSkill={(item) => saveWorkflowSkillFromMessage({
          conversationId,
          dialog,
          message: item,
          refreshSkills,
          t,
        })}
        onRetry={(item) => void retryConversationMessage(conversationId, item.id).catch(() => {
          dialog.toast({
            title: t('chat.retryFailed'),
            message: t('chat.retryFailedMessage'),
            tone: 'danger',
            dedupeKey: 'chat-retry-failed',
          })
        })}
        onRegenerate={() => void regenerateLastConversationAssistant(conversationId).catch(() => {
          dialog.toast({
            title: t('chat.regenerateFailed'),
            message: t('chat.regenerateFailedMessage'),
            tone: 'danger',
            dedupeKey: 'chat-regenerate-failed',
          })
        })}
        onSpeak={(item) => void speakText(item.responseText ?? item.content, provider)}
        onQuote={quoteMessage}
        onEdit={editUserMessage}
        onStartMultiSelect={startMessageMultiSelect}
        onDelete={(item) => deleteChatMessageWithConfirmation({ conversationId, dialog, message: item, removeMessage, t })}
        onConfigure={openAgentWorkflowSettings}
      />
    </MotiView>
  )
})
