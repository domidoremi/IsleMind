import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { MotiView } from 'moti'

import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import type { Conversation } from '@/types/chatContracts'
import { motionTokens } from '@/theme/animation'

import { resolveChatControlBorder, resolveChatControlSurface } from './chatChromeSurfaces'

const QUICK_TOOL_HIT_SLOP = { top: 8, right: 6, bottom: 8, left: 6 }

export function ComposerToolButton({
  label,
  stateLabel,
  accessibilityHint,
  accessibilityState,
  active,
  activeSurface = 'strong',
  testID,
  iconOnly = false,
  compact = false,
  maxWidth,
  children,
  disabled = false,
  onPress,
}: {
  label: string
  stateLabel?: string
  accessibilityHint?: string
  accessibilityState?: {
    disabled?: boolean
    selected?: boolean
    checked?: boolean | 'mixed'
    busy?: boolean
    expanded?: boolean
  }
  active: boolean
  activeSurface?: 'strong' | 'quiet'
  testID?: string
  iconOnly?: boolean
  compact?: boolean
  maxWidth?: number
  children: ReactNode
  disabled?: boolean
  onPress: () => void
}) {
  const { colors, isGlass } = useAppTheme()
  const motion = useMotionPreference()
  const accessibilityLabel = stateLabel ? `${label}: ${stateLabel}` : label
  // Glass panels already own the lens; wide tool controls stay transparent
  // with a hairline instead of opaque item cards inside them.
  const itemSurface = isGlass ? 'transparent' : colors.design?.semantic.surface.interactive.background ?? colors.ui.semantic.surface.muted
  const itemBorder = colors.ui.limeRoad ? colors.material.stroke : isGlass ? colors.design?.semantic.surface.interactive.border ?? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const controlSize = 44
  const activeBackground = activeSurface === 'quiet' ? colors.ui.actionBar.itemActiveBackground : colors.ui.control.primaryBackground
  const activeForeground = activeSurface === 'quiet' ? colors.ui.icon.accentForeground : colors.ui.control.primaryForeground
  return (
    <IslePressable
      testID={testID}
      haptic
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState ?? (active || disabled ? { selected: active, disabled: disabled || undefined } : undefined)}
      aria-expanded={accessibilityState?.expanded}
      hitSlop={QUICK_TOOL_HIT_SLOP}
      style={{ width: iconOnly ? controlSize : undefined, flexGrow: iconOnly ? 0 : 1, flexShrink: iconOnly ? 0 : 1, flexBasis: iconOnly ? undefined : 0, maxWidth, minHeight: controlSize, borderRadius: colors.ui.radius.controlLarge }}
    >
      <MotiView
        animate={{
          backgroundColor: active ? activeBackground : iconOnly || compact ? 'transparent' : itemSurface,
          borderColor: active ? colors.ui.control.primaryBorder : iconOnly ? 'transparent' : itemBorder,
          translateY: 0,
        }}
        transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
        style={{
          width: iconOnly ? controlSize : '100%',
          maxWidth,
          minHeight: controlSize,
          borderRadius: colors.ui.radius.controlLarge,
          paddingHorizontal: iconOnly ? 0 : compact ? 7 : stateLabel ? 10 : 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: iconOnly ? 0 : compact ? 4 : 7,
          borderWidth: active ? subtleBorderWidth : 0,
          opacity: disabled ? 0.68 : 1,
        }}
      >
        {children}
        {iconOnly ? null : (
          <View style={{ minWidth: 0, flexShrink: 1, maxWidth: stateLabel ? (compact ? 54 : 82) : (compact ? 62 : 104) }}>
            <Text numberOfLines={1} style={{ color: active ? activeForeground : colors.textSecondary, fontSize: compact ? 10.5 : 11, lineHeight: 14, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>
            {stateLabel ? (
              <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: active ? activeForeground : colors.textTertiary, fontSize: compact ? 9.5 : 10, lineHeight: 13, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center', opacity: active ? 0.82 : 1 }}>
                {stateLabel}
              </Text>
            ) : null}
          </View>
        )}
      </MotiView>
    </IslePressable>
  )
}

export function ReasoningToolIcon({ effort, active, available }: { effort: NonNullable<Conversation['reasoningEffort']>; active: boolean; available: boolean }) {
  const { colors, isGlass } = useAppTheme()
  const level = getReasoningVisualLevel(effort)
  const color = !available ? colors.textTertiary : active ? colors.ui.control.primaryForeground : level >= 4 ? colors.ui.icon.accentForeground : colors.textSecondary
  const heights = [5, 8, 11, 14, 17]
  const visibleLevel = available ? level : 0

  return (
    <View style={{ width: 22, height: 22, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}>
      {heights.map((height, index) => {
        const filled = index < visibleLevel
        return (
          <View
            key={height}
            style={{
              width: 3,
              height,
              borderRadius: 2,
              backgroundColor: color,
              opacity: filled ? (active || level >= 4 ? 0.96 : 0.82) : isGlass ? 0.28 : 0.22,
            }}
          />
        )
      })}
    </View>
  )
}

function getReasoningVisualLevel(effort: NonNullable<Conversation['reasoningEffort']>) {
  switch (effort) {
    case 'max':
    case 'xhigh':
      return 5
    case 'high':
      return 4
    case 'medium':
      return 3
    case 'low':
      return 2
    case 'minimal':
      return 1
    case 'none':
    default:
      return 0
  }
}

export function QuickChoiceButton({ label, active, accessibilityHint, maxWidth, onPress }: { label: string; active: boolean; accessibilityHint?: string; maxWidth?: number; onPress: () => void }) {
  const { colors, isGlass } = useAppTheme()
  const motion = useMotionPreference()
  const textMaxWidth = maxWidth ? Math.max(24, maxWidth - 24) : undefined
  const activeForeground = colors.ui.control.primaryForeground
  const inactiveBackground = resolveChatControlSurface(colors, isGlass, false, 'muted')
  const inactiveBorder = resolveChatControlBorder(colors, isGlass, false)
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  return (
    <IslePressable
      haptic
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: active }}
      hitSlop={QUICK_TOOL_HIT_SLOP}
      style={{ maxWidth, minHeight: 44, borderRadius: colors.ui.radius.controlLarge, alignItems: 'center', justifyContent: 'center' }}
    >
      <MotiView
        animate={{
          backgroundColor: active ? colors.ui.control.primaryBackground : inactiveBackground,
          borderColor: active ? colors.ui.control.primaryBorder : inactiveBorder,
          translateY: 0,
        }}
        transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
        style={{ minHeight: 44, borderRadius: colors.ui.radius.controlLarge, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: subtleBorderWidth }}
      >
        <Text numberOfLines={1} ellipsizeMode="tail" style={{ maxWidth: textMaxWidth, color: active ? activeForeground : colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '800', includeFontPadding: false }}>
          {label}
        </Text>
      </MotiView>
    </IslePressable>
  )
}
