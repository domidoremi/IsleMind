import type { BoundConversation, Conversation } from '@/types/chatContracts'
import type { AIProvider, ChatErrorCode } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import type { ProviderChatExecutionConstraint, ProviderChatSelection, ProviderChatResolutionReason } from './providerChatResolution'

export interface ProviderConversationAdmissionConfigIssue {
  readonly code: ChatErrorCode
  readonly message: string
  readonly messageKey?: string
}

export interface ProviderConversationGenerationRequest {
  readonly temperature: number
  readonly topP?: number
  readonly topK?: number
  readonly maxTokens: number
}

export interface ProviderConversationAdmissionDependencies<ModelConfig> {
  resolveExecution?(input: ProviderConversationAdmissionInput): Promise<
    | { kind: 'ready'; selection: ProviderChatSelection }
    | { kind: 'blocked'; reason: ProviderChatResolutionReason }
    | { kind: 'cancelled' }
  >
  providerHasModel(provider: AIProvider, model: string, settings: Settings): boolean
  hydrateProviderKey(providerId: string, signal: AbortSignal): Promise<AIProvider | null>
  getProviderConfigIssue(
    provider: AIProvider,
    apiKey: string,
  ): ProviderConversationAdmissionConfigIssue | null
  resolveProviderModelAlias(provider: AIProvider, model: string): string
  getModelConfig(
    model: string,
    providerType: AIProvider['type'],
    modelConfigs: AIProvider['modelConfigs'],
  ): ModelConfig
  resolveGenerationRequest(input: {
    readonly provider: AIProvider
    readonly conversation: BoundConversation
    readonly settings: Settings
    readonly model: string
    readonly modelConfig: ModelConfig
  }): ProviderConversationGenerationRequest
}

export interface ProviderConversationAdmissionInput {
  readonly conversation: Conversation
  readonly providers: readonly AIProvider[]
  readonly settings: Settings
  readonly signal: AbortSignal
}

export interface ProviderConversationAdmissionCancelled {
  readonly kind: 'cancelled'
}

export interface ProviderConversationAdmissionSetupRequired {
  readonly kind: 'setup_required'
}

export type ProviderConversationAdmissionRejectionReason =
  | 'disabled_provider'
  | 'model_unavailable'
  | 'missing_key'
  | 'invalid_configuration'
  | 'offline'
  | 'policy_blocked'
  | 'confirmation_declined'
  | 'candidate_changed'

export interface ProviderConversationAdmissionRejected {
  readonly kind: 'rejected'
  readonly reason: ProviderConversationAdmissionRejectionReason
  readonly code: ChatErrorCode
  readonly providerId?: string
  readonly messageKey?: string
  readonly fallback?: string
}

export interface ProviderConversationAdmissionFailed {
  readonly kind: 'failed'
  readonly reason: 'provider_hydration_failed'
  readonly code: ChatErrorCode
  readonly providerId: string
}

export interface ProviderConversationAdmissionReady<ModelConfig> {
  readonly kind: 'ready'
  readonly conversation: BoundConversation
  readonly provider: AIProvider
  readonly upstreamModel: string
  readonly modelConfig: ModelConfig
  readonly executionModel?: string
  readonly executionConstraint?: ProviderChatExecutionConstraint
}

export type ProviderConversationAdmissionOutcome<ModelConfig> =
  | ProviderConversationAdmissionCancelled
  | ProviderConversationAdmissionSetupRequired
  | ProviderConversationAdmissionRejected
  | ProviderConversationAdmissionFailed
  | ProviderConversationAdmissionReady<ModelConfig>

export function createProviderConversationAdmissionRuntime<ModelConfig>(
  dependencies: ProviderConversationAdmissionDependencies<ModelConfig>,
) {
  async function admitConversation(
    input: ProviderConversationAdmissionInput,
  ): Promise<ProviderConversationAdmissionOutcome<ModelConfig>> {
    if (input.signal.aborted) return { kind: 'cancelled' }
    if (!input.conversation.providerId?.trim() || !input.conversation.model?.trim()) return { kind: 'setup_required' }
    // Both fields were checked above; narrowing must not clone unchanged preferences.
    const preferredConversation = input.conversation as BoundConversation
    if (dependencies.resolveExecution) {
      const outcome = await dependencies.resolveExecution(input)
      if (input.signal.aborted || outcome.kind === 'cancelled') return { kind: 'cancelled' }
      if (outcome.kind === 'blocked') {
        const reason = outcome.reason
        const fallback = reason === 'offline' ? 'Offline. Your preferred model has not changed.'
          : reason === 'policy_blocked' ? 'The request is blocked by provider or capability policy.'
          : reason === 'confirmation_declined' ? 'Cross-provider fallback was not approved. Your preference has not changed.'
          : reason === 'candidate_changed' ? 'The fallback candidate changed. Retry to evaluate the request again.'
          : reason === 'invalid_configuration' ? 'Provider configuration needs attention.' : undefined
        return { kind: 'rejected', reason, code: reason === 'offline' ? 'network_error'
          : reason === 'disabled_provider' || reason === 'missing_key' || reason === 'model_unavailable' ? reason : 'unknown',
          providerId: preferredConversation.providerId,
          ...(fallback ? { fallback } : {}) }
      }
      return ready(outcome.selection.provider, preferredConversation, input.settings,
        outcome.selection.model, outcome.selection.constraint)
    }
    const currentProvider = input.providers.find(
      (provider) => provider.id === input.conversation.providerId,
    )
    const currentModelValid = currentProvider
      ? dependencies.providerHasModel(currentProvider, preferredConversation.model, input.settings)
      : false
    const manualMode = (input.conversation.providerModelMode ?? 'inherited') !== 'inherited'
    const resolvedProvider = currentProvider && currentModelValid && (manualMode || currentProvider.enabled)
      ? currentProvider
      : undefined

    if (input.signal.aborted) return { kind: 'cancelled' }

    if (input.conversation.providerId === 'local-setup') {
      return { kind: 'setup_required' }
    }

    if (!resolvedProvider) {
      if (currentProvider && !currentProvider.enabled) {
        return {
          kind: 'rejected',
          reason: 'disabled_provider',
          code: 'disabled_provider',
          providerId: currentProvider.id,
        }
      }
      return {
        kind: 'rejected',
        reason: 'model_unavailable',
        code: 'model_unavailable',
        providerId: currentProvider?.id ?? preferredConversation.providerId,
      }
    }

    let provider: AIProvider | null
    try {
      provider = await dependencies.hydrateProviderKey(resolvedProvider.id, input.signal)
    } catch {
      if (input.signal.aborted) return { kind: 'cancelled' }
      return {
        kind: 'failed',
        reason: 'provider_hydration_failed',
        code: 'unknown',
        providerId: resolvedProvider.id,
      }
    }

    if (input.signal.aborted) return { kind: 'cancelled' }
    if (!provider || !provider.enabled) {
      return {
        kind: 'rejected',
        reason: 'disabled_provider',
        code: 'disabled_provider',
        providerId: resolvedProvider.id,
      }
    }

    if (!provider.apiKey) {
      return {
        kind: 'rejected',
        reason: 'missing_key',
        code: 'missing_key',
        providerId: provider.id,
      }
    }

    const configIssue = dependencies.getProviderConfigIssue(provider, provider.apiKey)
    if (configIssue) {
      return {
        kind: 'rejected',
        reason: 'invalid_configuration',
        code: configIssue.code,
        providerId: provider.id,
        messageKey: configIssue.messageKey,
        fallback: configIssue.message,
      }
    }

    return ready(provider, preferredConversation, input.settings, preferredConversation.model)
  }

  function ready(provider: AIProvider, preferredConversation: BoundConversation, settings: Settings,
    executionModel: string, executionConstraint?: ProviderChatExecutionConstraint): ProviderConversationAdmissionReady<ModelConfig> {
    const upstreamModel = dependencies.resolveProviderModelAlias(provider, executionModel)
    const modelConfig = dependencies.getModelConfig(
      upstreamModel,
      provider.type,
      provider.modelConfigs,
    )
    const request = dependencies.resolveGenerationRequest({
      provider,
      conversation: preferredConversation,
      settings,
      model: upstreamModel,
      modelConfig,
    })
    const conversation = request.temperature === preferredConversation.temperature
      && request.topP === preferredConversation.topP
      && request.topK === preferredConversation.topK
      && request.maxTokens === preferredConversation.maxTokens
      ? preferredConversation
      : {
          ...preferredConversation,
          temperature: request.temperature,
          topP: request.topP,
          topK: request.topK,
          maxTokens: request.maxTokens,
        }

    return {
      kind: 'ready',
      conversation,
      provider,
      upstreamModel,
      modelConfig,
      ...(executionConstraint ? { executionModel, executionConstraint } : {}),
    }
  }

  return { admitConversation }
}
