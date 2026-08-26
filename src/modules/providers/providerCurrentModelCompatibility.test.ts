import { buildProviderProtocolRequestBody } from '@/bootstrap/providerRequestBinding'
import { resolveProviderCapabilityManifest } from '@/bootstrap/providerConformance'
import type { AIProvider } from '@/types/providerContracts'

const moonshot: AIProvider = {
  id: 'moonshot-current',
  presetId: 'moonshot' as const,
  type: 'openai-compatible' as const,
  name: 'Moonshot',
  apiKey: 'test-key',
  models: ['kimi-k3'],
  enabled: true,
  capabilities: {
    chat: true,
    streaming: true,
    modelList: true,
    vision: true,
    files: true,
    audioInput: false,
    audioTranscription: false,
    speech: false,
    nativeSearch: false,
    reasoningEffort: true,
    topP: false,
  },
}

describe('current model request compatibility', () => {
  it('uses Kimi K3 reasoning_effort instead of the K2 thinking payload', () => {
    const manifest = resolveProviderCapabilityManifest({
      provider: moonshot,
      model: 'kimi-k3',
      reasoningEffort: 'high',
    })
    expect(manifest.reasoning.requestShape).toBe('openai-reasoning-effort')

    const body = buildProviderProtocolRequestBody({
      provider: moonshot,
      model: 'kimi-k3',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'answer', reasoningContent: 'thought' },
      ],
      reasoningEffort: 'high',
      maxTokens: 128,
      generationParameterSources: { maxTokens: 'explicit' },
      stream: false,
    })

    expect(body.reasoning_effort).toBe('high')
    expect(body.thinking).toBeUndefined()
    expect((body.messages as Array<Record<string, unknown>>)[1].reasoning_content).toBe('thought')
  })
})
