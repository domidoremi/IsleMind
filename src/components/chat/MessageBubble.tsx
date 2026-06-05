import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { MotiView } from 'moti'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { ChevronRight, Copy, ListChecks, RefreshCcw, RotateCcw, Settings2, Sparkles, Trash2, Volume2, Zap } from 'lucide-react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { AnimatedNavigationIcon, type NavigationGlyph } from '@/components/navigation/AnimatedNavigationIcon'
import { useNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import type { ChatErrorCode, Message, MessageCitation, ProcessTrace } from '@/types'
import { useAppTheme } from '@/hooks/useAppTheme'
import { messageAnimationForMotion } from '@/theme/animation'
import { IslePressable } from '@/components/ui/isle'
import { useSettingsStore } from '@/store/settingsStore'
import { MessageContent } from './MessageContent'
import { collectMessageTraces, formatDuration, formatNumber, getActiveTraceTitle, metadataSummary, normalizeTraceStatuses, summarizeTraces, traceStatusLabel } from './tracePresentation'
import { IslePanel } from '@/components/ui/isle'
import { RenderGuard } from '@/components/ui/RenderGuard'
import { useMotionPreference } from '@/hooks/useMotionPreference'

const STREAMING_LAYOUT_TEXT_STEP = 160

interface MessageBubbleProps {
  conversationId: string
  message: Message
  index: number
  isLastAssistant?: boolean
  activeActionMessageId?: string | null
  onActionMessageChange?: (messageId: string | null) => void
  onLayoutChangeRequest?: () => void
  onCopy?: (message: Message) => void
  onCopyWorkArtifact?: (message: Message) => void
  onContinueWorkArtifact?: (message: Message) => void
  onRetry?: (message: Message) => void
  onRegenerate?: () => void
  onSpeak?: (message: Message) => void
  onDelete?: (message: Message) => void
  onConfigure?: (message: Message) => void
  onTestModel?: (message: Message) => void
}

export function MessageBubble({
  conversationId,
  message,
  index,
  isLastAssistant = false,
  activeActionMessageId,
  onActionMessageChange,
  onLayoutChangeRequest,
  onCopy,
  onCopyWorkArtifact,
  onContinueWorkArtifact,
  onRetry,
  onRegenerate,
  onSpeak,
  onDelete,
  onConfigure,
  onTestModel,
}: MessageBubbleProps) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { height: viewportHeight } = useWindowDimensions()
  const hapticsEnabled = useSettingsStore((state) => state.settings.hapticsEnabled)
  const [localActionsOpen, setLocalActionsOpen] = useState(false)
  const isUser = message.role === 'user'
  const isStreamingContent = !isUser && (message.status === 'streaming' || message.status === 'sending')
  const displayText = message.responseText ?? message.content
  const streamingLayoutStep = isStreamingContent ? Math.floor(displayText.length / STREAMING_LAYOUT_TEXT_STEP) : 0
  const visibleTraces = collectVisibleMessageTraces(message)
  const traceSummary = summarizeTraces(visibleTraces, message.status)
  const tokenTotal = getMessageTotalTokens(message)
  const panelMaxHeight = Math.min(260, viewportHeight * 0.38)
  const [activityExpanded, setActivityExpanded] = useState(isStreamingContent)
  const actionBarOpen = activeActionMessageId === undefined ? localActionsOpen : activeActionMessageId === message.id
  const armed = useSharedValue(0)
  const deleteProgress = useSharedValue(0)
  const canLongPressDelete = !!onDelete && message.status !== 'sending' && message.status !== 'streaming'
  const canOpenActions = canShowActionBar({
    message,
    displayText,
    isLastAssistant,
    onCopy,
    onCopyWorkArtifact,
    onContinueWorkArtifact,
    onRetry,
    onRegenerate,
    onSpeak,
    onConfigure,
    onTestModel,
  })
  const showActivity = !isUser && (message.status !== 'done' || visibleTraces.length > 0 || !!message.citations?.length || !!tokenTotal)
  const activityCanExpand = visibleTraces.length > 0 || !!message.citations?.length || isStreamingContent

  useEffect(() => {
    setLocalActionsOpen(false)
    if (activeActionMessageId === message.id) onActionMessageChange?.(null)
    setActivityExpanded(isStreamingContent)
  }, [message.id])

  useEffect(() => {
    if (isStreamingContent) {
      setActivityExpanded(true)
    }
  }, [isStreamingContent])

  useEffect(() => {
    if (!showActivity) return
    if (!activityExpanded && !isStreamingContent) return
    onLayoutChangeRequest?.()
  }, [showActivity, activityExpanded, isStreamingContent, visibleTraces.length, streamingLayoutStep, onLayoutChangeRequest])

  useEffect(() => {
    if (actionBarOpen) onLayoutChangeRequest?.()
  }, [actionBarOpen, onLayoutChangeRequest])

  function setActionBarOpen(open: boolean) {
    setLocalActionsOpen(open)
    onActionMessageChange?.(open ? message.id : null)
  }

  function requestDelete() {
    if (hapticsEnabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    onDelete?.(message)
  }

  function toggleActivity() {
    if (!activityCanExpand) return
    if (hapticsEnabled) void Haptics.selectionAsync()
    setActionBarOpen(false)
    setActivityExpanded((value) => !value)
    onLayoutChangeRequest?.()
  }

  function toggleActionBar() {
    if (!canOpenActions) return
    if (hapticsEnabled) void Haptics.selectionAsync()
    setActionBarOpen(!actionBarOpen)
  }

  const longPressDelete = Gesture.LongPress()
    .enabled(canLongPressDelete)
    .minDuration(380)
    .maxDistance(18)
    .onBegin(() => {
      armed.value = 1
      deleteProgress.value = withTiming(0.36, { duration: 100 })
    })
    .onStart(() => {
      deleteProgress.value = withTiming(1, { duration: 120 })
      runOnJS(requestDelete)()
    })
    .onFinalize(() => {
      armed.value = 0
      deleteProgress.value = withTiming(0, { duration: 160 })
    })

  const tapBubble = Gesture.Tap()
    .enabled(canOpenActions)
    .maxDistance(14)
    .onEnd((_event, success) => {
      if (success) runOnJS(toggleActionBar)()
    })

  const bubbleGesture = Gesture.Exclusive(longPressDelete, tapBubble)

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: armed.value ? withSpring(0.985) : withSpring(1) }],
  }))

  const deleteStyle = useAnimatedStyle(() => ({
    opacity: deleteProgress.value,
    transform: [{ scale: 0.85 + deleteProgress.value * 0.15 }],
  }))

  return (
    <View style={{ marginBottom: actionBarOpen ? 20 : 16 }}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: showActivity ? 42 : 8,
            bottom: 8,
            width: 56,
            borderRadius: 28,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.material.chrome,
            borderWidth: 1,
            borderColor: colors.borderStrong,
            [isUser ? 'right' : 'left']: 4,
          },
          deleteStyle,
        ]}
      >
        <Trash2 color={colors.textTertiary} size={18} strokeWidth={2.2} />
      </Animated.View>

      <MotiView
        {...messageAnimationForMotion(index, motion)}
        style={{
          alignSelf: isUser ? 'flex-end' : 'flex-start',
          maxWidth: isUser ? '84%' : '94%',
          width: isUser ? undefined : '92%',
        }}
      >
        {showActivity ? (
          <MessageActivityBar
            message={message}
            traces={visibleTraces}
            traceSummary={traceSummary.label}
            tokenTotal={tokenTotal}
            expanded={activityExpanded}
            canExpand={activityCanExpand}
            onToggle={toggleActivity}
          />
        ) : null}
        {showActivity && activityExpanded ? (
          <MessageActivityPanel
            conversationId={conversationId}
            message={message}
            traces={visibleTraces}
            maxHeight={panelMaxHeight}
            onNavigate={() => setActionBarOpen(false)}
          />
        ) : null}

        <GestureDetector gesture={bubbleGesture}>
          <Animated.View style={animatedStyle}>
            <IslePanel
              elevated={false}
              contentStyle={{
                paddingHorizontal: 14,
                paddingVertical: 11,
                position: 'relative',
              }}
              style={{
                borderRadius: 18,
                borderBottomRightRadius: isUser ? 8 : 18,
                borderBottomLeftRadius: isUser ? 18 : 8,
                backgroundColor: isUser ? colors.text : colors.material.paperRaised,
                borderColor: message.status === 'error' ? colors.error : colors.border,
              }}
            >
              <MessageBody message={message} displayText={displayText} isUser={isUser} isStreamingContent={isStreamingContent} visibleTraces={visibleTraces} />
            </IslePanel>
          </Animated.View>
        </GestureDetector>

        {actionBarOpen ? (
          <MessageActionBar
            message={message}
            displayText={displayText}
            isLastAssistant={isLastAssistant}
            onClose={() => setActionBarOpen(false)}
            onCopy={onCopy ? () => onCopy(message) : undefined}
            onCopyWorkArtifact={onCopyWorkArtifact ? () => onCopyWorkArtifact(message) : undefined}
            onContinueWorkArtifact={onContinueWorkArtifact ? () => onContinueWorkArtifact(message) : undefined}
            onSpeak={onSpeak ? () => onSpeak(message) : undefined}
            onConfigure={onConfigure ? () => onConfigure(message) : undefined}
            onTestModel={onTestModel ? () => onTestModel(message) : undefined}
            onRetry={onRetry ? () => onRetry(message) : undefined}
            onRegenerate={onRegenerate}
          />
        ) : null}
      </MotiView>
    </View>
  )
}

function MessageBody({ message, displayText, isUser, isStreamingContent, visibleTraces }: { message: Message; displayText: string; isUser: boolean; isStreamingContent: boolean; visibleTraces: ProcessTrace[] }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()

  return (
    <>
      {message.attachments?.length ? (
        <Text style={{ color: isUser ? colors.surface : colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>
          {t('messageBubble.attachmentCount', { count: message.attachments.length })}
        </Text>
      ) : null}
      <RenderGuard label={t('messageBubble.messageContent')} fallbackText={displayText || message.content} compact>
        {displayText ? (
          <MessageBodyReveal active={isStreamingContent}>
            <MessageContent content={displayText} isUser={isUser} />
          </MessageBodyReveal>
        ) : visibleTraces.length && message.status !== 'streaming' ? (
          <Text style={{ color: isUser ? colors.surface : colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
            {t('messageBubble.emptyResponse')}
          </Text>
        ) : isUser ? (
          <TypingDots />
        ) : null}
      </RenderGuard>
      {isStreamingContent && displayText ? <Cursor /> : null}
      {message.status === 'error' ? <ErrorHint code={message.errorCode} /> : null}
    </>
  )
}

function MessageActivityBar({
  message,
  traces,
  traceSummary,
  tokenTotal,
  expanded,
  canExpand,
  onToggle,
}: {
  message: Message
  traces: ProcessTrace[]
  traceSummary: string
  tokenTotal: number
  expanded: boolean
  canExpand: boolean
  onToggle: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const running = message.status === 'streaming' || message.status === 'sending'
  const label = activityLabel(message, traces, traceSummary, t)
  const tone =
    message.status === 'error'
      ? colors.error
      : message.status === 'cancelled'
        ? colors.warning
        : running
          ? colors.primary
          : colors.textTertiary

  return (
    <IslePressable
      haptic
      disabled={!canExpand}
      onPress={onToggle}
      accessibilityLabel={expanded ? t('messageBubble.collapseThinking') : t('messageBubble.expandThinking')}
      style={{
        alignSelf: 'flex-start',
        minHeight: 32,
        maxWidth: '100%',
        marginBottom: 5,
        paddingLeft: 8,
        paddingRight: 7,
        paddingVertical: 5,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        backgroundColor: colors.material.field,
        borderWidth: 1,
        borderColor: expanded ? colors.borderStrong : colors.border,
      }}
    >
      <MotiView
        from={{ opacity: 0.38, scale: 0.8 }}
        animate={{ opacity: running ? 1 : 0.72, scale: 1 }}
        transition={{ loop: running, type: 'timing', duration: 760 }}
        style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone }}
      />
      <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '800', flexShrink: 1, maxWidth: 176 }}>
        {label}
      </Text>
      {tokenTotal ? (
        <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800' }}>
          {t('messageBubble.tokensTotal', { value: formatNumber(tokenTotal) })}
        </Text>
      ) : null}
      {canExpand ? (
        <MotiView animate={{ rotate: expanded ? '90deg' : '0deg' }} transition={{ type: 'timing', duration: 150 }}>
          <ChevronRight color={colors.textTertiary} size={14} strokeWidth={2.2} />
        </MotiView>
      ) : null}
    </IslePressable>
  )
}

function MessageActivityPanel({ conversationId, message, traces, maxHeight, onNavigate }: { conversationId: string; message: Message; traces: ProcessTrace[]; maxHeight: number; onNavigate: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const normalizedTraces = normalizeTraceStatuses(traces, message.status).filter((trace) => !trace.metadata?.hiddenSignature)
  const details = normalizedTraces.slice(-6)
  const citations = message.citations ?? []
  const firstCitation = citations[0]
  const processSummary = summarizeTraces(normalizedTraces, message.status)
  const scrollHeight = Math.max(80, maxHeight - (citations.length || normalizedTraces.length ? 48 : 0))
  const running = message.status === 'streaming' || message.status === 'sending'

  function openSources() {
    onNavigate()
    router.push({ pathname: '/source', params: { conversationId, messageId: message.id, citationId: firstCitation?.id ?? '' } })
  }

  function openProcess() {
    onNavigate()
    router.push({ pathname: '/source', params: { conversationId, messageId: message.id, kind: 'process' } })
  }

  return (
    <MotiView
      from={{ opacity: 0, translateY: -4 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 140 }}
      style={{
        maxHeight,
        marginBottom: 7,
        borderRadius: 14,
        padding: 9,
        backgroundColor: colors.material.field,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {details.length || running ? (
        <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={details.length > 3} style={{ maxHeight: scrollHeight }} contentContainerStyle={{ gap: 9 }}>
          {details.length ? details.map((trace) => <ActivityTraceRow key={trace.id} trace={trace} />) : <TypingDots />}
        </ScrollView>
      ) : null}
      {citations.length || normalizedTraces.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
          {citations.length ? (
            <ActivityFooterButton
              label={t('messageBubble.sources', { count: citations.length })}
              glyph={citationGlyph(firstCitation)}
              onPress={openSources}
              tint={colors.primary}
            />
          ) : null}
          {normalizedTraces.length ? (
            <ActivityFooterButton
              label={t('messageBubble.process', { summary: processSummary.label })}
              glyph="mcp-network"
              onPress={openProcess}
              tint={processSummary.errors ? colors.error : processSummary.running ? colors.primary : colors.textSecondary}
            />
          ) : null}
        </View>
      ) : null}
    </MotiView>
  )
}

function ActivityTraceRow({ trace }: { trace: ProcessTrace }) {
  const { colors } = useAppTheme()
  const meta = [
    traceStatusLabel(trace.status),
    trace.durationMs ? formatDuration(trace.durationMs) : '',
    metadataSummary(trace.metadata),
  ].filter(Boolean).join(' · ')
  const tint =
    trace.status === 'error'
      ? colors.error
      : trace.status === 'running' || trace.status === 'pending'
        ? colors.primary
        : colors.textTertiary

  return (
    <View style={{ gap: 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tint }} />
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900', flex: 1 }}>
          {trace.title}
        </Text>
      </View>
      {meta ? (
        <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800', marginLeft: 13 }}>
          {meta}
        </Text>
      ) : null}
      {trace.content ? (
        <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '700', marginLeft: 13 }}>
          {trace.content}
        </Text>
      ) : null}
    </View>
  )
}

function ActivityFooterButton({ label, glyph, tint, onPress }: { label: string; glyph: NavigationGlyph; tint: string; onPress: () => void }) {
  const { colors } = useAppTheme()
  const navigation = useNavigationTrigger(onPress)

  return (
    <IslePressable
      haptic
      onPress={navigation.trigger}
      accessibilityLabel={label}
      style={{
        minHeight: 36,
        maxWidth: 168,
        borderRadius: 18,
        paddingHorizontal: 9,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.material.paperRaised,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <AnimatedNavigationIcon glyph={glyph} active={navigation.active} color={tint} size={14} />
      <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '900', flexShrink: 1 }}>
        {label}
      </Text>
    </IslePressable>
  )
}

function MessageActionBar({
  message,
  displayText,
  isLastAssistant,
  onClose,
  onCopy,
  onCopyWorkArtifact,
  onContinueWorkArtifact,
  onSpeak,
  onConfigure,
  onTestModel,
  onRetry,
  onRegenerate,
}: {
  message: Message
  displayText: string
  isLastAssistant: boolean
  onClose: () => void
  onCopy?: () => void
  onCopyWorkArtifact?: () => void
  onContinueWorkArtifact?: () => void
  onSpeak?: () => void
  onConfigure?: () => void
  onTestModel?: () => void
  onRetry?: () => void
  onRegenerate?: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const isUser = message.role === 'user'
  const canCopy = !!displayText && !!onCopy
  const canSpeak = !!displayText && !isUser && !!onSpeak
  const canRegenerate = !isUser && isLastAssistant && message.status !== 'streaming' && !!onRegenerate
  const canUseWorkArtifact = !!displayText && !isUser
  const showErrorActions = !isUser && message.status === 'error'
  const iconColor = colors.textSecondary

  function run(action?: () => void) {
    return () => {
      onClose()
      action?.()
    }
  }

  if (message.status === 'sending') return null
  if (isUser && !canCopy) return null
  if (!isUser && !canCopy && !canSpeak && !canRegenerate && !onCopyWorkArtifact && !onContinueWorkArtifact && !showErrorActions) return null

  return (
    <MotiView
      from={{ opacity: 0, translateY: -3, scale: 0.97 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={{ type: 'timing', duration: 120 }}
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        marginTop: 6,
        minHeight: 48,
        maxWidth: '100%',
        borderRadius: 24,
        paddingHorizontal: 4,
        paddingVertical: 4,
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 3,
        backgroundColor: colors.material.chrome,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {canCopy ? (
        <ActionIconButton label={t('common.copy')} onPress={run(onCopy)}>
          <Copy color={iconColor} size={16} strokeWidth={2.1} />
        </ActionIconButton>
      ) : null}
      {canSpeak ? (
        <ActionIconButton label={t('messageBubble.speak')} onPress={run(onSpeak)}>
          <Volume2 color={iconColor} size={16} strokeWidth={2.1} />
        </ActionIconButton>
      ) : null}
      {canRegenerate ? (
        <ActionIconButton label={t('messageBubble.regenerate')} onPress={run(onRegenerate)}>
          <RefreshCcw color={iconColor} size={16} strokeWidth={2.1} />
        </ActionIconButton>
      ) : null}
      {canUseWorkArtifact && onCopyWorkArtifact ? (
        <ActionIconButton label={t('messageBubble.copyWorkArtifact')} onPress={run(onCopyWorkArtifact)}>
          <ListChecks color={iconColor} size={16} strokeWidth={2.1} />
        </ActionIconButton>
      ) : null}
      {canUseWorkArtifact && onContinueWorkArtifact ? (
        <ActionIconButton label={t('messageBubble.continueWorkArtifact')} onPress={run(onContinueWorkArtifact)}>
          <Sparkles color={iconColor} size={16} strokeWidth={2.1} />
        </ActionIconButton>
      ) : null}
      {showErrorActions && onConfigure ? (
        <ActionIconButton label={t('messageBubble.configure')} onPress={run(onConfigure)} danger>
          <Settings2 color={colors.error} size={16} strokeWidth={2.1} />
        </ActionIconButton>
      ) : null}
      {showErrorActions && onTestModel ? (
        <ActionIconButton label={t('messageBubble.test')} onPress={run(onTestModel)} danger>
          <Zap color={colors.error} size={16} strokeWidth={2.1} />
        </ActionIconButton>
      ) : null}
      {showErrorActions && onRetry ? (
        <ActionIconButton label={t('messageBubble.retry')} onPress={run(onRetry)} danger>
          <RotateCcw color={colors.error} size={16} strokeWidth={2.1} />
        </ActionIconButton>
      ) : null}
    </MotiView>
  )
}

function ErrorHint({ code }: { code?: ChatErrorCode }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ borderRadius: 12, padding: 9, backgroundColor: colors.coralWash, marginTop: 8, borderWidth: 1, borderColor: colors.error }}>
      <Text style={{ color: colors.error, fontSize: 12, fontWeight: '800' }}>{errorTitle(code, t)}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 3 }}>{errorDescription(code, t)}</Text>
    </View>
  )
}

function MessageBodyReveal({ active, children }: { active: boolean; children: ReactNode }) {
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

function activityLabel(message: Message, traces: ProcessTrace[], traceSummary: string, t: TFunction): string {
  const activeTraceTitle = getActiveTraceTitle(traces, message.status)
  switch (message.status) {
    case 'sending':
      return t('messageBubble.readyToSend')
    case 'streaming':
      return activeTraceTitle ? t('messageBubble.traceGenerating', { title: activeTraceTitle }) : t('messageBubble.generating')
    case 'error':
      return activeTraceTitle || t('messageBubble.failed')
    case 'cancelled':
      return t('messageBubble.stopped')
    case 'done':
      return traces.length ? traceSummary : t('messageBubble.completed')
  }
}

function canShowActionBar({
  message,
  displayText,
  isLastAssistant,
  onCopy,
  onCopyWorkArtifact,
  onContinueWorkArtifact,
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
  onCopyWorkArtifact?: (message: Message) => void
  onContinueWorkArtifact?: (message: Message) => void
  onRetry?: (message: Message) => void
  onRegenerate?: () => void
  onSpeak?: (message: Message) => void
  onConfigure?: (message: Message) => void
  onTestModel?: (message: Message) => void
}): boolean {
  if (message.status === 'sending') return false
  const hasText = displayText.length > 0
  if (message.role === 'user') return hasText && !!onCopy
  const hasCommonActions = hasText && (!!onCopy || !!onSpeak || !!onCopyWorkArtifact || !!onContinueWorkArtifact)
  const hasRegenerate = isLastAssistant && message.status !== 'streaming' && !!onRegenerate
  const hasErrorActions = message.status === 'error' && (!!onConfigure || !!onTestModel || !!onRetry)
  return hasCommonActions || hasRegenerate || hasErrorActions
}

function collectVisibleMessageTraces(message: Message): ProcessTrace[] {
  return collectMessageTraces(message).filter((trace) => !trace.metadata?.hiddenSignature)
}

function getMessageTotalTokens(message: Message): number {
  const usage = message.usage
  if (usage?.totalTokens) return usage.totalTokens
  const input = usage?.inputTokens ?? 0
  const output = usage?.outputTokens ?? 0
  const reasoning = usage?.reasoningTokens ?? 0
  const computed = input + output + reasoning
  return computed || message.tokenCount || 0
}

function citationGlyph(citation?: MessageCitation): NavigationGlyph {
  if (citation?.type === 'knowledge') return 'knowledge-database'
  if (citation?.type === 'memory') return 'memory-brain'
  return 'source'
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

function ActionIconButton({ label, children, danger = false, onPress }: { label: string; children: ReactNode; danger?: boolean; onPress?: () => void }) {
  const { colors } = useAppTheme()

  return (
    <IslePressable
      haptic
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        minWidth: 44,
        minHeight: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: danger ? colors.coralWash : colors.material.paperRaised,
        borderWidth: 1,
        borderColor: danger ? colors.error : colors.border,
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
      style={{ width: 8, height: 18, borderRadius: 4, backgroundColor: colors.primary, marginTop: 2 }}
    />
  )
}
