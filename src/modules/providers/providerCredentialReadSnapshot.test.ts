import { createVerifiedSecureKeyValueStorage } from '@/core'
import {
  createProviderCredentialStorage,
  ProviderCredentialStorageError,
  providerCredentialGroupStorageKey,
  providerCredentialStorageKey,
} from './providerCredentialStorage'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

function fixture() {
  const values = new Map<string, string>()
  const read = jest.fn(async (key: string) => values.get(key) ?? null)
  const write = jest.fn(async (key: string, value: string) => { values.set(key, value) })
  const remove = jest.fn(async (key: string) => { values.delete(key) })
  const storage = createProviderCredentialStorage(createVerifiedSecureKeyValueStorage({
    getItem: read, setItem: write, removeItem: remove,
  }))
  return { values, read, write, remove, storage }
}

it('returns a detached immutable primary/group snapshot without inventing missing credentials', async () => {
  const f = fixture()
  f.values.set(providerCredentialStorageKey('reviewed'), 'primary-placeholder')
  f.values.set(providerCredentialGroupStorageKey('reviewed', 'present'), 'group-placeholder')
  const result = await f.storage.getProviderCredentials('reviewed', ['present', 'missing'])
  expect(result).toEqual({
    credential: 'primary-placeholder',
    credentialGroups: [{ groupId: 'present', credential: 'group-placeholder' }, { groupId: 'missing', credential: null }],
  })
  expect(Object.isFrozen(result)).toBe(true)
  expect(Object.isFrozen(result.credentialGroups)).toBe(true)
  expect(result.credentialGroups.every(Object.isFrozen)).toBe(true)
  expect(f.write).not.toHaveBeenCalled()
  expect(f.remove).not.toHaveBeenCalled()
})

it('captures queued group identities and read authority before caller-owned inputs change', async () => {
  const f = fixture(), entered = deferred<void>(), release = deferred<void>()
  f.read.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return null })
  f.values.set(providerCredentialGroupStorageKey('reviewed', 'shown'), 'shown-placeholder')
  const leading = f.storage.getProviderCredential('leading')
  await entered.promise
  const ids = ['shown'], admitted = jest.fn(), unreviewed = jest.fn()
  const options = { beforeRead: admitted }
  const pending = f.storage.getProviderCredentials('reviewed', ids, options)
  ids[0] = 'changed'; ids.push('inserted')
  options.beforeRead = unreviewed
  release.resolve()
  const [, result] = await Promise.all([leading, pending])
  expect(result.credentialGroups).toEqual([{ groupId: 'shown', credential: 'shown-placeholder' }])
  expect(admitted).toHaveBeenCalledTimes(3)
  expect(unreviewed).not.toHaveBeenCalled()
  expect(f.read.mock.calls.map(([key]) => key)).toEqual([
    providerCredentialStorageKey('leading'), providerCredentialStorageKey('reviewed'),
    providerCredentialGroupStorageKey('reviewed', 'shown'),
  ])
})

it('retains queued cancellation authority and rejects before any snapshot read is admitted', async () => {
  const f = fixture(), entered = deferred<void>(), release = deferred<void>()
  f.read.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return null })
  const leading = f.storage.getProviderCredential('leading')
  await entered.promise
  const controller = new AbortController(), options = { signal: controller.signal }
  const pending = f.storage.getProviderCredentials('reviewed', ['group'], options)
  const outcome = pending.catch(error => error)
  options.signal = new AbortController().signal
  const reason = new Error('Queued read cancelled')
  controller.abort(reason)
  release.resolve()
  const [, failure] = await Promise.all([leading, outcome])
  expect(failure).toBe(reason)
  expect(f.read).toHaveBeenCalledTimes(1)
  expect(f.write).not.toHaveBeenCalled()
  await expect(f.storage.getProviderCredentials('reviewed', [])).resolves.toEqual({ credential: null, credentialGroups: [] })
})

it('does not touch secure storage for a pre-cancelled read', async () => {
  const f = fixture(), controller = new AbortController()
  controller.abort()
  await expect(f.storage.getProviderCredentials('reviewed', ['group'], { signal: controller.signal }))
    .rejects.toMatchObject({ name: 'AbortError' })
  expect(f.read).not.toHaveBeenCalled()
})

it('keeps an admitted primary read and its queue slot until settlement after cancellation', async () => {
  const f = fixture(), entered = deferred<void>(), release = deferred<void>()
  const primary = providerCredentialStorageKey('reviewed')
  f.read.mockImplementation(async key => {
    if (key === primary) { entered.resolve(); await release.promise }
    return f.values.get(key) ?? null
  })
  const controller = new AbortController()
  let settled = false
  const pending = f.storage.getProviderCredentials('reviewed', ['group'], { signal: controller.signal })
    .then(value => { settled = true; return value }, error => { settled = true; throw error })
  const outcome = pending.catch(error => error)
  await entered.promise
  const queued = f.storage.setProviderCredential('after', 'after-placeholder')
  controller.abort()
  await Promise.resolve()
  const earlySettlement = settled, earlyWrites = f.write.mock.calls.length
  release.resolve()
  const [failure] = await Promise.all([outcome, queued])
  expect(earlySettlement).toBe(false)
  expect(earlyWrites).toBe(0)
  expect(failure).toMatchObject({ name: 'AbortError' })
  expect(f.read.mock.calls.some(([key]) => key === providerCredentialGroupStorageKey('reviewed', 'group'))).toBe(false)
  expect(f.values.get(providerCredentialStorageKey('after'))).toBe('after-placeholder')
})

it('awaits the current group read on cancellation and does not start the next group', async () => {
  const f = fixture(), entered = deferred<void>(), release = deferred<void>()
  const first = providerCredentialGroupStorageKey('reviewed', 'first')
  f.read.mockImplementation(async key => {
    if (key === first) { entered.resolve(); await release.promise }
    return null
  })
  const controller = new AbortController()
  let settled = false
  const pending = f.storage.getProviderCredentials('reviewed', ['first', 'second'], { signal: controller.signal })
    .then(value => { settled = true; return value }, error => { settled = true; throw error })
  const outcome = pending.catch(error => error)
  await entered.promise
  controller.abort()
  await Promise.resolve()
  const earlySettlement = settled
  release.resolve()
  expect(await outcome).toMatchObject({ name: 'AbortError' })
  expect(earlySettlement).toBe(false)
  expect(f.read.mock.calls.map(([key]) => key)).toEqual([providerCredentialStorageKey('reviewed'), first])
})

it('rechecks read authority after the primary settles and preserves the original refusal', async () => {
  const f = fixture(), refusal = new Error('Reviewed configuration changed')
  let checks = 0
  const pending = f.storage.getProviderCredentials('reviewed', ['group'], {
    beforeRead: () => { checks += 1; if (checks === 2) throw refusal },
  })
  await expect(pending).rejects.toBe(refusal)
  expect(f.read.mock.calls.map(([key]) => key)).toEqual([providerCredentialStorageKey('reviewed')])
  expect(f.write).not.toHaveBeenCalled()
})

it.each(['provider', 'credential_group'] as const)('redacts a failed %s read, returns no partial snapshot and permits a fresh retry', async scope => {
  const f = fixture(), primary = providerCredentialStorageKey('reviewed')
  const group = providerCredentialGroupStorageKey('reviewed', 'group')
  f.values.set(primary, 'primary-placeholder'); f.values.set(group, 'group-placeholder')
  const failedKey = scope === 'provider' ? primary : group
  f.read.mockImplementation(async key => {
    if (key === failedKey) throw new Error(`sensitive-placeholder: ${key}`)
    return f.values.get(key) ?? null
  })
  const failure = await f.storage.getProviderCredentials('reviewed', ['group']).catch(error => error)
  expect(failure).toBeInstanceOf(ProviderCredentialStorageError)
  expect(failure).toMatchObject({ code: 'read_failed', scope })
  expect(String(failure)).not.toContain('sensitive-placeholder')
  expect(String(failure)).not.toContain(failedKey)
  f.read.mockImplementation(async key => f.values.get(key) ?? null)
  await expect(f.storage.getProviderCredentials('reviewed', ['group'])).resolves.toEqual({
    credential: 'primary-placeholder', credentialGroups: [{ groupId: 'group', credential: 'group-placeholder' }],
  })
  expect(f.write).not.toHaveBeenCalled()
})

it.each([
  { label: 'empty identity', ids: [''] },
  { label: 'non-string identity', ids: [null] },
  { label: 'sparse identity list', ids: new Array(1) },
  { label: 'non-array identity list', ids: null },
])('rejects $label before reading any secure key', async ({ ids }) => {
  const f = fixture()
  await expect(f.storage.getProviderCredentials('reviewed', ids as unknown as string[]))
    .rejects.toMatchObject({ code: 'invalid_identity', scope: 'credential_group' })
  expect(f.read).not.toHaveBeenCalled()
  expect(f.write).not.toHaveBeenCalled()
})

it('reads the verified before-image only after a failed mutation has finished its rollback', async () => {
  const f = fixture(), primary = providerCredentialStorageKey('reviewed')
  const group = providerCredentialGroupStorageKey('reviewed', 'group')
  f.values.set(primary, 'old-primary-placeholder'); f.values.set(group, 'old-group-placeholder')
  f.write.mockImplementation(async (key, value) => {
    if (value === 'new-group-placeholder') throw new Error('Synthetic write failure')
    f.values.set(key, value)
  })
  const mutation = f.storage.applyMutations([
    { providerId: 'reviewed', credential: 'new-primary-placeholder' },
    { providerId: 'reviewed', groupId: 'group', credential: 'new-group-placeholder' },
  ]).catch(error => error)
  const pending = f.storage.getProviderCredentials('reviewed', ['group'])
  const [failure, snapshot] = await Promise.all([mutation, pending])
  expect(failure).toMatchObject({ code: 'write_failed', scope: 'replacement' })
  expect(snapshot).toEqual({
    credential: 'old-primary-placeholder', credentialGroups: [{ groupId: 'group', credential: 'old-group-placeholder' }],
  })
})
