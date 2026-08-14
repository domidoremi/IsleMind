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
  return requirePersistence().settings.save(settings)
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
