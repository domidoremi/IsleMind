import { buildSameModelRoutingPlans, collectSameModelRoutingMembers, resolveRoutingPlanSelection } from './providerRoutingGroups'
import type { AIProvider } from '@/types/providerContracts'

function providers(): AIProvider[] {
  return ['a', 'b', 'c'].map(id => ({ id, name: id, enabled: true, type: 'openai', apiKey: '',
    models: id === 'c' ? ['different-model'] : ['gpt-4o-mini'], lastModelSyncStatus: 'ok',
    ...(id === 'b' ? { modelAliases: [{ alias: 'my-alias', model: 'gpt-4o-mini' }], enabledModels: ['my-alias'] } : {}),
  }))
}

it('groups exact upstream IDs once per provider, retaining selected aliases without fuzzy matching', () => {
  const catalog = providers()
  const groups = buildSameModelRoutingPlans(catalog, {}, model => `${model} group`)
  expect(groups).toHaveLength(1)
  expect(groups[0].group?.members).toEqual([{ providerId: 'a', model: 'gpt-4o-mini' }, { providerId: 'b', model: 'my-alias' }])
  expect(groups[0].crossProvider).toBe('ask')
  expect(JSON.stringify(groups)).not.toContain('apiKey')
  catalog[0].enabledModels = []
  expect(buildSameModelRoutingPlans(catalog, {}, model => model)).toHaveLength(0)
  expect(collectSameModelRoutingMembers(providers(), { providerBlocklist: ['b'] }).get('gpt-4o-mini')).toHaveLength(1)
})

it('selects surviving saved members and never silently adds a newly matching connection', () => {
  const catalog = providers()
  const plan = buildSameModelRoutingPlans(catalog, {}, model => model)[0]
  catalog[0].enabled = false
  expect(resolveRoutingPlanSelection(plan, catalog)?.provider.id).toBe('b')
  catalog[1].modelAliases![0].model = 'different-model'
  catalog[2].models = ['gpt-4o-mini']
  expect(resolveRoutingPlanSelection(plan, catalog)).toBeUndefined()
})
