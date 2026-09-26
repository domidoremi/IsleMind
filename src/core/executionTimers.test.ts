import { bindExecutionTimerMirror, setExecutionTimeout, setExecutionInterval } from './executionTimers'

describe('execution timer mirror', () => {
  let unbind: (() => void) | undefined
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { unbind?.(); unbind = undefined; jest.useRealTimers() })

  it.each(['native', 'js'] as const)('%s completion wins once and disposes both clocks', clock => {
    let native!: () => void
    const cancelNative = jest.fn()
    unbind = bindExecutionTimerMirror({ schedule(callback) { native = callback; return cancelNative } })
    const callback = jest.fn()
    const timer = setExecutionTimeout(callback, 5000)
    if (clock === 'native') native()
    jest.advanceTimersByTime(5000)
    native(); timer.cancel()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(cancelNative).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('rejects late delivery after cancellation and leaves no foreground timer on failed admission', () => {
    let native!: () => void
    unbind = bindExecutionTimerMirror({ schedule(callback) { native = callback; return () => undefined } })
    const callback = jest.fn()
    setExecutionTimeout(callback, 10).cancel()
    native(); jest.runAllTimers()
    expect(callback).not.toHaveBeenCalled()
    unbind()
    unbind = bindExecutionTimerMirror({ schedule() { throw new Error('capacity') } })
    expect(() => setExecutionTimeout(callback, 10)).toThrow('capacity')
    expect(jest.getTimerCount()).toBe(0)
  })

  it('renews on native deadlines without a JS frame tick and stops from inside the callback', () => {
    const callbacks: Array<() => void> = []
    const disposers: jest.Mock[] = []
    unbind = bindExecutionTimerMirror({ schedule(callback) { callbacks.push(callback); const dispose = jest.fn(); disposers.push(dispose); return dispose } })
    let count = 0
    const interval = setExecutionInterval(() => { if (++count === 3) interval.cancel() }, 5000)
    callbacks[0](); callbacks[1](); callbacks[2]()
    callbacks.forEach(callback => callback())
    expect(count).toBe(3)
    expect(callbacks).toHaveLength(3)
    expect(disposers.every(dispose => dispose.mock.calls.length === 1)).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('uses the normal clock without a platform mirror and rejects invalid delays', () => {
    const callback = jest.fn()
    setExecutionTimeout(callback, 100)
    jest.advanceTimersByTime(100)
    expect(callback).toHaveBeenCalledTimes(1)
    for (const ms of [NaN, Infinity, -1, 2_147_483_648]) expect(() => setExecutionTimeout(callback, ms)).toThrow('deadline')
    expect(jest.getTimerCount()).toBe(0)
  })
})
