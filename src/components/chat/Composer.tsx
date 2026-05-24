import { useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Platform, Text, TextInput, View } from 'react-native'
import { AtSign, Camera, ChevronDown, FilePlus, Image, Mic, Plus, SendHorizontal, Slash, Square } from 'lucide-react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import type { Attachment, CommandReference } from '@/types'
import { pickDocument, pickImage, takePhoto } from '@/services/attachment'
import { useAppTheme } from '@/hooks/useAppTheme'
import { IslePressable } from '@/components/ui/isle'
import { IslePanel } from '@/components/ui/isle'
import { useIsleDialog } from '@/components/ui/isle'
import { getAudioRecorderHook, isAudioRecordingAvailable, requestMicrophonePermission, transcribeLocalAudio } from '@/services/speech'
import { normalizeSearchText } from '@/utils/text'

export interface ComposerCommand {
  id: string
  label: string
  description?: string
  insertText?: string
  run?: () => void
}

interface ComposerProps {
  disabled?: boolean
  streaming?: boolean
  activityLabel?: string
  pendingNotice?: string
  commands?: ComposerCommand[]
  references?: CommandReference[]
  utilitiesOpen?: boolean
  showInlineUtilities?: boolean
  onClearPending?: () => void
  onStop?: () => void
  onReferenceSelected?: (reference: CommandReference) => void
  onFocus?: () => void
  onOpenKnowledge?: () => void
  onInsertPromptTemplate?: () => void
  onSend: (content: string, attachments: Attachment[]) => Promise<void> | void
  onSendWhileStreaming?: (content: string, attachments: Attachment[]) => Promise<void> | void
}

export function Composer({
  disabled = false,
  streaming = false,
  activityLabel,
  pendingNotice,
  commands = [],
  references = [],
  utilitiesOpen = false,
  showInlineUtilities = true,
  onClearPending,
  onStop,
  onReferenceSelected,
  onFocus,
  onOpenKnowledge,
  onInsertPromptTemplate,
  onSend,
  onSendWhileStreaming,
}: ComposerProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const [content, setContent] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [focused, setFocused] = useState(false)
  const [sending, setSending] = useState(false)
  const useAudioRecorder = getAudioRecorderHook()
  const recorder = useAudioRecorder ? useAudioRecorder({ extension: '.m4a' }) : null
  const canSend = (!!content.trim() || attachments.length > 0) && !disabled && !sending
  const trigger = getActiveTrigger(content)
  const commandMatches = trigger?.type === 'command' ? filterCommands(commands, trigger.query).slice(0, 6) : []
  const referenceMatches = trigger?.type === 'reference' ? filterReferences(references, trigger.query).slice(0, 8) : []
  const showCommandPanel = !!trigger && (commandMatches.length > 0 || referenceMatches.length > 0 || trigger.query.length === 0)
  const isMultilineDraft = content.includes('\n') || content.length > 70

  async function addAttachment(picker: () => Promise<Attachment | null>) {
    try {
      const attachment = await picker()
      if (attachment) setAttachments((items) => [...items, attachment])
    } catch (error) {
      dialog.toast({
        title: t('chat.attachmentUnavailable'),
        message: error instanceof Error && error.message === 'error.fileTooLarge' ? t('chat.fileTooLarge20') : t('chat.attachmentReadFailed'),
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

  function replaceActiveToken(next: string) {
    if (!trigger) return
    const before = content.slice(0, trigger.start)
    const after = content.slice(trigger.end)
    const spacer = next && after && !/^\s/.test(after) ? ' ' : ''
    setContent(`${before}${next}${spacer}${after}`.replace(/[ \t]+\n/g, '\n'))
  }

  function applyCommand(command: ComposerCommand) {
    if (command.run) {
      command.run()
      replaceActiveToken('')
      return
    }
    replaceActiveToken(command.insertText ?? '')
  }

  function applyReference(reference: CommandReference) {
    onReferenceSelected?.(reference)
    replaceActiveToken(`@${reference.label}`)
  }

  async function toggleRecording() {
    if (!isAudioRecordingAvailable() || !recorder) {
      dialog.toast({ title: t('chat.voiceUnavailable'), message: t('chat.voiceUnavailableMessage'), tone: 'amber' })
      return
    }
    try {
      if (!recording) {
        const granted = await requestMicrophonePermission()
        if (!granted) {
          dialog.toast({ title: t('chat.recordingUnavailable'), message: t('chat.microphonePermissionMissing'), tone: 'danger' })
          return
        }
        await recorder.prepareToRecordAsync()
        recorder.record()
        setRecording(true)
        return
      }
      await recorder.stop()
      setRecording(false)
      const uri = recorder.uri
      if (!uri) return
      dialog.toast({ title: t('chat.transcribing'), message: t('chat.transcribingMessage'), tone: 'mint' })
      const text = await transcribeLocalAudio(uri)
      if (text.trim()) {
        setContent((value) => [value, text.trim()].filter(Boolean).join(value.trim() ? '\n' : ''))
      }
    } catch (error) {
      setRecording(false)
      dialog.toast({ title: t('chat.voiceFailed'), message: error instanceof Error ? error.message : t('chat.voiceFailedMessage'), tone: 'danger' })
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
      <IslePanel material="chrome" elevated={false} radius={26} style={{ borderColor: focused ? colors.borderStrong : colors.border, backgroundColor: colors.material.chrome }}>
      {attachments.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 10 }}>
          {attachments.map((item) => (
            <IslePressable
              key={item.id}
              onPress={() => setAttachments((files) => files.filter((file) => file.id !== item.id))}
              accessibilityLabel={t('chat.removeAttachment', { name: item.name })}
              style={{ paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: colors.islandRaised, justifyContent: 'center' }}
            >
              <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700', maxWidth: 180 }}>
                {item.name}
              </Text>
            </IslePressable>
          ))}
        </View>
      ) : null}
      {(attachmentsOpen || utilitiesOpen) ? (
        <MotiView
          from={{ opacity: 0, translateY: -4 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 200 }}
          style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 10, flexWrap: 'wrap' }}
        >
          <AttachmentChip label={t('chat.attachImage')} onPress={() => addAttachment(pickImage)}>
            <Image color={colors.textSecondary} size={15} strokeWidth={1.8} />
          </AttachmentChip>
          <AttachmentChip label={t('chat.attachCamera')} onPress={() => addAttachment(takePhoto)}>
            <Camera color={colors.textSecondary} size={15} strokeWidth={1.8} />
          </AttachmentChip>
          <AttachmentChip label={t('chat.attachFile')} onPress={() => addAttachment(pickDocument)}>
            <FilePlus color={colors.textSecondary} size={15} strokeWidth={1.8} />
          </AttachmentChip>
          <AttachmentChip label={recording ? t('chat.stopRecording') : t('chat.voiceInput')} onPress={() => void toggleRecording()}>
            <Mic color={recording ? colors.error : colors.textSecondary} size={15} strokeWidth={1.8} />
          </AttachmentChip>
          <AttachmentChip label={t('chat.openCommandPanel')} onPress={() => setContent((value) => value.trim() ? `${value} /` : '/')}>
            <Slash color={colors.textSecondary} size={15} strokeWidth={1.8} />
          </AttachmentChip>
          {onInsertPromptTemplate ? (
            <AttachmentChip label={t('chat.commandPromptTemplate')} onPress={onInsertPromptTemplate}>
              <Plus color={colors.textSecondary} size={15} strokeWidth={1.8} />
            </AttachmentChip>
          ) : null}
          {onOpenKnowledge ? (
            <AttachmentChip label={t('chat.importKnowledge')} onPress={onOpenKnowledge}>
              <FilePlus color={colors.textSecondary} size={15} strokeWidth={1.8} />
            </AttachmentChip>
          ) : null}
        </MotiView>
      ) : null}
      {pendingNotice ? (
        <IslePressable
          haptic
          onPress={onClearPending}
          accessibilityLabel={t('chat.clearPending')}
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
        </IslePressable>
      ) : null}
      {showCommandPanel ? (
        <MotiView
          from={{ opacity: 0, translateY: 5 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 210 }}
          style={{ paddingHorizontal: 10, paddingTop: 10 }}
        >
          <View style={{ borderRadius: 22, padding: 8, backgroundColor: colors.material.paperRaised, borderWidth: 1, borderColor: colors.border, gap: 6 }}>
            {commandMatches.map((command) => (
              <ComposerPickRow
                key={command.id}
                title={command.label}
                description={command.description}
                icon={<Slash color={colors.primary} size={14} strokeWidth={2.2} />}
                onPress={() => applyCommand(command)}
              />
            ))}
            {referenceMatches.map((reference) => (
              <ComposerPickRow
                key={`${reference.type}-${reference.id}`}
                title={reference.label}
                description={referenceDescription(reference, t)}
                icon={<AtSign color={colors.primary} size={14} strokeWidth={2.2} />}
                onPress={() => applyReference(reference)}
              />
            ))}
            {!commandMatches.length && !referenceMatches.length ? (
              <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 6 }}>
                {trigger?.type === 'command' ? t('chat.noCommandMatches') : t('chat.noReferenceMatches')}
              </Text>
            ) : null}
          </View>
        </MotiView>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 7, paddingTop: 7, gap: 6 }}>
        {showInlineUtilities ? (
          <>
            <IslePressable
              haptic
              onPress={() => setAttachmentsOpen((value) => !value)}
              accessibilityLabel={attachmentsOpen ? t('chat.collapseAttachments') : t('chat.expandAttachments')}
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
            </IslePressable>
            <IslePressable
              haptic
              onPress={() => void toggleRecording()}
              accessibilityLabel={recording ? t('chat.stopRecording') : t('chat.voiceInput')}
              style={{
                width: 38,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 18,
                backgroundColor: recording ? colors.error : colors.islandRaised,
              }}
            >
              <Mic color={recording ? colors.surface : colors.textSecondary} size={16} strokeWidth={2} />
            </IslePressable>
          </>
        ) : null}
        <View style={{ flex: 1, minHeight: 42, justifyContent: 'center' }}>
          {streaming ? <StreamingStatusInline label={activityLabel || t('chat.generating')} /> : null}
          <TextInput
            value={content}
            onChangeText={setContent}
            multiline
            editable={!disabled}
            accessibilityLabel={t('chat.inputAccessibility')}
            returnKeyType="send"
            submitBehavior={Platform.OS === 'ios' ? 'newline' : 'submit'}
            onSubmitEditing={() => {
              if (Platform.OS === 'android') {
                void submit()
              }
            }}
            maxLength={12000}
            placeholder={streaming ? t('chat.keepTyping') : t('chat.askAnything')}
            placeholderTextColor={colors.textTertiary}
            onFocus={() => {
              setFocused(true)
              onFocus?.()
            }}
            onBlur={() => setFocused(false)}
            style={{
              flex: 1,
              width: '100%',
              minHeight: streaming ? 30 : 42,
              maxHeight: 120,
              color: colors.text,
              fontSize: 15,
              lineHeight: 22,
              paddingTop: isMultilineDraft ? 8 : 0,
              paddingBottom: isMultilineDraft ? 8 : 0,
              paddingHorizontal: 0,
              textAlignVertical: isMultilineDraft ? 'top' : 'center',
            }}
          />
        </View>
        {streaming ? (
          <IslePressable
            haptic
            onPress={onStop}
            accessibilityLabel={t('chat.stopGenerating')}
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
          </IslePressable>
        ) : null}
        <IslePressable
          haptic
          disabled={!canSend}
          onPress={submit}
          accessibilityLabel={streaming ? t('chat.keepTypingAction') : t('chat.sendMessage')}
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
            backgroundColor: canSend ? colors.primary : colors.material.field,
            borderWidth: canSend ? 0 : 1,
            borderColor: colors.borderStrong,
            opacity: disabled ? 0.72 : 1,
          }}
        >
          {sending ? (
            <ActivityIndicator color={colors.primaryForeground} size="small" />
          ) : (
            <SendHorizontal color={canSend ? colors.primaryForeground : colors.textSecondary} size={19} strokeWidth={2.35} />
          )}
        </IslePressable>
      </View>
      </IslePanel>
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

function ComposerPickRow({
  title,
  description,
  icon,
  onPress,
}: {
  title: string
  description?: string
  icon: ReactNode
  onPress: () => void
}) {
  const { colors } = useAppTheme()
  return (
    <IslePressable
      haptic
      onPress={onPress}
      style={{ minHeight: 42, borderRadius: 17, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.islandRaised }}
    >
      <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintSoft }}>
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '900' }}>
          {title}
        </Text>
        {description ? (
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800', marginTop: 1 }}>
            {description}
          </Text>
        ) : null}
      </View>
    </IslePressable>
  )
}

function filterCommands(commands: ComposerCommand[], query: string): ComposerCommand[] {
  const needle = normalizeSearchText(query)
  if (!needle) return commands
  return commands.filter((command) => normalizeSearchText(`${command.label} ${command.description ?? ''}`).includes(needle))
}

function filterReferences(references: CommandReference[], query: string): CommandReference[] {
  const needle = normalizeSearchText(query)
  if (!needle) return references
  return references.filter((reference) => normalizeSearchText(`${reference.label} ${reference.value} ${reference.type}`).includes(needle))
}

function getActiveTrigger(value: string): { type: 'command' | 'reference'; query: string; start: number; end: number } | null {
  const match = value.match(/(^|\s)([/@])([^\s/@]*)$/)
  if (!match || match.index === undefined) return null
  const token = match[0]
  const prefixLength = /^\s/.test(token) ? 1 : 0
  return {
    type: match[2] === '/' ? 'command' : 'reference',
    query: match[3] ?? '',
    start: match.index + prefixLength,
    end: value.length,
  }
}

function referenceDescription(reference: CommandReference, t: (key: string) => string): string {
  switch (reference.type) {
    case 'skill':
      return 'Skill'
    case 'provider':
      return t('settings.providerManagement')
    case 'model':
      return String(reference.metadata?.providerName ?? t('chat.model'))
    case 'knowledge':
      return t('settings.knowledge')
    case 'memory':
      return t('settings.memory')
  }
}

interface IconButtonProps {
  label: string
  children: ReactNode
  onPress: () => void
}

function AttachmentChip({ label, children, onPress }: IconButtonProps) {
  const { colors } = useAppTheme()
  return (
    <IslePressable
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
    </IslePressable>
  )
}
