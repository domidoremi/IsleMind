import type { ImageSourcePropType } from 'react-native'
import type { HomePetAnimation, IsleAtlasId } from '@/components/mascot/petState'

const CORE_SPRITESHEET = require('../../../assets/pets/isle/spritesheet.webp') as ImageSourcePropType

export interface IsleAtlasDefinition {
  id: IsleAtlasId
  spritesheetPath: string
  source?: ImageSourcePropType
  columns: number
  cellWidth: number
  cellHeight: number
  rows: number
  available: boolean
  fallbackAtlasId?: IsleAtlasId
}

export interface IsleAnimationDefinition {
  atlasId: IsleAtlasId
  row: number
  frames: number
  fps: number
  fallbackAnimation?: HomePetAnimation
}

export interface ResolvedIsleAnimation {
  animation: HomePetAnimation
  requestedAnimation: HomePetAnimation
  atlas: IsleAtlasDefinition
  row: IsleAnimationDefinition
  usingFallback: boolean
}

export const ISLE_ATLASES: Record<IsleAtlasId, IsleAtlasDefinition> = {
  core: {
    id: 'core',
    spritesheetPath: 'spritesheet.webp',
    source: CORE_SPRITESHEET,
    columns: 8,
    cellWidth: 192,
    cellHeight: 208,
    rows: 9,
    available: true,
  },
  rag: {
    id: 'rag',
    spritesheetPath: 'rag-spritesheet.webp',
    columns: 8,
    cellWidth: 192,
    cellHeight: 208,
    rows: 9,
    available: false,
    fallbackAtlasId: 'core',
  },
  provider: {
    id: 'provider',
    spritesheetPath: 'provider-spritesheet.webp',
    columns: 8,
    cellWidth: 192,
    cellHeight: 208,
    rows: 9,
    available: false,
    fallbackAtlasId: 'core',
  },
}

export const ISLE_ANIMATIONS: Record<HomePetAnimation, IsleAnimationDefinition> = {
  idle: { atlasId: 'core', row: 0, frames: 6, fps: 5 },
  runningRight: { atlasId: 'core', row: 1, frames: 8, fps: 10 },
  runningLeft: { atlasId: 'core', row: 2, frames: 8, fps: 10 },
  waving: { atlasId: 'core', row: 3, frames: 4, fps: 6 },
  jumping: { atlasId: 'core', row: 4, frames: 5, fps: 8 },
  failed: { atlasId: 'core', row: 5, frames: 8, fps: 5 },
  waiting: { atlasId: 'core', row: 6, frames: 6, fps: 4 },
  running: { atlasId: 'core', row: 7, frames: 6, fps: 8 },
  review: { atlasId: 'core', row: 8, frames: 6, fps: 5 },
  deepThinking: { atlasId: 'rag', row: 0, frames: 6, fps: 5, fallbackAnimation: 'review' },
  retrieving: { atlasId: 'rag', row: 1, frames: 8, fps: 8, fallbackAnimation: 'review' },
  warningRecover: { atlasId: 'rag', row: 2, frames: 8, fps: 5, fallbackAnimation: 'failed' },
  toolWorking: { atlasId: 'provider', row: 0, frames: 8, fps: 8, fallbackAnimation: 'waving' },
  syncingModels: { atlasId: 'provider', row: 1, frames: 8, fps: 8, fallbackAnimation: 'running' },
  offlineWaiting: { atlasId: 'provider', row: 2, frames: 6, fps: 4, fallbackAnimation: 'waiting' },
}

export function resolveIsleAnimation(animation: HomePetAnimation, atlasId?: IsleAtlasId): ResolvedIsleAnimation {
  const requested = ISLE_ANIMATIONS[animation] ?? ISLE_ANIMATIONS.idle
  const preferredAtlas = atlasId ? ISLE_ATLASES[atlasId] : ISLE_ATLASES[requested.atlasId]
  if (preferredAtlas?.available && preferredAtlas.source) {
    return {
      animation,
      requestedAnimation: animation,
      atlas: preferredAtlas,
      row: { ...requested, atlasId: preferredAtlas.id },
      usingFallback: false,
    }
  }

  const fallbackAnimation = requested.fallbackAnimation ?? 'idle'
  const fallback = ISLE_ANIMATIONS[fallbackAnimation] ?? ISLE_ANIMATIONS.idle
  const fallbackAtlas = ISLE_ATLASES[fallback.atlasId] ?? ISLE_ATLASES.core
  return {
    animation: fallbackAnimation,
    requestedAnimation: animation,
    atlas: fallbackAtlas.available && fallbackAtlas.source ? fallbackAtlas : ISLE_ATLASES.core,
    row: fallbackAtlas.available && fallbackAtlas.source ? fallback : ISLE_ANIMATIONS.idle,
    usingFallback: true,
  }
}
