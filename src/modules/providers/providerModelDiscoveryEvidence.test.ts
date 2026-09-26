import { describe, expect, it } from '@jest/globals'
import type { AIProvider } from '@/types/providerContracts'
import { createProviderModelDiscoveryAdapter, canApplyProviderModelDiscoveryAbsence } from './providerModelDiscoveryAdapter'
import { mapAnthropicModels, mapGoogleModels, mapOpenAICompatibleModels } from './providerModelDiscoveryMapping'
import { createProviderProbe } from './providerProbe'
import { projectProviderModelTestHealth } from './providerModelTestHealthProjection'
import type { ProviderModelDiscoveryOptions } from './providerModelDiscoveryAdapter'

const provider: AIProvider = { id: 'p', type: 'openai', name: 'Test', enabled: true, apiKey: 'test-only', apiKeySource: { kind: 'primary' }, baseUrl: 'https://api.openai.com/v1', models: [] }
const options: ProviderModelDiscoveryOptions = { timeoutMs: 1000, scope: { providerId: 'p', credentialSource: { kind: 'primary' }, protocolAdapterId: 'openai-chat', endpointVariant: 'direct' }, operation: { scopeId: 's', epoch: 'e', operationId: 'o', orderToken: 1, startedAt: 1 } }
function adapter(pages: unknown[], request?: (url: string, signal: AbortSignal) => Promise<Response>) {
  const urls: string[] = []
  return { urls, value: createProviderModelDiscoveryAdapter({
    configurationIssue: () => undefined, supportsModelList: () => true, isOpenAICompatible: () => true,
    resolveBaseUrl: (p) => p.baseUrl ?? '', resolveHeaders: () => ({}),
    request: async (url, init) => {
      urls.push(String(url))
      return request ? request(String(url), init?.signal!) : new Response(JSON.stringify(pages.shift()), { status: 200 })
    },
    readResponseText: (response) => response.text(), parseResponseJson: (text) => JSON.parse(text),
    mapOpenAICompatible: (json, p) => mapOpenAICompatibleModels(json as never, p.type),
    mapAnthropic: (json) => mapAnthropicModels(json as never), mapGoogle: (json) => mapGoogleModels(json as never),
  }) }
}

describe('discovered model output-limit evidence', () => {
  it('does not treat id-only discovery or context metadata as an output bound', () => {
    for (const model of [
      ...mapOpenAICompatibleModels({ data: [{ id: 'custom-no-output-metadata' }, { id: 'custom-context-only', context_window: 1000 }] }, 'openai-compatible'),
      ...mapAnthropicModels({ data: [{ id: 'custom-anthropic', max_input_tokens: 1000 }] }),
      ...mapGoogleModels({ models: [{ name: 'models/custom-google', inputTokenLimit: 1000, supportedGenerationMethods: ['generateContent'] }] }),
    ]) {
      expect(model.source).toBe('remote')
      expect(model.outputTokenLimit).toBeUndefined()
    }
  })

  it('preserves explicit raw limits before display values are clamped, for every discovery protocol', () => {
    for (const model of [
      ...mapOpenAICompatibleModels({ data: [{ id: 'custom-openai', context_window: 1000, max_output_tokens: 2000 }] }, 'openai-compatible'),
      ...mapAnthropicModels({ data: [{ id: 'custom-anthropic', max_input_tokens: 1000, max_tokens: 2000 }] }),
      ...mapGoogleModels({ models: [{ name: 'models/custom-google', inputTokenLimit: 1000, outputTokenLimit: 2000, supportedGenerationMethods: ['generateContent'] }] }),
    ]) {
      expect(model.maxOutputTokens).toBe(1000)
      expect(model.outputTokenLimit).toEqual({ tokens: 2000, source: 'provider' })
    }
  })

  it.each([0, -1, 1.5, Infinity, '4096 tokens', '4096.5', ''])('does not manufacture evidence from invalid metadata %p', (value) => {
    const [model] = mapOpenAICompatibleModels({ data: [{ id: 'custom-invalid-output', metadata: { max_output_tokens: value } }] }, 'openai-compatible')
    expect(model.outputTokenLimit).toBeUndefined()
  })

  it('parses complete numeric metadata rather than truncating exponent notation', () => {
    const [model] = mapOpenAICompatibleModels({ data: [{ id: 'custom-output', metadata: { max_output_tokens: '6e4' } }] }, 'openai-compatible')
    expect(model.outputTokenLimit).toEqual({ tokens: 60_000, source: 'provider' })
    expect(model.maxOutputTokens).toBe(32768)
  })
})

describe('qualified discovery evidence', () => {
  it('allows absence only for a valid, scoped and exhaustive official response', async () => {
    const result = await adapter([{ object: 'list', data: [] }]).value.discoverDetailed(provider, options)
    expect(canApplyProviderModelDiscoveryAbsence(result)).toBe(true)
    expect(canApplyProviderModelDiscoveryAbsence({ ...result, operation: undefined })).toBe(false)
    for (const body of [{ data: [] }, { object: 'list', data: [], truncated: true }, { object: 'list', data: [{ id: 'a' }], has_more: true }, { error: 'not a model list' }]) {
      expect(canApplyProviderModelDiscoveryAbsence(await adapter([body]).value.discoverDetailed(provider, options))).toBe(false)
    }
  })

  it('consumes Anthropic pages and rejects nonadvancing/circular cursors and malformed page envelopes', async () => {
    const p = { ...provider, type: 'anthropic' as const, baseUrl: 'https://api.anthropic.com/v1' }
    const successful = adapter([{ data: [{ id: 'a' }], has_more: true, last_id: 'a' }, { data: [{ id: 'b' }], has_more: false }])
    const result = await successful.value.discoverDetailed(p, options)
    expect(result.models.map((model) => model.id)).toEqual(['a', 'b'])
    expect(successful.urls[1]).toContain('after_id=a')
    expect(canApplyProviderModelDiscoveryAbsence(result)).toBe(true)
    for (const pages of [
      [{ data: [{ id: 'a' }], has_more: true, last_id: 'a' }, { data: [{ id: 'a' }], has_more: true, last_id: 'a' }],
      [{ data: [{ id: 'a' }], has_more: true, last_id: 'a' }, { data: [{ id: 'b' }], has_more: true, last_id: 'b' }, { data: [{ id: 'a' }], has_more: true, last_id: 'a' }],
      [{ data: [{ id: 'a' }], has_more: true, last_id: 'a' }, { data: null }],
    ]) {
      const partial = await adapter(pages).value.discoverDetailed(p, options)
      expect(partial.status).toBe('failure')
      expect(partial.completeness).toBe('partial')
      expect(canApplyProviderModelDiscoveryAbsence(partial)).toBe(false)
    }
  })

  it('keeps Google filtering, compatible endpoints, GitHub and MiMo from asserting missing access', async () => {
    const google = adapter([{ models: [{ name: 'models/embed' }], nextPageToken: 'next' }, { models: [{ name: 'models/chat', supportedGenerationMethods: ['generateContent'] }] }])
    const result = await google.value.discoverDetailed({ ...provider, type: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' }, options)
    expect(result.advertisedModelIds).toEqual(['embed', 'chat'])
    expect(result.models.map((m) => m.id)).toEqual(['chat'])
    expect(google.urls[1]).toContain('pageToken=next')
    expect(canApplyProviderModelDiscoveryAbsence(result)).toBe(false)
    for (const p of [
      { ...provider, baseUrl: 'https://gateway.example/v1' },
      { ...provider, type: 'openai-compatible' as const, presetId: 'github-models' as const, baseUrl: 'https://models.github.ai/inference' },
      { ...provider, type: 'xiaomi-mimo' as const, wireProtocol: 'anthropic-compatible' as const, baseUrl: 'https://api.xiaomimimo.com/anthropic' },
    ]) {
      const vendor = adapter([{ data: [] }])
      const evidence = await vendor.value.discoverDetailed(p, options)
      expect(evidence.authority).toBe('catalog-only')
      expect(canApplyProviderModelDiscoveryAbsence(evidence)).toBe(false)
      if (p.type === 'xiaomi-mimo') expect(vendor.urls[0]).toContain('/v1/models')
    }
  })

  it('covers response bodies with the whole-operation deadline and separates cancellation', async () => {
    let signal: AbortSignal | undefined
    const stalled = adapter([], async (_url, requestSignal) => {
      signal = requestSignal
      return { ok: true, text: () => new Promise<string>(() => {}) } as Response
    })
    const result = await stalled.value.discoverDetailed(provider, { ...options, timeoutMs: 10 })
    expect(result).toMatchObject({ status: 'failure', failureReason: 'timeout' })
    expect(signal?.aborted).toBe(true)
    const controller = new AbortController()
    controller.abort()
    expect((await adapter([]).value.discoverDetailed(provider, { ...options, signal: controller.signal })).status).toBe('cancelled')
  })

  it('keeps one deadline across pages, preserves successful page evidence, and never retires on HTTP errors', async () => {
    const paged = adapter([], async (url) => url.includes('after_id=')
      ? { ok: true, text: () => new Promise<string>(() => {}) } as Response
      : new Response(JSON.stringify({ data: [{ id: 'a' }], has_more: true, last_id: 'a' }), { status: 200 }))
    const result = await paged.value.discoverDetailed({ ...provider, type: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' }, { ...options, timeoutMs: 10 })
    expect(result).toMatchObject({ status: 'failure', completeness: 'partial', failureReason: 'timeout' })
    expect(result.advertisedModelIds).toEqual(['a'])
    expect(paged.urls).toHaveLength(2)
    for (const status of [401, 403, 404, 410, 429, 500, 503]) {
      const failed = await adapter([], async () => new Response('raw body must not be exported', { status })).value.discoverDetailed(provider, options)
      expect(failed.status).toBe('failure')
      expect(canApplyProviderModelDiscoveryAbsence(failed)).toBe(false)
      expect(JSON.stringify(failed)).not.toContain('raw body must not be exported')
    }
    const unsupported = adapter([])
    const notSupported = await unsupported.value.discoverDetailed({ ...provider, capabilities: { modelList: false } as AIProvider['capabilities'] }, options)
    expect(notSupported.status).toBe('unsupported')
    expect(unsupported.urls).toHaveLength(0)
  })

  it('never makes a legacy/partial listing absence into failed model access or credential health', async () => {
    const probe = createProviderProbe({ defaultTimeoutMs: 1000, resolveUpstreamModel: (_p, m) => m, configurationIssue: () => undefined,
      hostedIssue: () => undefined, supportsModelDiscovery: () => true, discoverModels: async () => [],
    })
    expect((await probe.probe({ provider, model: 'manual-model' })).modelAccess).toBe('unknown')
    expect(projectProviderModelTestHealth({ ok: false, code: 'model_unavailable' })).toEqual({ lastTestStatus: 'idle' })
    expect(projectProviderModelTestHealth({ ok: false, code: 'empty_models' })).toEqual({ lastTestStatus: 'idle' })
  })
})
