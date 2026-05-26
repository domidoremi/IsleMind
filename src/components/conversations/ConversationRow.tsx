import { Text, TextInput, View } from 'react-native'
import { useState } from 'react'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react-native'
import { MotiView } from 'moti'
import type { Conversation } from '@/types'
import { getModelName } from '@/types'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { IslePressable } from '@/components/ui/isle'
import { IslePanel } from '@/components/ui/isle'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { useIsleDialog } from '@/components/ui/isle'

interface ConversationRowProps {
  conversation: Conversation
  index: number
  onOpen?: (conversationId: string) => void
  onRenameFocus?: () => void
}

export function ConversationRow({ conversation, index, onOpen, onRenameFocus }: ConversationRowProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const remove = useChatStore((state) => state.delete)
  const rename = useChatStore((state) => state.rename)
  const select = useChatStore((state) => state.select)
  const dialog = useIsleDialog()
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(conversation.title)
  const lastMessage = conversation.messages.at(-1)

  function confirmDelete() {
    void dialog.confirm({
      title: t('conversation.deleteTitle'),
      message: t('conversation.deleteConfirm'),
      tone: 'danger',
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    }).then((confirmed) => {
      if (confirmed) remove(conversation.id)
    })
  }

  function submitRename() {
    const value = title.trim()
    rename(conversation.id, value || t('conversation.untitled'))
    setRenaming(false)
  }

  return (
    <MotiView
      from={motion === 'full' ? { opacity: 0, translateY: 16 } : { opacity: 0 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle, delay: Math.min(index * 35, 280) } : { type: 'timing', duration: motionTokens.duration.fast }}
    >
      <IslePressable
        haptic
        onPress={() => {
          select(conversation.id)
          if (onOpen) {
            onOpen(conversation.id)
          } else {
            router.push({ pathname: '/chat/[id]', params: { id: conversation.id } })
          }
        }}
        onLongPress={() => setRenaming(true)}
        style={{ marginBottom: 12 }}
      >
        <IslePanel elevated material="paper" radius={28} contentStyle={{ minHeight: 92, padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1 }}>
            {renaming ? (
              <TextInput
                autoFocus
                value={title}
                onChangeText={setTitle}
                onBlur={submitRename}
                onSubmitEditing={submitRename}
                onFocus={onRenameFocus}
                accessibilityLabel={t('conversation.rename')}
                returnKeyType="done"
                blurOnSubmit
                style={{
                  color: colors.text,
                  fontSize: 17,
                  fontWeight: '900',
                  minHeight: 48,
                  paddingHorizontal: 0,
                  paddingVertical: 8,
                  textAlignVertical: 'center',
                }}
              />
            ) : (
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 17, fontWeight: '900' }}>
                {conversation.title || t('conversation.untitled')}
              </Text>
            )}
            <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 13, marginTop: 6, fontWeight: '700' }}>
              {lastMessage?.content || t('conversation.noMessagesYet')}
            </Text>
            <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 10, fontWeight: '900' }}>{getModelName(conversation.model)}</Text>
          </View>
          <IslePressable
            onPress={confirmDelete}
            accessibilityLabel={t('conversation.deleteTitle')}
            hitSlop={10}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.coralWash }}
          >
            <Trash2 color={colors.textTertiary} size={18} strokeWidth={1.8} />
          </IslePressable>
        </View>
        </IslePanel>
      </IslePressable>
    </MotiView>
  )
}
