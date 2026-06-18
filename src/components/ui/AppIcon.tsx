import type { ComponentType } from 'react'
import type { StyleProp, TextStyle } from 'react-native'
import type { LucideProps } from 'lucide-react-native'
import {
  ArrowDown,
  ArrowUp,
  ArrowRight,
  AtSign,
  BadgePlus,
  BookOpen,
  Bot,
  Brain,
  BrainCircuit,
  BrainCog,
  Camera,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CirclePlus,
  CircleStop,
  CircleX,
  ClipboardPaste,
  Cloud,
  Compass,
  Copy,
  Cpu,
  Database,
  DatabaseZap,
  Download,
  Earth,
  Ellipsis,
  ExternalLink,
  FileText,
  GitBranch,
  GripVertical,
  House,
  Image,
  Import,
  Info,
  Key,
  Layers,
  ListChecks,
  LoaderCircle,
  Lock,
  Map,
  MessageSquare,
  MessagesSquare,
  Mic,
  Moon,
  Network,
  NotebookPen,
  PanelBottom,
  PanelLeft,
  PanelTop,
  PanelsTopLeft,
  Paperclip,
  Power,
  RefreshCw,
  Search,
  SearchCheck,
  SendHorizontal,
  Settings2,
  Shield,
  ShieldCheck,
  ShoppingBag,
  Sigma,
  Slash,
  SlidersHorizontal,
  SlidersVertical,
  Smartphone,
  Sparkles,
  Split,
  Square,
  SquarePen,
  SquareTerminal,
  Star,
  Sun,
  Table2,
  Terminal,
  ToggleLeft,
  ToggleRight,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
  Volume2,
  Workflow,
  Wrench,
} from 'lucide-react-native'
import { useAppTheme } from '@/hooks/useAppTheme'

type LucideIcon = ComponentType<LucideProps>

export const appIconSizes = {
  xs: 13,
  sm: 15,
  md: 17,
  lg: 20,
  xl: 23,
} as const

export const appIconStroke = {
  fine: 1.75,
  regular: 2,
  strong: 2.2,
  bold: 2.35,
} as const

export type AppIconName =
  | 'activity'
  | 'add'
  | 'arrow-right'
  | 'arrow-down'
  | 'arrow-up'
  | 'attachment'
  | 'back-next'
  | 'bot'
  | 'camera'
  | 'chart'
  | 'check'
  | 'code'
  | 'cloud'
  | 'collapse'
  | 'command'
  | 'compass'
  | 'copy'
  | 'cpu'
  | 'delete'
  | 'device'
  | 'diy'
  | 'download'
  | 'edit'
  | 'external-link'
  | 'file-json'
  | 'filter'
  | 'globe'
  | 'grab'
  | 'health'
  | 'home'
  | 'history'
  | 'image'
  | 'info'
  | 'import'
  | 'json'
  | 'key'
  | 'lock'
  | 'knowledge'
  | 'layers'
  | 'leaf'
  | 'list-check'
  | 'loader'
  | 'map'
  | 'menu-output'
  | 'message'
  | 'mention'
  | 'microphone'
  | 'model'
  | 'moon'
  | 'more'
  | 'network'
  | 'paste'
  | 'power'
  | 'prompt'
  | 'provider-key'
  | 'reasoning'
  | 'reasoning-advanced'
  | 'reasoning-deep'
  | 'refresh'
  | 'regenerate'
  | 'retry'
  | 'search'
  | 'search-check'
  | 'send'
  | 'settings'
  | 'settings-sliders'
  | 'shield'
  | 'sigma'
  | 'slash-command'
  | 'source'
  | 'spark'
  | 'split'
  | 'star'
  | 'stop'
  | 'sun'
  | 'table'
  | 'toggle-off'
  | 'toggle-on'
  | 'tools'
  | 'trace'
  | 'undo'
  | 'upload'
  | 'voice'
  | 'warning'
  | 'workflow'
  | 'zap'
  | 'close'
  | 'shopping'
  | 'new-chat'
  | 'context-globe'
  | 'memory-brain'
  | 'knowledge-database'
  | 'preferences-sliders'
  | 'skills-sparkles'
  | 'mcp-network'
  | 'conversation'

const cleanIconRegistry = {
  activity: ChartColumn,
  add: CirclePlus,
  'arrow-right': ArrowRight,
  'arrow-down': ArrowDown,
  'arrow-up': ArrowUp,
  attachment: Paperclip,
  'back-next': ChevronRight,
  bot: Bot,
  camera: Camera,
  chart: ChartColumn,
  check: Check,
  code: SquareTerminal,
  cloud: Cloud,
  collapse: ChevronDown,
  command: Terminal,
  compass: Compass,
  copy: Copy,
  cpu: Cpu,
  delete: Trash2,
  device: Smartphone,
  diy: NotebookPen,
  download: Download,
  edit: SquarePen,
  'external-link': ExternalLink,
  'file-json': FileText,
  filter: SlidersHorizontal,
  globe: Earth,
  grab: GripVertical,
  health: ShieldCheck,
  home: House,
  history: PanelsTopLeft,
  image: Image,
  info: Info,
  import: Import,
  json: FileText,
  key: Key,
  lock: Lock,
  knowledge: BookOpen,
  layers: Layers,
  leaf: Sparkles,
  'list-check': ListChecks,
  loader: LoaderCircle,
  map: Map,
  'menu-output': PanelTop,
  message: MessageSquare,
  mention: AtSign,
  microphone: Mic,
  model: Bot,
  moon: Moon,
  more: Ellipsis,
  network: Network,
  paste: ClipboardPaste,
  power: Power,
  prompt: FileText,
  'provider-key': Key,
  reasoning: Brain,
  'reasoning-advanced': BrainCog,
  'reasoning-deep': BrainCircuit,
  refresh: RefreshCw,
  regenerate: RefreshCw,
  retry: RefreshCw,
  search: Search,
  'search-check': SearchCheck,
  send: SendHorizontal,
  settings: Settings2,
  'settings-sliders': SlidersVertical,
  shield: Shield,
  sigma: Sigma,
  'slash-command': Slash,
  source: PanelLeft,
  spark: Sparkles,
  split: Split,
  star: Star,
  stop: CircleStop,
  sun: Sun,
  table: Table2,
  'toggle-off': ToggleLeft,
  'toggle-on': ToggleRight,
  tools: Wrench,
  trace: GitBranch,
  undo: Undo2,
  upload: Upload,
  voice: Volume2,
  warning: TriangleAlert,
  workflow: Workflow,
  zap: CircleAlert,
  close: CircleX,
  shopping: ShoppingBag,
  'new-chat': BadgePlus,
  'context-globe': Earth,
  'memory-brain': Brain,
  'knowledge-database': Database,
  'preferences-sliders': SlidersHorizontal,
  'skills-sparkles': Sparkles,
  'mcp-network': DatabaseZap,
  conversation: MessagesSquare,
} as const satisfies Record<AppIconName, LucideIcon>

const playfulIconRegistry = {
  activity: ChartColumn,
  add: BadgePlus,
  'arrow-right': ArrowRight,
  'arrow-down': ArrowDown,
  'arrow-up': ArrowUp,
  attachment: Paperclip,
  'back-next': ChevronRight,
  bot: Bot,
  camera: Camera,
  chart: ChartColumn,
  check: CircleCheck,
  code: SquareTerminal,
  cloud: Cloud,
  collapse: ChevronDown,
  command: Terminal,
  compass: Compass,
  copy: Copy,
  cpu: Cpu,
  delete: CircleX,
  device: Smartphone,
  diy: NotebookPen,
  download: Download,
  edit: SquarePen,
  'external-link': ExternalLink,
  'file-json': FileText,
  filter: SlidersHorizontal,
  globe: Earth,
  grab: GripVertical,
  health: ShieldCheck,
  home: House,
  history: PanelLeft,
  image: Image,
  info: Info,
  import: Import,
  json: FileText,
  key: Key,
  lock: Lock,
  knowledge: BookOpen,
  layers: Layers,
  leaf: Sparkles,
  'list-check': ListChecks,
  loader: LoaderCircle,
  map: Map,
  'menu-output': PanelBottom,
  message: MessageSquare,
  mention: AtSign,
  microphone: Mic,
  model: Bot,
  moon: Moon,
  more: Ellipsis,
  network: Network,
  paste: ClipboardPaste,
  power: Power,
  prompt: FileText,
  'provider-key': Key,
  reasoning: Brain,
  'reasoning-advanced': BrainCog,
  'reasoning-deep': BrainCircuit,
  refresh: RefreshCw,
  regenerate: RefreshCw,
  retry: RefreshCw,
  search: Search,
  'search-check': SearchCheck,
  send: SendHorizontal,
  settings: Settings2,
  'settings-sliders': SlidersVertical,
  shield: ShieldCheck,
  sigma: Sigma,
  'slash-command': Slash,
  source: PanelTop,
  spark: Sparkles,
  split: Split,
  star: Star,
  stop: CircleStop,
  sun: Sun,
  table: Table2,
  'toggle-off': ToggleLeft,
  'toggle-on': ToggleRight,
  tools: Wrench,
  trace: GitBranch,
  undo: Undo2,
  upload: Upload,
  voice: Volume2,
  warning: CircleAlert,
  workflow: Workflow,
  zap: CirclePlus,
  close: CircleX,
  shopping: ShoppingBag,
  'new-chat': BadgePlus,
  'context-globe': Earth,
  'memory-brain': Brain,
  'knowledge-database': DatabaseZap,
  'preferences-sliders': SlidersHorizontal,
  'skills-sparkles': Sparkles,
  'mcp-network': Network,
  conversation: MessagesSquare,
} as const satisfies Record<AppIconName, LucideIcon>

const roleAccent = {
  danger: 'danger',
  success: 'success',
  warning: 'warning',
  ai: 'accent',
} as const

type IconRole = keyof typeof roleAccent | 'default'

const iconRoles: Partial<Record<AppIconName, IconRole>> = {
  bot: 'ai',
  code: 'ai',
  diy: 'ai',
  message: 'ai',
  model: 'ai',
  prompt: 'ai',
  reasoning: 'ai',
  'reasoning-advanced': 'ai',
  'reasoning-deep': 'ai',
  'slash-command': 'ai',
  spark: 'ai',
  workflow: 'ai',
  'skills-sparkles': 'ai',
  'new-chat': 'ai',
  delete: 'danger',
  warning: 'warning',
  check: 'success',
  health: 'success',
  leaf: 'success',
  'list-check': 'success',
  'search-check': 'success',
  shield: 'success',
  'toggle-on': 'success',
}

function resolveIconColor(name: AppIconName, requestedColor: string, cartoon: boolean, colors: ReturnType<typeof useAppTheme>['colors']) {
  const role = iconRoles[name] ?? 'default'
  if (!cartoon || role === 'default') return requestedColor
  if (isExplicitIconColor(requestedColor, colors)) return requestedColor
  if (role === 'danger') return colors.ui.tone.danger.foreground
  if (role === 'success') return colors.ui.tone.success.foreground
  if (role === 'warning') return colors.ui.tone.warning.foreground
  if (role === 'ai') return colors.ui.icon.accentForeground
  return requestedColor
}

function isExplicitIconColor(requestedColor: string, colors: ReturnType<typeof useAppTheme>['colors']) {
  return requestedColor === colors.text ||
    requestedColor === colors.textSecondary ||
    requestedColor === colors.textTertiary ||
    requestedColor === colors.ui.control.primaryForeground ||
    requestedColor === colors.ui.control.dangerForeground ||
    requestedColor === colors.ui.tone.danger.foreground ||
    requestedColor === colors.ui.tone.success.foreground ||
    requestedColor === colors.ui.tone.warning.foreground ||
    requestedColor === colors.ui.icon.accentForeground
}

export function AppIcon({
  name,
  color,
  size = appIconSizes.md,
  strokeWidth = appIconStroke.regular,
  fill,
  style,
}: {
  name: AppIconName
  color: string
  size?: number
  strokeWidth?: number
  fill?: string
  style?: StyleProp<TextStyle>
}) {
  const { colors, isCartoon } = useAppTheme()
  const registry = isCartoon ? playfulIconRegistry : cleanIconRegistry
  const IconComponent = registry[name]
  const iconColor = resolveIconColor(name, color, isCartoon, colors)

  return (
    <IconComponent
      color={iconColor}
      size={size}
      strokeWidth={strokeWidth}
      absoluteStrokeWidth
      fill={fill ?? 'none'}
      style={style}
    />
  )
}
