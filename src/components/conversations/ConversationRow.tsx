import { Text, TextInput, View } from 'react-native'
import { useState } from 'react'
import { router } from 'expo-router'
import { Trash2 } from 'lucide-react-native'
import { MotiView } from 'moti'
import type { Conversation } from '@/types'
import { getModelName } from '@/types'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { PressableScale } from '@/components/ui/PressableScale'
import { IslandPanel } from '@/components/ui/IslandPanel'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { useIslandDialog } from '@/components/ui/IslandDialog'

interface ConversationRowProps {
  conversation: Conversation
  index: number
}

export function ConversationRow({ conversation, index }: ConversationRowProps) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const remove = useChatStore((state) => state.delete)
  const rename = useChatStore((state) => state.rename)
  const select = useChatStore((state) => state.select)
  const dialog = useIslandDialog()
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(conversation.title)
  const lastMessage = conversation.messages.at(-1)

  function confirmDelete() {
    void dialog.confirm({
      title: '删除对话',
      message: '这个操作不会删除 API Key，但会移除本地对话记录。',
      tone: 'danger',
      confirmLabel: '删除',
      cancelLabel: '取消',
    }).then((confirmed) => {
      if (confirmed) remove(conversation.id)
    })
  }

  function submitRename() {
    const value = title.trim()
    rename(conversation.id, value || '未命名对话')
    setRenaming(false)
  }

  return (
    <MotiView
      from={motion === 'full' ? { opacity: 0, translateY: 16 } : { opacity: 0 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle, delay: Math.min(index * 35, 280) } : { type: 'timing', duration: motionTokens.duration.fast }}
    >
      <PressableScale
        haptic
        onPress={() => {
          select(conversation.id)
          router.replace({ pathname: '/chat/[id]', params: { id: conversation.id } })
        }}
        onLongPress={() => setRenaming(true)}
        style={{ marginBottom: 12 }}
      >
        <IslandPanel elevated material="paper" radius={28} contentStyle={{ minHeight: 92, padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1 }}>
            {renaming ? (
              <TextInput
                autoFocus
                value={title}
                onChangeText={setTitle}
                onBlur={submitRename}
                onSubmitEditing={submitRename}
                style={{ color: colors.text, fontSize: 17, fontWeight: '900', padding: 0 }}
              />
            ) : (
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 17, fontWeight: '900' }}>
                {conversation.title || '未命名对话'}
              </Text>
            )}
            <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 13, marginTop: 6, fontWeight: '700' }}>
              {lastMessage?.content || '还没有消息'}
            </Text>
            <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 10, fontWeight: '900' }}>{getModelName(conversation.model)}</Text>
          </View>
          <PressableScale
            onPress={confirmDelete}
            accessibilityLabel="删除对话"
            hitSlop={10}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.coralWash }}
          >
            <Trash2 color={colors.textTertiary} size={18} strokeWidth={1.8} />
          </PressableScale>
        </View>
        </IslandPanel>
      </PressableScale>
    </MotiView>
  )
}
