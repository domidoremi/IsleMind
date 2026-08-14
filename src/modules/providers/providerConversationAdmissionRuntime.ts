import type { Conversation } from '@/types/chatContracts'
import type { AIProvider, ChatErrorCode } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'

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
    readonly conversation: Conversation
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
  readonly conversation: Conversation
  readonly provider: AIProvider
  readonly upstreamModel: string
  readonly modelConfig: ModelConfig
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
    const currentProvider = input.providers.find(
      (provider) => provider.id === input.conversation.providerId,
    )
    const currentModelValid = currentProvider
      ? dependencies.providerHasModel(currentProvider, input.conversation.model, input.settings)
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
        providerId: currentProvider?.id ?? input.conversation.providerId,
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

    const upstreamModel = dependencies.resolveProviderModelAlias(
      provider,
      input.conversation.model,
    )
    const modelConfig = dependencies.getModelConfig(
      upstreamModel,
      provider.type,
      provider.modelConfigs,
    )
    const request = dependencies.resolveGenerationRequest({
      provider,
      conversation: input.conversation,
      settings: input.settings,
      model: upstreamModel,
      modelConfig,
    })
    const conversation = request.temperature === input.conversation.temperature
      && request.topP === input.conversation.topP
      && request.topK === input.conversation.topK
      && request.maxTokens === input.conversation.maxTokens
      ? input.conversation
      : {
          ...input.conversation,
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
    }
  }

  return { admitConversation }
}
