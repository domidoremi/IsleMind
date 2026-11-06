import type { ReasoningControlValue } from '@/utils/modelReasoning'
import { normalizeThemeId, type AppPalette } from '@/theme/colors'
import { resolveThemeMotionDurations } from '@/theme/themeTokens'
import type { CanonicalThemeId } from '@/types/settingsContracts'

export interface ReasoningEffortEffect {
  themeId: CanonicalThemeId
  start: string
  end: string
  core: 'pearl' | 'hollow' | 'seed' | 'orb' | 'star'
  rings: number
  sparks: number
  halo: number
  pop: number
  turn: number
  lift: number
  duration: number
  trackHeight: number
  stopWidth: number
  stopHeight: number
  surfaceRadius: number
  surfaceOpacity: [number, number]
  borderOpacity: number
}

type EffectDefinition = Pick<ReasoningEffortEffect, 'core' | 'rings' | 'sparks' | 'halo' | 'pop' | 'turn' | 'duration'> & {
  light: [string, string]
  dark: [string, string]
}

// Visual identity follows the semantic level, including models with sparse options.
const EFFECTS: Record<ReasoningControlValue, EffectDefinition> = {
  default: {
    light: ['#8A9DB4', '#647C9C'], dark: ['#D5DEE9', '#9CB4D2'],
    core: 'pearl', rings: 1, sparks: 0, halo: 0.06, pop: 1.05, turn: 18, duration: 420,
  },
  none: {
    light: ['#8E979F', '#68737E'], dark: ['#A5ADB5', '#808B96'],
    core: 'hollow', rings: 0, sparks: 0, halo: 0, pop: 1, turn: 0, duration: 0,
  },
  minimal: {
    light: ['#4AAE8B', '#267C65'], dark: ['#A2E8BE', '#6DCAA4'],
    core: 'seed', rings: 0, sparks: 1, halo: 0.05, pop: 1.08, turn: 24, duration: 360,
  },
  low: {
    light: ['#27A5B7', '#177F9B'], dark: ['#8AE3E5', '#68C6E4'],
    core: 'orb', rings: 1, sparks: 1, halo: 0.1, pop: 1.12, turn: 36, duration: 460,
  },
  medium: {
    light: ['#5A8ED8', '#6864CA'], dark: ['#A1C9FF', '#B1A7F2'],
    core: 'orb', rings: 2, sparks: 1, halo: 0.13, pop: 1.16, turn: 54, duration: 560,
  },
  high: {
    light: ['#9864CE', '#B05AAF'], dark: ['#C6A4FC', '#E5A3DA'],
    core: 'orb', rings: 2, sparks: 2, halo: 0.17, pop: 1.2, turn: 72, duration: 620,
  },
  xhigh: {
    light: ['#C568AC', '#CE607F'], dark: ['#E5A3DE', '#F59CAF'],
    core: 'orb', rings: 2, sparks: 3, halo: 0.21, pop: 1.23, turn: 96, duration: 700,
  },
  max: {
    light: ['#C69B2D', '#BE703A'], dark: ['#F3D483', '#EEAF73'],
    core: 'star', rings: 2, sparks: 4, halo: 0.24, pop: 1.26, turn: 120, duration: 780,
  },
  ultra: {
    light: ['#D47F4C', '#C95883'], dark: ['#FFC394', '#F99CB9'],
    core: 'star', rings: 3, sparks: 5, halo: 0.28, pop: 1.3, turn: 150, duration: 900,
  },
}

const THEME_STYLES = {
  minimal: {
    blend: 0.22, halo: 0, pop: 0.18, turn: 0, lift: 0, duration: 0.08,
    trackHeight: 1.5, stopWidth: 1, stopHeight: 5, surfaceRadius: 5,
    lightSurface: [0, 0], darkSurface: [0, 0], borderOpacity: 0.12,
  },
  monet: {
    blend: 0.18, halo: 0.65, pop: 0.55, turn: 0.2, lift: -1, duration: 0.32,
    trackHeight: 2.5, stopWidth: 2, stopHeight: 6, surfaceRadius: 9,
    lightSurface: [0.07, 0.03], darkSurface: [0.14, 0.06], borderOpacity: 0.1,
  },
  material: {
    blend: 0.58, halo: 0.35, pop: 0.3, turn: 0.1, lift: 0, duration: 0.18,
    trackHeight: 4, stopWidth: 3, stopHeight: 3, surfaceRadius: 12,
    lightSurface: [0.13, 0.1], darkSurface: [0.2, 0.14], borderOpacity: 0,
  },
  'liquid-glass': {
    blend: 0.12, halo: 1.1, pop: 0.8, turn: 0.8, lift: 0, duration: 0.65,
    trackHeight: 2, stopWidth: 3, stopHeight: 3, surfaceRadius: 15,
    lightSurface: [0.12, 0.04], darkSurface: [0.22, 0.09], borderOpacity: 0.22,
  },
  'animal-island-ui': {
    blend: 0.26, halo: 0.7, pop: 1.15, turn: 0.18, lift: -2.2, duration: 0.4,
    trackHeight: 3, stopWidth: 3, stopHeight: 5, surfaceRadius: 15,
    lightSurface: [0.1, 0.06], darkSurface: [0.17, 0.1], borderOpacity: 0.16,
  },
} as const satisfies Record<CanonicalThemeId, {
  blend: number; halo: number; pop: number; turn: number; lift: number; duration: number
  trackHeight: number; stopWidth: number; stopHeight: number; surfaceRadius: number
  lightSurface: readonly [number, number]; darkSurface: readonly [number, number]; borderOpacity: number
}>

function mixReasoningColor(source: string, target: string, amount: number): string {
  const channels = [1, 3, 5].map(offset => {
    const from = Number.parseInt(source.slice(offset, offset + 2), 16)
    const to = Number.parseInt(target.slice(offset, offset + 2), 16)
    return Math.round(from + (to - from) * amount).toString(16).padStart(2, '0')
  })
  return `#${channels.join('')}`
}

export function resolveReasoningEffortEffect(level: ReasoningControlValue, colors: AppPalette, dark: boolean): ReasoningEffortEffect {
  const themeId = normalizeThemeId(colors.ui.family)
  const { light, dark: darkColors, ...identity } = EFFECTS[level]
  const [baseStart, baseEnd] = dark ? darkColors : light
  const style = THEME_STYLES[themeId]
  const idle = level === 'none'
  const blend = level === 'default' ? 0.55 : style.blend
  const start = idle ? colors.textTertiary : mixReasoningColor(baseStart, colors.primary, blend)
  const end = idle ? colors.textSecondary : mixReasoningColor(baseEnd, colors.primary, blend)
  const duration = idle ? 0 : resolveThemeMotionDurations(themeId).emphasis + Math.round(identity.duration * style.duration)
  return {
    ...identity, themeId, start, end,
    halo: identity.halo * style.halo,
    pop: 1 + (identity.pop - 1) * style.pop,
    turn: identity.turn * style.turn,
    lift: idle ? 0 : style.lift,
    duration,
    trackHeight: style.trackHeight,
    stopWidth: style.stopWidth,
    stopHeight: style.stopHeight,
    surfaceRadius: style.surfaceRadius,
    surfaceOpacity: [...(dark ? style.darkSurface : style.lightSurface)],
    borderOpacity: style.borderOpacity * (dark ? 1.3 : 1),
  }
}
