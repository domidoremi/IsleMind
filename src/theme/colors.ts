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
  family: ThemeId
  minimal: boolean
  glass: boolean
  cartoon: boolean
  ornamented: boolean
  ambient: 'cartoon' | 'glass' | 'plain'
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

// Animal Island UI inspired color palette with enhanced contrast
const islandCards: CardColorMap = {
  default: { bg: 'rgb(247, 243, 223)', fg: '#725d42' },
  'app-pink': { bg: '#f8a6b2', fg: '#5a2832' },  // Darker text for better contrast
  purple: { bg: '#b77dee', fg: '#2d1a4f' },      // Darker text for better contrast
  'app-blue': { bg: '#889df0', fg: '#1e2d5a' },  // Darker text for better contrast
  'app-yellow': { bg: '#f7cd67', fg: '#5a4a1e' }, // Slightly darker for contrast
  'app-orange': { bg: '#e59266', fg: '#4a2f1e' }, // Darker text for better contrast
  'app-teal': { bg: '#82d5bb', fg: '#1a4a3d' },   // Darker text for better contrast
  'app-green': { bg: '#8ac68a', fg: '#2a4a2a' },  // Darker text for better contrast
  'app-red': { bg: '#fc736d', fg: '#4a1e1c' },    // Darker text for better contrast
  'lime-green': { bg: '#d1da49', fg: '#3d5a1a' },
  'yellow-green': { bg: '#ecdf52', fg: '#5a5219' }, // Slightly darker
  brown: { bg: '#9a835a', fg: '#2d2419' },        // Darker text for better contrast
  'warm-peach-pink': { bg: '#e18c6f', fg: '#4a2d1e' }, // Darker text for better contrast
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
  if (family === 'cartoon') {
    return {
      surface: {
        canvas: dark ? '#17130f' : '#f8f8f0',
        base: dark ? '#211a14' : '#fffdf5',
        raised: dark ? '#2b221a' : 'rgb(247, 243, 223)',
        muted: dark ? '#382c21' : '#efe0c7',
        overlay: dark ? 'rgba(33, 26, 20, 0.88)' : 'rgba(255, 253, 245, 0.86)',
      },
      content: {
        primary: dark ? '#fff2dd' : '#5a3819',
        secondary: dark ? '#c8b69f' : '#5a4a32',
        tertiary: dark ? '#8f7c66' : '#7a6b5a',
        inverse: dark ? '#17130f' : '#ffffff',
      },
      chrome: {
        background: dark ? 'rgba(33, 26, 20, 0.94)' : 'rgba(255, 253, 245, 0.92)',
        border: dark ? 'rgba(255, 238, 211, 0.16)' : 'rgba(114, 93, 66, 0.18)',
        toolbar: dark ? 'rgba(255, 238, 211, 0.045)' : 'rgba(114, 93, 66, 0.045)',
        sheet: dark ? '#211a14' : '#fffdf5',
      },
      control: {
        background: dark ? '#e8b15a' : '#ffcc00',
        foreground: dark ? '#17130f' : '#3d2710',
        border: dark ? 'rgba(232, 177, 90, 0.72)' : '#d99d00',
        focus: '#ffcc00',
      },
      feedback: {
        success: { background: dark ? '#214438' : '#e6f9f6', foreground: dark ? '#7cc9a8' : '#138f83', border: dark ? 'rgba(124, 201, 168, 0.24)' : 'rgba(12, 111, 102, 0.24)' },
        warning: { background: dark ? '#4c3920' : '#fff1c5', foreground: dark ? '#e8b15a' : '#7a5200', border: dark ? 'rgba(232, 177, 90, 0.24)' : 'rgba(122, 82, 0, 0.32)' },
        danger: { background: dark ? 'rgba(248, 143, 130, 0.14)' : 'rgba(173, 45, 45, 0.12)', foreground: dark ? '#f88f82' : '#ad2d2d', border: dark ? 'rgba(248, 143, 130, 0.24)' : 'rgba(173, 45, 45, 0.28)' },
        info: { background: dark ? '#203d47' : '#d9edf2', foreground: dark ? '#85b8cc' : '#3a6d7d', border: dark ? 'rgba(133, 184, 204, 0.24)' : 'rgba(58, 109, 125, 0.32)' },
      },
    }
  }
  if (family === 'glass') {
    return {
      surface: {
        canvas: dark ? '#0b1013' : '#f3f8fb',
        base: dark ? 'rgba(16, 20, 23, 0.76)' : 'rgba(255, 255, 255, 0.84)',
        raised: dark ? 'rgba(24, 29, 33, 0.76)' : 'rgba(255, 255, 255, 0.92)',
        muted: dark ? 'rgba(36, 44, 49, 0.76)' : 'rgba(243, 246, 248, 0.86)',
        overlay: dark ? 'rgba(12, 15, 18, 0.72)' : 'rgba(255, 255, 255, 0.86)',
      },
      content: {
        primary: dark ? '#f2fbff' : '#173240',
        secondary: dark ? '#c8d0d5' : '#5b6970',
        tertiary: dark ? '#8998a1' : '#7d8d96',
        inverse: dark ? '#091115' : '#f7fbfd',
      },
      chrome: {
        background: dark ? 'rgba(16, 20, 23, 0.76)' : 'rgba(255, 255, 255, 0.84)',
        border: dark ? 'rgba(232, 242, 247, 0.12)' : 'rgba(23, 50, 64, 0.1)',
        toolbar: dark ? 'rgba(232, 242, 247, 0.05)' : 'rgba(23, 50, 64, 0.05)',
        sheet: dark ? 'rgba(12, 15, 18, 0.72)' : 'rgba(255, 255, 255, 0.86)',
      },
      control: {
        background: dark ? 'rgba(232, 242, 247, 0.78)' : 'rgba(23, 50, 64, 0.9)',
        foreground: dark ? '#091115' : '#f7fbfd',
        border: dark ? 'rgba(232, 242, 247, 0.28)' : 'rgba(23, 50, 64, 0.2)',
        focus: dark ? '#dff5ff' : '#2e6580',
      },
      feedback: {
        success: { background: dark ? 'rgba(36, 87, 76, 0.22)' : 'rgba(213, 241, 234, 0.72)', foreground: dark ? '#9ad9c6' : '#2f6e5f', border: dark ? 'rgba(154, 217, 198, 0.22)' : 'rgba(47, 110, 95, 0.16)' },
        warning: { background: dark ? 'rgba(96, 71, 34, 0.22)' : 'rgba(249, 237, 208, 0.74)', foreground: dark ? '#ebc47c' : '#855713', border: dark ? 'rgba(235, 196, 124, 0.2)' : 'rgba(133, 87, 19, 0.16)' },
        danger: { background: dark ? 'rgba(128, 69, 61, 0.2)' : 'rgba(247, 224, 221, 0.72)', foreground: dark ? '#f3a79e' : '#a63d38', border: dark ? 'rgba(243, 167, 158, 0.2)' : 'rgba(166, 61, 56, 0.16)' },
        info: { background: dark ? 'rgba(46, 75, 96, 0.22)' : 'rgba(225, 236, 244, 0.72)', foreground: dark ? '#9cc3d8' : '#3f5f71', border: dark ? 'rgba(156, 195, 216, 0.2)' : 'rgba(63, 95, 113, 0.16)' },
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

function islandUi(mode: ResolvedThemeMode): ThemeUiTokens {
  const dark = mode === 'dark'
  return {
    family: 'cartoon',
    minimal: false,
    glass: false,
    cartoon: true,
    ornamented: true,
    ambient: 'cartoon',
    semantic: semanticUi('cartoon', mode),
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
        foreground: dark ? '#7cc9a8' : '#0c6f66', // Enhanced contrast (was #138f83)
        border: dark ? 'rgba(124, 201, 168, 0.28)' : 'rgba(12, 111, 102, 0.24)', // Stronger border
      },
      warning: {
        background: dark ? '#4c3920' : '#fff1c5',
        foreground: dark ? '#e8b15a' : '#7a5200', // Enhanced contrast (was #8f6500)
        border: dark ? 'rgba(232, 177, 90, 0.28)' : 'rgba(122, 82, 0, 0.32)', // Stronger border
      },
      danger: {
        background: dark ? 'rgba(240, 113, 95, 0.14)' : 'rgba(224, 90, 90, 0.12)',
        foreground: dark ? '#f88f82' : '#ad2d2d', // Enhanced contrast (was #d84a4a)
        border: dark ? 'rgba(248, 143, 130, 0.3)' : 'rgba(173, 45, 45, 0.28)', // Stronger border
      },
      info: {
        background: dark ? '#203d47' : '#d9edf2',
        foreground: dark ? '#85b8cc' : '#3a6d7d', // Enhanced contrast (was #4d8394)
        border: dark ? 'rgba(133, 184, 204, 0.28)' : 'rgba(58, 109, 125, 0.32)', // Stronger border
      },
      neutral: {
        background: dark ? '#2b221a' : 'rgb(247, 243, 223)',
        foreground: dark ? '#c8b69f' : '#5a4a32', // Enhanced contrast (was #725d42)
        border: dark ? 'rgba(255, 238, 211, 0.12)' : 'rgba(90, 74, 50, 0.2)', // Stronger border
      },
      ink: {
        background: dark ? '#fff2dd' : '#5a3819', // Enhanced contrast (was #794f27)
        foreground: dark ? '#17130f' : '#f8f8f0',
        border: dark ? 'rgba(255, 238, 211, 0.32)' : 'rgba(90, 56, 25, 0.28)', // Stronger border
      },
    },
    radius: {
      card: 20,
      titleCard: 36,
      panel: 30,
      modal: 38,
      field: 22,
      chip: 999, // Full pill shape for chips (animal-island-ui style)
      controlSmall: 12,
      controlMiddle: 999, // Full pill shape for buttons (animal-island-ui style)
      controlLarge: 24,
    },
    control: {
      primaryBackground: dark ? '#e8b15a' : '#ffcc00',
      primaryForeground: dark ? '#17130f' : '#3d2710', // Enhanced contrast (was #4f3517)
      dangerForeground: dark ? '#17130f' : '#ffffff',
      primaryBorder: dark ? 'rgba(232, 177, 90, 0.72)' : '#d99d00',
      defaultBackground: dark ? '#211a14' : '#f8f8f0',
      disabledBackground: dark ? '#382c21' : '#f0ece2',
      disabledForeground: dark ? '#d4c3af' : '#5a4a32',
      disabledBorder: dark ? 'rgba(255, 238, 211, 0.12)' : 'rgba(114, 93, 66, 0.14)',
      disabledOpacity: 1,
      link: dark ? '#7cc9a8' : '#0c6f66', // Enhanced contrast (was #138f83)
      focus: '#ffcc00',
      shadow: dark ? '#050302' : '#bdaea0',
      dangerShadow: '#c94444',
      primaryShadowOpacity: dark ? 0.12 : 0.08,
      primaryShadowRadius: 0,
      primaryShadowOffset: 1,
      secondaryShadowOpacity: dark ? 0.04 : 0.025,
      secondaryShadowRadius: 3,
      secondaryShadowOffset: 1,
    },
    input: {
      background: dark ? '#2b221a' : 'rgb(247, 243, 223)',
      backgroundFocused: dark ? '#211a14' : '#f8f8f0',
      disabledBackground: dark ? '#382c21' : '#f0ece2',
      disabledForeground: dark ? '#d4c3af' : '#5a4a32',
      placeholderForeground: dark ? '#a89580' : '#7a6b5a',
      border: dark ? 'rgba(255, 238, 211, 0.16)' : '#c4b89e',
      focus: '#ffcc00',
      shadow: dark ? '#100d0a' : '#d4c9b4',
      shadowOpacity: dark ? 0.06 : 0.04,
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
      userBackground: dark ? '#fff2dd' : '#73481f',
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
    family: 'minimal',
    minimal: true,
    glass: false,
    cartoon: false,
    ornamented: false,
    ambient: 'plain',
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

function glassUi(mode: ResolvedThemeMode): ThemeUiTokens {
  const dark = mode === 'dark'
  return {
    family: 'glass',
    minimal: true,
    glass: true,
    cartoon: false,
    ornamented: false,
    ambient: 'glass',
    semantic: semanticUi('glass', mode),
    section: {
      marker: dark ? '#b8e3ff' : '#2e6580',
      title: dark ? '#f2fbff' : '#173240',
      divider: dark ? 'rgba(240, 250, 255, 0.12)' : 'rgba(23, 50, 64, 0.12)',
    },
    icon: {
      accentBackground: dark ? 'rgba(92, 141, 169, 0.18)' : 'rgba(184, 227, 255, 0.42)',
      accentForeground: dark ? '#dff5ff' : '#1b556f',
    },
    tone: {
      success: {
        background: dark ? 'rgba(36, 87, 76, 0.22)' : 'rgba(213, 241, 234, 0.72)',
        foreground: dark ? '#9ad9c6' : '#2f6e5f',
        border: dark ? 'rgba(154, 217, 198, 0.22)' : 'rgba(47, 110, 95, 0.16)',
      },
      warning: {
        background: dark ? 'rgba(96, 71, 34, 0.22)' : 'rgba(249, 237, 208, 0.74)',
        foreground: dark ? '#ebc47c' : '#855713',
        border: dark ? 'rgba(235, 196, 124, 0.2)' : 'rgba(133, 87, 19, 0.16)',
      },
      danger: {
        background: dark ? 'rgba(128, 69, 61, 0.2)' : 'rgba(247, 224, 221, 0.72)',
        foreground: dark ? '#f3a79e' : '#a63d38',
        border: dark ? 'rgba(243, 167, 158, 0.2)' : 'rgba(166, 61, 56, 0.16)',
      },
      info: {
        background: dark ? 'rgba(46, 75, 96, 0.22)' : 'rgba(225, 236, 244, 0.72)',
        foreground: dark ? '#9cc3d8' : '#3f5f71',
        border: dark ? 'rgba(156, 195, 216, 0.2)' : 'rgba(63, 95, 113, 0.16)',
      },
      neutral: {
        background: dark ? 'rgba(21, 26, 29, 0.72)' : 'rgba(255, 255, 255, 0.84)',
        foreground: dark ? '#c8d0d5' : '#5b6970',
        border: dark ? 'rgba(232, 241, 246, 0.1)' : 'rgba(23, 50, 64, 0.1)',
      },
      ink: {
        background: dark ? 'rgba(232, 242, 247, 0.84)' : 'rgba(23, 50, 64, 0.92)',
        foreground: dark ? '#091115' : '#f7fbfd',
        border: dark ? 'rgba(232, 242, 247, 0.28)' : 'rgba(23, 50, 64, 0.22)',
      },
    },
    radius: {
      card: 18,
      titleCard: 22,
      panel: 24,
      modal: 28,
      field: 18,
      chip: 999,
      controlSmall: 10,
      controlMiddle: 18,
      controlLarge: 20,
    },
    control: {
      primaryBackground: dark ? 'rgba(232, 242, 247, 0.78)' : 'rgba(23, 50, 64, 0.9)',
      primaryForeground: dark ? '#091115' : '#f7fbfd',
      dangerForeground: dark ? '#091115' : '#ffffff',
      primaryBorder: dark ? 'rgba(232, 242, 247, 0.28)' : 'rgba(23, 50, 64, 0.2)',
      defaultBackground: dark ? 'rgba(24, 30, 35, 0.72)' : 'rgba(255, 255, 255, 0.66)',
      disabledBackground: dark ? 'rgba(20, 25, 29, 0.46)' : 'rgba(246, 248, 250, 0.66)',
      disabledForeground: dark ? '#c8d0d5' : '#566872',
      disabledBorder: dark ? 'rgba(232, 242, 247, 0.1)' : 'rgba(23, 50, 64, 0.08)',
      disabledOpacity: 1,
      link: dark ? '#b8e3ff' : '#1b556f',
      focus: dark ? '#dff5ff' : '#2e6580',
      shadow: '#000000',
      dangerShadow: '#000000',
      primaryShadowOpacity: 0.03,
      primaryShadowRadius: 8,
      primaryShadowOffset: 1,
      secondaryShadowOpacity: 0,
      secondaryShadowRadius: 0,
      secondaryShadowOffset: 0,
    },
    input: {
      background: dark ? 'rgba(15, 19, 22, 0.62)' : 'rgba(255, 255, 255, 0.58)',
      backgroundFocused: dark ? 'rgba(18, 23, 27, 0.72)' : 'rgba(255, 255, 255, 0.76)',
      disabledBackground: dark ? 'rgba(20, 25, 29, 0.46)' : 'rgba(246, 248, 250, 0.66)',
      disabledForeground: dark ? '#c8d0d5' : '#566872',
      placeholderForeground: dark ? '#98a6b0' : '#72848d',
      border: dark ? 'rgba(232, 242, 247, 0.16)' : 'rgba(23, 50, 64, 0.12)',
      focus: dark ? '#b8e3ff' : '#2e6580',
      shadow: '#000000',
      shadowOpacity: 0.02,
      shadowRadius: 6,
    },
    switch: {
      trackOn: dark ? 'rgba(184, 227, 255, 0.82)' : 'rgba(23, 50, 64, 0.82)',
      trackOff: dark ? 'rgba(48, 58, 66, 0.88)' : 'rgba(226, 232, 237, 0.9)',
      trackOnBorder: dark ? 'rgba(184, 227, 255, 0.24)' : 'rgba(23, 50, 64, 0.16)',
      trackOffBorder: dark ? 'rgba(232, 242, 247, 0.1)' : 'rgba(23, 50, 64, 0.08)',
      thumb: dark ? '#f4fbff' : '#ffffff',
      thumbOnBorder: dark ? 'rgba(244, 251, 255, 0.34)' : 'rgba(23, 50, 64, 0.18)',
      thumbOffBorder: dark ? 'rgba(132, 151, 163, 0.42)' : 'rgba(119, 135, 145, 0.28)',
      shadowOpacity: 0,
    },
    card: {
      defaultBackground: dark ? 'rgba(16, 20, 23, 0.68)' : 'rgba(255, 255, 255, 0.8)',
      mutedBackground: dark ? 'rgba(24, 29, 33, 0.62)' : 'rgba(248, 250, 252, 0.78)',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: 0,
    },
    composer: {
      shellBackground: dark ? 'rgba(16, 20, 23, 0.74)' : 'rgba(255, 255, 255, 0.82)',
      shellFocusedBackground: dark ? 'rgba(18, 23, 27, 0.82)' : 'rgba(255, 255, 255, 0.9)',
      toolbarBackground: dark ? 'rgba(232, 242, 247, 0.05)' : 'rgba(23, 50, 64, 0.04)',
      toolbarBorder: dark ? 'rgba(232, 242, 247, 0.1)' : 'rgba(23, 50, 64, 0.08)',
      statusBackground: dark ? 'rgba(232, 242, 247, 0.06)' : 'rgba(23, 50, 64, 0.05)',
      statusForeground: dark ? '#c8d0d5' : '#5b6970',
    },
    actionBar: {
      background: dark ? 'rgba(12, 15, 18, 0.78)' : 'rgba(255, 255, 255, 0.82)',
      border: dark ? 'rgba(232, 242, 247, 0.1)' : 'rgba(23, 50, 64, 0.08)',
      itemBackground: dark ? 'rgba(24, 29, 33, 0.62)' : 'rgba(255, 255, 255, 0.56)',
      itemBorder: dark ? 'rgba(232, 242, 247, 0.1)' : 'rgba(23, 50, 64, 0.08)',
      itemActiveBackground: dark ? 'rgba(232, 242, 247, 0.12)' : 'rgba(225, 236, 244, 0.78)',
    },
    message: {
      userBackground: dark ? 'rgba(232, 242, 247, 0.82)' : 'rgba(23, 50, 64, 0.9)',
      userForeground: dark ? '#091115' : '#f7fbfd',
      userBorder: dark ? 'rgba(232, 242, 247, 0.22)' : 'rgba(23, 50, 64, 0.16)',
      userActionBackground: dark ? 'rgba(9, 17, 21, 0.08)' : 'rgba(255, 255, 255, 0.16)',
      userActionForeground: dark ? '#091115' : '#f7fbfd',
    },
    code: {
      background: dark ? 'rgba(11, 16, 19, 0.82)' : 'rgba(242, 247, 250, 0.92)',
      border: dark ? 'rgba(232, 242, 247, 0.12)' : 'rgba(23, 50, 64, 0.12)',
      text: dark ? '#e8f1f5' : '#173240',
    },
    table: {
      headerBackground: dark ? 'rgba(36, 87, 76, 0.2)' : 'rgba(225, 236, 244, 0.86)',
    },
    loading: {
      background: dark ? 'rgba(24, 29, 33, 0.72)' : 'rgba(243, 246, 248, 0.84)',
      border: dark ? 'rgba(184, 227, 255, 0.2)' : 'rgba(23, 50, 64, 0.12)',
      dot: dark ? '#b8e3ff' : '#2e6580',
    },
    time: {
      border: dark ? 'rgba(232, 242, 247, 0.12)' : 'rgba(23, 50, 64, 0.1)',
      divider: dark ? 'rgba(232, 242, 247, 0.12)' : 'rgba(23, 50, 64, 0.12)',
    },
    footer: {
      sea: dark ? ['rgba(24, 72, 89, 0.9)', 'rgba(64, 112, 136, 0.9)', 'rgba(92, 141, 169, 0.9)'] : ['rgba(225, 236, 244, 0.92)', 'rgba(198, 225, 237, 0.92)', 'rgba(167, 214, 233, 0.92)'],
      tree: dark ? ['rgba(28, 48, 58, 0.9)', 'rgba(38, 63, 72, 0.9)', 'rgba(52, 78, 88, 0.9)'] : ['rgba(227, 237, 241, 0.92)', 'rgba(210, 225, 230, 0.92)', 'rgba(194, 213, 219, 0.92)'],
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
  border: 'rgba(114, 93, 66, 0.2)', // Stronger borders for better separation
  borderStrong: 'rgba(114, 93, 66, 0.35)', // Enhanced contrast
  text: '#5a3819', // Darker text for better readability (was #794f27)
  textSecondary: '#5a4a32', // Darker secondary text (was #725d42)
  textTertiary: '#7a6b5a', // Slightly darker tertiary (was #94856d)
  success: '#6fba2c',
  warning: '#f5c31c',
  error: '#c73a3a', // Darker for better contrast (was #e05a5a)
  backdrop: 'rgba(40, 30, 20, 0.55)', // Slightly darker backdrop
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
  creamInk: '#5a4a32', // Darker for better contrast
  mint: '#19c8b9',
  mintPressed: '#0c6f66', // Darker pressed state for better feedback
  mintWash: '#e6f9f6',
  amber: '#ffcc00',
  amberPressed: '#d99d00', // Darker pressed state
  amberWash: '#fff1c5',
  coral: '#c73a3a', // Darker for better contrast
  coralWash: 'rgba(199, 58, 58, 0.12)',
  sky: '#8bbdd0',
  skyWash: '#d9edf2',
  overlay: 'rgba(40, 30, 20, 0.55)',
  scrim: 'rgba(58, 48, 36, 0.22)', // Slightly stronger
  pressed: 'rgba(114, 93, 66, 0.12)', // More visible pressed state
  disabled: 'rgba(159, 146, 125, 0.5)', // Slightly stronger
  highlight: 'rgba(255, 255, 255, 0.78)',
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
  border: 'rgba(255, 238, 211, 0.14)', // Enhanced from 0.1 (+40%)
  borderStrong: 'rgba(255, 238, 211, 0.28)', // Enhanced from 0.22 (+27%)
  text: '#fff2dd',
  textSecondary: '#d4c3af', // Lighter for better contrast (was #c8b69f)
  textTertiary: '#a89580', // Lighter tertiary (was #8f7c66)
  success: '#7cc9a8',
  warning: '#e8b15a',
  error: '#f58070', // Lighter for better contrast (was #f0715f)
  backdrop: 'rgba(0, 0, 0, 0.68)', // Darker backdrop (+10%)
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
  mintPressed: '#5aae8c', // Lighter pressed state
  mintWash: '#214438',
  amber: '#e8b15a',
  amberPressed: '#d39d3f', // Lighter pressed state
  amberWash: '#4c3920',
  coral: '#f58070', // Enhanced contrast
  coralWash: 'rgba(245, 128, 112, 0.16)', // Slightly stronger
  sky: '#85b8cc',
  skyWash: '#203d47',
  overlay: 'rgba(0, 0, 0, 0.68)', // Darker overlay
  scrim: 'rgba(0, 0, 0, 0.42)', // Stronger scrim (+24%)
  pressed: 'rgba(255, 238, 211, 0.12)', // More visible (+50%)
  disabled: 'rgba(212, 195, 175, 0.42)', // Slightly stronger
  highlight: 'rgba(255, 242, 221, 0.12)', // More visible (+50%)
  background: islandBackground('dark'),
  material: {
    canvas: '#17130f',
    paper: '#211a14',
    paperRaised: '#2b221a',
    paperPressed: '#382c21',
    glass: 'rgba(33, 26, 20, 0.8)',
    chrome: 'rgba(33, 26, 20, 0.88)',
    field: '#2b221a',
    stroke: 'rgba(255, 238, 211, 0.14)', // Enhanced from 0.1
    strokeStrong: 'rgba(255, 238, 211, 0.28)', // Enhanced from 0.22
    sheet: {
      surface: '#211a14',
      chrome: 'rgba(33, 26, 20, 0.94)',
      body: '#211a14',
      border: 'rgba(255, 238, 211, 0.28)', // Enhanced from 0.22
      divider: 'rgba(255, 238, 211, 0.14)', // Enhanced from 0.1
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
    softOpacity: 0.28, // Enhanced from 0.24
    mediumOpacity: 0.38, // Enhanced from 0.34
    strongOpacity: 0.48, // Enhanced from 0.44
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

const glassLight: AppPalette = {
  ...minimalLight,
  primary: '#24495c',
  primaryForeground: '#ffffff',
  secondary: '#70838f',
  accent: '#5a91aa',
  border: 'rgba(23, 50, 64, 0.06)',
  borderStrong: 'rgba(23, 50, 64, 0.12)',
  text: '#173240',
  textSecondary: '#566872',
  textTertiary: '#7b8a92',
  success: '#2f6e5f',
  warning: '#9d6b1f',
  error: '#bb4d45',
  backdrop: 'rgba(9, 17, 21, 0.28)',
  island: 'rgba(255, 255, 255, 0.78)',
  islandRaised: 'rgba(255, 255, 255, 0.88)',
  islandMuted: 'rgba(247, 250, 252, 0.74)',
  glass: 'rgba(255, 255, 255, 0.74)',
  mintSoft: 'rgba(213, 241, 234, 0.78)',
  amberSoft: 'rgba(249, 237, 208, 0.78)',
  skySoft: 'rgba(225, 236, 244, 0.78)',
  shadowTint: '#0b1115',
  paper: 'rgba(255, 255, 255, 0.8)',
  paperDeep: 'rgba(239, 244, 247, 0.84)',
  paperWarm: 'rgba(255, 255, 255, 0.88)',
  creamInk: '#173240',
  mint: '#2f6e5f',
  mintPressed: '#24584c',
  mintWash: 'rgba(213, 241, 234, 0.78)',
  amber: '#9d6b1f',
  amberPressed: '#7f5516',
  amberWash: 'rgba(249, 237, 208, 0.78)',
  coral: '#bb4d45',
  coralWash: 'rgba(247, 224, 221, 0.72)',
  sky: '#4f7387',
  skyWash: 'rgba(225, 236, 244, 0.78)',
  overlay: 'rgba(9, 17, 21, 0.28)',
  scrim: 'rgba(255, 255, 255, 0.16)',
  pressed: 'rgba(23, 50, 64, 0.06)',
  disabled: 'rgba(83, 99, 107, 0.32)',
  highlight: 'rgba(255, 255, 255, 0.7)',
  background: {
    defaultMode: 'surface',
    canvas: '#f4f8fb',
    focusCanvas: '#eef5f9',
    surfaceCanvas: '#fbfdff',
    mist: {
      primary: 'rgba(213, 241, 234, 0.66)',
      secondary: 'rgba(225, 236, 244, 0.7)',
      warm: 'rgba(249, 237, 208, 0.62)',
      coolOpacity: 0.11,
      warmOpacity: 0.06,
      focusOpacity: 0.06,
      surfaceOpacity: 0.05,
    },
    trace: {
      primary: '#24495c',
      secondary: '#5a91aa',
      accent: '#8aa3b8',
      opacity: 0.06,
      focusOpacity: 0.05,
      surfaceOpacity: 0.04,
    },
    grid: 'rgba(23, 50, 64, 0.05)',
    scrim: 'rgba(9, 17, 21, 0.14)',
    motion: 'subtle',
  },
  material: {
    canvas: 'rgba(244, 248, 251, 0.94)',
    paper: 'rgba(255, 255, 255, 0.8)',
    paperRaised: 'rgba(255, 255, 255, 0.88)',
    paperPressed: 'rgba(239, 244, 247, 0.84)',
    glass: 'rgba(255, 255, 255, 0.84)',
    chrome: 'rgba(255, 255, 255, 0.9)',
    field: 'rgba(255, 255, 255, 0.5)',
    stroke: 'rgba(23, 50, 64, 0.08)',
    strokeStrong: 'rgba(23, 50, 64, 0.16)',
    sheet: {
      surface: 'rgba(255, 255, 255, 0.88)',
      chrome: 'rgba(255, 255, 255, 0.94)',
      body: 'rgba(255, 255, 255, 0.84)',
      border: 'rgba(23, 50, 64, 0.12)',
      divider: 'rgba(23, 50, 64, 0.08)',
    },
  },
  status: {
    info: '#4f7387',
    success: '#2f6e5f',
    warning: '#9d6b1f',
    danger: '#bb4d45',
    idle: '#71818a',
  },
  shadow: {
    color: '#0b1115',
    softOpacity: 0.06,
    mediumOpacity: 0.1,
    strongOpacity: 0.14,
  },
  cardColors: minimalCards,
  ui: glassUi('light'),
}

const glassDark: AppPalette = {
  ...minimalDark,
  primary: '#b8e3ff',
  primaryForeground: '#091115',
  secondary: '#8ea0aa',
  accent: '#9cc3d8',
  border: 'rgba(232, 242, 247, 0.06)',
  borderStrong: 'rgba(232, 242, 247, 0.12)',
  text: '#f2fbff',
  textSecondary: '#c8d0d5',
  textTertiary: '#98a6b0',
  success: '#9ad9c6',
  warning: '#ebc47c',
  error: '#f3a79e',
  backdrop: 'rgba(9, 17, 21, 0.42)',
  island: 'rgba(16, 20, 23, 0.72)',
  islandRaised: 'rgba(24, 29, 33, 0.72)',
  islandMuted: 'rgba(30, 37, 42, 0.62)',
  glass: 'rgba(16, 20, 23, 0.68)',
  mintSoft: 'rgba(36, 87, 76, 0.22)',
  amberSoft: 'rgba(96, 71, 34, 0.22)',
  skySoft: 'rgba(46, 75, 96, 0.22)',
  shadowTint: '#05080b',
  paper: 'rgba(16, 20, 23, 0.72)',
  paperDeep: 'rgba(11, 16, 19, 0.8)',
  paperWarm: 'rgba(24, 29, 33, 0.76)',
  creamInk: '#f2fbff',
  mint: '#9ad9c6',
  mintPressed: '#73b9a4',
  mintWash: 'rgba(36, 87, 76, 0.22)',
  amber: '#ebc47c',
  amberPressed: '#c79754',
  amberWash: 'rgba(96, 71, 34, 0.22)',
  coral: '#f3a79e',
  coralWash: 'rgba(128, 69, 61, 0.2)',
  sky: '#9cc3d8',
  skyWash: 'rgba(46, 75, 96, 0.22)',
  overlay: 'rgba(9, 17, 21, 0.42)',
  scrim: 'rgba(9, 17, 21, 0.26)',
  pressed: 'rgba(232, 242, 247, 0.07)',
  disabled: 'rgba(179, 187, 192, 0.34)',
  highlight: 'rgba(232, 242, 247, 0.1)',
  background: {
    defaultMode: 'surface',
    canvas: '#0d1215',
    focusCanvas: '#0b1115',
    surfaceCanvas: '#10161a',
    mist: {
      primary: 'rgba(36, 87, 76, 0.2)',
      secondary: 'rgba(46, 75, 96, 0.18)',
      warm: 'rgba(96, 71, 34, 0.16)',
      coolOpacity: 0.12,
      warmOpacity: 0.05,
      focusOpacity: 0.05,
      surfaceOpacity: 0.04,
    },
    trace: {
      primary: '#b8e3ff',
      secondary: '#9cc3d8',
      accent: '#ebc47c',
      opacity: 0.08,
      focusOpacity: 0.05,
      surfaceOpacity: 0.04,
    },
    grid: 'rgba(232, 242, 247, 0.05)',
    scrim: 'rgba(0, 0, 0, 0.18)',
    motion: 'subtle',
  },
  material: {
    canvas: 'rgba(13, 18, 21, 0.94)',
    paper: 'rgba(16, 20, 23, 0.72)',
    paperRaised: 'rgba(24, 29, 33, 0.72)',
    paperPressed: 'rgba(30, 37, 42, 0.64)',
    glass: 'rgba(16, 20, 23, 0.8)',
    chrome: 'rgba(16, 20, 23, 0.88)',
    field: 'rgba(15, 19, 22, 0.56)',
    stroke: 'rgba(232, 242, 247, 0.08)',
    strokeStrong: 'rgba(232, 242, 247, 0.16)',
    sheet: {
      surface: 'rgba(12, 15, 18, 0.88)',
      chrome: 'rgba(16, 20, 23, 0.92)',
      body: 'rgba(12, 15, 18, 0.84)',
      border: 'rgba(232, 242, 247, 0.12)',
      divider: 'rgba(232, 242, 247, 0.08)',
    },
  },
  status: {
    info: '#9cc3d8',
    success: '#9ad9c6',
    warning: '#ebc47c',
    danger: '#f3a79e',
    idle: '#93a3ad',
  },
  shadow: {
    color: '#05080b',
    softOpacity: 0.14,
    mediumOpacity: 0.2,
    strongOpacity: 0.28,
  },
  cardColors: minimalCards,
  ui: glassUi('dark'),
}

export const DEFAULT_THEME_ID: ThemeId = 'minimal'
export const themeIds = ['minimal', 'glass', 'cartoon'] as const satisfies readonly ThemeId[]

export const themePalettes: Record<ThemeId, Record<ResolvedThemeMode, AppPalette>> = {
  minimal: {
    light: minimalLight,
    dark: minimalDark,
  },
  glass: {
    light: glassLight,
    dark: glassDark,
  },
  cartoon: {
    light: islandLight,
    dark: islandDark,
  },
}

// Backward-compatible alias for older code that imported colors.light/colors.dark.
export const colors = themePalettes.minimal

export function isThemeId(value: unknown): value is ThemeId {
  return value === 'minimal' || value === 'glass' || value === 'cartoon'
}

export function normalizeThemeId(value: unknown): ThemeId {
  if (value === 'island') return 'cartoon'
  return isThemeId(value) ? value : DEFAULT_THEME_ID
}

export function resolveThemeMode(theme: ThemeMode, systemScheme?: 'light' | 'dark' | null): ResolvedThemeMode {
  return theme === 'system' ? systemScheme ?? 'light' : theme
}

export function getColors(theme: ThemeMode | ResolvedThemeMode, themeId: ThemeId = DEFAULT_THEME_ID, systemScheme?: 'light' | 'dark' | null) {
  const resolvedMode = resolveThemeMode(theme as ThemeMode, systemScheme)
  return themePalettes[normalizeThemeId(themeId)][resolvedMode]
}
