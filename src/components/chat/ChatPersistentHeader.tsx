import type { ReactNode } from 'react'
import { Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
import { useTranslation } from 'react-i18next'
import { MotiView } from 'moti'

import { useNavigationTrigger, type NavigationGlyph } from '@/components/navigation/AnimatedNavigationTrigger'
import { AnimatedNavigationIcon } from '@/components/navigation/AnimatedNavigationIcon'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IsleOverlayPressable } from '@/components/ui/isle'
import type { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import type { CanonicalThemeId } from '@/types/settingsContracts'

import { ChatChromeThemeSurface } from './theme-surfaces/ChatThemeSurfaces'

type HeaderColors = ReturnType<typeof useAppTheme>['colors']

export interface ChatPersistentHeaderProps {
  themeId: CanonicalThemeId
  colors: HeaderColors
  title: string
  subtitle?: string
  subtitleColor?: string
  modelIcon?: ReactNode
  modelStatusColor?: string
  modelMenuOpen?: boolean
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
  subtitle,
  subtitleColor,
  modelIcon,
  modelStatusColor,
  modelMenuOpen = false,
  leadingGlyph,
  leadingLabel,
  onLeadingPress,
  onModelPress,
  onNewConversation,
  onSettings,
  settingsTransitionActive = false,
  alertBorder,
  onLayout,
  modelAccessibilityLabel,
  modelAccessibilityHint,
  leadingIconStyle,
  trailingContent,
}: ChatPersistentHeaderProps) {
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const { active: leadingActive, running: leadingRunning, trigger: triggerLeading } = useNavigationTrigger(onLeadingPress)
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
      <View style={{ minHeight: subtitle ? 58 : 52, position: 'relative', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }}>
        <View style={{ width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
          <IsleOverlayPressable
            onPress={triggerLeading}
            disabled={leadingRunning}
            accessibilityRole="button"
            accessibilityLabel={leadingLabel}
            style={iconStyle}
          >
            <AnimatedNavigationIcon glyph={leadingGlyph} active={leadingActive} color={colors.textSecondary} accentColor={colors.ui.icon.accentForeground} size={22} />
          </IsleOverlayPressable>
        </View>
        <IsleOverlayPressable
          onPress={onModelPress}
          accessibilityRole="button"
          accessibilityLabel={modelAccessibilityLabel ?? `${t('chat.model')}: ${title}`}
          accessibilityHint={modelAccessibilityHint ?? t('chat.quickModelAccessibilityHint')}
          accessibilityState={{ expanded: modelMenuOpen }}
          style={{
            position: 'absolute',
            top: 0,
            right: titleSafeInset,
            bottom: 0,
            left: titleSafeInset,
            minHeight: ISLE_MIN_TOUCH_TARGET,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 4,
          }}
        >
          <MotiView
            key={`${title}:${subtitle ?? ''}`}
            from={motion === 'full' ? { opacity: 0.72, translateY: 2 } : undefined}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: motion === 'full' ? 176 : 1 }}
            style={{ maxWidth: '100%', minWidth: 0, alignItems: 'center' }}
          >
            <View style={{ maxWidth: '100%', minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {modelIcon ? (
                <View style={{ width: 19, height: 19, alignItems: 'center', justifyContent: 'center' }}>
                  {modelIcon}
                  {modelStatusColor ? (
                    <View
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        right: -2,
                        bottom: -1,
                        width: 7,
                        height: 7,
                        borderRadius: 4,
                        backgroundColor: modelStatusColor,
                        borderWidth: 1.5,
                        borderColor: colors.ui.semantic.surface.base,
                      }}
                    />
                  ) : null}
                </View>
              ) : modelStatusColor ? (
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: modelStatusColor }} />
              ) : null}
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                ellipsizeMode="middle"
                style={{ flexShrink: 1, minWidth: 0, color: colors.text, fontSize: 15, lineHeight: 19, fontWeight: '800', includeFontPadding: false, textAlign: 'center' }}
              >
                {title}
              </Text>
              <MotiView
                animate={{ rotate: modelMenuOpen ? '180deg' : '0deg' }}
                transition={{ type: 'timing', duration: motion === 'full' ? 176 : 1 }}
                style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}
              >
                <AppIcon name="arrow-down" color={colors.textTertiary} size={13} strokeWidth={appIconStroke.strong} />
              </MotiView>
            </View>
            {subtitle ? (
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{ maxWidth: '100%', marginTop: 1, color: subtitleColor ?? colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: subtitleColor ? '700' : '500', includeFontPadding: false, textAlign: 'center' }}
              >
                {subtitle}
              </Text>
            ) : null}
          </MotiView>
        </IsleOverlayPressable>
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
