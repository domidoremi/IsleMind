import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { MotiView } from 'moti'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Copy, Database, ExternalLink, Globe2, ListChecks, MoreHorizontal, RefreshCcw, RotateCcw, Settings2, Sparkles, Trash2, Zap } from 'lucide-react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated'
import type { ChatErrorCode, Message, MessageCitation } from '@/types'
import { useAppTheme } from '@/hooks/useAppTheme'
import { messageAnimationForMotion } from '@/theme/animation'
import { PressableScale } from '@/components/ui/PressableScale'
import { useSettingsStore } from '@/store/settingsStore'
import { MessageContent } from './MessageContent'
import { collectMessageTraces, formatDuration, formatNumber, getActiveTraceTitle, summarizeTraces } from './tracePresentation'
import { IslandPanel } from '@/components/ui/IslandPanel'
import { RenderGuard } from '@/components/ui/RenderGuard'
import { useMotionPreference } from '@/hooks/useMotionPreference'

interface MessageBubbleProps {
  conversationId: string
  message: Message
  index: number
  isLastAssistant?: boolean
  onCopy?: (message: Message) => void
  onRetry?: (message: Message) => void
  onRegenerate?: () => void
  onDelete?: (message: Message) => void
  onConfigure?: (message: Message) => void
  onTestModel?: (message: Message) => void
}

const DELETE_THRESHOLD = 82

export function MessageBubble({ conversationId, message, index, isLastAssistant = false, onCopy, onRetry, onRegenerate, onDelete, onConfigure, onTestModel }: MessageBubbleProps) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const hapticsEnabled = useSettingsStore((state) => state.settings.hapticsEnabled)
  const [actionsOpen, setActionsOpen] = useState(false)
  const isUser = message.role === 'user'
  const isStreamingContent = !isUser && (message.status === 'streaming' || message.status === 'sending')
  const translateX = useSharedValue(0)
  const armed = useSharedValue(0)
  const deleteProgress = useSharedValue(0)
  const direction = isUser ? 1 : -1
  const displayText = message.responseText ?? message.content
  const traces = collectMessageTraces(message)
  const traceSummary = summarizeTraces(traces, message.status)

  function notifyArmed() {
    if (hapticsEnabled) void Haptics.selectionAsync()
  }

  function notifyDelete() {
    if (hapticsEnabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    setTimeout(() => onDelete?.(message), 120)
  }

  const pan = Gesture.Pan()
    .activateAfterLongPress(260)
    .activeOffsetX([-10, 10])
    .failOffsetY([-18, 18])
    .onStart(() => {
      armed.value = 1
      runOnJS(notifyArmed)()
    })
    .onUpdate((event) => {
      const allowed = direction === 1 ? Math.max(0, event.translationX) : Math.min(0, event.translationX)
      translateX.value = allowed
      deleteProgress.value = Math.min(1, Math.abs(allowed) / DELETE_THRESHOLD)
    })
    .onEnd(() => {
      if (Math.abs(translateX.value) >= DELETE_THRESHOLD) {
        translateX.value = withSequence(withTiming(direction * 18, { duration: 80 }), withTiming(direction * 340, { duration: 180 }))
        deleteProgress.value = withTiming(1, { duration: 140 })
        runOnJS(notifyDelete)()
      } else {
        translateX.value = withSpring(0, { damping: 18, stiffness: 220 })
        deleteProgress.value = withTiming(0, { duration: 140 })
      }
      armed.value = 0
    })
    .onFinalize(() => {
      armed.value = 0
      if (Math.abs(translateX.value) < DELETE_THRESHOLD) {
        translateX.value = withSpring(0, { damping: 18, stiffness: 220 })
        deleteProgress.value = withTiming(0, { duration: 140 })
      }
    })

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { scale: armed.value ? withSpring(0.985) : withSpring(1) }],
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
            [isUser ? 'left' : 'right']: 4,
          },
          deleteStyle,
        ]}
      >
        <Trash2 color={colors.surface} size={18} strokeWidth={2.2} />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={animatedStyle}>
          <MotiView
            {...messageAnimationForMotion(index, motion)}
            style={{
              alignSelf: isUser ? 'flex-end' : 'flex-start',
              maxWidth: isUser ? '86%' : '94%',
              width: isUser ? undefined : '94%',
            }}
          >
            <IslandPanel
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
                  {message.attachments.length} 个附件
                </Text>
              ) : null}
              <RenderGuard label="消息内容" fallbackText={displayText || message.content} compact>
                {displayText && isStreamingContent ? (
                  <StreamingTextContent content={displayText} isUser={isUser} />
                ) : displayText ? (
                  <MessageContent content={displayText} isUser={isUser} />
                ) : traces.length && message.status !== 'streaming' ? (
                  <Text style={{ color: isUser ? colors.surface : colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
                    模型未返回正文。可以展开下方过程查看服务商返回的摘要、工具事件或失败原因。
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
                    <CitationSummaryRow
                      citations={message.citations}
                      onPress={() => router.push({ pathname: '/source', params: { conversationId, messageId: message.id, citationId: message.citations?.[0]?.id ?? '' } })}
                    />
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
            </IslandPanel>
            <MessageMeta message={message} />
            <MessageActionRow
              isUser={isUser}
              message={message}
              displayText={displayText}
              isLastAssistant={isLastAssistant}
              actionsOpen={actionsOpen}
              onToggle={() => setActionsOpen((value) => !value)}
              onCopy={() => onCopy?.(message)}
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
  onConfigure: () => void
  onTestModel: () => void
  onRetry: () => void
  onRegenerate?: () => void
}) {
  const { colors } = useAppTheme()
  const canCopy = !!displayText
  const canRegenerate = !isUser && isLastAssistant && message.status !== 'streaming'
  const hasNormalActions = canCopy || canRegenerate

  if (message.status === 'sending') return null
  if (message.status === 'streaming' && !canCopy) return null
  if (!hasNormalActions && message.status !== 'error') return null

  if (!isUser && message.status === 'error') {
    return (
      <View style={{ flexDirection: 'row', gap: 7, marginTop: 7, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        <ActionButton label="配置" onPress={onConfigure} tone="danger">
          <Settings2 color={colors.error} size={13} strokeWidth={2} />
        </ActionButton>
        <ActionButton label="测试" onPress={onTestModel} tone="danger">
          <Zap color={colors.error} size={13} strokeWidth={2} />
        </ActionButton>
        <ActionButton label="重试" onPress={onRetry} tone="danger">
          <RotateCcw color={colors.error} size={13} strokeWidth={2} />
        </ActionButton>
      </View>
    )
  }

  return (
    <View style={{ alignItems: isUser ? 'flex-end' : 'flex-start', marginTop: 5 }}>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
        <ActionButton label={actionsOpen ? '收起' : '操作'} onPress={onToggle} compact>
          <MoreHorizontal color={colors.textTertiary} size={14} strokeWidth={2} />
        </ActionButton>
        {actionsOpen && canCopy ? (
          <ActionButton label="复制" onPress={onCopy} compact>
            <Copy color={colors.textTertiary} size={13} strokeWidth={2} />
          </ActionButton>
        ) : null}
        {actionsOpen && canRegenerate ? (
          <ActionButton label="重新生成" onPress={onRegenerate} compact>
            <RefreshCcw color={colors.textTertiary} size={13} strokeWidth={2} />
          </ActionButton>
        ) : null}
      </View>
    </View>
  )
}

function ErrorHint({ code }: { code?: ChatErrorCode }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ borderRadius: 16, padding: 10, backgroundColor: colors.coralWash, marginTop: 8, borderWidth: 1, borderColor: colors.error }}>
      <Text style={{ color: colors.error, fontSize: 12, fontWeight: '800' }}>{errorTitle(code)}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 3 }}>{errorDescription(code)}</Text>
    </View>
  )
}

function StreamingTextContent({ content, isUser }: { content: string; isUser: boolean }) {
  const { colors } = useAppTheme()
  const [visibleLength, setVisibleLength] = useState(() => Math.max(0, content.length - 36))

  useEffect(() => {
    if (visibleLength >= content.length) return
    const timer = setTimeout(() => {
      setVisibleLength((current) => Math.min(content.length, current + Math.max(2, Math.ceil((content.length - current) / 4))))
    }, 24)
    return () => clearTimeout(timer)
  }, [content, visibleLength])

  useEffect(() => {
    setVisibleLength((current) => {
      if (content.length <= current) return content.length
      return Math.max(current, content.length - 36)
    })
  }, [content])

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
  if (isUser && message.status === 'done') return null
  if (hasText && (message.status === 'streaming' || message.status === 'sending')) return null
  const activeTrace = getActiveTraceTitle(traces, message.status)
  const status = statusLabel(message, activeTrace)
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

function statusLabel(message: Message, activeTraceTitle: string): string {
  switch (message.status) {
    case 'sending':
      return '准备发送'
    case 'streaming':
      return activeTraceTitle ? `${activeTraceTitle}中` : '生成中'
    case 'error':
      return '失败'
    case 'cancelled':
      return '已停止'
    case 'done':
      return ''
  }
}

function CitationSummaryRow({ citations, onPress }: { citations: MessageCitation[]; onPress: () => void }) {
  const { colors } = useAppTheme()
  const web = citations.filter((source) => source.type === 'web').length
  const knowledge = citations.filter((source) => source.type === 'knowledge').length
  const memory = citations.filter((source) => source.type === 'memory').length
  const first = citations[0]
  const summary = [
    web ? `网页 ${web}` : '',
    knowledge ? `知识 ${knowledge}` : '',
    memory ? `记忆 ${memory}` : '',
  ].filter(Boolean).join(' · ')

  return (
    <PressableScale
      haptic
      onPress={onPress}
      accessibilityLabel="查看来源"
      style={{
        minHeight: 30,
        borderRadius: 15,
        paddingHorizontal: 9,
        paddingVertical: 5,
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
        来源 {citations.length}{summary ? ` · ${summary}` : ''}
      </Text>
      <ExternalLink color={colors.textTertiary} size={12} strokeWidth={2} />
    </PressableScale>
  )
}

function ProcessSummaryRow({ summary, hasError, running, onPress }: { summary: string; hasError: boolean; running: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  const tint = running ? colors.primary : hasError ? colors.error : colors.textSecondary
  return (
    <PressableScale
      haptic
      onPress={onPress}
      accessibilityLabel="查看生成过程"
      style={{
        minHeight: 30,
        borderRadius: 15,
        paddingHorizontal: 9,
        paddingVertical: 5,
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
        过程 · {summary}
      </Text>
      <Sparkles color={tint} size={12} strokeWidth={2} />
    </PressableScale>
  )
}

function MessageMeta({ message }: { message: Message }) {
  const { colors } = useAppTheme()
  const usage = message.usage
  const items = [
    message.durationMs ? formatDuration(message.durationMs) : '',
    usage?.inputTokens ? `入 ${formatNumber(usage.inputTokens)}` : '',
    usage?.outputTokens ? `出 ${formatNumber(usage.outputTokens)}` : '',
    usage?.totalTokens ? `总 ${formatNumber(usage.totalTokens)}` : '',
    usage?.reasoningTokens ? `思考 ${formatNumber(usage.reasoningTokens)}` : '',
    usage?.source === 'estimated' || message.estimatedTokens ? '估算' : '',
    message.citations?.length ? `来源 ${message.citations.length}` : '',
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

function errorTitle(code?: ChatErrorCode): string {
  switch (code) {
    case 'missing_key':
      return '缺少 API Key'
    case 'disabled_provider':
      return '服务商未启用'
    case 'credential_mismatch':
      return '密钥类型与地址不匹配'
    case 'bad_auth':
      return '密钥或权限不可用'
    case 'bad_base_url':
      return '服务商地址可能不正确'
    case 'model_unavailable':
      return '模型不可用'
    case 'network_error':
      return '网络请求失败'
    case 'timeout':
      return '请求超时'
    case 'rate_limited':
      return '限流或额度不足'
    case 'max_tokens_exceeded':
      return '输出长度超过上限'
    default:
      return '发送失败'
  }
}

function errorDescription(code?: ChatErrorCode): string {
  switch (code) {
    case 'missing_key':
      return '保存当前服务商的 Key 后，可以直接回到这里重试。'
    case 'disabled_provider':
      return '在设置中启用当前服务商，或切换到其他可用服务商。'
    case 'credential_mismatch':
      return '例如 MiMo 的 tp- Key 必须走 Token Plan 地址，sk- Key 必须走按量付费地址。'
    case 'bad_auth':
      return '建议重新保存 Key，并使用测试密钥确认权限。'
    case 'bad_base_url':
      return '如果使用代理或 Token Plan，请确认 Base URL 包含 /v1。'
    case 'model_unavailable':
      return '获取可用模型后选择一个账号有权限的模型。'
    case 'network_error':
      return '检查网络、代理和服务商状态后再重试。'
    case 'timeout':
      return '请求等待过久，建议检查网络、代理或 Base URL。'
    case 'rate_limited':
      return '稍后重试，或检查服务商订阅、余额和速率限制。'
    case 'max_tokens_exceeded':
      return '降低对话参数里的 Max Tokens，或切换到更大输出上限的模型。'
    default:
      return '可以先测试当前模型，或打开设置检查服务商配置。'
  }
}

function ActionButton({ label, children, compact = false, tone = 'default', onPress }: { label: string; children: ReactNode; compact?: boolean; tone?: 'default' | 'danger'; onPress?: () => void }) {
  const { colors } = useAppTheme()

  return (
    <PressableScale
      haptic
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        minHeight: compact ? 28 : 30,
        paddingHorizontal: compact ? 9 : 10,
        borderRadius: compact ? 14 : 15,
        flexDirection: 'row',
        alignItems: 'center',
        gap: compact ? 4 : 5,
        backgroundColor: colors.material.paperRaised,
      }}
    >
      {children}
      <Text style={{ color: tone === 'danger' ? colors.error : colors.textTertiary, fontSize: compact ? 11 : 12, fontWeight: '900' }}>{label}</Text>
    </PressableScale>
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
