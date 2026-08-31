import type { ReactNode } from 'react'
import { StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
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
  /** Safe-area padding painted inside the chrome band, not above it. */
  topInset?: number
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

/**
 * Application chrome, not a card in the page.
 *
 * The band is edge to edge, paints its own safe-area inset, and separates from
 * the canvas by one rule or one tonal step. Model and conversation names are
 * information levels; the controls are transparent hit areas.
 */
export function ChatPersistentHeader({
  themeId,
  colors,
  title,
  subtitle,
  subtitleColor,
  topInset = 0,
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
  const { width: viewportWidth } = useWindowDimensions()
  const motion = useMotionPreference()
  const { active: leadingActive, running: leadingRunning, trigger: triggerLeading } = useNavigationTrigger(onLeadingPress)
  const minimal = themeId === 'minimal'
  const monet = themeId === 'monet'
  const material = themeId === 'material'
  const glass = themeId === 'liquid-glass'
  const compactHeaderLayout = viewportWidth <= 360
  const controlStyle: ViewStyle = {
    width: ISLE_MIN_TOUCH_TARGET,
    height: ISLE_MIN_TOUCH_TARGET,
    borderRadius: minimal ? 2 : material ? 22 : 24,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  }
  const iconStyle: StyleProp<ViewStyle> = [controlStyle, leadingIconStyle]

  const leadingControl = (
    <IsleOverlayPressable
      onPress={triggerLeading}
      disabled={leadingRunning}
      accessibilityRole="button"
      accessibilityLabel={leadingLabel}
      style={iconStyle}
    >
      <AnimatedNavigationIcon glyph={leadingGlyph} active={leadingActive} color={colors.textSecondary} accentColor={colors.ui.icon.accentForeground} size={22} />
    </IsleOverlayPressable>
  )

  const modelControl = (
    <IsleOverlayPressable
      onPress={onModelPress}
      accessibilityRole="button"
      accessibilityLabel={modelAccessibilityLabel ?? `${t('chat.model')}: ${title}`}
      accessibilityHint={modelAccessibilityHint ?? t('chat.quickModelAccessibilityHint')}
      accessibilityState={{ expanded: modelMenuOpen }}
      style={[
        styles.modelControl,
        monet ? styles.modelControlMonet : null,
        glass ? styles.modelControlGlass : null,
        modelMenuOpen
          ? { backgroundColor: colors.ui.actionBar.itemActiveBackground, borderRadius: minimal ? 2 : 20 }
          : null,
      ]}
    >
      <MotiView
        key={`${title}:${subtitle ?? ''}`}
        from={motion === 'full' ? { opacity: 0.72, translateY: monet ? 3 : 2 } : undefined}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: motion === 'full' ? (monet ? 240 : 176) : 1 }}
        style={styles.modelIdentity}
      >
        <View style={styles.modelTitleRow}>
          {!compactHeaderLayout && modelIcon ? (
            <View style={styles.modelIconFrame}>
              {modelIcon}
              {modelStatusColor ? <View pointerEvents="none" style={[styles.modelStatusDot, { backgroundColor: modelStatusColor, borderColor: colors.ui.semantic.surface.canvas }]} /> : null}
            </View>
          ) : modelStatusColor ? (
            <View style={[styles.modelStatusOnly, { backgroundColor: modelStatusColor }]} />
          ) : null}
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            ellipsizeMode="middle"
            style={[
              styles.modelTitle,
              minimal ? styles.modelTitleMinimal : null,
              monet ? styles.modelTitleMonet : null,
              material ? styles.modelTitleMaterial : null,
              glass ? styles.modelTitleGlass : null,
              { color: colors.text },
            ]}
          >
            {title}
          </Text>
          <MotiView
            animate={{ rotate: modelMenuOpen ? '180deg' : '0deg' }}
            transition={{ type: 'timing', duration: motion === 'full' ? (glass ? 220 : 176) : 1 }}
            style={styles.modelChevron}
          >
            <AppIcon name="arrow-down" color={colors.textTertiary} size={13} strokeWidth={appIconStroke.strong} />
          </MotiView>
        </View>
        {subtitle ? (
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.modelSubtitle, { color: subtitleColor ?? colors.textTertiary, fontWeight: subtitleColor ? '700' : '500' }]}
          >
            {subtitle}
          </Text>
        ) : null}
      </MotiView>
    </IsleOverlayPressable>
  )

  const newConversationAction = (
    <IsleOverlayPressable onPress={onNewConversation} accessibilityRole="button" accessibilityLabel={t('chat.newConversation')} style={controlStyle}>
      <AppIcon name="new-chat" color={colors.textSecondary} size={19} strokeWidth={appIconStroke.regular} />
    </IsleOverlayPressable>
  )
  const settingsAction = (
    <IsleOverlayPressable
      onPress={onSettings}
      accessibilityRole="button"
      accessibilityLabel={t('settings.title')}
      style={[controlStyle, settingsTransitionActive ? { backgroundColor: colors.ui.actionBar.itemActiveBackground } : null]}
    >
      <AppIcon name="settings" color={colors.textSecondary} size={19} strokeWidth={appIconStroke.regular} />
    </IsleOverlayPressable>
  )
  const actions = <>{trailingContent}{newConversationAction}{settingsAction}</>

  const bandHeight = material
    ? (subtitle ? 60 : 56)
    : monet || glass
      ? (subtitle ? 54 : 50)
      : (subtitle ? 50 : 46)

  return (
    <ChatChromeThemeSurface themeId={themeId} colors={colors} alertBorder={alertBorder} onLayout={onLayout}>
      <View style={[styles.header, { paddingTop: topInset, minHeight: bandHeight + topInset }]}>
        <View style={styles.leadingSlot}>{leadingControl}</View>
        {minimal ? <View pointerEvents="none" style={[styles.minimalHeaderIndex, { backgroundColor: colors.ui.control.primaryBackground }]} /> : null}
        {modelControl}
        <View style={styles.actions}>{actions}</View>
      </View>
    </ChatChromeThemeSurface>
  )
}

const styles = StyleSheet.create({
  header: { position: 'relative', minWidth: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 },
  leadingSlot: { width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  actions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 0 },
  minimalHeaderIndex: { width: 2, height: 20, marginLeft: 4, opacity: 0.72 },
  modelControl: { flex: 1, minWidth: 0, minHeight: ISLE_MIN_TOUCH_TARGET, marginLeft: 6, justifyContent: 'center', paddingHorizontal: 4 },
  modelControlMonet: { paddingHorizontal: 8 },
  modelControlGlass: { paddingHorizontal: 8 },
  modelIdentity: { maxWidth: '100%', minWidth: 0, alignItems: 'flex-start' },
  modelTitleRow: { maxWidth: '100%', minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  modelIconFrame: { width: 19, height: 19, alignItems: 'center', justifyContent: 'center' },
  modelStatusDot: { position: 'absolute', right: -2, bottom: -1, width: 7, height: 7, borderRadius: 4, borderWidth: 1.5 },
  modelStatusOnly: { width: 7, height: 7, borderRadius: 4 },
  modelTitle: { flexShrink: 1, minWidth: 0, includeFontPadding: false },
  modelTitleMinimal: { fontSize: 14, lineHeight: 18, fontWeight: '700' },
  modelTitleMonet: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  modelTitleMaterial: { fontSize: 16, lineHeight: 21, fontWeight: '500' },
  modelTitleGlass: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  modelChevron: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  modelSubtitle: { maxWidth: '100%', marginTop: 1, fontSize: 10.5, lineHeight: 14, includeFontPadding: false, textAlign: 'left' },
})
