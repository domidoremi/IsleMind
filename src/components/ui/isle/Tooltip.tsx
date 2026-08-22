import type { ReactNode } from 'react'
import { StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { AnimatePresence, MotiView } from 'moti'

import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { resolveThemeComponentExpression } from '@/theme/themeExpression'
import type { CanonicalThemeId } from '@/types/settingsContracts'

export interface IsleTooltipProps {
  label: string
  visible: boolean
  children: ReactNode
  placement?: 'top' | 'bottom'
  maxWidth?: number
  testID?: string
}

const TOOLTIP_METRICS: Readonly<Record<CanonicalThemeId, Readonly<{
  radius: number
  paddingHorizontal: number
  paddingVertical: number
  offset: number
  fontSize: number
  fontWeight: '600' | '700' | '800'
}>>> = Object.freeze({
  minimal: { radius: 2, paddingHorizontal: 7, paddingVertical: 4, offset: 5, fontSize: 10, fontWeight: '700' },
  monet: { radius: 12, paddingHorizontal: 10, paddingVertical: 7, offset: 8, fontSize: 11, fontWeight: '600' },
  material: { radius: 8, paddingHorizontal: 9, paddingVertical: 6, offset: 7, fontSize: 11, fontWeight: '700' },
  'liquid-glass': { radius: 14, paddingHorizontal: 10, paddingVertical: 7, offset: 9, fontSize: 11, fontWeight: '700' },
})

export function IsleTooltip({
  label,
  visible,
  children,
  placement = 'top',
  maxWidth = 220,
  testID,
}: IsleTooltipProps) {
  const { colors, canonicalThemeId, design } = useAppTheme()
  const motion = useMotionPreference()
  const expression = resolveThemeComponentExpression(canonicalThemeId, 'tooltip')
  const metrics = TOOLTIP_METRICS[canonicalThemeId]
  const glass = canonicalThemeId === 'liquid-glass'
  const monet = canonicalThemeId === 'monet'
  const material = canonicalThemeId === 'material'
  const backgroundColor = glass
    ? colors.ui.semantic.chrome.background
    : monet
      ? colors.ui.semantic.surface.base
      : material
        ? colors.ui.semantic.surface.muted
        : colors.ui.semantic.surface.overlay
  const borderColor = expression.border === 'divider'
    ? colors.material.strokeStrong
    : glass
      ? colors.ui.actionBar.itemBorder
      : colors.ui.semantic.chrome.border
  const animatedFrom = motion === 'full'
    ? expression.motion === 'precision'
      ? { opacity: 0, translateY: placement === 'top' ? 2 : -2 }
      : expression.motion === 'organic'
        ? { opacity: 0, translateY: placement === 'top' ? 5 : -5, scale: 0.98 }
        : expression.motion === 'material'
          ? { opacity: 0, translateY: placement === 'top' ? 4 : -4, scale: 0.96 }
          : { opacity: 0, translateY: placement === 'top' ? 6 : -6, scale: 0.94 }
    : { opacity: 0 }
  const transition = motion !== 'full'
    ? { type: 'timing' as const, duration: 1 }
    : expression.motion === 'fluid'
      ? { type: 'spring' as const, damping: 20, stiffness: 260, mass: 0.72 }
      : { type: 'timing' as const, duration: expression.motion === 'precision' ? 90 : expression.motion === 'organic' ? 220 : 160 }
  const webGlassStyle = glass
    ? ({ backdropFilter: 'blur(14px) saturate(1.12)', WebkitBackdropFilter: 'blur(14px) saturate(1.12)' } as unknown as ViewStyle)
    : undefined

  return (
    <View style={{ position: 'relative', alignSelf: 'flex-start' }}>
      {children}
      <AnimatePresence>
        {visible ? (
          <MotiView
            key="isle-tooltip"
            testID={testID ?? `theme-tooltip-${canonicalThemeId}`}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            from={animatedFrom}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            exit={motion === 'full' ? { opacity: 0, scale: expression.motion === 'precision' ? 1 : 0.98 } : { opacity: 0 }}
            transition={transition}
            style={[
              {
                position: 'absolute',
                zIndex: 120,
                right: 0,
                ...(placement === 'top'
                  ? { bottom: '100%', marginBottom: metrics.offset }
                  : { top: '100%', marginTop: metrics.offset }),
                maxWidth,
                minWidth: canonicalThemeId === 'minimal' ? 0 : 44,
                borderRadius: glass ? design?.semantic.radius.pill ?? metrics.radius : metrics.radius,
                paddingHorizontal: metrics.paddingHorizontal,
                paddingVertical: metrics.paddingVertical,
                backgroundColor,
                borderWidth: expression.border === 'none' ? 0 : StyleSheet.hairlineWidth,
                borderColor,
                shadowColor: glass || monet ? colors.shadowTint : undefined,
                shadowOpacity: glass ? 0.16 : monet ? 0.08 : 0,
                shadowRadius: glass ? 14 : monet ? 9 : 0,
                shadowOffset: { width: 0, height: placement === 'top' ? 4 : 2 },
                elevation: glass ? 4 : monet ? 2 : 0,
                overflow: 'hidden',
              },
              webGlassStyle,
            ]}
          >
            {monet ? (
              <View
                style={{ position: 'absolute', width: 28, height: 18, borderRadius: 14, right: -4, top: -5, backgroundColor: colors.ui.icon.accentBackground, opacity: 0.42 }}
              />
            ) : null}
            {material ? (
              <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.ui.icon.accentBackground, opacity: 0.16 }} />
            ) : null}
            {glass ? (
              <View style={{ position: 'absolute', top: 1, right: 9, left: 9, height: StyleSheet.hairlineWidth, backgroundColor: colors.ui.control.primaryForeground, opacity: 0.5 }} />
            ) : null}
            <Text
              numberOfLines={3}
              style={{
                color: colors.text,
                fontSize: metrics.fontSize,
                lineHeight: metrics.fontSize + 4,
                fontWeight: metrics.fontWeight,
                letterSpacing: canonicalThemeId === 'minimal' ? 0.2 : 0,
                includeFontPadding: false,
              }}
            >
              {label}
            </Text>
          </MotiView>
        ) : null}
      </AnimatePresence>
    </View>
  )
}
