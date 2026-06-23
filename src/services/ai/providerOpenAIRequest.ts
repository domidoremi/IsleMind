import type { AIProvider, Attachment, ReasoningEffort, WebSearchMode } from '@/types'
import { getModelConfig } from '@/types'
import {
  isCerebrasReasoningModel,
  getReasoningEffortOptions,
  isFireworksReasoningModel,
  isHuggingFaceReasoningModel,
  isCohereReasoningModel,
  isDeepInfraReasoningModel,
  isDeepSeekThinkingModel,
  isGroqReasoningModel,
  isKimiThinkingModel,
  isPerplexityReasoningModel,
  isSambaNovaReasoningModel,
  isTogetherReasoningModel,
  isXiaomiMimoReasoningModel,
  isXAIReasoningModel,
  isXAIMultiAgentReasoningModel,
  normalizeFireworksReasoningEffort,
  providerSupportsReasoning,
} from '@/utils/modelReasoning'
import { isCerebrasProvider, isFireworksProvider, isGroqProvider, isMiniMaxProvider, isMoonshotProvider, isPerplexityProvider, isTogetherProvider, isXAIProvider } from '@/services/ai/providerIdentity'
import { providerCompatibilityCapabilityCanBeSentForProvider, providerCompatibilityReasoningExplicitlyDeclaredForModel } from '@/services/ai/providerCompatibilityContract'

export interface OpenAIRequestInput {
  provider: AIProvider
  model: string
  reasoningEffort?: ReasoningEffort
  webSearchMode?: WebSearchMode
  attachments?: Attachment[]
}

export interface OpenAIReasoningReplayMessage {
  toolCalls?: unknown[]
}

export type OpenAICompatibleReasoningReplayField = 'reasoning' | 'reasoning_content'

export function getOpenAIChatMaxTokensField(req: OpenAIRequestInput): 'max_completion_tokens' | 'max_tokens' {
  if (req.provider.type === 'openai') return 'max_completion_tokens'
  if (req.provider.type === 'xiaomi-mimo') return 'max_completion_tokens'
  if (isGroqProvider(req.provider)) return 'max_completion_tokens'
  if (isMiniMaxProvider(req.provider)) return 'max_completion_tokens'
  if (isMoonshotProvider(req.provider)) return 'max_completion_tokens'
  if (isXAIProvider(req.provider)) return 'max_completion_tokens'
  if (isCerebrasProvider(req.provider)) return 'max_completion_tokens'
  if (isTogetherProvider(req.provider)) return 'max_tokens'
  if (isFireworksProvider(req.provider)) return 'max_tokens'
  return 'max_tokens'
}

export function openAICompatibleAttachmentPart(attachment: Attachment, provider?: AIProvider): Record<string, unknown> {
  if (attachment.type === 'image') {
    return {
      type: 'image_url',
      image_url: { url: `data:${attachment.mimeType};base64,${attachment.base64}`, detail: 'auto' },
    }
  }
  if (provider && isPerplexityProvider(provider)) {
    return {
      type: 'file_url',
      file_url: { url: attachment.base64 },
    }
  }
  return {
    type: 'file',
    file: {
      filename: attachment.name,
      file_data: `data:${attachment.mimeType};base64,${attachment.base64}`,
    },
  }
}

export function openAIResponsesAttachmentPart(attachment: Attachment): Record<string, unknown> {
  if (attachment.type === 'image') {
    return {
      type: 'input_image',
      image_url: `data:${attachment.mimeType};base64,${attachment.base64}`,
    }
  }
  return {
    type: 'input_file',
    filename: attachment.name,
    file_data: `data:${attachment.mimeType};base64,${attachment.base64}`,
  }
}

export function normalizeOpenAIReasoningEffort(req: OpenAIRequestInput): ReasoningEffort | undefined {
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  if (
    !req.reasoningEffort ||
    !providerReasoningCanBeSent(req.provider, modelConfig) ||
    !providerSupportsReasoning(req.provider, req.model)
  ) return undefined
  if (modelConfig.reasoningMode === 'xai-reasoning-effort' || isXAIReasoningModel(req.provider, req.model)) {
    const supported = getReasoningEffortOptions(req.provider, req.model)
    if (supported.includes(req.reasoningEffort)) return req.reasoningEffort
    if (req.reasoningEffort === 'max' && supported.includes('xhigh')) return 'xhigh'
    if ((req.reasoningEffort === 'xhigh' || req.reasoningEffort === 'max') && supported.includes('high')) return 'high'
    if (req.reasoningEffort === 'minimal' && supported.includes('low')) return 'low'
    if (isXAIMultiAgentReasoningModel(req.model) && supported.includes('low')) return 'low'
    return supported.includes('medium') ? 'medium' : supported[0]
  }
  if (modelConfig.reasoningMode === 'groq-reasoning-effort' || isGroqReasoningModel(req.provider, req.model)) {
    const supported = getReasoningEffortOptions(req.provider, req.model)
    if (req.reasoningEffort === 'none' && !supported.includes('none')) return undefined
    if (supported.includes(req.reasoningEffort)) return req.reasoningEffort
    if (req.reasoningEffort === 'minimal' && supported.includes('low')) return 'low'
    if ((req.reasoningEffort === 'xhigh' || req.reasoningEffort === 'max') && supported.includes('high')) return 'high'
    return supported.includes('medium') ? 'medium' : supported[0]
  }
  if (modelConfig.reasoningMode === 'together-reasoning-effort' || isTogetherReasoningModel(req.provider, req.model)) {
    const supported = getReasoningEffortOptions(req.provider, req.model)
    if (req.reasoningEffort === 'none' && !supported.includes('none')) return undefined
    if (supported.includes(req.reasoningEffort)) return req.reasoningEffort
    if (req.reasoningEffort === 'minimal' && supported.includes('low')) return 'low'
    if ((req.reasoningEffort === 'xhigh' || req.reasoningEffort === 'max') && supported.includes('high')) return 'high'
    return supported.includes('medium') ? 'medium' : supported[0]
  }
  if (modelConfig.reasoningMode === 'fireworks-reasoning-effort' || isFireworksReasoningModel(req.provider, req.model)) {
    return normalizeFireworksReasoningEffort(req.model, req.reasoningEffort)
  }
  if (modelConfig.reasoningMode === 'perplexity-reasoning-effort' || isPerplexityReasoningModel(req.provider, req.model)) {
    const supported = getReasoningEffortOptions(req.provider, req.model)
    if (req.reasoningEffort === 'none') return undefined
    if (supported.includes(req.reasoningEffort)) return req.reasoningEffort
    if (req.reasoningEffort === 'minimal' && supported.includes('minimal')) return 'minimal'
    if ((req.reasoningEffort === 'xhigh' || req.reasoningEffort === 'max') && supported.includes('high')) return 'high'
    return supported.includes('medium') ? 'medium' : supported[0]
  }
  if (modelConfig.reasoningMode === 'cohere-reasoning-effort' || isCohereReasoningModel(req.provider, req.model)) {
    if (req.reasoningEffort === 'none') return 'none'
    return 'high'
  }
  if (modelConfig.reasoningMode === 'cerebras-reasoning-effort' || isCerebrasReasoningModel(req.provider, req.model)) {
    const supported = getReasoningEffortOptions(req.provider, req.model)
    if (!supported.length) return undefined
    if (req.reasoningEffort === 'none') return supported.includes('none') ? 'none' : undefined
    if (supported.includes(req.reasoningEffort)) return req.reasoningEffort
    if (supported.length === 1 && supported[0] === 'none') return undefined
    if (req.reasoningEffort === 'minimal' && supported.includes('low')) return 'low'
    if ((req.reasoningEffort === 'xhigh' || req.reasoningEffort === 'max') && supported.includes('high')) return 'high'
    return supported.includes('medium') ? 'medium' : supported[0]
  }
  if (modelConfig.reasoningMode === 'sambanova-reasoning-effort' || isSambaNovaReasoningModel(req.provider, req.model)) {
    const supported = getReasoningEffortOptions(req.provider, req.model)
    if (!supported.length) return undefined
    if (req.reasoningEffort === 'none') return undefined
    if (supported.includes(req.reasoningEffort)) return req.reasoningEffort
    if (req.reasoningEffort === 'minimal' && supported.includes('low')) return 'low'
    if ((req.reasoningEffort === 'xhigh' || req.reasoningEffort === 'max') && supported.includes('high')) return 'high'
    return supported.includes('medium') ? 'medium' : supported[0]
  }
  if (modelConfig.reasoningMode === 'huggingface-reasoning-effort' || isHuggingFaceReasoningModel(req.provider, req.model)) {
    const supported = getReasoningEffortOptions(req.provider, req.model)
    if (!supported.length) return undefined
    if (req.reasoningEffort === 'none') return undefined
    if (supported.includes(req.reasoningEffort)) return req.reasoningEffort
    if (req.reasoningEffort === 'minimal' && supported.includes('low')) return 'low'
    if ((req.reasoningEffort === 'xhigh' || req.reasoningEffort === 'max') && supported.includes('high')) return 'high'
    return supported.includes('medium') ? 'medium' : supported[0]
  }
  if (modelConfig.reasoningMode === 'deepinfra-reasoning-effort' || isDeepInfraReasoningModel(req.provider, req.model)) {
    const supported = getReasoningEffortOptions(req.provider, req.model)
    if (!supported.length) return undefined
    if (supported.includes(req.reasoningEffort)) return req.reasoningEffort
    if (req.reasoningEffort === 'minimal' && supported.includes('low')) return 'low'
    if ((req.reasoningEffort === 'xhigh' || req.reasoningEffort === 'max') && supported.includes('high')) return 'high'
    return supported.includes('medium') ? 'medium' : supported[0]
  }
  if (req.reasoningEffort === 'none') return undefined
  if (req.provider.type !== 'openai' && modelConfig.reasoningMode !== 'openai-effort') return undefined
  if (
    modelConfig.reasoningMode === 'openai-effort' &&
    isLMStudioProvider(req.provider) &&
    modelConfig.preferredEndpoint !== 'responses'
  ) {
    return undefined
  }
  const supported = getReasoningEffortOptions(req.provider, req.model)
  if (!supported.length) return undefined
  const effort = req.reasoningEffort
  if (supported.includes(effort)) return effort
  if (effort === 'minimal' && supported.includes('low')) return 'low'
  if (effort === 'max' && supported.includes('xhigh')) return 'xhigh'
  if (effort === 'max' && supported.includes('high')) return 'high'
  if (effort === 'xhigh' && supported.includes('high')) return 'high'
  return supported.includes('medium') ? 'medium' : supported[0]
}

function providerReasoningExplicitlyDeclared(
  provider: AIProvider,
  modelConfig: ReturnType<typeof getModelConfig>
): boolean {
  return providerCompatibilityReasoningExplicitlyDeclaredForModel(provider, modelConfig)
}

function providerReasoningCanBeSent(
  provider: AIProvider,
  modelConfig: ReturnType<typeof getModelConfig>
): boolean {
  return providerCompatibilityCapabilityCanBeSentForProvider(provider, 'reasoning', providerReasoningExplicitlyDeclared(provider, modelConfig))
}

function providerResponsesApiCanBeSent(provider: AIProvider): boolean {
  return providerCompatibilityCapabilityCanBeSentForProvider(provider, 'responsesApi', provider.capabilities?.responsesApi === true)
}

function isLMStudioProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'lm-studio' || provider.detectedPresetId === 'lm-studio') return true
  return [provider.id, provider.name, provider.baseUrl, provider.models?.join(' ')].filter(Boolean).join(' ').match(/lm[-_ ]?studio|lmstudio|localhost:1234|127\.0\.0\.1:1234/i) !== null
}

function isVLLMProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'vllm' || provider.detectedPresetId === 'vllm') return true
  return [provider.id, provider.name, provider.baseUrl, provider.models?.join(' ')].filter(Boolean).join(' ').match(/vllm|localhost:8000|127\.0\.0\.1:8000/i) !== null
}

export function buildOpenAIResponsesReasoning(effort: ReasoningEffort | undefined, provider: AIProvider): Record<string, unknown> | undefined {
  if (!effort) return undefined
  return {
    effort,
    ...(provider.type === 'openai' && effort !== 'none' ? { summary: 'auto' } : {}),
  }
}

export function openAIResponsesNativeWebSearchTool(provider: AIProvider): Record<string, unknown> | undefined {
  if (!providerCompatibilityCapabilityCanBeSentForProvider(provider, 'nativeSearch', provider.capabilities?.nativeSearch === true)) return undefined
  if (provider.type === 'openai') return { type: 'web_search_preview' }
  if (isXAIProvider(provider)) return { type: 'web_search' }
  if (isPerplexityProvider(provider)) return undefined
  if (provider.capabilities?.nativeSearch === true) return { type: 'web_search_preview' }
  return undefined
}

export function supportsXiaomiMimoNativeWebSearch(modelId: string): boolean {
  const normalized = modelId.toLowerCase().split('/').at(-1) ?? modelId.toLowerCase()
  return /^mimo-v(?:2\.5(?:-pro)?|2-(?:pro|omni|flash))$/.test(normalized)
}

export function xiaomiMimoNativeWebSearchTool(modelId: string): Record<string, unknown> | undefined {
  if (!supportsXiaomiMimoNativeWebSearch(modelId)) return undefined
  return {
    type: 'web_search',
    max_keyword: 3,
    force_search: true,
    limit: 1,
  }
}

export function shouldIncludeOpenAIResponsesEncryptedReasoning(req: OpenAIRequestInput, effort?: ReasoningEffort): boolean {
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  if (!providerReasoningCanBeSent(req.provider, modelConfig)) return false
  if (effort && effort !== 'none') return true
  if (effort === 'none') return false
  return req.provider.type === 'openai-compatible' && isXAIProvider(req.provider) && isXAIReasoningModel(req.provider, req.model)
}

export function usesOpenAIResponses(req: OpenAIRequestInput): boolean {
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  if (req.provider.type === 'openai') {
    return modelConfig.preferredEndpoint === 'responses' || req.webSearchMode === 'native' || !!req.attachments?.some((attachment) => attachment.type !== 'image')
  }
  if (req.provider.type === 'openai-compatible' && req.provider.wireProtocol !== 'anthropic-compatible') {
    if (req.provider.capabilities?.responsesApi === true && providerResponsesApiCanBeSent(req.provider)) {
      return modelConfig.preferredEndpoint === 'responses'
        || (req.webSearchMode === 'native' && providerCompatibilityCapabilityCanBeSentForProvider(req.provider, 'nativeSearch', req.provider.capabilities?.nativeSearch === true))
        || (providerCompatibilityCapabilityCanBeSentForProvider(req.provider, 'files', req.provider.capabilities?.files === true) && !!req.attachments?.some((attachment) => attachment.type !== 'image'))
    }
    if (isXAIProvider(req.provider) && providerResponsesApiCanBeSent(req.provider)) {
      return modelConfig.preferredEndpoint === 'responses'
    }
  }
  return false
}

export function shouldReplayOpenAICompatibleReasoningContent(req: OpenAIRequestInput, msg: OpenAIReasoningReplayMessage): boolean {
  return Boolean(openAICompatibleReasoningReplayField(req, msg))
}

export function openAICompatibleReasoningReplayField(
  req: OpenAIRequestInput,
  msg: OpenAIReasoningReplayMessage
): OpenAICompatibleReasoningReplayField | undefined {
  if (req.provider.type !== 'openai-compatible' && req.provider.type !== 'xiaomi-mimo') return undefined
  if (req.provider.wireProtocol === 'anthropic-compatible') return undefined
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  if (!providerReasoningCanBeSent(req.provider, modelConfig)) return undefined
  if (isXiaomiMimoReasoningModel(req.provider, req.model)) return msg.toolCalls?.length ? 'reasoning_content' : undefined
  if (isCerebrasReasoningModel(req.provider, req.model)) return 'reasoning'
  if (isSambaNovaReasoningModel(req.provider, req.model)) return 'reasoning'
  if (isDeepSeekThinkingModel(req.provider, req.model)) return msg.toolCalls?.length ? 'reasoning_content' : undefined
  if (isFireworksReasoningModel(req.provider, req.model)) return msg.toolCalls?.length ? 'reasoning_content' : undefined
  if (isKimiThinkingModel(req.provider, req.model) || isXAIReasoningModel(req.provider, req.model)) return 'reasoning_content'
  return undefined
}
