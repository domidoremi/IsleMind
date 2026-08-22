import { useCallback, useEffect, useRef } from 'react'
import { Platform, StyleSheet, View, type AccessibilityActionEvent, type GestureResponderEvent, type ViewStyle } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'

import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { resolveThemeComponentExpression, resolveThemeExpression } from '@/theme/themeExpression'

import type { AssistantNavigationItem, AssistantNavigationScrollOptions } from './messageListNavigation'

const CONVERSATION_NAVIGATION_RAIL_RIGHT = -12
const CONVERSATION_NAVIGATION_RAIL_WIDTH = 48

export function ConversationNavigationRail({
  items,
  activeIndex,
  visible,
  topOffset,
  bottomOffset,
  onSelect,
  onInteractionStart,
  onInteractionEnd,
}: {
  items: AssistantNavigationItem[]
  activeIndex: number
  visible: boolean
  topOffset: number
  bottomOffset: number
  onSelect: (item: AssistantNavigationItem, options?: AssistantNavigationScrollOptions) => void
  onInteractionStart: () => void
  onInteractionEnd: () => void
}) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const navigationExpression = resolveThemeComponentExpression(canonicalThemeId, 'navigation')
  const themeExpression = resolveThemeExpression(canonicalThemeId)
  const grammar = navigationExpression.motion
  const visual = {
    precision: {
      shellWidth: 34,
      shellRadius: 2,
      shellBackground: 'transparent',
      shellBorder: colors.ui.semantic.chrome.border,
      shellBorderWidth: 0,
      trackWidth: 1,
      trackBackground: colors.ui.semantic.chrome.border,
      trackOpacity: 0.74,
      activeWidth: 18,
      activeHeight: 3,
      inactiveHeight: 2,
      activeRadius: 1,
      markerBorderWidth: 0,
      inactiveOpacity: 0.54,
      pulse: false,
      shadowOpacity: 0,
    },
    organic: {
      shellWidth: 42,
      shellRadius: 22,
      shellBackground: colors.ui.semantic.surface.base,
      shellBorder: colors.ui.control.focus,
      shellBorderWidth: 1,
      trackWidth: 10,
      trackBackground: colors.ui.control.focus,
      trackOpacity: 0.16,
      activeWidth: 18,
      activeHeight: 13,
      inactiveHeight: 5,
      activeRadius: 10,
      markerBorderWidth: 1,
      inactiveOpacity: 0.5,
      pulse: true,
      shadowOpacity: 0.09,
    },
    material: {
      shellWidth: 40,
      shellRadius: 20,
      shellBackground: colors.ui.semantic.surface.raised,
      shellBorder: colors.ui.semantic.chrome.border,
      shellBorderWidth: StyleSheet.hairlineWidth,
      trackWidth: 4,
      trackBackground: colors.ui.semantic.surface.muted,
      trackOpacity: 1,
      activeWidth: 24,
      activeHeight: 14,
      inactiveHeight: 4,
      activeRadius: 8,
      markerBorderWidth: 0,
      inactiveOpacity: 0.58,
      pulse: false,
      shadowOpacity: 0.08,
    },
    fluid: {
      shellWidth: 44,
      shellRadius: 22,
      shellBackground: colors.ui.semantic.surface.overlay,
      shellBorder: colors.ui.actionBar.itemBorder,
      shellBorderWidth: 1,
      trackWidth: 22,
      trackBackground: colors.ui.actionBar.itemBackground,
      trackOpacity: 0.84,
      activeWidth: 18,
      activeHeight: 18,
      inactiveHeight: 5,
      activeRadius: 10,
      markerBorderWidth: 2,
      inactiveOpacity: 0.62,
      pulse: true,
      shadowOpacity: 0.16,
    },
  }[grammar]
  const railBorder = visual.shellBorder
  const subtleBorderWidth = visual.shellBorderWidth || StyleSheet.hairlineWidth
  const glassStyle = grammar === 'fluid' && Platform.OS === 'web'
    ? ({ backdropFilter: 'blur(14px) saturate(1.14)' } as unknown as ViewStyle)
    : null
  const safeActiveIndex = Math.max(0, Math.min(items.length - 1, activeIndex >= 0 ? activeIndex : items.length - 1))
  const item = items[safeActiveIndex]
  const trackVisualHeight = Math.max(94, Math.min(232, 42 + Math.max(0, items.length - 1) * 11))
  const lastSelectedIndexRef = useRef(safeActiveIndex)
  const gestureSelectedIndexRef = useRef(safeActiveIndex)
  const trackWidth = 34
  const touchVerticalPadding = 10
  const activeMarkerFrame = 28
  const markerTravelInset = activeMarkerFrame / 2
  const markerTravelHeight = Math.max(1, trackVisualHeight - markerTravelInset * 2)
  const markerTravelTop = markerTravelInset

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

  const selectFromGesture = useCallback((event: GestureResponderEvent, options?: AssistantNavigationScrollOptions) => {
    if (items.length <= 1) return
    const trackY = event.nativeEvent.locationY - touchVerticalPadding - markerTravelTop
    const ratio = Math.max(0, Math.min(1, trackY / markerTravelHeight))
    selectIndex(Math.round(ratio * (items.length - 1)), options)
  }, [items.length, markerTravelHeight, markerTravelTop, selectIndex, touchVerticalPadding])

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

  const anchorBaseSize = items.length > 64 ? 2.5 : items.length > 32 ? 3.5 : items.length > 18 ? 5 : 7

  return (
    <View pointerEvents={visible ? 'box-none' : 'none'} style={{ position: 'absolute', top: topOffset, right: CONVERSATION_NAVIGATION_RAIL_RIGHT, bottom: bottomOffset, width: CONVERSATION_NAVIGATION_RAIL_WIDTH, justifyContent: 'center', zIndex: 34, elevation: 2 }}>
      <View
        testID={`chat-conversation-navigation-${canonicalThemeId}`}
        style={[{
          width: visual.shellWidth,
          borderRadius: visual.shellRadius,
          paddingHorizontal: 4,
          paddingVertical: 8,
          alignItems: 'center',
          alignSelf: 'center',
          overflow: 'hidden',
          backgroundColor: visual.shellBackground,
          borderWidth: visual.shellBorderWidth,
          borderColor: visual.shellBorder,
          shadowColor: colors.shadowTint,
          shadowOpacity: visual.shadowOpacity,
          shadowRadius: visual.shadowOpacity ? (grammar === 'fluid' ? 18 : 12) : 0,
          shadowOffset: { width: 0, height: visual.shadowOpacity ? 5 : 0 },
          elevation: visual.shadowOpacity ? (grammar === 'fluid' ? 3 : 1) : 0,
          opacity: visible ? 1 : 0,
          transform: [{ translateX: visible ? 0 : themeExpression.navigation === 'list' ? 8 : 18 }],
        }, glassStyle]}
      >
        {grammar === 'organic' ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 9, right: 9, height: 2, backgroundColor: colors.ui.control.focus, opacity: 0.24 }} /> : null}
        {grammar === 'fluid' ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 8, right: 8, height: 1, backgroundColor: colors.ui.semantic.content.inverse, opacity: 0.6 }} /> : null}
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityActions={[
            { name: 'increment', label: t('chat.nextAssistantReply') },
            { name: 'decrement', label: t('chat.previousAssistantReply') },
          ]}
          accessibilityLabel={t('chat.conversationNavigationPositionAccessibilityLabel', {
            current: item.assistantIndex,
            total: item.assistantCount,
            paragraphs: item.paragraphCount,
          })}
          accessibilityValue={{ text: t('chat.conversationNavigationPosition', { current: item.assistantIndex, total: item.assistantCount }) }}
          onAccessibilityAction={handleAccessibilityAction}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(event) => {
            onInteractionStart()
            selectFromGesture(event, { animated: false })
          }}
          onResponderMove={(event) => selectFromGesture(event, { animated: false })}
          onResponderRelease={() => {
            selectIndex(gestureSelectedIndexRef.current, { animated: false, settle: true })
            onInteractionEnd()
          }}
          onResponderTerminate={() => {
            selectIndex(gestureSelectedIndexRef.current, { animated: false, settle: true })
            onInteractionEnd()
          }}
          style={{ width: 42, height: trackVisualHeight + touchVerticalPadding * 2, alignItems: 'center', justifyContent: 'center' }}
        >
          <View
            style={{
              width: trackWidth,
              height: trackVisualHeight,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View pointerEvents="none" style={{ position: 'absolute', top: markerTravelTop, bottom: markerTravelTop, width: visual.trackWidth, borderRadius: 999, backgroundColor: visual.trackBackground, opacity: visual.trackOpacity }} />
            {items.map((navigationItem, index) => {
              const active = index === safeActiveIndex
              const travelRatio = items.length <= 1 ? 0.5 : index / (items.length - 1)
              const markerCenterY = markerTravelTop + travelRatio * markerTravelHeight
              const anchorWidth = active ? visual.activeWidth : Math.max(2, anchorBaseSize)
              const anchorHeight = active ? visual.activeHeight : Math.min(anchorWidth, visual.inactiveHeight)
              return (
                <MotiView
                  key={navigationItem.messageId}
                  pointerEvents="none"
                  animate={{
                    opacity: active ? 1 : visual.inactiveOpacity,
                  }}
                  transition={{ type: 'timing', duration: motion === 'full' ? themeExpression.motion.duration.interaction : 1 }}
                  style={{
                    position: 'absolute',
                    top: markerCenterY - activeMarkerFrame / 2,
                    left: (trackWidth - activeMarkerFrame) / 2,
                    width: activeMarkerFrame,
                    height: activeMarkerFrame,
                    borderRadius: 999,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'transparent',
                    borderWidth: 0,
                  }}
                >
                  {active && visual.pulse && motion === 'full' ? (
                    <MotiView
                      from={{ opacity: grammar === 'organic' ? 0.12 : 0.18, scale: 0.86 }}
                      animate={{ opacity: 0, scale: grammar === 'organic' ? 1.2 : 1.34 }}
                      transition={{ loop: true, type: 'timing', duration: grammar === 'organic' ? 1800 : 1280 }}
                      style={{
                        position: 'absolute',
                        width: grammar === 'organic' ? 30 : 28,
                        height: grammar === 'organic' ? 22 : 28,
                        borderRadius: 999,
                        backgroundColor: colors.ui.control.primaryBackground,
                      }}
                    />
                  ) : null}
                  <View
                    style={{
                      width: anchorWidth,
                      height: anchorHeight,
                      borderRadius: active ? visual.activeRadius : 999,
                      backgroundColor: active ? colors.ui.control.primaryBackground : colors.textSecondary,
                      borderWidth: active ? visual.markerBorderWidth : subtleBorderWidth,
                      borderColor: active ? colors.ui.control.primaryBorder : railBorder,
                      opacity: active ? 0.96 : visual.inactiveOpacity,
                    }}
                  />
                </MotiView>
              )
            })}
          </View>
        </View>
      </View>
    </View>
  )
}
