import type { PropsWithChildren } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
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
  radius,
  interactive = false,
}: IslePanelProps) {
  const { colors } = useAppTheme()
  const resolvedMaterial = material ?? (blur ? 'glass' : 'paper')
  const resolvedRadius = radius ?? colors.ui.radius.panel
  const backgroundColor = panelBackground(resolvedMaterial, colors)
  const borderColor = panelBorder(resolvedMaterial, colors)
  void intensity
  const panelStyle: StyleProp<ViewStyle> = [
    styles.panel,
    {
      borderColor,
      borderRadius: resolvedRadius,
      backgroundColor,
      shadowColor: colors.shadowTint,
      shadowOpacity: elevated && colors.ui.cartoon ? colors.ui.card.shadowOpacity : 0,
      shadowRadius: elevated && colors.ui.cartoon ? (interactive ? colors.ui.card.shadowRadius + 4 : colors.ui.card.shadowRadius) : 0,
      shadowOffset: { width: 0, height: elevated && colors.ui.cartoon ? (interactive ? colors.ui.card.shadowOffset + 2 : colors.ui.card.shadowOffset) : 0 },
      elevation: elevated && colors.ui.cartoon && colors.ui.card.shadowOpacity > 0 ? (interactive ? 3 : 1) : 0,
    },
    style,
  ]

  if (resolvedMaterial === 'paper' || resolvedMaterial === 'raised' || resolvedMaterial === 'muted' || resolvedMaterial === 'glass' || resolvedMaterial === 'chrome') {
    return (
      <IsleCard
        type={resolvedMaterial === 'muted' ? 'dashed' : resolvedMaterial === 'paper' && colors.ui.cartoon ? 'title' : 'default'}
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
      return colors.ui.cartoon ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base
    case 'muted':
      return colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted
    case 'glass':
      return colors.ui.semantic.surface.base
    case 'chrome':
      return colors.ui.semantic.chrome.background
    case 'field':
      return colors.material.field
    case 'transparent':
      return 'transparent'
    case 'paper':
    default:
      return colors.ui.cartoon ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base
  }
}

function panelBorder(material: IsleMaterial, colors: ReturnType<typeof useAppTheme>['colors']) {
  if (material === 'transparent') return 'transparent'
  if (colors.ui.cartoon) {
    return material === 'paper' || material === 'raised' ? colors.material.stroke : colors.material.strokeStrong
  }
  if (material === 'field') return colors.ui.input.border
  return colors.ui.semantic.chrome.border
}
