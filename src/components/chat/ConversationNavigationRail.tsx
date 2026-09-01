import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import {
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
const CONVERSATION_NAVIGATION_MOBILE_MAX_WIDTH = 248
const CONVERSATION_NAVIGATION_MARKER_LIMIT = 28
// Compact dock stays a lightweight overlay pill: 32pt visual controls padded
// back to a 44pt effective touch target via hitSlop.
const CONVERSATION_NAVIGATION_COMPACT_CONTROL_SIZE = 32
const CONVERSATION_NAVIGATION_COMPACT_CONTROL_HIT_SLOP = 6
const CONVERSATION_NAVIGATION_TRIGGER_HEIGHT = 32
const CONVERSATION_NAVIGATION_TRIGGER_HIT_SLOP = 6

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
  topOffset,
  bottomOffset,
  jumping = false,
  awayFromBottom = false,
  unreadCount = 0,
  expanded = false,
  onSelect,
  onJumpToLatest,
  onExpandedChange,
  onInteractionStart,
  onInteractionEnd,
}: {
  items: AssistantNavigationItem[]
  activeIndex: number
  topOffset: number
  bottomOffset: number
  jumping?: boolean
  awayFromBottom?: boolean
  unreadCount?: number
  expanded?: boolean
  onSelect: (item: AssistantNavigationItem, options?: AssistantNavigationScrollOptions) => void
  onJumpToLatest?: () => void
  onExpandedChange?: (expanded: boolean) => void
  onInteractionStart: () => void
  onInteractionEnd: () => void
}) {
  const { width: windowWidth } = useWindowDimensions()
  const { canonicalThemeId, design } = useAppTheme()
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const compact = windowWidth < CONVERSATION_NAVIGATION_MOBILE_BREAKPOINT
  const navigationTokens = design.component.navigation
  // This control lives inside the glass sampling target. Liquid Glass therefore
  // uses the opaque elevated material here instead of nesting another BlurView.
  const navigationMaterial = canonicalThemeId === 'liquid-glass'
    ? design.semantic.surface.elevated
    : design.semantic.surface.floating
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
        markerFrame: compact ? 16 : 24,
        activeMarkerWidth: compact ? 13 : 18,
        activeMarkerHeight: compact ? 6 : 8,
        inactiveMarkerSize: compact ? 4 : 5,
        inactiveOpacity: 0.58,
        shadowOpacity: 0,
        shadowRadius: 0,
        shadowOffsetY: 0,
      }
    : grammar === 'organic'
      ? {
          shellRadius: design.semantic.radius.extraLarge,
          shellPadding: compact ? 4 : 6,
          buttonRadius: design.semantic.radius.pill,
          trackThickness: compact ? 5 : 6,
          trackRadius: 999,
          markerFrame: compact ? 18 : 26,
          activeMarkerWidth: compact ? 13 : 19,
          activeMarkerHeight: compact ? 8 : 15,
          inactiveMarkerSize: compact ? 4 : 6,
          inactiveOpacity: 0.52,
          shadowOpacity: design.semantic.elevation.shadowOpacity * 0.7,
          shadowRadius: design.semantic.elevation.shadowBlur,
          shadowOffsetY: design.semantic.elevation.shadowOffsetY,
        }
      : grammar === 'material'
        ? {
            shellRadius: design.semantic.radius.extraLarge,
            shellPadding: compact ? 4 : 6,
            buttonRadius: design.semantic.radius.medium,
            trackThickness: compact ? 4 : 5,
            trackRadius: 999,
            markerFrame: compact ? 18 : 26,
            activeMarkerWidth: compact ? 13 : 22,
            activeMarkerHeight: compact ? 7 : 14,
            inactiveMarkerSize: compact ? 4 : 5,
            inactiveOpacity: 0.62,
            shadowOpacity: design.semantic.elevation.shadowOpacity * 0.8,
            shadowRadius: design.semantic.elevation.shadowBlur,
            shadowOffsetY: design.semantic.elevation.shadowOffsetY,
          }
        : {
            shellRadius: design.semantic.radius.pill,
            shellPadding: compact ? 4 : 6,
            buttonRadius: design.semantic.radius.pill,
            trackThickness: compact ? 5 : 7,
            trackRadius: 999,
            markerFrame: compact ? 18 : 28,
            activeMarkerWidth: compact ? 13 : 20,
            activeMarkerHeight: compact ? 7 : 18,
            inactiveMarkerSize: compact ? 4 : 6,
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
    ? Math.max(44, Math.min(60, windowWidth - 272))
    : Math.max(116, Math.min(216, 48 + Math.max(0, items.length - 1) * 7))
  const trackCrossSize = compact ? 26 : 32
  const touchPadding = compact ? 5 : 10
  const markerTravelInset = visual.markerFrame / 2
  const markerTravelLength = Math.max(1, trackLength - markerTravelInset * 2)
  const progressRatio = items.length <= 1 ? 0.5 : safeActiveIndex / (items.length - 1)
  const progressPosition = markerTravelInset + progressRatio * markerTravelLength
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
  const latestAccessibilityLabel = unreadCount > 0
    ? t('chat.scrollToBottomWithUnread', { count: unreadCount })
    : t('chat.scrollToBottom')
  const unreadBadgeText = unreadCount > 99 ? '99+' : unreadCount > 0 ? String(unreadCount) : undefined
  const changeExpanded = (nextExpanded: boolean) => {
    onInteractionStart()
    onExpandedChange?.(nextExpanded)
    onInteractionEnd()
  }

  if (compact && !expanded) {
    return (
      <View
        pointerEvents="box-none"
        style={[
          styles.compactOverlayRoot,
          {
            left: CONVERSATION_NAVIGATION_MOBILE_GUTTER,
            right: CONVERSATION_NAVIGATION_MOBILE_GUTTER,
            bottom: Math.max(0, bottomOffset) + 6,
          },
        ]}
      >
        <MotiView
          pointerEvents="auto"
          testID={`chat-conversation-navigation-${canonicalThemeId}`}
          from={{ opacity: 0, translateY: 2 }}
          animate={{ opacity: 1, translateY: 0 }}
          exit={{ opacity: 0, translateY: 2 }}
          transition={{ type: 'timing', duration: motion === 'full' ? design.semantic.motion.interaction : 1 }}
          style={{
            alignSelf: 'flex-start',
            borderRadius: design.semantic.radius.pill,
            backgroundColor: navigationMaterial.background,
            borderWidth: navigationMaterial.border === 'transparent' ? 0 : StyleSheet.hairlineWidth,
            borderColor: navigationMaterial.border,
            shadowColor: navigationMaterial.shadowColor,
            shadowOpacity: navigationMaterial.shadowOpacity * 0.7,
            shadowRadius: Math.min(10, navigationMaterial.shadowBlur),
            shadowOffset: { width: 0, height: Math.min(4, navigationMaterial.shadowOffsetY) },
            elevation: Math.min(design.semantic.elevation.level2, navigationMaterial.elevation),
          }}
        >
          <IslePressable
            haptic
            testID="chat-conversation-navigation-trigger"
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={t('common.expand')}
            accessibilityState={{ expanded: false }}
            hitSlop={CONVERSATION_NAVIGATION_TRIGGER_HIT_SLOP}
            onPress={() => changeExpanded(true)}
            style={styles.compactTrigger}
          >
            <AppIcon
              name="conversation"
              color={jumping ? navigationTokens.activeForeground : navigationTokens.foreground}
              size={14}
              strokeWidth={appIconStroke.strong}
            />
          </IslePressable>
        </MotiView>
      </View>
    )
  }

  const desktopShellWidth = grammar === 'precision' ? 54 : grammar === 'organic' ? 76 : grammar === 'material' ? 80 : 84
  const shellStyle: ViewStyle = {
    maxWidth: compact ? CONVERSATION_NAVIGATION_MOBILE_MAX_WIDTH : undefined,
    width: compact ? undefined : desktopShellWidth,
    alignSelf: compact ? 'flex-end' : undefined,
    borderRadius: compact ? design.semantic.radius.extraLarge : grammar === 'precision' ? 0 : grammar === 'organic' ? 22 : grammar === 'material' ? 18 : visual.shellRadius,
    padding: compact ? 3 : grammar === 'precision' ? 0 : visual.shellPadding,
    backgroundColor: compact ? navigationMaterial.background : grammar === 'precision' ? 'transparent' : navigationTokens.background,
    borderWidth: compact
      ? navigationMaterial.border === 'transparent' ? 0 : StyleSheet.hairlineWidth
      : grammar === 'fluid' ? StyleSheet.hairlineWidth : 0,
    borderColor: compact ? navigationMaterial.border : navigationTokens.border,
    shadowColor: compact ? navigationMaterial.shadowColor : design.semantic.elevation.shadowColor,
    shadowOpacity: compact ? navigationMaterial.shadowOpacity : visual.shadowOpacity,
    shadowRadius: compact ? navigationMaterial.shadowBlur : visual.shadowRadius,
    shadowOffset: { width: 0, height: compact ? navigationMaterial.shadowOffsetY : visual.shadowOffsetY },
    elevation: compact ? navigationMaterial.elevation : visual.shadowOpacity ? design.semantic.elevation.level2 : 0,
  }

  const previousControl = (
    <NavigationButton
      icon="back-previous"
      label={t('chat.previousAssistantReply')}
      hint={t('chat.conversationNavigationPreviousHint')}
      disabled={!previousItem}
      compact={compact}
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
      compact={compact}
      radius={visual.buttonRadius}
      foreground={navigationTokens.foreground}
      onPress={() => selectAdjacent(safeActiveIndex + 1)}
      testID="chat-conversation-navigation-next"
    />
  )
  const latestControl = compact && onJumpToLatest ? (
    <NavigationButton
      icon="arrow-down"
      label={latestAccessibilityLabel}
      hint={t('chat.scrollToBottom')}
      disabled={!awayFromBottom}
      compact={compact}
      radius={visual.buttonRadius}
      foreground={navigationTokens.foreground}
      badgeText={unreadBadgeText}
      badgeBackground={navigationTokens.activeBackground}
      badgeForeground={navigationTokens.activeForeground}
      onPress={onJumpToLatest}
      testID="chat-conversation-navigation-latest"
    />
  ) : null
  const collapseControl = compact ? (
    <NavigationButton
      icon="collapse"
      label={t('common.collapse')}
      hint={t('common.collapse')}
      disabled={false}
      compact
      radius={visual.buttonRadius}
      foreground={navigationTokens.foreground}
      onPress={() => changeExpanded(false)}
      testID="chat-conversation-navigation-collapse"
    />
  ) : null
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

  return (
    <View
      pointerEvents="box-none"
      style={compact
        ? [
            styles.compactOverlayRoot,
            {
            left: CONVERSATION_NAVIGATION_MOBILE_GUTTER,
            right: CONVERSATION_NAVIGATION_MOBILE_GUTTER,
              bottom: Math.max(0, bottomOffset) + 6,
            },
          ]
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
        pointerEvents="auto"
        testID={`chat-conversation-navigation-${canonicalThemeId}`}
        from={{ opacity: 0, translateY: 2 }}
        animate={{ opacity: 1, translateY: 0 }}
        exit={{ opacity: 0, translateY: 2 }}
        transition={{ type: 'timing', duration: motion === 'full' ? design.semantic.motion.interaction : 1 }}
        style={shellStyle}
      >
        <ConversationNavigationPresentation
          family={canonicalThemeId}
          compact={compact}
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
          latestControl={latestControl}
          collapseControl={collapseControl}
          trackControl={trackControl}
        />
      </MotiView>
    </View>
  )
}

function ConversationNavigationPresentation({
  family,
  compact,
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
  latestControl,
  collapseControl,
  trackControl,
}: {
  family: CanonicalThemeId
  compact: boolean
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
  latestControl: ReactNode
  collapseControl: ReactNode
  trackControl: ReactNode
}) {
  if (compact) {
    return (
      <View
        testID={`conversation-navigation-presentation-${family}`}
        style={styles.compactNavigationPanel}
      >
        {previousControl}
        <View style={styles.compactNavigationCenter}>
          <Text
            testID="chat-conversation-navigation-position"
            numberOfLines={1}
            accessibilityRole="text"
            style={[styles.compactNavigationPosition, { color: activeForeground }]}
          >
            {positionText}
          </Text>
          {trackControl}
        </View>
        {nextControl}
        {latestControl}
        {collapseControl}
      </View>
    )
  }

  if (family === 'minimal') {
    return (
      <View testID="conversation-navigation-presentation-minimal" style={compact ? styles.minimalNavigationCompact : styles.minimalNavigationRail}>
        <View pointerEvents="none" style={[compact ? styles.minimalNavigationBaseline : styles.minimalNavigationSpine, { backgroundColor: border }]} />
        {compact ? previousControl : null}
        <View style={compact ? styles.minimalNavigationCenterCompact : styles.minimalNavigationCenterRail}>
          <Text testID="chat-conversation-navigation-position" numberOfLines={1} accessibilityRole="text" style={[styles.minimalNavigationPosition, { color: activeForeground }]}>{positionText}</Text>
          {trackControl}
          {!compact ? <Text numberOfLines={1} style={[styles.minimalNavigationStatus, { color: foreground }]}>{statusText}</Text> : null}
        </View>
        {compact ? nextControl : null}
        {compact ? latestControl : null}
        {!compact ? <View style={styles.minimalNavigationRailActions}>{previousControl}{nextControl}</View> : null}
      </View>
    )
  }

  if (family === 'monet') {
    return (
      <View testID="conversation-navigation-presentation-monet" style={compact ? styles.monetNavigationCompact : styles.monetNavigationRail}>
        <View pointerEvents="none" style={[styles.monetNavigationWash, { backgroundColor: activeBackground }]} />
        {!compact ? (
          <View style={styles.monetNavigationHeading}>
            <AppIcon name="conversation" color={foreground} size={14} strokeWidth={appIconStroke.regular} />
            <Text numberOfLines={1} style={[styles.monetNavigationTitle, { color: foreground }]}>{title}</Text>
            <Text testID="chat-conversation-navigation-position" numberOfLines={1} accessibilityRole="text" style={[styles.monetNavigationPosition, { color: activeForeground }]}>{positionText}</Text>
          </View>
        ) : null}
        <View style={compact ? styles.monetNavigationPathCompact : styles.monetNavigationPathRail}>
          <View style={[styles.monetNavigationActionPetal, { backgroundColor: surface }]}>{previousControl}</View>
          {compact ? (
            <View style={styles.monetNavigationCenterCompact}>
              <Text testID="chat-conversation-navigation-position" numberOfLines={1} accessibilityRole="text" style={[styles.monetNavigationPosition, { color: activeForeground }]}>{positionText}</Text>
              {trackControl}
            </View>
          ) : trackControl}
          <View style={[styles.monetNavigationActionPetal, styles.monetNavigationActionPetalEnd, { backgroundColor: surface }]}>{nextControl}</View>
          {compact ? latestControl : null}
        </View>
        {!compact ? <Text numberOfLines={1} style={[styles.monetNavigationStatus, { color: foreground }]}>{statusText}</Text> : null}
      </View>
    )
  }

  if (family === 'material') {
    return (
      <View testID="conversation-navigation-presentation-material" style={compact ? styles.materialNavigationCompact : styles.materialNavigationRail}>
        {!compact ? (
          <View style={[styles.materialNavigationHeader, { backgroundColor: activeBackground }]}>
            <AppIcon name="conversation" color={activeForeground} size={15} strokeWidth={appIconStroke.strong} />
            <Text numberOfLines={1} style={[styles.materialNavigationTitle, { color: activeForeground }]}>{title}</Text>
            <Text testID="chat-conversation-navigation-position" numberOfLines={1} accessibilityRole="text" style={[styles.materialNavigationPosition, { color: activeForeground }]}>{positionText}</Text>
          </View>
        ) : null}
        <View style={compact ? styles.materialNavigationBodyCompact : styles.materialNavigationBodyRail}>
          <View style={[styles.materialNavigationAction, { backgroundColor: surface }]}>{previousControl}</View>
          <View style={styles.materialNavigationTrack}>
            {compact ? (
              <Text testID="chat-conversation-navigation-position" numberOfLines={1} accessibilityRole="text" style={[styles.materialNavigationPosition, { color: activeForeground }]}>{positionText}</Text>
            ) : null}
            {trackControl}
          </View>
          <View style={[styles.materialNavigationAction, { backgroundColor: surface }]}>{nextControl}</View>
          {compact ? <View style={[styles.materialNavigationAction, { backgroundColor: surface }]}>{latestControl}</View> : null}
        </View>
        {!compact ? <Text numberOfLines={1} style={[styles.materialNavigationStatus, { color: foreground }]}>{statusText}</Text> : null}
      </View>
    )
  }

  return (
    <View testID="conversation-navigation-presentation-liquid-glass" style={compact ? styles.glassNavigationCompact : styles.glassNavigationRail}>
      <View pointerEvents="none" style={[styles.glassNavigationHighlight, { backgroundColor: activeForeground }]} />
      {!compact ? (
        <View style={styles.glassNavigationHeading}>
          <View style={[styles.glassNavigationIconLens, { backgroundColor: surface }]}><AppIcon name="conversation" color={foreground} size={14} strokeWidth={appIconStroke.strong} /></View>
          <Text numberOfLines={1} style={[styles.glassNavigationTitle, { color: foreground }]}>{title}</Text>
          <Text testID="chat-conversation-navigation-position" numberOfLines={1} accessibilityRole="text" style={[styles.glassNavigationPosition, { color: activeForeground }]}>{positionText}</Text>
        </View>
      ) : null}
      <View style={compact ? styles.glassNavigationBodyCompact : styles.glassNavigationBodyRail}>
        <View style={[styles.glassNavigationActionLens, { borderColor: border }]}>{previousControl}</View>
        {compact ? (
          <View style={styles.glassNavigationTrackCompact}>
            <Text testID="chat-conversation-navigation-position" numberOfLines={1} accessibilityRole="text" style={[styles.glassNavigationPosition, { color: activeForeground }]}>{positionText}</Text>
            {trackControl}
          </View>
        ) : trackControl}
        <View style={[styles.glassNavigationActionLens, { borderColor: border }]}>{nextControl}</View>
        {compact ? <View style={[styles.glassNavigationActionLens, { borderColor: border }]}>{latestControl}</View> : null}
      </View>
      {!compact ? <Text numberOfLines={1} style={[styles.glassNavigationStatus, { color: foreground }]}>{statusText}</Text> : null}
    </View>
  )
}

function NavigationButton({
  icon,
  label,
  hint,
  disabled,
  compact,
  radius,
  foreground,
  badgeText,
  badgeBackground,
  badgeForeground,
  onPress,
  testID,
}: {
  icon: 'back-previous' | 'back-next' | 'arrow-down' | 'collapse'
  label: string
  hint: string
  disabled: boolean
  compact: boolean
  radius: number
  foreground: string
  badgeText?: string
  badgeBackground?: string
  badgeForeground?: string
  onPress: () => void
  testID: string
}) {
  const controlSize = compact ? CONVERSATION_NAVIGATION_COMPACT_CONTROL_SIZE : ISLE_MIN_TOUCH_TARGET
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
      hitSlop={compact ? { top: CONVERSATION_NAVIGATION_COMPACT_CONTROL_HIT_SLOP, right: CONVERSATION_NAVIGATION_COMPACT_CONTROL_HIT_SLOP, bottom: CONVERSATION_NAVIGATION_COMPACT_CONTROL_HIT_SLOP, left: CONVERSATION_NAVIGATION_COMPACT_CONTROL_HIT_SLOP } : undefined}
      style={{
        width: controlSize,
        height: controlSize,
        borderRadius: radius,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        opacity: disabled ? 0.38 : 1,
      }}
    >
      <AppIcon name={icon} color={foreground} size={compact ? 15 : 17} strokeWidth={appIconStroke.strong} />
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
  compactOverlayRoot: {
    position: 'absolute',
    alignItems: 'flex-end',
    zIndex: 34,
  },
  compactTrigger: {
    width: CONVERSATION_NAVIGATION_TRIGGER_HEIGHT,
    height: CONVERSATION_NAVIGATION_TRIGGER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactNavigationPanel: {
    minHeight: 38,
    maxWidth: CONVERSATION_NAVIGATION_MOBILE_MAX_WIDTH - 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 1,
  },
  compactNavigationCenter: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  compactNavigationPosition: {
    width: 28,
    flexShrink: 0,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
    textAlign: 'center',
  },
  minimalNavigationCompact: {
    position: 'relative',
    minHeight: 38,
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
    minHeight: 44,
    paddingHorizontal: 4,
    paddingVertical: 3,
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
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
  },
  monetNavigationCenterCompact: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
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
    minHeight: 40,
    paddingHorizontal: 2,
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
    minHeight: 44,
    padding: 4,
    overflow: 'hidden',
    borderRadius: 28,
  },
  glassNavigationRail: {
    position: 'relative',
    padding: 5,
    overflow: 'hidden',
    borderRadius: 30,
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
    flex: 1,
    minWidth: 0,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
  },
  glassNavigationTrackCompact: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
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
