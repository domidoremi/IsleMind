import { createProviderConversationAdmissionRuntime } from '@/modules/providers'
import { providerHasPolicyModel } from '@/bootstrap/providerModelAccess'
import { resolveConversationGenerationParameterRequest } from '@/bootstrap/providerConversationGeneration'
import { getModelConfig } from '@/types/modelCatalog'
import { getProviderConfigIssue } from '@/types/providerBaseUrls'
import { useSettingsStore } from '@/store/settingsStore'
import { resolveProviderModelAlias } from '@/utils/providerModels'

export const conversationProviderAdmissionRuntime = createProviderConversationAdmissionRuntime<ReturnType<typeof getModelConfig>>({
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
