import type { ModelRoutingPlan } from '@/core/modelRoutingPlan'
import type { AIProvider, ProviderCredentialSource } from '@/types/providerContracts'
import type { ProviderExecutionIdentity } from './providerExecutionTarget'
import type { ProviderFailoverPolicy, ProviderFailoverRoute, ProviderFailoverTrigger } from './providerFailoverPolicy'
import type { ProviderFallbackCandidateBuilder } from './providerFallbackCandidates'
import type { ProviderHealthRecord } from './providerHealth'
import type { ProviderModelAvailability } from './providerModelAvailability'
import type { ProviderModelAccessSettings } from './providerModelAccessPolicy'

/** Request-local admission fence, not a persisted preference or approval. */
export interface ProviderChatExecutionConstraint {
  identity: ProviderExecutionIdentity
  scope: { scopeId: string; epoch: string }
  fallbackUsed: boolean
  routingPlan?: ModelRoutingPlan
  /** Captured selection alias, independent of the conversation preference. */
  requestedModel?: string
  /** Original metadata only; secure hydration and live revocation remain separate. */
  providerCatalog?: readonly AIProvider[]
}

export interface ProviderChatSelection {
  /** Hydrated runtime-only provider. Never passed to Presentation or persisted. */
  provider: AIProvider
  model: string
  constraint: ProviderChatExecutionConstraint
  /** Synchronous revocation check for the captured read; never durable dispatch authority. */
  checkCurrentAdmission?: () => void
}

export interface ProviderChatResolutionInput {
  preferred: { providerId: string; model: string }
  routingPlan?: ModelRoutingPlan
  signal: AbortSignal
  providers?: readonly AIProvider[]
  settings?: ProviderModelAccessSettings
  requiredCapabilities?: readonly string[]
  policy?: Partial<ProviderFailoverPolicy>
  allowFallback?: boolean
  targetCredentialGroupId?: string
  confirmFallback?: (candidate: ProviderFailoverRoute, signal: AbortSignal) => Promise<boolean>
  readCurrentAccessSettings?: () => ProviderModelAccessSettings | undefined
  isSelectionPolicyCurrent?: () => boolean
}

export interface ProviderChatFallbackInput extends ProviderChatResolutionInput {
  original: ProviderFailoverRoute
  trigger: ProviderFailoverTrigger
  /** Already-serialized native declarations can only be replayed by their adapter. */
  requiredProtocolAdapterId?: ProviderExecutionIdentity['protocolAdapterId']
  streamStarted?: boolean
  continuationBound?: boolean
  fallbackUsed?: boolean
}

export type ProviderChatResolutionReason = 'offline' | 'disabled_provider' | 'missing_key' | 'invalid_configuration' | 'model_unavailable' | 'provider_cooldown' | 'policy_blocked' | 'confirmation_declined' | 'candidate_changed'

export interface ProviderChatResolutionDependencies {
  /** providerId limits credential reads; providers retains the full admitted metadata catalog. */
  readProviders(signal: AbortSignal, options?: { readonly providers?: readonly AIProvider[]; readonly providerId?: string }): Promise<readonly AIProvider[]>
  isOnline(provider?: AIProvider): Promise<boolean>
  buildCandidates: ProviderFallbackCandidateBuilder
  loadHealthRecords(): Promise<Record<string, ProviderHealthRecord>>
  configurationValid(provider: AIProvider): boolean
  accessAllowed(provider: AIProvider, model: string, settings?: ProviderModelAccessSettings): boolean
  resolveIdentity(provider: AIProvider, model: string, source: ProviderCredentialSource): ProviderExecutionIdentity
  getAvailability(identity: ProviderExecutionIdentity): Promise<{ scope: { scopeId: string; epoch: string }; availability: ProviderModelAvailability }>
  healthAllows(identity: ProviderExecutionIdentity): Promise<boolean>
  captureConfiguration?(): () => void
  captureDispatchValidation?(constraint: ProviderChatExecutionConstraint, input: ProviderChatResolutionInput): () => void
}
