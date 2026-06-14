import type { ReactNode } from 'react'
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { MotiView } from 'moti'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { IsleButton as BaseIsleButton, type IsleButtonType } from './IsleKit'
import { IsleCard } from './IsleKit'

export type IsleTone = 'primary' | 'soft' | 'danger' | 'mint' | 'amber' | 'default' | 'sky' | 'ink'
export type IsleSize = 'sm' | 'md' | 'lg'
export type IsleVariant = IsleButtonType
export type IsleDensity = 'comfortable' | 'compact'
export type IsleMotionPreset = 'none' | 'press' | 'entrance' | 'loop'

export interface IsleButtonProps {
  label: string
  icon?: ReactNode
  onPress?: () => void
  disabled?: boolean
  busy?: boolean
  tone?: IsleTone
  compact?: boolean
  block?: boolean
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
}

export function IsleButton({ label, icon, onPress, disabled = false, busy = false, tone = 'soft', compact = false, block = false, style, textStyle }: IsleButtonProps) {
  return (
    <BaseIsleButton
      label={label}
      icon={icon}
      type={buttonTypeForTone(tone)}
      danger={tone === 'danger'}
      loading={busy}
      disabled={disabled}
      onPress={onPress}
      size={compact ? 'small' : 'middle'}
      block={block}
      style={style}
      textStyle={textStyle}
    />
  )
}

export function IsleChip({ children, active = false, tone = 'default', style }: { children: ReactNode; active?: boolean; tone?: Exclude<IsleTone, 'primary' | 'soft' | 'sky' | 'ink'>; style?: StyleProp<ViewStyle> }) {
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

export function IsleMetric({ label }: { label: string }) {
  const { colors } = useAppTheme()
  return (
    <IsleCard type="title" style={{ minHeight: 34, borderRadius: colors.ui.radius.chip, paddingHorizontal: 12, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 14, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>
    </IsleCard>
  )
}

function buttonTypeForTone(tone: IsleTone): IsleButtonType {
  if (tone === 'primary' || tone === 'mint' || tone === 'amber' || tone === 'ink') return 'primary'
  if (tone === 'danger') return 'primary'
  return 'default'
}
