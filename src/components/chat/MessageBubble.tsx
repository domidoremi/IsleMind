import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { MotiView } from 'moti'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Copy, Database, ExternalLink, Globe2, ListChecks, MoreHorizontal, RefreshCcw, RotateCcw, Settings2, Sparkles, Trash2, Volume2, Zap } from 'lucide-react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import type { ChatErrorCode, Message, MessageCitation } from '@/types'
import { useAppTheme } from '@/hooks/useAppTheme'
import { messageAnimationForMotion } from '@/theme/animation'
import { IslePressable } from '@/components/ui/isle'
import { useSettingsStore } from '@/store/settingsStore'
import { MessageContent } from './MessageContent'
import { collectMessageTraces, formatDuration, formatNumber, getActiveTraceTitle, summarizeTraces } from './tracePresentation'
import { IslePanel } from '@/components/ui/isle'
import { RenderGuard } from '@/components/ui/RenderGuard'
import { useMotionPreference } from '@/hooks/useMotionPreference'

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
  const traces = collectMessageTraces(message)
  const traceSummary = summarizeTraces(traces, message.status)
  const canLongPressDelete = !!onDelete && message.status !== 'sending' && message.status !== 'streaming'

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
            backgroundColor: colors.error,
            [isUser ? 'right' : 'left']: 4,
          },
          deleteStyle,
        ]}
      >
        <Trash2 color={colors.surface} size={18} strokeWidth={2.2} />
      </Animated.View>

      <GestureDetector gesture={longPressDelete}>
        <Animated.View style={animatedStyle}>
          <MotiView
            {...messageAnimationForMotion(index, motion)}
            style={{
              alignSelf: isUser ? 'flex-end' : 'flex-start',
              maxWidth: isUser ? '86%' : '94%',
              width: isUser ? undefined : '94%',
            }}
          >
            <IslePanel
              elevated={!isUser}
              contentStyle={{
                paddingHorizontal: 16,
                paddingVertical: 12,
              }}
              style={{
                borderRadius: isUser ? 24 : 28,
                backgroundColor: isUser ? colors.text : colors.island,
                borderColor: message.status === 'error' ? colors.error : colors.border,
              }}
            >
              {message.attachments?.length ? (
                <Text style={{ color: isUser ? colors.surface : colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>
                  {t('messageBubble.attachmentCount', { count: message.attachments.length })}
                </Text>
              ) : null}
              <RenderGuard label={t('messageBubble.messageContent')} fallbackText={displayText || message.content} compact>
                {displayText && isStreamingContent ? (
                  <StreamingTextContent content={displayText} isUser={isUser} />
                ) : displayText ? (
                  <MessageContent content={displayText} isUser={isUser} />
                ) : traces.length && message.status !== 'streaming' ? (
                  <Text style={{ color: isUser ? colors.surface : colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
                    {t('messageBubble.emptyResponse')}
                  </Text>
                ) : (
                  <TypingDots />
                )}
              </RenderGuard>
              {isStreamingContent && displayText ? <Cursor /> : null}
              {message.status === 'error' ? <ErrorHint code={message.errorCode} /> : null}
              <MessageStatusLine message={message} traces={traces} isUser={isUser} hasText={!!displayText} />
              {!isUser && (message.citations?.length || traces.length) ? (
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
                  {traces.length ? (
                    <ProcessSummaryRow
                      summary={traceSummary.label}
                      hasError={traceSummary.errors > 0}
                      running={traceSummary.running > 0}
                      onPress={() => router.push({ pathname: '/source', params: { conversationId, messageId: message.id, kind: 'process' } })}
                    />
                  ) : null}
                </View>
              ) : null}
            </IslePanel>
            <MessageMeta message={message} />
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
          </MotiView>
        </Animated.View>
      </GestureDetector>
    </View>
  )
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
  const hasNormalActions = canCopy || canRegenerate

  if (message.status === 'sending') return null
  if (message.status === 'streaming' && !canCopy) return null
  if (!hasNormalActions && message.status !== 'error') return null

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
    <View style={{ alignItems: isUser ? 'flex-end' : 'flex-start', marginTop: 5 }}>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
        <ActionButton label={actionsOpen ? t('common.collapse') : t('messageBubble.actions')} onPress={onToggle} compact>
          <MoreHorizontal color={colors.textTertiary} size={14} strokeWidth={2} />
        </ActionButton>
        {actionsOpen && canCopy ? (
          <ActionButton label={t('common.copy')} onPress={onCopy} compact>
            <Copy color={colors.textTertiary} size={13} strokeWidth={2} />
          </ActionButton>
        ) : null}
        {actionsOpen && canCopy && !isUser && onCopyWorkArtifact ? (
          <ActionButton label={t('messageBubble.copyWorkArtifact')} onPress={onCopyWorkArtifact} compact>
            <ListChecks color={colors.textTertiary} size={13} strokeWidth={2} />
          </ActionButton>
        ) : null}
        {actionsOpen && canCopy && !isUser && onContinueWorkArtifact ? (
          <ActionButton label={t('messageBubble.continueWorkArtifact')} onPress={onContinueWorkArtifact} compact>
            <Sparkles color={colors.textTertiary} size={13} strokeWidth={2} />
          </ActionButton>
        ) : null}
        {actionsOpen && canCopy && !isUser ? (
          <ActionButton label={t('messageBubble.speak')} onPress={onSpeak} compact>
            <Volume2 color={colors.textTertiary} size={13} strokeWidth={2} />
          </ActionButton>
        ) : null}
        {actionsOpen && canRegenerate ? (
          <ActionButton label={t('messageBubble.regenerate')} onPress={onRegenerate} compact>
            <RefreshCcw color={colors.textTertiary} size={13} strokeWidth={2} />
          </ActionButton>
        ) : null}
      </View>
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

function StreamingTextContent({ content, isUser }: { content: string; isUser: boolean }) {
  const { colors } = useAppTheme()
  const [visibleLength, setVisibleLength] = useState(() => content.length)

  useEffect(() => {
    if (visibleLength >= content.length) {
      if (visibleLength > content.length) setVisibleLength(content.length)
      return
    }
    const timer = setTimeout(() => {
      setVisibleLength((current) => Math.min(content.length, current + Math.max(4, Math.ceil((content.length - current) / 3))))
    }, 18)
    return () => clearTimeout(timer)
  }, [content, visibleLength])

  return (
    <Text
      selectable
      style={{
        color: isUser ? colors.surface : colors.text,
        fontSize: 15,
        lineHeight: 23,
        letterSpacing: 0.1,
      }}
    >
      {content.slice(0, visibleLength)}
    </Text>
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
  const summary = [
    web ? t('messageBubble.web', { count: web }) : '',
    knowledge ? t('messageBubble.knowledge', { count: knowledge }) : '',
    memory ? t('messageBubble.memory', { count: memory }) : '',
  ].filter(Boolean).join(' · ')

  return (
    <IslePressable
      haptic
      onPress={onPress}
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
        {first?.type === 'web' ? <Globe2 color={colors.primary} size={11} strokeWidth={2.2} /> : <Database color={colors.primary} size={11} strokeWidth={2.2} />}
      </View>
      <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900', maxWidth: 132 }}>
        {t('messageBubble.sources', { count: citations.length })}{summary ? ` · ${summary}` : ''}
      </Text>
      <ExternalLink color={colors.textTertiary} size={12} strokeWidth={2} />
    </IslePressable>
  )
}

function CitationNumberChips({ citations, onPress }: { citations: MessageCitation[]; onPress: (citation: MessageCitation) => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
      {citations.slice(0, 6).map((citation, index) => (
        <IslePressable
          key={citation.id}
          haptic
          onPress={() => onPress(citation)}
          accessibilityLabel={t('source.citation', { index: index + 1 })}
          style={{
            minHeight: 44,
            minWidth: 44,
            borderRadius: 22,
            paddingHorizontal: 8,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.mintSoft,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '900' }}>[{index + 1}]</Text>
        </IslePressable>
      ))}
    </View>
  )
}

function ProcessSummaryRow({ summary, hasError, running, onPress }: { summary: string; hasError: boolean; running: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const tint = running ? colors.primary : hasError ? colors.error : colors.textSecondary
  return (
    <IslePressable
      haptic
      onPress={onPress}
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
        <ListChecks color={tint} size={11} strokeWidth={2.2} />
      </View>
      <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900', maxWidth: 132 }}>
        {t('messageBubble.process', { summary })}
      </Text>
      <Sparkles color={tint} size={12} strokeWidth={2} />
    </IslePressable>
  )
}

function MessageMeta({ message }: { message: Message }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const usage = message.usage
  const items = [
    message.durationMs ? formatDuration(message.durationMs) : '',
    usage?.inputTokens ? t('messageBubble.tokensIn', { value: formatNumber(usage.inputTokens) }) : '',
    usage?.outputTokens ? t('messageBubble.tokensOut', { value: formatNumber(usage.outputTokens) }) : '',
    usage?.totalTokens ? t('messageBubble.tokensTotal', { value: formatNumber(usage.totalTokens) }) : '',
    usage?.reasoningTokens ? t('messageBubble.tokensReasoning', { value: formatNumber(usage.reasoningTokens) }) : '',
    usage?.source === 'estimated' || message.estimatedTokens ? t('messageBubble.estimated') : '',
    message.citations?.length ? t('messageBubble.sources', { count: message.citations.length }) : '',
  ].filter(Boolean)
  if (!items.length) return null
  return (
    <Text
      numberOfLines={1}
      style={{
        alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
        maxWidth: '86%',
        color: colors.textTertiary,
        fontSize: 10,
        fontWeight: '900',
        marginTop: 6,
        paddingHorizontal: 4,
      }}
    >
      {items.join(' · ')}
    </Text>
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
