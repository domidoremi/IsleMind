import * as identity from '@/modules/providers'
import {
  createAnthropicThinkingPolicy,
  createGoogleThinkingPolicy,
  createOpenAICompatibleThinkingPolicy,
  createOpenAIRequestPolicy,
  createProviderRequestOptimizationPolicy,
  createProviderRequestParameterPolicy,
  injectBedrockCache,
  isAnthropicWireProvider,
  isMiniMaxProvider,
  isModelScopeProvider,
  isSiliconFlowProvider,
  resolveOpenAIResponsesWebSearchToolPolicy,
  type ProviderRequestOptimizationProvider,
} from '@/modules/providers'
import { providerModelCapabilityCanBeSent } from '@/bootstrap/providerCapabilityMatrix'
import { providerCompatibilityCapabilityCanBeSentForProvider, providerCompatibilityReasoningExplicitlyDeclaredForModel } from '@/modules/providers'
import {
  PROVIDER_PLATFORM_ANTHROPIC_MAX_TEMPERATURE,
  PROVIDER_PLATFORM_DEFAULT_TEMPERATURE,
  PROVIDER_PLATFORM_DEFAULT_TOP_P,
  PROVIDER_PLATFORM_MAX_TEMPERATURE,
  PROVIDER_PLATFORM_MAX_TOP_K,
  PROVIDER_PLATFORM_MAX_TOP_P,
  PROVIDER_PLATFORM_MIN_OUTPUT_TOKENS,
  PROVIDER_PLATFORM_MIN_TEMPERATURE,
  PROVIDER_PLATFORM_MIN_TOP_K,
  PROVIDER_PLATFORM_MIN_TOP_P,
  PROVIDER_PLATFORM_XIAOMI_MIMO_MAX_TEMPERATURE,
} from '@/modules/providers'
import { isAwsBedrockProvider, isBedrockRuntimeProvider } from '@/modules/providers'
import { resolveProviderCapabilityManifest } from '@/bootstrap/providerConformance'
import { getModelConfig } from '@/types/modelCatalog'
import type { AIProvider } from '@/types/providerContracts'
import * as reasoning from '@/utils/modelReasoning'

export const providerRequestParameterPolicy = createProviderRequestParameterPolicy({
  limits: {
    defaultTemperature: PROVIDER_PLATFORM_DEFAULT_TEMPERATURE, minTemperature: PROVIDER_PLATFORM_MIN_TEMPERATURE,
    maxTemperature: PROVIDER_PLATFORM_MAX_TEMPERATURE, anthropicMaxTemperature: PROVIDER_PLATFORM_ANTHROPIC_MAX_TEMPERATURE,
    xiaomiMimoMaxTemperature: PROVIDER_PLATFORM_XIAOMI_MIMO_MAX_TEMPERATURE, defaultTopP: PROVIDER_PLATFORM_DEFAULT_TOP_P,
    minTopP: PROVIDER_PLATFORM_MIN_TOP_P, maxTopP: PROVIDER_PLATFORM_MAX_TOP_P, minTopK: PROVIDER_PLATFORM_MIN_TOP_K,
    maxTopK: PROVIDER_PLATFORM_MAX_TOP_K, minOutputTokens: PROVIDER_PLATFORM_MIN_OUTPUT_TOKENS,
  },
  resolveModelConfig: (model, provider) => getModelConfig(model, provider.type, provider.modelConfigs),
  modelSupportsSamplingControls: reasoning.modelSupportsSamplingControls,
  isXiaomiMimoReasoningModel: reasoning.isXiaomiMimoReasoningModel,
  isMiniMaxProvider,
  providerCompatibilityReasoningExplicitlyDeclaredForModel,
  providerCompatibilityCapabilityCanBeSentForProvider,
})
export const { clampMaxTokens, isXiaomiMimoThinkingActive, normalizeTemperature, normalizeXiaomiMimoThinking, resolveProviderRequestParameters, supportsSamplingControls } = providerRequestParameterPolicy

export const openAIRequestPolicy = createOpenAIRequestPolicy({
  resolveModelConfig: (model, provider) => getModelConfig(model, provider.type, provider.modelConfigs),
  getReasoningEffortOptions: reasoning.getReasoningEffortOptions,
  providerSupportsReasoning: reasoning.providerSupportsReasoning,
  normalizeFireworksReasoningEffort: reasoning.normalizeFireworksReasoningEffort,
  providerCompatibilityReasoningExplicitlyDeclaredForModel,
  providerCompatibilityCapabilityCanBeSentForProvider,
  providerModelCapabilityCanBeSent,
  resolveOpenAIResponsesWebSearchToolPolicy,
  isProvider: (kind, provider) => ({ cerebras: identity.isCerebrasProvider, fireworks: identity.isFireworksProvider, groq: identity.isGroqProvider, minimax: identity.isMiniMaxProvider, moonshot: identity.isMoonshotProvider, perplexity: identity.isPerplexityProvider, together: identity.isTogetherProvider, xai: identity.isXAIProvider })[kind](provider),
  isReasoningModel: (kind, provider, model) => ({ cerebras: reasoning.isCerebrasReasoningModel, fireworks: reasoning.isFireworksReasoningModel, huggingface: reasoning.isHuggingFaceReasoningModel, cohere: reasoning.isCohereReasoningModel, deepinfra: reasoning.isDeepInfraReasoningModel, deepseek: reasoning.isDeepSeekThinkingModel, groq: reasoning.isGroqReasoningModel, kimi: reasoning.isKimiThinkingModel, perplexity: reasoning.isPerplexityReasoningModel, sambanova: reasoning.isSambaNovaReasoningModel, together: reasoning.isTogetherReasoningModel, 'xiaomi-mimo': reasoning.isXiaomiMimoReasoningModel, xai: reasoning.isXAIReasoningModel, 'xai-multi-agent': (_provider: AIProvider, candidate: string) => reasoning.isXAIMultiAgentReasoningModel(candidate) })[kind](provider, model),
  isLMStudioProvider: (provider) => provider.presetId === 'lm-studio' || provider.detectedPresetId === 'lm-studio' || /lm[-_ ]?studio|lmstudio|localhost:1234|127\.0\.0\.1:1234/i.test([provider.id, provider.name, provider.baseUrl].filter(Boolean).join(' ')),
})
export const { buildOpenAIResponsesReasoning, normalizeOpenAIReasoningEffort, openAICompatibleReasoningReplayField, openAIResponsesNativeWebSearchTool, shouldIncludeOpenAIResponsesEncryptedReasoning, shouldReplayOpenAICompatibleReasoningContent, usesOpenAIResponses } = openAIRequestPolicy

export const googleThinkingPolicy = createGoogleThinkingPolicy({ resolveModelConfig: (model, provider) => getModelConfig(model, 'google', provider.modelConfigs), isGeminiThinkingLevelModel: reasoning.isGeminiThinkingLevelModel, isGeminiThinkingModel: reasoning.isGeminiThinkingModel })
export const { normalizeGoogleThinkingConfig } = googleThinkingPolicy

export const anthropicThinkingPolicy = createAnthropicThinkingPolicy({ resolveModelConfig: (model, provider) => getModelConfig(model, provider.type, provider.modelConfigs), isClaudeThinkingModel: reasoning.isClaudeThinkingModel, clampMaxTokens, reasoningExplicitlyDeclaredForModel: providerCompatibilityReasoningExplicitlyDeclaredForModel, reasoningCanBeSentForProvider: providerCompatibilityCapabilityCanBeSentForProvider })
export const { normalizeAnthropicThinking } = anthropicThinkingPolicy

export const openAICompatibleThinkingPolicy = createOpenAICompatibleThinkingPolicy({ resolveModelConfig: (model, provider) => getModelConfig(model, provider.type, provider.modelConfigs), isDashScopeThinkingModel: reasoning.isDashScopeThinkingModel, isDeepSeekThinkingModel: reasoning.isDeepSeekThinkingModel, isKimiThinkingModel: reasoning.isKimiThinkingModel, isMiniMaxThinkingModel: reasoning.isMiniMaxThinkingModel, isSiliconFlowReasoningModel: reasoning.isSiliconFlowReasoningModel, isModelScopeProvider, isSiliconFlowProvider, reasoningExplicitlyDeclaredForModel: providerCompatibilityReasoningExplicitlyDeclaredForModel, reasoningCanBeSentForProvider: providerCompatibilityCapabilityCanBeSentForProvider })
export const { isKimiSamplingLocked, normalizeDashScopeThinking, normalizeDeepSeekThinking, normalizeKimiPreservedThinking, normalizeKimiThinking, normalizeMiniMaxThinking, normalizeSiliconFlowThinking, shouldRequestMiniMaxReasoningSplit } = openAICompatibleThinkingPolicy
export { normalizeDashScopeThinkingBudget, normalizeSiliconFlowThinkingBudget } from '@/modules/providers'

export const providerRequestOptimizationPolicy = createProviderRequestOptimizationPolicy({
  isAwsBedrockProvider, isBedrockRuntimeProvider,
  providerReasoningCanBeSent({ provider, model, reasoningEffort }) {
    const configuredProvider: AIProvider = { apiKey: '', models: [model], enabled: true, ...provider }
    return resolveProviderCapabilityManifest({ provider: configuredProvider, model, reasoningEffort }).reasoning.supported
  },
})
export const { isBedrockProvider, optimizeBedrockThinking, optimizeRequestBody } = providerRequestOptimizationPolicy
export { injectBedrockCache, isAnthropicWireProvider }
export type { ProviderRequestOptimizationProvider }
