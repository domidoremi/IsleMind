import { createElement, useCallback, useEffect, useRef } from 'react'
import { PixelRatio, View } from 'react-native'
import { createLiquidRenderer, disposeLiquidRenderer, drawLiquidFrame, type LiquidCanvasProps, type LiquidGL, type LiquidRenderer } from './liquidGlassRenderer'

export const liquidCanvasAvailable = typeof window !== 'undefined' && 'WebGLRenderingContext' in window

/** Web uses the same shader, with a cancellable display-VSync loop. */
export function LiquidGlassCanvas({ values, animated, style, onReady, onError }: LiquidCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef<{ gl: LiquidGL; renderer: LiquidRenderer } | null>(null)
  const latest = useRef(values)
  const phase = useRef(0)
  const frame = useRef<number | null>(null)
  const last = useRef<number | null>(null)
  const moving = useRef(animated)
  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    last.current = null
  }, [])
  const release = useCallback(() => {
    stop()
    if (state.current) disposeLiquidRenderer(state.current.gl, state.current.renderer)
    state.current = null
  }, [stop])
  const tick = useCallback(function renderFrame(time: number) {
    frame.current = null
    if (!state.current) return
    if (moving.current && last.current !== null) phase.current = (phase.current + Math.min(100, Math.max(0, time - last.current)) / latest.current.cycleMs) % 1
    last.current = moving.current ? time : null
    try {
      drawLiquidFrame(state.current.gl, state.current.renderer, latest.current, phase.current)
      if (moving.current) frame.current = requestAnimationFrame(renderFrame)
    } catch {
      release()
      onError()
    }
  }, [onError, release])
  useEffect(() => {
    latest.current = values
    moving.current = animated
    stop()
    tick(performance.now())
  }, [animated, stop, tick, values])
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const lost = (event: Event) => { event.preventDefault(); release(); onError() }
    element.addEventListener('webglcontextlost', lost)
    let gl: WebGLRenderingContext | null = null
    try {
      gl = element.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false })
      if (!gl) throw new Error('WebGL unavailable')
      state.current = { gl, renderer: createLiquidRenderer(gl) }
      tick(performance.now())
      if (state.current) onReady()
    } catch {
      release()
      onError()
    }
    return () => {
      element.removeEventListener('webglcontextlost', lost)
      release()
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [onError, onReady, release, tick])
  return <View testID="liquid-glass-gpu" pointerEvents="none" style={style}>
    {createElement('canvas', { ref: canvas, 'aria-hidden': true,
      width: Math.max(1, Math.round(Number(style.width) * PixelRatio.get())),
      height: Math.max(1, Math.round(Number(style.height) * PixelRatio.get())),
      style: { display: 'block', width: '100%', height: '100%', pointerEvents: 'none' } })}
  </View>
}
