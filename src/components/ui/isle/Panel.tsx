import type { PropsWithChildren } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { BlurView } from 'expo-blur'
import { useAppTheme } from '@/hooks/useAppTheme'
import { IsleCard } from './IsleKit'

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
  radius = 30,
  interactive = false,
}: IslePanelProps) {
  const { colors, isDark } = useAppTheme()
  const resolvedMaterial = material ?? (blur ? 'glass' : 'paper')
  const backgroundColor = panelBackground(resolvedMaterial, colors)
  const borderColor = resolvedMaterial === 'transparent' ? 'transparent' : colors.material.stroke
  const panelStyle: StyleProp<ViewStyle> = [
    styles.panel,
    {
      borderColor,
      borderRadius: radius,
      backgroundColor,
      shadowColor: colors.shadowTint,
      shadowOpacity: elevated ? (isDark ? colors.shadow.mediumOpacity : 0.18) : 0,
      shadowRadius: elevated ? (interactive ? 18 : 12) : 0,
      shadowOffset: { width: 0, height: elevated ? (interactive ? 8 : 5) : 0 },
      elevation: elevated ? (interactive ? 5 : 4) : 0,
    },
    style,
  ]

  if (resolvedMaterial === 'glass' || resolvedMaterial === 'chrome' || blur) {
    return (
      <BlurView intensity={intensity} tint={isDark ? 'dark' : 'light'} style={panelStyle}>
        <View style={contentStyle}>{children}</View>
      </BlurView>
    )
  }

  if (resolvedMaterial === 'paper' || resolvedMaterial === 'raised' || resolvedMaterial === 'muted') {
    return (
      <IsleCard
        type={resolvedMaterial === 'muted' ? 'dashed' : resolvedMaterial === 'paper' ? 'title' : 'default'}
        style={panelStyle}
        contentStyle={contentStyle}
      >
        {children}
      </IsleCard>
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
      return colors.material.paperRaised
    case 'muted':
      return colors.material.paperPressed
    case 'glass':
      return colors.material.glass
    case 'chrome':
      return colors.material.chrome
    case 'field':
      return colors.material.field
    case 'transparent':
      return 'transparent'
    case 'paper':
    default:
      return colors.material.paper
  }
}
