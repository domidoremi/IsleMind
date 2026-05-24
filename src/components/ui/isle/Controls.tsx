import type { ReactNode } from 'react'
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
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
  const foreground = tone === 'danger' ? colors.error : active ? colors.surface : colors.textSecondary
  const background =
    tone === 'danger'
      ? colors.coralWash
      : active
        ? colors.text
        : tone === 'mint'
          ? colors.mintSoft
          : tone === 'amber'
            ? colors.amberSoft
            : colors.islandRaised

  return (
    <View
      style={[
        {
          minHeight: 32,
          borderRadius: 16,
          paddingHorizontal: 11,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: background,
          borderWidth: active ? 0 : 1,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      <Text style={{ color: foreground, fontSize: 12, fontWeight: '900' }}>{children}</Text>
    </View>
  )
}

export function IsleMetric({ label }: { label: string }) {
  const { colors } = useAppTheme()
  return (
    <IsleCard type="title" style={{ minHeight: 34, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{label}</Text>
    </IsleCard>
  )
}

function buttonTypeForTone(tone: IsleTone): IsleButtonType {
  if (tone === 'primary' || tone === 'mint' || tone === 'amber' || tone === 'ink') return 'primary'
  if (tone === 'danger') return 'primary'
  return 'default'
}
