import { act, render } from '@testing-library/react-native'
import { AppState, Keyboard, Platform, View } from 'react-native'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'
import { APP_UPDATE_QUIET_PERIOD_MS, scheduleIdleAppUpdate } from '@/core/appUpdateIdle'
import { useAppUpdateActivityBridge } from './useAppUpdateActivityBridge'

let mockPath = '/chat'
const mockStreams = { activeStreams: new Map() }
const mockStreamListeners = new Set<(state: typeof mockStreams) => void>()
jest.mock('expo-router', () => ({ usePathname: () => mockPath }))
jest.mock('@/store/chatStreamingStore', () => ({
  useChatStreamingStore: {
    getState: () => mockStreams,
    subscribe: (listener: (state: typeof mockStreams) => void) => {
      mockStreamListeners.add(listener); return () => { mockStreamListeners.delete(listener) }
    },
  },
}))

const executionListeners = new Set<(busy: boolean) => void>()
let executionBusy = false
const execution = {
  isBusy: () => executionBusy,
  subscribeActivity: (listener: (busy: boolean) => void) => {
    executionListeners.add(listener); return () => { executionListeners.delete(listener) }
  },
}
const stateListeners = new Map<string, (state?: string) => void>()
const keyboardListeners = new Map<string, () => void>()
const platform = Object.getOwnPropertyDescriptor(Platform, 'OS')!
const currentState = Object.getOwnPropertyDescriptor(AppState, 'currentState')!

function Root({ ready = true }: { ready?: boolean }) {
  const touch = useAppUpdateActivityBridge({ ready, execution })
  return <View testID="root" {...touch} />
}
async function tick(ms = APP_UPDATE_QUIET_PERIOD_MS) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms) })
}
beforeEach(() => {
  jest.useFakeTimers()
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' })
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
    stateListeners.set(event, listener as never)
    return { remove: () => { stateListeners.delete(event) } } as never
  })
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false)
  jest.spyOn(Keyboard, 'addListener').mockImplementation((event, listener) => {
    keyboardListeners.set(event, listener as never)
    return { remove: () => { keyboardListeners.delete(event) } } as never
  })
  executionBusy = false
  mockStreams.activeStreams.clear()
  mockPath = '/chat'
  appUpdateActivity.setForeground(false)
})
afterEach(() => {
  jest.restoreAllMocks()
  Object.defineProperty(Platform, 'OS', platform)
  Object.defineProperty(AppState, 'currentState', currentState)
  jest.useRealTimers()
})

it('waits for readiness and an actual active native state', async () => {
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: null })
  const screen = await render(<Root ready={false} />)
  const onIdle = jest.fn(() => true)
  const cancel = scheduleIdleAppUpdate({ activity: appUpdateActivity, onIdle })
  await tick(60_000)
  expect(onIdle).not.toHaveBeenCalled()
  await screen.rerender(<Root />)
  await tick(60_000)
  expect(onIdle).not.toHaveBeenCalled()
  await act(() => stateListeners.get('change')?.('active'))
  await tick()
  expect(onIdle).toHaveBeenCalledTimes(1)
  cancel()
})

it('projects native keyboard, stream, and invocation activity without changing execution state', async () => {
  await render(<Root />)
  await act(() => keyboardListeners.get('keyboardDidShow')?.())
  expect(appUpdateActivity.getSnapshot().blocked).toBe(true)
  await act(() => {
    mockStreams.activeStreams.set('reply', {})
    for (const listener of mockStreamListeners) listener(mockStreams)
    executionBusy = true
    for (const listener of executionListeners) listener(true)
    keyboardListeners.get('keyboardDidHide')?.()
  })
  expect(appUpdateActivity.getSnapshot().blocked).toBe(true)
  await act(() => {
    mockStreams.activeStreams.clear()
    for (const listener of mockStreamListeners) listener(mockStreams)
  })
  expect(appUpdateActivity.getSnapshot().blocked).toBe(true)
  await act(() => { executionBusy = false; for (const listener of executionListeners) listener(false) })
  expect(appUpdateActivity.getSnapshot().blocked).toBe(false)
})

it('blocks Android window blur without misclassifying an app-owned modal as a background transition', async () => {
  await render(<Root />)
  await act(() => stateListeners.get('blur')?.())
  expect(appUpdateActivity.getSnapshot()).toMatchObject({ foreground: true, blocked: true })
  await act(() => stateListeners.get('focus')?.())
  expect(appUpdateActivity.getSnapshot()).toMatchObject({ foreground: true, blocked: false })
  await act(() => stateListeners.get('change')?.('background'))
  expect(appUpdateActivity.getSnapshot().foreground).toBe(false)
})

it('holds a gesture blocker through multi-touch and clears cancelled or background gestures', async () => {
  const screen = await render(<Root />)
  const handlers = screen.getByTestId('root').props
  await act(() => handlers.onTouchStart())
  await tick(60_000)
  expect(appUpdateActivity.getSnapshot().blocked).toBe(true)
  await act(() => handlers.onTouchEnd({ nativeEvent: { touches: [{}] } }))
  expect(appUpdateActivity.getSnapshot().blocked).toBe(true)
  await act(() => handlers.onTouchCancel())
  expect(appUpdateActivity.getSnapshot().blocked).toBe(false)
  await act(() => { handlers.onTouchStart(); stateListeners.get('change')?.('background') })
  expect(appUpdateActivity.getSnapshot().blocked).toBe(false)
})

it('resets quiet time on navigation and cleans every native subscription and blocker on teardown', async () => {
  const screen = await render(<Root />)
  const onIdle = jest.fn(() => true)
  const cancel = scheduleIdleAppUpdate({ activity: appUpdateActivity, onIdle })
  await tick(4_000)
  mockPath = '/settings'
  await screen.rerender(<Root />)
  await tick(4_999)
  expect(onIdle).not.toHaveBeenCalled()
  await tick(1)
  expect(onIdle).toHaveBeenCalledTimes(1)
  await act(() => keyboardListeners.get('keyboardDidShow')?.())
  await screen.unmount()
  expect(appUpdateActivity.getSnapshot()).toMatchObject({ foreground: false, blocked: false })
  expect(stateListeners.size).toBe(0)
  expect(keyboardListeners.size).toBe(0)
  expect(mockStreamListeners.size).toBe(0)
  expect(executionListeners.size).toBe(0)
  cancel()
})
