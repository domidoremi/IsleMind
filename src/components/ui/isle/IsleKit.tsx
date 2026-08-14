import { useEffect, useState, type ReactNode } from 'react'
import {
  Modal,
  Platform,
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
import { useTranslation } from 'react-i18next'
import { AppIcon, type AppIconName } from '@/components/ui/AppIcon'
import { HighFrameSpinner } from '@/components/ui/HighFrameSpinner'
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
export type IsleProgressSize = 'small' | 'middle' | 'large'
export type IsleProgressInfoPosition = 'inside' | 'right' | 'top'
export type IsleTimeType = 'hud' | 'game'

export interface IsleTimeProps {
  type?: IsleTimeType
  style?: StyleProp<ViewStyle>
}

export const ISLE_UI_COMPONENTS = [
  'Title',
  'Button',
  'Input',
  'Tag',
  'Image',
  'Skeleton',
  'BackTop',
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
  'Progress',
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
    : colors.ui.limeRoad
      ? colors.ui.semantic.surface.base
      : colors.ui.semantic.surface.base
  const sharedCard = colors.ui.glass
    ? colors.ui.actionBar.itemBackground
    : colors.ui.limeRoad
      ? colors.ui.semantic.surface.base
      : colors.ui.semantic.surface.base
  const sharedBorder = colors.ui.glass
    ? colors.ui.actionBar.itemBorder
    : colors.ui.limeRoad
      ? colors.material.strokeStrong
      : colors.ui.semantic.chrome.border
  const sharedBorderLight = colors.ui.glass
    ? colors.ui.actionBar.itemBorder
    : colors.ui.limeRoad
      ? colors.material.stroke
      : colors.ui.semantic.chrome.border
  return {
    colors,
    isDark,
    themeId,
    ui: colors.ui,
    minimal: colors.ui.minimal,
    glass: colors.ui.glass,
    limeRoad: colors.ui.limeRoad,
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
  if (size === 'small') return 40
  if (size === 'large') return 46
  return size === 'middle' ? 42 : 40
}

function organicRadius(titleCard: boolean, palette: ReturnType<typeof useIslePalette>) {
  return Math.min(titleCard ? palette.ui.radius.titleCard : palette.ui.radius.card, 8)
}

function controlRadius(size: IsleButtonSize | IsleInputSize, palette: ReturnType<typeof useIslePalette>) {
  if (size === 'small') return Math.min(palette.ui.radius.controlSmall, 8)
  if (size === 'large') return Math.min(palette.ui.radius.controlLarge, 8)
  return Math.min(palette.ui.radius.controlMiddle, 8)
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
  accessibilityRole = 'button',
  accessibilityState,
  testID,
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
  accessibilityRole?: Parameters<typeof PressableScale>[0]['accessibilityRole']
  accessibilityState?: Parameters<typeof PressableScale>[0]['accessibilityState']
  testID?: string
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
  const shadowOpacity = 0
  const shadowRadius = 0
  const pressedOffset = 0
  const borderWidth = text ? 0 : palette.limeRoad ? 1 : StyleSheet.hairlineWidth
  const resolvedShadowOpacity = shadowOpacity
  const buttonAccessibilityState = loading
    ? { ...accessibilityState, busy: true }
    : accessibilityState
  return (
    <PressableScale
      haptic
      disabled={disabled || loading}
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={buttonAccessibilityState}
      testID={testID}
      style={[
        {
          alignSelf: block ? 'stretch' : 'flex-start',
          minHeight: height,
          borderRadius: controlRadius(size, palette),
          paddingHorizontal: size === 'small' ? 12 : size === 'large' ? 18 : 14,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: background,
          borderWidth,
          borderStyle: type === 'dashed' && palette.limeRoad ? 'dashed' : 'solid',
          borderColor,
          opacity: disabled ? disabledStyle.opacity : 1,
          ...Platform.select<ViewStyle>({
            web: { boxShadow: 'none' },
            default: {
              shadowColor,
              shadowOpacity: palette.minimal && !primary ? 0 : resolvedShadowOpacity,
              shadowRadius,
              shadowOffset: { width: 0, height: pressedOffset },
              elevation: 0,
            },
          }),
        },
        style,
      ]}
    >
      {loading || icon ? (
        <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {loading ? (
            <HighFrameSpinner color={foreground} size={16} />
          ) : icon}
        </View>
      ) : null}
      {children || label ? (
        <Text numberOfLines={1} style={[{ flexShrink: 1, minWidth: 0, color: foreground, fontSize, lineHeight: Math.max(16, fontSize + 4), fontWeight: primary ? '800' : '700', letterSpacing: 0, includeFontPadding: false, textAlignVertical: 'center' }, textStyle]}>
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
  defaultValue,
  onChangeText,
  onClear,
  clearAccessibilityLabel,
  onBlur,
  onFocus,
  onContentSizeChange,
  scrollEnabled,
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
  onClear?: () => void
  clearAccessibilityLabel?: string
  wrapperStyle?: StyleProp<ViewStyle>
  inputStyle?: StyleProp<TextStyle>
}) {
  const palette = useIslePalette()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const [focused, setFocused] = useState(false)
  const [multilineContentHeight, setMultilineContentHeight] = useState(0)
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? '')
  const controlled = value !== undefined
  const currentValue = controlled ? value : uncontrolledValue
  const disabled = editable === false
  const input = palette.ui.input
  const borderColor = status === 'error' ? palette.ui.tone.danger.border : status === 'warning' ? palette.ui.tone.warning.border : 'transparent'
  const activeBorderColor = focused && !disabled ? input.focus : borderColor
  const statusShadow = status === 'error' ? palette.ui.tone.danger.foreground : status === 'warning' ? palette.ui.tone.warning.foreground : input.shadow
  const shadowEnabled = shadow || !!status
  const height = controlHeight(size)
  const inputBorderWidth = palette.limeRoad ? 1 : StyleSheet.hairlineWidth
  const clearButtonBackground = palette.glass
    ? palette.ui.actionBar.itemBackground
    : palette.limeRoad
      ? palette.ui.semantic.surface.muted
      : palette.ui.semantic.surface.muted
  const inputShadowOpacity = 0
  const multilineMaxHeight = 156
  const multilineShellHeight = multiline
    ? Math.max(76, Math.min(multilineMaxHeight, Math.ceil(multilineContentHeight || 56) + 18))
    : undefined
  return (
    <View style={wrapperStyle}>
      {label ? <Text style={{ color: palette.colors.textSecondary, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>{label}</Text> : null}
      <MotiView
        animate={{
          backgroundColor: disabled ? input.disabledBackground : focused ? input.backgroundFocused : input.background,
          borderColor: activeBorderColor,
        }}
        transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
        style={{
          height: multilineShellHeight,
          minHeight: multiline ? 76 : height,
          maxHeight: multiline ? multilineMaxHeight : undefined,
          borderRadius: multiline ? palette.ui.radius.field : controlRadius(size, palette),
          paddingHorizontal: size === 'large' ? 16 : 12,
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          gap: 8,
          borderWidth: inputBorderWidth,
          shadowColor: statusShadow,
          shadowOpacity: inputShadowOpacity,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 0 },
          elevation: 0,
        }}
      >
        {prefix}
        <TextInput
          {...props}
          value={currentValue}
          onChangeText={(nextValue) => {
            if (!controlled) setUncontrolledValue(nextValue)
            onChangeText?.(nextValue)
          }}
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
          scrollEnabled={multiline ? scrollEnabled ?? true : scrollEnabled}
          onContentSizeChange={(event) => {
            if (multiline) setMultilineContentHeight(event.nativeEvent.contentSize.height)
            onContentSizeChange?.(event)
          }}
          accessibilityLabel={props.accessibilityLabel ?? (typeof label === 'string' ? label : undefined)}
          accessibilityState={disabled ? { ...props.accessibilityState, disabled: true } : props.accessibilityState}
          aria-invalid={status === 'error' || undefined}
          placeholderTextColor={input.placeholderForeground}
          style={[
            {
              flex: 1,
              minWidth: 0,
              minHeight: multiline ? Math.max(64, multilineShellHeight ? multilineShellHeight - 6 : 78) : Math.max(44, height - 4),
              maxHeight: multiline ? multilineMaxHeight - 6 : undefined,
              padding: 0,
              paddingVertical: multiline ? 10 : 0,
              color: disabled ? input.disabledForeground : palette.colors.text,
              fontSize: textSize(size),
              fontWeight: '500',
              lineHeight: multiline ? 20 : undefined,
              textAlignVertical: multiline ? 'top' : 'center',
              includeFontPadding: false,
            },
            inputStyle,
          ]}
        />
        {allowClear && currentValue && !disabled ? (
          <PressableScale haptic accessibilityLabel={clearAccessibilityLabel ?? (label ? `${t('common.clear')} ${label}` : t('common.clear'))} onPress={() => {
            if (!controlled) setUncontrolledValue('')
            onChangeText?.('')
            onClear?.()
          }} style={{ width: 26, height: 26, borderRadius: Math.min(palette.ui.radius.controlSmall, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: clearButtonBackground }}>
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
  const borderWidth = palette.limeRoad ? 1 : StyleSheet.hairlineWidth
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
      accessibilityRole="switch"
      accessibilityState={loading ? { checked: active, busy: true } : { checked: active }}
      style={{
        width,
        height,
        borderRadius: height / 2,
        alignItems: 'flex-start',
        justifyContent: 'center',
        backgroundColor: disabled ? disabledStyle.backgroundColor : active ? switchTokens.trackOn : switchTokens.trackOff,
        opacity: 1,
        shadowColor: active ? switchTokens.trackOnBorder : switchTokens.trackOffBorder,
        shadowOpacity: 0,
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
        animate={{ translateX: active ? thumbTravel : 0 }}
        transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
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
        <Text style={{ position: 'absolute', top: 0, bottom: 0, left: active ? 7 : knob + thumbInset + 4, right: active ? knob + thumbInset + 4 : 7, color: switchTextColor, fontSize: 10, lineHeight: height, fontWeight: '800', textAlign: active ? 'left' : 'right', includeFontPadding: false, textAlignVertical: 'center' }}>
          {active ? checkedChildren : unCheckedChildren}
        </Text>
      ) : null}
    </PressableScale>
  )
}

export interface IsleCardProps {
  children: ReactNode
  type?: IsleCardType
  color?: IsleCardColor
  hoverable?: boolean
  onPress?: () => void
  disabled?: boolean
  accessibilityLabel?: string
  style?: StyleProp<ViewStyle>
  contentStyle?: StyleProp<ViewStyle>
}

export function IsleCard({
  children,
  type = 'default',
  color = 'default',
  hoverable = false,
  onPress,
  disabled = false,
  accessibilityLabel,
  style,
  contentStyle,
}: IsleCardProps) {
  const palette = useIslePalette()
  const motion = useMotionPreference()
  const [hovered, setHovered] = useState(false)
  const selected = palette.colors.cardColors[color]
  const titleCard = type === 'title'
  const uiCard = palette.ui.card
  const cardBackground = color === 'default'
    ? palette.glass
      ? palette.ui.semantic.chrome.background
      : uiCard.defaultBackground
    : selected.bg
  const cardBorderColor = type === 'dashed'
    ? hoverable && hovered
      ? palette.colors.borderStrong
      : palette.borderLight
    : palette.limeRoad
      ? 'transparent'
      : palette.border
  const interactive = hoverable || !!onPress
  const hoverOffset = hoverable && hovered && !disabled && type !== 'dashed' && motion === 'full' ? -2 : 0
  const cardStyle: StyleProp<ViewStyle> = [
    {
      position: 'relative',
      top: hoverOffset,
      borderRadius: organicRadius(titleCard, palette),
      padding: titleCard ? 12 : 10,
      backgroundColor: cardBackground,
      borderWidth: StyleSheet.hairlineWidth,
      borderStyle: type === 'dashed' && palette.limeRoad ? 'dashed' : 'solid',
      borderColor: cardBorderColor,
      shadowColor: palette.colors.shadowTint,
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
      cursor: interactive ? 'pointer' : 'auto',
      opacity: disabled ? 0.56 : 1,
    },
    style,
    contentStyle,
  ]

  if (!interactive) return <View style={cardStyle}>{children}</View>

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={disabled ? { disabled: true } : undefined}
      disabled={disabled}
      onHoverIn={() => {
        if (hoverable && !disabled) setHovered(true)
      }}
      onHoverOut={() => setHovered(false)}
      onPress={onPress}
      style={cardStyle}
    >
      {children}
    </Pressable>
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
  const titleBorder = palette.limeRoad ? palette.ui.tone.ink.border : palette.colors.material.stroke
  const ornamentedTitle = palette.limeRoad && palette.ui.ornamented
  const titleShadowOpacity = ornamentedTitle ? (palette.isDark ? 0.08 : 0.05) : 0

  const label = titleText ? (
    <Text
      numberOfLines={2}
      style={[
        {
          color: foreground,
          fontSize: metrics.fontSize,
          lineHeight: metrics.lineHeight,
          fontWeight: '800',
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

  if (!ornamentedTitle) {
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
        <View style={{ width: 3, height: Math.max(18, metrics.lineHeight), borderRadius: 2, backgroundColor: palette.ui.section.marker }} />
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
        from={motion === 'full' ? { opacity: 0, translateY: 6 } : { opacity: 0 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
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
            shadowOpacity: 0,
            shadowRadius: 0,
            shadowOffset: { width: 0, height: 0 },
            elevation: 0,
          }}
        >
          {label}
        </View>
      </MotiView>
    )
  }

  return (
    <MotiView
      from={motion === 'full' ? { opacity: 0, translateY: 6 } : { opacity: 0 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
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
          shadowOpacity: 0,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 0 },
          elevation: 0,
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
  const questionLabel = typeof question === 'string' || typeof question === 'number' ? String(question) : undefined
  return (
    <IsleCard type="dashed" style={disabled ? { borderColor: disabledStyle.borderColor } : undefined}>
      <PressableScale haptic disabled={disabled} onPress={() => setExpanded((value) => !value)} accessibilityLabel={questionLabel} accessibilityState={{ expanded }} style={{ minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 28, height: 28, borderRadius: Math.min(palette.ui.radius.controlSmall, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: controlBackground, borderWidth: disabled ? StyleSheet.hairlineWidth : 0, borderColor: controlBorder }}>
          <Text style={{ color: controlForeground, fontSize: 18, lineHeight: 22, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center' }}>{expanded ? '-' : '+'}</Text>
        </View>
        <Text style={{ flex: 1, minWidth: 0, color: questionColor, fontSize: 14, lineHeight: 19, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center' }}>{question}</Text>
        <MotiView animate={{ rotate: expanded ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: motion === 'full' ? 180 : 1 }}>
          <AppIcon name="leaf" color={iconColor} size={18} />
        </MotiView>
      </PressableScale>
      <AnimatePresence>
        {expanded ? (
          <MotiView
            key="isle-collapse-answer"
            from={motion === 'full' ? { opacity: 0, translateY: 6 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
            transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
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
  const { t } = useTranslation()
  const titleLabel = typeof title === 'string' ? title : undefined
  return (
    <Modal transparent visible={open} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
        <Pressable
          onPress={maskClosable ? onClose : undefined}
          accessible={false}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: palette.colors.backdrop }}
        />
        <MotiView
          from={motion === 'full' ? { opacity: 0, translateY: 10 } : { opacity: 0 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.normal : 1 }}
        >
          <IsleCard type="title" style={{ padding: 16, borderRadius: Math.min(palette.ui.radius.modal, 8) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, minWidth: 0, color: palette.text, fontSize: 18, fontWeight: '800' }}>{title}</Text>
              <PressableScale haptic accessibilityLabel={titleLabel ? `${t('dialog.close')} ${titleLabel}` : t('dialog.close')} onPress={onClose} style={{ width: 44, height: 44, borderRadius: Math.min(palette.ui.radius.controlSmall, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: palette.glass ? palette.ui.actionBar.itemBackground : palette.ui.semantic.surface.muted }}>
                <AppIcon name="close" color={palette.colors.textSecondary} size={16} />
              </PressableScale>
            </View>
            <View style={{ marginTop: 12 }}>
              {typewriter && typeof children === 'string' ? <IsleTypewriter>{children}</IsleTypewriter> : children}
            </View>
            {footer !== null ? (
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
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
  if (!palette.limeRoad || !palette.ui.ornamented) {
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
        accessibilityState={{ expanded: open }}
        icon={
          <MotiView
            animate={{ rotate: open ? '180deg' : '0deg' }}
            transition={{ type: 'timing', duration: motion === 'full' ? 160 : 1 }}
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
            from={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
            transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
          >
            <IsleCard style={{ marginTop: 8, gap: 6 }}>
              {options.map((option) => {
                const optionActive = option.value === value
                const optionDisabled = !!option.disabled
                return (
                  <PressableScale
                    key={option.value}
                    disabled={optionDisabled}
                    accessibilityLabel={option.label}
                    accessibilityState={{ selected: optionActive }}
                    onPress={() => {
                      onChange?.(option.value)
                      setOpen(false)
                    }}
                    style={{ minHeight: 34, borderRadius: Math.min(palette.ui.radius.controlSmall, 8), paddingHorizontal: 10, justifyContent: 'center' }}
                  >
                      <MotiView
                        animate={{ backgroundColor: optionDisabled ? disabledStyle.backgroundColor : optionActive ? activeOptionBackground : 'transparent' }}
                        transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
                        style={{ minHeight: 34, borderRadius: Math.min(palette.ui.radius.controlSmall, 8), paddingHorizontal: 10, justifyContent: 'center', marginHorizontal: -10, borderWidth: optionActive || optionDisabled ? StyleSheet.hairlineWidth : 0, borderColor: optionDisabled ? disabledStyle.borderColor : activeOptionBorder }}
                    >
                      <Text style={{ color: optionDisabled ? disabledStyle.foreground : optionActive ? activeOptionForeground : palette.colors.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center' }}>{option.label}</Text>
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
          <PressableScale key={option.value} haptic disabled={optionDisabled} accessibilityRole="checkbox" accessibilityLabel={option.label} accessibilityState={{ checked: active }} onPress={() => toggle(option)} style={{ minHeight: Math.max(34, box + 10), flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MotiView
              animate={{ backgroundColor: boxBackground, borderColor: boxBorder, rotate: '0deg' }}
              transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
              style={{ width: box, height: box, borderRadius: Math.min(palette.limeRoad ? 8 : palette.ui.radius.controlSmall, 8), alignItems: 'center', justifyContent: 'center', borderWidth: palette.limeRoad ? 1 : StyleSheet.hairlineWidth }}
            >
              <AnimatePresence>
                {active ? (
                  <MotiView
                    key="checkbox-check"
                    from={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
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
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={style}>
      {items.map((item) => {
        const active = activeKey === item.key
        return (
          <MotiView
            key={item.key}
            animate={{ translateY: 0 }}
            transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
          >
            <IsleButton
              label={item.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              type={active ? 'primary' : 'default'}
              size="small"
              disabled={item.disabled}
              onPress={() => onChange?.(item.key)}
            />
          </MotiView>
        )
      })}
    </ScrollView>
  )
}

export function IsleFooter({ type = 'tree', seamless = true, style }: { type?: IsleFooterType; seamless?: boolean; style?: StyleProp<ViewStyle> }) {
  const palette = useIslePalette()
  const colors = type === 'sea' ? palette.ui.footer.sea : palette.ui.footer.tree
  if (!palette.limeRoad || !palette.ui.ornamented) {
    return (
      <View style={[{ height: type === 'sea' ? 32 : 28, justifyContent: 'flex-end' }, style]}>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors[0], opacity: 0.78 }} />
        <View style={{ flexDirection: 'row', gap: seamless ? 0 : 5, marginTop: 6 }}>
          {colors.slice(0, 3).map((color, index) => (
            <View key={`${type}-${color}`} style={{ flex: 1, height: type === 'sea' ? 4 : 3, borderRadius: seamless ? 0 : 2, backgroundColor: color, opacity: 0.68 - index * 0.08 }} />
          ))}
        </View>
      </View>
    )
  }
  return (
    <View style={[{ height: type === 'sea' ? 56 : 44, overflow: 'hidden', justifyContent: 'flex-end' }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: seamless ? 0 : type === 'sea' ? 0 : 6 }}>
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
    <ScrollView horizontal style={[{ borderRadius: Math.min(palette.ui.radius.card, 8), backgroundColor: codeTokens.background, borderWidth: 1, borderColor: codeTokens.border }, style]} contentContainerStyle={{ padding: 12 }}>
      <Text style={{ color: codeTokens.text, fontSize: 12, lineHeight: 20, fontFamily: 'monospace', fontWeight: '700' }}>{code}</Text>
    </ScrollView>
  )
}

export function IsleLoading({ label, style }: { label?: string; style?: StyleProp<ViewStyle> }) {
  const palette = useIslePalette()
  const motion = useMotionPreference()
  const loadingTokens = palette.ui.loading
  const loaderWidth = palette.limeRoad ? 76 : 64
  const loaderHeight = palette.limeRoad ? 44 : 36
  const dotSize = palette.limeRoad ? 10 : 8
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center', padding: 12 }, style]}>
      <View style={{ width: loaderWidth, height: loaderHeight, borderRadius: Math.min(palette.ui.radius.controlLarge, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: loadingTokens.background, borderWidth: palette.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: loadingTokens.border }}>
        <View style={{ flexDirection: 'row', gap: 5 }}>
          {[0, 1, 2].map((index) => (
            <MotiView
              key={index}
              animate={motion === 'full' ? { opacity: 0.82, scale: 1 } : { opacity: 0.82, scale: 1 }}
              from={{ opacity: 0.24, scale: 0.9 }}
              transition={motion === 'full' ? { loop: true, type: 'timing', duration: 512, delay: index * 112 } : { type: 'timing', duration: 1 }}
              style={{ width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: loadingTokens.dot }}
            />
          ))}
        </View>
      </View>
      {label ? <Text style={{ color: palette.colors.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 8 }}>{label}</Text> : null}
    </View>
  )
}

export interface IsleProgressProps {
  percent: number
  size?: IsleProgressSize
  showInfo?: boolean
  infoPosition?: IsleProgressInfoPosition
  infoFormat?: (percent: number) => ReactNode
  durationMs?: number
  indeterminate?: boolean
  fillColor?: string
  style?: StyleProp<ViewStyle>
}

const PROGRESS_INSIDE_MIN_FILL = 18

export function IsleProgress({
  percent,
  size = 'middle',
  showInfo = true,
  infoPosition = 'inside',
  infoFormat,
  durationMs,
  indeterminate = false,
  fillColor,
  style,
}: IsleProgressProps) {
  const palette = useIslePalette()
  const motion = useMotionPreference()
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0
  const visualPercent = indeterminate ? Math.max(PROGRESS_INSIDE_MIN_FILL, safePercent || PROGRESS_INSIDE_MIN_FILL) : safePercent
  const trackHeight = size === 'small' ? 7 : size === 'large' ? 12 : 9
  const infoFontSize = size === 'small' ? 10 : size === 'large' ? 12 : 11
  const info = infoFormat ? infoFormat(safePercent) : `${Math.round(safePercent)}%`
  const isInside = showInfo && infoPosition === 'inside'
  const infoInsideVisible = isInside && visualPercent >= PROGRESS_INSIDE_MIN_FILL
  const resolvedDuration = durationMs ?? (motion === 'full' ? 176 : 1)
  const progressBackground = palette.ui.section.divider
  const progressFill = fillColor ?? palette.ui.control.primaryBackground
  const infoColor = palette.colors.textSecondary
  const insideInfoColor = palette.ui.control.primaryForeground

  const track = (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={indeterminate ? { min: 0, max: 100, text: typeof info === 'string' ? info : undefined } : { min: 0, max: 100, now: Math.round(safePercent), text: typeof info === 'string' ? info : undefined }}
      style={{ alignSelf: 'stretch', flexGrow: 1, flexShrink: 1, height: trackHeight, minWidth: 56, borderRadius: palette.ui.radius.chip, backgroundColor: progressBackground, overflow: 'hidden' }}
    >
      <MotiView
        animate={{ width: `${Math.max(indeterminate ? PROGRESS_INSIDE_MIN_FILL : 2, Math.round(visualPercent))}%`, opacity: indeterminate ? 0.72 : 1 }}
        transition={{ type: 'timing', duration: resolvedDuration }}
        style={{ height: trackHeight, borderRadius: palette.ui.radius.chip, backgroundColor: progressFill, alignItems: 'flex-end', justifyContent: 'center', paddingRight: infoInsideVisible ? 6 : 0 }}
      >
        {infoInsideVisible ? (
          <Text numberOfLines={1} style={{ color: insideInfoColor, fontSize: infoFontSize, lineHeight: Math.max(12, infoFontSize + 2), fontWeight: '900', includeFontPadding: false }}>
            {info}
          </Text>
        ) : null}
      </MotiView>
      {isInside && !infoInsideVisible ? (
        <Text numberOfLines={1} style={{ position: 'absolute', right: 6, top: Math.max(0, (trackHeight - Math.max(12, infoFontSize + 2)) / 2), color: infoColor, fontSize: infoFontSize, lineHeight: Math.max(12, infoFontSize + 2), fontWeight: '900', includeFontPadding: false }}>
          {info}
        </Text>
      ) : null}
    </View>
  )

  if (infoPosition === 'top') {
    return (
      <View style={[{ gap: 5 }, style]}>
        {showInfo ? <Text style={{ color: infoColor, fontSize: infoFontSize, lineHeight: Math.max(14, infoFontSize + 4), fontWeight: '900', includeFontPadding: false }}>{info}</Text> : null}
        {track}
      </View>
    )
  }

  if (showInfo && infoPosition === 'right') {
    return (
      <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>
        {track}
        <Text numberOfLines={1} style={{ color: infoColor, fontSize: infoFontSize, lineHeight: Math.max(14, infoFontSize + 4), fontWeight: '900', includeFontPadding: false }}>
          {info}
        </Text>
      </View>
    )
  }

  return <View style={style}>{track}</View>
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
  const rowBorderWidth = palette.limeRoad ? 1 : StyleSheet.hairlineWidth
  const tableMinWidth = Math.max(240, Math.min(280, width - 32))
  const defaultColumnWidth = Math.max(96, Math.min(124, width * 0.32))
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ minWidth: tableMinWidth, borderRadius: Math.min(palette.ui.radius.card, 8), overflow: 'hidden', borderWidth: rowBorderWidth, borderColor: palette.borderLight, backgroundColor: tableBackground }}>
        <View style={{ flexDirection: 'row', backgroundColor: palette.ui.table.headerBackground }}>
          {columns.map((column) => (
            <Text key={String(column.dataIndex)} style={{ width: column.width ?? defaultColumnWidth, padding: 10, color: palette.text, fontSize: 12, fontWeight: '800' }}>{column.title}</Text>
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
          <View style={{ padding: 12, alignItems: 'center' }}>
            {palette.limeRoad ? <AppIcon name="leaf" color={palette.secondary} size={24} /> : null}
            <Text style={{ color: palette.secondary, fontSize: 12, fontWeight: '800', marginTop: palette.limeRoad ? 6 : 0 }}>{emptyText}</Text>
          </View>
        )}
      </View>
    </ScrollView>
  )
}

export function IsleTime({ type = 'game', style }: IsleTimeProps) {
  const palette = useIslePalette()
  const { i18n } = useTranslation()
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const hours = time.getHours().toString().padStart(2, '0')
  const minutes = time.getMinutes().toString().padStart(2, '0')
  const weekday = new Intl.DateTimeFormat(locale, { weekday: type === 'game' ? 'narrow' : 'short' }).format(time)
  const monthDay = new Intl.DateTimeFormat(locale, { month: type === 'game' ? 'numeric' : 'short', day: 'numeric' }).format(time)
  const accessibilityLabel = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(time)
  const frameBorderWidth = palette.limeRoad ? 1 : StyleSheet.hairlineWidth
  const timeFontSize = palette.limeRoad ? 32 : 28
  const frameBackground = palette.glass ? palette.ui.semantic.chrome.background : palette.ui.semantic.surface.base

  if (type === 'game') {
    return (
      <View accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel} style={[{ alignItems: 'center', gap: 10 }, style]}>
        <Text style={{ color: palette.colors.textSecondary, fontSize: 40, lineHeight: 46, fontWeight: '800', letterSpacing: 1, includeFontPadding: false, textAlignVertical: 'center' }}>
          {hours}:{minutes}
        </Text>
        <View style={{ width: '100%', minWidth: 118, height: 3, borderRadius: 2, backgroundColor: palette.ui.time.divider }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 1 }}>
          <Text style={{ color: palette.colors.textSecondary, fontSize: 18, lineHeight: 24, fontWeight: '800', letterSpacing: 0.5, includeFontPadding: false }}>
            {monthDay}
          </Text>
          <View style={{ minWidth: 32, height: 27, paddingHorizontal: 10, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.ui.semantic.surface.muted }}>
            <Text style={{ color: palette.ui.section.title, fontSize: 16, lineHeight: 20, fontWeight: '800', includeFontPadding: false }}>
              {weekday}
            </Text>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel} style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: Math.min(palette.ui.radius.panel, 8), backgroundColor: frameBackground, borderWidth: frameBorderWidth, borderColor: palette.ui.time.border }, style]}>
      <View style={{ paddingRight: palette.limeRoad ? 14 : 14, borderRightWidth: frameBorderWidth, borderRightColor: palette.ui.time.divider }}>
        <Text style={{ color: palette.ui.tone.success.foreground, fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0, includeFontPadding: false, textAlignVertical: 'center' }}>{weekday}</Text>
        <Text style={{ color: palette.colors.textSecondary, fontSize: 18, lineHeight: 23, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center' }}>{monthDay}</Text>
      </View>
      <Text style={{ color: palette.colors.textSecondary, fontSize: timeFontSize, lineHeight: timeFontSize + 5, fontWeight: '800', letterSpacing: 0, includeFontPadding: false, textAlignVertical: 'center' }}>
        {hours}:{minutes}
      </Text>
    </View>
  )
}

export function IslePhone({ title = 'IsleMind', style }: { title?: string; style?: StyleProp<ViewStyle> }) {
  const palette = useIslePalette()
  const { width } = useWindowDimensions()
  const ornamented = palette.limeRoad && palette.ui.ornamented
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
    <View style={[{ width: phoneWidth, borderRadius: Math.min(palette.ui.radius.panel, 8), padding: 12, backgroundColor: phoneSurface, borderWidth: ornamented ? 1 : StyleSheet.hairlineWidth, borderColor: palette.borderLight }, style]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: palette.colors.textSecondary, fontSize: 12, fontWeight: '700' }}>{title}</Text>
        <AppIcon name="more" color={palette.secondary} size={18} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
        {apps.map((app) => (
          <View key={app.name} style={{ width: appTileSize, height: appTileSize, borderRadius: Math.min(palette.ui.radius.card, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: palette.colors.cardColors[app.color].bg, borderWidth: ornamented ? 0 : StyleSheet.hairlineWidth, borderColor: palette.colors.material.stroke }}>
            <IsleIcon name={app.name} color={palette.colors.cardColors[app.color].fg} size={20} />
          </View>
        ))}
      </View>
      <IsleDivider type="line-yellow" style={{ marginTop: 14 }} />
    </View>
  )
}
