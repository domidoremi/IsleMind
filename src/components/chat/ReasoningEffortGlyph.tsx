import { Animated } from 'react-native'
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg'
import type { ReasoningControlValue } from '@/utils/modelReasoning'
import type { ReasoningEffortEffect } from './composerReasoningEffects'

export function ReasoningEffortGlyph({ level, effect, size, id, progress, variant }: {
  level: ReasoningControlValue
  effect: ReasoningEffortEffect
  size: number
  id: string
  progress: Animated.Value
  variant: 'compact' | 'thumb' | 'feedback'
}) {
  const { themeId } = effect
  const gradient = `url(#${id})`
  return <Animated.View testID={`chat-reasoning-effect-${level}-${variant}`} pointerEvents="none" accessible={false}
    style={{ width: size, height: size, transform: [
      { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: [`-${effect.turn}deg`, '0deg'] }) },
      { scale: progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.94, effect.pop, 1] }) },
      { translateY: progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, effect.lift, 0] }) },
    ] }}>
    <Svg testID={`chat-reasoning-glyph-${themeId}-${variant}`} width={size} height={size} viewBox="0 0 32 32">
      <Defs><LinearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
        <Stop offset="0%" stopColor={effect.start} />
        <Stop offset="100%" stopColor={effect.end} />
      </LinearGradient></Defs>
      {effect.halo > 0 ? themeId === 'monet' ? <>
        <Path d="M4 17C2 9 12 3 21 5C31 6 30 21 23 26C14 31 4 26 4 17Z" fill={effect.end} fillOpacity={effect.halo * 0.55} />
        <Ellipse cx="15" cy="16" rx="10" ry="9" fill={effect.start} fillOpacity={effect.halo} />
      </> : <>
        <Circle cx="16" cy="16" r="14" fill={effect.end} fillOpacity={effect.halo * 0.4} />
        <Circle cx="16" cy="16" r="11" fill={effect.start} fillOpacity={effect.halo} />
      </> : null}
      {Array.from({ length: effect.rings }, (_, index) => {
        const stroke = index % 2 ? effect.end : effect.start
        if (themeId === 'minimal') return <Circle key={index} cx="16" cy="16" r={8 + index * 3}
          fill="none" stroke={stroke} strokeWidth="0.8" strokeOpacity={0.65 - index * 0.12}
          strokeDasharray={level === 'default' ? '2 3' : '12 10'} rotation={-45 + index * 55} origin="16,16" />
        if (themeId === 'monet') return <Path key={index} d="M5 18C2 8 24 3 27 12M6 23C10 28 22 25 27 17"
          fill="none" stroke={stroke} strokeWidth={1.7 - index * 0.25} strokeLinecap="round"
          strokeOpacity={0.5 - index * 0.08} rotation={index * 50} origin="16,16" />
        if (themeId === 'material') return <Circle key={index} cx="16" cy="16" r={9 + index * 2.4}
          fill="none" stroke={stroke} strokeWidth="1.4" strokeOpacity={0.6 - index * 0.12}
          strokeDasharray={level === 'default' ? '2 4' : '8 4'} rotation={-30 + index * 35} origin="16,16" />
        if (themeId === 'animal-island-ui') return <Circle key={index} cx="16" cy="16" r={9.5 + index * 2.1}
          fill="none" stroke={stroke} strokeWidth="0.8" strokeOpacity={0.5 - index * 0.12}
          strokeDasharray={level === 'default' ? '2 3' : '20 8'} rotation={index * 40} origin="16,16" />
        return <Ellipse key={index} cx="16" cy="16" rx={10 + index * 1.5} ry={7 + index * 1.5}
          rotation={-30 + index * 60} origin="16,16" fill="none" stroke={stroke} strokeWidth="0.8"
          strokeOpacity={0.7 - index * 0.1} strokeDasharray={level === 'default' ? '2 3' : `${18 - index * 3} 6`} />
      })}
      {effect.core === 'hollow' ? <>
        <Circle cx="16" cy="16" r="5.5" fill="none" stroke={effect.end} strokeWidth="1.7" />
        <Path d="M12.2 19.8L19.8 12.2" stroke={effect.start} strokeWidth="1.3" strokeLinecap="round" />
      </> : themeId === 'minimal' ? <>
        {effect.core === 'star' ? <Path d="M16 9L23 16L16 23L9 16Z" fill="none" stroke={gradient} strokeWidth="1.4" />
          : <Circle cx="16" cy="16" r={effect.core === 'seed' ? 3 : 4.5} fill="none" stroke={gradient}
            strokeWidth="1.4" strokeDasharray={level === 'default' ? '2 2' : undefined} />}
        <Circle cx="16" cy="16" r={effect.core === 'seed' ? 1 : 1.6} fill={effect.end} />
      </> : effect.core === 'pearl' ? <>
        <Circle cx="16" cy="16" r="4.5" fill={gradient} fillOpacity="0.6" />
        <Circle cx="15" cy="14.5" r="1.3" fill="white" fillOpacity="0.7" />
      </> : themeId === 'animal-island-ui' && effect.core !== 'star' ? <>
        <Path d={effect.core === 'seed' ? 'M16 22V17M16 18C8 17 9 10 10 9C17 9 20 13 16 18Z'
          : 'M16 23V15M16 17C8 16 8 9 10 8C17 8 19 13 16 17ZM16 16C17 9 23 9 25 10C25 16 21 20 16 16Z'}
          fill={gradient} stroke={effect.end} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M12 11L15 15" stroke="white" strokeWidth="0.9" strokeOpacity="0.65" strokeLinecap="round" />
      </> : themeId === 'monet' && effect.core !== 'star' ? <>
        <Path d={effect.core === 'seed' ? 'M13 12C18 9 22 14 20 18C19 22 12 21 11 17C9 14 11 13 13 12Z'
          : 'M10 12C9 8 17 8 20 11C25 12 25 19 21 21C18 25 10 23 9 18C7 16 8 13 10 12Z'} fill={gradient} />
        <Path d="M12 13Q14 11 17 12" fill="none" stroke="white" strokeWidth="1.2" strokeOpacity="0.6" strokeLinecap="round" />
      </> : effect.core === 'star' ? <>
        <Path d={themeId === 'material' ? 'M16 8L24 16L16 24L8 16Z'
          : 'M16 8.5L18 13.5L23.5 16L18 18.5L16 23.5L14 18.5L8.5 16L14 13.5Z'} fill={gradient} />
        {themeId !== 'material' ? <Circle cx="15" cy="14.5" r="1.7" fill="white" fillOpacity="0.8" /> : null}
      </> : <>
        <Circle cx="16" cy="16" r={effect.core === 'seed' ? 4 : 5.8} fill={gradient} />
        {themeId !== 'material' ? <Circle cx="14.3" cy="13.8" r={effect.core === 'seed' ? 1.1 : 1.8} fill="white" fillOpacity="0.8" /> : null}
      </>}
      {themeId === 'liquid-glass' && effect.core !== 'hollow' ? <>
        <Path d="M7 12C10 5 21 4 25 11" fill="none" stroke="white" strokeWidth="1" strokeOpacity="0.6" strokeLinecap="round" />
        <Path d="M10 25Q17 29 24 22" fill="none" stroke={effect.start} strokeWidth="1.1" strokeOpacity="0.45" strokeLinecap="round" />
      </> : null}
      {Array.from({ length: effect.sparks }, (_, index) => {
        const angle = (-45 + index * 360 / Math.max(1, effect.sparks)) * Math.PI / 180
        const x = 16 + Math.cos(angle) * 12
        const y = 16 + Math.sin(angle) * 12
        const color = index % 2 ? effect.end : effect.start
        if (themeId === 'minimal') return <Path key={index} d={`M${x - 1} ${y}h2`} stroke={color} strokeWidth="1" strokeLinecap="round" />
        if (themeId === 'material') return <Rect key={index} x={x - 1} y={y - 1.5} width="2" height="3" rx="0.6" fill={color}
          rotation={angle * 180 / Math.PI + 90} origin={`${x},${y}`} />
        return <Ellipse key={index} cx={x} cy={y} rx={themeId === 'animal-island-ui' ? 1.2 : 1}
          ry={themeId === 'monet' ? 0.65 : themeId === 'animal-island-ui' ? 1.7 : index === 0 ? 1.2 : 0.8}
          rotation={angle * 180 / Math.PI} origin={`${x},${y}`} fill={color} fillOpacity={0.9 - index * 0.08} />
      })}
    </Svg>
  </Animated.View>
}
