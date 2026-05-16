import { Easing } from 'react-native-reanimated'
import type { MotionIntensity } from '@/hooks/useMotionPreference'

export const spring = {
  default: {
    damping: 15,
    stiffness: 150,
    mass: 1,
  },
  gentle: {
    damping: 20,
    stiffness: 120,
    mass: 0.8,
  },
  bouncy: {
    damping: 8,
    stiffness: 180,
    mass: 1,
  },
  islandPress: {
    damping: 11,
    stiffness: 280,
    mass: 0.72,
  },
  islandSettle: {
    damping: 18,
    stiffness: 190,
    mass: 0.86,
  },
}

export const timing = {
  fast: { duration: 150, easing: Easing.out(Easing.ease) },
  normal: { duration: 250, easing: Easing.out(Easing.ease) },
  slow: { duration: 400, easing: Easing.out(Easing.ease) },
  typewriter: { duration: 24, easing: Easing.linear },
}

export const motionTokens = {
  duration: {
    instant: 90,
    fast: 150,
    normal: 230,
    slow: 420,
    ambient: 5200,
    mascotLoop: 1600,
  },
  distance: {
    chrome: 84,
    sheet: 10,
    message: 12,
    blob: 18,
  },
  spring: {
    press: spring.islandPress,
    settle: spring.islandSettle,
    gentle: spring.gentle,
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
  transition: { type: 'spring' as const, ...spring.default },
}

export const scaleIn = {
  from: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1 },
  transition: { type: 'spring' as const, ...spring.gentle },
}

export const messageAnimation = (index: number) => ({
  from: { opacity: 0, translateY: 12, scale: 0.985 },
  animate: { opacity: 1, translateY: 0, scale: 1 },
  transition: {
    type: 'spring' as const,
    ...spring.gentle,
    delay: Math.min(index * 12, 96),
  },
})

export const messageAnimationForMotion = (index: number, motion: MotionIntensity) => {
  if (motion !== 'full') {
    return {
      from: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { type: 'timing' as const, duration: motionTokens.duration.fast },
    }
  }
  return messageAnimation(index)
}

export const islandEntrance = (index = 0) => ({
  from: { opacity: 0, translateY: 10, scale: 0.985 },
  animate: { opacity: 1, translateY: 0, scale: 1 },
  transition: {
    type: 'spring' as const,
    ...spring.islandSettle,
    delay: Math.min(index * 28, 180),
  },
})

export const floatingChromeAnimation = (visible: boolean, distance = 72) => ({
  animate: { opacity: visible ? 1 : 0, translateY: visible ? 0 : -distance, scale: visible ? 1 : 0.985 },
  transition: { type: 'timing' as const, duration: visible ? 210 : 150 },
})
