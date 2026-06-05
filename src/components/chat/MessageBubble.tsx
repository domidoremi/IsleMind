import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { MotiView } from 'moti'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import * as Haptics from 'expo-haptics'
import { ChevronRight, Copy, ListChecks, RefreshCcw, RotateCcw, Settings2, Sparkles, Trash2, Volume2, Zap } from 'lucide-react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import type { ChatErrorCode, Message, ProcessTrace } from '@/types'
import { useAppTheme } from '@/hooks/useAppTheme'
import { messageAnimationForMotion } from '@/theme/animation'
import { IslePressable } from '@/components/ui/isle'
import { useSettingsStore } from '@/store/settingsStore'
import { MessageContent } from './MessageContent'
import { normalizeTraceStatuses } from './tracePresentation'
import { IslePanel } from '@/components/ui/isle'
import { RenderGuard } from '@/components/ui/RenderGuard'
import type { MotionIntensity } from '@/hooks/useMotionPreference'

const STREAMING_LAYOUT_TEXT_STEP = 160

interface MessageBubbleProps {
  conversationId: string
  message: Message
  index: number
  motion: MotionIntensity
  viewportHeight: number
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
  message,
  index,
  motion,
  viewportHeight,
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
  const hapticsEnabled = useSettingsStore((state) => state.settings.hapticsEnabled)
  const [localActionsOpen, setLocalActionsOpen] = useState(false)
  const [processExpanded, setProcessExpanded] = useState(false)
  const isUser = message.role === 'user'
  const isStreamingContent = !isUser && (message.status === 'streaming' || message.status === 'sending')
  const displayText = message.responseText ?? message.content
  const streamingLayoutStep = isStreamingContent ? Math.floor(displayText.length / STREAMING_LAYOUT_TEXT_STEP) : 0
  const reasoningTraces = useMemo(() => collectVisibleReasoningTraces(message), [message.reasoning])
  const reasoningTextLength = useMemo(() => reasoningTraces.reduce((total, trace) => total + (trace.content?.length ?? 0), 0), [reasoningTraces])
  const reasoningLayoutStep = isStreamingContent ? Math.floor(reasoningTextLength / STREAMING_LAYOUT_TEXT_STEP) : 0
  const processCanExpand = !isUser && (reasoningTraces.some(hasThinkingContent) || isStreamingContent)
  const processMaxHeight = Math.min(230, viewportHeight * 0.34)
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

  useEffect(() => {
    setLocalActionsOpen(false)
    setProcessExpanded(false)
    if (activeActionMessageId === message.id) onActionMessageChange?.(null)
  }, [message.id])

  useEffect(() => {
    if (!isStreamingContent && !processExpanded) return
    onLayoutChangeRequest?.()
  }, [isStreamingContent, processExpanded, reasoningTraces.length, reasoningLayoutStep, streamingLayoutStep, onLayoutChangeRequest])

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

  function toggleActionBar() {
    if (!canOpenActions) return
    if (hapticsEnabled) void Haptics.selectionAsync()
    setActionBarOpen(!actionBarOpen)
  }

  function toggleProcessLayer() {
    if (!processCanExpand) return
    if (hapticsEnabled) void Haptics.selectionAsync()
    setActionBarOpen(false)
    setProcessExpanded((value) => !value)
    onLayoutChangeRequest?.()
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
            top: 8,
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
            {!isUser ? (
              <MessageProcessLayer
                message={message}
                displayText={displayText}
                traces={reasoningTraces}
                expanded={processExpanded}
                canExpand={processCanExpand}
                maxHeight={processMaxHeight}
                onToggle={toggleProcessLayer}
              />
            ) : null}
            <GestureDetector gesture={bubbleGesture}>
              <Animated.View>
                <MessageBody message={message} displayText={displayText} isUser={isUser} isStreamingContent={isStreamingContent} />
              </Animated.View>
            </GestureDetector>
          </IslePanel>
        </Animated.View>

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

function MessageBody({ message, displayText, isUser, isStreamingContent }: { message: Message; displayText: string; isUser: boolean; isStreamingContent: boolean }) {
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
        ) : !isUser && !isStreamingContent ? (
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

function MessageProcessLayer({
  message,
  displayText,
  traces,
  expanded,
  canExpand,
  maxHeight,
  onToggle,
}: {
  message: Message
  displayText: string
  traces: ProcessTrace[]
  expanded: boolean
  canExpand: boolean
  maxHeight: number
  onToggle: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const active = message.status === 'streaming' || message.status === 'sending'
  const tone =
    message.status === 'error'
      ? colors.error
      : message.status === 'cancelled'
        ? colors.warning
        : active
          ? colors.primary
          : colors.textTertiary

  return (
    <View style={{ marginBottom: 8 }}>
      <IslePressable
        haptic
        disabled={!canExpand}
        onPress={onToggle}
        accessibilityLabel={expanded ? t('messageBubble.collapseThinking') : t('messageBubble.expandThinking')}
        style={{
          minHeight: 26,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <ThinkingPulse active={active} tone={tone} />
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: '800', flex: 1 }}>
          {processLayerLabel(message, displayText, t)}
        </Text>
        {canExpand ? (
          <MotiView animate={{ rotate: expanded ? '90deg' : '0deg' }} transition={{ type: 'timing', duration: 150 }}>
            <ChevronRight color={colors.textTertiary} size={14} strokeWidth={2.2} />
          </MotiView>
        ) : null}
      </IslePressable>
      {expanded && canExpand ? <MessageProcessPanel message={message} traces={traces} maxHeight={maxHeight} /> : null}
    </View>
  )
}

function MessageProcessPanel({ message, traces, maxHeight }: { message: Message; traces: ProcessTrace[]; maxHeight: number }) {
  const { colors } = useAppTheme()
  const thinkingText = normalizeTraceStatuses(traces, message.status)
    .map((trace) => trace.content?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
  const running = message.status === 'streaming' || message.status === 'sending'

  return (
    <MotiView
      from={{ opacity: 0, translateY: -3 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 130 }}
      style={{
        marginTop: 7,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: 8,
      }}
    >
      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={thinkingText.length > 360} style={{ maxHeight }}>
        {thinkingText ? (
          <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 18, fontWeight: '700' }}>
            {thinkingText}
          </Text>
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

function processLayerLabel(message: Message, displayText: string, t: TFunction): string {
  return (() => {
    switch (message.status) {
      case 'sending':
        return translateMessageBubbleLabel(t, 'messageBubble.thinking', '正在思考')
      case 'streaming':
        return displayText.trim()
          ? translateMessageBubbleLabel(t, 'messageBubble.thinkingDone', '思考完成')
          : translateMessageBubbleLabel(t, 'messageBubble.thinking', '正在思考')
      case 'error':
        return translateMessageBubbleLabel(t, 'messageBubble.failed', '失败')
      case 'cancelled':
        return translateMessageBubbleLabel(t, 'messageBubble.stopped', '已停止')
      case 'done':
        return translateMessageBubbleLabel(t, 'messageBubble.thinkingDone', '思考完成')
    }
  })()
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

function collectVisibleReasoningTraces(message: Message): ProcessTrace[] {
  return (message.reasoning ?? [])
    .filter((trace) => trace.type === 'reasoning' && !trace.metadata?.hiddenSignature)
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
}

function hasThinkingContent(trace: ProcessTrace): boolean {
  return !!trace.content?.trim()
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
