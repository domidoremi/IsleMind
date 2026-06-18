import type { AIProvider } from '@/types'
import { isAzureOpenAIProvider } from '@/services/ai/providerHostedRouting'
import { isVertexAIOpenAICompatibleProvider } from '@/services/ai/providerHostedBoundary'

export function getHeaders(provider: AIProvider): Record<string, string> {
  switch (provider.type) {
    case 'openai':
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      }
    case 'anthropic':
      return {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
      }
    case 'google':
      return { 'Content-Type': 'application/json' }
    case 'openai-compatible':
      if (isAzureOpenAIProvider(provider)) {
        return {
          'Content-Type': 'application/json',
          'api-key': provider.apiKey,
        }
      }
      if (isVertexAIOpenAICompatibleProvider(provider)) {
        return {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        }
      }
      if (provider.wireProtocol === 'anthropic-compatible') {
        return {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
          'anthropic-version': '2023-06-01',
        }
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      }
    case 'xiaomi-mimo':
      if (provider.wireProtocol === 'anthropic-compatible') {
        return {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
          'anthropic-version': '2023-06-01',
        }
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      }
  }
}
