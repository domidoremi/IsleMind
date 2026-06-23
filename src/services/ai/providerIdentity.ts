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
  if (provider.presetId === 'siliconflow' || provider.detectedPresetId === 'siliconflow') return false
  if (provider.presetId === 'modelscope' || provider.detectedPresetId === 'modelscope') return false
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

export function isGroqProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'groq' || provider.detectedPresetId === 'groq') return true
  const text = providerIdentityText(provider)
  return /groq|api\.groq\.com/i.test(text)
}

export function isTogetherProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'together' || provider.detectedPresetId === 'together') return true
  const text = providerIdentityText(provider)
  return /together|api\.together\.(ai|xyz)/i.test(text)
}

export function isFireworksProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'fireworks' || provider.detectedPresetId === 'fireworks') return true
  const text = providerIdentityText(provider)
  return /fireworks|api\.fireworks\.ai/i.test(text)
}

export function isPerplexityProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'perplexity' || provider.detectedPresetId === 'perplexity') return true
  const text = providerIdentityText(provider)
  return /perplexity|sonar|api\.perplexity\.ai/i.test(text)
}

export function isCohereProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'cohere' || provider.detectedPresetId === 'cohere') return true
  const text = providerIdentityText(provider)
  return /cohere|api\.cohere\.ai|api\.cohere\.com/i.test(text)
}

export function isCerebrasProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'cerebras' || provider.detectedPresetId === 'cerebras') return true
  const text = providerIdentityText(provider)
  return /cerebras|api\.cerebras\.ai/i.test(text)
}

export function isSambaNovaProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'sambanova' || provider.detectedPresetId === 'sambanova') return true
  const text = providerIdentityText(provider)
  return /sambanova|api\.sambanova\.ai/i.test(text)
}

export function isNvidiaNimProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'nvidia-nim' || provider.detectedPresetId === 'nvidia-nim') return true
  const text = providerIdentityText(provider)
  return /nvidia|integrate\.api\.nvidia\.com|build\.nvidia\.com/i.test(text)
}

export function isHuggingFaceProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'huggingface' || provider.detectedPresetId === 'huggingface') return true
  const text = providerIdentityText(provider)
  return /hugging\s*face|huggingface|router\.huggingface\.co|api-inference\.huggingface\.co|hf\.co/i.test(text)
}

export function isGitHubModelsProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'github-models' || provider.detectedPresetId === 'github-models') return true
  const text = providerIdentityText(provider)
  return /github\s*models|github-models|models\.github\.ai/i.test(text)
}

export function isDeepInfraProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'deepinfra' || provider.detectedPresetId === 'deepinfra') return true
  const text = providerIdentityText(provider)
  return /deepinfra|api\.deepinfra\.com/i.test(text)
}

export function isNovitaProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'novita' || provider.detectedPresetId === 'novita') return true
  const text = providerIdentityText(provider)
  return /novita|api\.novita\.ai/i.test(text)
}

export function isSiliconFlowProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'siliconflow' || provider.detectedPresetId === 'siliconflow') return true
  const text = providerIdentityText(provider)
  return /siliconflow|silicon\s*flow|api\.siliconflow\.(cn|com)|硅基流动/i.test(text)
}

export function isModelScopeProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'modelscope' || provider.detectedPresetId === 'modelscope') return true
  const text = providerIdentityText(provider)
  return /modelscope|model\s*scope|api-inference\.modelscope\.cn|魔搭/i.test(text)
}

export function shouldRequestDashScopeStreamUsage(req: ProviderStreamUsageRequestLike): boolean {
  return (req.stream ?? true) !== false && isDashScopeProvider(req.provider)
}

function providerIdentityText(provider: AIProvider): string {
  return [provider.id, provider.name, provider.baseUrl].filter(Boolean).join(' ')
}
