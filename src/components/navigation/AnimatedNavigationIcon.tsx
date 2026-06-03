import { StyleSheet, View } from 'react-native'
import type { ComponentProps, ReactNode } from 'react'
import { MotiView } from 'moti'
import Svg, { Circle, Ellipse, Line, Path } from 'react-native-svg'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

export type NavigationGlyph =
  | 'back'
  | 'home'
  | 'history'
  | 'new-chat'
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

type LayerMotion = Record<string, string | number | Array<string | number>>
type MotiTransition = ComponentProps<typeof MotiView>['transition']

const VIEW_BOX = '0 0 22 22'

export function AnimatedNavigationIcon({ glyph, active = false, color, accentColor = color, size = 22 }: AnimatedNavigationIconProps) {
  const motion = useMotionPreference()
  const play = active && motion === 'full'
  const transition = play
    ? { type: 'timing' as const, duration: motionTokens.duration.normal }
    : { type: 'timing' as const, duration: 1 }
  const springTransition = play
    ? { type: 'spring' as const, ...motionTokens.spring.gentle }
    : { type: 'timing' as const, duration: 1 }
  const props = { color, accentColor, play, transition, springTransition }

  return (
    <View pointerEvents="none" style={{ width: size, height: size }}>
      {renderGlyph(glyph, props)}
    </View>
  )
}

function renderGlyph(
  glyph: NavigationGlyph,
  props: {
    color: string
    accentColor: string
    play: boolean
    transition: { type: 'timing'; duration: number }
    springTransition: { type: 'spring'; damping: number; stiffness: number; mass: number } | { type: 'timing'; duration: number }
  }
) {
  switch (glyph) {
    case 'home':
      return <HomeGlyph {...props} />
    case 'history':
      return <HistoryGlyph {...props} />
    case 'new-chat':
      return <NewChatGlyph {...props} />
    case 'settings-sliders':
      return <SettingsSlidersGlyph {...props} />
    case 'provider-key':
      return <ProviderKeyGlyph {...props} />
    case 'context-globe':
      return <ContextGlobeGlyph {...props} />
    case 'memory-brain':
      return <MemoryBrainGlyph {...props} />
    case 'knowledge-database':
      return <KnowledgeDatabaseGlyph {...props} />
    case 'preferences-sliders':
      return <PreferencesSlidersGlyph {...props} />
    case 'skills-sparkles':
      return <SkillsSparklesGlyph {...props} />
    case 'mcp-network':
      return <McpNetworkGlyph {...props} />
    case 'source':
      return <SourceGlyph {...props} />
    case 'conversation':
      return <ConversationGlyph {...props} />
    case 'back':
    default:
      return <BackGlyph {...props} />
  }
}

function Layer({
  children,
  animate,
  transition,
}: {
  children: ReactNode
  animate?: LayerMotion
  transition?: MotiTransition
}) {
  return (
    <MotiView pointerEvents="none" animate={animate} transition={transition} style={styles.layer}>
      <Svg width="100%" height="100%" viewBox={VIEW_BOX}>
        {children}
      </Svg>
    </MotiView>
  )
}

function BackGlyph({ color, play, transition }: GlyphProps) {
  return (
    <>
      <Layer>
        <Line x1="7" y1="11" x2="18" y2="11" stroke={color} strokeOpacity={0.36} strokeWidth="1.8" strokeLinecap="round" />
      </Layer>
      <Layer animate={play ? { translateX: [0, -3, 0], scale: [1, 1.08, 1] } : { translateX: 0, scale: 1 }} transition={transition}>
        <Path d="M12.5 5.5 7 11l5.5 5.5" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <Line x1="8" y1="11" x2="17" y2="11" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </Layer>
    </>
  )
}

function HomeGlyph({ color, play, transition, springTransition }: GlyphProps) {
  return (
    <>
      <Layer animate={play ? { translateY: [0, -2, 0], scale: [1, 1.04, 1] } : { translateY: 0, scale: 1 }} transition={transition}>
        <Path d="M4.5 10.4 11 4.8l6.5 5.6" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M6.2 9.8v7.1h9.6V9.8" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </Layer>
      <Layer animate={play ? { translateY: [0, 2, 0], scaleY: [1, 0.82, 1] } : { translateY: 0, scaleY: 1 }} transition={springTransition}>
        <Path d="M9.7 16.9v-4h2.6v4" fill="none" stroke={color} strokeOpacity={0.72} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </Layer>
    </>
  )
}

function HistoryGlyph({ color, play, transition }: GlyphProps) {
  return (
    <>
      <Layer animate={play ? { rotate: ['0deg', '-16deg', '0deg'] } : { rotate: '0deg' }} transition={transition}>
        <Path d="M5.7 7.3A6.5 6.5 0 1 1 5 14.2" fill="none" stroke={color} strokeWidth="1.85" strokeLinecap="round" />
        <Path d="M5.5 4.7v3.1h3.1" fill="none" stroke={color} strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" />
      </Layer>
      <Layer animate={play ? { rotate: ['0deg', '-58deg', '0deg'] } : { rotate: '0deg' }} transition={transition}>
        <Line x1="11" y1="11" x2="11" y2="7.6" stroke={color} strokeOpacity={0.78} strokeWidth="1.7" strokeLinecap="round" />
        <Line x1="11" y1="11" x2="14.1" y2="12.8" stroke={color} strokeOpacity={0.78} strokeWidth="1.7" strokeLinecap="round" />
      </Layer>
    </>
  )
}

function NewChatGlyph({ color, play, transition }: GlyphProps) {
  return (
    <>
      <Layer>
        <Path d="M5.2 5.4h9.5a2.3 2.3 0 0 1 2.3 2.3v4.6a2.3 2.3 0 0 1-2.3 2.3H10l-4 3.1v-3.1h-.8a2.3 2.3 0 0 1-2.3-2.3V7.7a2.3 2.3 0 0 1 2.3-2.3Z" fill="none" stroke={color} strokeOpacity={0.44} strokeWidth="1.55" strokeLinejoin="round" />
      </Layer>
      <Layer animate={play ? { translateX: [0, -2.2, 0], rotate: ['0deg', '-8deg', '0deg'] } : { translateX: 0, rotate: '0deg' }} transition={transition}>
        <Line x1="11" y1="8" x2="11" y2="14" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </Layer>
      <Layer animate={play ? { translateX: [0, 2.2, 0], rotate: ['0deg', '8deg', '0deg'] } : { translateX: 0, rotate: '0deg' }} transition={transition}>
        <Line x1="8" y1="11" x2="14" y2="11" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </Layer>
    </>
  )
}

function SettingsSlidersGlyph({ color, play, transition }: GlyphProps) {
  return (
    <>
      <Layer>
        <Line x1="4.2" y1="8" x2="17.8" y2="8" stroke={color} strokeOpacity={0.48} strokeWidth="1.8" strokeLinecap="round" />
        <Line x1="4.2" y1="14.3" x2="17.8" y2="14.3" stroke={color} strokeOpacity={0.48} strokeWidth="1.8" strokeLinecap="round" />
      </Layer>
      <Layer animate={play ? { translateX: [0, 5.2, 1.4] } : { translateX: 0 }} transition={transition}>
        <Circle cx="7.2" cy="8" r="2.15" fill={color} />
      </Layer>
      <Layer animate={play ? { translateX: [0, -5.2, -1.2] } : { translateX: 0 }} transition={transition}>
        <Circle cx="14.7" cy="14.3" r="2.15" fill={color} />
      </Layer>
    </>
  )
}

function ProviderKeyGlyph({ color, play, transition }: GlyphProps) {
  return (
    <>
      <Layer animate={play ? { rotate: ['0deg', '16deg', '-4deg', '0deg'], scale: [1, 1.05, 1] } : { rotate: '0deg', scale: 1 }} transition={transition}>
        <Circle cx="8" cy="10.1" r="3.3" fill="none" stroke={color} strokeWidth="1.85" />
        <Line x1="10.5" y1="12.5" x2="17.8" y2="17.1" stroke={color} strokeWidth="1.85" strokeLinecap="round" />
        <Line x1="14.8" y1="15.2" x2="14.1" y2="17.2" stroke={color} strokeWidth="1.65" strokeLinecap="round" />
        <Line x1="16.9" y1="16.5" x2="16.2" y2="18.5" stroke={color} strokeWidth="1.65" strokeLinecap="round" />
      </Layer>
      <Layer animate={play ? { scale: [1, 1.28, 1], opacity: [0.32, 0.78, 0.32] } : { scale: 1, opacity: 0.32 }} transition={transition}>
        <Circle cx="8" cy="10.1" r="1.05" fill={color} />
      </Layer>
    </>
  )
}

function ContextGlobeGlyph({ color, play, transition }: GlyphProps) {
  return (
    <>
      <Layer>
        <Circle cx="11" cy="11" r="7.1" fill="none" stroke={color} strokeWidth="1.75" />
        <Path d="M4.4 11h13.2M11 3.9c2.1 2.2 2.1 11.9 0 14.2M11 3.9c-2.1 2.2-2.1 11.9 0 14.2" fill="none" stroke={color} strokeOpacity={0.54} strokeWidth="1.35" strokeLinecap="round" />
      </Layer>
      <Layer animate={play ? { translateX: [-5, 5, 0], opacity: [0.1, 0.9, 0.22] } : { translateX: 0, opacity: 0.2 }} transition={transition}>
        <Line x1="11" y1="4.7" x2="11" y2="17.3" stroke={color} strokeWidth="1.65" strokeLinecap="round" />
      </Layer>
    </>
  )
}

function MemoryBrainGlyph({ color, play, transition }: GlyphProps) {
  return (
    <>
      <Layer>
        <Path d="M8.4 17.6c-2.6 0-4.7-2-4.7-4.5 0-1.3.6-2.4 1.5-3.2-.2-.5-.2-1-.1-1.5.2-1.9 1.9-3.3 3.8-3.1A4.5 4.5 0 0 1 17.1 8c.9.8 1.4 2 1.4 3.3 0 2.6-2.1 4.6-4.8 4.6H8.4Z" fill="none" stroke={color} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M8.7 8.2c1.1.4 1.6 1.2 1.5 2.4M13.2 7.8c-.9.6-1.2 1.5-.9 2.5M9 13.9c1.3-1 2.7-1 4.1 0" fill="none" stroke={color} strokeOpacity={0.45} strokeWidth="1.35" strokeLinecap="round" />
      </Layer>
      {[0, 1, 2].map((index) => (
        <Layer
          key={index}
          animate={play ? { scale: [1, 1.42, 1], opacity: [0.48, 1, 0.48] } : { scale: 1, opacity: 0.58 }}
          transition={{ ...transition, duration: play ? motionTokens.duration.normal + index * 35 : 1 }}
        >
          <Circle cx={[7.8, 11.2, 14.6][index]} cy={[11.6, 9.3, 12.2][index]} r="1.15" fill={color} />
        </Layer>
      ))}
    </>
  )
}

function KnowledgeDatabaseGlyph({ color, play, transition }: GlyphProps) {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <Layer
          key={index}
          animate={play ? { translateY: [0, -1.6 + index * 0.8, 0], opacity: [0.64, 1, 0.74] } : { translateY: 0, opacity: 0.82 }}
          transition={{ ...transition, duration: play ? motionTokens.duration.normal + index * 28 : 1 }}
        >
          <Ellipse cx="11" cy={7.2 + index * 4} rx="6.5" ry="2.35" fill="none" stroke={color} strokeWidth="1.6" />
          {index < 2 ? <Line x1="4.5" y1={7.2 + index * 4} x2="4.5" y2={11.2 + index * 4} stroke={color} strokeOpacity={0.42} strokeWidth="1.3" /> : null}
          {index < 2 ? <Line x1="17.5" y1={7.2 + index * 4} x2="17.5" y2={11.2 + index * 4} stroke={color} strokeOpacity={0.42} strokeWidth="1.3" /> : null}
        </Layer>
      ))}
    </>
  )
}

function PreferencesSlidersGlyph({ color, play, transition }: GlyphProps) {
  return (
    <>
      <Layer>
        {[6, 11, 16].map((y) => (
          <Line key={y} x1="4" y1={y} x2="18" y2={y} stroke={color} strokeOpacity={0.45} strokeWidth="1.65" strokeLinecap="round" />
        ))}
      </Layer>
      {[0, 1, 2].map((index) => (
        <Layer key={index} animate={play ? { translateX: [0, [4, -4, 3][index], 0] } : { translateX: 0 }} transition={{ ...transition, duration: play ? motionTokens.duration.normal + index * 24 : 1 }}>
          <Circle cx={[8, 14, 10][index]} cy={[6, 11, 16][index]} r="1.95" fill={color} />
        </Layer>
      ))}
    </>
  )
}

function SkillsSparklesGlyph({ color, accentColor, play, transition }: GlyphProps) {
  return (
    <>
      <Layer animate={play ? { rotate: ['0deg', '18deg', '0deg'], scale: [1, 1.16, 1] } : { rotate: '0deg', scale: 1 }} transition={transition}>
        <Path d="M11 3.6 12.6 8l4.2 1.6-4.2 1.6L11 15.6l-1.6-4.4-4.2-1.6L9.4 8 11 3.6Z" fill="none" stroke={color} strokeWidth="1.65" strokeLinejoin="round" />
      </Layer>
      <Layer animate={play ? { scale: [0.8, 1.34, 1], opacity: [0.3, 1, 0.62] } : { scale: 1, opacity: 0.7 }} transition={transition}>
        <Path d="M16.8 13.7 17.5 15.5l1.7.7-1.7.7-.7 1.8-.7-1.8-1.7-.7 1.7-.7.7-1.8Z" fill={accentColor} />
        <Path d="M5.6 14.5 6 15.6l1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4.4-1.1Z" fill={accentColor} opacity="0.72" />
      </Layer>
    </>
  )
}

function McpNetworkGlyph({ color, play, transition }: GlyphProps) {
  return (
    <>
      <Layer>
        <Line x1="7" y1="7.2" x2="15.4" y2="6.4" stroke={color} strokeOpacity={0.42} strokeWidth="1.35" />
        <Line x1="7" y1="7.2" x2="10.2" y2="15.2" stroke={color} strokeOpacity={0.42} strokeWidth="1.35" />
        <Line x1="15.4" y1="6.4" x2="10.2" y2="15.2" stroke={color} strokeOpacity={0.42} strokeWidth="1.35" />
      </Layer>
      {[
        [7, 7.2],
        [15.4, 6.4],
        [10.2, 15.2],
      ].map(([cx, cy], index) => (
        <Layer
          key={`${cx}-${cy}`}
          animate={play ? { scale: [1, 1.34, 1], opacity: [0.7, 1, 0.7] } : { scale: 1, opacity: 0.86 }}
          transition={{ ...transition, duration: play ? motionTokens.duration.normal + index * 44 : 1 }}
        >
          <Circle cx={cx} cy={cy} r="2.45" fill="none" stroke={color} strokeWidth="1.7" />
          <Circle cx={cx} cy={cy} r="0.9" fill={color} />
        </Layer>
      ))}
    </>
  )
}

function SourceGlyph({ color, play, transition }: GlyphProps) {
  return (
    <>
      <Layer>
        <Path d="M6 3.8h7.1l3.1 3.2v11.2H6V3.8Z" fill="none" stroke={color} strokeWidth="1.65" strokeLinejoin="round" />
        <Path d="M13 3.9v3.3h3.2" fill="none" stroke={color} strokeOpacity={0.58} strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
      </Layer>
      {[0, 1, 2].map((index) => (
        <Layer key={index} animate={play ? { scaleX: [0.35, 1, 0.82], opacity: [0.35, 1, 0.72] } : { scaleX: 1, opacity: 0.72 }} transition={{ ...transition, duration: play ? motionTokens.duration.normal + index * 22 : 1 }}>
          <Line x1="8.3" y1={9.6 + index * 2.8} x2={14.2 - index * 1.1} y2={9.6 + index * 2.8} stroke={color} strokeWidth="1.35" strokeLinecap="round" />
        </Layer>
      ))}
    </>
  )
}

function ConversationGlyph({ color, play, transition }: GlyphProps) {
  return (
    <>
      <Layer animate={play ? { translateX: [0, 2, 0], translateY: [0, -1, 0] } : { translateX: 0, translateY: 0 }} transition={transition}>
        <Path d="M4.8 5.4h11.4a2.2 2.2 0 0 1 2.2 2.2v5.2a2.2 2.2 0 0 1-2.2 2.2h-5l-4.1 3v-3H4.8a2.2 2.2 0 0 1-2.2-2.2V7.6a2.2 2.2 0 0 1 2.2-2.2Z" fill="none" stroke={color} strokeWidth="1.65" strokeLinejoin="round" />
      </Layer>
      <Layer animate={play ? { translateX: [0, 3.2, 0], opacity: [0.45, 1, 0.62] } : { translateX: 0, opacity: 0.62 }} transition={transition}>
        <Line x1="7" y1="9.2" x2="14.8" y2="9.2" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
        <Line x1="7" y1="12" x2="12.5" y2="12" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      </Layer>
    </>
  )
}

type GlyphProps = {
  color: string
  accentColor: string
  play: boolean
  transition: { type: 'timing'; duration: number }
  springTransition: { type: 'spring'; damping: number; stiffness: number; mass: number } | { type: 'timing'; duration: number }
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
  },
})
