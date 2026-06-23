import { StyleSheet, View } from 'react-native'
import { MotiView } from 'moti'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { AppIcon, appIconStroke, type AppIconName } from '@/components/ui/AppIcon'

export type NavigationGlyph =
  | 'back'
  | 'home'
  | 'history'
  | 'new-chat'
  | 'settings'
  | 'settings-sliders'
  | 'provider-key'
  | 'context-globe'
  | 'memory-brain'
  | 'knowledge-database'
  | 'preferences-sliders'
  | 'skills-sparkles'
  | 'mcp-network'
  | 'source'
  | 'conversation'

interface AnimatedNavigationIconProps {
  glyph: NavigationGlyph
  active?: boolean
  color: string
  accentColor?: string
  size?: number
}

const navigationGlyphIcons: Record<NavigationGlyph, AppIconName> = {
  back: 'back-next',
  home: 'home',
  history: 'history',
  'new-chat': 'new-chat',
  settings: 'settings',
  'settings-sliders': 'settings-sliders',
  'provider-key': 'provider-key',
  'context-globe': 'context-globe',
  'memory-brain': 'memory-brain',
  'knowledge-database': 'knowledge-database',
  'preferences-sliders': 'preferences-sliders',
  'skills-sparkles': 'skills-sparkles',
  'mcp-network': 'mcp-network',
  source: 'source',
  conversation: 'conversation',
}

export function AnimatedNavigationIcon({ glyph, active = false, color, accentColor = color, size = 22 }: AnimatedNavigationIconProps) {
  const motion = useMotionPreference()
  const play = active && motion === 'full'
  const iconName = navigationGlyphIcons[glyph]
  const iconColor = active ? accentColor : color

  return (
    <View pointerEvents="none" style={{ width: size, height: size }}>
      <MotiView
        animate={play ? { scale: [1, 1.08, 1], rotate: glyph === 'back' ? ['0deg', '-8deg', '0deg'] : '0deg' } : { scale: 1, rotate: '0deg' }}
        transition={play ? { type: 'timing', duration: motionTokens.duration.normal } : { type: 'timing', duration: 1 }}
        style={styles.iconLayer}
      >
        <AppIcon name={iconName} color={iconColor} size={size} strokeWidth={appIconStroke.strong} />
      </MotiView>
    </View>
  )
}

const styles = StyleSheet.create({
  iconLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
