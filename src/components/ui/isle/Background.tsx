import { StyleSheet, View } from 'react-native'
import { MotiView } from 'moti'
import Svg, { Path, Rect } from 'react-native-svg'
import type { MotionIntensity } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import type { AppPalette, ThemeBackgroundMode } from '@/theme/colors'

export type IsleBackgroundMode = 'default' | ThemeBackgroundMode | 'none'
export type IsleBackgroundState = 'idle' | 'active' | 'input' | 'modal' | 'error'

interface IsleBackgroundProps {
  colors: AppPalette
  motion: MotionIntensity
  mode?: IsleBackgroundMode
  state?: IsleBackgroundState
  intensity?: number
}

export function IsleBackground({ colors, motion, mode = 'default', state = 'idle', intensity = 1 }: IsleBackgroundProps) {
  const resolvedMode = resolveBackgroundMode(colors, mode)
  if (resolvedMode === 'none' || resolvedMode === 'plain') return null

  const animated = shouldAnimateBackground(colors, motion, state)
  const profile = backgroundProfile(colors, resolvedMode, state, intensity)

  return (
    <View pointerEvents="none" style={styles.backdrop}>
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: profile.canvas }]} />
      <AmbientMistField
        enabled={animated}
        delay={0}
        opacity={profile.coolOpacity}
        primary={colors.background.mist.primary}
        secondary={colors.background.mist.secondary}
        from={{ translateX: -18, translateY: -8, scale: 1 }}
        animate={{ translateX: 18 * profile.motionScale, translateY: 10 * profile.motionScale, scale: 1 + 0.02 * profile.motionScale }}
      />
      <AmbientMistField
        enabled={animated}
        delay={motionTokens.duration.fast}
        opacity={profile.warmOpacity}
        primary={colors.background.mist.warm}
        secondary={colors.background.mist.primary}
        from={{ translateX: 16, translateY: 12, scale: 1.01 }}
        animate={{ translateX: -16 * profile.motionScale, translateY: -6 * profile.motionScale, scale: 1.01 + 0.025 * profile.motionScale }}
      />
      <AmbientTraceField
        enabled={animated}
        delay={motionTokens.duration.normal}
        opacity={profile.traceOpacity}
        primary={colors.background.trace.primary}
        secondary={colors.background.trace.secondary}
        accent={profile.traceAccent}
        grid={colors.background.grid}
        motionScale={profile.motionScale}
        showGrid={resolvedMode === 'surface' || state === 'modal'}
      />
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.background.scrim, opacity: profile.scrimOpacity }]} />
    </View>
  )
}

export function resolveBackgroundMode(colors: AppPalette, mode: IsleBackgroundMode = 'default'): ThemeBackgroundMode | 'none' {
  if (mode === 'none') return 'none'
  if (mode === 'default') return colors.background.defaultMode
  return mode
}

export function resolveBackgroundCanvas(colors: AppPalette, mode: IsleBackgroundMode = 'default') {
  const resolvedMode = resolveBackgroundMode(colors, mode)
  if (resolvedMode === 'focus') return colors.background.focusCanvas
  if (resolvedMode === 'surface') return colors.background.surfaceCanvas
  return colors.background.canvas
}

function shouldAnimateBackground(colors: AppPalette, motion: MotionIntensity, state: IsleBackgroundState) {
  if (motion !== 'full') return false
  if (colors.background.motion === 'none') return false
  if (state === 'input' || state === 'modal') return false
  return true
}

function backgroundProfile(colors: AppPalette, mode: ThemeBackgroundMode, state: IsleBackgroundState, intensity: number) {
  const normalizedIntensity = Math.max(0, Math.min(1.4, intensity))
  const modeScale = mode === 'ambient' ? 1 : mode === 'focus' ? 0.58 : 0.42
  const stateScale = state === 'active' ? 1.08 : state === 'error' ? 0.96 : state === 'input' ? 0.48 : state === 'modal' ? 0.35 : 1
  const calmScale = normalizedIntensity * modeScale * stateScale
  const canvas = mode === 'focus'
    ? colors.background.focusCanvas
    : mode === 'surface'
      ? colors.background.surfaceCanvas
      : colors.background.canvas

  return {
    canvas,
    coolOpacity: opacityForMode(colors, mode, 'cool') * calmScale,
    warmOpacity: opacityForMode(colors, mode, 'warm') * calmScale,
    traceOpacity: opacityForMode(colors, mode, 'trace') * calmScale,
    scrimOpacity: state === 'modal' ? 0.72 : state === 'input' ? 0.38 : 0.18,
    traceAccent: state === 'error' ? colors.error : colors.background.trace.accent,
    motionScale: colors.background.motion === 'subtle' ? 0.52 : mode === 'focus' || mode === 'surface' ? 0.62 : 1,
  }
}

function opacityForMode(colors: AppPalette, mode: ThemeBackgroundMode, channel: 'cool' | 'warm' | 'trace') {
  if (channel === 'trace') {
    if (mode === 'focus') return colors.background.trace.focusOpacity
    if (mode === 'surface') return colors.background.trace.surfaceOpacity
    return colors.background.trace.opacity
  }
  if (channel === 'warm') {
    if (mode === 'focus') return colors.background.mist.focusOpacity * 0.72
    if (mode === 'surface') return colors.background.mist.surfaceOpacity * 0.62
    return colors.background.mist.warmOpacity
  }
  if (mode === 'focus') return colors.background.mist.focusOpacity
  if (mode === 'surface') return colors.background.mist.surfaceOpacity
  return colors.background.mist.coolOpacity
}

function AmbientMistField({
  primary,
  secondary,
  opacity,
  enabled,
  delay,
  from,
  animate,
}: {
  primary: string
  secondary: string
  opacity: number
  enabled: boolean
  delay: number
  from: { translateX: number; translateY: number; scale: number }
  animate: { translateX: number; translateY: number; scale: number }
}) {
  return (
    <MotiView
      from={from}
      animate={enabled ? animate : { translateX: 0, translateY: 0, scale: 1 }}
      transition={enabled ? { loop: true, type: 'timing', duration: motionTokens.duration.ambient * 2.4, delay } : { type: 'timing', duration: 1 }}
      style={[styles.fieldLayer, { opacity }]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="none">
        <Path d="M-92 74C24 36 96 98 192 68C286 39 330 -18 476 14" stroke={primary} strokeWidth={172} strokeLinecap="round" fill="none" />
        <Path d="M-112 642C12 568 118 632 220 572C308 520 356 456 500 484" stroke={secondary} strokeWidth={206} strokeLinecap="round" fill="none" />
        <Path d="M-88 354C48 284 120 318 230 286C332 256 396 206 492 238" stroke={primary} strokeWidth={86} strokeLinecap="round" fill="none" opacity={0.58} />
      </Svg>
    </MotiView>
  )
}

function AmbientTraceField({
  primary,
  secondary,
  accent,
  grid,
  opacity,
  enabled,
  delay,
  motionScale,
  showGrid,
}: {
  primary: string
  secondary: string
  accent: string
  grid: string
  opacity: number
  enabled: boolean
  delay: number
  motionScale: number
  showGrid: boolean
}) {
  const drift = motionTokens.distance.blob * motionScale

  return (
    <MotiView
      from={{ opacity: opacity * 0.72, translateX: -drift, translateY: 0 }}
      animate={enabled ? { opacity, translateX: drift, translateY: -6 * motionScale } : { opacity: opacity * 0.76, translateX: 0, translateY: 0 }}
      transition={enabled ? { loop: true, type: 'timing', duration: motionTokens.duration.ambient * 1.8, delay } : { type: 'timing', duration: 1 }}
      style={styles.traceLayer}
    >
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="none">
        {showGrid ? <Rect x="0" y="0" width="390" height="844" fill="none" stroke={grid} strokeWidth="1" strokeDasharray="1 34" opacity={0.64} /> : null}
        <Path d="M18 206C82 176 134 194 188 158C246 120 308 110 372 82" stroke={primary} strokeWidth={1.4} strokeLinecap="round" fill="none" opacity={0.42} />
        <Path d="M-10 526C58 498 126 534 186 492C248 448 294 452 404 386" stroke={secondary} strokeWidth={1.2} strokeLinecap="round" fill="none" opacity={0.34} />
        <Path d="M40 742C122 704 174 736 250 682C302 646 336 632 402 624" stroke={accent} strokeWidth={1.2} strokeLinecap="round" fill="none" opacity={0.3} />
      </Svg>
    </MotiView>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: -160,
    right: 0,
    bottom: -160,
    left: 0,
  },
  fieldLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  traceLayer: {
    ...StyleSheet.absoluteFillObject,
  },
})
