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
  /** Whether BlurView instances currently exist (informs target-tree safety). */
  realtimeBlurSupported: boolean
}

const GlassBackdropContext = createContext<GlassBackdropContextValue>({
  blurTargetRef: { current: null },
  realtimeBlurSupported: false,
})

export function useGlassBackdrop(): GlassBackdropContextValue {
  return useContext(GlassBackdropContext)
}

const IS_ANDROID = Platform.OS === 'android'
const API_LEVEL = IS_ANDROID && typeof Platform.Version === 'number' ? Platform.Version : 0
const SDK31_PLUS = IS_ANDROID && API_LEVEL >= 31

export function GlassBackdropProvider({ children }: { children: ReactNode }) {
  const blurTargetRef = useRef<View>(null)
  const realtimeBlurSupported = !IS_ANDROID || SDK31_PLUS
  return (
    <GlassBackdropContext.Provider value={{ blurTargetRef, realtimeBlurSupported }}>
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
  const { blurTargetRef } = useGlassBackdrop()
  if (!SDK31_PLUS) {
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
  /** Blur strength 1-100 (expo-blur intensity). */
  intensity?: number
  tint?: 'light' | 'dark' | 'default'
  borderRadius?: number
  /** When false, renders the stable wrapper without any BlurView. */
  enabled?: boolean
}

/**
 * A realtime-backdrop glass surface: BlurView absolutely filled at the bottom
 * of the stacking order, crisp foreground content on top. Mounts nothing
 * blur-related when disabled so non-glass themes never touch the pipeline.
 */
export const GlassSurface = forwardRef<View, GlassSurfaceProps>(function GlassSurface(
  { children, style, intensity = 30, tint = 'default', borderRadius = 22, enabled = true },
  ref,
) {
  const { blurTargetRef, realtimeBlurSupported } = useGlassBackdrop()
  const blurActive = enabled && realtimeBlurSupported
  return (
    <View ref={ref} style={[enabled ? { borderRadius } : null, style]}>
      {blurActive ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }]}>
          <BlurView
            pointerEvents="none"
            intensity={intensity}
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
