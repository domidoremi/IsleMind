import type { Settings } from '@/types/settingsContracts'
import { normalizeSettingsToolDeclarationMode, normalizeSettingsToolDeclarations } from './toolDeclarations'
import { createSettingsPersistence } from './application/settingsPersistence'
import { sanitizeSettingsForPortableExport } from './settingsPortableExportPolicy'

test('only an explicit auto setting enables deferred declarations, and absent legacy settings stay absent', () => {
  const legacy = { theme: 'light' } as Settings
  expect(normalizeSettingsToolDeclarations(legacy)).toBe(legacy)
  expect(normalizeSettingsToolDeclarations(legacy)).not.toHaveProperty('toolDeclarationMode')
  expect(normalizeSettingsToolDeclarationMode('auto')).toBe('auto')
  for (const value of [undefined, null, 'full', 'discovery', true, 1, { mode: 'auto' }]) {
    expect(normalizeSettingsToolDeclarationMode(value)).toBe('full')
  }
})

test.each(['full', 'auto'] as const)('explicit %s mode survives persistence and portable export without changing unrelated settings', async mode => {
  let stored: unknown = null
  const settings = { theme: 'dark', toolDeclarationMode: mode, agentWorkflowMaxSteps: 17 } as Settings
  const port = { read: async () => stored, write: async (value: Settings) => { stored = JSON.parse(JSON.stringify(value)) } }
  await createSettingsPersistence(port).save(settings)
  expect(await createSettingsPersistence(port).load()).toEqual(settings)
  expect(sanitizeSettingsForPortableExport(settings).toolDeclarationMode).toBe(mode)
  expect(settings.agentWorkflowMaxSteps).toBe(17)
})

test('normalizes malformed saved values to full, preserves missing records, and propagates failed writes for retry', async () => {
  const records = { read: jest.fn().mockResolvedValue({ theme: 'light', toolDeclarationMode: 'unknown' }),
    write: jest.fn().mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValue(undefined) }
  const settings = createSettingsPersistence(records)
  expect(await settings.load()).toEqual({ theme: 'light', toolDeclarationMode: 'full' })
  records.read.mockResolvedValueOnce({ theme: 'light' })
  expect(await settings.load()).not.toHaveProperty('toolDeclarationMode')
  const malformed = { toolDeclarationMode: 'unknown' } as unknown as Settings
  await expect(settings.save(malformed)).rejects.toThrow('disk unavailable')
  await settings.save(malformed)
  expect(records.write).toHaveBeenLastCalledWith({ toolDeclarationMode: 'full' })
})
