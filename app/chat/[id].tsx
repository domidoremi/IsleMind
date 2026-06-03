import { useEffect } from 'react'
import { Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { MessageCircle } from 'lucide-react-native'
import { ChatWorkspace } from '@/components/chat/ChatWorkspace'
import { AnimatedNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { IsleEmptyState } from '@/components/ui/isle'
import { IsleHeader } from '@/components/ui/isle'
import { IsleScreen } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'

export default function ConversationDeepLinkScreen() {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const conversations = useChatStore((state) => state.conversations)
  const select = useChatStore((state) => state.select)
  const conversation = conversations.find((item) => item.id === id) ?? null

  useEffect(() => {
    if (conversation) select(conversation.id)
  }, [conversation, select])

  if (conversation) {
    return <ChatWorkspace conversation={conversation} showBack />
  }

  return (
    <IsleScreen padded={false} background="focus">
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 }}>
        <IsleHeader
          title={t('conversation.unavailable')}
          subtitle={id || t('conversation.missingId')}
          leading={
            <AnimatedNavigationTrigger variant="iconButton" label={t('common.back')} glyph="back" onNavigate={() => router.back()} color={colors.text} />
          }
        />
      </View>
      <View style={{ flex: 1, paddingHorizontal: 20, justifyContent: 'center' }}>
        <IsleEmptyState
          title={t('conversation.notFound')}
          actionLabel={t('conversation.viewHistory')}
          actionGlyph="history"
          onAction={() => router.push('/conversations')}
        />
        <View style={{ alignItems: 'center', marginTop: 12 }}>
          <MessageCircle color={colors.textTertiary} size={22} strokeWidth={1.8} />
        </View>
      </View>
    </IsleScreen>
  )
}
