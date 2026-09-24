import { memo, useEffect, useId } from 'react'
import { PixelRatio, Platform, StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native'
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg'

import { LiquidGlassScene, type LiquidGlassSceneProps } from './LiquidGlassScene'

// The scene owns its inputs; the backdrop supplies the fallback renderer.
export type FluidBackdropProps = Omit<LiquidGlassSceneProps, 'children'>

/** Soft light fields need no screen-density bitmap; text and glass stay sharp. */
export function resolveFluidArtworkScale(platform: string, width: number, height: number, pixelRatio: number) {
  const longestPixelEdge = Math.max(width, height) * pixelRatio
  return platform === 'android' && longestPixelEdge > 1024 ? 1024 / longestPixelEdge : 1
}

export const FluidBackdrop = memo(function FluidBackdrop(props: FluidBackdropProps) {
  return <LiquidGlassScene {...props}>{(animated) => <SoftFluidBackdrop {...props} animated={animated} />}</LiquidGlassScene>
})

/** The bounded SVG material remains the fallback for unavailable/lost GPUs. */
function SoftFluidBackdrop({ colors, environment, seed, animated, opacity }: FluidBackdropProps) {
  const phase = useSharedValue(0)
  const id = useId().replace(/:/g, '')
  const { width, height } = useWindowDimensions()
  // SVG viewports clip their artwork before the parent transform. Overscan
  // keeps those rectangular edges outside the screen even during rotation.
  const bleedX = 120 + height * 0.12
  const bleedY = 150 + width * 0.12
  const layer = { position: 'absolute' as const, top: -bleedY, bottom: -bleedY, left: -bleedX, right: -bleedX }
  const viewBox = `${-bleedX / width * 1000} ${-bleedY / height * 1000} ${1000 + bleedX / width * 2000} ${1000 + bleedY / height * 2000}`
  const dark = environment.mode === 'dark'
  const amplitude = environment.amplitude
  const offset = (seed % 360) * Math.PI / 180
  // Follow every display VSync, including 90/120/144 Hz. Keep the artwork cheap
  // to render instead of quantizing the phase or skipping animation frames.
  // Android SVGs are bitmap-backed. Overscanned screen-density fields can
  // exceed the texture cache. Bound only the soft artwork's raster size, then
  // scale it back to the same visual bounds.
  const artworkScale = resolveFluidArtworkScale(Platform.OS, width + bleedX * 2, height + bleedY * 2, PixelRatio.get())
  const artworkSize = `${artworkScale * 100}%` as const
  const artworkStyle: ViewStyle = {
    width: artworkSize, height: artworkSize,
    ...(artworkScale < 1 ? { transformOrigin: 'top left', transform: [{ scale: 1 / artworkScale }] } : {}),
  }

  useEffect(() => {
    if (animated && amplitude > 0) {
      // A complete orbit has identical endpoints. Resume from the frozen
      // position rather than snapping back after keyboard/app-state changes.
      phase.value = withRepeat(withTiming(phase.value + 1, { duration: environment.cycleMs, easing: Easing.linear }), -1, false)
    }
    return () => cancelAnimation(phase)
  }, [amplitude, animated, environment.cycleMs, phase])

  const nearStyle = useAnimatedStyle(() => {
    const angle = phase.value * Math.PI * 2 + offset
    return { transform: [
      { translateX: Math.sin(angle) * 100 * amplitude },
      { translateY: Math.cos(angle) * 90 * amplitude },
      { rotate: `${Math.sin(angle) * 12 * amplitude}deg` },
      { scale: 1.12 + Math.cos(angle) * 0.08 * amplitude },
    ] }
  })
  const farStyle = useAnimatedStyle(() => {
    const angle = phase.value * Math.PI * 2 + offset + Math.PI * 0.7
    return { transform: [
      { translateX: Math.cos(angle) * 110 * amplitude },
      { translateY: Math.sin(angle) * 130 * amplitude },
      { rotate: `${Math.cos(angle) * 9 * amplitude}deg` },
      { scale: 1.14 + Math.sin(angle) * 0.09 * amplitude },
    ] }
  })
  const causticStyle = useAnimatedStyle(() => {
    const angle = phase.value * Math.PI * 2 + offset
    return { opacity: 0.64 + Math.sin(angle) * 0.16 * amplitude, transform: [
      { translateX: Math.cos(angle) * 65 * amplitude },
      { translateY: Math.sin(angle) * 95 * amplitude },
      { rotate: `${Math.sin(angle) * -7 * amplitude}deg` },
      { scale: 1.1 },
    ] }
  })
  return (
    <View testID="liquid-flow-environment" pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: Math.min(1, opacity) }]}>
      <Animated.View testID="liquid-flow-near" collapsable={false} style={[layer, nearStyle]}>
        <View testID="liquid-flow-near-raster" collapsable={false} style={artworkStyle}>
          <Svg width="100%" height="100%" viewBox={viewBox} preserveAspectRatio="none">
            <Defs>
              <RadialGradient id={`${id}-cool`}>
                <Stop offset="0%" stopColor={colors.primary} stopOpacity={dark ? 0.46 : 0.34} />
                <Stop offset="40%" stopColor={colors.primary} stopOpacity={dark ? 0.23 : 0.18} />
                <Stop offset="100%" stopColor={colors.primary} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Ellipse cx="120" cy="100" rx="740" ry="680" fill={`url(#${id}-cool)`} />
            <Ellipse cx="900" cy="970" rx="650" ry="590" fill={`url(#${id}-cool)`} />
          </Svg>
        </View>
      </Animated.View>
      <Animated.View testID="liquid-flow-far" collapsable={false} style={[layer, farStyle]}>
        <View testID="liquid-flow-far-raster" collapsable={false} style={artworkStyle}>
          <Svg width="100%" height="100%" viewBox={viewBox} preserveAspectRatio="none">
            <Defs>
              <RadialGradient id={`${id}-warm`}>
                <Stop offset="0%" stopColor={colors.tertiary} stopOpacity={dark ? 0.24 : 0.2} />
                <Stop offset="45%" stopColor={colors.tertiary} stopOpacity={0.1} />
                <Stop offset="100%" stopColor={colors.tertiary} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Ellipse cx="960" cy="270" rx="670" ry="530" fill={`url(#${id}-warm)`} />
            <Ellipse cx="-80" cy="800" rx="610" ry="520" fill={`url(#${id}-warm)`} />
          </Svg>
        </View>
      </Animated.View>
      <Animated.View testID="liquid-flow-caustic" collapsable={false} style={[layer, causticStyle]}>
        <View testID="liquid-flow-caustic-raster" collapsable={false} style={artworkStyle}>
          <Svg width="100%" height="100%" viewBox={viewBox} preserveAspectRatio="none">
            <Defs>
              <RadialGradient id={`${id}-ribbon`}>
                <Stop offset="0%" stopColor={colors.primary} stopOpacity={0} />
                <Stop offset="68%" stopColor={colors.primary} stopOpacity={0} />
                <Stop offset="80%" stopColor={dark ? colors.primary : '#FFFFFF'} stopOpacity={dark ? 0.14 : 0.38} />
                <Stop offset="88%" stopColor={colors.primary} stopOpacity={dark ? 0.05 : 0.07} />
                <Stop offset="100%" stopColor={colors.primary} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            {/* A continuous radial falloff has no band edges or stroke end caps. */}
            <Ellipse cx="-360" cy="240" rx="1120" ry="970" fill={`url(#${id}-ribbon)`} />
          </Svg>
        </View>
      </Animated.View>
    </View>
  )
}
