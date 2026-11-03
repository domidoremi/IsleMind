import { useCallback, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  Keyboard, Platform, TextInput,
  type KeyboardEvent, type LayoutChangeEvent, type NativeScrollEvent,
  type NativeSyntheticEvent, type ScrollView, type View,
} from 'react-native'
import { resolveFocusedInputScroll, resolveKeyboardViewportInset } from './keyboardScrollViewport'

export function useKeyboardScrollViewport(routeKey: string) {
  const frameRef = useRef<View>(null)
  const scrollRef = useRef<ScrollView>(null)
  const active = useRef(false)
  const ownsFocus = useRef(false)
  const keyboardTop = useRef<number | null>(null)
  const scrollHeight = useRef(0)
  const offset = useRef(0)
  const beforeKeyboardOffset = useRef<number | null>(null)
  const restoreOffset = useRef<number | null>(null)
  const userScrolled = useRef(false)
  const generation = useRef(0)
  const pendingFrame = useRef<number | null>(null)
  const [bottomInset, setBottomInset] = useState(0)
  const [visibleHeight, setVisibleHeight] = useState(0)
  const [keyboardVisible, setKeyboardVisible] = useState(false)

  const cancelMeasurement = useCallback(() => {
    generation.current += 1
    if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current)
    pendingFrame.current = null
  }, [])

  const measureViewport = useCallback(() => {
    if (Platform.OS !== 'android' || !active.current) return
    cancelMeasurement()
    const epoch = generation.current
    pendingFrame.current = requestAnimationFrame(() => {
      pendingFrame.current = null
      // This parent never shrinks with the inset, so overlap cannot feed back.
      frameRef.current?.measureInWindow((_x, top, _width, height) => {
        if (!active.current || generation.current !== epoch || height <= 0) return
        const inset = resolveKeyboardViewportInset({ top, height }, keyboardTop.current)
        const available = Math.max(0, height - inset)
        setBottomInset(current => Math.abs(current - inset) < 0.5 ? current : inset)
        setVisibleHeight(current => Math.abs(current - available) < 0.5 ? current : available)
        // Wait for the native scroll viewport to resize before asking it to scroll.
        if (Math.abs(scrollHeight.current - available) > 1) return
        if (keyboardTop.current === null) {
          if (restoreOffset.current !== null) {
            const restored = restoreOffset.current
            restoreOffset.current = null
            offset.current = restored
            scrollRef.current?.scrollTo({ y: restored, animated: false })
          }
          return
        }
        if (!ownsFocus.current || available <= 0) return
        const input = TextInput.State.currentlyFocusedInput()
        input?.measureInWindow((_inputX, inputTop, _inputWidth, inputHeight) => {
          if (!active.current || generation.current !== epoch || !ownsFocus.current
            || input !== TextInput.State.currentlyFocusedInput() || keyboardTop.current === null) return
          const next = resolveFocusedInputScroll({
            viewport: { top, height: available },
            input: { top: inputTop, height: inputHeight },
            offset: offset.current,
          })
          if (Math.abs(next - offset.current) < 1) return
          offset.current = next
          scrollRef.current?.scrollTo({ y: next, animated: false })
        })
      })
    })
  }, [cancelMeasurement])

  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'android') return
    active.current = true
    const show = (event: Pick<KeyboardEvent, 'endCoordinates'>) => {
      if (event.endCoordinates.height <= 0 || !Number.isFinite(event.endCoordinates.screenY)) return
      if (keyboardTop.current === null) {
        beforeKeyboardOffset.current = offset.current
        userScrolled.current = false
      }
      restoreOffset.current = null
      keyboardTop.current = event.endCoordinates.screenY
      setKeyboardVisible(true)
      measureViewport()
    }
    const hide = () => {
      if (keyboardTop.current === null) return
      // Restore automatic reveal only; never undo the user's deliberate scroll.
      restoreOffset.current = userScrolled.current ? null : beforeKeyboardOffset.current
      beforeKeyboardOffset.current = null
      keyboardTop.current = null
      setKeyboardVisible(false)
      measureViewport()
    }
    const subscriptions = [
      Keyboard.addListener('keyboardDidShow', show),
      Keyboard.addListener('keyboardDidHide', hide),
    ]
    const metrics = Keyboard.metrics()
    if (metrics) show({ endCoordinates: metrics })
    else measureViewport()
    return () => {
      active.current = false
      ownsFocus.current = false
      keyboardTop.current = null
      beforeKeyboardOffset.current = null
      restoreOffset.current = null
      cancelMeasurement()
      for (const subscription of subscriptions) subscription.remove()
      setBottomInset(0)
      setVisibleHeight(0)
      setKeyboardVisible(false)
    }
  }, [routeKey, cancelMeasurement, measureViewport]))

  const onInputFocus = useCallback(() => {
    ownsFocus.current = true
    measureViewport()
  }, [measureViewport])
  const onInputBlur = useCallback(() => {
    ownsFocus.current = false
    cancelMeasurement()
  }, [cancelMeasurement])
  const onInputLayout = useCallback(() => {
    if (ownsFocus.current && keyboardTop.current !== null) measureViewport()
  }, [measureViewport])
  const onScrollLayout = useCallback((event: LayoutChangeEvent) => {
    scrollHeight.current = event.nativeEvent.layout.height
    measureViewport()
  }, [measureViewport])
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = Math.max(0, event.nativeEvent.contentOffset.y)
  }, [])
  const onScrollBeginDrag = useCallback(() => { userScrolled.current = true }, [])

  return {
    frameRef, scrollRef, bottomInset, visibleHeight, keyboardVisible,
    onFrameLayout: measureViewport, onScrollLayout, onScroll, onScrollBeginDrag,
    onInputFocus, onInputBlur, onInputLayout,
  }
}
