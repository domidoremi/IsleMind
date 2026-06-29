import { useEffect, useState } from 'react'
import { AccessibilityInfo, Platform } from 'react-native'

export type MotionIntensity = 'full' | 'reduced' | 'none'

const DEFAULT_MOTION_INTENSITY: MotionIntensity = Platform.OS === 'android' ? 'reduced' : 'full'

export function useMotionPreference(): MotionIntensity {
  const [intensity, setIntensity] = useState<MotionIntensity>(DEFAULT_MOTION_INTENSITY)

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setIntensity(enabled ? 'reduced' : DEFAULT_MOTION_INTENSITY)
    })

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setIntensity(enabled ? 'reduced' : DEFAULT_MOTION_INTENSITY)
    })

    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  return intensity
}

export function motionEnabled(intensity: MotionIntensity): boolean {
  return intensity === 'full'
}
