export interface ProviderIdentityDescriptor {
  id?: string
  name?: string
  baseUrl?: string
  presetId?: string
  detectedPresetId?: string
}

export interface ProviderStreamUsageRequestLike {
  provider: ProviderIdentityDescriptor
  stream?: boolean
}

export function isMiniMaxProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'minimax')) return true
  return /minimax|mini[-_ ]?max|minimaxi|海螺/i.test(providerIdentityText(provider))
}

export function isDashScopeProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'dashscope')) return true
  if (hasPreset(provider, 'siliconflow') || hasPreset(provider, 'modelscope')) return false
  return /dashscope|qwen|qwq|qvq|tongyi|aliyun|alibaba|百炼|阿里/i.test(providerIdentityText(provider))
}

export function isMoonshotProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'moonshot')) return true
  return /moonshot|kimi/i.test(providerIdentityText(provider))
}

export function isXAIProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'xai')) return true
  return /(^|[-_./])xai($|[-_./])|grok|api\.x\.ai/i.test(providerIdentityText(provider))
}

export function isGroqProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'groq')) return true
  return /groq|api\.groq\.com/i.test(providerIdentityText(provider))
}

export function isTogetherProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'together')) return true
  return /together|api\.together\.(ai|xyz)/i.test(providerIdentityText(provider))
}

export function isFireworksProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'fireworks')) return true
  return /fireworks|api\.fireworks\.ai/i.test(providerIdentityText(provider))
}

export function isPerplexityProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'perplexity')) return true
  return /perplexity|sonar|api\.perplexity\.ai/i.test(providerIdentityText(provider))
}

export function isCohereProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'cohere')) return true
  return /cohere|api\.cohere\.ai|api\.cohere\.com/i.test(providerIdentityText(provider))
}

export function isCerebrasProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'cerebras')) return true
  return /cerebras|api\.cerebras\.ai/i.test(providerIdentityText(provider))
}

export function isSambaNovaProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'sambanova')) return true
  return /sambanova|api\.sambanova\.ai/i.test(providerIdentityText(provider))
}

export function isNvidiaNimProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'nvidia-nim')) return true
  return /nvidia|integrate\.api\.nvidia\.com|build\.nvidia\.com/i.test(providerIdentityText(provider))
}

export function isHuggingFaceProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'huggingface')) return true
  return /hugging\s*face|huggingface|router\.huggingface\.co|api-inference\.huggingface\.co|hf\.co/i.test(providerIdentityText(provider))
}

export function isGitHubModelsProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'github-models')) return true
  return /github\s*models|github-models|models\.github\.ai/i.test(providerIdentityText(provider))
}

export function isDeepInfraProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'deepinfra')) return true
  return /deepinfra|api\.deepinfra\.com/i.test(providerIdentityText(provider))
}

export function isNovitaProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'novita')) return true
  return /novita|api\.novita\.ai/i.test(providerIdentityText(provider))
}

export function isSiliconFlowProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'siliconflow')) return true
  return /siliconflow|silicon\s*flow|api\.siliconflow\.(cn|com)|硅基流动/i.test(providerIdentityText(provider))
}

export function isModelScopeProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'modelscope')) return true
  return /modelscope|model\s*scope|api-inference\.modelscope\.cn|魔搭/i.test(providerIdentityText(provider))
}

/**
 * Returns whether an OpenAI Chat-compatible request should ask for streamed
 * usage metadata. These providers document the same `stream_options` field;
 * custom relays that merely expose a matching model name are excluded by the
 * identity checks above.
 */
export function shouldRequestOpenAIChatStreamUsage(req: ProviderStreamUsageRequestLike): boolean {
  if ((req.stream ?? true) === false) return false
  return isDashScopeProvider(req.provider) || isOllamaProvider(req.provider) || isLMStudioProvider(req.provider)
}

export function shouldRequestDashScopeStreamUsage(req: ProviderStreamUsageRequestLike): boolean {
  return (req.stream ?? true) !== false && isDashScopeProvider(req.provider)
}

export function isOllamaProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'ollama')) return true
  return /ollama|localhost:11434|127\.0\.0\.1:11434/i.test(providerIdentityText(provider))
}

export function isLMStudioProvider(provider: ProviderIdentityDescriptor): boolean {
  if (hasPreset(provider, 'lm-studio')) return true
  return /lm[-_ ]?studio|lmstudio|localhost:1234|127\.0\.0\.1:1234/i.test(providerIdentityText(provider))
}

function hasPreset(provider: ProviderIdentityDescriptor, presetId: string): boolean {
  return provider.presetId === presetId || provider.detectedPresetId === presetId
}

function providerIdentityText(provider: ProviderIdentityDescriptor): string {
  return [provider.id, provider.name, provider.baseUrl].filter(Boolean).join(' ')
}
