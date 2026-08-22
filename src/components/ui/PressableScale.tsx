import type { ReactNode } from 'react'
import { Pressable, type PressableProps, type PressableStateCallbackType } from 'react-native'
import * as Haptics from 'expo-haptics'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { useSettingsStore } from '@/store/settingsStore'
import { useMotionPreference } from '@/hooks/useMotionPreference'

interface PressableScaleProps extends PressableProps {
  children?: ReactNode
  scaleTo?: number
  haptic?: boolean
  interactionProfile?: PressableInteractionProfile
  pressedOpacity?: number
  hoverScaleTo?: number
  hoverOpacity?: number
  focusScaleTo?: number
  focusOpacity?: number
}

export type PressableInteractionProfile = 'default' | 'precision' | 'organic' | 'material' | 'fluid'

interface PressableInteractionTokens {
  scaleTo: number
  pressedOpacity: number
  hoverScaleTo: number
  hoverOpacity: number
  focusScaleTo: number
  focusOpacity: number
  disabledOpacity: number
  pressInDuration: number
  pressOutDuration: number
  hoverDuration: number
  focusDuration: number
}

const PRESSABLE_INTERACTION_TOKENS: Record<PressableInteractionProfile, PressableInteractionTokens> = {
  default: {
    scaleTo: 0.982,
    pressedOpacity: 0.96,
    hoverScaleTo: 1,
    hoverOpacity: 1,
    focusScaleTo: 1,
    focusOpacity: 1,
    disabledOpacity: 0.56,
    pressInDuration: 64,
    pressOutDuration: 96,
    hoverDuration: 96,
    focusDuration: 96,
  },
  precision: {
    scaleTo: 0.996,
    pressedOpacity: 0.86,
    hoverScaleTo: 1,
    hoverOpacity: 0.92,
    focusScaleTo: 1.002,
    focusOpacity: 1,
    disabledOpacity: 0.48,
    pressInDuration: 72,
    pressOutDuration: 88,
    hoverDuration: 80,
    focusDuration: 80,
  },
  organic: {
    scaleTo: 1.006,
    pressedOpacity: 0.98,
    hoverScaleTo: 1.012,
    hoverOpacity: 1,
    focusScaleTo: 1.006,
    focusOpacity: 1,
    disabledOpacity: 0.58,
    pressInDuration: 220,
    pressOutDuration: 320,
    hoverDuration: 280,
    focusDuration: 260,
  },
  material: {
    scaleTo: 0.998,
    pressedOpacity: 0.82,
    hoverScaleTo: 1,
    hoverOpacity: 0.9,
    focusScaleTo: 1,
    focusOpacity: 0.88,
    disabledOpacity: 0.38,
    pressInDuration: 80,
    pressOutDuration: 160,
    hoverDuration: 100,
    focusDuration: 100,
  },
  fluid: {
    scaleTo: 0.968,
    pressedOpacity: 0.98,
    hoverScaleTo: 1.012,
    hoverOpacity: 1,
    focusScaleTo: 1.006,
    focusOpacity: 1,
    disabledOpacity: 0.5,
    pressInDuration: 140,
    pressOutDuration: 220,
    hoverDuration: 180,
    focusDuration: 160,
  },
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

export function PressableScale({
  children,
  scaleTo,
  haptic = false,
  interactionProfile = 'default',
  pressedOpacity,
  hoverScaleTo,
  hoverOpacity,
  focusScaleTo,
  focusOpacity,
  onPress,
  onPressIn,
  onPressOut,
  onHoverIn,
  onHoverOut,
  onFocus,
  onBlur,
  style,
  ...props
}: PressableScaleProps) {
  const hapticsEnabled = useSettingsStore((state) => state.settings.hapticsEnabled)
  const motion = useMotionPreference()
  const profile = PRESSABLE_INTERACTION_TOKENS[interactionProfile]
  const resolvedScaleTo = scaleTo ?? profile.scaleTo
  const resolvedPressedOpacity = pressedOpacity ?? profile.pressedOpacity
  const resolvedHoverScaleTo = hoverScaleTo ?? profile.hoverScaleTo
  const resolvedHoverOpacity = hoverOpacity ?? profile.hoverOpacity
  const resolvedFocusScaleTo = focusScaleTo ?? profile.focusScaleTo
  const resolvedFocusOpacity = focusOpacity ?? profile.focusOpacity
  const disabled = !!props.disabled
  const accessibilityState = disabled
    ? { ...props.accessibilityState, disabled: true }
    : props.accessibilityState
  const pressProgress = useSharedValue(0)
  const hoverProgress = useSharedValue(0)
  const focusProgress = useSharedValue(0)
  const animatedStyle = useAnimatedStyle(() => {
    const transformEnabled = motion === 'full'
    const pressScale = transformEnabled ? 1 - (1 - resolvedScaleTo) * pressProgress.value : 1
    const hoverScale = transformEnabled ? 1 + (resolvedHoverScaleTo - 1) * hoverProgress.value : 1
    const focusScale = transformEnabled ? 1 + (resolvedFocusScaleTo - 1) * focusProgress.value : 1
    const interactionOpacity = motion === 'none'
      ? 1
      : Math.min(
          1 - (1 - resolvedPressedOpacity) * pressProgress.value,
          1 - (1 - resolvedHoverOpacity) * hoverProgress.value,
          1 - (1 - resolvedFocusOpacity) * focusProgress.value,
        )
    return {
      transform: [{ scale: pressScale * hoverScale * focusScale }],
      opacity: disabled ? profile.disabledOpacity : interactionOpacity,
    }
  }, [
    disabled,
    motion,
    profile.disabledOpacity,
    resolvedFocusOpacity,
    resolvedFocusScaleTo,
    resolvedHoverOpacity,
    resolvedHoverScaleTo,
    resolvedPressedOpacity,
    resolvedScaleTo,
  ])

  function interactionEasing() {
    if (interactionProfile === 'organic') return Easing.inOut(Easing.sin)
    if (interactionProfile === 'material') return Easing.bezier(0.2, 0, 0, 1)
    if (interactionProfile === 'fluid') return Easing.out(Easing.quad)
    return Easing.out(Easing.cubic)
  }

  function feedbackTransition(active: boolean, duration: number) {
    if (motion === 'none') return 0
    if (motion === 'reduced') return withTiming(active ? 1 : 0, { duration: 1 })
    if (interactionProfile === 'fluid' && !active) {
      return withSpring(0, {
        damping: 18,
        stiffness: 240,
        mass: 0.55,
        overshootClamping: true,
      })
    }
    return withTiming(active ? 1 : 0, {
      duration,
      easing: interactionEasing(),
    })
  }

  function setPressed(pressed: boolean) {
    if (disabled) return
    pressProgress.value = feedbackTransition(pressed, pressed ? profile.pressInDuration : profile.pressOutDuration)
  }

  function setHovered(hovered: boolean) {
    if (disabled) return
    hoverProgress.value = feedbackTransition(hovered, profile.hoverDuration)
  }

  function setFocused(focused: boolean) {
    if (disabled) return
    focusProgress.value = feedbackTransition(focused, profile.focusDuration)
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
      onHoverIn={(event) => {
        if (disabled) return
        setHovered(true)
        onHoverIn?.(event)
      }}
      onHoverOut={(event) => {
        if (disabled) return
        setHovered(false)
        onHoverOut?.(event)
      }}
      onFocus={(event) => {
        setFocused(true)
        onFocus?.(event)
      }}
      onBlur={(event) => {
        setFocused(false)
        onBlur?.(event)
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
