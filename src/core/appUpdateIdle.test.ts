import { APP_UPDATE_QUIET_PERIOD_MS, createAppUpdateActivity, scheduleIdleAppUpdate } from './appUpdateIdle'

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(0) })
afterEach(() => jest.useRealTimers())

function fixture() {
  const activity = createAppUpdateActivity(() => Date.now())
  const onIdle = jest.fn(() => true)
  const cancel = scheduleIdleAppUpdate({ activity, onIdle })
  return { activity, onIdle, cancel }
}

it('never authorizes a prompt from unknown or background state', () => {
  const f = fixture()
  jest.advanceTimersByTime(60_000)
  expect(f.onIdle).not.toHaveBeenCalled()
  expect(jest.getTimerCount()).toBe(0)
  f.activity.setForeground(false)
  jest.advanceTimersByTime(60_000)
  expect(f.onIdle).not.toHaveBeenCalled()
  f.cancel()
})

it('waits for a full foreground quiet period and consumes the request only once', () => {
  const f = fixture()
  f.activity.setForeground(true)
  jest.advanceTimersByTime(APP_UPDATE_QUIET_PERIOD_MS - 1)
  expect(f.onIdle).not.toHaveBeenCalled()
  jest.advanceTimersByTime(1)
  expect(f.onIdle).toHaveBeenCalledTimes(1)
  f.activity.recordActivity()
  jest.advanceTimersByTime(60_000)
  expect(f.onIdle).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(0)
})

it.each(['touch', 'navigation', 'keyboard', 'focus', 'generation', 'voice', 'draft', 'overlay', 'manual-check'])(
  'restarts the deadline after %s ends',
  (reason) => {
    const f = fixture()
    f.activity.setForeground(true)
    jest.advanceTimersByTime(4_000)
    const release = f.activity.acquireBlocker(reason)
    expect(jest.getTimerCount()).toBe(0)
    jest.advanceTimersByTime(60_000)
    expect(f.onIdle).not.toHaveBeenCalled()
    release()
    jest.advanceTimersByTime(APP_UPDATE_QUIET_PERIOD_MS - 1)
    expect(f.onIdle).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(f.onIdle).toHaveBeenCalledTimes(1)
  },
)

it('uses independent, idempotent blocker scopes and releases them on cleanup', () => {
  const f = fixture()
  f.activity.setForeground(true)
  const first = f.activity.acquireBlocker('draft')
  const second = f.activity.acquireBlocker('draft')
  first(); first()
  expect(f.activity.getSnapshot().blocked).toBe(true)
  jest.advanceTimersByTime(60_000)
  expect(f.onIdle).not.toHaveBeenCalled()
  second()
  f.cancel()
  expect(jest.getTimerCount()).toBe(0)
  f.activity.recordActivity()
  jest.advanceTimersByTime(60_000)
  expect(f.onIdle).not.toHaveBeenCalled()
})

it('defers repeated pointer, scroll, and route activity using only one timer', () => {
  const f = fixture()
  f.activity.setForeground(true)
  for (let index = 0; index < 100; index += 1) {
    jest.advanceTimersByTime(50)
    f.activity.recordActivity()
    expect(jest.getTimerCount()).toBe(1)
  }
  expect(f.onIdle).not.toHaveBeenCalled()
  jest.advanceTimersByTime(APP_UPDATE_QUIET_PERIOD_MS)
  expect(f.onIdle).toHaveBeenCalledTimes(1)
})

it('drops a background deadline and requires new quiet time after returning', () => {
  const f = fixture()
  f.activity.setForeground(true)
  jest.advanceTimersByTime(4_999)
  f.activity.setForeground(false)
  jest.advanceTimersByTime(60_000)
  f.activity.setForeground(true)
  jest.advanceTimersByTime(4_999)
  expect(f.onIdle).not.toHaveBeenCalled()
  jest.advanceTimersByTime(1)
  expect(f.onIdle).toHaveBeenCalledTimes(1)
})

it('checks eligibility again at the deadline without an idle polling loop', () => {
  const activity = createAppUpdateActivity(() => Date.now())
  activity.setForeground(true)
  let eligible = true
  const onIdle = jest.fn(() => false)
  const cancel = scheduleIdleAppUpdate({ activity, onIdle, canPrompt: () => eligible })
  eligible = false
  jest.advanceTimersByTime(APP_UPDATE_QUIET_PERIOD_MS)
  expect(onIdle).not.toHaveBeenCalled()
  eligible = true
  activity.recordActivity()
  jest.advanceTimersByTime(APP_UPDATE_QUIET_PERIOD_MS)
  expect(onIdle).toHaveBeenCalledTimes(1)
  jest.advanceTimersByTime(60_000)
  expect(onIdle).toHaveBeenCalledTimes(1)
  activity.recordActivity()
  jest.advanceTimersByTime(APP_UPDATE_QUIET_PERIOD_MS)
  expect(onIdle).toHaveBeenCalledTimes(2)
  cancel()
})
