import type { ThemeFamily } from './themeTokens'

/**
 * Theme Expression Layer
 *
 * Tokens answer "which value". Expressions answer "which visual and
 * interaction grammar". The registry is intentionally pure so native, web,
 * previews, and contract tests consume the same design language.
 */

export const THEME_COMPONENT_IDS = [
  'button',
  'iconButton',
  'fab',
  'textField',
  'search',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'tabs',
  'card',
  'list',
  'navigation',
  'drawer',
  'bottomNavigation',
  'dialog',
  'bottomSheet',
  'dropdown',
  'menu',
  'tooltip',
  'toast',
  'loading',
  'skeleton',
  'emptyState',
  'errorState',
  'chatMessage',
  'aiResponse',
  'markdown',
  'codeBlock',
  'userMessage',
  'composer',
  'attachment',
  'modelSelector',
  'settings',
  'knowledge',
  'memory',
] as const

export type ThemeComponentId = (typeof THEME_COMPONENT_IDS)[number]
export type ThemeMotionGrammar = 'precision' | 'organic' | 'material' | 'fluid'
export type ThemeSurfaceGrammar = 'boundary' | 'atmosphere' | 'tonal' | 'lens'
export type ThemeShapeGrammar = 'angular' | 'soft' | 'material' | 'capsule'
export type ThemeInteractionGrammar = 'direct' | 'breathing' | 'state-layer' | 'physical'
export type ThemeNavigationGrammar = 'list' | 'drift' | 'indicator' | 'floating'

export interface ThemeComponentExpression {
  composition: string
  surface: ThemeSurfaceGrammar
  shape: ThemeShapeGrammar
  density: 'compact' | 'balanced' | 'airy'
  border: 'none' | 'divider' | 'outline' | 'edge-highlight'
  elevation: 'none' | 'low' | 'tonal' | 'layered'
  interaction: ThemeInteractionGrammar
  motion: ThemeMotionGrammar
  focus: string
  selected: string
  disabled: string
}

export interface ThemeExpression {
  family: ThemeFamily
  name: string
  philosophy: string
  emotion: string
  userFeeling: string
  visual: {
    hierarchy: string
    rhythm: string
    typography: string
    iconography: string
  }
  spatial: {
    layout: string
    density: 'compact' | 'balanced' | 'airy'
    alignment: string
    containerPolicy: string
  }
  material: {
    surface: string
    border: string
    elevation: string
    background: string
    fallback: string
  }
  interaction: {
    grammar: ThemeInteractionGrammar
    press: string
    hover: string
    focus: string
    disabled: string
    selection: string
  }
  motion: {
    grammar: ThemeMotionGrammar
    duration: { instant: number; interaction: number; emphasis: number; panel: number; page: number }
    easing: string
    reducedMotion: string
    ambient: string
  }
  navigation: ThemeNavigationGrammar
  components: Record<ThemeComponentId, ThemeComponentExpression>
}

const component = (
  composition: string,
  surface: ThemeSurfaceGrammar,
  shape: ThemeShapeGrammar,
  density: ThemeComponentExpression['density'],
  border: ThemeComponentExpression['border'],
  elevation: ThemeComponentExpression['elevation'],
  interaction: ThemeInteractionGrammar,
  motion: ThemeMotionGrammar,
  focus: string,
  selected: string,
  disabled: string,
): ThemeComponentExpression => ({
  composition,
  surface,
  shape,
  density,
  border,
  elevation,
  interaction,
  motion,
  focus,
  selected,
  disabled,
})

const MINIMAL_COMPONENTS = {
  button: component('text or thin outline action', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'one-pixel focus rule', 'ink underline', 'muted label'),
  iconButton: component('icon with measured hit area', 'boundary', 'angular', 'compact', 'none', 'none', 'direct', 'precision', 'square focus ring', 'ink tint', 'muted icon'),
  fab: component('reserved primary action row', 'boundary', 'soft', 'compact', 'outline', 'low', 'direct', 'precision', 'outline', 'ink fill', 'muted fill'),
  textField: component('label plus underline input', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'underline and label', 'ink underline', 'text only'),
  search: component('inline search row', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'single rule', 'ink cursor', 'muted placeholder'),
  checkbox: component('small square mark', 'boundary', 'angular', 'compact', 'outline', 'none', 'direct', 'precision', 'outline', 'ink check', 'muted mark'),
  radio: component('single ring choice', 'boundary', 'angular', 'compact', 'outline', 'none', 'direct', 'precision', 'outline', 'center dot', 'muted ring'),
  switch: component('thin binary rail', 'boundary', 'soft', 'compact', 'divider', 'none', 'direct', 'precision', 'rail outline', 'ink rail', 'muted rail'),
  slider: component('hairline range with thumb', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'rail outline', 'ink segment', 'muted rail'),
  tabs: component('text tabs with rule', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'rule focus', 'ink rule', 'muted text'),
  card: component('content group without shell', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'rule focus', 'ink rule', 'muted content'),
  list: component('continuous rows and dividers', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'row rule', 'ink bar', 'muted row'),
  navigation: component('quiet indexed list', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'row rule', 'ink marker', 'muted label'),
  drawer: component('flush utility rail', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'edge rule', 'ink marker', 'muted item'),
  bottomNavigation: component('text-first bottom rail', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'rail rule', 'ink label', 'muted label'),
  dialog: component('short interruptive text panel', 'boundary', 'soft', 'compact', 'outline', 'low', 'direct', 'precision', 'outline', 'ink action', 'muted action'),
  bottomSheet: component('anchored utility list', 'boundary', 'soft', 'compact', 'divider', 'low', 'direct', 'precision', 'top rule', 'ink action', 'muted action'),
  dropdown: component('inline choice list', 'boundary', 'angular', 'compact', 'divider', 'low', 'direct', 'precision', 'row rule', 'ink marker', 'muted item'),
  menu: component('dense command list', 'boundary', 'angular', 'compact', 'divider', 'low', 'direct', 'precision', 'row rule', 'ink marker', 'muted item'),
  tooltip: component('plain contextual text', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'text underline', 'ink text', 'muted text'),
  toast: component('single-line status strip', 'boundary', 'angular', 'compact', 'divider', 'low', 'direct', 'precision', 'rule', 'ink marker', 'muted text'),
  loading: component('short progress trace', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'trace', 'ink trace', 'muted trace'),
  skeleton: component('static text-shaped rules', 'boundary', 'angular', 'compact', 'none', 'none', 'direct', 'precision', 'none', 'none', 'muted rule'),
  emptyState: component('centered next-action copy', 'boundary', 'angular', 'balanced', 'none', 'none', 'direct', 'precision', 'text rule', 'ink action', 'muted copy'),
  errorState: component('direct error and recovery row', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'rule', 'ink recovery', 'muted copy'),
  chatMessage: component('assistant text flow, user compact block', 'boundary', 'angular', 'compact', 'none', 'none', 'direct', 'precision', 'ink rule', 'ink edge', 'muted copy'),
  aiResponse: component('content-first response column', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'rule', 'ink citation', 'muted metadata'),
  markdown: component('continuous typographic reading flow with rules only for structure', 'boundary', 'angular', 'compact', 'none', 'none', 'direct', 'precision', 'text selection and one-pixel link rule', 'ink selection marker', 'muted metadata'),
  codeBlock: component('flat source ledger with line-number gutter', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'one-pixel source boundary', 'ink gutter marker', 'muted source'),
  userMessage: component('right-aligned compact text block', 'boundary', 'soft', 'compact', 'divider', 'none', 'direct', 'precision', 'edge rule', 'ink edge', 'muted copy'),
  composer: component('edge-to-edge writing rail', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'underline', 'ink caret', 'muted controls'),
  attachment: component('filename row with no tile', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'rule', 'ink marker', 'muted filename'),
  modelSelector: component('compact text selector', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'rule', 'ink marker', 'muted label'),
  settings: component('sectioned utility list', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'section rule', 'ink marker', 'muted copy'),
  knowledge: component('dense source ledger', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'row rule', 'ink marker', 'muted metadata'),
  memory: component('chronological note ledger', 'boundary', 'angular', 'compact', 'divider', 'none', 'direct', 'precision', 'row rule', 'ink marker', 'muted metadata'),
} as const satisfies Record<ThemeComponentId, ThemeComponentExpression>

const MONET_COMPONENTS = {
  button: component('soft pigment pill with light wash', 'atmosphere', 'soft', 'balanced', 'edge-highlight', 'low', 'breathing', 'organic', 'warm halo', 'luminous wash', 'faded pigment'),
  iconButton: component('floating brush-mark control', 'atmosphere', 'soft', 'balanced', 'edge-highlight', 'low', 'breathing', 'organic', 'soft halo', 'pigment tint', 'faded icon'),
  fab: component('sunlit floating pebble', 'atmosphere', 'soft', 'balanced', 'edge-highlight', 'low', 'breathing', 'organic', 'light halo', 'warm bloom', 'mist surface'),
  textField: component('misty field with soft glow', 'atmosphere', 'soft', 'airy', 'edge-highlight', 'low', 'breathing', 'organic', 'diffuse glow', 'light wash', 'low-contrast copy'),
  search: component('airy search ribbon', 'atmosphere', 'soft', 'airy', 'edge-highlight', 'low', 'breathing', 'organic', 'diffuse glow', 'color drift', 'mist placeholder'),
  checkbox: component('rounded pigment tick', 'atmosphere', 'soft', 'balanced', 'edge-highlight', 'low', 'breathing', 'organic', 'soft halo', 'painted check', 'faded mark'),
  radio: component('soft painted ring', 'atmosphere', 'soft', 'balanced', 'edge-highlight', 'low', 'breathing', 'organic', 'soft halo', 'warm dot', 'faded ring'),
  switch: component('slowly breathing color rail', 'atmosphere', 'soft', 'balanced', 'edge-highlight', 'low', 'breathing', 'organic', 'diffuse glow', 'sunlit rail', 'mist rail'),
  slider: component('painted path with drifting thumb', 'atmosphere', 'soft', 'balanced', 'edge-highlight', 'low', 'breathing', 'organic', 'path glow', 'pigment path', 'mist path'),
  tabs: component('floating labels over wash', 'atmosphere', 'soft', 'airy', 'none', 'none', 'breathing', 'organic', 'light bloom', 'color bloom', 'faded label'),
  card: component('soft translucent garden plane', 'atmosphere', 'soft', 'airy', 'edge-highlight', 'low', 'breathing', 'organic', 'light rim', 'warm wash', 'mist copy'),
  list: component('breathing rows with color drift', 'atmosphere', 'soft', 'airy', 'none', 'none', 'breathing', 'organic', 'wash edge', 'light wash', 'mist row'),
  navigation: component('garden path with soft wayfinding', 'atmosphere', 'soft', 'airy', 'none', 'low', 'breathing', 'organic', 'path glow', 'warm marker', 'mist label'),
  drawer: component('painted veil that parts gently', 'atmosphere', 'soft', 'airy', 'edge-highlight', 'low', 'breathing', 'organic', 'light rim', 'warm marker', 'mist item'),
  bottomNavigation: component('floating garden raft', 'atmosphere', 'soft', 'airy', 'edge-highlight', 'low', 'breathing', 'organic', 'soft halo', 'warm bloom', 'mist label'),
  dialog: component('quiet light-filled vignette', 'atmosphere', 'soft', 'airy', 'edge-highlight', 'low', 'breathing', 'organic', 'diffuse glow', 'warm action', 'mist action'),
  bottomSheet: component('waterline sheet with soft rise', 'atmosphere', 'soft', 'airy', 'edge-highlight', 'low', 'breathing', 'organic', 'waterline glow', 'warm action', 'mist action'),
  dropdown: component('color-wash choice ribbon', 'atmosphere', 'soft', 'balanced', 'edge-highlight', 'low', 'breathing', 'organic', 'wash edge', 'pigment marker', 'mist item'),
  menu: component('soft floating brush list', 'atmosphere', 'soft', 'balanced', 'edge-highlight', 'low', 'breathing', 'organic', 'wash edge', 'warm marker', 'mist item'),
  tooltip: component('small light mote with copy', 'atmosphere', 'soft', 'balanced', 'edge-highlight', 'low', 'breathing', 'organic', 'soft halo', 'warm copy', 'mist copy'),
  toast: component('floating colored breath', 'atmosphere', 'soft', 'airy', 'edge-highlight', 'low', 'breathing', 'organic', 'light bloom', 'warm marker', 'mist copy'),
  loading: component('three-dot breathing pollen', 'atmosphere', 'soft', 'airy', 'none', 'none', 'breathing', 'organic', 'none', 'light pulse', 'still mist'),
  skeleton: component('slowly shifting translucent wash', 'atmosphere', 'soft', 'airy', 'none', 'none', 'breathing', 'organic', 'none', 'light drift', 'mist wash'),
  emptyState: component('open garden composition with invitation', 'atmosphere', 'soft', 'airy', 'none', 'none', 'breathing', 'organic', 'light halo', 'warm action', 'mist copy'),
  errorState: component('warm interruption inside atmosphere', 'atmosphere', 'soft', 'balanced', 'edge-highlight', 'low', 'breathing', 'organic', 'warm glow', 'warm recovery', 'mist copy'),
  chatMessage: component('floating conversational brush strokes', 'atmosphere', 'soft', 'airy', 'edge-highlight', 'low', 'breathing', 'organic', 'light rim', 'warm wash', 'mist copy'),
  aiResponse: component('layered water-and-sky reading plane', 'atmosphere', 'soft', 'airy', 'edge-highlight', 'low', 'breathing', 'organic', 'light rim', 'warm citation', 'mist metadata'),
  markdown: component('airy reading flow with soft atmospheric spacing', 'atmosphere', 'soft', 'airy', 'none', 'none', 'breathing', 'organic', 'diffuse link halo', 'warm passage wash', 'faded metadata'),
  codeBlock: component('misty source plane with softly lit gutter', 'atmosphere', 'soft', 'balanced', 'edge-highlight', 'low', 'breathing', 'organic', 'soft source halo', 'pigment gutter wash', 'mist source'),
  userMessage: component('sunlit rounded note', 'atmosphere', 'soft', 'balanced', 'edge-highlight', 'low', 'breathing', 'organic', 'warm halo', 'warm wash', 'mist copy'),
  composer: component('garden-window writing surface', 'atmosphere', 'soft', 'airy', 'edge-highlight', 'low', 'breathing', 'organic', 'diffuse glow', 'warm caret', 'mist controls'),
  attachment: component('small floating petal chip', 'atmosphere', 'soft', 'balanced', 'edge-highlight', 'low', 'breathing', 'organic', 'soft halo', 'warm wash', 'mist filename'),
  modelSelector: component('sunlit model ribbon', 'atmosphere', 'soft', 'balanced', 'edge-highlight', 'low', 'breathing', 'organic', 'diffuse glow', 'warm marker', 'mist label'),
  settings: component('airy garden sections', 'atmosphere', 'soft', 'airy', 'none', 'none', 'breathing', 'organic', 'wash edge', 'warm marker', 'mist copy'),
  knowledge: component('source meadow with soft strata', 'atmosphere', 'soft', 'airy', 'edge-highlight', 'low', 'breathing', 'organic', 'light rim', 'warm marker', 'mist metadata'),
  memory: component('floating memory petals', 'atmosphere', 'soft', 'airy', 'none', 'none', 'breathing', 'organic', 'wash edge', 'warm marker', 'mist metadata'),
} as const satisfies Record<ThemeComponentId, ThemeComponentExpression>

const MATERIAL_COMPONENTS = {
  button: component('filled, tonal, outlined, or text action', 'tonal', 'material', 'compact', 'outline', 'tonal', 'state-layer', 'material', 'state layer', 'tonal container', 'disabled container'),
  iconButton: component('standard icon button with state layer', 'tonal', 'material', 'compact', 'none', 'tonal', 'state-layer', 'material', 'state layer', 'selected container', 'disabled icon'),
  fab: component('elevated primary action', 'tonal', 'material', 'compact', 'none', 'tonal', 'state-layer', 'material', 'state layer', 'primary container', 'disabled container'),
  textField: component('outlined or filled field with moving label', 'tonal', 'material', 'balanced', 'outline', 'tonal', 'state-layer', 'material', 'label and outline', 'primary outline', 'supporting text'),
  search: component('search bar with leading and trailing semantics', 'tonal', 'material', 'balanced', 'outline', 'tonal', 'state-layer', 'material', 'outline and label', 'indicator', 'supporting text'),
  checkbox: component('animated check and state layer', 'tonal', 'material', 'compact', 'outline', 'tonal', 'state-layer', 'material', 'state layer', 'primary fill', 'disabled mark'),
  radio: component('animated single-choice indicator', 'tonal', 'material', 'compact', 'outline', 'tonal', 'state-layer', 'material', 'state layer', 'primary dot', 'disabled ring'),
  switch: component('track and thumb with semantic states', 'tonal', 'material', 'compact', 'outline', 'tonal', 'state-layer', 'material', 'state layer', 'primary track', 'disabled track'),
  slider: component('active/inactive track with value semantics', 'tonal', 'material', 'compact', 'none', 'tonal', 'state-layer', 'material', 'state layer', 'primary track', 'disabled track'),
  tabs: component('text/icon tabs with active indicator', 'tonal', 'material', 'compact', 'none', 'tonal', 'state-layer', 'material', 'indicator', 'active indicator', 'disabled label'),
  card: component('filled, elevated, or outlined tonal surface', 'tonal', 'material', 'balanced', 'outline', 'tonal', 'state-layer', 'material', 'outline', 'tonal surface', 'disabled content'),
  list: component('bounded list rows with supporting text', 'tonal', 'material', 'compact', 'none', 'tonal', 'state-layer', 'material', 'state layer', 'leading indicator', 'disabled row'),
  navigation: component('adaptive navigation with selected indicator', 'tonal', 'material', 'compact', 'none', 'tonal', 'state-layer', 'material', 'indicator', 'active indicator', 'disabled label'),
  drawer: component('modal or standard navigation drawer', 'tonal', 'material', 'balanced', 'none', 'tonal', 'state-layer', 'material', 'indicator', 'active indicator', 'disabled item'),
  bottomNavigation: component('navigation bar with selected pill', 'tonal', 'material', 'compact', 'none', 'tonal', 'state-layer', 'material', 'indicator', 'active pill', 'disabled label'),
  dialog: component('tonal surface with stable action order', 'tonal', 'material', 'balanced', 'none', 'tonal', 'state-layer', 'material', 'state layer', 'primary action', 'disabled action'),
  bottomSheet: component('modal bottom sheet with scrim and handle', 'tonal', 'material', 'balanced', 'none', 'tonal', 'state-layer', 'material', 'scrim', 'primary action', 'disabled action'),
  dropdown: component('anchored menu with elevation level', 'tonal', 'material', 'compact', 'none', 'tonal', 'state-layer', 'material', 'state layer', 'active row', 'disabled row'),
  menu: component('bounded command menu', 'tonal', 'material', 'compact', 'none', 'tonal', 'state-layer', 'material', 'state layer', 'active row', 'disabled row'),
  tooltip: component('standard supporting tooltip', 'tonal', 'material', 'compact', 'none', 'tonal', 'state-layer', 'material', 'state layer', 'primary label', 'disabled label'),
  toast: component('snackbar with action and dismiss semantics', 'tonal', 'material', 'compact', 'none', 'tonal', 'state-layer', 'material', 'state layer', 'action label', 'disabled action'),
  loading: component('linear or circular progress indicator', 'tonal', 'material', 'compact', 'none', 'tonal', 'state-layer', 'material', 'indicator', 'primary indicator', 'disabled indicator'),
  skeleton: component('tonal placeholder blocks', 'tonal', 'material', 'balanced', 'none', 'tonal', 'state-layer', 'material', 'none', 'tonal placeholder', 'disabled placeholder'),
  emptyState: component('supporting text plus primary action', 'tonal', 'material', 'balanced', 'none', 'tonal', 'state-layer', 'material', 'state layer', 'primary action', 'supporting text'),
  errorState: component('supporting error text plus recovery action', 'tonal', 'material', 'compact', 'outline', 'tonal', 'state-layer', 'material', 'error outline', 'error action', 'disabled action'),
  chatMessage: component('tonal assistant surface and aligned user surface', 'tonal', 'material', 'balanced', 'outline', 'tonal', 'state-layer', 'material', 'state layer', 'selected container', 'disabled content'),
  aiResponse: component('surface container with citations and tool rows', 'tonal', 'material', 'balanced', 'outline', 'tonal', 'state-layer', 'material', 'state layer', 'citation indicator', 'supporting text'),
  markdown: component('role-based reading hierarchy with semantic blocks', 'tonal', 'material', 'balanced', 'none', 'none', 'state-layer', 'material', 'link state layer', 'tonal selection', 'supporting text'),
  codeBlock: component('outlined source container with fixed header and gutter', 'tonal', 'material', 'compact', 'outline', 'tonal', 'state-layer', 'material', 'outline and state layer', 'primary gutter indicator', 'disabled source'),
  userMessage: component('primary container aligned to end', 'tonal', 'material', 'compact', 'none', 'tonal', 'state-layer', 'material', 'state layer', 'primary container', 'disabled content'),
  composer: component('tonal input row with explicit model/action slots', 'tonal', 'material', 'compact', 'outline', 'tonal', 'state-layer', 'material', 'focused outline', 'primary action', 'supporting text'),
  attachment: component('assistive chip with remove action', 'tonal', 'material', 'compact', 'outline', 'tonal', 'state-layer', 'material', 'state layer', 'selected chip', 'disabled chip'),
  modelSelector: component('exposed dropdown with supporting metadata', 'tonal', 'material', 'compact', 'outline', 'tonal', 'state-layer', 'material', 'outline', 'active row', 'disabled row'),
  settings: component('grouped preference sections with supporting text', 'tonal', 'material', 'balanced', 'none', 'tonal', 'state-layer', 'material', 'state layer', 'selected row', 'disabled row'),
  knowledge: component('tonal source cards with filter controls', 'tonal', 'material', 'balanced', 'outline', 'tonal', 'state-layer', 'material', 'state layer', 'selected source', 'disabled source'),
  memory: component('tonal memory list with explicit actions', 'tonal', 'material', 'compact', 'none', 'tonal', 'state-layer', 'material', 'state layer', 'selected row', 'disabled row'),
} as const satisfies Record<ThemeComponentId, ThemeComponentExpression>

const GLASS_COMPONENTS = {
  button: component('floating translucent lens', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'light bending', 'energized lens', 'opaque fallback'),
  iconButton: component('lensed icon with lift on touch', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'edge glow', 'lifted lens', 'opaque fallback'),
  fab: component('large floating glass control', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'specular rim', 'lift and glow', 'opaque fallback'),
  textField: component('deep glass container with readable inset', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'interior glow', 'focused lens', 'opaque fallback'),
  search: component('glass search capsule with environmental tint', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'lensing', 'active lens', 'opaque fallback'),
  checkbox: component('lensed mark with light response', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'edge glow', 'energized mark', 'opaque fallback'),
  radio: component('floating lens choice', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'edge glow', 'lensed dot', 'opaque fallback'),
  switch: component('gel track and reflective thumb', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'specular rim', 'lifted thumb', 'opaque fallback'),
  slider: component('glass rail with depth-reactive thumb', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'lensing', 'energized segment', 'opaque fallback'),
  tabs: component('sliding glass capsules on one plane', 'lens', 'capsule', 'balanced', 'none', 'layered', 'physical', 'fluid', 'plane glow', 'sliding lens', 'opaque fallback'),
  card: component('translucent layered plane', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'edge glow', 'lifted plane', 'opaque fallback'),
  list: component('floating rows with environmental separation', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'lensing', 'lifted row', 'opaque fallback'),
  navigation: component('floating navigation plane', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'plane glow', 'active lens', 'opaque fallback'),
  drawer: component('glass sheet with depth separation', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'lensing', 'lifted sheet', 'opaque fallback'),
  bottomNavigation: component('floating glass dock', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'specular rim', 'active lens', 'opaque fallback'),
  dialog: component('independent floating glass layer', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'scrim and lens', 'lifted action', 'opaque fallback'),
  bottomSheet: component('materializing glass sheet with lensing', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'lensing', 'surface emergence', 'opaque fallback'),
  dropdown: component('lens bubble anchored to control', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'lensing', 'active lens', 'opaque fallback'),
  menu: component('floating glass command bubble', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'lensing', 'lifted row', 'opaque fallback'),
  tooltip: component('small glass lens with readable contrast', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'edge glow', 'active lens', 'opaque fallback'),
  toast: component('floating glass notice with light edge', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'lensing', 'energized lens', 'opaque fallback'),
  loading: component('fluid light trace inside lens', 'lens', 'capsule', 'balanced', 'none', 'layered', 'physical', 'fluid', 'none', 'light flow', 'opaque fallback'),
  skeleton: component('blurred but bounded placeholder layer', 'lens', 'capsule', 'balanced', 'none', 'layered', 'physical', 'fluid', 'none', 'light flow', 'opaque fallback'),
  emptyState: component('open environmental plane with floating action', 'lens', 'capsule', 'airy', 'none', 'layered', 'physical', 'fluid', 'ambient lens', 'lifted action', 'opaque fallback'),
  errorState: component('high-contrast glass alert layer', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'red edge glow', 'recovery lens', 'opaque fallback'),
  chatMessage: component('stacked message lenses with depth order', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'lensing', 'lifted message', 'opaque fallback'),
  aiResponse: component('deep readable assistant lens with evidence layers', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'interior glow', 'citation lens', 'opaque fallback'),
  markdown: component('readable text plane over one bounded lens region', 'lens', 'capsule', 'balanced', 'edge-highlight', 'none', 'physical', 'fluid', 'interior text glow', 'lifted passage lens', 'opaque reading fallback'),
  codeBlock: component('deep source lens with separated reflective gutter', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'specular source rim', 'lifted source lens', 'opaque code fallback'),
  userMessage: component('foreground glass capsule aligned to end', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'specular rim', 'lifted capsule', 'opaque fallback'),
  composer: component('primary floating glass writing plane', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'focus lens', 'send lift', 'opaque fallback'),
  attachment: component('small translucent file lens', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'edge glow', 'lifted chip', 'opaque fallback'),
  modelSelector: component('glass selector with morphing menu', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'lensing', 'morphing lens', 'opaque fallback'),
  settings: component('stacked glass panels with depth hierarchy', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'lensing', 'lifted panel', 'opaque fallback'),
  knowledge: component('layered source lenses over environmental field', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'lensing', 'selected lens', 'opaque fallback'),
  memory: component('floating memory shards with bounded depth', 'lens', 'capsule', 'balanced', 'edge-highlight', 'layered', 'physical', 'fluid', 'lensing', 'selected lens', 'opaque fallback'),
} as const satisfies Record<ThemeComponentId, ThemeComponentExpression>

export const THEME_EXPRESSION_REGISTRY: Readonly<Record<ThemeFamily, ThemeExpression>> = Object.freeze({
  minimal: {
    family: 'minimal',
    name: 'Minimal',
    philosophy: 'Calm, precise, content-first productivity with low cognitive load.',
    emotion: 'calm / efficient / precise',
    userFeeling: 'The product stays quiet and gets out of the way.',
    visual: { hierarchy: 'typography and alignment before decoration', rhythm: 'short measured intervals', typography: 'compact system sans with clear baselines', iconography: 'monoline utility icons with no ornament' },
    spatial: { layout: 'continuous canvas with explicit gutters', density: 'compact', alignment: 'strict columns and baseline alignment', containerPolicy: 'use spacing and rules before cards' },
    material: { surface: 'opaque paper and unframed content', border: 'hairline dividers only where needed', elevation: 'mostly flat; one restrained level for interruptive surfaces', background: 'plain, static canvas', fallback: 'opaque canvas with no visual loss' },
    interaction: { grammar: 'direct', press: 'small opacity/translation response', hover: 'quiet tint or rule', focus: 'visible single rule or ring', disabled: 'semantic muted content, never global fade', selection: 'ink edge and text marker' },
    motion: { grammar: 'precision', duration: { instant: 0, interaction: 80, emphasis: 120, panel: 180, page: 180 }, easing: 'standard easing with no overshoot', reducedMotion: 'opacity-only, 1-120ms', ambient: 'none' },
    navigation: 'list',
    components: MINIMAL_COMPONENTS,
  },
  monet: {
    family: 'monet',
    name: 'Monet',
    philosophy: 'A digital interface illuminated by atmosphere, reflected light, and adjacent color.',
    emotion: 'gentle / natural / dreamy',
    userFeeling: 'The surface feels calm, alive, and softly lit by its environment.',
    visual: { hierarchy: 'light fields and color adjacency create hierarchy', rhythm: 'longer breathing intervals with gentle offsets', typography: 'warm humanist scale with relaxed leading', iconography: 'soft marks with occasional pigment accents' },
    spatial: { layout: 'airy compositions with mild organic drift', density: 'airy', alignment: 'soft alignment with intentional asymmetry', containerPolicy: 'group content in translucent planes, never decorate without hierarchy' },
    material: { surface: 'thin atmospheric washes over opaque readable content', border: 'soft edge highlights instead of hard outlines', elevation: 'low floating planes with diffuse shadows', background: 'bounded light fields and slow color interpolation', fallback: 'opaque tonal wash with no blur dependency' },
    interaction: { grammar: 'breathing', press: 'light temperature and soft lift change', hover: 'light moves across the surface', focus: 'diffuse halo plus clear contrast', disabled: 'faded pigment with preserved text contrast', selection: 'warm/cool wash rather than a hard block' },
    motion: { grammar: 'organic', duration: { instant: 0, interaction: 220, emphasis: 280, panel: 380, page: 420 }, easing: 'slow sinusoidal breath with diagonal drift; no mechanical overshoot', reducedMotion: 'opacity-only, no ambient drift', ambient: 'bounded 6-8s low-amplitude light drift' },
    navigation: 'drift',
    components: MONET_COMPONENTS,
  },
  material: {
    family: 'material',
    name: 'Material 3',
    philosophy: 'A predictable system of tonal roles, state layers, elevation, and adaptive semantics.',
    emotion: 'reliable / structured / clear',
    userFeeling: 'Every control behaves consistently and explains its state.',
    visual: { hierarchy: 'tonal color roles and typography hierarchy', rhythm: 'measured component spacing and stable touch targets', typography: 'role-based scale with explicit labels/supporting text', iconography: 'semantic icons with selected/unselected states' },
    spatial: { layout: 'adaptive surfaces with component boundaries', density: 'compact', alignment: 'standardized slots and predictable action placement', containerPolicy: 'use filled/outlined/elevated variants intentionally' },
    material: { surface: 'tonal containers with six elevation levels', border: 'outlined component semantics', elevation: 'tonal elevation first, shadow when separation needs it', background: 'dynamic-color-ready tonal canvas', fallback: 'opaque tonal surfaces when dynamic color is unavailable' },
    interaction: { grammar: 'state-layer', press: 'state layer plus bounded ripple', hover: 'state layer at hover opacity', focus: 'focus ring and supporting semantics', disabled: 'role-specific disabled container/content', selection: 'indicator/container plus icon semantics' },
    motion: { grammar: 'material', duration: { instant: 0, interaction: 100, emphasis: 150, panel: 220, page: 280 }, easing: 'fast standard/decelerate with horizontal shared-axis and container transforms', reducedMotion: 'opacity-only with state completion', ambient: 'none' },
    navigation: 'indicator',
    components: MATERIAL_COMPONENTS,
  },
  'liquid-glass': {
    family: 'liquid-glass',
    name: 'Liquid Glass',
    philosophy: 'A responsive digital material that bends light, reveals its environment, and lifts on contact.',
    emotion: 'premium / spatial / futuristic',
    userFeeling: 'Controls float in a coherent plane and respond like a lightweight physical material.',
    visual: { hierarchy: 'depth, lensing, and specular edges before color', rhythm: 'layered spacing with clear depth separation', typography: 'high-contrast readable type over translucent surfaces', iconography: 'simple icons with edge-lit selected states' },
    spatial: { layout: 'floating planes over a bounded environment', density: 'balanced', alignment: 'nested layers with explicit z-order', containerPolicy: 'one blur layer per region; content remains opaque/readable' },
    material: { surface: 'translucent lens with reflection and environmental tint', border: 'specular edge highlight plus contrast boundary', elevation: 'layered depth with restrained shadow/glow', background: 'bounded environmental field; no unbounded blur', fallback: 'reduced-glass opaque tonal surface on unsupported devices' },
    interaction: { grammar: 'physical', press: 'instant flex/lift and highlight response', hover: 'light bends toward pointer', focus: 'interior glow plus edge contrast', disabled: 'opaque fallback surface with preserved semantics', selection: 'lifted lens and light concentration' },
    motion: { grammar: 'fluid', duration: { instant: 0, interaction: 140, emphasis: 220, panel: 320, page: 360 }, easing: 'spring with bounded translation and no infinite loops', reducedMotion: 'remove parallax/blur interpolation; keep opacity and focus', ambient: 'optional low-amplitude light movement, one layer per region' },
    navigation: 'floating',
    components: GLASS_COMPONENTS,
  },
})

export function isThemeComponentId(value: unknown): value is ThemeComponentId {
  return (THEME_COMPONENT_IDS as readonly unknown[]).includes(value)
}

export function resolveThemeExpression(family: ThemeFamily): ThemeExpression {
  return THEME_EXPRESSION_REGISTRY[family]
}

export function resolveThemeComponentExpression(family: ThemeFamily, componentId: ThemeComponentId): ThemeComponentExpression {
  return THEME_EXPRESSION_REGISTRY[family].components[componentId]
}

/** Stable labels used by grayscale and motion identity checks. */
export const THEME_IDENTITY_SIGNATURES: Readonly<Record<ThemeFamily, Readonly<{
  grayscale: readonly string[]
  interaction: readonly string[]
  emotion: string
}>>> = Object.freeze({
  minimal: { grayscale: ['rules', 'alignment', 'text-first', 'flat'], interaction: ['short', 'direct', 'quiet'], emotion: 'calm / efficient / precise' },
  monet: { grayscale: ['wash', 'soft-edge', 'organic-offset', 'breathing'], interaction: ['light-drift', 'halo', 'slow'], emotion: 'gentle / natural / dreamy' },
  material: { grayscale: ['tonal-levels', 'state-layer', 'indicator', 'standard-shape'], interaction: ['ripple', 'shared-axis', 'predictable'], emotion: 'reliable / structured / clear' },
  'liquid-glass': { grayscale: ['lens', 'depth', 'specular-edge', 'layered'], interaction: ['lift', 'parallax', 'spring'], emotion: 'premium / spatial / futuristic' },
})
