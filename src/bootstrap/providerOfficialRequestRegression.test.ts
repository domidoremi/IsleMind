import type { AIProvider } from '@/types/providerContracts'
import { DEFAULT_PROVIDER_CAPABILITIES, getOpenAIChatMaxTokensField } from '@/modules/providers'
import { buildProviderProtocolRequestBody } from './providerRequestBinding'
import { resolveProviderCapabilityManifest, resolveProviderRequestConformance } from './providerConformance'
import { resolveProviderModelExecutionProfile } from './providerModelExecutionProfile'
import { parseProviderBufferedStreamResponse, parseProviderChatCompletionJson } from './providerResponsePolicies'
import { modelSupportsSamplingControls } from '@/utils/modelReasoning'

const dashscope: AIProvider = {
  id: 'official-dashscope-fixture', name: 'DashScope', type: 'openai-compatible',
  presetId: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: 'synthetic-test-only', models: [], enabled: true,
}

// This is a dated provider contract, not a rule for Qwen models on other hosts.
describe('official DashScope output caps and default thinking replay', () => {
  it.each([
    'qwen3.7-max', 'qwen3.7-max-2026-05-20', 'qwen3.8-max', 'qwen3.8-max-0902',
    'qwen3.5-plus', 'qwen3.6-plus', 'qwen3.7-plus', 'qwen3.5-flash', 'qwen3.8-flash',
    'kimi-k2.5', 'kimi-k2.6', 'kimi-k2.7-code',
    'glm-5', 'glm-5.1', 'glm-5.2-fast-preview', 'glm-5.3', 'ZHIPU/GLM-5.3-FlashX',
    'MiniMax-M2.5', 'MiniMax-M3', 'MiniMax-M3.1-Flash', 'deepseek-v4-pro', 'deepseek-v4.1-flash',
  ])('uses the documented combined-output field only for supported %s', (model) => {
    const request = { provider: dashscope, model, messages: [{ role: 'user' as const, content: 'Test only' }], maxTokens: 1024, generationParameterSources: { maxTokens: 'explicit' as const }, stream: false }
    expect(getOpenAIChatMaxTokensField(request)).toBe('max_completion_tokens')
    const body = buildProviderProtocolRequestBody(request)
    expect(body.max_completion_tokens).toBe(1024)
    expect(body.max_tokens).toBeUndefined()
    expect(resolveProviderCapabilityManifest(request).payload.maxTokensField).toBe('max_completion_tokens')
  })

  it.each([
    'qwen-plus', 'qwen3.6-max', 'qwen3-32b', 'qwen3.8-27b', 'qwen3-vl-plus',
    'kimi-k2-thinking', 'glm-4.7', 'glm-5.3-unknown', 'MiniMax-M2.1', 'deepseek-r1',
    'siliconflow/deepseek-v4-pro', 'kimi/kimi-k2.7-code', 'MiniMax/MiniMax-M3',
    'Qwen/qwen3.8-max', 'unknown-model',
  ])('does not send a new output parameter to unsupported or undocumented %s', (model) => {
    const request = { provider: dashscope, model, messages: [{ role: 'user' as const, content: 'Test only' }], maxTokens: 1024, generationParameterSources: { maxTokens: 'explicit' as const }, stream: false }
    expect(getOpenAIChatMaxTokensField(request)).toBe('max_tokens')
    expect(buildProviderProtocolRequestBody(request).max_completion_tokens).toBeUndefined()
    expect(resolveProviderCapabilityManifest(request).payload.maxTokensField).toBe('max_tokens')
  })

  it.each([
    'qwen3.8-max', 'qwen3.8-max-0902', 'qwen3.8-flash', 'qwen3.8-omni-flash',
    'kimi-k2.7-code', 'kimi/kimi-k2.7-code', 'kimi/kimi-k2.7-code-highspeed',
  ])('preserves every assistant reasoning field separately for default-preserving %s', (model) => {
    const request = {
      provider: dashscope, model, reasoningEffort: 'none' as const, generationParameterSources: {}, stream: false,
      messages: [
        { role: 'assistant' as const, content: 'First answer', reasoningContent: '  first opaque reasoning\n' },
        { role: 'user' as const, content: 'Follow up' },
        { role: 'assistant' as const, content: 'Second answer', reasoningContent: '\n second opaque reasoning  ' },
        { role: 'user' as const, content: 'Continue' },
      ],
    }
    const body = buildProviderProtocolRequestBody(request)
    const messages = body.messages as Record<string, unknown>[]
    expect(messages[0]).toEqual({ role: 'assistant', content: 'First answer', reasoning_content: '  first opaque reasoning\n' })
    expect(messages[2]).toEqual({ role: 'assistant', content: 'Second answer', reasoning_content: '\n second opaque reasoning  ' })
    expect(body.preserve_thinking).toBeUndefined()
    expect(resolveProviderCapabilityManifest(request).payload).toMatchObject({
      requiresReasoningStatePassthrough: true, reasoningStatePreservationField: 'reasoning_content',
    })
  })

  it('does not opt older Qwen models into additionally billed thinking replay', () => {
    const body = buildProviderProtocolRequestBody({
      provider: dashscope, model: 'qwen3.7-max', generationParameterSources: {}, stream: false,
      messages: [{ role: 'assistant', content: 'Answer', reasoningContent: 'Old reasoning' }],
    })
    expect((body.messages as Record<string, unknown>[])[0].reasoning_content).toBeUndefined()
    expect(body.preserve_thinking).toBeUndefined()
  })

  it.each([
    { ...dashscope, presetId: 'custom-endpoint' as const, baseUrl: 'https://relay.example.test/v1' },
    { ...dashscope, presetId: 'custom-endpoint' as const, baseUrl: 'https://dashscope.aliyuncs.com.example.test/compatible-mode/v1' },
    { ...dashscope, presetId: 'custom-endpoint' as const, baseUrl: 'https://example.test/dashscope.aliyuncs.com/compatible-mode/v1' },
    { ...dashscope, presetId: 'siliconflow' as const, baseUrl: 'https://api.siliconflow.cn/v1' },
  ])('does not infer DashScope-only replay or parameters from labels or model names', (provider) => {
    const request = {
      provider, model: 'qwen3.8-max', generationParameterSources: {}, stream: false,
      messages: [{ role: 'assistant' as const, content: 'Answer', reasoningContent: 'Do not forward' }],
    }
    expect(getOpenAIChatMaxTokensField(request)).toBe('max_tokens')
    expect((buildProviderProtocolRequestBody(request).messages as Record<string, unknown>[])[0].reasoning_content).toBeUndefined()
  })
})

describe('default-preserving thinking survives response-to-request round trips', () => {
  it.each(['qwen3.8-max', 'kimi/kimi-k2.7-code'])(
    'preserves non-streaming reasoning separately from the answer for %s', (model) => {
      const request = {
        provider: dashscope, model, reasoningEffort: 'none' as const,
        generationParameterSources: {}, messages: [], stream: false,
      }
      const reasoning = '  exact first reasoning\n\nsecond reasoning  '
      const parsed = parseProviderChatCompletionJson({
        choices: [{ message: { role: 'assistant', content: 'Visible answer', reasoning_content: reasoning } }],
      }, request)
      const body = buildProviderProtocolRequestBody({
        ...request, messages: [
          { role: 'assistant', content: parsed.text, reasoningContent: parsed.reasoningContent },
          { role: 'user', content: 'Follow up' },
        ],
      })
      expect((body.messages as Record<string, unknown>[])[0]).toEqual({
        role: 'assistant', content: 'Visible answer', reasoning_content: reasoning,
      })
    },
  )

  it('keeps every streamed reasoning fragment, including whitespace, through the next request', () => {
    const request = {
      provider: dashscope, model: 'qwen3.8-max', reasoningEffort: 'none' as const,
      generationParameterSources: {}, messages: [], stream: true,
    }
    const fragments = ['  first reasoning\n', '\nsecond reasoning  ']
    const events = [
      ...fragments.map(reasoning_content => ({ choices: [{ delta: { reasoning_content } }] })),
      { choices: [{ delta: { content: 'Visible answer' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 20, total_tokens: 32 } },
    ]
    const raw = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
    const parsed = parseProviderBufferedStreamResponse(raw, request, 'openai-compatible')
    const body = buildProviderProtocolRequestBody({
      ...request, messages: [
        { role: 'assistant', content: parsed.text, reasoningContent: parsed.reasoningContent },
        { role: 'user', content: 'Follow up' },
      ],
    })
    expect(parsed.usage).toMatchObject({ inputTokens: 12, outputTokens: 20, totalTokens: 32, source: 'provider' })
    expect((body.messages as Record<string, unknown>[])[0]).toEqual({
      role: 'assistant', content: 'Visible answer', reasoning_content: fragments.join(''),
    })
  })
})

describe('official DeepSeek effort aliases agree across admission and wire shaping', () => {
  const provider: AIProvider = {
    id: 'official-deepseek-effort-fixture', name: 'DeepSeek', type: 'openai-compatible',
    presetId: 'deepseek', baseUrl: 'https://api.deepseek.com',
    apiKey: '', enabled: true, models: ['deepseek-v4-pro'],
  }

  it.each([
    ['none', undefined], ['minimal', 'low'], ['low', 'low'], ['medium', 'high'],
    ['high', 'high'], ['xhigh', 'high'], ['max', 'max'],
  ] as const)('maps %s to the documented effort %s without changing saved preferences', (reasoningEffort, effort) => {
    const request = {
      provider, model: 'deepseek-v4-pro', reasoningEffort,
      messages: [{ role: 'user' as const, content: 'Synthetic task' }],
      generationParameterSources: {}, stream: false,
    }
    const body = buildProviderProtocolRequestBody(request)
    const conformance = resolveProviderRequestConformance(request, body)
    expect(body.thinking).toEqual({ type: effort ? 'enabled' : 'disabled' })
    expect(body.reasoning_effort).toBe(effort)
    expect(conformance.reasoning).toMatchObject({ requested: reasoningEffort, enabled: Boolean(effort) })
    expect(conformance.reasoning.providerValue).toBe(effort)
    expect(modelSupportsSamplingControls(provider, request.model, reasoningEffort)).toBe(!effort)
    expect(request.reasoningEffort).toBe(reasoningEffort)
  })
})

it('does not advertise a retired service as executable text or streaming through saved flags', () => {
  const provider: AIProvider = {
    id: 'saved-retired-profile', type: 'openai-compatible', presetId: 'github-models', name: 'Saved GitHub',
    baseUrl: 'https://models.github.ai/inference', apiKey: 'synthetic-test-only',
    models: ['historical-model'], enabled: true,
    capabilities: { ...DEFAULT_PROVIDER_CAPABILITIES, chat: true, streaming: true, nativeTools: true, vision: true },
  }
  const request = { provider, model: 'historical-model' }
  expect(resolveProviderCapabilityManifest(request)).toMatchObject({
    modalities: { input: { text: false, image: false }, output: { text: false } },
    transport: { streaming: false }, tools: { supported: false },
    source: { url: 'https://docs.github.com/en/github-models', verifiedAt: '2026-10-31' },
  })
  expect(resolveProviderModelExecutionProfile(request).capabilities).toEqual([])
})

describe('official LocalAI interleaved thinking round trips', () => {
  const localai: AIProvider = {
    id: 'official-localai-replay-fixture', name: 'LocalAI', type: 'openai-compatible',
    presetId: 'localai', baseUrl: 'http://localhost:8080/v1', apiKey: '',
    models: [], enabled: true, capabilities: { ...DEFAULT_PROVIDER_CAPABILITIES },
  }
  const reasoning = '  keep this server-returned reasoning\n\nwithout trimming  '
  const calls = [{ id: 'call-localai', name: 'lookup', arguments: { city: 'Taipei' } }]
  const wireCall = {
    id: 'call-localai', type: 'function',
    function: { name: 'lookup', arguments: '{"city":"Taipei"}' },
  }
  const request = {
    provider: localai, model: 'server-model-alias', reasoningEffort: 'none' as const,
    generationParameterSources: {}, stream: false,
    messages: [
      { role: 'assistant' as const, content: '', reasoningContent: reasoning, toolCalls: calls },
      { role: 'tool' as const, content: 'Sunny', toolCallId: 'call-localai' },
    ],
  }

  it.each([undefined, 'openai-compatible'] as const)(
    'keeps canonical reasoning beside its tool calls on the %s chat wire',
    (wireProtocol) => {
      const body = buildProviderProtocolRequestBody({ ...request, provider: { ...localai, wireProtocol } })
      expect((body.messages as Record<string, unknown>[])[0]).toEqual({
        role: 'assistant', content: '', reasoning, tool_calls: [wireCall],
      })
      expect((body.messages as Record<string, unknown>[])[1]).toEqual({
        role: 'tool', content: 'Sunny', tool_call_id: 'call-localai',
      })
      expect(body.reasoning_effort).toBeUndefined()
      expect(body.thinking).toBeUndefined()
    },
  )

  it.each(['reasoning', 'reasoning_content'])(
    'retains the documented non-streaming %s alias before returning the tool result',
    (field) => {
      const parsed = parseProviderChatCompletionJson({
        choices: [{ finish_reason: 'tool_calls', message: {
          role: 'assistant', content: '', [field]: reasoning, tool_calls: [wireCall],
        } }],
      }, request)
      expect(parsed.reasoningContent).toBe(reasoning)
      expect(parsed.providerToolCalls).toHaveLength(1)
      const body = buildProviderProtocolRequestBody({
        ...request, messages: [
          { role: 'assistant', content: parsed.text, reasoningContent: parsed.reasoningContent, toolCalls: parsed.providerToolCalls },
          request.messages[1],
        ],
      })
      expect((body.messages as Record<string, unknown>[])[0]).toEqual({
        role: 'assistant', content: '', reasoning, tool_calls: [wireCall],
      })
    },
  )

  it.each(['reasoning', 'reasoning_content'])(
    'preserves every streamed %s fragment while keeping the terminal contract strict',
    (field) => {
      const fragments = ['  first reasoning\n', '\nsecond reasoning  ']
      const events = [
        ...fragments.map(fragment => ({ choices: [{ delta: { [field]: fragment } }] })),
        { choices: [{ delta: { tool_calls: [{ ...wireCall, index: 0 }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ]
      const raw = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
      const parsed = parseProviderBufferedStreamResponse(raw, request, 'openai-compatible')
      expect(parsed.streamOutcome?.status).toBe('completed')
      expect(parsed.reasoningContent).toBe(fragments.join(''))
      const body = buildProviderProtocolRequestBody({
        ...request, messages: [
          { role: 'assistant', content: parsed.text, reasoningContent: parsed.reasoningContent, toolCalls: parsed.providerToolCalls },
          request.messages[1],
        ],
      })
      expect((body.messages as Record<string, unknown>[])[0]).toEqual({
        role: 'assistant', content: '', reasoning: fragments.join(''), tool_calls: [wireCall],
      })
    },
  )

  it('reports returned-state preservation without enabling undeclared model reasoning controls', () => {
    const saved = JSON.stringify(localai)
    const manifest = resolveProviderCapabilityManifest(request)
    expect(manifest.reasoning).toMatchObject({ supported: false, requestShape: 'none' })
    expect(manifest.payload).toMatchObject({
      requiresReasoningStatePassthrough: true, reasoningStatePreservationField: 'reasoning',
    })
    const body = buildProviderProtocolRequestBody(request)
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.enable_thinking).toBeUndefined()
    expect(body.thinking).toBeUndefined()
    expect(JSON.stringify(localai)).toBe(saved)
  })

  it.each([undefined, 'custom-endpoint', 'ollama', 'vllm'] as const)(
    'does not infer the LocalAI replay contract from a label or local address for %s',
    (presetId) => {
      const otherRequest = { ...request, provider: { ...localai, presetId } }
      const message = (buildProviderProtocolRequestBody(otherRequest).messages as Record<string, unknown>[])[0]
      expect(message.reasoning).toBeUndefined()
      expect(message.reasoning_content).toBeUndefined()
      expect(resolveProviderCapabilityManifest(otherRequest).payload.requiresReasoningStatePassthrough).toBe(false)
    },
  )

  it('does not insert Chat reasoning into the Anthropic-compatible wire', () => {
    const nativeRequest = { ...request, provider: { ...localai, wireProtocol: 'anthropic-compatible' as const } }
    const body = buildProviderProtocolRequestBody(nativeRequest)
    expect((body.messages as Record<string, unknown>[]).every(message => message.reasoning === undefined)).toBe(true)
    expect(resolveProviderCapabilityManifest(nativeRequest).payload.reasoningStatePreservationField).not.toBe('reasoning')
  })

  it.each([
    { reasoningContent: undefined, toolCalls: calls },
    { reasoningContent: '', toolCalls: calls },
    { reasoningContent: reasoning, toolCalls: [] },
  ])('does not invent returned reasoning or replay text-only turns for %j', (state) => {
    const otherRequest = {
      ...request, messages: [{ role: 'assistant' as const, content: 'Visible answer', ...state }],
    }
    const message = (buildProviderProtocolRequestBody(otherRequest).messages as Record<string, unknown>[])[0]
    expect(message.content).toBe('Visible answer')
    expect(message.reasoning).toBeUndefined()
    expect(message.reasoning_content).toBeUndefined()
    expect(resolveProviderCapabilityManifest(otherRequest).payload.requiresReasoningStatePassthrough).toBe(false)
  })

  it('does not apply the Chat replay requirement to a request-local Responses adapter', () => {
    const manifest = resolveProviderCapabilityManifest({
      ...request, protocolAdapterId: 'openai-compatible-responses',
    })
    expect(manifest.protocol).toBe('openai-responses')
    expect(manifest.payload.requiresReasoningStatePassthrough).toBe(false)
    expect(manifest.payload.reasoningStatePreservationField).not.toBe('reasoning')
  })
})
