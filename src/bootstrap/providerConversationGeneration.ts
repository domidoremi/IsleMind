import { createProviderConversationGenerationPolicy } from '@/modules/providers'
import type { ReasoningEffort } from '@/core'
import type { AIProvider } from '@/types/providerContracts'
import { resolveProviderModelExecutionProfile } from './providerModelExecutionProfile'
import { resolveProviderRequestParameters } from '@/bootstrap/providerRequestPolicies'
import { getModelConfig } from '@/types/modelCatalog'

const providerConversationGenerationPolicy = createProviderConversationGenerationPolicy({
  getModelConfig,
  resolveProviderRequestParameters,
})

export const resolveConversationGenerationParameterRanges = providerConversationGenerationPolicy.resolveConversationGenerationParameterRanges
export const resolveConversationGenerationParameterDefault = providerConversationGenerationPolicy.resolveConversationGenerationParameterDefault
export const clampConversationGenerationParameter = providerConversationGenerationPolicy.clampConversationGenerationParameter
export const conversationGenerationParameterDiffersFromDefault = providerConversationGenerationPolicy.conversationGenerationParameterDiffersFromDefault
export const resolveConversationGenerationParameterRequest = providerConversationGenerationPolicy.resolveConversationGenerationParameterRequest
export const clampToParameterRange = providerConversationGenerationPolicy.clampToParameterRange

/** Defaults and controls must not request a capability that dispatch cannot admit. */
export function getConversationReasoningEffortOptions(provider: AIProvider | null | undefined, model: string): ReasoningEffort[] {
  if (!provider || !model) return []
  return resolveProviderModelExecutionProfile({ provider, model }).manifest.reasoning.selectableEfforts
}

export function resolveConversationReasoningEffort(
  provider: AIProvider | null | undefined,
  model: string,
  requested: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  const options = getConversationReasoningEffortOptions(provider, model)
  if (!options.length || requested === undefined) return undefined
  if (options.includes(requested)) return requested
  if (options.includes('medium')) return 'medium'
  return options.find((effort) => effort !== 'none' && effort !== 'minimal') ?? options[0]
}
