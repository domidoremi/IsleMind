import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react'
import Animated, {
  Easing,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type TextInputSubmitEditingEvent,
  type TextInputProps,
} from 'react-native'
import { useTranslation } from 'react-i18next'

import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { ProviderBrandIcon, type ProviderBrand } from '@/components/ui/ProviderBrandIcon'
import { HighFrameSpinner } from '@/components/ui/HighFrameSpinner'
import { IslePressable } from '@/components/ui/isle'
import type { MotionIntensity } from '@/hooks/useMotionPreference'
import type { useAppTheme } from '@/hooks/useAppTheme'
import type { CanonicalThemeId } from '@/types/settingsContracts'

import type {
  ComposerMarkdownAction,
  ComposerTextSelection,
} from './composerMarkdownEditing'
import type { ComposerSizeMode } from './composerLongDraftState'
import {
  COMPOSER_LARGE_HEADER_HEIGHT,
  COMPOSER_TOOLBAR_HEIGHT,
  resolveFloatingComposerWidth,
  resolveModelMenuPlacement,
  type ComposerActivityState,
} from './floatingComposerGeometry'
import type { ComposerKeyboardMotion } from './chatWorkspaceKeyboard'

type ThemeColors = ReturnType<typeof useAppTheme>['colors']

export interface MessageInputToolLabels {
  characterCount: string
  undo: string
  undoHint: string
  redo: string
  redoHint: string
  unorderedList: string
  unorderedListHint: string
  orderedList: string
  orderedListHint: string
  quote: string
  quoteHint: string
  codeBlock: string
  codeBlockHint: string
  collapse: string
  collapseHint: string
  expand: string
  expandHint: string
  more: string
  moreHint: string
  back: string
  backHint: string
  copyAll: string
  copyAllHint: string
  clearText: string
  clearTextHint: string
}

export interface MessageInputLongDraftTools {
  labels: MessageInputToolLabels
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onMarkdown: (action: ComposerMarkdownAction) => void
  onCopyAll: () => void
  onClearText: () => void
  onExpand: () => void
  onCollapse: () => void
}

const MOTION_CONFIG = {
  duration: 232,
  easing: Easing.inOut(Easing.cubic),
} as const

function geometryDuration(motion: MotionIntensity): number {
  if (motion === 'none') return 0
  if (motion === 'reduced') return 90
  return MOTION_CONFIG.duration
}

function keyboardEasing(easing: ComposerKeyboardMotion['easing']) {
  if (easing === 'linear') return Easing.linear
  if (easing === 'easeIn') return Easing.in(Easing.cubic)
  if (easing === 'easeOut') return Easing.out(Easing.cubic)
  return Easing.inOut(Easing.cubic)
}

const AnimatedView = Animated.createAnimatedComponent(View)
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput)

export function ComposerOverlay({
  viewportWidth,
  horizontalPadding,
  keyboardLift,
  keyboardMotion,
  sizeMode,
  activityState,
  motion,
  onLayout,
  children,
}: {
  viewportWidth: number
  horizontalPadding: number
  keyboardLift: number
  keyboardMotion: ComposerKeyboardMotion
  sizeMode: ComposerSizeMode
  activityState: ComposerActivityState
  motion: MotionIntensity
  onLayout?: (event: LayoutChangeEvent) => void
  children: ReactNode
}) {
  const targetWidth = resolveFloatingComposerWidth({
    viewportWidth,
    horizontalPadding,
    sizeMode,
    activityState,
  })
  const animatedWidth = useSharedValue(targetWidth)
  const keyboardProgress = useSharedValue(Math.max(0, keyboardLift))

  useEffect(() => {
    animatedWidth.value = withTiming(targetWidth, {
      duration: geometryDuration(motion),
      easing: Easing.inOut(Easing.cubic),
    })
  }, [animatedWidth, motion, targetWidth])

  useEffect(() => {
    keyboardProgress.value = withTiming(Math.max(0, keyboardLift), {
      duration: keyboardMotion.durationMs,
      easing: keyboardEasing(keyboardMotion.easing),
    })
  }, [
    keyboardLift,
    keyboardMotion.durationMs,
    keyboardMotion.easing,
    keyboardProgress,
  ])

  const widthStyle = useAnimatedStyle(() => ({ width: animatedWidth.value }))
  const keyboardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboardProgress.value }],
  }))

  return (
    <AnimatedView
      pointerEvents="box-none"
      style={[styles.overlay, keyboardStyle]}
    >
      <AnimatedView
        testID="composer-overlay"
        onLayout={onLayout}
        style={[styles.overlaySurface, { maxWidth: '100%', paddingHorizontal: 0 }, widthStyle]}
      >
        {children}
      </AnimatedView>
    </AnimatedView>
  )
}

export function ModelSelector({
  family,
  colors,
  label,
  accessibilityLabel,
  accessibilityHint,
  maxWidth,
  selected = false,
  expanded = false,
  iconOnly = false,
  ellipsizeMode = 'tail',
  icon,
  onPress,
  testID = 'chat-model-selector',
}: {
  family: CanonicalThemeId
  colors: ThemeColors
  label: string
  accessibilityLabel: string
  accessibilityHint?: string
  maxWidth: number
  selected?: boolean
  expanded?: boolean
  iconOnly?: boolean
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip'
  icon?: ReactNode
  onPress: () => void
  testID?: string
}) {
  const foreground = selected ? colors.ui.icon.accentForeground : colors.textSecondary
  return (
    <IslePressable
      testID={testID}
      haptic
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, expanded }}
      onPress={onPress}
      style={[
        styles.independentSurface,
        {
          minWidth: iconOnly ? 44 : 96,
          maxWidth,
          height: 44,
          paddingHorizontal: 10,
          borderRadius: 22,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          backgroundColor: colors.ui.semantic.surface.base,
          borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
          borderColor: selected ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border,
          shadowColor: colors.shadowTint,
          shadowOpacity: 0.08,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 5 },
          elevation: 1,
        },
      ]}
    >
      <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
        {icon ?? <AppIcon name="model" color={foreground} size={15} strokeWidth={appIconStroke.strong} />}
      </View>
      {!iconOnly ? <Text numberOfLines={1} ellipsizeMode={ellipsizeMode} style={{ flex: 1, minWidth: 0, color: foreground, fontSize: 11, lineHeight: 15, fontWeight: '800', includeFontPadding: false }}>{label}</Text> : null}
      <AppIcon name="collapse" color={colors.textTertiary} size={14} strokeWidth={appIconStroke.strong} />
    </IslePressable>
  )
}

export function MessageInput({
  value,
  onChangeText,
  surfaceHeight,
  bodyHeight,
  paddingVertical,
  toolbarBottomPadding,
  sizeMode,
  motion,
  focused,
  colors,
  placeholder,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  accessibilityValue,
  editable,
  multiline,
  scrollEnabled,
  submitBehavior,
  selection,
  inputRef,
  onSelectionChange,
  onSubmitEditing,
  onContentSizeChange,
  onFocus,
  onBlur,
  reviewExpandVisible,
  tools,
  inputProps,
}: {
  value: string
  onChangeText: (value: string) => void
  surfaceHeight: number
  bodyHeight: number
  paddingVertical: number
  toolbarBottomPadding: number
  sizeMode: ComposerSizeMode
  motion: MotionIntensity
  focused: boolean
  colors: ThemeColors
  placeholder: string
  accessibilityLabel: string
  accessibilityHint: string
  accessibilityState: TextInputProps['accessibilityState']
  accessibilityValue?: TextInputProps['accessibilityValue']
  editable: boolean
  multiline: boolean
  scrollEnabled: boolean
  submitBehavior: TextInputProps['submitBehavior']
  selection: ComposerTextSelection
  inputRef: RefObject<TextInput | null>
  onSelectionChange: (selection: ComposerTextSelection) => void
  onSubmitEditing: (event: TextInputSubmitEditingEvent) => void
  onContentSizeChange: TextInputProps['onContentSizeChange']
  onFocus: () => void
  onBlur: () => void
  reviewExpandVisible: boolean
  tools: MessageInputLongDraftTools
  inputProps?: Partial<TextInputProps>
}) {
  const [toolMode, setToolMode] = useState<'formatting' | 'more'>('formatting')
  const animatedSurfaceHeight = useSharedValue(surfaceHeight)
  const animatedBodyHeight = useSharedValue(bodyHeight)
  const largeProgress = useSharedValue(sizeMode === 'large' ? 1 : 0)
  const focusProgress = useSharedValue(focused ? 1 : 0)
  const reviewProgress = useSharedValue(
    sizeMode === 'review' && reviewExpandVisible ? 1 : 0,
  )
  const duration = geometryDuration(motion)
  const chromeDuration = motion === 'full' ? 150 : motion === 'reduced' ? 40 : 0

  useEffect(() => {
    animatedSurfaceHeight.value = withTiming(surfaceHeight, {
      duration,
      easing: Easing.inOut(Easing.cubic),
    })
    animatedBodyHeight.value = withTiming(bodyHeight, {
      duration,
      easing: Easing.inOut(Easing.cubic),
    })
  }, [animatedBodyHeight, animatedSurfaceHeight, bodyHeight, duration, surfaceHeight])

  useEffect(() => {
    focusProgress.value = withTiming(focused ? 1 : 0, {
      duration: chromeDuration,
      easing: Easing.inOut(Easing.cubic),
    })
  }, [chromeDuration, focusProgress, focused])

  useEffect(() => {
    largeProgress.value = withTiming(sizeMode === 'large' ? 1 : 0, {
      duration: chromeDuration,
      easing: Easing.inOut(Easing.cubic),
    })
    reviewProgress.value = withTiming(
      sizeMode === 'review' && reviewExpandVisible ? 1 : 0,
      {
        duration: chromeDuration,
        easing: Easing.inOut(Easing.cubic),
      },
    )
    if (sizeMode !== 'large') setToolMode('formatting')
  }, [chromeDuration, largeProgress, reviewExpandVisible, reviewProgress, sizeMode])

  const surfaceStyle = useAnimatedStyle(() => ({
    height: animatedSurfaceHeight.value,
  }))
  const focusStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      focusProgress.value,
      [0, 1],
      [colors.ui.input.background, colors.ui.input.backgroundFocused],
    ),
    borderColor: interpolateColor(
      focusProgress.value,
      [0, 1],
      [colors.ui.input.border, colors.ui.input.focus],
    ),
  }))
  const bodyStyle = useAnimatedStyle(() => ({
    height: animatedBodyHeight.value,
  }))
  const headerStyle = useAnimatedStyle(() => ({
    height: COMPOSER_LARGE_HEADER_HEIGHT * largeProgress.value,
    opacity: largeProgress.value,
  }))
  const reviewStyle = useAnimatedStyle(() => ({
    height: 36 * reviewProgress.value,
    opacity: reviewProgress.value,
  }))
  const toolbarStyle = useAnimatedStyle(() => ({
    height:
      (COMPOSER_TOOLBAR_HEIGHT + toolbarBottomPadding) *
      largeProgress.value,
    opacity: largeProgress.value,
    transform: [{ translateY: (1 - largeProgress.value) * 6 }],
  }))

  const renderToolButton = ({
    key,
    label,
    hint,
    disabled = false,
    onPress,
    children,
  }: {
    key: string
    label: string
    hint: string
    disabled?: boolean
    onPress: () => void
    children: ReactNode
  }) => (
    <IslePressable
      key={key}
      testID={'composer-tool-' + key}
      haptic
      disabled={disabled}
      onPressIn={() => inputRef.current?.focus()}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      hitSlop={{ top: 2, bottom: 2, left: 0, right: 0 }}
      style={{
        width: 44,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.42 : 1,
      }}
    >
      {children}
    </IslePressable>
  )

  const formattingTools = [
    renderToolButton({
      key: 'undo',
      label: tools.labels.undo,
      hint: tools.labels.undoHint,
      disabled: !tools.canUndo,
      onPress: tools.onUndo,
      children: (
        <AppIcon name="undo" color={colors.textSecondary} size={16} />
      ),
    }),
    renderToolButton({
      key: 'redo',
      label: tools.labels.redo,
      hint: tools.labels.redoHint,
      disabled: !tools.canRedo,
      onPress: tools.onRedo,
      children: (
        <AppIcon
          name="undo"
          color={colors.textSecondary}
          size={16}
          style={{ transform: [{ scaleX: -1 }] }}
        />
      ),
    }),
    renderToolButton({
      key: 'unordered-list',
      label: tools.labels.unorderedList,
      hint: tools.labels.unorderedListHint,
      onPress: () => tools.onMarkdown('unordered-list'),
      children: <Text style={{ color: colors.textSecondary, fontSize: 18 }}>•</Text>,
    }),
    renderToolButton({
      key: 'ordered-list',
      label: tools.labels.orderedList,
      hint: tools.labels.orderedListHint,
      onPress: () => tools.onMarkdown('ordered-list'),
      children: <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '900' }}>1.</Text>,
    }),
    renderToolButton({
      key: 'quote',
      label: tools.labels.quote,
      hint: tools.labels.quoteHint,
      onPress: () => tools.onMarkdown('quote'),
      children: <Text style={{ color: colors.textSecondary, fontSize: 16, fontWeight: '900' }}>❯</Text>,
    }),
    renderToolButton({
      key: 'code-block',
      label: tools.labels.codeBlock,
      hint: tools.labels.codeBlockHint,
      onPress: () => tools.onMarkdown('code-block'),
      children: <AppIcon name="code" color={colors.textSecondary} size={16} />,
    }),
  ]

  const moreTools = [
    renderToolButton({
      key: 'copy-all',
      label: tools.labels.copyAll,
      hint: tools.labels.copyAllHint,
      onPress: tools.onCopyAll,
      children: <AppIcon name="copy" color={colors.textSecondary} size={16} />,
    }),
    renderToolButton({
      key: 'clear-text',
      label: tools.labels.clearText,
      hint: tools.labels.clearTextHint,
      onPress: tools.onClearText,
      children: (
        <AppIcon
          name="delete"
          color={colors.ui.tone.danger.foreground}
          size={16}
        />
      ),
    }),
  ]

  return (
    <AnimatedView
      testID="message-input-surface"
      style={[
        styles.messageInputSurface,
        {
          borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
        },
        surfaceStyle,
        focusStyle,
      ]}
    >
      <AnimatedView
        pointerEvents={sizeMode === 'large' ? 'auto' : 'none'}
        style={[styles.longDraftHeader, headerStyle]}
      >
        <Text
          numberOfLines={1}
          style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800' }}
        >
          {tools.labels.characterCount}
        </Text>
      </AnimatedView>
      <AnimatedTextInput
        {...inputProps}
        ref={inputRef}
        testID="message-input"
        value={value}
        selection={selection}
        onSelectionChange={(event) =>
          onSelectionChange(event.nativeEvent.selection)
        }
        onChangeText={onChangeText}
        multiline={multiline}
        scrollEnabled={scrollEnabled}
        editable={editable}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={accessibilityState}
        accessibilityValue={accessibilityValue}
        returnKeyType={multiline ? 'default' : 'send'}
        submitBehavior={submitBehavior}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={colors.ui.input.placeholderForeground}
        onContentSizeChange={onContentSizeChange}
        onFocus={onFocus}
        onBlur={onBlur}
        style={[
          styles.messageInput,
          {
            color: colors.text,
            paddingTop: paddingVertical,
            paddingBottom: paddingVertical,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          bodyStyle,
        ]}
      />
      <AnimatedView
        pointerEvents={
          sizeMode === 'review' && reviewExpandVisible ? 'auto' : 'none'
        }
        style={[styles.reviewExpandRow, reviewStyle]}
      >
        <IslePressable
          testID="composer-expand-draft"
          onPressIn={() => inputRef.current?.focus()}
          onPress={tools.onExpand}
          accessibilityRole="button"
          accessibilityLabel={tools.labels.expand}
          accessibilityHint={tools.labels.expandHint}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          style={styles.reviewExpandButton}
        >
          <AppIcon
            name="arrow-up"
            color={colors.textSecondary}
            size={15}
            strokeWidth={appIconStroke.strong}
          />
          <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '800' }}>
            {tools.labels.expand}
          </Text>
        </IslePressable>
      </AnimatedView>
      <AnimatedView
        testID="composer-long-draft-toolbar"
        pointerEvents={sizeMode === 'large' ? 'auto' : 'none'}
        style={[
          styles.longDraftToolbar,
          { paddingBottom: toolbarBottomPadding },
          toolbarStyle,
        ]}
      >
        {renderToolButton({
          key: 'collapse',
          label: tools.labels.collapse,
          hint: tools.labels.collapseHint,
          onPress: tools.onCollapse,
          children: (
            <AppIcon name="collapse" color={colors.textSecondary} size={16} />
          ),
        })}
        <View style={styles.toolTrackFrame}>
          <ScrollView
            testID="composer-tool-track"
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.toolTrackContent}
          >
            {toolMode === 'formatting' ? formattingTools : moreTools}
          </ScrollView>
          <View pointerEvents="none" style={[styles.toolEdgeHint, { left: 0 }]} />
          <View pointerEvents="none" style={[styles.toolEdgeHint, { right: 0 }]} />
        </View>
        {renderToolButton({
          key: toolMode === 'formatting' ? 'more' : 'back',
          label:
            toolMode === 'formatting' ? tools.labels.more : tools.labels.back,
          hint:
            toolMode === 'formatting'
              ? tools.labels.moreHint
              : tools.labels.backHint,
          onPress: () =>
            setToolMode((current) =>
              current === 'formatting' ? 'more' : 'formatting'
            ),
          children: (
            <AppIcon
              name={toolMode === 'formatting' ? 'more' : 'back-previous'}
              color={colors.textSecondary}
              size={16}
            />
          ),
        })}
      </AnimatedView>
    </AnimatedView>
  )
}

export function SendButton({
  visible,
  canSend,
  sending,
  streaming,
  hasSendableDraft,
  activityState,
  motion,
  onSend,
  onStop,
  colors,
  accessibilityLabel,
  accessibilityHint,
}: {
  visible: boolean
  canSend: boolean
  sending: boolean
  streaming: boolean
  hasSendableDraft: boolean
  activityState: ComposerActivityState
  motion: MotionIntensity
  onSend: () => void
  onStop?: () => void
  colors: ThemeColors
  accessibilityLabel: string
  accessibilityHint: string
}) {
  const state = sending ? 'sending' : streaming && !hasSendableDraft ? 'stop' : canSend ? 'send' : 'disabled'
  const transition = useSharedValue(1)
  const sizeProgress = useSharedValue(activityState === 'idle' ? 0 : 1)
  const stateColorProgress = useSharedValue(
    state === 'disabled' ? 0 : state === 'stop' ? 2 : 1,
  )
  const stateDuration = motion === 'full' ? 160 : motion === 'reduced' ? 40 : 0

  useEffect(() => {
    transition.value = 0
    transition.value = withTiming(1, {
      duration: stateDuration,
      easing: Easing.out(Easing.cubic),
    })
    stateColorProgress.value = withTiming(
      state === 'disabled' ? 0 : state === 'stop' ? 2 : 1,
      {
        duration: stateDuration,
        easing: Easing.inOut(Easing.cubic),
      },
    )
  }, [state, stateColorProgress, stateDuration, transition])

  useEffect(() => {
    sizeProgress.value = withTiming(activityState === 'idle' ? 0 : 1, {
      duration: geometryDuration(motion),
      easing: Easing.inOut(Easing.cubic),
    })
  }, [activityState, motion, sizeProgress])

  const transitionStyle = useAnimatedStyle(() => ({
    opacity: transition.value,
    transform: [{ scale: 0.94 + transition.value * 0.06 }],
  }))
  const sizeStyle = useAnimatedStyle(() => {
    const size = 40 + sizeProgress.value * 4
    return {
      width: size,
      minWidth: size,
      height: size,
      borderRadius: 20 + sizeProgress.value * 2,
      backgroundColor: interpolateColor(
        stateColorProgress.value,
        [0, 1, 2],
        [
          colors.ui.control.disabledBackground,
          colors.ui.control.primaryBackground,
          colors.ui.tone.danger.background,
        ],
      ),
    }
  })

  if (!visible) return null

  const stopMode = state === 'stop'
  const enabled = stopMode || canSend
  return (
    <AnimatedView
      style={[
        styles.independentSurface,
        {
          borderRadius: 22,
          shadowColor: colors.shadowTint,
          shadowOpacity: 0.08,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 5 },
          elevation: 1,
        },
        sizeStyle,
      ]}
    >
      <IslePressable
        testID="send-button"
        haptic
        disabled={!enabled}
        onPress={() => {
          if (stopMode && onStop) {
            onStop()
            return
          }
          onSend()
        }}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: !enabled, busy: sending }}
        hitSlop={{ top: 12, right: 10, bottom: 12, left: 10 }}
        style={{
          flex: 1,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
          borderWidth: enabled ? 0 : colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
          borderColor: enabled ? 'transparent' : colors.ui.control.disabledBorder,
        }}
      >
        <AnimatedView style={transitionStyle}>
          {state === 'sending' ? (
            <HighFrameSpinner color={colors.ui.control.primaryForeground} size={16} />
          ) : state === 'stop' ? (
            <AppIcon name="stop" color={colors.ui.tone.danger.foreground} size={16} strokeWidth={appIconStroke.bold} fill={colors.ui.tone.danger.foreground} />
          ) : (
            <AppIcon name="send" color={canSend ? colors.ui.control.primaryForeground : colors.ui.control.disabledForeground} size={18} strokeWidth={appIconStroke.bold} />
          )}
        </AnimatedView>
      </IslePressable>
    </AnimatedView>
  )
}

export interface ModelMenuItem {
  id: string
  providerId: string
  providerLabel: string
  model: string
  modelLabel: string
  brand: ProviderBrand
}

export function ModelMenu({
  visible,
  anchor,
  items,
  selectedId,
  colors,
  motion,
  onSelect,
  onOpenConfiguration,
  onClose,
}: {
  visible: boolean
  anchor: { x: number; y: number; width: number; height: number } | null
  items: ModelMenuItem[]
  selectedId?: string
  colors: ThemeColors
  motion: MotionIntensity
  onSelect: (item: ModelMenuItem) => void
  onOpenConfiguration: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const [mounted, setMounted] = useState(visible)
  const estimatedMenuHeight = 58 + Math.min(items.length, 4) * 60 + 60
  const progress = useSharedValue(visible ? 1 : 0)

  const placement = useMemo(() => resolveModelMenuPlacement({
    anchor,
    windowWidth,
    windowHeight,
    estimatedMenuHeight,
  }), [anchor, estimatedMenuHeight, windowHeight, windowWidth])

  const placementStyle = placement.top === undefined
    ? { left: placement.left, bottom: placement.bottom, width: placement.width }
    : { left: placement.left, top: placement.top, width: placement.width }

  useEffect(() => {
    if (visible) {
      setMounted(true)
      progress.value = withTiming(1, {
        ...MOTION_CONFIG,
        duration: geometryDuration(motion),
      })
      return
    }
    progress.value = withTiming(0, {
      ...MOTION_CONFIG,
      duration: geometryDuration(motion),
    }, (finished) => {
      if (finished) runOnJS(setMounted)(false)
    })
  }, [motion, progress, visible])

  useEffect(() => {
    if (Platform.OS !== 'web' || !mounted) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mounted, onClose])

  const menuMotionStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * 10 },
      { scale: 0.98 + progress.value * 0.02 },
    ],
  }))

  if (!mounted) return null

  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.menuRoot} accessibilityViewIsModal>
        <Pressable
          accessible={false}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop, opacity: 0.18 }]}
        />
        <AnimatedView
          testID="model-menu"
          style={[
            styles.modelMenu,
            placementStyle,
            {
              backgroundColor: colors.ui.semantic.surface.raised,
              borderColor: colors.ui.semantic.chrome.border,
            },
            menuMotionStyle,
          ]}
        >
          <View style={styles.modelMenuHeader}>
            <View style={styles.modelMenuTitleRow}>
              <ProviderBrandIcon brand={selectedId ? (items.find((item) => item.id === selectedId)?.brand ?? 'generic') : 'generic'} size={17} />
              <Text style={{ flex: 1, color: colors.textSecondary, fontSize: 10, fontWeight: '900', letterSpacing: 0.3, textTransform: 'uppercase' }}>{t('chat.model')}</Text>
              <IslePressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t('dialog.closeLayer')}
                style={styles.menuIconButton}
              >
                <AppIcon name="close" color={colors.textSecondary} size={14} strokeWidth={appIconStroke.strong} />
              </IslePressable>
            </View>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: Math.min(280, windowHeight * 0.42) }}
            contentContainerStyle={{ padding: 8, gap: 6 }}
          >
            {items.length ? items.map((item) => {
              const active = item.id === selectedId
              return (
                <IslePressable
                  key={item.id}
                  haptic
                  onPress={() => {
                    onSelect(item)
                    onClose()
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.providerLabel} · ${item.modelLabel}`}
                  accessibilityState={{ selected: active }}
                  style={{
                    minHeight: 48,
                    paddingHorizontal: 11,
                    borderRadius: colors.ui.radius.field,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 9,
                    backgroundColor: active ? colors.ui.actionBar.itemActiveBackground : colors.ui.semantic.surface.muted,
                    borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
                    borderColor: active ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border,
                  }}
                >
                  <View style={{ width: 26, height: 26, borderRadius: colors.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.ui.icon.accentBackground : colors.ui.semantic.surface.base }}>
                    <ProviderBrandIcon brand={item.brand} size={16} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: active ? colors.text : colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{item.modelLabel}</Text>
                    <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '700', marginTop: 1 }}>{item.providerLabel}</Text>
                  </View>
                  <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: active ? colors.ui.control.primaryBackground : colors.ui.semantic.chrome.border, alignItems: 'center', justifyContent: 'center' }}>
                    {active ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ui.control.primaryBackground }} /> : null}
                  </View>
                </IslePressable>
              )
            }) : (
              <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '700', padding: 10 }}>{t('chat.noAvailableModels')}</Text>
            )}
            <IslePressable
              haptic
              onPress={() => {
                onClose()
                onOpenConfiguration()
              }}
              accessibilityRole="button"
              accessibilityLabel={t('chat.aiConfiguration')}
              style={{ minHeight: 44, borderRadius: colors.ui.radius.controlLarge, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.control.primaryBackground, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.control.primaryBorder }}
            >
              <AppIcon name="settings-sliders" color={colors.ui.control.primaryForeground} size={15} strokeWidth={appIconStroke.strong} />
              <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 11, fontWeight: '900' }}>{t('chat.aiConfiguration')}</Text>
            </IslePressable>
          </ScrollView>
        </AnimatedView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
  },
  overlaySurface: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  independentSurface: {
    flexShrink: 0,
  },
  messageInputSurface: {
    flex: 1,
    minWidth: 0,
    marginHorizontal: 0,
    borderRadius: 22,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  messageInput: {
    width: '100%',
    flexGrow: 0,
    flexShrink: 0,
    fontSize: 15,
    lineHeight: 22,
    includeFontPadding: false,
    paddingHorizontal: 16,
  },
  longDraftHeader: {
    flexShrink: 0,
    overflow: 'hidden',
    paddingHorizontal: 16,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  reviewExpandRow: {
    flexShrink: 0,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewExpandButton: {
    minWidth: 112,
    height: 36,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  longDraftToolbar: {
    flexShrink: 0,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 2,
  },
  toolTrackFrame: {
    flex: 1,
    minWidth: 0,
    height: 40,
    position: 'relative',
  },
  toolTrackContent: {
    minHeight: 40,
    alignItems: 'center',
  },
  toolEdgeHint: {
    position: 'absolute',
    top: 8,
    bottom: 8,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(127, 127, 127, 0.28)',
  },
  menuRoot: {
    flex: 1,
  },
  modelMenu: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  modelMenuHeader: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modelMenuTitleRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  menuIconButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
