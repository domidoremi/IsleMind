import type { MotionIntensity } from '@/hooks/useMotionPreference'

export type AppStatusTone = 'info' | 'success' | 'warning' | 'danger'
export type AppStatusSafeAreaEdge = 'none' | 'top' | 'bottom'

export interface AppStatusMotionState {
  opacity: number
  translateY?: number
}

export interface AppStatusMotionConfig {
  from: AppStatusMotionState
  animate: AppStatusMotionState
  exit: AppStatusMotionState
  duration: number
}

export function resolveAppStatusMotion(
  intensity: MotionIntensity,
  enabled: boolean,
): AppStatusMotionConfig {
  if (!enabled || intensity === 'none') {
    return {
      from: { opacity: 1 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      duration: 1,
    }
  }

  if (intensity === 'reduced') {
    return {
      from: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      duration: 120,
    }
  }

  return {
    from: { opacity: 0, translateY: 8 },
    animate: { opacity: 1, translateY: 0 },
    exit: { opacity: 0, translateY: 4 },
    duration: 160,
  }
}

export function resolveAppStatusSafeAreaPadding(
  edge: AppStatusSafeAreaEdge,
  insets: { top: number; bottom: number },
): { paddingTop?: number; paddingBottom?: number } {
  if (edge === 'top') return { paddingTop: Math.max(0, insets.top) }
  if (edge === 'bottom') return { paddingBottom: Math.max(10, insets.bottom) }
  return {}
}

export function resolveAppStatusIcon(tone: AppStatusTone): 'info' | 'check' | 'zap' | 'warning' {
  if (tone === 'success') return 'check'
  if (tone === 'warning') return 'zap'
  if (tone === 'danger') return 'warning'
  return 'info'
}
