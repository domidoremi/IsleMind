import { useCallback, useEffect, useRef } from 'react'
import { AppState, Keyboard, Platform, type GestureResponderEvent } from 'react-native'
import { usePathname } from 'expo-router'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'
import { useChatStreamingStore } from '@/store/chatStreamingStore'

interface ExecutionActivity {
  isBusy(): boolean
  subscribeActivity(listener: (busy: boolean) => void): () => void
}

/** Native foreground, focus, keyboard, gesture, and execution events feed a single quiet deadline. */
export function useAppUpdateActivityBridge({ ready, execution }: { ready: boolean; execution: ExecutionActivity }) {
  const path = usePathname()
  const touchBlocker = useRef<(() => void) | undefined>(undefined)
  const startTouch = useCallback(() => {
    touchBlocker.current ??= appUpdateActivity.acquireBlocker('touch')
  }, [])
  const cancelTouch = useCallback(() => {
    touchBlocker.current?.()
    touchBlocker.current = undefined
  }, [])
  const endTouch = useCallback((event: GestureResponderEvent) => {
    if (event.nativeEvent.touches?.length) return
    cancelTouch()
  }, [cancelTouch])
  useEffect(() => { appUpdateActivity.recordActivity() }, [path])

  useEffect(() => {
    if (!ready) { appUpdateActivity.setForeground(false); return cancelTouch }
    let keyboardBlocker: (() => void) | undefined
    let streamBlocker: (() => void) | undefined
    let executionBlocker: (() => void) | undefined
    let focusBlocker: (() => void) | undefined
    let windowBlocker: (() => void) | undefined
    let state = AppState.currentState
    const setKeyboard = (open: boolean) => {
      if (open) keyboardBlocker ??= appUpdateActivity.acquireBlocker('keyboard')
      else { keyboardBlocker?.(); keyboardBlocker = undefined }
    }
    const setStreams = (busy: boolean) => {
      if (busy) streamBlocker ??= appUpdateActivity.acquireBlocker('streaming')
      else { streamBlocker?.(); streamBlocker = undefined }
    }
    const setExecution = (busy: boolean) => {
      if (busy) executionBlocker ??= appUpdateActivity.acquireBlocker('assistant-execution')
      else { executionBlocker?.(); executionBlocker = undefined }
    }
    const setWindowFocus = (focused: boolean) => {
      if (!focused) windowBlocker ??= appUpdateActivity.acquireBlocker('window-focus')
      else { windowBlocker?.(); windowBlocker = undefined }
    }
    const publishForeground = () => {
      appUpdateActivity.setForeground(Platform.OS === 'web'
        ? document.visibilityState === 'visible' : state === 'active')
    }
    setStreams(useChatStreamingStore.getState().activeStreams.size > 0)
    setExecution(execution.isBusy())
    setKeyboard(Keyboard.isVisible())
    if (Platform.OS === 'web') setWindowFocus(document.hasFocus())
    publishForeground()
    const streams = useChatStreamingStore.subscribe((next) => setStreams(next.activeStreams.size > 0))
    const running = execution.subscribeActivity(setExecution)
    const showKeyboard = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true))
    const hideKeyboard = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false))
    const appState = AppState.addEventListener('change', (next) => {
      state = next
      if (next === 'active') setKeyboard(Keyboard.isVisible())
      publishForeground()
      if (next !== 'active') cancelTouch()
    })
    const androidFocus = Platform.OS === 'android'
      ? AppState.addEventListener('focus', () => setWindowFocus(true)) : undefined
    const androidBlur = Platform.OS === 'android'
      ? AppState.addEventListener('blur', () => { setWindowFocus(false); cancelTouch() }) : undefined
    let webCleanup: (() => void) | undefined
    if (Platform.OS === 'web') {
      let active = true
      const record = () => appUpdateActivity.recordActivity()
      const pointerDown = () => startTouch()
      const pointerUp = cancelTouch
      const refreshFocus = () => {
        if (!active) return
        const editing = document.activeElement?.matches('input, textarea, [contenteditable]:not([contenteditable="false"])')
        if (editing) focusBlocker ??= appUpdateActivity.acquireBlocker('web-input-focus')
        else { focusBlocker?.(); focusBlocker = undefined }
        record()
      }
      const blurInput = () => queueMicrotask(refreshFocus)
      const focusWindow = () => { setWindowFocus(true); publishForeground() }
      const blurWindow = () => { setWindowFocus(false); pointerUp(); publishForeground() }
      const visibility = () => {
        setWindowFocus(document.hasFocus())
        publishForeground()
        if (document.visibilityState !== 'visible') pointerUp()
      }
      document.addEventListener('visibilitychange', visibility)
      window.addEventListener('focus', focusWindow)
      window.addEventListener('blur', blurWindow)
      document.addEventListener('keydown', record, { capture: true, passive: true })
      document.addEventListener('wheel', record, { capture: true, passive: true })
      document.addEventListener('pointerdown', pointerDown, true)
      document.addEventListener('pointerup', pointerUp, true)
      document.addEventListener('pointercancel', pointerUp, true)
      document.addEventListener('focusin', refreshFocus)
      document.addEventListener('focusout', blurInput)
      refreshFocus()
      webCleanup = () => {
        active = false
        document.removeEventListener('visibilitychange', visibility)
        window.removeEventListener('focus', focusWindow)
        window.removeEventListener('blur', blurWindow)
        document.removeEventListener('keydown', record, true)
        document.removeEventListener('wheel', record, true)
        document.removeEventListener('pointerdown', pointerDown, true)
        document.removeEventListener('pointerup', pointerUp, true)
        document.removeEventListener('pointercancel', pointerUp, true)
        document.removeEventListener('focusin', refreshFocus)
        document.removeEventListener('focusout', blurInput)
      }
    }
    return () => {
      appUpdateActivity.setForeground(false)
      streams(); running(); showKeyboard.remove(); hideKeyboard.remove(); appState.remove()
      androidFocus?.remove(); androidBlur?.remove(); webCleanup?.()
      keyboardBlocker?.(); streamBlocker?.(); executionBlocker?.(); focusBlocker?.(); windowBlocker?.()
      cancelTouch()
    }
  }, [ready, execution, startTouch, cancelTouch])
  return { onTouchStart: startTouch, onTouchEnd: endTouch, onTouchCancel: cancelTouch }
}
