import { snapshotPlainData } from '@/core'
import { providerRequestHasRouteBoundContinuation } from './providerRuntimeFallback'
import type { ProviderRuntimeChatRequest } from './providerRuntimeContracts'

/** Capture execution data, not callbacks, signals or transport ownership. */
export function snapshotProviderRuntimeRequest(
  source: ProviderRuntimeChatRequest,
  snapshots = new WeakMap<object, unknown>(),
): ProviderRuntimeChatRequest {
  const request: ProviderRuntimeChatRequest = {
    ...source,
    provider: snapshotPlainData(source.provider, snapshots),
    messages: snapshotPlainData(source.messages, snapshots),
    generationParameterSources: snapshotPlainData(source.generationParameterSources, snapshots),
    generationParameterPlan: snapshotPlainData(source.generationParameterPlan, snapshots),
    attachments: snapshotPlainData(source.attachments, snapshots),
    retrievalSources: snapshotPlainData(source.retrievalSources, snapshots),
    usageContext: snapshotPlainData(source.usageContext, snapshots),
    settings: snapshotPlainData(source.settings, snapshots),
    remoteCompactFallback: snapshotPlainData(source.remoteCompactFallback, snapshots),
    fallbackProviders: snapshotPlainData(source.fallbackProviders, snapshots),
    failoverPolicy: snapshotPlainData(source.failoverPolicy, snapshots),
    executionConstraint: snapshotPlainData(source.executionConstraint, snapshots),
    providerToolDeclarations: snapshotPlainData(source.providerToolDeclarations, snapshots),
    structuredOutput: snapshotPlainData(source.structuredOutput, snapshots),
  }
  const policy = JSON.stringify(request.failoverPolicy)
  const continuationBound = providerRequestHasRouteBoundContinuation(request)
  const fallbackUsed = request.executionConstraint?.fallbackUsed
  const allowFallback = request.allowFallback
  const targetCredentialGroupId = request.targetCredentialGroupId
  const earlierPolicyCheck = source.isSelectionPolicyCurrent
  request.readCurrentAccessSettings = source.readCurrentAccessSettings ?? (() => source.settings)
  request.isSelectionPolicyCurrent = () => {
    try {
      return (earlierPolicyCheck?.() ?? true)
        && JSON.stringify(source.failoverPolicy) === policy
        && source.allowFallback === allowFallback
        && source.targetCredentialGroupId === targetCredentialGroupId
        && source.executionConstraint?.fallbackUsed === fallbackUsed
        && providerRequestHasRouteBoundContinuation(source) === continuationBound
    } catch {
      return false
    }
  }
  // Pipeline health projections may replace top-level data without mutating its caller.
  return request
}
