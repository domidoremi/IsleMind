import {
  createProviderActivation,
  type ProviderActivationPorts,
} from './providerActivation'
import { createProviderCredentialSynchronization } from './providerCredentialSynchronization'
import { runCredentialGroupModelSync } from './providerCredentialGroups'
import type { AIModel, AIProvider } from '@/types/providerContracts'

const scenarios = (['group', 'primary'] as const).flatMap(source =>
  (['success', 'failure'] as const).flatMap(status =>
    [false, true].map(enable => ({ source, status, enable }))),
)

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
    expect(saved.lastModelSyncStatus).toBe(status === 'success' ? 'ok' : 'bad')
    expect(saved.credentialGroups?.[0].lastModelSyncStatus).toBe(status === 'success' ? 'ok' : 'bad')
    expect(result.synced).toBe(status === 'success')
    expect(result.tested).toBe(false)
    expect(modelTest).not.toHaveBeenCalled()
    expect(retainedSyncData?.apiKey).toBe(key)
    expect(retainedSyncData?.apiKeySource).toEqual(credentialSource)
    expect(retainedSyncData?.credentialGroups?.[0].apiKey).toBe(key)
  },
)
