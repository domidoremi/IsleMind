import { View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Circle, Ellipse, G, Line, Path } from 'react-native-svg'
import { MotiView } from 'moti'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

interface BlueCatMascotProps {
  size?: number
  loading?: boolean
  style?: StyleProp<ViewStyle>
}

export function BlueCatMascot({ size = 156, loading = false, style }: BlueCatMascotProps) {
  const motion = useMotionPreference()
  const animated = motion === 'full'
  const orbitSize = size + 34

  return (
    <View style={[{ width: orbitSize, height: orbitSize, alignItems: 'center', justifyContent: 'center' }, style]}>
      {loading ? <LoadingOrbit size={orbitSize} animated={animated} /> : null}
      <MotiView
        from={{ translateY: 0, rotate: '0deg', scale: 1 }}
        animate={animated ? { translateY: -5, rotate: '-1.5deg', scale: 1.015 } : { translateY: 0, rotate: '0deg', scale: 1 }}
        transition={animated ? { loop: true, type: 'timing', duration: motionTokens.duration.mascotLoop } : { type: 'timing', duration: 1 }}
        style={{ width: size, height: size }}
      >
        <TailLayer size={size} animated={animated} />
        <CatBody size={size} />
        <EyeLayer size={size} animated={animated} />
        <PawSparkLayer size={size} animated={animated && loading} />
      </MotiView>
    </View>
  )
}

function CatBody({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 160 160">
      <Path d="M35 68 C18 62 15 44 27 33 C38 43 44 51 49 62 Z" fill="#6fb9ff" stroke="#244467" strokeWidth="5" strokeLinejoin="round" />
      <Path d="M125 68 C142 62 145 44 133 33 C122 43 116 51 111 62 Z" fill="#6fb9ff" stroke="#244467" strokeWidth="5" strokeLinejoin="round" />
      <Path d="M42 67 C45 36 69 24 88 28 C113 32 128 50 124 78 C120 111 99 125 73 122 C49 119 37 96 42 67 Z" fill="#7cc7ff" stroke="#244467" strokeWidth="5" strokeLinejoin="round" />
      <Path d="M57 48 C64 42 79 39 92 42 C106 45 114 55 116 70 C111 64 101 60 87 60 C72 60 62 62 52 70 C52 61 53 53 57 48 Z" fill="#9ed8ff" opacity="0.82" />
      <Ellipse cx="80" cy="91" rx="30" ry="24" fill="#e9f8ff" stroke="#244467" strokeWidth="4" />
      <Path d="M78 84 Q80 87 82 84" stroke="#244467" strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M80 88 Q72 95 64 90" stroke="#244467" strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M80 88 Q88 95 96 90" stroke="#244467" strokeWidth="3" strokeLinecap="round" fill="none" />
      <Line x1="49" y1="84" x2="31" y2="78" stroke="#244467" strokeWidth="3" strokeLinecap="round" />
      <Line x1="50" y1="94" x2="31" y2="96" stroke="#244467" strokeWidth="3" strokeLinecap="round" />
      <Line x1="111" y1="84" x2="129" y2="78" stroke="#244467" strokeWidth="3" strokeLinecap="round" />
      <Line x1="110" y1="94" x2="129" y2="96" stroke="#244467" strokeWidth="3" strokeLinecap="round" />
      <Path d="M55 118 C42 128 37 139 42 146 C50 156 67 143 62 123 Z" fill="#5ca9f6" stroke="#244467" strokeWidth="5" strokeLinejoin="round" />
      <Path d="M104 118 C118 127 124 139 118 146 C110 156 93 143 98 123 Z" fill="#5ca9f6" stroke="#244467" strokeWidth="5" strokeLinejoin="round" />
    </Svg>
  )
}

function TailLayer({ size, animated }: { size: number; animated: boolean }) {
  return (
    <MotiView
      pointerEvents="none"
      from={{ rotate: '0deg', translateX: 0 }}
      animate={animated ? { rotate: '8deg', translateX: 2 } : { rotate: '0deg', translateX: 0 }}
      transition={animated ? { loop: true, type: 'timing', duration: 1300 } : { type: 'timing', duration: 1 }}
      style={{ position: 'absolute', width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox="0 0 160 160">
        <Path d="M116 112 C148 105 150 132 127 135" fill="none" stroke="#244467" strokeWidth="11" strokeLinecap="round" />
        <Path d="M116 112 C146 106 146 128 126 130" fill="none" stroke="#62b5ff" strokeWidth="6" strokeLinecap="round" />
      </Svg>
    </MotiView>
  )
}

function EyeLayer({ size, animated }: { size: number; animated: boolean }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size }}>
      <AnimatedEye left={(64 / 160) * size - 4} top={(70 / 160) * size} animated={animated} />
      <AnimatedEye left={(96 / 160) * size - 4} top={(70 / 160) * size} animated={animated} delay={120} />
    </View>
  )
}

function AnimatedEye({ left, top, animated, delay = 0 }: { left: number; top: number; animated: boolean; delay?: number }) {
  return (
    <MotiView
      from={{ scaleY: 1 }}
      animate={animated ? { scaleY: 0.16 } : { scaleY: 1 }}
      transition={animated ? { loop: true, type: 'timing', duration: 2200, delay } : { type: 'timing', duration: 1 }}
      style={{ position: 'absolute', left, top, width: 8, height: 12 }}
    >
      <Svg width={8} height={12} viewBox="0 0 8 12">
        <Ellipse cx="4" cy="6" rx="4" ry="6" fill="#244467" />
      </Svg>
    </MotiView>
  )
}

function PawSparkLayer({ size, animated }: { size: number; animated: boolean }) {
  return (
    <MotiView
      pointerEvents="none"
      from={{ translateY: 0, opacity: 0.72 }}
      animate={animated ? { translateY: -5, opacity: 1 } : { translateY: 0, opacity: 0.78 }}
      transition={animated ? { loop: true, type: 'timing', duration: 740 } : { type: 'timing', duration: 1 }}
      style={{ position: 'absolute', width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox="0 0 160 160">
        <Circle cx="103" cy="121" r="5" fill="#ffd66d" stroke="#244467" strokeWidth="2.5" />
        <Circle cx="95" cy="127" r="3" fill="#ffd66d" stroke="#244467" strokeWidth="2" />
      </Svg>
    </MotiView>
  )
}

function LoadingOrbit({ size, animated }: { size: number; animated: boolean }) {
  const items = [
    { x: size * 0.18, y: size * 0.32, color: '#58b7ff' },
    { x: size * 0.78, y: size * 0.28, color: '#ffd66d' },
    { x: size * 0.22, y: size * 0.74, color: '#8de2c3' },
    { x: size * 0.75, y: size * 0.72, color: '#58b7ff' },
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
        <Path d={`M ${size * 0.5} ${size * 0.1} C ${size * 0.86} ${size * 0.16}, ${size * 0.9} ${size * 0.66}, ${size * 0.58} ${size * 0.82} C ${size * 0.42} ${size * 0.9}, ${size * 0.14} ${size * 0.74}, ${size * 0.16} ${size * 0.5} C ${size * 0.17} ${size * 0.28}, ${size * 0.34} ${size * 0.14}, ${size * 0.5} ${size * 0.1} Z`} fill="none" stroke="#7cc7ff" strokeWidth="3" strokeLinecap="round" strokeDasharray="8 12" opacity="0.5" />
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
