import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { resolveThemeComponentExpression } from '@/theme/themeExpression'

export function ProgramErrorBanner({
  title,
  message,
  topOffset,
  compact,
  onDismiss,
}: {
  title: string
  message: string
  topOffset: number
  compact: boolean
  onDismiss: () => void
}) {
  const { colors, isGlass, canonicalThemeId, design } = useAppTheme()
  const { t } = useTranslation()
  const tone = colors.ui.tone.danger
  const expression = resolveThemeComponentExpression(canonicalThemeId, 'errorState')
  const grammar = expression.motion
  const minimal = canonicalThemeId === 'minimal'
  const monet = canonicalThemeId === 'monet'
  const material = canonicalThemeId === 'material'
  const glass = canonicalThemeId === 'liquid-glass'
  const radius = minimal ? 0 : monet ? 16 : material ? design?.semantic.radius.extraLarge ?? 16 : design?.semantic.radius.extraLarge ?? 18
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: topOffset, left: 0, right: 0, zIndex: 46, paddingHorizontal: compact ? 12 : 16 }}>
      <View
        testID={`theme-error-state-${canonicalThemeId}`}
        accessibilityRole="alert"
        accessibilityLabel={`${title}. ${message}`}
        style={{
          minHeight: compact ? 48 : 54,
          position: 'relative',
          borderRadius: radius,
          borderWidth: minimal ? 0 : 1,
          borderLeftWidth: minimal ? 3 : undefined,
          borderBottomWidth: minimal ? StyleSheet.hairlineWidth : undefined,
          borderColor: tone.border,
          borderLeftColor: minimal ? tone.foreground : tone.border,
          backgroundColor: glass ? colors.ui.semantic.chrome.background : material ? colors.ui.semantic.surface.muted : monet || isGlass ? tone.background : colors.ui.semantic.surface.base,
          paddingHorizontal: minimal ? 10 : material ? 14 : 12,
          paddingVertical: minimal ? 8 : material ? 12 : 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          shadowColor: tone.foreground,
          shadowOpacity: glass ? 0.16 : monet ? 0.07 : 0,
          shadowRadius: glass ? 14 : monet ? 9 : 0,
          shadowOffset: { width: 0, height: 5 },
          elevation: glass ? 3 : monet ? 1 : 0,
          overflow: 'hidden',
        }}
      >
        {monet ? <View accessible={false} pointerEvents="none" style={{ position: 'absolute', width: 72, height: 42, borderRadius: 36, right: -12, top: -18, backgroundColor: colors.ui.icon.accentBackground, opacity: 0.24 }} /> : null}
        {material ? <View accessible={false} pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: tone.background, opacity: 0.34 }} /> : null}
        {glass ? <View accessible={false} pointerEvents="none" style={{ position: 'absolute', top: 1, right: 18, left: 18, height: StyleSheet.hairlineWidth, backgroundColor: colors.ui.control.primaryForeground, opacity: 0.58 }} /> : null}
        <View style={{ width: minimal ? 20 : material ? 34 : 28, height: minimal ? 28 : material ? 34 : 28, borderRadius: minimal ? 0 : material ? 10 : 14, alignItems: 'center', justifyContent: 'center', backgroundColor: minimal ? 'transparent' : tone.background, borderWidth: minimal ? 0 : StyleSheet.hairlineWidth, borderColor: tone.border }}>
          <AppIcon name="warning" color={tone.foreground} size={16} strokeWidth={appIconStroke.strong} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: tone.foreground, fontSize: 12.5, lineHeight: 16, fontWeight: '800', includeFontPadding: false }}>{title}</Text>
          <Text numberOfLines={2} style={{ color: colors.text, fontSize: 12, lineHeight: 16, marginTop: 2, includeFontPadding: false }}>{message}</Text>
        </View>
        <IslePressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.programErrorDismissAccessibilityLabel')}
          onPress={onDismiss}
          style={{
            width: ISLE_MIN_TOUCH_TARGET,
            height: ISLE_MIN_TOUCH_TARGET,
            borderRadius: minimal ? 2 : material ? 12 : glass ? 22 : colors.ui.radius.controlMiddle,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: minimal ? 'transparent' : material ? tone.background : colors.ui.semantic.surface.muted,
            borderWidth: expression.border === 'none' ? 0 : StyleSheet.hairlineWidth,
            borderColor: colors.ui.semantic.chrome.border,
          }}
        >
          {grammar === 'fluid' ? <View accessible={false} pointerEvents="none" style={{ position: 'absolute', top: 2, right: 10, left: 10, height: StyleSheet.hairlineWidth, backgroundColor: colors.ui.control.primaryForeground, opacity: 0.48 }} /> : null}
          <AppIcon name="close" color={colors.textSecondary} size={15} strokeWidth={appIconStroke.fine} />
        </IslePressable>
      </View>
    </View>
  )
}
