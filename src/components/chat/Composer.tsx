import { useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Platform, Text, TextInput, View } from 'react-native'
import { Camera, ChevronDown, FilePlus, Image, Plus, SendHorizontal, Square } from 'lucide-react-native'
import { MotiView } from 'moti'
import type { Attachment } from '@/types'
import { pickDocument, pickImage, takePhoto } from '@/services/attachment'
import { useAppTheme } from '@/hooks/useAppTheme'
import { PressableScale } from '@/components/ui/PressableScale'
import { IslandPanel } from '@/components/ui/IslandPanel'
import { useIslandDialog } from '@/components/ui/IslandDialog'

interface ComposerProps {
  disabled?: boolean
  streaming?: boolean
  activityLabel?: string
  pendingNotice?: string
  onClearPending?: () => void
  onStop?: () => void
  onSend: (content: string, attachments: Attachment[]) => Promise<void> | void
  onSendWhileStreaming?: (content: string, attachments: Attachment[]) => Promise<void> | void
}

export function Composer({ disabled = false, streaming = false, activityLabel, pendingNotice, onClearPending, onStop, onSend, onSendWhileStreaming }: ComposerProps) {
  const { colors } = useAppTheme()
  const dialog = useIslandDialog()
  const [content, setContent] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [sending, setSending] = useState(false)
  const canSend = (!!content.trim() || attachments.length > 0) && !disabled && !sending

  async function addAttachment(picker: () => Promise<Attachment | null>) {
    try {
      const attachment = await picker()
      if (attachment) setAttachments((items) => [...items, attachment])
    } catch (error) {
      dialog.toast({
        title: '附件不可用',
        message: error instanceof Error && error.message === 'error.fileTooLarge' ? '文件不能超过 20MB。' : '无法读取这个附件，请换一个文件试试。',
        tone: 'danger',
      })
    }
  }

  async function submit() {
    if (!canSend) return
    const text = content
    const files = attachments
    setSending(true)
    setContent('')
    setAttachments([])
    try {
      if (streaming && onSendWhileStreaming) {
        await onSendWhileStreaming(text, files)
      } else {
        await onSend(text, files)
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <MotiView
      animate={{ scale: focused ? 1.01 : 1, translateY: focused ? -1 : 0 }}
      transition={{ type: 'spring', damping: 18, stiffness: 180 }}
      style={{
        shadowColor: colors.shadowTint,
        shadowRadius: focused ? 22 : 14,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: focused ? 0.16 : 0.1,
        elevation: focused ? 5 : 3,
        backgroundColor: 'transparent',
      }}
    >
      <IslandPanel material="chrome" elevated={false} radius={26} style={{ borderColor: focused ? colors.borderStrong : colors.border, backgroundColor: colors.material.chrome }}>
      {attachments.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 10 }}>
          {attachments.map((item) => (
            <PressableScale
              key={item.id}
              onPress={() => setAttachments((files) => files.filter((file) => file.id !== item.id))}
              accessibilityLabel={`移除附件 ${item.name}`}
              style={{ paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: colors.islandRaised, justifyContent: 'center' }}
            >
              <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700', maxWidth: 180 }}>
                {item.name}
              </Text>
            </PressableScale>
          ))}
        </View>
      ) : null}
      {attachmentsOpen ? (
        <MotiView
          from={{ opacity: 0, translateY: -4 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 200 }}
          style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 10 }}
        >
          <AttachmentChip label="图片" onPress={() => addAttachment(pickImage)}>
            <Image color={colors.textSecondary} size={15} strokeWidth={1.8} />
          </AttachmentChip>
          <AttachmentChip label="拍照" onPress={() => addAttachment(takePhoto)}>
            <Camera color={colors.textSecondary} size={15} strokeWidth={1.8} />
          </AttachmentChip>
          <AttachmentChip label="文件" onPress={() => addAttachment(pickDocument)}>
            <FilePlus color={colors.textSecondary} size={15} strokeWidth={1.8} />
          </AttachmentChip>
        </MotiView>
      ) : null}
      {pendingNotice ? (
        <PressableScale
          haptic
          onPress={onClearPending}
          accessibilityLabel="清除待发送内容"
          style={{
            marginHorizontal: 10,
            marginTop: 10,
            minHeight: 30,
            borderRadius: 15,
            paddingHorizontal: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.amberSoft,
          }}
        >
          <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>
            {pendingNotice}
          </Text>
        </PressableScale>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', padding: 7, paddingTop: 7, gap: 6 }}>
        <PressableScale
          haptic
          onPress={() => setAttachmentsOpen((value) => !value)}
          accessibilityLabel={attachmentsOpen ? '收起附件' : '展开附件'}
          style={{
            width: 38,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 18,
            backgroundColor: attachmentsOpen ? colors.amberSoft : colors.islandRaised,
          }}
        >
          {attachmentsOpen ? <ChevronDown color={colors.textSecondary} size={16} strokeWidth={2} /> : <Plus color={colors.textSecondary} size={16} strokeWidth={2} />}
        </PressableScale>
        <View style={{ flex: 1, minHeight: 40, justifyContent: 'center' }}>
          {streaming ? <StreamingStatusInline label={activityLabel || '生成中'} /> : null}
          <TextInput
            value={content}
            onChangeText={setContent}
            multiline
            editable={!disabled}
            accessibilityLabel="输入消息"
            returnKeyType="send"
            submitBehavior={Platform.OS === 'ios' ? 'newline' : 'submit'}
            onSubmitEditing={() => {
              if (Platform.OS === 'android') {
                void submit()
              }
            }}
            maxLength={12000}
            placeholder={streaming ? '继续输入...' : '问点什么...'}
            placeholderTextColor={colors.textTertiary}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{
              flex: 1,
              width: '100%',
              minHeight: streaming ? 28 : 40,
              maxHeight: 120,
              color: colors.text,
              fontSize: 15,
              lineHeight: 22,
              paddingTop: streaming ? 2 : 8,
              paddingBottom: 7,
              textAlignVertical: 'top',
            }}
          />
        </View>
        {streaming ? (
          <PressableScale
            haptic
            onPress={onStop}
            accessibilityLabel="停止生成"
            hitSlop={{ top: 12, right: 8, bottom: 12, left: 8 }}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.error,
            }}
          >
            <Square color={colors.surface} size={14} strokeWidth={2.4} fill={colors.surface} />
          </PressableScale>
        ) : null}
        <PressableScale
          haptic
          disabled={!canSend}
          onPress={submit}
          accessibilityLabel={streaming ? '继续输入' : '发送消息'}
          hitSlop={{ top: 12, right: 10, bottom: 12, left: 10 }}
          style={{
            minWidth: 52,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 7,
            paddingHorizontal: 0,
            backgroundColor: canSend ? colors.text : colors.islandRaised,
            opacity: canSend ? 1 : 0.55,
          }}
        >
          {sending ? (
            <ActivityIndicator color={colors.surface} size="small" />
          ) : (
            <SendHorizontal color={colors.surface} size={19} strokeWidth={2} />
          )}
        </PressableScale>
      </View>
      </IslandPanel>
    </MotiView>
  )
}

function StreamingStatusInline({ label }: { label: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2, paddingTop: 2 }}>
      <MotiView
        from={{ opacity: 0.35, scale: 0.84 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ loop: true, type: 'timing', duration: 760 }}
        style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }}
      />
      <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '800', flexShrink: 1 }}>
        {label}
      </Text>
    </View>
  )
}

interface IconButtonProps {
  label: string
  children: ReactNode
  onPress: () => void
}

function AttachmentChip({ label, children, onPress }: IconButtonProps) {
  const { colors } = useAppTheme()
  return (
    <PressableScale
      haptic
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={8}
      style={{
        minHeight: 34,
        paddingHorizontal: 11,
        borderRadius: 17,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.islandRaised,
      }}
    >
      {children}
      <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '800' }}>{label}</Text>
    </PressableScale>
  )
}
