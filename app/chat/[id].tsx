import { useEffect } from 'react'
import { Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { ArrowLeft, MessageCircle } from 'lucide-react-native'
import { ChatWorkspace } from '@/components/chat/ChatWorkspace'
import { EmptyState } from '@/components/ui/EmptyState'
import { IslandHeader, IslandIconButton } from '@/components/ui/IslandPrimitives'
import { Screen } from '@/components/ui/Screen'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'

export default function ConversationDeepLinkScreen() {
  const { colors } = useAppTheme()
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
    <Screen padded={false}>
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 }}>
        <IslandHeader
          title="会话不可用"
          subtitle={id || '缺少会话 ID'}
          leading={
            <IslandIconButton label="返回" onPress={() => router.back()}>
              <ArrowLeft color={colors.text} size={19} strokeWidth={2} />
            </IslandIconButton>
          }
        />
      </View>
      <View style={{ flex: 1, paddingHorizontal: 20, justifyContent: 'center' }}>
        <EmptyState
          title="找不到这个会话"
          description="这个链接指向的本地会话不存在，可能已删除、未导入，或链接来自另一台设备。"
          actionLabel="查看历史对话"
          onAction={() => router.replace('/conversations')}
        />
        <View style={{ alignItems: 'center', marginTop: 12 }}>
          <MessageCircle color={colors.textTertiary} size={22} strokeWidth={1.8} />
        </View>
      </View>
    </Screen>
  )
}
