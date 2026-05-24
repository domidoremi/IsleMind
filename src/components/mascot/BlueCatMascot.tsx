import { View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Circle, Ellipse, G, Line, Path } from 'react-native-svg'
import { MotiView } from 'moti'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

interface BlueCatMascotProps {
  size?: number
  loading?: boolean
  mood?: BlueCatMascotMood
  speed?: number
  style?: StyleProp<ViewStyle>
}

export type BlueCatMascotMood = 'idle' | 'working' | 'thinking' | 'tool' | 'celebrate' | 'error'

export function BlueCatMascot({ size = 156, loading = false, mood = loading ? 'working' : 'idle', speed = 1, style }: BlueCatMascotProps) {
  const motion = useMotionPreference()
  const animated = motion === 'full'
  const orbitSize = size + 34
  const active = loading || mood === 'working' || mood === 'thinking' || mood === 'tool'
  const loopDuration = Math.max(620, motionTokens.duration.mascotLoop / Math.max(speed, 0.7))
  const palette = moodPalette(mood)

  return (
    <View style={[{ width: orbitSize, height: orbitSize, alignItems: 'center', justifyContent: 'center' }, style]}>
      {active ? <LoadingOrbit size={orbitSize} animated={animated} palette={palette} /> : null}
      <MotiView
        from={{ translateY: 0, rotate: '0deg', scale: 1 }}
        animate={animated ? mascotMotion(mood) : { translateY: 0, rotate: '0deg', scale: 1 }}
        transition={animated ? { loop: true, type: 'timing', duration: loopDuration } : { type: 'timing', duration: 1 }}
        style={{ width: size, height: size }}
      >
        <TailLayer size={size} animated={animated} mood={mood} palette={palette} />
        <CatBody size={size} palette={palette} mood={mood} />
        <EyeLayer size={size} animated={animated} mood={mood} />
        <PawSparkLayer size={size} animated={animated && (active || mood === 'celebrate' || mood === 'error')} mood={mood} palette={palette} />
      </MotiView>
    </View>
  )
}

function CatBody({ size, palette, mood }: { size: number; palette: MascotPalette; mood: BlueCatMascotMood }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 160 160">
      <Path d="M35 68 C18 62 15 44 27 33 C38 43 44 51 49 62 Z" fill={palette.ear} stroke={palette.stroke} strokeWidth="5" strokeLinejoin="round" />
      <Path d="M125 68 C142 62 145 44 133 33 C122 43 116 51 111 62 Z" fill={palette.ear} stroke={palette.stroke} strokeWidth="5" strokeLinejoin="round" />
      <Path d="M42 67 C45 36 69 24 88 28 C113 32 128 50 124 78 C120 111 99 125 73 122 C49 119 37 96 42 67 Z" fill={palette.body} stroke={palette.stroke} strokeWidth="5" strokeLinejoin="round" />
      <Path d="M57 48 C64 42 79 39 92 42 C106 45 114 55 116 70 C111 64 101 60 87 60 C72 60 62 62 52 70 C52 61 53 53 57 48 Z" fill={palette.highlight} opacity="0.82" />
      <Ellipse cx="80" cy="91" rx="30" ry="24" fill={palette.muzzle} stroke={palette.stroke} strokeWidth="4" />
      <Path d="M78 84 Q80 87 82 84" stroke={palette.stroke} strokeWidth="3" strokeLinecap="round" fill="none" />
      {mood === 'error' ? (
        <>
          <Path d="M80 90 Q72 86 65 93" stroke={palette.stroke} strokeWidth="3" strokeLinecap="round" fill="none" />
          <Path d="M80 90 Q88 86 95 93" stroke={palette.stroke} strokeWidth="3" strokeLinecap="round" fill="none" />
        </>
      ) : mood === 'thinking' || mood === 'tool' ? (
        <>
          <Path d="M80 88 Q72 92 64 90" stroke={palette.stroke} strokeWidth="3" strokeLinecap="round" fill="none" />
          <Path d="M80 88 Q88 92 96 90" stroke={palette.stroke} strokeWidth="3" strokeLinecap="round" fill="none" />
        </>
      ) : (
        <>
          <Path d="M80 88 Q72 95 64 90" stroke={palette.stroke} strokeWidth="3" strokeLinecap="round" fill="none" />
          <Path d="M80 88 Q88 95 96 90" stroke={palette.stroke} strokeWidth="3" strokeLinecap="round" fill="none" />
        </>
      )}
      <Line x1="49" y1="84" x2="31" y2="78" stroke={palette.stroke} strokeWidth="3" strokeLinecap="round" />
      <Line x1="50" y1="94" x2="31" y2="96" stroke={palette.stroke} strokeWidth="3" strokeLinecap="round" />
      <Line x1="111" y1="84" x2="129" y2="78" stroke={palette.stroke} strokeWidth="3" strokeLinecap="round" />
      <Line x1="110" y1="94" x2="129" y2="96" stroke={palette.stroke} strokeWidth="3" strokeLinecap="round" />
      <Path d="M55 118 C42 128 37 139 42 146 C50 156 67 143 62 123 Z" fill={palette.paw} stroke={palette.stroke} strokeWidth="5" strokeLinejoin="round" />
      <Path d="M104 118 C118 127 124 139 118 146 C110 156 93 143 98 123 Z" fill={palette.paw} stroke={palette.stroke} strokeWidth="5" strokeLinejoin="round" />
    </Svg>
  )
}

function TailLayer({ size, animated, mood, palette }: { size: number; animated: boolean; mood: BlueCatMascotMood; palette: MascotPalette }) {
  return (
    <MotiView
      pointerEvents="none"
      from={{ rotate: '0deg', translateX: 0 }}
      animate={animated ? { rotate: mood === 'error' ? '-10deg' : mood === 'celebrate' ? '16deg' : '8deg', translateX: mood === 'thinking' ? -1 : 2 } : { rotate: '0deg', translateX: 0 }}
      transition={animated ? { loop: true, type: 'timing', duration: mood === 'celebrate' ? 760 : 1300 } : { type: 'timing', duration: 1 }}
      style={{ position: 'absolute', width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox="0 0 160 160">
        <Path d="M116 112 C148 105 150 132 127 135" fill="none" stroke={palette.stroke} strokeWidth="11" strokeLinecap="round" />
        <Path d="M116 112 C146 106 146 128 126 130" fill="none" stroke={palette.tail} strokeWidth="6" strokeLinecap="round" />
      </Svg>
    </MotiView>
  )
}

function EyeLayer({ size, animated, mood }: { size: number; animated: boolean; mood: BlueCatMascotMood }) {
  const eyeHeight = mood === 'thinking' || mood === 'tool' ? 8 : mood === 'error' ? 5 : 12
  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size }}>
      <AnimatedEye left={(64 / 160) * size - 4} top={(70 / 160) * size} height={eyeHeight} animated={animated} />
      <AnimatedEye left={(96 / 160) * size - 4} top={(70 / 160) * size} height={eyeHeight} animated={animated} delay={120} />
    </View>
  )
}

function AnimatedEye({ left, top, height, animated, delay = 0 }: { left: number; top: number; height: number; animated: boolean; delay?: number }) {
  return (
    <MotiView
      from={{ scaleY: 1 }}
      animate={animated ? { scaleY: 0.16 } : { scaleY: 1 }}
      transition={animated ? { loop: true, type: 'timing', duration: 2200, delay } : { type: 'timing', duration: 1 }}
      style={{ position: 'absolute', left, top, width: 8, height }}
    >
      <Svg width={8} height={height} viewBox={`0 0 8 ${height}`}>
        <Ellipse cx="4" cy={height / 2} rx="4" ry={height / 2} fill="#244467" />
      </Svg>
    </MotiView>
  )
}

function PawSparkLayer({ size, animated, mood, palette }: { size: number; animated: boolean; mood: BlueCatMascotMood; palette: MascotPalette }) {
  return (
    <MotiView
      pointerEvents="none"
      from={{ translateY: 0, opacity: 0.72 }}
      animate={animated ? { translateY: -5, opacity: 1 } : { translateY: 0, opacity: 0.78 }}
      transition={animated ? { loop: true, type: 'timing', duration: 740 } : { type: 'timing', duration: 1 }}
      style={{ position: 'absolute', width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox="0 0 160 160">
        {mood === 'error' ? (
          <>
            <Circle cx="101" cy="113" r="4" fill={palette.accent} stroke={palette.stroke} strokeWidth="2" />
            <Circle cx="58" cy="110" r="3" fill={palette.accent} stroke={palette.stroke} strokeWidth="1.8" />
          </>
        ) : (
          <>
            <Circle cx="103" cy="121" r="5" fill={palette.accent} stroke={palette.stroke} strokeWidth="2.5" />
            <Circle cx="95" cy="127" r="3" fill={palette.accent} stroke={palette.stroke} strokeWidth="2" />
          </>
        )}
      </Svg>
    </MotiView>
  )
}

function LoadingOrbit({ size, animated, palette }: { size: number; animated: boolean; palette: MascotPalette }) {
  const items = [
    { x: size * 0.18, y: size * 0.32, color: palette.body },
    { x: size * 0.78, y: size * 0.28, color: palette.accent },
    { x: size * 0.22, y: size * 0.74, color: palette.secondaryAccent },
    { x: size * 0.75, y: size * 0.72, color: palette.body },
  ]

  return (
    <MotiView
      pointerEvents="none"
      from={{ rotate: '0deg', opacity: 0.72 }}
      animate={animated ? { rotate: '360deg', opacity: 1 } : { rotate: '0deg', opacity: 0.76 }}
      transition={animated ? { loop: true, type: 'timing', duration: 2600 } : { type: 'timing', duration: 1 }}
      style={{ position: 'absolute', width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Path d={`M ${size * 0.5} ${size * 0.1} C ${size * 0.86} ${size * 0.16}, ${size * 0.9} ${size * 0.66}, ${size * 0.58} ${size * 0.82} C ${size * 0.42} ${size * 0.9}, ${size * 0.14} ${size * 0.74}, ${size * 0.16} ${size * 0.5} C ${size * 0.17} ${size * 0.28}, ${size * 0.34} ${size * 0.14}, ${size * 0.5} ${size * 0.1} Z`} fill="none" stroke={palette.body} strokeWidth="3" strokeLinecap="round" strokeDasharray="8 12" opacity="0.5" />
        {items.map((item, index) => (
          <G key={`${item.x}-${item.y}-${index}`}>
            <Circle cx={item.x} cy={item.y} r="4" fill={item.color} />
            <Circle cx={item.x + 6} cy={item.y + 3} r="2" fill={item.color} opacity="0.8" />
          </G>
        ))}
      </Svg>
    </MotiView>
  )
}

interface MascotPalette {
  stroke: string
  body: string
  ear: string
  paw: string
  tail: string
  highlight: string
  muzzle: string
  accent: string
  secondaryAccent: string
}

function moodPalette(mood: BlueCatMascotMood): MascotPalette {
  const base = {
    stroke: '#244467',
    body: '#7cc7ff',
    ear: '#6fb9ff',
    paw: '#5ca9f6',
    tail: '#62b5ff',
    highlight: '#9ed8ff',
    muzzle: '#e9f8ff',
    accent: '#ffd66d',
    secondaryAccent: '#8de2c3',
  }
  if (mood === 'error') {
    return { ...base, body: '#7fb6ed', ear: '#6aa5df', paw: '#5f98ce', tail: '#5a9bd6', accent: '#ff8f88', secondaryAccent: '#ffc5a1' }
  }
  if (mood === 'thinking' || mood === 'tool') {
    return { ...base, accent: '#bba7ff', secondaryAccent: '#8de2c3' }
  }
  if (mood === 'celebrate') {
    return { ...base, accent: '#ffe17d', secondaryAccent: '#ff9fb5' }
  }
  return base
}

function mascotMotion(mood: BlueCatMascotMood) {
  switch (mood) {
    case 'working':
      return { translateY: -7, rotate: '1.5deg', scale: 1.02 }
    case 'thinking':
      return { translateY: -3, rotate: '-2.5deg', scale: 1.01 }
    case 'tool':
      return { translateY: -6, rotate: '2.5deg', scale: 1.018 }
    case 'celebrate':
      return { translateY: -11, rotate: '4deg', scale: 1.04 }
    case 'error':
      return { translateY: 4, rotate: '-4deg', scale: 0.985 }
    case 'idle':
    default:
      return { translateY: -5, rotate: '-1.5deg', scale: 1.015 }
  }
}
