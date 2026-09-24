import { useCallback, useEffect } from 'react'
import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { runOnJS, runOnUI, useFrameCallback, useSharedValue } from 'react-native-reanimated'
import type { ExpoWebGLRenderingContext } from 'expo-gl'
import { createLiquidRenderer, disposeLiquidRenderer, drawLiquidFrame, type LiquidCanvasProps, type LiquidRenderer } from './liquidGlassRenderer'

// Older installed binaries and Android < 31 keep the existing SVG material.
// Do not evaluate expo-gl's required native import until its module exists.
export const liquidCanvasAvailable = (Platform.OS === 'ios' || Platform.OS === 'android' && Number(Platform.Version) >= 31)
  && !!requireOptionalNativeModule('ExpoGL')
const nativeGL: typeof import('expo-gl') | null = liquidCanvasAvailable ? require('expo-gl') : null
const getWorkletGL = nativeGL?.getWorkletContext
type SceneContext = ExpoWebGLRenderingContext & { isleLiquidRenderer?: LiquidRenderer }

function getSceneContext(id: number) {
  'worklet'
  if (!id) return undefined
  return getWorkletGL?.(id) as SceneContext | undefined
}

function releaseContext(id: number) {
  'worklet'
  // GLView may already have destroyed its native context during unmount.
  try {
    const gl = getSceneContext(id)
    if (gl?.isleLiquidRenderer) {
      disposeLiquidRenderer(gl, gl.isleLiquidRenderer)
      delete gl.isleLiquidRenderer
    }
  } catch { /* Native context destruction owns the remaining resources. */ }
}

/** One native UI-thread clock submits one full-screen draw per display VSync. */
export function LiquidGlassCanvas({ values, animated, style, onReady, onError }: LiquidCanvasProps) {
  const contextId = useSharedValue(0)
  const mounted = useSharedValue(true)
  const uniforms = useSharedValue(values)
  const phase = useSharedValue(0)
  const frame = useFrameCallback(({ timeSincePreviousFrame }) => {
    if (!mounted.value || !contextId.value) return
    try {
      const gl = getSceneContext(contextId.value)
      if (!gl?.isleLiquidRenderer) throw new Error('Liquid glass context lost')
      phase.value = (phase.value + Math.min(100, Math.max(0, timeSincePreviousFrame ?? 0)) / uniforms.value.cycleMs) % 1
      drawLiquidFrame(gl, gl.isleLiquidRenderer, uniforms.value, phase.value)
    } catch {
      releaseContext(contextId.value)
      contextId.value = 0
      runOnJS(onError)()
    }
  }, false)
  useEffect(() => {
    frame.setActive(animated)
    return () => frame.setActive(false)
  }, [animated, frame])
  useEffect(() => {
    uniforms.value = values
    runOnUI(() => {
      if (!mounted.value || !contextId.value) return
      try {
        const gl = getSceneContext(contextId.value)
        if (!gl?.isleLiquidRenderer) throw new Error('Liquid glass context lost')
        drawLiquidFrame(gl, gl.isleLiquidRenderer, uniforms.value, phase.value)
      } catch {
        releaseContext(contextId.value)
        contextId.value = 0
        runOnJS(onError)()
      }
    })()
  }, [contextId, mounted, onError, phase, uniforms, values])
  useEffect(() => {
    mounted.value = true
    return () => {
      mounted.value = false
      runOnUI(() => {
        releaseContext(contextId.value)
        contextId.value = 0
      })()
    }
  }, [contextId, mounted])
  const onContextCreate = useCallback((context: ExpoWebGLRenderingContext) => {
    runOnUI((id: number) => {
      if (!mounted.value) return
      try {
        const gl = getSceneContext(id)
        if (!gl) { runOnJS(onError)(); return }
        gl.isleLiquidRenderer = createLiquidRenderer(gl)
        drawLiquidFrame(gl, gl.isleLiquidRenderer, uniforms.value, phase.value)
        contextId.value = id
        runOnJS(onReady)()
      } catch {
        releaseContext(id)
        runOnJS(onError)()
      }
    })(context.contextId)
  }, [contextId, mounted, onError, onReady, phase, uniforms])
  if (!nativeGL) return null
  return <nativeGL.GLView testID="liquid-glass-gpu" pointerEvents="none" style={style} msaaSamples={0}
    enableExperimentalWorkletSupport onContextCreate={onContextCreate} />
}
