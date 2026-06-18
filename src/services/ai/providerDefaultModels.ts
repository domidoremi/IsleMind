import type { AIProvider, ProviderType } from '@/types'

export function fallbackModel(providerType: ProviderType): string {
  switch (providerType) {
    case 'openai':
      return 'gpt-5.5'
    case 'anthropic':
      return 'claude-haiku-4-5-20251001'
    case 'google':
      return 'gemini-3-flash-preview'
    case 'openai-compatible':
      return 'gpt-4o-mini'
    case 'xiaomi-mimo':
      return 'mimo-v2.5-pro'
  }
}

export function pickEmbeddingModel(provider: AIProvider): string {
  if (provider.type === 'openai') return 'text-embedding-3-small'
  const configured = provider.models.find((model) => /embed|embedding|text-embedding/i.test(model))
  if (configured) return configured
  if (provider.type === 'xiaomi-mimo') return 'text-embedding'
  return 'text-embedding-3-small'
}
