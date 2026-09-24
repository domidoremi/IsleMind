import { useEffect, useState, type ReactNode } from 'react'
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { MotiView } from 'moti'
import { Button as NativeButton, Input as NativeInput, Switch as NativeSwitch, Card as NativeCard, Select as NativeSelect, Progress as NativeProgress } from 'animal-island-ui-rn'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { HighFrameSpinner } from '@/components/ui/HighFrameSpinner'
import { PressableScale } from '@/components/ui/PressableScale'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { useThemeMotion } from '@/hooks/useThemeMotion'
import { resolveThemeComponentExpression } from '@/theme/themeExpression'
import type { MotionIntensity } from '@/theme/themeMotion'
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

export type IsleProgressSize = 'small' | 'middle' | 'large'
export type IsleProgressInfoPosition = 'inside' | 'right' | 'top'

export const ISLE_MIN_TOUCH_TARGET = 44
const ISLE_INPUT_CLEAR_BUTTON_SIZE = 26

function useIslePalette() {
  const { colors, isDark, canonicalThemeId } = useAppTheme()
  const sharedSurface = colors.ui.liquidGlass
    ? colors.ui.semantic.chrome.background
    : colors.ui.semantic.surface.base
  const sharedCard = colors.ui.liquidGlass
    ? colors.ui.actionBar.itemBackground
    : colors.ui.semantic.surface.base
  const sharedBorder = colors.ui.liquidGlass
    ? colors.ui.actionBar.itemBorder
    : colors.ui.monet
      ? colors.material.strokeStrong
      : colors.ui.semantic.chrome.border
  const sharedBorderLight = colors.ui.liquidGlass
    ? colors.ui.actionBar.itemBorder
    : colors.ui.monet
      ? colors.material.stroke
      : colors.ui.semantic.chrome.border
  return {
    colors,
    isDark,
    themeId: canonicalThemeId,
    ui: colors.ui,
    minimal: colors.ui.minimal,
    liquidGlass: colors.ui.liquidGlass,
    monet: colors.ui.monet,
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
          ?? (palette.liquidGlass
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
  if (palette.themeId === 'animal-island-ui') {
    return <NativeButton type={type} size={size} danger={danger} ghost={ghost} block={block} loading={loading} disabled={disabled}
      icon={icon} onPress={onPress} accessibilityLabel={accessibilityLabel ?? label} accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState} testID={testID} textStyle={textStyle} style={[style, { minHeight: minimumButtonHeight }]}>
      {children ?? label}
    </NativeButton>
  }
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
          borderStyle: type === 'dashed' && palette.monet ? 'dashed' : 'solid',
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
  const focusMotion = useThemeMotion('accent')
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
  const fieldRadius = multiline ? palette.ui.radius.controlLarge : fieldExpression?.shape === 'capsule'
    ? palette.ui.radius.chip
    : fieldExpression?.shape === 'material'
      ? design?.semantic.radius.medium ?? controlRadius(size, palette)
      : fieldExpression?.shape === 'soft'
        ? palette.ui.radius.controlLarge
        : controlRadius(size, palette)
  const clearButtonBackground = palette.liquidGlass
    ? palette.ui.actionBar.itemBackground
    : palette.monet
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
  if (palette.themeId === 'animal-island-ui') {
    return <View style={wrapperStyle}>
      {label ? <Text style={{ color: palette.colors.textSecondary, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>{label}</Text> : null}
      <NativeInput prefix={prefix} suffix={suffix} allowClear={allowClear} status={status} size={size} shadow={shadow}
        value={currentValue} onChangeText={(nextValue) => {
          if (!controlled) setUncontrolledValue(nextValue)
          onChangeText?.(nextValue)
        }} onClear={onClear}
        clearAriaLabel={clearAccessibilityLabel ?? t('common.clear')} disabled={disabled} onFocus={onFocus} onBlur={onBlur}
        multiline={multiline} aria-label={props.accessibilityLabel ?? label}
        inputProps={{ ...props, scrollEnabled: multiline ? scrollEnabled ?? true : scrollEnabled,
          onContentSizeChange: (event) => {
            if (multiline) setMultilineContentHeight(event.nativeEvent.contentSize.height)
            onContentSizeChange?.(event)
          } }} inputStyle={inputStyle}
        style={{ minHeight: inputMinimumHeight, height: multiline ? multilineShellHeight : inputMinimumHeight }} />
    </View>
  }
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
        transition={focusMotion.transition}
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
  const switchMotion = useThemeMotion('accent')
  const motion = switchMotion.intensity
  const [internal, setInternal] = useState(defaultChecked)
  const active = checked ?? internal
  if (palette.themeId === 'animal-island-ui') {
    return <View style={{ minHeight: ISLE_MIN_TOUCH_TARGET, justifyContent: 'center' }}>
      <NativeSwitch checked={active} size={size} disabled={disabled} loading={loading}
        checkedChildren={checkedChildren} unCheckedChildren={unCheckedChildren} onChange={(next) => {
          if (checked === undefined) setInternal(next)
          onChange?.(next)
        }} hitSlop={12} />
    </View>
  }
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
      ? { type: 'spring' as const, damping: 19, stiffness: 260, mass: 0.7, overshootClamping: true }
      : switchMotion.transition
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
  const motion = useMotionPreference(true)
  const [hovered, setHovered] = useState(false)
  if (palette.themeId === 'animal-island-ui') {
    return <NativeCard type={type === 'dashed' ? 'dashed' : 'default'} color={color} hoverable={hoverable}
      onPress={disabled ? undefined : onPress} aria-label={accessibilityLabel} style={[style, contentStyle]}>{children}</NativeCard>
  }
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
  const menuMotion = useThemeMotion('overlay', { readable: true })
  const accentMotion = useThemeMotion('accent')
  const motion = menuMotion.intensity
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  const selected = options.find((option) => option.value === value)
  if (palette.themeId === 'animal-island-ui') {
    return <NativeSelect options={options.map((option) => ({ key: option.value, label: option.label, disabled: option.disabled }))}
      value={value ?? ''} placeholder={placeholder} disabled={disabled} onChange={(next) => onChange?.(next)} style={style} />
  }
  const selectExpression = palette.colors.design ? resolveThemeComponentExpression(palette.colors.design.family, 'dropdown') : null
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
        accessibilityState={{ expanded: open && !disabled }}
        icon={
          <MotiView
            animate={{ rotate: open ? '180deg' : '0deg' }}
            transition={motion === 'full' ? accentMotion.transition : { type: 'timing', duration: 1 }}
            style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}
          >
            <AppIcon name="collapse" color={palette.colors.textSecondary} size={15} />
          </MotiView>
        }
        onPress={() => setOpen((current) => !current)}
        style={{ alignSelf: 'stretch', justifyContent: 'space-between' }}
      />
      {/* Remove closed options immediately; exiting rows must never accept taps. */}
        {open && !disabled ? (
          <MotiView
            key="isle-select-options"
            testID={`theme-dropdown-${palette.colors.design?.family ?? 'minimal'}`}
            from={{ ...menuMotion.from, translateY: -menuMotion.from.translateY }}
            animate={menuMotion.animate}
            transition={menuMotion.transition}
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
                      if (disabled || optionDisabled) return
                      onChange?.(option.value)
                      setOpen(false)
                    }}
                    interactionProfile={selectExpression?.motion ?? 'default'}
                    style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(palette.ui.radius.controlSmall, 8), paddingHorizontal: 10, justifyContent: 'center' }}
                  >
                    <MotiView
                      animate={{ backgroundColor: optionDisabled ? disabledStyle.backgroundColor : optionActive ? activeOptionBackground : 'transparent' }}
                      transition={accentMotion.transition}
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
  motion: MotionIntensity
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
  if (palette.themeId === 'animal-island-ui') {
    return <NativeProgress percent={safePercent} size={size} showInfo={showInfo} infoFormat={infoFormat} indeterminate={indeterminate}
      fillColor={fillColor} duration={motion === 'full' ? (durationMs ?? 250) / 1000 : 0} style={style} />
  }
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



// Uncustomized library controls are aliases, not locally maintained RN ports.
export {
  Title as IsleTitle, Collapse as IsleCollapse, Cursor as IsleCursor, Modal as IsleModal,
  Typewriter as IsleTypewriter, Divider as IsleDivider, Checkbox as IsleCheckbox, Tabs as IsleTabs,
  Footer as IsleFooter, CodeBlock as IsleCodeBlock, Loading as IsleLoading, Table as IsleTable, Time as IsleTime,
} from 'animal-island-ui-rn'
