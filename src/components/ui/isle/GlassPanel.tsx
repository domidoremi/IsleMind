import type { PropsWithChildren } from 'react'
import { type StyleProp, type ViewStyle } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { IslePanel } from './Panel'

interface IsleGlassPanelProps extends PropsWithChildren {
  style?: StyleProp<ViewStyle>
  intensity?: number
}

export function IsleGlassPanel({ children, style, intensity = 36 }: IsleGlassPanelProps) {
  const { colors } = useAppTheme()
  return (
    <IslePanel
      material="glass"
      elevated
      intensity={intensity}
      radius={colors.ui.radius.modal}
      style={style}
    >
      {children}
    </IslePanel>
  )
}
