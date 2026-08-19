/**
 * Product theme design tokens.
 *
 * The registry intentionally follows a reference -> semantic -> component
 * shape. Presentation code should consume semantic/component roles rather than
 * selecting a raw colour or geometry value for a particular family.
 */

export type ThemeFamily = 'minimal' | 'monet' | 'material' | 'liquid-glass'
export type ThemeTokenMode = 'light' | 'dark'

export const THEME_FAMILIES = ['minimal', 'monet', 'material', 'liquid-glass'] as const satisfies readonly ThemeFamily[]

export const THEME_TOKEN_MODES = ['light', 'dark'] as const satisfies readonly ThemeTokenMode[]

export interface ThemeTypographyToken {
  fontFamily: string
  fontSize: number
  lineHeight: number
  fontWeight: '400' | '500' | '600' | '700' | '800'
  letterSpacing: number
}

export interface ThemeTypographyTokens {
  display: ThemeTypographyToken
  headline: ThemeTypographyToken
  title: ThemeTypographyToken
  body: ThemeTypographyToken
  label: ThemeTypographyToken
  caption: ThemeTypographyToken
  code: ThemeTypographyToken
}

export interface ThemeSpacingTokens {
  none: number
  hairline: number
  xxs: number
  xs: number
  sm: number
  md: number
  lg: number
  xl: number
  xxl: number
  xxxl: number
  section: number
  page: number
}

export interface ThemeRadiusTokens {
  none: number
  small: number
  medium: number
  large: number
  extraLarge: number
  pill: number
}

export interface ThemeElevationTokens {
  level0: number
  level1: number
  level2: number
  level3: number
  level4: number
  level5: number
  shadowColor: string
  shadowOpacity: number
  shadowBlur: number
  shadowOffsetY: number
  tonalSurface: boolean
}

export interface ThemeMotionTokens {
  instant: number
  interaction: number
  emphasis: number
  panel: number
  page: number
  easing: 'linear' | 'standard' | 'decelerate' | 'ease-out' | 'spring'
  stateLayerOpacity: {
    hover: number
    focus: number
    press: number
    drag: number
  }
  reducedMotion: 'opacity-only' | 'none'
}

export interface ThemeBlurTokens {
  enabled: boolean
  radius: number
  material: 'none' | 'regular' | 'clear'
  maxLayersPerRegion: number
  fallback: 'opaque' | 'tonal'
  dimmingOpacity: number
}

export interface ThemeSemanticColorTokens {
  canvas: string
  surface: string
  surfaceContainer: string
  surfaceElevated: string
  surfaceMuted: string
  surfaceOverlay: string
  onSurface: string
  onSurfaceMuted: string
  primary: string
  onPrimary: string
  primaryContainer: string
  onPrimaryContainer: string
  secondary: string
  onSecondary: string
  secondaryContainer: string
  onSecondaryContainer: string
  tertiary: string
  onTertiary: string
  border: string
  borderStrong: string
  divider: string
  focus: string
  selection: string
  success: string
  warning: string
  error: string
  info: string
}

export interface ThemeComponentTokens {
  button: {
    radius: number
    minHeight: number
    primaryBackground: string
    primaryForeground: string
    secondaryBackground: string
    secondaryForeground: string
    stateLayer: string
    disabledBackground: string
    disabledForeground: string
  }
  field: {
    radius: number
    minHeight: number
    background: string
    backgroundFocused: string
    border: string
    focus: string
    placeholder: string
  }
  panel: {
    radius: number
    background: string
    elevatedBackground: string
    border: string
    blur: boolean
  }
  navigation: {
    background: string
    foreground: string
    activeBackground: string
    activeForeground: string
    border: string
    blur: boolean
  }
  message: {
    userBackground: string
    userForeground: string
    assistantBackground: string
    assistantForeground: string
    border: string
  }
}

export interface ThemeDesignTokens {
  family: ThemeFamily
  mode: ThemeTokenMode
  reference: {
    accent: string
    accentSecondary: string
    neutral: string
    warm: string
    cool: string
  }
  semantic: {
    color: ThemeSemanticColorTokens
    typography: ThemeTypographyTokens
    spacing: ThemeSpacingTokens
    radius: ThemeRadiusTokens
    elevation: ThemeElevationTokens
    motion: ThemeMotionTokens
    blur: ThemeBlurTokens
  }
  component: ThemeComponentTokens
  behavior: {
    density: 'compact' | 'balanced' | 'airy'
    surfaceStrategy: 'boundary' | 'tonal' | 'material' | 'glass' | 'atmospheric'
    interactionStrategy: 'direct' | 'state-layer' | 'translucent' | 'breathing'
    contentLayerGlass: false
  }
}

const baseSpacing: ThemeSpacingTokens = {
  none: 0,
  hairline: 1,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  section: 48,
  page: 64,
}

const type = (fontSize: number, lineHeight: number, fontWeight: ThemeTypographyToken['fontWeight'], letterSpacing = 0): ThemeTypographyToken => ({
  fontFamily: 'System',
  fontSize,
  lineHeight,
  fontWeight,
  letterSpacing,
})

const typographyFor = (family: ThemeFamily): ThemeTypographyTokens => {
  if (family === 'minimal') return {
    display: type(30, 36, '700'), headline: type(22, 28, '700'), title: type(17, 22, '700'),
    body: type(14, 20, '400'), label: type(12, 16, '600'), caption: type(11, 15, '500'),
    code: { ...type(13, 19, '500'), fontFamily: 'monospace' },
  }
  if (family === 'material') return {
    display: type(36, 44, '400'), headline: type(28, 36, '400'), title: type(22, 28, '500'),
    body: type(16, 24, '400'), label: type(14, 20, '500'), caption: type(12, 16, '500'),
    code: { ...type(13, 20, '500'), fontFamily: 'monospace' },
  }
  if (family === 'monet') return {
    display: type(34, 44, '600'), headline: type(26, 35, '600'), title: type(19, 27, '600'),
    body: type(16, 24, '400'), label: type(13, 19, '600'), caption: type(12, 18, '500'),
    code: { ...type(13, 20, '500'), fontFamily: 'monospace' },
  }
  return {
    display: type(32, 40, '600'), headline: type(24, 32, '600'), title: type(18, 24, '600'),
    body: type(15, 22, '400'), label: type(13, 18, '600'), caption: type(11, 16, '500'),
    code: { ...type(13, 20, '500'), fontFamily: 'monospace' },
  }
}

const spacingFor = (family: ThemeFamily): ThemeSpacingTokens => ({
  ...baseSpacing,
  section: family === 'minimal' ? 40 : family === 'monet' ? 56 : 48,
  page: family === 'minimal' ? 48 : family === 'monet' ? 72 : 64,
})

const palette = (mode: ThemeTokenMode, light: ThemeSemanticColorTokens, dark: ThemeSemanticColorTokens): ThemeSemanticColorTokens => mode === 'dark' ? dark : light

const sharedLight: ThemeSemanticColorTokens = {
  canvas: '#F8FAF9',
  surface: '#FFFFFF',
  surfaceContainer: '#F1F4F3',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#E8EEEC',
  surfaceOverlay: 'rgba(255, 255, 255, 0.96)',
  onSurface: '#17201D',
  onSurfaceMuted: '#52615B',
  primary: '#1F5B50',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D4EDE5',
  onPrimaryContainer: '#10352E',
  secondary: '#4F6470',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#DFEAF0',
  onSecondaryContainer: '#1A2B34',
  tertiary: '#9A5A2B',
  onTertiary: '#FFFFFF',
  border: '#C8D3CE',
  borderStrong: '#879992',
  divider: '#DCE4E0',
  focus: '#0B6E61',
  selection: '#B8DED3',
  success: '#216E4E',
  warning: '#8A5A00',
  error: '#B3261E',
  info: '#315F7A',
}

const sharedDark: ThemeSemanticColorTokens = {
  canvas: '#101513',
  surface: '#17201D',
  surfaceContainer: '#202B27',
  surfaceElevated: '#27342F',
  surfaceMuted: '#2D3A35',
  surfaceOverlay: 'rgba(23, 32, 29, 0.97)',
  onSurface: '#ECF4F0',
  onSurfaceMuted: '#B7C7C0',
  primary: '#A8DCCB',
  onPrimary: '#07372D',
  primaryContainer: '#174A3E',
  onPrimaryContainer: '#C8F3E5',
  secondary: '#B8CBD5',
  onSecondary: '#1B303A',
  secondaryContainer: '#30444F',
  onSecondaryContainer: '#D8EAF2',
  tertiary: '#F3B98C',
  onTertiary: '#3C1C08',
  border: '#45544D',
  borderStrong: '#71857B',
  divider: '#34423C',
  focus: '#9DE9D6',
  selection: '#2D6255',
  success: '#8BD5AE',
  warning: '#F2C66D',
  error: '#FFB4AB',
  info: '#A9D3EC',
}

const monetLight: ThemeSemanticColorTokens = {
  ...sharedLight,
  canvas: '#F4F6F2',
  surface: '#FFFEF9',
  surfaceContainer: '#E8F0EC',
  surfaceElevated: '#FFFDF7',
  surfaceMuted: '#DCEBE6',
  primary: '#2F6E68',
  onPrimary: '#FFFFFF',
  primaryContainer: '#CFE8DF',
  onPrimaryContainer: '#153D3A',
  secondary: '#557C91',
  secondaryContainer: '#DCEBF1',
  onSecondaryContainer: '#1D3948',
  tertiary: '#A85E43',
  focus: '#B24C3A',
  selection: '#F3C8B7',
}

const monetDark: ThemeSemanticColorTokens = {
  ...sharedDark,
  canvas: '#101918',
  surface: '#182522',
  surfaceContainer: '#22332F',
  surfaceElevated: '#2B3D37',
  surfaceMuted: '#304840',
  primary: '#9DD6C8',
  onPrimary: '#123C35',
  primaryContainer: '#28564A',
  onPrimaryContainer: '#C6EFE2',
  secondary: '#A8C8D5',
  secondaryContainer: '#2E4855',
  onSecondaryContainer: '#D2EBF3',
  tertiary: '#F1AA8A',
  focus: '#F4B39B',
  selection: '#70483C',
}

const materialLight: ThemeSemanticColorTokens = {
  ...sharedLight,
  canvas: '#FFFBFE',
  surface: '#FFFBFE',
  surfaceContainer: '#F3EDF7',
  surfaceElevated: '#F7F2FA',
  surfaceMuted: '#E8DEF8',
  onSurface: '#1D1B20',
  onSurfaceMuted: '#49454F',
  primary: '#6750A4',
  onPrimary: '#FFFFFF',
  primaryContainer: '#EADDFF',
  onPrimaryContainer: '#21005D',
  secondary: '#625B71',
  secondaryContainer: '#E8DEF8',
  onSecondaryContainer: '#1D192B',
  tertiary: '#7D5260',
  onTertiary: '#FFFFFF',
  border: '#79747E',
  borderStrong: '#49454F',
  divider: '#CAC4D0',
  focus: '#6750A4',
  selection: '#EADDFF',
  error: '#B3261E',
}

const materialDark: ThemeSemanticColorTokens = {
  ...sharedDark,
  canvas: '#1C1B1F',
  surface: '#1C1B1F',
  surfaceContainer: '#211F26',
  surfaceElevated: '#2B2930',
  surfaceMuted: '#49454F',
  onSurface: '#E6E1E5',
  onSurfaceMuted: '#CAC4D0',
  primary: '#D0BCFF',
  onPrimary: '#381E72',
  primaryContainer: '#4F378B',
  onPrimaryContainer: '#EADDFF',
  secondary: '#CCC2DC',
  onSecondary: '#332D41',
  secondaryContainer: '#4A4458',
  onSecondaryContainer: '#E8DEF8',
  tertiary: '#EFB8C8',
  onTertiary: '#492532',
  border: '#938F99',
  borderStrong: '#CAC4D0',
  divider: '#49454F',
  focus: '#D0BCFF',
  selection: '#4F378B',
  error: '#F2B8B5',
}

const glassLight: ThemeSemanticColorTokens = {
  ...sharedLight,
  canvas: '#EAF2F8',
  surface: '#F8FBFD',
  surfaceContainer: '#E1ECF3',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#D9E6EE',
  surfaceOverlay: 'rgba(255, 255, 255, 0.88)',
  onSurface: '#152331',
  onSurfaceMuted: '#43586A',
  primary: '#155E87',
  onPrimary: '#FFFFFF',
  primaryContainer: 'rgba(139, 205, 237, 0.56)',
  onPrimaryContainer: '#0A3047',
  secondary: '#576B80',
  secondaryContainer: 'rgba(218, 232, 244, 0.72)',
  onSecondaryContainer: '#1C2A39',
  tertiary: '#9A4F43',
  focus: '#0D6E9E',
  selection: 'rgba(93, 184, 209, 0.42)',
  border: 'rgba(255, 255, 255, 0.66)',
  borderStrong: 'rgba(34, 73, 103, 0.48)',
  divider: 'rgba(44, 82, 111, 0.2)',
}

const glassDark: ThemeSemanticColorTokens = {
  ...sharedDark,
  canvas: '#0D1722',
  surface: '#192B3B',
  surfaceContainer: '#233A4E',
  surfaceElevated: '#2E4A62',
  surfaceMuted: '#334E63',
  surfaceOverlay: 'rgba(22, 39, 54, 0.92)',
  onSurface: '#EFF8FF',
  onSurfaceMuted: '#B8CDDC',
  primary: '#8ED0F0',
  onPrimary: '#07344D',
  primaryContainer: 'rgba(55, 113, 145, 0.72)',
  onPrimaryContainer: '#D7F1FF',
  secondary: '#B7CEDC',
  secondaryContainer: 'rgba(75, 102, 122, 0.74)',
  onSecondaryContainer: '#E0F1FA',
  tertiary: '#FFB5A8',
  onTertiary: '#4A170F',
  focus: '#B4E9FF',
  selection: 'rgba(105, 183, 222, 0.46)',
  border: 'rgba(219, 243, 255, 0.32)',
  borderStrong: 'rgba(219, 243, 255, 0.62)',
  divider: 'rgba(219, 243, 255, 0.18)',
}

const baseComponents = (color: ThemeSemanticColorTokens, radius: ThemeRadiusTokens, navigationBlur: boolean): ThemeComponentTokens => ({
  button: {
    radius: radius.medium,
    minHeight: 44,
    primaryBackground: color.primary,
    primaryForeground: color.onPrimary,
    secondaryBackground: color.secondaryContainer,
    secondaryForeground: color.onSecondaryContainer,
    stateLayer: color.primary,
    disabledBackground: color.surfaceMuted,
    disabledForeground: color.onSurfaceMuted,
  },
  field: {
    radius: radius.medium,
    minHeight: 48,
    background: color.surfaceContainer,
    backgroundFocused: color.surface,
    border: color.border,
    focus: color.focus,
    placeholder: color.onSurfaceMuted,
  },
  panel: {
    radius: radius.large,
    background: color.surface,
    elevatedBackground: color.surfaceElevated,
    border: color.border,
    blur: false,
  },
  navigation: {
    background: color.surfaceOverlay,
    foreground: color.onSurface,
    activeBackground: color.primaryContainer,
    activeForeground: color.onPrimaryContainer,
    border: color.border,
    blur: navigationBlur,
  },
  message: {
    userBackground: color.primary,
    userForeground: color.onPrimary,
    assistantBackground: color.surface,
    assistantForeground: color.onSurface,
    border: color.border,
  },
})

const componentsFor = (family: ThemeFamily, color: ThemeSemanticColorTokens, radius: ThemeRadiusTokens): ThemeComponentTokens => {
  const base = baseComponents(color, radius, family === 'liquid-glass')
  if (family === 'minimal') return {
    ...base,
    button: { ...base.button, radius: radius.small, minHeight: 40, secondaryBackground: color.surface },
    field: { ...base.field, radius: radius.small, minHeight: 44, background: color.surface },
    navigation: { ...base.navigation, background: color.surface, activeBackground: color.surfaceMuted },
  }
  if (family === 'material') return {
    ...base,
    button: { ...base.button, radius: radius.pill, minHeight: 40 },
    field: { ...base.field, radius: radius.small, minHeight: 56, background: color.surface, border: color.borderStrong },
    panel: { ...base.panel, radius: radius.extraLarge, background: color.surfaceContainer },
    navigation: { ...base.navigation, background: color.surfaceContainer },
    message: { ...base.message, assistantBackground: color.surfaceContainer },
  }
  if (family === 'liquid-glass') return {
    ...base,
    button: { ...base.button, radius: radius.pill },
    navigation: { ...base.navigation, background: color.surfaceOverlay, border: color.borderStrong, blur: true },
    message: { ...base.message, assistantBackground: color.surface },
  }
  return {
    ...base,
    button: { ...base.button, radius: radius.large },
    panel: { ...base.panel, radius: radius.large, elevatedBackground: color.surfaceElevated },
  }
}

const radiusFor = (family: ThemeFamily): ThemeRadiusTokens => {
  if (family === 'minimal') return { none: 0, small: 4, medium: 6, large: 8, extraLarge: 12, pill: 999 }
  if (family === 'material') return { none: 0, small: 4, medium: 8, large: 12, extraLarge: 16, pill: 999 }
  if (family === 'liquid-glass') return { none: 0, small: 10, medium: 16, large: 22, extraLarge: 28, pill: 999 }
  return { none: 0, small: 8, medium: 12, large: 18, extraLarge: 24, pill: 999 }
}

function makeTokens(family: ThemeFamily, mode: ThemeTokenMode): ThemeDesignTokens {
  const colors = family === 'monet'
    ? palette(mode, monetLight, monetDark)
    : family === 'material'
      ? palette(mode, materialLight, materialDark)
      : family === 'liquid-glass'
        ? palette(mode, glassLight, glassDark)
        : palette(mode, sharedLight, sharedDark)
  const radius = radiusFor(family)
  const isGlass = family === 'liquid-glass'
  const isMaterial = family === 'material'
  const isMonet = family === 'monet'
  const elevation: ThemeElevationTokens = family === 'minimal'
    ? { level0: 0, level1: 1, level2: 2, level3: 4, level4: 8, level5: 12, shadowColor: '#10201A', shadowOpacity: 0.08, shadowBlur: 8, shadowOffsetY: 2, tonalSurface: false }
    : isMaterial
      ? { level0: 0, level1: 1, level2: 3, level3: 6, level4: 8, level5: 12, shadowColor: '#1D1B20', shadowOpacity: 0.18, shadowBlur: 12, shadowOffsetY: 4, tonalSurface: true }
      : isGlass
        ? { level0: 0, level1: 2, level2: 6, level3: 12, level4: 18, level5: 24, shadowColor: '#12344A', shadowOpacity: 0.2, shadowBlur: 24, shadowOffsetY: 8, tonalSurface: false }
        : { level0: 0, level1: 1, level2: 3, level3: 6, level4: 10, level5: 14, shadowColor: '#527B73', shadowOpacity: 0.12, shadowBlur: 18, shadowOffsetY: 5, tonalSurface: false }
  const motion: ThemeMotionTokens = family === 'minimal'
    ? { instant: 0, interaction: 80, emphasis: 120, panel: 180, page: 180, easing: 'standard', stateLayerOpacity: { hover: 0.06, focus: 0.1, press: 0.1, drag: 0.16 }, reducedMotion: 'opacity-only' }
    : isMaterial
      ? { instant: 0, interaction: 120, emphasis: 160, panel: 240, page: 300, easing: 'standard', stateLayerOpacity: { hover: 0.08, focus: 0.1, press: 0.1, drag: 0.16 }, reducedMotion: 'opacity-only' }
      : isGlass
        ? { instant: 0, interaction: 140, emphasis: 220, panel: 320, page: 360, easing: 'spring', stateLayerOpacity: { hover: 0.08, focus: 0.12, press: 0.12, drag: 0.16 }, reducedMotion: 'opacity-only' }
        : { instant: 0, interaction: 110, emphasis: 180, panel: 280, page: 320, easing: 'ease-out', stateLayerOpacity: { hover: 0.06, focus: 0.1, press: 0.1, drag: 0.14 }, reducedMotion: 'opacity-only' }
  return {
    family,
    mode,
    reference: {
      accent: colors.primary,
      accentSecondary: colors.secondary,
      neutral: colors.surface,
      warm: colors.tertiary,
      cool: colors.secondary,
    },
    semantic: {
      color: colors,
      typography: typographyFor(family),
      spacing: spacingFor(family),
      radius,
      elevation,
      motion,
      blur: {
        enabled: isGlass,
        radius: isGlass ? 22 : 0,
        material: isGlass ? 'regular' : 'none',
        maxLayersPerRegion: isGlass ? 1 : 0,
        fallback: isGlass ? 'opaque' : isMaterial ? 'tonal' : 'opaque',
        dimmingOpacity: isGlass ? 0.35 : 0,
      },
    },
    component: componentsFor(family, colors, radius),
    behavior: {
      density: family === 'minimal' || isMaterial ? 'compact' : isMonet ? 'airy' : 'balanced',
      surfaceStrategy: family === 'minimal' ? 'boundary' : isMaterial ? 'tonal' : isGlass ? 'glass' : 'atmospheric',
      interactionStrategy: family === 'minimal' ? 'direct' : isMaterial ? 'state-layer' : isGlass ? 'translucent' : 'breathing',
      contentLayerGlass: false,
    },
  }
}

export const THEME_DESIGN_TOKENS: Readonly<Record<ThemeFamily, Readonly<Record<ThemeTokenMode, ThemeDesignTokens>>>> = Object.freeze({
  minimal: Object.freeze({ light: makeTokens('minimal', 'light'), dark: makeTokens('minimal', 'dark') }),
  monet: Object.freeze({ light: makeTokens('monet', 'light'), dark: makeTokens('monet', 'dark') }),
  material: Object.freeze({ light: makeTokens('material', 'light'), dark: makeTokens('material', 'dark') }),
  'liquid-glass': Object.freeze({ light: makeTokens('liquid-glass', 'light'), dark: makeTokens('liquid-glass', 'dark') }),
})

export function isThemeFamily(value: unknown): value is ThemeFamily {
  return (THEME_FAMILIES as readonly unknown[]).includes(value)
}

export function resolveThemeDesignTokens(family: ThemeFamily, mode: ThemeTokenMode): ThemeDesignTokens {
  return THEME_DESIGN_TOKENS[family][mode]
}
