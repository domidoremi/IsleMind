import type { ReactNode } from 'react'
import { Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'

interface IsleChipProps {
  children: ReactNode
  active?: boolean
  tone?: 'default' | 'mint' | 'amber' | 'danger'
  style?: StyleProp<ViewStyle>
}

export function IsleChip({ children, active = false, tone = 'default', style }: IsleChipProps) {
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
