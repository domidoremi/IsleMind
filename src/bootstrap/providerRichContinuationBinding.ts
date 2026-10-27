import { snapshotPlainData } from '@/core'
import {
  providerExecutionIdentityKey,
  requiredFallbackCapabilities,
  snapshotProviderRuntimeRequest,
  type ProviderChatExecutionConstraint,
  type ProviderExecutionTarget,
  type ProviderRuntimeChatRequest,
} from '@/modules/providers'
import { providerChatResolutionRuntime } from './providerChatResolutionRuntime'
import { resolveProviderModelAliasAccess } from './providerModelAccess'
import { resolveProviderModelAlias } from '@/utils/providerModels'

export interface ProviderRichContinuationBinding {
  readonly provider: ProviderRuntimeChatRequest['provider']
  readonly constraint: ProviderChatExecutionConstraint
  bind(request: ProviderRuntimeChatRequest): Promise<ProviderRuntimeChatRequest>
}

interface ProviderRichContinuationAuthority {
  readonly signal?: AbortSignal
  isCurrent?(): boolean
}

/** Captures the observed route, never the preferred route or hydrated metadata as authority. */
export async function captureProviderRichContinuationBinding(
  source: ProviderRuntimeChatRequest,
  observed: ProviderExecutionTarget,
  authority: ProviderRichContinuationAuthority = {},
): Promise<ProviderRichContinuationBinding> {
  const request = snapshotProviderRuntimeRequest(source)
  const originalSignal = authority.signal
  const isCurrent = authority.isCurrent
  const target = snapshotPlainData(observed)
  const catalog = request.executionConstraint?.providerCatalog
  if (!target.scope || !catalog?.some(provider => provider.id === target.providerId)) {
    throw new Error('The actual continuation route has no captured metadata and scope binding.')
  }
  const identity = snapshotPlainData({
    providerId: target.providerId,
    model: target.model,
    credentialSource: target.credentialSource,
    protocolAdapterId: target.protocolAdapterId,
    endpointVariant: target.endpointVariant,
  })
  const producingMetadata = catalog.find(provider => provider.id === identity.providerId)!
  const originalRequestedModel = request.requestedModel ?? request.model
  // An alias may authorize its own upstream, never a different producing fallback.
  const admissionModel = request.provider.id === identity.providerId
    && resolveProviderModelAlias(producingMetadata, originalRequestedModel) === identity.model
    ? originalRequestedModel : identity.model
  const constraint = snapshotPlainData({
    identity, scope: target.scope, providerCatalog: catalog,
    fallbackUsed: request.executionConstraint!.fallbackUsed
      || providerExecutionIdentityKey(identity) !== providerExecutionIdentityKey(request.executionConstraint!.identity),
  })
  const signal = request.signal ?? new AbortController().signal
  const selection = await resolve(request, signal)
  const provider = snapshotPlainData(selection.provider)

  function assertOriginalAuthority(): void {
    throwIfCancelled(signal)
    if (originalSignal) throwIfCancelled(originalSignal)
    if (!(isCurrent?.() ?? true) || !(request.isSelectionPolicyCurrent?.() ?? true)) {
      throw new Error('The producing turn no longer admits provider continuations.')
    }
  }

  function assertOriginalAccess(selected: ProviderRuntimeChatRequest['provider']): void {
    if (!resolveProviderModelAliasAccess({ provider: selected, model: admissionModel, settings: request.settings }).allowed
      || !resolveProviderModelAliasAccess({ provider: selected, model: admissionModel,
        settings: request.readCurrentAccessSettings?.() }).allowed) {
      throw new Error('The original continuation access was revoked before dispatch.')
    }
  }

  async function resolve(current: ProviderRuntimeChatRequest, currentSignal: AbortSignal) {
    throwIfCancelled(currentSignal)
    assertOriginalAuthority()
    let selected: Awaited<ReturnType<typeof providerChatResolutionRuntime.revalidate>>
    try {
      selected = await providerChatResolutionRuntime.revalidate(constraint, {
        preferred: { providerId: identity.providerId, model: admissionModel },
        providers: catalog, settings: current.settings, signal: currentSignal,
        requiredCapabilities: requiredFallbackCapabilities(current), allowFallback: false,
        ...(identity.credentialSource.kind === 'group'
          ? { targetCredentialGroupId: identity.credentialSource.groupId } : {}),
        readCurrentAccessSettings: current.readCurrentAccessSettings,
        isSelectionPolicyCurrent: () => {
          assertOriginalAuthority()
          return current.isSelectionPolicyCurrent?.() ?? true
        },
      })
    } catch (error) {
      throwIfCancelled(currentSignal)
      assertOriginalAuthority()
      throw error
    }
    throwIfCancelled(currentSignal)
    assertOriginalAuthority()
    if (!selected) throw new Error('The actual continuation route changed before dispatch.')
    assertOriginalAccess(selected.provider)
    selected.checkCurrentAdmission?.()
    return selected
  }

  return Object.freeze({
    provider,
    constraint,
    async bind(source: ProviderRuntimeChatRequest) {
      const current = snapshotProviderRuntimeRequest(source)
      if (current.provider.id !== identity.providerId || current.model !== identity.model) {
        throw new Error('The continuation request does not match its actual producing route.')
      }
      const selected = await resolve(current, current.signal ?? signal)
      if (selected.provider.apiKey !== provider.apiKey) {
        throw new Error('The actual continuation credential changed before dispatch.')
      }
      // Retain the original authority through downstream awaits and the last synchronous wire check.
      const isSelectionPolicyCurrent = () => {
        try {
          assertOriginalAuthority()
          if (current.signal) throwIfCancelled(current.signal)
          assertOriginalAccess(selected.provider)
          selected.checkCurrentAdmission?.()
          return current.isSelectionPolicyCurrent?.() ?? true
        } catch {
          return false
        }
      }
      return {
        ...current,
        provider: selected.provider,
        model: identity.model,
        requestedModel: admissionModel,
        executionConstraint: constraint,
        targetCredentialGroupId: identity.credentialSource.kind === 'group'
          ? identity.credentialSource.groupId : undefined,
        allowFallback: false,
        fallbackProviders: [],
        failoverPolicy: { mode: 'off' as const },
        confirmFallback: undefined,
        settings: snapshotPlainData({ ...current.settings, upstreamMaxRetries: 0 }),
        isSelectionPolicyCurrent,
      }
    },
  })
}

function throwIfCancelled(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error('The provider continuation was cancelled.')
  error.name = 'AbortError'
  throw error
}
