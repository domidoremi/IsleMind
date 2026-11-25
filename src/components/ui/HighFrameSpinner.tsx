import { View, type StyleProp, type ViewStyle } from 'react-native'
import { MotiView } from 'moti'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useThemeMotion } from '@/hooks/useThemeMotion'

interface HighFrameSpinnerProps {
  color: string
  size?: number
  strokeWidth?: number
  style?: StyleProp<ViewStyle>
  active?: boolean
}

/** Compact loading marks retain each theme's shape and motion grammar. */
export function HighFrameSpinner({ color, size = 16, strokeWidth = 2, style, active = true }: HighFrameSpinnerProps) {
  const { canonicalThemeId: family } = useAppTheme()
  const motion = useThemeMotion('accent')
  const animated = active && motion.intensity === 'full'
  const diameter = Number.isFinite(size) ? Math.max(4, size) : 16
  const stroke = Number.isFinite(strokeWidth) ? Math.max(1, Math.min(diameter / 4, strokeWidth)) : 2
  const bounds: ViewStyle = { width: diameter, height: diameter, alignItems: 'center', justifyContent: 'center' }
  const round: ViewStyle = { position: 'absolute', width: diameter - stroke, height: diameter - stroke,
    borderRadius: diameter / 2, borderWidth: stroke, borderColor: color }
  const transition = { ...motion.transition, loop: true, repeatReverse: true, delay: 0 }
  let mark
  if (family === 'minimal') {
    mark = <>
      <View style={{ position: 'absolute', width: diameter, height: stroke, backgroundColor: color, opacity: 0.2 }} />
      {animated ? <MotiView from={{ scaleX: 0.3, opacity: 0.5 }} animate={{ scaleX: 1, opacity: 1 }}
        transition={transition} style={{ width: diameter, height: stroke, backgroundColor: color }} />
        : <View style={{ width: diameter * 0.65, height: stroke, backgroundColor: color }} />}
    </>
  } else if (family === 'monet' || family === 'animal-island-ui') {
    mark = <View style={{ flexDirection: 'row', alignItems: 'center', gap: diameter * 0.1 }}>
      {[0, 1, 2].map(index => {
        const dot: ViewStyle = { width: diameter * 0.24, height: diameter * (family === 'monet' ? 0.24 : 0.34),
          borderRadius: diameter * (family === 'monet' ? 0.12 : 0.08), backgroundColor: color,
          opacity: index === 1 ? 1 : 0.5 }
        return animated ? <MotiView key={index} from={{ opacity: 0.35, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ ...transition, delay: index * motion.transition.duration / 3 }} style={dot} />
          : <View key={index} style={dot} />
      })}
    </View>
  } else if (family === 'liquid-glass') {
    mark = <>
      <View style={[round, { opacity: 0.25 }]} />
      {animated ? <MotiView from={{ scale: 0.65, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }}
        transition={transition} style={[round, { width: diameter * 0.55, height: diameter * 0.55 }]} />
        : <View style={[round, { width: diameter * 0.55, height: diameter * 0.55 }]} />}
    </>
  } else {
    const arc = { ...round, borderBottomColor: 'transparent', borderLeftColor: 'transparent' }
    mark = <>
      <View style={[round, { opacity: 0.18 }]} />
      {animated ? <MotiView from={{ rotate: '0deg' }} animate={{ rotate: '360deg' }}
        transition={{ ...transition, repeatReverse: false, duration: motion.transition.duration * 3 }} style={arc} />
        : <View style={arc} />}
    </>
  }
  return <View pointerEvents="none" accessible={false} testID={`theme-loading-${family}`}
    style={[bounds, style]}>{mark}</View>
}
