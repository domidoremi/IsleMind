import { createContext, forwardRef, useCallback, useContext, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Platform, StyleSheet, View, type LayoutChangeEvent, type ViewProps } from 'react-native'
import { BlurTargetView, BlurView } from 'expo-blur'
import Svg, { Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg'

import { useTransparencyPreference } from '@/hooks/useTransparencyPreference'
import type { AppPalette } from '@/theme/colors'
import { resolveThemeDesignTokens } from '@/theme/themeTokens'

export interface GlassCapabilityContract {
  platform: string
  realtimeBlurSupported: boolean
  targetedBackdropSupported: boolean
  maxLayersPerRegion: number
  fallback: 'opaque' | 'tonal'
}

export interface GlassBackdropContextValue {
  blurTargetRef: RefObject<View | null>
  capability: GlassCapabilityContract
  realtimeBlurSupported: boolean
  attachTarget: (target: View | null) => void
}

/** Unknown platforms and Android before API 31 use a readable solid material. */
export function resolveGlassCapability(platform: string, version?: unknown): GlassCapabilityContract {
  const androidApi = typeof version === 'number' ? version : typeof version === 'string' && /^\d+$/.test(version) ? Number(version) : 0
  const targetedBackdropSupported = platform === 'android' && androidApi >= 31
  const realtimeBlurSupported = targetedBackdropSupported || platform === 'ios' || platform === 'web'
  return { platform, realtimeBlurSupported, targetedBackdropSupported, maxLayersPerRegion: realtimeBlurSupported ? 1 : 0, fallback: 'opaque' }
}

const CAPABILITY = resolveGlassCapability(Platform.OS, Platform.Version)
const GlassBackdropContext = createContext<GlassBackdropContextValue>({
  blurTargetRef: { current: null },
  capability: CAPABILITY,
  realtimeBlurSupported: false,
  attachTarget: () => undefined,
})
// A target must never sample itself. Nested panels also reuse their parent's
// lens rather than blurring an already blurred region a second time.
const InsideGlassTarget = createContext(false)
const InsideGlassSurface = createContext(false)
const GlassActiveContext = createContext(true)

/** Retained pages keep their inputs/state, but not offscreen blur passes. */
export function GlassSurfaceActivity({ active, children }: { active: boolean; children: ReactNode }) {
  const parentActive = useContext(GlassActiveContext)
  return <GlassActiveContext.Provider value={parentActive && active}>{children}</GlassActiveContext.Provider>
}

export function useGlassBackdrop() {
  return useContext(GlassBackdropContext)
}

export function GlassBackdropProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const blurTargetRef = useRef<View | null>(null)
  const [targetReady, setTargetReady] = useState(false)
  const reduceTransparency = useTransparencyPreference()
  const attachTarget = useCallback((target: View | null) => {
    blurTargetRef.current = target
    setTargetReady(target !== null)
  }, [])
  const value = useMemo(() => ({
    blurTargetRef,
    capability: CAPABILITY,
    attachTarget,
    realtimeBlurSupported: enabled && !reduceTransparency && CAPABILITY.realtimeBlurSupported
      && (!CAPABILITY.targetedBackdropSupported || targetReady)
      && (Platform.OS !== 'web' || supportsWebBackdrop()),
  }), [attachTarget, enabled, reduceTransparency, targetReady])
  return <GlassBackdropContext.Provider value={value}>{children}</GlassBackdropContext.Provider>
}

/**
 * One full-screen environmental target, rendered BEFORE every glass sibling.
 * Never wrap application content here: descendant BlurViews create an Android
 * RenderThread sampling cycle. The guard below also fails closed if misused.
 */
export function GlassBackdropTarget({ children, ...props }: ViewProps) {
  const { capability, attachTarget } = useGlassBackdrop()
  const content = <InsideGlassTarget.Provider value>{children}</InsideGlassTarget.Provider>
  return capability.targetedBackdropSupported
    ? <BlurTargetView {...props} ref={attachTarget as never}>{content}</BlurTargetView>
    : <View {...props}>{content}</View>
}

export interface GlassSurfaceProps extends ViewProps {
  colors: AppPalette
  intensity?: number
  borderRadius?: number
  enabled?: boolean
  focused?: boolean
  variant?: 'chrome' | 'navigation' | 'floating'
}

const INTENSITY = { chrome: 42, navigation: 32, floating: 56 } as const

/** One material owner: clipped blur + tint + curved optics, then crisp content. */
export const GlassSurface = forwardRef<View, GlassSurfaceProps>(function GlassSurface(
  { colors, children, style, intensity, borderRadius, enabled = true, focused = false, variant = 'chrome', ...props }, ref,
) {
  const { blurTargetRef, capability, realtimeBlurSupported } = useGlassBackdrop()
  const insideTarget = useContext(InsideGlassTarget)
  const insideSurface = useContext(InsideGlassSurface)
  const active = useContext(GlassActiveContext)
  const blurActive = enabled && active && capability.realtimeBlurSupported && realtimeBlurSupported && !insideTarget && !insideSurface
  const design = colors.design ?? resolveThemeDesignTokens('liquid-glass', 'light')
  const material = variant === 'floating' ? design.semantic.surface.floating : design.semantic.surface.chrome
  const dark = design.mode === 'dark'
  const radius = borderRadius ?? design.semantic.radius.extraLarge
  const background = blurActive || insideSurface ? material.background : design.semantic.color.surface
  return (
    <View
      {...props}
      ref={ref}
      style={[
        style,
        enabled ? {
          position: 'relative',
          borderRadius: radius,
          borderCurve: 'continuous',
          backgroundColor: 'transparent',
          // Android elevation on a transparent content frame draws rectangular
          // render-node shadows. Only the outer rounded lens owns its shadow.
          elevation: 0,
          shadowOpacity: 0,
          boxShadow: insideSurface ? 'none' : `0 ${variant === 'floating' ? 8 : 5}px ${variant === 'floating' ? 26 : 18}px ${dark ? 'rgba(0, 5, 15, 0.22)' : 'rgba(29, 60, 90, 0.12)'}`,
        } : null,
      ]}
    >
      {enabled ? (
        <View
          testID="glass-material"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          collapsable={false}
          style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}
        >
          {blurActive ? <BlurView
            testID="glass-backdrop-blur"
            pointerEvents="none"
            intensity={intensity ?? INTENSITY[variant]}
            tint={dark ? 'systemUltraThinMaterialDark' : Platform.OS === 'ios' ? 'systemUltraThinMaterialLight' : 'default'}
            {...(capability.targetedBackdropSupported ? { blurMethod: 'dimezisBlurViewSdk31Plus', blurTarget: blurTargetRef } as const : {})}
            style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}
          /> : null}
          <View testID="glass-tint" style={[StyleSheet.absoluteFill, { backgroundColor: background, borderRadius: radius }]} />
          <GlassOptics colors={colors} radius={radius} focused={focused} />
        </View>
      ) : null}
      <InsideGlassSurface.Provider value={enabled || insideSurface}>{children}</InsideGlassSurface.Provider>
    </View>
  )
})

/** Gradients decay to zero inside the lens; no rectangular highlight strips. */
function GlassOptics({ colors, radius, focused }: { colors: AppPalette; radius: number; focused: boolean }) {
  const id = useId().replace(/:/g, '')
  const dark = colors.design?.mode === 'dark'
  const [size, setSize] = useState({ width: 0, height: 0 })
  const onLayout = useCallback(({ nativeEvent: { layout: { width, height } } }: LayoutChangeEvent) => {
    setSize((current) => current.width === width && current.height === height ? current : { width, height })
  }, [])
  // Android SVG caches percentage geometry when an ancestor animates its size.
  // Explicit measured geometry invalidates that cache for expanding composers,
  // rotation and multiline drafts, without remounting the input or blur target.
  return (
    <View testID="glass-optics" onLayout={onLayout} style={StyleSheet.absoluteFill}>
      {size.width > 0 && size.height > 0 ? <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`${id}-rim`} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={dark ? 0.58 : 0.96} />
            <Stop offset="28%" stopColor="#FFFFFF" stopOpacity={0.28} />
            <Stop offset="52%" stopColor={colors.primary} stopOpacity={0.07} />
            <Stop offset="78%" stopColor="#FFFFFF" stopOpacity={0.18} />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={dark ? 0.42 : 0.8} />
          </LinearGradient>
          <RadialGradient id={`${id}-light`}>
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={dark ? 0.11 : 0.3} />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`${id}-reflected`}>
            <Stop offset="0%" stopColor={colors.primary} stopOpacity={dark ? 0.1 : 0.08} />
            <Stop offset="100%" stopColor={colors.primary} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={size.width * 0.12} cy={0} rx={size.width * 0.65} ry={size.height * 0.95} fill={`url(#${id}-light)`} />
        <Ellipse cx={size.width * 0.95} cy={size.height * 1.1} rx={size.width * 0.6} ry={size.height} fill={`url(#${id}-reflected)`} />
        {/* Half the stroke is clipped at the lens boundary: a uniform inner rim
            at every size, including a multiline composer or a tall sheet. */}
        <Rect testID="glass-rim" width={size.width} height={size.height} rx={radius} fill="none" stroke={focused ? colors.ui.input.focus : `url(#${id}-rim)`} strokeWidth={focused ? 3 : 2} />
      </Svg> : null}
    </View>
  )
}

function supportsWebBackdrop() {
  const css = (globalThis as typeof globalThis & { CSS?: { supports?: (property: string, value: string) => boolean } }).CSS
  return css?.supports?.('backdrop-filter', 'blur(1px)') === true || css?.supports?.('-webkit-backdrop-filter', 'blur(1px)') === true
}
