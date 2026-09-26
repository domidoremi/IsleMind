import type { PropsWithChildren } from 'react'
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { GlassSurface } from './GlassSurface'
import { glassShadowStyle } from './glassShadowStyle'
import { Card as NativeCard } from 'animal-island-ui-rn'
export type IsleMaterial = 'paper' | 'raised' | 'muted' | 'glass' | 'chrome' | 'field' | 'transparent'

interface IslePanelProps extends PropsWithChildren {
  style?: StyleProp<ViewStyle>
  contentStyle?: StyleProp<ViewStyle>
  blur?: boolean
  material?: IsleMaterial
  intensity?: number
  elevated?: boolean
  radius?: number
  interactive?: boolean
}

export function IslePanel({
  children,
  style,
  contentStyle,
  blur = false,
  material,
  intensity = 34,
  elevated = true,
  radius,
  interactive = false,
}: IslePanelProps) {
  const { colors, design, isLiquidGlass } = useAppTheme()
  const resolvedMaterial = material ?? (blur ? 'glass' : 'paper')
  if (design.family === 'animal-island-ui' && resolvedMaterial !== 'transparent') {
    return <NativeCard style={[style, contentStyle]}>{children}</NativeCard>
  }
  const resolvedRadius = Math.min(radius ?? colors.ui.radius.panel, colors.ui.radius.panel)
  const functionalMaterial = isLiquidGlass && resolvedMaterial !== 'transparent'
  const tokenBackground = panelBackground(resolvedMaterial, colors)
  // Minimal paper panels are layout aids, not nested cards. Keep a real
  // surface for dialogs/raised sheets while allowing ordinary sections to
  // remain on the continuous canvas.
  const backgroundColor = resolvedMaterial === 'paper' && design.component.panel.background === 'transparent'
    ? 'transparent'
    : tokenBackground
  const borderColor = panelBorder(resolvedMaterial, colors)
  const shouldElevate = elevated && resolvedMaterial !== 'transparent' && (resolvedMaterial === 'raised' || resolvedMaterial === 'glass' || resolvedMaterial === 'chrome')
  const shadowOpacity = shouldElevate
    ? Math.min(0.1, design.semantic.elevation.shadowOpacity * (isLiquidGlass ? 0.72 : 0.42))
    : 0
  const shadowRadius = shouldElevate ? Math.min(16, design.semantic.elevation.shadowBlur) : 0
  const shadowOffsetY = shouldElevate ? Math.min(4, design.semantic.elevation.shadowOffsetY) : 0
  const panelStyle: StyleProp<ViewStyle> = [
    styles.panel,
    {
      borderColor,
      borderRadius: resolvedRadius,
      backgroundColor,
      ...Platform.select<ViewStyle>({
        web: { boxShadow: 'none' },
        default: {
          shadowColor: design.semantic.elevation.shadowColor,
          shadowOpacity,
          shadowRadius,
          shadowOffset: { width: 0, height: shadowOffsetY },
          elevation: shouldElevate ? 1 : 0,
        },
      }),
    },
    style,
    isLiquidGlass ? glassShadowStyle(colors, shouldElevate ? 'surface' : 'none') : null,
  ]

  if (functionalMaterial) {
    return (
      <GlassSurface
        colors={colors}
        variant={resolvedMaterial === 'chrome' ? 'chrome' : 'floating'}
        intensity={intensity}
        borderRadius={resolvedRadius}
        shadow={shouldElevate ? 'surface' : 'none'}
        style={[panelStyle, contentStyle, { borderWidth: 0 }]}
      >
        {children}
      </GlassSurface>
    )
  }
  return <View style={[panelStyle, contentStyle]}>{children}</View>
}

const styles = StyleSheet.create({
  panel: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
})

function panelBackground(material: IsleMaterial, colors: ReturnType<typeof useAppTheme>['colors']) {
  switch (material) {
    case 'raised':
      return colors.ui.semantic.surface.base
    case 'muted':
      return colors.ui.semantic.surface.muted
    case 'glass':
      return colors.ui.semantic.surface.overlay
    case 'chrome':
      return colors.ui.semantic.chrome.background
    case 'field':
      return colors.material.field
    case 'transparent':
      return 'transparent'
    case 'paper':
    default:
      return colors.ui.semantic.surface.base
  }
}

function panelBorder(material: IsleMaterial, colors: ReturnType<typeof useAppTheme>['colors']) {
  if (material === 'transparent') return 'transparent'
  if (colors.ui.monet) {
    return material === 'paper' || material === 'raised' ? colors.material.stroke : colors.material.strokeStrong
  }
  if (material === 'field') return colors.ui.input.border
  return colors.ui.semantic.chrome.border
}
