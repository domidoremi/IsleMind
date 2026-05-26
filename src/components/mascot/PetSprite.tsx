import { useEffect, useMemo, useState } from 'react'
import { Image } from 'expo-image'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { MotiView } from 'moti'
import { resolveIsleAnimation } from '@/components/mascot/isleManifest'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import type { HomePetAnimation, IsleAtlasId } from '@/components/mascot/petState'

interface PetSpriteProps {
  animation: HomePetAnimation
  atlasId?: IsleAtlasId
  size: number
  speed?: number
  onError?: () => void
  style?: StyleProp<ViewStyle>
}

export function PetSprite({ animation, atlasId, size, speed = 1, onError, style }: PetSpriteProps) {
  const motion = useMotionPreference()
  const state = resolveIsleAnimation(animation, atlasId)
  const row = state.row
  const atlas = state.atlas
  const [frame, setFrame] = useState(0)
  const scale = size / atlas.cellHeight
  const imageWidth = atlas.columns * atlas.cellWidth * scale
  const imageHeight = atlas.rows * atlas.cellHeight * scale
  const containerWidth = atlas.cellWidth * scale
  const frameDuration = Math.max(80, 1000 / (row.fps * Math.max(speed, 0.6)))
  const loopKey = `${state.animation}:${state.requestedAnimation}:${atlas.id}:${row.frames}:${frameDuration}`

  useEffect(() => {
    setFrame(0)
  }, [state.animation, state.requestedAnimation, atlas.id])

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
        { translateX: -frame * atlas.cellWidth * scale },
        { translateY: -row.row * atlas.cellHeight * scale },
      ],
    }),
    [atlas.cellHeight, atlas.cellWidth, frame, imageHeight, imageWidth, row.row, scale]
  )

  return (
    <MotiView
      from={{ translateY: 0, scale: 1 }}
      animate={motion === 'full' ? outerMotion(state.animation) : { translateY: 0, scale: 1 }}
      transition={motion === 'full' ? { loop: true, type: 'timing', duration: outerDuration(state.animation, speed) } : { type: 'timing', duration: 1 }}
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
        <Image source={atlas.source} style={frameStyle} contentFit="fill" onError={onError} />
      </View>
    </MotiView>
  )
}

function outerMotion(state: HomePetAnimation) {
  switch (state) {
    case 'modelTesting':
    case 'syncingModels':
    case 'running':
      return { translateY: -4, scale: 1.01 }
    case 'contextCompressing':
    case 'citationReview':
    case 'graphMapping':
    case 'memoryLinking':
    case 'deepThinking':
    case 'retrieving':
    case 'review':
      return { translateY: -2, scale: 1.005 }
    case 'mcpWorking':
    case 'skillRunning':
    case 'attachmentReading':
    case 'toolWorking':
    case 'waving':
      return { translateY: -3, scale: 1.01 }
    case 'flareScan':
    case 'knowledgeIndexing':
    case 'webSearching':
    case 'sendingPrompt':
      return { translateY: -5, scale: 1.012 }
    case 'jumping':
      return { translateY: -9, scale: 1.02 }
    case 'providerIssue':
    case 'warningRecover':
    case 'failed':
      return { translateY: 3, scale: 0.99 }
    case 'offlineWaiting':
    case 'waiting':
      return { translateY: 1, scale: 0.995 }
    case 'idle':
    default:
      return { translateY: -3, scale: 1.006 }
  }
}

function outerDuration(state: HomePetAnimation, speed: number): number {
  const base = state === 'jumping'
    ? 680
    : state === 'running' || state === 'syncingModels' || state === 'toolWorking' || state === 'mcpWorking' || state === 'webSearching' || state === 'modelTesting' || state === 'knowledgeIndexing'
      ? 760
      : state === 'failed' || state === 'warningRecover' || state === 'providerIssue'
        ? 1280
        : motionTokens.duration.mascotLoop
  return Math.max(520, base / Math.max(speed, 0.7))
}
