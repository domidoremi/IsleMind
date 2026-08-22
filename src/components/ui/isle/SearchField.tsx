import { useState, type Ref } from 'react'
import {
  Platform,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { MotiView } from 'moti'

import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { HighFrameSpinner } from '@/components/ui/HighFrameSpinner'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { resolveThemeComponentExpression } from '@/theme/themeExpression'
import type { CanonicalThemeId } from '@/types/settingsContracts'

import { IslePressable } from './Pressable'
import { IsleTooltip } from './Tooltip'

export interface IsleSearchFieldProps extends Omit<TextInputProps, 'style'> {
  inputRef?: Ref<TextInput>
  containerStyle?: StyleProp<ViewStyle>
  inputStyle?: StyleProp<TextStyle>
  compact?: boolean
  pending?: boolean
  pendingAccessibilityLabel?: string
  clearAccessibilityLabel: string
  clearAccessibilityHint?: string
  onClear?: () => void
  testID?: string
}

const SEARCH_METRICS: Readonly<Record<CanonicalThemeId, Readonly<{
  minHeight: number
  horizontalPadding: number
  gap: number
  iconSize: number
  fontSize: number
  fontWeight: '500' | '600' | '700'
  radius: number
}>>> = Object.freeze({
  minimal: { minHeight: 44, horizontalPadding: 2, gap: 9, iconSize: 16, fontSize: 14, fontWeight: '500', radius: 0 },
  monet: { minHeight: 50, horizontalPadding: 14, gap: 11, iconSize: 18, fontSize: 15, fontWeight: '600', radius: 18 },
  material: { minHeight: 52, horizontalPadding: 16, gap: 12, iconSize: 18, fontSize: 15, fontWeight: '500', radius: 26 },
  'liquid-glass': { minHeight: 50, horizontalPadding: 15, gap: 11, iconSize: 18, fontSize: 15, fontWeight: '600', radius: 25 },
})

export function IsleSearchField({
  inputRef,
  containerStyle,
  inputStyle,
  compact = false,
  pending = false,
  pendingAccessibilityLabel,
  clearAccessibilityLabel,
  clearAccessibilityHint,
  onClear,
  value,
  editable = true,
  onChangeText,
  onFocus,
  onBlur,
  accessibilityState,
  testID,
  ...props
}: IsleSearchFieldProps) {
  const { colors, canonicalThemeId, design } = useAppTheme()
  const motion = useMotionPreference()
  const [focused, setFocused] = useState(false)
  const [clearHintVisible, setClearHintVisible] = useState(false)
  const expression = resolveThemeComponentExpression(canonicalThemeId, 'search')
  const metrics = SEARCH_METRICS[canonicalThemeId]
  const minimal = canonicalThemeId === 'minimal'
  const monet = canonicalThemeId === 'monet'
  const material = canonicalThemeId === 'material'
  const glass = canonicalThemeId === 'liquid-glass'
  const disabled = editable === false
  const hasValue = typeof value === 'string' && value.length > 0
  const minHeight = compact ? Math.max(44, metrics.minHeight - 4) : metrics.minHeight
  const radius = glass
    ? design?.semantic.radius.pill ?? metrics.radius
    : material
      ? design?.semantic.radius.extraLarge ?? metrics.radius
      : metrics.radius
  const backgroundColor = disabled
    ? colors.ui.input.disabledBackground
    : minimal
      ? 'transparent'
      : glass
        ? colors.ui.semantic.chrome.background
        : focused
          ? colors.ui.input.backgroundFocused
          : colors.ui.input.background
  const borderColor = disabled
    ? colors.ui.input.border
    : focused
      ? colors.ui.input.focus
      : minimal
        ? colors.material.strokeStrong
        : glass
          ? colors.ui.actionBar.itemBorder
          : colors.ui.input.border
  const focusScale = motion === 'full'
    ? focused
      ? expression.motion === 'organic'
        ? 1.008
        : expression.motion === 'fluid'
          ? 1.006
          : 1
      : 1
    : 1
  const transition = motion !== 'full'
    ? { type: 'timing' as const, duration: 1 }
    : expression.motion === 'fluid'
      ? { type: 'spring' as const, damping: 22, stiffness: 250, mass: 0.74 }
      : { type: 'timing' as const, duration: expression.motion === 'precision' ? 110 : expression.motion === 'organic' ? 260 : 180 }
  const webGlassStyle = glass && Platform.OS === 'web'
    ? ({ backdropFilter: 'blur(16px) saturate(1.12)', WebkitBackdropFilter: 'blur(16px) saturate(1.12)' } as unknown as ViewStyle)
    : undefined

  return (
    <MotiView
      testID={testID ?? `theme-search-${canonicalThemeId}`}
      animate={{ backgroundColor, borderColor, scale: focusScale }}
      transition={transition}
      style={[
        {
          position: 'relative',
          minHeight,
          borderRadius: radius,
          paddingHorizontal: compact ? Math.max(2, metrics.horizontalPadding - 2) : metrics.horizontalPadding,
          flexDirection: 'row',
          alignItems: 'center',
          gap: metrics.gap,
          borderWidth: minimal ? 0 : expression.border === 'none' ? 0 : 1,
          borderBottomWidth: minimal ? (focused ? 2 : StyleSheet.hairlineWidth) : undefined,
          shadowColor: monet || glass ? colors.shadowTint : undefined,
          shadowOpacity: focused ? (glass ? 0.16 : monet ? 0.1 : 0) : glass ? 0.08 : monet ? 0.04 : 0,
          shadowRadius: focused ? (glass ? 16 : monet ? 12 : 0) : glass ? 9 : monet ? 6 : 0,
          shadowOffset: { width: 0, height: glass ? 5 : 3 },
          elevation: glass ? (focused ? 3 : 2) : monet && focused ? 1 : 0,
          overflow: 'visible',
        },
        webGlassStyle,
        containerStyle,
      ]}
    >
      {minimal && focused ? (
        <View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={{ position: 'absolute', left: 0, bottom: -1, width: 28, height: 2, backgroundColor: colors.ui.icon.accentForeground }}
        />
      ) : null}
      {monet ? (
        <View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={{ position: 'absolute', top: -8, right: 18, width: 54, height: 28, borderRadius: 28, backgroundColor: colors.ui.icon.accentBackground, opacity: focused ? 0.34 : 0.18 }}
        />
      ) : null}
      {material && focused ? (
        <View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius, backgroundColor: colors.ui.icon.accentBackground, opacity: 0.12 }}
        />
      ) : null}
      {glass ? (
        <View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={{ position: 'absolute', top: 1, right: 18, left: 18, height: StyleSheet.hairlineWidth, backgroundColor: colors.ui.control.primaryForeground, opacity: focused ? 0.64 : 0.38 }}
        />
      ) : null}
      <View style={{ width: metrics.iconSize + 2, height: minHeight, alignItems: 'center', justifyContent: 'center' }}>
        <AppIcon
          name="search"
          color={focused ? colors.ui.icon.accentForeground : colors.textTertiary}
          size={metrics.iconSize}
          strokeWidth={minimal ? appIconStroke.fine : appIconStroke.regular}
        />
      </View>
      <TextInput
        {...props}
        ref={inputRef}
        value={value}
        editable={editable}
        onChangeText={onChangeText}
        onFocus={(event) => {
          setFocused(true)
          onFocus?.(event)
        }}
        onBlur={(event) => {
          setFocused(false)
          onBlur?.(event)
        }}
        accessibilityState={{ ...accessibilityState, disabled, busy: pending || accessibilityState?.busy }}
        placeholderTextColor={colors.ui.input.placeholderForeground}
        style={[
          {
            flex: 1,
            minWidth: 0,
            minHeight: 44,
            padding: 0,
            color: disabled ? colors.ui.input.disabledForeground : colors.text,
            fontSize: compact ? Math.max(12, metrics.fontSize - 1) : metrics.fontSize,
            lineHeight: compact ? 18 : 20,
            fontWeight: metrics.fontWeight,
            letterSpacing: minimal ? 0.1 : 0,
            includeFontPadding: false,
            textAlignVertical: 'center',
          },
          inputStyle,
        ]}
      />
      {pending ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={pendingAccessibilityLabel}
          style={{ width: 32, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <HighFrameSpinner color={colors.ui.icon.accentForeground} size={16} />
        </View>
      ) : null}
      {hasValue && !disabled ? (
        <IsleTooltip label={clearAccessibilityLabel} visible={clearHintVisible} placement="bottom">
          <IslePressable
            haptic
            accessibilityRole="button"
            accessibilityLabel={clearAccessibilityLabel}
            accessibilityHint={clearAccessibilityHint}
            onHoverIn={() => setClearHintVisible(true)}
            onHoverOut={() => setClearHintVisible(false)}
            onFocus={() => setClearHintVisible(true)}
            onBlur={() => setClearHintVisible(false)}
            onPress={() => {
              setClearHintVisible(false)
              onChangeText?.('')
              onClear?.()
            }}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <View
              style={{
                width: minimal ? 24 : 28,
                height: minimal ? 24 : 28,
                borderRadius: minimal ? 2 : glass ? 14 : material ? 14 : 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: minimal ? 'transparent' : colors.ui.semantic.surface.muted,
                borderWidth: glass ? StyleSheet.hairlineWidth : 0,
                borderColor: glass ? colors.ui.actionBar.itemBorder : 'transparent',
              }}
            >
              <AppIcon name="close" color={colors.textSecondary} size={15} strokeWidth={appIconStroke.fine} />
            </View>
          </IslePressable>
        </IsleTooltip>
      ) : null}
    </MotiView>
  )
}
