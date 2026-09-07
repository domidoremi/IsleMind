import { forwardRef, useContext, useRef, useState, useCallback, type ReactNode, type RefObject } from 'react'
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { BlurTargetView, BlurView } from 'expo-blur'
import { createContext } from 'react'

/**
 * Single shared blur pipeline for the Liquid Glass family.
 *
 * Architecture:
 *  - `GlassBackdropProvider` owns ONE `BlurTargetView` (Android) wrapping the
 *    message list only — BlurViews must never overlap that target, because
 *    dine/Dimezis BlurView walks the target's render tree on every frame and
 *    a BlurView inside its own source produces a render cycle that overflows
 *    the stack on the RenderThread (SIGSEGV in libhwui prepareTreeImpl).
 *  - `GlassSurface` renders an `expo-blur` `BlurView` bound to that target
 *    (`dimezisBlurViewSdk31Plus` on Android API 31+, window sampling on iOS).
 *    The BlurView is absolutely filled at the BOTTOM of the surface; all
 *    foreground content renders crisp above it.
 *  - `enabled={false}` keeps the wrapper mounted (stable tree, no remount of
 *    children) but renders no BlurView at all.
 *
 * On Android < 12 (API < 31) BlurView falls back and the tint alone keeps
 * legibility.
 */

export interface GlassBackdropContextValue {
  blurTargetRef: RefObject<View | null>
  /** Explicit platform/material capability contract used by every glass surface. */
  capability: GlassCapabilityContract
  /** Compatibility shorthand for older consumers. */
  realtimeBlurSupported: boolean
}

export interface GlassCapabilityContract {
  platform: string
  /** Whether a realtime BlurView may be mounted safely. */
  realtimeBlurSupported: boolean
  /** Whether a BlurTargetView can be used as the sampled backdrop. */
  targetedBackdropSupported: boolean
  /** Hard budget for concurrent blur layers in one region. */
  maxLayersPerRegion: number
  /** Stable visual fallback when realtime blur is unavailable. */
  fallback: 'opaque' | 'tonal'
}

/**
 * Resolve capabilities in one place instead of letting each component infer
 * platform/version support. Unknown platforms fail closed; iOS and Web use
 * window sampling, while Android requires the SDK 31 target pipeline.
 */
export function resolveGlassCapability(platform: string, version?: unknown): GlassCapabilityContract {
  const normalizedPlatform = typeof platform === 'string' ? platform.toLowerCase() : 'unknown'
  const androidApi = typeof version === 'number'
    ? version
    : typeof version === 'string' && /^\d+$/.test(version)
      ? Number.parseInt(version, 10)
      : 0
  const isAndroid = normalizedPlatform === 'android'
  const isKnownWindowSamplingPlatform = normalizedPlatform === 'ios' || normalizedPlatform === 'web'
  const targetedBackdropSupported = isAndroid && androidApi >= 31
  const realtimeBlurSupported = targetedBackdropSupported || isKnownWindowSamplingPlatform
  return {
    platform: normalizedPlatform,
    realtimeBlurSupported,
    targetedBackdropSupported,
    maxLayersPerRegion: realtimeBlurSupported ? 1 : 0,
    fallback: 'opaque',
  }
}

const GlassBackdropContext = createContext<GlassBackdropContextValue>({
  blurTargetRef: { current: null },
  capability: {
    platform: 'unknown',
    realtimeBlurSupported: false,
    targetedBackdropSupported: false,
    maxLayersPerRegion: 0,
    fallback: 'opaque',
  },
  realtimeBlurSupported: false,
})

export function useGlassBackdrop(): GlassBackdropContextValue {
  return useContext(GlassBackdropContext)
}

const IS_ANDROID = Platform.OS === 'android'
const GLASS_CAPABILITY = resolveGlassCapability(Platform.OS, Platform.Version)

export function GlassBackdropProvider({ children }: { children: ReactNode }) {
  const blurTargetRef = useRef<View>(null)
  const { realtimeBlurSupported } = GLASS_CAPABILITY
  return (
    <GlassBackdropContext.Provider value={{ capability: GLASS_CAPABILITY, blurTargetRef, realtimeBlurSupported }}>
      {children}
    </GlassBackdropContext.Provider>
  )
}

interface GlassBackdropTargetProps {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}

/**
 * Marks the content sampled as the blurred backdrop (the message list).
 * Android SDK 31+: expo-blur BlurTargetView; elsewhere a plain View.
 * Must contain NO GlassSurface/BlurView descendants.
 */
export function GlassBackdropTarget({ children, style }: GlassBackdropTargetProps) {
  const { blurTargetRef, capability } = useGlassBackdrop()
  if (!capability.targetedBackdropSupported) {
    return <View style={style}>{children}</View>
  }
  return (
    <BlurTargetView ref={blurTargetRef as never} style={style}>
      {children}
    </BlurTargetView>
  )
}

interface GlassSurfaceProps {
  children?: ReactNode
  style?: StyleProp<ViewStyle>
  /** Blur strength 1-100 (expo-blur intensity). Overrides `variant` when set. */
  intensity?: number
  tint?: 'light' | 'dark' | 'default'
  borderRadius?: number
  /** When false, renders the stable wrapper without any BlurView. */
  enabled?: boolean
  /**
   * Tiered material variant. `chrome` (default) covers header/composer lens
   * strength; `navigation` is lighter so transient rails never read as cards;
   * `floating` is the strongest tier for popovers/sheets needing separation.
   */
  variant?: 'chrome' | 'navigation' | 'floating'
}

const VARIANT_INTENSITY: Record<NonNullable<GlassSurfaceProps['variant']>, number> = {
  chrome: 46,
  navigation: 30,
  floating: 64,
}

/**
 * A realtime-backdrop glass surface: BlurView absolutely filled at the bottom
 * of the stacking order, crisp foreground content on top. Mounts nothing
 * blur-related when disabled so non-glass themes never touch the pipeline.
 */
export const GlassSurface = forwardRef<View, GlassSurfaceProps>(function GlassSurface(
  { children, style, intensity, tint = 'default', borderRadius = 22, enabled = true, variant },
  ref,
) {
  const { blurTargetRef, capability } = useGlassBackdrop()
  const blurActive = enabled && capability.realtimeBlurSupported
  const resolvedIntensity = intensity ?? (variant ? VARIANT_INTENSITY[variant] : 30)
  return (
    <View ref={ref} style={[enabled ? { borderRadius } : null, style]}>
      {blurActive ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }]}>
          <BlurView
            pointerEvents="none"
            intensity={resolvedIntensity}
            tint={tint}
            {...(IS_ANDROID
              ? {
                  blurMethod: 'dimezisBlurViewSdk31Plus',
                  blurTarget: blurTargetRef,
                }
              : {})}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : null}
      {children}
    </View>
  )
})
