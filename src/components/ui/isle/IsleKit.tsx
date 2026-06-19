import { useEffect, useState, type ReactNode } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { AnimatePresence, MotiView } from 'moti'
import { AppIcon, type AppIconName } from '@/components/ui/AppIcon'
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

const titleMetrics: Record<IsleTitleSize, { fontSize: number; lineHeight: number; minHeight: number; paddingHorizontal: number }> = {
  small: { fontSize: 14, lineHeight: 18, minHeight: 34, paddingHorizontal: 16 },
  middle: { fontSize: 20, lineHeight: 24, minHeight: 44, paddingHorizontal: 22 },
  large: { fontSize: 28, lineHeight: 34, minHeight: 56, paddingHorizontal: 28 },
}

function useIslePalette() {
  const { colors, isDark, themeId } = useAppTheme()
  const sharedSurface = colors.ui.glass
    ? colors.ui.semantic.chrome.background
    : colors.ui.cartoon
      ? colors.ui.semantic.surface.base
      : colors.ui.semantic.surface.base
  const sharedCard = colors.ui.glass
    ? colors.ui.actionBar.itemBackground
    : colors.ui.cartoon
      ? colors.ui.semantic.surface.base
      : colors.ui.semantic.surface.base
  const sharedBorder = colors.ui.glass
    ? colors.ui.actionBar.itemBorder
    : colors.ui.cartoon
      ? colors.material.strokeStrong
      : colors.ui.semantic.chrome.border
  const sharedBorderLight = colors.ui.glass
    ? colors.ui.actionBar.itemBorder
    : colors.ui.cartoon
      ? colors.material.stroke
      : colors.ui.semantic.chrome.border
  return {
    colors,
    isDark,
    themeId,
    ui: colors.ui,
    minimal: colors.ui.minimal,
    glass: colors.ui.glass,
    cartoon: colors.ui.cartoon,
    surface: sharedSurface,
    card: sharedCard,
    text: colors.text,
    body: colors.textSecondary,
    secondary: colors.textTertiary,
    border: sharedBorder,
    borderLight: sharedBorderLight,
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

function disabledContentStyle(palette: ReturnType<typeof useIslePalette>) {
  return {
    backgroundColor: palette.ui.control.disabledBackground,
    borderColor: palette.ui.control.disabledBorder,
    foreground: palette.ui.control.disabledForeground,
    opacity: palette.ui.control.disabledOpacity,
  }
}

export function IsleButton({
  children,
  label,
  accessibilityLabel,
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
  accessibilityLabel?: string
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
  const disabledStyle = disabledContentStyle(palette)
  const enabledForeground = danger && primary ? control.dangerForeground : link ? control.link : danger ? palette.ui.tone.danger.foreground : primary ? control.primaryForeground : palette.text
  const foreground = disabled ? disabledStyle.foreground : enabledForeground
  const enabledBackground = ghost || text
    ? 'transparent'
    : danger && primary
      ? palette.ui.tone.danger.foreground
      : primary
        ? control.primaryBackground
        : palette.glass
          ? palette.ui.actionBar.itemBackground
          : palette.minimal
            ? palette.ui.semantic.surface.muted
            : control.defaultBackground
  const background = disabled && !text ? disabledStyle.backgroundColor : enabledBackground
  const enabledBorderColor = text
    ? 'transparent'
    : danger
      ? palette.ui.tone.danger.border
      : type === 'dashed'
        ? palette.borderLight
        : primary
          ? control.primaryBorder
          : palette.border
  const borderColor = disabled && !text ? disabledStyle.borderColor : enabledBorderColor
  const shadowColor = danger && primary ? control.dangerShadow : control.shadow
  const shadowOpacity = text || ghost ? 0 : primary ? control.primaryShadowOpacity : control.secondaryShadowOpacity
  const shadowRadius = primary ? control.primaryShadowRadius : control.secondaryShadowRadius
  const pressedOffset = loading ? 0 : primary ? control.primaryShadowOffset : control.secondaryShadowOffset
  const borderWidth = text ? 0 : palette.cartoon ? 1 : StyleSheet.hairlineWidth
  const primaryShadowCap = palette.glass ? 0.02 : 0.025
  const resolvedShadowOpacity = text || ghost ? 0 : primary ? Math.min(shadowOpacity, palette.cartoon ? 0.12 : primaryShadowCap) : (palette.cartoon ? shadowOpacity : 0)
  return (
    <PressableScale
      haptic
      disabled={disabled || loading}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? label}
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
          borderWidth,
          borderStyle: type === 'dashed' && palette.cartoon ? 'dashed' : 'solid',
          borderColor,
          opacity: disabled ? disabledStyle.opacity : 1,
          shadowColor,
          shadowOpacity: palette.minimal && !primary ? 0 : resolvedShadowOpacity,
          shadowRadius: palette.cartoon || primary ? shadowRadius : 0,
          shadowOffset: { width: 0, height: palette.cartoon || primary ? pressedOffset : 0 },
          elevation: text || ghost ? 0 : palette.cartoon && primary ? 1 : 0,
        },
        style,
      ]}
    >
      {loading ? (
        <MotiView
          animate={motion === 'full' ? { rotate: '360deg' } : { rotate: '0deg' }}
          transition={motion === 'full' ? { loop: true, type: 'timing', duration: 900 } : { type: 'timing', duration: 1 }}
        >
          <AppIcon name="loader" color={foreground} size={14} />
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
  const borderColor = status === 'error' ? palette.ui.tone.danger.border : status === 'warning' ? palette.ui.tone.warning.border : input.border
  const activeBorderColor = focused && !disabled ? input.focus : borderColor
  const statusShadow = status === 'error' ? palette.ui.tone.danger.foreground : status === 'warning' ? palette.ui.tone.warning.foreground : input.shadow
  const shadowEnabled = shadow || !!status
  const height = controlHeight(size)
  const inputBorderWidth = palette.cartoon ? 1 : 1
  const clearButtonBackground = palette.glass
    ? palette.ui.actionBar.itemBackground
    : palette.cartoon
      ? palette.ui.semantic.surface.muted
      : palette.ui.semantic.surface.muted
  const inputShadowOpacity = disabled || !shadowEnabled
    ? 0
    : status
      ? input.shadowOpacity
      : palette.cartoon
        ? input.shadowOpacity
        : 0
  return (
    <View style={wrapperStyle}>
      {label ? <Text style={{ color: palette.colors.textSecondary, fontSize: 12, fontWeight: '900', marginBottom: 6 }}>{label}</Text> : null}
      <MotiView
        animate={{
          backgroundColor: disabled ? input.disabledBackground : focused ? input.backgroundFocused : input.background,
          borderColor: activeBorderColor,
          scale: focused && !multiline ? 1.003 : 1,
        }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: 1 }}
        style={{
          minHeight: multiline ? 84 : height,
          maxHeight: multiline ? 180 : undefined,
          borderRadius: multiline ? palette.ui.radius.field : controlRadius(size, palette),
          paddingHorizontal: size === 'large' ? 16 : 12,
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          gap: 8,
          borderWidth: inputBorderWidth,
          shadowColor: statusShadow,
          shadowOpacity: inputShadowOpacity,
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
          placeholderTextColor={input.placeholderForeground}
          style={[
            {
              flex: 1,
              minWidth: 0,
              minHeight: multiline ? 78 : Math.max(44, height - 4),
              padding: 0,
              paddingVertical: multiline ? 10 : 0,
              color: disabled ? input.disabledForeground : palette.colors.text,
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
          <PressableScale haptic onPress={() => onChangeText?.('')} style={{ width: 26, height: 26, borderRadius: palette.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center', backgroundColor: clearButtonBackground }}>
            <AppIcon name="close" color={palette.secondary} size={13} />
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
  const disabledStyle = disabledContentStyle(palette)
  const width = size === 'small' ? 38 : 52
  const height = size === 'small' ? 20 : 28
  const borderWidth = palette.cartoon ? 1 : StyleSheet.hairlineWidth
  const thumbInset = size === 'small' ? 3 : 3
  const knob = height - thumbInset * 2
  const thumbTravel = width - knob - thumbInset * 2
  const switchTextColor = disabled ? disabledStyle.foreground : active ? palette.ui.control.primaryForeground : palette.colors.textSecondary
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
        backgroundColor: disabled ? disabledStyle.backgroundColor : active ? switchTokens.trackOn : switchTokens.trackOff,
        opacity: 1,
        shadowColor: active ? switchTokens.trackOnBorder : switchTokens.trackOffBorder,
        shadowOpacity: switchTokens.shadowOpacity,
        shadowRadius: 0,
        shadowOffset: { width: 0, height: 0 },
      }}
    >
      <MotiView
        animate={{
          backgroundColor: disabled ? disabledStyle.backgroundColor : active ? switchTokens.trackOn : switchTokens.trackOff,
          borderColor: disabled ? disabledStyle.borderColor : active ? switchTokens.trackOnBorder : switchTokens.trackOffBorder,
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
          backgroundColor: disabled ? palette.ui.semantic.surface.base : switchTokens.thumb,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: disabled ? disabledStyle.borderColor : active ? switchTokens.thumbOnBorder : switchTokens.thumbOffBorder,
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
  const cardBackground = color === 'default'
    ? palette.glass
      ? palette.ui.semantic.chrome.background
      : uiCard.defaultBackground
    : selected.bg
  const cardBorderColor = type === 'dashed'
    ? palette.borderLight
    : palette.cartoon
      ? 'transparent'
      : palette.border
  return (
    <View
      style={[
        {
          borderRadius: organicRadius(titleCard, palette),
          padding: titleCard ? 14 : 14,
          backgroundColor: cardBackground,
          borderWidth: type === 'dashed' ? (palette.cartoon ? 1 : StyleSheet.hairlineWidth) : StyleSheet.hairlineWidth,
          borderStyle: type === 'dashed' && palette.cartoon ? 'dashed' : 'solid',
          borderColor: cardBorderColor,
          shadowColor: palette.colors.shadowTint,
          shadowOpacity: type === 'dashed' ? 0 : (palette.cartoon ? uiCard.shadowOpacity : 0),
          shadowRadius: type === 'dashed' ? 0 : uiCard.shadowRadius,
          shadowOffset: { width: 0, height: type === 'dashed' ? 0 : uiCard.shadowOffset },
          elevation: type === 'dashed' ? 0 : palette.cartoon ? 0 : 0,
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
  const background = color === 'default' ? palette.ui.tone.ink.background : selected.bg
  const foreground = color === 'default' ? palette.ui.tone.ink.foreground : selected.fg
  const content = children ?? title
  const selfAlignment = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'
  const titleText = typeof content === 'string' || typeof content === 'number'
  const outerHeight = metrics.minHeight + 6
  const cloudLeftSize = metrics.minHeight * 0.62
  const cloudRightSize = metrics.minHeight * 0.68
  const wingWidth = metrics.minHeight * 0.46
  const wingHeight = metrics.minHeight * 0.52
  const titleBorder = palette.cartoon ? palette.ui.tone.ink.border : palette.colors.material.stroke
  const titleShadowOpacity = palette.cartoon ? (palette.isDark ? 0.08 : 0.05) : 0

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

  if (!palette.cartoon) {
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
        <View style={{ width: 3, height: Math.max(18, metrics.lineHeight), borderRadius: 999, backgroundColor: palette.ui.section.marker }} />
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
        <View style={{ position: 'absolute', left: metrics.minHeight * 0.48, top: (outerHeight - cloudLeftSize) / 2, width: cloudLeftSize, height: cloudLeftSize, borderRadius: metrics.minHeight, backgroundColor: background, opacity: 0.36 }} />
        <View style={{ position: 'absolute', right: metrics.minHeight * 0.56, top: (outerHeight - cloudRightSize) / 2, width: cloudRightSize, height: cloudRightSize, borderRadius: metrics.minHeight, backgroundColor: background, opacity: 0.32 }} />
        <View
          style={{
            minHeight: metrics.minHeight,
            minWidth: metrics.minHeight * 2.6,
            borderRadius: metrics.minHeight / 2,
            paddingHorizontal: metrics.paddingHorizontal,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: background,
            borderWidth: 1,
            borderColor: titleBorder,
            shadowColor: palette.colors.shadowTint,
            shadowOpacity: titleShadowOpacity,
            shadowRadius: 0,
            shadowOffset: { width: 0, height: titleShadowOpacity > 0 ? 2 : 0 },
            elevation: titleShadowOpacity > 0 ? 1 : 0,
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
          opacity: 0.36,
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
          opacity: 0.36,
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
          borderWidth: 1,
          borderColor: titleBorder,
          shadowColor: palette.colors.shadowTint,
          shadowOpacity: titleShadowOpacity,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: titleShadowOpacity > 0 ? 2 : 0 },
          elevation: titleShadowOpacity > 0 ? 1 : 0,
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
  const disabledStyle = disabledContentStyle(palette)
  const controlForeground = disabled ? disabledStyle.foreground : palette.ui.control.primaryForeground
  const controlBackground = disabled ? disabledStyle.backgroundColor : palette.ui.control.primaryBackground
  const controlBorder = disabled ? disabledStyle.borderColor : 'transparent'
  const questionColor = disabled ? disabledStyle.foreground : palette.text
  const iconColor = disabled ? disabledStyle.foreground : expanded ? palette.ui.icon.accentForeground : palette.secondary
  return (
    <IsleCard type="dashed" style={disabled ? { borderColor: disabledStyle.borderColor } : undefined}>
      <PressableScale haptic disabled={disabled} onPress={() => setExpanded((value) => !value)} style={{ minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 28, height: 28, borderRadius: palette.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center', backgroundColor: controlBackground, borderWidth: disabled ? StyleSheet.hairlineWidth : 0, borderColor: controlBorder }}>
          <Text style={{ color: controlForeground, fontSize: 18, lineHeight: 22, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{expanded ? '-' : '+'}</Text>
        </View>
        <Text style={{ flex: 1, minWidth: 0, color: questionColor, fontSize: 14, lineHeight: 19, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{question}</Text>
        <MotiView animate={{ rotate: expanded ? '180deg' : '0deg', scale: expanded ? 1.06 : 1 }} transition={{ type: 'timing', duration: motion === 'full' ? 180 : 1 }}>
          <AppIcon name="leaf" color={iconColor} size={18} />
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
            <Text style={{ color: palette.colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 10, includeFontPadding: false }}>{answer}</Text>
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
              <Text style={{ flex: 1, minWidth: 0, color: palette.text, fontSize: 18, fontWeight: '900' }}>{title}</Text>
              <PressableScale haptic onPress={onClose} style={{ width: 34, height: 34, borderRadius: palette.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.glass ? palette.ui.actionBar.itemBackground : palette.ui.semantic.surface.muted }}>
                <AppIcon name="close" color={palette.colors.textSecondary} size={16} />
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
  return <Text style={[{ color: palette.colors.textSecondary, fontSize: 14, lineHeight: 21, fontWeight: '700' }, textStyle]}>{text.slice(0, count)}</Text>
}

export function IsleDivider({ type = 'line-brown', style }: { type?: IsleDividerType; style?: StyleProp<ViewStyle> }) {
  const palette = useIslePalette()
  const color = type === 'line-teal' ? palette.ui.icon.accentForeground : type === 'line-yellow' || type === 'wave-yellow' ? palette.colors.accent : type === 'line-white' ? palette.ui.semantic.surface.base : palette.colors.material.stroke
  const wave = type === 'wave-yellow'
  if (!palette.cartoon) {
    return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: type === 'line-white' ? palette.colors.material.stroke : color, opacity: type === 'line-brown' ? 1 : 0.74 }, style]} />
  }
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
  const iconNameByIsleIcon: Record<IsleIconName, AppIconName> = {
    camera: 'camera',
    chat: 'message',
    critterpedia: 'knowledge',
    design: 'spark',
    diy: 'diy',
    helicopter: 'cloud',
    leaf: 'leaf',
    map: 'map',
    miles: 'cpu',
    shopping: 'shopping',
  }
  return <AppIcon name={iconNameByIsleIcon[name]} color={iconColor} size={size} />
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
  const activeOptionBackground = palette.ui.tone.success.background
  const activeOptionForeground = palette.ui.tone.success.foreground
  const activeOptionBorder = palette.ui.tone.success.border
  const disabledStyle = disabledContentStyle(palette)
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
            <AppIcon name="collapse" color={palette.colors.textSecondary} size={15} />
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
              {options.map((option) => {
                const optionActive = option.value === value
                const optionDisabled = !!option.disabled
                return (
                  <PressableScale
                    key={option.value}
                    disabled={optionDisabled}
                    onPress={() => {
                      onChange?.(option.value)
                      setOpen(false)
                    }}
                    style={{ minHeight: 34, borderRadius: palette.ui.radius.controlSmall, paddingHorizontal: 10, justifyContent: 'center' }}
                  >
                    <MotiView
                      animate={{ backgroundColor: optionDisabled ? disabledStyle.backgroundColor : optionActive ? activeOptionBackground : 'transparent', scale: optionActive && !optionDisabled ? 1.01 : 1 }}
                      transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
                      style={{ minHeight: 34, borderRadius: palette.ui.radius.controlSmall, paddingHorizontal: 10, justifyContent: 'center', marginHorizontal: -10, borderWidth: optionActive || optionDisabled ? StyleSheet.hairlineWidth : 0, borderColor: optionDisabled ? disabledStyle.borderColor : activeOptionBorder }}
                    >
                      <Text style={{ color: optionDisabled ? disabledStyle.foreground : optionActive ? activeOptionForeground : palette.colors.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{option.label}</Text>
                    </MotiView>
                  </PressableScale>
                )
              })}
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
  const activeBoxBackground = palette.ui.control.primaryBackground
  const activeBoxBorder = palette.ui.control.primaryBorder
  const checkColor = palette.ui.control.primaryForeground
  const inactiveBoxBackground = palette.glass ? palette.ui.actionBar.itemBackground : palette.card
  const inactiveBoxBorder = palette.glass ? palette.ui.actionBar.itemBorder : palette.borderLight
  const disabledStyle = disabledContentStyle(palette)
  function toggle(option: IsleCheckboxOption) {
    if (disabled || option.disabled) return
    const next = value.includes(option.value) ? value.filter((item) => item !== option.value) : [...value, option.value]
    onChange?.(next)
  }
  return (
    <View style={{ flexDirection: direction === 'horizontal' ? 'row' : 'column', gap: direction === 'horizontal' ? 12 : 8, flexWrap: 'wrap' }}>
      {options.map((option) => {
        const active = value.includes(option.value)
        const optionDisabled = disabled || !!option.disabled
        const boxBackground = optionDisabled ? disabledStyle.backgroundColor : active ? activeBoxBackground : inactiveBoxBackground
        const boxBorder = optionDisabled ? disabledStyle.borderColor : active ? activeBoxBorder : inactiveBoxBorder
        const labelColor = optionDisabled ? disabledStyle.foreground : palette.colors.textSecondary
        return (
          <PressableScale key={option.value} haptic disabled={optionDisabled} onPress={() => toggle(option)} style={{ minHeight: Math.max(34, box + 10), flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MotiView
              animate={{ backgroundColor: boxBackground, borderColor: boxBorder, scale: active && !optionDisabled ? 1.03 : 1, rotate: active || optionDisabled || !palette.cartoon ? '0deg' : '-1deg' }}
              transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
              style={{ width: box, height: box, borderRadius: palette.cartoon ? 8 : palette.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center', borderWidth: palette.cartoon ? 1 : StyleSheet.hairlineWidth }}
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
                    <AppIcon name="check" color={optionDisabled ? disabledStyle.foreground : checkColor} size={box * 0.62} strokeWidth={3} />
                  </MotiView>
                ) : null}
              </AnimatePresence>
            </MotiView>
            <Text style={{ color: labelColor, fontSize, lineHeight: Math.max(18, fontSize + 4), fontWeight: '700', includeFontPadding: false, textAlignVertical: 'center' }}>{option.label}</Text>
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
                  <AppIcon name="leaf" color={palette.colors.ui.control.primaryForeground} size={13} />
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
  if (!palette.cartoon) {
    return (
      <View style={[{ height: type === 'sea' ? 32 : 28, justifyContent: 'flex-end' }, style]}>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors[0], opacity: 0.78 }} />
        <View style={{ flexDirection: 'row', gap: 5, marginTop: 6 }}>
          {colors.slice(0, 3).map((color, index) => (
            <View key={`${type}-${color}`} style={{ flex: 1, height: type === 'sea' ? 4 : 3, borderRadius: 999, backgroundColor: color, opacity: 0.68 - index * 0.08 }} />
          ))}
        </View>
      </View>
    )
  }
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
  const loaderWidth = palette.cartoon ? 76 : 64
  const loaderHeight = palette.cartoon ? 44 : 36
  const dotSize = palette.cartoon ? 10 : 8
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center', padding: 16 }, style]}>
      <View style={{ width: loaderWidth, height: loaderHeight, borderRadius: palette.ui.radius.chip, alignItems: 'center', justifyContent: 'center', backgroundColor: loadingTokens.background, borderWidth: palette.cartoon ? 1 : StyleSheet.hairlineWidth, borderColor: loadingTokens.border }}>
        <View style={{ flexDirection: 'row', gap: 5 }}>
          {[0, 1, 2].map((index) => (
            <MotiView
              key={index}
              animate={motion === 'full' ? { translateY: [-2, -8, -2], scale: [1, 1.12, 1] } : { translateY: 0, scale: 1 }}
              transition={motion === 'full' ? { loop: true, type: 'timing', duration: 900, delay: index * 110 } : { type: 'timing', duration: 1 }}
              style={{ width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: loadingTokens.dot }}
            />
          ))}
        </View>
      </View>
      {label ? <Text style={{ color: palette.colors.textSecondary, fontSize: 12, fontWeight: '900', marginTop: 8 }}>{label}</Text> : null}
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
  const { width } = useWindowDimensions()
  const tableBackground = palette.glass ? palette.ui.semantic.chrome.background : palette.ui.semantic.surface.base
  const rowBorderWidth = palette.cartoon ? 1 : StyleSheet.hairlineWidth
  const tableMinWidth = Math.max(240, Math.min(280, width - 32))
  const defaultColumnWidth = Math.max(96, Math.min(124, width * 0.32))
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ minWidth: tableMinWidth, borderRadius: palette.ui.radius.card, overflow: 'hidden', borderWidth: rowBorderWidth, borderColor: palette.borderLight, backgroundColor: tableBackground }}>
        <View style={{ flexDirection: 'row', backgroundColor: palette.ui.table.headerBackground }}>
          {columns.map((column) => (
            <Text key={String(column.dataIndex)} style={{ width: column.width ?? defaultColumnWidth, padding: 10, color: palette.text, fontSize: 12, fontWeight: '900' }}>{column.title}</Text>
          ))}
        </View>
        {data.length ? data.map((row, index) => (
          <View key={index} style={{ flexDirection: 'row', borderTopWidth: rowBorderWidth, borderTopColor: palette.borderLight }}>
            {columns.map((column) => (
              <Text key={String(column.dataIndex)} numberOfLines={2} style={{ width: column.width ?? defaultColumnWidth, padding: 10, color: palette.colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '700' }}>
                {column.render ? column.render(row[column.dataIndex], row, index) : String(row[column.dataIndex] ?? '')}
              </Text>
            ))}
          </View>
        )) : (
          <View style={{ padding: 18, alignItems: 'center' }}>
            {palette.cartoon ? <AppIcon name="leaf" color={palette.secondary} size={24} /> : null}
            <Text style={{ color: palette.secondary, fontSize: 12, fontWeight: '800', marginTop: palette.cartoon ? 6 : 0 }}>{emptyText}</Text>
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
  const frameBorderWidth = palette.cartoon ? 1 : StyleSheet.hairlineWidth
  const timeFontSize = palette.cartoon ? 32 : 28
  const frameBackground = palette.glass ? palette.ui.semantic.chrome.background : palette.ui.semantic.surface.base
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: palette.cartoon ? 15 : 14, paddingHorizontal: palette.cartoon ? 18 : 18, paddingVertical: 12, borderRadius: palette.ui.radius.panel, backgroundColor: frameBackground, borderWidth: frameBorderWidth, borderColor: palette.ui.time.border }, style]}>
      <View style={{ paddingRight: palette.cartoon ? 14 : 14, borderRightWidth: frameBorderWidth, borderRightColor: palette.ui.time.divider }}>
        <Text style={{ color: palette.ui.tone.success.foreground, fontSize: 12, lineHeight: 16, fontWeight: '900', letterSpacing: 0, includeFontPadding: false, textAlignVertical: 'center' }}>{weekdays[time.getDay()]}</Text>
        <Text style={{ color: palette.colors.textSecondary, fontSize: 18, lineHeight: 23, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{time.getMonth() + 1}/{time.getDate()}</Text>
      </View>
      <Text style={{ color: palette.colors.textSecondary, fontSize: timeFontSize, lineHeight: timeFontSize + 5, fontWeight: '900', letterSpacing: 0, includeFontPadding: false, textAlignVertical: 'center' }}>
        {time.getHours().toString().padStart(2, '0')}:{time.getMinutes().toString().padStart(2, '0')}
      </Text>
    </View>
  )
}

export function IslePhone({ title = 'IsleMind', style }: { title?: string; style?: StyleProp<ViewStyle> }) {
  const palette = useIslePalette()
  const { width } = useWindowDimensions()
  const phoneWidth = Math.max(164, Math.min(188, width - 48))
  const appTileSize = phoneWidth < 176 ? 40 : 44
  const apps: { name: IsleIconName; color: IsleCardColor }[] = [
    { name: 'camera', color: 'purple' },
    { name: 'chat', color: 'app-blue' },
    { name: 'critterpedia', color: 'app-yellow' },
    { name: 'diy', color: 'app-orange' },
    { name: 'shopping', color: 'app-pink' },
    { name: 'design', color: 'app-green' },
  ]
  const phoneSurface = palette.glass ? palette.ui.semantic.chrome.background : palette.ui.semantic.surface.base
  return (
    <View style={[{ width: phoneWidth, borderRadius: palette.cartoon ? 46 : 24, padding: 14, backgroundColor: phoneSurface, borderWidth: palette.cartoon ? 1 : StyleSheet.hairlineWidth, borderColor: palette.borderLight }, style]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: palette.colors.textSecondary, fontSize: 12, fontWeight: '900' }}>{title}</Text>
        <AppIcon name="more" color={palette.secondary} size={18} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
        {apps.map((app) => (
          <View key={app.name} style={{ width: appTileSize, height: appTileSize, borderRadius: palette.cartoon ? 18 : 12, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.colors.cardColors[app.color].bg, borderWidth: palette.cartoon ? 0 : StyleSheet.hairlineWidth, borderColor: palette.colors.material.stroke }}>
            <IsleIcon name={app.name} color={palette.colors.cardColors[app.color].fg} size={20} />
          </View>
        ))}
      </View>
      <IsleDivider type="line-yellow" style={{ marginTop: 14 }} />
    </View>
  )
}
