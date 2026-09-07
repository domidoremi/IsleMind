import {
  normalizeThemeAccentValue,
  normalizeThemeFamilyValue,
  normalizeThemeModeValue,
  type CanonicalThemeId,
  type ThemeId,
  type ThemeMode,
} from '@/types/settingsContracts'
import { resolveThemeDesignTokens, THEME_FAMILIES, type ThemeDesignTokens, type ThemeFamily } from './themeTokens'
export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>

export type ThemeCardColor =
  | 'default'
  | 'app-pink'
  | 'purple'
  | 'app-blue'
  | 'app-yellow'
  | 'app-orange'
  | 'app-teal'
  | 'app-green'
  | 'app-red'
  | 'lime-green'
  | 'yellow-green'
  | 'brown'
  | 'warm-peach-pink'

type CardColorMap = Record<ThemeCardColor, { bg: string; fg: string }>

export type ThemeBackgroundMode = 'plain' | 'ambient' | 'focus' | 'surface'
export type ThemeBackgroundMotion = 'none' | 'subtle' | 'full'

export interface ThemeExperienceTokens {
  layout: 'quiet' | 'editorial' | 'document' | 'structured' | 'layered'
  navigation: 'quiet' | 'route' | 'document' | 'material' | 'glass'
  background: 'plain' | 'road' | 'document' | 'tonal' | 'glass'
  transition: 'fade' | 'travel' | 'cut' | 'shared-axis' | 'fluid'
  density: 'airy' | 'balanced' | 'compact'
}

type ThemeToneToken = {
  background: string
  foreground: string
  border: string
}

export interface ThemeBackgroundTokens {
  defaultMode: ThemeBackgroundMode
  canvas: string
  focusCanvas: string
  surfaceCanvas: string
  mist: {
    primary: string
    secondary: string
    warm: string
    coolOpacity: number
    warmOpacity: number
    focusOpacity: number
    surfaceOpacity: number
  }
  trace: {
    primary: string
    secondary: string
    accent: string
    opacity: number
    focusOpacity: number
    surfaceOpacity: number
  }
  grid: string
  scrim: string
  motion: ThemeBackgroundMotion
}

interface ThemeUiTokens {
  family: CanonicalThemeId
  minimal: boolean
  monet: boolean
  material: boolean
  liquidGlass: boolean
  ornamented: boolean
  ambient: 'plain' | CanonicalThemeId
  experience: ThemeExperienceTokens
  semantic: {
    surface: {
      canvas: string
      base: string
      raised: string
      muted: string
      overlay: string
    }
    content: {
      primary: string
      secondary: string
      tertiary: string
      inverse: string
    }
    chrome: {
      background: string
      border: string
      toolbar: string
      sheet: string
    }
    control: {
      background: string
      foreground: string
      border: string
      focus: string
    }
    feedback: {
      success: ThemeToneToken
      warning: ThemeToneToken
      danger: ThemeToneToken
      info: ThemeToneToken
    }
  }
  section: {
    marker: string
    title: string
    divider: string
  }
  icon: {
    accentBackground: string
    accentForeground: string
  }
  tone: {
    success: ThemeToneToken
    warning: ThemeToneToken
    danger: ThemeToneToken
    info: ThemeToneToken
    neutral: ThemeToneToken
    ink: ThemeToneToken
  }
  radius: {
    card: number
    titleCard: number
    panel: number
    modal: number
    field: number
    chip: number
    controlSmall: number
    controlMiddle: number
    controlLarge: number
  }
  control: {
    primaryBackground: string
    primaryForeground: string
    dangerForeground: string
    primaryBorder: string
    defaultBackground: string
    disabledBackground: string
    disabledForeground: string
    disabledBorder: string
    disabledOpacity: number
    link: string
    focus: string
    shadow: string
    dangerShadow: string
    primaryShadowOpacity: number
    primaryShadowRadius: number
    primaryShadowOffset: number
    secondaryShadowOpacity: number
    secondaryShadowRadius: number
    secondaryShadowOffset: number
  }
  input: {
    background: string
    backgroundFocused: string
    disabledBackground: string
    disabledForeground: string
    placeholderForeground: string
    border: string
    focus: string
    shadow: string
    shadowOpacity: number
    shadowRadius: number
  }
  switch: {
    trackOn: string
    trackOff: string
    trackOnBorder: string
    trackOffBorder: string
    thumb: string
    thumbOnBorder: string
    thumbOffBorder: string
    shadowOpacity: number
  }
  card: {
    defaultBackground: string
    mutedBackground: string
    shadowOpacity: number
    shadowRadius: number
    shadowOffset: number
  }
  composer: {
    shellBackground: string
    shellFocusedBackground: string
    toolbarBackground: string
    toolbarBorder: string
    statusBackground: string
    statusForeground: string
  }
  actionBar: {
    background: string
    border: string
    itemBackground: string
    itemBorder: string
    itemActiveBackground: string
  }
  message: {
    userBackground: string
    userForeground: string
    userBorder: string
    userActionBackground: string
    userActionForeground: string
  }
  code: {
    background: string
    border: string
    text: string
  }
  table: {
    headerBackground: string
  }
  loading: {
    background: string
    border: string
    dot: string
  }
  time: {
    border: string
    divider: string
  }
  footer: {
    sea: string[]
    tree: string[]
  }
}

export interface AppPalette {
  surface: string
  surfaceSecondary: string
  surfaceTertiary: string
  primary: string
  primaryForeground: string
  secondary: string
  /** Effective brand/interaction colour, including a custom accent override. */
  brand: string
  brandForeground: string
  /** Theme-owned decorative tertiary colour; custom brand accents do not replace it. */
  tertiary: string
  tertiaryForeground: string
  border: string
  borderStrong: string
  text: string
  textSecondary: string
  textTertiary: string
  success: string
  warning: string
  error: string
  backdrop: string
  shadowTint: string
  background: ThemeBackgroundTokens
  material: {
    canvas: string
    paper: string
    paperRaised: string
    paperPressed: string
    glass: string
    chrome: string
    field: string
    stroke: string
    strokeStrong: string
    sheet: {
      surface: string
      chrome: string
      body: string
      border: string
      divider: string
    }
  }
  status: {
    info: string
    success: string
    warning: string
    danger: string
    idle: string
  }
  shadow: {
    color: string
    softOpacity: number
    mediumOpacity: number
    strongOpacity: number
  }
  cardColors: CardColorMap
  ui: ThemeUiTokens
  /** Complete reference/system/component token snapshot for new consumers. */
  design?: ThemeDesignTokens
}

// Monet card accents: paper, cobalt route ink, acid markers, coral notes, and warm earth.
const monetCards: CardColorMap = {
  default: { bg: '#F4F1E8', fg: '#25272B' },
  'app-pink': { bg: '#F7C3D2', fg: '#6D2945' },
  purple: { bg: '#C7D2F2', fg: '#273B73' },
  'app-blue': { bg: '#B8E0EA', fg: '#174A63' },
  'app-yellow': { bg: '#E8FC32', fg: '#34420B' },
  'app-orange': { bg: '#E9B47A', fg: '#62391F' },
  'app-teal': { bg: '#B9E2DF', fg: '#164C5B' },
  'app-green': { bg: '#C5DD9A', fg: '#315329' },
  'app-red': { bg: '#F5A0A5', fg: '#712A36' },
  'lime-green': { bg: '#E8FC32', fg: '#34420B' },
  'yellow-green': { bg: '#DCE78C', fg: '#4E5E1A' },
  brown: { bg: '#D2BC74', fg: '#503A21' },
  'warm-peach-pink': { bg: '#F4B19C', fg: '#643328' },
}

const minimalCards: CardColorMap = {
  default: { bg: '#ffffff', fg: '#1b1d1f' },
  'app-pink': { bg: '#f1e8e5', fg: '#7b4538' },
  purple: { bg: '#ecebff', fg: '#47407c' },
  'app-blue': { bg: '#e8eef8', fg: '#314765' },
  'app-yellow': { bg: '#f3ecd8', fg: '#725421' },
  'app-orange': { bg: '#f2e8de', fg: '#785135' },
  'app-teal': { bg: '#e3f0ed', fg: '#2f6259' },
  'app-green': { bg: '#e6efe6', fg: '#3b6440' },
  'app-red': { bg: '#f5e7e5', fg: '#7d3836' },
  'lime-green': { bg: '#edf1de', fg: '#536226' },
  'yellow-green': { bg: '#f0eddc', fg: '#696027' },
  brown: { bg: '#ebe7df', fg: '#51483d' },
  'warm-peach-pink': { bg: '#f1e5e0', fg: '#765044' },
}

const THEME_FOOTER_TOKENS: Record<ThemeFamily, Record<ResolvedThemeMode, ThemeUiTokens['footer']>> = {
  minimal: {
    light: { sea: ['#d9e9e5', '#b7d4ce', '#8fb9b0'], tree: ['#dfe8df', '#cbd9ca', '#b4c7b5'] },
    dark: { sea: ['#1f3f46', '#335c63', '#46737a'], tree: ['#24322f', '#33453f', '#42584f'] },
  },
  monet: {
    light: { sea: ['#B8E0EA', '#84BAC1', '#0D6AC4'], tree: ['#D2BC74', '#AB594E', '#E8FC32'] },
    dark: { sea: ['#193C50', '#2A718B', '#5DB8D1'], tree: ['#3B3820', '#75652B', '#E8FC32'] },
  },
  material: {
    light: { sea: ['#DDF4FF', '#B6E3FF', '#80CCFF'], tree: ['#DAFBE1', '#ACEEBB', '#6FDD8B'] },
    dark: { sea: ['#17243A', '#1F3A5F', '#315A73'], tree: ['#1B2A24', '#244237', '#315C4B'] },
  },
  'liquid-glass': {
    light: { sea: ['#d9e9e5', '#b7d4ce', '#8fb9b0'], tree: ['#dfe8df', '#cbd9ca', '#b4c7b5'] },
    dark: { sea: ['#1f3f46', '#335c63', '#46737a'], tree: ['#24322f', '#33453f', '#42584f'] },
  },
}

function resolveThemeCardColors(family: ThemeFamily): CardColorMap {
  return family === 'monet' ? monetCards : minimalCards
}

function resolveThemeFooter(family: ThemeFamily, mode: ResolvedThemeMode): ThemeUiTokens['footer'] {
  return THEME_FOOTER_TOKENS[family][mode]
}
function projectDesignPalette(
  family: ThemeFamily,
  mode: ResolvedThemeMode,
): AppPalette {
  const design = resolveThemeDesignTokens(family, mode)
  const color = design.semantic.color
  const component = design.component
  const radius = design.semantic.radius
  const elevation = design.semantic.elevation
  const dark = mode === 'dark'
  const monet = family === 'monet'
  const material = family === 'material'
  const liquidGlass = family === 'liquid-glass'
  const minimal = family === 'minimal'
  const experience: ThemeExperienceTokens = minimal
    ? { layout: 'quiet', navigation: 'quiet', background: 'plain', transition: 'fade', density: 'compact' }
    : monet
      ? { layout: 'editorial', navigation: 'route', background: 'road', transition: 'travel', density: 'airy' }
      : material
        ? { layout: 'structured', navigation: 'material', background: 'tonal', transition: 'shared-axis', density: 'compact' }
        : { layout: 'layered', navigation: 'glass', background: 'glass', transition: 'fluid', density: 'balanced' }
  const backgroundMode: ThemeBackgroundMode = minimal ? 'plain' : material ? 'surface' : 'ambient'
  const softShadowOpacity = elevation.shadowOpacity * 0.55
  const mediumShadowOpacity = elevation.shadowOpacity * 0.78

  return {
    surface: color.canvas,
    surfaceSecondary: color.surface,
    surfaceTertiary: color.surfaceMuted,
    primary: color.primary,
    primaryForeground: color.onPrimary,
    secondary: color.secondary,
    brand: color.primary,
    brandForeground: color.onPrimary,
    tertiary: color.tertiary,
    tertiaryForeground: color.onTertiary,
    border: color.border,
    borderStrong: color.borderStrong,
    text: color.onSurface,
    textSecondary: color.onSurfaceMuted,
    textTertiary: color.onSurfaceMuted,
    success: color.success,
    warning: color.warning,
    error: color.error,
    backdrop: dark ? 'rgba(0, 0, 0, 0.58)' : 'rgba(21, 35, 49, 0.42)',
    shadowTint: elevation.shadowColor,
    background: {
      defaultMode: backgroundMode,
      canvas: color.canvas,
      focusCanvas: color.surfaceContainer,
      surfaceCanvas: color.surface,
      mist: {
        primary: color.primaryContainer,
        secondary: color.secondaryContainer,
        warm: color.tertiary,
        coolOpacity: monet ? 0.2 : liquidGlass ? 0.14 : 0,
        warmOpacity: monet ? 0.12 : liquidGlass ? 0.06 : 0,
        focusOpacity: monet ? 0.12 : liquidGlass ? 0.08 : 0,
        surfaceOpacity: monet ? 0.08 : liquidGlass ? 0.06 : 0,
      },
      trace: {
        primary: color.primary,
        secondary: color.secondary,
        accent: color.tertiary,
        opacity: monet ? 0.18 : liquidGlass ? 0.08 : 0,
        focusOpacity: monet ? 0.12 : liquidGlass ? 0.06 : 0,
        surfaceOpacity: monet ? 0.1 : liquidGlass ? 0.05 : 0,
      },
      grid: color.divider,
      scrim: dark ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.12)',
      motion: minimal || material ? 'none' : 'subtle',
    },
    material: {
      canvas: color.canvas,
      paper: color.surface,
      paperRaised: color.surfaceElevated,
      paperPressed: color.surfaceMuted,
      glass: color.surfaceOverlay,
      chrome: component.navigation.background,
      field: component.field.background,
      stroke: color.border,
      strokeStrong: color.borderStrong,
      sheet: {
        surface: component.panel.background,
        chrome: component.navigation.background,
        body: liquidGlass ? color.surfaceElevated : color.surface,
        border: color.borderStrong,
        divider: color.divider,
      },
    },
    status: {
      info: color.info,
      success: color.success,
      warning: color.warning,
      danger: color.error,
      idle: color.onSurfaceMuted,
    },
    shadow: {
      color: elevation.shadowColor,
      softOpacity: softShadowOpacity,
      mediumOpacity: mediumShadowOpacity,
      strongOpacity: elevation.shadowOpacity,
    },
    cardColors: resolveThemeCardColors(family),
    ui: {
      family,
      minimal,
      monet,
      material,
      liquidGlass,
      ornamented: monet || liquidGlass,
      ambient: minimal ? 'plain' : family,
      experience,
      semantic: {
        surface: {
          canvas: color.canvas,
          base: color.surface,
          raised: color.surfaceElevated,
          muted: color.surfaceMuted,
          overlay: color.surfaceOverlay,
        },
        content: {
          primary: color.onSurface,
          secondary: color.onSurfaceMuted,
          tertiary: color.onSurfaceMuted,
          inverse: color.onPrimary,
        },
        chrome: {
          background: component.navigation.background,
          border: component.navigation.border,
          toolbar: component.navigation.activeBackground,
          sheet: component.panel.background,
        },
        control: {
          background: component.button.primaryBackground,
          foreground: component.button.primaryForeground,
          border: color.borderStrong,
          focus: color.focus,
        },
        feedback: {
          success: { background: color.surfaceMuted, foreground: color.success, border: color.success },
          warning: { background: color.secondaryContainer, foreground: color.warning, border: color.warning },
          danger: { background: color.surfaceMuted, foreground: color.error, border: color.error },
          info: { background: color.secondaryContainer, foreground: color.info, border: color.info },
        },
      },
      section: {
        marker: color.tertiary,
        title: color.onSurface,
        divider: color.divider,
      },
      icon: {
        accentBackground: color.primaryContainer,
        accentForeground: color.onPrimaryContainer,
      },
      tone: {
        success: { background: color.surfaceMuted, foreground: color.success, border: color.success },
        warning: { background: color.secondaryContainer, foreground: color.warning, border: color.warning },
        danger: { background: color.surfaceMuted, foreground: color.error, border: color.error },
        info: { background: color.secondaryContainer, foreground: color.info, border: color.info },
        neutral: { background: color.surfaceContainer, foreground: color.onSurfaceMuted, border: color.border },
        ink: { background: color.primary, foreground: color.onPrimary, border: color.borderStrong },
      },
      radius: {
        card: radius.large,
        titleCard: radius.extraLarge,
        panel: radius.large,
        modal: radius.extraLarge,
        field: radius.medium,
        chip: radius.pill,
        controlSmall: radius.small,
        controlMiddle: radius.medium,
        controlLarge: radius.large,
      },
      control: {
        primaryBackground: component.button.primaryBackground,
        primaryForeground: component.button.primaryForeground,
        dangerForeground: color.onPrimary,
        primaryBorder: color.borderStrong,
        defaultBackground: component.button.secondaryBackground,
        disabledBackground: component.button.disabledBackground,
        disabledForeground: component.button.disabledForeground,
        disabledBorder: color.border,
        disabledOpacity: 1,
        link: color.primary,
        focus: color.focus,
        shadow: elevation.shadowColor,
        dangerShadow: elevation.shadowColor,
        primaryShadowOpacity: elevation.shadowOpacity,
        primaryShadowRadius: elevation.shadowBlur,
        primaryShadowOffset: elevation.shadowOffsetY,
        secondaryShadowOpacity: softShadowOpacity,
        secondaryShadowRadius: Math.max(0, Math.round(elevation.shadowBlur * 0.6)),
        secondaryShadowOffset: Math.max(0, Math.round(elevation.shadowOffsetY * 0.6)),
      },
      input: {
        background: component.field.background,
        backgroundFocused: component.field.backgroundFocused,
        disabledBackground: color.surfaceMuted,
        disabledForeground: color.onSurfaceMuted,
        placeholderForeground: component.field.placeholder,
        border: component.field.border,
        focus: component.field.focus,
        shadow: elevation.shadowColor,
        shadowOpacity: softShadowOpacity,
        shadowRadius: Math.max(0, Math.round(elevation.shadowBlur * 0.5)),
      },
      switch: {
        trackOn: color.primary,
        trackOff: color.surfaceMuted,
        trackOnBorder: color.borderStrong,
        trackOffBorder: color.border,
        thumb: color.surfaceElevated,
        thumbOnBorder: color.onPrimary,
        thumbOffBorder: color.borderStrong,
        shadowOpacity: softShadowOpacity,
      },
      card: {
        defaultBackground: component.panel.background,
        mutedBackground: color.surfaceContainer,
        shadowOpacity: softShadowOpacity,
        shadowRadius: elevation.shadowBlur,
        shadowOffset: elevation.shadowOffsetY,
      },
      composer: {
        shellBackground: liquidGlass ? color.surfaceOverlay : color.surface,
        shellFocusedBackground: color.surfaceElevated,
        toolbarBackground: component.navigation.activeBackground,
        toolbarBorder: color.border,
        statusBackground: color.surfaceMuted,
        statusForeground: color.onSurfaceMuted,
      },
      actionBar: {
        background: component.navigation.background,
        border: component.navigation.border,
        // Glass items sit on an already-frosted lens; the interactive material
        // gives them a faint inner tint instead of the solid surfaceContainer,
        // which reads as a white rectangle on the lens.
        itemBackground: liquidGlass
          ? design.semantic.surface.interactive.background
          : color.surfaceContainer,
        itemBorder: liquidGlass
          ? design.semantic.surface.interactive.border
          : color.border,
        itemActiveBackground: color.primaryContainer,
      },
      message: {
        userBackground: component.message.userBackground,
        userForeground: component.message.userForeground,
        userBorder: component.message.border,
        userActionBackground: color.selection,
        userActionForeground: component.message.userForeground,
      },
      code: {
        background: dark ? '#0D1722' : '#162733',
        border: dark ? '#385061' : '#385061',
        text: '#F2F7F9',
      },
      table: { headerBackground: color.surfaceContainer },
      loading: {
        background: color.primaryContainer,
        border: color.primary,
        dot: color.onPrimaryContainer,
      },
      time: { border: color.border, divider: color.divider },
      footer: resolveThemeFooter(family, mode),
    },
    design,
  }
}

export const DEFAULT_THEME_ID: CanonicalThemeId = 'minimal'
export const themeIds = THEME_FAMILIES

type ThemePalettePair = Readonly<Record<ResolvedThemeMode, AppPalette>>

const freezeThemeValue = <T,>(value: T): T => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) freezeThemeValue(child)
  return value
}

const palettePair = (
  light: AppPalette,
  dark: AppPalette,
): ThemePalettePair => freezeThemeValue({ light, dark })

/** The only runtime palette registry. Every key is a canonical family. */
export const THEME_PALETTE_REGISTRY: Readonly<Record<CanonicalThemeId, ThemePalettePair>> = freezeThemeValue({
  minimal: palettePair(
    projectDesignPalette('minimal', 'light'),
    projectDesignPalette('minimal', 'dark'),
  ),
  monet: palettePair(
    projectDesignPalette('monet', 'light'),
    projectDesignPalette('monet', 'dark'),
  ),
  material: palettePair(
    projectDesignPalette('material', 'light'),
    projectDesignPalette('material', 'dark'),
  ),
  'liquid-glass': palettePair(
    projectDesignPalette('liquid-glass', 'light'),
    projectDesignPalette('liquid-glass', 'dark'),
  ),
})

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_FAMILIES as readonly string[]).includes(value)
}

export function normalizeThemeId(value: unknown): CanonicalThemeId {
  return normalizeThemeFamilyValue(value) ?? DEFAULT_THEME_ID
}

export function resolveThemeMode(theme: unknown, systemScheme?: 'light' | 'dark' | null): ResolvedThemeMode {
  const normalizedTheme = normalizeThemeModeValue(theme) ?? 'system'
  if (normalizedTheme !== 'system') return normalizedTheme
  return normalizeThemeModeValue(systemScheme) === 'dark' ? 'dark' : 'light'
}

/** Resolve a palette through the canonical registry, failing closed for bridge callers. */
export function resolveThemePalette(themeId: unknown, mode: unknown): AppPalette {
  const canonical = normalizeThemeId(themeId)
  const resolvedMode: ResolvedThemeMode = mode === 'dark' ? 'dark' : 'light'
  return THEME_PALETTE_REGISTRY[canonical][resolvedMode]
}

/**
 * Custom accents are user-controlled input.  Keep a small LRU rather than an
 * unbounded map: a colour picker or imported settings can otherwise retain an
 * arbitrary number of complete palette graphs for the lifetime of the app.
 */
export const THEME_ACCENT_CACHE_MAX_ENTRIES = 64
const customAccentPaletteCache = new Map<string, AppPalette>()

function touchAccentCache(key: string, value: AppPalette): void {
  // Map insertion order gives us an allocation-free LRU implementation.
  customAccentPaletteCache.delete(key)
  customAccentPaletteCache.set(key, value)
  while (customAccentPaletteCache.size > THEME_ACCENT_CACHE_MAX_ENTRIES) {
    const oldest = customAccentPaletteCache.keys().next().value as string | undefined
    if (oldest === undefined) break
    customAccentPaletteCache.delete(oldest)
  }
}

/** @internal Exposed for deterministic diagnostics and unit tests. */
export function getThemeAccentPaletteCacheSize(): number {
  return customAccentPaletteCache.size
}

/** @internal Clears only derived palettes; canonical palettes remain intact. */
export function clearThemeAccentPaletteCache(): void {
  customAccentPaletteCache.clear()
}

export function normalizeThemeAccent(value: unknown): string | undefined {
  return normalizeThemeAccentValue(value)
}

export function getColors(
  theme: ThemeMode | ResolvedThemeMode,
  themeId: ThemeId = DEFAULT_THEME_ID,
  systemScheme?: 'light' | 'dark' | null,
  themeAccent?: string,
) {
  const resolvedMode = resolveThemeMode(theme as ThemeMode, systemScheme)
  const normalizedThemeId = normalizeThemeId(themeId)
  const basePalette = resolveThemePalette(normalizedThemeId, resolvedMode)
  const normalizedAccent = normalizeThemeAccent(themeAccent)
  if (!normalizedAccent) return basePalette

  const cacheKey = `${normalizedThemeId}:${resolvedMode}:${normalizedAccent}`
  const cached = customAccentPaletteCache.get(cacheKey)
  if (cached) {
    touchAccentCache(cacheKey, cached)
    return cached
  }

  const palette = freezeThemeValue(applyThemeAccent(basePalette, normalizedAccent, resolvedMode))
  touchAccentCache(cacheKey, palette)
  return palette
}

function applyThemeAccent(base: AppPalette, accent: string, mode: ResolvedThemeMode): AppPalette {
  const foreground = readableForeground(accent)
  const readableAccent = ensureContrast(accent, base.background.canvas, mode, base.background.canvas)
  const wash = rgba(accent, mode === 'dark' ? 0.18 : 0.11)
  const border = rgba(accent, mode === 'dark' ? 0.52 : 0.38)
  const readableAccentOnWash = ensureContrast(foreground, wash, mode, base.background.canvas)
  const readableActionForeground = ensureContrast(
    foreground,
    base.ui.message.userActionBackground,
    mode,
    accent,
  )
  const ambientPrimary = mixHex(accent, base.background.canvas, mode === 'dark' ? 0.58 : 0.72)
  const ambientSecondary = mixHex(accent, base.background.mist.secondary, mode === 'dark' ? 0.62 : 0.76)
  const surfaceTint = rgba(accent, mode === 'dark' ? 0.1 : 0.065)
  const surfaceBorder = rgba(accent, mode === 'dark' ? 0.34 : 0.22)
  const design = base.design
    ? {
        ...base.design,
        reference: {
          ...base.design.reference,
          brand: accent,
          brandForeground: foreground,
        },
        semantic: {
          ...base.design.semantic,
          color: {
            ...base.design.semantic.color,
            primary: accent,
            onPrimary: foreground,
            primaryContainer: wash,
            onPrimaryContainer: readableAccentOnWash,
            focus: readableAccent,
            selection: wash,
          },
          surface: {
            ...base.design.semantic.surface,
            chrome: {
              ...base.design.semantic.surface.chrome,
              border: surfaceBorder,
              highlight: base.ui.liquidGlass ? rgba(accent, mode === 'dark' ? 0.2 : 0.16) : base.design.semantic.surface.chrome.highlight,
            },
            interactive: {
              ...base.design.semantic.surface.interactive,
              background: base.ui.liquidGlass ? surfaceTint : base.design.semantic.surface.interactive.background,
              border: surfaceBorder,
            },
            active: {
              ...base.design.semantic.surface.active,
              background: wash,
              foreground: readableAccentOnWash,
              border,
            },
          },
        },
        component: {
          ...base.design.component,
          button: {
            ...base.design.component.button,
            primaryBackground: accent,
            primaryForeground: foreground,
            stateLayer: accent,
          },
          field: {
            ...base.design.component.field,
            focus: readableAccent,
          },
          navigation: {
            ...base.design.component.navigation,
            activeBackground: wash,
            activeForeground: readableAccentOnWash,
          },
          message: {
            ...base.design.component.message,
            userBackground: accent,
            userForeground: foreground,
          },
        },
      }
    : undefined

  return {
    ...base,
    primary: accent,
    primaryForeground: foreground,
    brand: accent,
    brandForeground: foreground,
    background: {
      ...base.background,
      mist: {
        ...base.background.mist,
        primary: ambientPrimary,
        secondary: ambientSecondary,
        warm: mixHex(accent, base.background.mist.warm, 0.72),
      },
      trace: {
        ...base.background.trace,
        accent,
      },
    },
    ui: {
      ...base.ui,
      semantic: {
        ...base.ui.semantic,
        chrome: {
          ...base.ui.semantic.chrome,
          border: surfaceBorder,
          toolbar: base.ui.liquidGlass ? surfaceTint : base.ui.semantic.chrome.toolbar,
        },
        control: {
          ...base.ui.semantic.control,
          background: accent,
          foreground,
          border,
          focus: readableAccent,
        },
      },
      section: {
        ...base.ui.section,
        marker: accent,
      },
      icon: {
        accentBackground: wash,
        accentForeground: readableAccentOnWash,
      },
      tone: {
        ...base.ui.tone,
        ink: {
          background: accent,
          foreground,
          border,
        },
      },
      control: {
        ...base.ui.control,
        primaryBackground: accent,
        primaryForeground: foreground,
        primaryBorder: border,
        link: readableAccent,
        focus: readableAccent,
      },
      input: {
        ...base.ui.input,
        focus: readableAccent,
      },
      switch: {
        ...base.ui.switch,
        trackOn: accent,
        trackOnBorder: border,
      },
      composer: {
        ...base.ui.composer,
        toolbarBorder: surfaceBorder,
      },
      actionBar: {
        ...base.ui.actionBar,
        border: surfaceBorder,
        itemBorder: surfaceBorder,
        itemActiveBackground: wash,
      },
      message: {
        ...base.ui.message,
        userBackground: accent,
        userForeground: foreground,
        userBorder: border,
        userActionForeground: readableActionForeground,
      },
      loading: {
        background: wash,
        border: readableAccentOnWash,
        dot: readableAccentOnWash,
      },
    },
    design,
  }
}

function readableForeground(background: string): '#FFFFFF' | '#0B0D0E' | '#000000' {
  const whiteRatio = contrastRatio(background, '#FFFFFF')
  const inkRatio = contrastRatio(background, '#0B0D0E')
  if (Math.max(whiteRatio, inkRatio) >= 4.5) {
    return whiteRatio >= inkRatio ? '#FFFFFF' : '#0B0D0E'
  }
  // Near-black is part of the product palette, but a small range of saturated
  // accents falls just below WCAG AA against it.  Use true black for that
  // narrow range rather than shipping an unreadable custom primary action.
  return '#000000'
}

function ensureContrast(color: string, background: string, mode: ResolvedThemeMode, backdropOverride?: string): string {
  const backdrop = backdropOverride ?? (mode === 'dark' ? '#101513' : '#FFFFFF')
  if (contrastRatio(color, background, backdrop) >= 4.5) return color

  const preferred = mode === 'dark' ? '#FFFFFF' : '#000000'
  const alternate = mode === 'dark' ? '#000000' : '#FFFFFF'
  const preferredRatio = contrastRatio(preferred, background, backdrop)
  const alternateRatio = contrastRatio(alternate, background, backdrop)
  const target = preferredRatio >= alternateRatio ? preferred : alternate
  if (Math.max(preferredRatio, alternateRatio) < 4.5) return target

  // Binary-search the smallest blend toward a readable endpoint. This keeps
  // focus/link accents recognisably close to the requested hue while giving
  // translucent washes a deterministic AA fallback.
  let low = 0
  let high = 1
  for (let step = 0; step < 12; step += 1) {
    const amount = (low + high) / 2
    const candidate = mixHex(color, target, amount)
    if (contrastRatio(candidate, background, backdrop) >= 4.5) high = amount
    else low = amount
  }
  return mixHex(color, target, high)
}

type ParsedColor = { r: number; g: number; b: number; a: number }

function contrastRatio(left: string, right: string, backdrop = '#FFFFFF'): number {
  const background = flattenColor(parseCssColor(right), parseCssColor(backdrop))
  const foreground = flattenColor(parseCssColor(left), background)
  const leftLuminance = relativeLuminance(foreground)
  const rightLuminance = relativeLuminance(background)
  const lighter = Math.max(leftLuminance, rightLuminance)
  const darker = Math.min(leftLuminance, rightLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(color: ParsedColor): number {
  const { r, g, b } = color
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function parseCssColor(value: string): ParsedColor {
  const normalized = normalizeThemeAccent(value)
  if (normalized) {
    const rgb = hexToRgb(normalized)
    return { ...rgb, a: 1 }
  }
  if (typeof value === 'string' && value.trim().toLowerCase() === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 }
  }
  const match = typeof value === 'string' ? value.trim().match(/^rgba?\(([^)]+)\)$/i) : null
  if (match) {
    const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()))
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return {
        r: clampChannel(parts[0]),
        g: clampChannel(parts[1]),
        b: clampChannel(parts[2]),
        a: parts.length >= 4 && Number.isFinite(parts[3]) ? Math.min(1, Math.max(0, parts[3])) : 1,
      }
    }
  }
  // Invalid internal colours fail closed to black instead of producing NaN
  // contrast values that could leak an unreadable foreground to the UI.
  return { r: 0, g: 0, b: 0, a: 1 }
}

function flattenColor(foreground: ParsedColor, background: ParsedColor): ParsedColor {
  const alpha = Math.min(1, Math.max(0, foreground.a))
  const outputAlpha = alpha + background.a * (1 - alpha)
  if (outputAlpha <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: (foreground.r * alpha + background.r * background.a * (1 - alpha)) / outputAlpha,
    g: (foreground.g * alpha + background.g * background.a * (1 - alpha)) / outputAlpha,
    b: (foreground.b * alpha + background.b * background.a * (1 - alpha)) / outputAlpha,
    a: outputAlpha,
  }
}

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, value))
}

function mixHex(source: string, target: string, amount: number): string {
  const from = hexToRgb(source)
  const to = hexToRgb(target)
  const mix = (left: number, right: number) => Math.round(left + (right - left) * amount)
  return rgbToHex(mix(from.r, to.r), mix(from.g, to.g), mix(from.b, to.b))
}

function rgba(color: string, alpha: number): string {
  const { r, g, b } = hexToRgb(color)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function hexToRgb(color: string): { r: number; g: number; b: number } {
  const normalized = normalizeThemeAccent(color) ?? '#000000'
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}
