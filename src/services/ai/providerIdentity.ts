import type { AIProvider } from '@/types'

export interface ProviderStreamUsageRequestLike {
  provider: AIProvider
  stream?: boolean
}

export function isMiniMaxProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'minimax' || provider.detectedPresetId === 'minimax') return true
  const text = providerIdentityText(provider)
  return /minimax|mini[-_ ]?max|minimaxi|海螺/i.test(text)
}

export function isDashScopeProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'dashscope' || provider.detectedPresetId === 'dashscope') return true
  const text = providerIdentityText(provider)
  return /dashscope|qwen|qwq|qvq|tongyi|aliyun|alibaba|百炼|阿里/i.test(text)
}

export function isMoonshotProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'moonshot' || provider.detectedPresetId === 'moonshot') return true
  const text = providerIdentityText(provider)
  return /moonshot|kimi/i.test(text)
}

export function isXAIProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'xai' || provider.detectedPresetId === 'xai') return true
  const text = providerIdentityText(provider)
  return /(^|[-_./])xai($|[-_./])|grok|api\.x\.ai/i.test(text)
}

export function isPerplexityProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'perplexity' || provider.detectedPresetId === 'perplexity') return true
  const text = providerIdentityText(provider)
  return /perplexity|sonar|api\.perplexity\.ai/i.test(text)
}

export function shouldRequestDashScopeStreamUsage(req: ProviderStreamUsageRequestLike): boolean {
  return (req.stream ?? true) !== false && isDashScopeProvider(req.provider)
}

function providerIdentityText(provider: AIProvider): string {
  return [provider.id, provider.name, provider.baseUrl, provider.models?.join(' ')].filter(Boolean).join(' ')
}
