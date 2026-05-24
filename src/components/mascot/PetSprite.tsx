import { useEffect, useMemo, useState } from 'react'
import { Image } from 'expo-image'
import { View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native'
import { MotiView } from 'moti'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import type { HomePetAnimation } from '@/components/mascot/petState'

const AOI_SPRITESHEET = require('../../../assets/pets/aoi/spritesheet.webp') as ImageSourcePropType

const ATLAS = {
  columns: 8,
  cellWidth: 192,
  cellHeight: 208,
  rows: {
    idle: { row: 0, frames: 6, fps: 5 },
    runningRight: { row: 1, frames: 8, fps: 10 },
    runningLeft: { row: 2, frames: 8, fps: 10 },
    waving: { row: 3, frames: 4, fps: 6 },
    jumping: { row: 4, frames: 5, fps: 8 },
    failed: { row: 5, frames: 8, fps: 5 },
    waiting: { row: 6, frames: 6, fps: 4 },
    running: { row: 7, frames: 6, fps: 8 },
    review: { row: 8, frames: 6, fps: 5 },
  },
} as const

type AtlasState = keyof typeof ATLAS.rows

interface PetSpriteProps {
  animation: HomePetAnimation
  size: number
  speed?: number
  onError?: () => void
  style?: StyleProp<ViewStyle>
}

export function PetSprite({ animation, size, speed = 1, onError, style }: PetSpriteProps) {
  const motion = useMotionPreference()
  const state = normalizeAnimation(animation)
  const row = ATLAS.rows[state]
  const [frame, setFrame] = useState(0)
  const scale = size / ATLAS.cellHeight
  const imageWidth = ATLAS.columns * ATLAS.cellWidth * scale
  const imageHeight = Object.keys(ATLAS.rows).length * ATLAS.cellHeight * scale
  const containerWidth = ATLAS.cellWidth * scale
  const frameDuration = Math.max(80, 1000 / (row.fps * Math.max(speed, 0.6)))
  const loopKey = `${state}:${row.frames}:${frameDuration}`

  useEffect(() => {
    setFrame(0)
  }, [state])

  useEffect(() => {
    if (motion !== 'full' || row.frames <= 1) return undefined
    const timer = setInterval(() => {
      setFrame((current) => (current + 1) % row.frames)
    }, frameDuration)
    return () => clearInterval(timer)
  }, [loopKey, motion, row.frames, frameDuration])

  const frameStyle = useMemo(
    () => ({
      width: imageWidth,
      height: imageHeight,
      transform: [
        { translateX: -frame * ATLAS.cellWidth * scale },
        { translateY: -row.row * ATLAS.cellHeight * scale },
      ],
    }),
    [frame, imageHeight, imageWidth, row.row, scale]
  )

  return (
    <MotiView
      from={{ translateY: 0, scale: 1 }}
      animate={motion === 'full' ? outerMotion(state) : { translateY: 0, scale: 1 }}
      transition={motion === 'full' ? { loop: true, type: 'timing', duration: outerDuration(state, speed) } : { type: 'timing', duration: 1 }}
      style={[{ width: containerWidth, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
      pointerEvents="none"
    >
      <View
        style={{
          width: containerWidth,
          height: size,
          overflow: 'hidden',
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
        }}
        pointerEvents="none"
      >
        <Image source={AOI_SPRITESHEET} style={frameStyle} contentFit="fill" onError={onError} />
      </View>
    </MotiView>
  )
}

function normalizeAnimation(animation: HomePetAnimation): AtlasState {
  switch (animation) {
    case 'running':
    case 'review':
    case 'waving':
    case 'jumping':
    case 'failed':
      return animation
    case 'idle':
    default:
      return 'idle'
  }
}

function outerMotion(state: AtlasState) {
  switch (state) {
    case 'running':
      return { translateY: -4, scale: 1.01 }
    case 'review':
      return { translateY: -2, scale: 1.005 }
    case 'waving':
      return { translateY: -3, scale: 1.01 }
    case 'jumping':
      return { translateY: -9, scale: 1.02 }
    case 'failed':
      return { translateY: 3, scale: 0.99 }
    case 'idle':
    default:
      return { translateY: -3, scale: 1.006 }
  }
}

function outerDuration(state: AtlasState, speed: number): number {
  const base = state === 'jumping'
    ? 680
    : state === 'running'
      ? 760
      : state === 'failed'
        ? 1280
        : motionTokens.duration.mascotLoop
  return Math.max(520, base / Math.max(speed, 0.7))
}
