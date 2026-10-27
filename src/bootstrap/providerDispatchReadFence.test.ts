import { createProviderDispatchReadFence } from './providerDispatchReadFence'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const fence = (bound = 3) => createProviderDispatchReadFence(bound, 'dispatch read revoked')

it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid retained revision bound %s', bound => {
  expect(() => fence(bound)).toThrow('Invalid dispatch read-fence bound')
})

it('retains a stable captured read until a relevant write is admitted', async () => {
  const runtime = fence()
  const check = runtime.capture('a')
  expect(check).not.toThrow()
  await runtime.observe(['b'], async () => undefined)
  expect(check).not.toThrow()
  await runtime.observe(['a'], async () => undefined)
  expect(check).toThrow('dispatch read revoked')
  expect(runtime.capture('a')).not.toThrow()
})

it('a read captured during a pending write stays revoked after that write settles', async () => {
  const runtime = fence()
  const gate = deferred()
  const before = runtime.capture('a')
  const write = runtime.observe(['a'], () => gate.promise)
  const during = runtime.capture('a')
  expect(before).toThrow()
  expect(during).toThrow()
  gate.resolve()
  await write
  expect(before).toThrow()
  expect(during).toThrow()
  expect(runtime.capture('a')).not.toThrow()
})

it('overlapping same-key writes keep admission closed until both settle', async () => {
  const runtime = fence()
  const first = deferred()
  const second = deferred()
  const writeA = runtime.observe(['a', 'a'], () => first.promise)
  const writeB = runtime.observe(['a'], () => second.promise)
  first.resolve()
  await writeA
  expect(runtime.capture('a')).toThrow()
  second.resolve()
  await writeB
  expect(runtime.capture('a')).not.toThrow()
})

it('a rejected write releases pending ownership but cannot restore an earlier read', async () => {
  const runtime = fence()
  const before = runtime.capture('a')
  await expect(runtime.observe(['a'], async () => { throw new Error('storage failed') })).rejects.toThrow('storage failed')
  expect(before).toThrow()
  expect(runtime.capture('a')).not.toThrow()
})

it('a synchronous write failure releases pending ownership', async () => {
  const runtime = fence()
  await expect(runtime.observe(['a'], () => { throw new Error('sync failed') })).rejects.toThrow('sync failed')
  expect(runtime.capture('a')).not.toThrow()
})

it('capacity eviction permanently revokes the evicted read without an ABA reopen', () => {
  const runtime = fence(2)
  const first = runtime.capture('a')
  runtime.capture('b')
  const last = runtime.capture('c')
  expect(first).toThrow()
  expect(last).not.toThrow()
  expect(runtime.capture('a')).not.toThrow()
  expect(first).toThrow()
})

it('evicting a pending key cannot erase its admitted write lifetime', async () => {
  const runtime = fence(1)
  const gate = deferred()
  const write = runtime.observe(['a'], () => gate.promise)
  runtime.capture('b')
  const during = runtime.capture('a')
  expect(during).toThrow()
  gate.resolve()
  await write
  expect(during).toThrow()
  expect(runtime.capture('a')).not.toThrow()
})

it('tracks multiple pending keys even when revision capacity is smaller than the admitted set', async () => {
  const runtime = fence(1)
  const gate = deferred()
  const write = runtime.observe(['a', 'b', 'c'], () => gate.promise)
  expect(runtime.capture('a')).toThrow()
  expect(runtime.capture('b')).toThrow()
  expect(runtime.capture('c')).toThrow()
  gate.resolve()
  await write
  expect(runtime.capture('a')).not.toThrow()
  expect(runtime.capture('b')).not.toThrow()
  expect(runtime.capture('c')).not.toThrow()
})

it('captures the admitted key list before awaiting and preserves the write result', async () => {
  const runtime = fence()
  const keys = ['a']
  const gate = deferred()
  const write = runtime.observe(keys, async () => { await gate.promise; return 7 })
  keys[0] = 'b'
  expect(runtime.capture('a')).toThrow()
  expect(runtime.capture('b')).not.toThrow()
  gate.resolve()
  expect(await write).toBe(7)
  expect(runtime.capture('a')).not.toThrow()
})

it('empty evidence changes preserve an existing captured read', async () => {
  const runtime = fence()
  const check = runtime.capture('a')
  await runtime.observe([], async () => undefined)
  expect(check).not.toThrow()
})
