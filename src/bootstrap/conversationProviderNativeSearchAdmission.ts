import {
  createProviderConversationNativeSearchAdmission,
  createProviderNativeSearchSupportPolicy,
  providerCompatibilityCapabilityCanBeSentForProvider,
  resolveOpenAIResponsesWebSearchToolPolicy,
} from '@/modules/providers'

const providerNativeSearchSupportPolicy = createProviderNativeSearchSupportPolicy({
  compatibilityCapabilityCanBeSent(provider, capability, explicitDeclaration) {
    return providerCompatibilityCapabilityCanBeSentForProvider(
      provider,
      capability,
      explicitDeclaration,
    )
  },
  resolveOpenAIResponsesSearchPolicy: resolveOpenAIResponsesWebSearchToolPolicy,
})

export const providerSupportsNativeSearch = providerNativeSearchSupportPolicy.providerSupportsNativeSearch

export const conversationProviderNativeSearchAdmission = createProviderConversationNativeSearchAdmission({
  providerSupportsNativeSearch(provider, model) {
    return providerNativeSearchSupportPolicy.providerSupportsNativeSearch(provider, model)
  },
})
