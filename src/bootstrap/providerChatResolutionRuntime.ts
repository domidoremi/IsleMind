import { snapshotPlainData } from '@/core'
import { assertProviderConfiguration, createProviderChatResolutionRuntime, indexProviderHealthRecords, requestProviderFallbackConfirmation,
  resolveProviderEndpointVariant, type ProviderRuntimeChatRequest } from '@/modules/providers'
import { getProviderConfigIssue } from '@/types/providerBaseUrls'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { buildProviderFallbackCandidates } from './providerFallbackCandidates'
import { loadProviderHealthSnapshot } from './providerHealthRepository'
import { resolveProviderModelAliasAccess } from './providerModelAccess'
import { captureProviderModelDispatchEvidence, providerModelAvailabilityRuntime } from './providerModelAvailabilityRuntime'
import { resolveProviderProtocolAdapter } from './providerRequestBinding'
import { captureProviderRuntimeHealthDispatch, resolveProviderRuntimeHealthView } from './providerRuntimeHealth'
import { getHostedProviderSupportIssue } from './providerPolicies'
import type { Settings } from '@/types/settingsContracts'
import type { AIProvider } from '@/types/providerContracts'

let readCurrentSettings: () => Settings | undefined = () => undefined
let readCurrentProviders: () => readonly AIProvider[] | undefined = () => undefined

export const providerChatResolutionRuntime = createProviderChatResolutionRuntime({
  async readProviders(signal, options) {
    const admittedProviders = snapshotPlainData(options?.providers)
    throwIfProviderSelectionCancelled(signal)
    const { useSettingsStore } = await import('@/store/settingsStore')
    throwIfProviderSelectionCancelled(signal)
    const state = useSettingsStore.getState()
    readCurrentSettings = () => useSettingsStore.getState().settings
    readCurrentProviders = () => useSettingsStore.getState().providers
    const catalog = admittedProviders ?? snapshotPlainData(state.providers)
    const providers = []
    for (const item of catalog) {
      throwIfProviderSelectionCancelled(signal)
      const hydrated = snapshotPlainData(await state.hydrateProviderKey(item.id, { providers: catalog, signal }))
      throwIfProviderSelectionCancelled(signal)
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
  captureDispatchValidation(constraint, input) {
    const catalog = snapshotPlainData(constraint.providerCatalog ?? input.providers
      ?? readCurrentProviders()?.filter(provider => provider.id === constraint.identity.providerId))
    const checkEvidence = captureProviderModelDispatchEvidence(constraint.scope.scopeId, constraint.identity.model)
    const checkHealth = captureProviderRuntimeHealthDispatch(constraint.identity.providerId)
    return () => {
      const current = readCurrentProviders()
      const selected = catalog?.find(provider => provider.id === constraint.identity.providerId)
      if (!selected || !current) throw new Error('Provider metadata is unavailable before dispatch')
      for (const expected of catalog ?? []) {
        assertProviderConfiguration(current.find(provider => provider.id === expected.id), expected)
      }
      if (!resolveProviderModelAliasAccess({ provider: selected, model: input.preferred.model,
        settings: readCurrentSettings() }).allowed) throw new Error('Provider access changed before dispatch')
      checkEvidence()
      checkHealth()
    }
  },
  async healthAllows(identity) {
    const health = await resolveProviderRuntimeHealthView({ providerId: identity.providerId, model: identity.model,
      ...(identity.credentialSource.kind === 'group' ? { credentialGroupId: identity.credentialSource.groupId } : {}) })
    return health?.status !== 'cooldown' && health?.status !== 'circuit-open'
  },
})

function throwIfProviderSelectionCancelled(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error('Provider selection was cancelled.')
  error.name = 'AbortError'
  throw error
}

export function chatFallbackConfirmation(request: Pick<ProviderRuntimeChatRequest, 'conversationId' | 'provider' | 'model' | 'requestedModel'>): NonNullable<ProviderRuntimeChatRequest['confirmFallback']> {
  return (candidate, signal) => request.conversationId ? requestProviderFallbackConfirmation({
    conversationId: request.conversationId, preferred: { providerId: request.provider.id, model: request.requestedModel ?? request.model }, candidate, signal,
  }) : Promise.resolve(false)
}
