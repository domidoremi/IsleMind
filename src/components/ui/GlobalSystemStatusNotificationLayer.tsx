import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { clearAndroidStatusNotification, updateAndroidStatusNotification } from '@/bootstrap/androidStatusNotification'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import { useSettingsStore } from '@/store/settingsStore'
import { previewSystemStatusMessage } from '@/components/chat/messageActivityPreview'
import { getMessageActivityLabel } from '@/components/chat/messageActivityPreview'
import { resolveGlobalGenerationStatus } from './globalGenerationStatusState'
import {
  createSystemStatusNotificationDispatcher,
  type SystemStatusNotificationDispatcher,
} from './systemStatusNotificationDispatch'

const SYSTEM_STATUS_NOTIFICATION_CLEAR_DELAY_MS = 12_000

/** Owns Chat system notification lifecycle independently of the currently visible route. */
export function GlobalSystemStatusNotificationLayer() {
  const enabled = useSettingsStore((state) => state.settings.systemStatusNotificationsEnabled === true)
  const enabledRef = useRef(enabled)
  const wasEnabledRef = useRef(enabled)
  enabledRef.current = enabled
  const notificationDispatcher = useMemo(() => createSystemStatusNotificationDispatcher({
    update: (payload) => updateAndroidStatusNotification(payload, { enabled: enabledRef.current }),
    clear: clearAndroidStatusNotification,
  }), [])

  useEffect(() => {
    if (wasEnabledRef.current && !enabled) void notificationDispatcher.clear()
    wasEnabledRef.current = enabled
  }, [enabled, notificationDispatcher])

  return enabled
    ? <EnabledSystemStatusNotificationLayer notificationDispatcher={notificationDispatcher} />
    : null
}

function EnabledSystemStatusNotificationLayer({
  notificationDispatcher,
}: {
  notificationDispatcher: SystemStatusNotificationDispatcher
}) {
  const { t } = useTranslation()
  const conversations = useChatStore((state) => state.conversations)
  const activeStreams = useChatStreamingStore((state) => state.activeStreams)
  const activeStatus = useMemo(() => resolveGlobalGenerationStatus(conversations, activeStreams), [activeStreams, conversations])
  const tracked = useRef<{ conversationId: string; messageId: string; title: string } | null>(null)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (clearTimer.current) {
      clearTimeout(clearTimer.current)
      clearTimer.current = null
    }

    if (activeStatus) {
      const conversation = conversations.find((item) => item.id === activeStatus.conversationId)
      const message = conversation?.messages.find((item) => item.id === activeStatus.messageId)
      const title = activeStatus.conversationTitle || t('conversation.untitled')
      const activity = message ? getMessageActivityLabel(message, t) : t('chat.generating')
      tracked.current = { conversationId: activeStatus.conversationId, messageId: activeStatus.messageId, title }
      void notificationDispatcher.update({
        state: 'generating',
        title: t('chat.systemStatusGeneratingTitle'),
        message: t('chat.systemStatusGeneratingMessage', { conversation: title, activity }),
        shortText: activity,
        conversationId: activeStatus.conversationId,
        deepLink: `islemind://chat/${activeStatus.conversationId}`,
        indeterminate: true,
        ongoing: true,
        requestPromotedOngoing: true,
      })
      return
    }

    const previous = tracked.current
    if (!previous) return
    const conversation = conversations.find((item) => item.id === previous.conversationId)
    const completedMessage = conversation?.messages.find((item) => item.id === previous.messageId)
    if (!completedMessage) {
      tracked.current = null
      void notificationDispatcher.clear()
      return
    }
    if (completedMessage.status === 'sending' || completedMessage.status === 'streaming') return

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
      ? t('chat.systemStatusErrorMessage', { conversation: previous.title, preview })
      : terminal === 'cancelled'
        ? t('chat.systemStatusStoppedMessage', { conversation: previous.title, preview })
        : t('chat.systemStatusCompletedMessage', { conversation: previous.title, preview })

    void notificationDispatcher.update({
      state: terminal === 'error' ? 'error' : 'completed',
      title: statusTitle,
      message,
      shortText: preview,
      conversationId: previous.conversationId,
      deepLink: `islemind://chat/${previous.conversationId}`,
      indeterminate: false,
      ongoing: false,
      requestPromotedOngoing: false,
    })
    tracked.current = null
    clearTimer.current = setTimeout(() => {
      clearTimer.current = null
      void notificationDispatcher.clear()
    }, SYSTEM_STATUS_NOTIFICATION_CLEAR_DELAY_MS)
  }, [activeStatus, conversations, notificationDispatcher, t])

  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current)
  }, [])

  return null
}
