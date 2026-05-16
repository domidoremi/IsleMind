import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

export type MotionIntensity = 'full' | 'reduced' | 'none'

export function useMotionPreference(): MotionIntensity {
  const [intensity, setIntensity] = useState<MotionIntensity>('full')

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setIntensity(enabled ? 'reduced' : 'full')
    })

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setIntensity(enabled ? 'reduced' : 'full')
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
