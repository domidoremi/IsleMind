import {
  createProviderActivation,
  type ProviderActivationPorts,
} from './providerActivation'
import { createProviderCredentialSynchronization } from './providerCredentialSynchronization'
import { runCredentialGroupModelSync } from './providerCredentialGroups'
import type { AIModel, AIProvider } from '@/types/providerContracts'
import { getProviderAvailableModels, getProviderManualModels, getProviderPreferredModel, isProviderChatCompatibleModel } from '@/utils/providerModels'
import { resolveProviderModelAliasAccess } from '@/bootstrap/providerModelAccess'

const scenarios = (['group', 'primary'] as const).flatMap(source =>
  (['success', 'empty', 'failure'] as const).flatMap(status =>
    [false, true].map(enable => ({ source, status, enable }))),
)

function ownedModelActivation() {
  const test = jest.fn(async () => ({ ok: true, code: 'ok' as const, message: 'Synthetic model accepted' }))
  const runtime = createProviderActivation({
    translate: key => key,
    synchronizeProviderCredentials: async source => ({ ok: true, code: 'ok', message: 'Fetched', data: source }),
    testProviderModel: test,
    getAvailableModels: getProviderAvailableModels, getManualModels: getProviderManualModels,
    getPreferredModel: getProviderPreferredModel, isChatCompatibleModel: isProviderChatCompatibleModel,
    isModelAllowed: (provider, model, settings) => resolveProviderModelAliasAccess({ provider, model, settings }).allowed,
  })
  return { runtime, test }
}

const ownershipFixture: AIProvider = {
  id: 'activation-owners', name: 'Activation owners', type: 'openai-compatible', enabled: true,
  apiKey: 'synthetic-legacy', models: ['Model', 'model'], manualModels: [], lastModelSyncStatus: 'ok',
  credentialGroups: [
    { id: 'lower', label: 'Lower', apiKey: 'synthetic-lower', enabled: true, availableModels: ['model'], lastModelSyncStatus: 'ok' },
    { id: 'upper', label: 'Upper', apiKey: 'synthetic-upper', enabled: true, availableModels: ['Model'], lastModelSyncStatus: 'ok' },
    { id: 'unknown', label: 'Unknown', apiKey: 'synthetic-unknown', enabled: true },
  ],
}

it('limits explicit activation tests to the exact model owner and follows alias targets', () => {
  const { runtime } = ownedModelActivation()
  expect(runtime.buildTestCandidates(ownershipFixture, 'Model').map(c => c.groupId)).toEqual(['upper'])
  expect(runtime.buildTestCandidates(ownershipFixture, 'model').map(c => c.groupId)).toEqual(['lower'])
  expect(runtime.buildTestCandidates({ ...ownershipFixture, modelAliases: [{ alias: 'model', model: 'Model' }] }, 'model')
    .map(c => c.groupId)).toEqual(['upper'])
})

it('does not substitute another model when an explicit activation test is unselected or blocked', () => {
  const { runtime } = ownedModelActivation()
  expect(runtime.buildTestCandidates({ ...ownershipFixture, enabledModels: ['model'] }, 'Model')).toEqual([])
  expect(runtime.buildTestCandidates(ownershipFixture, 'Model', { modelBlocklist: ['Model'] })).toEqual([])
})

it('does not revive a disabled model owner through unknown groups or the legacy primary', () => {
  const { runtime } = ownedModelActivation()
  const p = { ...ownershipFixture, credentialGroups: ownershipFixture.credentialGroups!.map(g => g.id === 'upper' ? { ...g, enabled: false } : g) }
  expect(runtime.buildTestCandidates(p, 'Model')).toEqual([])
  const disabled = { ...p, manualModels: ['manual'], credentialGroups: p.credentialGroups.map(g => ({ ...g, enabled: false })) }
  expect(runtime.buildTestCandidates(disabled, 'manual')).toEqual([])
  expect(runtime.buildTestCandidates(disabled)).toEqual([])
})

it('keeps automatic manual-model checks bound to the known owner after catalog failure', () => {
  const { runtime } = ownedModelActivation()
  const p = { ...ownershipFixture, manualModels: ['Model'], credentialGroups: ownershipFixture.credentialGroups!.map(g => ({ ...g,
    lastModelSyncStatus: 'bad' as const, modelCatalogKnown: g.id !== 'unknown' })) }
  expect(runtime.buildTestCandidates(p).map(c => c.groupId)).toEqual(['upper'])
})

it('permits unknown and explicit manual primary models while honoring confirmed empty catalogs', () => {
  const { runtime } = ownedModelActivation()
  const empty = { ...ownershipFixture, models: [], credentialGroups: undefined }
  expect(runtime.buildTestCandidates(empty, 'new-model')).toEqual([])
  expect(runtime.buildTestCandidates({ ...empty, lastModelSyncStatus: undefined }, 'new-model')).toHaveLength(1)
  expect(runtime.buildTestCandidates({ ...empty, manualModels: ['new-model'] }, 'new-model')).toHaveLength(1)
})

it('dispatches the requested activation test once through its owner and records that identity', async () => {
  const { runtime, test } = ownedModelActivation()
  let saved = ownershipFixture
  const result = await runtime.syncAndTestProvider(saved, {
    updateProvider: async (_id, patch) => { saved = { ...saved, ...patch } },
    hydrateProviderKey: async () => ({ ...saved, apiKey: ownershipFixture.apiKey,
      credentialGroups: saved.credentialGroups!.map(g => ({ ...g, apiKey: ownershipFixture.credentialGroups!.find(k => k.id === g.id)!.apiKey })) }),
    updateProviderCredentialGroupHealth: async () => undefined,
  }, { testModel: 'Model', testModels: true })
  expect(test).toHaveBeenCalledTimes(1)
  expect(test).toHaveBeenCalledWith(expect.anything(), 'Model', 'synthetic-upper', expect.anything())
  expect(result).toMatchObject({ tested: true, testOk: true, testModel: 'Model', testGroupId: 'upper' })
})

it.each(scenarios)(
  'keeps $source credentials read-only during catalog $status with explicit enable=$enable',
  async ({ source, status, enable }) => {
    const key = 'owned-inert-catalog-boundary-key'
    const primaryStorageKey = 'owned-provider.primary'
    const groupStorageKey = 'owned-provider.group'
    const credentialSource = source === 'group'
      ? { kind: 'group' as const, groupId: 'owned-group' }
      : { kind: 'primary' as const }
    const secure = new Map([[source === 'group' ? groupStorageKey : primaryStorageKey, key]])
    const originalSecure = new Map(secure)
    let saved: AIProvider = {
      id: 'owned-provider', name: 'Owned catalog provider', type: 'openai-compatible',
      presetId: 'custom-endpoint', wireProtocol: 'openai-compatible',
      baseUrl: 'https://owned-catalog-fixture.invalid/v1', apiKey: '', enabled: false,
      models: ['owned-manual-model'], manualModels: ['owned-manual-model'],
      credentialGroups: [{
        id: 'owned-group', label: 'Owned group', apiKey: '', enabled: true,
        source: credentialSource, availableModels: [],
      }],
    }
    const updatesSeen: Partial<AIProvider>[] = []
    const hydrate = (): AIProvider => ({
      ...saved,
      apiKey: secure.get(source === 'group' ? groupStorageKey : primaryStorageKey) ?? '',
      apiKeySource: credentialSource,
      credentialGroups: saved.credentialGroups?.map(group => ({
        ...group,
        apiKey: secure.get(source === 'group' ? groupStorageKey : primaryStorageKey) ?? '',
      })),
    })
    const ports: ProviderActivationPorts = {
      async updateProvider(_id, updates) {
        updatesSeen.push(updates)
        if (updates.apiKey) secure.set(primaryStorageKey, updates.apiKey)
        for (const group of updates.credentialGroups ?? []) {
          if (group.apiKey) secure.set(groupStorageKey, group.apiKey)
        }
        saved = {
          ...saved, ...updates, apiKey: '',
          credentialGroups: (updates.credentialGroups ?? saved.credentialGroups)?.map(group => ({
            ...group, apiKey: '',
          })),
        }
        delete saved.apiKeySource
      },
      async hydrateProviderKey() { return hydrate() },
      async updateProviderCredentialGroupHealth() {},
    }
    const synchronization = createProviderCredentialSynchronization({
      messages: {
        saveTokenGroupFirst: 'Save a token first',
        defaultToken: 'Owned default token',
        credentialGroupsSynced: 'Owned catalog synchronized',
      },
      synchronize: (provider, deps) => runCredentialGroupModelSync(provider, deps),
      fetchModels: async () => status === 'success'
        ? {
            ok: true, code: 'ok', message: 'Owned model list',
            data: [{ id: 'owned-remote-model', name: 'Owned remote model', provider: 'openai-compatible' } as AIModel],
          }
        : status === 'empty' ? { ok: false, code: 'empty_models', message: 'Empty catalog', data: [] }
        : { ok: false, code: 'unknown', message: 'Owned catalog failure' },
    })
    let retainedSyncData: AIProvider | undefined
    const modelTest = jest.fn(async () => { throw new Error('Catalog retrieval must not test a model') })
    const activation = createProviderActivation({
      translate: text => text,
      async synchronizeProviderCredentials(provider, options) {
        const result = await synchronization.synchronize(provider, options)
        retainedSyncData = result.data
        return result
      },
      testProviderModel: modelTest,
      getAvailableModels: provider => [...new Set([...provider.models, ...(provider.manualModels ?? [])])],
      getManualModels: provider => provider.manualModels ?? [],
      getPreferredModel: provider => provider.manualModels?.[0] ?? provider.models[0],
      isChatCompatibleModel: () => true,
      isModelAllowed: () => true,
    })
    const result = await activation.syncAndTestProvider(saved, ports, { enable, testModels: false })

    const catalogUpdate = updatesSeen.find(updates => Object.hasOwn(updates, 'credentialGroups'))
    expect(catalogUpdate).toBeDefined()
    expect(Object.hasOwn(catalogUpdate!, 'apiKey')).toBe(false)
    expect(Object.hasOwn(catalogUpdate!, 'apiKeySource')).toBe(false)
    expect(catalogUpdate!.credentialGroups?.every(group => !Object.hasOwn(group, 'apiKey'))).toBe(true)
    expect(catalogUpdate!.credentialGroups?.[0].source).toEqual(credentialSource)
    expect(secure).toEqual(originalSecure)
    expect(saved.enabled).toBe(enable)
    expect(saved.manualModels).toEqual(['owned-manual-model'])
    expect(saved.lastModelSyncStatus).toBe(status === 'failure' ? 'bad' : 'ok')
    expect(saved.credentialGroups?.[0].lastModelSyncStatus).toBe(status === 'failure' ? 'bad' : 'ok')
    expect(result.synced).toBe(status !== 'failure')
    expect(result.tested).toBe(false)
    expect(modelTest).not.toHaveBeenCalled()
    expect(retainedSyncData?.apiKey).toBe(key)
    expect(retainedSyncData?.apiKeySource).toEqual(credentialSource)
    expect(retainedSyncData?.credentialGroups?.[0].apiKey).toBe(key)
  },
)
