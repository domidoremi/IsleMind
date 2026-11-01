import type { AIProvider } from '@/types/providerContracts'
import { getProviderConfigIssue } from '@/types/providerBaseUrls'
import { isChatReasoningReplay } from '@/core'
import { findProviderCompatibilityLiveSmokeGaps, getProviderCompatibilityEvidence, getProviderCompatibilityLiveSmokeGates, resolveProviderCompatibilityCapabilitySendPolicy, resolveProviderCompatibilityCapabilityStatus } from './providerCompatibilityCatalog'
import { createProviderMediaAdapter, type ProviderAudioTranscriptionInput } from './providerMediaAdapter'
import { extractGoogleReplayContentParts, extractOpenAIResponseReplayItems } from './providerReplay'
import { createProviderStreamParsingPolicy } from './providerStreamParsing'
import { extractUsage } from './providerUsage'
import { providerRequestHasRouteBoundContinuation } from './providerRuntimeFallback'
import { createProviderFallbackCandidateBuilder } from './providerFallbackCandidates'
import { createProviderRegistry, DEFAULT_PROVIDER_CAPABILITIES } from './providerRegistry'

const parser = createProviderStreamParsingPolicy({
  translate: (key) => key,
  createTrace: (type, _provider, title, content, status, id) => ({ type, title, content, status, id }),
  summarizeToolEvent: () => '',
})
const sse = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`

// Dated primary sources and receipt hashes are in provider-official-docs-review.json.
describe('official Responses reasoning-item completion', () => {
  const added = {
    type: 'response.output_item.added', output_index: 0,
    item: { id: 'rs-official', type: 'reasoning', status: 'in_progress', encrypted_content: 'unfinished-ciphertext', summary: [] },
  }
  const done = {
    type: 'response.output_item.done', output_index: 0,
    item: { id: 'rs-official', type: 'reasoning', status: 'completed', encrypted_content: 'complete-ciphertext', summary: [] },
  }

  it('does not expose in-progress ciphertext as reusable provider state', () => {
    expect(extractOpenAIResponseReplayItems(added)).toBeUndefined()
    expect(parser.parseProviderStreamEvent(added, 'openai').responseItems).toBeUndefined()
  })

  it('replays the completed item exactly, including when reasoning display is off', () => {
    expect(parser.parseProviderStreamChunk(sse(added) + sse(done), 'openai', { includeReasoning: false }).responseItems).toEqual([done.item])
  })

  it('cannot retain an unfinished encrypted field when the completed item omits it', () => {
    const finalItem = { id: 'rs-official', type: 'reasoning', status: 'completed', summary: [] }
    expect(parser.parseProviderStreamChunk(sse(added) + sse({ ...done, item: finalItem }), 'openai').responseItems).toEqual([finalItem])
  })

  it('does not erase completed ciphertext when a later final snapshot omits the optional field', () => {
    const snapshot = { ...done.item }
    delete (snapshot as Partial<typeof done.item>).encrypted_content
    const completed = { type: 'response.completed', response: { output: [snapshot] } }
    expect(parser.parseProviderStreamChunk(sse(added) + sse(done) + sse(completed), 'openai').responseItems).toEqual([done.item])
  })

  it('keeps canonical non-streaming reasoning and function-call items', () => {
    const call = { type: 'function_call', id: 'fc-official', call_id: 'call-official', name: 'lookup', arguments: '{}' }
    expect(extractOpenAIResponseReplayItems({ output: [done.item, call] })).toEqual([done.item, call])
  })
})

describe('official Gemini signed-part and continuation behavior', () => {
  const parts = [
    { text: '  exact thought\n', thought: true, thoughtSignature: 'signed-thought' },
    { text: 'Answer ' },
    { functionCall: { id: 'google-a', name: 'lookup', args: { city: 'Taipei' } }, thoughtSignature: 'signed-first-call' },
    { functionCall: { id: 'google-b', name: 'lookup', args: { city: 'Tokyo' } } },
    { text: '', thoughtSignature: 'late-empty-part-signature' },
  ]

  it.each([true, false])('retains every part in order independently of reasoning display: %s', (includeReasoning) => {
    const events = [
      { candidates: [{ content: { role: 'model', parts: parts.slice(0, 2) } }] },
      { candidates: [{ content: { role: 'model', parts: parts.slice(2, 4) } }] },
      { candidates: [{ content: { role: 'model', parts: parts.slice(4) }, finishReason: 'STOP' }] },
    ]
    expect(parser.parseProviderStreamChunk(events.map(sse).join(''), 'google', { includeReasoning })).toMatchObject({
      text: 'Answer ',
      googleContentParts: parts,
      streamOutcome: { status: 'completed' },
    })
  })

  it('keeps a signature-only final part even when no function is called', () => {
    const response = { candidates: [{ content: { parts: [{ text: 'Answer' }, parts[4]] }, finishReason: 'STOP' }] }
    expect(parser.parseProviderStreamChunk(JSON.stringify(response), 'google', { includeReasoning: false })).toMatchObject({
      text: 'Answer', googleContentParts: response.candidates[0].content.parts,
    })
  })

  it('does not silently discard malformed parts from a signed replay envelope', () => {
    for (const invalid of [null, 'unexpected', ['nested-array']]) {
      expect(extractGoogleReplayContentParts({
        candidates: [{ content: { parts: [parts[0], invalid, parts[4]] } }],
      })).toBeUndefined()
    }
  })

  it('does not promote CONTINUATION to final success or lose authoritative thinking-only usage', () => {
    const response = {
      candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'CONTINUATION', continuationToken: 'synthetic-not-a-provider-token' }],
      usageMetadata: { promptTokenCount: 142, candidatesTokenCount: 0, thoughtsTokenCount: 32768, totalTokenCount: 32910 },
    }
    expect(parser.parseProviderStreamChunk(sse(response), 'google')).toMatchObject({
      text: '', terminal: true, streamOutcome: { status: 'incomplete', reason: 'CONTINUATION' },
      usage: { inputTokens: 142, outputTokens: 0, reasoningTokens: 32768, totalTokens: 32910, source: 'provider' },
    })
  })

  it('uses the last cumulative usage value within one stream rather than summing snapshots', () => {
    const usage = (count: number) => ({ usageMetadata: { promptTokenCount: 2, candidatesTokenCount: count, totalTokenCount: count + 2 } })
    expect(parser.parseProviderStreamChunk(sse(usage(3)) + sse(usage(5)), 'google').usage?.outputTokens).toBe(5)
  })

  it('keeps Google native replay in the existing bounded, plain-data canonical envelope', () => {
    expect(isChatReasoningReplay([{ kind: 'google-content', data: JSON.stringify(parts) }])).toBe(true)
    for (const data of ['null', '{}', '[null]', 'not-json', JSON.stringify([{ text: 'x'.repeat(1_048_576) }])]) {
      expect(isChatReasoningReplay([{ kind: 'google-content', data }])).toBe(false)
    }
  })

  it('does not authorize route changes merely because a signed text reply has no tool calls', () => {
    expect(providerRequestHasRouteBoundContinuation({
      provider: { id: 'g', type: 'google', name: 'Google', apiKey: '', enabled: true, models: [] }, model: 'gemini-3.8-flash',
      messages: [{ googleContentParts: [{ text: '', thoughtSignature: 'signature-late' }] }],
    })).toBe(true)
  })
})

it('does not mistake Anthropic estimated thinking tokens for authoritative usage', () => {
  expect(extractUsage({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '', estimated_tokens: 5000 } }, 'anthropic')).toBeUndefined()
  expect(extractUsage({ type: 'message_delta', usage: { output_tokens: 7 } }, 'anthropic')).toMatchObject({
    outputTokens: 7, source: 'provider',
  })
})

describe('official Cohere transcription request requirements', () => {
  const provider: AIProvider = {
    id: 'cohere-official', type: 'openai-compatible', presetId: 'cohere', name: 'Cohere',
    baseUrl: 'https://api.cohere.ai/compatibility/v1', apiKey: 'synthetic-test-only', models: [], enabled: true,
    capabilities: { chat: true, streaming: true, modelList: false, vision: false, files: false, audioInput: false,
      audioTranscription: true, speech: false, nativeSearch: false, reasoningEffort: true, topP: true },
  }
  const request = jest.fn(async (_url: RequestInfo | URL, _init: RequestInit | undefined) => new Response('{"text":"Synthetic transcript"}', { status: 200 }))
  const adapter = createProviderMediaAdapter({
    selectProvider: (value) => value, validateConfiguration: () => undefined, supportsAudio: () => true,
    request, timeoutMs: 1000, resolveBaseUrl: (value) => value.baseUrl!, resolveHeaders: () => ({ 'Content-Type': 'application/json' }),
  })
  const input: ProviderAudioTranscriptionInput & { language?: string } = {
    provider, model: 'cohere-transcribe-03-2026', language: 'en', mimeType: 'audio/wav', fileName: 'synthetic.wav', audioBase64: 'dGVzdA==',
  }
  const originalFormData = global.FormData
  class SyntheticFormData {
    readonly fields: [string, unknown][] = []
    append(name: string, value: unknown) { this.fields.push([name, value]) }
  }

  beforeAll(() => { global.FormData = SyntheticFormData as unknown as typeof FormData })
  afterAll(() => { global.FormData = originalFormData })
  beforeEach(() => { request.mockClear() })

  it.each([undefined, '', '   '])('requires an explicit nonempty language before dispatch: %j', async (language) => {
    await expect(adapter.transcribe({ ...input, language })).rejects.toThrow('audio_transcription_language_required')
    expect(request).not.toHaveBeenCalled()
  })

  it('does not invent OpenAI whisper-1 as the Cohere transcription model', async () => {
    await expect(adapter.transcribe({ ...input, model: undefined })).rejects.toThrow('audio_transcription_model_required')
    expect(request).not.toHaveBeenCalled()
  })

  it.each(['audio/mp4', 'audio/x-m4a', 'audio/webm'])('rejects the documented unsupported %s input before dispatch', async (mimeType) => {
    await expect(adapter.transcribe({ ...input, mimeType })).rejects.toThrow('audio_transcription_format_unavailable')
    expect(request).not.toHaveBeenCalled()
  })

  it('sends the required language, JSON format and file as the last form field', async () => {
    await expect(adapter.transcribe(input)).resolves.toBe('Synthetic transcript')
    const form = request.mock.calls[0][1]?.body as unknown as SyntheticFormData
    expect(form.fields.map(([name]) => name)).toEqual(['model', 'language', 'response_format', 'file'])
    expect(form.fields[1]).toEqual(['language', 'en'])
    expect(form.fields[2]).toEqual(['response_format', 'json'])
    expect(request.mock.calls[0][0]).toBe('https://api.cohere.ai/compatibility/v1/audio/transcriptions')
    expect(request.mock.calls[0][1]?.headers).toEqual({})
  })

  it('does not impose Cohere-only language and model requirements on OpenAI', async () => {
    await expect(adapter.transcribe({ ...input, provider: { ...provider, type: 'openai', presetId: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' }, model: undefined, language: undefined })).resolves.toBe('Synthetic transcript')
    const form = request.mock.calls[0][1]?.body as unknown as SyntheticFormData
    expect(form.fields[0]).toEqual(['model', 'whisper-1'])
    expect(form.fields.map(([name]) => name)).toEqual(['model', 'file'])
  })

  it('does not turn a display name into Cohere-specific parameter evidence', async () => {
    await expect(adapter.transcribe({ ...input, provider: { ...provider, presetId: 'custom-endpoint', name: 'Cohere proxy label', baseUrl: 'https://example.test/v1' }, model: undefined, language: undefined })).resolves.toBe('Synthetic transcript')
  })
})

describe('official GitHub Models service retirement', () => {
  it.each(['https://models.github.ai/inference', 'https://MODELS.GITHUB.AI/inference/chat/completions/', 'http://models.github.ai/inference'])(
    'blocks the retired official endpoint before key use: %s', (baseUrl) => {
      expect(getProviderConfigIssue({ type: 'openai-compatible', baseUrl })).toMatchObject({
        code: 'endpoint_unavailable', messageKey: 'providerIssue.githubModelsRetired',
      })
    },
  )

  it.each(['https://models.github.ai.example.test/inference', 'https://example.test/models.github.ai/inference', 'https://api.github.com'])(
    'does not infer service retirement from an arbitrary URL string: %s', (baseUrl) => {
      expect(getProviderConfigIssue({ type: 'openai-compatible', baseUrl })).toBeNull()
    },
  )

  it('does not continue advertising the retired API as a conformance-ready service', () => {
    const evidence = getProviderCompatibilityEvidence('github-models')
    expect(evidence.auditState).toBe('docs-mapped')
    expect(evidence.officialDocs).toContain('https://docs.github.com/en/github-models')
    expect(evidence.notes).toMatch(/retired.*2026-07-30/i)
    for (const capability of ['chat', 'streaming', 'tools', 'modelList'] as const) {
      expect(resolveProviderCompatibilityCapabilityStatus('github-models', capability)).toBe('unsupported')
    }
  })

  it('does not advertise a retired service as a missing-credentials live-smoke opportunity', () => {
    expect(getProviderCompatibilityLiveSmokeGates('github-models')).toEqual([])
    expect(findProviderCompatibilityLiveSmokeGaps(['github-models'])).toEqual([])
  })

  it.each(['chat', 'streaming', 'tools', 'vision', 'files', 'reasoning', 'nativeSearch', 'modelList', 'responsesApi', 'remoteCompact', 'audio'] as const)(
    'does not revive retired %s capability through manual declarations or old model metadata', (behavior) => {
      expect(resolveProviderCompatibilityCapabilitySendPolicy({
        type: 'openai-compatible', presetId: 'github-models',
      }, behavior, true)).toMatchObject({ allowed: false, sendSource: 'blocked' })
    },
  )

  it('does not probe a known-retired endpoint during provider detection', async () => {
    const fetch = jest.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    const registry = createProviderRegistry({
      translate: (key) => key,
      configurationIssue: (baseUrl, apiKey) => getProviderConfigIssue({ type: 'openai-compatible', baseUrl }, apiKey),
      resolveModelAccess: () => ({ allowed: true }),
      fetch,
    })
    expect(await registry.probeProviderPreset({
      baseUrl: 'https://models.github.ai/inference', apiKey: 'synthetic-test-only',
    })).toMatchObject({ ok: false, reason: 'providerIssue.githubModelsRetired' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not rank a saved, enabled retired service as a text fallback', () => {
    const projectModel = jest.fn((_provider, model: string) => ({
      deprecated: false, upstreamModel: model, capabilities: ['text'],
    }))
    const provider: AIProvider = {
      id: 'saved-retired-provider', type: 'openai-compatible', presetId: 'github-models',
      name: 'Saved GitHub', baseUrl: 'https://models.github.ai/inference',
      enabled: true, models: ['historical-model'], apiKey: 'synthetic-test-only',
      capabilities: { ...DEFAULT_PROVIDER_CAPABILITIES, chat: true, streaming: true },
    }
    const result = createProviderFallbackCandidateBuilder({ projectModel })({
      providers: [provider], original: { providerId: 'active-provider', model: 'active-model' },
      requiredCapabilities: ['text'],
    })
    expect(result.candidates).toEqual([])
    expect(result.rejectedCandidates).toEqual([{ providerId: provider.id, reason: 'provider_retired' }])
    expect(projectModel).not.toHaveBeenCalled()
  })
})

it('keeps working Sonar sync/streaming separate from the retired async surface', () => {
  const evidence = getProviderCompatibilityEvidence('perplexity')
  expect(evidence.endpointFamilies).toEqual(['/v1/sonar'])
  expect(evidence.serviceLifecycle).toBeUndefined()
  expect(evidence.serviceMigration).toMatchObject({
    effectiveDate: '2026-09-27',
    sourceUrl: 'https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview.md',
    reviewedAt: '2026-10-31',
  })
  expect(resolveProviderCompatibilityCapabilityStatus('perplexity', 'chat')).toBe('supported')
  expect(resolveProviderCompatibilityCapabilityStatus('perplexity', 'streaming')).toBe('supported')
})
