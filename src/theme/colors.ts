import type { ThemeId, ThemeMode } from '@/types/settingsContracts'
import { normalizeSettingsThemeAccent, normalizeSettingsThemeFamily, normalizeSettingsThemeMode } from '@/modules/settings'
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
  layout: 'quiet' | 'editorial' | 'document'
  navigation: 'quiet' | 'route' | 'document'
  background: 'plain' | 'road' | 'document'
  transition: 'fade' | 'travel' | 'cut'
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
  family: ThemeId
  minimal: boolean
  markdown: boolean
  /** @deprecated Compatibility flag for older presentation consumers. */
  glass: boolean
  limeRoad: boolean
  ornamented: boolean
  ambient: 'lime-road' | 'markdown' | 'plain'
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
  accent: string
  border: string
  borderStrong: string
  text: string
  textSecondary: string
  textTertiary: string
  success: string
  warning: string
  error: string
  backdrop: string
  island: string
  islandRaised: string
  islandMuted: string
  glass: string
  mintSoft: string
  amberSoft: string
  skySoft: string
  shadowTint: string
  paper: string
  paperDeep: string
  paperWarm: string
  creamInk: string
  mint: string
  mintPressed: string
  mintWash: string
  amber: string
  amberPressed: string
  amberWash: string
  coral: string
  coralWash: string
  sky: string
  skyWash: string
  overlay: string
  scrim: string
  pressed: string
  disabled: string
  highlight: string
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
}

// Lime-road palette: paper, cobalt route ink, acid markers, coral notes, and warm earth.
const limeRoadCards: CardColorMap = {
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

function semanticUi(family: ThemeId, mode: ResolvedThemeMode): ThemeUiTokens['semantic'] {
  const dark = mode === 'dark'
  if (family === 'lime-road') {
    return {
      surface: {
        canvas: dark ? '#101A28' : '#F4F1E8',
        base: dark ? '#162A3A' : '#FFFDFC',
        raised: dark ? '#1B3548' : '#FFFFFF',
        muted: dark ? '#203F4F' : '#E9F2F4',
        overlay: dark ? 'rgba(22, 42, 58, 0.94)' : 'rgba(255, 253, 248, 0.94)',
      },
      content: {
        primary: dark ? '#F4F1E8' : '#25272B',
        secondary: dark ? '#C3D2D6' : '#5A6870',
        tertiary: dark ? '#8EA5AB' : '#657379',
        inverse: dark ? '#0F1A26' : '#FFFFFF',
      },
      chrome: {
        background: dark ? 'rgba(22, 42, 58, 0.96)' : 'rgba(255, 253, 248, 0.96)',
        border: dark ? 'rgba(195, 210, 214, 0.2)' : 'rgba(37, 39, 43, 0.14)',
        toolbar: dark ? 'rgba(195, 210, 214, 0.06)' : 'rgba(13, 106, 196, 0.06)',
        sheet: dark ? '#162A3A' : '#FFFDFC',
      },
      control: {
        background: dark ? '#5DB8D1' : '#0D6AC4',
        foreground: dark ? '#0F1A26' : '#FFFFFF',
        border: dark ? 'rgba(93, 184, 209, 0.56)' : 'rgba(13, 106, 196, 0.34)',
        focus: '#E8FC32',
      },
      feedback: {
        success: { background: dark ? '#173F3B' : '#E2F2E9', foreground: dark ? '#8AD5C6' : '#1D725E', border: dark ? 'rgba(138, 213, 198, 0.24)' : 'rgba(29, 114, 94, 0.22)' },
        warning: { background: dark ? '#4C3C1B' : '#FFF3C4', foreground: dark ? '#E8D46A' : '#73530D', border: dark ? 'rgba(232, 212, 106, 0.24)' : 'rgba(115, 83, 13, 0.22)' },
        danger: { background: dark ? 'rgba(241, 95, 141, 0.18)' : 'rgba(166, 48, 86, 0.1)', foreground: dark ? '#FF9FBA' : '#9A2F52', border: dark ? 'rgba(255, 159, 186, 0.24)' : 'rgba(154, 47, 82, 0.22)' },
        info: { background: dark ? '#193C50' : '#DDF2F5', foreground: dark ? '#9ED7E5' : '#276B7D', border: dark ? 'rgba(158, 215, 229, 0.24)' : 'rgba(39, 107, 125, 0.22)' },
      },
    }
  }
  if (family === 'markdown') {
    return {
      surface: {
        canvas: dark ? '#0D1117' : '#F6F8FA',
        base: dark ? '#161B22' : '#FFFFFF',
        raised: dark ? '#21262D' : '#F6F8FA',
        muted: dark ? '#1F242C' : '#EFF2F5',
        overlay: dark ? '#161B22' : '#FFFFFF',
      },
      content: {
        primary: dark ? '#F0F6FC' : '#1F2328',
        secondary: dark ? '#B1BAC4' : '#59636E',
        tertiary: dark ? '#8C959F' : '#6E7781',
        inverse: dark ? '#0D1117' : '#FFFFFF',
      },
      chrome: {
        background: dark ? '#161B22' : '#FFFFFF',
        border: dark ? '#30363D' : '#D0D7DE',
        toolbar: dark ? '#21262D' : '#F6F8FA',
        sheet: dark ? '#161B22' : '#FFFFFF',
      },
      control: {
        background: dark ? '#58A6FF' : '#315A73',
        foreground: dark ? '#0D1117' : '#FFFFFF',
        border: dark ? '#58A6FF' : '#315A73',
        focus: dark ? '#79C0FF' : '#0969DA',
      },
      feedback: {
        success: { background: dark ? '#122117' : '#DAFBE1', foreground: dark ? '#7EE787' : '#116329', border: dark ? '#238636' : '#4AC26B' },
        warning: { background: dark ? '#2D2305' : '#FFF8C5', foreground: dark ? '#E3B341' : '#7D4E00', border: dark ? '#9E6A03' : '#D4A72C' },
        danger: { background: dark ? '#2D1619' : '#FFEBE9', foreground: dark ? '#FF7B72' : '#A40E26', border: dark ? '#DA3633' : '#FF8182' },
        info: { background: dark ? '#121D2F' : '#DDF4FF', foreground: dark ? '#79C0FF' : '#0550AE', border: dark ? '#1F6FEB' : '#54AEFF' },
      },
    }
  }
  return {
    surface: {
      canvas: dark ? '#090a0b' : '#f7f7f2',
      base: dark ? '#111416' : '#ffffff',
      raised: dark ? '#141719' : '#ffffff',
      muted: dark ? '#1b2023' : '#f0efea',
      overlay: dark ? 'rgba(17, 20, 22, 0.92)' : 'rgba(255, 255, 255, 0.92)',
    },
    content: {
      primary: dark ? '#edf0f2' : '#1b1d1f',
      secondary: dark ? '#b3bbc0' : '#565f63',
      tertiary: dark ? '#747f86' : '#7f8589',
      inverse: dark ? '#0b0d0e' : '#ffffff',
    },
    chrome: {
      background: dark ? '#141719' : '#ffffff',
      border: dark ? 'rgba(232, 236, 238, 0.18)' : 'rgba(25, 27, 29, 0.18)',
      toolbar: dark ? 'rgba(232, 236, 238, 0.05)' : 'rgba(25, 27, 29, 0.04)',
      sheet: dark ? '#111416' : '#ffffff',
    },
    control: {
      background: dark ? '#d7f0e8' : '#234f46',
      foreground: dark ? '#0b0d0e' : '#ffffff',
      border: dark ? 'rgba(215, 240, 232, 0.58)' : 'rgba(35, 79, 70, 0.34)',
      focus: dark ? '#9fd8ca' : '#2f6259',
    },
    feedback: {
      success: { background: dark ? '#17322d' : '#e5f2ee', foreground: dark ? '#81c59b' : '#3f7c5f', border: dark ? 'rgba(129, 197, 155, 0.24)' : 'rgba(63, 124, 95, 0.22)' },
      warning: { background: dark ? '#352819' : '#f4ead8', foreground: dark ? '#d0a15a' : '#925b16', border: dark ? 'rgba(208, 161, 90, 0.24)' : 'rgba(146, 91, 22, 0.22)' },
      danger: { background: dark ? 'rgba(224, 122, 115, 0.14)' : 'rgba(181, 69, 63, 0.1)', foreground: dark ? '#e07a73' : '#b5453f', border: dark ? 'rgba(224, 122, 115, 0.24)' : 'rgba(181, 69, 63, 0.2)' },
      info: { background: dark ? '#1a2630' : '#e8eef8', foreground: dark ? '#88949b' : '#5a687c', border: dark ? 'rgba(136, 148, 155, 0.24)' : 'rgba(90, 104, 124, 0.18)' },
    },
  }
}

function limeRoadUi(mode: ResolvedThemeMode): ThemeUiTokens {
  const dark = mode === 'dark'
  return {
    family: 'lime-road',
    minimal: false,
    markdown: false,
    glass: false,
    limeRoad: true,
    ornamented: true,
    ambient: 'lime-road',
    experience: {
      layout: 'editorial',
      navigation: 'route',
      background: 'road',
      transition: 'travel',
      density: 'airy',
    },
    semantic: semanticUi('lime-road', mode),
    section: {
      marker: dark ? '#5DB8D1' : '#0D6AC4',
      title: dark ? '#F4F1E8' : '#25272B',
      divider: dark ? 'rgba(195, 210, 214, 0.18)' : 'rgba(37, 39, 43, 0.14)',
    },
    icon: {
      accentBackground: dark ? '#193C50' : '#DDF2F5',
      accentForeground: dark ? '#9ED7E5' : '#276B7D',
    },
    tone: {
      success: {
        background: dark ? '#173F3B' : '#E2F2E9',
        foreground: dark ? '#8AD5C6' : '#1D725E',
        border: dark ? 'rgba(138, 213, 198, 0.24)' : 'rgba(29, 114, 94, 0.22)',
      },
      warning: {
        background: dark ? '#4C3C1B' : '#FFF3C4',
        foreground: dark ? '#E8D46A' : '#73530D',
        border: dark ? 'rgba(232, 212, 106, 0.24)' : 'rgba(115, 83, 13, 0.22)',
      },
      danger: {
        background: dark ? 'rgba(241, 95, 141, 0.18)' : 'rgba(166, 48, 86, 0.1)',
        foreground: dark ? '#FF9FBA' : '#9A2F52',
        border: dark ? 'rgba(255, 159, 186, 0.24)' : 'rgba(154, 47, 82, 0.22)',
      },
      info: {
        background: dark ? '#193C50' : '#DDF2F5',
        foreground: dark ? '#9ED7E5' : '#276B7D',
        border: dark ? 'rgba(158, 215, 229, 0.24)' : 'rgba(39, 107, 125, 0.22)',
      },
      neutral: {
        background: dark ? '#1B3548' : '#F4F1E8',
        foreground: dark ? '#C3D2D6' : '#5A6870',
        border: dark ? 'rgba(195, 210, 214, 0.18)' : 'rgba(37, 39, 43, 0.14)',
      },
      ink: {
        background: dark ? '#5DB8D1' : '#0D6AC4',
        foreground: dark ? '#0F1A26' : '#FFFFFF',
        border: dark ? 'rgba(93, 184, 209, 0.56)' : 'rgba(13, 106, 196, 0.34)',
      },
    },
    radius: {
      card: 8,
      titleCard: 8,
      panel: 8,
      modal: 8,
      field: 8,
      chip: 999,
      controlSmall: 6,
      controlMiddle: 8,
      controlLarge: 8,
    },
    control: {
      primaryBackground: dark ? '#5DB8D1' : '#0D6AC4',
      primaryForeground: dark ? '#0F1A26' : '#FFFFFF',
      dangerForeground: dark ? '#0F1A26' : '#FFFFFF',
      primaryBorder: dark ? 'rgba(93, 184, 209, 0.56)' : 'rgba(13, 106, 196, 0.34)',
      defaultBackground: dark ? '#162A3A' : '#FFFDFC',
      disabledBackground: dark ? '#203F4F' : '#E9F2F4',
      disabledForeground: dark ? '#C3D2D6' : '#5A6870',
      disabledBorder: dark ? 'rgba(195, 210, 214, 0.14)' : 'rgba(37, 39, 43, 0.12)',
      disabledOpacity: 1,
      link: dark ? '#9ED7E5' : '#0D6AC4',
      focus: '#E8FC32',
      shadow: dark ? '#07111C' : '#A5B9BA',
      dangerShadow: dark ? '#2A0B16' : '#8A2D4A',
      primaryShadowOpacity: dark ? 0.1 : 0.05,
      primaryShadowRadius: 0,
      primaryShadowOffset: 1,
      secondaryShadowOpacity: dark ? 0.025 : 0.015,
      secondaryShadowRadius: 3,
      secondaryShadowOffset: 1,
    },
    input: {
      background: dark ? '#1B3548' : '#F4F1E8',
      backgroundFocused: dark ? '#162A3A' : '#FFFDFC',
      disabledBackground: dark ? '#203F4F' : '#E9F2F4',
      disabledForeground: dark ? '#C3D2D6' : '#5A6870',
      placeholderForeground: dark ? '#8EA5AB' : '#657379',
      border: dark ? 'rgba(195, 210, 214, 0.18)' : 'rgba(37, 39, 43, 0.16)',
      focus: '#E8FC32',
      shadow: dark ? '#07111C' : '#A5B9BA',
      shadowOpacity: dark ? 0.04 : 0.025,
      shadowRadius: 0,
    },
    switch: {
      trackOn: dark ? '#5DB8D1' : '#0D6AC4',
      trackOff: dark ? '#294758' : '#D7E4E7',
      trackOnBorder: dark ? 'rgba(93, 184, 209, 0.5)' : 'rgba(13, 106, 196, 0.3)',
      trackOffBorder: dark ? 'rgba(195, 210, 214, 0.18)' : 'rgba(37, 39, 43, 0.14)',
      thumb: dark ? '#F4F1E8' : '#FFFDFC',
      thumbOnBorder: dark ? 'rgba(244, 241, 232, 0.34)' : 'rgba(255, 253, 248, 0.84)',
      thumbOffBorder: dark ? '#8EA5AB' : '#9AAEB2',
      shadowOpacity: 0,
    },
    card: {
      defaultBackground: dark ? '#162A3A' : '#F4F1E8',
      mutedBackground: dark ? '#203F4F' : '#F0F6F6',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: 0,
    },
    composer: {
      shellBackground: dark ? '#162A3A' : '#FFFDFC',
      shellFocusedBackground: dark ? '#1B3548' : '#F8FBFA',
      toolbarBackground: dark ? 'rgba(195, 210, 214, 0.06)' : 'rgba(13, 106, 196, 0.06)',
      toolbarBorder: dark ? 'rgba(195, 210, 214, 0.16)' : 'rgba(37, 39, 43, 0.12)',
      statusBackground: dark ? 'rgba(195, 210, 214, 0.08)' : 'rgba(13, 106, 196, 0.06)',
      statusForeground: dark ? '#C3D2D6' : '#5A6870',
    },
    actionBar: {
      background: dark ? 'rgba(22, 42, 58, 0.96)' : 'rgba(255, 253, 248, 0.96)',
      border: dark ? 'rgba(195, 210, 214, 0.16)' : 'rgba(37, 39, 43, 0.12)',
      itemBackground: dark ? '#1B3548' : '#F4F1E8',
      itemBorder: dark ? 'rgba(195, 210, 214, 0.16)' : 'rgba(37, 39, 43, 0.12)',
      itemActiveBackground: dark ? '#203F4F' : '#DDF2F5',
    },
    message: {
      userBackground: dark ? '#5DB8D1' : '#00529B',
      userForeground: dark ? '#0F1A26' : '#FFFFFF',
      userBorder: dark ? 'rgba(93, 184, 209, 0.52)' : 'rgba(13, 106, 196, 0.34)',
      userActionBackground: dark ? 'rgba(15, 26, 38, 0.12)' : 'rgba(255, 255, 255, 0.18)',
      userActionForeground: dark ? '#0F1A26' : '#FFFFFF',
    },
    code: {
      background: dark ? '#0D1A27' : '#20384A',
      border: dark ? '#28455A' : '#365D73',
      text: dark ? '#DDECF0' : '#F4F1E8',
    },
    table: {
      headerBackground: dark ? '#193C50' : '#DDF2F5',
    },
    loading: {
      background: dark ? '#193C50' : '#DDF2F5',
      border: dark ? '#5DB8D1' : '#0D6AC4',
      dot: dark ? '#E8FC32' : '#0D6AC4',
    },
    time: {
      border: dark ? '#294758' : '#D7E4E7',
      divider: dark ? 'rgba(195, 210, 214, 0.18)' : 'rgba(37, 39, 43, 0.12)',
    },
    footer: {
      sea: dark ? ['#193C50', '#2A718B', '#5DB8D1'] : ['#B8E0EA', '#84BAC1', '#0D6AC4'],
      tree: dark ? ['#3B3820', '#75652B', '#E8FC32'] : ['#D2BC74', '#AB594E', '#E8FC32'],
    },
  }
}

function minimalUi(mode: ResolvedThemeMode): ThemeUiTokens {
  const dark = mode === 'dark'
  return {
    family: 'minimal',
    minimal: true,
    markdown: false,
    glass: false,
    limeRoad: false,
    ornamented: false,
    ambient: 'plain',
    experience: {
      layout: 'quiet',
      navigation: 'quiet',
      background: 'plain',
      transition: 'fade',
      density: 'balanced',
    },
    semantic: semanticUi('minimal', mode),
    section: {
      marker: dark ? '#d7f0e8' : '#234f46',
      title: dark ? '#e8ecee' : '#191b1d',
      divider: dark ? 'rgba(232, 236, 238, 0.12)' : 'rgba(25, 27, 29, 0.12)',
    },
    icon: {
      accentBackground: dark ? '#1f2a2d' : '#dcebe6',
      accentForeground: dark ? '#d7f0e8' : '#173a34',
    },
    tone: {
      success: {
        background: dark ? '#17322d' : '#e5f2ee',
        foreground: dark ? '#81c59b' : '#3f7c5f',
        border: dark ? 'rgba(129, 197, 155, 0.24)' : 'rgba(63, 124, 95, 0.22)',
      },
      warning: {
        background: dark ? '#352819' : '#f4ead8',
        foreground: dark ? '#d0a15a' : '#925b16',
        border: dark ? 'rgba(208, 161, 90, 0.24)' : 'rgba(146, 91, 22, 0.22)',
      },
      danger: {
        background: dark ? 'rgba(224, 122, 115, 0.14)' : 'rgba(181, 69, 63, 0.1)',
        foreground: dark ? '#e07a73' : '#b5453f',
        border: dark ? 'rgba(224, 122, 115, 0.24)' : 'rgba(181, 69, 63, 0.2)',
      },
      info: {
        background: dark ? '#1a2630' : '#e8eef8',
        foreground: dark ? '#88949b' : '#5a687c',
        border: dark ? 'rgba(136, 148, 155, 0.24)' : 'rgba(90, 104, 124, 0.18)',
      },
      neutral: {
        background: dark ? '#141719' : '#ffffff',
        foreground: dark ? '#b3bbc0' : '#565f63',
        border: dark ? 'rgba(232, 236, 238, 0.1)' : 'rgba(25, 27, 29, 0.1)',
      },
      ink: {
        background: dark ? '#d7f0e8' : '#234f46',
        foreground: dark ? '#0b0d0e' : '#ffffff',
        border: dark ? 'rgba(215, 240, 232, 0.58)' : 'rgba(35, 79, 70, 0.34)',
      },
    },
    radius: {
      card: 8,
      titleCard: 8,
      panel: 8,
      modal: 8,
      field: 8,
      chip: 999,
      controlSmall: 6,
      controlMiddle: 8,
      controlLarge: 8,
    },
    control: {
      primaryBackground: dark ? '#d7f0e8' : '#234f46',
      primaryForeground: dark ? '#0b0d0e' : '#ffffff',
      dangerForeground: dark ? '#0b0d0e' : '#ffffff',
      primaryBorder: dark ? 'rgba(215, 240, 232, 0.58)' : 'rgba(35, 79, 70, 0.34)',
      defaultBackground: dark ? '#141719' : '#ffffff',
      disabledBackground: dark ? '#1b2023' : '#eeede8',
      disabledForeground: dark ? '#b3bbc0' : '#565f63',
      disabledBorder: dark ? 'rgba(232, 236, 238, 0.1)' : 'rgba(25, 27, 29, 0.1)',
      disabledOpacity: 1,
      link: dark ? '#9fd8ca' : '#2f6259',
      focus: dark ? '#9fd8ca' : '#2f6259',
      shadow: dark ? '#000000' : '#0f172a',
      dangerShadow: dark ? '#000000' : '#7f1d1d',
      primaryShadowOpacity: dark ? 0.08 : 0.04,
      primaryShadowRadius: 8,
      primaryShadowOffset: 1,
      secondaryShadowOpacity: 0,
      secondaryShadowRadius: 0,
      secondaryShadowOffset: 0,
    },
    input: {
      background: dark ? '#141719' : '#ffffff',
      backgroundFocused: dark ? '#171b1d' : '#ffffff',
      disabledBackground: dark ? '#1b2023' : '#eeede8',
      disabledForeground: dark ? '#b3bbc0' : '#565f63',
      placeholderForeground: dark ? '#7a868d' : '#7f8589',
      border: dark ? 'rgba(232, 236, 238, 0.14)' : 'rgba(25, 27, 29, 0.13)',
      focus: dark ? '#9fd8ca' : '#2f6259',
      shadow: dark ? '#000000' : '#0f172a',
      shadowOpacity: dark ? 0.08 : 0.03,
      shadowRadius: 6,
    },
    switch: {
      trackOn: dark ? '#9fd8ca' : '#234f46',
      trackOff: dark ? '#252b2e' : '#d8d8d2',
      trackOnBorder: dark ? 'rgba(159, 216, 202, 0.5)' : 'rgba(35, 79, 70, 0.32)',
      trackOffBorder: dark ? 'rgba(232, 236, 238, 0.18)' : 'rgba(25, 27, 29, 0.12)',
      thumb: dark ? '#0b0d0e' : '#ffffff',
      thumbOnBorder: dark ? 'rgba(11, 13, 14, 0.28)' : 'rgba(255, 255, 255, 0.72)',
      thumbOffBorder: dark ? '#5f686d' : '#b7b7ae',
      shadowOpacity: 0,
    },
    card: {
      defaultBackground: dark ? '#141719' : '#ffffff',
      mutedBackground: dark ? '#1b2023' : '#f0efea',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: 0,
    },
    composer: {
      shellBackground: dark ? '#111416' : '#ffffff',
      shellFocusedBackground: dark ? '#141719' : '#ffffff',
      toolbarBackground: dark ? 'rgba(232, 236, 238, 0.05)' : 'rgba(25, 27, 29, 0.04)',
      toolbarBorder: dark ? 'rgba(232, 236, 238, 0.1)' : 'rgba(25, 27, 29, 0.1)',
      statusBackground: dark ? 'rgba(232, 236, 238, 0.07)' : 'rgba(25, 27, 29, 0.05)',
      statusForeground: dark ? '#b3bbc0' : '#565f63',
    },
    actionBar: {
      background: dark ? 'rgba(17, 20, 22, 0.96)' : 'rgba(255, 255, 255, 0.96)',
      border: dark ? 'rgba(232, 236, 238, 0.09)' : 'rgba(25, 27, 29, 0.09)',
      itemBackground: dark ? '#1b2023' : '#ffffff',
      itemBorder: dark ? 'rgba(232, 236, 238, 0.08)' : 'rgba(25, 27, 29, 0.08)',
      itemActiveBackground: dark ? '#252b2e' : '#f0efea',
    },
    message: {
      userBackground: dark ? '#d7f0e8' : '#234f46',
      userForeground: dark ? '#0b0d0e' : '#ffffff',
      userBorder: dark ? '#d7f0e8' : '#234f46',
      userActionBackground: dark ? 'rgba(11, 13, 14, 0.08)' : 'rgba(255, 255, 255, 0.14)',
      userActionForeground: dark ? '#0b0d0e' : '#ffffff',
    },
    code: {
      background: dark ? '#0f1113' : '#1e2326',
      border: dark ? '#262c30' : '#333b40',
      text: '#e5e7eb',
    },
    table: {
      headerBackground: dark ? '#1b2023' : '#f0efea',
    },
    loading: {
      background: dark ? '#1b2023' : '#edf5f1',
      border: dark ? '#365b52' : '#b9d8cf',
      dot: dark ? '#9fd8ca' : '#234f46',
    },
    time: {
      border: dark ? '#252b2e' : '#d8d8d2',
      divider: dark ? 'rgba(232, 236, 238, 0.12)' : 'rgba(25, 27, 29, 0.12)',
    },
    footer: {
      sea: dark ? ['#1f3f46', '#335c63', '#46737a'] : ['#d9e9e5', '#b7d4ce', '#8fb9b0'],
      tree: dark ? ['#24322f', '#33453f', '#42584f'] : ['#dfe8df', '#cbd9ca', '#b4c7b5'],
    },
  }
}

function markdownUi(mode: ResolvedThemeMode): ThemeUiTokens {
  const dark = mode === 'dark'
  return {
    family: 'markdown',
    minimal: true,
    markdown: true,
    glass: false,
    limeRoad: false,
    ornamented: false,
    ambient: 'markdown',
    experience: {
      layout: 'document',
      navigation: 'document',
      background: 'document',
      transition: 'cut',
      density: 'compact',
    },
    semantic: semanticUi('markdown', mode),
    section: {
      marker: dark ? '#58A6FF' : '#0969DA',
      title: dark ? '#F0F6FC' : '#1F2328',
      divider: dark ? '#30363D' : '#D0D7DE',
    },
    icon: {
      accentBackground: dark ? '#1F2D3D' : '#DDF4FF',
      accentForeground: dark ? '#79C0FF' : '#0550AE',
    },
    tone: {
      success: {
        background: dark ? '#122117' : '#DAFBE1',
        foreground: dark ? '#7EE787' : '#116329',
        border: dark ? '#238636' : '#4AC26B',
      },
      warning: {
        background: dark ? '#2D2305' : '#FFF8C5',
        foreground: dark ? '#E3B341' : '#7D4E00',
        border: dark ? '#9E6A03' : '#D4A72C',
      },
      danger: {
        background: dark ? '#2D1619' : '#FFEBE9',
        foreground: dark ? '#FF7B72' : '#A40E26',
        border: dark ? '#DA3633' : '#FF8182',
      },
      info: {
        background: dark ? '#121D2F' : '#DDF4FF',
        foreground: dark ? '#79C0FF' : '#0550AE',
        border: dark ? '#1F6FEB' : '#54AEFF',
      },
      neutral: {
        background: dark ? '#21262D' : '#F6F8FA',
        foreground: dark ? '#B1BAC4' : '#59636E',
        border: dark ? '#30363D' : '#D0D7DE',
      },
      ink: {
        background: dark ? '#58A6FF' : '#315A73',
        foreground: dark ? '#0D1117' : '#FFFFFF',
        border: dark ? '#58A6FF' : '#315A73',
      },
    },
    radius: {
      card: 6,
      titleCard: 6,
      panel: 6,
      modal: 8,
      field: 6,
      chip: 999,
      controlSmall: 4,
      controlMiddle: 6,
      controlLarge: 8,
    },
    control: {
      primaryBackground: dark ? '#58A6FF' : '#315A73',
      primaryForeground: dark ? '#0D1117' : '#FFFFFF',
      dangerForeground: dark ? '#0D1117' : '#FFFFFF',
      primaryBorder: dark ? '#58A6FF' : '#315A73',
      defaultBackground: dark ? '#21262D' : '#F6F8FA',
      disabledBackground: dark ? '#21262D' : '#EFF2F5',
      disabledForeground: dark ? '#8C959F' : '#59636E',
      disabledBorder: dark ? '#30363D' : '#D0D7DE',
      disabledOpacity: 1,
      link: dark ? '#58A6FF' : '#0969DA',
      focus: dark ? '#79C0FF' : '#0969DA',
      shadow: '#000000',
      dangerShadow: '#000000',
      primaryShadowOpacity: 0,
      primaryShadowRadius: 0,
      primaryShadowOffset: 0,
      secondaryShadowOpacity: 0,
      secondaryShadowRadius: 0,
      secondaryShadowOffset: 0,
    },
    input: {
      background: dark ? '#0D1117' : '#FFFFFF',
      backgroundFocused: dark ? '#161B22' : '#FFFFFF',
      disabledBackground: dark ? '#21262D' : '#F6F8FA',
      disabledForeground: dark ? '#8C959F' : '#59636E',
      placeholderForeground: dark ? '#8C959F' : '#6E7781',
      border: dark ? '#30363D' : '#D0D7DE',
      focus: dark ? '#58A6FF' : '#0969DA',
      shadow: '#000000',
      shadowOpacity: 0,
      shadowRadius: 0,
    },
    switch: {
      trackOn: dark ? '#58A6FF' : '#315A73',
      trackOff: dark ? '#30363D' : '#D0D7DE',
      trackOnBorder: dark ? '#58A6FF' : '#315A73',
      trackOffBorder: dark ? '#484F58' : '#AFB8C1',
      thumb: dark ? '#0D1117' : '#FFFFFF',
      thumbOnBorder: dark ? '#0D1117' : '#FFFFFF',
      thumbOffBorder: dark ? '#8C959F' : '#6E7781',
      shadowOpacity: 0,
    },
    card: {
      defaultBackground: dark ? '#161B22' : '#FFFFFF',
      mutedBackground: dark ? '#21262D' : '#F6F8FA',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: 0,
    },
    composer: {
      shellBackground: dark ? '#161B22' : '#FFFFFF',
      shellFocusedBackground: dark ? '#21262D' : '#FFFFFF',
      toolbarBackground: dark ? '#21262D' : '#F6F8FA',
      toolbarBorder: dark ? '#30363D' : '#D0D7DE',
      statusBackground: dark ? '#21262D' : '#F6F8FA',
      statusForeground: dark ? '#B1BAC4' : '#59636E',
    },
    actionBar: {
      background: dark ? '#161B22' : '#FFFFFF',
      border: dark ? '#30363D' : '#D0D7DE',
      itemBackground: dark ? '#21262D' : '#F6F8FA',
      itemBorder: dark ? '#30363D' : '#D0D7DE',
      itemActiveBackground: dark ? '#30363D' : '#DDF4FF',
    },
    message: {
      userBackground: dark ? '#58A6FF' : '#315A73',
      userForeground: dark ? '#0D1117' : '#FFFFFF',
      userBorder: dark ? '#58A6FF' : '#315A73',
      userActionBackground: dark ? 'rgba(13, 17, 23, 0.12)' : 'rgba(255, 255, 255, 0.16)',
      userActionForeground: dark ? '#0D1117' : '#FFFFFF',
    },
    code: {
      background: dark ? '#0D1117' : '#F6F8FA',
      border: dark ? '#30363D' : '#D0D7DE',
      text: dark ? '#E6EDF3' : '#1F2328',
    },
    table: {
      headerBackground: dark ? '#21262D' : '#F6F8FA',
    },
    loading: {
      background: dark ? '#21262D' : '#F6F8FA',
      border: dark ? '#58A6FF' : '#0969DA',
      dot: dark ? '#58A6FF' : '#0969DA',
    },
    time: {
      border: dark ? '#30363D' : '#D0D7DE',
      divider: dark ? '#30363D' : '#D0D7DE',
    },
    footer: {
      sea: dark ? ['#17243A', '#1F3A5F', '#315A73'] : ['#DDF4FF', '#B6E3FF', '#80CCFF'],
      tree: dark ? ['#1B2A24', '#244237', '#315C4B'] : ['#DAFBE1', '#ACEEBB', '#6FDD8B'],
    },
  }
}

function limeRoadBackground(mode: ResolvedThemeMode): ThemeBackgroundTokens {
  const dark = mode === 'dark'
  return {
    defaultMode: 'surface',
    canvas: dark ? '#101A28' : '#F4F1E8',
    focusCanvas: dark ? '#0D1724' : '#EEF7F7',
    surfaceCanvas: dark ? '#122234' : '#FFFDFC',
    mist: {
      primary: dark ? '#193C50' : '#DDF2F5',
      secondary: dark ? '#28455A' : '#B8E0EA',
      warm: dark ? '#4C3C1B' : '#FFF3C4',
      coolOpacity: dark ? 0.14 : 0.16,
      warmOpacity: dark ? 0.07 : 0.08,
      focusOpacity: dark ? 0.08 : 0.09,
      surfaceOpacity: dark ? 0.05 : 0.06,
    },
    trace: {
      primary: dark ? '#5DB8D1' : '#0D6AC4',
      secondary: dark ? '#9ED7E5' : '#84BAC1',
      accent: '#E8FC32',
      opacity: dark ? 0.12 : 0.1,
      focusOpacity: dark ? 0.08 : 0.08,
      surfaceOpacity: dark ? 0.05 : 0.06,
    },
    grid: dark ? 'rgba(195, 210, 214, 0.1)' : 'rgba(13, 106, 196, 0.09)',
    scrim: dark ? 'rgba(7, 17, 28, 0.2)' : 'rgba(244, 241, 232, 0.18)',
    motion: 'full',
  }
}

function minimalBackground(mode: ResolvedThemeMode): ThemeBackgroundTokens {
  const dark = mode === 'dark'
  return {
    defaultMode: dark ? 'surface' : 'plain',
    canvas: dark ? '#090a0b' : '#f7f7f2',
    focusCanvas: dark ? '#08090a' : '#f5f5ef',
    surfaceCanvas: dark ? '#0d1011' : '#f8f8f4',
    mist: {
      primary: dark ? '#17322d' : '#e5f2ee',
      secondary: dark ? '#1a2630' : '#e8eef8',
      warm: dark ? '#352819' : '#f4ead8',
      coolOpacity: dark ? 0.12 : 0.16,
      warmOpacity: dark ? 0.08 : 0.1,
      focusOpacity: dark ? 0.08 : 0.1,
      surfaceOpacity: dark ? 0.07 : 0.08,
    },
    trace: {
      primary: dark ? '#9fd8ca' : '#234f46',
      secondary: dark ? '#88949b' : '#64748b',
      accent: dark ? '#d0a15a' : '#b7791f',
      opacity: dark ? 0.12 : 0.1,
      focusOpacity: dark ? 0.08 : 0.08,
      surfaceOpacity: dark ? 0.08 : 0.07,
    },
    grid: dark ? 'rgba(232, 236, 238, 0.07)' : 'rgba(25, 27, 29, 0.07)',
    scrim: dark ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.2)',
    motion: 'subtle',
  }
}

const limeRoadLight: AppPalette = {
  surface: '#F4F1E8',
  surfaceSecondary: '#FFFDFC',
  surfaceTertiary: '#E9F2F4',
  primary: '#0D6AC4',
  primaryForeground: '#FFFFFF',
  secondary: '#5A6870',
  accent: '#E8FC32',
  border: 'rgba(37, 39, 43, 0.14)',
  borderStrong: 'rgba(37, 39, 43, 0.28)',
  text: '#25272B',
  textSecondary: '#5A6870',
  textTertiary: '#657379',
  success: '#1D725E',
  warning: '#73530D',
  error: '#9A2F52',
  backdrop: 'rgba(15, 26, 38, 0.48)',
  island: '#FFFDFC',
  islandRaised: '#FFFFFF',
  islandMuted: '#E9F2F4',
  glass: 'rgba(255, 253, 248, 0.86)',
  mintSoft: '#DDF2F5',
  amberSoft: '#FFF3C4',
  skySoft: '#B8E0EA',
  shadowTint: '#7A8F94',
  paper: '#F4F1E8',
  paperDeep: '#E7EEF0',
  paperWarm: '#FFF3C4',
  creamInk: '#25272B',
  mint: '#0D6AC4',
  mintPressed: '#09549D',
  mintWash: '#DDF2F5',
  amber: '#E8FC32',
  amberPressed: '#B5C91C',
  amberWash: '#FFF3C4',
  coral: '#F15F8D',
  coralWash: 'rgba(241, 95, 141, 0.12)',
  sky: '#84BAC1',
  skyWash: '#DDF2F5',
  overlay: 'rgba(15, 26, 38, 0.48)',
  scrim: 'rgba(37, 39, 43, 0.12)',
  pressed: 'rgba(13, 106, 196, 0.1)',
  disabled: 'rgba(90, 104, 112, 0.36)',
  highlight: 'rgba(232, 252, 50, 0.22)',
  background: limeRoadBackground('light'),
  material: {
    canvas: '#F4F1E8',
    paper: '#FFFDFC',
    paperRaised: '#FFFFFF',
    paperPressed: '#E9F2F4',
    glass: 'rgba(255, 253, 248, 0.86)',
    chrome: 'rgba(255, 253, 248, 0.94)',
    field: '#F4F1E8',
    stroke: 'rgba(37, 39, 43, 0.14)',
    strokeStrong: 'rgba(37, 39, 43, 0.28)',
    sheet: {
      surface: '#FFFDFC',
      chrome: 'rgba(255, 253, 248, 0.96)',
      body: '#FFFDFC',
      border: 'rgba(37, 39, 43, 0.2)',
      divider: 'rgba(37, 39, 43, 0.12)',
    },
  },
  status: {
    info: '#276B7D',
    success: '#1D725E',
    warning: '#73530D',
    danger: '#9A2F52',
    idle: '#7D8588',
  },
  shadow: {
    color: '#7A8F94',
    softOpacity: 0.06,
    mediumOpacity: 0.1,
    strongOpacity: 0.14,
  },
  cardColors: limeRoadCards,
  ui: limeRoadUi('light'),
}

const limeRoadDark: AppPalette = {
  surface: '#101A28',
  surfaceSecondary: '#162A3A',
  surfaceTertiary: '#203F4F',
  primary: '#5DB8D1',
  primaryForeground: '#0F1A26',
  secondary: '#9ED7E5',
  accent: '#E8FC32',
  border: 'rgba(195, 210, 214, 0.16)',
  borderStrong: 'rgba(195, 210, 214, 0.28)',
  text: '#F4F1E8',
  textSecondary: '#C3D2D6',
  textTertiary: '#8EA5AB',
  success: '#8AD5C6',
  warning: '#E8D46A',
  error: '#FF9FBA',
  backdrop: 'rgba(4, 12, 22, 0.72)',
  island: '#162A3A',
  islandRaised: '#1B3548',
  islandMuted: '#203F4F',
  glass: 'rgba(22, 42, 58, 0.88)',
  mintSoft: '#193F50',
  amberSoft: '#4C3C1B',
  skySoft: '#193C50',
  shadowTint: '#07111C',
  paper: '#101A28',
  paperDeep: '#0D1724',
  paperWarm: '#1B3548',
  creamInk: '#F4F1E8',
  mint: '#5DB8D1',
  mintPressed: '#3E8FA9',
  mintWash: '#193F50',
  amber: '#E8FC32',
  amberPressed: '#B5C91C',
  amberWash: '#4C3C1B',
  coral: '#FF9FBA',
  coralWash: 'rgba(241, 95, 141, 0.18)',
  sky: '#9ED7E5',
  skyWash: '#193C50',
  overlay: 'rgba(4, 12, 22, 0.72)',
  scrim: 'rgba(4, 12, 22, 0.42)',
  pressed: 'rgba(195, 210, 214, 0.1)',
  disabled: 'rgba(195, 210, 214, 0.36)',
  highlight: 'rgba(232, 252, 50, 0.16)',
  background: limeRoadBackground('dark'),
  material: {
    canvas: '#101A28',
    paper: '#162A3A',
    paperRaised: '#1B3548',
    paperPressed: '#203F4F',
    glass: 'rgba(22, 42, 58, 0.88)',
    chrome: 'rgba(22, 42, 58, 0.94)',
    field: '#1B3548',
    stroke: 'rgba(195, 210, 214, 0.16)',
    strokeStrong: 'rgba(195, 210, 214, 0.28)',
    sheet: {
      surface: '#162A3A',
      chrome: 'rgba(22, 42, 58, 0.96)',
      body: '#162A3A',
      border: 'rgba(195, 210, 214, 0.24)',
      divider: 'rgba(195, 210, 214, 0.16)',
    },
  },
  status: {
    info: '#9ED7E5',
    success: '#8AD5C6',
    warning: '#E8D46A',
    danger: '#FF9FBA',
    idle: '#8EA5AB',
  },
  shadow: {
    color: '#07111C',
    softOpacity: 0.16,
    mediumOpacity: 0.22,
    strongOpacity: 0.3,
  },
  cardColors: limeRoadCards,
  ui: limeRoadUi('dark'),
}

const minimalLight: AppPalette = {
  surface: '#f7f7f2',
  surfaceSecondary: '#ffffff',
  surfaceTertiary: '#eceae3',
  primary: '#234f46',
  primaryForeground: '#ffffff',
  secondary: '#64748b',
  accent: '#b7791f',
  border: 'rgba(25, 27, 29, 0.08)',
  borderStrong: 'rgba(25, 27, 29, 0.14)',
  text: '#1b1d1f',
  textSecondary: '#565f63',
  textTertiary: '#7f8589',
  success: '#3f7c5f',
  warning: '#a66a1f',
  error: '#b5453f',
  backdrop: 'rgba(15, 17, 19, 0.42)',
  island: '#ffffff',
  islandRaised: '#f0efea',
  islandMuted: '#e7e5de',
  glass: 'rgba(255, 255, 255, 0.82)',
  mintSoft: '#e5f2ee',
  amberSoft: '#f4ead8',
  skySoft: '#e8eef8',
  shadowTint: '#0f172a',
  paper: '#f7f7f2',
  paperDeep: '#eceae3',
  paperWarm: '#ffffff',
  creamInk: '#1b1d1f',
  mint: '#234f46',
  mintPressed: '#173a34',
  mintWash: '#e5f2ee',
  amber: '#b7791f',
  amberPressed: '#855514',
  amberWash: '#f4ead8',
  coral: '#b5453f',
  coralWash: 'rgba(181, 69, 63, 0.1)',
  sky: '#64748b',
  skyWash: '#e8eef8',
  overlay: 'rgba(15, 17, 19, 0.42)',
  scrim: 'rgba(15, 17, 19, 0.08)',
  pressed: 'rgba(25, 27, 29, 0.06)',
  disabled: 'rgba(86, 95, 99, 0.36)',
  highlight: 'rgba(255, 255, 255, 0.78)',
  background: minimalBackground('light'),
  material: {
    canvas: '#f7f7f2',
    paper: '#ffffff',
    paperRaised: '#ffffff',
    paperPressed: '#eceae3',
    glass: 'rgba(255, 255, 255, 0.82)',
    chrome: 'rgba(255, 255, 255, 0.92)',
    field: '#ffffff',
    stroke: 'rgba(25, 27, 29, 0.1)',
    strokeStrong: 'rgba(25, 27, 29, 0.18)',
    sheet: {
      surface: '#ffffff',
      chrome: '#f7f7f2',
      body: '#ffffff',
      border: 'rgba(25, 27, 29, 0.18)',
      divider: 'rgba(25, 27, 29, 0.1)',
    },
  },
  status: {
    info: '#64748b',
    success: '#3f7c5f',
    warning: '#a66a1f',
    danger: '#b5453f',
    idle: '#868b8f',
  },
  shadow: {
    color: '#0f172a',
    softOpacity: 0.05,
    mediumOpacity: 0.08,
    strongOpacity: 0.12,
  },
  cardColors: minimalCards,
  ui: minimalUi('light'),
}

const minimalDark: AppPalette = {
  surface: '#090a0b',
  surfaceSecondary: '#111416',
  surfaceTertiary: '#1b2023',
  primary: '#9fd8ca',
  primaryForeground: '#0b0d0e',
  secondary: '#88949b',
  accent: '#d0a15a',
  border: 'rgba(232, 236, 238, 0.08)',
  borderStrong: 'rgba(232, 236, 238, 0.14)',
  text: '#edf0f2',
  textSecondary: '#b3bbc0',
  textTertiary: '#7a868d',
  success: '#81c59b',
  warning: '#d0a15a',
  error: '#e07a73',
  backdrop: 'rgba(0, 0, 0, 0.68)',
  island: '#111416',
  islandRaised: '#1b2023',
  islandMuted: '#252b2e',
  glass: 'rgba(17, 20, 22, 0.82)',
  mintSoft: '#17322d',
  amberSoft: '#352819',
  skySoft: '#1a2630',
  shadowTint: '#000000',
  paper: '#090a0b',
  paperDeep: '#050607',
  paperWarm: '#111416',
  creamInk: '#edf0f2',
  mint: '#9fd8ca',
  mintPressed: '#79b9a9',
  mintWash: '#17322d',
  amber: '#d0a15a',
  amberPressed: '#a87a32',
  amberWash: '#352819',
  coral: '#e07a73',
  coralWash: 'rgba(224, 122, 115, 0.14)',
  sky: '#88949b',
  skyWash: '#1a2630',
  overlay: 'rgba(0, 0, 0, 0.68)',
  scrim: 'rgba(0, 0, 0, 0.42)',
  pressed: 'rgba(232, 236, 238, 0.07)',
  disabled: 'rgba(179, 187, 192, 0.34)',
  highlight: 'rgba(232, 236, 238, 0.08)',
  background: minimalBackground('dark'),
  material: {
    canvas: '#090a0b',
    paper: '#111416',
    paperRaised: '#141719',
    paperPressed: '#252b2e',
    glass: 'rgba(17, 20, 22, 0.82)',
    chrome: 'rgba(17, 20, 22, 0.92)',
    field: '#141719',
    stroke: 'rgba(232, 236, 238, 0.1)',
    strokeStrong: 'rgba(232, 236, 238, 0.18)',
    sheet: {
      surface: '#111416',
      chrome: '#141719',
      body: '#111416',
      border: 'rgba(232, 236, 238, 0.18)',
      divider: 'rgba(232, 236, 238, 0.1)',
    },
  },
  status: {
    info: '#88949b',
    success: '#81c59b',
    warning: '#d0a15a',
    danger: '#e07a73',
    idle: '#747f86',
  },
  shadow: {
    color: '#000000',
    softOpacity: 0.16,
    mediumOpacity: 0.22,
    strongOpacity: 0.3,
  },
  cardColors: minimalCards,
  ui: minimalUi('dark'),
}

const markdownLight: AppPalette = {
  ...minimalLight,
  primary: '#315A73',
  primaryForeground: '#FFFFFF',
  secondary: '#59636E',
  accent: '#0969DA',
  border: '#D0D7DE',
  borderStrong: '#AFB8C1',
  text: '#1F2328',
  textSecondary: '#59636E',
  textTertiary: '#6E7781',
  success: '#1A7F37',
  warning: '#9A6700',
  error: '#CF222E',
  backdrop: 'rgba(31, 35, 40, 0.4)',
  island: '#FFFFFF',
  islandRaised: '#F6F8FA',
  islandMuted: '#EFF2F5',
  glass: '#FFFFFF',
  mintSoft: '#DAFBE1',
  amberSoft: '#FFF8C5',
  skySoft: '#DDF4FF',
  shadowTint: '#1F2328',
  paper: '#FFFFFF',
  paperDeep: '#F6F8FA',
  paperWarm: '#FFFFFF',
  creamInk: '#1F2328',
  mint: '#1A7F37',
  mintPressed: '#116329',
  mintWash: '#DAFBE1',
  amber: '#9A6700',
  amberPressed: '#7D4E00',
  amberWash: '#FFF8C5',
  coral: '#CF222E',
  coralWash: '#FFEBE9',
  sky: '#0969DA',
  skyWash: '#DDF4FF',
  overlay: 'rgba(31, 35, 40, 0.4)',
  scrim: 'rgba(255, 255, 255, 0.12)',
  pressed: '#EFF2F5',
  disabled: '#AFB8C1',
  highlight: '#DDF4FF',
  background: {
    defaultMode: 'surface',
    canvas: '#F6F8FA',
    focusCanvas: '#F6F8FA',
    surfaceCanvas: '#FFFFFF',
    mist: {
      primary: '#DAFBE1',
      secondary: '#DDF4FF',
      warm: '#FFF8C5',
      coolOpacity: 0,
      warmOpacity: 0,
      focusOpacity: 0,
      surfaceOpacity: 0,
    },
    trace: {
      primary: '#0969DA',
      secondary: '#1A7F37',
      accent: '#9A6700',
      opacity: 0,
      focusOpacity: 0,
      surfaceOpacity: 0,
    },
    grid: '#D0D7DE',
    scrim: 'rgba(31, 35, 40, 0.08)',
    motion: 'none',
  },
  material: {
    canvas: '#F6F8FA',
    paper: '#FFFFFF',
    paperRaised: '#F6F8FA',
    paperPressed: '#EFF2F5',
    glass: '#FFFFFF',
    chrome: '#FFFFFF',
    field: '#FFFFFF',
    stroke: '#D0D7DE',
    strokeStrong: '#AFB8C1',
    sheet: {
      surface: '#FFFFFF',
      chrome: '#FFFFFF',
      body: '#FFFFFF',
      border: '#D0D7DE',
      divider: '#D8DEE4',
    },
  },
  status: {
    info: '#0969DA',
    success: '#1A7F37',
    warning: '#9A6700',
    danger: '#CF222E',
    idle: '#6E7781',
  },
  shadow: {
    color: '#1F2328',
    softOpacity: 0,
    mediumOpacity: 0,
    strongOpacity: 0,
  },
  cardColors: minimalCards,
  ui: markdownUi('light'),
}

const markdownDark: AppPalette = {
  ...minimalDark,
  primary: '#58A6FF',
  primaryForeground: '#0D1117',
  secondary: '#B1BAC4',
  accent: '#58A6FF',
  border: '#30363D',
  borderStrong: '#484F58',
  text: '#F0F6FC',
  textSecondary: '#B1BAC4',
  textTertiary: '#8C959F',
  success: '#7EE787',
  warning: '#E3B341',
  error: '#FF7B72',
  backdrop: 'rgba(1, 4, 9, 0.7)',
  island: '#161B22',
  islandRaised: '#21262D',
  islandMuted: '#1F242C',
  glass: '#161B22',
  mintSoft: '#122117',
  amberSoft: '#2D2305',
  skySoft: '#121D2F',
  shadowTint: '#010409',
  paper: '#161B22',
  paperDeep: '#0D1117',
  paperWarm: '#21262D',
  creamInk: '#F0F6FC',
  mint: '#7EE787',
  mintPressed: '#56D364',
  mintWash: '#122117',
  amber: '#E3B341',
  amberPressed: '#D29922',
  amberWash: '#2D2305',
  coral: '#FF7B72',
  coralWash: '#2D1619',
  sky: '#58A6FF',
  skyWash: '#121D2F',
  overlay: 'rgba(1, 4, 9, 0.7)',
  scrim: 'rgba(1, 4, 9, 0.32)',
  pressed: '#21262D',
  disabled: '#484F58',
  highlight: '#121D2F',
  background: {
    defaultMode: 'surface',
    canvas: '#0D1117',
    focusCanvas: '#0D1117',
    surfaceCanvas: '#161B22',
    mist: {
      primary: '#122117',
      secondary: '#121D2F',
      warm: '#2D2305',
      coolOpacity: 0,
      warmOpacity: 0,
      focusOpacity: 0,
      surfaceOpacity: 0,
    },
    trace: {
      primary: '#58A6FF',
      secondary: '#7EE787',
      accent: '#E3B341',
      opacity: 0,
      focusOpacity: 0,
      surfaceOpacity: 0,
    },
    grid: '#30363D',
    scrim: 'rgba(1, 4, 9, 0.18)',
    motion: 'none',
  },
  material: {
    canvas: '#0D1117',
    paper: '#161B22',
    paperRaised: '#21262D',
    paperPressed: '#1F242C',
    glass: '#161B22',
    chrome: '#161B22',
    field: '#0D1117',
    stroke: '#30363D',
    strokeStrong: '#484F58',
    sheet: {
      surface: '#161B22',
      chrome: '#161B22',
      body: '#161B22',
      border: '#30363D',
      divider: '#30363D',
    },
  },
  status: {
    info: '#58A6FF',
    success: '#7EE787',
    warning: '#E3B341',
    danger: '#FF7B72',
    idle: '#8C959F',
  },
  shadow: {
    color: '#010409',
    softOpacity: 0,
    mediumOpacity: 0,
    strongOpacity: 0,
  },
  cardColors: minimalCards,
  ui: markdownUi('dark'),
}

export const DEFAULT_THEME_ID: ThemeId = 'minimal'
export const themeIds = ['minimal', 'lime-road', 'markdown'] as const satisfies readonly ThemeId[]

export const themePalettes: Record<ThemeId, Record<ResolvedThemeMode, AppPalette>> = {
  minimal: {
    light: minimalLight,
    dark: minimalDark,
  },
  'lime-road': {
    light: limeRoadLight,
    dark: limeRoadDark,
  },
  markdown: {
    light: markdownLight,
    dark: markdownDark,
  },
}

// Backward-compatible alias for older code that imported colors.light/colors.dark.
export const colors = themePalettes.minimal

export function isThemeId(value: unknown): value is ThemeId {
  return value === 'minimal' || value === 'lime-road' || value === 'markdown'
}

export function normalizeThemeId(value: unknown): ThemeId {
  return normalizeSettingsThemeFamily(value) ?? DEFAULT_THEME_ID
}

export function resolveThemeMode(theme: unknown, systemScheme?: 'light' | 'dark' | null): ResolvedThemeMode {
  const normalizedTheme = normalizeSettingsThemeMode(theme) ?? 'system'
  return normalizedTheme === 'system' ? systemScheme ?? 'light' : normalizedTheme
}

const customAccentPaletteCache = new Map<string, AppPalette>()

export function normalizeThemeAccent(value: unknown): string | undefined {
  return normalizeSettingsThemeAccent(value)
}

export function getColors(
  theme: ThemeMode | ResolvedThemeMode,
  themeId: ThemeId = DEFAULT_THEME_ID,
  systemScheme?: 'light' | 'dark' | null,
  themeAccent?: string,
) {
  const resolvedMode = resolveThemeMode(theme as ThemeMode, systemScheme)
  const normalizedThemeId = normalizeThemeId(themeId)
  const basePalette = themePalettes[normalizedThemeId][resolvedMode]
  const normalizedAccent = normalizeThemeAccent(themeAccent)
  if (!normalizedAccent) return basePalette

  const cacheKey = `${normalizedThemeId}:${resolvedMode}:${normalizedAccent}`
  const cached = customAccentPaletteCache.get(cacheKey)
  if (cached) return cached

  const palette = applyThemeAccent(basePalette, normalizedAccent, resolvedMode)
  customAccentPaletteCache.set(cacheKey, palette)
  return palette
}

function applyThemeAccent(base: AppPalette, accent: string, mode: ResolvedThemeMode): AppPalette {
  const foreground = readableForeground(accent)
  const readableAccent = ensureContrast(accent, base.background.canvas, mode)
  const pressed = mixHex(accent, foreground === '#FFFFFF' ? '#000000' : '#FFFFFF', 0.16)
  const wash = rgba(accent, mode === 'dark' ? 0.18 : 0.11)
  const border = rgba(accent, mode === 'dark' ? 0.52 : 0.38)

  return {
    ...base,
    primary: accent,
    primaryForeground: foreground,
    accent,
    mint: accent,
    mintPressed: pressed,
    mintWash: wash,
    highlight: rgba(accent, mode === 'dark' ? 0.13 : 0.09),
    background: {
      ...base.background,
      trace: {
        ...base.background.trace,
        accent,
      },
    },
    ui: {
      ...base.ui,
      semantic: {
        ...base.ui.semantic,
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
        accentForeground: readableAccent,
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
      message: {
        ...base.ui.message,
        userBackground: accent,
        userForeground: foreground,
        userBorder: border,
        userActionForeground: foreground,
      },
      loading: {
        background: wash,
        border: readableAccent,
        dot: readableAccent,
      },
    },
  }
}

function readableForeground(background: string): '#FFFFFF' | '#0B0D0E' {
  return contrastRatio(background, '#FFFFFF') >= contrastRatio(background, '#0B0D0E')
    ? '#FFFFFF'
    : '#0B0D0E'
}

function ensureContrast(color: string, background: string, mode: ResolvedThemeMode): string {
  let candidate = color
  const target = mode === 'dark' ? '#FFFFFF' : '#000000'
  for (let step = 0; step < 8 && contrastRatio(candidate, background) < 4.5; step += 1) {
    candidate = mixHex(candidate, target, 0.12)
  }
  return candidate
}

function contrastRatio(left: string, right: string): number {
  const leftLuminance = relativeLuminance(left)
  const rightLuminance = relativeLuminance(right)
  const lighter = Math.max(leftLuminance, rightLuminance)
  const darker = Math.min(leftLuminance, rightLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(color: string): number {
  const { r, g, b } = hexToRgb(color)
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
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
