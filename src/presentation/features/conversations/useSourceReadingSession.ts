import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import { useReadingChrome } from '@/presentation/layout/useReadingChrome'

type Position = { offset: number; contentHeight: number; viewportHeight: number }
export type SourceReadingSession = {
  offset: (key: string) => number
  report: (key: string, position: Position) => void
}

/** Numeric reading positions belong to this open route, never to the source record. */
export function useSourceReadingSession(identity: string) {
  const positions = useRef(new Map<string, number>())
  const active = useRef(identity)
  active.current = identity
  const chrome = useReadingChrome(identity)
  const update = chrome.update
  const session = useMemo<SourceReadingSession>(() => ({
    offset: key => positions.current.get(JSON.stringify([identity, key])) ?? 0,
    report: (key, position) => {
      if (active.current !== identity) return
      const entry = JSON.stringify([identity, key])
      positions.current.delete(entry)
      positions.current.set(entry, position.offset)
      if (positions.current.size > 64) positions.current.delete(positions.current.keys().next().value!)
      update(position.offset, position.contentHeight, position.viewportHeight)
    },
  }), [identity, update])
  return { chrome, session }
}

/** Restore only once the current source has content and a measured reading viewport. */
export function useSourceReaderPosition(session: SourceReadingSession | undefined, key: string, ready: boolean, scrollTo: (offset: number) => void) {
  const metrics = useRef({ contentHeight: 0, viewportHeight: 0, offset: 0 })
  const restored = useRef(false)
  const move = useRef(scrollTo)
  move.current = scrollTo
  const latest = useRef({ session, key, ready })
  latest.current = { session, key, ready }

  const report = useCallback(() => session?.report(key, metrics.current), [session, key])
  const restore = useCallback(() => {
    if (latest.current.session !== session || latest.current.key !== key || !latest.current.ready) return
    const position = metrics.current
    if (!position.contentHeight || !position.viewportHeight) return
    if (!restored.current) {
      position.offset = Math.min(session?.offset(key) ?? 0, Math.max(0, position.contentHeight - position.viewportHeight))
      restored.current = true
      move.current(position.offset)
    }
    report()
  }, [session, key, report])

  useLayoutEffect(() => {
    restored.current = false
    // A loading header is not the final source's measured content.
    metrics.current = { contentHeight: 0, viewportHeight: 0, offset: 0 }
  }, [session, key, ready])

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    if (latest.current.session !== session || latest.current.key !== key) return
    metrics.current.viewportHeight = event.nativeEvent.layout.height
    restore()
  }, [restore])
  const onContentSizeChange = useCallback((_width: number, height: number) => {
    if (latest.current.session !== session || latest.current.key !== key) return
    metrics.current.contentHeight = height
    restore()
  }, [restore])
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (latest.current.session !== session || latest.current.key !== key || !latest.current.ready || !restored.current) return
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    // Hidden stack routes report zero layouts; they cannot replace a reading position.
    if (contentSize.height <= 0 || layoutMeasurement.height <= 0) return
    metrics.current = { offset: Math.max(0, contentOffset.y), contentHeight: contentSize.height, viewportHeight: layoutMeasurement.height }
    report()
  }, [session, key, report])
  return { onScroll, onLayout, onContentSizeChange, scrollEventThrottle: 32 }
}
