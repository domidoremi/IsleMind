import type { PropsWithChildren } from 'react'
import { type StyleProp, type ViewStyle } from 'react-native'
import { IslandPanel } from '@/components/ui/IslandPanel'

interface GlassPanelProps extends PropsWithChildren {
  style?: StyleProp<ViewStyle>
  intensity?: number
}

export function GlassPanel({ children, style, intensity = 36 }: GlassPanelProps) {
  return (
    <IslandPanel
      material="glass"
      elevated
      intensity={intensity}
      radius={30}
      style={style}
    >
      {children}
    </IslandPanel>
  )
}
