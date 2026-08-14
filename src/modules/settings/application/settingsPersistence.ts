import type { Settings } from '@/types/settingsContracts'

export class SettingsPersistenceValidationError extends Error {
  constructor() {
    super('Persisted settings record is malformed.')
    this.name = 'SettingsPersistenceValidationError'
  }
}

export interface SettingsPersistenceRecordPort {
  read(): Promise<unknown | null>
  write(settings: Settings): Promise<void>
}

export interface SettingsPersistencePort {
  load(): Promise<Partial<Settings> | null>
  save(settings: Settings): Promise<void>
}

export function createSettingsPersistence(
  records: SettingsPersistenceRecordPort,
): SettingsPersistencePort {
  return Object.freeze({
    async load() {
      const record = await records.read()
      if (record === null) return null
      if (!isPlainRecord(record)) throw new SettingsPersistenceValidationError()
      return record as Partial<Settings>
    },
    save(settings: Settings) {
      return records.write(settings)
    },
  })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
