import { useCallback, useLayoutEffect, useState } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

const TOP = { scrolled: false, progress: 0 }

/** Bounded display state only; the reader still owns its scroll restoration. */
export function useReadingChrome(identity: string) {
  const [position, setPosition] = useState(TOP)
  useLayoutEffect(() => { setPosition(TOP) }, [identity])
  const update = useCallback((y: number, contentHeight: number, viewportHeight: number) => {
    const offset = Math.max(0, y)
    const travel = contentHeight - viewportHeight
    const progress = travel > 1 ? Math.round(Math.min(1, offset / travel) * 100) / 100 : 0
    const scrolled = offset > 12
    setPosition(previous => previous.scrolled === scrolled && previous.progress === progress
      ? previous : { scrolled, progress })
  }, [])
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    update(contentOffset.y, contentSize.height, layoutMeasurement.height)
  }, [update])
  return { ...position, onScroll, update }
}
