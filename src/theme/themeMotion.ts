import type { CanonicalThemeId, ThemeId } from '@/types/settingsContracts'
import { normalizeThemeId } from './colors'
import { THEME_MOTION_DURATIONS, type ThemeMotionDurationTokens } from './themeTokens'

/** Presentation policy; platform hooks consume this type, never own it. */
export type MotionIntensity = 'full' | 'reduced' | 'none'
export type ThemeFoundation = CanonicalThemeId
export type ThemeSeasonalLayer = 'none' | 'summer-road'
export type ThemeMotionProfileId = 'quiet' | 'monet-breathe' | 'material-shared-axis' | 'glass-refraction' | 'animal-island'
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
  staggerMs: number
  directionalX: boolean
}

export interface ThemeMotionProfile {
  id: ThemeMotionProfileId
  curve: 'precision' | 'organic' | 'material' | 'fluid' | 'island'
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

// Profiles own geometry and sequencing, not a second set of base durations.
const durationTokenByRole = {
  page: 'page',
  section: 'panel',
  scenic: 'panel',
  accent: 'emphasis',
  overlay: 'panel',
} as const satisfies Record<ThemeMotionRole, keyof ThemeMotionDurationTokens>

const THEME_MOTION_ROLES = Object.keys(durationTokenByRole) as ThemeMotionRole[]
const isThemeMotionRole = (value: unknown): value is ThemeMotionRole => (
  typeof value === 'string' && (THEME_MOTION_ROLES as readonly string[]).includes(value)
)

const frame = (
  opacity: number,
  x = 0,
  y = 0,
  scale = 1,
): ThemeMotionFrameToken => ({ opacity, x, y, scale })

const sequence = (
  enter: ThemeMotionFrameToken,
  exit: ThemeMotionFrameToken,
  staggerMs: number,
  directionalX = false,
): ThemeMotionSequenceToken => ({ enter, exit, staggerMs, directionalX })

export const THEME_EXPERIENCE_EXTENSIONS = {
  'animal-island-ui': {
    foundation: 'animal-island-ui',
    seasonalLayer: 'none',
    animalIslandUi: 'supported',
    motion: {
      id: 'animal-island',
      curve: 'island',
      page: sequence(frame(0), frame(0), 0),
      section: sequence(frame(0, 0, 3), frame(0), 12),
      scenic: sequence(frame(0), frame(0), 0),
      accent: sequence(frame(0), frame(0), 0),
      overlay: sequence(frame(0, 0, 4), frame(0), 0),
      camera: { panX: 0, panY: 0, scaleFrom: 1 },
      ambient: { parallaxX: 0, parallaxY: 0, scale: 1, durationMs: 0 },
    },
  },
  minimal: {
    foundation: 'minimal',
    seasonalLayer: 'none',
    animalIslandUi: 'supported',
    motion: {
      id: 'quiet',
      curve: 'precision',
      page: sequence(frame(0, 2), frame(0, 2), 0, true),
      section: sequence(frame(0, 0, 3), frame(0), 12),
      scenic: sequence(frame(0), frame(0), 12),
      accent: sequence(frame(0), frame(0), 8),
      overlay: sequence(frame(0), frame(0), 0),
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
      curve: 'organic',
      page: sequence(frame(0, 5, 3, 0.995), frame(0, 4, -2, 1.004), 0, true),
      section: sequence(frame(0, -1, 4, 0.995), frame(0, 1, -3, 1.004), 24),
      scenic: sequence(frame(0, 4, 4, 0.99), frame(0, -3, -3, 1.006), 28, true),
      accent: sequence(frame(0, -1, 2, 0.99), frame(0, 1, -1, 1.004), 20),
      overlay: sequence(frame(0, -1, 5, 0.995), frame(0, 1, -3, 1.004), 0),
      camera: { panX: 5, panY: 3, scaleFrom: 0.995 },
      ambient: { parallaxX: 4, parallaxY: 3, scale: 1.01, durationMs: 6400 },
    },
  },
  material: {
    foundation: 'material',
    seasonalLayer: 'none',
    animalIslandUi: 'supported',
    motion: {
      id: 'material-shared-axis',
      curve: 'material',
      page: sequence(frame(0, 10, 0, 0.98), frame(0, -8, 0, 1.01), 0, true),
      section: sequence(frame(0, 6, 0, 0.99), frame(0, -4, 0, 1.005), 12, true),
      scenic: sequence(frame(0, 8, 0, 0.985), frame(0, -5, 0, 1.008), 10, true),
      accent: sequence(frame(0, 0, 0, 0.97), frame(0, 0, 0, 1.015), 8),
      overlay: sequence(frame(0, 0, 8, 0.98), frame(0, 0, -4, 1.01), 0),
      camera: { panX: 10, panY: 0, scaleFrom: 0.98 },
      ambient: { parallaxX: 0, parallaxY: 0, scale: 1, durationMs: 0 },
    },
  },
  'liquid-glass': {
    foundation: 'liquid-glass',
    seasonalLayer: 'none',
    animalIslandUi: 'supported',
    motion: {
      id: 'glass-refraction',
      curve: 'fluid',
      page: sequence(frame(0, 12, 5, 0.985), frame(0, 10, -3, 1.008), 0, true),
      section: sequence(frame(0, 0, 7, 0.99), frame(0, 0, -3), 20),
      scenic: sequence(frame(0, 6, 4, 0.98), frame(0, 4, -2, 1.006), 22, true),
      accent: sequence(frame(0, 0, 1, 0.94), frame(0), 16),
      overlay: sequence(frame(0, 0, 12, 0.98), frame(0, 0, 5, 0.99), 0),
      camera: { panX: 12, panY: 5, scaleFrom: 0.985 },
      ambient: { parallaxX: 3, parallaxY: 2, scale: 1.008, durationMs: 7200 },
    },
  },
} as const satisfies Record<CanonicalThemeId, ThemeExperienceExtension>

/**
 * Return configuration issues for release/QA tooling without crashing the
 * application at module load time when a profile is being edited.
 */
export function collectThemeMotionProfileIssues(): string[] {
  const issues: string[] = []
  for (const family of Object.keys(THEME_EXPERIENCE_EXTENSIONS) as CanonicalThemeId[]) {
    const durations = THEME_MOTION_DURATIONS[family]
    const profile = THEME_EXPERIENCE_EXTENSIONS[family].motion
    for (const role of THEME_MOTION_ROLES) {
      const duration = durations[durationTokenByRole[role]]
      const motion = profile[role]
      if (!Number.isFinite(duration) || duration < 0) issues.push(`${family}:${role} has an invalid duration token`)
      if (!Number.isFinite(motion.staggerMs) || motion.staggerMs < 0) issues.push(`${family}:${role} has an invalid stagger`)
      for (const frame of [motion.enter, motion.exit]) {
        if (!Object.values(frame).every(Number.isFinite) || frame.opacity < 0 || frame.opacity > 1 || frame.scale <= 0) {
          issues.push(`${family}:${role} has an invalid motion frame`)
        }
      }
    }
  }
  return issues
}

export function resolveThemeMotion({
  themeId,
  role,
  intensity,
  direction = 'neutral',
  order = 0,
  readable = false,
}: {
  themeId: ThemeId
  role: ThemeMotionRole
  intensity: MotionIntensity
  direction?: ThemeMotionDirection
  order?: number
  /** Critical content must be readable before the first animation frame. */
  readable?: boolean
}): ResolvedThemeMotion {
  const settled: ThemeMotionState = { opacity: 1, translateX: 0, translateY: 0, scale: 1 }
  const safeIntensity: MotionIntensity = intensity === 'full' || intensity === 'reduced' || intensity === 'none' ? intensity : 'reduced'

  if (safeIntensity === 'none') {
    return {
      from: settled,
      animate: settled,
      exit: { ...settled, opacity: 0 },
      transition: { type: 'timing', duration: 1, delay: 0 },
    }
  }

  if (safeIntensity === 'reduced') {
    return {
      from: { ...settled, opacity: readable ? 0.65 : 0 },
      animate: settled,
      exit: { ...settled, opacity: 0 },
      transition: { type: 'timing', duration: 120, delay: 0 },
    }
  }

  const family = normalizeThemeId(themeId)
  const profile = THEME_EXPERIENCE_EXTENSIONS[family].motion
  const safeRole = isThemeMotionRole(role) ? role : 'section'
  const motion = profile[safeRole]
  const directionMultiplier = direction === 'forward' ? 1 : direction === 'backward' ? -1 : 0
  const resolveFrame = (token: ThemeMotionFrameToken): ThemeMotionState => ({
    opacity: token.opacity,
    translateX: token.x * (motion.directionalX ? directionMultiplier : 1),
    translateY: token.y,
    scale: token.scale,
  })
  const safeOrder = Number.isFinite(order) ? Math.min(6, Math.max(0, Math.trunc(order))) : 0

  return {
    from: { ...resolveFrame(motion.enter), opacity: readable ? Math.max(0.65, motion.enter.opacity) : motion.enter.opacity },
    animate: settled,
    exit: resolveFrame(motion.exit),
    transition: {
      type: 'timing',
      duration: THEME_MOTION_DURATIONS[family][durationTokenByRole[safeRole]],
      delay: Math.min(safeOrder * motion.staggerMs, 180),
    },
  }
}
