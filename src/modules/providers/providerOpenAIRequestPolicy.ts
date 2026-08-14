import type { ReasoningEffort } from '@/core'
import type { Attachment } from '@/types/chatContracts'
import type { AIModel, AIProvider } from '@/types/providerContracts'
import type { WebSearchMode } from '@/types/settingsContracts'

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
export type OpenAIProviderModelCapability = 'reasoning' | 'responsesApi' | 'nativeSearch' | 'files'
export type OpenAIProviderIdentity =
  | 'cerebras'
  | 'fireworks'
  | 'groq'
  | 'minimax'
  | 'moonshot'
  | 'perplexity'
  | 'together'
  | 'xai'

export type OpenAIReasoningModelKind =
  | 'cerebras'
  | 'fireworks'
  | 'huggingface'
  | 'cohere'
  | 'deepinfra'
  | 'deepseek'
  | 'groq'
  | 'kimi'
  | 'perplexity'
  | 'sambanova'
  | 'together'
  | 'xiaomi-mimo'
  | 'xai'
  | 'xai-multi-agent'

export interface OpenAIRequestPolicyDependencies {
  resolveModelConfig(model: string, provider: AIProvider): AIModel
  getReasoningEffortOptions(provider: AIProvider, model: string): readonly ReasoningEffort[]
  providerSupportsReasoning(provider: AIProvider, model: string): boolean
  isProvider(kind: OpenAIProviderIdentity, provider: AIProvider): boolean
  isReasoningModel(kind: OpenAIReasoningModelKind, provider: AIProvider, model: string): boolean
  normalizeFireworksReasoningEffort(model: string, effort: ReasoningEffort): ReasoningEffort | undefined
  providerCompatibilityReasoningExplicitlyDeclaredForModel(provider: AIProvider, modelConfig: AIModel): boolean
  providerCompatibilityCapabilityCanBeSentForProvider(
    provider: AIProvider,
    capability: OpenAIProviderModelCapability,
    explicitDeclaration?: boolean,
  ): boolean
  providerModelCapabilityCanBeSent(
    provider: AIProvider,
    model: string,
    capability: OpenAIProviderModelCapability,
  ): boolean
  resolveOpenAIResponsesWebSearchToolPolicy(provider: AIProvider, model: string): { allowed: boolean }
  isLMStudioProvider(provider: AIProvider): boolean
}

export interface OpenAIRequestPolicy {
  normalizeOpenAIReasoningEffort(request: OpenAIRequestInput): ReasoningEffort | undefined
  buildOpenAIResponsesReasoning(effort: ReasoningEffort | undefined, provider: AIProvider): Record<string, unknown> | undefined
  openAIResponsesNativeWebSearchTool(provider: AIProvider, model?: string): Record<string, unknown> | undefined
  shouldIncludeOpenAIResponsesEncryptedReasoning(request: OpenAIRequestInput, effort?: ReasoningEffort): boolean
  usesOpenAIResponses(request: OpenAIRequestInput): boolean
  shouldReplayOpenAICompatibleReasoningContent(request: OpenAIRequestInput, message: OpenAIReasoningReplayMessage): boolean
  openAICompatibleReasoningReplayField(
    request: OpenAIRequestInput,
    message: OpenAIReasoningReplayMessage,
  ): OpenAICompatibleReasoningReplayField | undefined
}

export function getOpenAIChatMaxTokensField(req: OpenAIRequestInput): 'max_completion_tokens' | 'max_tokens' {
  if (req.provider.type === 'openai') return 'max_completion_tokens'
  if (req.provider.type === 'xiaomi-mimo') return 'max_completion_tokens'
  if (providerMatches(req.provider, 'groq', /groq|api\.groq\.com/i)) return 'max_completion_tokens'
  if (providerMatches(req.provider, 'minimax', /minimax|mini[-_ ]?max|minimaxi|海螺/i)) return 'max_completion_tokens'
  if (providerMatches(req.provider, 'moonshot', /moonshot|kimi/i)) return 'max_completion_tokens'
  if (providerMatches(req.provider, 'xai', /(^|[-_./])xai($|[-_./])|grok|api\.x\.ai/i)) return 'max_completion_tokens'
  if (providerMatches(req.provider, 'cerebras', /cerebras|api\.cerebras\.ai/i)) return 'max_completion_tokens'
  if (providerMatches(req.provider, 'together', /together|api\.together\.(ai|xyz)/i)) return 'max_tokens'
  if (providerMatches(req.provider, 'fireworks', /fireworks|api\.fireworks\.ai/i)) return 'max_tokens'
  return 'max_tokens'
}

export function createOpenAIRequestPolicy(dependencies: OpenAIRequestPolicyDependencies): OpenAIRequestPolicy {
  const isProvider = (kind: OpenAIProviderIdentity, provider: AIProvider): boolean => dependencies.isProvider(kind, provider)
  const isReasoningModel = (kind: OpenAIReasoningModelKind, provider: AIProvider, model: string): boolean => dependencies.isReasoningModel(kind, provider, model)

  const openAICompatibleModelCapabilityCanBeSent = (
    provider: AIProvider,
    model: string,
    capability: OpenAIProviderModelCapability,
  ): boolean => {
    if (provider.type !== 'openai-compatible') return true
    if (provider.wireProtocol === 'anthropic-compatible') return true
    return dependencies.providerModelCapabilityCanBeSent(provider, model, capability) === true
  }

  const providerReasoningCanBeSent = (provider: AIProvider, modelConfig: AIModel): boolean => (
    dependencies.providerCompatibilityCapabilityCanBeSentForProvider(
      provider,
      'reasoning',
      dependencies.providerCompatibilityReasoningExplicitlyDeclaredForModel(provider, modelConfig),
    ) === true &&
    openAICompatibleModelCapabilityCanBeSent(provider, modelConfig.id, 'reasoning')
  )

  const providerResponsesApiCanBeSent = (provider: AIProvider, model: string): boolean => (
    dependencies.providerCompatibilityCapabilityCanBeSentForProvider(provider, 'responsesApi', provider.capabilities?.responsesApi === true) === true &&
    openAICompatibleModelCapabilityCanBeSent(provider, model, 'responsesApi')
  )

  function normalizeOpenAIReasoningEffort(req: OpenAIRequestInput): ReasoningEffort | undefined {
    const modelConfig = dependencies.resolveModelConfig(req.model, req.provider)
    if (
      !req.reasoningEffort ||
      !providerReasoningCanBeSent(req.provider, modelConfig) ||
      !dependencies.providerSupportsReasoning(req.provider, req.model)
    ) return undefined

    const supported = () => dependencies.getReasoningEffortOptions(req.provider, req.model)
    const effort = req.reasoningEffort
    if (modelConfig.reasoningMode === 'xai-reasoning-effort' || isReasoningModel('xai', req.provider, req.model)) {
      const options = supported()
      if (options.includes(effort)) return effort
      if (effort === 'max' && options.includes('xhigh')) return 'xhigh'
      if ((effort === 'xhigh' || effort === 'max') && options.includes('high')) return 'high'
      if (effort === 'minimal' && options.includes('low')) return 'low'
      if (isReasoningModel('xai-multi-agent', req.provider, req.model) && options.includes('low')) return 'low'
      return options.includes('medium') ? 'medium' : options[0]
    }
    if (modelConfig.reasoningMode === 'groq-reasoning-effort' || isReasoningModel('groq', req.provider, req.model)) {
      const options = supported()
      if (effort === 'none' && !options.includes('none')) return undefined
      if (options.includes(effort)) return effort
      if (effort === 'minimal' && options.includes('low')) return 'low'
      if ((effort === 'xhigh' || effort === 'max') && options.includes('high')) return 'high'
      return options.includes('medium') ? 'medium' : options[0]
    }
    if (modelConfig.reasoningMode === 'together-reasoning-effort' || isReasoningModel('together', req.provider, req.model)) {
      const options = supported()
      if (effort === 'none' && !options.includes('none')) return undefined
      if (options.includes(effort)) return effort
      if (effort === 'minimal' && options.includes('low')) return 'low'
      if ((effort === 'xhigh' || effort === 'max') && options.includes('high')) return 'high'
      return options.includes('medium') ? 'medium' : options[0]
    }
    if (modelConfig.reasoningMode === 'fireworks-reasoning-effort' || isReasoningModel('fireworks', req.provider, req.model)) {
      return dependencies.normalizeFireworksReasoningEffort(req.model, effort)
    }
    if (modelConfig.reasoningMode === 'perplexity-reasoning-effort' || isReasoningModel('perplexity', req.provider, req.model)) {
      const options = supported()
      if (effort === 'none') return undefined
      if (options.includes(effort)) return effort
      if (effort === 'minimal' && options.includes('minimal')) return 'minimal'
      if ((effort === 'xhigh' || effort === 'max') && options.includes('high')) return 'high'
      return options.includes('medium') ? 'medium' : options[0]
    }
    if (modelConfig.reasoningMode === 'cohere-reasoning-effort' || isReasoningModel('cohere', req.provider, req.model)) {
      return effort === 'none' ? 'none' : 'high'
    }
    if (modelConfig.reasoningMode === 'cerebras-reasoning-effort' || isReasoningModel('cerebras', req.provider, req.model)) {
      const options = supported()
      if (!options.length) return undefined
      if (effort === 'none') return options.includes('none') ? 'none' : undefined
      if (options.includes(effort)) return effort
      if (options.length === 1 && options[0] === 'none') return undefined
      if (effort === 'minimal' && options.includes('low')) return 'low'
      if ((effort === 'xhigh' || effort === 'max') && options.includes('high')) return 'high'
      return options.includes('medium') ? 'medium' : options[0]
    }
    if (modelConfig.reasoningMode === 'sambanova-reasoning-effort' || isReasoningModel('sambanova', req.provider, req.model)) {
      const options = supported()
      if (!options.length || effort === 'none') return undefined
      if (options.includes(effort)) return effort
      if (effort === 'minimal' && options.includes('low')) return 'low'
      if ((effort === 'xhigh' || effort === 'max') && options.includes('high')) return 'high'
      return options.includes('medium') ? 'medium' : options[0]
    }
    if (modelConfig.reasoningMode === 'huggingface-reasoning-effort' || isReasoningModel('huggingface', req.provider, req.model)) {
      const options = supported()
      if (!options.length || effort === 'none') return undefined
      if (options.includes(effort)) return effort
      if (effort === 'minimal' && options.includes('low')) return 'low'
      if ((effort === 'xhigh' || effort === 'max') && options.includes('high')) return 'high'
      return options.includes('medium') ? 'medium' : options[0]
    }
    if (modelConfig.reasoningMode === 'deepinfra-reasoning-effort' || isReasoningModel('deepinfra', req.provider, req.model)) {
      const options = supported()
      if (!options.length) return undefined
      if (options.includes(effort)) return effort
      if (effort === 'minimal' && options.includes('low')) return 'low'
      if ((effort === 'xhigh' || effort === 'max') && options.includes('high')) return 'high'
      return options.includes('medium') ? 'medium' : options[0]
    }
    if (effort === 'none') return undefined
    if (req.provider.type !== 'openai' && modelConfig.reasoningMode !== 'openai-effort') return undefined
    if (modelConfig.reasoningMode === 'openai-effort' && dependencies.isLMStudioProvider(req.provider) && modelConfig.preferredEndpoint !== 'responses') return undefined
    const options = supported()
    if (!options.length) return undefined
    if (options.includes(effort)) return effort
    if (effort === 'minimal' && options.includes('low')) return 'low'
    if (effort === 'max' && options.includes('xhigh')) return 'xhigh'
    if (effort === 'max' && options.includes('high')) return 'high'
    if (effort === 'xhigh' && options.includes('high')) return 'high'
    return options.includes('medium') ? 'medium' : options[0]
  }

  function openAIResponsesNativeWebSearchTool(provider: AIProvider, model?: string): Record<string, unknown> | undefined {
    const modelId = model ?? ''
    if (!dependencies.resolveOpenAIResponsesWebSearchToolPolicy(provider, modelId).allowed) return undefined
    const modelDeclaresNativeSearch = model ? openAICompatibleModelCapabilityCanBeSent(provider, model, 'nativeSearch') : false
    const explicitDeclaration = provider.type === 'openai' || provider.capabilities?.nativeSearch === true || modelDeclaresNativeSearch
    if (!dependencies.providerCompatibilityCapabilityCanBeSentForProvider(provider, 'nativeSearch', explicitDeclaration)) return undefined
    if (provider.type === 'openai') return { type: 'web_search' }
    if (isProvider('xai', provider)) return { type: 'web_search' }
    if (isProvider('perplexity', provider)) return undefined
    if (provider.capabilities?.nativeSearch === true || modelDeclaresNativeSearch) return { type: 'web_search_preview' }
    return undefined
  }

  function usesOpenAIResponses(req: OpenAIRequestInput): boolean {
    const modelConfig = dependencies.resolveModelConfig(req.model, req.provider)
    if (req.provider.type === 'openai') {
      return modelConfig.preferredEndpoint === 'responses' || req.webSearchMode === 'native' || Boolean(req.attachments?.some((attachment) => attachment.type !== 'image'))
    }
    if (req.provider.type === 'openai-compatible' && req.provider.wireProtocol !== 'anthropic-compatible') {
      if (req.provider.capabilities?.responsesApi === true && providerResponsesApiCanBeSent(req.provider, req.model)) {
        return modelConfig.preferredEndpoint === 'responses' ||
          (
            req.webSearchMode === 'native' &&
            dependencies.providerCompatibilityCapabilityCanBeSentForProvider(req.provider, 'nativeSearch', openAICompatibleModelCapabilityCanBeSent(req.provider, req.model, 'nativeSearch')) &&
            openAICompatibleModelCapabilityCanBeSent(req.provider, req.model, 'nativeSearch')
          ) ||
          (dependencies.providerCompatibilityCapabilityCanBeSentForProvider(req.provider, 'files', req.provider.capabilities?.files === true) && Boolean(req.attachments?.some((attachment) => attachment.type !== 'image')))
      }
      if (isProvider('xai', req.provider) && providerResponsesApiCanBeSent(req.provider, req.model)) return modelConfig.preferredEndpoint === 'responses'
    }
    return false
  }

  function buildOpenAIResponsesReasoning(effort: ReasoningEffort | undefined, provider: AIProvider): Record<string, unknown> | undefined {
    if (!effort) return undefined
    return { effort, ...(provider.type === 'openai' && effort !== 'none' ? { summary: 'auto' } : {}) }
  }

  function shouldIncludeOpenAIResponsesEncryptedReasoning(req: OpenAIRequestInput, effort?: ReasoningEffort): boolean {
    const modelConfig = dependencies.resolveModelConfig(req.model, req.provider)
    if (!providerReasoningCanBeSent(req.provider, modelConfig)) return false
    if (effort && effort !== 'none') return true
    if (effort === 'none') return false
    return req.provider.type === 'openai-compatible' && isProvider('xai', req.provider) && isReasoningModel('xai', req.provider, req.model)
  }

  function openAICompatibleReasoningReplayField(
    req: OpenAIRequestInput,
    msg: OpenAIReasoningReplayMessage,
  ): OpenAICompatibleReasoningReplayField | undefined {
    if (req.provider.type !== 'openai-compatible' && req.provider.type !== 'xiaomi-mimo') return undefined
    if (req.provider.wireProtocol === 'anthropic-compatible') return undefined
    const modelConfig = dependencies.resolveModelConfig(req.model, req.provider)
    if (!providerReasoningCanBeSent(req.provider, modelConfig)) return undefined
    if (isReasoningModel('xiaomi-mimo', req.provider, req.model)) return msg.toolCalls?.length ? 'reasoning_content' : undefined
    if (isReasoningModel('cerebras', req.provider, req.model)) return 'reasoning'
    if (isReasoningModel('sambanova', req.provider, req.model)) return 'reasoning'
    if (isReasoningModel('deepseek', req.provider, req.model)) return msg.toolCalls?.length ? 'reasoning_content' : undefined
    if (isReasoningModel('fireworks', req.provider, req.model)) return msg.toolCalls?.length ? 'reasoning_content' : undefined
    if (isReasoningModel('kimi', req.provider, req.model) || isReasoningModel('xai', req.provider, req.model)) return 'reasoning_content'
    return undefined
  }

  return {
    normalizeOpenAIReasoningEffort,
    buildOpenAIResponsesReasoning,
    openAIResponsesNativeWebSearchTool,
    shouldIncludeOpenAIResponsesEncryptedReasoning,
    usesOpenAIResponses,
    shouldReplayOpenAICompatibleReasoningContent(request, message) {
      return Boolean(openAICompatibleReasoningReplayField(request, message))
    },
    openAICompatibleReasoningReplayField,
  }
}

function providerMatches(provider: AIProvider, preset: string, pattern: RegExp): boolean {
  if (provider.presetId === preset || provider.detectedPresetId === preset) return true
  return pattern.test([provider.id, provider.name, provider.baseUrl].filter(Boolean).join(' '))
}
