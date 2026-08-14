import type { ReactNode } from 'react'
import { Pressable, type PressableProps, type PressableStateCallbackType } from 'react-native'
import * as Haptics from 'expo-haptics'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSettingsStore } from '@/store/settingsStore'
import { useMotionPreference } from '@/hooks/useMotionPreference'

interface PressableScaleProps extends PressableProps {
  children?: ReactNode
  scaleTo?: number
  haptic?: boolean
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

export function PressableScale({ children, scaleTo = 0.982, haptic = false, onPress, onPressIn, onPressOut, style, ...props }: PressableScaleProps) {
  const hapticsEnabled = useSettingsStore((state) => state.settings.hapticsEnabled)
  const motion = useMotionPreference()
  const disabled = !!props.disabled
  const accessibilityState = disabled
    ? { ...props.accessibilityState, disabled: true }
    : props.accessibilityState
  const pressProgress = useSharedValue(0)
  const animatedStyle = useAnimatedStyle(() => {
    const progress = pressProgress.value
    return {
      transform: [{ scale: 1 - (1 - scaleTo) * progress }],
      opacity: disabled ? 0.56 : 1 - 0.04 * progress,
    }
  }, [disabled, scaleTo])

  function setPressed(pressed: boolean) {
    if (motion !== 'full' || disabled) return
    pressProgress.value = withTiming(pressed ? 1 : 0, {
      duration: pressed ? 64 : 96,
      easing: Easing.out(Easing.cubic),
    })
  }
  const pressableStyle = typeof style === 'function'
    ? (state: PressableStateCallbackType) => {
      const resolvedStyle = style(state)
      return Array.isArray(resolvedStyle) ? [...resolvedStyle, animatedStyle] : [resolvedStyle, animatedStyle]
    }
    : [style, animatedStyle]

  return (
    <AnimatedPressable
      accessibilityRole="button"
      {...props}
      accessibilityState={accessibilityState}
      onPressIn={(event) => {
        if (disabled) return
        setPressed(true)
        onPressIn?.(event)
      }}
      onPressOut={(event) => {
        if (disabled) return
        setPressed(false)
        onPressOut?.(event)
      }}
      onPress={(event) => {
        if (disabled) return
        if (haptic && hapticsEnabled) {
          void Haptics.selectionAsync()
        }
        onPress?.(event)
      }}
      style={pressableStyle}
    >
      {children}
    </AnimatedPressable>
  )
}
