import { useCallback, useEffect, useRef } from 'react'
import { StyleSheet, View, type AccessibilityActionEvent, type GestureResponderEvent } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'

import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

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
  const { colors, isGlass, isLimeRoad } = useAppTheme()
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const railBorder = isLimeRoad ? colors.material.stroke : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const subtleBorderWidth = isLimeRoad ? 1 : StyleSheet.hairlineWidth
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
        style={{
          width: CONVERSATION_NAVIGATION_RAIL_WIDTH,
          borderRadius: colors.ui.radius.controlLarge,
          paddingHorizontal: 4,
          paddingVertical: 8,
          alignItems: 'center',
          backgroundColor: 'transparent',
          borderWidth: 0,
          borderColor: 'transparent',
          shadowOpacity: 0,
          elevation: 0,
          opacity: visible ? 1 : 0,
          transform: [{ translateX: visible ? 0 : 18 }],
        }}
      >
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
            <View pointerEvents="none" style={{ position: 'absolute', top: markerTravelTop, bottom: markerTravelTop, width: 2, borderRadius: 999, backgroundColor: railBorder, opacity: isGlass ? 0.34 : 0.28 }} />
            {items.map((navigationItem, index) => {
              const active = index === safeActiveIndex
              const travelRatio = items.length <= 1 ? 0.5 : index / (items.length - 1)
              const markerCenterY = markerTravelTop + travelRatio * markerTravelHeight
              const anchorSize = active ? 15 : anchorBaseSize
              return (
                <MotiView
                  key={navigationItem.messageId}
                  pointerEvents="none"
                  animate={{
                    opacity: active ? 1 : 0.58,
                  }}
                  transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
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
                  {active && motion === 'full' ? (
                    <MotiView
                      from={{ opacity: 0.16 }}
                      animate={{ opacity: 0 }}
                      transition={{ loop: true, type: 'timing', duration: 960 }}
                      style={{
                        position: 'absolute',
                        width: 26,
                        height: 26,
                        borderRadius: 999,
                        backgroundColor: colors.ui.control.primaryBackground,
                      }}
                    />
                  ) : null}
                  <View
                    style={{
                      width: anchorSize,
                      height: anchorSize,
                      borderRadius: 999,
                      backgroundColor: active ? colors.ui.control.primaryBackground : colors.textSecondary,
                      borderWidth: active ? 2 : subtleBorderWidth,
                      borderColor: active ? colors.ui.control.primaryBorder : railBorder,
                      opacity: active ? 0.96 : (isGlass ? 0.62 : 0.5),
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
