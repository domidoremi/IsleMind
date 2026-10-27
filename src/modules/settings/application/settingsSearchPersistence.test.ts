import {
  createSettingsSearchPersistence,
  SETTINGS_SEARCH_MAX_LENGTH,
  SETTINGS_SEARCH_SCHEMA,
  type SettingsSearchRecord,
} from './settingsSearchPersistence'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

it('restores only a bounded search record without rewriting it on load', async () => {
  const write = jest.fn().mockResolvedValue(undefined)
  const search = createSettingsSearchPersistence({
    read: async () => ({ schema: SETTINGS_SEARCH_SCHEMA, query: 'x'.repeat(800), provider: 'do-not-apply' }),
    write,
  })
  await search.load()
  expect(search.getSnapshot()).toEqual({ query: 'x'.repeat(SETTINGS_SEARCH_MAX_LENGTH), hydrated: true, pending: false, failure: null })
  expect(write).not.toHaveBeenCalled()
})

it.each([null, [], { schema: 'unknown', query: 'ignore' }, { schema: SETTINGS_SEARCH_SCHEMA, query: false }])(
  'treats an absent or invalid search record as empty without removing user data',
  async raw => {
    const write = jest.fn().mockResolvedValue(undefined)
    const search = createSettingsSearchPersistence({ read: async () => raw, write })
    await search.load()
    expect(search.getSnapshot().query).toBe('')
    expect(write).not.toHaveBeenCalled()
  },
)

it('never replaces typing or an explicit clear with a delayed hydration result', async () => {
  for (const query of ['current input', '']) {
    const read = deferred<unknown>()
    const written: SettingsSearchRecord[] = []
    const search = createSettingsSearchPersistence({ read: () => read.promise, write: async record => { written.push(record) } })
    const loading = search.load()
    await search.setQuery(query)
    read.resolve({ schema: SETTINGS_SEARCH_SCHEMA, query: 'old search' })
    await loading
    expect(search.getSnapshot().query).toBe(query)
    expect(written).toEqual([{ schema: SETTINGS_SEARCH_SCHEMA, query }])
  }
})

it('serializes storage writes and retains the latest pending state until it is durable', async () => {
  const first = deferred<void>()
  const second = deferred<void>()
  const write = jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const search = createSettingsSearchPersistence({ read: async () => null, write })
  const early = search.setQuery('t')
  const latest = search.setQuery('temperature')
  await Promise.resolve()
  expect(write).toHaveBeenCalledTimes(1)
  first.resolve()
  await early
  expect(search.getSnapshot()).toMatchObject({ query: 'temperature', pending: true })
  await Promise.resolve()
  expect(write).toHaveBeenCalledTimes(2)
  second.resolve()
  await latest
  expect(search.getSnapshot()).toMatchObject({ query: 'temperature', pending: false, failure: null })
})

it('keeps input on storage failure and retries the same query without blocking later edits', async () => {
  const write = jest.fn().mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValue(undefined)
  const search = createSettingsSearchPersistence({ read: async () => null, write })
  await expect(search.setQuery('MCP')).rejects.toThrow('disk unavailable')
  expect(search.getSnapshot()).toMatchObject({ query: 'MCP', pending: false, failure: 'save' })
  await search.retry()
  expect(write).toHaveBeenLastCalledWith({ schema: SETTINGS_SEARCH_SCHEMA, query: 'MCP' })
  expect(search.getSnapshot().failure).toBeNull()
  await search.setQuery('skills')
  expect(search.getSnapshot().query).toBe('skills')
})

it('exposes a failed read and permits a retry without treating failure as an empty saved record', async () => {
  const read = jest.fn().mockRejectedValueOnce(new Error('read unavailable'))
    .mockResolvedValue({ schema: SETTINGS_SEARCH_SCHEMA, query: 'memory' })
  const write = jest.fn()
  const search = createSettingsSearchPersistence({ read, write })
  await expect(search.load()).rejects.toThrow('read unavailable')
  expect(search.getSnapshot()).toMatchObject({ hydrated: false, failure: 'load' })
  await search.retry()
  expect(search.getSnapshot()).toMatchObject({ query: 'memory', hydrated: true, failure: null })
  expect(write).not.toHaveBeenCalled()
})

it('does not publish a stale failure over a newer successful edit and releases listeners', async () => {
  const first = deferred<void>()
  const write = jest.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined)
  const search = createSettingsSearchPersistence({ read: async () => null, write })
  const listener = jest.fn()
  const release = search.subscribe(listener)
  const early = search.setQuery('earlier')
  const failure = expect(early).rejects.toThrow('old failure')
  const latest = search.setQuery('newer')
  first.reject(new Error('old failure'))
  await failure
  await latest
  expect(search.getSnapshot()).toMatchObject({ query: 'newer', pending: false, failure: null })
  release()
  const calls = listener.mock.calls.length
  await search.setQuery('after unmount')
  expect(listener).toHaveBeenCalledTimes(calls)
})
