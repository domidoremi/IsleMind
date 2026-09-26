import { AccessibilityInfo, NativeModules, Platform, findNodeHandle, type GestureResponderEvent } from 'react-native'
import { restoreAccessibilityFocus } from './restoreAccessibilityFocus'

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  NativeModules: { AndroidAccessibilityFocus: { restore: jest.fn(), cancel: jest.fn() } },
  AccessibilityInfo: { sendAccessibilityEvent: jest.fn() },
  findNodeHandle: jest.fn(),
}))

const native = NativeModules.AndroidAccessibilityFocus
const control = { focus: jest.fn(), measure: jest.fn() }
const target = control as unknown as GestureResponderEvent['currentTarget']

beforeEach(() => {
  jest.clearAllMocks()
  Platform.OS = 'android'
  jest.mocked(findNodeHandle).mockReturnValue(42)
})

it('restores the Web activating control without using the Android bridge', () => {
  Platform.OS = 'web'
  restoreAccessibilityFocus(target)()
  expect(control.focus).toHaveBeenCalledTimes(1)
  expect(native.restore).not.toHaveBeenCalled()
})

it('delegates native window readiness and cancellation without requesting input focus', () => {
  const cancelFirst = restoreAccessibilityFocus(target)
  const first = native.restore.mock.calls[0][1]
  const cancelSecond = restoreAccessibilityFocus(target)
  const second = native.restore.mock.calls[1][1]
  expect(native.restore).toHaveBeenNthCalledWith(1, 42, first)
  expect(second).not.toBe(first)
  cancelFirst()
  expect(native.cancel).toHaveBeenLastCalledWith(first)
  cancelSecond()
  expect(native.cancel).toHaveBeenLastCalledWith(second)
  expect(control.focus).not.toHaveBeenCalled()
  expect(control.measure).not.toHaveBeenCalled()
  expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled()
})

it('ignores a native control that has already unmounted', () => {
  jest.mocked(findNodeHandle).mockReturnValue(null)
  restoreAccessibilityFocus(target)()
  expect(native.restore).not.toHaveBeenCalled()
  expect(native.cancel).not.toHaveBeenCalled()
})

it('cancels the fallback host measurement when the owner leaves', () => {
  Platform.OS = 'ios'
  const cancel = restoreAccessibilityFocus(target)
  const measure = control.measure.mock.calls[0][0]
  cancel()
  measure(0, 0, 100, 44, 0, 0)
  expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled()
})
