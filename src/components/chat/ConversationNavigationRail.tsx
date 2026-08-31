import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type ViewStyle,
} from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'

import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import type { CanonicalThemeId } from '@/types/settingsContracts'

import {
  sampleAssistantNavigationIndices,
  type AssistantNavigationItem,
  type AssistantNavigationScrollOptions,
} from './messageListNavigation'

const CONVERSATION_NAVIGATION_RAIL_RIGHT = 8
const CONVERSATION_NAVIGATION_RAIL_WIDTH = 84
const CONVERSATION_NAVIGATION_MOBILE_BREAKPOINT = 720
const CONVERSATION_NAVIGATION_MOBILE_GUTTER = 12
const CONVERSATION_NAVIGATION_MOBILE_MAX_WIDTH = 292
const CONVERSATION_NAVIGATION_MARKER_LIMIT = 28

interface ConversationNavigationVisual {
  shellRadius: number
  shellPadding: number
  buttonRadius: number
  trackThickness: number
  trackRadius: number
  markerFrame: number
  activeMarkerWidth: number
  activeMarkerHeight: number
  inactiveMarkerSize: number
  inactiveOpacity: number
  shadowOpacity: number
  shadowRadius: number
  shadowOffsetY: number
}

export function ConversationNavigationRail({
  items,
  activeIndex,
  visible,
  topOffset,
  bottomOffset,
  jumping = false,
  onSelect,
  onDismiss,
  onInteractionStart,
  onInteractionEnd,
}: {
  items: AssistantNavigationItem[]
  activeIndex: number
  visible: boolean
  topOffset: number
  bottomOffset: number
  jumping?: boolean
  onSelect: (item: AssistantNavigationItem, options?: AssistantNavigationScrollOptions) => void
  /**
   * Compact presentation is user-dismissible so reading is never blocked.
   * Jumping to the latest message belongs to the contextual scroll utility,
   * which owns that action for the whole screen.
   */
  onDismiss?: () => void
  onInteractionStart: () => void
  onInteractionEnd: () => void
}) {
  const { width: windowWidth } = useWindowDimensions()
  const { canonicalThemeId, design } = useAppTheme()
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const compact = windowWidth < CONVERSATION_NAVIGATION_MOBILE_BREAKPOINT
  const navigationTokens = design.component.navigation
  const grammar = {
    minimal: 'precision',
    monet: 'organic',
    material: 'material',
    'liquid-glass': 'fluid',
  }[canonicalThemeId]
  const visual: ConversationNavigationVisual = grammar === 'precision'
    ? {
        shellRadius: design.semantic.radius.small,
        shellPadding: 4,
        buttonRadius: design.semantic.radius.small,
        trackThickness: 2,
        trackRadius: 1,
        markerFrame: compact ? 20 : 24,
        activeMarkerWidth: compact ? 16 : 18,
        activeMarkerHeight: compact ? 7 : 8,
        inactiveMarkerSize: 5,
        inactiveOpacity: 0.58,
        shadowOpacity: 0,
        shadowRadius: 0,
        shadowOffsetY: 0,
      }
    : grammar === 'organic'
      ? {
          shellRadius: design.semantic.radius.extraLarge,
          shellPadding: 6,
          buttonRadius: design.semantic.radius.pill,
          trackThickness: 6,
          trackRadius: 999,
          markerFrame: compact ? 22 : 26,
          activeMarkerWidth: compact ? 16 : 19,
          activeMarkerHeight: compact ? 10 : 15,
          inactiveMarkerSize: 6,
          inactiveOpacity: 0.52,
          shadowOpacity: design.semantic.elevation.shadowOpacity * 0.7,
          shadowRadius: design.semantic.elevation.shadowBlur,
          shadowOffsetY: design.semantic.elevation.shadowOffsetY,
        }
      : grammar === 'material'
        ? {
            shellRadius: design.semantic.radius.extraLarge,
            shellPadding: 6,
            buttonRadius: design.semantic.radius.medium,
            trackThickness: 5,
            trackRadius: 999,
            markerFrame: compact ? 22 : 26,
            activeMarkerWidth: compact ? 17 : 22,
            activeMarkerHeight: compact ? 10 : 14,
            inactiveMarkerSize: 5,
            inactiveOpacity: 0.62,
            shadowOpacity: design.semantic.elevation.shadowOpacity * 0.8,
            shadowRadius: design.semantic.elevation.shadowBlur,
            shadowOffsetY: design.semantic.elevation.shadowOffsetY,
          }
        : {
            shellRadius: design.semantic.radius.pill,
            shellPadding: 6,
            buttonRadius: design.semantic.radius.pill,
            trackThickness: 7,
            trackRadius: 999,
            markerFrame: compact ? 22 : 28,
            activeMarkerWidth: compact ? 17 : 20,
            activeMarkerHeight: compact ? 12 : 18,
            inactiveMarkerSize: 6,
            inactiveOpacity: 0.68,
            shadowOpacity: design.semantic.elevation.shadowOpacity,
            shadowRadius: design.semantic.elevation.shadowBlur,
            shadowOffsetY: design.semantic.elevation.shadowOffsetY,
          }

  const safeActiveIndex = Math.max(0, Math.min(items.length - 1, activeIndex >= 0 ? activeIndex : items.length - 1))
  const item = items[safeActiveIndex]
  const previousItem = safeActiveIndex > 0 ? items[safeActiveIndex - 1] : undefined
  const nextItem = safeActiveIndex < items.length - 1 ? items[safeActiveIndex + 1] : undefined
  const markerIndices = useMemo(
    () => sampleAssistantNavigationIndices(items.length, safeActiveIndex, CONVERSATION_NAVIGATION_MARKER_LIMIT),
    [items.length, safeActiveIndex],
  )
  const lastSelectedIndexRef = useRef(safeActiveIndex)
  const gestureSelectedIndexRef = useRef(safeActiveIndex)

  useEffect(() => {
    lastSelectedIndexRef.current = safeActiveIndex
    gestureSelectedIndexRef.current = safeActiveIndex
  }, [safeActiveIndex])

  const selectIndex = useCallback((nextIndex: number, options?: AssistantNavigationScrollOptions) => {
    if (!items.length) return
    const boundedIndex = Math.max(0, Math.min(items.length - 1, nextIndex))
    gestureSelectedIndexRef.current = boundedIndex
    if (boundedIndex === lastSelectedIndexRef.current && !options?.settle) return
    lastSelectedIndexRef.current = boundedIndex
    onSelect(items[boundedIndex], options)
  }, [items, onSelect])

  const selectAdjacent = useCallback((nextIndex: number) => {
    const boundedIndex = Math.max(0, Math.min(items.length - 1, nextIndex))
    if (boundedIndex === safeActiveIndex) return
    onInteractionStart()
    selectIndex(boundedIndex, { animated: true, settle: true })
    onInteractionEnd()
  }, [items.length, onInteractionEnd, onInteractionStart, safeActiveIndex, selectIndex])

  const trackLength = compact
    ? Math.max(68, Math.min(112, windowWidth - 232))
    : Math.max(116, Math.min(216, 48 + Math.max(0, items.length - 1) * 7))
  const trackCrossSize = compact ? 28 : 32
  const touchPadding = compact ? 8 : 10
  const markerTravelInset = visual.markerFrame / 2
  const markerTravelLength = Math.max(1, trackLength - markerTravelInset * 2)
  const progressRatio = items.length <= 1 ? 0.5 : safeActiveIndex / (items.length - 1)
  const progressPosition = markerTravelInset + progressRatio * markerTravelLength
  const glassStyle = navigationTokens.blur && Platform.OS === 'web'
    ? ({ backdropFilter: `blur(${Math.max(8, design.semantic.blur.radius)}px) saturate(1.12)` } as unknown as ViewStyle)
    : null

  const selectFromGesture = useCallback((event: GestureResponderEvent, options?: AssistantNavigationScrollOptions) => {
    if (items.length <= 1) return
    const coordinate = compact
      ? event.nativeEvent.locationX - touchPadding - markerTravelInset
      : event.nativeEvent.locationY - touchPadding - markerTravelInset
    const ratio = Math.max(0, Math.min(1, coordinate / markerTravelLength))
    selectIndex(Math.round(ratio * (items.length - 1)), options)
  }, [compact, items.length, markerTravelInset, markerTravelLength, selectIndex, touchPadding])

  const handleAccessibilityAction = useCallback((event: AccessibilityActionEvent) => {
    onInteractionStart()
    if (event.nativeEvent.actionName === 'increment') {
      selectIndex(safeActiveIndex + 1, { animated: true, settle: true })
    } else if (event.nativeEvent.actionName === 'decrement') {
      selectIndex(safeActiveIndex - 1, { animated: true, settle: true })
    }
    onInteractionEnd()
  }, [onInteractionEnd, onInteractionStart, safeActiveIndex, selectIndex])

  if (!item) return null

  const positionText = t('chat.conversationNavigationPosition', {
    current: item.assistantIndex,
    total: item.assistantCount,
  })
  const statusText = jumping
    ? t('chat.conversationNavigationJumping', { current: item.assistantIndex })
    : t('chat.paragraphCountShort', { count: item.paragraphCount })
  const accessibilityLabel = t('chat.conversationNavigationPositionAccessibilityLabel', {
    current: item.assistantIndex,
    total: item.assistantCount,
    paragraphs: item.paragraphCount,
  })
  const desktopShellWidth = grammar === 'precision' ? 54 : grammar === 'organic' ? 76 : grammar === 'material' ? 80 : 84
  const shellStyle: ViewStyle = {
    maxWidth: compact ? (grammar === 'precision' ? 276 : CONVERSATION_NAVIGATION_MOBILE_MAX_WIDTH) : undefined,
    width: compact ? undefined : desktopShellWidth,
    borderRadius: grammar === 'precision' ? 4 : grammar === 'organic' ? 20 : grammar === 'material' ? 18 : visual.shellRadius,
    padding: grammar === 'precision' ? (compact ? 3 : 0) : visual.shellPadding,
    backgroundColor: grammar === 'precision' && !compact ? 'transparent' : navigationTokens.background,
    borderWidth: grammar === 'fluid' || compact ? StyleSheet.hairlineWidth : 0,
    borderColor: navigationTokens.border,
    shadowColor: design.semantic.elevation.shadowColor,
    shadowOpacity: visual.shadowOpacity,
    shadowRadius: visual.shadowRadius,
    shadowOffset: { width: 0, height: visual.shadowOffsetY },
    elevation: visual.shadowOpacity ? design.semantic.elevation.level2 : 0,
    opacity: visible ? 1 : 0,
    transform: [{ translateY: visible ? 0 : 2 }],
  }

  const previousControl = (
    <NavigationButton
      icon="back-previous"
      label={t('chat.previousAssistantReply')}
      hint={t('chat.conversationNavigationPreviousHint')}
      disabled={!previousItem}
      radius={visual.buttonRadius}
      foreground={navigationTokens.foreground}
      onPress={() => selectAdjacent(safeActiveIndex - 1)}
      testID="chat-conversation-navigation-previous"
    />
  )
  const nextControl = (
    <NavigationButton
      icon="back-next"
      label={t('chat.nextAssistantReply')}
      hint={t('chat.conversationNavigationNextHint')}
      disabled={!nextItem}
      radius={visual.buttonRadius}
      foreground={navigationTokens.foreground}
      onPress={() => selectAdjacent(safeActiveIndex + 1)}
      testID="chat-conversation-navigation-next"
    />
  )
  const trackControl = (
    <NavigationTrack
      items={items}
      markerIndices={markerIndices}
      activeIndex={safeActiveIndex}
      jumping={jumping}
      compact={compact}
      trackLength={trackLength}
      trackCrossSize={trackCrossSize}
      touchPadding={touchPadding}
      markerTravelInset={markerTravelInset}
      markerTravelLength={markerTravelLength}
      progressPosition={progressPosition}
      visual={visual}
      markerTransitionDuration={motion === 'full' ? 120 : 1}
      trackColor={navigationTokens.border}
      activeTrackColor={navigationTokens.activeBackground}
      markerColor={navigationTokens.foreground}
      activeMarkerColor={navigationTokens.activeForeground}
      onAccessibilityAction={handleAccessibilityAction}
      onInteractionStart={onInteractionStart}
      onInteractionEnd={onInteractionEnd}
      onSelect={selectFromGesture}
      positionText={positionText}
      accessibilityLabel={accessibilityLabel}
      hint={t('chat.conversationNavigationTrackHint')}
    />
  )

  const dismissControl = compact && onDismiss ? (
    <NavigationButton
      icon="close"
      label={t('common.close')}
      hint={t('common.close')}
      disabled={false}
      radius={visual.buttonRadius}
      foreground={navigationTokens.foreground}
      onPress={onDismiss}
      testID="chat-conversation-navigation-dismiss"
    />
  ) : null

  return (
    <View
      pointerEvents={visible ? 'box-none' : 'none'}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={compact
        ? {
            position: 'absolute',
            right: CONVERSATION_NAVIGATION_MOBILE_GUTTER,
            bottom: Math.max(0, bottomOffset) + 8,
            maxWidth: Math.max(160, windowWidth - CONVERSATION_NAVIGATION_MOBILE_GUTTER * 2),
            alignItems: 'flex-end',
            zIndex: 34,
          }
        : {
            position: 'absolute',
            top: Math.max(0, topOffset),
            right: CONVERSATION_NAVIGATION_RAIL_RIGHT,
            bottom: Math.max(0, bottomOffset),
            width: CONVERSATION_NAVIGATION_RAIL_WIDTH,
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 34,
            elevation: 2,
          }}
    >
      <MotiView
        pointerEvents={visible ? 'auto' : 'none'}
        testID={`chat-conversation-navigation-${canonicalThemeId}`}
        animate={{ opacity: visible ? 1 : 0, translateY: visible ? 0 : 2 }}
        transition={{ type: 'timing', duration: motion === 'full' ? design.semantic.motion.interaction : 1 }}
        style={[shellStyle, glassStyle]}
      >
        <ConversationNavigationPresentation
          family={canonicalThemeId}
          compact={compact}
          showTitle={!compact}
          title={compact && jumping ? t('chat.conversationNavigationJumpingShort') : t('chat.conversationNavigation')}
          positionText={positionText}
          statusText={statusText}
          foreground={navigationTokens.foreground}
          activeForeground={navigationTokens.activeForeground}
          activeBackground={navigationTokens.activeBackground}
          border={navigationTokens.border}
          surface={navigationTokens.background}
          previousControl={previousControl}
          nextControl={nextControl}
          dismissControl={dismissControl}
          trackControl={trackControl}
        />
      </MotiView>
    </View>
  )
}

function ConversationNavigationPresentation({
  family,
  compact,
  showTitle,
  title,
  positionText,
  statusText,
  foreground,
  activeForeground,
  activeBackground,
  border,
  surface,
  previousControl,
  nextControl,
  dismissControl,
  trackControl,
}: {
  family: CanonicalThemeId
  compact: boolean
  showTitle: boolean
  title: string
  positionText: string
  statusText: string
  foreground: string
  activeForeground: string
  activeBackground: string
  border: string
  surface: string
  previousControl: ReactNode
  nextControl: ReactNode
  dismissControl: ReactNode
  trackControl: ReactNode
}) {
  if (family === 'minimal') {
    return (
      <View testID="conversation-navigation-presentation-minimal" style={compact ? styles.minimalNavigationCompact : styles.minimalNavigationRail}>
        <View pointerEvents="none" style={[compact ? styles.minimalNavigationBaseline : styles.minimalNavigationSpine, { backgroundColor: border }]} />
        {compact ? previousControl : null}
        <View style={compact ? styles.minimalNavigationCenterCompact : styles.minimalNavigationCenterRail}>
          <Text testID="chat-conversation-navigation-position" numberOfLines={1} accessibilityRole="text" style={[styles.minimalNavigationPosition, { color: activeForeground }]}>{positionText}</Text>
          {trackControl}
          {showTitle ? <Text numberOfLines={1} style={[styles.minimalNavigationStatus, { color: foreground }]}>{statusText}</Text> : null}
        </View>
        {compact ? nextControl : null}
        {compact ? dismissControl : null}
        {!compact ? <View style={styles.minimalNavigationRailActions}>{previousControl}{nextControl}</View> : null}
      </View>
    )
  }

  if (family === 'monet') {
    return (
      <View testID="conversation-navigation-presentation-monet" style={compact ? styles.monetNavigationCompact : styles.monetNavigationRail}>
        <View pointerEvents="none" style={[styles.monetNavigationWash, { backgroundColor: activeBackground }]} />
        {showTitle ? (
          <View style={styles.monetNavigationHeading}>
            <AppIcon name="conversation" color={foreground} size={14} strokeWidth={appIconStroke.regular} />
            <Text numberOfLines={1} style={[styles.monetNavigationTitle, { color: foreground }]}>{title}</Text>
            <Text testID="chat-conversation-navigation-position" numberOfLines={1} accessibilityRole="text" style={[styles.monetNavigationPosition, { color: activeForeground }]}>{positionText}</Text>
          </View>
        ) : null}
        <View style={compact ? styles.monetNavigationPathCompact : styles.monetNavigationPathRail}>
          {compact ? <Text testID="chat-conversation-navigation-position" numberOfLines={1} accessibilityRole="text" style={[styles.monetNavigationPosition, { color: activeForeground }]}>{positionText}</Text> : null}
          <View style={[styles.monetNavigationActionPetal, { backgroundColor: surface }]}>{previousControl}</View>
          {trackControl}
          <View style={[styles.monetNavigationActionPetal, styles.monetNavigationActionPetalEnd, { backgroundColor: surface }]}>{nextControl}</View>
          {compact ? dismissControl : null}
        </View>
        {showTitle ? <Text numberOfLines={1} style={[styles.monetNavigationStatus, { color: foreground }]}>{statusText}</Text> : null}
      </View>
    )
  }

  if (family === 'material') {
    return (
      <View testID="conversation-navigation-presentation-material" style={compact ? styles.materialNavigationCompact : styles.materialNavigationRail}>
        {showTitle ? (
          <View style={[styles.materialNavigationHeader, { backgroundColor: activeBackground }]}>
            <AppIcon name="conversation" color={activeForeground} size={15} strokeWidth={appIconStroke.strong} />
            <Text numberOfLines={1} style={[styles.materialNavigationTitle, { color: activeForeground }]}>{title}</Text>
            <Text testID="chat-conversation-navigation-position" numberOfLines={1} accessibilityRole="text" style={[styles.materialNavigationPosition, { color: activeForeground }]}>{positionText}</Text>
          </View>
        ) : null}
        <View style={compact ? styles.materialNavigationBodyCompact : styles.materialNavigationBodyRail}>
          {compact ? <Text testID="chat-conversation-navigation-position" numberOfLines={1} accessibilityRole="text" style={[styles.materialNavigationPosition, { color: foreground }]}>{positionText}</Text> : null}
          {previousControl}
          <View style={styles.materialNavigationTrack}>{trackControl}</View>
          {nextControl}
          {compact ? dismissControl : null}
        </View>
        {showTitle ? <Text numberOfLines={1} style={[styles.materialNavigationStatus, { color: foreground }]}>{statusText}</Text> : null}
      </View>
    )
  }

  return (
    <View testID="conversation-navigation-presentation-liquid-glass" style={compact ? styles.glassNavigationCompact : styles.glassNavigationRail}>
      <View pointerEvents="none" style={[styles.glassNavigationHighlight, { backgroundColor: activeForeground }]} />
      {showTitle ? (
        <View style={styles.glassNavigationHeading}>
          <View style={[styles.glassNavigationIconLens, { backgroundColor: surface }]}><AppIcon name="conversation" color={foreground} size={14} strokeWidth={appIconStroke.strong} /></View>
          <Text numberOfLines={1} style={[styles.glassNavigationTitle, { color: foreground }]}>{title}</Text>
          <Text testID="chat-conversation-navigation-position" numberOfLines={1} accessibilityRole="text" style={[styles.glassNavigationPosition, { color: activeForeground }]}>{positionText}</Text>
        </View>
      ) : null}
      <View style={compact ? styles.glassNavigationBodyCompact : styles.glassNavigationBodyRail}>
        {compact ? <Text testID="chat-conversation-navigation-position" numberOfLines={1} accessibilityRole="text" style={[styles.glassNavigationPosition, { color: activeForeground }]}>{positionText}</Text> : null}
        {previousControl}
        {trackControl}
        {nextControl}
        {compact ? dismissControl : null}
      </View>
      {showTitle ? <Text numberOfLines={1} style={[styles.glassNavigationStatus, { color: foreground }]}>{statusText}</Text> : null}
    </View>
  )
}

function NavigationButton({
  icon,
  label,
  hint,
  disabled,
  radius,
  foreground,
  badgeText,
  badgeBackground,
  badgeForeground,
  onPress,
  testID,
}: {
  icon: 'back-previous' | 'back-next' | 'arrow-down' | 'close'
  label: string
  hint: string
  disabled: boolean
  radius: number
  foreground: string
  badgeText?: string
  badgeBackground?: string
  badgeForeground?: string
  onPress: () => void
  testID: string
}) {
  return (
    <IslePressable
      haptic
      testID={testID}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      onPress={onPress}
      style={{
        width: ISLE_MIN_TOUCH_TARGET,
        height: ISLE_MIN_TOUCH_TARGET,
        borderRadius: radius,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        opacity: disabled ? 0.38 : 1,
      }}
    >
      <AppIcon name={icon} color={foreground} size={17} strokeWidth={appIconStroke.strong} />
      {badgeText ? (
        <View pointerEvents="none" style={[styles.navigationBadge, { backgroundColor: badgeBackground }]}>
          <Text numberOfLines={1} style={[styles.navigationBadgeText, { color: badgeForeground }]}>{badgeText}</Text>
        </View>
      ) : null}
    </IslePressable>
  )
}

function NavigationTrack({
  items,
  markerIndices,
  activeIndex,
  jumping,
  compact,
  trackLength,
  trackCrossSize,
  touchPadding,
  markerTravelInset,
  markerTravelLength,
  progressPosition,
  visual,
  markerTransitionDuration,
  trackColor,
  activeTrackColor,
  markerColor,
  activeMarkerColor,
  onAccessibilityAction,
  onInteractionStart,
  onInteractionEnd,
  onSelect,
  positionText,
  accessibilityLabel,
  hint,
}: {
  items: AssistantNavigationItem[]
  markerIndices: number[]
  activeIndex: number
  jumping: boolean
  compact: boolean
  trackLength: number
  trackCrossSize: number
  touchPadding: number
  markerTravelInset: number
  markerTravelLength: number
  progressPosition: number
  visual: ConversationNavigationVisual
  markerTransitionDuration: number
  trackColor: string
  activeTrackColor: string
  markerColor: string
  activeMarkerColor: string
  onAccessibilityAction: (event: AccessibilityActionEvent) => void
  onInteractionStart: () => void
  onInteractionEnd: () => void
  onSelect: (event: GestureResponderEvent, options?: AssistantNavigationScrollOptions) => void
  positionText: string
  accessibilityLabel: string
  hint: string
}) {
  const trackStyle = compact
    ? { width: trackLength + touchPadding * 2, height: trackCrossSize + touchPadding * 2 }
    : { width: trackCrossSize + touchPadding * 2, height: trackLength + touchPadding * 2 }
  const baseTrackStyle = compact
    ? { left: touchPadding, right: touchPadding, top: (trackStyle.height - visual.trackThickness) / 2, height: visual.trackThickness }
    : { top: touchPadding, bottom: touchPadding, left: (trackStyle.width - visual.trackThickness) / 2, width: visual.trackThickness }
  const activeTrackStyle = compact
    ? { left: touchPadding, width: Math.max(visual.trackThickness, progressPosition - markerTravelInset), top: (trackStyle.height - visual.trackThickness) / 2, height: visual.trackThickness }
    : { top: touchPadding, height: Math.max(visual.trackThickness, progressPosition - markerTravelInset), left: (trackStyle.width - visual.trackThickness) / 2, width: visual.trackThickness }

  return (
    <View
      testID="chat-conversation-navigation-track"
      accessible
      accessibilityRole="adjustable"
      accessibilityActions={[
        { name: 'increment', label: hint },
        { name: 'decrement', label: hint },
      ]}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={hint}
      accessibilityState={{ busy: jumping }}
      accessibilityValue={{ text: positionText }}
      onAccessibilityAction={onAccessibilityAction}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(event) => {
        onInteractionStart()
        onSelect(event, { animated: false })
      }}
      onResponderMove={(event) => onSelect(event, { animated: false })}
      onResponderRelease={(event) => {
        onSelect(event, { animated: false, settle: true })
        onInteractionEnd()
      }}
      onResponderTerminate={(event) => {
        onSelect(event, { animated: false, settle: true })
        onInteractionEnd()
      }}
      style={[styles.trackTouchTarget, trackStyle]}
    >
      <View pointerEvents="none" style={[styles.track, baseTrackStyle, { backgroundColor: trackColor, borderRadius: visual.trackRadius, opacity: 0.62 }]} />
      <View pointerEvents="none" style={[styles.track, activeTrackStyle, { backgroundColor: activeTrackColor, borderRadius: visual.trackRadius, opacity: 0.86 }]} />
      {markerIndices.map((markerIndex) => {
        const markerRatio = items.length <= 1 ? 0.5 : markerIndex / (items.length - 1)
        const markerPosition = markerTravelInset + markerRatio * markerTravelLength
        const active = markerIndex === activeIndex
        const markerStyle = compact
          ? {
              left: markerPosition - visual.markerFrame / 2,
              top: (trackStyle.height - visual.markerFrame) / 2,
            }
          : {
              top: markerPosition - visual.markerFrame / 2,
              left: (trackStyle.width - visual.markerFrame) / 2,
            }
        return (
          <View key={`${items[markerIndex]?.messageId ?? markerIndex}`} pointerEvents="none" style={[styles.markerFrame, markerStyle, { width: visual.markerFrame, height: visual.markerFrame }]}>
            <MotiView
              animate={{ opacity: active ? 1 : visual.inactiveOpacity, scale: active ? 1 : 0.92 }}
              transition={{ type: 'timing', duration: markerTransitionDuration }}
              style={{
                width: active ? visual.activeMarkerWidth : visual.inactiveMarkerSize,
                height: active ? visual.activeMarkerHeight : visual.inactiveMarkerSize,
                borderRadius: active ? visual.trackRadius : 999,
                backgroundColor: active ? activeMarkerColor : markerColor,
                borderWidth: active ? 0 : StyleSheet.hairlineWidth,
                borderColor: active ? activeMarkerColor : trackColor,
              }}
            />
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  minimalNavigationCompact: {
    position: 'relative',
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  minimalNavigationRail: {
    position: 'relative',
    alignItems: 'center',
    paddingVertical: 4,
  },
  minimalNavigationBaseline: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: StyleSheet.hairlineWidth,
  },
  minimalNavigationSpine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 4,
    width: StyleSheet.hairlineWidth,
  },
  minimalNavigationCenterCompact: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  minimalNavigationCenterRail: {
    alignItems: 'center',
  },
  minimalNavigationPosition: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  minimalNavigationStatus: {
    fontSize: 8.5,
    lineHeight: 11,
    fontWeight: '600',
    includeFontPadding: false,
  },
  minimalNavigationRailActions: {
    marginTop: 2,
    alignItems: 'center',
  },
  monetNavigationCompact: {
    position: 'relative',
    minHeight: 62,
    paddingHorizontal: 6,
    paddingVertical: 5,
    overflow: 'hidden',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 13,
    borderBottomRightRadius: 27,
    borderBottomLeftRadius: 17,
  },
  monetNavigationRail: {
    position: 'relative',
    paddingHorizontal: 5,
    paddingVertical: 7,
    overflow: 'hidden',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 30,
    borderBottomLeftRadius: 18,
  },
  monetNavigationWash: {
    position: 'absolute',
    top: -18,
    right: -18,
    width: 88,
    height: 60,
    borderBottomLeftRadius: 52,
    opacity: 0.22,
  },
  monetNavigationHeading: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  monetNavigationTitle: {
    flexShrink: 1,
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  monetNavigationPosition: {
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  monetNavigationPathCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
  },
  monetNavigationPathRail: {
    alignItems: 'center',
  },
  monetNavigationActionPetal: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 10,
    borderBottomRightRadius: 20,
    borderBottomLeftRadius: 12,
    overflow: 'hidden',
  },
  monetNavigationActionPetalEnd: {
    borderTopLeftRadius: 10,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 12,
    borderBottomLeftRadius: 20,
  },
  monetNavigationStatus: {
    marginTop: 2,
    fontSize: 8.5,
    lineHeight: 11,
    fontWeight: '600',
    textAlign: 'center',
    includeFontPadding: false,
  },
  materialNavigationCompact: {
    overflow: 'hidden',
    borderRadius: 16,
  },
  materialNavigationRail: {
    overflow: 'hidden',
    borderRadius: 16,
  },
  materialNavigationHeader: {
    minHeight: 34,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  materialNavigationTitle: {
    flexShrink: 1,
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  materialNavigationPosition: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  materialNavigationBodyCompact: {
    minHeight: 48,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
  },
  materialNavigationBodyRail: {
    paddingVertical: 4,
    alignItems: 'center',
  },
  materialNavigationAction: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  materialNavigationTrack: {
    minWidth: 0,
    alignItems: 'center',
  },
  materialNavigationStatus: {
    paddingBottom: 6,
    fontSize: 8.5,
    lineHeight: 11,
    fontWeight: '600',
    textAlign: 'center',
    includeFontPadding: false,
  },
  glassNavigationCompact: {
    position: 'relative',
    minHeight: 70,
    padding: 5,
    overflow: 'hidden',
    borderRadius: 28,
  },
  glassNavigationRail: {
    position: 'relative',
    padding: 5,
    overflow: 'hidden',
    borderRadius: 30,
  },
  glassNavigationInnerPlane: {
    position: 'absolute',
    top: 3,
    right: 3,
    bottom: 3,
    left: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 25,
    opacity: 0.48,
  },
  glassNavigationHighlight: {
    position: 'absolute',
    top: 3,
    right: 20,
    left: 20,
    height: StyleSheet.hairlineWidth,
    opacity: 0.48,
  },
  glassNavigationHeading: {
    minHeight: 28,
    paddingHorizontal: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  glassNavigationIconLens: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassNavigationTitle: {
    flexShrink: 1,
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  glassNavigationPosition: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  glassNavigationBodyCompact: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
  },
  glassNavigationBodyRail: {
    alignItems: 'center',
  },
  glassNavigationActionLens: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    overflow: 'hidden',
  },
  glassNavigationStatus: {
    paddingBottom: 4,
    fontSize: 8.5,
    lineHeight: 11,
    fontWeight: '600',
    textAlign: 'center',
    includeFontPadding: false,
  },
  controls: {
    alignItems: 'center',
  },
  controlsCompact: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  controlsRail: {
    flexDirection: 'column',
    gap: 2,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerCompact: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 2,
    gap: 1,
  },
  centerRail: {
    width: '100%',
  },
  positionRow: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  positionTitle: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    includeFontPadding: false,
  },
  positionText: {
    marginTop: 1,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
    textAlign: 'center',
  },
  positionTextCompact: {
    marginTop: 0,
    flexShrink: 0,
    fontSize: 12,
    lineHeight: 14,
  },
  statusText: {
    maxWidth: '100%',
    marginTop: 1,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '600',
    includeFontPadding: false,
    textAlign: 'center',
  },
  trackTouchTarget: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
  },
  markerFrame: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navigationBadge: {
    position: 'absolute',
    top: 1,
    right: 0,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navigationBadgeText: {
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
})
