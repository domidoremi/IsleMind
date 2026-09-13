import { createProviderConversationAdmissionRuntime } from '@/modules/providers'
import { providerHasPolicyModel } from '@/bootstrap/providerModelAccess'
import { resolveConversationGenerationParameterRequest } from '@/bootstrap/providerConversationGeneration'
import { getModelConfig } from '@/types/modelCatalog'
import { getProviderConfigIssue } from '@/types/providerBaseUrls'
import { useSettingsStore } from '@/store/settingsStore'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { providerChatResolutionRuntime } from './providerChatResolutionRuntime'
import { requestProviderFallbackConfirmation, requiredFallbackCapabilities } from '@/modules/providers'

export const conversationProviderAdmissionRuntime = createProviderConversationAdmissionRuntime<ReturnType<typeof getModelConfig>>({
  resolveExecution(input) {
    const preferred = { providerId: input.conversation.providerId!, model: input.conversation.model! }
    const provider = input.providers.find((item) => item.id === preferred.providerId)
    const latestUser = [...input.conversation.messages].reverse().find((message) => message.role === 'user')
    const requiredCapabilities = provider ? requiredFallbackCapabilities({ provider, model: preferred.model,
      attachments: latestUser?.attachments, reasoningEffort: input.conversation.reasoningEffort,
      webSearchMode: input.settings.webSearchEnabled && input.settings.webSearchMode === 'native' ? 'native' : undefined }) : ['text']
    return providerChatResolutionRuntime.resolvePreferred({ preferred, signal: input.signal, settings: input.settings, requiredCapabilities,
      confirmFallback: (candidate, signal) => requestProviderFallbackConfirmation({ conversationId: input.conversation.id, preferred, candidate, signal }) })
  },
  providerHasModel: providerHasPolicyModel,
  async hydrateProviderKey(providerId, signal) {
    if (signal.aborted) return null
    const provider = await useSettingsStore.getState().hydrateProviderKey(providerId) ?? null
    return signal.aborted ? null : provider
  },
  getProviderConfigIssue,
  resolveProviderModelAlias,
  getModelConfig,
  resolveGenerationRequest: resolveConversationGenerationParameterRequest,
})
