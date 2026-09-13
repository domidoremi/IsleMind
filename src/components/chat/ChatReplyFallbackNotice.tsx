import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { IsleButton, useIsleDialog } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { Conversation } from '@/types/chatContracts'
import { projectReplyFallback, type ReplyPreferenceSnapshot } from './chatReplyFallback'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'

/** Inline in the message list, not another absolute overlay above the composer. */
export function ChatReplyFallbackNotice({ conversation }: { conversation: Conversation }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const providers = useSettingsStore((state) => state.providers)
  const [snapshot, setSnapshot] = useState<ReplyPreferenceSnapshot>()
  const streaming = conversation.messages.findLast((item) => item.role === 'assistant' && item.status === 'streaming')
  useEffect(() => {
    if (!streaming || !conversation.providerId || !conversation.model) return
    setSnapshot((previous) => previous?.responseMessageId === streaming.id && previous.conversationId === conversation.id ? previous : {
      conversationId: conversation.id, responseMessageId: streaming.id,
      userMessageId: conversation.messages.findLast((item) => item.role === 'user')?.id,
      providerId: conversation.providerId!, model: conversation.model!,
    })
  }, [conversation.id, conversation.providerId, conversation.model, streaming?.id])
  const fallback = projectReplyFallback(snapshot, conversation, providers)
  if (!fallback) return null
  const label = (target: { providerId: string; model: string }) => {
    const provider = providers.find((item) => item.id === target.providerId)
    return `${provider ? resolveProviderDisplayName(provider, t('providerSettings.customProvider')) : target.providerId} · ${target.model}`
  }
  return <View testID="chat-reply-fallback" accessibilityLiveRegion="polite" style={{ padding: 12, gap: 6, borderRadius: colors.ui.radius.panel, backgroundColor: colors.ui.semantic.surface.muted }}>
    <Text style={{ color: colors.text, fontWeight: '700' }}>{t('modelAvailability.usingFallback')}</Text>
    <Text style={{ color: colors.textSecondary }}>{t('modelAvailability.preferredTarget', { target: label(fallback.preferred) })}</Text>
    <Text style={{ color: colors.textSecondary }}>{t('modelAvailability.actualTarget', { target: label(fallback.actual) })}</Text>
    <Text style={{ color: colors.textTertiary }}>{t('modelAvailability.temporaryFallbackReason')}</Text>
    {!fallback.streaming ? <IsleButton compact label={t('modelAvailability.adoptFallback')} onPress={() => {
      if (!useChatStore.getState().switchConversationModel(conversation.id, fallback.actual.providerId, fallback.actual.model)) {
        dialog.toast({ title: t('modelAvailability.selectionFailed'), tone: 'amber' })
      }
    }} /> : null}
  </View>
}
