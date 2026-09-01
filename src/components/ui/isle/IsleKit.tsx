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
import { resolveThemeComponentExpression } from '@/theme/themeExpression'
import { resolveMinimumTouchTargetHeight } from './touchTarget'
import {
  ThemeButtonExpressionBody,
  ThemeCardExpressionLayers,
  ThemeInputExpressionBody,
} from './ThemeExpressionControls'
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

export const ISLE_MIN_TOUCH_TARGET = 44
const ISLE_INPUT_CLEAR_BUTTON_SIZE = 26

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
  const design = palette.colors.design
  const buttonExpression = design ? resolveThemeComponentExpression(design.family, 'button') : null
  const primary = type === 'primary'
  const link = type === 'link'
  const text = type === 'text' || link
  const height = controlHeight(size)
  const fontSize = textSize(size)
  const disabledStyle = disabledContentStyle(palette)
  const enabledForeground = danger && primary ? control.dangerForeground : link ? control.link : danger ? palette.ui.tone.danger.foreground : primary ? control.primaryForeground : palette.text
  const foreground = disabled ? disabledStyle.foreground : enabledForeground
  const expressionBackground = primary
    ? design?.component.button.primaryBackground
    : design?.component.button.secondaryBackground
  const enabledBackground = ghost || text
    ? 'transparent'
    : danger && primary
      ? palette.ui.tone.danger.foreground
      : primary
        ? expressionBackground ?? control.primaryBackground
        : expressionBackground
          ?? (palette.glass
            ? palette.ui.actionBar.itemBackground
            : palette.minimal
              ? 'transparent'
              : palette.colors.design?.family === 'monet'
                ? palette.ui.semantic.surface.base
                : control.defaultBackground)
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
  // A button is a control, not a card. Keep one boundary and reserve lift for
  // the Liquid Glass lens where it actually communicates material.
  const shadowOpacity = buttonExpression?.elevation === 'layered' ? 0.08 : 0
  const shadowRadius = buttonExpression?.elevation === 'layered' ? Math.min(10, design?.semantic.elevation.shadowBlur ?? 8) : 0
  const pressedOffset = buttonExpression?.interaction === 'physical' ? 1 : 0
  const borderWidth = text
    ? 0
    : type === 'dashed'
      ? StyleSheet.hairlineWidth
      : buttonExpression?.border === 'none'
        ? 0
        : buttonExpression?.border === 'outline' || buttonExpression?.border === 'edge-highlight'
          ? 1
          : palette.minimal
            ? 0
            : StyleSheet.hairlineWidth
  const resolvedShadowOpacity = shadowOpacity
  const buttonAccessibilityState = loading
    ? { ...accessibilityState, busy: true }
    : accessibilityState
  const flattenedStyle = StyleSheet.flatten(style)
  const minimumButtonHeight = resolveMinimumTouchTargetHeight(height, flattenedStyle, ISLE_MIN_TOUCH_TARGET)
  const iconNode = loading || icon ? (
    <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {loading ? (
        <HighFrameSpinner color={foreground} size={16} />
      ) : icon}
    </View>
  ) : undefined
  const contentNode = children || label ? (
    <Text numberOfLines={1} style={[{ flexShrink: 1, minWidth: 0, color: foreground, fontSize, lineHeight: Math.max(16, fontSize + 4), fontWeight: design?.semantic.typography.label.fontWeight ?? (primary ? '700' : '600'), letterSpacing: design?.semantic.typography.label.letterSpacing ?? 0, includeFontPadding: false, textAlignVertical: 'center' }, textStyle]}>
      {children ?? label}
    </Text>
  ) : undefined
  return (
    <PressableScale
      haptic
      interactionProfile={buttonExpression?.motion ?? 'default'}
      scaleTo={
        buttonExpression?.interaction === 'physical'
          ? 0.968
          : buttonExpression?.interaction === 'breathing'
            ? 0.984
            : buttonExpression?.interaction === 'state-layer'
              ? 0.978
              : 0.99
      }
      disabled={disabled || loading}
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={buttonAccessibilityState}
      testID={testID}
      style={[
        {
          position: 'relative',
          alignSelf: block ? 'stretch' : 'flex-start',
           borderRadius: buttonExpression?.shape === 'capsule'
             ? palette.ui.radius.chip
             : buttonExpression?.shape === 'material'
               ? palette.ui.radius.controlMiddle
               : buttonExpression?.shape === 'soft'
                 ? palette.ui.radius.controlLarge
                 : controlRadius(size, palette),
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
               shadowOpacity: palette.minimal ? 0 : resolvedShadowOpacity,
               shadowRadius,
              shadowOffset: { width: 0, height: pressedOffset },
              elevation: resolvedShadowOpacity > 0 ? 1 : 0,
            },
          }),
        },
        style,
        { minHeight: minimumButtonHeight },
      ]}
    >
      <ThemeButtonExpressionBody
        family={design?.family ?? 'minimal'}
        colors={palette.colors}
        icon={iconNode}
        content={contentNode}
        primary={primary}
      />
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
  const design = palette.colors.design
  const fieldExpression = design ? resolveThemeComponentExpression(design.family, 'textField') : null
  const fieldTokens = design?.component.field
  const fieldFamily = design?.family ?? 'minimal'
  const borderColor = status === 'error'
    ? palette.ui.tone.danger.border
    : status === 'warning'
      ? palette.ui.tone.warning.border
      : fieldExpression?.border === 'none'
        ? 'transparent'
        : input.border
  const activeBorderColor = focused && !disabled ? input.focus : borderColor
  const statusShadow = status === 'error' ? palette.ui.tone.danger.foreground : status === 'warning' ? palette.ui.tone.warning.foreground : input.shadow
  const shadowEnabled = shadow || !!status
  const height = controlHeight(size)
  const inputBorderWidth = status
    ? 1
    : fieldFamily === 'material'
      ? fieldExpression?.border === 'none' ? 0 : 1
      : 0
  const fieldRadius = fieldExpression?.shape === 'capsule'
    ? palette.ui.radius.chip
    : fieldExpression?.shape === 'material'
      ? design?.semantic.radius.medium ?? controlRadius(size, palette)
      : fieldExpression?.shape === 'soft'
        ? palette.ui.radius.controlLarge
        : controlRadius(size, palette)
  const clearButtonBackground = palette.glass
    ? palette.ui.actionBar.itemBackground
    : palette.limeRoad
      ? palette.ui.semantic.surface.muted
      : palette.ui.semantic.surface.muted
  const inputShadowOpacity = shadowEnabled && fieldFamily === 'liquid-glass'
    ? 0.08
    : 0
  const inputShadowRadius = shadowEnabled && fieldExpression?.elevation !== 'none'
    ? Math.min(18, design?.semantic.elevation.shadowBlur ?? 8)
    : 0
  const inputElevation = shadowEnabled
    ? fieldExpression?.elevation === 'layered'
      ? 2
      : fieldExpression?.elevation === 'low' || fieldExpression?.elevation === 'tonal'
        ? 1
        : 0
    : 0
  const multilineMaxHeight = 156
  const multilineShellHeight = multiline
    ? Math.max(76, Math.min(multilineMaxHeight, Math.ceil(multilineContentHeight || 56) + 18))
    : undefined
  const inputMinimumHeight = multiline ? 76 : Math.max(height, ISLE_MIN_TOUCH_TARGET)
  return (
    <View style={wrapperStyle}>
      {label ? <Text style={{ color: palette.colors.textSecondary, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>{label}</Text> : null}
      <MotiView
        animate={{
          backgroundColor: disabled
            ? input.disabledBackground
            : fieldFamily === 'minimal'
              ? 'transparent'
              : focused
                ? input.backgroundFocused
                : input.background,
          borderColor: activeBorderColor,
        }}
        transition={{ type: 'timing', duration: motion === 'full' ? design?.semantic.motion.interaction ?? motionTokens.duration.fast : 1 }}
        style={{
          height: multilineShellHeight,
          minHeight: Math.max(inputMinimumHeight, fieldTokens?.minHeight ?? inputMinimumHeight),
          maxHeight: multiline ? multilineMaxHeight : undefined,
          borderRadius: fieldRadius,
          paddingHorizontal: size === 'large' ? 16 : 12,
          position: 'relative',
          borderWidth: inputBorderWidth,
          shadowColor: statusShadow,
          shadowOpacity: inputShadowOpacity,
          shadowRadius: inputShadowRadius,
          shadowOffset: { width: 0, height: 0 },
          elevation: inputElevation,
        }}
      >
        <ThemeInputExpressionBody
          family={design?.family ?? 'minimal'}
          colors={palette.colors}
          focused={focused}
          multiline={!!multiline}
          prefix={prefix}
          input={(
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
                  minHeight: multiline ? Math.max(64, multilineShellHeight ? multilineShellHeight - 6 : 78) : Math.max(44, (fieldTokens?.minHeight ?? height) - 4),
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
          )}
          suffix={allowClear && currentValue && !disabled ? (
          <PressableScale haptic accessibilityLabel={clearAccessibilityLabel ?? (label ? `${t('common.clear')} ${label}` : t('common.clear'))} onPress={() => {
            if (!controlled) setUncontrolledValue('')
            onChangeText?.('')
            onClear?.()
          }} style={{ width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}>
             <View style={{ width: ISLE_INPUT_CLEAR_BUTTON_SIZE, height: ISLE_INPUT_CLEAR_BUTTON_SIZE, borderRadius: fieldExpression?.shape === 'capsule' ? palette.ui.radius.chip : Math.min(palette.ui.radius.controlSmall, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: clearButtonBackground }}>
              <AppIcon name="close" color={palette.secondary} size={13} />
            </View>
          </PressableScale>
          ) : suffix ? suffix : undefined}
        />
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
  const switchExpression = palette.colors.design ? resolveThemeComponentExpression(palette.colors.design.family, 'switch') : null
  const disabledStyle = disabledContentStyle(palette)
  const switchGrammar = switchExpression?.motion ?? 'precision'
  const width = size === 'small'
    ? switchGrammar === 'precision' ? 36 : switchGrammar === 'organic' ? 40 : 38
    : switchGrammar === 'precision' ? 48 : switchGrammar === 'organic' ? 54 : switchGrammar === 'fluid' ? 54 : 52
  const height = size === 'small'
    ? switchGrammar === 'precision' ? 18 : switchGrammar === 'organic' ? 22 : 20
    : switchGrammar === 'precision' ? 24 : switchGrammar === 'organic' ? 30 : switchGrammar === 'fluid' ? 30 : 28
  const touchWidth = Math.max(width, ISLE_MIN_TOUCH_TARGET)
  const trackLeft = (touchWidth - width) / 2
  const trackTop = (ISLE_MIN_TOUCH_TARGET - height) / 2
  const borderWidth = switchExpression?.border === 'none' ? 0 : switchGrammar === 'precision' ? StyleSheet.hairlineWidth : 1
  const thumbInset = switchGrammar === 'precision' ? 3 : switchGrammar === 'organic' ? 4 : 3
  const knob = height - thumbInset * 2
  const thumbTravel = width - knob - thumbInset * 2
  const switchTextColor = disabled ? disabledStyle.foreground : active ? palette.ui.control.primaryForeground : palette.colors.textSecondary
  const switchTransition = motion !== 'full'
    ? { type: 'timing' as const, duration: 1 }
    : switchGrammar === 'fluid'
      ? { type: 'spring' as const, damping: 19, stiffness: 260, mass: 0.7 }
      : { type: 'timing' as const, duration: switchGrammar === 'precision' ? 110 : switchGrammar === 'organic' ? 280 : 190 }
  const trackRadius = switchGrammar === 'precision' ? 2 : switchGrammar === 'material' ? height / 2 : height / 2
  const thumbRadius = switchGrammar === 'precision' ? 2 : knob / 2
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
      interactionProfile={switchExpression?.motion ?? 'default'}
      testID={`theme-switch-${palette.colors.design?.family ?? 'minimal'}`}
      style={{
        width: touchWidth,
        height: ISLE_MIN_TOUCH_TARGET,
        alignItems: 'flex-start',
        justifyContent: 'center',
        opacity: 1,
      }}
    >
      <MotiView
        animate={{
          backgroundColor: disabled ? disabledStyle.backgroundColor : active ? switchTokens.trackOn : switchTokens.trackOff,
          borderColor: disabled ? disabledStyle.borderColor : active ? switchTokens.trackOnBorder : switchTokens.trackOffBorder,
        }}
        transition={switchTransition}
        style={{ position: 'absolute', top: trackTop, left: trackLeft, width, height, borderRadius: trackRadius, borderWidth, overflow: 'hidden' }}
      >
        {switchGrammar === 'organic' ? (
          <View accessible={false} pointerEvents="none" style={{ position: 'absolute', width: width * 0.64, height: height * 0.9, borderRadius: height, top: -height * 0.18, left: active ? width * 0.24 : -width * 0.08, backgroundColor: palette.ui.icon.accentBackground, opacity: active ? 0.48 : 0.18 }} />
        ) : null}
        {switchGrammar === 'material' && active ? (
          <View accessible={false} pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: palette.ui.icon.accentBackground, opacity: 0.18 }} />
        ) : null}
        {switchGrammar === 'fluid' ? (
          <View accessible={false} pointerEvents="none" style={{ position: 'absolute', top: 1, right: 7, left: 7, height: StyleSheet.hairlineWidth, backgroundColor: palette.ui.control.primaryForeground, opacity: active ? 0.62 : 0.32 }} />
        ) : null}
        <MotiView
          animate={{ translateX: active ? thumbTravel : 0 }}
          transition={switchTransition}
          style={{
            position: 'absolute',
            top: thumbInset,
            left: thumbInset,
            width: knob,
            height: knob,
            borderRadius: thumbRadius,
            backgroundColor: disabled ? palette.ui.semantic.surface.base : switchTokens.thumb,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: disabled ? disabledStyle.borderColor : active ? switchTokens.thumbOnBorder : switchTokens.thumbOffBorder,
            shadowColor: switchGrammar === 'fluid' || switchGrammar === 'organic' ? palette.shadow : 'transparent',
            shadowOpacity: switchGrammar === 'fluid' ? 0.18 : switchGrammar === 'organic' ? 0.08 : 0,
            shadowRadius: switchGrammar === 'fluid' ? 6 : switchGrammar === 'organic' ? 4 : 0,
            shadowOffset: { width: 0, height: switchGrammar === 'fluid' ? 3 : 2 },
            elevation: switchGrammar === 'fluid' ? 2 : 0,
          }}
        />
        {checkedChildren || unCheckedChildren ? (
          <Text style={{ position: 'absolute', top: 0, bottom: 0, left: active ? 7 : knob + thumbInset + 4, right: active ? knob + thumbInset + 4 : 7, color: switchTextColor, fontSize: 10, lineHeight: height, fontWeight: '800', textAlign: active ? 'left' : 'right', includeFontPadding: false, textAlignVertical: 'center' }}>
            {active ? checkedChildren : unCheckedChildren}
          </Text>
        ) : null}
      </MotiView>
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
  const design = palette.colors.design
  const cardExpression = design ? resolveThemeComponentExpression(design.family, 'card') : null
  const panelTokens = design?.component.panel
  const selected = palette.colors.cardColors[color]
  const titleCard = type === 'title'
  const uiCard = palette.ui.card
  const family = design?.family ?? 'minimal'
  const explicitColor = color !== 'default'
  const continuousCard = family === 'minimal' && !explicitColor && type === 'default'
  const cardBackground = color === 'default'
    ? continuousCard
      ? 'transparent'
      : family === 'liquid-glass'
        ? palette.ui.semantic.surface.overlay
        : family === 'monet'
          ? palette.ui.semantic.surface.base
          : panelTokens?.background ?? uiCard.defaultBackground
    : selected.bg
  const cardBorderColor = type === 'dashed'
    ? hoverable && hovered
      ? palette.colors.borderStrong
      : palette.borderLight
    : continuousCard || cardExpression?.border === 'none'
      ? 'transparent'
      : cardExpression?.border === 'divider'
        ? palette.ui.semantic.chrome.border
        : palette.border
  const interactive = hoverable || !!onPress
  const hoverOffset = hoverable && hovered && !disabled && type !== 'dashed' && motion === 'full'
    ? cardExpression?.interaction === 'physical'
      ? -3
      : cardExpression?.interaction === 'breathing'
        ? -2
        : cardExpression?.interaction === 'state-layer'
          ? -1
          : 0
    : 0
  const cardRadius = cardExpression?.shape === 'capsule'
    ? palette.ui.radius.chip
    : cardExpression?.shape === 'material'
      ? design?.semantic.radius.large ?? organicRadius(titleCard, palette)
      : cardExpression?.shape === 'soft'
        ? palette.ui.radius.card
        : organicRadius(titleCard, palette)
  const cardElevation = cardExpression?.elevation
  const cardShadowOpacity = continuousCard
    ? 0
    : cardElevation === 'layered'
      ? 0.08
      : cardElevation === 'low' || cardElevation === 'tonal'
        ? 0.04
        : 0
  const cardShadowRadius = cardShadowOpacity > 0 ? Math.min(14, design?.semantic.elevation.shadowBlur ?? uiCard.shadowRadius) : 0
  const cardElevationValue = cardShadowOpacity > 0 ? 1 : 0
  const cardStyle: StyleProp<ViewStyle> = [
    {
      position: 'relative',
      top: hoverOffset,
      borderRadius: cardRadius,
      padding: continuousCard ? 4 : titleCard ? 12 : 8,
      backgroundColor: cardBackground,
      borderWidth: type === 'dashed' ? StyleSheet.hairlineWidth : continuousCard || cardExpression?.border === 'none' ? 0 : cardExpression?.border === 'outline' || cardExpression?.border === 'edge-highlight' ? 1 : StyleSheet.hairlineWidth,
      borderStyle: type === 'dashed' ? 'dashed' : 'solid',
      borderColor: cardBorderColor,
      shadowColor: palette.colors.shadowTint,
      shadowOpacity: cardShadowOpacity,
      shadowRadius: cardShadowRadius,
      shadowOffset: { width: 0, height: cardShadowOpacity > 0 ? (design?.semantic.elevation.shadowOffsetY ?? 2) : 0 },
      elevation: cardElevationValue,
      cursor: interactive ? 'pointer' : 'auto',
      opacity: disabled ? 0.72 : 1,
      overflow: 'hidden',
    },
    style,
    contentStyle,
  ]

  const cardLayers = (
    <ThemeCardExpressionLayers
      family={family}
      colors={palette.colors}
      interactive={interactive}
      titleCard={titleCard}
    />
  )

  if (!interactive) return <View style={cardStyle}>{cardLayers}{children}</View>

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
      {cardLayers}
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
      <PressableScale haptic disabled={disabled} onPress={() => setExpanded((value) => !value)} accessibilityLabel={questionLabel} accessibilityState={{ expanded }} style={{ minHeight: ISLE_MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
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
      <View accessibilityViewIsModal style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
        <Pressable
          onPress={maskClosable ? onClose : undefined}
          accessible={false}
          accessibilityRole="none"
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
  const selectExpression = palette.colors.design ? resolveThemeComponentExpression(palette.colors.design.family, 'dropdown') : null
  const selectGrammar = selectExpression?.motion ?? 'precision'
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
            transition={{ type: 'timing', duration: motion === 'full' ? selectGrammar === 'precision' ? 100 : selectGrammar === 'organic' ? 220 : 160 : 1 }}
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
            testID={`theme-dropdown-${palette.colors.design?.family ?? 'minimal'}`}
            from={motion === 'full'
              ? selectGrammar === 'precision'
                ? { opacity: 0, translateY: -2 }
                : selectGrammar === 'organic'
                  ? { opacity: 0, translateY: -7, scale: 0.985 }
                  : selectGrammar === 'material'
                    ? { opacity: 0, translateY: -4, scale: 0.97 }
                    : { opacity: 0, translateY: -8, scale: 0.95 }
              : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={motion === 'full' ? { opacity: 0, translateY: selectGrammar === 'precision' ? -2 : -4, scale: selectGrammar === 'precision' ? 1 : 0.98 } : { opacity: 0 }}
            transition={motion !== 'full'
              ? { type: 'timing', duration: 1 }
              : selectGrammar === 'fluid'
                ? { type: 'spring', damping: 20, stiffness: 250, mass: 0.72 }
                : { type: 'timing', duration: selectGrammar === 'precision' ? 110 : selectGrammar === 'organic' ? 240 : 180 }}
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
                    interactionProfile={selectExpression?.motion ?? 'default'}
                    style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(palette.ui.radius.controlSmall, 8), paddingHorizontal: 10, justifyContent: 'center' }}
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
  const checkboxExpression = palette.colors.design ? resolveThemeComponentExpression(palette.colors.design.family, 'checkbox') : null
  const checkboxGrammar = checkboxExpression?.motion ?? 'precision'
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
          <PressableScale key={option.value} haptic disabled={optionDisabled} accessibilityRole="checkbox" accessibilityLabel={option.label} accessibilityState={{ checked: active }} interactionProfile={checkboxExpression?.motion ?? 'default'} testID={`theme-checkbox-${palette.colors.design?.family ?? 'minimal'}-${option.value}`} onPress={() => toggle(option)} style={{ minHeight: Math.max(34, box + 10), flexDirection: 'row', alignItems: 'center', gap: checkboxGrammar === 'organic' ? 10 : 8 }}>
            <MotiView
              animate={{ backgroundColor: boxBackground, borderColor: boxBorder, rotate: active && checkboxGrammar === 'organic' ? '-2deg' : '0deg', scale: active && checkboxGrammar === 'fluid' ? 1.04 : 1 }}
              transition={motion !== 'full'
                ? { type: 'timing', duration: 1 }
                : checkboxGrammar === 'fluid'
                  ? { type: 'spring', damping: 18, stiffness: 300, mass: 0.62 }
                  : { type: 'timing', duration: checkboxGrammar === 'precision' ? 100 : checkboxGrammar === 'organic' ? 240 : 180 }}
              style={{ width: box, height: box, borderRadius: checkboxGrammar === 'precision' ? 2 : checkboxGrammar === 'organic' ? Math.min(9, box * 0.38) : checkboxGrammar === 'fluid' ? Math.min(10, box / 2) : Math.min(palette.ui.radius.controlSmall, 8), alignItems: 'center', justifyContent: 'center', borderWidth: checkboxExpression?.border === 'none' ? 0 : checkboxGrammar === 'precision' ? StyleSheet.hairlineWidth : 1, shadowColor: checkboxGrammar === 'fluid' || checkboxGrammar === 'organic' ? palette.shadow : undefined, shadowOpacity: checkboxGrammar === 'fluid' && active ? 0.16 : checkboxGrammar === 'organic' && active ? 0.07 : 0, shadowRadius: checkboxGrammar === 'fluid' ? 6 : 4, shadowOffset: { width: 0, height: 2 }, elevation: checkboxGrammar === 'fluid' && active ? 2 : 0 }}
            >
              {checkboxGrammar === 'material' && active ? <View accessible={false} pointerEvents="none" style={{ position: 'absolute', top: -5, right: -5, bottom: -5, left: -5, borderRadius: box, backgroundColor: palette.ui.icon.accentBackground, opacity: 0.18 }} /> : null}
              {checkboxGrammar === 'fluid' ? <View accessible={false} pointerEvents="none" style={{ position: 'absolute', top: 1, right: 4, left: 4, height: StyleSheet.hairlineWidth, backgroundColor: palette.ui.control.primaryForeground, opacity: active ? 0.72 : 0.32 }} /> : null}
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
  const palette = useIslePalette()
  const motion = useMotionPreference()
  const design = palette.colors.design
  const tabsExpression = resolveThemeComponentExpression(design?.family ?? 'minimal', 'tabs')
  const grammar = tabsExpression.motion
  const glassStyle = grammar === 'fluid' && Platform.OS === 'web'
    ? ({ backdropFilter: 'blur(12px) saturate(1.12)' } as unknown as ViewStyle)
    : null
  const containerBackground = grammar === 'precision'
    ? 'transparent'
    : grammar === 'organic'
      ? palette.ui.semantic.surface.base
      : grammar === 'material'
        ? palette.ui.semantic.surface.muted
        : palette.ui.semantic.surface.overlay
  const containerRadius = grammar === 'precision'
    ? 0
    : grammar === 'organic'
      ? palette.ui.radius.controlLarge
      : grammar === 'material'
        ? palette.ui.radius.controlMiddle
        : palette.ui.radius.chip
  return (
    <ScrollView
      horizontal
      testID={`isle-tabs-${design?.family ?? 'minimal'}`}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: grammar === 'precision' ? 16 : grammar === 'organic' ? 7 : grammar === 'material' ? 4 : 6,
        paddingHorizontal: grammar === 'precision' ? 0 : 5,
        paddingVertical: grammar === 'precision' ? 0 : 5,
      }}
      style={[
        {
          borderRadius: containerRadius,
          backgroundColor: containerBackground,
          borderBottomWidth: grammar === 'precision' ? StyleSheet.hairlineWidth : 0,
          borderWidth: grammar === 'fluid' ? 1 : grammar === 'organic' ? StyleSheet.hairlineWidth : 0,
          borderColor: grammar === 'fluid' ? palette.ui.actionBar.itemBorder : palette.ui.semantic.chrome.border,
          overflow: 'hidden',
        },
        glassStyle,
        style,
      ]}
    >
      {items.map((item) => {
        const active = activeKey === item.key
        const selectedBackground = grammar === 'precision'
          ? 'transparent'
          : grammar === 'organic'
            ? palette.ui.icon.accentBackground
            : grammar === 'material'
              ? palette.ui.control.primaryBackground
              : palette.ui.actionBar.itemBackground
        const selectedForeground = grammar === 'material'
          ? palette.ui.control.primaryForeground
          : active
            ? palette.ui.icon.accentForeground
            : palette.colors.textSecondary
        return (
          <PressableScale
            key={item.key}
            interactionProfile={tabsExpression.motion}
            disabled={item.disabled}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active, disabled: !!item.disabled }}
            onPress={() => onChange?.(item.key)}
            style={{
              minHeight: ISLE_MIN_TOUCH_TARGET,
              minWidth: 48,
              borderRadius: grammar === 'precision' ? 0 : grammar === 'organic' ? palette.ui.radius.controlLarge : grammar === 'material' ? palette.ui.radius.controlMiddle : palette.ui.radius.chip,
              overflow: 'hidden',
              opacity: item.disabled ? palette.ui.control.disabledOpacity : 1,
            }}
          >
            <MotiView
              animate={{
                backgroundColor: active ? selectedBackground : 'transparent',
                translateY: grammar === 'organic' && active && motion === 'full' ? -1 : 0,
              }}
              transition={{ type: 'timing', duration: motion === 'full' ? design?.semantic.motion.interaction ?? motionTokens.duration.fast : 1 }}
              style={{
                minHeight: ISLE_MIN_TOUCH_TARGET,
                paddingHorizontal: grammar === 'precision' ? 2 : grammar === 'organic' ? 13 : grammar === 'material' ? 14 : 12,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: grammar === 'precision' ? 0 : grammar === 'organic' ? palette.ui.radius.controlLarge : grammar === 'material' ? palette.ui.radius.controlMiddle : palette.ui.radius.chip,
                borderWidth: grammar === 'fluid' && active ? StyleSheet.hairlineWidth : 0,
                borderColor: palette.ui.actionBar.itemBorder,
              }}
            >
              {grammar === 'organic' && active ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 12, right: 12, height: 2, backgroundColor: palette.ui.control.focus, opacity: 0.24 }} /> : null}
              {grammar === 'fluid' && active ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 10, right: 10, height: 1, backgroundColor: palette.ui.semantic.content.inverse, opacity: 0.62 }} /> : null}
              <Text style={{ color: selectedForeground, fontSize: 12, lineHeight: 16, fontWeight: active ? '800' : '700' }}>
                {item.label}
              </Text>
              {active && grammar === 'precision' ? <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: palette.ui.control.primaryBackground }} /> : null}
              {active && grammar === 'material' ? <View style={{ position: 'absolute', left: 14, right: 14, bottom: 3, height: 2, borderRadius: 2, backgroundColor: palette.ui.control.primaryForeground, opacity: 0.72 }} /> : null}
            </MotiView>
          </PressableScale>
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
  const design = palette.colors.design
  const loadingExpression = design ? resolveThemeComponentExpression(design.family, 'loading') : null
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} style={[{ alignItems: 'center', justifyContent: 'center', padding: 12 }, style]}>
      {renderThemeLoadingIndicator({
        grammar: loadingExpression?.motion ?? 'precision',
        palette,
        motion,
        background: loadingTokens.background,
        border: loadingTokens.border,
        foreground: loadingTokens.dot,
      })}
      {label ? <Text style={{ color: palette.colors.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 8 }}>{label}</Text> : null}
    </View>
  )
}

function renderThemeLoadingIndicator({
  grammar,
  palette,
  motion,
  background,
  border,
  foreground,
}: {
  grammar: 'precision' | 'organic' | 'material' | 'fluid'
  palette: ReturnType<typeof useIslePalette>
  motion: ReturnType<typeof useMotionPreference>
  background: string
  border: string
  foreground: string
}) {
  if (grammar === 'organic') {
    return (
      <View style={{ width: 78, height: 46, borderRadius: palette.ui.radius.controlLarge, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: background, borderWidth: 1, borderColor: border }}>
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 18, right: 18, height: 2, backgroundColor: palette.ui.control.focus, opacity: 0.22 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          {[0, 1, 2].map((index) => (
            <MotiView
              key={index}
              from={{ opacity: 0.28, scale: 0.82, translateY: 2 }}
              animate={{ opacity: 0.86, scale: 1, translateY: 0 }}
              transition={motion === 'full' ? { loop: true, type: 'timing', duration: 760, delay: index * 150 } : { type: 'timing', duration: 1 }}
              style={{ width: index === 1 ? 10 : 8, height: index === 1 ? 10 : 8, borderRadius: 10, backgroundColor: foreground }}
            />
          ))}
        </View>
      </View>
    )
  }

  if (grammar === 'material') {
    return (
      <View style={{ width: 72, minHeight: 36, justifyContent: 'center', paddingHorizontal: 10, borderRadius: palette.ui.radius.controlMiddle, backgroundColor: background }}>
        <View style={{ height: 4, borderRadius: 4, overflow: 'hidden', backgroundColor: palette.ui.section.divider }}>
          <MotiView
            from={{ translateX: -22, opacity: 0.72 }}
            animate={{ translateX: 64, opacity: 1 }}
            transition={motion === 'full' ? { loop: true, type: 'timing', duration: 680 } : { type: 'timing', duration: 1 }}
            style={{ width: 24, height: 4, borderRadius: 4, backgroundColor: foreground }}
          />
        </View>
      </View>
    )
  }

  if (grammar === 'fluid') {
    const glassStyle = Platform.OS === 'web'
      ? ({ backdropFilter: 'blur(14px) saturate(1.14)' } as unknown as ViewStyle)
      : null
    return (
      <View style={[{ width: 76, height: 38, borderRadius: palette.ui.radius.chip, justifyContent: 'center', overflow: 'hidden', backgroundColor: background, borderWidth: 1, borderColor: border, shadowColor: palette.shadow, shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2 }, glassStyle]}>
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 12, right: 12, height: 1, backgroundColor: palette.colors.ui.semantic.content.inverse, opacity: 0.52 }} />
        <View style={{ height: 6, marginHorizontal: 10, borderRadius: 6, overflow: 'hidden', backgroundColor: palette.ui.semantic.surface.muted }}>
          <MotiView
            from={{ translateX: -24, opacity: 0.28, scaleX: 0.72 }}
            animate={{ translateX: 64, opacity: 0.9, scaleX: 1 }}
            transition={motion === 'full' ? { loop: true, type: 'timing', duration: 920 } : { type: 'timing', duration: 1 }}
            style={{ width: 24, height: 6, borderRadius: 6, backgroundColor: foreground }}
          />
        </View>
      </View>
    )
  }

  return (
    <View style={{ width: 64, height: 32, justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: border }}>
      <View style={{ gap: 4 }}>
        {[32, 22, 14].map((width, index) => (
          <MotiView
            key={width}
            from={{ opacity: index === 0 ? 0.42 : 0.2 }}
            animate={{ opacity: index === 0 ? 0.92 : 0.54 }}
            transition={motion === 'full' ? { loop: true, type: 'timing', duration: 520, delay: index * 70 } : { type: 'timing', duration: 1 }}
            style={{ width, height: 2, backgroundColor: foreground }}
          />
        ))}
      </View>
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
