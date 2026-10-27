import type { SettingsPersistencePort, SettingsSearchPersistence } from '@/modules/settings'
import type { ProviderMetadataPersistencePort } from '@/modules/providers'
import type { Settings } from '@/types/settingsContracts'
import type { AIProvider } from '@/types/providerContracts'

export const SETTINGS_STORE_PERSISTENCE_UNINITIALIZED_ERROR =
  'settings_store_persistence_uninitialized'
export const SETTINGS_STORE_PERSISTENCE_ALREADY_BOUND_ERROR =
  'settings_store_persistence_already_bound'

export interface SettingsStorePersistence {
  readonly settings: SettingsPersistencePort
  readonly providers: ProviderMetadataPersistencePort
  readonly search?: SettingsSearchPersistence
}

let persistence: SettingsStorePersistence | undefined
let settingsMutationTail: Promise<void> = Promise.resolve()
let latestSettingsMutation: Promise<void> = Promise.resolve()
// The existing save queue also fences route-affecting settings behind their
// durable scope invalidation. A failed prerequisite must block later snapshots
// too, since they may contain the same in-memory configuration.
let settingsSavePrerequisite: Promise<void> = Promise.resolve()

export function bindSettingsStorePersistence(nextPersistence: SettingsStorePersistence): void {
  if (!persistence) {
    persistence = nextPersistence
    return
  }
  if (persistence !== nextPersistence) {
    throw new Error(SETTINGS_STORE_PERSISTENCE_ALREADY_BOUND_ERROR)
  }
}

export function releaseSettingsStorePersistence(boundPersistence: SettingsStorePersistence): void {
  if (persistence === boundPersistence) { persistence = undefined; settingsSavePrerequisite = Promise.resolve() }
}

export function loadPersistedSettings(): Promise<Partial<Settings> | null> {
  return requirePersistence().settings.load()
}

export function savePersistedSettings(settings: Settings, beforeSave?: Promise<void>): Promise<void> {
  const boundPersistence = requirePersistence()
  if (beforeSave) {
    settingsSavePrerequisite = beforeSave
    // Mark rejection handled immediately, without changing the awaited outcome.
    void beforeSave.catch(() => undefined)
  }
  const prerequisite = settingsSavePrerequisite
  return enqueueSettingsMutation(async () => { await prerequisite; await boundPersistence.settings.save(settings) })
}

export function flushPersistedSettings(): Promise<void> {
  return latestSettingsMutation
}

export function loadPersistedProviderMetadata(): Promise<readonly AIProvider[] | null> {
  return requirePersistence().providers.load()
}

export function savePersistedProviderMetadata(providers: readonly AIProvider[]): Promise<void> {
  return requirePersistence().providers.save(providers)
}

export function getSettingsSearchSnapshot() {
  return requireSettingsSearch().getSnapshot()
}

export function subscribeSettingsSearch(listener: () => void): () => void {
  return requireSettingsSearch().subscribe(listener)
}

export function loadSettingsSearch(): Promise<void> {
  return requireSettingsSearch().load()
}

export function setSettingsSearchQuery(query: string): Promise<void> {
  return requireSettingsSearch().setQuery(query)
}

export function retrySettingsSearch(): Promise<void> {
  return requireSettingsSearch().retry()
}

function requireSettingsSearch(): SettingsSearchPersistence {
  const search = requirePersistence().search
  if (!search) throw new Error('settings_search_persistence_uninitialized')
  return search
}

function requirePersistence(): SettingsStorePersistence {
  if (!persistence) throw new Error(SETTINGS_STORE_PERSISTENCE_UNINITIALIZED_ERROR)
  return persistence
}

function enqueueSettingsMutation(operation: () => Promise<void>): Promise<void> {
  const result = settingsMutationTail.then(operation, operation)
  settingsMutationTail = result.catch(() => undefined)
  latestSettingsMutation = result
  return result
}
