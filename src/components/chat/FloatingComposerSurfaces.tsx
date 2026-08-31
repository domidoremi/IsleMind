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
  type ViewStyle,
} from 'react-native'
import { useTranslation } from 'react-i18next'

import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { ProviderBrandIcon, type ProviderBrand } from '@/components/ui/ProviderBrandIcon'
import { HighFrameSpinner } from '@/components/ui/HighFrameSpinner'
import { IslePressable } from '@/components/ui/isle'
import { ThemeModelSelectorExpression } from '@/components/ui/isle/ThemeModelSelectorExpression'
import type { MotionIntensity } from '@/hooks/useMotionPreference'
import type { useAppTheme } from '@/hooks/useAppTheme'
import { resolveThemeComponentExpression } from '@/theme/themeExpression'
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

export function ComposerOverlay({
  viewportWidth,
  horizontalPadding,
  readingColumnMaxWidth,
  keyboardLift,
  keyboardMotion,
  motion,
  onLayout,
  children,
}: {
  viewportWidth: number
  horizontalPadding: number
  readingColumnMaxWidth?: number
  keyboardLift: number
  keyboardMotion: ComposerKeyboardMotion
  motion: MotionIntensity
  onLayout?: (event: LayoutChangeEvent) => void
  children: ReactNode
}) {
  const targetWidth = resolveFloatingComposerWidth({
    viewportWidth,
    horizontalPadding,
    readingColumnMaxWidth,
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
  isDark,
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
  isDark: boolean
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
  return (
    <ThemeModelSelectorExpression
      family={family}
      colors={colors}
      expression={resolveThemeComponentExpression(family, 'modelSelector')}
      testID={testID}
      label={label}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      maxWidth={maxWidth}
      selected={selected || expanded}
      iconOnly={iconOnly}
      ellipsizeMode={ellipsizeMode}
      icon={icon}
      onPress={onPress}
    />
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
  const family = colors.design?.family ?? 'minimal'
  const minimal = family === 'minimal'
  const monet = family === 'monet'
  const material = family === 'material'
  const glass = family === 'liquid-glass'
  const [toolMode, setToolMode] = useState<'formatting' | 'more'>('formatting')
  const animatedSurfaceHeight = useSharedValue(surfaceHeight)
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
  }, [animatedSurfaceHeight, duration, surfaceHeight])

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
  const singleLineInput = !value.includes('\n') && sizeMode !== 'large' && bodyHeight <= 56

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
        minimal ? styles.messageInputMinimal : null,
        monet ? styles.messageInputMonet : null,
        material ? styles.messageInputMaterial : null,
        glass ? styles.messageInputGlass : null,
        {
          borderWidth: minimal ? 0 : colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
          shadowOpacity: glass ? 0.05 : 0,
          shadowRadius: glass ? 8 : 0,
          shadowOffset: { width: 0, height: glass ? 3 : 0 },
          elevation: glass ? 1 : 0,
        },
        surfaceStyle,
        focusStyle,
      ]}
    >
      {minimal ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.minimalInputBaseline, { backgroundColor: focused ? colors.ui.input.focus : colors.ui.input.border }]} />
      ) : null}
      {monet ? (
        <>
          <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetInputWash, { backgroundColor: colors.ui.icon.accentBackground }]} />
          <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetInputBrush, { backgroundColor: colors.primary }]} />
        </>
      ) : null}
      {material ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.materialInputStateLayer, { backgroundColor: colors.primary, opacity: focused ? 0.09 : 0.035 }]} />
      ) : null}
      {glass ? (
        <>
          <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.glassInputReadingPlane, { borderColor: colors.ui.actionBar.itemBorder }]} />
          <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.glassInputHighlight, { backgroundColor: colors.ui.control.primaryForeground }]} />
        </>
      ) : null}
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
      <TextInput
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
            height: bodyHeight,
            color: colors.text,
            paddingTop: singleLineInput ? 0 : paddingVertical,
            paddingBottom: singleLineInput ? 0 : paddingVertical,
            textAlignVertical: singleLineInput ? 'center' : 'top',
          },
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
  const family = colors.design?.family ?? 'minimal'
  const minimal = family === 'minimal'
  const material = family === 'material'
  const glass = family === 'liquid-glass'
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
      borderRadius: minimal ? 4 : 20 + sizeProgress.value * 2,
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
          borderRadius: minimal ? 4 : 22,
          shadowColor: colors.shadowTint,
          shadowOpacity: glass ? 0.06 : material ? 0.03 : 0,
          shadowRadius: glass || material ? 7 : 0,
          shadowOffset: { width: 0, height: glass || material ? 3 : 0 },
          elevation: glass || material ? 1 : 0,
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
          borderRadius: minimal ? 4 : 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
          borderWidth: enabled ? 0 : minimal ? StyleSheet.hairlineWidth : colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
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
  isDark,
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
  isDark: boolean
  motion: MotionIntensity
  onSelect: (item: ModelMenuItem) => void
  onOpenConfiguration: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const family = colors.design?.family ?? 'minimal'
  const minimal = family === 'minimal'
  const material = family === 'material'
  const glass = family === 'liquid-glass'
  const menuBackdropStyle = glass && Platform.OS === 'web'
    ? ({ backdropFilter: 'blur(16px) saturate(1.12)' } as unknown as ViewStyle)
    : null
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
            minimal ? styles.modelMenuMinimal : null,
            family === 'monet' ? styles.modelMenuMonet : null,
            material ? styles.modelMenuMaterial : null,
            glass ? styles.modelMenuGlass : null,
            placementStyle,
            {
              backgroundColor: minimal ? colors.ui.semantic.surface.base : glass ? colors.ui.semantic.surface.overlay : material ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base,
              borderColor: colors.ui.semantic.chrome.border,
              borderWidth: glass ? 1 : StyleSheet.hairlineWidth,
              borderRadius: minimal ? 4 : glass ? 16 : material ? 12 : 10,
              shadowOpacity: glass ? 0.07 : material ? 0.04 : 0,
              shadowRadius: glass || material ? 10 : 0,
              shadowOffset: { width: 0, height: glass || material ? 3 : 0 },
              elevation: glass || material ? 2 : 0,
            },
            menuBackdropStyle,
            menuMotionStyle,
          ]}
        >
          <ModelMenuHeader
            family={family}
            colors={colors}
            isDark={isDark}
            brand={selectedId ? (items.find((item) => item.id === selectedId)?.brand ?? 'generic') : 'generic'}
            title={t('chat.model')}
            closeLabel={t('dialog.closeLayer')}
            onClose={onClose}
          />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: Math.min(280, windowHeight * 0.42) }}
            contentContainerStyle={[
              styles.modelMenuContent,
              family === 'monet' ? styles.modelMenuContentMonet : null,
              minimal ? styles.modelMenuContentMinimal : null,
            ]}
          >
            {items.length ? items.map((item, index) => (
              <ModelMenuRow
                key={item.id}
                family={family}
                colors={colors}
                item={item}
                index={index}
                active={item.id === selectedId}
                isDark={isDark}
                onPress={() => {
                  onSelect(item)
                  onClose()
                }}
              />
            )) : (
              <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '700', padding: 10 }}>{t('chat.noAvailableModels')}</Text>
            )}
            <ModelMenuConfigurationAction
              family={family}
              colors={colors}
              label={t('chat.aiConfiguration')}
              onPress={() => {
                onClose()
                onOpenConfiguration()
              }}
            />
          </ScrollView>
        </AnimatedView>
      </View>
    </Modal>
  )
}

function ModelMenuHeader({
  family,
  colors,
  isDark,
  brand,
  title,
  closeLabel,
  onClose,
}: {
  family: CanonicalThemeId
  colors: ThemeColors
  isDark: boolean
  brand: ProviderBrand
  title: string
  closeLabel: string
  onClose: () => void
}) {
  const close = (
    <IslePressable onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} style={styles.menuIconButton}>
      <AppIcon name="close" color={colors.textSecondary} size={14} strokeWidth={appIconStroke.strong} />
    </IslePressable>
  )
  const brandIcon = <ProviderBrandIcon brand={brand} size={17} variant={isDark ? 'onDark' : 'onLight'} />

  if (family === 'minimal') {
    return (
      <View testID="model-menu-header-minimal" style={[styles.modelMenuHeader, styles.modelMenuHeaderMinimal, { borderBottomColor: colors.ui.semantic.chrome.border }]}>
        <View style={[styles.minimalMenuIndex, { borderLeftColor: colors.ui.control.primaryBorder }]} />
        {brandIcon}
        <Text style={[styles.minimalMenuTitle, { color: colors.text }]}>{title}</Text>
        {close}
      </View>
    )
  }

  if (family === 'monet') {
    return (
      <View testID="model-menu-header-monet" style={[styles.modelMenuHeader, styles.modelMenuHeaderMonet]}>
        <View pointerEvents="none" style={[styles.monetMenuHeaderWash, { backgroundColor: colors.ui.icon.accentBackground }]} />
        {brandIcon}
        <View style={styles.monetMenuTitleBlock}>
          <Text style={[styles.monetMenuTitle, { color: colors.text }]}>{title}</Text>
          <View style={styles.monetMenuBrushRow}>
            <View style={[styles.monetMenuBrushLong, { backgroundColor: colors.primary }]} />
            <View style={[styles.monetMenuBrushShort, { backgroundColor: colors.accent }]} />
          </View>
        </View>
        {close}
      </View>
    )
  }

  if (family === 'material') {
    return (
      <View testID="model-menu-header-material" style={[styles.modelMenuHeader, styles.modelMenuHeaderMaterial, { borderBottomColor: colors.ui.section.divider }]}>
        <View style={[styles.materialMenuLeading, { backgroundColor: colors.ui.icon.accentBackground }]}>{brandIcon}</View>
        <Text style={[styles.materialMenuTitle, { color: colors.text }]}>{title}</Text>
        <View style={[styles.materialMenuCloseState, { backgroundColor: colors.ui.actionBar.itemBackground }]}>{close}</View>
      </View>
    )
  }

  return (
    <View testID="model-menu-header-liquid-glass" style={[styles.modelMenuHeader, styles.modelMenuHeaderGlass, { backgroundColor: colors.ui.semantic.chrome.background, borderColor: colors.ui.actionBar.itemBorder }]}>
      <View pointerEvents="none" style={[styles.glassMenuHighlight, { backgroundColor: colors.ui.control.primaryForeground }]} />
      <View style={[styles.glassMenuLeadingLens, { backgroundColor: colors.ui.semantic.surface.base }]}>{brandIcon}</View>
      <Text style={[styles.glassMenuTitle, { color: colors.text }]}>{title}</Text>
      {close}
    </View>
  )
}

function ModelMenuRow({
  family,
  colors,
  item,
  index,
  active,
  isDark,
  onPress,
}: {
  family: CanonicalThemeId
  colors: ThemeColors
  item: ModelMenuItem
  index: number
  active: boolean
  isDark: boolean
  onPress: () => void
}) {
  const label = `${item.providerLabel} · ${item.modelLabel}`
  const brandIcon = <ProviderBrandIcon brand={item.brand} size={16} variant={isDark ? 'onDark' : 'onLight'} />

  if (family === 'minimal') {
    return (
      <IslePressable haptic onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} style={[styles.menuRowMinimal, { borderBottomColor: colors.ui.semantic.chrome.border }]}>
        <Text style={[styles.minimalMenuRowIndex, { color: active ? colors.ui.icon.accentForeground : colors.textTertiary }]}>{String(index + 1).padStart(2, '0')}</Text>
        <View style={[styles.minimalMenuRowRule, { backgroundColor: active ? colors.ui.control.primaryBackground : colors.ui.semantic.chrome.border }]} />
        <View style={styles.modelMenuCopy}>
          <Text numberOfLines={1} style={[styles.minimalMenuRowTitle, { color: active ? colors.text : colors.textSecondary }]}>{item.modelLabel}</Text>
          <Text numberOfLines={1} style={[styles.modelMenuProvider, { color: colors.textTertiary }]}>{item.providerLabel}</Text>
        </View>
        {active ? <AppIcon name="check" color={colors.ui.icon.accentForeground} size={15} strokeWidth={appIconStroke.bold} /> : brandIcon}
      </IslePressable>
    )
  }

  if (family === 'monet') {
    return (
      <IslePressable haptic onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} style={[styles.menuRowMonet, index % 2 ? styles.menuRowMonetEven : styles.menuRowMonetOdd, { backgroundColor: active ? colors.ui.actionBar.itemActiveBackground : colors.ui.semantic.surface.base, borderColor: active ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border }]}>
        <View pointerEvents="none" style={[styles.monetMenuRowWash, { backgroundColor: active ? colors.primary : colors.ui.icon.accentBackground }]} />
        <View style={styles.monetMenuBrand}>{brandIcon}</View>
        <View style={styles.modelMenuCopy}>
          <Text numberOfLines={1} style={[styles.monetMenuRowTitle, { color: colors.text }]}>{item.modelLabel}</Text>
          <Text numberOfLines={1} style={[styles.modelMenuProvider, { color: colors.textSecondary }]}>{item.providerLabel}</Text>
        </View>
        <View style={[styles.monetMenuSelectionBrush, { backgroundColor: active ? colors.primary : colors.ui.semantic.chrome.border }]} />
      </IslePressable>
    )
  }

  if (family === 'material') {
    return (
      <IslePressable haptic onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} style={[styles.menuRowMaterial, { backgroundColor: active ? colors.ui.actionBar.itemActiveBackground : 'transparent' }]}>
        <View style={[styles.materialMenuRowIcon, { backgroundColor: active ? colors.ui.icon.accentBackground : colors.ui.semantic.surface.base }]}>{brandIcon}</View>
        <View style={styles.modelMenuCopy}>
          <Text numberOfLines={1} style={[styles.materialMenuRowTitle, { color: colors.text }]}>{item.modelLabel}</Text>
          <Text numberOfLines={1} style={[styles.modelMenuProvider, { color: colors.textSecondary }]}>{item.providerLabel}</Text>
        </View>
        {active ? <AppIcon name="check" color={colors.ui.control.primaryBackground} size={18} strokeWidth={appIconStroke.bold} /> : null}
      </IslePressable>
    )
  }

  return (
    <IslePressable haptic onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} style={[styles.menuRowGlass, { backgroundColor: active ? colors.ui.actionBar.itemActiveBackground : colors.ui.semantic.chrome.background, borderColor: active ? colors.ui.control.primaryBorder : colors.ui.actionBar.itemBorder }]}>
      <View pointerEvents="none" style={[styles.glassMenuRowHighlight, { backgroundColor: colors.ui.control.primaryForeground }]} />
      <View style={[styles.glassMenuRowLens, { backgroundColor: colors.ui.semantic.surface.base }]}>{brandIcon}</View>
      <View style={styles.modelMenuCopy}>
        <Text numberOfLines={1} style={[styles.glassMenuRowTitle, { color: colors.text }]}>{item.modelLabel}</Text>
        <Text numberOfLines={1} style={[styles.modelMenuProvider, { color: colors.textSecondary }]}>{item.providerLabel}</Text>
      </View>
      <View style={[styles.glassMenuRadio, { borderColor: active ? colors.ui.control.primaryBorder : colors.ui.actionBar.itemBorder }]}>
        {active ? <View style={[styles.glassMenuRadioDot, { backgroundColor: colors.ui.control.primaryBackground }]} /> : null}
      </View>
    </IslePressable>
  )
}

function ModelMenuConfigurationAction({ family, colors, label, onPress }: { family: CanonicalThemeId; colors: ThemeColors; label: string; onPress: () => void }) {
  return (
    <IslePressable
      haptic
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.modelMenuConfiguration,
        family === 'minimal' ? styles.modelMenuConfigurationMinimal : null,
        family === 'monet' ? styles.modelMenuConfigurationMonet : null,
        family === 'material' ? styles.modelMenuConfigurationMaterial : null,
        family === 'liquid-glass' ? styles.modelMenuConfigurationGlass : null,
        {
          backgroundColor: family === 'minimal' ? 'transparent' : colors.ui.control.primaryBackground,
          borderColor: family === 'minimal' ? colors.ui.semantic.chrome.border : colors.ui.control.primaryBorder,
        },
      ]}
    >
      <AppIcon name="settings-sliders" color={family === 'minimal' ? colors.textSecondary : colors.ui.control.primaryForeground} size={15} strokeWidth={appIconStroke.strong} />
      <Text style={[styles.modelMenuConfigurationText, { color: family === 'minimal' ? colors.text : colors.ui.control.primaryForeground }]}>{label}</Text>
      {family === 'minimal' ? <AppIcon name="arrow-right" color={colors.textTertiary} size={14} /> : null}
    </IslePressable>
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
    // The dock is flat, so the field needs no lift of its own; the field's own
    // fill and focus outline carry the affordance.
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  messageInputMinimal: {
    borderRadius: 0,
    backgroundColor: 'transparent',
    overflow: 'visible',
  },
  messageInputMonet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 9,
    borderBottomRightRadius: 20,
    borderBottomLeftRadius: 12,
  },
  messageInputMaterial: {
    borderRadius: 12,
  },
  messageInputGlass: {
    borderRadius: 20,
  },
  minimalInputBaseline: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    left: 4,
    height: StyleSheet.hairlineWidth,
  },
  monetInputWash: {
    position: 'absolute',
    top: -12,
    right: -18,
    width: 86,
    height: 54,
    borderBottomLeftRadius: 48,
    opacity: 0.18,
  },
  monetInputBrush: {
    position: 'absolute',
    top: 9,
    bottom: 9,
    left: 3,
    width: 3,
    borderRadius: 2,
    opacity: 0.46,
  },
  materialInputStateLayer: {
    ...StyleSheet.absoluteFill,
  },
  glassInputReadingPlane: {
    position: 'absolute',
    top: 3,
    right: 3,
    bottom: 3,
    left: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 17,
    opacity: 0.42,
  },
  glassInputHighlight: {
    position: 'absolute',
    top: 3,
    right: 18,
    left: 18,
    height: StyleSheet.hairlineWidth,
    opacity: 0.48,
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
  modelMenuMinimal: { borderRadius: 2 },
  modelMenuMonet: { borderTopLeftRadius: 20, borderTopRightRadius: 10, borderBottomRightRadius: 26, borderBottomLeftRadius: 14 },
  modelMenuMaterial: { borderRadius: 12 },
  modelMenuGlass: { borderRadius: 24 },
  modelMenuContent: { padding: 8, gap: 6 },
  modelMenuContentMinimal: { paddingTop: 2, gap: 0 },
  modelMenuContentMonet: { paddingHorizontal: 10, gap: 8 },
  modelMenuHeader: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modelMenuHeaderMinimal: { minHeight: 44, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 8 },
  modelMenuHeaderMonet: { minHeight: 54, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 9, overflow: 'hidden', borderBottomWidth: 0 },
  modelMenuHeaderMaterial: { minHeight: 56, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 10 },
  modelMenuHeaderGlass: { minHeight: 50, margin: 5, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 19, overflow: 'hidden' },
  modelMenuTitleRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  minimalMenuIndex: { width: 8, height: 22, borderLeftWidth: 2 },
  minimalMenuTitle: { flex: 1, fontSize: 11, lineHeight: 15, fontWeight: '800', textTransform: 'uppercase' },
  monetMenuHeaderWash: { position: 'absolute', top: -24, right: -18, width: 120, height: 74, borderBottomLeftRadius: 64, opacity: 0.24 },
  monetMenuTitleBlock: { flex: 1, minWidth: 0 },
  monetMenuTitle: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  monetMenuBrushRow: { width: 84, height: 3, marginTop: 3, flexDirection: 'row', gap: 4 },
  monetMenuBrushLong: { flex: 1, borderRadius: 2 },
  monetMenuBrushShort: { width: 20, borderRadius: 2 },
  materialMenuLeading: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  materialMenuTitle: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  materialMenuCloseState: { borderRadius: 20 },
  glassMenuHighlight: { position: 'absolute', top: 1, right: 18, left: 18, height: StyleSheet.hairlineWidth, opacity: 0.5 },
  glassMenuLeadingLens: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  glassMenuTitle: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  modelMenuCopy: { flex: 1, minWidth: 0 },
  modelMenuProvider: { marginTop: 1, fontSize: 10, lineHeight: 13, fontWeight: '600' },
  menuRowMinimal: { minHeight: 52, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  minimalMenuRowIndex: { width: 22, fontSize: 9, lineHeight: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  minimalMenuRowRule: { width: 2, alignSelf: 'stretch', marginVertical: 9 },
  minimalMenuRowTitle: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  menuRowMonet: { minHeight: 52, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  menuRowMonetOdd: { marginRight: 7, borderTopLeftRadius: 15, borderTopRightRadius: 8, borderBottomRightRadius: 17, borderBottomLeftRadius: 10 },
  menuRowMonetEven: { marginLeft: 7, borderTopLeftRadius: 9, borderTopRightRadius: 16, borderBottomRightRadius: 10, borderBottomLeftRadius: 18 },
  monetMenuRowWash: { position: 'absolute', top: -18, right: -14, width: 76, height: 54, borderBottomLeftRadius: 48, opacity: 0.18 },
  monetMenuBrand: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  monetMenuRowTitle: { fontSize: 12.5, lineHeight: 17, fontWeight: '700' },
  monetMenuSelectionBrush: { width: 18, height: 4, borderRadius: 2, opacity: 0.7 },
  menuRowMaterial: { minHeight: 52, paddingHorizontal: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  materialMenuRowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  materialMenuRowTitle: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  menuRowGlass: { minHeight: 52, paddingHorizontal: 8, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 9, overflow: 'hidden' },
  glassMenuRowHighlight: { position: 'absolute', top: 1, right: 16, left: 16, height: StyleSheet.hairlineWidth, opacity: 0.42 },
  glassMenuRowLens: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  glassMenuRowTitle: { fontSize: 12.5, lineHeight: 17, fontWeight: '700' },
  glassMenuRadio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  glassMenuRadioDot: { width: 8, height: 8, borderRadius: 4 },
  modelMenuConfiguration: { minHeight: 46, marginTop: 2, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth },
  modelMenuConfigurationMinimal: { borderRadius: 0, borderRightWidth: 0, borderBottomWidth: 0, borderLeftWidth: 0 },
  modelMenuConfigurationMonet: { marginHorizontal: 4, borderTopLeftRadius: 14, borderTopRightRadius: 8, borderBottomRightRadius: 18, borderBottomLeftRadius: 10 },
  modelMenuConfigurationMaterial: { borderRadius: 23, justifyContent: 'center' },
  modelMenuConfigurationGlass: { borderRadius: 23, justifyContent: 'center' },
  modelMenuConfigurationText: { flex: 1, fontSize: 11, lineHeight: 15, fontWeight: '800' },
  menuIconButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
