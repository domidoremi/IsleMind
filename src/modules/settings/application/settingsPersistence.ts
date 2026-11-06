import type { Settings } from '@/types/settingsContracts'
import { normalizeModelRoutingPlans } from '@/core/modelRoutingPlan'
import { normalizeSettingsLastPreferredModel } from '../identity'
import { normalizeSettingsToolDeclarationMode, normalizeSettingsToolDeclarations } from '../toolDeclarations'
import { normalizeScenePlans, normalizeSettingsScenePlans } from '../scenePlans'

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
      try {
        // Unsupported saved identity versions must not become optional startup errors.
        normalizeSettingsLastPreferredModel(record.lastPreferredModel)
        normalizeModelRoutingPlans(record.modelRoutingPlans)
        normalizeScenePlans(record.scenePlans)
      } catch {
        throw new SettingsPersistenceValidationError()
      }
      return Object.hasOwn(record, 'toolDeclarationMode')
        ? { ...record, toolDeclarationMode: normalizeSettingsToolDeclarationMode(record.toolDeclarationMode) } as Partial<Settings>
        : record as Partial<Settings>
    },
    save(settings: Settings) {
      return records.write(normalizeSettingsScenePlans(normalizeSettingsToolDeclarations(settings)))
    },
  })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
