import type { ReactNode } from 'react'
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { useAppTheme } from '@/hooks/useAppTheme'
import { resolveThemeComponentExpression, type ThemeComponentId } from '@/theme/themeExpression'

export interface ThemeExpressionRegionProps {
  componentId: Extract<ThemeComponentId, 'knowledge' | 'memory' | 'menu'>
  children: ReactNode
  style?: StyleProp<ViewStyle>
  testID?: string
}

export function ThemeExpressionRegion({ componentId, children, style, testID }: ThemeExpressionRegionProps) {
  const { colors, canonicalThemeId, design } = useAppTheme()
  const expression = resolveThemeComponentExpression(canonicalThemeId, componentId)
  const minimal = canonicalThemeId === 'minimal'
  const monet = canonicalThemeId === 'monet'
  const material = canonicalThemeId === 'material'
  const glass = canonicalThemeId === 'liquid-glass'
  const contentRegion = componentId === 'knowledge' || componentId === 'memory'
  const radius = expression.shape === 'capsule'
    ? design?.semantic.radius.extraLarge ?? colors.ui.radius.panel
    : expression.shape === 'material'
      ? design?.semantic.radius.large ?? colors.ui.radius.card
      : expression.shape === 'soft'
        ? colors.ui.radius.controlLarge
        : 0
  const backgroundColor = contentRegion
    ? 'transparent'
    : minimal
    ? 'transparent'
    : glass
      ? colors.ui.semantic.chrome.background
      : material
        ? colors.ui.semantic.surface.muted
        : colors.ui.semantic.surface.base
  const borderColor = glass
    ? colors.ui.actionBar.itemBorder
    : material
      ? colors.ui.semantic.chrome.border
      : monet
        ? colors.ui.semantic.chrome.border
        : colors.material.strokeStrong
  const webGlassStyle = glass && componentId === 'menu' && Platform.OS === 'web'
    ? ({ backdropFilter: 'blur(10px) saturate(1.05)', WebkitBackdropFilter: 'blur(10px) saturate(1.05)' } as unknown as ViewStyle)
    : undefined

  return (
    <View
      testID={testID ?? `theme-${componentId}-${canonicalThemeId}`}
      style={[
        {
          position: 'relative',
          paddingLeft: contentRegion ? (minimal || material ? 11 : 8) : minimal ? 11 : 10,
          paddingRight: contentRegion ? 0 : minimal ? 0 : 10,
          paddingVertical: contentRegion ? 1 : minimal ? 1 : 10,
          borderRadius: contentRegion ? 0 : radius,
          backgroundColor,
          borderWidth: contentRegion || minimal ? 0 : expression.border === 'none' ? 0 : StyleSheet.hairlineWidth,
          borderLeftWidth: contentRegion
            ? minimal || glass
              ? StyleSheet.hairlineWidth
              : material
                ? 3
                : 0
            : minimal
              ? 1
              : undefined,
          borderLeftColor: contentRegion || minimal ? borderColor : undefined,
          borderColor: contentRegion || minimal ? undefined : borderColor,
          shadowColor: glass && componentId === 'menu' ? colors.shadowTint : undefined,
          shadowOpacity: glass && componentId === 'menu' ? 0.06 : 0,
          shadowRadius: glass && componentId === 'menu' ? 8 : 0,
          shadowOffset: { width: 0, height: glass && componentId === 'menu' ? 3 : 0 },
          elevation: glass && componentId === 'menu' ? 1 : 0,
          overflow: contentRegion ? 'visible' : 'hidden',
        },
        webGlassStyle,
        style,
      ]}
    >
      {material ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 3, backgroundColor: colors.ui.icon.accentForeground, opacity: 0.68 }} />
      ) : null}
      {glass ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 1, right: contentRegion ? 0 : 18, left: contentRegion ? 8 : 18, height: StyleSheet.hairlineWidth, backgroundColor: colors.ui.control.primaryForeground, opacity: contentRegion ? 0.28 : 0.52 }} />
      ) : null}
      {children}
    </View>
  )
}
