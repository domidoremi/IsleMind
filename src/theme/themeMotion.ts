import type { MotionIntensity } from '@/hooks/useMotionPreference'
import type { ThemeId } from '@/types/settingsContracts'

export type ThemeFoundation = 'minimal' | 'animal-island' | 'document'
export type ThemeSeasonalLayer = 'none' | 'summer-road'
export type ThemeMotionProfileId = 'quiet' | 'road-cinema' | 'document-cut'
export type ThemeMotionRole = 'page' | 'section' | 'scenic' | 'accent' | 'overlay'
export type ThemeMotionDirection = 'forward' | 'backward' | 'neutral'
export type AnimalIslandUiThemeSupport = 'supported' | 'fused'

interface ThemeMotionFrameToken {
  opacity: number
  x: number
  y: number
  scale: number
}

interface ThemeMotionSequenceToken {
  enter: ThemeMotionFrameToken
  exit: ThemeMotionFrameToken
  durationMs: number
  staggerMs: number
  directionalX: boolean
}

export interface ThemeMotionProfile {
  id: ThemeMotionProfileId
  page: ThemeMotionSequenceToken
  section: ThemeMotionSequenceToken
  scenic: ThemeMotionSequenceToken
  accent: ThemeMotionSequenceToken
  overlay: ThemeMotionSequenceToken
  camera: {
    panX: number
    panY: number
    scaleFrom: number
  }
  ambient: {
    parallaxX: number
    parallaxY: number
    scale: number
    durationMs: number
  }
}

export interface ThemeExperienceExtension {
  foundation: ThemeFoundation
  seasonalLayer: ThemeSeasonalLayer
  animalIslandUi: AnimalIslandUiThemeSupport
  motion: ThemeMotionProfile
}

export interface ThemeMotionState {
  opacity: number
  translateX: number
  translateY: number
  scale: number
}

export interface ResolvedThemeMotion {
  from: ThemeMotionState
  animate: ThemeMotionState
  exit: ThemeMotionState
  transition: {
    type: 'timing'
    duration: number
    delay: number
  }
}

const frame = (
  opacity: number,
  x = 0,
  y = 0,
  scale = 1,
): ThemeMotionFrameToken => ({ opacity, x, y, scale })

const sequence = (
  enter: ThemeMotionFrameToken,
  exit: ThemeMotionFrameToken,
  durationMs: number,
  staggerMs: number,
  directionalX = false,
): ThemeMotionSequenceToken => ({ enter, exit, durationMs, staggerMs, directionalX })

export const THEME_EXPERIENCE_EXTENSIONS = {
  minimal: {
    foundation: 'minimal',
    seasonalLayer: 'none',
    animalIslandUi: 'supported',
    motion: {
      id: 'quiet',
      page: sequence(frame(0, 4), frame(0, 4), 176, 0, true),
      section: sequence(frame(0, 0, 6), frame(0, 0, -3), 184, 22),
      scenic: sequence(frame(0, 0, 4), frame(0), 208, 26),
      accent: sequence(frame(0, 0, 0, 0.97), frame(0), 168, 20),
      overlay: sequence(frame(0, 0, 4, 0.995), frame(0, 0, 2), 184, 0),
      camera: { panX: 4, panY: 0, scaleFrom: 1 },
      ambient: { parallaxX: 0, parallaxY: 0, scale: 1, durationMs: 0 },
    },
  },
  'lime-road': {
    foundation: 'animal-island',
    seasonalLayer: 'summer-road',
    animalIslandUi: 'fused',
    motion: {
      id: 'road-cinema',
      page: sequence(frame(0, 28, 0, 0.975), frame(0, 34, 0, 1.015), 320, 0, true),
      section: sequence(frame(0, 0, 14, 0.99), frame(0, 0, -7, 1.005), 256, 30),
      scenic: sequence(frame(0, 18, 8, 0.94), frame(0, 12, -4, 1.02), 384, 34, true),
      accent: sequence(frame(0, 0, 4, 0.86), frame(0, 0, -2, 1.02), 224, 28),
      overlay: sequence(frame(0, 0, 10, 0.98), frame(0, 0, 6, 0.99), 248, 0),
      camera: { panX: 28, panY: 8, scaleFrom: 0.975 },
      ambient: { parallaxX: 18, parallaxY: 10, scale: 1.035, durationMs: 5120 },
    },
  },
  markdown: {
    foundation: 'document',
    seasonalLayer: 'none',
    animalIslandUi: 'supported',
    motion: {
      id: 'document-cut',
      page: sequence(frame(0, 8), frame(0, 8), 112, 0, true),
      section: sequence(frame(0, 0, 4), frame(0, 0, -2), 128, 12),
      scenic: sequence(frame(0), frame(0), 104, 10),
      accent: sequence(frame(0, 0, 0, 0.99), frame(0), 96, 8),
      overlay: sequence(frame(0, 0, 2), frame(0), 112, 0),
      camera: { panX: 8, panY: 0, scaleFrom: 1 },
      ambient: { parallaxX: 0, parallaxY: 0, scale: 1, durationMs: 0 },
    },
  },
} as const satisfies Record<ThemeId, ThemeExperienceExtension>

export function resolveThemeMotion({
  themeId,
  role,
  intensity,
  direction = 'neutral',
  order = 0,
}: {
  themeId: ThemeId
  role: ThemeMotionRole
  intensity: MotionIntensity
  direction?: ThemeMotionDirection
  order?: number
}): ResolvedThemeMotion {
  const settled: ThemeMotionState = { opacity: 1, translateX: 0, translateY: 0, scale: 1 }

  if (intensity === 'none') {
    return {
      from: settled,
      animate: settled,
      exit: { ...settled, opacity: 0 },
      transition: { type: 'timing', duration: 1, delay: 0 },
    }
  }

  if (intensity === 'reduced') {
    return {
      from: { ...settled, opacity: 0 },
      animate: settled,
      exit: { ...settled, opacity: 0 },
      transition: { type: 'timing', duration: 120, delay: 0 },
    }
  }

  const profile = THEME_EXPERIENCE_EXTENSIONS[themeId].motion
  const motion = profile[role]
  const directionMultiplier = direction === 'forward' ? 1 : direction === 'backward' ? -1 : 0
  const resolveFrame = (token: ThemeMotionFrameToken): ThemeMotionState => ({
    opacity: token.opacity,
    translateX: token.x * (motion.directionalX ? directionMultiplier : 1),
    translateY: token.y,
    scale: token.scale,
  })
  const safeOrder = Math.min(6, Math.max(0, Math.trunc(order)))

  return {
    from: resolveFrame(motion.enter),
    animate: settled,
    exit: resolveFrame(motion.exit),
    transition: {
      type: 'timing',
      duration: motion.durationMs,
      delay: Math.min(safeOrder * motion.staggerMs, 180),
    },
  }
}
