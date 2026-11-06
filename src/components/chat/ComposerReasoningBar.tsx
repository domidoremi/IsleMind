import { useEffect, useId, useRef, useState } from 'react'
import { Animated, Easing, View, type GestureResponderEvent } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import * as Haptics from 'expo-haptics'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { ISLE_MIN_TOUCH_TARGET } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { useSettingsStore } from '@/store/settingsStore'
import type { ReasoningEffort } from '@/core'
import { type ReasoningControlValue, resolveReasoningControlValue } from '@/utils/modelReasoning'
import { resolveReasoningEffortEffect } from './composerReasoningEffects'
import { ReasoningEffortGlyph } from './ReasoningEffortGlyph'

const EFFORT_ORDER: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
const TRACK_INSET = 16
const DRAG_THRESHOLD = 6
const THUMB_SIZE = 16
const SURFACE_HEIGHT = 30
const FEEDBACK_HEIGHT = 24
const FEEDBACK_WIDTH = 76

export function ComposerReasoningBar({ options, value, disabled, modelKey, compact, onChange, onExpand }: {
  options: ReasoningEffort[]
  value: ReasoningEffort | undefined
  disabled?: boolean
  modelKey: string
  onChange: (value: ReasoningEffort | undefined) => void
  onExpand: () => void
  compact: boolean
}) {
  const { colors, isDark } = useAppTheme()
  const { t } = useTranslation()
  const gradientId = useId().replace(/:/g, '')
  const hapticsEnabled = useSettingsStore(state => state.settings.hapticsEnabled)
  const supportedLevels = EFFORT_ORDER.filter(level => options.includes(level))
  const levels: ReasoningControlValue[] = ['default', ...supportedLevels]
  const levelsKey = levels.join('|')
  const available = supportedLevels.length > 0
  const showTrack = !compact && available
  const motion = useMotionPreference(true)
  const selected = value && supportedLevels.includes(value) ? value : 'default'
  const selectedIndex = levels.indexOf(selected)
  const selectedFraction = selectedIndex / Math.max(1, levels.length - 1)
  const [dragIndex, setDragIndex] = useState<number>()
  const [feedback, setFeedback] = useState<ReasoningControlValue>()
  const [feedbackVisible, setFeedbackVisible] = useState(false)
  const [railWidth, setRailWidth] = useState(0)
  const trackPresence = useRef(new Animated.Value(showTrack ? 1 : 0)).current
  const position = useRef(new Animated.Value(selectedFraction)).current
  const pressPresence = useRef(new Animated.Value(0)).current
  const feedbackOpacity = useRef(new Animated.Value(0)).current
  const effectProgress = useRef(new Animated.Value(1)).current
  const trackWidth = useRef(0)
  const gesture = useRef<{
    origin: number; startX: number; startIndex: number; index: number; moved: boolean
    startValue: ReasoningEffort | undefined
    modelKey: string; levelsKey: string; compact: boolean; lastHapticAt: number
  } | null>(null)
  const feedbackScope = useRef('')
  const current = useRef({ disabled, available, value, levels, selectedIndex, modelKey, levelsKey, compact, onChange, onExpand })
  current.current = { disabled, available, value, levels, selectedIndex, modelKey, levelsKey, compact, onChange, onExpand }
  const activeDragIndex = !disabled && gesture.current?.modelKey === modelKey &&
    gesture.current.levelsKey === levelsKey && gesture.current.compact === compact &&
    gesture.current.startValue === value ? dragIndex : undefined
  const previewIndex = activeDragIndex ?? selectedIndex
  const preview = levels[previewIndex] ?? 'default'
  const effect = resolveReasoningEffortEffect(available ? preview : 'none', colors, !!isDark)
  const effectKey = `${effect.themeId}:${effect.start}:${effect.end}:${isDark}`
  const trackHeight = effect.trackHeight

  useEffect(() => {
    effectProgress.stopAnimation()
    if (motion !== 'full' || disabled || !available || effect.duration === 0) {
      effectProgress.setValue(1)
      return
    }
    effectProgress.setValue(0)
    const animation = Animated.timing(effectProgress, {
      toValue: 1, duration: effect.duration, easing: Easing.out(Easing.cubic),
      useNativeDriver: true, isInteraction: false,
    })
    animation.start()
    return () => animation.stop()
  }, [preview, compact, motion, disabled, available, modelKey, effectKey, effect.duration, effectProgress])

  useEffect(() => {
    gesture.current = null
    setDragIndex(undefined)
  }, [value, disabled, modelKey, levelsKey, compact])

  useEffect(() => {
    feedbackScope.current = ''
    setFeedback(undefined)
    setFeedbackVisible(false)
    feedbackOpacity.stopAnimation()
    feedbackOpacity.setValue(0)
  }, [disabled, modelKey, levelsKey, compact, feedbackOpacity])

  useEffect(() => {
    if (motion !== 'full') {
      trackPresence.setValue(showTrack ? 1 : 0)
      return
    }
    const animation = Animated.spring(trackPresence, {
      toValue: showTrack ? 1 : 0, stiffness: 360, damping: 30, mass: 0.8, overshootClamping: true,
      useNativeDriver: true, isInteraction: false,
    })
    animation.start()
    return () => animation.stop()
  }, [showTrack, motion, trackPresence])

  const pressed = activeDragIndex !== undefined
  const feedbackActive = pressed && showTrack
  useEffect(() => {
    if (motion !== 'full') {
      pressPresence.setValue(pressed ? 1 : 0)
      return
    }
    const animation = Animated.spring(pressPresence, {
      toValue: pressed ? 1 : 0, stiffness: 420, damping: 26, mass: 0.65,
      useNativeDriver: true, isInteraction: false,
    })
    animation.start()
    return () => animation.stop()
  }, [pressed, motion, pressPresence])

  useEffect(() => {
    if (pressed) return
    if (motion !== 'full') {
      position.setValue(selectedFraction)
      return
    }
    const animation = Animated.spring(position, {
      toValue: selectedFraction, stiffness: 460, damping: 30, mass: 0.65, overshootClamping: true,
      useNativeDriver: true, isInteraction: false,
    })
    animation.start()
    return () => animation.stop()
  }, [pressed, selectedFraction, modelKey, levelsKey, motion, position])

  useEffect(() => () => {
    position.stopAnimation()
    trackPresence.stopAnimation()
    pressPresence.stopAnimation()
    feedbackOpacity.stopAnimation()
    effectProgress.stopAnimation()
  }, [position, trackPresence, pressPresence, feedbackOpacity, effectProgress])

  useEffect(() => {
    if (feedbackActive) setFeedbackVisible(true)
    if (motion !== 'full') {
      feedbackOpacity.setValue(feedbackActive ? 1 : 0)
      if (!feedbackActive) setFeedbackVisible(false)
      return
    }
    const animation = Animated.timing(feedbackOpacity, {
      toValue: feedbackActive ? 1 : 0, duration: feedbackActive ? 110 : 180,
      easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false,
    })
    animation.start(({ finished }) => {
      if (finished && !feedbackActive) setFeedbackVisible(false)
    })
    return () => animation.stop()
  }, [feedbackActive, motion, feedbackOpacity])

  const levelLabel = (level: ReasoningControlValue) => t(`chat.reasoningEffort.${level}`)
  const selectionHaptic = () => {
    if (hapticsEnabled) void Haptics.selectionAsync().catch(() => {})
  }
  const chooseIndex = (index: number, haptic = true) => {
    const latest = current.current
    const level = latest.levels[index]
    if (!latest.available || latest.disabled || !level) return
    const next = resolveReasoningControlValue(level)
    if (next !== latest.value) {
      if (haptic) selectionHaptic()
      latest.onChange(next)
    }
  }
  const resetDrag = () => {
    gesture.current = null
    setDragIndex(undefined)
  }
  const cancelDrag = () => {
    resetDrag()
    feedbackOpacity.stopAnimation()
    feedbackOpacity.setValue(0)
    setFeedback(undefined)
    setFeedbackVisible(false)
  }
  const moveDrag = (event: GestureResponderEvent) => {
    const active = gesture.current
    const latest = current.current
    if (!active || latest.disabled || active.modelKey !== latest.modelKey ||
      active.levelsKey !== latest.levelsKey || active.compact !== latest.compact ||
      active.startValue !== latest.value) return
    const delta = event.nativeEvent.pageX - active.startX
    active.moved ||= Math.abs(delta) >= DRAG_THRESHOLD
    if (latest.compact && !active.moved) return
    const next = Math.max(0, Math.min(1, latest.compact
      ? active.startIndex / (latest.levels.length - 1) + delta / trackWidth.current
      : (event.nativeEvent.pageX - active.origin - TRACK_INSET) / trackWidth.current))
    if (!Number.isFinite(next)) return
    const nextIndex = Math.round(next * (latest.levels.length - 1))
    if (nextIndex !== active.index) {
      const now = Date.now()
      if (now - active.lastHapticAt >= 45) {
        selectionHaptic()
        active.lastHapticAt = now
      }
      active.index = nextIndex
      setDragIndex(nextIndex)
    }
    // Direct manipulation stays continuous; labels and committed values are discrete.
    position.setValue(next)
    if (!latest.compact) setFeedback(latest.levels[nextIndex])
  }
  const startDrag = (event: GestureResponderEvent) => {
    if (!current.current.available || current.current.disabled || trackWidth.current <= 0) return
    gesture.current = {
      origin: event.nativeEvent.pageX - event.nativeEvent.locationX,
      startX: event.nativeEvent.pageX, startIndex: selectedIndex, index: selectedIndex, moved: false,
      startValue: value,
      modelKey, levelsKey, compact, lastHapticAt: 0,
    }
    feedbackScope.current = `${modelKey}:${levelsKey}`
    setDragIndex(selectedIndex)
    moveDrag(event)
  }
  const finishDrag = (event: GestureResponderEvent) => {
    moveDrag(event)
    const completed = gesture.current
    resetDrag()
    const latest = current.current
    if (!completed || latest.disabled || !latest.available || completed.modelKey !== latest.modelKey ||
      completed.levelsKey !== latest.levelsKey || completed.compact !== latest.compact ||
      completed.startValue !== latest.value) return
    if (completed.compact && !completed.moved) {
      selectionHaptic()
      latest.onExpand()
      return
    }
    chooseIndex(completed.index, false)
  }
  const adjust = (direction: number) => {
    if (!available || disabled) return
    cancelDrag()
    const latest = current.current
    chooseIndex(Math.max(0, Math.min(latest.levels.length - 1, latest.selectedIndex + direction)))
  }
  const railTranslate = position.interpolate({ inputRange: [0, 1], outputRange: [-railWidth / 2, 0], extrapolate: 'clamp' })
  const thumbTranslate = position.interpolate({ inputRange: [0, 1], outputRange: [0, railWidth], extrapolate: 'clamp' })
  const feedbackWidth = Math.min(FEEDBACK_WIDTH, railWidth + TRACK_INSET * 2)
  const feedbackEdge = Math.min(0.49, Math.max(0.001, (feedbackWidth / 2 - TRACK_INSET) / Math.max(1, railWidth)))
  const feedbackTranslate = position.interpolate({
    inputRange: [0, feedbackEdge, 1 - feedbackEdge, 1],
    outputRange: [-TRACK_INSET, -TRACK_INSET, railWidth + TRACK_INSET - feedbackWidth, railWidth + TRACK_INSET - feedbackWidth],
    extrapolate: 'clamp',
  })

  return <View testID="chat-reasoning-bar" accessible focusable accessibilityRole="adjustable"
    accessibilityLabel={t('chat.quickReasoning')}
    accessibilityHint={t(!available ? 'chat.reasoningBar.fixedHint' : compact ? 'chat.reasoningBar.compactHint' : 'chat.reasoningBar.inlineHint')}
    accessibilityState={{ disabled: !available || !!disabled }}
    accessibilityValue={{ min: 0, max: levels.length - 1, now: previewIndex,
      text: available ? levelLabel(preview) : t('chat.reasoningBar.fixed') }}
    accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]}
    onAccessibilityAction={event => {
      if (event.nativeEvent.actionName === 'increment') adjust(1)
      if (event.nativeEvent.actionName === 'decrement') adjust(-1)
      if (event.nativeEvent.actionName === 'activate') {
        cancelDrag()
        const latest = current.current
        if (!latest.available || latest.disabled) return
        if (latest.compact) latest.onExpand()
        else chooseIndex((latest.selectedIndex + 1) % latest.levels.length)
      }
    }}
    onLayout={event => {
      const width = Math.max(0, event.nativeEvent.layout.width - TRACK_INSET * 2)
      trackWidth.current = width
      setRailWidth(width)
    }}
    onStartShouldSetResponder={() => !current.current.disabled && current.current.available}
    onResponderGrant={startDrag} onResponderMove={moveDrag} onResponderRelease={finishDrag}
    onResponderTerminationRequest={() => !gesture.current || !!current.current.disabled}
    onResponderTerminate={cancelDrag} onTouchCancel={cancelDrag}
    style={{ height: ISLE_MIN_TOUCH_TARGET, minWidth: 0, borderRadius: ISLE_MIN_TOUCH_TARGET / 2,
      overflow: 'hidden', opacity: disabled || !available ? 0.45 : 1 }}>
    <Animated.View pointerEvents="none" accessible={false}
      testID={compact ? 'chat-reasoning-compact' : !available ? 'chat-reasoning-inline' : undefined}
      style={{ position: 'absolute', left: 0, right: 0, top: (ISLE_MIN_TOUCH_TARGET - SURFACE_HEIGHT) / 2,
        height: SURFACE_HEIGHT, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center',
        justifyContent: 'center', gap: 6,
        opacity: trackPresence.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [{ scale: trackPresence.interpolate({ inputRange: [0, 1], outputRange: [1, 0.88] }) }] }}>
      <Svg width={railWidth + TRACK_INSET * 2} height={SURFACE_HEIGHT} style={{ position: 'absolute', left: 0, top: 0 }}>
        <Defs><LinearGradient id={`${gradientId}-surface`} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor={effect.start} stopOpacity={effect.surfaceOpacity[0]} />
          <Stop offset="100%" stopColor={effect.end} stopOpacity={effect.surfaceOpacity[1]} />
        </LinearGradient></Defs>
        <Rect testID="chat-reasoning-surface" x="0.5" y="0.5" width={Math.max(0, railWidth + TRACK_INSET * 2 - 1)}
          height={SURFACE_HEIGHT - 1} rx={Math.min((SURFACE_HEIGHT - 1) / 2, effect.surfaceRadius)}
          fill={`url(#${gradientId}-surface)`} stroke={effect.end} strokeOpacity={effect.borderOpacity} strokeWidth="0.7" />
      </Svg>
      {available ? <ReasoningEffortGlyph level={preview} effect={effect} size={24}
        id={`${gradientId}-compact`} progress={effectProgress} variant="compact" /> : null}
      <Text numberOfLines={1} style={{ minWidth: 0, flexShrink: 1, fontSize: 12,
        fontWeight: '600', letterSpacing: 0.1, color: colors.textSecondary }}>
        {available ? levelLabel(preview) : t('chat.reasoningBar.fixed')}
      </Text>
    </Animated.View>
    {available ? <Animated.View pointerEvents="none" accessible={false}
      testID={showTrack ? 'chat-reasoning-track' : undefined}
      style={{ position: 'absolute', left: TRACK_INSET, right: TRACK_INSET, top: 0,
        height: ISLE_MIN_TOUCH_TARGET, opacity: trackPresence,
        transform: [{ scaleX: trackPresence.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }] }}>
      <View testID="chat-reasoning-rail" style={{ position: 'absolute', left: 0, right: 0,
        top: (ISLE_MIN_TOUCH_TARGET - trackHeight) / 2, height: trackHeight }}>
        <View style={{ position: 'absolute', left: 0, right: 0, height: trackHeight,
          borderRadius: trackHeight / 2, backgroundColor: colors.textTertiary, opacity: 0.2 }} />
        <Animated.View style={{ position: 'absolute', left: 0, top: -3, width: railWidth, height: 8,
          borderRadius: 4, backgroundColor: effect.end,
          opacity: pressPresence.interpolate({ inputRange: [0, 1], outputRange: [effect.halo * 0.4, effect.halo * 0.8] }),
          transform: [{ translateX: railTranslate }, { scaleX: position }] }} />
        <Animated.View style={{ position: 'absolute', left: 0, width: railWidth, height: trackHeight,
          transform: [{ translateX: railTranslate }, { scaleX: position }] }}>
          <Svg width={railWidth} height={trackHeight}>
            <Defs><LinearGradient id={`${gradientId}-rail`} x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor={effect.start} />
              <Stop offset="100%" stopColor={effect.end} />
            </LinearGradient></Defs>
            <Rect width={railWidth} height={trackHeight} rx={trackHeight / 2} fill={`url(#${gradientId}-rail)`} />
          </Svg>
        </Animated.View>
        {levels.map((level, index) => <View key={level} testID={`chat-reasoning-stop-${level}`} style={{ position: 'absolute',
          left: `${index / (levels.length - 1) * 100}%`, top: (trackHeight - effect.stopHeight) / 2,
          marginLeft: -effect.stopWidth / 2, width: effect.stopWidth, height: effect.stopHeight,
          borderRadius: effect.themeId === 'minimal' ? 0 : effect.stopWidth / 2,
          backgroundColor: resolveReasoningEffortEffect(level, colors, !!isDark).end,
          opacity: previewIndex === index ? 0 : 0.45 }} />)}
        <Animated.View testID={showTrack ? 'chat-reasoning-thumb' : undefined}
          style={{ position: 'absolute', left: -THUMB_SIZE / 2, top: (trackHeight - THUMB_SIZE) / 2,
            width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: THUMB_SIZE / 2,
            opacity: feedbackOpacity.interpolate({ inputRange: [0, 1], outputRange: [1, 0.12] }),
            transform: [{ translateX: thumbTranslate },
              { scale: pressPresence.interpolate({ inputRange: [0, 1], outputRange: [1, 1.2] }) }] }}>
          <Animated.View style={{ position: 'absolute', left: -7, top: -7,
            width: THUMB_SIZE + 14, height: THUMB_SIZE + 14, borderRadius: (THUMB_SIZE + 14) / 2,
            borderWidth: 1, borderColor: effect.end,
            opacity: effectProgress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, effect.halo, 0] }),
            transform: [{ scale: effectProgress.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.3] }) }] }} />
          <View style={{ position: 'absolute', left: -8, top: -8 }}>
            <ReasoningEffortGlyph level={preview} effect={effect} size={32}
              id={`${gradientId}-thumb`} progress={effectProgress} variant="thumb" />
          </View>
        </Animated.View>
        {showTrack && !disabled && feedbackVisible && feedback && feedbackScope.current === `${modelKey}:${levelsKey}` ? <Animated.View
          testID="chat-reasoning-feedback" pointerEvents="none" accessible={false}
          style={{ position: 'absolute', left: 0, top: (trackHeight - FEEDBACK_HEIGHT) / 2,
            width: feedbackWidth, height: FEEDBACK_HEIGHT, borderRadius: Math.min(FEEDBACK_HEIGHT / 2, effect.surfaceRadius),
            backgroundColor: colors.ui.composer.shellBackground, paddingHorizontal: 8,
            flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
            opacity: feedbackOpacity, transform: [{ translateX: feedbackTranslate },
              { scale: feedbackOpacity.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }] }}>
          <Svg width={feedbackWidth} height={FEEDBACK_HEIGHT} style={{ position: 'absolute', left: 0, top: 0 }}>
            <Defs><LinearGradient id={`${gradientId}-feedback`} x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={effect.start} stopOpacity={effect.surfaceOpacity[0] * 1.6} />
              <Stop offset="100%" stopColor={effect.end} stopOpacity={effect.surfaceOpacity[1] * 1.6} />
            </LinearGradient></Defs>
            <Rect x="0.5" y="0.5" width={feedbackWidth - 1} height={FEEDBACK_HEIGHT - 1}
              rx={Math.min((FEEDBACK_HEIGHT - 1) / 2, effect.surfaceRadius)}
              fill={`url(#${gradientId}-feedback)`} stroke={effect.end} strokeOpacity={effect.borderOpacity + 0.12} strokeWidth="0.7" />
          </Svg>
          <ReasoningEffortGlyph level={preview} effect={effect} size={16}
            id={`${gradientId}-feedback-mark`} progress={effectProgress} variant="feedback" />
          <Text testID="chat-reasoning-feedback-label" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
            style={{ minWidth: 0, flexShrink: 1, fontSize: 12, fontWeight: '600', color: colors.text }}>
            {levelLabel(feedback)}
          </Text>
        </Animated.View> : null}
      </View>
    </Animated.View> : null}
  </View>
}
