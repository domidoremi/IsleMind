import { retryWebSqliteOpen } from './expoSqliteDatabase'

const message = "NoModificationAllowedError: Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle'"

function simulateBrowser() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { value: {}, configurable: true })
  return () => {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}

it('reopens after a worker releases its OPFS access handle', async () => {
  const restore = simulateBrowser()
  try {
    const opened = {}
    const open = jest.fn().mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce(opened)
    await expect(retryWebSqliteOpen(open)).resolves.toBe(opened)
    expect(open).toHaveBeenCalledTimes(2)
  } finally { restore() }
})

it('returns the last file conflict after the retry budget is spent', async () => {
  const restore = simulateBrowser()
  try {
    const last = new Error(message)
    const open = jest.fn().mockRejectedValueOnce(new Error(message)).mockRejectedValueOnce(new Error(message)).mockRejectedValue(last)
    await expect(retryWebSqliteOpen(open)).rejects.toBe(last)
    expect(open).toHaveBeenCalledTimes(3)
  } finally { restore() }
})

it.each(['NotAllowedError: createSyncAccessHandle', 'NoModificationAllowedError: permission denied', 'database is corrupt'])(
  'propagates other database failures immediately (%s)', async detail => {
    const restore = simulateBrowser()
    try {
      const error = new Error(detail), open = jest.fn().mockRejectedValue(error)
      await expect(retryWebSqliteOpen(open)).rejects.toBe(error)
      expect(open).toHaveBeenCalledTimes(1)
    } finally { restore() }
  },
)
