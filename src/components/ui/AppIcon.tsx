import type { ComponentType } from 'react'
import type { StyleProp, TextStyle } from 'react-native'
import type { LucideProps } from 'lucide-react-native'
import Activity from 'lucide-react-native/icons/activity'
import ArrowDown from 'lucide-react-native/icons/arrow-down'
import ArrowRight from 'lucide-react-native/icons/arrow-right'
import ArrowUp from 'lucide-react-native/icons/arrow-up'
import AtSign from 'lucide-react-native/icons/at-sign'
import BookOpenText from 'lucide-react-native/icons/book-open-text'
import Bot from 'lucide-react-native/icons/bot'
import Brain from 'lucide-react-native/icons/brain'
import BrainCircuit from 'lucide-react-native/icons/brain-circuit'
import BrainCog from 'lucide-react-native/icons/brain-cog'
import Camera from 'lucide-react-native/icons/camera'
import ChartNoAxesColumnIncreasing from 'lucide-react-native/icons/chart-no-axes-column-increasing'
import Check from 'lucide-react-native/icons/check'
import ChevronDown from 'lucide-react-native/icons/chevron-down'
import ChevronLeft from 'lucide-react-native/icons/chevron-left'
import ChevronRight from 'lucide-react-native/icons/chevron-right'
import CircleStop from 'lucide-react-native/icons/circle-stop'
import ClipboardPaste from 'lucide-react-native/icons/clipboard-paste'
import Cloud from 'lucide-react-native/icons/cloud'
import Compass from 'lucide-react-native/icons/compass'
import Copy from 'lucide-react-native/icons/copy'
import Cpu from 'lucide-react-native/icons/cpu'
import DatabaseZap from 'lucide-react-native/icons/database-zap'
import Download from 'lucide-react-native/icons/download'
import Earth from 'lucide-react-native/icons/earth'
import Ellipsis from 'lucide-react-native/icons/ellipsis'
import ExternalLink from 'lucide-react-native/icons/external-link'
import FileText from 'lucide-react-native/icons/file-text'
import GitBranch from 'lucide-react-native/icons/git-branch'
import GripVertical from 'lucide-react-native/icons/grip-vertical'
import HeartPulse from 'lucide-react-native/icons/heart-pulse'
import History from 'lucide-react-native/icons/rotate-ccw-clock'
import House from 'lucide-react-native/icons/house'
import Image from 'lucide-react-native/icons/image'
import Import from 'lucide-react-native/icons/import'
import Info from 'lucide-react-native/icons/info'
import Key from 'lucide-react-native/icons/key'
import KeySquare from 'lucide-react-native/icons/key-square'
import Layers from 'lucide-react-native/icons/layers'
import Leaf from 'lucide-react-native/icons/leaf'
import ListChecks from 'lucide-react-native/icons/list-checks'
import LoaderCircle from 'lucide-react-native/icons/loader-circle'
import Lock from 'lucide-react-native/icons/lock'
import Map from 'lucide-react-native/icons/map'
import Menu from 'lucide-react-native/icons/menu'
import MessageSquare from 'lucide-react-native/icons/message-square'
import MessageSquarePlus from 'lucide-react-native/icons/message-square-plus'
import MessagesSquare from 'lucide-react-native/icons/messages-square'
import Mic from 'lucide-react-native/icons/mic'
import Moon from 'lucide-react-native/icons/moon'
import Network from 'lucide-react-native/icons/network'
import NotebookPen from 'lucide-react-native/icons/notebook-pen'
import PanelBottom from 'lucide-react-native/icons/panel-bottom'
import PanelLeft from 'lucide-react-native/icons/panel-left'
import Paperclip from 'lucide-react-native/icons/paperclip'
import Plus from 'lucide-react-native/icons/plus'
import Power from 'lucide-react-native/icons/power'
import RefreshCw from 'lucide-react-native/icons/refresh-cw'
import Search from 'lucide-react-native/icons/search'
import SearchCheck from 'lucide-react-native/icons/search-check'
import SendHorizontal from 'lucide-react-native/icons/send-horizontal'
import Settings2 from 'lucide-react-native/icons/settings-2'
import Shield from 'lucide-react-native/icons/shield'
import ShoppingBag from 'lucide-react-native/icons/shopping-bag'
import Sigma from 'lucide-react-native/icons/sigma'
import Slash from 'lucide-react-native/icons/slash'
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal'
import SlidersVertical from 'lucide-react-native/icons/sliders-vertical'
import Smartphone from 'lucide-react-native/icons/smartphone'
import Sparkles from 'lucide-react-native/icons/sparkles'
import Split from 'lucide-react-native/icons/split'
import SquarePen from 'lucide-react-native/icons/square-pen'
import SquareTerminal from 'lucide-react-native/icons/square-terminal'
import Star from 'lucide-react-native/icons/star'
import Sun from 'lucide-react-native/icons/sun'
import Table2 from 'lucide-react-native/icons/table-2'
import Terminal from 'lucide-react-native/icons/terminal'
import ToggleLeft from 'lucide-react-native/icons/toggle-left'
import ToggleRight from 'lucide-react-native/icons/toggle-right'
import Trash2 from 'lucide-react-native/icons/trash-2'
import TriangleAlert from 'lucide-react-native/icons/triangle-alert'
import Undo2 from 'lucide-react-native/icons/undo-2'
import Upload from 'lucide-react-native/icons/upload'
import Volume2 from 'lucide-react-native/icons/volume-2'
import Workflow from 'lucide-react-native/icons/workflow'
import Wrench from 'lucide-react-native/icons/wrench'
import X from 'lucide-react-native/icons/x'
import Zap from 'lucide-react-native/icons/zap'
import { useAppTheme } from '@/hooks/useAppTheme'

type LucideIcon = ComponentType<LucideProps>

export const appIconSizes = {
  xs: 12,
  sm: 16,
  md: 18,
  lg: 20,
  xl: 24,
} as const

export const appIconStroke = {
  fine: 1.6,
  regular: 1.8,
  strong: 2,
  bold: 2.2,
} as const

export type AppIconName =
  | 'activity'
  | 'add'
  | 'arrow-right'
  | 'arrow-down'
  | 'arrow-up'
  | 'attachment'
  | 'back-previous'
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
  | 'menu'
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

/** One semantic glyph registry keeps the same action recognizable in every theme. */
const appIconRegistry = {
  activity: Activity,
  add: Plus,
  'arrow-right': ArrowRight,
  'arrow-down': ArrowDown,
  'arrow-up': ArrowUp,
  attachment: Paperclip,
  'back-previous': ChevronLeft,
  'back-next': ChevronRight,
  bot: Bot,
  camera: Camera,
  chart: ChartNoAxesColumnIncreasing,
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
  health: HeartPulse,
  home: House,
  history: History,
  image: Image,
  info: Info,
  import: Import,
  json: FileText,
  key: Key,
  lock: Lock,
  knowledge: BookOpenText,
  layers: Layers,
  leaf: Leaf,
  'list-check': ListChecks,
  loader: LoaderCircle,
  map: Map,
  'menu-output': PanelBottom,
  message: MessageSquare,
  menu: Menu,
  mention: AtSign,
  microphone: Mic,
  model: Bot,
  moon: Moon,
  more: Ellipsis,
  network: Network,
  paste: ClipboardPaste,
  power: Power,
  prompt: FileText,
  'provider-key': KeySquare,
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
  zap: Zap,
  close: X,
  shopping: ShoppingBag,
  'new-chat': MessageSquarePlus,
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

function resolveIconColor(name: AppIconName, requestedColor: string, limeRoad: boolean, colors: ReturnType<typeof useAppTheme>['colors']) {
  const role = iconRoles[name] ?? 'default'
  if (!limeRoad || role === 'default') return requestedColor
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
  strokeWidth,
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
  const { colors, isLimeRoad } = useAppTheme()
  const IconComponent = appIconRegistry[name]
  const iconColor = resolveIconColor(name, color, isLimeRoad, colors)
  const resolvedStrokeWidth = strokeWidth ?? opticalStrokeWidth(size)

  return (
    <IconComponent
      color={iconColor}
      size={size}
      strokeWidth={resolvedStrokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeMiterlimit={10}
      absoluteStrokeWidth
      fill={fill ?? 'none'}
      style={style}
    />
  )
}

function opticalStrokeWidth(size: number): number {
  if (size <= appIconSizes.xs) return appIconStroke.strong
  if (size >= appIconSizes.xl) return appIconStroke.fine
  return appIconStroke.regular
}
