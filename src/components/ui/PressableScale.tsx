import type { ReactNode } from 'react'
import { Pressable, type PressableProps } from 'react-native'
import * as Haptics from 'expo-haptics'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { useSettingsStore } from '@/store/settingsStore'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

interface PressableScaleProps extends PressableProps {
  children?: ReactNode
  scaleTo?: number
  haptic?: boolean
}

export function PressableScale({ children, scaleTo = 0.96, haptic = false, onPress, onPressIn, onPressOut, style, ...props }: PressableScaleProps) {
  const scale = useSharedValue(1)
  const hapticsEnabled = useSettingsStore((state) => state.settings.hapticsEnabled)
  const motion = useMotionPreference()
  const disabled = !!props.disabled
  const canAnimate = motion === 'full'

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  return (
    <AnimatedPressable
      accessibilityRole="button"
      {...props}
      onPressIn={(event) => {
        if (disabled) return
        if (canAnimate) {
          scale.value = withSpring(scaleTo, motionTokens.spring.press)
        }
        onPressIn?.(event)
      }}
      onPressOut={(event) => {
        if (disabled) return
        if (canAnimate) {
          scale.value = withSpring(1, motionTokens.spring.settle)
        }
        onPressOut?.(event)
      }}
      onPress={(event) => {
        if (disabled) return
        if (haptic && hapticsEnabled) {
          void Haptics.selectionAsync()
        }
        onPress?.(event)
      }}
      style={[animatedStyle, style]}
    >
      {children}
    </AnimatedPressable>
  )
}
