import { createAndroidFileOperationsPort, type AndroidFileOperationsNativeModule } from './androidFileOperations'

function setup() {
  const native: AndroidFileOperationsNativeModule = {
    fileOperationVersion: 1,
    executeFileOperation: jest.fn(async (requestId, action) => ({
      requestId, action, status: 'succeeded', effect: 'applied', bytesCopied: 12,
      targetUri: 'content://files/tree/root/document/result',
      data: { ok: true, action, status: 'done', targetUri: 'content://files/tree/root/document/result' },
    })),
    cancelFileOperation: jest.fn(async () => true),
  }
  return { native, port: createAndroidFileOperationsPort({ os: 'android', nativeModule: native }) }
}

test('requires the versioned native contract, never falls back to an unsafe legacy write', async () => {
  const { native } = setup()
  for (const deps of [{ os: 'web', nativeModule: native }, { os: 'android' }, { os: 'android', nativeModule: { ...native, fileOperationVersion: 0 } }]) {
    const port = createAndroidFileOperationsPort(deps)
    expect(port.isAvailable()).toBe(false)
    expect(await port.execute('rename', {})).toMatchObject({ status: 'failed', reason: 'unavailable', effect: 'none' })
  }
  expect(native.executeFileOperation).not.toHaveBeenCalled()
})

test('pre-cancelled requests do not dispatch', async () => {
  const { port, native } = setup()
  const controller = new AbortController(); controller.abort()
  expect(await port.execute('copy', {}, controller.signal)).toMatchObject({ status: 'cancelled', effect: 'none' })
  expect(native.executeFileOperation).not.toHaveBeenCalled()
})

test('cancellation waits for the real receipt and preserves partial changes', async () => {
  const { port, native } = setup()
  let finish!: (value: unknown) => void
  let id = ''
  native.executeFileOperation = jest.fn((requestId) => { id = requestId; return new Promise(resolve => { finish = resolve }) })
  const controller = new AbortController()
  let settled = false
  const result = port.execute('copy', {}, controller.signal).then(value => { settled = true; return value })
  controller.abort()
  await Promise.resolve()
  expect(settled).toBe(false)
  expect(native.cancelFileOperation).toHaveBeenCalledWith(id)
  finish({ requestId: id, action: 'copy', status: 'cancelled', effect: 'partial', bytesCopied: 128,
    targetUri: 'content://files/tree/root/document/partial', reason: 'cancelled' })
  expect(await result).toMatchObject({ status: 'cancelled', effect: 'partial', bytesCopied: 128, targetUri: expect.stringContaining('/partial') })
})

test('late abort retains applied effect and removes the abort listener', async () => {
  const { port, native } = setup()
  const controller = new AbortController()
  const remove = jest.spyOn(controller.signal, 'removeEventListener')
  const pending = port.execute('rename', {}, controller.signal)
  controller.abort()
  expect(await pending).toMatchObject({ status: 'succeeded', effect: 'applied', bytesCopied: 12 })
  expect(remove).toHaveBeenCalledTimes(1)
  expect(native.executeFileOperation).toHaveBeenCalledTimes(1)
})

test('awaits durable intent before dispatch and never dispatches when its commit fails', async () => {
  const { port, native } = setup()
  let commit!: () => void
  const barrier = new Promise<void>(resolve => { commit = resolve })
  const before = jest.fn((_id: string) => barrier)
  const pending = port.execute('copy', {}, undefined, before)
  expect(before).toHaveBeenCalledTimes(1)
  expect(native.executeFileOperation).not.toHaveBeenCalled()
  commit()
  const receipt = await pending
  expect(receipt.requestId).toBe(before.mock.calls[0][0])
  await expect(port.execute('copy', {}, undefined, async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
  expect(native.executeFileOperation).toHaveBeenCalledTimes(1)
})

test('cancellation during intent persistence produces an exact no-effect receipt without native dispatch', async () => {
  const { port, native } = setup()
  const controller = new AbortController()
  let id = ''
  const result = await port.execute('copy', {}, controller.signal, async value => { id = value; controller.abort() })
  expect(result).toMatchObject({ requestId: id, status: 'cancelled', effect: 'none', bytesCopied: 0 })
  expect(native.executeFileOperation).not.toHaveBeenCalled()
})

test('native failure and bridge rejection cannot become success or safe replay', async () => {
  const { port, native } = setup()
  native.executeFileOperation = jest.fn(async (requestId, action) => ({ requestId, action,
    status: 'failed', effect: 'uncertain', bytesCopied: 0, reason: 'io_error', completedSteps: ['moved'] }))
  expect(await port.execute('move', {})).toMatchObject({ status: 'failed', effect: 'uncertain', reason: 'io_error', completedSteps: ['moved'] })
  native.executeFileOperation = jest.fn(async () => { throw new Error('bridge lost') })
  expect(await port.execute('move', {})).toMatchObject({ status: 'failed', effect: 'uncertain', reason: 'bridge_error' })
  expect(await port.execute('scan', {})).toMatchObject({ status: 'failed', effect: 'none' })
})

test.each([
  { requestId: 'wrong' }, { status: 'done' }, { effect: 'partial' }, { bytesCopied: -1 },
  { bytesCopied: 65 * 1024 * 1024 }, { data: {} }, { targetUri: 'file:///private' },
  { effect: 'none', bytesCopied: 0, completedSteps: ['created'], data: { ok: false, status: 'skipped' } },
])('malformed or mismatched receipt fails closed: %j', async override => {
  const { port, native } = setup()
  native.executeFileOperation = jest.fn(async (requestId, action) => ({ requestId, action,
    status: 'succeeded', effect: 'applied', bytesCopied: 0,
    targetUri: 'content://files/tree/root/document/result',
    data: { ok: true, status: 'done', targetUri: 'content://files/tree/root/document/result' }, ...override }))
  expect(await port.execute('copy', {})).toMatchObject({ status: 'failed', effect: 'uncertain', reason: 'invalid_receipt' })
})
