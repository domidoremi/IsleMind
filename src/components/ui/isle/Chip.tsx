import type { ReactNode } from 'react'
import { Text, type StyleProp, type ViewStyle } from 'react-native'
import { MotiView } from 'moti'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

interface IsleChipProps {
  children: ReactNode
  active?: boolean
  tone?: 'default' | 'mint' | 'amber' | 'danger'
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
  const foreground = tone === 'danger' ? toneToken.foreground : active ? colors.ui.control.primaryForeground : toneToken.foreground
  const background =
    active
      ? colors.ui.control.primaryBackground
      : toneToken.background

  return (
    <MotiView
      animate={{ backgroundColor: background, borderColor: active ? colors.ui.control.primaryBorder : toneToken.border, scale: active && !colors.ui.minimal ? 1.035 : 1 }}
      transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
      style={[
        {
          minHeight: 32,
          borderRadius: colors.ui.radius.chip,
          paddingHorizontal: 11,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
        },
        style,
      ]}
    >
      <Text style={{ color: foreground, fontSize: 12, lineHeight: 16, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{children}</Text>
    </MotiView>
  )
}
