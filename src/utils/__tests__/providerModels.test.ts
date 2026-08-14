import type { AIProvider, ProviderCredentialGroup } from '@/types/providerContracts'
import { normalizeProviderCredentialGroups } from '@/modules/providers'
import {
  clearHistoricalInjectedGroupModels,
  clearHistoricalInjectedProviderModels,
  getProviderSelectableModels,
} from '@/utils/providerModels'

const REMOTE_MODELS = ['deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-5.2']

function provider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: 'compatible-provider',
    type: 'openai-compatible',
    name: 'Compatible Provider',
    apiKey: '',
    models: [],
    enabled: true,
    ...overrides,
  }
}

function group(overrides: Partial<ProviderCredentialGroup> = {}): ProviderCredentialGroup {
  return {
    id: 'group-1',
    label: 'Group 1',
    apiKey: '',
    enabled: true,
    availableModels: REMOTE_MODELS,
    ...overrides,
  }
}

describe('provider remote model evidence', () => {
  it('preserves remotely synchronized provider and credential-group model ids', () => {
    const syncedGroup = group({ lastModelSyncStatus: 'ok' })
    const syncedProvider = provider({
      models: REMOTE_MODELS,
      lastModelSyncStatus: 'ok',
      credentialGroups: [syncedGroup],
    })

    expect(clearHistoricalInjectedProviderModels(syncedProvider)).toEqual(REMOTE_MODELS)
    expect(clearHistoricalInjectedGroupModels(syncedGroup, syncedProvider)).toEqual(REMOTE_MODELS)
    expect(normalizeProviderCredentialGroups(syncedProvider).credentialGroups?.[0]?.availableModels).toEqual(REMOTE_MODELS)
    expect(getProviderSelectableModels(syncedProvider)).toEqual(REMOTE_MODELS)
  })

  it('still removes unsynchronized historical placeholders', () => {
    const unsyncedGroup = group()
    const unsyncedProvider = provider({ models: REMOTE_MODELS, credentialGroups: [unsyncedGroup] })

    expect(clearHistoricalInjectedProviderModels(unsyncedProvider)).toEqual(['gpt-5.2'])
    expect(clearHistoricalInjectedGroupModels(unsyncedGroup, unsyncedProvider)).toEqual(['gpt-5.2'])
    expect(normalizeProviderCredentialGroups(unsyncedProvider).credentialGroups?.[0]?.availableModels).toEqual(['gpt-5.2'])
  })
})
