import type { ReactNode } from 'react'
import { StyleSheet, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { useAppTheme } from '@/hooks/useAppTheme'
import { IsleButton as BaseIsleButton, type IsleButtonType } from './IsleKit'
import { IsleChip as BaseIsleChip, type IsleChipTone } from './Chip'
import { FeedbackAnnouncement, FeedbackGlyph } from '../FeedbackGlyph'
import type { ActionFeedbackPhase } from '@/hooks/useActionFeedback'
export type IsleTone = 'primary' | 'soft' | 'danger' | 'mint' | 'amber' | 'default' | 'sky' | 'ink'
export type IsleSize = 'sm' | 'md' | 'lg'
export type IsleVariant = IsleButtonType
export type IsleDensity = 'comfortable' | 'compact'
export type IsleMotionPreset = 'none' | 'press' | 'entrance' | 'loop'

export interface IsleButtonProps {
  label: string
  accessibilityLabel?: string
  testID?: string
  icon?: ReactNode
  onPress?: NonNullable<PressableProps['onPress']>
  disabled?: boolean
  busy?: boolean
  feedbackPhase?: ActionFeedbackPhase
  feedbackLabel?: string
  tone?: IsleTone
  compact?: boolean
  block?: boolean
  multiline?: boolean
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
}

export function IsleButton({ label, accessibilityLabel, testID, icon, onPress, disabled = false, busy = false, feedbackPhase, feedbackLabel, tone = 'soft', compact = false, block = false, multiline = false, style, textStyle }: IsleButtonProps) {
  const { colors } = useAppTheme()
  const pending = busy || feedbackPhase === 'pending'
  const phase = pending ? 'pending' : feedbackPhase
  const foreground = buttonTypeForTone(tone) === 'primary' ? colors.ui.control.primaryForeground : colors.text
  return (
    <><BaseIsleButton
      label={label}
      accessibilityLabel={phase === 'success' && feedbackLabel ? `${accessibilityLabel ?? label}. ${feedbackLabel}` : accessibilityLabel}
      accessibilityState={{ busy: pending }}
      testID={testID}
      icon={feedbackPhase === undefined ? icon : <FeedbackGlyph phase={phase} announce={false} color={foreground} idleIcon={icon} testID={testID ? `${testID}-status` : undefined} />}
      type={buttonTypeForTone(tone)}
      danger={tone === 'danger'}
      loading={feedbackPhase === undefined && pending}
      disabled={disabled || pending}
      onPress={onPress}
      size={compact ? 'small' : 'middle'}
      block={block}
      multiline={multiline}
      style={style}
      textStyle={textStyle}
    />
    {feedbackPhase !== undefined ? <FeedbackAnnouncement message={phase === 'success' ? feedbackLabel : undefined} testID={testID ? `${testID}-announcement` : undefined} /> : null}</>
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
  const backgroundColor = colors.ui.monet
    ? colors.ui.semantic.surface.base
    : colors.ui.liquidGlass
      ? colors.ui.actionBar.itemBackground
      : colors.ui.semantic.surface.muted
  const borderColor = colors.ui.monet
    ? colors.material.stroke
    : colors.ui.liquidGlass
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
        borderWidth: colors.ui.monet ? 1 : StyleSheet.hairlineWidth,
        borderColor,
      }}
    >
      <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '700', includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>
    </View>
  )
}

function buttonTypeForTone(tone: IsleTone): IsleButtonType {
  if (tone === 'primary' || tone === 'mint' || tone === 'amber' || tone === 'ink') return 'primary'
  if (tone === 'danger') return 'primary'
  return 'default'
}
