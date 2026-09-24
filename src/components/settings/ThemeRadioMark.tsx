import { StyleSheet, View } from 'react-native'
import { MotiView } from 'moti'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useThemeMotion } from '@/hooks/useThemeMotion'
import { resolveThemeComponentExpression } from '@/theme/themeExpression'

export function ThemeRadioMark({ active, disabled = false, size = 20 }: { active: boolean; disabled?: boolean; size?: number }) {
  const { colors, canonicalThemeId } = useAppTheme()
  const selectionMotion = useThemeMotion('accent')
  const motion = selectionMotion.intensity
  const radioExpression = resolveThemeComponentExpression(canonicalThemeId, 'radio')
  const radius = radioExpression.shape === 'angular'
    ? 2
    : radioExpression.shape === 'soft'
      ? Math.round(size * 0.42)
      : size / 2
  const innerWidth = radioExpression.motion === 'precision' ? Math.max(7, size - 9) : Math.round(size * 0.46)
  const innerHeight = radioExpression.motion === 'precision' ? 3 : Math.round(size * 0.46)
  const selectedColor = disabled
    ? colors.ui.control.disabledForeground
    : radioExpression.motion === 'organic'
      ? colors.ui.icon.accentForeground
      : radioExpression.motion === 'fluid'
        ? colors.ui.control.primaryForeground
        : colors.ui.control.primaryBackground
  const backgroundColor = disabled
    ? colors.ui.control.disabledBackground
    : radioExpression.surface === 'atmosphere'
      ? colors.ui.icon.accentBackground
      : radioExpression.surface === 'lens'
        ? colors.ui.semantic.chrome.background
        : 'transparent'
  const borderColor = disabled
    ? colors.ui.control.disabledBorder
    : active
      ? colors.ui.control.primaryBorder
      : radioExpression.surface === 'lens'
        ? colors.ui.actionBar.itemBorder
        : colors.ui.semantic.chrome.border
  const indicatorScale = motion === 'full' ? (active ? 1 : 0.45) : 1

  return (
    <MotiView
      accessible={false}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      animate={{ backgroundColor, borderColor, opacity: disabled ? 0.58 : 1 }}
      transition={selectionMotion.transition}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: radioExpression.border === 'outline' || radioExpression.border === 'edge-highlight' ? 1.5 : StyleSheet.hairlineWidth,
        overflow: 'hidden',
      }}
    >
      <MotiView
        animate={{ opacity: active ? 1 : 0, scale: indicatorScale }}
        transition={selectionMotion.transition}
        style={{
          width: innerWidth,
          height: innerHeight,
          borderRadius: radioExpression.motion === 'precision' ? 0 : innerWidth / 2,
          backgroundColor: selectedColor,
        }}
      />
      {active && radioExpression.motion === 'fluid' ? (
        <View style={{ position: 'absolute', top: 3, right: 4, width: 4, height: 2, borderRadius: 2, backgroundColor: colors.ui.control.primaryForeground, opacity: 0.58 }} />
      ) : null}
    </MotiView>
  )
}
