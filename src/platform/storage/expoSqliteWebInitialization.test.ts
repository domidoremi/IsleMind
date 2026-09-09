/** @jest-environment node */
import { expect, it, jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TextDecoder, TextEncoder } from 'node:util'
import { runInNewContext } from 'node:vm'
import { transformSync } from '@babel/core'

// Exercise the installed, patched Web implementation with controlled platform
// boundaries. These host regressions are not browser/OPFS or native evidence.
function loadWebSource<T>(file: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  const filename = join(process.cwd(), 'node_modules/expo-sqlite/web', file)
  const source = transformSync(readFileSync(filename, 'utf8'), {
    filename, configFile: false, babelrc: false,
    plugins: ['@babel/plugin-transform-typescript', '@babel/plugin-transform-modules-commonjs'],
  })!.code!
  const module = { exports: {} }
  runInNewContext(source, {
    module, exports: module.exports, Error, console, TextEncoder, TextDecoder,
    require: (id: string) => {
      if (!(id in dependencies)) throw new Error('Unexpected Web dependency: ' + id)
      return dependencies[id]
    },
    ...globals,
  }, { filename })
  return module.exports as T
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve))

function workerFixture() {
  const results: { id: number; error: Error | null }[] = []
  const self: { onmessage?: (event: unknown) => Promise<void> } = {}
  const persistent: { close: () => Promise<void> }[] = []
  const createPersistent = jest.fn(async () => {
    const value = { close: jest.fn(async () => undefined) }
    persistent.push(value)
    return value
  })
  const createMemory = jest.fn(async () => ({ close: jest.fn(() => undefined) }))
  const factory = jest.fn(async () => ({}))
  let pointer = 0
  const sqlite3 = {
    vfs_register: jest.fn(() => undefined),
    open_v2: jest.fn(async () => ++pointer),
  }
  loadWebSource('worker.ts', {
    './SQLAction': {},
    './SQLiteOptions': { SQLiteOptions: class {
      useNewConnection = true
      enableChangeListener = false
      equals() { return false }
    } },
    './WorkerChannel': { sendWorkerResult: (result: typeof results[number]) => results.push(result) },
    './wa-sqlite/AccessHandlePoolVFS': { AccessHandlePoolVFS: { create: createPersistent } },
    './wa-sqlite/MemoryVFS': { MemoryVFS: { create: createMemory } },
    './wa-sqlite/sqlite-api': { Factory: () => sqlite3 },
    './wa-sqlite/sqlite-constants': { SQLITE_OK: 0, SQLITE_OPEN_READWRITE: 2, SQLITE_OPEN_CREATE: 4 },
    './wa-sqlite/wa-sqlite': factory,
    './wa-sqlite/wa-sqlite.wasm': '/sqlite.wasm',
  }, { self })
  return {
    factory, createPersistent, createMemory, persistent, sqlite3,
    async open(id: number) {
      await self.onmessage!({ data: {
        id, type: 'open', isSync: false,
        data: { nativeDatabaseId: id, databasePath: './test-' + id + '.db', options: { useNewConnection: true } },
      } })
      return results.find((result) => result.id === id)!
    },
  }
}

it('shares complete initialization across simultaneous and mid-initialization requests', async () => {
  const runtime = workerFixture()
  const ready = deferred<Awaited<ReturnType<typeof runtime.createPersistent>>>()
  runtime.createPersistent.mockImplementation(() => ready.promise)
  const first = runtime.open(1)
  const second = runtime.open(2)
  await nextTurn()
  const third = runtime.open(3)
  await nextTurn()
  const opensBeforeReady = runtime.sqlite3.open_v2.mock.calls.length
  ready.resolve({ close: jest.fn(async () => undefined) })
  const results = await Promise.all([first, second, third])
  expect(opensBeforeReady).toBe(0)
  expect(runtime.factory).toHaveBeenCalledTimes(1)
  expect(runtime.createPersistent).toHaveBeenCalledTimes(1)
  expect(runtime.createMemory).toHaveBeenCalledTimes(1)
  expect(results.map((result) => result.error)).toEqual([null, null, null])
  expect(runtime.sqlite3.open_v2).toHaveBeenCalledTimes(3)
})

it('preserves the actual initialization error and permits retry after the cause clears', async () => {
  const runtime = workerFixture()
  const locked = new Error('OPFS handle is owned by another worker')
  locked.name = 'NoModificationAllowedError'
  runtime.createPersistent.mockRejectedValueOnce(locked)
  expect((await runtime.open(1)).error).toBe(locked)
  expect(runtime.sqlite3.open_v2).not.toHaveBeenCalled()
  expect((await runtime.open(2)).error).toBeNull()
  expect(runtime.createPersistent).toHaveBeenCalledTimes(2)
  expect(runtime.sqlite3.open_v2).toHaveBeenCalledTimes(1)
})

it('releases an acquired persistent VFS if later initialization fails, before retrying', async () => {
  const runtime = workerFixture()
  const failure = new Error('memory VFS initialization failed')
  runtime.createMemory.mockRejectedValueOnce(failure)
  expect((await runtime.open(1)).error).toBe(failure)
  expect(runtime.persistent[0].close).toHaveBeenCalledTimes(1)
  expect(runtime.sqlite3.open_v2).not.toHaveBeenCalled()
  expect((await runtime.open(2)).error).toBeNull()
  expect(runtime.persistent).toHaveLength(2)
  expect(runtime.persistent[1].close).not.toHaveBeenCalled()
})

it('drains late OPFS handle acquisitions and closes all acquired handles on pool failure', async () => {
  const locked = new Error('a different file is locked')
  const handle = () => {
    const header = new Uint8Array(4096)
    new Uint32Array(header.buffer, 516, 2).set([0xfecc5f80, 0xaccec037])
    return {
      read(target: ArrayBufferView, options: { at: number }) {
        new Uint8Array(target.buffer, target.byteOffset, target.byteLength)
          .set(header.subarray(options.at, options.at + target.byteLength))
        return target.byteLength
      },
      truncate: jest.fn(() => undefined),
      close: jest.fn(() => undefined),
    }
  }
  const early = handle()
  const late = handle()
  const lateOpen = deferred<ReturnType<typeof handle>>()
  const directory = {
    async getDirectoryHandle() { return directory },
    async *[Symbol.asyncIterator]() {
      yield ['early', { kind: 'file', createSyncAccessHandle: async () => early }]
      yield ['locked', { kind: 'file', createSyncAccessHandle: async () => { throw locked } }]
      yield ['late', { kind: 'file', createSyncAccessHandle: () => lateOpen.promise }]
    },
  }
  const { AccessHandlePoolVFS } = loadWebSource<{
    AccessHandlePoolVFS: { create(name: string, module: object): Promise<unknown> }
  }>('wa-sqlite/AccessHandlePoolVFS.js', {
    './FacadeVFS.js': { FacadeVFS: class {} },
    './VFS.js': { SQLITE_OPEN_MAIN_DB: 0x100, SQLITE_OPEN_MAIN_JOURNAL: 0x800, SQLITE_OPEN_SUPER_JOURNAL: 0x4000, SQLITE_OPEN_WAL: 0x80000 },
  }, { navigator: { storage: { getDirectory: async () => directory } } })
  let settled = false
  const result = AccessHandlePoolVFS.create('test-pool', {}).then(
    () => { settled = true; return undefined },
    (error: unknown) => { settled = true; return error },
  )
  await nextTurn()
  const settledBeforeLateOpen = settled
  lateOpen.resolve(late)
  expect(await result).toBe(locked)
  await nextTurn()
  expect(settledBeforeLateOpen).toBe(false)
  expect(early.close).toHaveBeenCalledTimes(1)
  expect(late.close).toHaveBeenCalledTimes(1)
})
