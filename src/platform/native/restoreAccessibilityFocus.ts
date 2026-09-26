import { AccessibilityInfo, NativeModules, Platform, findNodeHandle, type GestureResponderEvent } from 'react-native'

type FocusControl = GestureResponderEvent['currentTarget']
interface AndroidFocusModule {
  restore: (tag: number, requestId: number) => void
  cancel: (requestId: number) => void
}
let nextRequestId = 0

/** Return cancellation for an unmounted owner or a newly opened reading layer. */
export function restoreAccessibilityFocus(control: FocusControl): () => void {
  if (Platform.OS === 'web') {
    control.focus()
    return () => undefined
  }
  const android = Platform.OS === 'android'
    ? NativeModules.AndroidAccessibilityFocus as AndroidFocusModule | undefined
    : undefined
  if (android) {
    // RN's legacy declaration omits the Fabric host element accepted at runtime.
    const tag = findNodeHandle(control as unknown as Parameters<typeof findNodeHandle>[0])
    if (tag === null) return () => undefined
    const requestId = ++nextRequestId
    android.restore(tag, requestId)
    return () => android.cancel(requestId)
  }
  // iOS and older native hosts use React Native's accessibility event. A native
  // measurement avoids sending it before the retained control is committed.
  let active = true
  control.measure((_x, _y, width, height) => {
    if (active && width > 0 && height > 0) AccessibilityInfo.sendAccessibilityEvent(control, 'focus')
  })
  return () => { active = false }
}
