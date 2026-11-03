import { Fragment, type ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Card as NativeCard } from 'animal-island-ui-rn'
import { GlassSurface } from '@/components/ui/isle/GlassSurface'
import { useAppTheme } from '@/hooks/useAppTheme'

type WorkspaceSurfaceRole = 'reading' | 'support' | 'task'

export function WorkspaceSurface({ role, children, focused = false, selected = false, style, testID }: {
  role: WorkspaceSurfaceRole
  children: ReactNode
  focused?: boolean
  selected?: boolean
  style?: StyleProp<ViewStyle>
  testID?: string
}) {
  const { colors, canonicalThemeId } = useAppTheme()
  const semantic = colors.design!.semantic
  const reading = role === 'reading'
  const island = canonicalThemeId === 'animal-island-ui'
  const glass = canonicalThemeId === 'liquid-glass'
  const minimal = canonicalThemeId === 'minimal'
  const radius = reading
    ? semantic.radius.large
    : role === 'task' ? semantic.radius.medium : semantic.radius.extraLarge
  const backgroundColor = reading
    ? colors.ui.semantic.surface.base
    : selected ? semantic.color.primaryContainer
      : role === 'task' ? semantic.color.surfaceContainer
        : minimal ? 'transparent' : colors.ui.semantic.surface.muted
  const surfaceStyle: StyleProp<ViewStyle> = [
    styles.surface,
    {
      borderRadius: radius,
      backgroundColor,
      borderColor: focused ? colors.ui.semantic.control.focus : 'transparent',
      padding: reading ? 20 : 16,
    },
    style,
  ]

  // A theme changes the material behind the same content, never the input tree.
  return <GlassSurface colors={colors} enabled={glass && !reading} variant="floating"
    testID={testID} borderRadius={radius} shadow="none" style={surfaceStyle}>
    {island && !reading ? <View key="material" pointerEvents="none" accessible={false}
      importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <NativeCard style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor }]} />
    </View> : null}
    <Fragment key="content">{children}</Fragment>
  </GlassSurface>
}

const styles = StyleSheet.create({
  surface: { minWidth: 0, borderWidth: StyleSheet.hairlineWidth },
})
