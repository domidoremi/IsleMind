import type { AIProvider, ReasoningEffort } from '@/types'
import { getModelConfig } from '@/types'
import { isXiaomiMimoReasoningModel, modelSupportsSamplingControls } from '@/utils/modelReasoning'
import { isMiniMaxProvider } from '@/services/ai/providerIdentity'
import { providerCompatibilityCapabilityCanBeSentForProvider, providerCompatibilityReasoningExplicitlyDeclaredForModel } from '@/services/ai/providerCompatibilityContract'

export interface ProviderRequestParameterInput {
  provider: AIProvider
  model: string
  reasoningEffort?: ReasoningEffort
  temperature?: number
  maxTokens?: number
}

export function normalizeXiaomiMimoThinking(req: ProviderRequestParameterInput): { type: 'enabled' | 'disabled' } | undefined {
  if (!req.reasoningEffort) return undefined
  if (!providerReasoningCanBeSent(req)) return undefined
  if (!isXiaomiMimoReasoningModel(req.provider, req.model)) return undefined
  return { type: req.reasoningEffort === 'none' ? 'disabled' : 'enabled' }
}

export function isXiaomiMimoThinkingActive(req: ProviderRequestParameterInput): boolean {
  if (!providerReasoningCanBeSent(req)) return false
  if (!isXiaomiMimoReasoningModel(req.provider, req.model)) return false
  if (req.reasoningEffort) return req.reasoningEffort !== 'none'
  const modelId = req.model.toLowerCase()
  return ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro', 'mimo-v2-omni'].includes(modelId)
}

function providerReasoningCanBeSent(req: ProviderRequestParameterInput): boolean {
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  const explicitDeclaration = providerCompatibilityReasoningExplicitlyDeclaredForModel(req.provider, modelConfig)
  return providerCompatibilityCapabilityCanBeSentForProvider(req.provider, 'reasoning', explicitDeclaration)
}

export function supportsSamplingControls(req: ProviderRequestParameterInput): boolean {
  return modelSupportsSamplingControls(req.provider, req.model, req.reasoningEffort)
}

export function normalizeTemperature(req: ProviderRequestParameterInput): number | undefined {
  if (!supportsSamplingControls(req)) return undefined
  if (req.provider.type === 'xiaomi-mimo') {
    if (isXiaomiMimoThinkingActive(req)) return undefined
    return Math.max(0, Math.min(1.5, req.temperature ?? 0.7))
  }
  if (isMiniMaxProvider(req.provider)) {
    return Math.max(0, Math.min(2, req.temperature ?? 1))
  }
  return req.temperature ?? 0.7
}

export function clampMaxTokens(req: ProviderRequestParameterInput): number {
  const config = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  const requested = req.maxTokens ?? config.defaultMaxTokens
  return Math.max(1, Math.min(config.maxOutputTokens, requested))
}
