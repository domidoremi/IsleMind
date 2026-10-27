import { createProviderMetadataPersistence } from '@/modules/providers'
import { createSettingsPersistence } from '@/modules/settings'
import {
  bindSettingsStorePersistence,
  releaseSettingsStorePersistence,
  type SettingsStorePersistence,
} from '@/presentation/features/settings/settingsStorePersistenceCommand'
import {
  readApplicationDataRecord,
  writeApplicationDataRecord,
} from './applicationDataRecords'
import { settingsSearchPersistence } from './settingsSearchPersistence'

export const settingsStorePersistence: SettingsStorePersistence = Object.freeze({
  // Explicit Save/Retry needs the storage failure, not legacy no-throw behavior.
  settings: createSettingsPersistence({
    read: () => readApplicationDataRecord<unknown>('SETTINGS'),
    write: (settings) => writeApplicationDataRecord('SETTINGS', settings),
  }),
  providers: createProviderMetadataPersistence({
    read: () => readApplicationDataRecord<unknown>('PROVIDERS'),
    write: (providers) => writeApplicationDataRecord('PROVIDERS', providers),
  }),
  search: settingsSearchPersistence,
})

let initialized = false

export function initializeSettingsStorePersistence(): void {
  if (initialized) return
  bindSettingsStorePersistence(settingsStorePersistence)
  initialized = true
}

type MetroHotModule = {
  hot?: {
    dispose(callback: () => void): void
  }
}

const metroHotModule = typeof module === 'undefined'
  ? undefined
  : module as unknown as MetroHotModule

if (__DEV__) {
  metroHotModule?.hot?.dispose(() => {
    releaseSettingsStorePersistence(settingsStorePersistence)
    initialized = false
  })
}
