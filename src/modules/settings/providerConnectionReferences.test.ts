import type { ModelRoutingPlan, ScenePlan } from '@/core'
import { projectSettingsProviderReferences, type SettingsConnectionReferencePreferences } from './providerConnectionReferences'

const route: ModelRoutingPlan = { schema: 'islemind.model-routing-plan.v1', id: 'route', name: 'Same name', mode: 'fallback',
  primary: { providerId: 'A', model: 'Alias' }, backup: { providerId: 'B', model: 'Alias' }, crossProvider: 'ask' }
const scene: ScenePlan = { schema: 'islemind.scene-plan.v1', id: 'scene', name: 'Same name', revision: 1,
  configuration: { model: { target: route.primary, routingPlan: route }, systemPrompt: 'Private prompt', enabledTools: ['private-tool'] } }
const settings: SettingsConnectionReferencePreferences = { defaultProvider: 'A',
  lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId: 'A', model: 'Alias' },
  modelRoutingPlans: [route], scenePlans: [scene], modelFavorites: [{ providerId: 'A', modelId: 'Alias' }, { providerId: 'B', modelId: 'Alias' }] }

it('counts an object once while preserving each matching role and exact connection/model identity', () => {
  const result = projectSettingsProviderReferences(settings, ['A', 'B', 'A'])
  expect(result.filter(item => item.kind === 'routing')).toHaveLength(1)
  expect(result.filter(item => item.kind === 'scene')).toHaveLength(1)
  expect(result.find(item => item.kind === 'scene')?.targets.map(target => target.role)).toEqual(['model', 'primary', 'backup'])
  expect(result.filter(item => item.kind === 'favorite').map(item => item.targets[0])).toEqual([
    { providerId: 'A', model: 'Alias', role: 'model' }, { providerId: 'B', model: 'Alias', role: 'model' },
  ])
  expect(projectSettingsProviderReferences(settings, ['a'])).toEqual([])
  expect(JSON.stringify(result)).not.toMatch(/Private prompt|private-tool|crossProvider/)
})

it('keeps a scene routing copy independent of a changed/deleted route template', () => {
  const result = projectSettingsProviderReferences({ ...settings, modelRoutingPlans: [] }, ['B'])
  expect(result.filter(item => item.kind === 'scene')).toHaveLength(1)
  expect(result.find(item => item.kind === 'scene')?.targets).toEqual([{ providerId: 'B', model: 'Alias', role: 'backup' }])
  expect(result.some(item => item.kind === 'routing')).toBe(false)
})

it('does not turn omitted scene models or fixed-plan leftovers into live dependencies', () => {
  const result = projectSettingsProviderReferences({
    ...settings, modelRoutingPlans: [{ ...route, mode: 'fixed' }],
    scenePlans: [{ ...scene, configuration: { systemPrompt: 'Keep current model' } }],
  }, ['B'])
  expect(result.map(item => item.kind)).toEqual(['favorite'])
})

it('copies only reference fields and retains Unicode code points and requested aliases', () => {
  const favorite = { providerId: 'é', modelId: 'Requested-Alias', apiKey: 'forbidden', source: 'forbidden' }
  const result = projectSettingsProviderReferences({ ...settings, modelRoutingPlans: [], scenePlans: [], defaultProvider: null,
    lastPreferredModel: undefined, modelFavorites: [favorite] }, ['é'])
  expect(result).toHaveLength(1)
  expect(projectSettingsProviderReferences({ ...settings, modelFavorites: [favorite] }, ['e\u0301'])).toEqual([])
  favorite.modelId = 'Changed'
  expect(result[0].targets[0].model).toBe('Requested-Alias')
  expect(JSON.stringify(result)).not.toContain('forbidden')
})
