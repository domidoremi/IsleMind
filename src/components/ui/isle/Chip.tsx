import type { ReactNode } from 'react'
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native'
import { MotiView } from 'moti'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
export type IsleChipTone = 'default' | 'mint' | 'amber' | 'danger'

export interface IsleChipProps {
  children: ReactNode
  active?: boolean
  tone?: IsleChipTone
  style?: StyleProp<ViewStyle>
}

export function IsleChip({ children, active = false, tone = 'default', style }: IsleChipProps) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const ornamented = colors.ui.limeRoad && colors.ui.ornamented
  const family = colors.design?.family ?? 'minimal'
  const toneToken = tone === 'danger'
    ? colors.ui.tone.danger
    : tone === 'mint'
      ? colors.ui.tone.success
      : tone === 'amber'
        ? colors.ui.tone.warning
        : colors.ui.tone.neutral
  const foreground = active
    ? colors.ui.control.primaryForeground
    : tone === 'default' && colors.ui.glass
      ? colors.textSecondary
      : toneToken.foreground
  const background = active
    ? colors.ui.control.primaryBackground
    : tone === 'default'
      ? ornamented
        ? colors.ui.semantic.surface.base
        : colors.ui.glass
          ? colors.ui.actionBar.itemBackground
          : family === 'minimal' ? 'transparent' : colors.ui.semantic.surface.muted
      : toneToken.background
  const borderColor = active
    ? colors.ui.control.primaryBorder
    : tone === 'default'
      ? ornamented
        ? colors.material.stroke
        : colors.ui.glass
          ? colors.ui.actionBar.itemBorder
          : family === 'minimal' ? 'transparent' : colors.ui.semantic.chrome.border
      : toneToken.border
  const activeShadowOpacity = 0

  return (
    <MotiView
      animate={{
        backgroundColor: background,
        borderColor,
        translateY: 0,
      }}
      transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
      style={[
        {
          minHeight: 28,
          borderRadius: colors.ui.radius.chip,
          paddingHorizontal: 11,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: active || tone !== 'default' ? StyleSheet.hairlineWidth : ornamented ? 1 : family === 'minimal' ? 0 : StyleSheet.hairlineWidth,
          shadowColor: colors.shadowTint,
          shadowOpacity: active ? activeShadowOpacity : 0,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 0 },
          elevation: 0,
        },
        style,
      ]}
    >
      <Text style={{ color: foreground, fontSize: 12, lineHeight: 16, fontWeight: family === 'material' ? '500' : '600', includeFontPadding: false, textAlignVertical: 'center' }}>{children}</Text>
    </MotiView>
  )
}
