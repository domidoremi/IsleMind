import type { ReasoningEffort } from '@/core'
import { normalizeModelId } from '@/utils/modelId'

type FireworksReasoningProfile =
  | 'qwen3'
  | 'minimax-m2'
  | 'deepseek-binary'
  | 'deepseek-v4'
  | 'glm-binary'
  | 'glm-5.2'
  | 'gpt-oss'

export function getProviderFireworksReasoningEffortOptions(model: string): ReasoningEffort[] {
  const profile = fireworksReasoningProfile(model)
  if (profile === 'gpt-oss' || profile === 'minimax-m2') return ['low', 'medium', 'high']
  if (profile === 'deepseek-v4') return ['none', 'low', 'medium', 'high', 'xhigh', 'max']
  if (profile === 'glm-5.2') return ['none', 'high', 'max']
  if (profile === 'qwen3' || profile === 'deepseek-binary' || profile === 'glm-binary') return ['none', 'low', 'medium', 'high']
  return []
}

export function normalizeProviderFireworksReasoningEffort(model: string, effort: ReasoningEffort): ReasoningEffort | undefined {
  const profile = fireworksReasoningProfile(model)
  if (!profile) return undefined
  if (profile === 'gpt-oss' || profile === 'minimax-m2') {
    if (effort === 'none') return undefined
    if (effort === 'minimal') return 'low'
    if (effort === 'xhigh' || effort === 'max') return 'high'
    return ['low', 'medium', 'high'].includes(effort) ? effort : 'medium'
  }
  if (profile === 'deepseek-v4') {
    if (effort === 'minimal') return 'low'
    if (effort === 'xhigh' || effort === 'max') return 'max'
    return ['none', 'low', 'medium', 'high'].includes(effort) ? effort : 'high'
  }
  if (profile === 'glm-5.2') {
    if (effort === 'none') return 'none'
    if (effort === 'xhigh' || effort === 'max') return 'max'
    return 'high'
  }
  if (effort === 'minimal') return 'low'
  if (effort === 'xhigh' || effort === 'max') return 'high'
  return ['none', 'low', 'medium', 'high'].includes(effort) ? effort : 'medium'
}

function fireworksReasoningProfile(model: string): FireworksReasoningProfile | undefined {
  const normalized = normalizeModelId(model)
  const compact = normalized.replace(/[._-]/g, '')
  if (/^gpt-oss(?:[-.]|$)/.test(normalized)) return 'gpt-oss'
  if (/^qwen3(?:p5)?(?:[-.]|$)/.test(normalized) || /^qwen3\.5(?:[-.]|$)/.test(normalized)) return 'qwen3'
  if (/^minimax-m2(?:[-.]|$)/.test(normalized)) return 'minimax-m2'
  if (/^deepseek/.test(normalized)) {
    if (/v4/.test(compact)) return 'deepseek-v4'
    if (/v3p?[12]/.test(compact)) return 'deepseek-binary'
  }
  if (/^glm/.test(normalized)) {
    if (/glm52/.test(compact)) return 'glm-5.2'
    if (/glm4[567]|glm51/.test(compact)) return 'glm-binary'
  }
  return undefined
}
