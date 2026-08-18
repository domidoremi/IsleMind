import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, TextInput, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native'
import type { TFunction } from 'i18next'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { MotiView } from 'moti'
import { useNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import type { Conversation } from '@/types/chatContracts'
import { getModelName } from '@/types/modelCatalog'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { IslePressable } from '@/components/ui/isle'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { useIsleDialog } from '@/components/ui/isle'
import type { ThemeId } from '@/types/settingsContracts'
import { HistoryRowContent, HistoryRowFrame, type HistoryVisualTokens } from '@/components/main/history/HistoryPresentation'

const ROW_MESSAGE_PREVIEW_LIMIT = 180
const ROW_MESSAGE_PREVIEW_SCAN_LIMIT = 1200
const ROW_MESSAGE_PREVIEW_SEPARATOR = ' ... '
const ROW_ACTION_HIT_SLOP = { top: 10, right: 10, bottom: 10, left: 10 }
const ROW_CONTAINER_BOTTOM_SPACING = 0
const ROW_MINUTE_MS = 60 * 1000
const ROW_HOUR_MS = 60 * ROW_MINUTE_MS
const ROW_DAY_MS = 24 * ROW_HOUR_MS
const ROW_OPEN_PENDING_RELEASE_MS = 700

interface ConversationRowProps {
  conversation: Conversation
  index: number
  themeId: ThemeId
  active?: boolean
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

export const ConversationRow = memo(function ConversationRow({ conversation, index, themeId, active = false, interactionDisabled = false, now = Date.now(), isInteractionBlocked, onInteractionBlocked, modelLabel, onOpen, onRenameFocus, onLayoutHeight, searchMatchSummary, searchMatchFieldLabel, searchMatchAccessibilitySummary }: ConversationRowProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const { width } = useWindowDimensions()
  const compact = width < 390
  const remove = useChatStore((state) => state.delete)
  const rename = useChatStore((state) => state.rename)
  const select = useChatStore((state) => state.select)
  const dialog = useIsleDialog()
  const [renaming, setRenaming] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
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
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const iconActionSurface = colors.ui.semantic.surface.muted
  const iconActionBorder = colors.ui.semantic.chrome.border
  const historyVisualTokens = useMemo<HistoryVisualTokens>(() => ({
    text: colors.text,
    textSecondary: colors.textSecondary,
    textTertiary: colors.textTertiary,
    canvas: colors.ui.semantic.surface.canvas,
    surface: colors.ui.semantic.surface.base,
    surfaceMuted: colors.ui.semantic.surface.muted,
    border: colors.ui.semantic.chrome.border,
    borderStrong: colors.material.strokeStrong,
    accent: colors.ui.icon.accentForeground,
    accentBackground: colors.ui.icon.accentBackground,
    accentBorder: colors.ui.control.primaryBorder,
    dangerBackground: colors.ui.tone.danger.background,
    dangerForeground: colors.ui.tone.danger.foreground,
    dangerBorder: colors.ui.tone.danger.border,
  }), [colors])

  useEffect(() => {
    setTitle(conversation.title)
    setActionsOpen(false)
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
    router.push({ pathname: '/chat/[id]', params: { id: conversation.id, returnTo: 'history' } })
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
        setActionsOpen(false)
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
    setActionsOpen(false)
  }

  function startRename() {
    if (renameFocusFrame.current !== null) cancelAnimationFrame(renameFocusFrame.current)
    skipNextRenameSubmit.current = false
    renameSubmitHandled.current = false
    setActionsOpen(false)
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
      animate={{ opacity: rowBusy || rowTemporarilyBlocked ? 0.72 : 1, translateY: 0 }}
      transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
      style={{ marginBottom: ROW_CONTAINER_BOTTOM_SPACING }}
    >
      <HistoryRowFrame
        themeId={themeId}
        tokens={historyVisualTokens}
        compact={compact}
        index={index}
        active={active}
        content={
          <IslePressable
            haptic={!openInteractionDisabled && !rowTemporarilyBlocked}
            onPress={openInteractionDisabled ? undefined : guardedOpenConversation}
            onLongPress={openInteractionDisabled ? undefined : guardedStartRename}
            accessibilityRole={renaming ? undefined : 'button'}
            accessibilityLabel={displayTitle}
            accessibilityHint={rowOpenAccessibilityHint}
            accessibilityState={renaming ? undefined : rowOpenAccessibilityState}
            accessibilityValue={renaming ? undefined : { text: rowAccessibilityValue }}
            style={{ flex: 1, minWidth: 0, minHeight: 54 }}
          >
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
                  fontSize: historyRenameInputFontSize(themeId),
                  fontWeight: '700',
                  minHeight: 46,
                  paddingHorizontal: 0,
                  paddingVertical: 6,
                  textAlignVertical: 'center',
                }}
              />
            ) : (
              <HistoryRowContent
                themeId={themeId}
                tokens={historyVisualTokens}
                title={displayTitle}
                preview={lastMessagePreview}
                meta={rowMeta}
                active={active}
                activeLabel={t('conversation.current')}
                searchMatchSummary={searchMatchSummary}
                searchMatchFieldLabel={searchMatchFieldLabel}
                statusLabel={rowStatusLabel || undefined}
                statusColor={rowStatusToken?.foreground}
              />
            )}
          </IslePressable>
        }
        actions={renaming ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <IslePressable
              onPress={rowActionDisabled ? undefined : guardedSubmitRename}
              disabled={rowActionDisabled}
              accessibilityRole="button"
              accessibilityLabel={t('common.save')}
              accessibilityHint={rowActionPausedAccessibilityHint ?? t('conversation.saveRenameAccessibilityHint')}
              accessibilityState={rowActionAccessibilityState ?? { selected: true }}
              hitSlop={ROW_ACTION_HIT_SLOP}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.ui.control.primaryBackground, borderWidth: subtleBorderWidth, borderColor: colors.ui.control.primaryBorder, opacity: rowActionDisabled ? 0.55 : 1 }}
            >
              <AppIcon name="check" color={colors.ui.control.primaryForeground} size={17} strokeWidth={appIconStroke.strong} />
            </IslePressable>
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
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: iconActionSurface, borderWidth: subtleBorderWidth, borderColor: iconActionBorder, opacity: rowActionDisabled ? 0.55 : 1 }}
            >
              <AppIcon name="close" color={colors.textSecondary} size={17} />
            </IslePressable>
          </View>
        ) : (
          <IslePressable
            onPress={rowActionDisabled ? undefined : () => setActionsOpen((current) => !current)}
            disabled={rowActionDisabled}
            accessibilityRole="button"
            accessibilityLabel={`${t('messageBubble.actions')}: ${displayTitle}`}
            accessibilityHint={rowActionPausedAccessibilityHint}
            accessibilityState={rowActionAccessibilityState ?? { expanded: actionsOpen }}
            hitSlop={ROW_ACTION_HIT_SLOP}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, opacity: rowActionDisabled ? 0.55 : actionsOpen ? 1 : 0.72 }}
          >
            <AppIcon name={actionsOpen ? 'close' : 'more'} color={actionsOpen ? colors.ui.icon.accentForeground : colors.textSecondary} size={18} strokeWidth={appIconStroke.strong} />
          </IslePressable>
        )}
        expandedActions={actionsOpen && !renaming ? (
          <MotiView
            from={motion === 'full' ? { opacity: 0, translateY: -3 } : { opacity: 1 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: motion === 'full' ? 112 : 1 }}
            style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginTop: 9 }}
          >
            <IslePressable
              onPress={rowActionDisabled ? undefined : guardedStartRename}
              disabled={rowActionDisabled}
              accessibilityRole="button"
              accessibilityLabel={t('conversation.rename')}
              accessibilityHint={rowActionPausedAccessibilityHint ?? t('conversation.renameAccessibilityHint')}
              accessibilityState={rowActionAccessibilityState}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: iconActionSurface, borderWidth: subtleBorderWidth, borderColor: iconActionBorder }}
            >
              <AppIcon name="edit" color={colors.textSecondary} size={17} strokeWidth={appIconStroke.fine} />
            </IslePressable>
            <IslePressable
              onPress={rowActionDisabled ? undefined : guardedConfirmDelete}
              disabled={rowActionDisabled}
              accessibilityRole="button"
              accessibilityLabel={t('conversation.deleteAccessibilityLabel', { title: displayTitle })}
              accessibilityHint={rowActionPausedAccessibilityHint ?? t('conversation.deleteAccessibilityHint')}
              accessibilityState={rowActionAccessibilityState}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.ui.tone.danger.background, borderWidth: subtleBorderWidth, borderColor: colors.ui.tone.danger.border }}
            >
              <AppIcon name="delete" color={colors.ui.tone.danger.foreground} size={17} strokeWidth={appIconStroke.fine} />
            </IslePressable>
          </MotiView>
        ) : null}
      />
    </MotiView>
  )
}, areConversationRowPropsEqual)

function areConversationRowPropsEqual(previous: ConversationRowProps, next: ConversationRowProps): boolean {
  if (
    !areConversationRowConversationsEqual(previous.conversation, next.conversation) ||
    previous.index !== next.index ||
    previous.themeId !== next.themeId ||
    previous.active !== next.active ||
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
      previousLastMessage?.responseText === nextLastMessage?.responseText &&
      previousLastMessage?.durationMs === nextLastMessage?.durationMs &&
      previousLastMessage?.tokenCount === nextLastMessage?.tokenCount &&
      previousLastMessage?.usage?.totalTokens === nextLastMessage?.usage?.totalTokens &&
      previousLastMessage?.usage?.inputTokens === nextLastMessage?.usage?.inputTokens &&
      previousLastMessage?.usage?.outputTokens === nextLastMessage?.usage?.outputTokens
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

function historyRenameInputFontSize(themeId: ThemeId): number {
  switch (themeId) {
    case 'markdown':
      return 14.5
    case 'lime-road':
    case 'minimal':
    default:
      return 15.5
  }
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
