import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { PixelRatio, StyleSheet, View, useWindowDimensions } from 'react-native'
import { NavigationContext } from 'expo-router/react-navigation'
import { useTransparencyPreference } from '@/hooks/useTransparencyPreference'
import { useDisplayRefreshRate } from '@/hooks/useDisplayRefreshRate'
import type { AppPalette } from '@/theme/colors'
import type { BackgroundEnvironmentConfig } from '@/theme/backgroundEnvironment'
import { LiquidGlassCanvas, liquidCanvasAvailable } from './LiquidGlassCanvas'
import { liquidRasterSize, liquidUniforms } from './liquidGlassRenderer'

export interface LiquidGlassSceneProps {
  colors: AppPalette
  environment: BackgroundEnvironmentConfig
  seed: number
  animated: boolean
  opacity: number
  canvasColor?: string
  children: (animated: boolean) => ReactNode
}

/** GPU resources belong only to the visible page; text is never captured. */
export function LiquidGlassScene({ colors, environment, seed, animated, opacity, canvasColor, children }: LiquidGlassSceneProps) {
  const navigation = useContext(NavigationContext)
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true)
  const [failed, setFailed] = useState(false)
  const reduceTransparency = useTransparencyPreference()
  const { width, height } = useWindowDimensions()
  const raster = liquidRasterSize(width, height, PixelRatio.get())
  const values = useMemo(() => liquidUniforms(colors, environment.amplitude, opacity, seed, environment.cycleMs, canvasColor),
    [colors, environment.amplitude, environment.cycleMs, opacity, seed, canvasColor])
  const onError = useCallback(() => setFailed(true), [])
  const available = liquidCanvasAvailable && !failed && !reduceTransparency && focused
  useDisplayRefreshRate(animated && environment.amplitude > 0 && focused && !reduceTransparency)
  useEffect(() => {
    if (!navigation) return
    setFocused(navigation.isFocused())
    const focus = navigation.addListener('focus', () => setFocused(true))
    const blur = navigation.addListener('blur', () => setFocused(false))
    return () => { focus(); blur() }
  }, [navigation])
  const fallback = () => children(animated && focused && !reduceTransparency)
  return <View testID="liquid-glass-scene" pointerEvents="none" style={StyleSheet.absoluteFill}>
    {available ? <ReadyScene key={`${width}:${height}`} values={values} animated={animated && environment.amplitude > 0}
      onError={onError} raster={raster} fallback={fallback} /> : fallback()}
  </View>
}

/** Readiness belongs to a single context, never to a previous route/size. */
function ReadyScene({ values, animated, onError, raster, fallback }: {
  values: ReturnType<typeof liquidUniforms>
  animated: boolean
  onError: () => void
  raster: ReturnType<typeof liquidRasterSize>
  fallback: () => ReactNode
}) {
  const [ready, setReady] = useState(false)
  const onReady = useCallback(() => setReady(true), [])
  return <>
    {!ready ? fallback() : null}
    <LiquidGlassCanvas values={values} animated={animated} onReady={onReady} onError={onError}
      style={{ position: 'absolute', width: raster.width, height: raster.height, left: 0, top: 0,
        opacity: ready ? 1 : 0, transformOrigin: 'top left', transform: [{ scale: 1 / raster.scale }] }} />
  </>
}
