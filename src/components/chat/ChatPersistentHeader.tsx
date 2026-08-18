import type { ReactNode } from 'react'
import { Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
import { useTranslation } from 'react-i18next'

import { AnimatedNavigationTrigger, type NavigationGlyph } from '@/components/navigation/AnimatedNavigationTrigger'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IsleOverlayPressable } from '@/components/ui/isle'
import type { useAppTheme } from '@/hooks/useAppTheme'
import type { ThemeId } from '@/types/settingsContracts'

import { ChatChromeThemeSurface } from './theme-surfaces/ChatThemeSurfaces'

type HeaderColors = ReturnType<typeof useAppTheme>['colors']

export interface ChatPersistentHeaderProps {
  themeId: ThemeId
  colors: HeaderColors
  title: string
  leadingGlyph: NavigationGlyph
  leadingLabel: string
  onLeadingPress: () => void
  onModelPress: () => void
  onNewConversation: () => void
  onSettings: () => void
  settingsTransitionActive?: boolean
  alertBorder?: string
  onLayout?: (event: LayoutChangeEvent) => void
  modelAccessibilityLabel?: string
  modelAccessibilityHint?: string
  leadingIconStyle?: StyleProp<ViewStyle>
  trailingContent?: ReactNode
}

export function ChatPersistentHeader({
  themeId,
  colors,
  title,
  leadingGlyph,
  leadingLabel,
  onLeadingPress,
  onNewConversation,
  onSettings,
  settingsTransitionActive = false,
  alertBorder,
  onLayout,
  leadingIconStyle,
  trailingContent,
}: ChatPersistentHeaderProps) {
  const { t } = useTranslation()
  const iconStyle: StyleProp<ViewStyle> = [
    {
      width: ISLE_MIN_TOUCH_TARGET,
      height: ISLE_MIN_TOUCH_TARGET,
      borderRadius: colors.ui.radius.controlMiddle,
      backgroundColor: 'transparent',
      borderWidth: 0,
      shadowOpacity: 0,
      elevation: 0,
    },
    leadingIconStyle,
  ]
  const actionStyle: StyleProp<ViewStyle> = {
    width: ISLE_MIN_TOUCH_TARGET,
    height: ISLE_MIN_TOUCH_TARGET,
    borderRadius: colors.ui.radius.controlMiddle,
    backgroundColor: 'transparent',
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
  }
  const titleSafeInset = ISLE_MIN_TOUCH_TARGET * 2 + 12

  return (
    <ChatChromeThemeSurface themeId={themeId} colors={colors} alertBorder={alertBorder} onLayout={onLayout}>
      <View style={{ minHeight: 52, position: 'relative', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }}>
        <View style={{ width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
          <AnimatedNavigationTrigger
            variant="iconButton"
            label={leadingLabel}
            glyph={leadingGlyph}
            onNavigate={onLeadingPress}
            color={colors.textSecondary}
            style={iconStyle}
          />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: titleSafeInset, bottom: 0, left: titleSafeInset, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}>
          <Text accessibilityRole="header" numberOfLines={1} ellipsizeMode="tail" style={{ maxWidth: '100%', color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: '700', includeFontPadding: false, textAlign: 'center' }}>
            {title}
          </Text>
        </View>
        <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          {trailingContent}
          <IsleOverlayPressable
            onPress={onNewConversation}
            accessibilityRole="button"
            accessibilityLabel={t('chat.newConversation')}
            style={[actionStyle, { alignItems: 'center', justifyContent: 'center' }]}
          >
            <AppIcon name="new-chat" color={colors.textSecondary} size={19} strokeWidth={appIconStroke.regular} />
          </IsleOverlayPressable>
          <IsleOverlayPressable
            onPress={onSettings}
            accessibilityRole="button"
            accessibilityLabel={t('settings.title')}
            style={settingsTransitionActive ? { ...actionStyle, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.actionBar.itemActiveBackground } : [actionStyle, { alignItems: 'center', justifyContent: 'center' }]}
          >
            <AppIcon name="settings" color={colors.textSecondary} size={19} strokeWidth={appIconStroke.regular} />
          </IsleOverlayPressable>
        </View>
      </View>
    </ChatChromeThemeSurface>
  )
}
