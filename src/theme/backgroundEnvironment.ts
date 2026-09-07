import type { CanonicalThemeId, ThemeBackgroundIntensity, ThemeBackgroundMotion, ThemeBackgroundVariation } from '@/types/settingsContracts'
import type { ResolvedThemeMode } from './colors'

export type BackgroundEnvironmentKind = 'minimal' | 'atmospheric' | 'tonal' | 'fluid'

export interface BackgroundEnvironmentConfig {
  family: CanonicalThemeId
  kind: BackgroundEnvironmentKind
  mode: ResolvedThemeMode
  variation: ThemeBackgroundVariation
  motion: ThemeBackgroundMotion
  intensity: ThemeBackgroundIntensity
  seed: number
  preset: number
  layerCount: number
  visualIntensity: number
  amplitude: number
  cycleMs: number
  grainOpacity: number
}

export interface ResolveBackgroundEnvironmentInput {
  family: CanonicalThemeId
  mode: ResolvedThemeMode
  accent?: string
  variation?: ThemeBackgroundVariation
  motion?: ThemeBackgroundMotion
  intensity?: ThemeBackgroundIntensity
  preset?: number
  now?: Date
  startupSeed?: number
  rotationEpoch?: number
}

export const DEFAULT_BACKGROUND_VARIATION: ThemeBackgroundVariation = 'daily'
export const DEFAULT_BACKGROUND_MOTION: ThemeBackgroundMotion = 'subtle'
export const DEFAULT_BACKGROUND_INTENSITY: ThemeBackgroundIntensity = 'low'

const DEFAULT_MOTION_BY_FAMILY: Readonly<Record<CanonicalThemeId, ThemeBackgroundMotion>> = Object.freeze({
  minimal: 'static',
  monet: 'subtle',
  material: 'static',
  'liquid-glass': 'subtle',
})

const KIND_BY_FAMILY: Readonly<Record<CanonicalThemeId, BackgroundEnvironmentKind>> = Object.freeze({
  minimal: 'minimal',
  monet: 'atmospheric',
  material: 'tonal',
  'liquid-glass': 'fluid',
})

const LAYER_BUDGET: Readonly<Record<BackgroundEnvironmentKind, Readonly<Record<ThemeBackgroundMotion, number>>>> = Object.freeze({
  minimal: Object.freeze({ static: 1, subtle: 1, dynamic: 2, immersive: 2 }),
  atmospheric: Object.freeze({ static: 3, subtle: 3, dynamic: 4, immersive: 5 }),
  tonal: Object.freeze({ static: 2, subtle: 2, dynamic: 3, immersive: 3 }),
  fluid: Object.freeze({ static: 3, subtle: 4, dynamic: 5, immersive: 6 }),
})

const INTENSITY_SCALE: Readonly<Record<ThemeBackgroundIntensity, number>> = Object.freeze({
  low: 0.62,
  medium: 0.84,
  high: 1,
})

const MOTION_SCALE: Readonly<Record<ThemeBackgroundMotion, number>> = Object.freeze({
  static: 0,
  subtle: 0.42,
  dynamic: 0.72,
  immersive: 1,
})

const CYCLE_MS: Readonly<Record<BackgroundEnvironmentKind, number>> = Object.freeze({
  minimal: 96_000,
  atmospheric: 72_000,
  tonal: 88_000,
  fluid: 64_000,
})

/**
 * Resolves user preferences and theme expression into one immutable runtime
 * environment. Presentation code consumes this contract instead of inferring
 * a wallpaper or family-specific animation policy.
 */
export function resolveBackgroundEnvironment(input: ResolveBackgroundEnvironmentInput): BackgroundEnvironmentConfig {
  const kind = KIND_BY_FAMILY[input.family]
  const variation = input.variation ?? DEFAULT_BACKGROUND_VARIATION
  const motion = input.motion ?? DEFAULT_MOTION_BY_FAMILY[input.family]
  const intensity = input.intensity ?? DEFAULT_BACKGROUND_INTENSITY
  const preset = normalizeBackgroundPreset(input.preset)
  const now = input.now ?? new Date()
  const variationKey = resolveVariationKey(variation, now, preset, input.startupSeed, input.rotationEpoch)
  const seed = hashEnvironmentSeed(`${input.family}:${input.mode}:${input.accent ?? 'default'}:${variationKey}`)
  const familyAmplitude = kind === 'minimal' ? 0.24 : kind === 'tonal' ? 0.46 : kind === 'atmospheric' ? 0.72 : 1

  return Object.freeze({
    family: input.family,
    kind,
    mode: input.mode,
    variation,
    motion,
    intensity,
    seed,
    preset,
    layerCount: LAYER_BUDGET[kind][motion],
    visualIntensity: familyAmplitude * INTENSITY_SCALE[intensity],
    amplitude: familyAmplitude * INTENSITY_SCALE[intensity] * MOTION_SCALE[motion],
    cycleMs: CYCLE_MS[kind],
    grainOpacity: kind === 'fluid' ? 0.018 * INTENSITY_SCALE[intensity] : 0,
  })
}

export function normalizeBackgroundPreset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(3, Math.round(value)))
}

export function seededEnvironmentValue(seed: number, index: number): number {
  let value = (seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return (value >>> 0) / 0xffffffff
}

export function hashEnvironmentSeed(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function resolveVariationKey(
  variation: ThemeBackgroundVariation,
  now: Date,
  preset: number,
  startupSeed = 0,
  rotationEpoch = 0,
): string {
  if (variation === 'preset') return `preset-${preset}`
  if (variation === 'startup') return `startup-${startupSeed}`
  if (variation === 'random') return `random-${rotationEpoch}`
  if (variation === 'daily') {
    return `daily-${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
  }
  return 'fixed'
}
