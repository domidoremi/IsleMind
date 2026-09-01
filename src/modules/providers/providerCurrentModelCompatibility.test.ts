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

  it('omits advanced fields for an unknown official model and preserves them for a catalog model', () => {
    const provider: AIProvider = {
      id: 'openai-capability-gate',
      type: 'openai',
      name: 'OpenAI',
      apiKey: 'test-key',
      models: ['unknown-future-model', 'gpt-5.5'],
      enabled: true,
    }
    const requestShape = {
      provider,
      messages: [{ role: 'user' as const, content: 'Return JSON.' }],
      providerToolDeclarations: [{
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Look up a value.',
          parameters: { type: 'object', properties: {} },
        },
      }],
      structuredOutput: {
        type: 'json_schema' as const,
        name: 'result',
        schema: { type: 'object' },
        strict: true,
      },
      stream: false,
      generationParameterSources: {},
    }

    const unknownBody = buildProviderProtocolRequestBody({
      ...requestShape,
      model: 'unknown-future-model',
    })
    expect(unknownBody.tools).toBeUndefined()
    expect(unknownBody.response_format).toBeUndefined()

    const catalogBody = buildProviderProtocolRequestBody({
      ...requestShape,
      model: 'gpt-5.5',
    })
    expect(catalogBody.tools).toBeDefined()
    expect(catalogBody.text).toBeDefined()
  })
})
