import { StyleSheet, View } from 'react-native'
import { MotiView } from 'moti'
import Svg, { Path, Rect } from 'react-native-svg'
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
    // Material's tonal roles are structural, so they remain visible even when
    // the decorative color channels are intentionally quiet.
    const tonalOpacity = colors.design?.family === 'material'
      ? state === 'modal' ? 0.34 : 0.26
      : Math.min(0.34, profile.traceOpacity * 0.52 + profile.coolOpacity * 0.22)
    return (
      <View pointerEvents="none" testID="theme-background-tonal" style={styles.backdrop}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: profile.canvas }]} />
        <TonalHierarchyField
          primary={colors.background.mist.primary}
          secondary={colors.background.mist.secondary}
          accent={colors.background.trace.accent}
          grid={colors.background.grid}
          opacity={tonalOpacity}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background.scrim, opacity: profile.scrimOpacity * 0.42 }]} />
      </View>
    )
  }

  if (experienceBackground === 'glass') {
    return (
      <View pointerEvents="none" testID="theme-background-glass" style={styles.backdrop}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: profile.canvas }]} />
        <GlassDepthPlaneField
          primary={colors.background.mist.primary}
          secondary={colors.background.mist.secondary}
          accent={colors.background.trace.accent}
          opacity={Math.min(0.46, profile.coolOpacity * 2.8 + profile.warmOpacity * 1.6 + profile.traceOpacity * 1.4)}
        />
        <GlassEnvironmentField
          enabled={animated}
          opacity={Math.min(0.72, profile.coolOpacity * 1.18 + profile.warmOpacity * 0.64)}
          primary={colors.background.mist.primary}
          secondary={colors.background.mist.secondary}
          accent={colors.background.trace.accent}
          edge={colors.background.trace.primary}
          motionScale={profile.motionScale}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background.scrim, opacity: profile.scrimOpacity * 0.34 }]} />
      </View>
    )
  }

  return (
    <View pointerEvents="none" testID="theme-background-road" style={styles.backdrop}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: profile.canvas }]} />
      <AmbientMistField
        enabled={animated}
        delay={0}
        opacity={Math.min(0.38, profile.coolOpacity * 1.24 + profile.warmOpacity * 0.36)}
        primary={colors.background.mist.primary}
        secondary={colors.background.mist.secondary}
        from={{ translateX: -18, translateY: -8 }}
        animate={{ translateX: 18 * profile.motionScale, translateY: 10 * profile.motionScale }}
      />
      <AmbientTraceField
        enabled={animated}
        delay={motionTokens.duration.normal}
        opacity={Math.min(0.22, profile.traceOpacity * 1.18 + profile.warmOpacity * 0.2)}
        primary={colors.background.trace.primary}
        secondary={colors.background.trace.secondary}
        accent={profile.traceAccent}
        grid={colors.background.grid}
        motionScale={profile.motionScale}
        showGrid={resolvedMode === 'surface' || state === 'modal'}
      />
      <MonetPaperPlaneField
        enabled={animated}
        opacity={Math.min(0.28, profile.coolOpacity * 1.42 + profile.warmOpacity * 0.88 + profile.traceOpacity * 0.72)}
        primary={colors.background.mist.primary}
        secondary={colors.background.mist.secondary}
        warm={colors.background.trace.accent}
        motionScale={profile.motionScale}
      />
      <LimeRoadEditorialField
        enabled={animated}
        opacity={Math.min(0.34, profile.traceOpacity * 1.08 + profile.warmOpacity * 0.28)}
        primary={colors.background.trace.primary}
        secondary={colors.background.trace.secondary}
        accent={profile.traceAccent}
        paper={colors.ui.semantic.surface.base}
        motionScale={profile.motionScale}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background.scrim, opacity: profile.scrimOpacity * 0.58 }]} />
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
      <View style={[styles.tonalTopBand, { backgroundColor: primary }]} />
      <View style={[styles.tonalNavigationRail, { backgroundColor: secondary }]} />
      <View style={[styles.tonalWorkSurface, { backgroundColor: primary, borderColor: grid }]} />
      <View style={[styles.tonalDock, { backgroundColor: accent }]} />
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
      <Path d="M-118 92C6 -18 132 108 242 40C344 -24 426 12 520 -58" stroke={primary} strokeWidth="214" strokeLinecap="round" fill="none" opacity={0.58} />
      <Path d="M-146 744C-8 604 104 760 232 642C326 556 414 602 516 512" stroke={secondary} strokeWidth="188" strokeLinecap="round" fill="none" opacity={0.54} />
      <Path d="M-82 434C34 330 126 442 224 340C304 258 384 284 476 222" stroke={accent} strokeWidth="92" strokeLinecap="round" fill="none" opacity={0.22} />
      <Path d="M-30 244C82 168 154 232 236 152C300 90 350 88 430 38" stroke={edge} strokeWidth="3" fill="none" opacity={0.62} />
      <Path d="M-34 252C78 176 152 240 240 158C302 100 352 96 432 46" stroke={secondary} strokeWidth="1" fill="none" opacity={0.54} />
      <Path d="M-24 548C90 456 174 566 278 452C330 394 380 384 444 330" stroke={edge} strokeWidth="4" fill="none" opacity={0.42} />
      <Path d="M62 62L390 248L390 332L-18 102Z" fill={secondary} opacity={0.08} />
      <Path d="M0 686L312 490L390 544L62 754Z" fill={primary} opacity={0.09} />
    </Svg>
  )

  if (!enabled) return <View style={[styles.fieldLayer, { opacity }]}>{field}</View>

  return (
    <MotiView
      from={{ opacity: opacity * 0.84, translateX: -7 * motionScale, translateY: 3 * motionScale, scale: 1.004 }}
      animate={{ opacity, translateX: 7 * motionScale, translateY: -3 * motionScale, scale: 1.012 }}
      transition={{ loop: true, type: 'timing', duration: motionTokens.duration.ambient * 2.8 }}
      style={styles.fieldLayer}
    >
      {field}
    </MotiView>
  )
}

function GlassDepthPlaneField({
  primary,
  secondary,
  accent,
  opacity,
}: {
  primary: string
  secondary: string
  accent: string
  opacity: number
}) {
  return (
    <View style={[styles.fieldLayer, { opacity }]}>
      <View style={[styles.glassDepthTop, { backgroundColor: primary }]} />
      <View style={[styles.glassDepthDiagonal, { backgroundColor: secondary }]} />
      <View style={[styles.glassDepthBottom, { backgroundColor: accent }]} />
      <View style={[styles.glassDepthHalo, { borderColor: primary }]} />
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
      <Path d="M-70 704C18 622 84 710 170 648C254 588 330 602 466 526" stroke={primary} strokeWidth="46" strokeLinecap="round" fill="none" opacity={0.34} />
      <Path d="M-54 728C34 650 108 732 194 668C278 606 354 628 456 566" stroke={secondary} strokeWidth="17" strokeLinecap="round" fill="none" opacity={0.44} />
      <Path d="M8 180C72 124 130 170 184 126C240 82 306 70 416 18" stroke={secondary} strokeWidth="24" strokeLinecap="round" fill="none" opacity={0.26} />
      <Path d="M18 202C90 142 148 188 206 142C260 100 322 90 420 48" stroke={accent} strokeWidth="7" strokeLinecap="round" fill="none" opacity={0.34} />
      <Path d="M284 80C322 62 354 68 398 44L406 126C354 142 320 132 278 150Z" fill={paper} opacity={0.34} />
      <Path d="M294 94C324 82 350 86 382 72" stroke={primary} strokeWidth="5" strokeLinecap="round" opacity={0.32} />
      <Path d="M302 112C332 100 354 104 374 98" stroke={accent} strokeWidth="9" strokeLinecap="round" opacity={0.3} />
      <Path d="M22 770C74 746 126 756 190 724" stroke={accent} strokeWidth="12" strokeLinecap="round" opacity={0.28} />
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

function MonetPaperPlaneField({
  enabled,
  opacity,
  primary,
  secondary,
  warm,
  motionScale,
}: {
  enabled: boolean
  opacity: number
  primary: string
  secondary: string
  warm: string
  motionScale: number
}) {
  const field = (
    <View style={styles.fieldLayer}>
      <View style={[styles.monetPaperPlaneLarge, { backgroundColor: primary }]} />
      <View style={[styles.monetPaperPlaneSmall, { backgroundColor: secondary }]} />
      <View style={[styles.monetPaperPlaneWarm, { backgroundColor: warm }]} />
      <View style={[styles.monetPaperBrush, { backgroundColor: warm }]} />
    </View>
  )

  if (!enabled) return <View style={[styles.fieldLayer, { opacity }]}>{field}</View>

  return (
    <MotiView
      from={{ opacity: opacity * 0.78, translateX: -6 * motionScale, translateY: 3 * motionScale }}
      animate={{ opacity, translateX: 6 * motionScale, translateY: -2 * motionScale }}
      transition={{ loop: true, type: 'timing', duration: motionTokens.duration.ambient * 2.6 }}
      style={styles.fieldLayer}
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
      <Path d="M-128 72C-12 -10 88 102 188 38C286 -24 376 38 504 -42" stroke={primary} strokeWidth={178} strokeLinecap="round" fill="none" opacity={0.72} />
      <Path d="M-138 754C-6 622 96 760 214 650C314 558 398 612 516 510" stroke={secondary} strokeWidth={164} strokeLinecap="round" fill="none" opacity={0.66} />
      <Path d="M-116 390C22 274 112 394 226 298C320 218 404 270 510 180" stroke={primary} strokeWidth={82} strokeLinecap="round" fill="none" opacity={0.3} />
      <Path d="M-54 512C38 438 118 520 206 446C288 378 350 404 448 334" stroke={secondary} strokeWidth={38} strokeLinecap="round" fill="none" opacity={0.24} />
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
      {showGrid ? <Path d="M0 256C92 232 170 268 258 238C316 218 356 216 410 202 M-18 596C78 568 166 606 252 576C316 554 358 552 416 536" stroke={grid} strokeWidth="1" strokeDasharray="3 18" fill="none" opacity={0.42} /> : null}
      <Path d="M-20 214C52 164 118 214 178 162C238 110 306 126 416 54" stroke={primary} strokeWidth="8" strokeLinecap="round" fill="none" opacity={0.58} />
      <Path d="M-14 226C56 178 120 226 184 172C244 120 314 136 420 68" stroke={accent} strokeWidth="3" strokeLinecap="round" fill="none" opacity={0.46} />
      <Path d="M-28 526C48 470 120 534 190 474C256 416 320 444 430 362" stroke={secondary} strokeWidth="10" strokeLinecap="round" fill="none" opacity={0.44} />
      <Path d="M24 748C102 694 172 754 246 690C304 640 352 648 422 604" stroke={accent} strokeWidth="6" strokeLinecap="round" fill="none" opacity={0.38} />
      <Path d="M270 554C298 536 324 540 358 520L366 584C330 600 300 594 272 606Z" fill={primary} opacity={0.22} />
      <Path d="M286 570C306 558 328 560 348 550" stroke={accent} strokeWidth="6" strokeLinecap="round" opacity={0.48} />
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
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  fieldLayer: {
    ...StyleSheet.absoluteFill,
  },
  traceLayer: {
    ...StyleSheet.absoluteFill,
  },
  tonalTopBand: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    height: '17%',
    borderBottomRightRadius: 40,
  },
  tonalNavigationRail: {
    position: 'absolute',
    top: '19%',
    bottom: '15%',
    left: 0,
    width: '16%',
    borderTopRightRadius: 30,
    borderBottomRightRadius: 30,
    opacity: 0.82,
  },
  tonalWorkSurface: {
    // The conversation canvas is already the page's reading surface. Painting
    // a second rounded work plane here makes the background read as a giant
    // card behind the transcript, especially on wide screens.
    display: 'none',
  },
  tonalDock: {
    // Composer owns its own elevated surface; the background must not draw a
    // second pill beneath it and create a false layer boundary.
    display: 'none',
  },
  glassDepthTop: {
    position: 'absolute',
    top: '-12%',
    right: '-8%',
    width: '72%',
    height: '32%',
    borderBottomLeftRadius: 180,
    transform: [{ rotate: '-7deg' }],
    opacity: 0.62,
  },
  glassDepthDiagonal: {
    position: 'absolute',
    top: '34%',
    right: '-18%',
    width: '76%',
    height: '17%',
    transform: [{ rotate: '-12deg' }],
    opacity: 0.42,
  },
  glassDepthBottom: {
    position: 'absolute',
    bottom: '-8%',
    left: '-12%',
    width: '82%',
    height: '28%',
    borderTopRightRadius: 160,
    transform: [{ rotate: '8deg' }],
    opacity: 0.46,
  },
  glassDepthHalo: {
    position: 'absolute',
    top: '19%',
    right: '-14%',
    width: '42%',
    height: '42%',
    borderWidth: 2,
    borderRadius: 999,
    opacity: 0.22,
  },
  monetPaperPlaneLarge: {
    position: 'absolute',
    top: '17%',
    left: '-14%',
    width: '88%',
    height: '26%',
    borderTopRightRadius: 150,
    borderBottomRightRadius: 92,
    transform: [{ rotate: '-3deg' }],
    opacity: 0.5,
  },
  monetPaperPlaneSmall: {
    position: 'absolute',
    top: '48%',
    right: '-12%',
    width: '62%',
    height: '18%',
    borderTopLeftRadius: 112,
    borderBottomLeftRadius: 72,
    transform: [{ rotate: '4deg' }],
    opacity: 0.44,
  },
  monetPaperPlaneWarm: {
    position: 'absolute',
    bottom: '13%',
    left: '9%',
    width: '36%',
    height: '8%',
    borderTopRightRadius: 48,
    borderBottomRightRadius: 28,
    transform: [{ rotate: '-5deg' }],
    opacity: 0.48,
  },
  monetPaperBrush: {
    position: 'absolute',
    top: '23%',
    left: '11%',
    width: '30%',
    height: 3,
    borderRadius: 2,
    transform: [{ rotate: '-3deg' }],
    opacity: 0.58,
  },
})
