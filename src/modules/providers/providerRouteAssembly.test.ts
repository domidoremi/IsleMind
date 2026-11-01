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
    }))).toBe('https://gateway.example/anthropic/messages')
  })

  it('fails closed when a custom endpoint has no supplier address', () => {
    expect(getProviderApiEndpoint(provider({ wireProtocol: 'openai-compatible' }))).toBe('')
  })

  it.each([
    ['https://gateway.example', 'https://gateway.example/v1/messages'],
    ['https://gateway.example/', 'https://gateway.example/v1/messages'],
    ['https://gateway.example/v1/', 'https://gateway.example/v1/messages'],
    ['https://gateway.example/custom/', 'https://gateway.example/custom/messages'],
    ['https://gateway.example/custom/v1', 'https://gateway.example/custom/v1/messages'],
    ['https://gateway.example/custom/messages/', 'https://gateway.example/custom/messages'],
    ['https://gateway.example/anthropic/messages', 'https://gateway.example/anthropic/messages'],
  ])('preserves the Messages base or full endpoint %s', (baseUrl, endpoint) => {
    expect(getProviderApiEndpoint(provider({ baseUrl, wireProtocol: 'anthropic-compatible' }))).toBe(endpoint)
  })

  it('keeps the documented MiniMax Anthropic prefix convention scoped to MiniMax', () => {
    expect(getProviderApiEndpoint(provider({
      presetId: 'minimax', baseUrl: 'https://api.minimax.io/anthropic', wireProtocol: 'anthropic-compatible',
    }))).toBe('https://api.minimax.io/anthropic/v1/messages')
  })
})
