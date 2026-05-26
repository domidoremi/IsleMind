import { useEffect, useState, type ReactNode } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import {
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  Cloud,
  Code2,
  Cpu,
  Leaf,
  LoaderCircle,
  Map,
  MessageCircle,
  MoreHorizontal,
  Search,
  ShoppingBag,
  Sparkles,
  X,
} from 'lucide-react-native'
import { MotiView } from 'moti'
import { PressableScale } from '@/components/ui/PressableScale'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

export type IsleButtonType = 'primary' | 'default' | 'dashed' | 'text' | 'link'
export type IsleButtonSize = 'small' | 'middle' | 'large'
export type IsleInputSize = 'small' | 'middle' | 'large'
export type IsleSwitchSize = 'small' | 'default'
export type IsleCardType = 'default' | 'title' | 'dashed'
export type IsleCardColor =
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
export type IsleDividerType = 'line-brown' | 'line-teal' | 'line-white' | 'line-yellow' | 'wave-yellow'
export type IsleIconName =
  | 'camera'
  | 'chat'
  | 'critterpedia'
  | 'design'
  | 'diy'
  | 'helicopter'
  | 'leaf'
  | 'map'
  | 'miles'
  | 'shopping'
export type IsleFooterType = 'tree' | 'sea'
export type IsleCheckboxSize = 'small' | 'middle' | 'large'

export const ISLE_UI_COMPONENTS = [
  'Button',
  'Input',
  'Switch',
  'Card',
  'Collapse',
  'Cursor',
  'Modal',
  'Typewriter',
  'Divider',
  'Icon',
  'Select',
  'Checkbox',
  'Tabs',
  'Footer',
  'CodeBlock',
  'Loading',
  'Table',
  'Time',
  'Phone',
] as const

export const ICON_LIST: IsleIconName[] = ['camera', 'chat', 'critterpedia', 'design', 'diy', 'helicopter', 'leaf', 'map', 'miles', 'shopping']

export const isleColors = {
  primary: '#19c8b9',
  primaryHover: '#3dd4c6',
  primaryActive: '#11a89b',
  primaryBg: '#e6f9f6',
  success: '#6fba2c',
  warning: '#f5c31c',
  error: '#e05a5a',
  focus: '#ffcc00',
  focusDark: '#e0b800',
  text: '#794f27',
  body: '#725d42',
  secondary: '#9f927d',
  muted: '#8a7b66',
  disabled: '#c4b89e',
  border: '#9f927d',
  borderLight: '#c4b89e',
  bg: '#f8f8f0',
  card: '#f7f3df',
  buttonShadow: '#bdaea0',
  inputShadow: '#d4c9b4',
  codeBg: '#2b2118',
  codeBorder: '#3d3028',
  codeText: '#e8d5bc',
}

export const isleTokens = isleColors

const cardColors: Record<IsleCardColor, { bg: string; fg: string }> = {
  default: { bg: isleColors.card, fg: isleColors.body },
  'app-pink': { bg: '#f8a6b2', fg: '#fff' },
  purple: { bg: '#b77dee', fg: '#fff' },
  'app-blue': { bg: '#889df0', fg: '#fff' },
  'app-yellow': { bg: '#f7cd67', fg: isleColors.body },
  'app-orange': { bg: '#e59266', fg: '#fff' },
  'app-teal': { bg: '#82d5bb', fg: '#fff' },
  'app-green': { bg: '#8ac68a', fg: '#fff' },
  'app-red': { bg: '#fc736d', fg: '#fff' },
  'lime-green': { bg: '#d1da49', fg: '#3d5a1a' },
  'yellow-green': { bg: '#ecdf52', fg: isleColors.body },
  brown: { bg: '#9a835a', fg: '#fff' },
  'warm-peach-pink': { bg: '#e18c6f', fg: '#fff' },
}

function useIslePalette() {
  const { colors, isDark } = useAppTheme()
  return {
    colors,
    isDark,
    surface: isDark ? colors.material.paper : isleColors.bg,
    card: isDark ? colors.material.paperRaised : isleColors.card,
    text: isDark ? colors.text : isleColors.text,
    body: isDark ? colors.textSecondary : isleColors.body,
    secondary: isDark ? colors.textTertiary : isleColors.secondary,
    border: isDark ? colors.borderStrong : isleColors.border,
    borderLight: isDark ? colors.border : isleColors.borderLight,
    shadow: isDark ? colors.shadowTint : isleColors.buttonShadow,
    inputShadow: isDark ? colors.surfaceTertiary : isleColors.inputShadow,
  }
}

function textSize(size: IsleButtonSize | IsleInputSize) {
  if (size === 'small') return 12
  if (size === 'large') return 16
  return 14
}

function controlHeight(size: IsleButtonSize | IsleInputSize) {
  if (size === 'small') return 44
  if (size === 'large') return 48
  return size === 'middle' ? 45 : 44
}

function organicRadius(titleCard: boolean) {
  return titleCard ? 36 : 20
}

export function IsleButton({
  children,
  label,
  icon,
  type = 'default',
  size = 'middle',
  danger = false,
  ghost = false,
  block = false,
  loading = false,
  disabled = false,
  onPress,
  style,
  textStyle,
}: {
  children?: ReactNode
  label?: string
  icon?: ReactNode
  type?: IsleButtonType
  size?: IsleButtonSize
  danger?: boolean
  ghost?: boolean
  block?: boolean
  loading?: boolean
  disabled?: boolean
  onPress?: () => void
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
}) {
  const palette = useIslePalette()
  const motion = useMotionPreference()
  const primary = type === 'primary'
  const link = type === 'link'
  const text = type === 'text' || link
  const height = controlHeight(size)
  const foreground = danger && primary ? '#fff' : link ? isleColors.primary : danger ? isleColors.error : primary ? isleColors.text : palette.text
  const background = ghost || text ? 'transparent' : danger && primary ? isleColors.error : primary ? isleColors.bg : palette.surface
  const borderColor = text ? 'transparent' : danger ? isleColors.error : type === 'dashed' ? palette.borderLight : primary ? isleColors.bg : palette.border
  const shadowColor = danger && primary ? '#c94444' : primary ? isleColors.buttonShadow : palette.shadow
  const pressedOffset = loading ? 0 : size === 'small' ? 3 : 5
  return (
    <PressableScale
      haptic
      disabled={disabled || loading}
      onPress={onPress}
      accessibilityLabel={label}
      scaleTo={0.98}
      style={[
        {
          alignSelf: block ? 'stretch' : 'flex-start',
          minHeight: height,
          borderRadius: size === 'small' ? 12 : size === 'large' ? 24 : 999,
          paddingHorizontal: size === 'small' ? 16 : size === 'large' ? 24 : 20,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: background,
          borderWidth: text ? 0 : 2,
          borderStyle: type === 'dashed' ? 'dashed' : 'solid',
          borderColor,
          opacity: disabled ? 0.5 : 1,
          shadowColor,
          shadowOpacity: text || ghost ? 0 : 1,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: pressedOffset },
          elevation: text || ghost ? 0 : 3,
        },
        style,
      ]}
    >
      {loading ? (
        <MotiView
          animate={motion === 'full' ? { rotate: '360deg' } : { rotate: '0deg' }}
          transition={motion === 'full' ? { loop: true, type: 'timing', duration: 900 } : { type: 'timing', duration: 1 }}
        >
          <LoaderCircle color={foreground} size={14} />
        </MotiView>
      ) : icon ? icon : null}
      {children || label ? (
        <Text style={[{ color: foreground, fontSize: textSize(size), fontWeight: '900', letterSpacing: 0.2 }, textStyle]}>
          {children ?? label}
        </Text>
      ) : null}
    </PressableScale>
  )
}
export function IsleInput({
  label,
  prefix,
  suffix,
  allowClear = false,
  status,
  size = 'middle',
  wrapperStyle,
  inputStyle,
  value,
  onChangeText,
  multiline,
  editable,
  ...props
}: TextInputProps & {
  label?: string
  prefix?: ReactNode
  suffix?: ReactNode
  allowClear?: boolean
  status?: 'error' | 'warning'
  size?: IsleInputSize
  wrapperStyle?: StyleProp<ViewStyle>
  inputStyle?: StyleProp<TextStyle>
}) {
  const palette = useIslePalette()
  const disabled = editable === false
  const borderColor = status === 'error' ? isleColors.error : status === 'warning' ? isleColors.warning : palette.borderLight
  const height = controlHeight(size)
  return (
    <View style={wrapperStyle}>
      {label ? <Text style={{ color: palette.body, fontSize: 12, fontWeight: '900', marginBottom: 6 }}>{label}</Text> : null}
      <View
        style={{
          minHeight: multiline ? 84 : height,
          maxHeight: multiline ? 180 : undefined,
          borderRadius: multiline ? 22 : 999,
          paddingHorizontal: size === 'large' ? 18 : 14,
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          gap: 8,
          backgroundColor: disabled ? palette.colors.material.paperPressed : palette.card,
          borderWidth: size === 'large' ? 3 : 2.5,
          borderColor,
          shadowColor: palette.inputShadow,
          shadowOpacity: disabled ? 0 : 1,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: size === 'small' ? 2 : size === 'large' ? 4 : 3 },
          elevation: disabled ? 0 : 2,
        }}
      >
        {prefix}
        <TextInput
          {...props}
          value={value}
          onChangeText={onChangeText}
          editable={editable}
          multiline={multiline}
          accessibilityLabel={props.accessibilityLabel ?? (typeof label === 'string' ? label : undefined)}
          placeholderTextColor={palette.secondary}
          style={[
            {
              flex: 1,
              minHeight: multiline ? 78 : Math.max(44, height - 4),
              padding: 0,
              paddingVertical: multiline ? 10 : 0,
              color: palette.body,
              fontSize: textSize(size),
          fontWeight: '600',
              lineHeight: multiline ? 20 : undefined,
              textAlignVertical: multiline ? 'top' : 'center',
            },
            inputStyle,
          ]}
        />
        {allowClear && value ? (
          <PressableScale haptic onPress={() => onChangeText?.('')} style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface }}>
            <X color={palette.secondary} size={13} />
          </PressableScale>
        ) : suffix ? suffix : null}
      </View>
    </View>
  )
}

export function IsleSwitch({
  checked,
  defaultChecked = false,
  size = 'default',
  disabled = false,
  loading = false,
  checkedChildren,
  unCheckedChildren,
  onChange,
}: {
  checked?: boolean
  defaultChecked?: boolean
  size?: IsleSwitchSize
  disabled?: boolean
  loading?: boolean
  checkedChildren?: ReactNode
  unCheckedChildren?: ReactNode
  onChange?: (checked: boolean) => void
}) {
  const palette = useIslePalette()
  const motion = useMotionPreference()
  const [internal, setInternal] = useState(defaultChecked)
  const active = checked ?? internal
  const width = size === 'small' ? 38 : 52
  const height = size === 'small' ? 20 : 28
  const knob = size === 'small' ? 14 : 21
  function toggle() {
    if (disabled || loading) return
    const next = !active
    setInternal(next)
    onChange?.(next)
  }
  return (
    <PressableScale
      haptic
      onPress={toggle}
      disabled={disabled || loading}
      style={{
        minWidth: width,
        height,
        borderRadius: height / 2,
        padding: size === 'small' ? 2 : 3,
        justifyContent: 'center',
        backgroundColor: active ? '#86d67a' : '#d4c9b4',
        borderWidth: 2,
        borderColor: active ? isleColors.success : palette.borderLight,
        opacity: disabled ? 0.55 : 1,
        shadowColor: active ? '#5a9e1e' : isleColors.buttonShadow,
        shadowOpacity: 1,
        shadowRadius: 0,
        shadowOffset: { width: 0, height: size === 'small' ? 2 : 3 },
      }}
    >
      <MotiView
        animate={{ translateX: active ? width - knob - (size === 'small' ? 8 : 10) : 0, translateY: -2 }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: 1 }}
        style={{ width: knob, height: knob, borderRadius: knob / 2, backgroundColor: '#fffdf5' }}
      />
      {checkedChildren || unCheckedChildren ? (
        <Text style={{ position: 'absolute', left: active ? 7 : 24, right: active ? 24 : 7, color: '#fff', fontSize: 10, fontWeight: '900', textAlign: active ? 'left' : 'right' }}>
          {active ? checkedChildren : unCheckedChildren}
        </Text>
      ) : null}
    </PressableScale>
  )
}

export function IsleCard({
  children,
  type = 'default',
  color = 'default',
  style,
  contentStyle,
}: {
  children: ReactNode
  type?: IsleCardType
  color?: IsleCardColor
  style?: StyleProp<ViewStyle>
  contentStyle?: StyleProp<ViewStyle>
}) {
  const palette = useIslePalette()
  const selected = cardColors[color]
  const titleCard = type === 'title'
  return (
    <View
      style={[
        {
          borderRadius: organicRadius(titleCard),
          padding: titleCard ? 14 : 16,
          backgroundColor: selected.bg === isleColors.card && palette.isDark ? palette.card : selected.bg,
          borderWidth: type === 'dashed' ? 2 : StyleSheet.hairlineWidth,
          borderStyle: type === 'dashed' ? 'dashed' : 'solid',
          borderColor: type === 'dashed' ? palette.borderLight : 'transparent',
          shadowColor: palette.colors.shadowTint,
          shadowOpacity: type === 'dashed' ? 0 : palette.isDark ? 0.3 : 0.2,
          shadowRadius: type === 'dashed' ? 0 : 12,
          shadowOffset: { width: 0, height: type === 'dashed' ? 0 : 5 },
          elevation: type === 'dashed' ? 0 : 4,
        },
        style,
        contentStyle,
      ]}
    >
      {children}
    </View>
  )
}

export function IsleCollapse({
  question,
  answer,
  defaultExpanded = false,
  disabled = false,
}: {
  question: ReactNode
  answer: ReactNode
  defaultExpanded?: boolean
  disabled?: boolean
}) {
  const palette = useIslePalette()
  const motion = useMotionPreference()
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <IsleCard type="dashed" style={{ opacity: disabled ? 0.55 : 1 }}>
      <PressableScale haptic disabled={disabled} onPress={() => setExpanded((value) => !value)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: isleColors.primary }}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>{expanded ? '-' : '+'}</Text>
        </View>
        <Text style={{ flex: 1, color: palette.text, fontSize: 14, fontWeight: '900' }}>{question}</Text>
        <MotiView animate={{ rotate: expanded ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: motion === 'full' ? 180 : 1 }}>
          <Leaf color={expanded ? isleColors.primary : palette.secondary} size={18} />
        </MotiView>
      </PressableScale>
      {expanded ? (
        <MotiView
          from={motion === 'full' ? { opacity: 0, translateY: 6 } : { opacity: 0 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
        >
          <Text style={{ color: palette.body, fontSize: 13, lineHeight: 19, marginTop: 10 }}>{answer}</Text>
        </MotiView>
      ) : null}
    </IsleCard>
  )
}

export function IsleCursor({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <MotiView style={style}>{children}</MotiView>
}

export function IsleModal({
  open,
  title,
  children,
  footer,
  maskClosable = true,
  onClose,
  onOk,
  typewriter = false,
}: {
  open: boolean
  title?: ReactNode
  children?: ReactNode
  footer?: ReactNode | null
  maskClosable?: boolean
  onClose?: () => void
  onOk?: () => void
  typewriter?: boolean
}) {
  const palette = useIslePalette()
  const motion = useMotionPreference()
  return (
    <Modal transparent visible={open} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
        <Pressable
          onPress={maskClosable ? onClose : undefined}
          accessible={false}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: palette.colors.backdrop }}
        />
        <MotiView
          from={motion === 'full' ? { opacity: 0, scale: 0.94, translateY: 10 } : { opacity: 0 }}
          animate={{ opacity: 1, scale: 1, translateY: 0 }}
          transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: 1 }}
        >
          <IsleCard type="title" style={{ padding: 22, borderRadius: 38 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, color: palette.text, fontSize: 18, fontWeight: '900' }}>{title}</Text>
              <PressableScale haptic onPress={onClose} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface }}>
                <X color={palette.body} size={16} />
              </PressableScale>
            </View>
            <View style={{ marginTop: 12 }}>
              {typewriter && typeof children === 'string' ? <IsleTypewriter>{children}</IsleTypewriter> : children}
            </View>
            {footer !== null ? (
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                {footer ?? (
                  <>
                    <IsleButton label="Cancel" onPress={onClose} />
                    <IsleButton label="OK" type="primary" onPress={onOk} />
                  </>
                )}
              </View>
            ) : null}
          </IsleCard>
        </MotiView>
      </View>
    </Modal>
  )
}

export function IsleTypewriter({ children, speed = 40, trigger, autoPlay = true, onDone, textStyle }: {
  children: ReactNode
  speed?: number
  trigger?: unknown
  autoPlay?: boolean
  onDone?: () => void
  textStyle?: StyleProp<TextStyle>
}) {
  const palette = useIslePalette()
  const text = typeof children === 'string' || typeof children === 'number' ? String(children) : ''
  const [count, setCount] = useState(autoPlay ? 0 : text.length)
  useEffect(() => {
    if (!text) return undefined
    if (!autoPlay) {
      setCount(text.length)
      return undefined
    }
    setCount(0)
    const timer = setInterval(() => {
      setCount((current) => {
        if (current >= text.length) {
          clearInterval(timer)
          onDone?.()
          return current
        }
        return current + 1
      })
    }, speed)
    return () => clearInterval(timer)
  }, [autoPlay, onDone, speed, text, trigger])
  if (!text) return <>{children}</>
  return <Text style={[{ color: palette.body, fontSize: 14, lineHeight: 21, fontWeight: '700' }, textStyle]}>{text.slice(0, count)}</Text>
}

export function IsleDivider({ type = 'line-brown', style }: { type?: IsleDividerType; style?: StyleProp<ViewStyle> }) {
  const color = type === 'line-teal' ? isleColors.primary : type === 'line-yellow' || type === 'wave-yellow' ? '#f1e26f' : type === 'line-white' ? '#fffdf5' : '#d8d0c3'
  const wave = type === 'wave-yellow'
  return (
    <View style={[{ height: 14, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' }, style]}>
      {Array.from({ length: wave ? 18 : 14 }).map((_, index) => (
        <View
          key={index}
          style={{
            width: wave ? 22 : 12,
            height: wave ? 6 : 10,
            borderRadius: 999,
            backgroundColor: color,
            marginHorizontal: wave ? -1 : 5,
            transform: [{ rotate: wave ? `${index % 2 ? -8 : 8}deg` : `${index % 3 === 0 ? 12 : -10}deg` }],
            opacity: type === 'line-white' ? 0.78 : 1,
          }}
        />
      ))}
    </View>
  )
}

export function IsleIcon({ name, size = 24, color }: { name: IsleIconName; size?: number; color?: string }) {
  const palette = useIslePalette()
  const iconColor = color ?? palette.text
  const props = { color: iconColor, size, strokeWidth: 2 }
  switch (name) {
    case 'camera':
      return <Camera {...props} />
    case 'chat':
      return <MessageCircle {...props} />
    case 'critterpedia':
      return <BookOpen {...props} />
    case 'design':
      return <Sparkles {...props} />
    case 'diy':
      return <Code2 {...props} />
    case 'helicopter':
      return <Cloud {...props} />
    case 'map':
      return <Map {...props} />
    case 'miles':
      return <Cpu {...props} />
    case 'shopping':
      return <ShoppingBag {...props} />
    case 'leaf':
    default:
      return <Leaf {...props} />
  }
}

export interface IsleSelectOption {
  label: string
  value: string
  disabled?: boolean
}

export function IsleSelect({ options, value, placeholder = 'Select', disabled = false, onChange, style }: {
  options: IsleSelectOption[]
  value?: string
  placeholder?: string
  disabled?: boolean
  onChange?: (value: string) => void
  style?: StyleProp<ViewStyle>
}) {
  const palette = useIslePalette()
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.value === value)
  return (
    <View style={style}>
      <IsleButton
        label={selected?.label ?? placeholder}
        type="default"
        disabled={disabled}
        icon={<ChevronDown color={palette.body} size={15} />}
        onPress={() => setOpen((current) => !current)}
        style={{ alignSelf: 'stretch', justifyContent: 'space-between' }}
      />
      {open ? (
        <IsleCard style={{ marginTop: 8, gap: 6 }}>
          {options.map((option) => (
            <PressableScale
              key={option.value}
              disabled={option.disabled}
              onPress={() => {
                onChange?.(option.value)
                setOpen(false)
              }}
              style={{ minHeight: 34, borderRadius: 17, paddingHorizontal: 10, justifyContent: 'center', backgroundColor: option.value === value ? isleColors.primaryBg : 'transparent', opacity: option.disabled ? 0.45 : 1 }}
            >
              <Text style={{ color: option.value === value ? isleColors.primaryActive : palette.body, fontSize: 13, fontWeight: '900' }}>{option.label}</Text>
            </PressableScale>
          ))}
        </IsleCard>
      ) : null}
    </View>
  )
}

export interface IsleCheckboxOption {
  label: string
  value: string
  disabled?: boolean
}

export function IsleCheckbox({ options, value = [], size = 'middle', direction = 'vertical', disabled = false, onChange }: {
  options: IsleCheckboxOption[]
  value?: string[]
  size?: IsleCheckboxSize
  direction?: 'horizontal' | 'vertical'
  disabled?: boolean
  onChange?: (value: string[]) => void
}) {
  const palette = useIslePalette()
  const box = size === 'small' ? 18 : size === 'large' ? 28 : 22
  const fontSize = size === 'small' ? 12 : size === 'large' ? 16 : 14
  function toggle(option: IsleCheckboxOption) {
    if (disabled || option.disabled) return
    const next = value.includes(option.value) ? value.filter((item) => item !== option.value) : [...value, option.value]
    onChange?.(next)
  }
  return (
    <View style={{ flexDirection: direction === 'horizontal' ? 'row' : 'column', gap: direction === 'horizontal' ? 12 : 8, flexWrap: 'wrap' }}>
      {options.map((option) => {
        const active = value.includes(option.value)
        return (
          <PressableScale key={option.value} haptic disabled={disabled || option.disabled} onPress={() => toggle(option)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: disabled || option.disabled ? 0.55 : 1 }}>
            <View style={{ width: box, height: box, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? isleColors.primary : palette.card, borderWidth: 2, borderColor: active ? isleColors.primaryActive : palette.borderLight }}>
              {active ? <Check color="#fff" size={box * 0.62} strokeWidth={3} /> : null}
            </View>
            <Text style={{ color: palette.body, fontSize, fontWeight: '700' }}>{option.label}</Text>
          </PressableScale>
        )
      })}
    </View>
  )
}

export interface IsleTabItem {
  key: string
  label: string
  disabled?: boolean
}

export function IsleTabs({ items, activeKey, onChange, style }: { items: IsleTabItem[]; activeKey: string; onChange?: (key: string) => void; style?: StyleProp<ViewStyle> }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={style}>
      {items.map((item) => (
        <IsleButton
          key={item.key}
          label={item.label}
          type={activeKey === item.key ? 'primary' : 'default'}
          size="small"
          disabled={item.disabled}
          icon={activeKey === item.key ? <Leaf color={isleColors.primaryActive} size={13} /> : undefined}
          onPress={() => onChange?.(item.key)}
        />
      ))}
    </ScrollView>
  )
}

export function IsleFooter({ type = 'tree', style }: { type?: IsleFooterType; style?: StyleProp<ViewStyle> }) {
  const colors = type === 'sea' ? ['#327a93', '#98d2e3', '#008077'] : ['#8ac68a', '#6fba2c', '#d1da49']
  return (
    <View style={[{ height: type === 'sea' ? 56 : 44, overflow: 'hidden', justifyContent: 'flex-end' }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: type === 'sea' ? 0 : 6 }}>
        {Array.from({ length: type === 'sea' ? 16 : 12 }).map((_, index) => (
          <View
            key={index}
            style={{
              flex: 1,
              height: type === 'sea' ? 18 + (index % 3) * 8 : 22 + (index % 4) * 5,
              borderTopLeftRadius: 999,
              borderTopRightRadius: 999,
              backgroundColor: colors[index % colors.length],
              opacity: 0.86,
            }}
          />
        ))}
      </View>
    </View>
  )
}

export function IsleCodeBlock({ code, style }: { code: string; style?: StyleProp<ViewStyle> }) {
  return (
    <ScrollView horizontal style={[{ borderRadius: 20, backgroundColor: isleColors.codeBg, borderWidth: 1, borderColor: isleColors.codeBorder }, style]} contentContainerStyle={{ padding: 16 }}>
      <Text style={{ color: isleColors.codeText, fontSize: 12, lineHeight: 20, fontFamily: 'monospace', fontWeight: '700' }}>{code}</Text>
    </ScrollView>
  )
}

export function IsleLoading({ label, style }: { label?: string; style?: StyleProp<ViewStyle> }) {
  const palette = useIslePalette()
  const motion = useMotionPreference()
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center', padding: 16 }, style]}>
      <View style={{ width: 76, height: 44, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: isleColors.primaryBg, borderWidth: 2, borderColor: isleColors.primary }}>
        <View style={{ flexDirection: 'row', gap: 5 }}>
          {[0, 1, 2].map((index) => (
            <MotiView
              key={index}
              animate={motion === 'full' ? { translateY: [-2, -8, -2], scale: [1, 1.12, 1] } : { translateY: 0, scale: 1 }}
              transition={motion === 'full' ? { loop: true, type: 'timing', duration: 900, delay: index * 110 } : { type: 'timing', duration: 1 }}
              style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: isleColors.primary }}
            />
          ))}
        </View>
      </View>
      {label ? <Text style={{ color: palette.body, fontSize: 12, fontWeight: '900', marginTop: 8 }}>{label}</Text> : null}
    </View>
  )
}

export interface IsleTableColumn<T extends Record<string, unknown> = Record<string, unknown>> {
  title: string
  dataIndex: keyof T | string
  width?: number
  render?: (value: unknown, record: T, index: number) => ReactNode
}

export function IsleTable<T extends Record<string, unknown>>({ columns, data, emptyText = 'No data' }: { columns: IsleTableColumn<T>[]; data: T[]; emptyText?: string }) {
  const palette = useIslePalette()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ minWidth: 280, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: palette.borderLight, backgroundColor: palette.card }}>
        <View style={{ flexDirection: 'row', backgroundColor: isleColors.primaryBg }}>
          {columns.map((column) => (
            <Text key={String(column.dataIndex)} style={{ width: column.width ?? 120, padding: 10, color: palette.text, fontSize: 12, fontWeight: '900' }}>{column.title}</Text>
          ))}
        </View>
        {data.length ? data.map((row, index) => (
          <View key={index} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: palette.borderLight }}>
            {columns.map((column) => (
              <Text key={String(column.dataIndex)} numberOfLines={2} style={{ width: column.width ?? 120, padding: 10, color: palette.body, fontSize: 12, lineHeight: 17, fontWeight: '700' }}>
                {column.render ? column.render(row[column.dataIndex], row, index) : String(row[column.dataIndex] ?? '')}
              </Text>
            ))}
          </View>
        )) : (
          <View style={{ padding: 18, alignItems: 'center' }}>
            <Leaf color={palette.secondary} size={24} />
            <Text style={{ color: palette.secondary, fontSize: 12, fontWeight: '800', marginTop: 6 }}>{emptyText}</Text>
          </View>
        )}
      </View>
    </ScrollView>
  )
}

export function IsleTime({ style }: { style?: StyleProp<ViewStyle> }) {
  const palette = useIslePalette()
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 18, backgroundColor: palette.surface, borderWidth: 3, borderColor: '#d4cfc3' }, style]}>
      <View style={{ paddingRight: 16, borderRightWidth: 3, borderRightColor: 'rgba(159, 146, 125, 0.35)' }}>
        <Text style={{ color: isleColors.success, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 }}>{weekdays[time.getDay()]}</Text>
        <Text style={{ color: palette.body, fontSize: 18, fontWeight: '900' }}>{time.getMonth() + 1}/{time.getDate()}</Text>
      </View>
      <Text style={{ color: palette.body, fontSize: 32, fontWeight: '900', letterSpacing: 1 }}>
        {time.getHours().toString().padStart(2, '0')}:{time.getMinutes().toString().padStart(2, '0')}
      </Text>
    </View>
  )
}

export function IslePhone({ title = 'IsleMind', style }: { title?: string; style?: StyleProp<ViewStyle> }) {
  const palette = useIslePalette()
  const apps: { name: IsleIconName; color: IsleCardColor }[] = [
    { name: 'camera', color: 'purple' },
    { name: 'chat', color: 'app-blue' },
    { name: 'critterpedia', color: 'app-yellow' },
    { name: 'diy', color: 'app-orange' },
    { name: 'shopping', color: 'app-pink' },
    { name: 'design', color: 'app-green' },
  ]
  return (
    <View style={[{ width: 188, borderRadius: 46, padding: 14, backgroundColor: palette.surface, borderWidth: 2, borderColor: palette.borderLight }, style]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: palette.body, fontSize: 12, fontWeight: '900' }}>{title}</Text>
        <MoreHorizontal color={palette.secondary} size={18} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
        {apps.map((app) => (
          <View key={app.name} style={{ width: 44, height: 44, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: cardColors[app.color].bg }}>
            <IsleIcon name={app.name} color={cardColors[app.color].fg} size={20} />
          </View>
        ))}
      </View>
      <IsleDivider type="line-yellow" style={{ marginTop: 14 }} />
    </View>
  )
}
