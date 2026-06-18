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
      ? colors.ui.cartoon
        ? colors.ui.semantic.surface.base
        : colors.ui.glass
          ? colors.ui.actionBar.itemBackground
          : colors.ui.semantic.surface.muted
      : toneToken.background
  const borderColor = active
    ? colors.ui.control.primaryBorder
    : tone === 'default'
      ? colors.ui.cartoon
        ? colors.material.stroke
        : colors.ui.glass
          ? colors.ui.actionBar.itemBorder
          : colors.ui.semantic.chrome.border
      : toneToken.border
  const activeScale = colors.ui.cartoon ? 1.02 : colors.ui.glass ? 1.006 : 1
  const activeShadowOpacity = colors.ui.cartoon ? 0.03 : 0

  return (
    <MotiView
      animate={{
        backgroundColor: background,
        borderColor,
        scale: active ? activeScale : 1,
        translateY: active && colors.ui.glass ? -0.5 : 0,
      }}
      transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
      style={[
        {
          minHeight: 32,
          borderRadius: colors.ui.radius.chip,
          paddingHorizontal: 11,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth,
          shadowColor: colors.shadowTint,
          shadowOpacity: active ? activeShadowOpacity : 0,
          shadowRadius: active && colors.ui.cartoon ? 4 : 0,
          shadowOffset: { width: 0, height: active && colors.ui.cartoon ? 1 : 0 },
          elevation: active && colors.ui.cartoon ? 1 : 0,
        },
        style,
      ]}
    >
      <Text style={{ color: foreground, fontSize: 12, lineHeight: 16, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{children}</Text>
    </MotiView>
  )
}
