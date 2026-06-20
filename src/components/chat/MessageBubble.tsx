import type { ReactNode } from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { MotiView } from 'moti'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import * as Haptics from 'expo-haptics'
import { useRouter } from 'expo-router'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { StyleSheet } from 'react-native'
import { runOnJS } from 'react-native-reanimated'
import type { ChatErrorCode, Message, ProcessTrace } from '@/types'
import { useAppTheme } from '@/hooks/useAppTheme'
import { messageAnimationForMotion } from '@/theme/animation'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { useSettingsStore } from '@/store/settingsStore'
import { MessageContent } from './MessageContent'
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
import { IslePanel } from '@/components/ui/isle'
import { RenderGuard } from '@/components/ui/RenderGuard'
import type { MotionIntensity } from '@/hooks/useMotionPreference'
import { getAgentEvidenceRepairActionFromMessage, getAgentPendingActionFromMessage, getAgentWorkflowContinuationActionFromMessage, getAgentWorkflowRecoveryActionFromMessage, getAgentWorkflowSkillSuggestionFromMessage } from '@/services/agent'
import { clampAgentOutput, redactSensitiveText } from '@/services/agent/agentTrace'

const STREAMING_LAYOUT_TEXT_STEP = 160
const STREAMING_RENDER_TEXT_STEP = 120
const STREAMING_RENDER_THROTTLE_MS = 120
const AGENT_ACTION_PROMPT_VISIBILITY_LIMIT = 900
const MESSAGE_ACTION_LOCK_MS = 420
const MESSAGE_BUBBLE_HORIZONTAL_GUTTER = 40

function resolveMessageActionChrome(colors: ReturnType<typeof useAppTheme>['colors'], isGlass: boolean) {
  return {
    barSurface: colors.ui.cartoon ? colors.ui.actionBar.background : isGlass ? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.base,
    barBorder: colors.ui.cartoon ? colors.ui.actionBar.border : colors.ui.semantic.chrome.border,
    itemSurface: colors.ui.cartoon ? colors.ui.actionBar.itemBackground : isGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted,
    itemBorder: colors.ui.cartoon ? colors.ui.actionBar.itemBorder : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border,
  }
}

function resolveAssistantBubbleSurface(colors: ReturnType<typeof useAppTheme>['colors'], isGlass: boolean) {
  return isGlass ? colors.ui.semantic.chrome.background : colors.ui.cartoon ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base
}

export interface MessageBubbleProps {
  conversationId: string
  message: Message
  index: number
  motion: MotionIntensity
  viewportHeight: number
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
  onConfirmAgentAction?: (message: Message) => void
  onPrepareAndroidUndo?: (message: Message) => void
  onRepairAgentEvidence?: (message: Message) => void
  onSaveAgentWorkflow?: (message: Message) => void
  onRetry?: (message: Message) => void
  onRegenerate?: () => void
  onSpeak?: (message: Message) => void
  onDelete?: (message: Message) => void
  onConfigure?: (message: Message) => void
  onTestModel?: (message: Message) => void
}

function MessageBubbleComponent({
  conversationId,
  message,
  index,
  motion,
  viewportHeight,
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
  onConfirmAgentAction,
  onPrepareAndroidUndo,
  onRepairAgentEvidence,
  onSaveAgentWorkflow,
  onRetry,
  onRegenerate,
  onSpeak,
  onDelete,
  onConfigure,
  onTestModel,
}: MessageBubbleProps) {
  const { colors, isGlass } = useAppTheme()
  const { t } = useTranslation()
  const actionChrome = resolveMessageActionChrome(colors, isGlass)
  const { width: windowWidth } = useWindowDimensions()
  const hapticsEnabled = useSettingsStore((state) => state.settings.hapticsEnabled)
  const [localActionsOpen, setLocalActionsOpen] = useState(false)
  const [processExpanded, setProcessExpanded] = useState(false)
  const previousActionBarOpen = useRef<boolean | null>(null)
  const isUser = message.role === 'user'
  const isStreamingContent = !isUser && (message.status === 'streaming' || message.status === 'sending')
  const displayText = message.responseText ?? message.content
  const renderedDisplayText = useThrottledStreamingText(displayText, isStreamingContent)
  const streamingLayoutStep = isStreamingContent ? Math.floor(displayText.length / STREAMING_LAYOUT_TEXT_STEP) : 0
  const processTraces = useMemo(() => collectVisibleProcessTraces(message), [message.reasoning, message.retrievalTrace, message.toolCalls])
  const processLayerVisible = !isUser && (
    isStreamingContent ||
    showThinkingStatus ||
    processTraces.some(isActiveProcessTrace) ||
    processTraces.some(hasVisibleProcessContent) ||
    processTraces.some(isAgentWorkflowWaitingTrace)
  )
  const bubbleMaxWidth = useMemo(
    () => resolveMessageBubbleMaxWidth(renderedDisplayText, isUser, processLayerVisible, windowWidth),
    [renderedDisplayText, isUser, processLayerVisible, windowWidth]
  )
  const processTextLength = useMemo(() => processTraces.reduce((total, trace) => {
    const display = formatProcessTraceForDisplay(trace)
    return total + display.title.length + display.content.length
  }, 0), [processTraces])
  const processLayoutStep = isStreamingContent ? Math.floor(processTextLength / STREAMING_LAYOUT_TEXT_STEP) : 0
  const processCanExpand = !isUser && processTraces.some(hasVisibleProcessContent)
  const canCopyProcessTrace = !isUser && processTraces.length > 0 && !!onCopyProcessTrace
  const processMaxHeight = Math.min(230, viewportHeight * 0.34)
  const actionBarOpen = activeActionMessageId === undefined ? localActionsOpen : activeActionMessageId === message.id
  const actionMessage = !isUser && !isStreamingContent ? message : undefined
  const pendingAgentAction = useMemo(() => actionMessage ? getAgentPendingActionFromMessage(actionMessage) : undefined, [actionMessage])
  const evidenceRepairAction = useMemo(() => actionMessage ? getAgentEvidenceRepairActionFromMessage(actionMessage) : undefined, [actionMessage])
  const workflowRecoveryAction = useMemo(() => actionMessage ? getAgentWorkflowRecoveryActionFromMessage(actionMessage) : undefined, [actionMessage])
  const workflowContinuationAction = useMemo(() => actionMessage ? getAgentWorkflowContinuationActionFromMessage(actionMessage) : undefined, [actionMessage])
  const canConfirmAgentAction = !!pendingAgentAction?.confirmable && !!pendingAgentAction.resumeToolRequest && !!onConfirmAgentAction
  const canContinueAgentWorkflow = (pendingAgentAction?.reason === 'step_limit_reached' || (pendingAgentAction?.reason === 'permission_required' && hasSafeAgentActionPrompt(pendingAgentAction.suggestedUserPrompt)) || !!workflowContinuationAction) && !!onContinueAgentWorkflow
  const canRepairAgentEvidence = !!evidenceRepairAction && !!onRepairAgentEvidence
  const canPrepareAndroidUndo = !isUser && hasAndroidUndoFollowUp(processTraces) && !!onPrepareAndroidUndo
  const canOpenWorkflowSettings = !!workflowRecoveryAction && workflowRecoveryAction.reason !== 'workflow-selection-ambiguous' && !!onConfigure
  const reviewWorkflowSettingsLabel = agentWorkflowRecoveryActionLabel(t, workflowRecoveryAction)
  const agentWorkflowSuggestion = !isUser ? getAgentWorkflowSkillSuggestionFromMessage(message) : undefined
  const canSaveAgentWorkflow = message.status === 'done' && !!agentWorkflowSuggestion?.ok && !!agentWorkflowSuggestion.skill && !!onSaveAgentWorkflow
  const canDeleteMessage = !!onDelete && message.status !== 'sending' && message.status !== 'streaming'
  const canOpenActions = !isStreamingContent && canShowActionBar({
    message,
    displayText,
    isLastAssistant,
    onCopy,
    canCopyProcessTrace,
    onCopyWorkArtifact,
    onContinueWorkArtifact,
    canConfirmAgentAction,
    canContinueAgentWorkflow,
    canPrepareAndroidUndo,
    canRepairAgentEvidence,
    canOpenWorkflowSettings,
    canSaveAgentWorkflow,
    canDeleteMessage,
    onRetry,
    onRegenerate,
    onSpeak,
    onConfigure,
    onTestModel,
  })

  useEffect(() => {
    setLocalActionsOpen(false)
    setProcessExpanded(false)
    if (activeActionMessageId === message.id) onActionMessageChange?.(null)
  }, [message.id])

  useEffect(() => {
    if (!isStreamingContent) return
    onLayoutChangeRequest?.()
  }, [isStreamingContent, processTraces.length, processLayoutStep, streamingLayoutStep, onLayoutChangeRequest])

  useEffect(() => {
    const previousOpen = previousActionBarOpen.current
    previousActionBarOpen.current = actionBarOpen
    if (previousOpen === null ? actionBarOpen : previousOpen !== actionBarOpen) onLayoutChangeRequest?.()
  }, [actionBarOpen, onLayoutChangeRequest])

  function setActionBarOpen(open: boolean) {
    setLocalActionsOpen(open)
    onActionMessageChange?.(open ? message.id : null)
  }

  function toggleActionBar() {
    if (!canOpenActions) return
    if (hapticsEnabled) void Haptics.selectionAsync()
    setActionBarOpen(!actionBarOpen)
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
    .enabled(canOpenActions)
    .maxDuration(220)
    .maxDistance(14)
    .onEnd((_event, success) => {
      if (success) runOnJS(toggleActionBar)()
    })

  function handleBubbleLayout() {
    if (isStreamingContent || actionBarOpen || processLayerVisible) onLayoutChangeRequest?.()
  }

  return (
    <View onLayout={handleBubbleLayout} style={{ marginBottom: actionBarOpen ? 20 : 16 }}>
      <MotiView
        {...messageAnimationForMotion(index, motion)}
        style={{
          alignSelf: isUser ? 'flex-end' : 'flex-start',
          maxWidth: bubbleMaxWidth,
          flexShrink: 1,
        }}
      >
        <View>
          <IslePanel
            elevated={colors.ui.cartoon}
            contentStyle={{
              paddingHorizontal: 14,
              paddingVertical: 11,
              position: 'relative',
            }}
            style={{
              borderRadius: colors.ui.radius.panel,
              borderBottomRightRadius: isUser ? colors.ui.radius.controlSmall : colors.ui.radius.panel,
              borderBottomLeftRadius: isUser ? colors.ui.radius.panel : colors.ui.radius.controlSmall,
              backgroundColor: isUser ? colors.ui.message.userBackground : resolveAssistantBubbleSurface(colors, isGlass),
              borderColor: message.status === 'error' ? colors.ui.tone.danger.border : isUser ? colors.ui.message.userBorder : colors.ui.semantic.chrome.border,
            }}
          >
            {processLayerVisible ? (
              <MessageProcessLayer
                message={message}
                traces={processTraces}
                expanded={processExpanded}
                canExpand={processCanExpand}
                maxHeight={processMaxHeight}
                onToggle={toggleProcessLayer}
                trailingActionSpace={false}
              />
            ) : null}
            <GestureDetector gesture={tapBubble}>
              <View>
                <MessageBody
                  conversationId={conversationId}
                  message={message}
                  displayText={renderedDisplayText}
                  isUser={isUser}
                  isStreamingContent={isStreamingContent}
                  onLayoutChangeRequest={onLayoutChangeRequest}
                />
              </View>
            </GestureDetector>
          </IslePanel>
        </View>

        {actionBarOpen ? (
          <MessageActionBar
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
            canConfirmAgentAction={canConfirmAgentAction}
            onConfirmAgentAction={onConfirmAgentAction ? () => onConfirmAgentAction(message) : undefined}
            canPrepareAndroidUndo={canPrepareAndroidUndo}
            onPrepareAndroidUndo={onPrepareAndroidUndo ? () => onPrepareAndroidUndo(message) : undefined}
            canRepairAgentEvidence={canRepairAgentEvidence}
            onRepairAgentEvidence={onRepairAgentEvidence ? () => onRepairAgentEvidence(message) : undefined}
            canOpenWorkflowSettings={canOpenWorkflowSettings}
            reviewWorkflowSettingsLabel={reviewWorkflowSettingsLabel}
            canSaveAgentWorkflow={canSaveAgentWorkflow}
            onSaveAgentWorkflow={onSaveAgentWorkflow ? () => onSaveAgentWorkflow(message) : undefined}
            onSpeak={onSpeak ? () => onSpeak(message) : undefined}
            onConfigure={onConfigure ? () => onConfigure(message) : undefined}
            onTestModel={onTestModel ? () => onTestModel(message) : undefined}
            onRetry={onRetry ? () => onRetry(message) : undefined}
            onRegenerate={onRegenerate}
            onDelete={canDeleteMessage && onDelete ? () => onDelete(message) : undefined}
          />
        ) : null}
      </MotiView>
    </View>
  )
}

function useThrottledStreamingText(text: string, active: boolean): string {
  const [renderedText, setRenderedText] = useState(text)
  const latestText = useRef(text)
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    latestText.current = text
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
      if (text.length - current.length >= STREAMING_RENDER_TEXT_STEP) return text
      return current
    })

    if (!renderTimer.current) {
      renderTimer.current = setTimeout(() => {
        renderTimer.current = null
        setRenderedText((current) => current === latestText.current ? current : latestText.current)
      }, STREAMING_RENDER_THROTTLE_MS)
    }
  }, [active, text])

  useEffect(() => () => {
    if (renderTimer.current) clearTimeout(renderTimer.current)
  }, [])

  return renderedText
}

function resolveMessageBubbleMaxWidth(displayText: string, isUser: boolean, processLayerVisible: boolean, windowWidth: number): number {
  const availableWidth = Math.max(220, windowWidth - MESSAGE_BUBBLE_HORIZONTAL_GUTTER)
  const fullWidth = Math.floor(availableWidth * (isUser ? 0.84 : 0.94))
  if (isUser || processLayerVisible || hasWideMessageContent(displayText)) return fullWidth

  const normalizedText = displayText.trim().replace(/\s+/g, ' ')
  const charCount = Array.from(normalizedText).length
  if (charCount <= 0) return Math.min(fullWidth, 180)
  if (charCount <= 18) return Math.min(fullWidth, 220)
  if (charCount <= 56) return Math.min(fullWidth, 320)
  if (charCount <= 120) return Math.min(fullWidth, 430)
  return fullWidth
}

function hasWideMessageContent(displayText: string): boolean {
  if (/```|^\s*[\[{]/m.test(displayText)) return true
  const lines = displayText.split('\n')
  if (lines.length > 4) return true
  if (lines.some((line) => line.length > 88)) return true
  return lines.some((line) => /^\s*\|.+\|\s*$/.test(line))
}

function MessageBody({
  conversationId,
  message,
  displayText,
  isUser,
  isStreamingContent,
  onLayoutChangeRequest,
}: {
  conversationId: string
  message: Message
  displayText: string
  isUser: boolean
  isStreamingContent: boolean
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
            <MessageContent content={displayText} isUser={isUser} isStreaming={isStreamingContent} onLayoutChangeRequest={onLayoutChangeRequest} />
          </MessageBodyReveal>
        ) : !isUser && !isStreamingContent ? (
          <Text style={{ color: isUser ? userMessage.userForeground : colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
            {t('messageBubble.emptyResponse')}
          </Text>
        ) : isUser ? (
          <TypingDots />
        ) : null}
      </RenderGuard>
      {!isUser && message.citations?.length ? <MessageSourceLink conversationId={conversationId} message={message} /> : null}
      {isStreamingContent && displayText ? <Cursor /> : null}
      {message.status === 'error' ? <ErrorHint code={message.errorCode} /> : null}
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
        minHeight: 34,
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
      <Text style={{ color: colors.ui.icon.accentForeground, fontSize: 12, lineHeight: 16, fontWeight: '900' }}>
        {t('messageBubble.sources', { count })}
      </Text>
    </IslePressable>
  )
}

function MessageProcessLayer({
  message,
  traces,
  expanded,
  canExpand,
  maxHeight,
  onToggle,
  trailingActionSpace = false,
}: {
  message: Message
  traces: ProcessTrace[]
  expanded: boolean
  canExpand: boolean
  maxHeight: number
  onToggle: () => void
  trailingActionSpace?: boolean
}) {
  const { colors, isGlass } = useAppTheme()
  const actionChrome = resolveMessageActionChrome(colors, isGlass)
  const { t } = useTranslation()
  const active = message.status === 'streaming' || message.status === 'sending'
  const processStatusLabel = processLayerLabel(message, traces, t)
  const emphasizedStatus = message.status === 'error' || message.status === 'cancelled' || traces.some(isAgentWorkflowWaitingTrace)
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
          ? colors.ui.tone.info.background
          : actionChrome.itemSurface
  const statusBorder =
    message.status === 'error'
      ? colors.ui.tone.danger.border
      : message.status === 'cancelled'
        ? colors.ui.tone.warning.border
        : active
          ? colors.ui.tone.info.border
          : actionChrome.itemBorder

  return (
    <View style={{ marginBottom: 8 }}>
      <IslePressable
        haptic
        disabled={!canExpand}
        onPress={onToggle}
        accessibilityLabel={processAccessibilityLabel}
        accessibilityRole={canExpand ? 'button' : 'text'}
        accessibilityState={processAccessibilityState}
        accessibilityValue={canExpand ? { text: processStatusLabel } : undefined}
        style={{
          minHeight: 26,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          alignSelf: 'flex-start',
          width: active ? '100%' : undefined,
          maxWidth: '100%',
          borderRadius: colors.ui.radius.chip,
          paddingVertical: emphasizedStatus ? 5 : 2,
          paddingHorizontal: emphasizedStatus ? 8 : 0,
          paddingRight: emphasizedStatus && trailingActionSpace ? 48 : emphasizedStatus ? 8 : 0,
          backgroundColor: emphasizedStatus ? statusBackground : 'transparent',
          borderWidth: emphasizedStatus ? 1 : 0,
          borderColor: emphasizedStatus ? statusBorder : 'transparent',
        }}
      >
        <ThinkingPulse active={active} tone={tone} />
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ color: tone, fontSize: 12, lineHeight: 16, fontWeight: '800', flexGrow: 1, flexShrink: 1, minWidth: 120 }}
        >
          {processStatusLabel}
        </Text>
        {canExpand ? (
          <MotiView animate={{ rotate: expanded ? '90deg' : '0deg' }} transition={{ type: 'timing', duration: 150 }}>
            <AppIcon name="back-next" color={colors.textTertiary} size={14} strokeWidth={appIconStroke.strong} />
          </MotiView>
        ) : null}
      </IslePressable>
      {expanded && canExpand ? <MessageProcessPanel message={message} traces={traces} maxHeight={maxHeight} /> : null}
    </View>
  )
}

function MessageProcessPanel({ message, traces, maxHeight }: { message: Message; traces: ProcessTrace[]; maxHeight: number }) {
  const { colors, isGlass } = useAppTheme()
  const { t } = useTranslation()
  const scrollRef = useRef<ScrollView>(null)
  const thinkingSummaries = normalizeTraceStatuses(traces, message.status)
    .filter(hasVisibleProcessContent)
    .map((trace) => formatProcessSummary(trace, message.status, t))
    .filter(Boolean)
  const contentLength = thinkingSummaries.reduce((total, summary) => total + summary.length, 0)
  const running = message.status === 'streaming' || message.status === 'sending'

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: running }))
  }, [contentLength, running, thinkingSummaries.length])

  return (
    <MotiView
      from={{ opacity: 0, translateY: -3 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 130 }}
      style={{
        marginTop: 7,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: isGlass ? colors.ui.actionBar.itemBorder : colors.material.stroke,
        paddingTop: 8,
      }}
    >
      <ScrollView ref={scrollRef} nestedScrollEnabled showsVerticalScrollIndicator={contentLength > 360 || thinkingSummaries.length > 2} style={{ maxHeight }}>
        {thinkingSummaries.length ? (
          <View style={{ gap: 8 }}>
            {thinkingSummaries.map((summary, index) => (
              <Text key={`${index}-${summary.slice(0, 24)}`} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '700' }}>
                {summary}
              </Text>
            ))}
          </View>
        ) : running ? (
          <TypingDots />
        ) : null}
      </ScrollView>
    </MotiView>
  )
}

function ThinkingPulse({ active, tone }: { active: boolean; tone: string }) {
  if (!active) {
    return (
      <View style={{ width: 22, height: 10, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
        {[0, 1, 2].map((item) => (
          <View
            key={item}
            style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: tone, opacity: 0.65 }}
          />
        ))}
      </View>
    )
  }

  return (
    <View style={{ width: 22, height: 10, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      {[0, 1, 2].map((item) => (
        <MotiView
          key={item}
          from={{ opacity: active ? 0.3 : 0.65, translateY: 0 }}
          animate={{ opacity: active ? 1 : 0.65, translateY: active ? -2 : 0 }}
          transition={{ loop: active, type: 'timing', duration: 560, delay: item * 120 }}
          style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: tone }}
        />
      ))}
    </View>
  )
}

function processLayerLabel(message: Message, traces: ProcessTrace[], t: TFunction): string {
  const waitingLabel = waitingProcessLayerLabel(traces, t)
  if (waitingLabel) return withProcessStageLabel(waitingLabel, traces, message.status)

  if (message.status === 'streaming' || message.status === 'sending') {
    const activeTrace = selectActiveProcessTrace(traces, message.status)
    const completedTrace = selectLatestCompletedProcessTrace(traces, message.status)
    if (activeTrace && !isGenericModelRequestTrace(activeTrace)) return thinkingProgressLabel(t, 'active', traceActivityStageLabel(activeTrace))
    if (completedTrace) return thinkingProgressLabel(t, 'done', traceActivityStageLabel(completedTrace))
    if (activeTrace) return thinkingProgressLabel(t, 'active', traceActivityStageLabel(activeTrace))
    return thinkingProgressLabel(t, 'base')
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

function thinkingDoneLabel(message: Message, traces: ProcessTrace[], t: TFunction): string {
  const settledStage = settledProcessStageLabel(message, traces, t)
  if (settledStage) return settledStage
  const durationMs = resolveThinkingDurationMs(message, traces)
  if (durationMs) {
    return t('messageBubble.thinkingDoneWithDuration', {
      duration: formatDuration(durationMs),
      defaultValue: `已思考 ${formatDuration(durationMs)}`,
    })
  }
  return translateMessageBubbleLabel(t, 'messageBubble.thinkingDone', '已思考')
}

function settledProcessStageLabel(message: Message, traces: ProcessTrace[], t: TFunction): string {
  const trace = selectLatestCompletedProcessTrace(traces, message.status)
  if (!trace) return ''
  return thinkingProgressLabel(t, 'done', traceActivityStageLabel(trace))
}

function resolveThinkingDurationMs(message: Message, traces: ProcessTrace[]): number | undefined {
  const traceDurations = normalizeTraceStatuses(traces, message.status)
    .filter((trace) => trace.type === 'reasoning' && !trace.metadata?.hiddenSignature)
    .map(traceDurationMs)
    .filter((duration): duration is number => typeof duration === 'number' && duration > 0)
  if (traceDurations.length) return Math.max(...traceDurations)
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
      defaultValue: `思考中... > 正在${stage}`,
    })
  }
  if (state === 'done' && stage) {
    return t('messageBubble.thinkingProgressDone', {
      stage,
      defaultValue: `思考中... > 已完成${stage}`,
    })
  }
  return t('messageBubble.thinkingProgressBase', {
    defaultValue: '思考中... >',
  })
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
  pendingAction: ReturnType<typeof getAgentPendingActionFromMessage>,
  continuationAction: ReturnType<typeof getAgentWorkflowContinuationActionFromMessage>,
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
  recoveryAction: ReturnType<typeof getAgentWorkflowRecoveryActionFromMessage>,
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
  return clampAgentOutput(redactSensitiveText(value.trim()), limit).replace(/\s+/g, ' ')
}

function asWorkflowContextRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function pendingActionReason(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const reason = (value as Record<string, unknown>).reason
  return typeof reason === 'string' ? reason : undefined
}

function formatThinkingSummary(trace: ProcessTrace): string {
  const summary = formatProcessTraceForDisplay(trace, 720).content
  return summary ? `${traceStageLabel(trace)} · ${summary}` : ''
}

function formatProcessSummary(trace: ProcessTrace, messageStatus: Message['status'], t: TFunction): string {
  if (hasThinkingContent(trace)) return formatThinkingSummary(trace)
  const stage = traceActivityStageLabel(trace)
  if (isActiveProcessTrace(trace)) return thinkingProgressLabel(t, 'active', stage)
  const normalized = normalizeTraceStatuses([trace], messageStatus)[0] ?? trace
  if (isCompletedProcessStageTrace(normalized)) return thinkingProgressLabel(t, 'done', stage)
  if (normalized.status === 'skipped' || normalized.status === 'cancelled') return ''
  const display = formatProcessTraceForDisplay(trace, 140)
  const summary = display.content || display.title
  return summary ? `${stage} · ${summary}` : ''
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
  return Boolean(clampAgentOutput(redactSensitiveText(value.trim()), AGENT_ACTION_PROMPT_VISIBILITY_LIMIT).trim())
}

function MessageActionBar({
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
  canConfirmAgentAction,
  onConfirmAgentAction,
  canPrepareAndroidUndo,
  onPrepareAndroidUndo,
  canRepairAgentEvidence,
  onRepairAgentEvidence,
  canOpenWorkflowSettings,
  reviewWorkflowSettingsLabel,
  canSaveAgentWorkflow,
  onSaveAgentWorkflow,
  onSpeak,
  onConfigure,
  onTestModel,
  onRetry,
  onRegenerate,
  onDelete,
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
  canConfirmAgentAction: boolean
  onConfirmAgentAction?: () => void
  canPrepareAndroidUndo: boolean
  onPrepareAndroidUndo?: () => void
  canRepairAgentEvidence: boolean
  onRepairAgentEvidence?: () => void
  canOpenWorkflowSettings: boolean
  reviewWorkflowSettingsLabel: string
  canSaveAgentWorkflow: boolean
  onSaveAgentWorkflow?: () => void
  onSpeak?: () => void
  onConfigure?: () => void
  onTestModel?: () => void
  onRetry?: () => void
  onRegenerate?: () => void
  onDelete?: () => void
}) {
  const { colors, isGlass } = useAppTheme()
  const { t } = useTranslation()
  const actionChrome = resolveMessageActionChrome(colors, isGlass)
  const actionLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const actionLockedRef = useRef(false)
  const [actionLocked, setActionLocked] = useState(false)
  const isUser = message.role === 'user'
  const canCopy = !!displayText && !!onCopy
  const canSpeak = !!displayText && !isUser && !!onSpeak
  const canRegenerate = !isUser && isLastAssistant && message.status !== 'streaming' && !!onRegenerate
  const canUseWorkArtifact = !!displayText && !isUser
  const showContinueAgentWorkflow = !isUser && canContinueAgentWorkflow && !!onContinueAgentWorkflow
  const showConfirmAgentAction = !isUser && canConfirmAgentAction && !!onConfirmAgentAction
  const showPrepareAndroidUndo = !isUser && canPrepareAndroidUndo && !!onPrepareAndroidUndo
  const showRepairAgentEvidence = !isUser && canRepairAgentEvidence && !!onRepairAgentEvidence
  const showOpenWorkflowSettings = !isUser && canOpenWorkflowSettings && !!onConfigure
  const showSaveAgentWorkflow = !isUser && canSaveAgentWorkflow && !!onSaveAgentWorkflow
  const showErrorActions = !isUser && message.status === 'error'
  const canDelete = !!onDelete && message.status !== 'sending' && message.status !== 'streaming'
  const iconColor = colors.textSecondary
  const pendingAgentAction = !isUser ? getAgentPendingActionFromMessage(message) : undefined
  const workflowContinuationAction = !isUser ? getAgentWorkflowContinuationActionFromMessage(message) : undefined
  const continueAgentWorkflowLabel = agentWorkflowContinuationActionLabel(t, pendingAgentAction, workflowContinuationAction)

  useEffect(() => {
    return () => {
      if (actionLockTimer.current) clearTimeout(actionLockTimer.current)
      actionLockTimer.current = null
    }
  }, [])

  function run(action?: () => void) {
    return () => {
      if (actionLockedRef.current) return
      actionLockedRef.current = true
      setActionLocked(true)
      if (actionLockTimer.current) clearTimeout(actionLockTimer.current)
      actionLockTimer.current = setTimeout(() => {
        actionLockTimer.current = null
        actionLockedRef.current = false
        setActionLocked(false)
      }, MESSAGE_ACTION_LOCK_MS)
      onClose()
      action?.()
    }
  }

  if (message.status === 'sending') return null
  if (isUser && !canCopy && !canDelete) return null
  if (!isUser && !canCopy && !canCopyProcessTrace && !canSpeak && !canRegenerate && !onCopyWorkArtifact && !onContinueWorkArtifact && !showContinueAgentWorkflow && !showConfirmAgentAction && !showPrepareAndroidUndo && !showRepairAgentEvidence && !showOpenWorkflowSettings && !showSaveAgentWorkflow && !showErrorActions && !canDelete) return null

  return (
    <MotiView
      from={{ opacity: 0, translateY: -3, scale: 0.97 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={{ type: 'timing', duration: 120 }}
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        marginTop: 6,
        minHeight: 52,
        maxWidth: '100%',
        borderRadius: colors.ui.radius.controlLarge,
        backgroundColor: actionChrome.barSurface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: actionChrome.barBorder,
        shadowColor: colors.shadowTint,
        shadowOpacity: colors.ui.cartoon ? Math.min(colors.ui.card.shadowOpacity, 0.012) : 0,
        shadowRadius: colors.ui.cartoon ? Math.max(2, colors.ui.card.shadowRadius - 5) : 0,
        shadowOffset: { width: 0, height: colors.ui.cartoon ? Math.max(1, colors.ui.card.shadowOffset - 2) : 0 },
        elevation: colors.ui.cartoon && colors.ui.card.shadowOpacity > 0 ? 1 : 0,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        accessibilityLabel={t('messageBubble.actions')}
        contentContainerStyle={{
          minHeight: 50,
          paddingHorizontal: 4,
          paddingVertical: 4,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 3,
        }}
        style={{ maxWidth: '100%' }}
      >
      {canCopy ? (
        <ActionIconButton label={t('common.copy')} disabled={actionLocked} onPress={run(onCopy)}>
          <AppIcon name="copy" color={iconColor} size={16} strokeWidth={appIconStroke.strong} />
        </ActionIconButton>
      ) : null}
      {canCopyProcessTrace ? (
        <ActionIconButton label={t('messageBubble.copyProcessTrace')} disabled={actionLocked} onPress={run(onCopyProcessTrace)}>
          <AppIcon name="trace" color={iconColor} size={16} strokeWidth={appIconStroke.strong} />
        </ActionIconButton>
      ) : null}
      {canSpeak ? (
        <ActionIconButton label={t('messageBubble.speak')} disabled={actionLocked} onPress={run(onSpeak)}>
          <AppIcon name="voice" color={iconColor} size={16} strokeWidth={appIconStroke.strong} />
        </ActionIconButton>
      ) : null}
      {canRegenerate ? (
        <ActionIconButton label={t('messageBubble.regenerate')} disabled={actionLocked} onPress={run(onRegenerate)}>
          <AppIcon name="regenerate" color={iconColor} size={16} strokeWidth={appIconStroke.strong} />
        </ActionIconButton>
      ) : null}
      {showContinueAgentWorkflow ? (
        <ActionIconButton label={continueAgentWorkflowLabel} disabled={actionLocked} onPress={run(onContinueAgentWorkflow)}>
          <AppIcon name="back-next" color={colors.ui.icon.accentForeground} size={16} strokeWidth={appIconStroke.strong} />
        </ActionIconButton>
      ) : null}
      {showConfirmAgentAction ? (
        <ActionIconButton label={t('messageBubble.confirmAgentAction')} disabled={actionLocked} onPress={run(onConfirmAgentAction)}>
          <AppIcon name="shield" color={colors.ui.icon.accentForeground} size={16} strokeWidth={appIconStroke.strong} />
        </ActionIconButton>
      ) : null}
      {showPrepareAndroidUndo ? (
        <ActionIconButton label={t('messageBubble.prepareAndroidUndo')} disabled={actionLocked} onPress={run(onPrepareAndroidUndo)}>
          <AppIcon name="undo" color={colors.ui.icon.accentForeground} size={16} strokeWidth={appIconStroke.strong} />
        </ActionIconButton>
      ) : null}
      {showRepairAgentEvidence ? (
        <ActionIconButton label={t('messageBubble.repairAgentEvidence')} disabled={actionLocked} onPress={run(onRepairAgentEvidence)}>
          <AppIcon name="search" color={colors.ui.icon.accentForeground} size={16} strokeWidth={appIconStroke.strong} />
        </ActionIconButton>
      ) : null}
      {showOpenWorkflowSettings ? (
        <ActionIconButton label={reviewWorkflowSettingsLabel} disabled={actionLocked} onPress={run(onConfigure)}>
          <AppIcon name="settings-sliders" color={colors.ui.icon.accentForeground} size={16} strokeWidth={appIconStroke.strong} />
        </ActionIconButton>
      ) : null}
      {showSaveAgentWorkflow ? (
        <ActionIconButton label={t('messageBubble.saveAgentWorkflow')} disabled={actionLocked} onPress={run(onSaveAgentWorkflow)}>
          <AppIcon name="workflow" color={colors.ui.icon.accentForeground} size={16} strokeWidth={appIconStroke.strong} />
        </ActionIconButton>
      ) : null}
      {canUseWorkArtifact && onCopyWorkArtifact ? (
        <ActionIconButton label={t('messageBubble.copyWorkArtifact')} disabled={actionLocked} onPress={run(onCopyWorkArtifact)}>
          <AppIcon name="list-check" color={iconColor} size={16} strokeWidth={appIconStroke.strong} />
        </ActionIconButton>
      ) : null}
      {canUseWorkArtifact && onContinueWorkArtifact ? (
        <ActionIconButton label={t('messageBubble.continueWorkArtifact')} disabled={actionLocked} onPress={run(onContinueWorkArtifact)}>
          <AppIcon name="spark" color={iconColor} size={16} strokeWidth={appIconStroke.strong} />
        </ActionIconButton>
      ) : null}
      {showErrorActions && onConfigure ? (
        <ActionIconButton label={t('messageBubble.configure')} disabled={actionLocked} onPress={run(onConfigure)} danger>
          <AppIcon name="settings-sliders" color={colors.ui.tone.danger.foreground} size={16} strokeWidth={appIconStroke.strong} />
        </ActionIconButton>
      ) : null}
      {showErrorActions && onTestModel ? (
        <ActionIconButton label={t('messageBubble.test')} disabled={actionLocked} onPress={run(onTestModel)} danger>
          <AppIcon name="zap" color={colors.ui.tone.danger.foreground} size={16} strokeWidth={appIconStroke.strong} />
        </ActionIconButton>
      ) : null}
      {showErrorActions && onRetry ? (
        <ActionIconButton label={t('messageBubble.retry')} disabled={actionLocked} onPress={run(onRetry)} danger>
          <AppIcon name="retry" color={colors.ui.tone.danger.foreground} size={16} strokeWidth={appIconStroke.strong} />
        </ActionIconButton>
      ) : null}
      {canDelete ? (
        <ActionIconButton label={t('common.delete')} disabled={actionLocked} onPress={run(onDelete)} danger>
          <AppIcon name="delete" color={colors.ui.tone.danger.foreground} size={16} strokeWidth={appIconStroke.strong} />
        </ActionIconButton>
      ) : null}
      </ScrollView>
    </MotiView>
  )
}

function ErrorHint({ code }: { code?: ChatErrorCode }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ borderRadius: colors.ui.radius.field, padding: 9, backgroundColor: colors.ui.tone.danger.background, marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.ui.tone.danger.border }}>
      <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 12, fontWeight: '800' }}>{errorTitle(code, t)}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 3 }}>{errorDescription(code, t)}</Text>
    </View>
  )
}

function MessageBodyReveal({ active, children }: { active: boolean; children: ReactNode }) {
  if (!active) return <View>{children}</View>

  return (
    <MotiView
      from={{ opacity: 0.92, translateY: active ? 2 : 0 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 90 }}
      style={{ marginTop: active ? 4 : 0 }}
    >
      {children}
    </MotiView>
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
  canConfirmAgentAction,
  canContinueAgentWorkflow,
  canPrepareAndroidUndo,
  canRepairAgentEvidence,
  canOpenWorkflowSettings,
  canSaveAgentWorkflow,
  canDeleteMessage,
  onRetry,
  onRegenerate,
  onSpeak,
  onConfigure,
  onTestModel,
}: {
  message: Message
  displayText: string
  isLastAssistant: boolean
  onCopy?: (message: Message) => void
  canCopyProcessTrace: boolean
  onCopyWorkArtifact?: (message: Message) => void
  onContinueWorkArtifact?: (message: Message) => void
  canConfirmAgentAction: boolean
  canContinueAgentWorkflow: boolean
  canPrepareAndroidUndo: boolean
  canRepairAgentEvidence: boolean
  canOpenWorkflowSettings: boolean
  canSaveAgentWorkflow: boolean
  canDeleteMessage: boolean
  onRetry?: (message: Message) => void
  onRegenerate?: () => void
  onSpeak?: (message: Message) => void
  onConfigure?: (message: Message) => void
  onTestModel?: (message: Message) => void
}): boolean {
  if (message.status === 'sending') return false
  const hasText = displayText.length > 0
  if (message.role === 'user') return (hasText && !!onCopy) || canDeleteMessage
  const hasCommonActions = (hasText && (!!onCopy || !!onSpeak || !!onCopyWorkArtifact || !!onContinueWorkArtifact)) || canCopyProcessTrace
  const hasRegenerate = isLastAssistant && message.status !== 'streaming' && !!onRegenerate
  const hasErrorActions = message.status === 'error' && (!!onConfigure || !!onTestModel || !!onRetry)
  return hasCommonActions || hasRegenerate || canConfirmAgentAction || canContinueAgentWorkflow || canPrepareAndroidUndo || canRepairAgentEvidence || canOpenWorkflowSettings || canSaveAgentWorkflow || hasErrorActions || canDeleteMessage
}

function hasThinkingContent(trace: ProcessTrace): boolean {
  return trace.type === 'reasoning' && Boolean(trace.content?.trim())
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

function errorTitle(code: ChatErrorCode | undefined, t: TFunction): string {
  switch (code) {
    case 'missing_key':
      return t('messageBubble.error.missing_key')
    case 'disabled_provider':
      return t('messageBubble.error.disabled_provider')
    case 'credential_mismatch':
      return t('messageBubble.error.credential_mismatch')
    case 'bad_auth':
      return t('messageBubble.error.bad_auth')
    case 'bad_base_url':
      return t('messageBubble.error.bad_base_url')
    case 'model_unavailable':
      return t('messageBubble.error.model_unavailable')
    case 'network_error':
      return t('messageBubble.error.network_error')
    case 'timeout':
      return t('messageBubble.error.timeout')
    case 'rate_limited':
      return t('messageBubble.error.rate_limited')
    case 'max_tokens_exceeded':
      return t('messageBubble.error.max_tokens_exceeded')
    default:
      return t('messageBubble.error.default')
  }
}

function errorDescription(code: ChatErrorCode | undefined, t: TFunction): string {
  switch (code) {
    case 'missing_key':
      return t('messageBubble.errorDescription.missing_key')
    case 'disabled_provider':
      return t('messageBubble.errorDescription.disabled_provider')
    case 'credential_mismatch':
      return t('messageBubble.errorDescription.credential_mismatch')
    case 'bad_auth':
      return t('messageBubble.errorDescription.bad_auth')
    case 'bad_base_url':
      return t('messageBubble.errorDescription.bad_base_url')
    case 'model_unavailable':
      return t('messageBubble.errorDescription.model_unavailable')
    case 'network_error':
      return t('messageBubble.errorDescription.network_error')
    case 'timeout':
      return t('messageBubble.errorDescription.timeout')
    case 'rate_limited':
      return t('messageBubble.errorDescription.rate_limited')
    case 'max_tokens_exceeded':
      return t('messageBubble.errorDescription.max_tokens_exceeded')
    default:
      return t('messageBubble.errorDescription.default')
  }
}

function ActionIconButton({ label, children, danger = false, disabled = false, onPress }: { label: string; children: ReactNode; danger?: boolean; disabled?: boolean; onPress?: () => void }) {
  const { colors, isGlass } = useAppTheme()
  const actionChrome = resolveMessageActionChrome(colors, isGlass)
  const idleBackground = danger ? colors.ui.tone.danger.background : actionChrome.itemSurface
  const idleBorder = danger ? colors.ui.tone.danger.border : actionChrome.itemBorder

  return (
    <IslePressable
      haptic={!disabled}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      accessible
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={disabled ? { disabled: true, busy: true } : undefined}
      style={{
        width: 44,
        height: 44,
        margin: 3,
        borderRadius: colors.ui.radius.controlMiddle,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: disabled ? colors.ui.control.disabledBackground : idleBackground,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: disabled ? colors.ui.control.disabledBorder : idleBorder,
        opacity: 1,
      }}
    >
      {children}
    </IslePressable>
  )
}

function TypingDots() {
  const { colors } = useAppTheme()

  return (
    <View style={{ flexDirection: 'row', gap: 5, paddingVertical: 6 }}>
      {[0, 1, 2].map((item) => (
        <MotiView
          key={item}
          from={{ opacity: 0.25, translateY: 0 }}
          animate={{ opacity: 1, translateY: -3 }}
          transition={{ loop: true, type: 'timing', duration: 520, delay: item * 120 }}
          style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textSecondary }}
        />
      ))}
    </View>
  )
}

function Cursor() {
  const { colors } = useAppTheme()

  return (
    <MotiView
      from={{ opacity: 0.2, scaleY: 0.8 }}
      animate={{ opacity: 1, scaleY: 1.05 }}
      transition={{ loop: true, type: 'timing', duration: 620 }}
      style={{ width: 8, height: 18, borderRadius: 4, backgroundColor: colors.ui.control.primaryBackground, marginTop: 2 }}
    />
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

  // 附件和 traces 长度比较
  if (prevMsg.attachments?.length !== nextMsg.attachments?.length) return false
  if (processTraceSignature(prevMsg) !== processTraceSignature(nextMsg)) return false

  // 其他关键 props 比较
  if (prevProps.index !== nextProps.index) return false
  if (prevProps.isLastAssistant !== nextProps.isLastAssistant) return false
  if (prevProps.showThinkingStatus !== nextProps.showThinkingStatus) return false
  if (prevProps.activeActionMessageId !== nextProps.activeActionMessageId) return false

  return true
}

function processTraceSignature(message: Message): string {
  return collectVisibleProcessTraces(message)
    .map((trace) => `${trace.id}:${trace.type}:${trace.status}:${trace.title}:${trace.content?.length ?? 0}:${trace.completedAt ?? ''}`)
    .join('|')
}

/**
 * 使用 memo 优化的 MessageBubble 组件
 *
 * 性能提升：在长对话（100+消息）中，当新消息流式更新时，
 * 其他消息不会重新渲染，滚动性能提升约 2 倍
 */
export const MessageBubble = memo(MessageBubbleComponent, areMessagesEqual)
