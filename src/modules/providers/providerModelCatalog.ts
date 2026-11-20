import type { AIProvider, ProviderCredentialGroup, ProviderTestStatus } from '@/types/providerContracts'

export interface CredentialModelCatalog {
  availableModels?: readonly string[]
  lastModelSyncStatus?: ProviderTestStatus
  modelCatalogKnown?: boolean
}

/** A successful empty response is a catalog, and stays one after a failed refresh. */
export function hasCredentialModelCatalog(group: CredentialModelCatalog): boolean {
  return group.modelCatalogKnown === true || group.lastModelSyncStatus === 'ok' || !!group.availableModels?.length
}

/** Group catalogs own their models. A provider aggregate cannot revive a disabled group. */
export function getProviderRemoteModelSources(provider: AIProvider): readonly { models: readonly string[]; confirmed: boolean }[] {
  if (provider.credentialGroups?.length) {
    return provider.credentialGroups.filter(group => group.enabled !== false).map(group => ({
      models: group.availableModels ?? [], confirmed: group.modelCatalogKnown === true || group.lastModelSyncStatus === 'ok',
    }))
  }
  if (provider.modelCatalogKnown === true || provider.lastModelSyncStatus === 'ok'
    || provider.lastModelSyncStatus === 'bad' && provider.models.length) return [{ models: provider.models,
      confirmed: provider.modelCatalogKnown === true || provider.lastModelSyncStatus === 'ok' }]
  return provider.lastTestStatus === 'ok' && provider.lastTestModel ? [{ models: [provider.lastTestModel], confirmed: true }] : []
}

export function credentialListsModel(group: CredentialModelCatalog, model: string, upstreamModel = model): boolean {
  return !!group.availableModels?.some(id => id.trim() === upstreamModel.trim())
}

export function isProviderModelManuallyConfigured(provider: Pick<AIProvider, 'manualModels' | 'modelAliases'>, model: string, upstreamModel = model): boolean {
  return !!provider.manualModels?.some(id => id.trim() === model.trim() || id.trim() === upstreamModel.trim())
    || !!provider.modelAliases?.some(alias => alias.model.trim() === upstreamModel.trim())
}

export function credentialCanUseProviderModel(provider: AIProvider, group: CredentialModelCatalog, model: string, upstreamModel = model): boolean {
  if (credentialListsModel(group, model, upstreamModel)) return true
  // A disabled or excluded owner cannot transfer its models to an unlisted key.
  if (provider.credentialGroups?.some(owner => credentialListsModel(owner, model, upstreamModel))) return false
  return isProviderModelManuallyConfigured(provider, model, upstreamModel) || !hasCredentialModelCatalog(group)
}

export function primaryCredentialModelCatalog(provider: AIProvider): Pick<ProviderCredentialGroup, 'availableModels' | 'lastModelSyncStatus' | 'modelCatalogKnown'> {
  return {
    availableModels: provider.lastModelSyncStatus === 'ok' || provider.lastModelSyncStatus === 'bad' || provider.modelCatalogKnown === true
      ? provider.models : [],
    lastModelSyncStatus: provider.lastModelSyncStatus,
    modelCatalogKnown: provider.modelCatalogKnown === true || provider.lastModelSyncStatus === 'ok',
  }
}
