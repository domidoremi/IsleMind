import { StyleSheet, View } from 'react-native'
import { MotiView } from 'moti'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { motionTokens } from '@/theme/animation'
import type { AppPalette, ThemeBackgroundMode } from '@/theme/colors'
import { useMotionPreference } from '@/hooks/useMotionPreference'
export type IsleBackgroundMode = 'default' | ThemeBackgroundMode | 'none'
export type IsleBackgroundState = 'idle' | 'active' | 'input' | 'modal' | 'error'

interface IsleBackgroundProps {
  colors: AppPalette
  mode?: IsleBackgroundMode
  state?: IsleBackgroundState
  intensity?: number
}

export function IsleBackground({ colors, mode = 'default', state = 'idle', intensity = 1 }: IsleBackgroundProps) {
  const resolvedMode = resolveBackgroundMode(colors, mode)
  const experienceBackground = colors.ui.experience.background
  const motion = useMotionPreference()
  if (resolvedMode === 'none' || experienceBackground === 'plain') return null

  const animated = motion === 'full'
    && colors.background.motion !== 'none'
    && (state === 'idle' || state === 'active')
  const profile = backgroundProfile(colors, resolvedMode, state, intensity)

  if (experienceBackground === 'document') {
    return (
      <View pointerEvents="none" testID="theme-background-document" style={styles.backdrop}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: profile.canvas }]} />
        <DocumentField
          primary={colors.background.trace.primary}
          secondary={colors.background.trace.secondary}
          grid={colors.background.grid}
          opacity={profile.traceOpacity}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background.scrim, opacity: profile.scrimOpacity * 0.48 }]} />
      </View>
    )
  }

  if (experienceBackground === 'tonal') {
    return (
      <View pointerEvents="none" testID="theme-background-tonal" style={styles.backdrop}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: profile.canvas }]} />
        <TonalHierarchyField
          primary={colors.background.mist.primary}
          secondary={colors.background.mist.secondary}
          accent={colors.background.trace.accent}
          grid={colors.background.grid}
          opacity={Math.min(0.56, profile.traceOpacity * 0.76 + profile.coolOpacity * 0.34)}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background.scrim, opacity: profile.scrimOpacity * 0.42 }]} />
      </View>
    )
  }

  if (experienceBackground === 'glass') {
    return (
      <View pointerEvents="none" testID="theme-background-glass" style={styles.backdrop}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: profile.canvas }]} />
        <GlassEnvironmentField
          enabled={animated}
          opacity={Math.min(0.82, profile.coolOpacity + profile.warmOpacity * 0.58)}
          primary={colors.background.mist.primary}
          secondary={colors.background.mist.secondary}
          accent={colors.background.trace.accent}
          edge={colors.background.trace.primary}
          motionScale={profile.motionScale}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background.scrim, opacity: profile.scrimOpacity * 0.52 }]} />
      </View>
    )
  }

  return (
    <View pointerEvents="none" testID="theme-background-road" style={styles.backdrop}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: profile.canvas }]} />
      <AmbientMistField
        enabled={animated}
        delay={0}
        opacity={profile.coolOpacity}
        primary={colors.background.mist.primary}
        secondary={colors.background.mist.secondary}
        from={{ translateX: -18, translateY: -8 }}
        animate={{ translateX: 18 * profile.motionScale, translateY: 10 * profile.motionScale }}
      />
      <AmbientMistField
        enabled={animated}
        delay={motionTokens.duration.fast}
        opacity={profile.warmOpacity}
        primary={colors.background.mist.warm}
        secondary={colors.background.mist.primary}
        from={{ translateX: 16, translateY: 12 }}
        animate={{ translateX: -16 * profile.motionScale, translateY: -6 * profile.motionScale }}
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
      <LimeRoadEditorialField
        enabled={animated}
        opacity={Math.min(0.92, profile.traceOpacity * 1.18)}
        primary={colors.background.trace.primary}
        secondary={colors.background.trace.secondary}
        accent={profile.traceAccent}
        paper={colors.ui.semantic.surface.base}
        motionScale={profile.motionScale}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background.scrim, opacity: profile.scrimOpacity }]} />
    </View>
  )
}

function TonalHierarchyField({
  primary,
  secondary,
  accent,
  grid,
  opacity,
}: {
  primary: string
  secondary: string
  accent: string
  grid: string
  opacity: number
}) {
  return (
    <View style={[styles.fieldLayer, { opacity }]}>
      <View style={[styles.tonalPlane, styles.tonalPlanePrimary, { backgroundColor: primary }]} />
      <View style={[styles.tonalPlane, styles.tonalPlaneSecondary, { backgroundColor: secondary }]} />
      <View style={[styles.tonalPlane, styles.tonalPlaneAccent, { backgroundColor: accent }]} />
      <View style={[styles.tonalGrid, { borderColor: grid }]} />
    </View>
  )
}

function GlassEnvironmentField({
  enabled,
  opacity,
  primary,
  secondary,
  accent,
  edge,
  motionScale,
}: {
  enabled: boolean
  opacity: number
  primary: string
  secondary: string
  accent: string
  edge: string
  motionScale: number
}) {
  const field = (
    <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="none">
      <Path d="M-84 118C58 32 136 126 246 68C318 30 372 16 474 42" stroke={primary} strokeWidth="164" strokeLinecap="round" fill="none" opacity={0.5} />
      <Path d="M-92 712C44 626 148 720 246 650C326 594 384 574 480 608" stroke={secondary} strokeWidth="142" strokeLinecap="round" fill="none" opacity={0.46} />
      <Path d="M32 260C104 208 168 226 230 180C286 140 330 134 378 102" stroke={edge} strokeWidth="2" fill="none" opacity={0.52} />
      <Path d="M-20 510C96 448 168 516 270 442C318 406 358 396 420 362" stroke={accent} strokeWidth="3" fill="none" opacity={0.34} />
      <Circle cx="294" cy="174" r="34" fill={secondary} opacity={0.18} />
      <Circle cx="72" cy="612" r="46" fill={primary} opacity={0.16} />
    </Svg>
  )

  if (!enabled) return <View style={[styles.fieldLayer, { opacity }]}>{field}</View>

  return (
    <MotiView
      from={{ opacity: opacity * 0.82, translateX: -4 * motionScale, translateY: 2 * motionScale, scale: 1 }}
      animate={{ opacity, translateX: 4 * motionScale, translateY: -2 * motionScale, scale: 1.006 }}
      transition={{ loop: true, type: 'timing', duration: motionTokens.duration.ambient * 2.8 }}
      style={styles.fieldLayer}
    >
      {field}
    </MotiView>
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
    traceAccent: state === 'error' ? colors.ui.tone.danger.foreground : colors.background.trace.accent,
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

function DocumentField({
  primary,
  secondary,
  grid,
  opacity,
}: {
  primary: string
  secondary: string
  grid: string
  opacity: number
}) {
  return (
    <View style={[styles.traceLayer, { opacity: Math.max(0.22, opacity * 0.74) }]}>
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="none">
        <Path d="M44 0V844 M58 0V844" stroke={primary} strokeWidth="1" opacity={0.36} />
        <Path d="M78 112H370 M78 148H340 M78 184H358 M78 256H370 M78 292H326 M78 328H350 M78 400H370 M78 436H310 M78 472H358 M78 544H370 M78 580H334 M78 616H360 M78 688H370 M78 724H322" stroke={grid} strokeWidth="1" opacity={0.62} />
        <Path d="M78 220H218 M78 364H274 M78 508H238 M78 652H286" stroke={secondary} strokeWidth="2" opacity={0.28} />
        <Rect x="25" y="102" width="6" height="6" fill={secondary} opacity={0.52} />
        <Rect x="25" y="246" width="6" height="6" fill={secondary} opacity={0.38} />
        <Rect x="25" y="390" width="6" height="6" fill={secondary} opacity={0.46} />
        <Rect x="25" y="534" width="6" height="6" fill={secondary} opacity={0.34} />
      </Svg>
    </View>
  )
}

function LimeRoadEditorialField({
  enabled,
  opacity,
  primary,
  secondary,
  accent,
  paper,
  motionScale,
}: {
  enabled: boolean
  opacity: number
  primary: string
  secondary: string
  accent: string
  paper: string
  motionScale: number
}) {
  const field = (
    <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="none">
      <Path d="M-32 654C58 618 112 680 194 646C262 618 310 584 430 620" stroke={primary} strokeWidth="7" fill="none" opacity={0.72} />
      <Path d="M-24 672C60 640 120 696 202 662C276 632 324 604 424 638" stroke={secondary} strokeWidth="2" strokeDasharray="8 13" fill="none" opacity={0.72} />
      <Circle cx="92" cy="650" r="8" fill={paper} stroke={primary} strokeWidth="4" />
      <Circle cx="302" cy="617" r="10" fill={accent} stroke={primary} strokeWidth="3" />
      <Path d="M306 108H372 M306 116H352" stroke={primary} strokeWidth="3" opacity={0.42} />
      <Rect x="266" y="72" width="96" height="56" rx="3" fill={paper} stroke={primary} strokeWidth="2" opacity={0.72} transform="rotate(-5 266 72)" />
      <Circle cx="284" cy="94" r="7" fill={accent} opacity={0.92} />
      <Path d="M38 188C84 164 126 176 164 146C202 116 230 104 270 98" stroke={secondary} strokeWidth="3" strokeDasharray="3 12" strokeLinecap="round" fill="none" opacity={0.48} />
      <Path d="M44 738H174" stroke={primary} strokeWidth="3" opacity={0.36} />
      <Rect x="44" y="730" width="22" height="16" fill={accent} opacity={0.84} />
    </Svg>
  )

  if (!enabled) {
    return <View style={[styles.traceLayer, { opacity }]}>{field}</View>
  }

  return (
    <MotiView
      from={{ opacity: opacity * 0.72, translateX: -8 * motionScale, translateY: 2 }}
      animate={{ opacity, translateX: 8 * motionScale, translateY: -3 }}
      transition={{ loop: true, type: 'timing', duration: motionTokens.duration.ambient * 2.1 }}
      style={styles.traceLayer}
    >
      {field}
    </MotiView>
  )
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
  from: { translateX: number; translateY: number }
  animate: { translateX: number; translateY: number }
}) {
  const mist = (
    <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="none">
      <Path d="M-92 74C24 36 96 98 192 68C286 39 330 -18 476 14" stroke={primary} strokeWidth={148} strokeLinecap="round" fill="none" />
      <Path d="M-112 686C12 608 118 674 220 614C308 562 356 502 500 530" stroke={secondary} strokeWidth={136} strokeLinecap="round" fill="none" />
      <Path d="M-88 354C48 284 120 318 230 286C332 256 396 206 492 238" stroke={primary} strokeWidth={64} strokeLinecap="round" fill="none" opacity={0.46} />
    </Svg>
  )

  if (!enabled) {
    return <View style={[styles.fieldLayer, { opacity }]}>{mist}</View>
  }

  return (
    <MotiView
      from={from}
      animate={animate}
      transition={{ loop: true, type: 'timing', duration: motionTokens.duration.ambient * 2.4, delay }}
      style={[styles.fieldLayer, { opacity }]}
    >
      {mist}
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
  const trace = (
    <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="none">
      {showGrid ? <Rect x="0" y="0" width="390" height="844" fill="none" stroke={grid} strokeWidth="1" strokeDasharray="1 34" opacity={0.64} /> : null}
      <Path d="M18 206C82 176 134 194 188 158C246 120 308 110 372 82" stroke={primary} strokeWidth={3} strokeLinecap="round" strokeDasharray="2 13" fill="none" opacity={0.74} />
      <Circle cx="18" cy="206" r="7" fill={accent} stroke={primary} strokeWidth={3} />
      <Path d="M-10 526C58 498 126 534 186 492C248 448 294 452 404 386" stroke={secondary} strokeWidth={2.2} strokeLinecap="round" fill="none" opacity={0.56} />
      <Path d="M40 742C122 704 174 736 250 682C302 646 336 632 402 624" stroke={accent} strokeWidth={2} strokeLinecap="round" strokeDasharray="4 11" fill="none" opacity={0.52} />
      <Rect x="276" y="548" width="76" height="48" rx="3" fill="none" stroke={primary} strokeWidth="2" opacity={0.5} transform="rotate(-6 276 548)" />
      <Circle cx="292" cy="571" r="6" fill={accent} opacity={0.72} />
      <Path d="M326 568 A16 16 0 0 1 342 584 M326 568 A16 16 0 0 0 342 552" stroke={secondary} strokeWidth="3" fill="none" opacity={0.72} />
    </Svg>
  )

  if (!enabled) {
    return <View style={[styles.traceLayer, { opacity: opacity * 0.76 }]}>{trace}</View>
  }

  return (
    <MotiView
      from={{ opacity: opacity * 0.72, translateX: -drift, translateY: 0 }}
      animate={{ opacity, translateX: drift, translateY: -6 * motionScale }}
      transition={{ loop: true, type: 'timing', duration: motionTokens.duration.ambient * 1.8, delay }}
      style={styles.traceLayer}
    >
      {trace}
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
    overflow: 'hidden',
  },
  fieldLayer: {
    ...StyleSheet.absoluteFill,
  },
  traceLayer: {
    ...StyleSheet.absoluteFill,
  },
  tonalPlane: {
    position: 'absolute',
    borderRadius: 56,
  },
  tonalPlanePrimary: {
    top: '8%',
    left: '-18%',
    width: '76%',
    height: '27%',
  },
  tonalPlaneSecondary: {
    top: '34%',
    right: '-22%',
    width: '78%',
    height: '31%',
  },
  tonalPlaneAccent: {
    bottom: '4%',
    left: '12%',
    width: '76%',
    height: '20%',
  },
  tonalGrid: {
    position: 'absolute',
    top: '16%',
    right: '9%',
    width: '36%',
    height: '26%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    opacity: 0.42,
  },
})
