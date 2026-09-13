import { normalizeSettingsIdentityPreferences, normalizeSettingsLastPreferredModel } from './identity'
import { createSettingsPersistence } from './application/settingsPersistence'
import type { Settings } from '@/types/settingsContracts'

describe('last explicitly preferred model', () => {
  const preference = { schema: 'islemind.global-model-preference.v1' as const, providerId: 'p', model: 'alias' }
  it('validates the versioned pair without filling missing preferences', () => {
    expect(normalizeSettingsLastPreferredModel(undefined)).toBeUndefined()
    expect(normalizeSettingsLastPreferredModel({ ...preference, model: '' })).toBeUndefined()
    expect(normalizeSettingsLastPreferredModel(preference)).toEqual(preference)
    expect(() => normalizeSettingsLastPreferredModel({ ...preference, schema: 'islemind.global-model-preference.v2' })).toThrow()
  })
  it('survives storage reconstruction without changing the configured default', async () => {
    let record: Settings | null = null
    const records = { read: async () => record, write: async (settings: Settings) => { record = JSON.parse(JSON.stringify(settings)) } }
    const settings = { defaultProvider: 'different-default', lastPreferredModel: preference } as Settings
    await createSettingsPersistence(records).save(normalizeSettingsIdentityPreferences(settings))
    expect(await createSettingsPersistence(records).load()).toEqual(settings)
  })
  it('propagates save failure rather than reporting durable global preference', async () => {
    const persistence = createSettingsPersistence({ read: async () => null, write: async () => { throw new Error('storage unavailable') } })
    await expect(persistence.save({ lastPreferredModel: preference } as Settings)).rejects.toThrow('storage unavailable')
  })
})
