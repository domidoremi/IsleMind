import type { ReactNode } from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MotiView } from 'moti'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import * as Haptics from 'expo-haptics'
import { useRouter } from 'expo-router'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { Easing, runOnJS } from 'react-native-reanimated'
import type { Message } from '@/types/chatContracts'
import type { ProcessTrace } from '@/core'
import { useAppTheme } from '@/hooks/useAppTheme'
import { AppIcon, appIconStroke, type AppIconName } from '@/components/ui/AppIcon'
import { ProviderBrandIcon, type ProviderBrand } from '@/components/ui/ProviderBrandIcon'
import { ISLE_MIN_TOUCH_TARGET, IslePressable } from '@/components/ui/isle'
import { useSettingsStore } from '@/store/settingsStore'
import { mergeMessageWithStreamingTraceSnapshot, useChatStreamingStore } from '@/store/chatStreamingStore'
import { MessageContent } from './MessageContent'
import { containsDisplayFormulaBlock } from './messageContentSpecialFormatPolicy'
import {
  collectVisibleProcessTraces,
  formatDuration,
  formatProcessTraceForDisplay,
  metadataSummaryForTrace,
  isAgentWorkflowEnvelopeTrace,
  normalizeTraceStatuses,
  selectActiveProcessTrace,
  traceActivityStageLabel,
  traceStageLabel,
} from './tracePresentation'
import { MessageBubbleThemeSurface } from './theme-surfaces/ChatThemeSurfaces'
import { hasWideMessageContent, resolveMessageBubbleMaxWidth, resolveMessageBubbleRowAlignment } from './messageBubbleLayout'
import { RenderGuard } from '@/components/ui/RenderGuard'
import { useMotionPreference, type MotionIntensity } from '@/hooks/useMotionPreference'
import { getWorkflowContinuationActionFromMessage, getWorkflowEvidenceRepairActionFromMessage, getWorkflowPendingActionFromMessage, getWorkflowRecoveryActionFromMessage } from '@/presentation/features/conversations/workflowMessageActionSelectors'
import { getWorkflowSkillSuggestionFromMessage } from '@/presentation/features/conversations/workflowSkillSuggestionSelector'
import { clampTraceText, redactSensitiveText, relocalizeUserFacingError } from '@/core'
import { extractTaggedThinkingOutputText, sanitizeInternalChatOutputText } from '@/services/chatInternalOutputGuard'
import { summarizeWorkArtifact } from '@/utils/workArtifact'
import { resolveChatAssistantDisplayName } from './chatIdentityPresentation'
import { getAssistantThinkingLabel } from './messageActivityPreview'
import { createProcessTraceSignature } from './messageTraceSignature'
import { resolveThemeComponentExpression, resolveThemeExpression, type ThemeMotionGrammar } from '@/theme/themeExpression'

const STREAMING_LAYOUT_TEXT_STEP = 160
const STREAMING_RENDER_TEXT_STEP = 32
const STREAMING_RENDER_FAST_FORWARD_THRESHOLD = 240
const STREAMING_RENDER_THROTTLE_MS = 16
const AGENT_ACTION_PROMPT_VISIBILITY_LIMIT = 900
const MESSAGE_ACTION_LOCK_MS = 420
const MESSAGE_ACTION_SHEET_MAX_WIDTH = 540
const MESSAGE_ACTION_PRIMARY_LIMIT = 5

function resolveMessageActionChrome(colors: ReturnType<typeof useAppTheme>['colors'], isGlass: boolean) {
  return {
    barSurface: colors.ui.limeRoad ? colors.ui.actionBar.background : isGlass ? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.base,
    barBorder: colors.ui.limeRoad ? colors.ui.actionBar.border : colors.ui.semantic.chrome.border,
    itemSurface: colors.ui.limeRoad ? colors.ui.actionBar.itemBackground : isGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted,
    itemBorder: colors.ui.limeRoad ? colors.ui.actionBar.itemBorder : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border,
  }
}

export interface MessageBubbleProps {
  conversationId: string
  message: Message
  index: number
  motion: MotionIntensity
  viewportHeight: number
  providerBrand?: ProviderBrand
  isLastAssistant?: boolean
  showThinkingStatus?: boolean
  activeActionMessageId?: string | null
  onActionMessageChange?: (messageId: string | null) => void
  onLayoutChangeRequest?: (options?: { force?: boolean }) => void
  onCopy?: (message: Message) => void
  onCopyProcessTrace?: (message: Message) => void
  onCopyWorkArtifact?: (message: Message) => void
  onContinueWorkArtifact?: (message: Message) => void
  onContinueAgentWorkflow?: (message: Message) => void
  onConfirmAction?: (message: Message) => void
  onPrepareAndroidUndo?: (message: Message) => void
  onRepairAgentEvidence?: (message: Message) => void
  onSaveWorkflowSkill?: (message: Message) => void
  onRetry?: (message: Message) => void
  onRegenerate?: () => void
  onSpeak?: (message: Message) => void
  onDelete?: (message: Message) => void
  onQuote?: (message: Message) => void
  onEdit?: (message: Message) => void
  onStartMultiSelect?: (message: Message) => void
  onToggleSelected?: (message: Message) => void
  onConfigure?: (message: Message) => void
  multiSelectActive?: boolean
  selected?: boolean
}

function MessageBubbleComponent({
  conversationId,
  message,
  index,
  motion,
  viewportHeight,
  providerBrand = 'generic',
  isLastAssistant = false,
  showThinkingStatus = false,
  activeActionMessageId,
  onActionMessageChange,
  onLayoutChangeRequest,
  onCopy,
  onCopyProcessTrace,
  onCopyWorkArtifact,
  onContinueWorkArtifact,
  onContinueAgentWorkflow,
  onConfirmAction,
  onPrepareAndroidUndo,
  onRepairAgentEvidence,
  onSaveWorkflowSkill,
  onRetry,
  onRegenerate,
  onSpeak,
  onDelete,
  onQuote,
  onEdit,
  onStartMultiSelect,
  onToggleSelected,
  onConfigure,
  multiSelectActive = false,
  selected = false,
}: MessageBubbleProps) {
  const { colors, isGlass, canonicalThemeId } = useAppTheme()
  const { t, i18n } = useTranslation()
  const { width: windowWidth } = useWindowDimensions()
  const hapticsEnabled = useSettingsStore((state) => state.settings.hapticsEnabled)
  const configuredAssistantDisplayName = useSettingsStore((state) => state.settings.assistantDisplayName)
  const assistantDisplayName = resolveChatAssistantDisplayName(configuredAssistantDisplayName)
  const [localActionsOpen, setLocalActionsOpen] = useState(false)
  const [processExpanded, setProcessExpanded] = useState(false)
  const isUser = message.role === 'user'
  const isStreamingContent = !isUser && (message.status === 'streaming' || message.status === 'sending')
  const liveStreamingTraceSnapshot = useChatStreamingStore((state) =>
    isStreamingContent ? state.streamingTraces.get(`${conversationId}:${message.id}`) : undefined
  )
  const liveStreamingText = useChatStreamingStore((state) =>
    isStreamingContent ? state.streamingText.get(`${conversationId}:${message.id}`) : undefined
  )
  const displayMessage = useMemo(
    () => mergeMessageWithStreamingTraceSnapshot(message, liveStreamingTraceSnapshot),
    [liveStreamingTraceSnapshot, message]
  )
  // A failed reply persists the sentence that was rendered when it failed, so the bubble
  // would keep speaking the language selected back then. Its copy is rebuilt from the
  // persisted error code on every render instead.
  const persistedDisplayText = message.responseText ?? message.content
  const rawDisplayText = liveStreamingText ?? (!isUser && message.status === 'error'
    ? relocalizeUserFacingError(persistedDisplayText, message.errorCode, t)
    : persistedDisplayText)
  const displayText = sanitizeInternalChatOutputText(rawDisplayText)
  const renderedDisplayText = useThrottledStreamingText(displayText, isStreamingContent)
  const displayFormulaLayout = useMemo(
    () => containsDisplayFormulaBlock(renderedDisplayText),
    [renderedDisplayText]
  )
  const streamingLayoutStep = isStreamingContent ? Math.floor(displayText.length / STREAMING_LAYOUT_TEXT_STEP) : 0
  const taggedThinkingText = useMemo(() => extractTaggedThinkingOutputText(rawDisplayText), [rawDisplayText])
  const taggedThinkingTrace = useMemo<ProcessTrace | undefined>(() => {
    if (!taggedThinkingText) return undefined
    const now = Date.now()
    return {
      id: `tagged-thinking-output:${message.id}`,
      type: 'reasoning',
      title: t('providerTrace.reasoningSummary'),
      content: taggedThinkingText,
      status: isStreamingContent ? 'running' : 'done',
      startedAt: message.startedAt ?? now,
      completedAt: isStreamingContent ? undefined : message.completedAt ?? now,
    }
  }, [isStreamingContent, message.completedAt, message.id, message.startedAt, taggedThinkingText, t])
  const processTraces = useMemo(
    () => {
      const traces = collectVisibleProcessTraces(displayMessage)
      if (!taggedThinkingTrace) return traces
      if (traces.some((trace) => trace.type === 'reasoning' && trace.content?.includes(taggedThinkingText.slice(0, 48)))) {
        return traces
      }
      return [...traces, taggedThinkingTrace]
    },
    [displayMessage.reasoning, displayMessage.retrievalTrace, displayMessage.toolCalls, taggedThinkingText, taggedThinkingTrace]
  )
  const processCanExpand = !isUser && processTraces.some(hasExpandableThinkingContent)
  const hasVisibleAssistantReply = !isUser && Boolean(renderedDisplayText.trim())
  const processNeedsAttention = !isUser && processTraces.some((trace) =>
    shouldKeepBlockingProcessTraceVisible(trace, message.status)
  )
  // Live, interrupted, or actionable work stays explicit. Once a successful
  // reply is visible, redundant terminal status disappears; meaningful model
  // thinking remains available through a compact disclosure instead.
  const processLayerVisible = !isUser && (
    isStreamingContent ||
    showThinkingStatus ||
    message.status === 'error' ||
    message.status === 'cancelled' ||
    (message.status === 'done' && !hasVisibleAssistantReply) ||
    processCanExpand ||
    processTraces.some(isActiveProcessTrace) ||
    processNeedsAttention
  )
  const processHasDetails = processLayerVisible
  const bubbleMaxWidth = useMemo(
    () => resolveMessageBubbleMaxWidth(renderedDisplayText, message.role, processHasDetails, windowWidth, displayFormulaLayout),
    [displayFormulaLayout, message.role, renderedDisplayText, processHasDetails, windowWidth]
  )
  const processWidthClaim = processHasDetails || hasWideMessageContent(renderedDisplayText)
  const bubbleUsesAvailableWidth = displayFormulaLayout || (!isUser && processWidthClaim && (
    processLayerVisible || hasWideMessageContent(renderedDisplayText)
  ))
  const processTextLength = useMemo(() => processTraces.reduce((total, trace) => {
    const display = formatProcessTraceForDisplay(trace)
    return total + display.title.length + display.content.length
  }, 0), [processTraces])
  const processLayoutStep = isStreamingContent ? Math.floor(processTextLength / STREAMING_LAYOUT_TEXT_STEP) : 0
  const canCopyProcessTrace = !isUser && processTraces.length > 0 && !!onCopyProcessTrace
  const processMaxHeight = Math.min(230, viewportHeight * 0.34)
  const actionBarOpen = activeActionMessageId === undefined ? localActionsOpen : activeActionMessageId === message.id
  const actionMessage = !isUser && !isStreamingContent ? message : undefined
  const pendingWorkflowAction = useMemo(() => actionMessage ? getWorkflowPendingActionFromMessage(actionMessage) : undefined, [actionMessage])
  const evidenceRepairAction = useMemo(() => actionMessage ? getWorkflowEvidenceRepairActionFromMessage(actionMessage) : undefined, [actionMessage])
  const workflowRecoveryAction = useMemo(() => actionMessage ? getWorkflowRecoveryActionFromMessage(actionMessage) : undefined, [actionMessage])
  const workflowContinuationAction = useMemo(() => actionMessage ? getWorkflowContinuationActionFromMessage(actionMessage) : undefined, [actionMessage])
  const canConfirmAction = !!pendingWorkflowAction?.confirmable && !!pendingWorkflowAction.resumeToolRequest && !!onConfirmAction
  const canContinueAgentWorkflow = (pendingWorkflowAction?.reason === 'step_limit_reached' || (pendingWorkflowAction?.reason === 'permission_required' && hasSafeAgentActionPrompt(pendingWorkflowAction.suggestedUserPrompt)) || !!workflowContinuationAction) && !!onContinueAgentWorkflow
  const canRepairAgentEvidence = !!evidenceRepairAction && !!onRepairAgentEvidence
  const canPrepareAndroidUndo = !isUser && hasAndroidUndoFollowUp(processTraces) && !!onPrepareAndroidUndo
  const canOpenWorkflowSettings = !!workflowRecoveryAction && workflowRecoveryAction.reason !== 'workflow-selection-ambiguous' && !!onConfigure
  const reviewWorkflowSettingsLabel = agentWorkflowRecoveryActionLabel(t, workflowRecoveryAction)
  const workflowSkillSuggestion = !isUser ? getWorkflowSkillSuggestionFromMessage(message) : undefined
  const canSaveWorkflowSkill = message.status === 'done' && !!workflowSkillSuggestion?.ok && !!workflowSkillSuggestion.skill && !!onSaveWorkflowSkill
  const canDeleteMessage = !!onDelete && message.status !== 'sending' && message.status !== 'streaming'
  const canQuoteMessage = !!displayText.trim() && !!onQuote && message.status !== 'sending' && message.status !== 'streaming'
  const canEditMessage = isUser && !!displayText.trim() && !!onEdit && message.status !== 'sending' && message.status !== 'streaming'
  const canStartMessageMultiSelect = !!onStartMultiSelect && message.status !== 'sending' && message.status !== 'streaming'
  const canOpenActions = !isStreamingContent && canShowActionBar({
    message,
    displayText,
    isLastAssistant,
    onCopy,
    canCopyProcessTrace,
    onCopyWorkArtifact,
    onContinueWorkArtifact,
    canConfirmAction,
    canContinueAgentWorkflow,
    canPrepareAndroidUndo,
    canRepairAgentEvidence,
    canOpenWorkflowSettings,
    canSaveWorkflowSkill,
    canDeleteMessage,
    canQuoteMessage,
    canEditMessage,
    canStartMessageMultiSelect,
    onRetry,
    onRegenerate,
    onSpeak,
    onConfigure,
  }) && !multiSelectActive
  const hasDefaultWorkArtifactActions = useMemo(() => {
    if (isUser || isStreamingContent || !displayText.trim()) return false
    if (!onCopyWorkArtifact && !onContinueWorkArtifact) return false
    return summarizeWorkArtifact(displayText).hasWorkArtifact
  }, [displayText, isStreamingContent, isUser, onCopyWorkArtifact, onContinueWorkArtifact])
  const messageTimestamp = useMemo(
    () => formatMessageTimestamp(message.timestamp, i18n.resolvedLanguage ?? i18n.language),
    [i18n.language, i18n.resolvedLanguage, message.timestamp],
  )
  const showCompletedQuickActions = !isUser && message.status === 'done' && !multiSelectActive && Boolean(displayText.trim()) && Boolean(
    onCopy || onSpeak || (isLastAssistant && onRegenerate),
  )
  const showInlineRetry = !isUser && message.status === 'error' && !multiSelectActive && Boolean(onRetry)
  useEffect(() => {
    setLocalActionsOpen(false)
    setProcessExpanded(false)
    if (activeActionMessageId === message.id) onActionMessageChange?.(null)
  }, [message.id])

  useEffect(() => {
    if (!isStreamingContent) return
    onLayoutChangeRequest?.()
  }, [isStreamingContent, processTraces.length, processLayoutStep, streamingLayoutStep, onLayoutChangeRequest])

  function setActionBarOpen(open: boolean) {
    setLocalActionsOpen(open)
    onActionMessageChange?.(open ? message.id : null)
  }

  function toggleSelectedFromTap() {
    if (!multiSelectActive) return
    onToggleSelected?.(message)
  }

  function openActionBarFromLongPress() {
    if (multiSelectActive) {
      onToggleSelected?.(message)
      return
    }
    if (!canOpenActions) return
    if (hapticsEnabled) void Haptics.selectionAsync()
    setActionBarOpen(true)
  }

  function toggleProcessLayer() {
    if (!processCanExpand) return
    if (hapticsEnabled) void Haptics.selectionAsync()
    setActionBarOpen(false)
    setProcessExpanded((value) => {
      const next = !value
      if (next) requestAnimationFrame(() => onLayoutChangeRequest?.({ force: true }))
      return next
    })
  }

  const tapBubble = Gesture.Tap()
    .enabled(multiSelectActive)
    .maxDuration(220)
    .maxDistance(14)
    .onEnd((_event, success) => {
      if (success) runOnJS(toggleSelectedFromTap)()
    })
  const longPressBubble = Gesture.LongPress()
    .enabled(canOpenActions || multiSelectActive)
    .minDuration(360)
    .maxDistance(16)
    .onEnd((_event, success) => {
      if (success) runOnJS(openActionBarFromLongPress)()
    })
  const bubbleGesture = Gesture.Exclusive(longPressBubble, tapBubble)

  function handleBubbleLayout() {
    if (isStreamingContent || processExpanded || hasDefaultWorkArtifactActions) onLayoutChangeRequest?.()
  }

  return (
    <View onLayout={handleBubbleLayout} style={{ width: '100%', minWidth: 0, marginBottom: 16 }}>
      <View
        style={{
          width: '100%',
          minWidth: 0,
          alignItems: resolveMessageBubbleRowAlignment(message.role),
        }}
      >
        <View
          style={{
            alignSelf: resolveMessageBubbleRowAlignment(message.role),
            width: bubbleUsesAvailableWidth || isUser ? bubbleMaxWidth : undefined,
            maxWidth: '100%',
            minWidth: 0,
            flexShrink: 1,
            position: 'relative',
          }}
        >
        <View
          style={{
            width: '100%',
            minWidth: 0,
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: resolveMessageBubbleRowAlignment(message.role),
            gap: 8,
          }}
        >
          {!isUser ? <AssistantBrandBadge brand={providerBrand} /> : null}
          <View style={{ width: isUser ? undefined : bubbleUsesAvailableWidth ? Math.max(0, bubbleMaxWidth - 32) : undefined, maxWidth: isUser ? bubbleMaxWidth : Math.max(0, bubbleMaxWidth - 32), minWidth: 0, flexShrink: 1, position: 'relative' }}>
          <MessageBubbleThemeSurface themeId={canonicalThemeId} colors={colors} isUser={isUser} selected={selected}>
            {multiSelectActive ? (
              <IslePressable
                haptic
                accessibilityRole="checkbox"
                accessibilityLabel={t('messageBubble.toggleMessageSelection')}
                accessibilityState={{ checked: selected }}
                onPress={() => onToggleSelected?.(message)}
                style={{
                  position: 'absolute',
                  top: 7,
                  right: 7,
                  zIndex: 3,
                  width: 44,
                  height: 44,
                  borderRadius: colors.ui.radius.controlSmall,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: selected ? colors.ui.control.primaryBackground : colors.ui.semantic.surface.base,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: selected ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border,
                }}
              >
                <AppIcon name={selected ? 'check' : 'list-check'} color={selected ? colors.ui.control.primaryForeground : colors.textTertiary} size={17} strokeWidth={appIconStroke.strong} />
              </IslePressable>
            ) : null}
            {processLayerVisible ? (
              <MessageProcessLayer
                message={message}
                traces={processTraces}
                assistantDisplayName={assistantDisplayName}
                expanded={processExpanded}
                canExpand={processCanExpand}
                maxHeight={processMaxHeight}
                onToggle={toggleProcessLayer}
                trailingActionSpace={false}
                motion={motion}
                writingResponse={isStreamingContent && !!renderedDisplayText.trim()}
                compactSettled={message.status === 'done' && hasVisibleAssistantReply && !processNeedsAttention}
              />
            ) : null}
            <GestureDetector gesture={bubbleGesture}>
              <View>
                <MessageBody
                  conversationId={conversationId}
                  message={message}
                  displayText={renderedDisplayText}
                  isUser={isUser}
                  isStreamingContent={isStreamingContent}
                  motion={motion}
                  onLayoutChangeRequest={onLayoutChangeRequest}
                />
              </View>
            </GestureDetector>
            {canConfirmAction && !multiSelectActive ? (
              <PendingActionQuickAction onPress={() => onConfirmAction?.(message)} />
            ) : null}
            {hasDefaultWorkArtifactActions ? (
              <WorkArtifactQuickActions
                hapticsEnabled={hapticsEnabled}
                onCopy={onCopyWorkArtifact ? () => onCopyWorkArtifact(message) : undefined}
                onContinue={onContinueWorkArtifact ? () => onContinueWorkArtifact(message) : undefined}
              />
            ) : null}
          </MessageBubbleThemeSurface>

          {actionBarOpen ? (
            <MessageActionSheet
            message={message}
            displayText={displayText}
            isLastAssistant={isLastAssistant}
            onClose={() => setActionBarOpen(false)}
            onCopy={onCopy ? () => onCopy(message) : undefined}
            canCopyProcessTrace={canCopyProcessTrace}
            onCopyProcessTrace={onCopyProcessTrace ? () => onCopyProcessTrace(message) : undefined}
            onCopyWorkArtifact={onCopyWorkArtifact ? () => onCopyWorkArtifact(message) : undefined}
            onContinueWorkArtifact={onContinueWorkArtifact ? () => onContinueWorkArtifact(message) : undefined}
            canContinueAgentWorkflow={canContinueAgentWorkflow}
            onContinueAgentWorkflow={onContinueAgentWorkflow ? () => onContinueAgentWorkflow(message) : undefined}
            canConfirmAction={canConfirmAction}
            onConfirmAction={onConfirmAction ? () => onConfirmAction(message) : undefined}
            canPrepareAndroidUndo={canPrepareAndroidUndo}
            onPrepareAndroidUndo={onPrepareAndroidUndo ? () => onPrepareAndroidUndo(message) : undefined}
            canRepairAgentEvidence={canRepairAgentEvidence}
            onRepairAgentEvidence={onRepairAgentEvidence ? () => onRepairAgentEvidence(message) : undefined}
            canOpenWorkflowSettings={canOpenWorkflowSettings}
            reviewWorkflowSettingsLabel={reviewWorkflowSettingsLabel}
            canSaveWorkflowSkill={canSaveWorkflowSkill}
            onSaveWorkflowSkill={onSaveWorkflowSkill ? () => onSaveWorkflowSkill(message) : undefined}
            onSpeak={onSpeak ? () => onSpeak(message) : undefined}
            onConfigure={onConfigure ? () => onConfigure(message) : undefined}
            onRetry={onRetry ? () => onRetry(message) : undefined}
            onRegenerate={onRegenerate}
            onDelete={canDeleteMessage && onDelete ? () => onDelete(message) : undefined}
            onQuote={canQuoteMessage && onQuote ? () => onQuote(message) : undefined}
            onEdit={canEditMessage && onEdit ? () => onEdit(message) : undefined}
            onStartMultiSelect={canStartMessageMultiSelect && onStartMultiSelect ? () => onStartMultiSelect(message) : undefined}
            />
          ) : null}
          </View>
        </View>
        {isUser ? (
          <Text
            accessibilityLabel={messageTimestamp}
            style={{ marginTop: 4, alignSelf: 'flex-end', color: message.status === 'error' ? colors.ui.tone.danger.foreground : colors.textTertiary, fontSize: 10, lineHeight: 13, fontWeight: '500', fontVariant: ['tabular-nums'] }}
          >
            {messageTimestamp}
          </Text>
        ) : null}
        {showCompletedQuickActions ? (
          <MessageCompletedQuickActions
            motion={motion}
            onCopy={onCopy ? () => onCopy(message) : undefined}
            onSpeak={onSpeak ? () => onSpeak(message) : undefined}
            onRegenerate={isLastAssistant ? onRegenerate : undefined}
          />
        ) : null}
        {showInlineRetry ? (
          <MessageInlineRetry motion={motion} onPress={() => onRetry?.(message)} />
        ) : null}
        </View>
      </View>
    </View>
  )
}

function AssistantBrandBadge({ brand }: { brand: ProviderBrand }) {
  const theme = useAppTheme()
  const { colors } = theme
  const isDark = theme.isDark
  return (
    <View
      accessible={false}
      style={{
        width: 24,
        height: 24,
        marginTop: 8,
        borderRadius: 7,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: isDark ? colors.ui.semantic.surface.raised : colors.ui.semantic.surface.base,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isDark ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border,
      }}
    >
      <ProviderBrandIcon brand={brand} size={15} variant={isDark ? 'onDark' : 'onLight'} />
    </View>
  )
}

function MessageCompletedQuickActions({
  motion,
  onCopy,
  onSpeak,
  onRegenerate,
}: {
  motion: MotionIntensity
  onCopy?: () => void
  onSpeak?: () => void
  onRegenerate?: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const actions: Array<{ id: string; label: string; icon: AppIconName; onPress: () => void }> = []
  if (onCopy) actions.push({ id: 'copy', label: t('common.copy'), icon: 'copy', onPress: onCopy })
  if (onSpeak) actions.push({ id: 'speak', label: t('messageBubble.speak'), icon: 'voice', onPress: onSpeak })
  if (onRegenerate) actions.push({ id: 'regenerate', label: t('messageBubble.regenerate'), icon: 'regenerate', onPress: onRegenerate })

  return (
    <MotiView
      from={motion === 'full' ? { opacity: 0, translateY: -3 } : undefined}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: motion === 'full' ? 176 : 1 }}
      style={{ minHeight: ISLE_MIN_TOUCH_TARGET, marginLeft: 32, marginTop: 2, flexDirection: 'row', alignItems: 'center' }}
    >
      {actions.map((action) => (
        <IslePressable
          key={action.id}
          haptic
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={{ width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', borderRadius: colors.ui.radius.controlSmall }}
        >
          <AppIcon name={action.icon} color={colors.textTertiary} size={15} strokeWidth={appIconStroke.regular} />
        </IslePressable>
      ))}
    </MotiView>
  )
}

function MessageInlineRetry({ motion, onPress }: { motion: MotionIntensity; onPress: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <MotiView
      from={motion === 'full' ? { opacity: 0, translateY: -3 } : undefined}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: motion === 'full' ? 176 : 1 }}
      style={{ marginLeft: 32, marginTop: 4, alignSelf: 'flex-start' }}
    >
      <IslePressable
        haptic
        accessibilityRole="button"
        accessibilityLabel={t('messageBubble.retry')}
        onPress={onPress}
        style={{
          minHeight: ISLE_MIN_TOUCH_TARGET,
          paddingHorizontal: 13,
          borderRadius: colors.ui.radius.controlMiddle,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          backgroundColor: colors.ui.tone.danger.background,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.ui.tone.danger.border,
        }}
      >
        <AppIcon name="retry" color={colors.ui.tone.danger.foreground} size={14} strokeWidth={appIconStroke.strong} />
        <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 12, lineHeight: 16, fontWeight: '800' }}>
          {t('messageBubble.retry')}
        </Text>
      </IslePressable>
    </MotiView>
  )
}

function formatMessageTimestamp(timestamp: number, locale?: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
  } catch {
    const date = new Date(timestamp)
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }
}

function PendingActionQuickAction({ onPress }: { onPress: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const [locked, setLocked] = useState(false)
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (lockTimer.current) clearTimeout(lockTimer.current)
  }, [])

  function confirm() {
    if (locked) return
    setLocked(true)
    onPress()
    lockTimer.current = setTimeout(() => {
      lockTimer.current = null
      setLocked(false)
    }, MESSAGE_ACTION_LOCK_MS)
  }

  return (
    <View style={{ minHeight: 44, marginTop: 10, flexDirection: 'row', alignItems: 'center' }}>
      <IslePressable
        haptic
        accessibilityRole="button"
        accessibilityLabel={t('messageBubble.confirmAgentAction')}
        accessibilityState={{ disabled: locked }}
        disabled={locked}
        onPress={confirm}
        testID="message-pending-action-confirm"
        style={{
          minHeight: 44,
          maxWidth: '100%',
          borderRadius: Math.min(colors.ui.radius.controlMiddle, 8),
          paddingHorizontal: 13,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: locked
            ? colors.ui.control.disabledBackground
            : colors.ui.control.primaryBackground,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: locked
            ? colors.ui.control.disabledBorder
            : colors.ui.control.primaryBorder,
        }}
      >
        <AppIcon
          name="shield"
          color={locked ? colors.textTertiary : colors.ui.control.primaryForeground}
          size={16}
          strokeWidth={appIconStroke.strong}
        />
        <Text
          numberOfLines={1}
          style={{
            color: locked ? colors.textTertiary : colors.ui.control.primaryForeground,
            fontSize: 12,
            lineHeight: 17,
            fontWeight: '800',
          }}
        >
          {t('messageBubble.confirmAgentAction')}
        </Text>
      </IslePressable>
    </View>
  )
}

function useThrottledStreamingText(text: string, active: boolean): string {
  const [renderedText, setRenderedText] = useState(text)
  const latestText = useRef(text)
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    latestText.current = text

    const scheduleRenderFlush = () => {
      if (renderTimer.current) return
      renderTimer.current = setTimeout(() => {
        renderTimer.current = null
        let needsAnotherFrame = false
        setRenderedText((current) => {
          const next = latestText.current
          const updated = nextStreamingTextFrame(current, next)
          needsAnotherFrame = updated !== next
          return updated
        })
        if (needsAnotherFrame) scheduleRenderFlush()
      }, STREAMING_RENDER_THROTTLE_MS)
    }

    if (!active) {
      if (renderTimer.current) {
        clearTimeout(renderTimer.current)
        renderTimer.current = null
      }
      setRenderedText((current) => current === text ? current : text)
      return
    }

    setRenderedText((current) => {
      if (text.length < current.length) return text
      if (!text.startsWith(current)) return text
      return current
    })

    scheduleRenderFlush()
  }, [active, text])

  useEffect(() => () => {
    if (renderTimer.current) clearTimeout(renderTimer.current)
  }, [])

  return renderedText
}

function nextStreamingTextFrame(current: string, next: string): string {
  if (current === next) return current
  if (next.length < current.length || !next.startsWith(current)) return next
  const backlog = next.length - current.length
  if (backlog <= STREAMING_RENDER_TEXT_STEP) return next
  const frameStep = backlog > STREAMING_RENDER_FAST_FORWARD_THRESHOLD
    ? Math.max(STREAMING_RENDER_TEXT_STEP, Math.ceil(backlog * 0.55))
    : STREAMING_RENDER_TEXT_STEP
  return next.slice(0, current.length + frameStep)
}

function MessageBody({
  conversationId,
  message,
  displayText,
  isUser,
  isStreamingContent,
  motion,
  onLayoutChangeRequest,
}: {
  conversationId: string
  message: Message
  displayText: string
  isUser: boolean
  isStreamingContent: boolean
  motion: MotionIntensity
  onLayoutChangeRequest?: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const userMessage = colors.ui.message

  return (
    <>
      {message.attachments?.length ? (
        <Text style={{ color: isUser ? userMessage.userForeground : colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>
          {t('messageBubble.attachmentCount', { count: message.attachments.length })}
        </Text>
      ) : null}
      <RenderGuard label={t('messageBubble.messageContent')} fallbackText={displayText || message.content} compact>
        {displayText ? (
          <MessageBodyReveal active={isStreamingContent}>
            <MessageContent content={displayText} isUser={isUser} isStreaming={isStreamingContent} onLayoutChangeRequest={onLayoutChangeRequest} selectionEnabled={false} />
          </MessageBodyReveal>
        ) : !isUser && !isStreamingContent && message.status !== 'cancelled' ? (
          <Text style={{ color: isUser ? userMessage.userForeground : colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
            {t('messageBubble.emptyResponse')}
          </Text>
        ) : isUser ? (
          <TypingDots motion={motion} />
        ) : null}
      </RenderGuard>
      {!isUser && message.citations?.length ? <MessageSourceLink conversationId={conversationId} message={message} /> : null}
    </>
  )
}

function MessageSourceLink({ conversationId, message }: { conversationId: string; message: Message }) {
  const router = useRouter()
  const { colors, isGlass } = useAppTheme()
  const { t } = useTranslation()
  const firstCitation = message.citations?.[0]
  const count = message.citations?.length ?? 0
  if (!firstCitation || count < 1) return null

  return (
    <IslePressable
      haptic
      accessibilityRole="button"
      accessibilityLabel={t('messageBubble.viewSources')}
      onPress={() => router.push({
        pathname: '/source',
        params: {
          conversationId,
          messageId: message.id,
          citationId: firstCitation.id,
        },
      })}
      style={{
        alignSelf: 'flex-start',
        minHeight: ISLE_MIN_TOUCH_TARGET,
        marginTop: 9,
        borderRadius: colors.ui.radius.controlSmall,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        backgroundColor: isGlass ? colors.ui.actionBar.itemBackground : colors.ui.icon.accentBackground,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isGlass ? colors.ui.actionBar.itemBorder : colors.material.stroke,
      }}
    >
      <AppIcon name="knowledge" color={colors.ui.icon.accentForeground} size={14} strokeWidth={appIconStroke.strong} />
      <Text style={{ color: colors.ui.icon.accentForeground, fontSize: 12, lineHeight: 16, fontWeight: '800' }}>
        {t('messageBubble.sources', { count })}
      </Text>
    </IslePressable>
  )
}

function MessageProcessLayer({
  message,
  traces,
  assistantDisplayName,
  expanded,
  canExpand,
  maxHeight,
  onToggle,
  trailingActionSpace = false,
  motion,
  writingResponse,
  compactSettled,
}: {
  message: Message
  traces: ProcessTrace[]
  assistantDisplayName?: string
  expanded: boolean
  canExpand: boolean
  maxHeight: number
  onToggle: () => void
  trailingActionSpace?: boolean
  motion: MotionIntensity
  writingResponse: boolean
  compactSettled: boolean
}) {
  const { colors, canonicalThemeId } = useAppTheme()
  const processExpression = resolveThemeComponentExpression(canonicalThemeId, 'aiResponse')
  const processGrammar = processExpression.motion
  const actionChrome = resolveMessageActionChrome(colors, canonicalThemeId === 'liquid-glass')
  const { t } = useTranslation()
  const active = message.status === 'streaming' || message.status === 'sending'
  const processStatusLabel = processLayerLabel(message, traces, t, writingResponse, assistantDisplayName)
  if (compactSettled && canExpand) {
    return (
      <SettledThinkingDisclosure
        message={message}
        traces={traces}
        expanded={expanded}
        maxHeight={maxHeight}
        onToggle={onToggle}
        motion={motion}
      />
    )
  }
  const emphasizedStatus = message.status === 'cancelled' || traces.some(isAgentWorkflowWaitingTrace)
  const processAccessibilityLabel = canExpand
    ? expanded
      ? t('messageBubble.collapseThinking')
      : t('messageBubble.expandThinking')
    : processStatusLabel
  const processAccessibilityState = canExpand
    ? active
      ? { expanded, busy: true }
      : { expanded }
    : active
      ? { busy: true }
      : undefined
  const processStatusIcon: AppIconName = message.status === 'error'
    ? 'warning'
    : message.status === 'cancelled'
      ? 'stop'
      : active
        ? 'spark'
        : 'check'
  const tone =
    message.status === 'error'
      ? colors.ui.tone.danger.foreground
        : message.status === 'cancelled'
          ? colors.ui.tone.warning.foreground
          : active
            ? colors.ui.icon.accentForeground
            : colors.textTertiary
  const statusBackground =
    message.status === 'error'
      ? colors.ui.tone.danger.background
      : message.status === 'cancelled'
        ? colors.ui.tone.warning.background
        : active
          ? processGrammar === 'precision'
            ? 'transparent'
            : processGrammar === 'fluid'
              ? colors.ui.actionBar.itemBackground
              : colors.ui.tone.info.background
          : processGrammar === 'precision'
            ? 'transparent'
            : processGrammar === 'material'
              ? colors.ui.semantic.surface.raised
              : actionChrome.itemSurface
  const statusBorder =
    message.status === 'error'
      ? colors.ui.tone.danger.border
      : message.status === 'cancelled'
        ? colors.ui.tone.warning.border
      : active
        ? processGrammar === 'precision'
          ? colors.ui.icon.accentForeground
          : colors.ui.tone.info.border
        : actionChrome.itemBorder
  const statusRadius = processExpression.shape === 'capsule'
    ? colors.ui.radius.chip
    : processExpression.shape === 'material'
      ? colors.ui.radius.controlMiddle
      : processExpression.shape === 'soft'
        ? colors.ui.radius.controlLarge
        : 2
  const statusBorderWidth = processGrammar === 'precision'
    ? 0
    : processExpression.border === 'none'
      ? 0
      : processGrammar === 'organic' || processGrammar === 'fluid'
        ? 1
        : StyleSheet.hairlineWidth
  return (
    <View style={{ marginBottom: 10 }}>
      <IslePressable
        testID="message-model-status"
        haptic
        disabled={!canExpand}
        onPress={onToggle}
        accessibilityLabel={processAccessibilityLabel}
        accessibilityRole={canExpand ? 'button' : 'text'}
        accessibilityLiveRegion="polite"
        accessibilityState={processAccessibilityState}
        accessibilityValue={canExpand ? { text: processStatusLabel } : undefined}
        style={{
          minHeight: ISLE_MIN_TOUCH_TARGET,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          alignSelf: 'flex-start',
          width: '100%',
          maxWidth: '100%',
          overflow: 'hidden',
          borderRadius: statusRadius,
          paddingVertical: emphasizedStatus ? 6 : processGrammar === 'precision' ? 4 : 5,
          paddingHorizontal: processGrammar === 'precision' ? 4 : processGrammar === 'organic' ? 10 : 8,
          paddingRight: emphasizedStatus && trailingActionSpace ? 48 : 8,
          backgroundColor: statusBackground,
          borderWidth: statusBorderWidth,
          borderLeftWidth: processGrammar === 'precision' ? 2 : statusBorderWidth,
          borderColor: statusBorder,
          shadowColor: colors.shadowTint,
          shadowOpacity: processGrammar === 'organic' ? 0.07 : processGrammar === 'fluid' ? 0.12 : 0,
          shadowRadius: processGrammar === 'organic' ? 12 : processGrammar === 'fluid' ? 16 : 0,
          shadowOffset: { width: 0, height: processGrammar === 'organic' || processGrammar === 'fluid' ? 4 : 0 },
          elevation: processGrammar === 'fluid' ? 2 : processGrammar === 'organic' ? 1 : 0,
        }}
      >
        {processGrammar === 'organic' ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 18, right: 18, height: 2, borderRadius: 2, backgroundColor: colors.ui.control.focus, opacity: 0.24 }} /> : null}
        {processGrammar === 'material' ? <View pointerEvents="none" style={{ ...StyleSheet.absoluteFill, backgroundColor: colors.primary, opacity: active ? 0.06 : 0.025 }} /> : null}
        {processGrammar === 'fluid' ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 12, right: 12, height: 1, backgroundColor: colors.ui.semantic.content.inverse, opacity: 0.62 }} /> : null}
        <View style={{ flex: 1, flexShrink: 1, minWidth: 0 }}>
          <View
            key={writingResponse ? 'writing' : active ? 'active-process' : 'settled-process'}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 20 }}
          >
            <AnimatedProcessStatusText active={active} label={processStatusLabel} tone={tone} icon={processStatusIcon} motion={motion} grammar={processGrammar} />
          </View>
        </View>
        {canExpand ? (
          <MotiView animate={{ rotate: expanded ? '90deg' : '0deg' }} transition={{ type: 'timing', duration: motion === 'full' ? (processGrammar === 'precision' ? 88 : processGrammar === 'organic' ? 220 : processGrammar === 'material' ? 160 : 200) : 1, easing: processGrammar === 'organic' ? Easing.inOut(Easing.sin) : Easing.out(Easing.cubic) }}>
            <AppIcon name="back-next" color={colors.textTertiary} size={14} strokeWidth={appIconStroke.strong} />
          </MotiView>
        ) : null}
      </IslePressable>
      {expanded && canExpand ? <MessageProcessPanel message={message} traces={traces} maxHeight={maxHeight} motion={motion} /> : null}
    </View>
  )
}

function SettledThinkingDisclosure({
  message,
  traces,
  expanded,
  maxHeight,
  onToggle,
  motion,
}: {
  message: Message
  traces: ProcessTrace[]
  expanded: boolean
  maxHeight: number
  onToggle: () => void
  motion: MotionIntensity
}) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { t } = useTranslation()
  const label = settledThinkingDisclosureLabel(message, traces, t)
  const disclosureExpression = resolveThemeComponentExpression(canonicalThemeId, 'aiResponse')
  const grammar = disclosureExpression.motion
  const disclosureBackground = grammar === 'precision'
    ? 'transparent'
    : grammar === 'organic'
      ? colors.ui.semantic.surface.base
      : grammar === 'material'
        ? colors.ui.semantic.surface.raised
        : colors.ui.actionBar.itemBackground
  const disclosureBorder = grammar === 'precision'
    ? colors.ui.semantic.chrome.border
    : grammar === 'fluid'
      ? colors.ui.actionBar.itemBorder
      : colors.ui.semantic.chrome.border
  const disclosureRadius = disclosureExpression.shape === 'capsule'
    ? colors.ui.radius.chip
    : disclosureExpression.shape === 'material'
      ? colors.ui.radius.controlMiddle
      : disclosureExpression.shape === 'soft'
        ? colors.ui.radius.controlLarge
        : 2

  return (
    <View style={{ marginBottom: expanded ? 8 : 4 }}>
      <IslePressable
        testID="message-thinking-disclosure"
        haptic
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={expanded ? t('messageBubble.collapseThinking') : t('messageBubble.expandThinking')}
        accessibilityState={{ expanded }}
        accessibilityValue={{ text: label }}
        style={{
          minHeight: ISLE_MIN_TOUCH_TARGET,
          maxWidth: '100%',
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          gap: grammar === 'precision' ? 5 : 7,
          overflow: 'hidden',
          paddingHorizontal: grammar === 'precision' ? 3 : 9,
          backgroundColor: disclosureBackground,
          borderRadius: disclosureRadius,
          borderWidth: grammar === 'precision' ? 0 : disclosureExpression.border === 'none' ? 0 : StyleSheet.hairlineWidth,
          borderBottomWidth: grammar === 'precision' ? StyleSheet.hairlineWidth : undefined,
          borderColor: disclosureBorder,
        }}
      >
        {grammar === 'organic' ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 2, backgroundColor: colors.ui.control.focus, opacity: 0.2 }} /> : null}
        {grammar === 'material' ? <View pointerEvents="none" style={{ ...StyleSheet.absoluteFill, backgroundColor: colors.primary, opacity: expanded ? 0.08 : 0.03 }} /> : null}
        {grammar === 'fluid' ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 10, right: 10, height: 1, backgroundColor: colors.ui.semantic.content.inverse, opacity: 0.56 }} /> : null}
        <AppIcon name="reasoning" color={colors.textTertiary} size={13} strokeWidth={appIconStroke.strong} />
        <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.textTertiary, fontSize: 11, lineHeight: 15, fontWeight: '700' }}>
          {label}
        </Text>
        <MotiView animate={{ rotate: expanded ? '90deg' : '0deg' }} transition={{ type: 'timing', duration: motion === 'full' ? (grammar === 'precision' ? 88 : grammar === 'organic' ? 220 : grammar === 'material' ? 160 : 200) : 1, easing: grammar === 'organic' ? Easing.inOut(Easing.sin) : Easing.out(Easing.cubic) }}>
          <AppIcon name="back-next" color={colors.textTertiary} size={12} strokeWidth={appIconStroke.strong} />
        </MotiView>
      </IslePressable>
      {expanded ? <MessageProcessPanel message={message} traces={traces} maxHeight={maxHeight} motion={motion} /> : null}
    </View>
  )
}

function AnimatedProcessStatusText({ active, label, tone, icon, motion, grammar }: { active: boolean; label: string; tone: string; icon: AppIconName; motion: MotionIntensity; grammar: ThemeMotionGrammar }) {
  const [dotCount, setDotCount] = useState(1)
  const shimmer = active && motion === 'full' && grammar !== 'precision'
  const baseLabel = label.replace(/[.\u2026]+$/u, '').trimEnd()
  const displayLabel = active
    ? `${baseLabel}${'.'.repeat(motion === 'full' ? dotCount : 3)}`
    : label
  const cycleMs = grammar === 'organic' ? 520 : grammar === 'fluid' ? 420 : 360
  const shimmerDuration = grammar === 'organic' ? 1800 : grammar === 'fluid' ? 1380 : 980
  const shimmerWidth = grammar === 'organic' ? 42 : grammar === 'fluid' ? 30 : 24
  const shimmerOpacity = grammar === 'organic' ? 0.1 : grammar === 'fluid' ? 0.18 : 0.12

  useEffect(() => {
    if (!active || motion !== 'full') {
      setDotCount(3)
      return
    }
    setDotCount(1)
    const timer = setInterval(() => {
      setDotCount((current) => current >= 3 ? 1 : current + 1)
    }, cycleMs)
    return () => clearInterval(timer)
  }, [active, cycleMs, motion])

  return (
    <View testID={`message-thinking-status-${grammar}`} style={{ flex: 1, flexShrink: 1, minWidth: 0, minHeight: 16, justifyContent: 'center', overflow: 'hidden' }}>
      <View
        key={label}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}
      >
        <AppIcon name={icon} color={tone} size={14} strokeWidth={appIconStroke.strong} />
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          accessibilityLabel={label}
          style={{ flexShrink: 1, color: tone, fontSize: 12, lineHeight: 16, fontWeight: '800', includeFontPadding: false }}
        >
          {displayLabel}
        </Text>
      </View>
      <MotiView
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        from={{ translateX: -shimmerWidth, opacity: 0 }}
        animate={shimmer ? { translateX: 320, opacity: shimmerOpacity } : { translateX: -shimmerWidth, opacity: 0 }}
        transition={{ loop: shimmer, type: 'timing', duration: shimmer ? shimmerDuration : 1, easing: grammar === 'organic' ? Easing.inOut(Easing.sin) : Easing.inOut(Easing.cubic) }}
        style={{ position: 'absolute', top: -6, bottom: -6, left: 0, width: shimmerWidth, borderRadius: grammar === 'material' ? 2 : 12, backgroundColor: tone, transform: [{ rotate: grammar === 'material' ? '0deg' : '12deg' }] }}
      />
    </View>
  )
}

function MessageProcessPanel({ message, traces, maxHeight, motion }: { message: Message; traces: ProcessTrace[]; maxHeight: number; motion: MotionIntensity }) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { t } = useTranslation()
  const scrollRef = useRef<ScrollView>(null)
  const thinkingSummaries = collectThinkingSummaries(traces)
  const contentLength = thinkingSummaries.reduce((total, summary) => total + summary.length, 0)
  const running = message.status === 'streaming' || message.status === 'sending'
  const panelExpression = resolveThemeComponentExpression(canonicalThemeId, 'aiResponse')
  const grammar = panelExpression.motion
  const panelBackground = grammar === 'precision'
    ? 'transparent'
    : grammar === 'organic'
      ? colors.ui.semantic.surface.base
      : grammar === 'material'
        ? colors.ui.semantic.surface.raised
        : colors.ui.actionBar.itemBackground
  const panelBorder = grammar === 'fluid' ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const panelRadius = panelExpression.shape === 'capsule'
    ? colors.ui.radius.controlLarge
    : panelExpression.shape === 'material'
      ? colors.ui.radius.controlMiddle
      : panelExpression.shape === 'soft'
        ? colors.ui.radius.controlLarge
        : 2

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: running && motion === 'full' }))
  }, [contentLength, motion, running, thinkingSummaries.length])

  return (
    <View
      testID="message-thinking-panel"
      style={{
        marginTop: 7,
        overflow: 'hidden',
        borderRadius: panelRadius,
        borderWidth: grammar === 'precision' ? 0 : panelExpression.border === 'none' ? 0 : StyleSheet.hairlineWidth,
        borderTopWidth: grammar === 'precision' ? StyleSheet.hairlineWidth : undefined,
        borderTopColor: panelBorder,
        borderColor: panelBorder,
        backgroundColor: panelBackground,
        paddingTop: grammar === 'precision' ? 8 : 10,
        paddingHorizontal: grammar === 'precision' ? 0 : grammar === 'organic' ? 11 : 10,
        paddingBottom: grammar === 'precision' ? 0 : 9,
        shadowColor: colors.shadowTint,
        shadowOpacity: grammar === 'organic' ? 0.06 : grammar === 'fluid' ? 0.12 : 0,
        shadowRadius: grammar === 'organic' ? 12 : grammar === 'fluid' ? 16 : 0,
        shadowOffset: { width: 0, height: grammar === 'organic' || grammar === 'fluid' ? 4 : 0 },
        elevation: grammar === 'fluid' ? 2 : grammar === 'organic' ? 1 : 0,
      }}
    >
      {grammar === 'organic' ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 18, right: 18, height: 2, backgroundColor: colors.ui.control.focus, opacity: 0.22 }} /> : null}
      {grammar === 'material' ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: 3, bottom: 0, backgroundColor: colors.primary, opacity: 0.72 }} /> : null}
      {grammar === 'fluid' ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 12, right: 12, height: 1, backgroundColor: colors.ui.semantic.content.inverse, opacity: 0.58 }} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 7 }}>
        <AppIcon name="reasoning" color={colors.ui.icon.accentForeground} size={13} strokeWidth={appIconStroke.strong} />
        <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '800' }}>
          {t('messageBubble.thinkingDetails', { defaultValue: '思考摘要' })}
        </Text>
        {running ? (
          <Text style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 14, fontWeight: '700' }}>
            {t('chat.generating', { defaultValue: '生成中' })}
          </Text>
        ) : null}
      </View>
      <ScrollView ref={scrollRef} nestedScrollEnabled showsVerticalScrollIndicator={contentLength > 360 || thinkingSummaries.length > 2} style={{ maxHeight }}>
        {thinkingSummaries.length ? (
          <View style={{ gap: grammar === 'precision' ? 6 : grammar === 'organic' ? 10 : 8 }}>
            {thinkingSummaries.map((summary, index) => (
              <View
                key={`${index}-${summary.slice(0, 24)}`}
                style={{
                  borderLeftWidth: grammar === 'precision' ? 1 : grammar === 'material' ? 3 : 0,
                  borderLeftColor: grammar === 'precision' ? colors.ui.semantic.chrome.border : colors.primary,
                  borderRadius: grammar === 'organic' ? colors.ui.radius.controlSmall : grammar === 'fluid' ? colors.ui.radius.controlLarge : 0,
                  paddingLeft: grammar === 'precision' ? 7 : grammar === 'material' ? 8 : grammar === 'organic' || grammar === 'fluid' ? 9 : 0,
                  paddingRight: grammar === 'organic' || grammar === 'fluid' ? 8 : 0,
                  paddingVertical: grammar === 'organic' || grammar === 'fluid' ? 6 : 0,
                  backgroundColor: grammar === 'organic'
                    ? colors.ui.semantic.surface.muted
                    : grammar === 'fluid'
                      ? colors.ui.semantic.surface.overlay
                      : 'transparent',
                }}
              >
                <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: grammar === 'material' ? '700' : '600' }}>
                  {summary}
                </Text>
              </View>
            ))}
          </View>
        ) : running ? (
          <TypingDots motion={motion} />
        ) : null}
      </ScrollView>
    </View>
  )
}

function processLayerLabel(
  message: Message,
  traces: ProcessTrace[],
  t: TFunction,
  writingResponse = false,
  assistantDisplayName?: string,
): string {
  const waitingLabel = waitingProcessLayerLabel(traces, t)
  if (waitingLabel) return withProcessStageLabel(waitingLabel, traces, message.status)

  if (message.status === 'streaming' || message.status === 'sending') {
    const activeTrace = selectActiveProcessTrace(traces, message.status)
    if (activeTrace && !isGenericModelRequestTrace(activeTrace)) return activeProcessLayerLabel(activeTrace, t)
    if (writingResponse) {
      return t('messageBubble.responseStreaming', {
        defaultValue: '正在生成回复',
      })
    }
    const completedTrace = selectLatestCompletedProcessTrace(traces, message.status)
    if (completedTrace) {
      return t('messageBubble.responseStreaming', {
        defaultValue: '正在生成回复',
      })
    }
    if (activeTrace) return activeProcessLayerLabel(activeTrace, t)
    return assistantDisplayName
      ? getAssistantThinkingLabel(assistantDisplayName, t)
      : thinkingProgressLabel(t, 'base')
  }

  return (() => {
    switch (message.status) {
      case 'error':
        return translateMessageBubbleLabel(t, 'messageBubble.failed', '失败')
      case 'cancelled':
        return translateMessageBubbleLabel(t, 'messageBubble.stopped', '已停止')
      case 'done':
        return thinkingDoneLabel(message, traces, t)
    }
  })()
}

function activeProcessLayerLabel(trace: ProcessTrace, t: TFunction): string {
  const stage = traceActivityStageLabel(trace)
  if (trace.type === 'tool') {
    return t('messageBubble.runningTool', {
      tool: processTraceOperationName(trace, stage),
      defaultValue: `正在调用 ${processTraceOperationName(trace, stage)}`,
    })
  }
  if (trace.type === 'search') {
    return t('messageBubble.runningSearch', { defaultValue: '正在搜索' })
  }
  if (trace.type === 'retrieval' || trace.type === 'memory' || trace.type === 'knowledge') {
    return t('messageBubble.runningRetrieval', { defaultValue: '正在检索资料' })
  }
  if (isGenericModelRequestTrace(trace)) {
    return t('messageBubble.runningRequest', { defaultValue: '正在准备请求' })
  }
  if (trace.type === 'reasoning') {
    return t('chat.thinking', { defaultValue: '思考中...' })
  }
  return thinkingProgressLabel(t, 'active', stage)
}

function thinkingDoneLabel(message: Message, traces: ProcessTrace[], t: TFunction): string {
  const hasThinking = traces.some(hasDisplayableThinkingContent)
  const durationMs = resolveThinkingDurationMs(message, traces)
  if (hasThinking && durationMs) {
    return translateMessageBubbleLabel(t, 'messageBubble.completed', '已完成') + ` · ${formatDuration(durationMs)}`
  }
  if (hasThinking) return translateMessageBubbleLabel(t, 'messageBubble.completed', '已完成')
  return translateMessageBubbleLabel(t, 'messageBubble.completed', '已完成')
}

function settledThinkingDisclosureLabel(message: Message, traces: ProcessTrace[], t: TFunction): string {
  const title = t('messageBubble.thinkingDetails', { defaultValue: '思考摘要' })
  const durationMs = resolveThinkingDurationMs(message, traces)
  return durationMs ? `${title} · ${formatDuration(durationMs)}` : title
}

function settledProcessStageLabel(message: Message, traces: ProcessTrace[], t: TFunction): string {
  const trace = selectLatestCompletedProcessTrace(traces, message.status)
  if (!trace) return ''
  return thinkingProgressLabel(t, 'done', traceActivityStageLabel(trace))
}

function resolveThinkingDurationMs(message: Message, traces: ProcessTrace[]): number | undefined {
  let maxTraceDuration = 0
  for (const trace of normalizeTraceStatuses(traces, message.status)) {
    if (!hasDisplayableThinkingContent(trace)) continue
    const duration = traceDurationMs(trace)
    if (duration && duration > maxTraceDuration) maxTraceDuration = duration
  }
  if (maxTraceDuration > 0) return maxTraceDuration
  return message.durationMs && message.durationMs > 0 ? message.durationMs : traceDurationMs(message)
}

function traceDurationMs(trace: Pick<ProcessTrace, 'durationMs' | 'startedAt' | 'completedAt'>): number | undefined {
  if (trace.durationMs && trace.durationMs > 0) return trace.durationMs
  if (trace.startedAt && trace.completedAt && trace.completedAt > trace.startedAt) {
    return trace.completedAt - trace.startedAt
  }
  return undefined
}

function withProcessStageLabel(label: string, traces: ProcessTrace[], messageStatus: Message['status']): string {
  const activeTrace = selectProcessStageTrace(traces, messageStatus)
  if (!activeTrace) return label
  return `${traceActivityStageLabel(activeTrace)} · ${label}`
}

function selectProcessStageTrace(traces: ProcessTrace[], messageStatus: Message['status']): ProcessTrace | undefined {
  const activeTrace = selectActiveProcessTrace(traces, messageStatus)
  if (activeTrace) return activeTrace
  const normalized = normalizeTraceStatuses(traces, messageStatus)
  return normalized.find((trace) => trace.status === 'error')
    ?? [...normalized].reverse().find((trace) => trace.title.startsWith('Agent ') || trace.metadata?.source || trace.metadata?.inputSummary)
    ?? normalized[normalized.length - 1]
}

function selectLatestCompletedProcessTrace(traces: ProcessTrace[], messageStatus: Message['status']): ProcessTrace | undefined {
  return [...normalizeTraceStatuses(traces, messageStatus)].reverse().find((item) =>
    isCompletedProcessStageTrace(item) &&
    hasVisibleProcessContent(item)
  )
}

function isCompletedProcessStageTrace(trace: ProcessTrace): boolean {
  return trace.status === 'done' &&
    trace.type !== 'reasoning' &&
    trace.type !== 'system'
}

function thinkingProgressLabel(t: TFunction, state: 'base' | 'active' | 'done', stage = ''): string {
  if (state === 'active' && stage) {
    return t('messageBubble.thinkingProgressActive', {
      stage,
      defaultValue: `正在${stage}`,
    })
  }
  if (state === 'done' && stage) {
    return t('messageBubble.thinkingProgressDone', {
      stage,
      defaultValue: `已完成${stage}`,
    })
  }
  return t('chat.thinking', { defaultValue: '思考中...' })
}

function waitingProcessLayerLabel(traces: ProcessTrace[], t: TFunction): string | undefined {
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const trace = traces[index]
    if (!isAgentWorkflowWaitingTrace(trace)) continue
    const metadata = trace.metadata
    const pendingReason = pendingActionReason(metadata?.pendingAction)
    const reason = pendingReason ?? metadata?.failureCode
    if (reason === 'evidence_insufficient') {
      return withWaitingWorkflowContext(translateMessageBubbleLabel(t, 'messageBubble.agentEvidenceRepairRequired', '证据需要修复'), metadata, t)
    }
    if (reason === 'step_limit_reached') {
      return withWaitingWorkflowContext(translateMessageBubbleLabel(t, 'messageBubble.agentStepLimitReached', '已达到步骤上限'), metadata, t)
    }
    if (reason === 'permission_required') {
      return withWaitingWorkflowContext(translateMessageBubbleLabel(t, 'messageBubble.agentPermissionRequired', '需要确认后继续'), metadata, t)
    }
    if (metadata?.reason === 'workflow-review-required') {
      return withWaitingWorkflowContext(translateMessageBubbleLabel(t, 'messageBubble.agentWorkflowReviewRequired', 'workflow 需要审核'), metadata, t)
    }
    if (metadata?.reason === 'workflow-disabled') {
      return withWaitingWorkflowContext(translateMessageBubbleLabel(t, 'messageBubble.agentWorkflowDisabled', 'workflow 已停用'), metadata, t)
    }
    if (metadata?.reason === 'workflow-invalid') {
      return withWaitingWorkflowContext(translateMessageBubbleLabel(t, 'messageBubble.agentWorkflowInvalid', 'workflow 定义无效'), metadata, t)
    }
    if (metadata?.reason === 'workflow-selection-ambiguous') {
      return withWaitingWorkflowContext(translateMessageBubbleLabel(t, 'messageBubble.agentWorkflowSelectionAmbiguous', 'workflow 选择不明确'), metadata, t)
    }
  }
  return undefined
}

function isAgentWorkflowWaitingTrace(trace: ProcessTrace): boolean {
  return isAgentWorkflowEnvelopeTrace(trace)
}

function agentWorkflowContinuationActionLabel(
  t: TFunction,
  pendingAction: ReturnType<typeof getWorkflowPendingActionFromMessage>,
  continuationAction: ReturnType<typeof getWorkflowContinuationActionFromMessage>,
): string {
  const context = workflowContextLabelFromRecords(t, pendingAction, continuationAction, true)
  if (continuationAction?.reason === 'failed') {
    return context
      ? t('messageBubble.retryAgentWorkflowStepWithContext', { context })
      : t('messageBubble.retryAgentWorkflowStep')
  }
  return context
    ? t('messageBubble.continueAgentWorkflowWithContext', { context })
    : t('messageBubble.continueAgentWorkflow')
}

function agentWorkflowRecoveryActionLabel(
  t: TFunction,
  recoveryAction: ReturnType<typeof getWorkflowRecoveryActionFromMessage>,
): string {
  const context = workflowContextLabelFromRecords(t, recoveryAction, undefined, true)
  return context
    ? t('messageBubble.reviewWorkflowSettingsWithContext', { context })
    : t('messageBubble.reviewWorkflowSettings')
}

function withWaitingWorkflowContext(label: string, metadata: Record<string, unknown> | undefined, t: TFunction): string {
  const context = workflowContextLabelFromTraceMetadata(metadata, t, false)
  return context ? `${label} · ${context}` : label
}

function workflowContextLabelFromTraceMetadata(metadata: Record<string, unknown> | undefined, t: TFunction, includeId: boolean): string {
  if (!metadata) return ''
  return workflowContextLabelFromRecords(t, metadata.pendingAction, metadata, includeId)
}

function workflowContextLabelFromRecords(t: TFunction, primary: unknown, secondary: unknown, includeId: boolean): string {
  const primaryRecord = asWorkflowContextRecord(primary)
  const secondaryRecord = asWorkflowContextRecord(secondary)
  const workflowName = workflowContextText(primaryRecord?.workflowName ?? secondaryRecord?.workflowName, 80)
  const workflowExpectedOutput = workflowContextText(primaryRecord?.workflowExpectedOutput ?? secondaryRecord?.workflowExpectedOutput, 40)
  const workflowId = includeId
    ? workflowContextText(primaryRecord?.workflowId ?? secondaryRecord?.workflowId, 64)
    : ''
  return [
    workflowName,
    workflowExpectedOutput ? t('messageBubble.agentWorkflowOutputContext', { output: workflowExpectedOutput }) : '',
    workflowId ? t('messageBubble.agentWorkflowIdContext', { id: workflowId }) : '',
  ].filter(Boolean).join(' · ')
}

function workflowContextText(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  return clampTraceText(redactSensitiveText(value.trim()), limit).replace(/\s+/g, ' ')
}

function asWorkflowContextRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function pendingActionReason(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const reason = (value as Record<string, unknown>).reason
  return typeof reason === 'string' ? reason : undefined
}

function collectThinkingSummaries(traces: ProcessTrace[]): string[] {
  const seen = new Set<string>()
  const summaries: string[] = []
  for (const trace of traces) {
    if (!hasDisplayableThinkingContent(trace)) continue
    const content = formatProcessTraceForDisplay(trace, 720).content
    if (!content) continue
    const summary = `${traceStageLabel(trace)} · ${content}`
    const key = summary.replace(/\s+/g, ' ').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    summaries.push(summary)
  }
  return summaries
}

function processTraceOperationName(trace: ProcessTrace, fallback: string): string {
  const metadata = trace.metadata ?? {}
  const candidates = [
    metadata.toolName,
    metadata.providerToolName,
    metadata.failedToolName,
    metadata.source,
    trace.title,
    fallback,
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    return clampTraceText(redactSensitiveText(candidate.trim()), 48).replace(/\s+/g, ' ')
  }
  return fallback
}

function hasAndroidUndoFollowUp(traces: ProcessTrace[]): boolean {
  return traces.some(isAndroidUndoFollowUpTrace)
}

function isAndroidUndoFollowUpTrace(trace: ProcessTrace): boolean {
  const metadata = trace.metadata
  return isWorkflowAndroidUndoFollowUpTrace(trace) &&
    typeof metadata?.androidUndoOperationCount === 'number' &&
    metadata.androidUndoOperationCount > 0 &&
    metadata.androidUndoToolName === 'android.files.undo_operations' &&
    metadata.androidUndoRequiresVisibleConfirmation === true
}

function isWorkflowAndroidUndoFollowUpTrace(trace: ProcessTrace): boolean {
  return isAgentWorkflowEnvelopeTrace(trace)
}

function hasSafeAgentActionPrompt(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return Boolean(clampTraceText(redactSensitiveText(value.trim()), AGENT_ACTION_PROMPT_VISIBILITY_LIMIT).trim())
}

type MessageActionSheetAction = {
  id: string
  label: string
  icon: AppIconName
  onPress: () => void
  danger?: boolean
  emphasized?: boolean
}

function MessageActionSheet({
  message,
  displayText,
  isLastAssistant,
  onClose,
  onCopy,
  canCopyProcessTrace,
  onCopyProcessTrace,
  onCopyWorkArtifact,
  onContinueWorkArtifact,
  canContinueAgentWorkflow,
  onContinueAgentWorkflow,
  canConfirmAction,
  onConfirmAction,
  canPrepareAndroidUndo,
  onPrepareAndroidUndo,
  canRepairAgentEvidence,
  onRepairAgentEvidence,
  canOpenWorkflowSettings,
  reviewWorkflowSettingsLabel,
  canSaveWorkflowSkill,
  onSaveWorkflowSkill,
  onSpeak,
  onConfigure,
  onRetry,
  onRegenerate,
  onDelete,
  onQuote,
  onEdit,
  onStartMultiSelect,
}: {
  message: Message
  displayText: string
  isLastAssistant: boolean
  onClose: () => void
  onCopy?: () => void
  canCopyProcessTrace: boolean
  onCopyProcessTrace?: () => void
  onCopyWorkArtifact?: () => void
  onContinueWorkArtifact?: () => void
  canContinueAgentWorkflow: boolean
  onContinueAgentWorkflow?: () => void
  canConfirmAction: boolean
  onConfirmAction?: () => void
  canPrepareAndroidUndo: boolean
  onPrepareAndroidUndo?: () => void
  canRepairAgentEvidence: boolean
  onRepairAgentEvidence?: () => void
  canOpenWorkflowSettings: boolean
  reviewWorkflowSettingsLabel: string
  canSaveWorkflowSkill: boolean
  onSaveWorkflowSkill?: () => void
  onSpeak?: () => void
  onConfigure?: () => void
  onRetry?: () => void
  onRegenerate?: () => void
  onDelete?: () => void
  onQuote?: () => void
  onEdit?: () => void
  onStartMultiSelect?: () => void
}) {
  const { colors, isGlass, canonicalThemeId } = useAppTheme()
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const actionChrome = resolveMessageActionChrome(colors, isGlass)
  const menuExpression = resolveThemeComponentExpression(canonicalThemeId, 'menu')
  const themeExpression = resolveThemeExpression(canonicalThemeId)
  const menuRadius = menuExpression.shape === 'angular'
    ? 2
    : menuExpression.shape === 'soft'
      ? 20
      : menuExpression.shape === 'material'
        ? 16
        : 24
  const menuSurface = menuExpression.surface === 'boundary'
    ? colors.ui.semantic.surface.base
    : menuExpression.surface === 'atmosphere'
      ? colors.ui.semantic.surface.overlay
      : menuExpression.surface === 'tonal'
        ? colors.ui.semantic.surface.raised
        : colors.ui.semantic.chrome.background
  const menuBorder = menuExpression.surface === 'atmosphere'
    ? colors.ui.control.focus
    : menuExpression.surface === 'lens'
      ? colors.ui.actionBar.itemBorder
      : actionChrome.barBorder
  const menuBorderWidth = menuExpression.border === 'none'
    ? 0
    : menuExpression.border === 'outline' || menuExpression.border === 'edge-highlight'
      ? 1
      : StyleSheet.hairlineWidth
  const menuFrom = motion !== 'full'
    ? { opacity: 1, translateY: 0, scale: 1 }
    : menuExpression.motion === 'precision'
      ? { opacity: 0, translateY: 6, scale: 1 }
      : menuExpression.motion === 'organic'
        ? { opacity: 0, translateY: 18, scale: 0.985 }
        : menuExpression.motion === 'material'
          ? { opacity: 0, translateY: 24, scale: 0.99 }
          : { opacity: 0, translateY: 30, scale: 0.965 }
  const menuTransition = motion !== 'full'
    ? { type: 'timing' as const, duration: 1 }
    : menuExpression.motion === 'fluid'
      ? { type: 'spring' as const, damping: 19, stiffness: 190, mass: 0.9 }
      : { type: 'timing' as const, duration: themeExpression.motion.duration.panel }
  const webGlassStyle = menuExpression.surface === 'lens' && Platform.OS === 'web'
    ? ({ backdropFilter: 'blur(18px) saturate(1.12)', WebkitBackdropFilter: 'blur(18px) saturate(1.12)' } as unknown as ViewStyle)
    : undefined
  const [showMore, setShowMore] = useState(false)
  const actionLockedRef = useRef(false)
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUser = message.role === 'user'
  const hasText = !!displayText.trim()
  const pendingWorkflowAction = !isUser ? getWorkflowPendingActionFromMessage(message) : undefined
  const workflowContinuationAction = !isUser ? getWorkflowContinuationActionFromMessage(message) : undefined
  const continueAgentWorkflowLabel = agentWorkflowContinuationActionLabel(t, pendingWorkflowAction, workflowContinuationAction)

  useEffect(() => () => {
    if (unlockTimer.current) clearTimeout(unlockTimer.current)
  }, [])

  function action(id: string, label: string, icon: AppIconName, onPress: (() => void) | undefined, options: Pick<MessageActionSheetAction, 'danger' | 'emphasized'> = {}): MessageActionSheetAction | null {
    return onPress ? { id, label, icon, onPress, ...options } : null
  }

  const workflowActions = [
    !isUser && canConfirmAction ? action('confirm', t('messageBubble.confirmAgentAction'), 'shield', onConfirmAction, { emphasized: true }) : null,
    !isUser && canContinueAgentWorkflow ? action('continue-workflow', continueAgentWorkflowLabel, 'back-next', onContinueAgentWorkflow, { emphasized: true }) : null,
    !isUser && canRepairAgentEvidence ? action('repair-evidence', t('messageBubble.repairAgentEvidence'), 'search', onRepairAgentEvidence, { emphasized: true }) : null,
    !isUser && canPrepareAndroidUndo ? action('android-undo', t('messageBubble.prepareAndroidUndo'), 'undo', onPrepareAndroidUndo, { emphasized: true }) : null,
  ].filter((item): item is MessageActionSheetAction => item !== null)
  const commonActions = [
    hasText ? action('copy', t('common.copy'), 'copy', onCopy) : null,
    isUser && hasText ? action('edit', t('common.edit'), 'edit', onEdit) : null,
    !isUser && message.status === 'error' ? action('retry', t('messageBubble.retry'), 'retry', onRetry, { emphasized: true }) : null,
    !isUser && isLastAssistant && message.status !== 'streaming' ? action('regenerate', t('messageBubble.regenerate'), 'regenerate', onRegenerate) : null,
    hasText ? action('quote', t('messageBubble.quote'), 'paste', onQuote) : null,
    !isUser && hasText ? action('speak', t('messageBubble.speak'), 'voice', onSpeak) : null,
  ].filter((item): item is MessageActionSheetAction => item !== null)
  const secondaryActions = [
    canCopyProcessTrace ? action('copy-trace', t('messageBubble.copyProcessTrace'), 'trace', onCopyProcessTrace) : null,
    hasText && !isUser ? action('copy-artifact', t('messageBubble.copyWorkArtifact'), 'list-check', onCopyWorkArtifact) : null,
    hasText && !isUser ? action('continue-artifact', t('messageBubble.continueWorkArtifact'), 'spark', onContinueWorkArtifact) : null,
    !isUser && canOpenWorkflowSettings ? action('workflow-settings', reviewWorkflowSettingsLabel, 'settings-sliders', onConfigure) : null,
    !isUser && canSaveWorkflowSkill ? action('save-workflow', t('messageBubble.saveAgentWorkflow'), 'workflow', onSaveWorkflowSkill) : null,
    action('multi-select', t('messageBubble.multiSelect'), 'list-check', onStartMultiSelect),
    !isUser && message.status === 'error' ? action('configure', t('messageBubble.configure'), 'settings-sliders', onConfigure) : null,
    action('delete', t('common.delete'), 'delete', onDelete, { danger: true }),
  ].filter((item): item is MessageActionSheetAction => item !== null)
  const prioritizedActions = [...workflowActions, ...commonActions]
  const primaryActions = prioritizedActions.slice(0, MESSAGE_ACTION_PRIMARY_LIMIT)
  const overflowActions = [...prioritizedActions.slice(MESSAGE_ACTION_PRIMARY_LIMIT), ...secondaryActions]
  const visibleActions = showMore ? overflowActions : primaryActions

  function run(item: MessageActionSheetAction) {
    if (actionLockedRef.current) return
    actionLockedRef.current = true
    if (unlockTimer.current) clearTimeout(unlockTimer.current)
    unlockTimer.current = setTimeout(() => {
      actionLockedRef.current = false
      unlockTimer.current = null
    }, MESSAGE_ACTION_LOCK_MS)
    onClose()
    item.onPress()
  }

  const sheetMaxHeight = Math.max(260, height - Math.max(insets.top, 12) - 24)
  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: width < 380 ? 10 : 16, paddingBottom: Math.max(insets.bottom, 10) }}>
        <Pressable
          accessible={false}
          accessibilityRole="none"
          onPress={onClose}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.backdrop }}
        />
        <MotiView
          testID="message-action-sheet"
          accessibilityRole="menu"
          accessibilityLabel={t('messageBubble.actions')}
          accessibilityViewIsModal
          from={menuFrom}
          animate={{ opacity: 1, translateY: 0, scale: 1 }}
          transition={menuTransition}
          style={[
            {
              width: '100%',
              maxWidth: MESSAGE_ACTION_SHEET_MAX_WIDTH,
              maxHeight: sheetMaxHeight,
              alignSelf: 'center',
              borderRadius: menuRadius,
              borderWidth: menuBorderWidth,
              borderColor: menuBorder,
              backgroundColor: menuSurface,
              overflow: 'hidden',
              elevation: menuExpression.elevation === 'layered' ? 18 : menuExpression.elevation === 'none' ? 0 : 8,
              shadowColor: colors.shadowTint,
              shadowOpacity: menuExpression.elevation === 'layered' ? 0.2 : menuExpression.elevation === 'none' ? 0 : 0.1,
              shadowRadius: menuExpression.elevation === 'layered' ? 20 : menuExpression.elevation === 'none' ? 0 : 12,
              shadowOffset: { width: 0, height: menuExpression.elevation === 'none' ? 0 : 8 },
            },
            webGlassStyle,
          ]}
        >
          <View style={{ minHeight: menuExpression.density === 'compact' ? 50 : 58, flexDirection: 'row', alignItems: 'center', gap: menuExpression.density === 'airy' ? 12 : 10, paddingLeft: menuExpression.shape === 'angular' ? 12 : 16, paddingRight: 7, borderBottomWidth: menuExpression.border === 'none' ? 0 : StyleSheet.hairlineWidth, borderBottomColor: menuBorder }}>
            {showMore ? (
              <IslePressable
                haptic
                accessibilityRole="button"
                accessibilityLabel={t('common.back')}
                onPress={() => setShowMore(false)}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <AppIcon name="back-previous" color={colors.textSecondary} size={18} strokeWidth={appIconStroke.strong} />
              </IslePressable>
            ) : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: menuExpression.density === 'compact' ? 14 : 15, lineHeight: 20, fontWeight: menuExpression.motion === 'material' ? '700' : '900', letterSpacing: menuExpression.motion === 'precision' ? 0.3 : 0 }}>
                {showMore ? t('messageBubble.moreActions') : t('messageBubble.actions')}
              </Text>
              <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 1 }}>
                {isUser ? t('messageBubble.userMessage') : t('messageBubble.assistantMessage')}
              </Text>
            </View>
            <IslePressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={onClose}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <AppIcon name="close" color={colors.textTertiary} size={18} strokeWidth={appIconStroke.strong} />
            </IslePressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={visibleActions.length > 6}
            contentContainerStyle={{ padding: menuExpression.density === 'compact' ? 6 : 8, gap: menuExpression.motion === 'precision' ? 0 : menuExpression.motion === 'organic' ? 5 : 2 }}
          >
            {visibleActions.map((item) => (
              <MessageActionSheetRow key={item.id} action={item} onPress={() => run(item)} />
            ))}
            {!showMore && overflowActions.length ? (
              <MessageActionSheetRow
                action={{
                  id: 'more',
                  label: t('messageBubble.moreActionsCount', { count: overflowActions.length }),
                  icon: 'more',
                  onPress: () => setShowMore(true),
                }}
                onPress={() => setShowMore(true)}
              />
            ) : null}
          </ScrollView>
        </MotiView>
      </View>
    </Modal>
  )
}

function MessageActionSheetRow({ action, onPress }: { action: MessageActionSheetAction; onPress: () => void }) {
  const { colors, isGlass, canonicalThemeId } = useAppTheme()
  const actionChrome = resolveMessageActionChrome(colors, isGlass)
  const menuExpression = resolveThemeComponentExpression(canonicalThemeId, 'menu')
  const foreground = action.danger
    ? colors.ui.tone.danger.foreground
    : action.emphasized
      ? colors.ui.icon.accentForeground
      : colors.textSecondary
  const background = action.danger
    ? colors.ui.tone.danger.background
    : action.emphasized
      ? colors.ui.actionBar.itemActiveBackground
      : menuExpression.surface === 'boundary'
        ? 'transparent'
        : menuExpression.surface === 'atmosphere'
          ? colors.ui.semantic.surface.base
          : menuExpression.surface === 'tonal'
            ? colors.ui.semantic.surface.muted
            : actionChrome.itemSurface
  const rowRadius = menuExpression.shape === 'angular'
    ? 0
    : menuExpression.shape === 'soft'
      ? 16
      : menuExpression.shape === 'material'
        ? 12
        : 18
  const iconSurface = menuExpression.motion === 'organic'
    ? colors.ui.icon.accentBackground
    : menuExpression.motion === 'fluid'
      ? colors.ui.semantic.chrome.background
      : 'transparent'
  const pressedOpacity = menuExpression.interaction === 'direct'
    ? 0.72
    : menuExpression.interaction === 'physical'
      ? 0.86
      : 0.9
  return (
    <IslePressable
      haptic
      testID={`message-action-menu-item-${canonicalThemeId}-${action.id}`}
      accessibilityRole="menuitem"
      accessibilityLabel={action.label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 50,
        flexDirection: 'row',
        alignItems: 'center',
        gap: menuExpression.density === 'airy' ? 13 : 10,
        paddingHorizontal: menuExpression.density === 'compact' ? 10 : 13,
        borderRadius: rowRadius,
        backgroundColor: pressed ? colors.ui.actionBar.itemActiveBackground : background,
        borderWidth: action.danger || menuExpression.border === 'edge-highlight' ? StyleSheet.hairlineWidth : 0,
        borderBottomWidth: !action.danger && menuExpression.border === 'divider' ? StyleSheet.hairlineWidth : undefined,
        borderColor: action.danger ? colors.ui.tone.danger.border : actionChrome.itemBorder,
        opacity: pressed ? pressedOpacity : 1,
      })}
    >
      <View style={{ width: menuExpression.motion === 'precision' ? 24 : 30, height: menuExpression.motion === 'precision' ? 24 : 30, borderRadius: menuExpression.motion === 'organic' || menuExpression.motion === 'fluid' ? 15 : menuExpression.motion === 'material' ? 8 : 0, alignItems: 'center', justifyContent: 'center', backgroundColor: iconSurface, borderWidth: menuExpression.motion === 'fluid' ? StyleSheet.hairlineWidth : 0, borderColor: actionChrome.itemBorder }}>
        <AppIcon name={action.icon} color={foreground} size={17} strokeWidth={appIconStroke.strong} />
      </View>
      <Text numberOfLines={2} style={{ flex: 1, minWidth: 0, color: foreground, fontSize: menuExpression.density === 'compact' ? 13 : 13.5, lineHeight: 18, fontWeight: menuExpression.motion === 'material' ? '600' : '800', letterSpacing: menuExpression.motion === 'precision' ? 0.15 : 0 }}>
        {action.label}
      </Text>
      {action.id === 'more' ? <AppIcon name="back-next" color={colors.textTertiary} size={16} /> : null}
    </IslePressable>
  )
}

function WorkArtifactQuickActions({
  hapticsEnabled,
  onCopy,
  onContinue,
}: {
  hapticsEnabled: boolean
  onCopy?: () => void
  onContinue?: () => void
}) {
  const { colors, isGlass } = useAppTheme()
  const { t } = useTranslation()
  const actionChrome = resolveMessageActionChrome(colors, isGlass)
  if (!onCopy && !onContinue) return null

  function run(action?: () => void) {
    return () => {
      if (!action) return
      if (hapticsEnabled) void Haptics.selectionAsync()
      action()
    }
  }

  return (
    <View
      style={{
        alignSelf: 'flex-end',
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 44,
        flexShrink: 0,
        gap: 6,
        marginTop: 10,
      }}
    >
      {onCopy ? (
        <WorkArtifactQuickActionButton
          label={t('messageBubble.copyWorkArtifact')}
          onPress={run(onCopy)}
          backgroundColor={actionChrome.itemSurface}
          borderColor={actionChrome.itemBorder}
        >
          <AppIcon name="list-check" color={colors.textSecondary} size={16} strokeWidth={appIconStroke.strong} />
        </WorkArtifactQuickActionButton>
      ) : null}
      {onContinue ? (
        <WorkArtifactQuickActionButton
          label={t('messageBubble.continueWorkArtifact')}
          onPress={run(onContinue)}
          backgroundColor={actionChrome.itemSurface}
          borderColor={actionChrome.itemBorder}
        >
          <AppIcon name="spark" color={colors.ui.icon.accentForeground} size={16} strokeWidth={appIconStroke.strong} />
        </WorkArtifactQuickActionButton>
      ) : null}
    </View>
  )
}

function WorkArtifactQuickActionButton({
  label,
  children,
  backgroundColor,
  borderColor,
  onPress,
}: {
  label: string
  children: ReactNode
  backgroundColor: string
  borderColor: string
  onPress: () => void
}) {
  const { colors } = useAppTheme()
  return (
    <IslePressable
      onPress={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: colors.ui.radius.controlSmall,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor,
        opacity: pressed ? 0.78 : 1,
      })}
    >
      {children}
    </IslePressable>
  )
}

function MessageBodyReveal({ active, children }: { active: boolean; children: ReactNode }) {
  if (!active) return <View>{children}</View>

  return (
    <View style={{ marginTop: active ? 4 : 0 }}>
      {children}
    </View>
  )
}

function canShowActionBar({
  message,
  displayText,
  isLastAssistant,
  onCopy,
  canCopyProcessTrace,
  onCopyWorkArtifact,
  onContinueWorkArtifact,
  canConfirmAction,
  canContinueAgentWorkflow,
  canPrepareAndroidUndo,
  canRepairAgentEvidence,
  canOpenWorkflowSettings,
  canSaveWorkflowSkill,
  canDeleteMessage,
  canQuoteMessage,
  canEditMessage,
  canStartMessageMultiSelect,
  onRetry,
  onRegenerate,
  onSpeak,
  onConfigure,
}: {
  message: Message
  displayText: string
  isLastAssistant: boolean
  onCopy?: (message: Message) => void
  canCopyProcessTrace: boolean
  onCopyWorkArtifact?: (message: Message) => void
  onContinueWorkArtifact?: (message: Message) => void
  canConfirmAction: boolean
  canContinueAgentWorkflow: boolean
  canPrepareAndroidUndo: boolean
  canRepairAgentEvidence: boolean
  canOpenWorkflowSettings: boolean
  canSaveWorkflowSkill: boolean
  canDeleteMessage: boolean
  canQuoteMessage: boolean
  canEditMessage: boolean
  canStartMessageMultiSelect: boolean
  onRetry?: (message: Message) => void
  onRegenerate?: () => void
  onSpeak?: (message: Message) => void
  onConfigure?: (message: Message) => void
}): boolean {
  if (message.status === 'sending') return false
  const hasText = displayText.length > 0
  if (message.role === 'user') return (hasText && !!onCopy) || canDeleteMessage || canQuoteMessage || canEditMessage || canStartMessageMultiSelect
  const hasCommonActions = (hasText && (!!onCopy || !!onSpeak || !!onCopyWorkArtifact || !!onContinueWorkArtifact)) || canCopyProcessTrace || canQuoteMessage
  const hasRegenerate = isLastAssistant && message.status !== 'streaming' && !!onRegenerate
  const hasErrorActions = message.status === 'error' && (!!onConfigure || !!onRetry)
  return hasCommonActions || hasRegenerate || canConfirmAction || canContinueAgentWorkflow || canPrepareAndroidUndo || canRepairAgentEvidence || canOpenWorkflowSettings || canSaveWorkflowSkill || hasErrorActions || canDeleteMessage || canStartMessageMultiSelect
}

function hasThinkingContent(trace: ProcessTrace): boolean {
  return hasDisplayableThinkingContent(trace)
}

function hasExpandableThinkingContent(trace: ProcessTrace): boolean {
  if (trace.metadata?.hiddenSignature || trace.type !== 'reasoning') return false
  return isActiveProcessTrace(trace) || hasDisplayableThinkingContent(trace)
}

function hasDisplayableThinkingContent(trace: ProcessTrace): boolean {
  if (trace.metadata?.hiddenSignature || trace.type !== 'reasoning') return false
  const content = trace.content?.trim()
  return Boolean(content && !isInternalThinkingStatusContent(content))
}

function isInternalThinkingStatusContent(content: string): boolean {
  return /^(disabled|enabled|adaptive)$/i.test(content.trim())
}

function hasVisibleProcessContent(trace: ProcessTrace): boolean {
  if (trace.metadata?.hiddenSignature) return false
  if (hasThinkingContent(trace)) return true
  if (isActiveProcessTrace(trace)) return true
  if (isAgentWorkflowWaitingTrace(trace)) return true
  if (trace.type === 'system' && isGenericModelRequestTrace(trace)) return false
  return Boolean(
    trace.content?.trim() ||
    metadataSummaryForTrace(trace) ||
    (
      trace.title.trim() &&
      trace.type !== 'system'
    )
  )
}

function shouldKeepBlockingProcessTraceVisible(trace: ProcessTrace, messageStatus: Message['status']): boolean {
  if (messageStatus === 'streaming' || messageStatus === 'sending') return false
  const normalized = normalizeTraceStatuses([trace], messageStatus)[0]
  if (!normalized || !hasVisibleProcessContent(normalized)) return false
  if (normalized.status === 'error' || normalized.status === 'cancelled') return true
  if (isAgentWorkflowWaitingTrace(normalized)) return true
  return false
}

function isGenericModelRequestTrace(trace: ProcessTrace): boolean {
  const metadata = trace.metadata ?? {}
  return trace.id.startsWith('model-') ||
    (
      typeof metadata.providerId === 'string' &&
      typeof metadata.model === 'string'
    )
}

function isActiveProcessTrace(trace: ProcessTrace): boolean {
  return trace.status === 'running' || trace.status === 'pending'
}

function translateMessageBubbleLabel(t: TFunction, key: string, fallback: string): string {
  const translated = t(key, { defaultValue: fallback })
  return typeof translated === 'string' && translated !== key ? translated : fallback
}

function TypingDots({ motion }: { motion: MotionIntensity }) {
  const { colors, canonicalThemeId } = useAppTheme()
  const grammar = resolveThemeComponentExpression(canonicalThemeId, 'loading').motion

  if (grammar === 'precision') {
    return (
      <View testID={`message-streaming-indicator-${canonicalThemeId}`} style={{ gap: 4, paddingVertical: 6 }}>
        {[14, 9, 5].map((width, index) => (
          <MotiView
            key={width}
            from={motion === 'full' ? { opacity: 0.22 } : { opacity: index === 0 ? 0.88 : 0.52 }}
            animate={{ opacity: index === 0 ? 0.88 : 0.52 }}
            transition={{ loop: motion === 'full', type: 'timing', duration: motion === 'full' ? 420 : 1, delay: motion === 'full' ? index * 60 : 0 }}
            style={{ width, height: 2, borderRadius: 1, backgroundColor: colors.textSecondary }}
          />
        ))}
      </View>
    )
  }

  if (grammar === 'material') {
    return (
      <View testID={`message-streaming-indicator-${canonicalThemeId}`} style={{ width: 38, height: 4, marginVertical: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.ui.semantic.surface.muted }}>
        <MotiView
          from={{ translateX: motion === 'full' ? -14 : 10, opacity: 0.78 }}
          animate={{ translateX: motion === 'full' ? 38 : 10, opacity: 1 }}
          transition={{ loop: motion === 'full', type: 'timing', duration: motion === 'full' ? 680 : 1 }}
          style={{ width: 14, height: 4, borderRadius: 4, backgroundColor: colors.ui.control.primaryBackground }}
        />
      </View>
    )
  }

  if (grammar === 'fluid') {
    return (
      <View testID={`message-streaming-indicator-${canonicalThemeId}`} style={{ width: 42, height: 12, marginVertical: 5, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.ui.actionBar.itemBackground, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.ui.actionBar.itemBorder }}>
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 7, right: 7, height: 1, backgroundColor: colors.ui.semantic.content.inverse, opacity: 0.56 }} />
        <MotiView
          from={{ translateX: motion === 'full' ? -18 : 13, opacity: 0.32, scaleX: 0.72 }}
          animate={{ translateX: motion === 'full' ? 42 : 13, opacity: 0.92, scaleX: 1 }}
          transition={{ loop: motion === 'full', type: 'timing', duration: motion === 'full' ? 920 : 1 }}
          style={{ width: 16, height: 10, marginTop: 1, borderRadius: 7, backgroundColor: colors.ui.icon.accentForeground }}
        />
      </View>
    )
  }

  return (
    <View testID={`message-streaming-indicator-${canonicalThemeId}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 7 }}>
      {[0, 1, 2].map((item) => (
        <MotiView
          key={item}
          from={motion === 'full' ? { opacity: 0.24, scale: 0.8, translateY: 2 } : { opacity: 0.82, scale: 1, translateY: 0 }}
          animate={{ opacity: 0.82, scale: 1, translateY: motion === 'full' ? -2 : 0 }}
          transition={{ loop: motion === 'full', type: 'timing', duration: motion === 'full' ? 760 : 1, delay: motion === 'full' ? item * 150 : 0 }}
          style={{ width: item === 1 ? 9 : 7, height: item === 1 ? 9 : 7, borderRadius: 6, backgroundColor: colors.textSecondary }}
        />
      ))}
    </View>
  )
}

/**
 * 消息属性比较函数 - 优化渲染性能
 * 返回 true 表示属性相同，跳过重新渲染
 */
const areMessagesEqual = (
  prevProps: MessageBubbleProps,
  nextProps: MessageBubbleProps
): boolean => {
  const prevMsg = prevProps.message
  const nextMsg = nextProps.message

  // 基础字段比较
  if (prevMsg.id !== nextMsg.id) return false
  if (prevMsg.role !== nextMsg.role) return false
  if (prevMsg.content !== nextMsg.content) return false
  if (prevMsg.responseText !== nextMsg.responseText) return false
  if (prevMsg.status !== nextMsg.status) return false
  if (prevMsg.timestamp !== nextMsg.timestamp) return false

  // 附件和 traces 长度比较
  if (prevMsg.attachments?.length !== nextMsg.attachments?.length) return false
  if (processTraceSignature(prevMsg) !== processTraceSignature(nextMsg)) return false

  // 其他关键 props 比较
  if (prevProps.index !== nextProps.index) return false
  if (prevProps.motion !== nextProps.motion) return false
  if (prevProps.providerBrand !== nextProps.providerBrand) return false
  if (prevProps.isLastAssistant !== nextProps.isLastAssistant) return false
  if (prevProps.showThinkingStatus !== nextProps.showThinkingStatus) return false
  if (prevProps.activeActionMessageId !== nextProps.activeActionMessageId) return false
  if (prevProps.multiSelectActive !== nextProps.multiSelectActive) return false
  if (prevProps.selected !== nextProps.selected) return false

  return true
}

function processTraceSignature(message: Message): string {
  return createProcessTraceSignature(collectVisibleProcessTraces(message))
}

/**
 * 使用 memo 优化的 MessageBubble 组件
 *
 * 性能提升：在长对话（100+消息）中，当新消息流式更新时，
 * 其他消息不会重新渲染，滚动性能提升约 2 倍
 */
export const MessageBubble = memo(MessageBubbleComponent, areMessagesEqual)
