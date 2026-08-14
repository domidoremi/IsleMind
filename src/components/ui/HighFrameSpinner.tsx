import { View, type StyleProp, type ViewStyle } from 'react-native'
import { MotiView } from 'moti'
import { Easing } from 'react-native-reanimated'
import { useMotionPreference } from '@/hooks/useMotionPreference'

interface HighFrameSpinnerProps {
  color: string
  size?: number
  strokeWidth?: number
  style?: StyleProp<ViewStyle>
}

export function HighFrameSpinner({ color, size = 16, strokeWidth = 2, style }: HighFrameSpinnerProps) {
  const motion = useMotionPreference()
  const dotSize = Math.max(2, Math.round(size * 0.18))
  const radius = size / 2

  return (
    <View
      pointerEvents="none"
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: radius,
          borderWidth: strokeWidth,
          borderColor: color,
          opacity: 0.18,
        }}
      />
      {motion === 'full' ? (
        <MotiView
          from={{ rotate: '0deg' }}
          animate={{ rotate: '360deg' }}
          transition={{ loop: true, type: 'timing', duration: 928, easing: Easing.linear }}
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: radius,
            borderWidth: strokeWidth,
            borderColor: 'transparent',
            borderTopColor: color,
            borderRightColor: color,
          }}
        />
      ) : (
        <View
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: radius,
            borderWidth: strokeWidth,
            borderColor: 'transparent',
            borderTopColor: color,
            borderRightColor: color,
          }}
        />
      )}
      <View style={{ width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: color, opacity: 0.72 }} />
    </View>
  )
}
