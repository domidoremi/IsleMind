import type { AIProvider, ProviderCredentialGroup } from '@/types/providerContracts'
import { getPolicyAllowedProviderModels, getPolicyPreferredProviderModel, providerHasPolicyModel } from '@/bootstrap/providerModelAccess'
import { getProviderAvailableModels, getProviderPreferredModel, getProviderSelectableModels } from '@/utils/providerModels'
import { chooseCredentialForModel, runCredentialGroupModelSync } from './providerCredentialGroups'
import { createProviderFallbackCandidateBuilder } from './providerFallbackCandidates'
import { providerForRuntimeFallback } from './providerRuntimeFallback'
import { createProviderMetadataPersistence } from './providerMetadataPersistence'
import { createProviderActivation } from './providerActivation'

const key = (id: string, models: string[], overrides: Partial<ProviderCredentialGroup> = {}): ProviderCredentialGroup => ({
  id, label: id, apiKey: `synthetic-${id}`, enabled: true, availableModels: models, lastModelSyncStatus: 'ok', ...overrides,
})
const provider = (overrides: Partial<AIProvider> = {}): AIProvider => ({
  id: 'catalog', name: 'Catalog', type: 'openai-compatible', presetId: 'custom-endpoint', baseUrl: 'https://catalog.invalid/v1',
  enabled: true, apiKey: 'synthetic-primary', models: ['stale'], lastTestStatus: 'ok', lastTestModel: 'stale',
  lastModelSyncStatus: 'ok', credentialGroups: [key('empty', [])], ...overrides,
})
const build = createProviderFallbackCandidateBuilder({ projectModel: (p, model) => ({
  deprecated: false, capabilities: ['text'], upstreamModel: p.modelAliases?.find(a => a.alias === model)?.model ?? model,
}) })
const candidates = (p: AIProvider) => build({ providers: [p], original: { providerId: p.id, model: 'stale' }, maxModelsPerProvider: 100 }).candidates
function expectNoStaleModel(p: AIProvider) {
  expect(getPolicyAllowedProviderModels(p)).toEqual([])
  expect(getProviderAvailableModels(p)).toEqual([])
  expect(getProviderSelectableModels(p)).toEqual([])
  expect(getPolicyPreferredProviderModel(p)).toBeUndefined()
  expect(getProviderPreferredModel(p)).toBeUndefined()
  expect(providerHasPolicyModel(p, 'stale')).toBe(false)
  expect(chooseCredentialForModel(p, 'stale').source).toEqual({ kind: 'none' })
  expect(candidates(p)).toEqual([])
}

it.each([true, false])('does not revive a tested model after an empty catalog, grouped=%s', grouped => {
  expectNoStaleModel(provider({ models: [], ...(grouped ? {} : { credentialGroups: undefined }) }))
})

it.each([false, true])('reports empty catalog discovery as successful while preserving readiness, testModels=%s', async testModels => {
  let saved = provider({ models: [], lastTestModel: 'stale' })
  const test = jest.fn()
  const activation = createProviderActivation({
    translate: key => key,
    synchronizeProviderCredentials: async source => ({ ok: true, code: 'ok', message: 'Fetched', data: await runCredentialGroupModelSync(source, { fetchModels: async () => [] }) }),
    testProviderModel: test,
    getAvailableModels: getProviderAvailableModels, getManualModels: p => p.manualModels ?? [], getPreferredModel: getProviderPreferredModel,
    isChatCompatibleModel: () => true, isModelAllowed: (p, model) => providerHasPolicyModel(p, model),
  })
  const result = await activation.syncAndTestProvider(saved, {
    updateProvider: async (_id, update) => { saved = { ...saved, ...update } },
    hydrateProviderKey: async () => ({ ...saved, apiKey: 'synthetic-primary', credentialGroups: saved.credentialGroups?.map(group => ({ ...group, apiKey: 'synthetic-key' })) }),
    updateProviderCredentialGroupHealth: async () => undefined,
  }, { testModels })
  expect(result).toMatchObject({ synced: true, syncedGroups: 1, modelCount: 0, ready: false, tested: false })
  expect(result.failures).toHaveLength(testModels ? 1 : 0)
  expect(test).not.toHaveBeenCalled()
  expect(saved.lastTestModel).toBeUndefined()
  expectNoStaleModel(saved)
})

it('does not turn old aggregate metadata into models after all owning keys are disabled', () => {
  expectNoStaleModel(provider({ credentialGroups: [key('owner', ['stale'], { enabled: false }), key('empty', [])] }))
})

it('does not assign a disabled owner model to an unknown key', () => {
  const p = provider({ credentialGroups: [key('owner', ['stale'], { enabled: false }), key('unknown', [], { lastModelSyncStatus: undefined })] })
  expectNoStaleModel(p)
})

it('includes disabled catalog owners only for an explicitly requested diagnostic build', () => {
  const p = provider({ enabled: false, credentialGroups: [key('owner', ['stale'], { enabled: false })] })
  expect(candidates(p)).toEqual([])
  const input = { providers: [p], original: { providerId: p.id, model: 'stale' }, includeDisabledProviders: true }
  expect(build(input).rejectedCandidates).toContainEqual({ providerId: p.id, reason: 'no_enabled_credentials' })
  const result = build({ ...input, includeDisabledCredentials: true })
  expect(result.candidates).toHaveLength(1)
  expect(result.candidates[0]).toMatchObject({ model: 'stale', credentialGroupId: 'owner' })
  expect(getProviderAvailableModels(p)).toEqual([])
  expect(chooseCredentialForModel(p, 'stale').source.kind).toBe('none')
})

it('retains authoritative emptiness through a failed refresh and metadata reload', async () => {
  const empty = await runCredentialGroupModelSync(provider(), { fetchModels: async () => [], delay: async () => undefined })
  const failed = await runCredentialGroupModelSync(empty, { fetchModels: async () => { throw Error('Discovery unavailable') }, delay: async () => undefined })
  expect(failed.lastModelSyncStatus).toBe('bad')
  expect(failed.credentialGroups![0]).toMatchObject({ lastModelSyncStatus: 'bad', modelCatalogKnown: true, availableModels: [] })
  let record: unknown = null
  const persistence = createProviderMetadataPersistence({ read: async () => record, write: async value => { record = JSON.parse(JSON.stringify(value)) } })
  await persistence.save([failed])
  expectNoStaleModel((await persistence.load())![0])
})

it('retains a failed nonempty catalog and accepts a later successful replacement', async () => {
  const initial = provider({ credentialGroups: [key('owner', ['stale'])] })
  const failed = await runCredentialGroupModelSync(initial, { fetchModels: async () => { throw Error('Retry') } })
  expect(getPolicyAllowedProviderModels(failed)).toEqual(['stale'])
  expect(chooseCredentialForModel(failed, 'stale').credentialGroupId).toBe('owner')
  const replaced = await runCredentialGroupModelSync(failed, { fetchModels: async () => [{ id: 'replacement', name: 'Replacement', provider: 'openai-compatible' }] })
  expect(getPolicyAllowedProviderModels(replaced)).toEqual(['replacement'])
  expect(chooseCredentialForModel(replaced, 'stale').source.kind).toBe('none')
})

it('ignores an unsupported preferred key and rejects strict targeting without transferring the request', () => {
  const p = provider({ credentialGroups: [key('owner', ['stale']), key('other', ['different']), key('unknown', [], { lastModelSyncStatus: undefined })],
    credentialSelection: { strategy: 'balanced', preferredGroupId: 'other' } })
  expect(chooseCredentialForModel(p, 'stale', { preferredCredentialGroupId: 'unknown' }).credentialGroupId).toBe('owner')
  for (const id of ['other', 'unknown']) {
    expect(() => chooseCredentialForModel(p, 'stale', { targetCredentialGroupId: id })).toThrow()
    expect(() => providerForRuntimeFallback({ provider: p, model: 'stale' }, { providerId: p.id, model: 'stale', credentialSource: { kind: 'group', groupId: id } })).toThrow()
  }
  expect(candidates(p).filter(c => c.model === 'stale').map(c => c.credentialGroupId)).toEqual(['owner'])
  expect(chooseCredentialForModel(p, 'stale', { excludedCredentialGroupIds: ['owner'] }).source.kind).toBe('none')
})

it('preserves exact upstream identity when selecting keys', () => {
  const p = provider({ models: ['Model', 'model'], credentialGroups: [key('upper', ['Model']), key('lower', ['model'])] })
  expect(chooseCredentialForModel(p, 'Model').credentialGroupId).toBe('upper')
  expect(chooseCredentialForModel(p, 'model').credentialGroupId).toBe('lower')
  expect(() => chooseCredentialForModel(p, 'Model', { targetCredentialGroupId: 'lower' })).toThrow()
})

it('checks the resolved upstream when an alias shadows another listed model', () => {
  const p = provider({ models: ['short', 'upstream'], modelAliases: [{ alias: 'short', model: 'upstream' }],
    credentialGroups: [key('wrong', ['short']), key('right', ['upstream'])] })
  expect(chooseCredentialForModel(p, 'short').credentialGroupId).toBe('right')
  expect(() => chooseCredentialForModel(p, 'short', { targetCredentialGroupId: 'wrong' })).toThrow()
  expect(candidates(p).filter(c => c.model === 'short').map(c => c.credentialGroupId)).toEqual(['right'])
})

it('keeps genuine remote catalog IDs after a later failed refresh and normalization', async () => {
  const p = provider({ models: ['deepseek-v4-pro'], credentialGroups: [key('owner', ['deepseek-v4-pro'])] })
  const failed = await runCredentialGroupModelSync(p, { fetchModels: async () => { throw Error('Retry') } })
  expect(getPolicyAllowedProviderModels(failed)).toEqual(['deepseek-v4-pro'])
  expect(getProviderAvailableModels(failed)).toEqual(['deepseek-v4-pro'])
  expect(chooseCredentialForModel(failed, 'deepseek-v4-pro').credentialGroupId).toBe('owner')
})

it.each(['manual', 'alias'] as const)('allows an explicitly configured unlisted %s and respects empty selection', kind => {
  const p = provider({ models: [], enabledModels: ['chosen'], ...(kind === 'manual' ? { manualModels: ['chosen'] }
    : { modelAliases: [{ alias: 'chosen', model: 'unlisted' }] }) })
  expect(getPolicyAllowedProviderModels(p)).toEqual(['chosen'])
  expect(chooseCredentialForModel(p, 'chosen').credentialGroupId).toBe('empty')
  expect(candidates(p).some(c => c.model === 'chosen')).toBe(true)
  expect(getPolicyAllowedProviderModels({ ...p, enabledModels: [] })).toEqual([])
  expect(candidates({ ...p, enabledModels: [] })).toEqual([])
})

it('keeps an alias bound to known owners even when another preferred key is empty', () => {
  const p = provider({ enabledModels: ['short'], modelAliases: [{ alias: 'short', model: 'stale' }],
    credentialGroups: [key('owner', ['stale']), key('empty', [])], credentialSelection: { strategy: 'balanced', preferredGroupId: 'empty' } })
  expect(chooseCredentialForModel(p, 'short').credentialGroupId).toBe('owner')
  expect(candidates(p).every(c => c.credentialGroupId === 'owner')).toBe(true)
  expect(() => chooseCredentialForModel(p, 'short', { targetCredentialGroupId: 'empty' })).toThrow()
})

it('allows direct explicit model attempts before discovery without treating empty success as unknown', () => {
  const p = provider({ lastModelSyncStatus: undefined, credentialGroups: [key('unknown', [], { lastModelSyncStatus: undefined })] })
  expect(chooseCredentialForModel(p, 'explicit-model').credentialGroupId).toBe('unknown')
  expect(chooseCredentialForModel(provider(), 'explicit-model').source.kind).toBe('none')
})
