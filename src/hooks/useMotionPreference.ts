import { useSyncExternalStore } from 'react'
import { AccessibilityInfo, Platform } from 'react-native'
export type MotionIntensity = 'full' | 'reduced' | 'none'

const DEFAULT_MOTION_INTENSITY: MotionIntensity = Platform.OS === 'android' ? 'reduced' : 'full'
const motionListeners = new Set<() => void>()
let currentMotionIntensity: MotionIntensity = DEFAULT_MOTION_INTENSITY
let motionPreferenceSubscription: { remove(): void } | null = null
let motionPreferenceEpoch = 0

export function useMotionPreference(): MotionIntensity {
  return useSyncExternalStore(
    subscribeMotionPreference,
    getMotionPreferenceSnapshot,
    getServerMotionPreferenceSnapshot,
  )
}

export function motionEnabled(intensity: MotionIntensity): boolean {
  return intensity === 'full'
}

function subscribeMotionPreference(listener: () => void): () => void {
  motionListeners.add(listener)
  if (motionListeners.size === 1) startMotionPreferenceSubscription()

  let subscribed = true
  return () => {
    if (!subscribed) return
    subscribed = false
    motionListeners.delete(listener)
    if (motionListeners.size === 0) stopMotionPreferenceSubscription()
  }
}

function getMotionPreferenceSnapshot(): MotionIntensity {
  return currentMotionIntensity
}

function getServerMotionPreferenceSnapshot(): MotionIntensity {
  return DEFAULT_MOTION_INTENSITY
}

function startMotionPreferenceSubscription() {
  const epoch = ++motionPreferenceEpoch
  let nativeEventSeen = false

  const updateFromNativeEvent = (enabled: boolean) => {
    if (epoch !== motionPreferenceEpoch || motionListeners.size === 0) return
    nativeEventSeen = true
    updateMotionPreferenceFromReduceMotion(enabled)
  }

  try {
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', updateFromNativeEvent)
    motionPreferenceSubscription = subscription && typeof subscription.remove === 'function'
      ? subscription
      : null
  } catch {
    motionPreferenceSubscription = null
  }

  void Promise.resolve()
    .then(() => {
      if (epoch !== motionPreferenceEpoch || motionListeners.size === 0) return undefined
      return AccessibilityInfo.isReduceMotionEnabled()
    })
    .then((enabled) => {
      if (
        typeof enabled !== 'boolean' ||
        nativeEventSeen ||
        epoch !== motionPreferenceEpoch ||
        motionListeners.size === 0
      ) return
      updateMotionPreferenceFromReduceMotion(enabled)
    })
    .catch(() => undefined)
}

function stopMotionPreferenceSubscription() {
  motionPreferenceEpoch += 1
  try {
    motionPreferenceSubscription?.remove()
  } catch {
    // Native subscription cleanup is best-effort during teardown.
  }
  motionPreferenceSubscription = null
}

function updateMotionPreferenceFromReduceMotion(enabled: boolean) {
  const next: MotionIntensity = enabled ? 'reduced' : DEFAULT_MOTION_INTENSITY
  if (currentMotionIntensity === next) return
  currentMotionIntensity = next
  for (const listener of motionListeners) listener()
}
