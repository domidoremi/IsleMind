import { createSettingsSearchPersistence } from '@/modules/settings'
import { readApplicationDataRecord, writeApplicationDataRecord } from './applicationDataRecords'

export const settingsSearchPersistence = createSettingsSearchPersistence({
  read: () => readApplicationDataRecord('SETTINGS_SEARCH'),
  write: (record) => writeApplicationDataRecord('SETTINGS_SEARCH', record),
})
