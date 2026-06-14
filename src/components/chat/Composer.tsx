import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Platform, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { AtSign, Camera, ChevronDown, FilePlus, Image, Mic, Plus, SendHorizontal, Slash } from 'lucide-react-native'
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
  pendingNotice?: string
  initialDraft?: string
  initialDraftKey?: string | number
  initialAttachments?: Attachment[]
  restoreInitialDraftIfEmpty?: boolean
  commands?: ComposerCommand[]
  references?: CommandReference[]
  utilitiesOpen?: boolean
  showInlineUtilities?: boolean
  leadingAccessory?: ReactNode
  onClearPending?: () => void
  onReferenceSelected?: (reference: CommandReference) => void
  onFocus?: () => void
  onBlur?: () => void
  onOpenKnowledge?: () => void
  onSend: (content: string, attachments: Attachment[]) => Promise<void> | void
  onSendWhileStreaming?: (content: string, attachments: Attachment[]) => Promise<void> | void
}

const COMPOSER_CONTROL_HIT_SLOP = { top: 8, right: 8, bottom: 8, left: 8 }
const COMPOSER_PILL_HIT_SLOP = { top: 10, right: 8, bottom: 10, left: 8 }
const COMPOSER_MAX_LENGTH = 12000

export function Composer({
  disabled = false,
  streaming = false,
  pendingNotice,
  initialDraft,
  initialDraftKey,
  initialAttachments,
  restoreInitialDraftIfEmpty = false,
  commands = [],
  references = [],
  utilitiesOpen = false,
  showInlineUtilities = true,
  leadingAccessory,
  onClearPending,
  onReferenceSelected,
  onFocus,
  onBlur,
  onOpenKnowledge,
  onSend,
  onSendWhileStreaming,
}: ComposerProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const { width: composerWindowWidth } = useWindowDimensions()
  const [content, setContent] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [focused, setFocused] = useState(false)
  const [sending, setSending] = useState(false)
  const [consumedDraftKey, setConsumedDraftKey] = useState<string | number | undefined>(undefined)
  const useAudioRecorder = getAudioRecorderHook()
  const recorder = useAudioRecorder ? useAudioRecorder({ extension: '.m4a' }) : null
  const draftCharacterCount = content.length
  const draftOverLimit = draftCharacterCount > COMPOSER_MAX_LENGTH
  const draftExcessCharacters = Math.max(0, draftCharacterCount - COMPOSER_MAX_LENGTH)
  const hasSendableDraft = !!content.trim() || attachments.length > 0
  const canSend = hasSendableDraft && !disabled && !sending && !draftOverLimit
  const draftStatusVisible = draftOverLimit
  const draftStatusLabel = attachments.length > 0
    ? t('chat.composerDraftStatusWithAttachments', {
      count: draftCharacterCount,
      limit: COMPOSER_MAX_LENGTH,
      attachments: attachments.length,
    })
    : t('chat.composerDraftStatus', {
      count: draftCharacterCount,
      limit: COMPOSER_MAX_LENGTH,
    })
  const draftWarningLabel = draftOverLimit ? t('chat.composerDraftExceeded', { count: draftExcessCharacters }) : ''
  const draftAccessibilityValue = draftStatusVisible
    ? { text: draftWarningLabel ? `${draftStatusLabel}. ${draftWarningLabel}` : draftStatusLabel }
    : undefined
  const sendButtonAccessibilityHint = sending
    ? t('chat.sendingAccessibilityHint')
    : disabled
      ? t('chat.sendMessageUnavailableAccessibilityHint')
      : !hasSendableDraft
        ? t('chat.sendMessageEmptyAccessibilityHint')
        : streaming
          ? t('chat.keepTypingAccessibilityHint')
          : t('chat.sendMessageAccessibilityHint')
  const trigger = getActiveTrigger(content)
  const commandMatches = trigger?.type === 'command' ? filterCommands(commands, trigger.query).slice(0, 6) : []
  const referenceMatches = trigger?.type === 'reference' ? filterReferences(references, trigger.query).slice(0, 8) : []
  const showCommandPanel = !!trigger && (commandMatches.length > 0 || referenceMatches.length > 0 || trigger.query.length === 0)
  const isMultilineDraft = content.includes('\n') || content.length > 70
  const panelRadius = colors.ui.radius.panel
  const fieldRadius = colors.ui.radius.field
  const chipRadius = colors.ui.radius.chip
  const compactControlRadius = colors.ui.radius.controlMiddle
  const largeControlRadius = colors.ui.radius.controlLarge
  const raisedSurface = colors.ui.card.defaultBackground
  const raisedBorder = colors.material.stroke
  const compactComposer = composerWindowWidth < 390
  const attachmentLabelMaxWidth = Math.max(108, Math.min(compactComposer ? 132 : 180, composerWindowWidth * 0.42))
  const utilityControlWidth = compactComposer ? 36 : 38
  const sendButtonMinWidth = compactComposer ? 46 : 52

  useEffect(() => {
    const draft = initialDraft ?? ''
    const draftAttachments = initialAttachments ?? []
    const hasDraft = !!draft.trim()
    const hasAttachments = draftAttachments.length > 0
    if (!hasDraft && !hasAttachments) return
    const draftKey = initialDraftKey ?? [draft ?? '', ...draftAttachments.map((item) => `${item.id}:${item.uri}`)].join('|')
    if (consumedDraftKey === draftKey) return
    if (restoreInitialDraftIfEmpty && (content.trim() || attachments.length > 0)) {
      setConsumedDraftKey(draftKey)
      return
    }
    setContent(draft ?? '')
    if (hasAttachments) setAttachments(draftAttachments)
    setConsumedDraftKey(draftKey)
  }, [attachments.length, consumedDraftKey, content, initialAttachments, initialDraft, initialDraftKey, restoreInitialDraftIfEmpty])

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
    } catch {
      setContent((current) => current ? current : text)
      setAttachments((current) => current.length > 0 ? current : files)
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
      animate={{ scale: focused && !compactComposer ? 1.01 : 1, translateY: focused ? -1 : 0 }}
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
      <IslePanel material="chrome" elevated={false} radius={panelRadius} style={{ borderColor: focused ? colors.material.strokeStrong : colors.material.stroke, backgroundColor: colors.ui.card.defaultBackground }}>
      {attachments.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 10 }}>
          {attachments.map((item) => (
            <IslePressable
              key={item.id}
              onPress={() => setAttachments((files) => files.filter((file) => file.id !== item.id))}
              accessibilityRole="button"
              accessibilityLabel={t('chat.removeAttachment', { name: item.name })}
              accessibilityHint={t('chat.removeAttachmentAccessibilityHint', { name: item.name })}
              hitSlop={COMPOSER_PILL_HIT_SLOP}
              style={{ paddingHorizontal: 10, height: 28, borderRadius: chipRadius, backgroundColor: raisedSurface, justifyContent: 'center' }}
            >
              <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700', maxWidth: attachmentLabelMaxWidth }}>
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
          style={{ gap: 10, paddingHorizontal: 12, paddingTop: 10 }}
        >
          <UtilityGroupTitle label={t('chat.inputTools')} />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <AttachmentChip label={t('chat.attachImage')} accessibilityHint={t('chat.attachImageAccessibilityHint')} onPress={() => addAttachment(pickImage)}>
              <Image color={colors.textSecondary} size={15} strokeWidth={1.8} />
            </AttachmentChip>
            <AttachmentChip label={t('chat.attachCamera')} accessibilityHint={t('chat.attachCameraAccessibilityHint')} onPress={() => addAttachment(takePhoto)}>
              <Camera color={colors.textSecondary} size={15} strokeWidth={1.8} />
            </AttachmentChip>
            <AttachmentChip label={t('chat.attachFile')} accessibilityHint={t('chat.attachFileAccessibilityHint')} onPress={() => addAttachment(pickDocument)}>
              <FilePlus color={colors.textSecondary} size={15} strokeWidth={1.8} />
            </AttachmentChip>
            <AttachmentChip
              label={recording ? t('chat.stopRecording') : t('chat.voiceInput')}
              accessibilityHint={recording ? t('chat.stopRecordingAccessibilityHint') : t('chat.voiceInputAccessibilityHint')}
              active={recording}
              onPress={() => void toggleRecording()}
            >
              <Mic color={recording ? colors.ui.tone.danger.foreground : colors.textSecondary} size={15} strokeWidth={1.8} />
            </AttachmentChip>
            <AttachmentChip label={t('chat.openCommandPanel')} accessibilityHint={t('chat.openCommandPanelAccessibilityHint')} onPress={() => setContent((value) => value.trim() ? `${value} /` : '/')}>
              <Slash color={colors.textSecondary} size={15} strokeWidth={1.8} />
            </AttachmentChip>
            {onOpenKnowledge ? (
              <AttachmentChip label={t('chat.importKnowledge')} accessibilityHint={t('chat.importKnowledgeAccessibilityHint')} onPress={onOpenKnowledge}>
                <FilePlus color={colors.textSecondary} size={15} strokeWidth={1.8} />
              </AttachmentChip>
            ) : null}
          </View>
        </MotiView>
      ) : null}
      {pendingNotice ? (
        <IslePressable
          haptic
          onPress={onClearPending}
          accessibilityRole="button"
          accessibilityLabel={t('chat.clearPending')}
          accessibilityHint={t('chat.clearPendingAccessibilityHint')}
          accessibilityValue={{ text: pendingNotice }}
          accessibilityLiveRegion="polite"
          hitSlop={COMPOSER_PILL_HIT_SLOP}
          style={{
            marginHorizontal: 10,
            marginTop: 10,
            minHeight: 30,
            borderRadius: compactControlRadius,
            paddingHorizontal: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.ui.tone.warning.background,
            borderWidth: 1,
            borderColor: colors.ui.tone.warning.border,
          }}
        >
          <Text accessible={false} importantForAccessibility="no" numberOfLines={1} style={{ color: colors.ui.tone.warning.foreground, fontSize: 11, fontWeight: '900' }}>
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
          <View style={{ borderRadius: fieldRadius, padding: 8, backgroundColor: raisedSurface, borderWidth: 1, borderColor: raisedBorder, gap: 6 }}>
            {commandMatches.map((command) => (
              <ComposerPickRow
                key={command.id}
                title={command.label}
                description={command.description}
                icon={<Slash color={colors.ui.icon.accentForeground} size={14} strokeWidth={2.2} />}
                accessibilityHint={t('chat.selectCommandAccessibilityHint', { command: command.label })}
                onPress={() => applyCommand(command)}
              />
            ))}
            {referenceMatches.map((reference) => (
              <ComposerPickRow
                key={`${reference.type}-${reference.id}`}
                title={reference.label}
                description={referenceDescription(reference, t)}
                icon={<AtSign color={colors.ui.icon.accentForeground} size={14} strokeWidth={2.2} />}
                accessibilityHint={t('chat.selectReferenceAccessibilityHint', { reference: reference.label })}
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
        {leadingAccessory ? (
          <View style={{ flexShrink: 0 }}>
            {leadingAccessory}
          </View>
        ) : null}
        {showInlineUtilities ? (
          <>
            <IslePressable
              haptic
              onPress={() => setAttachmentsOpen((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={attachmentsOpen ? t('chat.collapseAttachments') : t('chat.expandAttachments')}
              accessibilityHint={attachmentsOpen ? t('chat.collapseAttachmentsAccessibilityHint') : t('chat.expandAttachmentsAccessibilityHint')}
              accessibilityState={{ expanded: attachmentsOpen }}
              hitSlop={COMPOSER_CONTROL_HIT_SLOP}
              style={{
                width: utilityControlWidth,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: compactControlRadius,
                backgroundColor: attachmentsOpen ? colors.ui.control.primaryBackground : raisedSurface,
                borderWidth: 1,
                borderColor: attachmentsOpen ? colors.ui.control.primaryBorder : raisedBorder,
              }}
            >
              {attachmentsOpen ? <ChevronDown color={colors.ui.control.primaryForeground} size={16} strokeWidth={2} /> : <Plus color={colors.textSecondary} size={16} strokeWidth={2} />}
            </IslePressable>
            <IslePressable
              haptic
              onPress={() => void toggleRecording()}
              accessibilityRole="button"
              accessibilityLabel={recording ? t('chat.stopRecording') : t('chat.voiceInput')}
              accessibilityHint={recording ? t('chat.stopRecordingAccessibilityHint') : t('chat.voiceInputAccessibilityHint')}
              accessibilityState={{ selected: recording, busy: recording }}
              hitSlop={COMPOSER_CONTROL_HIT_SLOP}
              style={{
                width: utilityControlWidth,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: compactControlRadius,
                backgroundColor: recording ? colors.ui.tone.danger.foreground : raisedSurface,
                borderWidth: 1,
                borderColor: recording ? colors.ui.tone.danger.border : raisedBorder,
              }}
            >
              <Mic color={recording ? colors.ui.control.dangerForeground : colors.textSecondary} size={16} strokeWidth={2} />
            </IslePressable>
          </>
        ) : null}
        <View style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}>
          <TextInput
            value={content}
            onChangeText={setContent}
            multiline
            editable={!disabled}
            accessibilityLabel={t('chat.inputAccessibility')}
            accessibilityHint={streaming ? t('chat.keepTypingInputAccessibilityHint') : t('chat.inputAccessibilityHint')}
            accessibilityState={{ disabled }}
            accessibilityValue={draftAccessibilityValue}
            returnKeyType="send"
            submitBehavior={Platform.OS === 'ios' ? 'newline' : 'submit'}
            onSubmitEditing={() => {
              if (Platform.OS === 'android') {
                void submit()
              }
            }}
            placeholder={streaming ? t('chat.keepTyping') : t('chat.askAnything')}
            placeholderTextColor={colors.textTertiary}
            onFocus={() => {
              setFocused(true)
              onFocus?.()
            }}
            onBlur={() => {
              setFocused(false)
              onBlur?.()
            }}
            style={{
              flex: 1,
              width: '100%',
              minHeight: 44,
              maxHeight: 120,
              color: colors.text,
              fontSize: 15,
              lineHeight: 22,
              paddingTop: isMultilineDraft ? 8 : 0,
              paddingBottom: isMultilineDraft ? 8 : 0,
              paddingHorizontal: 8,
              textAlignVertical: isMultilineDraft ? 'top' : 'center',
            }}
          />
        </View>
        <IslePressable
          haptic
          disabled={!canSend}
          onPress={submit}
          accessibilityRole="button"
          accessibilityLabel={streaming ? t('chat.keepTypingAction') : t('chat.sendMessage')}
          accessibilityHint={sendButtonAccessibilityHint}
          accessibilityState={{ disabled: !canSend, busy: sending }}
          hitSlop={{ top: 12, right: 10, bottom: 12, left: 10 }}
          style={{
            minWidth: sendButtonMinWidth,
            height: 44,
            borderRadius: largeControlRadius,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 7,
            paddingHorizontal: 0,
            backgroundColor: canSend ? colors.ui.control.primaryBackground : colors.ui.input.disabledBackground,
            borderWidth: 1,
            borderColor: canSend ? colors.ui.control.primaryBorder : colors.ui.input.border,
            opacity: disabled ? 0.72 : 1,
          }}
        >
          {sending ? (
            <ActivityIndicator color={colors.ui.control.primaryForeground} size="small" />
          ) : (
            <SendHorizontal color={canSend ? colors.ui.control.primaryForeground : colors.textSecondary} size={19} strokeWidth={2.35} />
          )}
        </IslePressable>
      </View>
      {draftStatusVisible ? (
        <View
          accessibilityLiveRegion={draftWarningLabel ? 'polite' : undefined}
          style={{ minHeight: 18, paddingHorizontal: 12, paddingBottom: 8, marginTop: -2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
        >
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: '800' }}>
            {draftStatusLabel}
          </Text>
          {draftWarningLabel ? (
            <Text numberOfLines={1} style={{ color: colors.ui.tone.warning.foreground, fontSize: 10.5, lineHeight: 14, fontWeight: '900' }}>
              {draftWarningLabel}
            </Text>
          ) : null}
        </View>
      ) : null}
      </IslePanel>
    </MotiView>
  )
}

function ComposerPickRow({
  title,
  description,
  icon,
  accessibilityHint,
  onPress,
}: {
  title: string
  description?: string
  icon: ReactNode
  accessibilityHint?: string
  onPress: () => void
}) {
  const { colors } = useAppTheme()
  const rowRadius = colors.ui.radius.field
  return (
    <IslePressable
      haptic
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityValue={description ? { text: description } : undefined}
      hitSlop={COMPOSER_CONTROL_HIT_SLOP}
      style={{ minHeight: 44, borderRadius: rowRadius, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.ui.card.mutedBackground }}
    >
      <View style={{ width: 24, height: 24, borderRadius: colors.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.icon.accentBackground }}>
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
  accessibilityHint?: string
  active?: boolean
  children: ReactNode
  onPress: () => void
}

function AttachmentChip({ label, accessibilityHint, active = false, children, onPress }: IconButtonProps) {
  const { colors } = useAppTheme()
  return (
    <IslePressable
      haptic
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={active ? { selected: true, busy: true } : undefined}
      hitSlop={COMPOSER_CONTROL_HIT_SLOP}
      style={{
        minHeight: 44,
        paddingHorizontal: 12,
        borderRadius: colors.ui.radius.chip,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: active ? colors.ui.tone.danger.background : colors.ui.card.defaultBackground,
        borderWidth: 1,
        borderColor: active ? colors.ui.tone.danger.border : colors.material.stroke,
      }}
    >
      {children}
      <Text style={{ color: active ? colors.ui.tone.danger.foreground : colors.textSecondary, fontSize: 11, fontWeight: '800' }}>{label}</Text>
    </IslePressable>
  )
}

function UtilityGroupTitle({ label }: { label: string }) {
  const { colors } = useAppTheme()
  return (
    <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' }}>
      {label}
    </Text>
  )
}
