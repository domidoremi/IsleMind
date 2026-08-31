import { useCallback, useEffect, useState } from 'react'
import { Text, useWindowDimensions, View } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'

import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'

import { ConversationNavigationRail } from './ConversationNavigationRail'
import type { useChatMessageListScrollController } from './chatMessageListScrollState'

type ChatMessageListController = ReturnType<typeof useChatMessageListScrollController>

/** Below this the transcript is short enough to scroll; indexed jumps add noise. */
const CONVERSATION_NAVIGATION_MIN_ITEMS = 3
const CONVERSATION_NAVIGATION_WIDE_BREAKPOINT = 720

export interface ChatActiveNavigationRailProps {
  messageListBottomPadding: number
  messageListController: ChatMessageListController
  messageListTopInset: number
  visualTopInset: number
}

/**
 * Contextual scroll utility, not a docked panel.
 *
 * Reading is the default state, so this layer paints nothing at rest and never
 * reserves viewport height. A compact pill cluster appears above the composer
 * only when the reader leaves the latest message or scrubs through a long
 * transcript, and the full indexed rail stays one tap away.
 */
export function ChatActiveNavigationRail({
  messageListBottomPadding,
  messageListController,
  messageListTopInset,
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

  const { width: windowWidth } = useWindowDimensions()
  const wideViewport = windowWidth >= CONVERSATION_NAVIGATION_WIDE_BREAKPOINT
  const [railExpanded, setRailExpanded] = useState(false)

  const indexedNavigationAvailable =
    assistantNavigationVisible &&
    Boolean(activeAssistantNavigationItem) &&
    assistantNavigationItems.length >= CONVERSATION_NAVIGATION_MIN_ITEMS

  // Expansion is a deliberate user action, so it outlives the controller's
  // transient reveal window. It ends when the reader dismisses it, jumps back
  // to the latest message, or the transcript stops offering indexed jumps.
  useEffect(() => {
    if (!indexedNavigationAvailable) setRailExpanded(false)
  }, [indexedNavigationAvailable])

  const railVisible = indexedNavigationAvailable && (wideViewport ? assistantNavigationFloatingVisible : railExpanded)
  const indexChipVisible = indexedNavigationAvailable && !wideViewport && !railExpanded &&
    (assistantNavigationFloatingVisible || messageListAwayFromBottom)
  const latestVisible = messageListAwayFromBottom && !railExpanded

  const openRail = useCallback(() => {
    setRailExpanded(true)
    handleAssistantNavigationInteractionStart()
  }, [handleAssistantNavigationInteractionStart])

  const closeRail = useCallback(() => {
    setRailExpanded(false)
    handleAssistantNavigationInteractionEnd()
  }, [handleAssistantNavigationInteractionEnd])

  const jumpToLatest = useCallback(() => {
    setRailExpanded(false)
    scrollToMessageListBottom()
  }, [scrollToMessageListBottom])
  return (
    <>
      {railVisible && activeAssistantNavigationItem ? (
        <ConversationNavigationRail
          items={assistantNavigationItems}
          activeIndex={activeAssistantNavigationIndex}
          visible
          jumping={assistantNavigationJumping}
          topOffset={Math.max(visualTopInset + 70, messageListTopInset + 8)}
          bottomOffset={messageListBottomPadding + 12}
          onSelect={scrollToAssistantNavigationItem}
          onDismiss={wideViewport ? undefined : closeRail}
          onInteractionStart={handleAssistantNavigationInteractionStart}
          onInteractionEnd={handleAssistantNavigationInteractionEnd}
        />
      ) : null}
      <ContextualScrollUtility
        indexVisible={indexChipVisible}
        indexLabel={activeAssistantNavigationItem
          ? `${activeAssistantNavigationItem.assistantIndex}/${activeAssistantNavigationItem.assistantCount}`
          : ''}
        latestVisible={latestVisible}
        unreadCount={unreadMessageCount}
        bottomOffset={messageListBottomPadding + 10}
        onIndexPress={openRail}
        onLatestPress={jumpToLatest}
      />
    </>
  )
}

/**
 * One cluster owns both scroll utilities so the page never shows two competing
 * floating controls. It is right-aligned, content-sized, and transparent to
 * touches wherever it is not painted.
 */
function ContextualScrollUtility({
  indexVisible,
  indexLabel,
  latestVisible,
  unreadCount,
  bottomOffset,
  onIndexPress,
  onLatestPress,
}: {
  indexVisible: boolean
  indexLabel: string
  latestVisible: boolean
  unreadCount: number
  bottomOffset: number
  onIndexPress: () => void
  onLatestPress: () => void
}) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const countLabel = unreadCount > 99 ? '99+' : String(unreadCount)
  const latestAccessibilityLabel = unreadCount > 0
    ? t('chat.scrollToBottomWithUnread', { count: unreadCount })
    : t('chat.scrollToBottom')
  const duration = motion === 'full' ? 176 : 1
  const pillStyle = {
    height: 34,
    paddingHorizontal: 11,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.ui.semantic.surface.base,
    borderWidth: 1,
    borderColor: colors.ui.semantic.chrome.border,
  } as const

  if (!indexVisible && !latestVisible) return null

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', right: 12, bottom: bottomOffset, zIndex: 36, alignItems: 'flex-end', gap: 6 }}
    >
      <MotiView
        pointerEvents={indexVisible ? 'auto' : 'none'}
        aria-hidden={!indexVisible}
        accessibilityElementsHidden={!indexVisible}
        importantForAccessibility={indexVisible ? 'auto' : 'no-hide-descendants'}
        animate={{ opacity: indexVisible ? 1 : 0, translateY: indexVisible ? 0 : 4 }}
        transition={{ type: 'timing', duration }}
      >
        <IslePressable
          haptic
          testID="chat-conversation-navigation-toggle"
          accessibilityRole="button"
          accessibilityLabel={t('chat.conversationNavigation')}
          accessibilityHint={t('chat.conversationNavigationTrackHint')}
          accessibilityState={{ expanded: false }}
          disabled={!indexVisible}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          onPress={onIndexPress}
          style={pillStyle}
        >
          <AppIcon name="conversation" color={colors.textSecondary} size={14} strokeWidth={appIconStroke.regular} />
          <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 14, fontWeight: '700', fontVariant: ['tabular-nums'], includeFontPadding: false }}>
            {indexLabel}
          </Text>
        </IslePressable>
      </MotiView>
      <MotiView
        pointerEvents={latestVisible ? 'auto' : 'none'}
        aria-hidden={!latestVisible}
        accessibilityElementsHidden={!latestVisible}
        importantForAccessibility={latestVisible ? 'auto' : 'no-hide-descendants'}
        animate={{ opacity: latestVisible ? 1 : 0, translateY: latestVisible ? 0 : 6, scale: latestVisible ? 1 : 0.96 }}
        transition={{ type: 'timing', duration }}
      >
        <IslePressable
          haptic
          testID="chat-scroll-to-latest"
          accessibilityRole="button"
          accessibilityLabel={latestAccessibilityLabel}
          disabled={!latestVisible}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          onPress={onLatestPress}
          style={[pillStyle, { minWidth: ISLE_MIN_TOUCH_TARGET }]}
        >
          <AppIcon name="arrow-down" color={colors.ui.icon.accentForeground} size={16} strokeWidth={appIconStroke.strong} />
          <Text style={{ color: colors.text, fontSize: 11, lineHeight: 14, fontWeight: '800', includeFontPadding: false }}>
            {t('chat.latestShort')}
          </Text>
          {unreadCount > 0 ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: -6,
                right: -6,
                minWidth: 18,
                height: 18,
                borderRadius: 9,
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
    </View>
  )
}
