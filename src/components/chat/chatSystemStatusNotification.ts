import { useEffect, useRef } from 'react'
import type { TFunction } from 'i18next'
import { clearAndroidStatusNotification, updateAndroidStatusNotification } from '@/services/androidStatusNotification'
import type { Message } from '@/types/chatContracts'
import { previewSystemStatusMessage } from './messageActivityPreview'

const SYSTEM_STATUS_NOTIFICATION_CLEAR_DELAY_MS = 5200

export function useChatSystemStatusNotification({
  active,
  activityLabel,
  conversationId,
  conversationTitle,
  enabled,
  isStreaming,
  lastMessage,
  messages,
  streamingMessage,
  t,
  managedByGlobal = false,
}: {
  active: boolean
  activityLabel: string
  conversationId?: string
  conversationTitle?: string
  enabled: boolean
  isStreaming: boolean
  lastMessage?: Message
  messages?: Message[]
  streamingMessage?: Message
  t: TFunction
  managedByGlobal?: boolean
}) {
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeStatusRef = useRef<{ conversationId: string; messageId?: string; title: string } | null>(null)

  useEffect(() => {
    if (managedByGlobal) return
    if (!active) return
    if (clearTimer.current) {
      clearTimeout(clearTimer.current)
      clearTimer.current = null
    }

    if (!conversationId || !enabled) {
      activeStatusRef.current = null
      void clearAndroidStatusNotification()
      return
    }

    const title = conversationTitle?.trim() || t('conversation.untitled')
    if (isStreaming && streamingMessage) {
      const activity = activityLabel || t('chat.generating')
      activeStatusRef.current = {
        conversationId,
        messageId: streamingMessage.id,
        title,
      }
      void updateAndroidStatusNotification({
        state: 'generating',
        title: t('chat.systemStatusGeneratingTitle'),
        message: t('chat.systemStatusGeneratingMessage', { conversation: title, activity }),
        shortText: activity,
        conversationId,
        deepLink: `islemind://chat/${conversationId}`,
        indeterminate: true,
        ongoing: true,
        requestPromotedOngoing: true,
      })
      return
    }

    const activeStatus = activeStatusRef.current
    if (!activeStatus || activeStatus.conversationId !== conversationId) {
      void clearAndroidStatusNotification()
      return
    }

    const completedMessage = messages?.find((message) => message.id === activeStatus.messageId) ?? lastMessage
    if (!completedMessage || completedMessage.status === 'sending' || completedMessage.status === 'streaming') return

    const terminal = completedMessage.status === 'error'
      ? 'error'
      : completedMessage.status === 'cancelled'
        ? 'cancelled'
        : 'completed'
    const preview = previewSystemStatusMessage(completedMessage, t)
    const statusTitle = terminal === 'error'
      ? t('chat.systemStatusErrorTitle')
      : terminal === 'cancelled'
        ? t('chat.systemStatusStoppedTitle')
        : t('chat.systemStatusCompletedTitle')
    const message = terminal === 'error'
      ? t('chat.systemStatusErrorMessage', { conversation: title, preview })
      : terminal === 'cancelled'
        ? t('chat.systemStatusStoppedMessage', { conversation: title, preview })
        : t('chat.systemStatusCompletedMessage', { conversation: title, preview })
    void updateAndroidStatusNotification({
      state: terminal === 'error' ? 'error' : 'completed',
      title: statusTitle,
      message,
      shortText: preview,
      conversationId,
      deepLink: `islemind://chat/${conversationId}`,
      indeterminate: false,
      ongoing: false,
      requestPromotedOngoing: false,
    })
    activeStatusRef.current = null
    clearTimer.current = setTimeout(() => {
      clearTimer.current = null
      void clearAndroidStatusNotification()
    }, SYSTEM_STATUS_NOTIFICATION_CLEAR_DELAY_MS)
  }, [active, activityLabel, conversationId, conversationTitle, enabled, isStreaming, lastMessage, managedByGlobal, messages, streamingMessage, t])

  useEffect(() => () => {
    if (managedByGlobal) return
    if (clearTimer.current) clearTimeout(clearTimer.current)
    void clearAndroidStatusNotification()
  }, [managedByGlobal])
}
