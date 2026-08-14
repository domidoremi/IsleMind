import type { AIModel, AIProvider } from '@/types/providerContracts'
import { createProviderModelDiscoveryAdapter } from './providerModelDiscoveryAdapter'

function provider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: 'custom-endpoint',
    type: 'openai-compatible',
    name: 'Team gateway',
    apiKey: 'test-key',
    baseUrl: 'https://gateway.example/anthropic',
    models: [],
    enabled: true,
    presetId: 'custom-endpoint',
    wireProtocol: 'anthropic-compatible',
    ...overrides,
  }
}

describe('provider model discovery protocol mapping', () => {
  it('uses Anthropic model mapping for a custom supplier on the Anthropic wire protocol', async () => {
    const anthropicModels: AIModel[] = [{
      id: 'claude-test',
      name: 'Claude Test',
      provider: 'anthropic',
      contextWindow: 1000,
      maxTokens: 100,
      maxOutputTokens: 100,
      defaultMaxTokens: 100,
      supportsVision: false,
      supportsFiles: false,
    }]
    const mapOpenAICompatible = jest.fn(() => [])
    const mapAnthropic = jest.fn(() => anthropicModels)
    const adapter = createProviderModelDiscoveryAdapter({
      configurationIssue: () => undefined,
      supportsModelList: () => true,
      isOpenAICompatible: () => true,
      resolveBaseUrl: (value) => value.baseUrl ?? '',
      resolveHeaders: () => ({ 'x-api-key': 'test-key' }),
      request: async () => new Response(JSON.stringify({ data: [{ id: 'claude-test' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      readResponseText: (response) => response.text(),
      parseResponseJson: (text) => JSON.parse(text),
      mapOpenAICompatible,
      mapAnthropic,
      mapGoogle: () => [],
    })

    await expect(adapter.discover(provider(), { timeoutMs: 1000 })).resolves.toBe(anthropicModels)
    expect(mapAnthropic).toHaveBeenCalledTimes(1)
    expect(mapOpenAICompatible).not.toHaveBeenCalled()
  })
})
