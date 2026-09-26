import { createAndroidExecutionTimerMirror } from './androidExecutionTimers'

function setup() {
  let emit!: (event: unknown) => void
  const remove = jest.fn()
  const native = { scheduleExecutionTimer: jest.fn(async () => true), cancelExecutionTimer: jest.fn() }
  const scheduler = createAndroidExecutionTimerMirror({ native, subscribe(listener) { emit = listener; return remove } })
  return { ...scheduler, native, remove, emit }
}

describe('Android execution deadline mirror', () => {
  it('validates event identity and ignores duplicate, cancelled and disposed deliveries', () => {
    const fx = setup(), callback = jest.fn()
    const cancel = fx.mirror.schedule(callback, 5000)
    for (const event of [null, {}, { id: '1' }, { id: 0 }, { id: 1.5 }, { id: Infinity }]) fx.emit(event)
    expect(callback).not.toHaveBeenCalled()
    fx.emit({ id: 1 }); fx.emit({ id: 1 }); cancel(); cancel()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(fx.native.cancelExecutionTimer).toHaveBeenCalledTimes(1)
    fx.mirror.schedule(callback, 10)(); fx.emit({ id: 2 })
    fx.mirror.schedule(callback, 10); fx.dispose(); fx.dispose(); fx.emit({ id: 3 })
    expect(callback).toHaveBeenCalledTimes(1)
    expect(fx.remove).toHaveBeenCalledTimes(1)
    expect(() => fx.mirror.schedule(callback, 10)).toThrow('unavailable')
  })

  it('bounds retained callbacks and frees capacity on cancellation and delivery', () => {
    const fx = setup()
    const cancellations = Array.from({ length: 128 }, () => fx.mirror.schedule(() => undefined, 100))
    expect(() => fx.mirror.schedule(() => undefined, 100)).toThrow('capacity')
    cancellations[0]()
    expect(() => fx.mirror.schedule(() => undefined, 100)).not.toThrow()
    fx.emit({ id: 2 })
    expect(() => fx.mirror.schedule(() => undefined, 100)).not.toThrow()
    fx.dispose()
  })

  it('does not leak callback capacity if the native bridge throws synchronously', () => {
    const fx = setup()
    fx.native.scheduleExecutionTimer.mockImplementation(() => { throw new Error('bridge') })
    for (let i = 0; i < 130; i++) expect(() => fx.mirror.schedule(() => undefined, 100)).toThrow('bridge')
    fx.dispose()
  })
})
