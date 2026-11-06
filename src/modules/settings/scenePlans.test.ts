import type { ScenePlan } from '@/core'
import type { Settings } from '@/types/settingsContracts'
import { createScenePlanManagement, normalizeScenePlan, normalizeScenePlanConfiguration, normalizeScenePlans } from './scenePlans'
import { createSettingsPersistence } from './application/settingsPersistence'
import { sanitizeSettingsForPortableExport } from './settingsPortableExportPolicy'

const plan: ScenePlan = { schema: 'islemind.scene-plan.v1', id: 'research', name: 'Research', revision: 1,
  configuration: { model: { target: { providerId: 'a', model: 'alias' }, routingPlan: {
    schema: 'islemind.model-routing-plan.v1', id: 'route', name: 'Preferred', mode: 'fallback',
    primary: { providerId: 'a', model: 'alias' }, backup: { providerId: 'b', model: 'model' }, crossProvider: 'ask',
  } }, enabledTools: [], knowledgeSources: ['document-a'], contextPolicy: null, toolDeclarationMode: 'auto' } }

test('retains keep/none/inherit distinctions and detaches routing and resource references', () => {
  expect(normalizeScenePlanConfiguration({})).toEqual({})
  expect(normalizeScenePlanConfiguration({ enabledTools: [], contextPolicy: null })).toEqual({ enabledTools: [], contextPolicy: null })
  const input = JSON.parse(JSON.stringify(plan)) as ScenePlan
  const copy = normalizeScenePlan(input)!
  input.configuration.model!.routingPlan!.backup!.model = 'changed'
  input.configuration.knowledgeSources!.push('later')
  expect(copy.configuration.model!.routingPlan!.backup!.model).toBe('model')
  expect(copy.configuration.knowledgeSources).toEqual(['document-a'])
  expect(copy.configuration.model!.routingPlan!.crossProvider).toBe('ask')
})

test.each([
  { ...plan, schema: 'future' }, { ...plan, apiKey: 'synthetic-forbidden-field' }, { ...plan, revision: 0 },
  { ...plan, configuration: { permission: 'allow' } }, { ...plan, configuration: { model: { target: { providerId: 'a', model: 'x', token: 'forbidden' } } } },
  { ...plan, configuration: { knowledgeSources: ['duplicate', 'duplicate'] } },
  { ...plan, configuration: { skillVariables: { topic: 'x' } } },
  { ...plan, configuration: { contextPolicy: { schema: 'islemind.conversation-context-policy.v1', remoteCompactThreshold: 0.01 } } },
  { ...plan, configuration: { toolDeclarationMode: 'execute-anything' } },
])('rejects unsupported or authority-bearing template data', value => {
  expect(normalizeScenePlan(value)).toBeUndefined()
  expect(() => normalizeScenePlans([value])).toThrow('scene_plan_invalid')
})

test('bounds templates and resources without dropping an over-budget item', () => {
  expect(() => normalizeScenePlans(Array.from({ length: 51 }, (_, index) => ({ ...plan, id: `scene-${index}` })))).toThrow()
  expect(normalizeScenePlanConfiguration({ enabledTools: Array.from({ length: 129 }, (_, index) => `tool-${index}`) })).toBeUndefined()
  expect(normalizeScenePlans(undefined)).toBeUndefined()
})

test('requires the captured version for both saving and deletion, including overlapping saves', async () => {
  let collection = [plan]
  const persist = jest.fn(async () => undefined)
  const management = createScenePlanManagement({ read: () => collection, publish: value => { collection = value }, persist })
  const first = management.save({ ...plan, name: 'First' }, 1)
  const second = management.save({ ...plan, name: 'Second' }, 1)
  await expect(first).resolves.toMatchObject({ name: 'First', revision: 2 })
  await expect(second).rejects.toThrow('scene_plan_conflict')
  await expect(management.remove(plan.id, 1)).rejects.toThrow('scene_plan_conflict')
  expect(collection[0].name).toBe('First')
  expect(persist).toHaveBeenCalledTimes(1)
})

test('restores only its collection after a failed save, queues correction and retains unrelated changes for retry', async () => {
  let settings = { scenePlans: [plan], theme: 'light' }
  const snapshots: typeof settings[] = []
  let fail = true
  const management = createScenePlanManagement({
    read: () => settings.scenePlans,
    publish: scenePlans => { settings = { ...settings, scenePlans } },
    async persist() {
      snapshots.push(JSON.parse(JSON.stringify(settings)))
      if (fail) { fail = false; settings = { ...settings, scenePlans: settings.scenePlans.map(item => ({ ...item })), theme: 'dark' }; throw Error('storage') }
    },
  })
  await expect(management.save({ ...plan, name: 'Edited' }, 1)).rejects.toThrow('scene_plan_save_failed')
  expect(settings).toEqual({ scenePlans: [plan], theme: 'dark' })
  expect(snapshots).toHaveLength(2)
  expect(snapshots[1]).toEqual(settings)
  await management.save({ ...plan, name: 'Edited' }, 1)
  expect(settings.scenePlans[0]).toMatchObject({ name: 'Edited', revision: 2 })
})

test('failed deletion keeps the prior collection and can be retried', async () => {
  let collection = [plan]
  const persist = jest.fn().mockRejectedValueOnce(Error('storage')).mockResolvedValue(undefined)
  const management = createScenePlanManagement({ read: () => collection, publish: value => { collection = value }, persist })
  await expect(management.remove(plan.id, 1)).rejects.toThrow('scene_plan_save_failed')
  expect(collection).toEqual([plan])
  await management.remove(plan.id, 1)
  expect(collection).toEqual([])
})

test('legacy settings omit templates; current snapshots round-trip and export an explicit collection', async () => {
  let record: unknown = { theme: 'light' }
  const persistence = createSettingsPersistence({ read: async () => record, write: async value => { record = JSON.parse(JSON.stringify(value)) } })
  expect(await persistence.load()).not.toHaveProperty('scenePlans')
  const settings = { theme: 'dark', scenePlans: [plan] } as Settings
  await persistence.save(settings)
  expect(await persistence.load()).toEqual(settings)
  expect(sanitizeSettingsForPortableExport({ theme: 'light' } as Settings).scenePlans).toEqual([])
  record = { scenePlans: [{ ...plan, schema: 'future' }] }
  await expect(persistence.load()).rejects.toThrow('Persisted settings record is malformed')
})
