import {
  createLocalModelStateRepository,
  LOCAL_MODEL_STATE_MAX_ENTRIES,
  LOCAL_MODEL_STATE_MAX_SERIALIZED_LENGTH,
  LOCAL_MODEL_STATE_STORAGE_KEY,
  type LocalModelStateRecord,
  type LocalModelStateRecoveryRepository,
  type LocalModelStateSnapshot,
} from './localModelStateRepository'

const empty = (): LocalModelStateSnapshot => ({ records: {}, failed: {} })
const record = (modelId = 'owned-model'): LocalModelStateRecord => ({
  modelId, source: 'downloaded', bytes: 100, sha256: { 'model.onnx': '0'.repeat(64) },
})
const serialize = (state: unknown) => JSON.stringify(state)

function fixture(...initial: [] | [string | null | undefined]) {
  let raw: string | null | undefined = initial.length === 0 ? serialize(empty()) : initial[0]
  const storage = {
    getItem: jest.fn(async (_key: string, _signal?: AbortSignal) => raw),
    setItem: jest.fn(async (_key: string, value: string, _signal?: AbortSignal) => { raw = value }),
    removeItem: jest.fn(async (_key: string, _signal?: AbortSignal) => { raw = null }),
  }
  return {
    storage,
    repository: createLocalModelStateRepository(storage),
    get raw() { return raw },
    replace(value: string | null | undefined) { raw = value },
    fresh() { return createLocalModelStateRepository(storage) },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

async function flush() {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}

it.each([null, undefined])('treats only absent storage %s as an empty local-model state without writing', async raw => {
  const f = fixture(raw)
  await expect(f.repository.loadState()).resolves.toEqual(empty())
  expect(f.raw).toBe(raw)
  expect(f.storage.setItem).not.toHaveBeenCalled()
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})

it('rejects a storage read failure without substituting an empty state or exposing its detail', async () => {
  const f = fixture()
  f.storage.getItem.mockRejectedValueOnce(new Error('private storage path and token=owned-secret'))
  const error = await f.repository.loadState().catch(error => error)
  expect(error).toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'load' })
  expect(String(error)).not.toMatch(/owned-secret|private storage/)
  expect(f.storage.setItem).not.toHaveBeenCalled()
  await expect(f.repository.loadState()).resolves.toEqual(empty())
  expect(f.storage.getItem).toHaveBeenCalledTimes(2)
})

const invalidStates: [string, string][] = [
  ['empty serialized data', ''],
  ['malformed JSON', '{"records":'],
  ['JSON null', 'null'],
  ['array envelope', '[]'],
  ['unsupported envelope fields', serialize({ ...empty(), schema: 'future-state-v2' })],
  ['missing records', serialize({ failed: {} })],
  ['missing failed map', serialize({ records: {} })],
  ['array records', serialize({ records: [], failed: {} })],
  ['array failed map', serialize({ records: {}, failed: [] })],
  ['mismatched record identity', serialize({ records: { one: record('two') }, failed: {} })],
  ['invalid record source', serialize({ records: { one: { ...record('one'), source: 'future' } }, failed: {} })],
  ['invalid record bytes', serialize({ records: { one: { ...record('one'), bytes: -1 } }, failed: {} })],
  ['unknown record fields', serialize({ records: { one: { ...record('one'), futureMetadata: true } }, failed: {} })],
  ['invalid hash', serialize({ records: { one: { ...record('one'), sha256: { file: 'invalid' } } }, failed: {} })],
  ['too many hashes', serialize({
    records: { one: { ...record('one'), sha256: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`file-${index}`, '0'.repeat(64)])) } },
    failed: {},
  })],
  ['non-string failure', serialize({ records: {}, failed: { one: 123 } })],
  ['oversized failure', serialize({ records: {}, failed: { one: 'x'.repeat(2_049) } })],
  ['invalid failure identity', serialize({ records: {}, failed: { '': 'failure' } })],
  ['too many records', serialize({
    records: Object.fromEntries(Array.from({ length: LOCAL_MODEL_STATE_MAX_ENTRIES + 1 }, (_, index) => [`model-${index}`, record(`model-${index}`)])),
    failed: {},
  })],
  ['too many failures', serialize({
    records: {},
    failed: Object.fromEntries(Array.from({ length: LOCAL_MODEL_STATE_MAX_ENTRIES + 1 }, (_, index) => [`model-${index}`, 'failure'])),
  })],
  ['oversized serialized state', `${' '.repeat(LOCAL_MODEL_STATE_MAX_SERIALIZED_LENGTH)}${serialize(empty())}`],
]

it.each(invalidStates)('retains %s instead of caching a writable partial or empty model directory', async (_description, raw) => {
  const f = fixture(raw)
  await expect(f.repository.loadState()).rejects.toMatchObject({ name: 'LocalModelStateDataError' })
  expect(f.raw).toBe(raw)
  expect(f.storage.setItem).not.toHaveBeenCalled()
  expect(f.storage.removeItem).not.toHaveBeenCalled()
  f.replace(serialize({ records: { recovered: record('recovered') }, failed: {} }))
  await expect(f.repository.loadState()).resolves.toMatchObject({ records: { recovered: record('recovered') } })
  expect(f.storage.getItem).toHaveBeenCalledTimes(2)
})

it.each(['record', 'failure', 'remove'] as const)('refuses a %s mutation after an unreadable existing directory', async kind => {
  const f = fixture()
  f.storage.getItem.mockRejectedValue(new Error('Owned read failure'))
  const operation = kind === 'record'
    ? f.repository.recordInstalledModel(record())
    : kind === 'failure'
      ? f.repository.markModelFailure('owned-model', 'Owned failure')
      : f.repository.removeModel('owned-model')
  await expect(operation).rejects.toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'load' })
  expect(f.storage.setItem).not.toHaveBeenCalled()
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})

it.each(['record', 'failure', 'remove'] as const)('refuses a %s mutation instead of rewriting an invalid saved directory', async kind => {
  const raw = serialize({ records: { one: record('different-id') }, failed: {} })
  const f = fixture(raw)
  const operation = kind === 'record'
    ? f.repository.recordInstalledModel(record())
    : kind === 'failure'
      ? f.repository.markModelFailure('owned-model', 'Owned failure')
      : f.repository.removeModel('owned-model')
  await expect(operation).rejects.toMatchObject({ name: 'LocalModelStateDataError' })
  expect(f.raw).toBe(raw)
  expect(f.storage.setItem).not.toHaveBeenCalled()
})

it('reads the persisted directory again after a previous successful read', async () => {
  const f = fixture(serialize({ records: { one: record('one') }, failed: {} }))
  await f.repository.loadState()
  f.replace(serialize({ records: { two: record('two') }, failed: {} }))
  await expect(f.repository.loadState()).resolves.toEqual({ records: { two: record('two') }, failed: {} })
  expect(f.storage.getItem).toHaveBeenCalledTimes(2)
})

it('does not serve a previous successful read when authoritative storage later fails', async () => {
  const f = fixture(serialize({ records: { one: record('one') }, failed: {} }))
  await f.repository.loadState()
  f.storage.getItem.mockRejectedValueOnce(new Error('Owned later read failure'))
  await expect(f.repository.loadState()).rejects.toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'load' })
})

it('preserves unrelated records that arrived after an earlier directory read', async () => {
  const f = fixture(serialize({ records: { one: record('one') }, failed: {} }))
  await f.repository.loadState()
  f.replace(serialize({ records: { one: record('one'), external: record('external') }, failed: { external: 'Retained failure' } }))
  await f.repository.recordInstalledModel(record('new'))
  const stored = JSON.parse(f.raw!)
  expect(Object.keys(stored.records).sort()).toEqual(['external', 'new', 'one'])
  expect(stored.failed.external).toBe('Retained failure')
})

it('serializes overlapping model installations instead of persisting the same stale base', async () => {
  const f = fixture()
  await Promise.all([f.repository.recordInstalledModel(record('one')), f.repository.recordInstalledModel(record('two'))])
  expect(Object.keys(JSON.parse(f.raw!).records).sort()).toEqual(['one', 'two'])
})

it('serializes a failure marker with an overlapping installation without losing either record', async () => {
  const f = fixture()
  await Promise.all([f.repository.recordInstalledModel(record('one')), f.repository.markModelFailure('two', 'Owned failure')])
  expect(JSON.parse(f.raw!)).toEqual({ records: { one: record('one') }, failed: { two: 'Owned failure' } })
})

it('keeps a readback queued until an already-admitted storage write settles', async () => {
  const f = fixture()
  const write = deferred<void>()
  f.storage.setItem.mockImplementationOnce(async (_key, value) => { await write.promise; f.replace(value) })
  const install = f.repository.recordInstalledModel(record())
  await flush()
  let readSettled = false
  const readback = f.repository.loadState().then(state => { readSettled = true; return state })
  try {
    await flush()
    expect(readSettled).toBe(false)
    expect(f.storage.getItem).toHaveBeenCalledTimes(1)
  } finally {
    write.resolve()
    await install
  }
  await expect(readback).resolves.toEqual({ records: { 'owned-model': record() }, failed: {} })
})

it('does not let clear finish before a previously admitted install can resurrect its directory', async () => {
  const f = fixture()
  const write = deferred<void>()
  f.storage.setItem.mockImplementationOnce(async (_key, value) => { await write.promise; f.replace(value) })
  const install = f.repository.recordInstalledModel(record())
  await flush()
  const clear = f.repository.clear()
  try {
    await flush()
    expect(f.storage.removeItem).not.toHaveBeenCalled()
  } finally {
    write.resolve()
    await Promise.all([install, clear])
  }
  expect(f.raw).toBeNull()
  await expect(f.repository.loadState()).resolves.toEqual(empty())
})

it('retains a queued mutation cancellation reason and never dispatches its storage work', async () => {
  const f = fixture()
  const write = deferred<void>()
  f.storage.setItem.mockImplementationOnce(async (_key, value) => { await write.promise; f.replace(value) })
  const first = f.repository.recordInstalledModel(record('first'))
  await flush()
  const controller = new AbortController()
  const reason = new Error('Retired queued model mutation')
  const second = f.repository.recordInstalledModel(record('second'), { signal: controller.signal })
  const refused = expect(second).rejects.toBe(reason)
  controller.abort(reason)
  try {
    await flush()
    expect(f.storage.setItem).toHaveBeenCalledTimes(1)
  } finally {
    write.resolve()
    await first
    await refused
  }
  expect(Object.keys(JSON.parse(f.raw!).records)).toEqual(['first'])
})

it('reads possible durable storage effects after a write rejection instead of claiming cached rollback', async () => {
  const f = fixture()
  f.storage.setItem.mockImplementationOnce(async (_key, value) => {
    f.replace(value)
    throw new Error('Owned acknowledgement failure')
  })
  await expect(f.repository.recordInstalledModel(record())).rejects.toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'save' })
  await expect(f.repository.loadState()).resolves.toEqual({ records: { 'owned-model': record() }, failed: {} })
  await expect(f.fresh().loadState()).resolves.toEqual({ records: { 'owned-model': record() }, failed: {} })
})

it('permits an already-admitted write to acknowledge after cancellation without claiming rollback', async () => {
  const f = fixture()
  const controller = new AbortController()
  f.storage.setItem.mockImplementationOnce(async (_key, value) => {
    f.replace(value)
    controller.abort(new Error('Retired after storage admission'))
  })
  await expect(f.repository.recordInstalledModel(record(), { signal: controller.signal })).resolves.toEqual(record())
  await expect(f.repository.loadState()).resolves.toEqual({ records: { 'owned-model': record() }, failed: {} })
})

it('does not evict an unseen installed model when the directory is full', async () => {
  const raw = serialize({
    records: Object.fromEntries(Array.from({ length: LOCAL_MODEL_STATE_MAX_ENTRIES }, (_, index) => [`model-${index}`, record(`model-${index}`)])),
    failed: {},
  })
  const f = fixture(raw)
  await expect(f.repository.recordInstalledModel(record('extra'))).rejects.toThrow()
  expect(f.raw).toBe(raw)
  expect(f.storage.setItem).not.toHaveBeenCalled()
  await f.repository.recordInstalledModel({ ...record('model-0'), bytes: 200 })
  expect(Object.keys(JSON.parse(f.raw!).records)).toHaveLength(LOCAL_MODEL_STATE_MAX_ENTRIES)
})

it('does not evict an unseen failure marker when its directory is full', async () => {
  const raw = serialize({
    records: {},
    failed: Object.fromEntries(Array.from({ length: LOCAL_MODEL_STATE_MAX_ENTRIES }, (_, index) => [`model-${index}`, 'Retained failure'])),
  })
  const f = fixture(raw)
  await expect(f.repository.markModelFailure('extra', 'New failure')).rejects.toThrow()
  expect(f.raw).toBe(raw)
  expect(f.storage.setItem).not.toHaveBeenCalled()
})

it('preserves literal dictionary identities without prototype mutation or disappearing records', async () => {
  const f = fixture(serialize({
    records: Object.fromEntries([['__proto__', record('__proto__')]]),
    failed: Object.fromEntries([['constructor', 'Retained failure']]),
  }))
  const state = await f.repository.loadState()
  expect(Object.hasOwn(state.records, '__proto__')).toBe(true)
  expect(Object.getPrototypeOf(state.records)).toBe(Object.prototype)
  expect(state.records.__proto__).toEqual(record('__proto__'))
  await f.repository.recordInstalledModel(record('constructor'))
  expect(Object.keys(JSON.parse(f.raw!).records).sort()).toEqual(['__proto__', 'constructor'])
})

it('persists a literal prototype-named newly installed record as an own data key', async () => {
  const f = fixture()
  await f.repository.recordInstalledModel(record('__proto__'))
  expect(Object.hasOwn(JSON.parse(f.raw!).records, '__proto__')).toBe(true)
})

it('preserves valid literal hash paths across load, detached copies and subsequent saves', async () => {
  const hashes = Object.fromEntries([
    ['__proto__', '0'.repeat(64)],
    ['constructor', '1'.repeat(64)],
    ['model.onnx', '2'.repeat(64)],
  ])
  const f = fixture(serialize({ records: { one: { ...record('one'), sha256: hashes } }, failed: {} }))
  const state = await f.repository.loadState()
  expect(Object.keys(state.records.one.sha256!).sort()).toEqual(Object.keys(hashes).sort())
  expect(state.records.one.sha256).toEqual(hashes)
  await f.repository.recordInstalledModel(record('two'))
  expect(JSON.parse(f.raw!).records.one.sha256).toEqual(hashes)
  const installed = await f.repository.recordInstalledModel({ ...record('three'), sha256: hashes })
  expect(installed.sha256).toEqual(hashes)
  expect(JSON.parse(f.raw!).records.three.sha256).toEqual(hashes)
})

it('preserves a prototype-named failure marker across detached reads and new mutations', async () => {
  const f = fixture(serialize({
    records: {},
    failed: Object.fromEntries([['__proto__', 'Retained literal failure']]),
  }))
  const state = await f.repository.loadState()
  expect(Object.hasOwn(state.failed, '__proto__')).toBe(true)
  expect(state.failed.__proto__).toBe('Retained literal failure')
  await f.repository.markModelFailure('two', 'Second failure')
  expect(JSON.parse(f.raw!).failed.__proto__).toBe('Retained literal failure')
  await f.repository.markModelFailure('__proto__', 'Updated literal failure')
  expect(Object.hasOwn(JSON.parse(f.raw!).failed, '__proto__')).toBe(true)
  expect(JSON.parse(f.raw!).failed.__proto__).toBe('Updated literal failure')
})

it('returns detached records and hashes while preserving exact storage signals', async () => {
  const f = fixture(serialize({ records: { one: record('one') }, failed: {} }))
  const controller = new AbortController()
  const state = await f.repository.loadState({ signal: controller.signal })
  state.records.one.sha256!['model.onnx'] = 'f'.repeat(64)
  state.records.one.bytes = 500
  await expect(f.repository.loadState()).resolves.toEqual({ records: { one: record('one') }, failed: {} })
  expect(f.storage.getItem).toHaveBeenCalledWith(LOCAL_MODEL_STATE_STORAGE_KEY, controller.signal)
  await f.repository.recordInstalledModel(record('two'), { signal: controller.signal })
  expect(f.storage.setItem).toHaveBeenLastCalledWith(LOCAL_MODEL_STATE_STORAGE_KEY, expect.any(String), controller.signal)
})

it('allows only an explicit clear to remove an invalid directory and preserves failed removal bytes', async () => {
  const raw = '{"unsupported":"owned"}'
  const f = fixture(raw)
  f.storage.removeItem.mockRejectedValueOnce(new Error('Owned remove failure'))
  await expect(f.repository.clear()).rejects.toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'remove' })
  expect(f.raw).toBe(raw)
  await f.repository.clear()
  expect(f.raw).toBeNull()
  await expect(f.repository.loadState()).resolves.toEqual(empty())
})

it.each(['load', 'record', 'failure', 'remove', 'clear'] as const)('refuses an already-aborted %s before any storage admission', async kind => {
  const f = fixture()
  const controller = new AbortController()
  const reason = new Error('Retired before storage')
  controller.abort(reason)
  const options = { signal: controller.signal }
  const operation = kind === 'load' ? f.repository.loadState(options)
    : kind === 'record' ? f.repository.recordInstalledModel(record(), options)
      : kind === 'failure' ? f.repository.markModelFailure('owned-model', 'Failure', options)
        : kind === 'remove' ? f.repository.removeModel('owned-model', options)
          : f.repository.clear(options)
  await expect(operation).rejects.toBe(reason)
  expect(f.storage.getItem).not.toHaveBeenCalled()
  expect(f.storage.setItem).not.toHaveBeenCalled()
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})

const recovery = (f: ReturnType<typeof fixture>) => f.repository as LocalModelStateRecoveryRepository
const invalidRecoveryState = '{"schema":"future-model-state","records":{},"failed":{},"private":"owned-recovery-token"}'

it('reviews invalid model metadata without exposing raw bytes or deleting it before explicit reset', async () => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  expect(review).not.toBeNull()
  expect(Object.isFrozen(review)).toBe(true)
  expect(Object.keys(review!)).toEqual(['reset'])
  expect(JSON.stringify(review)).not.toContain('owned-recovery-token')
  expect(f.raw).toBe(invalidRecoveryState)
  expect(f.storage.removeItem).not.toHaveBeenCalled()
  expect(f.storage.setItem).not.toHaveBeenCalled()
  await review!.reset()
  expect(f.raw).toBeNull()
  expect(f.storage.getItem).toHaveBeenCalledTimes(2)
  expect(f.storage.removeItem).toHaveBeenCalledTimes(1)
  await expect(f.repository.loadState()).resolves.toEqual(empty())
})

it.each([
  ['malformed JSON', '{"records":'],
  ['invalid record identity', serialize({ records: { one: record('different') }, failed: {} })],
  ['oversized serialized state', ' '.repeat(LOCAL_MODEL_STATE_MAX_SERIALIZED_LENGTH + 1)],
])('permits a reviewed metadata-only reset of %s without a partial writable catalog', async (_description, raw) => {
  const f = fixture(raw)
  const review = await recovery(f).reviewInvalidState()
  expect(review).not.toBeNull()
  expect(f.raw).toBe(raw)
  expect(f.storage.setItem).not.toHaveBeenCalled()
  expect(f.storage.removeItem).not.toHaveBeenCalled()
  await review!.reset()
  expect(f.raw).toBeNull()
})

it.each([
  ['absent null', null],
  ['absent undefined', undefined],
  ['supported empty state', serialize(empty())],
  ['supported installed state', serialize({ records: { one: record('one') }, failed: { two: 'Retained failure' } })],
] as [string, string | null | undefined][])('never offers destructive recovery for %s', async (_description, raw) => {
  const f = fixture(raw)
  await expect(recovery(f).reviewInvalidState()).resolves.toBeNull()
  expect(f.raw).toBe(raw)
  expect(f.storage.setItem).not.toHaveBeenCalled()
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})

it('refuses a recovery review when authoritative storage cannot be read and redacts its detail', async () => {
  const f = fixture(invalidRecoveryState)
  f.storage.getItem.mockRejectedValueOnce(new Error('private path token=owned-recovery-token'))
  const error = await recovery(f).reviewInvalidState().catch(error => error)
  expect(error).toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'load' })
  expect(String(error)).not.toContain('owned-recovery-token')
  expect(f.storage.removeItem).not.toHaveBeenCalled()
  expect(f.raw).toBe(invalidRecoveryState)
})

it('refuses an already-aborted recovery review before reading any model metadata', async () => {
  const f = fixture(invalidRecoveryState)
  const controller = new AbortController()
  const reason = new Error('Retired recovery review')
  controller.abort(reason)
  await expect(recovery(f).reviewInvalidState({ signal: controller.signal })).rejects.toBe(reason)
  expect(f.storage.getItem).not.toHaveBeenCalled()
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})

it('rejects a reviewed reset when persisted bytes changed, even if the replacement is also invalid', async () => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  const replacement = '{"schema":"another-invalid-state"}'
  f.replace(replacement)
  await expect(review!.reset()).rejects.toMatchObject({ name: 'LocalModelStateRecoveryConflictError' })
  expect(f.raw).toBe(replacement)
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})

it('invalidates changed-and-restored recovery consent after this repository observed both versions', async () => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  f.replace('{"schema":"changed-invalid-state"}')
  await expect(f.repository.loadState()).rejects.toMatchObject({ name: 'LocalModelStateDataError' })
  f.replace(invalidRecoveryState)
  await expect(f.repository.loadState()).rejects.toMatchObject({ name: 'LocalModelStateDataError' })
  await expect(review!.reset()).rejects.toMatchObject({ name: 'LocalModelStateRecoveryConflictError' })
  expect(f.raw).toBe(invalidRecoveryState)
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})

it('invalidates reviewed recovery after an admitted clear even when external bytes are restored', async () => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  await f.repository.clear()
  f.replace(invalidRecoveryState)
  await expect(review!.reset()).rejects.toMatchObject({ name: 'LocalModelStateRecoveryConflictError' })
  expect(f.raw).toBe(invalidRecoveryState)
  expect(f.storage.removeItem).toHaveBeenCalledTimes(1)
})

it('invalidates a reviewed reset after another removal acknowledgement failed without claiming rollback', async () => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  f.storage.removeItem.mockRejectedValueOnce(new Error('Owned unclear removal acknowledgement'))
  await expect(f.repository.clear()).rejects.toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'remove' })
  await expect(review!.reset()).rejects.toMatchObject({ name: 'LocalModelStateRecoveryConflictError' })
  expect(f.raw).toBe(invalidRecoveryState)
  expect(f.storage.removeItem).toHaveBeenCalledTimes(1)
})

it('does not delete on a reset preflight read error and permits explicit retry before any removal admission', async () => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  f.storage.getItem.mockRejectedValueOnce(new Error('Owned preflight read failed'))
  await expect(review!.reset()).rejects.toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'load' })
  expect(f.storage.removeItem).not.toHaveBeenCalled()
  expect(f.raw).toBe(invalidRecoveryState)
  await review!.reset()
  expect(f.raw).toBeNull()
  expect(f.storage.removeItem).toHaveBeenCalledTimes(1)
})

it('binds a reviewed reset to its original lifetime instead of reviving it with a different signal', async () => {
  const f = fixture(invalidRecoveryState)
  const controller = new AbortController()
  const reason = new Error('Retired after recovery review')
  const review = await recovery(f).reviewInvalidState({ signal: controller.signal })
  controller.abort(reason)
  await expect(review!.reset({ signal: new AbortController().signal })).rejects.toBe(reason)
  expect(f.storage.getItem).toHaveBeenCalledTimes(1)
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})

it('refuses an already-aborted reset before a new authoritative read or removal', async () => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  const controller = new AbortController()
  const reason = new Error('Retired explicit reset')
  controller.abort(reason)
  await expect(review!.reset({ signal: controller.signal })).rejects.toBe(reason)
  expect(f.storage.getItem).toHaveBeenCalledTimes(1)
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})

it('refuses new removal when a reset is cancelled through its awaited preflight read', async () => {
  const f = fixture(invalidRecoveryState)
  const controller = new AbortController()
  const review = await recovery(f).reviewInvalidState({ signal: controller.signal })
  const read = deferred<string>()
  f.storage.getItem.mockImplementationOnce(async () => read.promise)
  const reset = review!.reset()
  const reason = new Error('Retired during reset preflight')
  const refused = expect(reset).rejects.toBe(reason)
  try {
    await flush()
    expect(f.storage.getItem).toHaveBeenCalledTimes(2)
    controller.abort(reason)
  } finally {
    read.resolve(invalidRecoveryState)
    await refused
  }
  expect(f.storage.removeItem).not.toHaveBeenCalled()
  expect(f.raw).toBe(invalidRecoveryState)
})

it('fences a queued reset cancellation before it can dispatch any new storage work', async () => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  const read = deferred<string>()
  f.storage.getItem.mockImplementationOnce(async () => read.promise)
  const first = f.repository.loadState().catch(error => error)
  await flush()
  const controller = new AbortController()
  const reason = new Error('Retired while reset was queued')
  const reset = review!.reset({ signal: controller.signal })
  const refused = expect(reset).rejects.toBe(reason)
  controller.abort(reason)
  try {
    await flush()
    expect(f.storage.getItem).toHaveBeenCalledTimes(2)
  } finally {
    read.resolve(invalidRecoveryState)
    await first
    await refused
  }
  expect(f.storage.getItem).toHaveBeenCalledTimes(2)
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})

it('keeps readback queued until an already-admitted reviewed removal settles', async () => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  const removal = deferred<void>()
  f.storage.removeItem.mockImplementationOnce(async () => { await removal.promise; f.replace(null) })
  const reset = review!.reset()
  await flush()
  let settled = false
  const readback = f.repository.loadState().then(state => { settled = true; return state })
  try {
    await flush()
    expect(settled).toBe(false)
    expect(f.storage.getItem).toHaveBeenCalledTimes(2)
  } finally {
    removal.resolve()
    await reset
  }
  await expect(readback).resolves.toEqual(empty())
})

it('consumes reset consent at removal admission and never retries a failed acknowledgement with the same review', async () => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  f.storage.removeItem.mockRejectedValueOnce(new Error('private reset path token=owned-recovery-token'))
  const error = await review!.reset().catch(error => error)
  expect(error).toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'remove' })
  expect(String(error)).not.toContain('owned-recovery-token')
  expect(f.raw).toBe(invalidRecoveryState)
  await expect(review!.reset()).rejects.toMatchObject({ name: 'LocalModelStateRecoveryConflictError' })
  expect(f.storage.removeItem).toHaveBeenCalledTimes(1)
  const newReview = await recovery(f).reviewInvalidState()
  await newReview!.reset()
  expect(f.raw).toBeNull()
  expect(f.storage.removeItem).toHaveBeenCalledTimes(2)
})

it('reads possible committed reset effects after acknowledgement failure without cached rollback or repeated removal', async () => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  f.storage.removeItem.mockImplementationOnce(async () => {
    f.replace(null)
    throw new Error('Owned reset acknowledgement failed after commit')
  })
  await expect(review!.reset()).rejects.toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'remove' })
  await expect(f.repository.loadState()).resolves.toEqual(empty())
  await expect(review!.reset()).rejects.toMatchObject({ name: 'LocalModelStateRecoveryConflictError' })
  expect(f.storage.removeItem).toHaveBeenCalledTimes(1)
  await expect(recovery(f).reviewInvalidState()).resolves.toBeNull()
})

it('acknowledges an already-admitted reset after cancellation without claiming storage rollback', async () => {
  const f = fixture(invalidRecoveryState)
  const controller = new AbortController()
  const review = await recovery(f).reviewInvalidState({ signal: controller.signal })
  f.storage.removeItem.mockImplementationOnce(async () => {
    f.replace(null)
    controller.abort(new Error('Retired after reset removal admission'))
  })
  await expect(review!.reset()).resolves.toBeUndefined()
  await expect(f.repository.loadState()).resolves.toEqual(empty())
  expect(f.storage.removeItem).toHaveBeenCalledWith(LOCAL_MODEL_STATE_STORAGE_KEY, controller.signal)
})

it('never reviews a non-string storage-port result as a safely resettable metadata snapshot', async () => {
  const f = fixture(invalidRecoveryState)
  f.storage.getItem.mockResolvedValueOnce({ records: {}, failed: {} } as unknown as string)
  await expect(recovery(f).reviewInvalidState()).rejects.toMatchObject({ name: 'LocalModelStateDataError' })
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})

it.each(['record', 'failure', 'remove'] as const)('invalidates recovery consent after an admitted %s mutation fails its strict metadata preflight', async kind => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  const operation = kind === 'record' ? f.repository.recordInstalledModel(record())
    : kind === 'failure' ? f.repository.markModelFailure('owned-model', 'Owned failure')
      : f.repository.removeModel('owned-model')
  await expect(operation).rejects.toMatchObject({ name: 'LocalModelStateDataError' })
  await expect(review!.reset()).rejects.toMatchObject({ name: 'LocalModelStateRecoveryConflictError' })
  expect(f.raw).toBe(invalidRecoveryState)
  expect(f.storage.setItem).not.toHaveBeenCalled()
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})

it.each(['resolved', 'rejected'] as const)('serializes concurrent reset consent through a %s removal acknowledgement without replay', async outcome => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  const removal = deferred<void>()
  f.storage.removeItem.mockImplementationOnce(async () => {
    await removal.promise
    if (outcome === 'rejected') throw new Error('Owned concurrent removal acknowledgement failed')
    f.replace(null)
  })
  const first = review!.reset().catch(error => error)
  const second = review!.reset()
  const refused = expect(second).rejects.toMatchObject({ name: 'LocalModelStateRecoveryConflictError' })
  try {
    await flush()
    expect(f.storage.removeItem).toHaveBeenCalledTimes(1)
    expect(f.storage.getItem).toHaveBeenCalledTimes(2)
  } finally {
    removal.resolve()
    const acknowledgement = await first
    if (outcome === 'rejected') expect(acknowledgement).toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'remove' })
    else expect(acknowledgement).toBeUndefined()
    await refused
  }
  expect(f.storage.removeItem).toHaveBeenCalledTimes(1)
  expect(f.storage.getItem).toHaveBeenCalledTimes(2)
})

it.each(['resolved', 'rejected'] as const)('invalidates a second independent review after a %s removal even if the same invalid bytes are restored', async outcome => {
  const f = fixture(invalidRecoveryState)
  const first = await recovery(f).reviewInvalidState()
  const second = await recovery(f).reviewInvalidState()
  if (outcome === 'rejected') f.storage.removeItem.mockRejectedValueOnce(new Error('Owned admitted removal failed'))
  const acknowledgement = await first!.reset().catch(error => error)
  if (outcome === 'rejected') expect(acknowledgement).toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'remove' })
  else expect(acknowledgement).toBeUndefined()
  f.replace(invalidRecoveryState)
  await expect(second!.reset()).rejects.toMatchObject({ name: 'LocalModelStateRecoveryConflictError' })
  expect(f.raw).toBe(invalidRecoveryState)
  expect(f.storage.removeItem).toHaveBeenCalledTimes(1)
})

it.each(['resolved', 'rejected'] as const)('preserves original recovery lifetime cancellation during a %s reset read using a different signal', async outcome => {
  const f = fixture(invalidRecoveryState)
  const original = new AbortController()
  const override = new AbortController()
  const review = await recovery(f).reviewInvalidState({ signal: original.signal })
  const read = deferred<string>()
  f.storage.getItem.mockImplementationOnce(async () => read.promise)
  const reset = review!.reset({ signal: override.signal })
  const reason = new Error('Retired original consent during override read')
  const refused = expect(reset).rejects.toBe(reason)
  try {
    await flush()
    expect(f.storage.getItem).toHaveBeenLastCalledWith(LOCAL_MODEL_STATE_STORAGE_KEY, override.signal)
    original.abort(reason)
  } finally {
    if (outcome === 'resolved') read.resolve(invalidRecoveryState)
    else read.reject(new Error('Owned late override read refusal'))
    await refused
  }
  expect(f.raw).toBe(invalidRecoveryState)
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})

it('fences a queued reset against its original retired lifetime even when its replacement signal stays live', async () => {
  const f = fixture(invalidRecoveryState)
  const original = new AbortController()
  const review = await recovery(f).reviewInvalidState({ signal: original.signal })
  const read = deferred<string>()
  f.storage.getItem.mockImplementationOnce(async () => read.promise)
  const blocking = f.repository.loadState().catch(error => error)
  await flush()
  const reason = new Error('Retired original consent in queue')
  const reset = review!.reset({ signal: new AbortController().signal })
  const refused = expect(reset).rejects.toBe(reason)
  original.abort(reason)
  try {
    await flush()
    expect(f.storage.getItem).toHaveBeenCalledTimes(2)
  } finally {
    read.resolve(invalidRecoveryState)
    await blocking
    await refused
  }
  expect(f.storage.getItem).toHaveBeenCalledTimes(2)
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})

it('does not invalidate reviewed consent for a cancelled queued mutation that never enters storage admission', async () => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  const read = deferred<string>()
  f.storage.getItem.mockImplementationOnce(async () => read.promise)
  const blocking = f.repository.loadState().catch(error => error)
  await flush()
  const controller = new AbortController()
  const reason = new Error('Retired before queued mutation admission')
  const mutation = f.repository.markModelFailure('owned-model', 'Never admitted', { signal: controller.signal })
  const refused = expect(mutation).rejects.toBe(reason)
  controller.abort(reason)
  read.resolve(invalidRecoveryState)
  await blocking
  await refused
  await review!.reset()
  expect(f.raw).toBeNull()
  expect(f.storage.getItem).toHaveBeenCalledTimes(3)
  expect(f.storage.setItem).not.toHaveBeenCalled()
  expect(f.storage.removeItem).toHaveBeenCalledTimes(1)
})

it('recovery-admission guard checks current caller consent after the awaited authoritative read before removal', async () => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  const read = deferred<string>()
  const isCurrent = jest.fn(() => true)
  f.storage.getItem.mockImplementationOnce(async () => read.promise)
  const reset = review!.reset({ isCurrent })
  try {
    await flush()
    expect(isCurrent).not.toHaveBeenCalled()
    expect(f.storage.removeItem).not.toHaveBeenCalled()
  } finally {
    read.resolve(invalidRecoveryState)
    await reset
  }
  expect(isCurrent).toHaveBeenCalledTimes(1)
  expect(isCurrent).toHaveBeenCalledWith()
  expect(f.storage.removeItem).toHaveBeenCalledTimes(1)
})

it('recovery-admission guard refuses stale caller consent without consuming unadmitted removal consent', async () => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  await expect(review!.reset({ isCurrent: () => false })).rejects.toMatchObject({ name: 'LocalModelStateRecoveryConflictError' })
  expect(f.raw).toBe(invalidRecoveryState)
  expect(f.storage.removeItem).not.toHaveBeenCalled()
  await review!.reset({ isCurrent: () => true })
  expect(f.raw).toBeNull()
  expect(f.storage.removeItem).toHaveBeenCalledTimes(1)
})

it('recovery-admission guard captures the caller predicate before queuing rather than accepting a later replacement', async () => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  const read = deferred<string>()
  f.storage.getItem.mockImplementationOnce(async () => read.promise)
  const blocking = f.repository.loadState().catch(error => error)
  await flush()
  const options = { isCurrent: () => false }
  const reset = review!.reset(options)
  const refused = expect(reset).rejects.toMatchObject({ name: 'LocalModelStateRecoveryConflictError' })
  options.isCurrent = () => true
  read.resolve(invalidRecoveryState)
  await blocking
  await refused
  expect(f.raw).toBe(invalidRecoveryState)
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})

it('recovery-admission guard rechecks the original lifetime if the predicate retires it immediately before removal', async () => {
  const f = fixture(invalidRecoveryState)
  const controller = new AbortController()
  const reason = new Error('Retired by current-consent predicate')
  const review = await recovery(f).reviewInvalidState({ signal: controller.signal })
  await expect(review!.reset({ isCurrent: () => { controller.abort(reason); return true } })).rejects.toBe(reason)
  expect(f.raw).toBe(invalidRecoveryState)
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})

it('recovery-admission guard refuses a non-boolean thenable instead of treating it as current consent', async () => {
  const f = fixture(invalidRecoveryState)
  const review = await recovery(f).reviewInvalidState()
  await expect(review!.reset({ isCurrent: () => Promise.resolve(true) as unknown as boolean }))
    .rejects.toMatchObject({ name: 'LocalModelStateRecoveryConflictError' })
  expect(f.raw).toBe(invalidRecoveryState)
  expect(f.storage.removeItem).not.toHaveBeenCalled()
})
