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
  const { width: viewportWidth } = useWindowDimensions()
  const motion = useMotionPreference()
  const { active: leadingActive, running: leadingRunning, trigger: triggerLeading } = useNavigationTrigger(onLeadingPress)
  const minimal = themeId === 'minimal'
  const monet = themeId === 'monet'
  const material = themeId === 'material'
  const glass = themeId === 'liquid-glass'
  const iconStyle: StyleProp<ViewStyle> = [
    {
      width: ISLE_MIN_TOUCH_TARGET,
      height: ISLE_MIN_TOUCH_TARGET,
      borderRadius: minimal ? 4 : monet ? 14 : material ? 20 : 22,
      backgroundColor: 'transparent',
      borderWidth: 0,
      shadowOpacity: 0,
      elevation: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    leadingIconStyle,
  ]
  const actionStyle: StyleProp<ViewStyle> = {
    width: ISLE_MIN_TOUCH_TARGET,
    height: ISLE_MIN_TOUCH_TARGET,
    borderRadius: minimal ? 4 : monet ? 14 : material ? 20 : 22,
    backgroundColor: 'transparent',
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
    alignItems: 'center',
    justifyContent: 'center',
  }
  const compactHeaderLayout = viewportWidth <= 340

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
        minimal ? styles.modelControlMinimal : null,
        monet ? styles.modelControlMonet : null,
        material ? styles.modelControlMaterial : null,
        glass ? styles.modelControlGlass : null,
        modelMenuOpen ? { backgroundColor: colors.ui.actionBar.itemActiveBackground } : null,
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
          {!compactHeaderLayout ? (
            modelIcon ? (
              <View style={styles.modelIconFrame}>
                {modelIcon}
                {modelStatusColor ? <View pointerEvents="none" style={[styles.modelStatusDot, { backgroundColor: modelStatusColor, borderColor: colors.ui.semantic.surface.base }]} /> : null}
              </View>
            ) : modelStatusColor ? (
              <View style={[styles.modelStatusOnly, { backgroundColor: modelStatusColor }]} />
            ) : null
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
            style={[styles.modelChevron, material ? styles.materialChevron : null, glass ? styles.glassChevron : null]}
          >
            <AppIcon name="arrow-down" color={colors.textTertiary} size={13} strokeWidth={appIconStroke.strong} />
          </MotiView>
        </View>
        {subtitle ? (
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[
              styles.modelSubtitle,
              { color: subtitleColor ?? colors.textTertiary, fontWeight: subtitleColor ? '700' : '500' },
            ]}
          >
            {subtitle}
          </Text>
        ) : null}
      </MotiView>
    </IsleOverlayPressable>
  )

  const newConversationAction = (
    <IsleOverlayPressable onPress={onNewConversation} accessibilityRole="button" accessibilityLabel={t('chat.newConversation')} style={actionStyle}>
      <AppIcon name="new-chat" color={colors.textSecondary} size={19} strokeWidth={appIconStroke.regular} />
    </IsleOverlayPressable>
  )
  const settingsAction = (
    <IsleOverlayPressable
      onPress={onSettings}
      accessibilityRole="button"
      accessibilityLabel={t('settings.title')}
      style={[actionStyle, settingsTransitionActive ? { backgroundColor: colors.ui.actionBar.itemActiveBackground } : null]}
    >
      <AppIcon name="settings" color={colors.textSecondary} size={19} strokeWidth={appIconStroke.regular} />
    </IsleOverlayPressable>
  )
  const actions = <>{trailingContent}{newConversationAction}{settingsAction}</>

  return (
    <ChatChromeThemeSurface themeId={themeId} colors={colors} alertBorder={alertBorder} onLayout={onLayout}>
      <View style={[styles.header, { minHeight: subtitle ? 58 : 52 }]}>
        <View style={styles.leadingSlot}>{leadingControl}</View>
        {modelControl}
        <View style={styles.actions}>{actions}</View>
      </View>
    </ChatChromeThemeSurface>
  )
}

const styles = StyleSheet.create({
  header: { position: 'relative', minWidth: 0, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center' },
  leadingSlot: { width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  modelControl: { flex: 1, minWidth: 0, minHeight: ISLE_MIN_TOUCH_TARGET, marginHorizontal: 3, paddingHorizontal: 8, justifyContent: 'center', overflow: 'hidden' },
  modelControlMinimal: { borderRadius: 4 },
  modelControlMonet: { borderRadius: 14 },
  modelControlMaterial: { borderRadius: 20 },
  modelControlGlass: { borderRadius: 22 },
  modelIdentity: { maxWidth: '100%', minWidth: 0, alignItems: 'flex-start' },
  modelIdentityCentered: { alignItems: 'center' },
  modelTitleRow: { maxWidth: '100%', minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  modelTitleRowCentered: { justifyContent: 'center' },
  modelIconFrame: { width: 19, height: 19, alignItems: 'center', justifyContent: 'center' },
  modelStatusDot: { position: 'absolute', right: -2, bottom: -1, width: 7, height: 7, borderRadius: 4, borderWidth: 1.5 },
  modelStatusOnly: { width: 7, height: 7, borderRadius: 4 },
  modelTitle: { flexShrink: 1, minWidth: 0, includeFontPadding: false },
  modelTitleMinimal: { fontSize: 14, lineHeight: 18, fontWeight: '700' },
  modelTitleMonet: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
  modelTitleMaterial: { fontSize: 16, lineHeight: 21, fontWeight: '500' },
  modelTitleGlass: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  modelChevron: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  materialChevron: { width: 22, height: 22, borderRadius: 11 },
  glassChevron: { width: 24, height: 24, borderRadius: 12 },
  modelSubtitle: { maxWidth: '100%', marginTop: 1, fontSize: 10.5, lineHeight: 14, includeFontPadding: false, textAlign: 'left' },
  actions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 0 },
  modelSubtitleCentered: { textAlign: 'center' },
  minimalModelRule: { width: 36, height: StyleSheet.hairlineWidth, marginTop: 3 },
  monetModelWash: { position: 'absolute', top: -12, right: -14, width: 104, height: 38, borderBottomLeftRadius: 32, opacity: 0.2 },
  monetModelBrushRow: { width: 76, height: 3, marginTop: 3, flexDirection: 'row', gap: 4, opacity: 0.62 },
  monetModelBrushLong: { flex: 1, borderRadius: 2 },
  monetModelBrushShort: { width: 18, borderRadius: 2 },
  materialModelIndicator: { position: 'absolute', right: 24, bottom: -5, left: 24, height: 3, borderRadius: 2 },
  glassModelHighlight: { position: 'absolute', top: 2, right: 22, left: 22, height: StyleSheet.hairlineWidth, opacity: 0.46 },
  minimalHeader: { paddingHorizontal: 8 },
  minimalHeaderIndex: { width: 2, height: 24, marginLeft: 5, opacity: 0.72 },
  minimalActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 0 },
  monetHeader: { paddingHorizontal: 8, overflow: 'hidden' },
  monetHeaderPlane: { position: 'absolute', top: -28, right: 120, width: 190, height: 74, borderBottomLeftRadius: 58, borderBottomRightRadius: 20, opacity: 0.18, transform: [{ rotate: '-4deg' }] },
  monetLeadingPetal: { borderTopLeftRadius: 20, borderTopRightRadius: 10, borderBottomRightRadius: 22, borderBottomLeftRadius: 12, overflow: 'hidden' },
  monetActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5 },
  materialHeader: { paddingHorizontal: 8 },
  materialActions: { marginLeft: 'auto', paddingHorizontal: 2, flexDirection: 'row', alignItems: 'center', gap: 0, borderRadius: 24 },
  glassHeader: { paddingHorizontal: 5, overflow: 'hidden', borderRadius: 26 },
  // The GlassSurface wrapper supplies borderRadius + clip; drop the opaque
  // margin-based shell so the realtime blur reads cleanly at the edges.
  glassHeaderShell: { margin: 3 },
  glassHeaderTint: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  glassHeaderInnerPlane: { position: 'absolute', top: 2, right: 2, bottom: 2, left: 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: 24, opacity: 0.38 },
  glassHeaderSpecular: { position: 'absolute', top: 2, right: 52, left: 52, height: StyleSheet.hairlineWidth, opacity: 0.52 },
  glassLeadingLens: { zIndex: 1 },
  glassActions: { zIndex: 1, marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5 },
})
