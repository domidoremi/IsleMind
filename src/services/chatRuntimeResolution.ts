import type { AIProvider, ChatErrorCode, Conversation, Settings } from '@/types'
import { getPolicyAllowedProviderModels } from '@/services/ai/policy/providerModelAccess'

export interface RuntimeConversationResolution {
  conversation: Conversation
  provider: AIProvider
}

export interface RuntimeResolutionError {
  code: ChatErrorCode
  providerId?: string
}

export function resolveRuntimeConversation(input: {
  conversation: Conversation
  providers: AIProvider[]
  settings: Settings
}): RuntimeConversationResolution | null {
  const currentProvider = input.providers.find((item) => item.id === input.conversation.providerId)
  if ((input.conversation.providerModelMode ?? 'inherited') !== 'inherited') {
    return currentProvider && getPolicyAllowedProviderModels(currentProvider, input.settings).includes(input.conversation.model)
      ? { conversation: input.conversation, provider: currentProvider }
      : null
  }
  if (currentProvider?.enabled && getPolicyAllowedProviderModels(currentProvider, input.settings).includes(input.conversation.model)) {
    return { conversation: input.conversation, provider: currentProvider }
  }
  return null
}

export function resolveRuntimeResolutionError(input: {
  conversation: Conversation
  providers: AIProvider[]
}): RuntimeResolutionError {
  const provider = input.providers.find((item) => item.id === input.conversation.providerId)
  if (provider && !provider.enabled) {
    return { code: 'disabled_provider', providerId: provider.id }
  }
  return { code: 'model_unavailable', providerId: provider?.id ?? input.conversation.providerId }
}
