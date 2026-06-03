import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { MotiView } from 'moti'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { ChevronDown, Copy, ListChecks, MoreHorizontal, RefreshCcw, RotateCcw, Settings2, Sparkles, Trash2, Volume2, Zap } from 'lucide-react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { AnimatedNavigationIcon } from '@/components/navigation/AnimatedNavigationIcon'
import { useNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import type { ChatErrorCode, Message, MessageCitation, ProcessTrace } from '@/types'
import { useAppTheme } from '@/hooks/useAppTheme'
import { messageAnimationForMotion } from '@/theme/animation'
import { IslePressable } from '@/components/ui/isle'
import { useSettingsStore } from '@/store/settingsStore'
import { MessageContent } from './MessageContent'
import { collectMessageTraces, formatDuration, formatNumber, getActiveTraceTitle, normalizeTraceStatuses, summarizeTraces } from './tracePresentation'
import { IslePanel } from '@/components/ui/isle'
import { RenderGuard } from '@/components/ui/RenderGuard'
import { useMotionPreference } from '@/hooks/useMotionPreference'

type MessageActionItem = {
  key: string
  label: string
  onPress?: () => void
  icon: ReactNode
}

interface MessageBubbleProps {
  conversationId: string
  message: Message
  index: number
  isLastAssistant?: boolean
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

export function MessageBubble({ conversationId, message, index, isLastAssistant = false, onCopy, onCopyWorkArtifact, onContinueWorkArtifact, onRetry, onRegenerate, onSpeak, onDelete, onConfigure, onTestModel }: MessageBubbleProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const hapticsEnabled = useSettingsStore((state) => state.settings.hapticsEnabled)
  const [actionsOpen, setActionsOpen] = useState(false)
  const isUser = message.role === 'user'
  const isStreamingContent = !isUser && (message.status === 'streaming' || message.status === 'sending')
  const armed = useSharedValue(0)
  const deleteProgress = useSharedValue(0)
  const displayText = message.responseText ?? message.content
  const processTraces = collectMessageTraces(message)
  const thinkingTraces = collectThinkingTraces(message)
  const processSummary = summarizeTraces(processTraces, message.status)
  const thinkingSummary = summarizeTraces(thinkingTraces, message.status)
  const canLongPressDelete = !!onDelete && message.status !== 'sending' && message.status !== 'streaming'
  const showThinking = !isUser && thinkingTraces.length > 0
  const hasFloatingActions = message.status !== 'error' && (displayText.length > 0 || (!isUser && isLastAssistant && message.status !== 'streaming'))

  function requestDelete() {
    if (hapticsEnabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    onDelete?.(message)
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

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: armed.value ? withSpring(0.985) : withSpring(1) }],
  }))

  const deleteStyle = useAnimatedStyle(() => ({
    opacity: deleteProgress.value,
    transform: [{ scale: 0.85 + deleteProgress.value * 0.15 }],
  }))

  return (
    <View style={{ marginBottom: 18 }}>
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

      <GestureDetector gesture={longPressDelete}>
        <Animated.View style={animatedStyle}>
          <MotiView
            {...messageAnimationForMotion(index, motion)}
            style={{
              alignSelf: isUser ? 'flex-end' : 'flex-start',
              maxWidth: isUser ? '84%' : '94%',
              width: isUser ? undefined : '92%',
            }}
          >
            <IslePanel
              elevated={!isUser}
              contentStyle={{
                paddingHorizontal: 16,
                paddingTop: 12,
                paddingBottom: hasFloatingActions ? 56 : 12,
                paddingRight: hasFloatingActions ? 54 : 16,
                position: 'relative',
              }}
              style={{
                borderRadius: 24,
                borderBottomRightRadius: isUser ? 9 : 24,
                borderBottomLeftRadius: isUser ? 24 : 9,
                backgroundColor: isUser ? colors.text : colors.material.paperRaised,
                borderColor: message.status === 'error' ? colors.error : colors.border,
              }}
            >
              {message.attachments?.length ? (
                <Text style={{ color: isUser ? colors.surface : colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>
                  {t('messageBubble.attachmentCount', { count: message.attachments.length })}
                </Text>
              ) : null}
              {showThinking ? <ThinkingProcessBlock traces={thinkingTraces} status={message.status} summary={thinkingSummary.label} /> : null}
              <RenderGuard label={t('messageBubble.messageContent')} fallbackText={displayText || message.content} compact>
                {displayText ? (
                  <MessageBodyReveal active={isStreamingContent}>
                    <MessageContent content={displayText} isUser={isUser} />
                  </MessageBodyReveal>
                ) : processTraces.length && message.status !== 'streaming' ? (
                  <Text style={{ color: isUser ? colors.surface : colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
                    {t('messageBubble.emptyResponse')}
                  </Text>
                ) : isUser ? (
                  <TypingDots />
                ) : null}
              </RenderGuard>
              {isStreamingContent && displayText ? <Cursor /> : null}
              {message.status === 'error' ? <ErrorHint code={message.errorCode} /> : null}
              <MessageStatusLine message={message} traces={processTraces} isUser={isUser} hasText={!!displayText} />
              {!isUser && (message.citations?.length || processTraces.length) ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {message.citations?.length ? (
                    <>
                      <CitationSummaryRow
                        citations={message.citations}
                        onPress={() => router.push({ pathname: '/source', params: { conversationId, messageId: message.id, citationId: message.citations?.[0]?.id ?? '' } })}
                      />
                      <CitationNumberChips
                        citations={message.citations}
                        onPress={(citation) => router.push({ pathname: '/source', params: { conversationId, messageId: message.id, citationId: citation.id } })}
                      />
                    </>
                  ) : null}
                  {processTraces.length ? (
                    <ProcessSummaryRow
                      summary={processSummary.label}
                      hasError={processSummary.errors > 0}
                      running={processSummary.running > 0}
                      onPress={() => router.push({ pathname: '/source', params: { conversationId, messageId: message.id, kind: 'process' } })}
                    />
                  ) : null}
                </View>
              ) : null}
              <MessageActionRow
                isUser={isUser}
                message={message}
                displayText={displayText}
                isLastAssistant={isLastAssistant}
                actionsOpen={actionsOpen}
                onToggle={() => setActionsOpen((value) => !value)}
                onCopy={() => onCopy?.(message)}
                onCopyWorkArtifact={onCopyWorkArtifact ? () => onCopyWorkArtifact(message) : undefined}
                onContinueWorkArtifact={onContinueWorkArtifact ? () => onContinueWorkArtifact(message) : undefined}
                onSpeak={() => onSpeak?.(message)}
                onConfigure={() => onConfigure?.(message)}
                onTestModel={() => onTestModel?.(message)}
                onRetry={() => onRetry?.(message)}
                onRegenerate={onRegenerate}
              />
            </IslePanel>
            <MessageMeta message={message} />
          </MotiView>
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

function collectThinkingTraces(message: Message): ProcessTrace[] {
  return (message.reasoning ?? [])
    .filter((trace) => trace.type === 'reasoning' && !trace.metadata?.hiddenSignature)
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
}

function MessageActionRow({
  isUser,
  message,
  displayText,
  isLastAssistant,
  actionsOpen,
  onToggle,
  onCopy,
  onCopyWorkArtifact,
  onContinueWorkArtifact,
  onSpeak,
  onConfigure,
  onTestModel,
  onRetry,
  onRegenerate,
}: {
  isUser: boolean
  message: Message
  displayText: string
  isLastAssistant: boolean
  actionsOpen: boolean
  onToggle: () => void
  onCopy: () => void
  onCopyWorkArtifact?: () => void
  onContinueWorkArtifact?: () => void
  onSpeak: () => void
  onConfigure: () => void
  onTestModel: () => void
  onRetry: () => void
  onRegenerate?: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const canCopy = !!displayText
  const canRegenerate = !isUser && isLastAssistant && message.status !== 'streaming'
  const actionCandidates: Array<MessageActionItem | null> = [
    canCopy ? { key: 'copy', label: t('common.copy'), onPress: onCopy, icon: <Copy color={colors.textSecondary} size={15} strokeWidth={2.1} /> } : null,
    canCopy && !isUser ? { key: 'speak', label: t('messageBubble.speak'), onPress: onSpeak, icon: <Volume2 color={colors.textSecondary} size={15} strokeWidth={2.1} /> } : null,
    canRegenerate ? { key: 'regenerate', label: t('messageBubble.regenerate'), onPress: onRegenerate, icon: <RefreshCcw color={colors.textSecondary} size={15} strokeWidth={2.1} /> } : null,
  ]
  const normalActions = actionCandidates.filter((item): item is MessageActionItem => item !== null)
  const hasWorkArtifactActions = canCopy && !isUser && (!!onCopyWorkArtifact || !!onContinueWorkArtifact)

  if (message.status === 'sending') return null
  if (message.status === 'streaming' && !canCopy) return null
  if (!normalActions.length && !hasWorkArtifactActions && message.status !== 'error') return null

  if (!isUser && message.status === 'error') {
    return (
      <View style={{ flexDirection: 'row', gap: 7, marginTop: 7, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        <ActionButton label={t('messageBubble.configure')} onPress={onConfigure} tone="danger">
          <Settings2 color={colors.error} size={13} strokeWidth={2} />
        </ActionButton>
        <ActionButton label={t('messageBubble.test')} onPress={onTestModel} tone="danger">
          <Zap color={colors.error} size={13} strokeWidth={2} />
        </ActionButton>
        <ActionButton label={t('messageBubble.retry')} onPress={onRetry} tone="danger">
          <RotateCcw color={colors.error} size={13} strokeWidth={2} />
        </ActionButton>
      </View>
    )
  }

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', right: 8, bottom: 8, zIndex: 3, alignItems: 'flex-end' }}>
      {actionsOpen ? (
        <MotiView
          from={{ opacity: 0, translateY: 4, scale: 0.96 }}
          animate={{ opacity: 1, translateY: 0, scale: 1 }}
          transition={{ type: 'timing', duration: 120 }}
          style={{
            marginBottom: 6,
            minHeight: 38,
            borderRadius: 20,
            paddingHorizontal: 5,
            paddingVertical: 4,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            backgroundColor: colors.material.chrome,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          {normalActions.map((action) => (
            <ActionIconButton key={action.key} label={action.label} onPress={action.onPress}>
              {action.icon}
            </ActionIconButton>
          ))}
          {canCopy && !isUser && onCopyWorkArtifact ? (
            <ActionIconButton label={t('messageBubble.copyWorkArtifact')} onPress={onCopyWorkArtifact}>
              <ListChecks color={colors.textSecondary} size={15} strokeWidth={2.1} />
            </ActionIconButton>
          ) : null}
          {canCopy && !isUser && onContinueWorkArtifact ? (
            <ActionIconButton label={t('messageBubble.continueWorkArtifact')} onPress={onContinueWorkArtifact}>
              <Sparkles color={colors.textSecondary} size={15} strokeWidth={2.1} />
            </ActionIconButton>
          ) : null}
        </MotiView>
      ) : null}
      <ActionIconButton label={actionsOpen ? t('common.collapse') : t('messageBubble.actions')} onPress={onToggle} active={actionsOpen}>
        <MoreHorizontal color={actionsOpen ? colors.primary : colors.textTertiary} size={16} strokeWidth={2.2} />
      </ActionIconButton>
    </View>
  )
}

function ErrorHint({ code }: { code?: ChatErrorCode }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ borderRadius: 16, padding: 10, backgroundColor: colors.coralWash, marginTop: 8, borderWidth: 1, borderColor: colors.error }}>
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

function ThinkingProcessBlock({ traces, status, summary }: { traces: ProcessTrace[]; status: Message['status']; summary: string }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const running = status === 'streaming' || status === 'sending'
  const [expanded, setExpanded] = useState(running)
  const normalizedTraces = normalizeTraceStatuses(traces, status).filter((trace) => !trace.metadata?.hiddenSignature)
  const activeTrace = normalizedTraces.find((trace) => trace.status === 'running' || trace.status === 'pending')
  const details = normalizedTraces.length ? normalizedTraces.slice(-5) : []
  const canToggle = running || details.length > 0

  useEffect(() => {
    if (running) {
      setExpanded(true)
    } else {
      setExpanded(false)
    }
  }, [running])

  return (
    <View style={{ marginBottom: 10 }}>
      <IslePressable
        haptic
        disabled={!canToggle}
        onPress={() => setExpanded((value) => !value)}
        accessibilityLabel={expanded ? t('messageBubble.collapseThinking') : t('messageBubble.expandThinking')}
        style={{
          minHeight: 44,
          borderRadius: 18,
          paddingHorizontal: 10,
          paddingVertical: 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: colors.material.field,
          borderWidth: 1,
          borderColor: running ? colors.borderStrong : colors.border,
        }}
      >
        <MotiView
          from={{ opacity: 0.4, scale: 0.84 }}
          animate={{ opacity: running ? 1 : 0.72, scale: 1 }}
          transition={{ loop: running, type: 'timing', duration: 760 }}
          style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: running ? colors.primary : colors.textTertiary }}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '900' }}>
            {running ? (activeTrace?.title ?? t('messageBubble.thinkingActive')) : t('messageBubble.thinkingCollapsed')}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800', marginTop: 1 }}>
            {summary}
          </Text>
        </View>
        {canToggle ? (
          <MotiView animate={{ rotate: expanded ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 150 }}>
            <ChevronDown color={colors.textTertiary} size={14} strokeWidth={2.1} />
          </MotiView>
        ) : null}
      </IslePressable>
      {expanded ? (
        <MotiView
          from={{ opacity: 0, translateY: -3 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 120 }}
          style={{
            marginTop: 6,
            borderRadius: 16,
            padding: 10,
            backgroundColor: colors.material.field,
            borderWidth: 1,
            borderColor: colors.border,
            gap: 8,
          }}
        >
          {details.length ? details.map((trace) => (
            <View key={trace.id} style={{ gap: 2 }}>
              <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>
                {trace.title}
              </Text>
              {trace.content ? (
                <Text numberOfLines={3} style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 15, fontWeight: '700' }}>
                  {trace.content}
                </Text>
              ) : null}
            </View>
          )) : (
            <TypingDots />
          )}
        </MotiView>
      ) : null}
    </View>
  )
}

function UsageTextChips({ usage, estimated }: { usage: NonNullable<Message['usage']>; estimated: boolean }) {
  const { t } = useTranslation()
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const reasoning = usage.reasoningTokens ?? 0
  const total = usage.totalTokens ?? input + output + reasoning
  const items = [
    input ? t('messageBubble.tokensIn', { value: formatNumber(input) }) : '',
    output ? t('messageBubble.tokensOut', { value: formatNumber(output) }) : '',
    total ? t('messageBubble.tokensTotal', { value: formatNumber(total) }) : '',
    reasoning ? t('messageBubble.tokensReasoning', { value: formatNumber(reasoning) }) : '',
    estimated ? t('messageBubble.estimated') : '',
  ].filter(Boolean)

  if (!items.length) return null

  return (
    <>
      {items.map((item) => (
        <MetaChip key={item} label={item} />
      ))}
    </>
  )
}

function MessageStatusLine({ message, traces, isUser, hasText }: { message: Message; traces: ReturnType<typeof collectMessageTraces>; isUser: boolean; hasText: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  if (isUser && message.status === 'done') return null
  if (hasText && (message.status === 'streaming' || message.status === 'sending')) return null
  const activeTrace = getActiveTraceTitle(traces, message.status)
  const status = statusLabel(message, activeTrace, t)
  if (!status) return null
  const tone =
    message.status === 'error'
      ? colors.error
      : message.status === 'cancelled'
        ? colors.warning
        : message.status === 'streaming' || message.status === 'sending'
          ? colors.primary
          : colors.textTertiary

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
      <MotiView
        from={{ opacity: 0.35, scale: 0.82 }}
        animate={{ opacity: message.status === 'streaming' || message.status === 'sending' ? 1 : 0.7, scale: 1 }}
        transition={{ loop: message.status === 'streaming' || message.status === 'sending', type: 'timing', duration: 760 }}
        style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone }}
      />
      <Text numberOfLines={1} style={{ color: isUser ? colors.surface : tone, fontSize: 11, fontWeight: '800', flexShrink: 1 }}>
        {status}
      </Text>
    </View>
  )
}

function statusLabel(message: Message, activeTraceTitle: string, t: TFunction): string {
  switch (message.status) {
    case 'sending':
      return t('messageBubble.readyToSend')
    case 'streaming':
      return activeTraceTitle ? t('messageBubble.traceGenerating', { title: activeTraceTitle }) : t('messageBubble.generating')
    case 'error':
      return t('messageBubble.failed')
    case 'cancelled':
      return t('messageBubble.stopped')
    case 'done':
      return ''
  }
}

function CitationSummaryRow({ citations, onPress }: { citations: MessageCitation[]; onPress: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const web = citations.filter((source) => source.type === 'web').length
  const knowledge = citations.filter((source) => source.type === 'knowledge').length
  const memory = citations.filter((source) => source.type === 'memory').length
  const first = citations[0]
  const navigation = useNavigationTrigger(onPress)
  const summary = [
    web ? t('messageBubble.web', { count: web }) : '',
    knowledge ? t('messageBubble.knowledge', { count: knowledge }) : '',
    memory ? t('messageBubble.memory', { count: memory }) : '',
  ].filter(Boolean).join(' · ')

  return (
    <IslePressable
      haptic
      onPress={navigation.trigger}
      accessibilityLabel={t('messageBubble.viewSources')}
      style={{
        minHeight: 44,
        borderRadius: 22,
        paddingHorizontal: 11,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.material.paperRaised,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.island }}>
        <AnimatedNavigationIcon glyph={first?.type === 'knowledge' ? 'knowledge-database' : first?.type === 'memory' ? 'memory-brain' : 'source'} active={navigation.active} color={colors.primary} size={16} />
      </View>
      <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900', maxWidth: 132 }}>
        {t('messageBubble.sources', { count: citations.length })}{summary ? ` · ${summary}` : ''}
      </Text>
      <AnimatedNavigationIcon glyph="source" active={navigation.active} color={colors.textTertiary} size={14} />
    </IslePressable>
  )
}

function CitationNumberChips({ citations, onPress }: { citations: MessageCitation[]; onPress: (citation: MessageCitation) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
      {citations.slice(0, 6).map((citation, index) => (
        <CitationNumberChip key={citation.id} citation={citation} index={index} onPress={onPress} />
      ))}
    </View>
  )
}

function CitationNumberChip({ citation, index, onPress }: { citation: MessageCitation; index: number; onPress: (citation: MessageCitation) => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const navigation = useNavigationTrigger(() => onPress(citation))
  return (
    <IslePressable
      haptic
      onPress={navigation.trigger}
      accessibilityLabel={t('source.citation', { index: index + 1 })}
      style={{
        minHeight: 44,
        minWidth: 44,
        borderRadius: 22,
        paddingHorizontal: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        backgroundColor: colors.mintSoft,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <AnimatedNavigationIcon glyph={citation.type === 'knowledge' ? 'knowledge-database' : citation.type === 'memory' ? 'memory-brain' : 'source'} active={navigation.active} color={colors.primary} size={14} />
      <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '900' }}>[{index + 1}]</Text>
    </IslePressable>
  )
}

function ProcessSummaryRow({ summary, hasError, running, onPress }: { summary: string; hasError: boolean; running: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const tint = running ? colors.primary : hasError ? colors.error : colors.textSecondary
  const navigation = useNavigationTrigger(onPress)
  return (
    <IslePressable
      haptic
      onPress={navigation.trigger}
      accessibilityLabel={t('messageBubble.viewProcess')}
      style={{
        minHeight: 44,
        borderRadius: 22,
        paddingHorizontal: 11,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.material.paperRaised,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.island }}>
        <AnimatedNavigationIcon glyph="source" active={navigation.active} color={tint} size={16} />
      </View>
      <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900', maxWidth: 132 }}>
        {t('messageBubble.process', { summary })}
      </Text>
      <AnimatedNavigationIcon glyph="mcp-network" active={navigation.active} color={tint} size={14} />
    </IslePressable>
  )
}

function MessageMeta({ message }: { message: Message }) {
  const { t } = useTranslation()
  const usage = message.usage
  const estimated = usage?.source === 'estimated' || !!message.estimatedTokens
  const hasUsage = !!usage && !!(usage.inputTokens || usage.outputTokens || usage.totalTokens || usage.reasoningTokens)
  const items = [
    message.durationMs ? t('messageBubble.duration', { value: formatDuration(message.durationMs) }) : '',
    !hasUsage && estimated ? t('messageBubble.estimated') : '',
    message.citations?.length ? t('messageBubble.sources', { count: message.citations.length }) : '',
  ].filter(Boolean)
  if (!items.length && !hasUsage) return null
  return (
    <View
      style={{
        alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
        maxWidth: message.role === 'user' ? '84%' : '92%',
        marginTop: 6,
        paddingHorizontal: 4,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start',
        flexWrap: 'wrap',
        gap: 6,
      }}
    >
      {hasUsage && usage ? <UsageTextChips usage={usage} estimated={estimated} /> : null}
      {items.map((item) => (
        <MetaChip key={item} label={item} />
      ))}
    </View>
  )
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

function ActionButton({ label, children, compact = false, tone = 'default', onPress }: { label: string; children: ReactNode; compact?: boolean; tone?: 'default' | 'danger'; onPress?: () => void }) {
  const { colors } = useAppTheme()

  return (
    <IslePressable
      haptic
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        minHeight: 44,
        paddingHorizontal: compact ? 11 : 12,
        borderRadius: 22,
        flexDirection: 'row',
        alignItems: 'center',
        gap: compact ? 4 : 5,
        backgroundColor: colors.material.paperRaised,
      }}
    >
      {children}
      <Text style={{ color: tone === 'danger' ? colors.error : colors.textTertiary, fontSize: compact ? 11 : 12, fontWeight: '900' }}>{label}</Text>
    </IslePressable>
  )
}

function ActionIconButton({ label, children, active = false, onPress }: { label: string; children: ReactNode; active?: boolean; onPress?: () => void }) {
  const { colors } = useAppTheme()

  return (
    <IslePressable
      haptic
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? colors.islandRaised : colors.material.paperRaised,
        borderWidth: 1,
        borderColor: active ? colors.borderStrong : colors.border,
      }}
    >
      {children}
    </IslePressable>
  )
}

function MetaChip({ label }: { label: string }) {
  const { colors } = useAppTheme()

  return (
    <View style={{ minHeight: 24, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border }}>
      <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '900' }}>
        {label}
      </Text>
    </View>
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
