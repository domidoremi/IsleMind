import { createProviderCredentialSynchronization } from './providerCredentialSynchronization'
import { createProviderModelList } from './providerModelList'
import { failure } from './providerOperationResult'
import type { AIProvider } from '@/types/providerContracts'

it('explicit synchronization bypasses cached success and retries the current endpoint after failure', async () => {
  const provider = { id: 'local', type: 'openai', baseUrl: 'http://localhost/v1', apiKey: 'local' } as AIProvider
  const fetchModels = jest.fn().mockResolvedValueOnce([{ id: 'first' }])
    .mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce([{ id: 'recovered' }])
  const list = createProviderModelList({
    defaultTimeoutMs: 1000, configurationIssue: () => undefined, hostedIssue: () => undefined,
    credentialGroupId: () => undefined, fetchModels, now: () => 0,
    fetchFailure: () => failure('network_error', 'unavailable'),
    messages: { saveApiKeyFirst: 'missing', emptyModels: 'empty', modelsFetched: () => 'fetched' },
  })
  const sync = createProviderCredentialSynchronization({
    messages: { saveTokenGroupFirst: 'missing', defaultToken: 'default', credentialGroupsSynced: 'synced' },
    fetchModels: list.listDetailed,
    synchronize: async (source, deps) => {
      const models = await deps.fetchModels(source, source.credentialGroups![0])
      return { ...source, models: models.map(model => model.id) }
    },
  })
  expect((await sync.synchronize(provider)).data?.models).toEqual(['first'])
  await expect(sync.synchronize(provider)).rejects.toThrow('unavailable')
  expect((await sync.synchronize(provider)).data?.models).toEqual(['recovered'])
  expect(fetchModels).toHaveBeenCalledTimes(3)
})
