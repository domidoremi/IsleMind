import type { AIProvider, Attachment, ReasoningEffort, WebSearchMode } from '@/types'
import { getModelConfig } from '@/types'
import {
  getReasoningEffortOptions,
  isDeepSeekThinkingModel,
  isKimiThinkingModel,
  isXAIReasoningModel,
  isXAIMultiAgentReasoningModel,
  providerSupportsReasoning,
} from '@/utils/modelReasoning'
import { isMiniMaxProvider, isMoonshotProvider, isXAIProvider } from '@/services/ai/providerIdentity'

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

export function getOpenAIChatMaxTokensField(req: OpenAIRequestInput): 'max_completion_tokens' | 'max_tokens' {
  if (req.provider.type === 'openai') return 'max_completion_tokens'
  if (req.provider.type === 'xiaomi-mimo') return 'max_completion_tokens'
  if (isMiniMaxProvider(req.provider)) return 'max_completion_tokens'
  if (isMoonshotProvider(req.provider)) return 'max_completion_tokens'
  if (isXAIProvider(req.provider)) return 'max_completion_tokens'
  return 'max_tokens'
}

export function openAICompatibleAttachmentPart(attachment: Attachment): Record<string, unknown> {
  if (attachment.type === 'image') {
    return {
      type: 'image_url',
      image_url: { url: `data:${attachment.mimeType};base64,${attachment.base64}`, detail: 'auto' },
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
  if (!req.reasoningEffort || !providerSupportsReasoning(req.provider, req.model)) return undefined
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  if (modelConfig.reasoningMode === 'xai-reasoning-effort' || isXAIReasoningModel(req.provider, req.model)) {
    const supported = getReasoningEffortOptions(req.provider, req.model)
    if (supported.includes(req.reasoningEffort)) return req.reasoningEffort
    if (req.reasoningEffort === 'max' && supported.includes('xhigh')) return 'xhigh'
    if ((req.reasoningEffort === 'xhigh' || req.reasoningEffort === 'max') && supported.includes('high')) return 'high'
    if (req.reasoningEffort === 'minimal' && supported.includes('low')) return 'low'
    if (isXAIMultiAgentReasoningModel(req.model) && supported.includes('low')) return 'low'
    return supported.includes('medium') ? 'medium' : supported[0]
  }
  if (req.reasoningEffort === 'none') return undefined
  if (req.provider.type !== 'openai' && modelConfig.reasoningMode !== 'openai-effort') return undefined
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

export function buildOpenAIResponsesReasoning(effort: ReasoningEffort | undefined, provider: AIProvider): Record<string, unknown> | undefined {
  if (!effort) return undefined
  return {
    effort,
    ...(provider.type === 'openai' && effort !== 'none' ? { summary: 'auto' } : {}),
  }
}

export function openAIResponsesNativeWebSearchTool(provider: AIProvider): Record<string, unknown> {
  return { type: isXAIProvider(provider) ? 'web_search' : 'web_search_preview' }
}

export function shouldIncludeOpenAIResponsesEncryptedReasoning(req: OpenAIRequestInput, effort?: ReasoningEffort): boolean {
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
    if (req.provider.capabilities?.responsesApi === true) {
      return modelConfig.preferredEndpoint === 'responses'
        || req.webSearchMode === 'native'
        || !!req.attachments?.some((attachment) => attachment.type !== 'image')
    }
    if (isXAIProvider(req.provider)) {
      return modelConfig.preferredEndpoint === 'responses'
    }
  }
  return false
}

export function shouldReplayOpenAICompatibleReasoningContent(req: OpenAIRequestInput, msg: OpenAIReasoningReplayMessage): boolean {
  if (req.provider.type !== 'openai-compatible' && req.provider.type !== 'xiaomi-mimo') return false
  if (req.provider.wireProtocol === 'anthropic-compatible') return false
  if (isDeepSeekThinkingModel(req.provider, req.model)) return Boolean(msg.toolCalls?.length)
  return isKimiThinkingModel(req.provider, req.model) || isXAIReasoningModel(req.provider, req.model)
}
