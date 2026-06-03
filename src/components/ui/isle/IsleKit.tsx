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
import { AnimatePresence, MotiView } from 'moti'
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
export type IsleTitleSize = 'small' | 'middle' | 'large'
export type IsleTitleVariant = 'ribbon' | 'cloud'

export const ISLE_UI_COMPONENTS = [
  'Title',
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

const titleMetrics: Record<IsleTitleSize, { fontSize: number; lineHeight: number; minHeight: number; paddingHorizontal: number }> = {
  small: { fontSize: 14, lineHeight: 18, minHeight: 34, paddingHorizontal: 16 },
  middle: { fontSize: 20, lineHeight: 24, minHeight: 44, paddingHorizontal: 22 },
  large: { fontSize: 28, lineHeight: 34, minHeight: 56, paddingHorizontal: 28 },
}

function useIslePalette() {
  const { colors, isDark, themeId } = useAppTheme()
  return {
    colors,
    isDark,
    themeId,
    ui: colors.ui,
    minimal: colors.ui.minimal,
    surface: colors.material.paper,
    card: colors.ui.card.defaultBackground,
    text: colors.text,
    body: colors.textSecondary,
    secondary: colors.textTertiary,
    border: colors.borderStrong,
    borderLight: colors.border,
    shadow: colors.shadowTint,
    inputShadow: colors.ui.input.shadow,
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

function organicRadius(titleCard: boolean, palette: ReturnType<typeof useIslePalette>) {
  return titleCard ? palette.ui.radius.titleCard : palette.ui.radius.card
}

function controlRadius(size: IsleButtonSize | IsleInputSize, palette: ReturnType<typeof useIslePalette>) {
  if (size === 'small') return palette.ui.radius.controlSmall
  if (size === 'large') return palette.ui.radius.controlLarge
  return palette.ui.radius.controlMiddle
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
  const control = palette.ui.control
  const primary = type === 'primary'
  const link = type === 'link'
  const text = type === 'text' || link
  const height = controlHeight(size)
  const fontSize = textSize(size)
  const foreground = danger && primary ? '#fff' : link ? control.link : danger ? palette.colors.error : primary ? control.primaryForeground : palette.text
  const background = ghost || text ? 'transparent' : danger && primary ? palette.colors.error : primary ? control.primaryBackground : control.defaultBackground
  const borderColor = text ? 'transparent' : danger ? palette.colors.error : type === 'dashed' ? palette.borderLight : primary ? control.primaryBorder : palette.border
  const shadowColor = danger && primary ? control.dangerShadow : control.shadow
  const shadowOpacity = text || ghost ? 0 : primary ? control.primaryShadowOpacity : control.secondaryShadowOpacity
  const shadowRadius = primary ? control.primaryShadowRadius : control.secondaryShadowRadius
  const pressedOffset = loading ? 0 : primary ? control.primaryShadowOffset : control.secondaryShadowOffset
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
          borderRadius: controlRadius(size, palette),
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
          shadowOpacity,
          shadowRadius,
          shadowOffset: { width: 0, height: pressedOffset },
          elevation: text || ghost ? 0 : primary ? 3 : 1,
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
        <Text style={[{ color: foreground, fontSize, lineHeight: Math.max(16, fontSize + 4), fontWeight: '900', letterSpacing: 0, includeFontPadding: false, textAlignVertical: 'center' }, textStyle]}>
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
  onBlur,
  onFocus,
  multiline,
  editable,
  shadow = false,
  ...props
}: TextInputProps & {
  label?: string
  prefix?: ReactNode
  suffix?: ReactNode
  allowClear?: boolean
  status?: 'error' | 'warning'
  size?: IsleInputSize
  shadow?: boolean
  wrapperStyle?: StyleProp<ViewStyle>
  inputStyle?: StyleProp<TextStyle>
}) {
  const palette = useIslePalette()
  const motion = useMotionPreference()
  const [focused, setFocused] = useState(false)
  const disabled = editable === false
  const input = palette.ui.input
  const borderColor = status === 'error' ? palette.colors.error : status === 'warning' ? palette.colors.warning : input.border
  const activeBorderColor = focused && !disabled ? input.focus : borderColor
  const statusShadow = status === 'error' ? palette.colors.error : status === 'warning' ? palette.colors.warning : input.shadow
  const shadowEnabled = shadow || !!status
  const height = controlHeight(size)
  return (
    <View style={wrapperStyle}>
      {label ? <Text style={{ color: palette.body, fontSize: 12, fontWeight: '900', marginBottom: 6 }}>{label}</Text> : null}
      <MotiView
        animate={{
          backgroundColor: disabled ? input.disabledBackground : focused ? input.backgroundFocused : input.background,
          borderColor: activeBorderColor,
          scale: focused && !multiline ? 1.006 : 1,
        }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: 1 }}
        style={{
          minHeight: multiline ? 84 : height,
          maxHeight: multiline ? 180 : undefined,
          borderRadius: multiline ? palette.ui.radius.field : controlRadius(size, palette),
          paddingHorizontal: size === 'large' ? 18 : 14,
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          gap: 8,
          borderWidth: size === 'large' ? 3 : 2.5,
          shadowColor: statusShadow,
          shadowOpacity: disabled || !shadowEnabled ? 0 : input.shadowOpacity,
          shadowRadius: shadowEnabled ? input.shadowRadius : 0,
          shadowOffset: { width: 0, height: size === 'small' ? 2 : size === 'large' ? 4 : 3 },
          elevation: disabled || !shadowEnabled ? 0 : 1,
        }}
      >
        {prefix}
        <TextInput
          {...props}
          value={value}
          onChangeText={onChangeText}
          onBlur={(event) => {
            setFocused(false)
            onBlur?.(event)
          }}
          onFocus={(event) => {
            setFocused(true)
            onFocus?.(event)
          }}
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
              includeFontPadding: false,
            },
            inputStyle,
          ]}
        />
        {allowClear && value ? (
          <PressableScale haptic onPress={() => onChangeText?.('')} style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.colors.pressed }}>
            <X color={palette.secondary} size={13} />
          </PressableScale>
        ) : suffix ? suffix : null}
      </MotiView>
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
  const switchTokens = palette.ui.switch
  const width = size === 'small' ? 38 : 52
  const height = size === 'small' ? 20 : 28
  const borderWidth = 2
  const thumbInset = size === 'small' ? 3 : 3
  const knob = height - thumbInset * 2
  const thumbTravel = width - knob - thumbInset * 2
  const switchTextColor = active ? palette.colors.primaryForeground : palette.colors.textSecondary
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
        width,
        height,
        borderRadius: height / 2,
        alignItems: 'flex-start',
        justifyContent: 'center',
        backgroundColor: active ? switchTokens.trackOn : switchTokens.trackOff,
        opacity: disabled ? 0.55 : 1,
        shadowColor: active ? switchTokens.trackOnBorder : switchTokens.trackOffBorder,
        shadowOpacity: switchTokens.shadowOpacity,
        shadowRadius: 0,
        shadowOffset: { width: 0, height: 0 },
      }}
    >
      <MotiView
        animate={{
          backgroundColor: active ? switchTokens.trackOn : switchTokens.trackOff,
          borderColor: active ? switchTokens.trackOnBorder : switchTokens.trackOffBorder,
        }}
        transition={motion === 'full' ? { type: 'timing', duration: motionTokens.duration.fast } : { type: 'timing', duration: 1 }}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: height / 2, borderWidth }}
      />
      <MotiView
        animate={{ translateX: active ? thumbTravel : 0, scale: loading ? 0.88 : 1 }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: 1 }}
        style={{
          position: 'absolute',
          top: thumbInset,
          left: thumbInset,
          width: knob,
          height: knob,
          borderRadius: knob / 2,
          backgroundColor: switchTokens.thumb,
          borderWidth: 1,
          borderColor: active ? switchTokens.thumbOnBorder : switchTokens.thumbOffBorder,
          shadowColor: 'transparent',
          shadowOpacity: 0,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 0 },
          elevation: 0,
        }}
      />
      {checkedChildren || unCheckedChildren ? (
        <Text style={{ position: 'absolute', top: 0, bottom: 0, left: active ? 7 : knob + thumbInset + 4, right: active ? knob + thumbInset + 4 : 7, color: switchTextColor, fontSize: 10, lineHeight: height, fontWeight: '900', textAlign: active ? 'left' : 'right', includeFontPadding: false, textAlignVertical: 'center' }}>
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
  const selected = palette.colors.cardColors[color]
  const titleCard = type === 'title'
  const uiCard = palette.ui.card
  return (
    <View
      style={[
        {
          borderRadius: organicRadius(titleCard, palette),
          padding: titleCard ? 14 : 16,
          backgroundColor: color === 'default' ? uiCard.defaultBackground : selected.bg,
          borderWidth: type === 'dashed' ? 2 : StyleSheet.hairlineWidth,
          borderStyle: type === 'dashed' ? 'dashed' : 'solid',
          borderColor: type === 'dashed' ? palette.borderLight : palette.minimal ? palette.borderLight : 'transparent',
          shadowColor: palette.colors.shadowTint,
          shadowOpacity: type === 'dashed' ? 0 : uiCard.shadowOpacity,
          shadowRadius: type === 'dashed' ? 0 : uiCard.shadowRadius,
          shadowOffset: { width: 0, height: type === 'dashed' ? 0 : uiCard.shadowOffset },
          elevation: type === 'dashed' ? 0 : palette.minimal ? 1 : 0,
        },
        style,
        contentStyle,
      ]}
    >
      {children}
    </View>
  )
}

export function IsleTitle({
  children,
  title,
  size = 'middle',
  color = 'app-teal',
  variant = 'ribbon',
  align = 'left',
  style,
  textStyle,
}: {
  children?: ReactNode
  title?: string
  size?: IsleTitleSize
  color?: IsleCardColor
  variant?: IsleTitleVariant
  align?: 'left' | 'center' | 'right'
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
}) {
  const palette = useIslePalette()
  const motion = useMotionPreference()
  const selected = palette.colors.cardColors[color]
  const metrics = titleMetrics[size]
  const background = color === 'default' ? palette.colors.primary : selected.bg
  const foreground = color === 'default' ? palette.text : selected.fg
  const content = children ?? title
  const selfAlignment = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'
  const titleText = typeof content === 'string' || typeof content === 'number'
  const outerHeight = metrics.minHeight + 6
  const cloudLeftSize = metrics.minHeight * 0.62
  const cloudRightSize = metrics.minHeight * 0.68
  const wingWidth = metrics.minHeight * 0.46
  const wingHeight = metrics.minHeight * 0.52
  const titleBorder = palette.minimal ? palette.borderLight : palette.colors.highlight

  const label = titleText ? (
    <Text
      numberOfLines={2}
      style={[
        {
          color: foreground,
          fontSize: metrics.fontSize,
          lineHeight: metrics.lineHeight,
          fontWeight: '900',
          includeFontPadding: false,
          textAlign: 'center',
          textAlignVertical: 'center',
        },
        textStyle,
      ]}
    >
      {content}
    </Text>
  ) : (
    content
  )

  if (palette.minimal) {
    return (
      <MotiView
        from={motion === 'full' ? { opacity: 0, translateY: 4 } : { opacity: 0 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={motion === 'full' ? { type: 'timing', duration: motionTokens.duration.fast } : { type: 'timing', duration: 1 }}
        style={[
          {
            alignSelf: selfAlignment,
            minHeight: Math.max(30, metrics.minHeight - 10),
            flexDirection: 'row',
            alignItems: 'center',
            gap: 9,
            paddingVertical: 4,
            paddingRight: 6,
          },
          style,
        ]}
      >
        <View style={{ width: 3, height: Math.max(18, metrics.lineHeight), borderRadius: 999, backgroundColor: palette.colors.primary }} />
        {titleText ? (
          <Text
            numberOfLines={2}
            style={[
              {
                color: palette.text,
                fontSize: Math.max(15, metrics.fontSize - 5),
                lineHeight: Math.max(20, metrics.lineHeight - 3),
                fontWeight: '800',
                includeFontPadding: false,
                textAlign: align,
                textAlignVertical: 'center',
              },
              textStyle,
            ]}
          >
            {content}
          </Text>
        ) : (
          content
        )}
      </MotiView>
    )
  }

  if (variant === 'cloud') {
    return (
      <MotiView
        from={motion === 'full' ? { opacity: 0, translateY: 6, scale: 0.97 } : { opacity: 0 }}
        animate={{ opacity: 1, translateY: 0, scale: 1 }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
        style={[{ alignSelf: selfAlignment, minHeight: outerHeight, justifyContent: 'center', paddingHorizontal: 8 }, style]}
      >
        <View style={{ position: 'absolute', left: metrics.minHeight * 0.48, top: (outerHeight - cloudLeftSize) / 2, width: cloudLeftSize, height: cloudLeftSize, borderRadius: metrics.minHeight, backgroundColor: background, opacity: 0.5 }} />
        <View style={{ position: 'absolute', right: metrics.minHeight * 0.56, top: (outerHeight - cloudRightSize) / 2, width: cloudRightSize, height: cloudRightSize, borderRadius: metrics.minHeight, backgroundColor: background, opacity: 0.46 }} />
        <View
          style={{
            minHeight: metrics.minHeight,
            minWidth: metrics.minHeight * 2.6,
            borderRadius: metrics.minHeight / 2,
            paddingHorizontal: metrics.paddingHorizontal,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: background,
            borderWidth: 2,
            borderColor: titleBorder,
            shadowColor: palette.colors.shadowTint,
            shadowOpacity: palette.isDark ? 0.24 : 0.18,
            shadowRadius: 0,
            shadowOffset: { width: 0, height: 4 },
            elevation: 2,
          }}
        >
          {label}
        </View>
      </MotiView>
    )
  }

  return (
    <MotiView
      from={motion === 'full' ? { opacity: 0, translateY: 6, scale: 0.97 } : { opacity: 0 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
      style={[{ alignSelf: selfAlignment, minHeight: outerHeight, justifyContent: 'center', paddingHorizontal: 10 }, style]}
    >
      <View
        style={{
          position: 'absolute',
          left: 3,
          top: (outerHeight - wingHeight) / 2,
          width: wingWidth,
          height: wingHeight,
          borderRadius: 8,
          backgroundColor: background,
          opacity: 0.58,
          transform: [{ rotate: '-8deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: 3,
          top: (outerHeight - wingHeight) / 2,
          width: wingWidth,
          height: wingHeight,
          borderRadius: 8,
          backgroundColor: background,
          opacity: 0.58,
          transform: [{ rotate: '8deg' }],
        }}
      />
      <View
        style={{
          minHeight: metrics.minHeight,
          minWidth: metrics.minHeight * 2.5,
          borderRadius: metrics.minHeight / 2,
          paddingHorizontal: metrics.paddingHorizontal,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: background,
          borderWidth: 2,
          borderColor: titleBorder,
          shadowColor: palette.colors.shadowTint,
          shadowOpacity: palette.isDark ? 0.26 : 0.2,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        }}
      >
        {label}
      </View>
    </MotiView>
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
  const controlForeground = palette.colors.primaryForeground
  return (
    <IsleCard type="dashed" style={{ opacity: disabled ? 0.55 : 1 }}>
      <PressableScale haptic disabled={disabled} onPress={() => setExpanded((value) => !value)} style={{ minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.colors.primary }}>
          <Text style={{ color: controlForeground, fontSize: 18, lineHeight: 22, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{expanded ? '-' : '+'}</Text>
        </View>
        <Text style={{ flex: 1, color: palette.text, fontSize: 14, lineHeight: 19, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{question}</Text>
        <MotiView animate={{ rotate: expanded ? '180deg' : '0deg', scale: expanded ? 1.06 : 1 }} transition={{ type: 'timing', duration: motion === 'full' ? 180 : 1 }}>
          <Leaf color={expanded ? palette.colors.primary : palette.secondary} size={18} />
        </MotiView>
      </PressableScale>
      <AnimatePresence>
        {expanded ? (
          <MotiView
            key="isle-collapse-answer"
            from={motion === 'full' ? { opacity: 0, translateY: 6, scale: 0.985 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4, scale: 0.985 } : { opacity: 0 }}
            transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
          >
            <Text style={{ color: palette.body, fontSize: 13, lineHeight: 19, marginTop: 10, includeFontPadding: false }}>{answer}</Text>
          </MotiView>
        ) : null}
      </AnimatePresence>
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
          <IsleCard type="title" style={{ padding: 22, borderRadius: palette.ui.radius.modal }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, color: palette.text, fontSize: 18, fontWeight: '900' }}>{title}</Text>
              <PressableScale haptic onPress={onClose} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.colors.pressed }}>
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
  const palette = useIslePalette()
  const color = type === 'line-teal' ? palette.colors.primary : type === 'line-yellow' || type === 'wave-yellow' ? palette.colors.accent : type === 'line-white' ? palette.colors.material.paper : palette.borderLight
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
  const motion = useMotionPreference()
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.value === value)
  return (
    <View style={style}>
      <IsleButton
        label={selected?.label ?? placeholder}
        type="default"
        disabled={disabled}
        icon={
          <MotiView
            animate={{ rotate: open ? '180deg' : '0deg', scale: open ? 1.08 : 1 }}
            transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
            style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}
          >
            <ChevronDown color={palette.body} size={15} />
          </MotiView>
        }
        onPress={() => setOpen((current) => !current)}
        style={{ alignSelf: 'stretch', justifyContent: 'space-between' }}
      />
      <AnimatePresence>
        {open ? (
          <MotiView
            key="isle-select-options"
            from={motion === 'full' ? { opacity: 0, translateY: -4, scale: 0.985 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4, scale: 0.985 } : { opacity: 0 }}
            transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
          >
            <IsleCard style={{ marginTop: 8, gap: 6 }}>
              {options.map((option) => (
                <PressableScale
                  key={option.value}
                  disabled={option.disabled}
                  onPress={() => {
                    onChange?.(option.value)
                    setOpen(false)
                  }}
                  style={{ minHeight: 34, borderRadius: 17, paddingHorizontal: 10, justifyContent: 'center', opacity: option.disabled ? 0.45 : 1 }}
                >
                  <MotiView
                    animate={{ backgroundColor: option.value === value ? palette.colors.mintSoft : 'transparent', scale: option.value === value ? 1.01 : 1 }}
                    transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
                    style={{ minHeight: 34, borderRadius: 17, paddingHorizontal: 10, justifyContent: 'center', marginHorizontal: -10 }}
                  >
                    <Text style={{ color: option.value === value ? palette.colors.primary : palette.body, fontSize: 13, lineHeight: 18, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{option.label}</Text>
                  </MotiView>
                </PressableScale>
              ))}
            </IsleCard>
          </MotiView>
        ) : null}
      </AnimatePresence>
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
  const motion = useMotionPreference()
  const box = size === 'small' ? 18 : size === 'large' ? 28 : 22
  const fontSize = size === 'small' ? 12 : size === 'large' ? 16 : 14
  const checkColor = palette.colors.primaryForeground
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
          <PressableScale key={option.value} haptic disabled={disabled || option.disabled} onPress={() => toggle(option)} style={{ minHeight: Math.max(34, box + 10), flexDirection: 'row', alignItems: 'center', gap: 8, opacity: disabled || option.disabled ? 0.55 : 1 }}>
            <MotiView
              animate={{ backgroundColor: active ? palette.colors.primary : palette.card, borderColor: active ? palette.colors.mintPressed : palette.borderLight, scale: active ? 1.04 : 1, rotate: active || palette.minimal ? '0deg' : '-2deg' }}
              transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
              style={{ width: box, height: box, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 2 }}
            >
              <AnimatePresence>
                {active ? (
                  <MotiView
                    key="checkbox-check"
                    from={motion === 'full' ? { opacity: 0, scale: 0.65 } : { opacity: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={motion === 'full' ? { opacity: 0, scale: 0.65 } : { opacity: 0 }}
                    transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
                  >
                    <Check color={checkColor} size={box * 0.62} strokeWidth={3} />
                  </MotiView>
                ) : null}
              </AnimatePresence>
            </MotiView>
            <Text style={{ color: palette.body, fontSize, lineHeight: Math.max(18, fontSize + 4), fontWeight: '700', includeFontPadding: false, textAlignVertical: 'center' }}>{option.label}</Text>
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
  const motion = useMotionPreference()
  const palette = useIslePalette()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={style}>
      {items.map((item) => {
        const active = activeKey === item.key
        return (
          <MotiView
            key={item.key}
            animate={{ scale: active ? 1.035 : 1, translateY: active ? -1 : 0 }}
            transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
          >
            <IsleButton
              label={item.label}
              type={active ? 'primary' : 'default'}
              size="small"
              disabled={item.disabled}
              icon={
                <MotiView
                  animate={{ opacity: active ? 1 : 0, scale: active ? 1 : 0.6, rotate: active ? '0deg' : '-16deg' }}
                  transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
                  style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Leaf color={palette.colors.primary} size={13} />
                </MotiView>
              }
              onPress={() => onChange?.(item.key)}
            />
          </MotiView>
        )
      })}
    </ScrollView>
  )
}

export function IsleFooter({ type = 'tree', style }: { type?: IsleFooterType; style?: StyleProp<ViewStyle> }) {
  const palette = useIslePalette()
  const colors = type === 'sea' ? palette.ui.footer.sea : palette.ui.footer.tree
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
  const palette = useIslePalette()
  const codeTokens = palette.ui.code
  return (
    <ScrollView horizontal style={[{ borderRadius: palette.ui.radius.card, backgroundColor: codeTokens.background, borderWidth: 1, borderColor: codeTokens.border }, style]} contentContainerStyle={{ padding: 16 }}>
      <Text style={{ color: codeTokens.text, fontSize: 12, lineHeight: 20, fontFamily: 'monospace', fontWeight: '700' }}>{code}</Text>
    </ScrollView>
  )
}

export function IsleLoading({ label, style }: { label?: string; style?: StyleProp<ViewStyle> }) {
  const palette = useIslePalette()
  const motion = useMotionPreference()
  const loadingTokens = palette.ui.loading
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center', padding: 16 }, style]}>
      <View style={{ width: 76, height: 44, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: loadingTokens.background, borderWidth: 2, borderColor: loadingTokens.border }}>
        <View style={{ flexDirection: 'row', gap: 5 }}>
          {[0, 1, 2].map((index) => (
            <MotiView
              key={index}
              animate={motion === 'full' ? { translateY: [-2, -8, -2], scale: [1, 1.12, 1] } : { translateY: 0, scale: 1 }}
              transition={motion === 'full' ? { loop: true, type: 'timing', duration: 900, delay: index * 110 } : { type: 'timing', duration: 1 }}
              style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: loadingTokens.dot }}
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
      <View style={{ minWidth: 280, borderRadius: palette.ui.radius.card, overflow: 'hidden', borderWidth: 1, borderColor: palette.borderLight, backgroundColor: palette.card }}>
        <View style={{ flexDirection: 'row', backgroundColor: palette.ui.table.headerBackground }}>
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
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 12, borderRadius: palette.ui.radius.panel, backgroundColor: palette.surface, borderWidth: 3, borderColor: palette.ui.time.border }, style]}>
      <View style={{ paddingRight: 16, borderRightWidth: 3, borderRightColor: palette.ui.time.divider }}>
        <Text style={{ color: palette.colors.success, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 }}>{weekdays[time.getDay()]}</Text>
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
    <View style={[{ width: 188, borderRadius: palette.minimal ? 24 : 46, padding: 14, backgroundColor: palette.surface, borderWidth: 2, borderColor: palette.borderLight }, style]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: palette.body, fontSize: 12, fontWeight: '900' }}>{title}</Text>
        <MoreHorizontal color={palette.secondary} size={18} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
        {apps.map((app) => (
          <View key={app.name} style={{ width: 44, height: 44, borderRadius: palette.minimal ? 12 : 18, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.colors.cardColors[app.color].bg }}>
            <IsleIcon name={app.name} color={palette.colors.cardColors[app.color].fg} size={20} />
          </View>
        ))}
      </View>
      <IsleDivider type="line-yellow" style={{ marginTop: 14 }} />
    </View>
  )
}
