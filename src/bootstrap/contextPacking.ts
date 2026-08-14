import type { ReasoningEffort } from '@/core'
import { createContextPackingPolicy } from '@/modules/assistant-runtime'
import { estimateMessageTokens, estimateTextTokens } from '@/services/tokenUsage'
import type { Attachment } from '@/types/chatContracts'
import { getModelConfig } from '@/types/modelCatalog'
import type {
  AIProvider,
  ProviderType,
} from '@/types/providerContracts'
import { providerSupportsReasoning } from '@/utils/modelReasoning'

const contextPackingPolicy = createContextPackingPolicy<
  Attachment,
  ReasoningEffort,
  AIProvider,
  ProviderType
>({
  estimateTextTokens,
  estimateMessageTokens,
  estimateReasoningReserve,
})

export const { packChatMessages } = contextPackingPolicy

function estimateReasoningReserve(input: {
  reasoningEffort?: ReasoningEffort
  provider?: AIProvider
  providerType?: ProviderType
  model?: string
}): number {
  const { reasoningEffort, provider, providerType, model } = input
  const normalizedModel = model?.toLowerCase() ?? ''
  const modelConfig = provider && model
    ? getModelConfig(model, provider.type, provider.modelConfigs)
    : undefined
  const providerAllowsReasoningReserve = provider && model
    ? providerSupportsReasoning(provider, model)
    : true
  if (provider && model && !providerAllowsReasoningReserve) return 0
  const modelReasoningMode = providerAllowsReasoningReserve
    ? modelConfig?.reasoningMode
    : undefined
  const effectiveProviderType = provider?.type ?? providerType
  const normalizedModelTail = normalizedModel.split('/').at(-1) ?? normalizedModel
  const isDashScopeQwenReasoning = effectiveProviderType === 'openai-compatible' && (
    modelReasoningMode === 'dashscope-thinking'
    || /^(qwen3|qwq|qvq)/.test(normalizedModelTail)
  )
  const isReasoningModel = effectiveProviderType === 'openai' && /^(o[1-9]|gpt-5)/.test(normalizedModel)
    || effectiveProviderType === 'anthropic' && /claude-(3[.-]7|fable-5|opus-4|sonnet-4|haiku-4|mythos)/.test(normalizedModel)
    || effectiveProviderType === 'google' && /^gemini-(2\.5|3)/.test(normalizedModel)
    || effectiveProviderType === 'openai-compatible' && /^minimax-m3$/.test(normalizedModel)
    || Boolean(modelReasoningMode)
    || isDashScopeQwenReasoning
    || /deepseek|reasoner|thinking/.test(normalizedModel)
  if (!isReasoningModel) return 0
  if (isDashScopeQwenReasoning) {
    return estimateDashScopeQwenReasoningReserve(reasoningEffort, normalizedModelTail)
  }
  switch (reasoningEffort) {
    case 'max':
    case 'xhigh':
      return 8192
    case 'high':
      return 4096
    case 'medium':
      return 2048
    case 'low':
      return 1024
    case 'minimal':
      return 512
    case 'none':
    default:
      return 0
  }
}

function estimateDashScopeQwenReasoningReserve(
  reasoningEffort?: ReasoningEffort,
  model?: string,
): number {
  const maxBudget = /^qwen3\.(6|7)/.test(model ?? '') ? 262144 : 8192
  switch (reasoningEffort) {
    case 'high':
    case 'max':
    case 'xhigh':
      return maxBudget
    case 'medium':
      return Math.min(maxBudget, 65536)
    case 'low':
      return Math.min(maxBudget, 8192)
    case 'none':
    case 'minimal':
    default:
      return 0
  }
}
