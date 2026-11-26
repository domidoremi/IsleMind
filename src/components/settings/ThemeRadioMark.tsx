import { StyleSheet, View } from 'react-native'
import { MotiView } from 'moti'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useThemeMotion } from '@/hooks/useThemeMotion'
import { resolveThemeComponentExpression } from '@/theme/themeExpression'

type Rgb = readonly [number, number, number]

function composite(value: string, backdrop: Rgb): Rgb {
  if (value === 'transparent') return backdrop
  if (/^#[\da-f]{6}$/i.test(value)) return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)]
  const channels = /^rgba?\(([^)]+)\)$/i.exec(value)?.[1].split(',').map(Number)
  if (!channels || channels.length < 3 || !channels.every(Number.isFinite)) return backdrop
  const alpha = channels[3] ?? 1
  const channel = (index: number) => channels[index] * alpha + backdrop[index] * (1 - alpha)
  return [channel(0), channel(1), channel(2)]
}

function luminance(value: Rgb): number {
  const linear = value.map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

function readableIndicator(preferred: string, fill: string, backdrops: string[], alternatives: string[]): string {
  const backgrounds = backdrops.map(value => composite(fill, composite(value, [0, 0, 0])))
  const contrast = (value: string) => Math.min(...backgrounds.map(background => {
    const front = luminance(composite(value, background)), back = luminance(background)
    return (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05)
  }))
  if (contrast(preferred) >= 3) return preferred
  return alternatives.reduce((best, value) => contrast(value) > contrast(best) ? value : best, preferred)
}

export function ThemeRadioMark({ active, disabled = false, size = 20, surface = 'default' }: { active: boolean; disabled?: boolean; size?: number; surface?: 'default' | 'primary' }) {
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
  const backgroundColor = disabled
    ? colors.ui.control.disabledBackground
    : radioExpression.surface === 'atmosphere'
      ? colors.ui.icon.accentBackground
      : radioExpression.surface === 'lens'
        ? colors.ui.semantic.chrome.background
        : 'transparent'
  const preferredColor = radioExpression.motion === 'organic'
    ? colors.ui.icon.accentForeground
    : radioExpression.motion === 'fluid'
      ? colors.ui.control.primaryForeground
      : colors.ui.control.primaryBackground
  // Keep each family's fill and accent where readable. A translucent wash/lens
  // must be composed with its actual host before selecting a contrasting dot.
  const selectedColor = disabled ? colors.ui.control.disabledForeground : readableIndicator(
    preferredColor,
    backgroundColor,
    surface === 'primary' ? [colors.ui.control.primaryBackground] : [colors.background.canvas, colors.ui.semantic.surface.base, colors.ui.semantic.surface.raised],
    [colors.text, colors.ui.control.primaryForeground, colors.ui.icon.accentForeground, colors.ui.control.primaryBackground],
  )
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
      animate={{ backgroundColor, borderColor, opacity: disabled ? colors.ui.control.disabledOpacity : 1 }}
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
