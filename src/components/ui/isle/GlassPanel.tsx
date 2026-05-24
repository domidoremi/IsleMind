import type { PropsWithChildren } from 'react'
import { type StyleProp, type ViewStyle } from 'react-native'
import { IslePanel } from './Panel'

interface IsleGlassPanelProps extends PropsWithChildren {
  style?: StyleProp<ViewStyle>
  intensity?: number
}

export function IsleGlassPanel({ children, style, intensity = 36 }: IsleGlassPanelProps) {
  return (
    <IslePanel
      material="glass"
      elevated
      intensity={intensity}
      radius={30}
      style={style}
    >
      {children}
    </IslePanel>
  )
}
