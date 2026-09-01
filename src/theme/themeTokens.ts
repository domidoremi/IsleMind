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

export interface ThemeSurfaceMaterialToken {
  background: string
  foreground: string
  border: string
  highlight: string
  blurRadius: number
  saturation: number
  shadowColor: string
  shadowOpacity: number
  shadowBlur: number
  shadowOffsetY: number
  elevation: number
}

export interface ThemeSurfaceMaterialTokens {
  background: ThemeSurfaceMaterialToken
  chrome: ThemeSurfaceMaterialToken
  conversation: ThemeSurfaceMaterialToken
  elevated: ThemeSurfaceMaterialToken
  floating: ThemeSurfaceMaterialToken
  interactive: ThemeSurfaceMaterialToken
  active: ThemeSurfaceMaterialToken
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
  toast: {
    radius: number
    maxWidth: number
    minHeight: number
    paddingHorizontal: number
    paddingVertical: number
    gap: number
    elevation: number
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
    surface: ThemeSurfaceMaterialTokens
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
  onPrimaryContainer: '#D6F6ED',
  secondary: '#A8C8D5',
  secondaryContainer: '#2E4855',
  onSecondaryContainer: '#D2EBF3',
  tertiary: '#F1AA8A',
  focus: '#F4B39B',
  selection: '#70483C',
}

const materialLight: ThemeSemanticColorTokens = {
  ...sharedLight,
  canvas: '#FAFAFC',
  surface: '#FAFAFC',
  surfaceContainer: '#F0F1F3',
  surfaceElevated: '#F7F8FA',
  surfaceMuted: '#E5E8EC',
  onSurface: '#1B1D20',
  onSurfaceMuted: '#4D5359',
  primary: '#365F86',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D8E7F5',
  onPrimaryContainer: '#17324A',
  secondary: '#59636D',
  secondaryContainer: '#E0E6EB',
  onSecondaryContainer: '#28323B',
  tertiary: '#76565F',
  onTertiary: '#FFFFFF',
  border: '#73777D',
  borderStrong: '#454A50',
  divider: '#C8CDD2',
  focus: '#365F86',
  selection: '#D8E7F5',
  error: '#B3261E',
}

const materialDark: ThemeSemanticColorTokens = {
  ...sharedDark,
  canvas: '#191B1E',
  surface: '#191B1E',
  surfaceContainer: '#22252A',
  surfaceElevated: '#2A2E34',
  surfaceMuted: '#343A42',
  onSurface: '#E2E4E7',
  onSurfaceMuted: '#C2C7CD',
  primary: '#A6C8EA',
  onPrimary: '#0D314E',
  primaryContainer: '#234B6D',
  onPrimaryContainer: '#D3E7FA',
  secondary: '#BEC7D0',
  onSecondary: '#29323A',
  secondaryContainer: '#3B454F',
  onSecondaryContainer: '#DBE3EA',
  tertiary: '#DDB8C1',
  onTertiary: '#422932',
  border: '#8D9298',
  borderStrong: '#C2C7CD',
  divider: '#45494F',
  focus: '#A6C8EA',
  selection: '#234B6D',
  error: '#F2B8B5',
}

const glassLight: ThemeSemanticColorTokens = {
  ...sharedLight,
  canvas: '#EAF2F8',
  surface: '#F8FBFD',
  surfaceContainer: '#E1ECF3',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#D9E6EE',
  // Realtime backdrop blur carries the material; the tint stays low so text
  // behind the glass reads as color/light/shadow, never as letters.
  surfaceOverlay: 'rgba(255, 255, 255, 0.28)',
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
  surfaceOverlay: 'rgba(22, 39, 54, 0.3)',
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

const baseComponents = (
  color: ThemeSemanticColorTokens,
  radius: ThemeRadiusTokens,
  surface: ThemeSurfaceMaterialTokens,
  navigationBlur: boolean,
): ThemeComponentTokens => ({
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
    background: surface.interactive.background,
    backgroundFocused: surface.active.background,
    border: surface.interactive.border,
    focus: color.focus,
    placeholder: color.onSurfaceMuted,
  },
  panel: {
    radius: radius.large,
    background: surface.elevated.background,
    elevatedBackground: surface.floating.background,
    border: surface.elevated.border,
    blur: false,
  },
  navigation: {
    background: surface.chrome.background,
    foreground: surface.chrome.foreground,
    activeBackground: surface.active.background,
    activeForeground: surface.active.foreground,
    border: surface.chrome.border,
    blur: navigationBlur,
  },
  message: {
    userBackground: color.primary,
    userForeground: color.onPrimary,
    assistantBackground: surface.conversation.background,
    assistantForeground: color.onSurface,
    border: surface.conversation.border,
  },
  toast: {
    radius: radius.medium,
    maxWidth: 440,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    elevation: 2,
  },
})

const componentsFor = (
  family: ThemeFamily,
  color: ThemeSemanticColorTokens,
  radius: ThemeRadiusTokens,
  mode: ThemeTokenMode,
  surface: ThemeSurfaceMaterialTokens,
): ThemeComponentTokens => {
  const base = baseComponents(color, radius, surface, family === 'liquid-glass')
  if (family === 'minimal') return {
    ...base,
    // Minimal keeps the canvas continuous. Boundaries are communicated by
    // typography, spacing, and a single hairline only when interaction needs
    // it; a logical panel must not automatically become a visual card.
    button: { ...base.button, radius: radius.small, minHeight: 40, secondaryBackground: 'transparent', primaryBackground: color.primary },
    field: { ...base.field, radius: radius.small, minHeight: 44 },
    panel: { ...base.panel, radius: radius.medium, blur: false },
    navigation: { ...base.navigation },
    message: {
      ...base.message,
      userBackground: 'transparent',
      userForeground: color.onSurface,
      assistantBackground: 'transparent',
      border: 'transparent',
    },
    toast: { ...base.toast, radius: radius.small, maxWidth: 420, minHeight: 48, paddingHorizontal: 10, paddingVertical: 8, gap: 8, elevation: 0 },
  }
  if (family === 'material') return {
    ...base,
    // Material uses tonal roles first. Outlines and shadows are reserved for
    // controls that need a boundary, keeping routine content on one plane.
    button: { ...base.button, radius: radius.pill, minHeight: 40 },
    field: { ...base.field, radius: radius.small, minHeight: 56 },
    panel: { ...base.panel, radius: radius.large },
    navigation: { ...base.navigation },
    message: {
      ...base.message,
      userBackground: color.primaryContainer,
      userForeground: color.onPrimaryContainer,
      assistantBackground: color.surfaceContainer,
      border: 'transparent',
    },
    toast: { ...base.toast, radius: radius.large, maxWidth: 460, minHeight: 60, paddingHorizontal: 16, paddingVertical: 12, gap: 12, elevation: 2 },
  }
  if (family === 'liquid-glass') return {
    ...base,
    // Only chrome and transient surfaces are lenses. Message content remains
    // opaque so text never competes with the environmental backdrop.
    button: { ...base.button, radius: radius.pill },
    field: {
      ...base.field,
      radius: radius.medium,
      background: surface.interactive.background,
      backgroundFocused: surface.active.background,
      border: surface.interactive.border,
    },
    panel: { ...base.panel, radius: radius.large, blur: false },
    navigation: { ...base.navigation, blur: true },
    message: {
      ...base.message,
      userBackground: color.surfaceOverlay,
      userForeground: color.onSurface,
      assistantBackground: surface.conversation.background,
      border: surface.conversation.border,
    },
    toast: { ...base.toast, radius: radius.large, maxWidth: 460, minHeight: 58, paddingHorizontal: 14, paddingVertical: 11, gap: 11, elevation: 2 },
  }
  return {
    ...base,
    // Monet has a soft, editorial rhythm but still avoids a stack of cards.
    button: { ...base.button, radius: radius.medium },
    panel: { ...base.panel, radius: radius.large },
    navigation: { ...base.navigation },
    message: {
      ...base.message,
      userBackground: color.primaryContainer,
      userForeground: color.onPrimaryContainer,
      assistantBackground: 'transparent',
      border: 'transparent',
    },
    toast: { ...base.toast, radius: radius.large, maxWidth: 440, minHeight: 56, paddingHorizontal: 13, paddingVertical: 10, gap: 10, elevation: 2 },
  }
}

const radiusFor = (family: ThemeFamily): ThemeRadiusTokens => {
  if (family === 'minimal') return { none: 0, small: 2, medium: 4, large: 6, extraLarge: 8, pill: 999 }
  if (family === 'material') return { none: 0, small: 4, medium: 8, large: 12, extraLarge: 16, pill: 999 }
  if (family === 'liquid-glass') return { none: 0, small: 8, medium: 12, large: 16, extraLarge: 22, pill: 999 }
  return { none: 0, small: 6, medium: 10, large: 14, extraLarge: 18, pill: 999 }
}

const surfaceMaterial = (
  background: string,
  foreground: string,
  border = 'transparent',
  options: Partial<Omit<ThemeSurfaceMaterialToken, 'background' | 'foreground' | 'border'>> = {},
): ThemeSurfaceMaterialToken => ({
  background,
  foreground,
  border,
  highlight: 'transparent',
  blurRadius: 0,
  saturation: 1,
  shadowColor: 'transparent',
  shadowOpacity: 0,
  shadowBlur: 0,
  shadowOffsetY: 0,
  elevation: 0,
  ...options,
})

function surfaceMaterialsFor(
  family: ThemeFamily,
  mode: ThemeTokenMode,
  color: ThemeSemanticColorTokens,
  elevation: ThemeElevationTokens,
): ThemeSurfaceMaterialTokens {
  const conversation = surfaceMaterial('transparent', color.onSurface)
  const active = surfaceMaterial(color.primaryContainer, color.onPrimaryContainer, color.borderStrong)

  if (family === 'minimal') {
    return {
      background: surfaceMaterial(color.canvas, color.onSurface),
      chrome: surfaceMaterial(color.canvas, color.onSurface, color.divider),
      conversation,
      elevated: surfaceMaterial(color.surface, color.onSurface, color.divider),
      floating: surfaceMaterial(color.surfaceElevated, color.onSurface, color.border, {
        shadowColor: elevation.shadowColor,
        shadowOpacity: 0.055,
        shadowBlur: 8,
        shadowOffsetY: 3,
        elevation: elevation.level2,
      }),
      interactive: surfaceMaterial('transparent', color.onSurface, color.divider),
      active,
    }
  }

  if (family === 'material') {
    return {
      background: surfaceMaterial(color.canvas, color.onSurface),
      chrome: surfaceMaterial(color.surface, color.onSurface, 'transparent'),
      conversation,
      elevated: surfaceMaterial(color.surfaceContainer, color.onSurface),
      floating: surfaceMaterial(color.surfaceElevated, color.onSurface, color.divider, {
        shadowColor: elevation.shadowColor,
        shadowOpacity: elevation.shadowOpacity,
        shadowBlur: elevation.shadowBlur,
        shadowOffsetY: elevation.shadowOffsetY,
        elevation: elevation.level3,
      }),
      interactive: surfaceMaterial(color.surfaceContainer, color.onSurface, 'transparent'),
      active,
    }
  }

  if (family === 'liquid-glass') {
    const light = mode === 'light'
    return {
      background: surfaceMaterial(color.canvas, color.onSurface),
      chrome: surfaceMaterial(
        light ? 'rgba(248, 252, 255, 0.66)' : 'rgba(22, 39, 54, 0.7)',
        color.onSurface,
        color.border,
        {
          highlight: light ? 'rgba(255, 255, 255, 0.76)' : 'rgba(231, 247, 255, 0.3)',
          blurRadius: 22,
          saturation: 1.18,
          shadowColor: elevation.shadowColor,
          shadowOpacity: 0.08,
          shadowBlur: 14,
          shadowOffsetY: 5,
          elevation: elevation.level2,
        },
      ),
      conversation,
      elevated: surfaceMaterial(color.surface, color.onSurface, color.divider, {
        shadowColor: elevation.shadowColor,
        shadowOpacity: 0.035,
        shadowBlur: 7,
        shadowOffsetY: 2,
        elevation: elevation.level1,
      }),
      floating: surfaceMaterial(
        light ? 'rgba(250, 253, 255, 0.78)' : 'rgba(25, 44, 60, 0.8)',
        color.onSurface,
        color.borderStrong,
        {
          highlight: light ? 'rgba(255, 255, 255, 0.82)' : 'rgba(231, 247, 255, 0.34)',
          blurRadius: 24,
          saturation: 1.2,
          shadowColor: elevation.shadowColor,
          shadowOpacity: 0.12,
          shadowBlur: 18,
          shadowOffsetY: 7,
          elevation: elevation.level3,
        },
      ),
      interactive: surfaceMaterial(
        light ? 'rgba(255, 255, 255, 0.22)' : 'rgba(214, 237, 249, 0.08)',
        color.onSurface,
        color.divider,
        { highlight: light ? 'rgba(255, 255, 255, 0.38)' : 'rgba(231, 247, 255, 0.14)' },
      ),
      active: surfaceMaterial(color.primaryContainer, color.onPrimaryContainer, color.borderStrong, {
        highlight: light ? 'rgba(255, 255, 255, 0.42)' : 'rgba(231, 247, 255, 0.16)',
      }),
    }
  }

  return {
    background: surfaceMaterial(color.canvas, color.onSurface),
    chrome: surfaceMaterial(color.surface, color.onSurface, color.divider, {
      shadowColor: elevation.shadowColor,
      shadowOpacity: 0.025,
      shadowBlur: 6,
      shadowOffsetY: 2,
      elevation: elevation.level1,
    }),
    conversation,
    elevated: surfaceMaterial(color.surface, color.onSurface, color.divider),
    floating: surfaceMaterial(color.surfaceElevated, color.onSurface, color.border, {
      shadowColor: elevation.shadowColor,
      shadowOpacity: 0.065,
      shadowBlur: 10,
      shadowOffsetY: 4,
      elevation: elevation.level2,
    }),
    interactive: surfaceMaterial(color.surfaceContainer, color.onSurface, color.divider),
    active,
  }
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
    ? { level0: 0, level1: 0, level2: 0, level3: 1, level4: 2, level5: 4, shadowColor: '#10201A', shadowOpacity: 0.03, shadowBlur: 4, shadowOffsetY: 1, tonalSurface: false }
    : isMaterial
      ? { level0: 0, level1: 1, level2: 2, level3: 4, level4: 6, level5: 8, shadowColor: '#1D1B20', shadowOpacity: 0.1, shadowBlur: 8, shadowOffsetY: 3, tonalSurface: true }
      : isGlass
        ? { level0: 0, level1: 1, level2: 3, level3: 6, level4: 9, level5: 12, shadowColor: '#12344A', shadowOpacity: 0.1, shadowBlur: 12, shadowOffsetY: 4, tonalSurface: false }
        : { level0: 0, level1: 1, level2: 2, level3: 4, level4: 6, level5: 9, shadowColor: '#527B73', shadowOpacity: 0.045, shadowBlur: 8, shadowOffsetY: 2, tonalSurface: false }
  const motion: ThemeMotionTokens = family === 'minimal'
    ? { instant: 0, interaction: 80, emphasis: 120, panel: 180, page: 180, easing: 'standard', stateLayerOpacity: { hover: 0.06, focus: 0.1, press: 0.1, drag: 0.16 }, reducedMotion: 'opacity-only' }
    : isMaterial
      ? { instant: 0, interaction: 120, emphasis: 160, panel: 240, page: 300, easing: 'standard', stateLayerOpacity: { hover: 0.08, focus: 0.1, press: 0.1, drag: 0.16 }, reducedMotion: 'opacity-only' }
      : isGlass
        ? { instant: 0, interaction: 130, emphasis: 200, panel: 280, page: 320, easing: 'spring', stateLayerOpacity: { hover: 0.06, focus: 0.1, press: 0.1, drag: 0.14 }, reducedMotion: 'opacity-only' }
        : { instant: 0, interaction: 110, emphasis: 180, panel: 260, page: 300, easing: 'ease-out', stateLayerOpacity: { hover: 0.06, focus: 0.1, press: 0.1, drag: 0.14 }, reducedMotion: 'opacity-only' }
  const blur: ThemeBlurTokens = {
    enabled: isGlass,
    radius: isGlass ? 22 : 0,
    material: isGlass ? 'regular' : 'none',
    maxLayersPerRegion: isGlass ? 1 : 0,
    fallback: isGlass ? 'opaque' : isMaterial ? 'tonal' : 'opaque',
    dimmingOpacity: isGlass ? 0.24 : 0,
  }
  const surface = surfaceMaterialsFor(family, mode, colors, elevation)
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
      blur,
      surface,
    },
    component: componentsFor(family, colors, radius, mode, surface),
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
