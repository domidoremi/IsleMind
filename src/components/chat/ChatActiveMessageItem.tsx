import { memo, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { MotiView } from 'moti'
import { router } from 'expo-router'

import type { useIsleDialog } from '@/components/ui/isle'
import { resolveProviderBrand } from '@/components/ui/ProviderBrandIcon'
import type { MotionIntensity } from '@/hooks/useMotionPreference'
import {
  regenerateLastConversationAssistant,
  retryConversationMessage,
} from '@/presentation/features/conversations/conversationControlCommand'
import { branchConversationFromMessage } from '@/presentation/features/conversations/conversationMessageActionCommand'
import { speakText } from '@/services/speech'
import type { Attachment, Message } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import { useSettingsStore } from '@/store/settingsStore'
import { useChatStore } from '@/store/chatStore'

import { MessageBubble } from './MessageBubble'
import { resolveMessageProviderIdentity } from './messageProviderIdentity'
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
  const isDraftConversation = useChatStore(state => state.draftConversationIds.has(conversationId))
  const capturedProvider = useSettingsStore((state) => message.providerId
    ? state.providers.find((item) => item.id === message.providerId)
    : undefined)
  const messageIdentity = resolveMessageProviderIdentity({
    message,
    conversationProvider: provider,
    conversationModel: modelId,
    providers: capturedProvider ? [capturedProvider] : [],
  })

  async function confirmRegenerate() {
    const confirmed = await dialog.confirm({
      title: t('chat.regenerateConfirmTitle', { defaultValue: '重新生成回复？' }),
      message: t('chat.regenerateConfirmMessage', { defaultValue: '当前回复将被替换。' }),
      confirmLabel: t('chat.regenerateConfirm', { defaultValue: '重新生成' }),
      cancelLabel: t('common.cancel'),
      tone: 'amber',
    })
    if (!confirmed) return
    await regenerateLastConversationAssistant(conversationId)
  }

  async function confirmBranch(item: Message) {
    const confirmed = await dialog.confirm({
      title: t('messageBubble.branchChat'),
      message: t('messageBubble.branchChatDescription'),
      confirmLabel: t('messageBubble.branchChat'),
      cancelLabel: t('common.cancel'),
      tone: 'mint',
    })
    if (!confirmed) return
    const id = branchConversationFromMessage(conversationId, item.id)
    if (!id) {
      dialog.toast({ title: t('messageBubble.branchChatUnavailable'), tone: 'amber' })
      return
    }
    router.push({ pathname: '/chat/[id]', params: { id, returnTo: 'chat' } })
  }

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
        providerBrand={resolveProviderBrand(messageIdentity.provider, messageIdentity.model)}
        isLastAssistant={message.id === regenerableAssistantId}
        activeActionMessageId={actionSheetActive ? message.id : null}
        onActionMessageChange={onActionMessageChange}
        multiSelectActive={multiSelectActive}
        selected={selected}
        onToggleSelected={onToggleSelected}
        onLayoutChangeRequest={onLayoutChangeRequest}
        onCopy={(item) => copyChatMessageText({ dialog, message: item, t })}
        onCreateDocument={(item) => router.push({ pathname: '/documents/edit', params: { conversationId, messageId: item.id } })}
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
        onRegenerate={() => void confirmRegenerate().catch(() => {
          dialog.toast({
            title: t('chat.regenerateFailed'),
            message: t('chat.regenerateFailedMessage'),
            tone: 'danger',
            dedupeKey: 'chat-regenerate-failed',
          })
        })}
        onSpeak={(item) => void speakText(item.responseText ?? item.content, provider)}
        onQuote={quoteMessage}
        onBranch={isDraftConversation ? undefined : (item) => void confirmBranch(item).catch(() => {
          dialog.toast({ title: t('messageBubble.branchChatFailed'), tone: 'danger' })
        })}
        onEdit={editUserMessage}
        onStartMultiSelect={startMessageMultiSelect}
        onDelete={(item) => deleteChatMessageWithConfirmation({ conversationId, dialog, message: item, removeMessage, t })}
        onConfigure={openAgentWorkflowSettings}
      />
    </MotiView>
  )
})
