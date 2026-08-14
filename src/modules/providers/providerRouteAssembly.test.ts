import { getProviderApiEndpoint } from './providerRouteAssembly'
import type { AIProvider } from '@/types/providerContracts'

function provider(overrides: Partial<AIProvider>): AIProvider {
  return {
    id: 'custom-endpoint',
    type: 'openai-compatible',
    presetId: 'custom-endpoint',
    detectedPresetId: 'custom-endpoint',
    name: 'Team gateway',
    apiKey: '',
    models: [],
    enabled: true,
    ...overrides,
  }
}

describe('custom endpoint route assembly', () => {
  it('routes OpenAI API-compatible and Anthropic Messages-compatible protocols independently', () => {
    expect(getProviderApiEndpoint(provider({
      baseUrl: 'https://gateway.example/v1',
      wireProtocol: 'openai-compatible',
    }))).toBe('https://gateway.example/v1/chat/completions')
    expect(getProviderApiEndpoint(provider({
      baseUrl: 'https://gateway.example/anthropic',
      wireProtocol: 'anthropic-compatible',
    }))).toBe('https://gateway.example/anthropic/v1/messages')
  })

  it('fails closed when a custom endpoint has no supplier address', () => {
    expect(getProviderApiEndpoint(provider({ wireProtocol: 'openai-compatible' }))).toBe('')
  })
})
