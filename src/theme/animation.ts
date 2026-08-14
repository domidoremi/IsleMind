import { Easing } from 'react-native-reanimated'
import type { MotionIntensity } from '@/hooks/useMotionPreference'
export const timing = {
  fast: { duration: 144, easing: Easing.out(Easing.cubic) },
  normal: { duration: 224, easing: Easing.out(Easing.cubic) },
  slow: { duration: 384, easing: Easing.out(Easing.cubic) },
  typewriter: { duration: 16, easing: Easing.linear },
}

export const motionTokens = {
  duration: {
    frame: 16,
    instant: 80,
    fast: 144,
    normal: 224,
    slow: 384,
    ambient: 5120,
    pulseLoop: 1536,
    spinnerLoop: 928,
  },
  distance: {
    chrome: 84,
    sheet: 10,
    message: 12,
    blob: 18,
  },
}

export const fadeIn = {
  from: { opacity: 0 },
  animate: { opacity: 1 },
  transition: timing.normal,
}

export const slideUp = {
  from: { opacity: 0, translateY: 20 },
  animate: { opacity: 1, translateY: 0 },
  transition: { type: 'timing' as const, duration: motionTokens.duration.normal },
}

export const scaleIn = {
  from: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { type: 'timing' as const, duration: motionTokens.duration.normal },
}

export const messageAnimation = (index: number) => ({
  from: { opacity: 0, translateY: 12 },
  animate: { opacity: 1, translateY: 0 },
  transition: {
    type: 'timing' as const,
    duration: motionTokens.duration.fast,
    delay: Math.min(index * 12, 96),
  },
})

export const messageAnimationForMotion = (_index: number, _motion: MotionIntensity) => ({
  animate: { opacity: 1, translateY: 0 },
  transition: { type: 'timing' as const, duration: 1 },
})

export const islandEntrance = (index = 0) => ({
  from: { opacity: 0, translateY: 10 },
  animate: { opacity: 1, translateY: 0 },
  transition: {
    type: 'timing' as const,
    duration: motionTokens.duration.fast,
    delay: Math.min(index * 28, 180),
  },
})

export const floatingChromeAnimation = (visible: boolean, distance = 72) => ({
  animate: { opacity: visible ? 1 : 0, translateY: visible ? 0 : -distance },
  transition: { type: 'timing' as const, duration: visible ? 208 : motionTokens.duration.fast },
})
