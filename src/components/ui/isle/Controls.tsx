import type { ReactNode } from 'react'
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { IsleButton as BaseIsleButton, type IsleButtonType } from './IsleKit'
import { IsleChip as BaseIsleChip, type IsleChipTone } from './Chip'

export type IsleTone = 'primary' | 'soft' | 'danger' | 'mint' | 'amber' | 'default' | 'sky' | 'ink'
export type IsleSize = 'sm' | 'md' | 'lg'
export type IsleVariant = IsleButtonType
export type IsleDensity = 'comfortable' | 'compact'
export type IsleMotionPreset = 'none' | 'press' | 'entrance' | 'loop'

export interface IsleButtonProps {
  label: string
  accessibilityLabel?: string
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

export function IsleButton({ label, accessibilityLabel, icon, onPress, disabled = false, busy = false, tone = 'soft', compact = false, block = false, style, textStyle }: IsleButtonProps) {
  return (
    <BaseIsleButton
      label={label}
      accessibilityLabel={accessibilityLabel}
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
  return (
    <BaseIsleChip active={active} tone={tone as IsleChipTone} style={style}>
      {children}
    </BaseIsleChip>
  )
}

export function IsleMetric({ label }: { label: string }) {
  const { colors } = useAppTheme()
  const backgroundColor = colors.ui.cartoon
    ? colors.ui.semantic.surface.base
    : colors.ui.glass
      ? colors.ui.actionBar.itemBackground
      : colors.ui.semantic.surface.muted
  const borderColor = colors.ui.cartoon
    ? colors.material.stroke
    : colors.ui.glass
      ? colors.ui.actionBar.itemBorder
      : colors.ui.semantic.chrome.border
  return (
    <View
      style={{
        minHeight: 30,
        borderRadius: colors.ui.radius.chip,
        paddingHorizontal: 11,
        paddingVertical: 6,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor,
        borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth,
        borderColor,
      }}
    >
      <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 14, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>
    </View>
  )
}

function buttonTypeForTone(tone: IsleTone): IsleButtonType {
  if (tone === 'primary' || tone === 'mint' || tone === 'amber' || tone === 'ink') return 'primary'
  if (tone === 'danger') return 'primary'
  return 'default'
}
