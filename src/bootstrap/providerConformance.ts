import { createProviderConformancePolicy } from '@/modules/providers'
import { filterSendableAttachments } from '@/modules/conversations'
import { hardenProviderRequestBody } from '@/bootstrap/providerRequestHardening'
import { getModelConfig } from '@/types/modelCatalog'
import * as reasoning from '@/utils/modelReasoning'

export type {
  ProviderBodyConformanceResult,
  ProviderCapabilityManifest,
  ProviderConformanceFamily,
  ProviderConformanceIssue,
  ProviderConformanceIssueCode,
  ProviderConformanceProtocol,
  ProviderConformanceRequest,
  ProviderConformanceResult,
  ProviderReasoningRequestShape,
  ProviderReasoningResolution,
  ProviderReasoningResolutionArtifact,
  ProviderToolRequestShape,
} from '@/modules/providers'

export { PROVIDER_REASONING_RESOLUTION_SCHEMA } from '@/modules/providers'

export const providerConformancePolicy = createProviderConformancePolicy({
  getModelConfig,
  filterSendableAttachments,
  hardenProviderRequestBody,
  getReasoningEffortOptions: reasoning.getReasoningEffortOptions,
  isCerebrasReasoningModel: reasoning.isCerebrasReasoningModel,
  isClaudeThinkingModel: reasoning.isClaudeThinkingModel,
  isCohereReasoningModel: reasoning.isCohereReasoningModel,
  isDashScopeThinkingModel: reasoning.isDashScopeThinkingModel,
  isDeepInfraReasoningModel: reasoning.isDeepInfraReasoningModel,
  isDeepSeekThinkingModel: reasoning.isDeepSeekThinkingModel,
  isFireworksReasoningModel: reasoning.isFireworksReasoningModel,
  isGeminiThinkingLevelModel: reasoning.isGeminiThinkingLevelModel,
  isGeminiThinkingModel: reasoning.isGeminiThinkingModel,
  isGroqReasoningModel: reasoning.isGroqReasoningModel,
  isHuggingFaceReasoningModel: reasoning.isHuggingFaceReasoningModel,
  isKimiThinkingModel: reasoning.isKimiThinkingModel,
  isMiniMaxThinkingModel: reasoning.isMiniMaxThinkingModel,
  isOpenAIReasoningModel: reasoning.isOpenAIReasoningModel,
  isPerplexityReasoningModel: reasoning.isPerplexityReasoningModel,
  isSambaNovaReasoningModel: reasoning.isSambaNovaReasoningModel,
  isSiliconFlowReasoningModel: reasoning.isSiliconFlowReasoningModel,
  isTogetherReasoningModel: reasoning.isTogetherReasoningModel,
  isXAIReasoningModel: reasoning.isXAIReasoningModel,
  isXAIMultiAgentReasoningModel: reasoning.isXAIMultiAgentReasoningModel,
  isXiaomiMimoReasoningModel: reasoning.isXiaomiMimoReasoningModel,
  normalizeFireworksReasoningEffort: reasoning.normalizeFireworksReasoningEffort,
})

export const {
  applyProviderConformanceToBody,
  resolveAndHardenProviderRequest,
  resolveProviderCapabilityManifest,
  resolveProviderRequestConformance,
} = providerConformancePolicy
