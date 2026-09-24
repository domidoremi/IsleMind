import type { ProviderCredentialSource } from './providerCredentials'
import type { ProviderProtocolAdapterId } from './providerProtocolAdapter'

/** Secret-free actual wire identity. Never persisted as the Conversation preference. */
export interface ProviderExecutionIdentity {
  providerId: string
  model: string
  credentialSource: ProviderCredentialSource
  protocolAdapterId: ProviderProtocolAdapterId
  /** Opaque variant/deployment identity, never a URL, header or credential fingerprint. */
  endpointVariant: string
}

export interface ProviderExecutionTarget extends ProviderExecutionIdentity {
  attemptId: string
  scope?: { scopeId: string; epoch: string }
  /** Final assembled request estimate. No prompt, media, credentials or billing claims. */
  tokenEstimate?: { inputTokens: number; outputTokens: number; rawInputTokens?: number; calibrationKey?: string; managedTextBytes?: number }
}

/** Awaited out-of-band before output is delivered; does not commit a stream. */
export type ProviderExecutionTargetObserver = (target: ProviderExecutionTarget) => Promise<void>

let executionAttemptSequence = 0

export class ProviderExecutionTargetObserverError extends Error {
  constructor(cause: unknown) {
    super('Could not record the actual provider execution target.', { cause })
    this.name = 'ProviderExecutionTargetObserverError'
  }
}

/** Called at the wire boundary, outside retry classification. Observer failure stops dispatch. */
export async function reportProviderExecutionTarget(
  identity: ProviderExecutionIdentity,
  signal: AbortSignal,
  observer?: ProviderExecutionTargetObserver,
): Promise<ProviderExecutionTarget> {
  const checkCancellation = () => {
    if (signal.aborted) {
      const error = new Error('Provider execution was cancelled')
      error.name = 'AbortError'
      throw error
    }
  }
  checkCancellation()
  const target: ProviderExecutionTarget = {
    providerId: identity.providerId,
    model: identity.model,
    credentialSource: identity.credentialSource.kind === 'group'
      ? { kind: 'group', groupId: identity.credentialSource.groupId } : { kind: identity.credentialSource.kind },
    protocolAdapterId: identity.protocolAdapterId,
    endpointVariant: identity.endpointVariant,
    attemptId: `execution-${Date.now().toString(36)}-${(++executionAttemptSequence).toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  }
  try {
    await observer?.(target)
  } catch (error) {
    checkCancellation()
    throw new ProviderExecutionTargetObserverError(error)
  }
  checkCancellation()
  return target
}

export function providerExecutionIdentityKey(identity: ProviderExecutionIdentity): string {
  return JSON.stringify([
    identity.providerId, identity.model,
    identity.credentialSource.kind,
    identity.credentialSource.kind === 'group' ? identity.credentialSource.groupId : '',
    identity.protocolAdapterId, identity.endpointVariant,
  ])
}
