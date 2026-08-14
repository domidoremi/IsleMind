import { StyleSheet, View } from 'react-native'
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
  back: 'back-previous',
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
  const iconName = navigationGlyphIcons[glyph]
  const iconColor = active ? accentColor : color

  return (
    <View style={{ width: size, height: size, pointerEvents: 'none' }}>
      <View style={styles.iconLayer}>
        <AppIcon name={iconName} color={iconColor} size={size} strokeWidth={appIconStroke.strong} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  iconLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
