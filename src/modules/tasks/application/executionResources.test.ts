import { createExecutionResources } from './executionResources'

test('an aborted caller cannot release a still-running native permit', async () => {
  const resources = createExecutionResources()
  const first = new AbortController()
  let settle!: () => void
  const pending = new Promise<void>((resolve) => { settle = resolve })
  const a = resources.runLocal(first.signal, () => pending).catch(() => 'cancelled')
  await Promise.resolve()
  first.abort()
  let entered = false
  const b = resources.runLocal(new AbortController().signal, async () => { entered = true })
  await Promise.resolve()
  expect(entered).toBe(false)
  settle()
  expect(await a).toBe('cancelled')
  await b
  expect(entered).toBe(true)
})

test('queued cancellation and memory pressure never start queued work', async () => {
  const resources = createExecutionResources()
  let settle!: () => void
  const a = resources.runLocal(new AbortController().signal, () => new Promise<void>((resolve) => { settle = resolve }))
  await Promise.resolve()
  const controller = new AbortController()
  const work = jest.fn(async () => undefined)
  const b = resources.runLocal(controller.signal, work)
  controller.abort()
  await expect(b).rejects.toBeDefined()
  const c = resources.runLocal(new AbortController().signal, work)
  resources.setPressure(true)
  await expect(c).rejects.toMatchObject({ code: 'memory_pressure' })
  settle()
  await a
  expect(work).not.toHaveBeenCalled()
  expect(() => resources.reserveText(1)).toThrow('memory_pressure')
  resources.setPressure(false)
  await resources.runLocal(new AbortController().signal, work)
  expect(work).toHaveBeenCalledTimes(1)
})

test('text reservations are bounded and released idempotently', () => {
  const resources = createExecutionResources({ maxTextBytes: 10 })
  const release = resources.reserveText(8)
  expect(() => resources.reserveText(3)).toThrow('text_budget')
  release(); release()
  expect(resources.retainedTextBytes).toBe(0)
  expect(() => resources.reserveText(Number.NaN)).toThrow('text_budget')
})

test('stop-only text reservations ignore critical pressure but never bypass the shared cap or authorize work', async () => {
  const resources = createExecutionResources({ maxTextBytes: 10 })
  const work = resources.reserveText(8)
  resources.setPressure(true)
  const stop = resources.reserveStopText(2)
  expect(resources.retainedTextBytes).toBe(10)
  expect(() => resources.reserveStopText(1)).toThrow('text_budget')
  expect(() => resources.reserveStopText(Number.NaN)).toThrow('text_budget')
  expect(() => resources.reserveText(0)).toThrow('memory_pressure')
  const dispatch = jest.fn(async () => undefined)
  await expect(resources.runLocal(new AbortController().signal, dispatch)).rejects.toThrow('memory_pressure')
  expect(dispatch).not.toHaveBeenCalled()
  stop(); stop(); work()
  expect(resources.retainedTextBytes).toBe(0)
})
