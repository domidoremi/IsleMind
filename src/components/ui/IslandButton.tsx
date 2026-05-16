import type { ReactNode } from 'react'
import { ActivityIndicator, Text, type StyleProp, type ViewStyle } from 'react-native'
import { PressableScale } from '@/components/ui/PressableScale'
import { useAppTheme } from '@/hooks/useAppTheme'

interface IslandButtonProps {
  label: string
  icon?: ReactNode
  onPress?: () => void
  disabled?: boolean
  busy?: boolean
  tone?: 'primary' | 'soft' | 'danger' | 'mint' | 'amber'
  compact?: boolean
  style?: StyleProp<ViewStyle>
}

export function IslandButton({ label, icon, onPress, disabled = false, busy = false, tone = 'soft', compact = false, style }: IslandButtonProps) {
  const { colors } = useAppTheme()
  const isPrimary = tone === 'primary'
  const isDanger = tone === 'danger'
  const foreground = isPrimary ? colors.surface : isDanger ? colors.error : colors.textSecondary
  const background =
    isPrimary
      ? colors.text
      : isDanger
        ? colors.coralWash
        : tone === 'mint'
          ? colors.mintSoft
          : tone === 'amber'
            ? colors.amberSoft
            : colors.islandRaised

  return (
    <PressableScale
      haptic
      disabled={disabled || busy}
      onPress={onPress}
      accessibilityLabel={label}
      style={[
        {
          minHeight: compact ? 34 : 44,
          borderRadius: compact ? 17 : 22,
          paddingHorizontal: compact ? 11 : 15,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 7,
          backgroundColor: background,
          borderWidth: isPrimary ? 0 : 1,
          borderColor: colors.border,
          opacity: disabled ? 0.48 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={foreground} /> : icon}
      {!busy ? <Text style={{ color: foreground, fontSize: compact ? 12 : 14, fontWeight: '900' }}>{label}</Text> : null}
    </PressableScale>
  )
}
