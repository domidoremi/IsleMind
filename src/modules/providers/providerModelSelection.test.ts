import type { AIProvider } from '@/types/providerContracts'
import { getPolicyAllowedProviderModels, getPolicyPreferredProviderModel, providerHasPolicyModel, resolveProviderModelAliasAccess } from '@/bootstrap/providerModelAccess'
import { getProviderAvailableModels, getProviderSelectableModels, getProviderPreferredModel } from '@/utils/providerModels'
import { parseProviderEnabledModels } from './providerModelSelection'
import { createProviderCredentialSynchronization } from './providerCredentialSynchronization'
import { runCredentialGroupModelSync } from './providerCredentialGroups'

const provider: AIProvider = {
  id: 'selection', name: 'Selection', type: 'openai-compatible', baseUrl: 'https://fixture.invalid/v1',
  enabled: true, apiKey: 'synthetic', models: ['first', 'second'], manualModels: ['manual'],
  lastModelSyncStatus: 'ok', lastTestStatus: 'ok', lastTestModel: 'first',
  modelAliases: [{ alias: 'short', model: 'second' }],
  credentialGroups: [{ id: 'key', label: 'Key', enabled: true, apiKey: 'synthetic', availableModels: ['first', 'second'], lastModelSyncStatus: 'ok' }],
}

it('preserves legacy catalogs but limits explicit choices across all selectors', () => {
  expect(getPolicyAllowedProviderModels(provider)).toEqual(['first', 'second', 'manual', 'short'])
  const selected = { ...provider, enabledModels: ['second'] }
  expect(getPolicyAllowedProviderModels(selected)).toEqual(['second'])
  expect(getProviderAvailableModels(selected)).toEqual(['second'])
  expect(getProviderSelectableModels(selected)).toEqual(['second'])
  expect(getPolicyPreferredProviderModel(selected)).toBe('second')
  expect(providerHasPolicyModel(selected, 'first')).toBe(false)
  expect(resolveProviderModelAliasAccess({ provider: selected, model: 'first' }).allowed).toBe(false)
})

it('keeps explicit empty selection empty despite cached test, manual models and aliases', () => {
  const empty = { ...provider, enabledModels: [] }
  expect(getPolicyAllowedProviderModels(empty)).toEqual([])
  expect(getProviderSelectableModels(empty)).toEqual([])
  expect(getPolicyPreferredProviderModel(empty)).toBeUndefined()
  for (const model of ['first', 'second', 'manual', 'short']) {
    expect(providerHasPolicyModel(empty, model)).toBe(false)
    expect(resolveProviderModelAliasAccess({ provider: empty, model }).allowed).toBe(false)
  }
})

it('allows a selected alias and its upstream while retaining access restrictions', () => {
  const selected = { ...provider, enabledModels: ['short'] }
  expect(getPolicyAllowedProviderModels(selected)).toEqual(['short'])
  expect(resolveProviderModelAliasAccess({ provider: selected, model: 'short' }).allowed).toBe(true)
  expect(resolveProviderModelAliasAccess({ provider: selected, model: 'second' }).allowed).toBe(true)
  expect(resolveProviderModelAliasAccess({ provider: selected, model: 'short', settings: { modelBlocklist: ['second'] } }).allowed).toBe(false)
})

it('keeps case-distinct model selections and alias upstream IDs separate', () => {
  const selected = { ...provider, models: ['Model', 'model'], manualModels: [], modelAliases: [],
    enabledModels: ['Model'], credentialGroups: [{ ...provider.credentialGroups![0], availableModels: ['Model', 'model'] }] }
  expect(getPolicyAllowedProviderModels(selected)).toEqual(['Model'])
  expect(getProviderAvailableModels(selected)).toEqual(['Model'])
  expect(getProviderSelectableModels(selected)).toEqual(['Model'])
  expect(providerHasPolicyModel(selected, 'model')).toBe(false)
  expect(resolveProviderModelAliasAccess({ provider: selected, model: 'model' }).allowed).toBe(false)
  const alias = { ...selected, enabledModels: ['short'], modelAliases: [{ alias: 'short', model: 'Model' }] }
  expect(resolveProviderModelAliasAccess({ provider: alias, model: 'Model' }).allowed).toBe(true)
  expect(resolveProviderModelAliasAccess({ provider: alias, model: 'model' }).allowed).toBe(false)
})

it('keeps catalog and historical preference identity exact for legacy unrestricted selections', () => {
  const legacy = { ...provider, enabledModels: undefined, models: ['model'], manualModels: [], modelAliases: [],
    lastTestModel: 'Model', credentialGroups: [{ ...provider.credentialGroups![0], availableModels: ['model'] }] }
  expect(providerHasPolicyModel(legacy, 'Model')).toBe(false)
  expect(providerHasPolicyModel(legacy, 'model')).toBe(true)
  expect(getProviderPreferredModel(legacy)).toBe('model')
  expect(getPolicyPreferredProviderModel(legacy)).toBe('model')
  const manual = { ...legacy, models: [], manualModels: ['manual'], credentialGroups: [] }
  expect(providerHasPolicyModel(manual, 'Manual')).toBe(false)
  expect(providerHasPolicyModel(manual, 'manual')).toBe(true)
})

it('preserves legacy alias-name matching while keeping its upstream identity exact', () => {
  const alias = { ...provider, models: [], manualModels: [], modelAliases: [{ alias: 'Friendly', model: 'Model' }],
    credentialGroups: [{ ...provider.credentialGroups![0], availableModels: [] }] }
  expect(providerHasPolicyModel(alias, 'friendly')).toBe(true)
  expect(providerHasPolicyModel(alias, 'Model')).toBe(true)
  expect(providerHasPolicyModel(alias, 'model')).toBe(false)
})

it.each([null, {}, [''], [false], 'first'])('rejects malformed selection %j', value => {
  expect(() => parseProviderEnabledModels(value)).toThrow()
})

it('copies selections, retains explicit empty lists and normalizes saved IDs', () => {
  expect(parseProviderEnabledModels(undefined)).toBeUndefined()
  expect(parseProviderEnabledModels([])).toEqual([])
  expect(parseProviderEnabledModels([' first ', 'first'])).toEqual(['first'])
})

it('retains a legacy primary catalog and its choices when its first grouped refresh fails', async () => {
  const source = { ...provider, credentialGroups: undefined, manualModels: [], modelAliases: [] }
  const sync = createProviderCredentialSynchronization({
    getEnabledModels: getProviderSelectableModels,
    messages: { defaultToken: 'default', saveTokenGroupFirst: 'missing', credentialGroupsSynced: 'synced' },
    fetchModels: async () => ({ ok: false, code: 'network_error', message: 'Unavailable' }),
    synchronize: (input, dependencies) => runCredentialGroupModelSync(input, dependencies),
  })
  const result = (await sync.synchronize(source)).data!
  expect(result.lastModelSyncStatus).toBe('bad')
  expect(result.enabledModels).toEqual(['first', 'second'])
  expect(getPolicyAllowedProviderModels(result)).toEqual(['first', 'second'])
})

it.each([{ enabledModels: undefined }, { enabledModels: [] }, { enabledModels: ['second'] }])('discovery retains the previous choice and leaves new IDs unselected: %j', async ({ enabledModels }) => {
  const source = { ...provider, enabledModels }
  const sync = createProviderCredentialSynchronization({
    getEnabledModels: getProviderSelectableModels,
    messages: { defaultToken: 'default', saveTokenGroupFirst: 'missing', credentialGroupsSynced: 'synced' },
    fetchModels: jest.fn(),
    synchronize: async input => ({ ...input, models: ['first', 'second', 'new'], credentialGroups: [
      { ...input.credentialGroups![0], availableModels: ['first', 'second', 'new'] },
    ] }),
  })
  const result = (await sync.synchronize(source)).data!
  expect(result.enabledModels).toEqual(enabledModels ?? ['first', 'second', 'manual', 'short'])
  expect(getPolicyAllowedProviderModels(result)).not.toContain('new')
  expect(source.enabledModels).toEqual(enabledModels)
})
