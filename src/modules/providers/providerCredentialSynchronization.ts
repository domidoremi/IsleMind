import type { AIModel, AIProvider, ProviderCredentialGroup } from '@/types/providerContracts'
import { failure, success, type ProviderOperationResult } from './providerOperationResult'

export interface ProviderCredentialSynchronizationOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ProviderCredentialSynchronizationMessages {
  saveTokenGroupFirst: string
  defaultToken: string
  credentialGroupsSynced: string
}

export interface ProviderCredentialSynchronizationDependencies {
  messages: ProviderCredentialSynchronizationMessages
  synchronize(
    provider: AIProvider,
    dependencies: {
      fetchModels(provider: AIProvider, group: ProviderCredentialGroup): Promise<AIModel[]>
      signal?: AbortSignal
    },
  ): Promise<AIProvider>
  fetchModels(
    provider: AIProvider,
    apiKey: string,
    options: ProviderCredentialSynchronizationOptions,
  ): Promise<ProviderOperationResult<AIModel[]>>
}

export interface ProviderCredentialSynchronization {
  synchronize(
    provider: AIProvider,
    options?: ProviderCredentialSynchronizationOptions,
  ): Promise<ProviderOperationResult<AIProvider>>
}

/** Owns credential-group synchronization admission and result semantics. */
export function createProviderCredentialSynchronization(
  dependencies: ProviderCredentialSynchronizationDependencies,
): ProviderCredentialSynchronization {
  return {
    async synchronize(provider, options = {}) {
      const groups = provider.credentialGroups?.filter(
        (group) => group.enabled && group.apiKey?.trim(),
      ) ?? []
      if (!groups.length && !provider.apiKey.trim()) {
        return failure('missing_key', dependencies.messages.saveTokenGroupFirst)
      }

      const sourceGroups = groups.length
        ? provider.credentialGroups
        : [{
            id: 'default',
            label: dependencies.messages.defaultToken,
            enabled: true,
            apiKey: provider.apiKey,
            availableModels: [],
          }]
      const synchronized = await dependencies.synchronize(
        { ...provider, credentialGroups: sourceGroups },
        {
          fetchModels: async (source, group) => {
            const result = await dependencies.fetchModels(
              source,
              group.apiKey ?? '',
              options,
            )
            if (!result.ok || !result.data?.length) throw new Error(result.message)
            return result.data
          },
          signal: options.signal,
        },
      )
      return success(dependencies.messages.credentialGroupsSynced, synchronized)
    },
  }
}
