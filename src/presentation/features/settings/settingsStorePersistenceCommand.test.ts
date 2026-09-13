import { bindSettingsStorePersistence, flushPersistedSettings, releaseSettingsStorePersistence, savePersistedSettings } from './settingsStorePersistenceCommand'
import type { SettingsStorePersistence } from './settingsStorePersistenceCommand'
import type { Settings } from '@/types/settingsContracts'

function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture() {
  const saved: Settings[] = []
  const persistence: SettingsStorePersistence = {
    settings: { load: async () => null, save: async (settings) => { saved.push(settings) } },
    providers: { load: async () => null, save: async () => {} },
  }
  bindSettingsStorePersistence(persistence)
  return { saved, release: () => releaseSettingsStorePersistence(persistence) }
}

it('waits for durable scope invalidation before this and later settings snapshots', async () => {
  const { saved, release } = fixture()
  const invalidation = deferred()
  try {
    const route = { proxyMode: 'custom-base-url', proxyBaseUrl: 'https://proxy.example.test' } as Settings
    const first = savePersistedSettings(route, invalidation.promise)
    const second = savePersistedSettings({ ...route, theme: 'dark' })
    await Promise.resolve()
    expect(saved).toEqual([])
    invalidation.resolve()
    await Promise.all([first, second, flushPersistedSettings()])
    expect(saved).toEqual([route, { ...route, theme: 'dark' }])
  } finally { release() }
})

it('fails closed after invalidation failure, including later preference saves, until a safe retry', async () => {
  const { saved, release } = fixture()
  const invalidation = deferred()
  try {
    const route = { proxyMode: 'custom-base-url' } as Settings
    const first = savePersistedSettings(route, invalidation.promise)
    const firstFailure = expect(first).rejects.toThrow('invalidation failed')
    invalidation.reject(new Error('invalidation failed'))
    await firstFailure
    await expect(savePersistedSettings({ ...route, lastPreferredModel: {
      schema: 'islemind.global-model-preference.v1', providerId: 'p', model: 'm',
    } })).rejects.toThrow('invalidation failed')
    await expect(flushPersistedSettings()).rejects.toThrow('invalidation failed')
    expect(saved).toEqual([])
    await savePersistedSettings(route, Promise.resolve())
    await savePersistedSettings({ ...route, theme: 'light' })
    expect(saved).toHaveLength(2)
  } finally { release() }
})
