import { createProviderChatResolutionRuntime, indexProviderHealthRecords, requestProviderFallbackConfirmation,
  resolveProviderEndpointVariant, type ProviderRuntimeChatRequest } from '@/modules/providers'
import { getProviderConfigIssue } from '@/types/providerBaseUrls'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { buildProviderFallbackCandidates } from './providerFallbackCandidates'
import { loadProviderHealthSnapshot } from './providerHealthRepository'
import { resolveProviderModelAliasAccess } from './providerModelAccess'
import { providerModelAvailabilityRuntime } from './providerModelAvailabilityRuntime'
import { resolveProviderProtocolAdapter } from './providerRequestBinding'
import { resolveProviderRuntimeHealthView } from './providerRuntimeHealth'
import { getHostedProviderSupportIssue } from './providerPolicies'
import type { Settings } from '@/types/settingsContracts'

let readCurrentSettings: () => Settings | undefined = () => undefined

export const providerChatResolutionRuntime = createProviderChatResolutionRuntime({
  async readProviders(signal) {
    const { useSettingsStore } = await import('@/store/settingsStore')
    const state = useSettingsStore.getState()
    readCurrentSettings = () => useSettingsStore.getState().settings
    const providers = []
    for (const item of state.providers) {
      if (signal.aborted) break
      const hydrated = await state.hydrateProviderKey(item.id)
      if (hydrated) providers.push(hydrated)
    }
    return providers
  },
  async isOnline() {
    const { getNetworkStateAsync } = await import('expo-network')
    const state = await getNetworkStateAsync()
    // Unknown reachability isn't proof of offline, just as unknown model evidence
    // isn't proof of support. Normal transport/governance still applies.
    return state.isConnected !== false && state.isInternetReachable !== false
  },
  buildCandidates: buildProviderFallbackCandidates,
  async loadHealthRecords() { return indexProviderHealthRecords((await loadProviderHealthSnapshot()).records) },
  configurationValid: (provider) => !getProviderConfigIssue(provider, provider.apiKey) && !getHostedProviderSupportIssue(provider, 'chat'),
  accessAllowed: (provider, model, settings) => resolveProviderModelAliasAccess({ provider, model, settings }).allowed
    && resolveProviderModelAliasAccess({ provider, model, settings: readCurrentSettings() }).allowed,
  resolveIdentity(provider, model, credentialSource) {
    const upstream = resolveProviderModelAlias(provider, model)
    const adapter = resolveProviderProtocolAdapter({ provider, model: upstream, messages: [], generationParameterSources: {} })
    return { providerId: provider.id, model: upstream, credentialSource, protocolAdapterId: adapter.id,
      endpointVariant: resolveProviderEndpointVariant(provider) }
  },
  getAvailability: (identity) => providerModelAvailabilityRuntime.getAvailability(identity),
  captureConfiguration: () => providerModelAvailabilityRuntime.captureConfiguration(),
  async healthAllows(identity) {
    const health = await resolveProviderRuntimeHealthView({ providerId: identity.providerId, model: identity.model,
      ...(identity.credentialSource.kind === 'group' ? { credentialGroupId: identity.credentialSource.groupId } : {}) })
    return health?.status !== 'cooldown' && health?.status !== 'circuit-open'
  },
})

export function chatFallbackConfirmation(request: Pick<ProviderRuntimeChatRequest, 'conversationId' | 'provider' | 'model' | 'requestedModel'>): NonNullable<ProviderRuntimeChatRequest['confirmFallback']> {
  return (candidate, signal) => request.conversationId ? requestProviderFallbackConfirmation({
    conversationId: request.conversationId, preferred: { providerId: request.provider.id, model: request.requestedModel ?? request.model }, candidate, signal,
  }) : Promise.resolve(false)
}
