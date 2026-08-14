import { createProviderMetadataPersistence } from '@/modules/providers'
import { createSettingsPersistence } from '@/modules/settings'
import {
  bindSettingsStorePersistence,
  releaseSettingsStorePersistence,
  type SettingsStorePersistence,
} from '@/presentation/features/settings/settingsStorePersistenceCommand'
import {
  loadApplicationDataRecord,
  saveApplicationDataRecord,
} from './applicationDataRecords'

export const settingsStorePersistence: SettingsStorePersistence = Object.freeze({
  settings: createSettingsPersistence({
    read: () => loadApplicationDataRecord<unknown>('SETTINGS'),
    write: (settings) => saveApplicationDataRecord('SETTINGS', settings),
  }),
  providers: createProviderMetadataPersistence({
    read: () => loadApplicationDataRecord<unknown>('PROVIDERS'),
    write: (providers) => saveApplicationDataRecord('PROVIDERS', providers),
  }),
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
