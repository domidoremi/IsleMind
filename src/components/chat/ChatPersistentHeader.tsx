import type { ReactNode } from 'react'
import { Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
import { useTranslation } from 'react-i18next'

import { AnimatedNavigationTrigger, type NavigationGlyph } from '@/components/navigation/AnimatedNavigationTrigger'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { IsleOverlayPressable } from '@/components/ui/isle'
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
      width: 38,
      height: 38,
      borderRadius: Math.min(colors.ui.radius.controlMiddle, 8),
      backgroundColor: 'transparent',
      borderWidth: 0,
      shadowOpacity: 0,
      elevation: 0,
    },
    leadingIconStyle,
  ]
  const actionStyle: StyleProp<ViewStyle> = {
    width: 38,
    height: 38,
    borderRadius: Math.min(colors.ui.radius.controlMiddle, 8),
    backgroundColor: 'transparent',
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
  }

  return (
    <ChatChromeThemeSurface themeId={themeId} colors={colors} alertBorder={alertBorder} onLayout={onLayout}>
      <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8 }}>
        <View style={{ minWidth: 0, flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
          <AnimatedNavigationTrigger
            variant="iconButton"
            label={leadingLabel}
            glyph={leadingGlyph}
            onNavigate={onLeadingPress}
            color={colors.text}
            style={iconStyle}
          />
          <Text numberOfLines={1} style={{ maxWidth: 52, marginLeft: -1, color: colors.textSecondary, fontSize: 11.5, lineHeight: 16, fontWeight: '700', includeFontPadding: false }}>
            {leadingLabel}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, minHeight: 38, justifyContent: 'center', paddingHorizontal: 7 }}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '700', includeFontPadding: false }}>
            {title}
          </Text>
        </View>
        {trailingContent}
        <IsleOverlayPressable
          onPress={onNewConversation}
          accessibilityRole="button"
          accessibilityLabel={t('chat.newConversation')}
          hitSlop={8}
          style={[actionStyle, { alignItems: 'center', justifyContent: 'center' }]}
        >
          <AppIcon name="new-chat" color={colors.text} size={19} strokeWidth={appIconStroke.strong} />
        </IsleOverlayPressable>
        <IsleOverlayPressable
          onPress={onSettings}
          accessibilityRole="button"
          accessibilityLabel={t('settings.title')}
          hitSlop={8}
          style={settingsTransitionActive ? { ...actionStyle, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.actionBar.itemActiveBackground } : [actionStyle, { alignItems: 'center', justifyContent: 'center' }]}
        >
          <AppIcon name="settings" color={colors.text} size={19} strokeWidth={appIconStroke.strong} />
        </IsleOverlayPressable>
      </View>
    </ChatChromeThemeSurface>
  )
}
