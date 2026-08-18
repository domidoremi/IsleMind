import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Platform, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { useTranslation } from 'react-i18next'
import { AppIcon, appIconStroke, type AppIconName } from '@/components/ui/AppIcon'
import type { Attachment, CommandReference } from '@/types/chatContracts'
import { pickDocument, pickImage, takePhoto } from '@/services/attachment'
import { useAppTheme } from '@/hooks/useAppTheme'
import { ISLE_MIN_TOUCH_TARGET, IslePanel, IslePressable, useIsleDialog } from '@/components/ui/isle'
import { HighFrameSpinner } from '@/components/ui/HighFrameSpinner'
import { normalizeSearchText } from '@/utils/text'
import { type ChatMultimodalEntry, type ChatMultimodalPolicy } from '@/presentation/features/chat/chatMultimodalPolicy'
import { PRODUCT_MOBILE_COMPOSER_COMPACT_BREAKPOINT, resolveProductMobileComposerToolsLayout } from '@/presentation/layout/productMobileLayout'
import {
  resolveAppliedInitialDraftKeyAfterSuccessfulSend,
  resolveComposerInitialDraft,
  resolveExternalSubmitKey,
  restoreRejectedComposerAttachments,
  restoreRejectedComposerText,
} from './composerDraftState'
import { appendComposerVoiceTranscript, composerVoiceIsBusy, formatComposerVoiceDuration, type ComposerVoiceState } from './composerVoiceState'
import { useComposerVoiceInput } from './useComposerVoiceInput'
import { useComposerDraftPersistence } from './useComposerDraftPersistence'
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
  draftPersistenceKey?: string
  externalSubmitKey?: string | number
  commands?: ComposerCommand[]
  references?: CommandReference[]
  multimodalPolicy?: ChatMultimodalPolicy
  utilitiesOpen?: boolean
  showInlineUtilities?: boolean
  showCommandAction?: boolean
  placeholder?: string
  leadingAccessory?: ReactNode
  trailingAccessory?: ReactNode
  bottomAccessory?: ReactNode
  onClearPending?: () => void
  onReferenceSelected?: (reference: CommandReference) => void
  onFocus?: () => void
  onBlur?: () => void
  onOpenKnowledge?: () => void
  onRequestCloseUtilities?: () => void
  onSend: (content: string, attachments: Attachment[]) => Promise<void> | void
  onSendWhileStreaming?: (content: string, attachments: Attachment[]) => Promise<void> | void
}

const COMPOSER_CONTROL_HIT_SLOP = { top: 8, right: 8, bottom: 8, left: 8 }
const COMPOSER_MAX_LENGTH = 12000
const COMPOSER_INPUT_MIN_HEIGHT = 48
const COMPOSER_INPUT_LINE_HEIGHT = 22
const COMPOSER_INPUT_VERTICAL_PADDING = 8
const COMPOSER_INPUT_MAX_LINES = 6
const COMPOSER_DOCK_CONTROL_SIZE = ISLE_MIN_TOUCH_TARGET
const COMPOSER_INPUT_WEB_SCROLLBAR_PROPS = Platform.OS === 'web'
  ? ({ className: 'composer-input-no-scrollbar' } as Record<string, unknown>)
  : undefined

export function Composer({
  disabled = false,
  streaming = false,
  pendingNotice,
  initialDraft,
  initialDraftKey,
  initialAttachments,
  restoreInitialDraftIfEmpty = false,
  draftPersistenceKey,
  externalSubmitKey,
  commands = [],
  references = [],
  multimodalPolicy,
  utilitiesOpen = false,
  showInlineUtilities = true,
  showCommandAction = true,
  placeholder,
  leadingAccessory,
  trailingAccessory,
  bottomAccessory,
  onClearPending,
  onReferenceSelected,
  onFocus,
  onBlur,
  onOpenKnowledge,
  onRequestCloseUtilities,
  onSend,
  onSendWhileStreaming,
}: ComposerProps) {
  const { colors, isGlass } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const { width: composerWindowWidth } = useWindowDimensions()
  const [content, setContent] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [sending, setSending] = useState(false)
  const [inputContentHeight, setInputContentHeight] = useState(COMPOSER_INPUT_MIN_HEIGHT)
  const [consumedDraftKey, setConsumedDraftKey] = useState<string | number | undefined>(undefined)
  const [appliedInitialDraftKey, setAppliedInitialDraftKey] = useState<string | number | undefined>(undefined)
  const consumedExternalSubmitKey = useRef<string | number | undefined>(undefined)
  const {
    markChanged: markDraftChanged,
    flush: flushDraft,
    clear: clearDraft,
  } = useComposerDraftPersistence({
    persistenceKey: draftPersistenceKey,
    content,
    attachments,
    sending,
    skipHydration: !!initialDraft?.trim() || (initialAttachments?.length ?? 0) > 0,
    setContent,
    setAttachments,
  })
  const appendVoiceTranscript = useCallback((transcript: string) => {
    markDraftChanged()
    setContent((draft) => appendComposerVoiceTranscript(draft, transcript))
  }, [markDraftChanged])
  const voiceInput = useComposerVoiceInput({
    enabled: !disabled && isMultimodalEntryAvailable('voice'),
    onTranscript: appendVoiceTranscript,
  })
  const recording = voiceInput.state.phase === 'recording'
  const voiceBusy = composerVoiceIsBusy(voiceInput.state)
  const voiceHardUnavailable = voiceInput.state.phase === 'error' && (
    voiceInput.state.kind === 'unavailable' ||
    voiceInput.state.kind === 'web-insecure' ||
    voiceInput.state.kind === 'web-unsupported'
  )
  const voiceControlDisabled = !recording && (
    disabled ||
    !isMultimodalEntryAvailable('voice') ||
    voiceBusy ||
    voiceInput.state.phase === 'success' ||
    voiceHardUnavailable
  )
  const blockedAttachmentEntry = attachments.find((attachment) => !isMultimodalEntryAvailable(attachment.type === 'image' ? 'image' : 'file'))
  const blockedAttachmentPolicy = blockedAttachmentEntry
    ? multimodalEntryPolicy(blockedAttachmentEntry.type === 'image' ? 'image' : 'file')
    : null
  const draftCharacterCount = content.length
  const draftOverLimit = draftCharacterCount > COMPOSER_MAX_LENGTH
  const draftExcessCharacters = Math.max(0, draftCharacterCount - COMPOSER_MAX_LENGTH)
  const hasSendableDraft = !!content.trim() || attachments.length > 0
  const hasBlockedAttachment = !!blockedAttachmentPolicy
  const canSend = hasSendableDraft && !disabled && !sending && !draftOverLimit && !hasBlockedAttachment
  const draftStatusVisible = draftOverLimit || hasBlockedAttachment
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
  const draftWarningLabel = draftOverLimit
    ? t('chat.composerDraftExceeded', { count: draftExcessCharacters })
    : blockedAttachmentPolicy
      ? multimodalUnavailableMessage(blockedAttachmentPolicy.entry)
      : ''
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
  const showCommandPanel = !!trigger && (
    commandMatches.length > 0 ||
    referenceMatches.length > 0 ||
    trigger.query.length === 0 ||
    trigger.type === 'command'
  )
  const isMultilineDraft = content.includes('\n') || content.length > 70
  const multilineInput = isMultilineDraft
  const inputMaxHeight = COMPOSER_INPUT_LINE_HEIGHT * COMPOSER_INPUT_MAX_LINES + COMPOSER_INPUT_VERTICAL_PADDING * 2
  const inputHeight = Math.max(COMPOSER_INPUT_MIN_HEIGHT, Math.min(inputMaxHeight, Math.ceil(inputContentHeight)))
  const inputPaddingVertical = isMultilineDraft ? COMPOSER_INPUT_VERTICAL_PADDING : (COMPOSER_INPUT_MIN_HEIGHT - COMPOSER_INPUT_LINE_HEIGHT) / 2
  const panelRadius = colors.ui.radius.panel
  const fieldRadius = colors.ui.radius.field
  const chipRadius = colors.ui.radius.controlLarge
  const compactControlRadius = colors.ui.radius.controlMiddle
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const raisedSurface = colors.ui.glass ? colors.ui.semantic.chrome.background : colors.ui.limeRoad ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base
  const raisedBorder = colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.limeRoad ? colors.material.stroke : colors.ui.semantic.chrome.border
  const chipSurface = colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.limeRoad ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base
  const chipBorder = colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.limeRoad ? colors.material.stroke : colors.ui.semantic.chrome.border
  const shellBorder = colors.ui.limeRoad
    ? colors.material.stroke
    : colors.ui.glass
      ? colors.ui.actionBar.border
      : colors.ui.semantic.chrome.border
  const compactComposer = composerWindowWidth < PRODUCT_MOBILE_COMPOSER_COMPACT_BREAKPOINT
  const attachmentLabelMaxWidth = Math.max(108, Math.min(compactComposer ? 132 : 180, composerWindowWidth * 0.42))
  const utilityControlWidth = COMPOSER_DOCK_CONTROL_SIZE
  const sendButtonSize = COMPOSER_DOCK_CONTROL_SIZE
  const showSendAction = streaming || hasSendableDraft || sending
  const toolsLayout = resolveProductMobileComposerToolsLayout(composerWindowWidth, {
    entryCount: 5 + (onOpenKnowledge ? 1 : 0),
    unavailableEntryCount: (multimodalPolicy?.unavailableCount ?? 0) + (multimodalPolicy?.generationUnavailableCount ?? 0),
  })
  const composerShadowOpacity = 0

  useEffect(() => {
    const decision = resolveComposerInitialDraft({
      initialDraft,
      initialDraftKey,
      initialAttachments,
      consumedDraftKey,
      restoreInitialDraftIfEmpty,
      currentContent: content,
      currentAttachmentCount: attachments.length,
    })
    if (decision.kind === 'ignore') return
    if (decision.kind === 'preserve-current') return

    markDraftChanged()
    setConsumedDraftKey(decision.draftKey)
    setContent(decision.content)
    if (decision.attachments.length > 0) setAttachments(decision.attachments)
    setAppliedInitialDraftKey(decision.draftKey)
  }, [attachments.length, consumedDraftKey, content, initialAttachments, initialDraft, initialDraftKey, markDraftChanged, restoreInitialDraftIfEmpty])

  useEffect(() => {
    const admittedSubmitKey = resolveExternalSubmitKey({
      externalSubmitKey,
      consumedExternalSubmitKey: consumedExternalSubmitKey.current,
      canSend,
    })
    if (admittedSubmitKey === undefined) return
    consumedExternalSubmitKey.current = admittedSubmitKey
    void submit()
  }, [canSend, externalSubmitKey])

  function multimodalEntryPolicy(entry: ChatMultimodalEntry) {
    return multimodalPolicy?.entries[entry]
  }

  function isMultimodalEntryAvailable(entry: ChatMultimodalEntry): boolean {
    return multimodalEntryPolicy(entry)?.available !== false
  }

  function multimodalUnavailableMessage(entry: ChatMultimodalEntry): string {
    const policy = multimodalEntryPolicy(entry)
    return policy?.reasonKey
      ? t(policy.reasonKey, policy.reasonParams)
      : t('chat.multimodalUnavailableGeneric')
  }

  function multimodalAccessibilityHint(entry: ChatMultimodalEntry, fallbackKey: string): string {
    return isMultimodalEntryAvailable(entry) ? t(fallbackKey) : multimodalUnavailableMessage(entry)
  }

  async function addAttachment(entry: ChatMultimodalEntry, picker: () => Promise<Attachment | null>) {
    if (!isMultimodalEntryAvailable(entry)) return
    try {
      const attachment = await picker()
      if (attachment) {
        markDraftChanged()
        setAttachments((items) => [...items, attachment])
      }
    } catch {
      // Picker APIs resolve with null for an intentional cancellation; only rejected operations reach this feedback path.
      dialog.toast({
        title: t('chat.attachmentPickerFailed'),
        message: t('chat.attachmentPickerFailedMessage'),
        tone: 'danger',
        dedupeKey: 'chat-attachment-picker-failed',
      })
    }
  }

  function closeUtilities() {
    setAttachmentsOpen(false)
    onRequestCloseUtilities?.()
  }

  function openCommandEntry() {
    closeUtilities()
    markDraftChanged()
    setContent((value) => value.trim() ? `${value} /` : '/')
  }

  function openKnowledge() {
    closeUtilities()
    onOpenKnowledge?.()
  }

  async function submit() {
    if (!canSend) return
    const text = content
    const files = attachments
    const persistenceKeyAtSubmit = draftPersistenceKey
    void flushDraft(text, files)
    setSending(true)
    setContent('')
    setAttachments([])
    try {
      if (streaming && onSendWhileStreaming) {
        await onSendWhileStreaming(text, files)
      } else {
        await onSend(text, files)
      }
      const nextAppliedInitialDraftKey = resolveAppliedInitialDraftKeyAfterSuccessfulSend(appliedInitialDraftKey, initialDraftKey)
      if (nextAppliedInitialDraftKey !== appliedInitialDraftKey) {
        setAppliedInitialDraftKey(nextAppliedInitialDraftKey)
      }
      void clearDraft(persistenceKeyAtSubmit)
    } catch {
      markDraftChanged()
      setContent((current) => restoreRejectedComposerText(current, text))
      setAttachments((current) => restoreRejectedComposerAttachments(current, files))
    } finally {
      setSending(false)
    }
  }

  function replaceActiveToken(next: string) {
    if (!trigger) return
    const before = content.slice(0, trigger.start)
    const after = content.slice(trigger.end)
    const spacer = next && after && !/^\s/.test(after) ? ' ' : ''
    markDraftChanged()
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

  return (
    <View
      style={{
        shadowColor: colors.shadowTint,
        shadowRadius: focused ? 12 : 6,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: composerShadowOpacity,
        elevation: colors.ui.limeRoad && composerShadowOpacity > 0.02 ? 1 : 0,
        backgroundColor: 'transparent',
      }}
    >
      <IslePanel material="chrome" intensity={isGlass ? 48 : 34} elevated={false} radius={panelRadius} style={{ borderColor: shellBorder, backgroundColor: focused ? colors.ui.composer.shellFocusedBackground : colors.ui.composer.shellBackground }}>
      {attachments.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 10 }}>
          {attachments.map((item) => (
            <IslePressable
              key={item.id}
              onPress={() => {
                markDraftChanged()
                setAttachments((files) => files.filter((file) => file.id !== item.id))
              }}
              accessibilityRole="button"
              accessibilityLabel={t('chat.removeAttachment', { name: item.name })}
              accessibilityHint={t('chat.removeAttachmentAccessibilityHint', { name: item.name })}
              style={{ minHeight: ISLE_MIN_TOUCH_TARGET, justifyContent: 'center' }}
            >
              <View style={{ paddingHorizontal: 10, height: 28, borderRadius: chipRadius, backgroundColor: chipSurface, borderWidth: subtleBorderWidth, borderColor: chipBorder, justifyContent: 'center' }}>
                <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700', maxWidth: attachmentLabelMaxWidth }}>
                  {item.name}
                </Text>
              </View>
            </IslePressable>
          ))}
        </View>
      ) : null}
      {(attachmentsOpen || utilitiesOpen) ? (
        <View
          style={{ gap: 10, paddingHorizontal: toolsLayout.panelHorizontalPadding, paddingTop: 10 }}
        >
          <UtilityGroupTitle label={t('chat.inputTools')} />
          <View style={{ flexDirection: 'row', gap: toolsLayout.chipGap, flexWrap: 'wrap' }}>
            <AttachmentChip label={t('chat.attachImage')} accessibilityHint={multimodalAccessibilityHint('image', 'chat.attachImageAccessibilityHint')} disabled={!isMultimodalEntryAvailable('image')} minWidth={toolsLayout.chipMinWidth} maxWidth={toolsLayout.chipMaxWidth} onPress={() => addAttachment('image', pickImage)}>
              <AppIcon name="image" color={isMultimodalEntryAvailable('image') ? colors.textSecondary : colors.ui.control.disabledForeground} size={15} strokeWidth={appIconStroke.fine} />
            </AttachmentChip>
            <AttachmentChip label={t('chat.attachCamera')} accessibilityHint={multimodalAccessibilityHint('camera', 'chat.attachCameraAccessibilityHint')} disabled={!isMultimodalEntryAvailable('camera')} minWidth={toolsLayout.chipMinWidth} maxWidth={toolsLayout.chipMaxWidth} onPress={() => addAttachment('camera', takePhoto)}>
              <AppIcon name="camera" color={isMultimodalEntryAvailable('camera') ? colors.textSecondary : colors.ui.control.disabledForeground} size={15} strokeWidth={appIconStroke.fine} />
            </AttachmentChip>
            <AttachmentChip label={t('chat.attachFile')} accessibilityHint={multimodalAccessibilityHint('file', 'chat.attachFileAccessibilityHint')} disabled={!isMultimodalEntryAvailable('file')} minWidth={toolsLayout.chipMinWidth} maxWidth={toolsLayout.chipMaxWidth} onPress={() => addAttachment('file', pickDocument)}>
              <AppIcon name="attachment" color={isMultimodalEntryAvailable('file') ? colors.textSecondary : colors.ui.control.disabledForeground} size={15} strokeWidth={appIconStroke.fine} />
            </AttachmentChip>
            <AttachmentChip
              label={recording ? t('chat.stopRecording') : t('chat.voiceInput')}
              accessibilityHint={recording ? t('chat.stopRecordingAccessibilityHint') : multimodalAccessibilityHint('voice', 'chat.voiceInputAccessibilityHint')}
              active={recording}
              disabled={voiceControlDisabled || (!recording && !isMultimodalEntryAvailable('voice'))}
              minWidth={toolsLayout.chipMinWidth}
              maxWidth={toolsLayout.chipMaxWidth}
              onPress={() => void (recording ? voiceInput.stop() : voiceInput.begin())}
            >
              <AppIcon name="microphone" color={recording ? colors.ui.tone.danger.foreground : isMultimodalEntryAvailable('voice') ? colors.textSecondary : colors.ui.control.disabledForeground} size={15} strokeWidth={appIconStroke.fine} />
            </AttachmentChip>
            <AttachmentChip label={t('chat.openCommandPanel')} accessibilityHint={t('chat.openCommandPanelAccessibilityHint')} minWidth={toolsLayout.chipMinWidth} maxWidth={toolsLayout.chipMaxWidth} onPress={openCommandEntry}>
              <AppIcon name="slash-command" color={colors.textSecondary} size={15} strokeWidth={appIconStroke.fine} />
            </AttachmentChip>
            {onOpenKnowledge ? (
              <AttachmentChip label={t('chat.importKnowledge')} accessibilityHint={t('chat.importKnowledgeAccessibilityHint')} minWidth={toolsLayout.chipMinWidth} maxWidth={toolsLayout.chipMaxWidth} onPress={openKnowledge}>
                <AppIcon name="knowledge" color={colors.textSecondary} size={15} strokeWidth={appIconStroke.fine} />
              </AttachmentChip>
            ) : null}
          </View>
        </View>
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
          style={{
            marginHorizontal: 10,
            marginTop: 10,
            minHeight: ISLE_MIN_TOUCH_TARGET,
            borderRadius: compactControlRadius,
            paddingHorizontal: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.ui.tone.warning.background,
            borderWidth: subtleBorderWidth,
            borderColor: colors.ui.tone.warning.border,
          }}
        >
          <Text accessible={false} importantForAccessibility="no" numberOfLines={1} style={{ color: colors.ui.tone.warning.foreground, fontSize: 11, fontWeight: '800' }}>
            {pendingNotice}
          </Text>
        </IslePressable>
      ) : null}
      <ComposerVoiceStatus
        state={voiceInput.state}
        onStop={() => void voiceInput.stop()}
        onCancel={() => void voiceInput.cancel()}
        onRetry={() => void voiceInput.retry()}
        onOpenSettings={() => void voiceInput.openSettings()}
      />
      {showCommandPanel ? (
        <View
          style={{ paddingHorizontal: 10, paddingTop: 10 }}
        >
          <View style={{ borderRadius: fieldRadius, padding: 8, backgroundColor: raisedSurface, borderWidth: subtleBorderWidth, borderColor: raisedBorder, gap: 6 }}>
            {commandMatches.map((command) => (
              <ComposerPickRow
                key={command.id}
                title={command.label}
                description={command.description}
                icon={<AppIcon name="slash-command" color={colors.ui.icon.accentForeground} size={14} strokeWidth={appIconStroke.strong} />}
                accessibilityHint={t('chat.selectCommandAccessibilityHint', { command: command.label })}
                onPress={() => applyCommand(command)}
              />
            ))}
            {referenceMatches.map((reference) => (
              <ComposerPickRow
                key={`${reference.type}-${reference.id}`}
                title={reference.label}
                description={referenceDescription(reference, t)}
                icon={<AppIcon name="mention" color={colors.ui.icon.accentForeground} size={14} strokeWidth={appIconStroke.strong} />}
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
        </View>
      ) : null}
      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 0 }}>
        <View style={{ minHeight: COMPOSER_INPUT_MIN_HEIGHT, justifyContent: 'center' }}>
          <TextInput
            value={content}
            onChangeText={(value) => {
              markDraftChanged()
              setContent(value)
            }}
            multiline={multilineInput}
            scrollEnabled={multilineInput}
            {...COMPOSER_INPUT_WEB_SCROLLBAR_PROPS}
            editable={!disabled}
            accessibilityLabel={t('chat.inputAccessibility')}
            accessibilityHint={streaming ? t('chat.keepTypingInputAccessibilityHint') : t('chat.inputAccessibilityHint')}
            accessibilityState={{ disabled }}
            accessibilityValue={draftAccessibilityValue}
            returnKeyType="send"
            submitBehavior={Platform.OS === 'ios' && multilineInput ? 'newline' : 'submit'}
            onSubmitEditing={() => {
              if (Platform.OS === 'ios' && multilineInput) return
              void submit()
            }}
            placeholder={streaming ? t('chat.keepTyping') : placeholder ?? t('chat.askAnything')}
            placeholderTextColor={colors.ui.input.placeholderForeground}
            onContentSizeChange={(event) => {
              setInputContentHeight(event.nativeEvent.contentSize.height)
            }}
            onFocus={() => {
              setFocused(true)
              onFocus?.()
            }}
            onBlur={() => {
              setFocused(false)
              onBlur?.()
            }}
            style={{
              flexGrow: 0,
              flexShrink: 0,
              width: '100%',
              height: inputHeight,
              minHeight: COMPOSER_INPUT_MIN_HEIGHT,
              maxHeight: inputMaxHeight,
              color: colors.text,
              fontSize: 15,
              lineHeight: COMPOSER_INPUT_LINE_HEIGHT,
              includeFontPadding: false,
              paddingTop: inputPaddingVertical,
              paddingBottom: inputPaddingVertical,
              paddingHorizontal: 2,
              textAlignVertical: multilineInput ? 'top' : 'center',
            }}
          />
        </View>
      </View>
      <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 0, paddingBottom: bottomAccessory ? 4 : 6, gap: 2 }}>
        {leadingAccessory ? <View style={{ flexShrink: 1, minWidth: 0 }}>{leadingAccessory}</View> : null}
        {showInlineUtilities ? (
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
              height: COMPOSER_DOCK_CONTROL_SIZE,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: compactControlRadius,
              backgroundColor: attachmentsOpen ? colors.ui.actionBar.itemActiveBackground : 'transparent',
              borderWidth: attachmentsOpen ? subtleBorderWidth : 0,
              borderColor: attachmentsOpen ? colors.ui.control.primaryBorder : raisedBorder,
            }}
          >
            {attachmentsOpen ? <AppIcon name="collapse" color={colors.ui.control.primaryForeground} size={16} /> : <AppIcon name="add" color={colors.textSecondary} size={16} />}
          </IslePressable>
        ) : null}
        {showCommandAction ? (
          <IslePressable
            haptic
            onPress={openCommandEntry}
            accessibilityRole="button"
            accessibilityLabel={t('chat.openCommandPanel')}
            accessibilityHint={t('chat.openCommandPanelAccessibilityHint')}
            hitSlop={COMPOSER_CONTROL_HIT_SLOP}
            style={{
              width: utilityControlWidth,
              height: COMPOSER_DOCK_CONTROL_SIZE,
              borderRadius: compactControlRadius,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'transparent',
              borderWidth: 0,
              borderColor: raisedBorder,
            }}
          >
            <AppIcon name="slash-command" color={colors.textSecondary} size={16} strokeWidth={appIconStroke.strong} />
          </IslePressable>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }} />
        <IslePressable
          haptic
          onPress={() => void (recording ? voiceInput.stop() : voiceInput.begin())}
          disabled={voiceControlDisabled || (!recording && !isMultimodalEntryAvailable('voice'))}
          accessibilityRole="button"
          accessibilityLabel={recording ? t('chat.stopRecording') : t('chat.voiceInput')}
          accessibilityHint={recording ? t('chat.stopRecordingAccessibilityHint') : multimodalAccessibilityHint('voice', 'chat.voiceInputAccessibilityHint')}
          accessibilityState={{ selected: recording, busy: voiceBusy, disabled: voiceControlDisabled }}
          hitSlop={COMPOSER_CONTROL_HIT_SLOP}
          style={{
            width: utilityControlWidth,
            height: COMPOSER_DOCK_CONTROL_SIZE,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: compactControlRadius,
            backgroundColor: recording ? colors.ui.tone.danger.background : 'transparent',
            borderWidth: recording ? subtleBorderWidth : 0,
            borderColor: recording ? colors.ui.tone.danger.border : 'transparent',
            opacity: voiceControlDisabled ? 0.5 : 1,
          }}
          >
            <AppIcon name="microphone" color={recording ? colors.ui.tone.danger.foreground : isMultimodalEntryAvailable('voice') ? colors.textSecondary : colors.ui.control.disabledForeground} size={16} />
          </IslePressable>
        {trailingAccessory ? <View style={{ flexShrink: 0 }}>{trailingAccessory}</View> : null}
        {showSendAction ? (
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
              width: sendButtonSize,
              minWidth: sendButtonSize,
              height: sendButtonSize,
              borderRadius: colors.ui.radius.controlLarge,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 7,
              paddingHorizontal: 0,
              backgroundColor: canSend ? colors.ui.control.primaryBackground : colors.ui.control.disabledBackground,
              borderWidth: canSend ? 0 : subtleBorderWidth,
              borderColor: canSend ? 'transparent' : colors.ui.control.disabledBorder,
              opacity: 1,
            }}
          >
            {sending ? (
              <HighFrameSpinner color={colors.ui.control.primaryForeground} size={16} />
            ) : (
              <AppIcon name="send" color={canSend ? colors.ui.control.primaryForeground : colors.ui.control.disabledForeground} size={18} strokeWidth={appIconStroke.bold} />
            )}
          </IslePressable>
        ) : null}
      </View>
      {bottomAccessory ? (
        <View style={{ paddingHorizontal: 7, paddingTop: 0, paddingBottom: 7 }}>
          {bottomAccessory}
        </View>
      ) : null}
      {draftStatusVisible ? (
        <View
          accessibilityLiveRegion={draftWarningLabel ? 'polite' : undefined}
          style={{ minHeight: 18, paddingHorizontal: 12, paddingBottom: 8, marginTop: -2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
        >
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: '800' }}>
            {draftStatusLabel}
          </Text>
          {draftWarningLabel ? (
            <Text numberOfLines={1} style={{ color: colors.ui.tone.warning.foreground, fontSize: 10.5, lineHeight: 14, fontWeight: '800' }}>
              {draftWarningLabel}
            </Text>
          ) : null}
        </View>
      ) : null}
      </IslePanel>
    </View>
  )
}

function ComposerVoiceStatus({
  state,
  onStop,
  onCancel,
  onRetry,
  onOpenSettings,
}: {
  state: ComposerVoiceState
  onStop: () => void
  onCancel: () => void
  onRetry: () => void
  onOpenSettings: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  if (state.phase === 'idle') return null

  const durationLabel = 'durationMillis' in state ? formatComposerVoiceDuration(state.durationMillis) : null
  const isError = state.phase === 'error'
  const isSuccess = state.phase === 'success'
  const isRecording = state.phase === 'recording'
  const needsSettings = isError && state.kind === 'permission' && !state.canAskAgain
  const canRetry = isError && !needsSettings && state.kind !== 'unavailable' && state.kind !== 'web-insecure' && state.kind !== 'web-unsupported'
  const canCancel = state.phase === 'permission-request' || state.phase === 'recording' || state.phase === 'stopping' || state.phase === 'transcribing'

  let title = t('chat.voiceInput')
  let message = t('chat.voiceInputAccessibilityHint')
  if (state.phase === 'permission-request') {
    title = t('chat.voicePermissionRequesting')
    message = t('chat.voicePermissionRequestingMessage')
  } else if (state.phase === 'recording') {
    title = t('chat.voiceRecording')
    message = t('chat.voiceRecordingMessage')
  } else if (state.phase === 'stopping') {
    title = t('chat.voiceStopping')
    message = t('chat.voiceStoppingMessage')
  } else if (state.phase === 'cancelling') {
    title = t('chat.voiceCancelling')
    message = t('chat.voiceCancellingMessage')
  } else if (state.phase === 'transcribing') {
    title = t('chat.transcribing')
    message = t('chat.transcribingMessage')
  } else if (state.phase === 'success') {
    title = t('chat.voiceAddedToDraft')
    message = t('chat.voiceAddedToDraftMessage')
  } else if (state.kind === 'permission') {
    title = t('chat.microphonePermissionMissing')
    message = state.canAskAgain ? t('chat.microphonePermissionRetryMessage') : t('chat.microphonePermissionSettingsMessage')
  } else if (state.kind === 'web-insecure') {
    title = t('chat.voiceUnavailable')
    message = t('chat.voiceWebInsecureMessage')
  } else if (state.kind === 'web-unsupported') {
    title = t('chat.voiceUnavailable')
    message = t('chat.voiceWebUnsupportedMessage')
  } else if (state.kind === 'unavailable') {
    title = t('chat.voiceUnavailable')
    message = t('chat.voiceUnavailableMessage')
  } else {
    title = t('chat.voiceFailed')
    message = state.kind === 'transcription' ? t('chat.voiceTranscriptionFailedMessage') : t('chat.voiceFailedMessage')
  }

  return (
    <View
      style={{
        marginHorizontal: 10,
        marginTop: 10,
        padding: 8,
        borderRadius: colors.ui.radius.field,
        backgroundColor: isError
          ? colors.ui.tone.warning.background
          : isSuccess
            ? colors.ui.tone.success.background
            : colors.ui.semantic.surface.muted,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isError
          ? colors.ui.tone.warning.border
          : isSuccess
            ? colors.ui.tone.success.border
            : colors.ui.semantic.chrome.border,
        gap: 8,
      }}
    >
      <View style={{ minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
        >
          {isRecording ? (
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ui.tone.danger.foreground }} />
          ) : state.phase === 'permission-request' || state.phase === 'stopping' || state.phase === 'cancelling' || state.phase === 'transcribing' ? (
            <HighFrameSpinner color={colors.textSecondary} size={16} />
          ) : (
            <AppIcon name={isSuccess ? 'check' : 'microphone'} color={isError ? colors.ui.tone.warning.foreground : colors.textSecondary} size={16} />
          )}
        </View>
        <View
          accessible
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${title}. ${message}`}
          accessibilityValue={durationLabel ? { text: durationLabel } : undefined}
          style={{ flex: 1, minWidth: 0 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '800' }}>
              {title}
            </Text>
            {durationLabel ? (
              <Text accessible={false} importantForAccessibility="no" style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'], fontWeight: '800' }}>
                {durationLabel}
              </Text>
            ) : null}
          </View>
          <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: '600' }}>
            {message}
          </Text>
        </View>
      </View>

      {isRecording || canCancel || canRetry || needsSettings || isError ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }}>
          {isRecording ? (
            <ComposerVoiceAction label={t('chat.stopRecording')} hint={t('chat.stopRecordingAccessibilityHint')} icon="stop" emphasized onPress={onStop} />
          ) : null}
          {canRetry ? (
            <ComposerVoiceAction label={t('chat.retryVoiceInput')} hint={t('chat.retryVoiceInputAccessibilityHint')} icon="retry" emphasized onPress={onRetry} />
          ) : null}
          {needsSettings ? (
            <ComposerVoiceAction label={t('chat.openMicrophoneSettings')} hint={t('chat.openMicrophoneSettingsAccessibilityHint')} icon="settings" emphasized onPress={onOpenSettings} />
          ) : null}
          {canCancel || isError ? (
            <ComposerVoiceAction
              label={isError ? t('chat.dismissVoiceError') : t('chat.cancelVoiceInput')}
              hint={isError ? t('chat.dismissVoiceErrorAccessibilityHint') : t('chat.cancelVoiceInputAccessibilityHint')}
              icon="close"
              onPress={onCancel}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function ComposerVoiceAction({
  label,
  hint,
  icon,
  emphasized = false,
  onPress,
}: {
  label: string
  hint: string
  icon: AppIconName
  emphasized?: boolean
  onPress: () => void
}) {
  const { colors } = useAppTheme()
  return (
    <IslePressable
      haptic
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      hitSlop={COMPOSER_CONTROL_HIT_SLOP}
      style={{
        minWidth: 44,
        minHeight: 44,
        paddingHorizontal: 11,
        borderRadius: colors.ui.radius.controlLarge,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: emphasized ? colors.ui.control.primaryBackground : colors.ui.semantic.surface.base,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: emphasized ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border,
      }}
    >
      <AppIcon name={icon} color={emphasized ? colors.ui.control.primaryForeground : colors.textSecondary} size={15} strokeWidth={appIconStroke.strong} />
      <Text numberOfLines={1} style={{ color: emphasized ? colors.ui.control.primaryForeground : colors.textSecondary, fontSize: 11, fontWeight: '800' }}>
        {label}
      </Text>
    </IslePressable>
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
  const { colors, isGlass } = useAppTheme()
  const rowRadius = colors.ui.radius.field
  const rowBackground = isGlass ? colors.ui.actionBar.itemBackground : colors.ui.limeRoad ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted
  const rowBorderColor = isGlass ? colors.ui.actionBar.itemBorder : colors.ui.limeRoad ? colors.material.stroke : colors.ui.semantic.chrome.border
  const iconBackground = isGlass ? colors.ui.actionBar.itemActiveBackground : colors.ui.icon.accentBackground
  return (
    <IslePressable
      haptic
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityValue={description ? { text: description } : undefined}
      hitSlop={COMPOSER_CONTROL_HIT_SLOP}
      style={{ minHeight: 44, borderRadius: rowRadius, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: rowBackground, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: rowBorderColor }}
    >
      <View style={{ width: 24, height: 24, borderRadius: colors.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center', backgroundColor: iconBackground }}>
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>
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
  disabled?: boolean
  minWidth?: number
  maxWidth?: number
  children: ReactNode
  onPress: () => void
}

function AttachmentChip({ label, accessibilityHint, active = false, disabled = false, minWidth, maxWidth, children, onPress }: IconButtonProps) {
  const { colors, isGlass } = useAppTheme()
  const idleBackground = isGlass ? colors.ui.actionBar.itemBackground : colors.ui.limeRoad ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base
  const idleBorder = isGlass ? colors.ui.actionBar.itemBorder : colors.ui.limeRoad ? colors.material.stroke : colors.ui.semantic.chrome.border
  return (
    <IslePressable
      haptic
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={active ? { selected: true, busy: true } : undefined}
      hitSlop={COMPOSER_CONTROL_HIT_SLOP}
      style={{
        minHeight: 44,
        minWidth,
        maxWidth,
        paddingHorizontal: 12,
        borderRadius: colors.ui.radius.controlLarge,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: disabled ? 'transparent' : active ? colors.ui.tone.danger.background : idleBackground,
        borderWidth: disabled || colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
        borderColor: disabled ? colors.ui.control.disabledBorder : active ? colors.ui.tone.danger.border : idleBorder,
      }}
    >
      {children}
      <Text numberOfLines={1} style={{ color: disabled ? colors.ui.control.disabledForeground : active ? colors.ui.tone.danger.foreground : colors.textSecondary, fontSize: 11, fontWeight: '800', flexShrink: 1 }}>{label}</Text>
    </IslePressable>
  )
}

function UtilityGroupTitle({ label }: { label: string }) {
  const { colors } = useAppTheme()
  return (
    <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }}>
      {label}
    </Text>
  )
}
