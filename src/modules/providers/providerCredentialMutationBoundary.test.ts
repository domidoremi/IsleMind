import { createProviderCredentialStorage, providerCredentialGroupStorageKey, providerCredentialStorageKey } from './providerCredentialStorage'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

it('rechecks cancellation after lifecycle admission before secure-key writes', async () => {
  const values = new Map<string, string>()
  const set = jest.fn(async (key: string, value: string) => { values.set(key, value) })
  const entered = deferred<void>()
  const release = deferred<void>()
  const storage = createProviderCredentialStorage({
    getItem: async key => values.get(key) ?? null, setItem: set, removeItem: async key => { values.delete(key) },
  }, { withMutation: async (_ids, mutate) => { entered.resolve(); await release.promise; await mutate() } })
  const abort = new AbortController()
  const apply = storage.applyMutations as (mutations: { providerId: string; credential: string | null }[], options?: unknown) => Promise<void>
  const operation = apply([{ providerId: 'fixture', credential: 'local-placeholder' }], { signal: abort.signal })
  const outcome = operation.catch(error => error)
  await entered.promise
  const reason = new Error('cancel before secure boundary')
  abort.abort(reason)
  release.resolve()
  expect(await outcome).toBe(reason)
  expect(set).not.toHaveBeenCalled()
  expect(values.size).toBe(0)
})

it('captures queued credential mutations before the caller changes their identity or value', async () => {
  const values = new Map<string, string>()
  const entered = deferred<void>()
  const release = deferred<void>()
  let first = true
  const storage = createProviderCredentialStorage({
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => {
      if (first) { first = false; entered.resolve(); await release.promise }
      values.set(key, value)
    },
    removeItem: async key => { values.delete(key) },
  })
  const leading = storage.setProviderCredential('first', 'first-placeholder')
  await entered.promise
  const mutations = [{ providerId: 'shown', credential: 'shown-placeholder' }]
  const queued = storage.applyMutations(mutations)
  mutations[0].providerId = 'unreviewed'
  mutations[0].credential = 'changed-placeholder'
  release.resolve()
  await Promise.all([leading, queued])
  expect(await storage.getProviderCredential('shown')).toBe('shown-placeholder')
  expect(await storage.getProviderCredential('unreviewed')).toBeNull()
})

function queuedCredentialFixture() {
  const values = new Map<string, string>()
  const entered = deferred<void>(), release = deferred<void>()
  let first = true
  const lifecycle = jest.fn(async (_ids: readonly string[], mutate: () => Promise<void>) => mutate())
  const storage = createProviderCredentialStorage({
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => {
      if (first) { first = false; entered.resolve(); await release.promise }
      values.set(key, value)
    },
    removeItem: async key => { values.delete(key) },
  }, { withMutation: lifecycle })
  return { values, storage, entered, release, lifecycle }
}

it('captures queued credential replacement identities and nested values before the caller changes them', async () => {
  const fixture = queuedCredentialFixture()
  const leading = fixture.storage.setProviderCredential('leading', 'leading-placeholder')
  await fixture.entered.promise
  const replacement = [{
    providerId: 'reviewed', credential: 'reviewed-primary-placeholder',
    credentialGroups: [{ groupId: 'reviewed-group', credential: 'reviewed-group-placeholder' }],
  }]
  const queued = fixture.storage.replaceCredentials({ current: [], replacement })
  replacement[0].providerId = 'unreviewed'
  replacement[0].credential = 'changed-primary-placeholder'
  replacement[0].credentialGroups[0].groupId = 'changed-group'
  replacement[0].credentialGroups[0].credential = 'changed-group-placeholder'
  replacement.push({ providerId: 'inserted', credential: 'inserted-placeholder', credentialGroups: [] })
  fixture.release.resolve()
  await Promise.all([leading, queued])
  expect(await fixture.storage.getProviderCredential('reviewed')).toBe('reviewed-primary-placeholder')
  expect(await fixture.storage.getCredentialGroupCredential('reviewed', 'reviewed-group')).toBe('reviewed-group-placeholder')
  expect(await fixture.storage.getProviderCredential('unreviewed')).toBeNull()
  expect(await fixture.storage.getProviderCredential('inserted')).toBeNull()
  expect(fixture.lifecycle.mock.calls.map(([ids]) => ids)).toEqual([['leading'], ['reviewed']])
})

it('captures queued credential replacement removal inventory without deleting later unreviewed identities', async () => {
  const fixture = queuedCredentialFixture()
  for (const id of ['reviewed', 'unreviewed']) {
    fixture.values.set(providerCredentialStorageKey(id), `${id}-primary-placeholder`)
    fixture.values.set(providerCredentialGroupStorageKey(id, `${id}-group`), `${id}-group-placeholder`)
  }
  const leading = fixture.storage.setProviderCredential('leading', 'leading-placeholder')
  await fixture.entered.promise
  const current = [{ providerId: 'reviewed', credentialGroupIds: ['reviewed-group'] }]
  const queued = fixture.storage.replaceCredentials({ current, replacement: [] })
  current[0].providerId = 'unreviewed'
  current[0].credentialGroupIds[0] = 'unreviewed-group'
  fixture.release.resolve()
  await Promise.all([leading, queued])
  expect(await fixture.storage.getProviderCredential('reviewed')).toBeNull()
  expect(await fixture.storage.getCredentialGroupCredential('reviewed', 'reviewed-group')).toBeNull()
  expect(await fixture.storage.getProviderCredential('unreviewed')).toBe('unreviewed-primary-placeholder')
  expect(await fixture.storage.getCredentialGroupCredential('unreviewed', 'unreviewed-group')).toBe('unreviewed-group-placeholder')
  expect(fixture.lifecycle.mock.calls.map(([ids]) => ids)).toEqual([['leading'], ['reviewed']])
})
