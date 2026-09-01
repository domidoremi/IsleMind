import { Text, useWindowDimensions, View, StyleSheet } from 'react-native'
import { AnimatePresence, MotiView } from 'moti'
import { useTranslation } from 'react-i18next'

import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'

import { ConversationNavigationRail } from './ConversationNavigationRail'
import type { useChatMessageListScrollController } from './chatMessageListScrollState'

const DESKTOP_NAVIGATION_RAIL_CLEARANCE = 108

type ChatMessageListController = ReturnType<typeof useChatMessageListScrollController>

export interface ChatActiveNavigationRailProps {
  mobileNavigationExpanded: boolean
  messageListBottomPadding: number
  messageListController: ChatMessageListController
  messageListTopInset: number
  onMobileNavigationExpandedChange: (expanded: boolean) => void
  visualTopInset: number
}

export function ChatActiveNavigationRail({
  mobileNavigationExpanded,
  messageListBottomPadding,
  messageListController,
  messageListTopInset,
  onMobileNavigationExpandedChange,
  visualTopInset,
}: ChatActiveNavigationRailProps) {
  const {
    activeAssistantNavigationIndex,
    activeAssistantNavigationItem,
    assistantNavigationFloatingVisible,
    assistantNavigationJumping,
    assistantNavigationItems,
    assistantNavigationVisible,
    handleAssistantNavigationInteractionEnd,
    handleAssistantNavigationInteractionStart,
    messageListAwayFromBottom,
    scrollToAssistantNavigationItem,
    scrollToMessageListBottom,
    unreadMessageCount,
  } = messageListController

  const showAssistantNavigation = assistantNavigationVisible && Boolean(activeAssistantNavigationItem)
  const { width: windowWidth } = useWindowDimensions()
  const compactViewport = windowWidth < 720
  const showStandaloneLatest = messageListAwayFromBottom && (
    !compactViewport ||
    !showAssistantNavigation ||
    !assistantNavigationFloatingVisible
  )
  const latestControlRightInset = compactViewport ? 12 : DESKTOP_NAVIGATION_RAIL_CLEARANCE

  return (
    <>
      <AnimatePresence>
        {showAssistantNavigation && assistantNavigationFloatingVisible && activeAssistantNavigationItem ? (
          <ConversationNavigationRail
            items={assistantNavigationItems}
            activeIndex={activeAssistantNavigationIndex}
            jumping={assistantNavigationJumping}
            awayFromBottom={messageListAwayFromBottom}
            unreadCount={unreadMessageCount}
            expanded={mobileNavigationExpanded}
            topOffset={Math.max(visualTopInset + 70, messageListTopInset + 8)}
            bottomOffset={messageListBottomPadding + 12}
            onExpandedChange={onMobileNavigationExpandedChange}
            onSelect={scrollToAssistantNavigationItem}
            onJumpToLatest={scrollToMessageListBottom}
            onInteractionStart={handleAssistantNavigationInteractionStart}
            onInteractionEnd={handleAssistantNavigationInteractionEnd}
          />
        ) : null}
      </AnimatePresence>
      <ScrollToBottomControl
        visible={showStandaloneLatest}
        unreadCount={unreadMessageCount}
        bottomOffset={messageListBottomPadding + 12}
        compactViewport={compactViewport}
        rightInset={latestControlRightInset}
        onPress={scrollToMessageListBottom}
      />
    </>
  )
}

function ScrollToBottomControl({
  visible,
  unreadCount,
  bottomOffset,
  compactViewport,
  rightInset,
  onPress,
}: {
  visible: boolean
  unreadCount: number
  bottomOffset: number
  compactViewport: boolean
  rightInset: number
  onPress: () => void
}) {
  const { colors, canonicalThemeId } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const countLabel = unreadCount > 99 ? '99+' : String(unreadCount)
  const accessibilityLabel = unreadCount > 0
    ? t('chat.scrollToBottomWithUnread', { count: unreadCount })
    : t('chat.scrollToBottom')
  const material = canonicalThemeId === 'liquid-glass'
    ? colors.design?.semantic.surface.elevated
    : colors.design?.semantic.surface.floating
  const visualSize = compactViewport ? 32 : ISLE_MIN_TOUCH_TARGET

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: bottomOffset,
        zIndex: 36,
        alignItems: 'flex-end',
        paddingRight: rightInset,
      }}
    >
      <AnimatePresence>
        {visible ? (
          <MotiView
            key="chat-scroll-to-latest"
            from={{ opacity: 0, translateY: 6, scale: 0.96 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            exit={{ opacity: 0, translateY: 6, scale: 0.96 }}
            transition={{ type: 'timing', duration: motion === 'full' ? 176 : 1 }}
          >
            <IslePressable
              haptic
              testID="chat-scroll-to-latest"
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
              onPress={onPress}
              hitSlop={compactViewport ? 6 : undefined}
              style={{
                width: visualSize,
                height: visualSize,
                borderRadius: visualSize / 2,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: material?.border && material.border !== 'transparent' ? StyleSheet.hairlineWidth : 0,
                borderColor: material?.border ?? colors.ui.semantic.chrome.border,
                shadowColor: material?.shadowColor ?? colors.shadowTint,
                shadowOpacity: material?.shadowOpacity ?? 0.08,
                shadowRadius: material?.shadowBlur ?? 8,
                shadowOffset: { width: 0, height: material?.shadowOffsetY ?? 3 },
                elevation: material?.elevation ?? 2,
                backgroundColor: material?.background ?? colors.ui.semantic.surface.base,
              }}
            >
              <AppIcon name="arrow-down" color={colors.ui.icon.accentForeground} size={18} strokeWidth={appIconStroke.strong} />
              {unreadCount > 0 ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: -5,
                    right: -7,
                    minWidth: 19,
                    height: 19,
                    borderRadius: 10,
                    paddingHorizontal: 4,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.ui.control.primaryBackground,
                    borderWidth: 2,
                    borderColor: colors.ui.semantic.surface.base,
                  }}
                >
                  <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 9, lineHeight: 11, fontWeight: '900', fontVariant: ['tabular-nums'] }}>
                    {countLabel}
                  </Text>
                </View>
              ) : null}
            </IslePressable>
          </MotiView>
        ) : null}
      </AnimatePresence>
    </View>
  )
}
