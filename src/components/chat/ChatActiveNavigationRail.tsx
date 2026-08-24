import { Text, View } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'

import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'

import { ConversationNavigationRail } from './ConversationNavigationRail'
import type { useChatMessageListScrollController } from './chatMessageListScrollState'

type ChatMessageListController = ReturnType<typeof useChatMessageListScrollController>

export interface ChatActiveNavigationRailProps {
  messageListBottomPadding: number
  messageListController: ChatMessageListController
  messageListTopInset: number
  visualTopInset: number
}

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

  return (
    <>
      {showAssistantNavigation && activeAssistantNavigationItem ? (
        <ConversationNavigationRail
          items={assistantNavigationItems}
          activeIndex={activeAssistantNavigationIndex}
          visible={assistantNavigationFloatingVisible}
          topOffset={Math.max(visualTopInset + 70, messageListTopInset + 8)}
          bottomOffset={messageListBottomPadding + 12}
          onSelect={scrollToAssistantNavigationItem}
          onInteractionStart={handleAssistantNavigationInteractionStart}
          onInteractionEnd={handleAssistantNavigationInteractionEnd}
        />
      ) : null}
      <ScrollToBottomControl
        visible={messageListAwayFromBottom}
        unreadCount={unreadMessageCount}
        bottomOffset={messageListBottomPadding + 12}
        onPress={scrollToMessageListBottom}
      />
    </>
  )
}

function ScrollToBottomControl({
  visible,
  unreadCount,
  bottomOffset,
  onPress,
}: {
  visible: boolean
  unreadCount: number
  bottomOffset: number
  onPress: () => void
}) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const countLabel = unreadCount > 99 ? '99+' : String(unreadCount)
  const accessibilityLabel = unreadCount > 0
    ? t('chat.scrollToBottomWithUnread', { count: unreadCount })
    : t('chat.scrollToBottom')

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: bottomOffset, zIndex: 36, alignItems: 'center' }}
    >
      <MotiView
        pointerEvents={visible ? 'auto' : 'none'}
        animate={{ opacity: visible ? 1 : 0, translateY: visible ? 0 : 6, scale: visible ? 1 : 0.96 }}
        transition={{ type: 'timing', duration: motion === 'full' ? 176 : 1 }}
      >
        <IslePressable
          haptic
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled: !visible }}
          disabled={!visible}
          onPress={onPress}
          style={{
            width: ISLE_MIN_TOUCH_TARGET,
            height: ISLE_MIN_TOUCH_TARGET,
            borderRadius: ISLE_MIN_TOUCH_TARGET / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.ui.semantic.surface.base,
            borderWidth: 1,
            borderColor: colors.ui.semantic.chrome.border,
            shadowColor: colors.shadowTint,
            shadowOpacity: 0.11,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 3,
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
    </View>
  )
}
