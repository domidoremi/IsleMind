import { useEffect, useMemo, useState } from 'react'
import { AppState, StyleSheet, View, type AppStateStatus } from 'react-native'
import { MotiView } from 'moti'
import Svg, { Circle, Defs, Ellipse, RadialGradient, Rect, Stop } from 'react-native-svg'
import { Easing } from 'react-native-reanimated'
import type { AppPalette, ThemeBackgroundMode } from '@/theme/colors'
import { hashEnvironmentSeed, seededEnvironmentValue, type BackgroundEnvironmentConfig } from '@/theme/backgroundEnvironment'
import { useMotionPreference } from '@/hooks/useMotionPreference'

export type IsleBackgroundMode = 'default' | ThemeBackgroundMode | 'none'
export type IsleBackgroundState = 'idle' | 'active' | 'input' | 'modal' | 'error'

interface IsleBackgroundProps {
  colors: AppPalette
  environment: BackgroundEnvironmentConfig
  mode?: IsleBackgroundMode
  state?: IsleBackgroundState
  intensity?: number
}

interface AmbientField {
  id: string
  color: string
  x: number
  y: number
  radiusX: number
  radiusY: number
  opacity: number
  driftX: number
  driftY: number
  scale: number
  duration: number
  delay: number
}

export function IsleBackground({ colors, environment, mode = 'default', state = 'idle', intensity = 1 }: IsleBackgroundProps) {
  const resolvedMode = resolveBackgroundMode(colors, mode)
  const experienceBackground = colors.ui.experience.background
  const motionPreference = useMotionPreference()
  const appActive = useAppActive()
  const variationEpoch = useEnvironmentVariationEpoch(environment.variation)
  const seed = environment.variation === 'random' || environment.variation === 'daily'
    ? hashEnvironmentSeed(`${environment.seed}:${variationEpoch}`)
    : environment.seed
  const profile = backgroundProfile(colors, resolvedMode === 'none' ? colors.background.defaultMode : resolvedMode, state, intensity, environment.visualIntensity)
  const animated = resolvedMode !== 'none'
    && appActive
    && motionPreference === 'full'
    && environment.motion !== 'static'
    && (state === 'idle' || state === 'active')
  const fields = useMemo(
    () => buildAmbientFields(colors, environment, seed, profile.environmentOpacity),
    [colors, environment, profile.environmentOpacity, seed],
  )

  if (resolvedMode === 'none') return null

  return (
    <View pointerEvents="none" testID={`theme-background-${experienceBackground}-${environment.kind}`} style={styles.backdrop}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: profile.canvas }]} />
      {environment.kind === 'minimal' ? (
        <MinimalEnvironment fields={fields} animated={animated} amplitude={environment.amplitude} />
      ) : environment.kind === 'tonal' ? (
        <TonalEnvironment fields={fields} animated={animated} amplitude={environment.amplitude} grid={colors.background.grid} />
      ) : (
        <AmbientEnvironment fields={fields} animated={animated} amplitude={environment.amplitude} fluid={environment.kind === 'fluid'} />
      )}
      {environment.kind === 'fluid' && environment.grainOpacity > 0 ? (
        <EnvironmentGrain seed={seed} opacity={environment.grainOpacity * profile.stateScale} color={colors.text} />
      ) : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background.scrim, opacity: profile.scrimOpacity }]} />
    </View>
  )
}

function MinimalEnvironment({ fields, animated, amplitude }: { fields: AmbientField[]; animated: boolean; amplitude: number }) {
  return <View style={styles.fieldLayer}>{fields.slice(0, 1).map((field) => <EnvironmentField key={field.id} field={field} animated={animated} amplitude={amplitude * 0.34} />)}</View>
}

function TonalEnvironment({ fields, animated, amplitude, grid }: { fields: AmbientField[]; animated: boolean; amplitude: number; grid: string }) {
  return (
    <View style={styles.fieldLayer}>
      {fields.slice(0, 2).map((field) => <EnvironmentField key={field.id} field={field} animated={animated} amplitude={amplitude * 0.45} />)}
      <View style={[styles.tonalHorizon, { backgroundColor: grid }]} />
    </View>
  )
}

function AmbientEnvironment({ fields, animated, amplitude, fluid }: { fields: AmbientField[]; animated: boolean; amplitude: number; fluid: boolean }) {
  return (
    <View style={styles.fieldLayer}>
      {fields.map((field) => <EnvironmentField key={field.id} field={field} animated={animated} amplitude={amplitude} />)}
      {fluid ? <FluidLightDirection field={fields[0]} animated={animated} amplitude={amplitude} /> : null}
    </View>
  )
}

function EnvironmentField({ field, animated, amplitude }: { field: AmbientField; animated: boolean; amplitude: number }) {
  const artwork = (
    <Svg width="100%" height="100%" viewBox="0 0 1000 1000" preserveAspectRatio="none">
      <Defs>
        <RadialGradient id={field.id} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0%" stopColor={field.color} stopOpacity={0.88} />
          <Stop offset="48%" stopColor={field.color} stopOpacity={0.42} />
          <Stop offset="100%" stopColor={field.color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={field.x} cy={field.y} rx={field.radiusX} ry={field.radiusY} fill={`url(#${field.id})`} />
    </Svg>
  )
  if (!animated || amplitude <= 0) return <View style={[styles.fieldLayer, { opacity: field.opacity }]}>{artwork}</View>
  return (
    <MotiView
      from={{ opacity: field.opacity * 0.82, translateX: -field.driftX * amplitude, translateY: -field.driftY * amplitude, scale: 1 }}
      animate={{ opacity: field.opacity, translateX: field.driftX * amplitude, translateY: field.driftY * amplitude, scale: 1 + field.scale * amplitude }}
      transition={{ type: 'timing', duration: field.duration, delay: field.delay, easing: Easing.inOut(Easing.sin), loop: true }}
      style={styles.fieldLayer}
    >
      {artwork}
    </MotiView>
  )
}

function FluidLightDirection({ field, animated, amplitude }: { field?: AmbientField; animated: boolean; amplitude: number }) {
  if (!field) return null
  const light = (
    <Svg width="100%" height="100%" viewBox="0 0 1000 1000" preserveAspectRatio="none">
      <Defs>
        <RadialGradient id="fluid-light" cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.34} />
          <Stop offset="55%" stopColor="#FFFFFF" stopOpacity={0.09} />
          <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={field.x} cy={field.y} rx={field.radiusX * 0.66} ry={field.radiusY * 0.54} fill="url(#fluid-light)" />
    </Svg>
  )
  if (!animated || amplitude <= 0) return <View style={[styles.fieldLayer, { opacity: 0.16 }]}>{light}</View>
  return (
    <MotiView
      from={{ opacity: 0.08, translateX: -18 * amplitude, translateY: 10 * amplitude }}
      animate={{ opacity: 0.18, translateX: 24 * amplitude, translateY: -16 * amplitude }}
      transition={{ type: 'timing', duration: field.duration * 1.37, easing: Easing.inOut(Easing.sin), loop: true }}
      style={styles.fieldLayer}
    >
      {light}
    </MotiView>
  )
}

function EnvironmentGrain({ seed, opacity, color }: { seed: number; opacity: number; color: string }) {
  const points = Array.from({ length: 34 }, (_, index) => ({
    x: seededEnvironmentValue(seed, 100 + index * 3) * 1000,
    y: seededEnvironmentValue(seed, 101 + index * 3) * 1000,
    radius: 0.7 + seededEnvironmentValue(seed, 102 + index * 3) * 1.2,
  }))
  return (
    <Svg width="100%" height="100%" viewBox="0 0 1000 1000" preserveAspectRatio="none" style={[styles.fieldLayer, { opacity }]}>
      <Rect x="0" y="0" width="1000" height="1000" fill="transparent" />
      {points.map((point, index) => <Circle key={index} cx={point.x} cy={point.y} r={point.radius} fill={color} />)}
    </Svg>
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

function buildAmbientFields(colors: AppPalette, environment: BackgroundEnvironmentConfig, seed: number, opacity: number): AmbientField[] {
  const palette = [colors.background.mist.primary, colors.background.mist.secondary, colors.background.mist.warm, colors.background.trace.accent, colors.background.trace.primary, colors.background.trace.secondary]
  return Array.from({ length: environment.layerCount }, (_, index) => {
    const radiusBase = environment.kind === 'fluid' ? 310 : environment.kind === 'atmospheric' ? 360 : 470
    const opacityBase = environment.kind === 'minimal' ? 0.055 : environment.kind === 'tonal' ? 0.09 : environment.kind === 'fluid' ? 0.17 : 0.14
    const radiusJitter = seededEnvironmentValue(seed, index * 9 + 3)
    return {
      id: `ambient-${seed}-${index}`,
      color: palette[index % palette.length],
      x: -80 + seededEnvironmentValue(seed, index * 9) * 1160,
      y: -60 + seededEnvironmentValue(seed, index * 9 + 1) * 1120,
      radiusX: radiusBase + radiusJitter * 180,
      radiusY: radiusBase * (0.62 + seededEnvironmentValue(seed, index * 9 + 4) * 0.46),
      opacity: opacityBase * opacity * (0.74 + seededEnvironmentValue(seed, index * 9 + 5) * 0.36),
      driftX: 18 + seededEnvironmentValue(seed, index * 9 + 6) * 34,
      driftY: 12 + seededEnvironmentValue(seed, index * 9 + 7) * 27,
      scale: 0.014 + seededEnvironmentValue(seed, index * 9 + 8) * 0.032,
      duration: environment.cycleMs * (0.78 + seededEnvironmentValue(seed, index * 9 + 2) * 0.68),
      delay: index * 840,
    }
  })
}

function backgroundProfile(colors: AppPalette, mode: ThemeBackgroundMode, state: IsleBackgroundState, intensity: number, visualIntensity: number) {
  const normalizedIntensity = Math.max(0, Math.min(1.2, intensity))
  const modeScale = mode === 'ambient' ? 1 : mode === 'focus' ? 0.66 : mode === 'surface' ? 0.5 : 0.36
  const stateScale = state === 'active' ? 1.08 : state === 'error' ? 0.78 : state === 'input' ? 0.58 : state === 'modal' ? 0.38 : 1
  const canvas = mode === 'focus' ? colors.background.focusCanvas : mode === 'surface' ? colors.background.surfaceCanvas : colors.background.canvas
  return {
    canvas,
    stateScale,
    environmentOpacity: normalizedIntensity * modeScale * stateScale * visualIntensity,
    scrimOpacity: state === 'modal' ? 0.12 : state === 'input' ? 0.07 : state === 'error' ? 0.08 : 0.025,
  }
}

function useAppActive(): boolean {
  const [state, setState] = useState<AppStateStatus>(AppState.currentState)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', setState)
    return () => subscription.remove()
  }, [])
  return state === 'active'
}

function useEnvironmentVariationEpoch(variation: BackgroundEnvironmentConfig['variation']): string | number {
  const [epoch, setEpoch] = useState(() => variationEpoch(variation))
  useEffect(() => {
    setEpoch(variationEpoch(variation))
    if (variation !== 'random' && variation !== 'daily') return undefined
    const interval = setInterval(() => setEpoch(variationEpoch(variation)), variation === 'random' ? 15 * 60 * 1000 : 60 * 60 * 1000)
    return () => clearInterval(interval)
  }, [variation])
  return epoch
}

function variationEpoch(variation: BackgroundEnvironmentConfig['variation']): string | number {
  if (variation === 'random') return Math.floor(Date.now() / (15 * 60 * 1000))
  if (variation === 'daily') {
    const now = new Date()
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
  }
  return 0
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  fieldLayer: { ...StyleSheet.absoluteFill },
  tonalHorizon: { position: 'absolute', right: '7%', bottom: '19%', left: '7%', height: StyleSheet.hairlineWidth, opacity: 0.22 },
})
