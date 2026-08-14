import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppIcon, appIconStroke, type AppIconName } from '@/components/ui/AppIcon'
import { IsleOverlayPressable, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

import {
  presentChatWorkspaceReview,
  type ChatWorkspaceReviewKind,
  type ChatWorkspaceReviewPresentedWriteback,
  type ChatWorkspaceReviewProjection,
  type ChatWorkspaceReviewStatus,
} from './chatWorkspaceReviewPresentation'

export type ChatWorkspaceReviewConfirmationRequest =
  | { kind: 'approve-writeback'; writebackId: string }
  | { kind: 'dismiss-writeback'; writebackId: string }
  | { kind: 'clear-private-memory' }

export type ChatWorkspaceReviewBusyAction =
  | { kind: 'refresh' }
  | ChatWorkspaceReviewConfirmationRequest

export interface ChatWorkspaceReviewLabels {
  title: string
  subtitle: string
  close: string
  closeHint: string
  refresh: string
  refreshHint: string
  loading: string
  errorTitle: string
  pendingListTitle: string
  emptyState: string
  privateMemoryTitle: string
  approve: string
  dismiss: string
  confirm: string
  cancel: string
  confirmHint: string
  cancelHint: string
  clearPrivateMemory: string
  clearPrivateMemoryHint: string
  formatPendingWritebackCount: (count: number) => string
  formatReviewUnitCount: (count: number) => string
  formatPrivateMemoryCount: (count: number) => string
  formatHiddenWritebackCount: (count: number) => string
  formatWritebackPosition: (position: number, total: number) => string
  formatWritebackAccessibilityLabel: (input: {
    position: number
    total: number
    status: ChatWorkspaceReviewStatus
    reviewUnitCount: number
    kindCounts: readonly { kind: ChatWorkspaceReviewKind; count: number }[]
  }) => string
  formatApproveHint: (position: number) => string
  formatDismissHint: (position: number) => string
  formatKindCount: (kind: ChatWorkspaceReviewKind, count: number) => string
  formatPrivateMemoryDescription: (count: number) => string
  formatConfirmationTitle: (request: ChatWorkspaceReviewConfirmationRequest) => string
  formatConfirmationDescription: (request: ChatWorkspaceReviewConfirmationRequest) => string
  statusLabels: Readonly<Record<ChatWorkspaceReviewStatus, string>>
}

export interface ChatWorkspaceReviewSheetProps {
  open: boolean
  loading: boolean
  busyAction: ChatWorkspaceReviewBusyAction | null
  error: string | null
  projection: ChatWorkspaceReviewProjection | null
  confirmation: ChatWorkspaceReviewConfirmationRequest | null
  labels: ChatWorkspaceReviewLabels
  onApprove: (writebackId: string) => void | Promise<void>
  onDismiss: (writebackId: string) => void | Promise<void>
  onClearPrivateMemory: () => void | Promise<void>
  onRefresh: () => void | Promise<void>
  onClose: () => void
  onRequestConfirmation: (request: ChatWorkspaceReviewConfirmationRequest) => void
  onCancelConfirmation: (request: ChatWorkspaceReviewConfirmationRequest) => void
}

export function ChatWorkspaceReviewSheet({
  open,
  loading,
  busyAction,
  error,
  projection,
  confirmation,
  labels,
  onApprove,
  onDismiss,
  onClearPrivateMemory,
  onRefresh,
  onClose,
  onRequestConfirmation,
  onCancelConfirmation,
}: ChatWorkspaceReviewSheetProps) {
  const { colors, isGlass } = useAppTheme()
  const insets = useSafeAreaInsets()
  const { height, width } = useWindowDimensions()
  const presentation = projection ? presentChatWorkspaceReview(projection) : null
  const controlsBusy = loading || busyAction !== null
  const mutationsDisabled = controlsBusy || error !== null
  const compact = width < 440
  const sheetWidth = Math.min(640, width)
  const listMaxHeight = Math.min(360, Math.max(152, height - 430))
  const sheetMaterial = colors.material.sheet
  const borderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const confirmationAvailable = confirmation
    ? error
      ? false
      : confirmation.kind === 'clear-private-memory'
      ? !!presentation?.canClearPrivateMemory && presentation.privateMemoryCount > 0
      : !!presentation?.writebacks.some((writeback) => (
        writeback.id === confirmation.writebackId && (
          confirmation.kind === 'approve-writeback' ? writeback.canApprove : writeback.canDismiss
        )
      ))
    : false

  function requestApproval(writeback: ChatWorkspaceReviewPresentedWriteback) {
    if (writeback.approveConfirmationRequired) {
      onRequestConfirmation({ kind: 'approve-writeback', writebackId: writeback.id })
      return
    }
    void onApprove(writeback.id)
  }

  function confirmRequest(request: ChatWorkspaceReviewConfirmationRequest) {
    if (request.kind === 'approve-writeback') {
      void onApprove(request.writebackId)
      return
    }
    if (request.kind === 'dismiss-writeback') {
      void onDismiss(request.writebackId)
      return
    }
    void onClearPrivateMemory()
  }

  return (
    <Modal
      transparent
      visible={open}
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <IsleOverlayPressable
          accessibilityLabel={labels.close}
          accessibilityHint={labels.closeHint}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]}
        />
        <View
          accessibilityViewIsModal
          style={{
            width: sheetWidth,
            maxHeight: Math.max(360, height - Math.max(insets.top, 16) - 16),
            alignSelf: 'center',
            borderTopLeftRadius: Math.min(colors.ui.radius.modal, 8),
            borderTopRightRadius: Math.min(colors.ui.radius.modal, 8),
            backgroundColor: sheetMaterial.surface,
            borderWidth,
            borderBottomWidth: 0,
            borderColor: sheetMaterial.border,
            overflow: 'hidden',
          }}
          testID="chat-workspace-review-sheet"
        >
          <View style={[styles.header, { backgroundColor: sheetMaterial.chrome, borderBottomColor: sheetMaterial.divider, borderBottomWidth: borderWidth }]}>
            <View style={styles.headerCopy}>
              <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>{labels.title}</Text>
              <Text numberOfLines={2} style={[styles.subtitle, { color: colors.textSecondary }]}>{labels.subtitle}</Text>
            </View>
            <IconAction
              icon="refresh"
              label={labels.refresh}
              hint={labels.refreshHint}
              disabled={controlsBusy}
              busy={busyAction?.kind === 'refresh'}
              onPress={() => void onRefresh()}
            />
            <IconAction icon="close" label={labels.close} hint={labels.closeHint} onPress={onClose} />
          </View>

          <View style={[styles.body, { paddingBottom: Math.max(insets.bottom, 12), backgroundColor: sheetMaterial.body }]}>
            {presentation ? (
              <View
                key={`${presentation.pendingWritebackCount}:${presentation.reviewUnitCount}:${presentation.privateMemoryCount}`}
                accessibilityRole="summary"
                accessibilityLiveRegion="polite"
                style={[styles.summary, { borderBottomColor: sheetMaterial.divider, borderBottomWidth: borderWidth }]}
              >
                <SummaryMetric label={labels.formatPendingWritebackCount(presentation.pendingWritebackCount)} />
                <View style={[styles.summaryDivider, { backgroundColor: sheetMaterial.divider }]} />
                <SummaryMetric label={labels.formatReviewUnitCount(presentation.reviewUnitCount)} />
                <View style={[styles.summaryDivider, { backgroundColor: sheetMaterial.divider }]} />
                <SummaryMetric label={labels.formatPrivateMemoryCount(presentation.privateMemoryCount)} />
              </View>
            ) : null}

            {error ? (
              <View
                accessibilityRole="alert"
                style={[styles.notice, { backgroundColor: colors.ui.tone.danger.background, borderColor: colors.ui.tone.danger.border, borderWidth }]}
              >
                <AppIcon name="warning" color={colors.ui.tone.danger.foreground} size={16} strokeWidth={appIconStroke.strong} />
                <View style={styles.noticeCopy}>
                  <Text style={[styles.noticeTitle, { color: colors.ui.tone.danger.foreground }]}>{labels.errorTitle}</Text>
                  <Text numberOfLines={3} style={[styles.noticeDescription, { color: colors.ui.tone.danger.foreground }]}>{error}</Text>
                </View>
              </View>
            ) : null}

            {loading && !presentation ? (
              <View accessibilityRole="progressbar" accessibilityLabel={labels.loading} style={styles.loadingState}>
                <ActivityIndicator color={colors.ui.icon.accentForeground} size="small" />
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>{labels.loading}</Text>
              </View>
            ) : presentation ? (
              <>
                <View style={styles.sectionHeader}>
                  <Text numberOfLines={1} style={[styles.sectionTitle, { color: colors.text }]}>{labels.pendingListTitle}</Text>
                  {presentation.hiddenPendingWritebackCount > 0 ? (
                    <Text numberOfLines={1} style={[styles.overflowText, { color: colors.textTertiary }]}>
                      {labels.formatHiddenWritebackCount(presentation.hiddenPendingWritebackCount)}
                    </Text>
                  ) : null}
                </View>

                {presentation.writebacks.length > 0 ? (
                  <ScrollView
                    accessibilityRole="list"
                    style={{ maxHeight: listMaxHeight }}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={presentation.writebacks.length > 4}
                  >
                    {presentation.writebacks.map((writeback, index) => (
                      <ReviewWritebackRow
                        key={`${writeback.id}:${index}`}
                        writeback={writeback}
                        position={index + 1}
                        total={presentation.pendingWritebackCount}
                        labels={labels}
                        compact={compact}
                        disabled={mutationsDisabled || confirmation !== null}
                        approving={busyAction?.kind === 'approve-writeback' && busyAction.writebackId === writeback.id}
                        dismissing={busyAction?.kind === 'dismiss-writeback' && busyAction.writebackId === writeback.id}
                        onApprove={() => requestApproval(writeback)}
                        onDismiss={() => onRequestConfirmation({ kind: 'dismiss-writeback', writebackId: writeback.id })}
                      />
                    ))}
                  </ScrollView>
                ) : (
                  <View style={styles.emptyState}>
                    <AppIcon name="check" color={colors.ui.tone.success.foreground} size={18} strokeWidth={appIconStroke.strong} />
                    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{labels.emptyState}</Text>
                  </View>
                )}

                <View style={[styles.privateMemory, { borderTopColor: sheetMaterial.divider, borderTopWidth: borderWidth }]}>
                  <View style={[styles.privateMemoryIcon, { backgroundColor: colors.ui.icon.accentBackground }]}>
                    <AppIcon name="lock" color={colors.ui.icon.accentForeground} size={16} strokeWidth={appIconStroke.strong} />
                  </View>
                  <View style={styles.privateMemoryCopy}>
                    <Text numberOfLines={1} style={[styles.privateMemoryTitle, { color: colors.text }]}>{labels.privateMemoryTitle}</Text>
                    <Text numberOfLines={2} style={[styles.privateMemoryDescription, { color: colors.textSecondary }]}>
                      {labels.formatPrivateMemoryDescription(presentation.privateMemoryCount)}
                    </Text>
                  </View>
                  <ActionButton
                    icon="delete"
                    label={labels.clearPrivateMemory}
                    hint={labels.clearPrivateMemoryHint}
                    tone="danger"
                    disabled={mutationsDisabled || confirmation !== null || !presentation.canClearPrivateMemory || presentation.privateMemoryCount <= 0}
                    busy={busyAction?.kind === 'clear-private-memory'}
                    onPress={() => onRequestConfirmation({ kind: 'clear-private-memory' })}
                  />
                </View>
              </>
            ) : null}

            {confirmation ? (
              <View
                accessibilityRole="alert"
                style={[styles.confirmation, { backgroundColor: colors.ui.tone.warning.background, borderColor: colors.ui.tone.warning.border, borderWidth }]}
              >
                <View style={styles.confirmationPrompt}>
                  <AppIcon name="shield" color={colors.ui.tone.warning.foreground} size={17} strokeWidth={appIconStroke.strong} />
                  <View style={styles.confirmationCopy}>
                    <Text style={[styles.confirmationTitle, { color: colors.ui.tone.warning.foreground }]}>
                      {labels.formatConfirmationTitle(confirmation)}
                    </Text>
                    <Text numberOfLines={3} style={[styles.confirmationDescription, { color: colors.ui.tone.warning.foreground }]}>
                      {labels.formatConfirmationDescription(confirmation)}
                    </Text>
                  </View>
                </View>
                <View style={styles.confirmationActions}>
                  <ActionButton
                    icon="close"
                    label={labels.cancel}
                    hint={labels.cancelHint}
                    disabled={busyAction !== null}
                    onPress={() => onCancelConfirmation(confirmation)}
                  />
                  <ActionButton
                    icon="check"
                    label={labels.confirm}
                    hint={labels.confirmHint}
                    tone={confirmation.kind === 'approve-writeback' ? 'primary' : 'danger'}
                    disabled={!confirmationAvailable || busyAction !== null}
                    busy={isSameAction(busyAction, confirmation)}
                    onPress={() => confirmRequest(confirmation)}
                  />
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  )
}

function SummaryMetric({ label }: { label: string }) {
  const { colors } = useAppTheme()
  return <Text numberOfLines={2} style={[styles.summaryMetric, { color: colors.textSecondary }]}>{label}</Text>
}

function ReviewWritebackRow({
  writeback,
  position,
  total,
  labels,
  compact,
  disabled,
  approving,
  dismissing,
  onApprove,
  onDismiss,
}: {
  writeback: ChatWorkspaceReviewPresentedWriteback
  position: number
  total: number
  labels: ChatWorkspaceReviewLabels
  compact: boolean
  disabled: boolean
  approving: boolean
  dismissing: boolean
  onApprove: () => void
  onDismiss: () => void
}) {
  const { colors } = useAppTheme()
  const statusTone = reviewStatusTone(colors, writeback.status)
  const kindSummary = writeback.kindCounts.length > 0
    ? writeback.kindCounts.map(({ kind, count }) => labels.formatKindCount(kind, count)).join('  ')
    : labels.formatReviewUnitCount(writeback.reviewUnitCount)

  return (
    <View
      accessible
      accessibilityLabel={labels.formatWritebackAccessibilityLabel({
        position,
        total,
        status: writeback.status,
        reviewUnitCount: writeback.reviewUnitCount,
        kindCounts: writeback.kindCounts,
      })}
      style={[
        styles.writebackRow,
        compact && styles.writebackRowCompact,
        { borderBottomColor: colors.ui.section.divider, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
      testID={`chat-workspace-review-row-${position}`}
    >
      <View style={styles.writebackCopy}>
        <View style={styles.writebackHeading}>
          <Text numberOfLines={1} style={[styles.writebackPosition, { color: colors.text }]}>
            {labels.formatWritebackPosition(position, total)}
          </Text>
          <View style={[styles.status, { backgroundColor: statusTone.background, borderColor: statusTone.border }]}>
            <Text numberOfLines={1} style={[styles.statusText, { color: statusTone.foreground }]}>{labels.statusLabels[writeback.status]}</Text>
          </View>
        </View>
        <Text numberOfLines={2} style={[styles.kindSummary, { color: colors.textSecondary }]}>{kindSummary}</Text>
      </View>
      <View style={[styles.rowActions, compact && styles.rowActionsCompact]}>
        <ActionButton
          icon="check"
          label={labels.approve}
          hint={labels.formatApproveHint(position)}
          tone="primary"
          disabled={disabled || !writeback.canApprove}
          busy={approving}
          onPress={onApprove}
        />
        <ActionButton
          icon="close"
          label={labels.dismiss}
          hint={labels.formatDismissHint(position)}
          tone="danger"
          disabled={disabled || !writeback.canDismiss}
          busy={dismissing}
          onPress={onDismiss}
        />
      </View>
    </View>
  )
}

function IconAction({
  icon,
  label,
  hint,
  disabled = false,
  busy = false,
  onPress,
}: {
  icon: AppIconName
  label: string
  hint: string
  disabled?: boolean
  busy?: boolean
  onPress: () => void
}) {
  const { colors, isGlass } = useAppTheme()
  const surface = isGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  return (
    <IslePressable
      haptic
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={{
        width: 44,
        height: 44,
        borderRadius: Math.min(colors.ui.radius.controlLarge, 8),
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: surface,
        borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
        borderColor: isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border,
      }}
    >
      {busy
        ? <ActivityIndicator color={colors.textSecondary} size="small" />
        : <AppIcon name={icon} color={colors.textSecondary} size={17} strokeWidth={appIconStroke.strong} />}
    </IslePressable>
  )
}

function ActionButton({
  icon,
  label,
  hint,
  tone = 'default',
  disabled = false,
  busy = false,
  onPress,
}: {
  icon: AppIconName
  label: string
  hint: string
  tone?: 'default' | 'primary' | 'danger'
  disabled?: boolean
  busy?: boolean
  onPress: () => void
}) {
  const { colors, isGlass } = useAppTheme()
  const primary = tone === 'primary'
  const danger = tone === 'danger'
  const backgroundColor = primary
    ? colors.ui.control.primaryBackground
    : danger
      ? colors.ui.tone.danger.background
      : isGlass
        ? colors.ui.actionBar.itemBackground
        : colors.ui.semantic.surface.muted
  const foreground = primary
    ? colors.ui.control.primaryForeground
    : danger
      ? colors.ui.tone.danger.foreground
      : colors.textSecondary
  const borderColor = primary
    ? colors.ui.control.primaryBorder
    : danger
      ? colors.ui.tone.danger.border
      : isGlass
        ? colors.ui.actionBar.itemBorder
        : colors.ui.semantic.chrome.border

  return (
    <IslePressable
      haptic
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={{
        minWidth: 88,
        height: 40,
        borderRadius: Math.min(colors.ui.radius.controlMiddle, 8),
        paddingHorizontal: 11,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        backgroundColor,
        borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
        borderColor,
      }}
    >
      {busy
        ? <ActivityIndicator color={foreground} size="small" />
        : <AppIcon name={icon} color={foreground} size={14} strokeWidth={appIconStroke.strong} />}
      <Text numberOfLines={1} style={[styles.actionLabel, { color: foreground }]}>{label}</Text>
    </IslePressable>
  )
}

function reviewStatusTone(colors: ReturnType<typeof useAppTheme>['colors'], status: ChatWorkspaceReviewStatus) {
  if (status === 'conflict') return colors.ui.tone.danger
  if (status === 'needs-attention' || status === 'blocked') return colors.ui.tone.warning
  return colors.ui.tone.neutral
}

function isSameAction(
  busyAction: ChatWorkspaceReviewBusyAction | null,
  request: ChatWorkspaceReviewConfirmationRequest,
): boolean {
  if (!busyAction || busyAction.kind !== request.kind) return false
  if (busyAction.kind === 'clear-private-memory' || request.kind === 'clear-private-memory') return true
  return busyAction.writebackId === request.writebackId
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  header: {
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  body: {
    paddingHorizontal: 14,
    paddingTop: 10,
    gap: 10,
  },
  summary: {
    minHeight: 46,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  summaryMetric: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'center',
    paddingHorizontal: 7,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0,
    textAlign: 'center',
    includeFontPadding: false,
  },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
  },
  notice: {
    minHeight: 58,
    borderRadius: 8,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  noticeCopy: {
    flex: 1,
    minWidth: 0,
  },
  noticeTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  noticeDescription: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    letterSpacing: 0,
  },
  loadingState: {
    minHeight: 148,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  loadingText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0,
  },
  sectionHeader: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  listContent: {
    flexGrow: 0,
  },
  sectionTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  overflowText: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  writebackRow: {
    minHeight: 76,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  writebackRowCompact: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  writebackCopy: {
    flex: 1,
    minWidth: 0,
  },
  writebackHeading: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  writebackPosition: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  status: {
    maxWidth: 138,
    minHeight: 24,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  kindSummary: {
    marginTop: 3,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  rowActions: {
    flexShrink: 0,
    flexDirection: 'row',
    gap: 7,
  },
  rowActionsCompact: {
    alignSelf: 'flex-end',
  },
  emptyState: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  emptyText: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  privateMemory: {
    minHeight: 66,
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  privateMemoryIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  privateMemoryCopy: {
    flex: 1,
    minWidth: 0,
  },
  privateMemoryTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  privateMemoryDescription: {
    marginTop: 2,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  confirmation: {
    minHeight: 76,
    borderRadius: 8,
    padding: 10,
    flexDirection: 'column',
    gap: 9,
  },
  confirmationPrompt: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  confirmationCopy: {
    flex: 1,
    minWidth: 0,
  },
  confirmationTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  confirmationDescription: {
    marginTop: 2,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0,
  },
  confirmationActions: {
    flexShrink: 0,
    flexDirection: 'row',
    gap: 7,
  },
  actionLabel: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0,
    includeFontPadding: false,
  },
})
