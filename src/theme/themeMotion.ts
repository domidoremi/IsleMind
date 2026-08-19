import type { MotionIntensity } from '@/hooks/useMotionPreference'
import type { CanonicalThemeId, ThemeId } from '@/types/settingsContracts'
import { normalizeThemeId } from './colors'

export type ThemeFoundation = 'minimal' | 'monet' | 'material' | 'liquid-glass' | 'animal-island' | 'document'
export type ThemeSeasonalLayer = 'none' | 'summer-road'
export type ThemeMotionProfileId = 'quiet' | 'monet-breathe' | 'material-shared-axis' | 'glass-refraction'
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
      page: sequence(frame(0, 2), frame(0, 2), 144, 0, true),
      section: sequence(frame(0, 0, 3), frame(0), 136, 12),
      scenic: sequence(frame(0), frame(0), 144, 12),
      accent: sequence(frame(0), frame(0), 112, 8),
      overlay: sequence(frame(0), frame(0), 160, 0),
      camera: { panX: 4, panY: 0, scaleFrom: 1 },
      ambient: { parallaxX: 0, parallaxY: 0, scale: 1, durationMs: 0 },
    },
  },
  monet: {
    foundation: 'monet',
    seasonalLayer: 'none',
    animalIslandUi: 'supported',
    motion: {
      id: 'monet-breathe',
      page: sequence(frame(0, 10, 2, 0.99), frame(0, 8, -2, 1.005), 320, 0, true),
      section: sequence(frame(0, 0, 8, 0.995), frame(0, 0, -4), 280, 24),
      scenic: sequence(frame(0, 8, 5, 0.98), frame(0, 5, -2, 1.008), 360, 28, true),
      accent: sequence(frame(0, 0, 2, 0.96), frame(0), 220, 20),
      overlay: sequence(frame(0, 0, 6, 0.99), frame(0, 0, 3), 260, 0),
      camera: { panX: 10, panY: 5, scaleFrom: 0.99 },
      ambient: { parallaxX: 4, parallaxY: 3, scale: 1.01, durationMs: 6400 },
    },
  },
  material: {
    foundation: 'material',
    seasonalLayer: 'none',
    animalIslandUi: 'supported',
    motion: {
      id: 'material-shared-axis',
      page: sequence(frame(0, 16, 0, 0.96), frame(0, 12, 0, 1.04), 300, 0, true),
      section: sequence(frame(0, 0, 8), frame(0, 0, -4), 240, 18),
      scenic: sequence(frame(0, 0, 4), frame(0), 220, 16),
      accent: sequence(frame(0, 0, 0, 0.92), frame(0), 180, 14),
      overlay: sequence(frame(0, 0, 10, 0.98), frame(0, 0, 5, 0.99), 240, 0),
      camera: { panX: 16, panY: 0, scaleFrom: 0.96 },
      ambient: { parallaxX: 0, parallaxY: 0, scale: 1, durationMs: 0 },
    },
  },
  'liquid-glass': {
    foundation: 'liquid-glass',
    seasonalLayer: 'none',
    animalIslandUi: 'supported',
    motion: {
      id: 'glass-refraction',
      page: sequence(frame(0, 12, 5, 0.985), frame(0, 10, -3, 1.008), 340, 0, true),
      section: sequence(frame(0, 0, 7, 0.99), frame(0, 0, -3), 280, 20),
      scenic: sequence(frame(0, 6, 4, 0.98), frame(0, 4, -2, 1.006), 320, 22, true),
      accent: sequence(frame(0, 0, 1, 0.94), frame(0), 200, 16),
      overlay: sequence(frame(0, 0, 12, 0.98), frame(0, 0, 5, 0.99), 300, 0),
      camera: { panX: 12, panY: 5, scaleFrom: 0.985 },
      ambient: { parallaxX: 3, parallaxY: 2, scale: 1.008, durationMs: 7200 },
    },
  },
} as const satisfies Record<CanonicalThemeId, ThemeExperienceExtension>

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

  const profile = THEME_EXPERIENCE_EXTENSIONS[normalizeThemeId(themeId)].motion
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
