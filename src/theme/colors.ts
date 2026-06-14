import { type ThemeId, type ThemeMode } from '@/types'

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
  minimal: boolean
  ornamented: boolean
  ambient: 'island' | 'plain'
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

const islandCards: CardColorMap = {
  default: { bg: 'rgb(247, 243, 223)', fg: '#725d42' },
  'app-pink': { bg: '#f8a6b2', fg: '#fff' },
  purple: { bg: '#b77dee', fg: '#fff' },
  'app-blue': { bg: '#889df0', fg: '#fff' },
  'app-yellow': { bg: '#f7cd67', fg: '#725d42' },
  'app-orange': { bg: '#e59266', fg: '#fff' },
  'app-teal': { bg: '#82d5bb', fg: '#fff' },
  'app-green': { bg: '#8ac68a', fg: '#fff' },
  'app-red': { bg: '#fc736d', fg: '#fff' },
  'lime-green': { bg: '#d1da49', fg: '#3d5a1a' },
  'yellow-green': { bg: '#ecdf52', fg: '#725d42' },
  brown: { bg: '#9a835a', fg: '#fff' },
  'warm-peach-pink': { bg: '#e18c6f', fg: '#fff' },
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

function islandUi(mode: ResolvedThemeMode): ThemeUiTokens {
  const dark = mode === 'dark'
  return {
    minimal: false,
    ornamented: true,
    ambient: 'island',
    section: {
      marker: dark ? '#7cc9a8' : '#19c8b9',
      title: dark ? '#fff2dd' : '#794f27',
      divider: dark ? 'rgba(255, 238, 211, 0.12)' : 'rgba(114, 93, 66, 0.16)',
    },
    icon: {
      accentBackground: dark ? '#2e5145' : '#d8f3ee',
      accentForeground: dark ? '#b9f0d5' : '#0c6f66',
    },
    tone: {
      success: {
        background: dark ? '#214438' : '#e6f9f6',
        foreground: dark ? '#7cc9a8' : '#138f83',
        border: dark ? 'rgba(124, 201, 168, 0.24)' : 'rgba(25, 200, 185, 0.24)',
      },
      warning: {
        background: dark ? '#4c3920' : '#fff1c5',
        foreground: dark ? '#e8b15a' : '#8f6500',
        border: dark ? 'rgba(232, 177, 90, 0.24)' : 'rgba(245, 195, 28, 0.3)',
      },
      danger: {
        background: dark ? 'rgba(240, 113, 95, 0.14)' : 'rgba(224, 90, 90, 0.12)',
        foreground: dark ? '#f0715f' : '#d84a4a',
        border: dark ? 'rgba(240, 113, 95, 0.26)' : 'rgba(224, 90, 90, 0.22)',
      },
      info: {
        background: dark ? '#203d47' : '#d9edf2',
        foreground: dark ? '#85b8cc' : '#4d8394',
        border: dark ? 'rgba(133, 184, 204, 0.24)' : 'rgba(139, 189, 208, 0.3)',
      },
      neutral: {
        background: dark ? '#2b221a' : 'rgb(247, 243, 223)',
        foreground: dark ? '#c8b69f' : '#725d42',
        border: dark ? 'rgba(255, 238, 211, 0.1)' : 'rgba(114, 93, 66, 0.16)',
      },
      ink: {
        background: dark ? '#fff2dd' : '#794f27',
        foreground: dark ? '#17130f' : '#f8f8f0',
        border: dark ? 'rgba(255, 238, 211, 0.28)' : 'rgba(114, 93, 66, 0.24)',
      },
    },
    radius: {
      card: 20,
      titleCard: 36,
      panel: 30,
      modal: 38,
      field: 22,
      chip: 16,
      controlSmall: 12,
      controlMiddle: 999,
      controlLarge: 24,
    },
    control: {
      primaryBackground: dark ? '#e8b15a' : '#ffcc00',
      primaryForeground: dark ? '#17130f' : '#4f3517',
      dangerForeground: dark ? '#17130f' : '#ffffff',
      primaryBorder: dark ? 'rgba(232, 177, 90, 0.72)' : '#d99d00',
      defaultBackground: dark ? '#211a14' : '#f8f8f0',
      link: dark ? '#7cc9a8' : '#138f83',
      focus: '#ffcc00',
      shadow: dark ? '#050302' : '#bdaea0',
      dangerShadow: '#c94444',
      primaryShadowOpacity: dark ? 0.7 : 1,
      primaryShadowRadius: 0,
      primaryShadowOffset: 5,
      secondaryShadowOpacity: dark ? 0.28 : 0.18,
      secondaryShadowRadius: 10,
      secondaryShadowOffset: 3,
    },
    input: {
      background: dark ? '#2b221a' : 'rgb(247, 243, 223)',
      backgroundFocused: dark ? '#211a14' : '#f8f8f0',
      disabledBackground: dark ? '#382c21' : '#f0ece2',
      border: dark ? 'rgba(255, 238, 211, 0.16)' : '#c4b89e',
      focus: '#ffcc00',
      shadow: dark ? '#100d0a' : '#d4c9b4',
      shadowOpacity: dark ? 0.42 : 1,
      shadowRadius: 0,
    },
    switch: {
      trackOn: '#86d67a',
      trackOff: '#d4c9b4',
      trackOnBorder: '#6fba2c',
      trackOffBorder: '#c4b89e',
      thumb: dark ? '#fff2dd' : 'rgb(247, 243, 223)',
      thumbOnBorder: '#6fba2c',
      thumbOffBorder: dark ? '#8f7c66' : '#bdaea0',
      shadowOpacity: 0,
    },
    card: {
      defaultBackground: dark ? '#211a14' : 'rgb(247, 243, 223)',
      mutedBackground: dark ? '#382c21' : '#faf8f2',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: 0,
    },
    composer: {
      shellBackground: dark ? '#211a14' : '#fffdf5',
      shellFocusedBackground: dark ? '#241d17' : '#f8f8f0',
      toolbarBackground: dark ? 'rgba(255, 238, 211, 0.06)' : 'rgba(114, 93, 66, 0.06)',
      toolbarBorder: dark ? 'rgba(255, 238, 211, 0.1)' : 'rgba(114, 93, 66, 0.12)',
      statusBackground: dark ? 'rgba(255, 238, 211, 0.08)' : 'rgba(114, 93, 66, 0.08)',
      statusForeground: dark ? '#c8b69f' : '#725d42',
    },
    actionBar: {
      background: dark ? 'rgba(33, 26, 20, 0.94)' : 'rgba(255, 253, 245, 0.96)',
      border: dark ? 'rgba(255, 238, 211, 0.12)' : 'rgba(114, 93, 66, 0.16)',
      itemBackground: dark ? '#2b221a' : '#f8f8f0',
      itemBorder: dark ? 'rgba(255, 238, 211, 0.12)' : 'rgba(114, 93, 66, 0.14)',
      itemActiveBackground: dark ? '#382c21' : '#fff1c5',
    },
    message: {
      userBackground: dark ? '#fff2dd' : '#794f27',
      userForeground: dark ? '#17130f' : '#f8f8f0',
      userBorder: dark ? 'rgba(255, 238, 211, 0.28)' : 'rgba(114, 93, 66, 0.18)',
      userActionBackground: dark ? 'rgba(23, 19, 15, 0.08)' : 'rgba(255, 255, 255, 0.18)',
      userActionForeground: dark ? '#17130f' : '#f8f8f0',
    },
    code: {
      background: '#2b2118',
      border: '#3d3028',
      text: '#e8d5bc',
    },
    table: {
      headerBackground: dark ? '#214438' : '#e6f9f6',
    },
    loading: {
      background: dark ? '#214438' : '#e6f9f6',
      border: dark ? '#7cc9a8' : '#138f83',
      dot: dark ? '#7cc9a8' : '#138f83',
    },
    time: {
      border: dark ? '#4c3920' : '#d4cfc3',
      divider: 'rgba(159, 146, 125, 0.35)',
    },
    footer: {
      sea: ['#327a93', '#98d2e3', '#008077'],
      tree: ['#8ac68a', '#6fba2c', '#d1da49'],
    },
  }
}

function minimalUi(mode: ResolvedThemeMode): ThemeUiTokens {
  const dark = mode === 'dark'
  return {
    minimal: true,
    ornamented: false,
    ambient: 'plain',
    section: {
      marker: dark ? '#d7f0e8' : '#234f46',
      title: dark ? '#e8ecee' : '#191b1d',
      divider: dark ? 'rgba(232, 236, 238, 0.12)' : 'rgba(25, 27, 29, 0.12)',
    },
    icon: {
      accentBackground: dark ? '#d7f0e8' : '#dcebe6',
      accentForeground: dark ? '#0b0d0e' : '#173a34',
    },
    tone: {
      success: {
        background: dark ? '#17322d' : '#e5f2ee',
        foreground: dark ? '#81c59b' : '#3f7c5f',
        border: dark ? 'rgba(129, 197, 155, 0.24)' : 'rgba(63, 124, 95, 0.22)',
      },
      warning: {
        background: dark ? '#352819' : '#f4ead8',
        foreground: dark ? '#d0a15a' : '#a66a1f',
        border: dark ? 'rgba(208, 161, 90, 0.24)' : 'rgba(166, 106, 31, 0.22)',
      },
      danger: {
        background: dark ? 'rgba(224, 122, 115, 0.14)' : 'rgba(181, 69, 63, 0.1)',
        foreground: dark ? '#e07a73' : '#b5453f',
        border: dark ? 'rgba(224, 122, 115, 0.24)' : 'rgba(181, 69, 63, 0.2)',
      },
      info: {
        background: dark ? '#1a2630' : '#e8eef8',
        foreground: dark ? '#88949b' : '#64748b',
        border: dark ? 'rgba(136, 148, 155, 0.24)' : 'rgba(100, 116, 139, 0.18)',
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
      card: 14,
      titleCard: 16,
      panel: 18,
      modal: 22,
      field: 12,
      chip: 999,
      controlSmall: 8,
      controlMiddle: 10,
      controlLarge: 12,
    },
    control: {
      primaryBackground: dark ? '#d7f0e8' : '#234f46',
      primaryForeground: dark ? '#0b0d0e' : '#ffffff',
      dangerForeground: dark ? '#0b0d0e' : '#ffffff',
      primaryBorder: dark ? 'rgba(215, 240, 232, 0.58)' : 'rgba(35, 79, 70, 0.34)',
      defaultBackground: dark ? '#141719' : '#ffffff',
      link: dark ? '#9fd8ca' : '#2f6259',
      focus: dark ? '#9fd8ca' : '#2f6259',
      shadow: dark ? '#000000' : '#0f172a',
      dangerShadow: dark ? '#000000' : '#7f1d1d',
      primaryShadowOpacity: dark ? 0.16 : 0.1,
      primaryShadowRadius: 12,
      primaryShadowOffset: 2,
      secondaryShadowOpacity: dark ? 0.12 : 0.06,
      secondaryShadowRadius: 10,
      secondaryShadowOffset: 1,
    },
    input: {
      background: dark ? '#141719' : '#ffffff',
      backgroundFocused: dark ? '#171b1d' : '#ffffff',
      disabledBackground: dark ? '#1b2023' : '#eeede8',
      border: dark ? 'rgba(232, 236, 238, 0.14)' : 'rgba(25, 27, 29, 0.13)',
      focus: dark ? '#9fd8ca' : '#2f6259',
      shadow: dark ? '#000000' : '#0f172a',
      shadowOpacity: dark ? 0.12 : 0.05,
      shadowRadius: 8,
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
      shadowOpacity: dark ? 0.08 : 0.04,
      shadowRadius: 10,
      shadowOffset: 2,
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
      border: dark ? 'rgba(232, 236, 238, 0.12)' : 'rgba(25, 27, 29, 0.12)',
      itemBackground: dark ? '#1b2023' : '#ffffff',
      itemBorder: dark ? 'rgba(232, 236, 238, 0.1)' : 'rgba(25, 27, 29, 0.1)',
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

function islandBackground(mode: ResolvedThemeMode): ThemeBackgroundTokens {
  const dark = mode === 'dark'
  return {
    defaultMode: 'ambient',
    canvas: dark ? '#17130f' : '#f8f8f0',
    focusCanvas: dark ? '#15110d' : '#f7f4e8',
    surfaceCanvas: dark ? '#181410' : '#faf7ed',
    mist: {
      primary: dark ? '#214438' : '#e6f9f6',
      secondary: dark ? '#203d47' : '#d9edf2',
      warm: dark ? '#4c3920' : '#fff1c5',
      coolOpacity: dark ? 0.28 : 0.46,
      warmOpacity: dark ? 0.2 : 0.34,
      focusOpacity: dark ? 0.16 : 0.22,
      surfaceOpacity: dark ? 0.12 : 0.16,
    },
    trace: {
      primary: dark ? '#7cc9a8' : '#19c8b9',
      secondary: dark ? '#85b8cc' : '#8bbdd0',
      accent: dark ? '#e8b15a' : '#ffcc00',
      opacity: dark ? 0.28 : 0.2,
      focusOpacity: dark ? 0.18 : 0.14,
      surfaceOpacity: dark ? 0.12 : 0.1,
    },
    grid: dark ? 'rgba(255, 238, 211, 0.08)' : 'rgba(114, 93, 66, 0.1)',
    scrim: dark ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 253, 245, 0.18)',
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

const islandLight: AppPalette = {
  surface: '#f8f8f0',
  surfaceSecondary: 'rgb(247, 243, 223)',
  surfaceTertiary: '#eadcc4',
  primary: '#19c8b9',
  primaryForeground: '#ffffff',
  secondary: '#8bbdd0',
  accent: '#ffcc00',
  border: 'rgba(114, 93, 66, 0.16)',
  borderStrong: 'rgba(114, 93, 66, 0.28)',
  text: '#794f27',
  textSecondary: '#725d42',
  textTertiary: '#94856d',
  success: '#6fba2c',
  warning: '#f5c31c',
  error: '#e05a5a',
  backdrop: 'rgba(40, 30, 20, 0.45)',
  island: '#fffdf5',
  islandRaised: 'rgb(247, 243, 223)',
  islandMuted: '#efe0c7',
  glass: 'rgba(255, 253, 245, 0.78)',
  mintSoft: '#e6f9f6',
  amberSoft: '#fff1c5',
  skySoft: '#d9edf2',
  shadowTint: '#bdaea0',
  paper: '#f8f8f0',
  paperDeep: '#f1dfc2',
  paperWarm: '#fff1d0',
  creamInk: '#725d42',
  mint: '#19c8b9',
  mintPressed: '#11a89b',
  mintWash: '#e6f9f6',
  amber: '#ffcc00',
  amberPressed: '#e0b800',
  amberWash: '#fff1c5',
  coral: '#e05a5a',
  coralWash: 'rgba(224, 90, 90, 0.12)',
  sky: '#8bbdd0',
  skyWash: '#d9edf2',
  overlay: 'rgba(40, 30, 20, 0.45)',
  scrim: 'rgba(58, 48, 36, 0.18)',
  pressed: 'rgba(114, 93, 66, 0.08)',
  disabled: 'rgba(159, 146, 125, 0.46)',
  highlight: 'rgba(255, 255, 255, 0.72)',
  background: islandBackground('light'),
  material: {
    canvas: '#f8f8f0',
    paper: '#fffdf5',
    paperRaised: 'rgb(247, 243, 223)',
    paperPressed: '#efe0c7',
    glass: 'rgba(255, 253, 245, 0.78)',
    chrome: 'rgba(255, 253, 245, 0.86)',
    field: 'rgb(247, 243, 223)',
    stroke: 'rgba(114, 93, 66, 0.16)',
    strokeStrong: 'rgba(114, 93, 66, 0.28)',
    sheet: {
      surface: '#fffdf5',
      chrome: 'rgba(255, 253, 245, 0.92)',
      body: '#fffdf5',
      border: 'rgba(114, 93, 66, 0.28)',
      divider: 'rgba(114, 93, 66, 0.16)',
    },
  },
  status: {
    info: '#8bbdd0',
    success: '#6fba2c',
    warning: '#f5c31c',
    danger: '#e05a5a',
    idle: '#9f927d',
  },
  shadow: {
    color: '#bdaea0',
    softOpacity: 0.1,
    mediumOpacity: 0.15,
    strongOpacity: 0.2,
  },
  cardColors: islandCards,
  ui: islandUi('light'),
}

const islandDark: AppPalette = {
  surface: '#17130f',
  surfaceSecondary: '#241d17',
  surfaceTertiary: '#31271e',
  primary: '#7cc9a8',
  primaryForeground: '#ffffff',
  secondary: '#85b8cc',
  accent: '#e8b15a',
  border: 'rgba(255, 238, 211, 0.1)',
  borderStrong: 'rgba(255, 238, 211, 0.22)',
  text: '#fff2dd',
  textSecondary: '#c8b69f',
  textTertiary: '#8f7c66',
  success: '#7cc9a8',
  warning: '#e8b15a',
  error: '#f0715f',
  backdrop: 'rgba(0, 0, 0, 0.62)',
  island: '#211a14',
  islandRaised: '#2b221a',
  islandMuted: '#382c21',
  glass: 'rgba(33, 26, 20, 0.8)',
  mintSoft: '#214438',
  amberSoft: '#4c3920',
  skySoft: '#203d47',
  shadowTint: '#050302',
  paper: '#17130f',
  paperDeep: '#100d0a',
  paperWarm: '#241d17',
  creamInk: '#fff2dd',
  mint: '#7cc9a8',
  mintPressed: '#4f9879',
  mintWash: '#214438',
  amber: '#e8b15a',
  amberPressed: '#b87d2d',
  amberWash: '#4c3920',
  coral: '#f0715f',
  coralWash: 'rgba(240, 113, 95, 0.14)',
  sky: '#85b8cc',
  skyWash: '#203d47',
  overlay: 'rgba(0, 0, 0, 0.62)',
  scrim: 'rgba(0, 0, 0, 0.34)',
  pressed: 'rgba(255, 238, 211, 0.08)',
  disabled: 'rgba(200, 182, 159, 0.38)',
  highlight: 'rgba(255, 242, 221, 0.08)',
  background: islandBackground('dark'),
  material: {
    canvas: '#17130f',
    paper: '#211a14',
    paperRaised: '#2b221a',
    paperPressed: '#382c21',
    glass: 'rgba(33, 26, 20, 0.8)',
    chrome: 'rgba(33, 26, 20, 0.88)',
    field: '#2b221a',
    stroke: 'rgba(255, 238, 211, 0.1)',
    strokeStrong: 'rgba(255, 238, 211, 0.22)',
    sheet: {
      surface: '#211a14',
      chrome: 'rgba(33, 26, 20, 0.94)',
      body: '#211a14',
      border: 'rgba(255, 238, 211, 0.22)',
      divider: 'rgba(255, 238, 211, 0.1)',
    },
  },
  status: {
    info: '#85b8cc',
    success: '#7cc9a8',
    warning: '#e8b15a',
    danger: '#f0715f',
    idle: '#8f7c66',
  },
  shadow: {
    color: '#050302',
    softOpacity: 0.24,
    mediumOpacity: 0.34,
    strongOpacity: 0.44,
  },
  cardColors: islandCards,
  ui: islandUi('dark'),
}

const minimalLight: AppPalette = {
  surface: '#f7f7f2',
  surfaceSecondary: '#ffffff',
  surfaceTertiary: '#eceae3',
  primary: '#234f46',
  primaryForeground: '#ffffff',
  secondary: '#64748b',
  accent: '#b7791f',
  border: 'rgba(25, 27, 29, 0.1)',
  borderStrong: 'rgba(25, 27, 29, 0.18)',
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
  border: 'rgba(232, 236, 238, 0.1)',
  borderStrong: 'rgba(232, 236, 238, 0.18)',
  text: '#edf0f2',
  textSecondary: '#b3bbc0',
  textTertiary: '#747f86',
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

export const DEFAULT_THEME_ID: ThemeId = 'island'
export const themeIds = ['island', 'minimal'] as const satisfies readonly ThemeId[]

export const themePalettes: Record<ThemeId, Record<ResolvedThemeMode, AppPalette>> = {
  island: {
    light: islandLight,
    dark: islandDark,
  },
  minimal: {
    light: minimalLight,
    dark: minimalDark,
  },
}

// Backward-compatible alias for older code that imported colors.light/colors.dark.
export const colors = themePalettes.island

export function isThemeId(value: unknown): value is ThemeId {
  return value === 'island' || value === 'minimal'
}

export function normalizeThemeId(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME_ID
}

export function resolveThemeMode(theme: ThemeMode, systemScheme?: 'light' | 'dark' | null): ResolvedThemeMode {
  return theme === 'system' ? systemScheme ?? 'light' : theme
}

export function getColors(theme: ThemeMode | ResolvedThemeMode, themeId: ThemeId = DEFAULT_THEME_ID, systemScheme?: 'light' | 'dark' | null) {
  const resolvedMode = resolveThemeMode(theme as ThemeMode, systemScheme)
  return themePalettes[normalizeThemeId(themeId)][resolvedMode]
}
