import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'
import { Platform, type View, type ViewStyle } from 'react-native'
import { MODEL_MENU_VIEWPORT_MARGIN, type ModelMenuAnchor, type ModelMenuPlacement } from './floatingComposerGeometry'

type Insets = { top: number; right: number; bottom: number; left: number }
type ElementRef = RefObject<View | null>

function webElement(ref?: ElementRef) {
  const node = ref?.current as unknown as HTMLElement | null
  return typeof node?.getBoundingClientRect === 'function' ? node : null
}

function measureViewport(root: HTMLElement, trigger: HTMLElement | null, anchor: ModelMenuAnchor | null) {
  const host = root.getBoundingClientRect()
  const visual = window.visualViewport
  const left = visual?.offsetLeft ?? 0
  const top = visual?.offsetTop ?? 0
  const width = visual?.width ?? window.innerWidth
  const height = visual?.height ?? window.innerHeight
  const button = trigger?.getBoundingClientRect() ?? anchor
  // The fixed modal, the visual viewport and the trigger use layout CSS pixels.
  return {
    width: host.width, height: host.height, visibleHeight: height,
    anchor: button && { x: button.x - host.left, y: button.y - host.top, width: button.width, height: button.height },
    obscured: {
      left: Math.max(0, left - host.left), top: Math.max(0, top - host.top),
      right: Math.max(0, host.right - left - width), bottom: Math.max(0, host.bottom - top - height),
    },
  }
}

export function useModelMenuWebViewport(visible: boolean, rootRef: ElementRef, triggerRef: ElementRef | undefined, anchor: ModelMenuAnchor | null) {
  const [viewport, setViewport] = useState<ReturnType<typeof measureViewport> | null>(null)
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || !visible) return
    const root = webElement(rootRef)
    if (!root) return
    const trigger = webElement(triggerRef)
    const visual = window.visualViewport
    const windowBounds = () => [window.innerWidth, window.innerHeight, visual?.width, visual?.height, visual?.offsetLeft, visual?.offsetTop].join(',')
    let lastBounds: string
    const refresh = () => {
      lastBounds = windowBounds()
      setViewport(measureViewport(root, trigger, anchor))
    }
    refresh()
    window.addEventListener('resize', refresh)
    visual?.addEventListener('resize', refresh)
    visual?.addEventListener('scroll', refresh)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(refresh) : null
    observer?.observe(root)
    if (trigger) observer?.observe(trigger)
    // Some embedded browsers update visualViewport before delivering resize or
    // animation frames. Read element bounds only when the viewport has changed.
    const check = setInterval(() => {
      if (!globalThis.document?.hidden && windowBounds() !== lastBounds) refresh()
    }, 250)
    return () => {
      clearInterval(check)
      observer?.disconnect()
      window.removeEventListener('resize', refresh)
      visual?.removeEventListener('resize', refresh)
      visual?.removeEventListener('scroll', refresh)
    }
  }, [visible, rootRef, triggerRef, anchor])
  return viewport
}

/** Percentages track the modal even when the browser defers resize notifications. */
export function webModelMenuStyle(placement: ModelMenuPlacement, insets: Insets, width: number, height: number, estimatedHeight: number): ViewStyle {
  const marginX = Math.min(MODEL_MENU_VIEWPORT_MARGIN, Math.max(0, width - insets.left - insets.right) / 2)
  const marginY = Math.min(MODEL_MENU_VIEWPORT_MARGIN, Math.max(0, height - insets.top - insets.bottom) / 2)
  const left = insets.left + marginX
  const right = insets.right + marginX
  const near = (placement.openAbove ? insets.bottom : insets.top) + marginY
  const far = (placement.openAbove ? insets.top : insets.bottom) + marginY
  const offset = placement.bottom ?? placement.top ?? near
  const reserved = Math.min(estimatedHeight, placement.maxHeight)
  const edge = `clamp(${near}px, ${offset}px, calc(100% - ${far + reserved}px))`
  // React Native's shared style types omit CSS math supported by its web renderer.
  const style: CSSProperties = {
    left: `clamp(${left}px, ${placement.left}px, calc(100% - ${right + placement.width}px))`,
    width: placement.width,
    maxWidth: `max(0px, calc(100% - ${left + right}px))`,
    [placement.openAbove ? 'bottom' : 'top']: edge,
    maxHeight: `max(0px, calc(100% - ${far}px - ${edge}))`,
  }
  return style as ViewStyle
}
