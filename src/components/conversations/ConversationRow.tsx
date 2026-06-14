import { Text, TextInput, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Check, PencilLine, Trash2, X } from 'lucide-react-native'
import { MotiView } from 'moti'
import { AnimatedNavigationIcon } from '@/components/navigation/AnimatedNavigationIcon'
import { NavigationIconBadge, useNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import type { Conversation } from '@/types'
import { getModelName } from '@/types'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { IslePressable } from '@/components/ui/isle'
import { IslePanel } from '@/components/ui/isle'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { useIsleDialog } from '@/components/ui/isle'

const ROW_MESSAGE_PREVIEW_LIMIT = 180
const ROW_MESSAGE_PREVIEW_SCAN_LIMIT = 1200
const ROW_MESSAGE_PREVIEW_SEPARATOR = ' ... '
const ROW_ACTION_HIT_SLOP = { top: 10, right: 10, bottom: 10, left: 10 }
const ROW_CONTAINER_BOTTOM_SPACING = 12
const ROW_MINUTE_MS = 60 * 1000
const ROW_HOUR_MS = 60 * ROW_MINUTE_MS
const ROW_DAY_MS = 24 * ROW_HOUR_MS
const ROW_OPEN_PENDING_RELEASE_MS = 700

interface ConversationRowProps {
  conversation: Conversation
  index: number
  active?: boolean
  animateEntrance?: boolean
  interactionDisabled?: boolean
  now?: number
  isInteractionBlocked?: () => boolean
  onInteractionBlocked?: () => void
  modelLabel?: string
  onOpen?: (conversationId: string) => void
  onRenameFocus?: (index: number) => void
  onLayoutHeight?: (conversationId: string, height: number) => void
  searchMatchSummary?: string
  searchMatchFieldLabel?: string
  searchMatchAccessibilitySummary?: string
}

export const ConversationRow = memo(function ConversationRow({ conversation, index, active = false, animateEntrance = true, interactionDisabled = false, now = Date.now(), isInteractionBlocked, onInteractionBlocked, modelLabel, onOpen, onRenameFocus, onLayoutHeight, searchMatchSummary, searchMatchFieldLabel, searchMatchAccessibilitySummary }: ConversationRowProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const { width } = useWindowDimensions()
  const compact = width < 390
  const panelPadding = compact ? 12 : 16
  const rowGap = compact ? 8 : 12
  const actionGap = compact ? 6 : 8
  const remove = useChatStore((state) => state.delete)
  const rename = useChatStore((state) => state.rename)
  const select = useChatStore((state) => state.select)
  const dialog = useIsleDialog()
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(conversation.title)
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const skipNextRenameSubmit = useRef(false)
  const renameSubmitHandled = useRef(false)
  const deleteConfirmOpen = useRef(false)
  const renameFocusFrame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)
  const openPendingReleaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openPendingRef = useRef(false)
  const [openPending, setOpenPending] = useState(false)
  const lastMessage = conversation.messages.at(-1)
  const lastMessageText = lastMessage ? lastMessage.responseText ?? lastMessage.content : ''
  const lastMessagePreview = useMemo(() => {
    const preview = previewConversationMessage(lastMessageText)
    return preview || t('conversation.noMessagesYet')
  }, [lastMessageText, t])
  const displayTitle = conversation.title.trim() || t('conversation.untitled')
  const secondaryPreview = searchMatchSummary ?? lastMessagePreview
  const searchMatchAccessibilityPreview = searchMatchAccessibilitySummary ?? secondaryPreview
  const rowStatusLabel = lastMessage ? conversationRowStatusLabel(lastMessage.status, t) : ''
  const rowStatusTone = lastMessage ? conversationRowStatusTone(lastMessage.status) : undefined
  const rowStatusToken = rowStatusTone ? colors.ui.tone[rowStatusTone] : undefined
  const rowTimestamp = getConversationUpdatedTimestamp(conversation)
  const rowMeta = useMemo(() => t('conversation.rowMeta', {
    model: modelLabel ?? getModelName(conversation.model),
    messageLabel: formatConversationMessageCount(conversation.messages.length, t),
    time: formatConversationUpdatedAt(rowTimestamp, now, t),
  }), [conversation.messages.length, conversation.model, modelLabel, now, rowTimestamp, t])
  const rowStatusMeta = rowStatusLabel ? t('conversation.rowStatusMeta', { status: rowStatusLabel, meta: rowMeta }) : rowMeta
  const rowAccessibilityMeta = active ? t('conversation.rowActiveMeta', { meta: rowStatusMeta }) : rowStatusMeta
  const rowAccessibilityValue = useMemo(() => t('conversation.rowAccessibilityValue', {
    preview: searchMatchAccessibilityPreview,
    meta: rowAccessibilityMeta,
  }), [rowAccessibilityMeta, searchMatchAccessibilityPreview, t])
  const renameInputAccessibilityValue = useMemo(
    () => ({ text: title.trim() || t('conversation.untitled') }),
    [t, title]
  )

  useEffect(() => {
    setTitle(conversation.title)
  }, [conversation.id, conversation.title])

  useEffect(() => {
    return () => {
      if (renameFocusFrame.current !== null) cancelAnimationFrame(renameFocusFrame.current)
      renameFocusFrame.current = null
      if (openPendingReleaseTimer.current) clearTimeout(openPendingReleaseTimer.current)
      openPendingReleaseTimer.current = null
    }
  }, [])

  const { active: opening, trigger: openConversation } = useNavigationTrigger(() => {
    if (openPendingRef.current) return
    openPendingRef.current = true
    setOpenPending(true)
    scheduleOpenPendingRelease()
    if (onOpen) {
      onOpen(conversation.id)
      return
    }
    select(conversation.id)
    router.push({ pathname: '/chat/[id]', params: { id: conversation.id } })
  })
  const rowBusy = deleteConfirming || opening || openPending
  const rowTemporarilyBlocked = interactionDisabled
  const openInteractionDisabled = renaming || rowBusy
  const rowActionDisabled = rowBusy || rowTemporarilyBlocked
  const rowOpenAccessibilityState = useMemo(
    () => {
      if (rowBusy) return active ? { selected: true, disabled: true, busy: true } : { disabled: true, busy: true }
      if (rowTemporarilyBlocked) return active ? { selected: true, disabled: true, busy: true } : { disabled: true, busy: true }
      return active ? { selected: true } : undefined
    },
    [active, rowBusy, rowTemporarilyBlocked]
  )
  const rowActionAccessibilityState = useMemo(
    () => rowActionDisabled ? { disabled: true, busy: rowBusy || rowTemporarilyBlocked } : undefined,
    [rowActionDisabled, rowBusy, rowTemporarilyBlocked]
  )
  const rowOpenAccessibilityHint = openInteractionDisabled
    ? undefined
    : rowTemporarilyBlocked
      ? t('conversation.interactionPausedMessage')
      : t('conversation.openAccessibilityHint')
  const rowActionPausedAccessibilityHint = rowTemporarilyBlocked
    ? t('conversation.interactionPausedMessage')
    : undefined

  function scheduleOpenPendingRelease() {
    if (openPendingReleaseTimer.current) clearTimeout(openPendingReleaseTimer.current)
    openPendingReleaseTimer.current = setTimeout(() => {
      openPendingReleaseTimer.current = null
      openPendingRef.current = false
      setOpenPending(false)
    }, ROW_OPEN_PENDING_RELEASE_MS)
  }

  function transientInteractionBlocked(): boolean {
    if (rowTemporarilyBlocked) {
      onInteractionBlocked?.()
      return true
    }
    if (isInteractionBlocked?.() !== true) return false
    onInteractionBlocked?.()
    return true
  }

  function guardedOpenConversation() {
    if (transientInteractionBlocked()) return
    openConversation()
  }

  function guardedStartRename() {
    if (transientInteractionBlocked()) return
    startRename()
  }

  function guardedSubmitRename() {
    if (transientInteractionBlocked()) return
    submitRename()
  }

  function guardedCancelRename() {
    if (transientInteractionBlocked()) return
    cancelRename()
  }

  function guardedConfirmDelete() {
    if (transientInteractionBlocked()) return
    confirmDelete()
  }

  function confirmDelete() {
    if (deleteConfirmOpen.current) return
    deleteConfirmOpen.current = true
    setDeleteConfirming(true)
    void (async () => {
      let restoreButton = true
      try {
        const confirmed = await dialog.confirm({
          title: t('conversation.deleteTitle'),
          message: t('conversation.deleteConfirmNamed', { title: displayTitle }),
          tone: 'danger',
          confirmLabel: t('common.delete'),
          cancelLabel: t('common.cancel'),
        })
        if (!confirmed) return
        restoreButton = false
        remove(conversation.id)
        dialog.toast({
          title: t('conversation.deleteCompleted'),
          message: t('conversation.deleteCompletedMessage', { title: displayTitle }),
          tone: 'mint',
          position: 'bottom',
          durationMs: 2400,
        })
      } finally {
        if (restoreButton) {
          deleteConfirmOpen.current = false
          setDeleteConfirming(false)
        }
      }
    })()
  }

  function submitRename() {
    if (renameSubmitHandled.current) return
    if (skipNextRenameSubmit.current) {
      skipNextRenameSubmit.current = false
      renameSubmitHandled.current = true
      return
    }
    renameSubmitHandled.current = true
    const value = title.trim()
    const nextTitle = value || t('conversation.untitled')
    skipNextRenameSubmit.current = false
    setRenaming(false)
    if (nextTitle === displayTitle) return
    rename(conversation.id, nextTitle)
    dialog.toast({
      title: t('conversation.renameSaved'),
      message: t('conversation.renameSavedMessage', { title: nextTitle }),
      tone: 'mint',
      position: 'bottom',
      durationMs: 2200,
    })
  }

  function cancelRename() {
    skipNextRenameSubmit.current = true
    renameSubmitHandled.current = true
    setTitle(conversation.title)
    setRenaming(false)
  }

  function startRename() {
    if (renameFocusFrame.current !== null) cancelAnimationFrame(renameFocusFrame.current)
    skipNextRenameSubmit.current = false
    renameSubmitHandled.current = false
    setRenaming(true)
    renameFocusFrame.current = requestAnimationFrame(() => {
      renameFocusFrame.current = null
      onRenameFocus?.(index)
    })
  }

  function reportRowLayout(event: LayoutChangeEvent) {
    onLayoutHeight?.(conversation.id, Math.ceil(event.nativeEvent.layout.height) + ROW_CONTAINER_BOTTOM_SPACING)
  }

  return (
    <MotiView
      onLayout={reportRowLayout}
      from={animateEntrance ? (motion === 'full' ? { opacity: 0, translateY: 16 } : { opacity: 0 }) : { opacity: 1, translateY: 0 }}
      animate={{ opacity: rowBusy || rowTemporarilyBlocked ? 0.72 : 1, translateY: 0 }}
      transition={animateEntrance
        ? (motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle, delay: Math.min(index * 35, 280) } : { type: 'timing', duration: motionTokens.duration.fast })
        : { type: 'timing', duration: 0 }}
      style={{ marginBottom: ROW_CONTAINER_BOTTOM_SPACING }}
    >
      <IslePanel
        elevated
        material="paper"
        radius={colors.ui.radius.panel}
        style={active ? { borderColor: colors.ui.control.primaryBorder } : undefined}
        contentStyle={{ minHeight: 92, padding: panelPadding }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: rowGap }}>
          {active ? (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                alignSelf: 'stretch',
                width: 4,
                minHeight: 54,
                borderRadius: 999,
                backgroundColor: colors.ui.icon.accentForeground,
                opacity: rowTemporarilyBlocked ? 0.62 : 1,
              }}
            />
          ) : null}
          <IslePressable
            haptic={!openInteractionDisabled && !rowTemporarilyBlocked}
            onPress={openInteractionDisabled ? undefined : guardedOpenConversation}
            onLongPress={openInteractionDisabled ? undefined : guardedStartRename}
            accessibilityRole={renaming ? undefined : 'button'}
            accessibilityLabel={displayTitle}
            accessibilityHint={rowOpenAccessibilityHint}
            accessibilityState={renaming ? undefined : rowOpenAccessibilityState}
            accessibilityValue={renaming ? undefined : { text: rowAccessibilityValue }}
            style={{ flex: 1, minWidth: 0, minHeight: 54, flexDirection: 'row', alignItems: 'flex-start', gap: rowGap }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              {renaming ? (
                <TextInput
                  autoFocus
                  value={title}
                  onChangeText={setTitle}
                  onBlur={submitRename}
                  onSubmitEditing={submitRename}
                  onFocus={() => onRenameFocus?.(index)}
                  accessibilityLabel={t('conversation.renameAccessibilityLabel', { title: displayTitle })}
                  accessibilityHint={t('conversation.saveRenameAccessibilityHint')}
                  accessibilityValue={renameInputAccessibilityValue}
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
                <Text numberOfLines={2} style={{ minWidth: 0, flexShrink: 1, color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '900', includeFontPadding: false }}>
                  {displayTitle}
                </Text>
              )}
              {searchMatchSummary && searchMatchFieldLabel ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 7,
                    marginTop: 8,
                    minWidth: 0,
                    borderRadius: colors.ui.radius.card,
                    paddingHorizontal: 8,
                    paddingVertical: 7,
                    backgroundColor: colors.ui.card.mutedBackground,
                    borderWidth: 1,
                    borderColor: colors.material.stroke,
                  }}
                >
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{
                      minHeight: 20,
                      maxWidth: compact ? 74 : 96,
                      borderRadius: colors.ui.radius.chip,
                      paddingHorizontal: 7,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      backgroundColor: colors.ui.card.defaultBackground,
                      borderWidth: 1,
                      borderColor: colors.ui.control.primaryBorder,
                    }}
                  >
                    <Text numberOfLines={1} style={{ color: colors.ui.icon.accentForeground, fontSize: 11, lineHeight: 14, fontWeight: '900', includeFontPadding: false }}>
                      {searchMatchFieldLabel}
                    </Text>
                  </View>
                  <Text numberOfLines={compact ? 2 : 3} style={{ flex: 1, minWidth: 0, flexShrink: 1, color: colors.ui.icon.accentForeground, fontSize: 13, lineHeight: 18, fontWeight: '800', includeFontPadding: false }}>
                    {secondaryPreview}
                  </Text>
                </View>
              ) : (
                <Text numberOfLines={1} style={{ minWidth: 0, flexShrink: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 6, fontWeight: '700', includeFontPadding: false }}>
                  {secondaryPreview}
                </Text>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {active ? (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{
                      minHeight: 20,
                      borderRadius: colors.ui.radius.chip,
                      paddingHorizontal: 8,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.ui.control.primaryBackground,
                      borderWidth: 1,
                      borderColor: colors.ui.control.primaryBorder,
                    }}
                  >
                    <Text numberOfLines={1} style={{ color: colors.ui.control.primaryForeground, fontSize: 11, lineHeight: 14, fontWeight: '900', includeFontPadding: false }}>
                      {t('conversation.current')}
                    </Text>
                  </View>
                ) : null}
                {rowStatusLabel && rowStatusToken ? (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{
                      minHeight: 20,
                      borderRadius: colors.ui.radius.chip,
                      paddingHorizontal: 8,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: rowStatusToken.background,
                      borderWidth: 1,
                      borderColor: rowStatusToken.border,
                    }}
                  >
                    <Text numberOfLines={1} style={{ color: rowStatusToken.foreground, fontSize: 11, lineHeight: 14, fontWeight: '900', includeFontPadding: false }}>
                      {rowStatusLabel}
                    </Text>
                  </View>
                ) : null}
                <Text numberOfLines={1} style={{ minWidth: 0, flexShrink: 1, color: colors.textTertiary, fontSize: 12, lineHeight: 16, fontWeight: '900', includeFontPadding: false }}>{rowMeta}</Text>
              </View>
            </View>
            {compact ? null : (
              <NavigationIconBadge>
                <AnimatedNavigationIcon glyph="conversation" active={opening || openPending} color={colors.textSecondary} accentColor={colors.ui.icon.accentForeground} />
              </NavigationIconBadge>
            )}
          </IslePressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: actionGap, flexShrink: 0 }}>
            <IslePressable
              onPress={rowActionDisabled ? undefined : renaming ? guardedSubmitRename : guardedStartRename}
              disabled={rowActionDisabled}
              accessibilityRole="button"
              accessibilityLabel={renaming ? t('common.save') : t('conversation.rename')}
              accessibilityHint={rowActionPausedAccessibilityHint ?? (renaming ? t('conversation.saveRenameAccessibilityHint') : t('conversation.renameAccessibilityHint'))}
              accessibilityState={rowActionAccessibilityState ?? (renaming ? { selected: true } : undefined)}
              hitSlop={ROW_ACTION_HIT_SLOP}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: colors.ui.radius.controlMiddle, backgroundColor: renaming ? colors.ui.control.primaryBackground : colors.ui.card.defaultBackground, borderWidth: 1, borderColor: renaming ? colors.ui.control.primaryBorder : colors.material.stroke, opacity: rowActionDisabled ? 0.55 : 1 }}
            >
              {renaming
                ? <Check color={colors.ui.control.primaryForeground} size={18} strokeWidth={2.2} />
                : <PencilLine color={colors.textSecondary} size={18} strokeWidth={1.8} />}
            </IslePressable>
            {renaming ? (
              <IslePressable
                onPress={rowActionDisabled ? undefined : guardedCancelRename}
                onPressIn={() => {
                  if (rowActionDisabled || transientInteractionBlocked()) return
                  skipNextRenameSubmit.current = true
                }}
                disabled={rowActionDisabled}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
                accessibilityHint={rowActionPausedAccessibilityHint ?? t('conversation.cancelRenameAccessibilityHint')}
                accessibilityState={rowActionAccessibilityState}
                hitSlop={ROW_ACTION_HIT_SLOP}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: colors.ui.radius.controlMiddle, backgroundColor: colors.ui.card.defaultBackground, borderWidth: 1, borderColor: colors.material.stroke, opacity: rowActionDisabled ? 0.55 : 1 }}
              >
                <X color={colors.textSecondary} size={18} strokeWidth={2} />
              </IslePressable>
            ) : (
              <IslePressable
                onPress={rowActionDisabled ? undefined : guardedConfirmDelete}
                disabled={rowActionDisabled}
                accessibilityRole="button"
                accessibilityLabel={t('conversation.deleteAccessibilityLabel', { title: displayTitle })}
                accessibilityHint={rowActionPausedAccessibilityHint ?? t('conversation.deleteAccessibilityHint')}
                accessibilityState={rowActionAccessibilityState}
                hitSlop={ROW_ACTION_HIT_SLOP}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: colors.ui.radius.controlMiddle, backgroundColor: colors.ui.tone.danger.background, borderWidth: 1, borderColor: colors.ui.tone.danger.border, opacity: rowActionDisabled ? 0.55 : 1 }}
              >
                <Trash2 color={colors.ui.tone.danger.foreground} size={18} strokeWidth={1.8} />
              </IslePressable>
            )}
          </View>
        </View>
      </IslePanel>
    </MotiView>
  )
}, areConversationRowPropsEqual)

function areConversationRowPropsEqual(previous: ConversationRowProps, next: ConversationRowProps): boolean {
  if (
    !areConversationRowConversationsEqual(previous.conversation, next.conversation) ||
    previous.index !== next.index ||
    previous.active !== next.active ||
    previous.animateEntrance !== next.animateEntrance ||
    previous.interactionDisabled !== next.interactionDisabled ||
    previous.isInteractionBlocked !== next.isInteractionBlocked ||
    previous.onInteractionBlocked !== next.onInteractionBlocked ||
    previous.modelLabel !== next.modelLabel ||
    previous.onOpen !== next.onOpen ||
    previous.onRenameFocus !== next.onRenameFocus ||
    previous.onLayoutHeight !== next.onLayoutHeight ||
    previous.searchMatchSummary !== next.searchMatchSummary ||
    previous.searchMatchFieldLabel !== next.searchMatchFieldLabel ||
    previous.searchMatchAccessibilitySummary !== next.searchMatchAccessibilitySummary
  ) return false

  const previousTimestamp = getConversationUpdatedTimestamp(previous.conversation)
  const nextTimestamp = getConversationUpdatedTimestamp(next.conversation)
  if (previousTimestamp !== nextTimestamp) return false
  return getRelativeTimeRenderToken(previousTimestamp, previous.now ?? Date.now()) === getRelativeTimeRenderToken(nextTimestamp, next.now ?? Date.now())
}

function areConversationRowConversationsEqual(previous: Conversation, next: Conversation): boolean {
  if (previous === next) return true
  if (
    previous.id !== next.id ||
    previous.title !== next.title ||
    previous.model !== next.model ||
    previous.messages.length !== next.messages.length ||
    previous.createdAt !== next.createdAt ||
    previous.updatedAt !== next.updatedAt
  ) return false

  const previousLastMessage = previous.messages.at(-1)
  const nextLastMessage = next.messages.at(-1)
  return (
      previousLastMessage?.timestamp === nextLastMessage?.timestamp &&
      previousLastMessage?.status === nextLastMessage?.status &&
      previousLastMessage?.content === nextLastMessage?.content &&
      previousLastMessage?.responseText === nextLastMessage?.responseText
  )
}

function previewConversationMessage(content: string): string {
  const source = content.length > ROW_MESSAGE_PREVIEW_SCAN_LIMIT
    ? `${content.slice(0, Math.floor(ROW_MESSAGE_PREVIEW_SCAN_LIMIT * 0.62))}${ROW_MESSAGE_PREVIEW_SEPARATOR}${content.slice(content.length - Math.floor(ROW_MESSAGE_PREVIEW_SCAN_LIMIT * 0.38))}`
    : content
  const compact = source.replace(/\s+/g, ' ').trim()
  if (compact.length <= ROW_MESSAGE_PREVIEW_LIMIT) return compact
  const headLength = Math.max(0, Math.floor((ROW_MESSAGE_PREVIEW_LIMIT - ROW_MESSAGE_PREVIEW_SEPARATOR.length) * 0.62))
  const tailLength = Math.max(0, ROW_MESSAGE_PREVIEW_LIMIT - ROW_MESSAGE_PREVIEW_SEPARATOR.length - headLength)
  return `${compact.slice(0, headLength).trimEnd()}${ROW_MESSAGE_PREVIEW_SEPARATOR}${compact.slice(compact.length - tailLength).trimStart()}`
}

function getConversationUpdatedTimestamp(conversation: Conversation): number | undefined {
  return conversation.updatedAt || conversation.messages.at(-1)?.timestamp || conversation.createdAt
}

function getRelativeTimeRenderToken(timestamp: number | undefined, now: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return 'unknown'
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < ROW_MINUTE_MS) return 'just-now'
  if (elapsed < ROW_HOUR_MS) return `minute:${Math.max(1, Math.floor(elapsed / ROW_MINUTE_MS))}`
  if (elapsed < ROW_DAY_MS) return `hour:${Math.max(1, Math.floor(elapsed / ROW_HOUR_MS))}`
  if (elapsed < 7 * ROW_DAY_MS) return `day:${Math.max(1, Math.floor(elapsed / ROW_DAY_MS))}`
  return `date:${new Date(timestamp).toISOString().slice(0, 10)}`
}

function formatConversationMessageCount(count: number, t: TFunction): string {
  return t(count === 1 ? 'conversation.messageCountOne' : 'conversation.messageCountOther', { count })
}

function conversationRowStatusLabel(status: Conversation['messages'][number]['status'], t: TFunction): string {
  switch (status) {
    case 'sending':
      return t('conversation.rowStatusSending')
    case 'streaming':
      return t('conversation.rowStatusStreaming')
    case 'error':
      return t('conversation.rowStatusError')
    case 'cancelled':
      return t('conversation.rowStatusCancelled')
    case 'done':
      return ''
  }
}

function conversationRowStatusTone(status: Conversation['messages'][number]['status']): 'warning' | 'danger' | undefined {
  switch (status) {
    case 'sending':
    case 'streaming':
    case 'cancelled':
      return 'warning'
    case 'error':
      return 'danger'
    case 'done':
      return undefined
  }
}

function formatConversationUpdatedAt(timestamp: number | undefined, now: number, t: TFunction): string {
  if (!timestamp || !Number.isFinite(timestamp)) return t('conversation.updatedUnknown')
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < ROW_MINUTE_MS) return t('conversation.updatedJustNow')
  if (elapsed < ROW_HOUR_MS) return t('conversation.updatedMinutesAgo', { count: Math.max(1, Math.floor(elapsed / ROW_MINUTE_MS)) })
  if (elapsed < ROW_DAY_MS) return t('conversation.updatedHoursAgo', { count: Math.max(1, Math.floor(elapsed / ROW_HOUR_MS)) })
  if (elapsed < 7 * ROW_DAY_MS) return t('conversation.updatedDaysAgo', { count: Math.max(1, Math.floor(elapsed / ROW_DAY_MS)) })
  return t('conversation.updatedDate', { date: new Date(timestamp).toISOString().slice(0, 10) })
}
