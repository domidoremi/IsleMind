import { CHAT_REQUEST_SCHEMA, type ChatRequest, type StreamEvent } from '@/core'
import type { AIProvider } from '@/types/providerContracts'
import { getModelConfig } from '@/types/modelCatalog'
import { createProviderGateway, extractProviderToolCalls, selectProviderAttachmentMessage, type ProviderRuntimeCompletionResult } from '@/modules/providers'
import { buildProviderNativeToolRevisionMessages } from '@/services/chatProviderNativeToolUtils'
import { buildProviderProtocolRequestBody } from './providerRequestBinding'
import { createProviderRuntimeAdapter, toRuntimeChatRequest } from './providerRuntime'
import { createRichStreamEventReporter } from './conversationProviderStreamingRuntime'

jest.mock('./providerModelAvailabilityRuntime', () => ({ bindProviderModelAvailabilityOperations: jest.fn() }))
jest.mock('./usageStatisticsRuntime', () => ({}))

const provider = (type: AIProvider['type'], model: string, presetId?: AIProvider['presetId']): AIProvider => ({
  id: `${type}-replay`, type, presetId, name: type, enabled: true, models: [model], apiKey: 'test-only',
})

describe('Harness native-search continuation', () => {
  const p: AIProvider = {
    ...provider('openai', 'gpt-4o'),
    capabilities: { chat: true, streaming: true, modelList: true, vision: true, files: true,
      audioInput: false, audioTranscription: false, speech: false, nativeSearch: true,
      reasoningEffort: true, nativeTools: true, topP: true },
  }
  const request: ChatRequest = {
    schema: CHAT_REQUEST_SCHEMA, conversationId: 'search-continuation', providerId: p.id, model: p.models[0],
    generationParameterSources: {},
    requestedCapabilities: ['tools', 'native-search'],
    providerStateBinding: { providerId: p.id, model: p.models[0] },
    messages: [
      { id: 'u1', role: 'user', text: 'Continue with the search results.' },
      { id: 'a1', role: 'assistant', text: '', toolCalls: [{ callId: 'call-1', name: 'lookup', arguments: {} }] },
      { id: 't1', role: 'tool', name: 'lookup', toolCallId: 'call-1', text: 'Local result' },
    ],
  }

  it('passes the gateway and preserves native search, call identity and route binding on the wire', async () => {
    const streamChat = jest.fn<ReturnType<NonNullable<Parameters<typeof createProviderRuntimeAdapter>[0]['streamChat']>>,
      Parameters<NonNullable<Parameters<typeof createProviderRuntimeAdapter>[0]['streamChat']>>>()
      .mockImplementation(async (runtime, _chunk, done) => {
        expect(runtime.webSearchMode).toBe('native')
        expect(runtime.allowFallback).toBe(false)
        const body = buildProviderProtocolRequestBody(runtime)
        expect(body.tools).toContainEqual(expect.objectContaining({ type: 'web_search' }))
        expect(body.input).toContainEqual({ type: 'function_call_output', call_id: 'call-1', output: 'Local result' })
        return { controller: new AbortController(), done: Promise.resolve().then(() => done({ text: 'Finished', traces: [] })) }
      })
    const gateway = createProviderGateway([createProviderRuntimeAdapter({ provider: p, streamChat })])
    const events: StreamEvent[] = []
    for await (const event of gateway.stream(request, { signal: new AbortController().signal })) events.push(event)
    expect(streamChat).toHaveBeenCalledTimes(1)
    expect(events).toContainEqual({ type: 'text-delta', text: 'Finished' })
  })

  it('rejects unsupported native search before dispatch', async () => {
    const streamChat = jest.fn()
    const gateway = createProviderGateway([createProviderRuntimeAdapter({
      provider: { ...p, capabilities: { ...p.capabilities!, nativeSearch: false } }, streamChat,
    })])
    await expect((async () => {
      for await (const _event of gateway.stream(request, { signal: new AbortController().signal })) { /* drain */ }
    })()).rejects.toThrow(/native-search/)
    expect(streamChat).not.toHaveBeenCalled()
  })

  it('does not enable native search for plain or legacy ambiguous web-search requests', () => {
    for (const requestedCapabilities of [undefined, ['tools'], ['web-search']]) {
      expect(toRuntimeChatRequest({ provider: p }, { ...request, requestedCapabilities }).webSearchMode).toBeUndefined()
    }
  })

  it.each(['web-search', 'attachments', 'remote-compact'])('keeps unsupported legacy %s recovery fail-closed', async (capability) => {
    const streamChat = jest.fn()
    const gateway = createProviderGateway([createProviderRuntimeAdapter({ provider: p, streamChat })])
    await expect((async () => {
      for await (const _event of gateway.stream({ ...request, requestedCapabilities: [capability] }, {
        signal: new AbortController().signal,
      })) { /* drain */ }
    })()).rejects.toThrow(capability)
    expect(streamChat).not.toHaveBeenCalled()
  })
})

describe.each(['native', 'tagged'] as const)('%s tool continuation attachments', (mode) => {
  it.each([
    ['openai', 'gpt-4o'],
    ['openai', 'gpt-6-astra'],
    ['anthropic', 'claude-sonnet-4-6'],
    ['google', 'gemini-3.8-flash'],
  ] as const)('keeps media on its original user message for %s / %s', (type, model) => {
    const p: AIProvider = { ...provider(type, model), capabilities: {
      chat: true, streaming: true, modelList: true, vision: true, files: true,
      audioInput: false, audioTranscription: false, speech: false, nativeSearch: false,
      reasoningEffort: true, nativeTools: true, topP: true,
    } }
    const original: ChatRequest = {
      schema: CHAT_REQUEST_SCHEMA, conversationId: 'media-continuation', providerId: p.id, model,
      generationParameterSources: {},
      providerStateBinding: { providerId: p.id, model },
      messages: [
        { id: 'older-user', role: 'user', text: 'Read this image' },
        { id: 'older-answer', role: 'assistant', text: 'Earlier answer' },
        { id: 'media-user', role: 'user', text: 'Read this image' },
        ...(mode === 'native' ? [
          { id: 'call', role: 'assistant' as const, text: '', toolCalls: [{ callId: 'read-1', name: 'lookup', arguments: {} }] },
          { id: 'receipt', role: 'tool' as const, toolCallId: 'read-1', name: 'lookup', text: 'Local result' },
        ] : [
          { id: 'call', role: 'assistant' as const, text: '<islemind_tool_call>lookup</islemind_tool_call>' },
          { id: 'receipt', role: 'user' as const, text: 'Tool result: local result. Continue.' },
        ]),
      ],
    }
    const runtime = toRuntimeChatRequest({ provider: p, attachmentMessageId: 'media-user' }, original)
    runtime.attachments = [{ id: 'image', type: 'image', uri: 'fixture://image', name: 'image.png',
      mimeType: 'image/png', size: 8, base64: 'Zml4dHVyZQ==' }]
    const body = buildProviderProtocolRequestBody(runtime)
    const messages = (body.messages ?? body.input ?? body.contents) as Record<string, unknown>[]
    expect(JSON.stringify(messages[2])).toContain('Zml4dHVyZQ==')
    expect(JSON.stringify(messages.filter((_, index) => index !== 2))).not.toContain('Zml4dHVyZQ==')
    expect(JSON.stringify(body)).not.toContain('attachmentTarget')
    expect(JSON.stringify(body)).not.toContain('fixture://image')
    expect(JSON.stringify(original)).not.toContain('attachmentTarget')
    expect(runtime.allowFallback).toBe(false)

    for (const attachmentMessageId of ['missing', 'older-answer']) {
      expect(() => toRuntimeChatRequest({ provider: p, attachmentMessageId }, original)).toThrow(/attachment message binding/)
    }
    expect(() => toRuntimeChatRequest({ provider: p, attachmentMessageId: 'media-user' }, {
      ...original, messages: [...original.messages, original.messages[2]],
    })).toThrow(/attachment message binding/)

    const next = toRuntimeChatRequest({ provider: p, attachmentMessageId: 'media-user' }, {
      ...original, messages: [...original.messages,
        { id: 'follow-up-answer', role: 'assistant', text: 'Another operation completed' },
        { id: 'follow-up-receipt', role: 'user', text: 'Second tool receipt, not the image owner' }],
    })
    next.attachments = runtime.attachments
    const nextBody = buildProviderProtocolRequestBody(next)
    const nextMessages = (nextBody.messages ?? nextBody.input ?? nextBody.contents) as Record<string, unknown>[]
    expect(JSON.stringify(nextMessages[2])).toContain('Zml4dHVyZQ==')
    expect(JSON.stringify(nextMessages.filter((_, index) => index !== 2))).not.toContain('Zml4dHVyZQ==')

    const noVision = buildProviderProtocolRequestBody({ ...runtime,
      provider: { ...p, modelConfigs: [{ ...getModelConfig(model, type), supportsVision: false }] },
    })
    expect(JSON.stringify(noVision)).not.toContain('Zml4dHVyZQ==')
  })
})

test('attachment selection preserves legacy initial sends and rejects ambiguous or non-user bindings', () => {
  const user = { role: 'user' }
  const assistant = { role: 'assistant' }
  expect(selectProviderAttachmentMessage([assistant, user])).toBe(user)
  expect(selectProviderAttachmentMessage([user, assistant])).toBeUndefined()
  expect(selectProviderAttachmentMessage([])).toBeUndefined()
  expect(() => selectProviderAttachmentMessage([{ ...user, attachmentTarget: true },
    { ...user, attachmentTarget: true }])).toThrow(/attachment message binding/)
  expect(() => selectProviderAttachmentMessage([{ ...assistant, attachmentTarget: true }, user]))
    .toThrow(/attachment message binding/)
})

test.each(['openai', 'anthropic', 'google'] as const)('Harness %s requests serialize an output cap without changing explicit settings', (type) => {
  const p = provider(type, type === 'openai' ? 'gpt-4o' : type === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gemini-2.5-flash')
  const request: ChatRequest = { schema: CHAT_REQUEST_SCHEMA, conversationId: 'output-cap', providerId: p.id, model: p.models[0],
    messages: [{ id: 'u1', role: 'user', text: 'hello' }], generationParameterSources: { maxTokens: 'provider-default' } }
  const runtime = toRuntimeChatRequest({ provider: p }, request)
  expect(runtime.generationParameterSources?.maxTokens).toBe('internal-policy')
  const body = buildProviderProtocolRequestBody(runtime)
  const cap = body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens
    ?? (body.generationConfig as { maxOutputTokens?: number })?.maxOutputTokens
  expect(typeof cap).toBe('number')
  expect(cap).toBeGreaterThan(0)
  const explicit = toRuntimeChatRequest({ provider: p }, { ...request, maxTokens: 1024, generationParameterSources: { maxTokens: 'explicit' } })
  expect(explicit.maxTokens).toBe(1024)
  expect(explicit.generationParameterSources?.maxTokens).toBe('explicit')
})

async function completionEvents(p: AIProvider, result: ProviderRuntimeCompletionResult, path: 'plain' | 'rich') {
  const events: StreamEvent[] = []
  if (path === 'rich') {
    createRichStreamEventReporter((event) => events.push(event), {
      binding: { providerId: p.id, model: p.models[0] },
    }).complete(result)
  } else {
    const adapter = createProviderRuntimeAdapter({
      provider: p,
      streamChat: async (_request, _onChunk, onDone) => ({
        controller: new AbortController(), done: Promise.resolve().then(() => { onDone(result) }),
      }),
    })
    const request: ChatRequest = {
      schema: CHAT_REQUEST_SCHEMA, conversationId: 'replay-test', providerId: p.id, model: p.models[0],
      messages: [{ id: 'u1', role: 'user', text: 'Look up both cities' }], generationParameterSources: {},
    }
    for await (const event of adapter.stream(request, { signal: new AbortController().signal })) events.push(event)
  }
  return events
}

async function roundTrip(p: AIProvider, result: ProviderRuntimeCompletionResult, path: 'plain' | 'rich' = 'plain') {
  const request: ChatRequest = {
    schema: CHAT_REQUEST_SCHEMA, conversationId: 'replay-test', providerId: p.id, model: p.models[0],
    messages: [{ id: 'u1', role: 'user', text: 'Look up both cities' }], generationParameterSources: {},
    reasoningEffort: 'high',
  }
  const events = await completionEvents(p, result, path)
  const state = events.find((event) => event.type === 'provider-continuation-state')!
  if (state.type !== 'provider-continuation-state') throw new Error('Missing continuation state')
  const calls = events.filter((event) => event.type === 'tool-call')
  const continued: ChatRequest = {
    ...request,
    providerStateBinding: state.binding,
    messages: [
      ...request.messages,
      { id: 'a1', role: 'assistant', text: result.text, reasoningReplay: state.reasoningReplay, toolCalls: calls.map((call) => ({
        callId: call.toolCallId, name: call.toolName, arguments: call.arguments ?? {}, providerMetadata: call.providerMetadata,
      })) },
      // Deliberately reverse completion order: identity must not depend on position.
      ...[...calls].reverse().map((call, index) => ({
        id: `t${index}`, role: 'tool' as const, toolCallId: call.toolCallId, name: call.toolName, text: `result-${call.toolCallId}`,
      })),
      { id: 'u2', role: 'user', text: 'Continue' },
    ],
  }
  const runtime = toRuntimeChatRequest({ provider: p }, continued)
  expect(runtime.allowFallback).toBe(false)
  return { runtime, body: buildProviderProtocolRequestBody(runtime), events }
}

describe('provider completion → canonical continuation → next request', () => {
  it('round-trips Gemini call IDs and per-part signatures without assigning one to unsigned calls', async () => {
    const parts = [
      { functionCall: { id: 'server-a', name: 'lookup', args: { city: 'Taipei' } }, thoughtSignature: 'opaque-signature' },
      { functionCall: { id: 'server-b', name: 'lookup', args: { city: 'Tokyo' } } },
    ]
    const p = provider('google', 'gemini-3.8-flash')
    const parsed = extractProviderToolCalls({ candidates: [{ content: { parts } }] }, 'google')!
    const { body } = await roundTrip(p, { text: '', traces: [], providerToolCalls: parsed })
    expect(body.contents).toContainEqual({ role: 'model', parts })
    const responseParts = (body.contents as { parts: Record<string, unknown>[] }[]).flatMap((content) => content.parts).filter((part) => part.functionResponse)
    expect(responseParts).toEqual([
      { functionResponse: { id: 'server-b', name: 'lookup', response: { result: 'result-server-b' } } },
      { functionResponse: { id: 'server-a', name: 'lookup', response: { result: 'result-server-a' } } },
    ])

    const rich = buildProviderNativeToolRevisionMessages({
      provider: p, messages: [], firstOutput: '', call: parsed[0],
      tool: { providerName: 'lookup', toolName: 'lookup', source: 'builtin', toolId: 'lookup', permission: 'read-only' }, toolOutput: 'found', ok: true,
    }, '')
    const richBody = buildProviderProtocolRequestBody({ provider: p, model: p.models[0], messages: rich, stream: true, generationParameterSources: {} })
    expect(JSON.stringify(richBody)).toContain('"id":"server-a"')
    expect((richBody.contents as { parts: unknown[] }[])[0].parts).toEqual([parts[0]])
    expect((richBody.contents as { parts: unknown[] }[])[1].parts).toEqual([
      { functionResponse: { id: 'server-a', name: 'lookup', response: { ok: true, result: 'found' } } },
    ])
  })

  it('does not fabricate Gemini server IDs for legacy calls without IDs', async () => {
    const { body } = await roundTrip(provider('google', 'gemini-3.8-flash'), {
      text: '', traces: [], providerToolCalls: [{ name: 'lookup', arguments: {} }],
    })
    expect(JSON.stringify(body)).not.toContain('"id":')
    expect(JSON.stringify(body)).not.toContain('thoughtSignature')
  })

  it('round-trips independent Claude signed, omitted and redacted blocks', async () => {
    const blocks = [
      { type: 'thinking', thinking: 'first', signature: 'signature-a' },
      { type: 'thinking', thinking: '', signature: 'signature-b' },
      { type: 'redacted_thinking', data: 'opaque-redacted' },
    ]
    const { body } = await roundTrip(provider('anthropic', 'claude-sonnet-4-6'), {
      text: '', traces: [], providerContentBlocks: blocks,
      providerToolCalls: [{ id: 'tool-a', name: 'lookup', arguments: {} }],
    })
    const messages = body.messages as { role: string; content: unknown[] }[]
    expect(messages.find((message) => message.role === 'assistant')?.content).toEqual([
      ...blocks, { type: 'tool_use', id: 'tool-a', name: 'lookup', input: {} },
    ])
    expect(JSON.stringify(body)).not.toContain('__islemindAnthropicBlockIndex')
  })

  it('round-trips encrypted Responses reasoning and parallel same-name call identities', async () => {
    const reasoning = { type: 'reasoning', id: 'rs-a', encrypted_content: 'opaque-encrypted', summary: [{ type: 'summary_text', text: 'summary' }] }
    const { body } = await roundTrip(provider('openai', 'gpt-6-astra'), {
      text: '', traces: [], responseItems: [reasoning], providerToolCalls: [
        { id: 'fc-a', callId: 'call-a', name: 'lookup', arguments: { city: 'Taipei' } },
        { id: 'fc-b', callId: 'call-b', name: 'lookup', arguments: { city: 'Tokyo' } },
      ],
    })
    const input = body.input as Record<string, unknown>[]
    expect(input).toContainEqual(reasoning)
    expect(input.filter((item) => item.type === 'function_call')).toEqual([
      { type: 'function_call', id: 'fc-a', call_id: 'call-a', name: 'lookup', arguments: '{"city":"Taipei"}' },
      { type: 'function_call', id: 'fc-b', call_id: 'call-b', name: 'lookup', arguments: '{"city":"Tokyo"}' },
    ])
    expect(input.filter((item) => item.type === 'function_call_output')).toEqual([
      { type: 'function_call_output', call_id: 'call-b', output: 'result-call-b' },
      { type: 'function_call_output', call_id: 'call-a', output: 'result-call-a' },
    ])
  })

  it('preserves DeepSeek reasoning through a non-tool assistant turn', async () => {
    const reasoning = '  Exact reasoning\nincluding whitespace.  '
    const { body } = await roundTrip(provider('openai-compatible', 'deepseek-flash', 'deepseek'), {
      text: 'Answer', traces: [], reasoningContent: reasoning,
    })
    expect(body.messages).toContainEqual({ role: 'assistant', content: 'Answer', reasoning_content: reasoning })
  })

  describe.each(['plain', 'rich'] as const)('%s continuation integrity', (path) => {
    it('preserves empty signed blocks and exact whitespace in signed thinking', async () => {
      const blocks = [
        { type: 'thinking', thinking: '  summarized thinking\n ', signature: 'signature-a' },
        { type: 'thinking', thinking: '', signature: 'signature-b' },
        { type: 'redacted_thinking', data: 'opaque-redacted' },
      ]
      const { body } = await roundTrip(provider('anthropic', 'claude-sonnet-4-6'), {
        text: 'Answer', traces: [], providerContentBlocks: blocks,
      }, path)
      expect(body.messages).toContainEqual({ role: 'assistant', content: [...blocks, { type: 'text', text: 'Answer' }] })
    })

    it('preserves DeepSeek reasoning whitespace without shortening it', async () => {
      const reasoning = '  Exact reasoning\nincluding whitespace.  '
      const { body } = await roundTrip(provider('openai-compatible', 'deepseek-flash', 'deepseek'), {
        text: 'Answer', traces: [], reasoningContent: reasoning,
      }, path)
      expect(body.messages).toContainEqual({ role: 'assistant', content: 'Answer', reasoning_content: reasoning })
    })

    it('preserves encrypted data beyond the display-text limit within the existing core bounds', async () => {
      const reasoning = { type: 'reasoning', id: 'rs-large', encrypted_content: 'e'.repeat(300_000), summary: [{ type: 'summary_text', text: '  summary\n' }] }
      const { body } = await roundTrip(provider('openai', 'gpt-6-astra'), {
        text: '', traces: [], responseItems: [reasoning],
      }, path)
      const item = (body.input as Record<string, unknown>[]).find((entry) => entry.id === reasoning.id)!
      // Keep opaque payloads out of assertion diffs, even when this regresses.
      expect(item?.encrypted_content === reasoning.encrypted_content).toBe(true)
      expect(item?.summary).toEqual(reasoning.summary)
    })

    it.each([
      { providerContentBlocks: Array.from({ length: 33 }, (_, index) => ({ type: 'thinking', thinking: '', signature: `signature-${index}` })) },
      { providerContentBlocks: [{ type: 'thinking', thinking: 't'.repeat(262_145), signature: 'opaque' }] },
      { providerContentBlocks: [{ type: 'thinking', thinking: '', signature: 's'.repeat(262_145) }] },
      { responseItems: [{ type: 'reasoning', id: 'rs-overflow', encrypted_content: 'e'.repeat(1_048_577) }] },
      { responseItems: [{ type: 'reasoning', id: 'rs-summary', encrypted_content: 'opaque', summary: [{ type: 'summary_text', text: 's'.repeat(4_097) }] }] },
      { providerToolCalls: [{ name: 'lookup', id: 'server-a', arguments: {}, thoughtSignature: 's'.repeat(262_145) }] },
    ])('rejects oversized continuation rather than silently truncating it (%#)', async (fields) => {
      await expect(completionEvents(provider('anthropic', 'claude-sonnet-4-6'), { text: '', traces: [], ...fields }, path).then(() => undefined))
        .rejects.toThrow(/continuation/i)
    })
  })

  it('never emits partial continuation or tool events after a Rich validation failure', () => {
    const events: StreamEvent[] = []
    const reporter = createRichStreamEventReporter((event) => events.push(event), {
      binding: { providerId: 'google-replay', model: 'gemini-3.8-flash' },
    })
    expect(() => reporter.complete({
      text: '', traces: [], reasoningContent: 'valid', providerToolCalls: [
        { id: 'valid-call', name: 'lookup', arguments: {} },
        { id: 'invalid-call', name: 'lookup', arguments: {}, thoughtSignature: 's'.repeat(262_145) },
      ],
    })).toThrow(/continuation/i)
    expect(events).toEqual([])
  })
})
