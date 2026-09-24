import { buildProviderProtocolRequestBody } from '@/bootstrap/providerRequestBinding'
import { buildProviderNativeToolDeclarations } from '@/bootstrap/providerNativeToolDeclarations'
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

const anthropic: AIProvider = {
  id: 'anthropic-current', type: 'anthropic', name: 'Anthropic',
  apiKey: 'test-key', models: ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1'], enabled: true,
}

const anthropicRequest = {
  provider: anthropic,
  messages: [{ role: 'user' as const, content: 'Return JSON.' }],
  maxTokens: 16384,
  generationParameterSources: { maxTokens: 'explicit' as const },
  stream: false,
}

describe('current model request compatibility', () => {
  it.each([
    ['low', 'low'], ['medium', 'high'], ['high', 'high'], ['xhigh', 'high'], ['max', 'max'],
  ] as const)('sends the documented DeepSeek effort mapping %s → %s', (effort, expected) => {
    const provider: AIProvider = {
      id: 'deepseek-current', presetId: 'deepseek', type: 'openai-compatible', name: 'DeepSeek',
      apiKey: 'test-key', models: ['deepseek-flash'], enabled: true,
    }
    const body = buildProviderProtocolRequestBody({
      provider, model: 'deepseek-flash', reasoningEffort: effort,
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi', reasoningContent: 'Previous turn reasoning without a tool call.' },
        { role: 'user', content: 'Look up a value' },
      ],
      providerToolDeclarations: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {} } } }],
      temperature: 0.7, topP: 0.9,
      generationParameterSources: { temperature: 'explicit', topP: 'explicit' }, stream: true,
    })
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.reasoning_effort).toBe(expected)
    expect(body.temperature).toBeUndefined()
    expect(body.top_p).toBeUndefined()
    expect(body.messages).toContainEqual(expect.objectContaining({
      role: 'assistant', reasoning_content: 'Previous turn reasoning without a tool call.',
    }))
  })

  it('uses Responses tool calls and omits unsupported sampling controls for GPT-6 Astra', () => {
    const provider: AIProvider = {
      id: 'openai-current', type: 'openai', name: 'OpenAI',
      apiKey: 'test-key', models: ['gpt-6-astra'], enabled: true,
    }
    const declarations = buildProviderNativeToolDeclarations({
      target: 'openai-responses',
      manifests: [{
        id: 'lookup', source: 'builtin', name: 'lookup', description: 'Look up a value.',
        permission: 'read-only', enabled: true, inputSchema: { type: 'object', properties: {} },
      }],
    })
    const body = buildProviderProtocolRequestBody({
      provider, model: 'gpt-6-astra',
      messages: [{ role: 'user', content: 'Look up a value.' }],
      reasoningEffort: 'high', temperature: 0.7, topP: 0.9, maxTokens: 8192,
      generationParameterSources: { temperature: 'explicit', topP: 'explicit', maxTokens: 'explicit' },
      providerToolDeclarations: declarations.tools,
      stream: true,
    })
    expect(body.input).toBeDefined()
    expect(body.messages).toBeUndefined()
    expect(body.reasoning).toMatchObject({ effort: 'high' })
    expect(body.temperature).toBeUndefined()
    expect(body.top_p).toBeUndefined()
    expect(body.tools).toEqual([expect.objectContaining({
      type: 'function', name: declarations.toolNameMap[0].providerName,
    })])
  })

  it.each([['high', 'high'], ['minimal', 'low']] as const)(
    'maps Gemini 3.8 Flash %s to a documented thinkingLevel (%s)',
    (effort, expected) => {
      const provider: AIProvider = {
        id: 'google-current', type: 'google', name: 'Google',
        apiKey: 'test-key', models: ['gemini-3.8-flash'], enabled: true,
      }
      const body = buildProviderProtocolRequestBody({
        provider, model: 'gemini-3.8-flash', reasoningEffort: effort,
        messages: [{ role: 'user', content: 'Hello.' }], stream: true,
        generationParameterSources: {},
      })
      // Google rejects minimal on 3.8; saved selections from older Flash models
      // must use the lowest documented level instead of an invalid wire value.
      expect(body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: expected } })
    },
  )

  it.each(['claude-opus-4-6', 'claude-sonnet-4-6'])('%s preserves 128K explicit output and normalizes legacy xhigh without sending it', (model) => {
    const body = buildProviderProtocolRequestBody({
      ...anthropicRequest, model, maxTokens: 128000, reasoningEffort: 'max',
    })
    expect(body.max_tokens).toBe(128000)
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(body.output_config).toEqual({ effort: 'max' })

    // Older saved conversations used xhigh as an alias for max on these models.
    const legacy = buildProviderProtocolRequestBody({ ...anthropicRequest, model, reasoningEffort: 'xhigh' })
    expect(legacy.output_config).toEqual({ effort: 'max' })
  })

  it.each(['claude-opus-5', 'claude-sonnet-5'])('%s uses adaptive thinking and preserves xhigh', (model) => {
    const body = buildProviderProtocolRequestBody({ ...anthropicRequest, model, reasoningEffort: 'xhigh' })
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(body.output_config).toEqual({ effort: 'xhigh' })
    expect(body.temperature).toBeUndefined()
    expect(body.top_p).toBeUndefined()
  })

  it.each(['claude-opus-5', 'claude-sonnet-5'])('%s explicitly disables default thinking for none', (model) => {
    const body = buildProviderProtocolRequestBody({ ...anthropicRequest, model, reasoningEffort: 'none' })
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.output_config).toBeUndefined()
    const defaultBody = buildProviderProtocolRequestBody({ ...anthropicRequest, model })
    expect(defaultBody.thinking).toBeUndefined()
  })

  it('preserves legacy budgets and always-on Fable thinking', () => {
    const legacy = buildProviderProtocolRequestBody({ ...anthropicRequest, model: 'claude-sonnet-4-5', reasoningEffort: 'high' })
    expect(legacy.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 })
    const fable = buildProviderProtocolRequestBody({ ...anthropicRequest, model: 'claude-fable-5-1', reasoningEffort: 'xhigh' })
    expect(fable.thinking).toBeUndefined()
    expect(fable.output_config).toEqual({ effort: 'xhigh' })
  })

  it.each(['claude-fable-5-1', 'claude-fable-5', 'claude-opus-5', 'claude-sonnet-5'])('%s uses native JSON output without forced tools or overwriting effort', (model) => {
    const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false }
    const body = buildProviderProtocolRequestBody({
      ...anthropicRequest, model, reasoningEffort: 'high',
      structuredOutput: { type: 'json_schema', schema, strict: true },
    })
    expect(body.tool_choice).toBeUndefined()
    expect(body.tools).toBeUndefined()
    expect(body.output_config).toEqual({ effort: 'high', format: { type: 'json_schema', schema } })
    const manifest = resolveProviderCapabilityManifest({ provider: anthropic, model })
    expect(manifest.structuredOutput).toMatchObject({ documentedRequestShape: 'anthropic-output-config', appRequestControl: true, strictJsonSchema: true, jsonObjectMode: false })
  })

  it('rejects schema-free Claude 5 JSON mode locally rather than silently dropping structured output', () => {
    expect(() => buildProviderProtocolRequestBody({
      ...anthropicRequest, model: 'claude-fable-5-1', structuredOutput: { type: 'json_object' },
    })).toThrow('explicit JSON schema')
    expect(() => buildProviderProtocolRequestBody({
      ...anthropicRequest, model: 'claude-fable-5-1', structuredOutput: { type: 'json_schema' },
    })).toThrow('explicit JSON schema')
  })

  it('preserves ordinary tools alongside native JSON output and keeps legacy tool-schema output', () => {
    const tool = { name: 'lookup', description: 'Look up a value', input_schema: { type: 'object', properties: {} } }
    const body = buildProviderProtocolRequestBody({
      ...anthropicRequest, model: 'claude-fable-5-1', providerToolDeclarations: [tool],
      structuredOutput: { type: 'json_schema', schema: { type: 'object', properties: {}, additionalProperties: false } },
    })
    expect(body.tools).toEqual([tool])
    expect(body.tool_choice).toBeUndefined()
    const legacy = buildProviderProtocolRequestBody({
      ...anthropicRequest, model: 'claude-sonnet-4-5', structuredOutput: { type: 'json_object' },
    })
    expect(legacy.tool_choice).toEqual({ type: 'tool', name: 'islemind_structured_output' })
    expect(legacy.output_config).toBeUndefined()
  })

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
