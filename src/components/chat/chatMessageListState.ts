import type { TFunction } from 'i18next'
import type { MotionIntensity } from '@/hooks/useMotionPreference'
import type { ConversationTaskActivityRecord } from '@/modules/tasks'
import {
  LONG_MESSAGE_LIST_ANIMATION_THRESHOLD,
  MESSAGE_LIST_ANDROID_DRAW_DISTANCE_MIN,
} from './chatWorkspaceConstants'

export interface ChatMessageListExtraData {
  activeActionMessageId: string | null
  isStreaming: boolean
  messageListMotion: MotionIntensity
  multiSelectActive: boolean
  regenerableAssistantId?: string
  selectedMessageSignature: string
  conversationTaskSignature: string
  rewindingMessageSignature: string
}

export function resolveMessageListDrawDistance(platformOS: string, viewportHeight: number): number | undefined {
  if (platformOS !== 'android') return undefined
  return Math.max(MESSAGE_LIST_ANDROID_DRAW_DISTANCE_MIN, Math.ceil(viewportHeight * 2.2))
}

export function resolveMessageListMotion(messageCount: number, motion: MotionIntensity): MotionIntensity {
  return messageCount >= LONG_MESSAGE_LIST_ANIMATION_THRESHOLD && motion === 'full'
    ? 'reduced'
    : motion
}

export function buildMessageListExtraData({
  activeActionMessageId,
  isStreaming,
  messageListMotion,
  conversationTasks,
  multiSelectActive,
  regenerableAssistantId,
  selectedMessageSignature,
  rewindingMessageIds = new Set<string>(),
}: {
  activeActionMessageId: string | null
  isStreaming: boolean
  messageListMotion: MotionIntensity
  conversationTasks: ConversationTaskActivityRecord[]
  multiSelectActive: boolean
  regenerableAssistantId?: string
  selectedMessageSignature: string
  rewindingMessageIds?: Set<string>
}): ChatMessageListExtraData {
  return {
    activeActionMessageId,
    isStreaming,
    messageListMotion,
    multiSelectActive,
    regenerableAssistantId,
    selectedMessageSignature,
    rewindingMessageSignature: Array.from(rewindingMessageIds).sort().join('|'),
    conversationTaskSignature: conversationTasks.map((task) => `${task.id}:${task.status}:${task.progress ?? ''}:${task.updatedAt}`).join('|'),
  }
}

export function buildMessageListAccessibility({
  activityLabel,
  isStreaming,
  messageCount,
  t,
}: {
  activityLabel: string
  isStreaming: boolean
  messageCount: number
  t: TFunction
}): { value: string; state: { busy: boolean } } {
  const messageCountLabel = t(messageCount === 1 ? 'conversation.messageCountOne' : 'conversation.messageCountOther', {
    count: messageCount,
  })
  return {
    value: t(isStreaming ? 'chat.messageListGeneratingAccessibilityValue' : 'chat.messageListAccessibilityValue', {
      messageCount: messageCountLabel,
      activity: activityLabel || t('chat.generating'),
    }),
    state: { busy: isStreaming },
  }
}
