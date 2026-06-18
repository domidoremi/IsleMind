import type { AIProvider, ProviderType } from '@/types'
import { isAnthropicWireProvider } from '@/services/ai/providerRequestOptimization'

export interface ProviderWireRequestLike {
  provider: AIProvider
}

export function getWireProviderType(provider: AIProvider): ProviderType {
  return provider.wireProtocol === 'anthropic-compatible'
    ? 'anthropic'
    : provider.type
}

export function isAnthropicWireRequest(req: ProviderWireRequestLike): boolean {
  return isAnthropicWireProvider(req.provider)
}
