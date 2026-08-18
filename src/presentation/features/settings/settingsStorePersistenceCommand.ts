import type { SettingsPersistencePort } from '@/modules/settings'
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
}

let persistence: SettingsStorePersistence | undefined
let settingsMutationTail: Promise<void> = Promise.resolve()
let latestSettingsMutation: Promise<void> = Promise.resolve()

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
  if (persistence === boundPersistence) persistence = undefined
}

export function loadPersistedSettings(): Promise<Partial<Settings> | null> {
  return requirePersistence().settings.load()
}

export function savePersistedSettings(settings: Settings): Promise<void> {
  const boundPersistence = requirePersistence()
  return enqueueSettingsMutation(() => boundPersistence.settings.save(settings))
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
