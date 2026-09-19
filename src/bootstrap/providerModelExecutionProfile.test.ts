import { resolveProviderModelExecutionProfile } from './providerModelExecutionProfile'
import { resolveProviderProtocolAdapter } from './providerRequestBinding'
import { getConversationReasoningEffortOptions } from './providerConversationGeneration'
import { buildProviderFallbackCandidates } from './providerFallbackCandidates'
import type { AIProvider } from '@/types/providerContracts'
import type { ProviderRuntimeChatRequest } from '@/modules/providers'
import { providerRequestSerializer } from './providerRequestBinding'

const provider: AIProvider = {
  id: 'profile-test', name: 'Profile test', type: 'openai', enabled: true,
  apiKey: 'synthetic-not-for-projection', baseUrl: 'https://example.invalid/v1',
  models: ['gpt-4o-mini', 'gpt-5.2'],
  modelAliases: [{ alias: 'reasoner', model: 'gpt-5.2' }],
  capabilities: { chat: true, streaming: true, reasoningEffort: true, responsesApi: true, modelList: true,
    vision: true, files: true, audioInput: false, audioTranscription: false, speech: false, nativeSearch: true, topP: true },
}

it('resolves alias metadata before defaults/admission, without changing provider or model identity', () => {
  const before = JSON.stringify(provider)
  const profile = resolveProviderModelExecutionProfile({ provider, model: 'reasoner' })
  expect(profile.providerId).toBe(provider.id)
  expect(profile.selectedModel).toBe('reasoner')
  expect(profile.upstreamModel).toBe('gpt-5.2')
  expect(profile.modelConfig.id).toBe('gpt-5.2')
  expect(profile.manifest.reasoning.selectableEfforts).toEqual(getConversationReasoningEffortOptions(provider, 'reasoner'))
  expect(JSON.stringify(profile)).not.toContain(provider.apiKey)
  expect(JSON.stringify(provider)).toBe(before)
})

it.each(['gpt-4o-mini', 'gpt-5.2'])('uses the dispatch adapter selector for %s', model => {
  const request = { provider, model } as ProviderRuntimeChatRequest
  expect(resolveProviderModelExecutionProfile(request).adapter.id).toBe(resolveProviderProtocolAdapter(request).id)
})

it('resolves request-dependent routing without changing a model-wide preference', () => {
  const base = resolveProviderModelExecutionProfile({ provider, model: 'gpt-4o-mini' })
  const search = resolveProviderModelExecutionProfile({ provider, model: 'gpt-4o-mini', webSearchMode: 'native' })
  expect(base.adapter.bodyTarget).toBe('openai-chat')
  expect(search.adapter.bodyTarget).toBe('openai-responses')
  expect(base.modelConfig.preferredEndpoint).not.toBe('responses')
})

it('keeps explicit provider restrictions consistent across controls and admission', () => {
  const restricted: AIProvider = { ...provider, type: 'openai-compatible', capabilities: { ...provider.capabilities!, reasoningEffort: false },
    lastModelSyncStatus: 'ok', modelConfigs: [{ id: 'gpt-5.2', name: 'Remote reasoning', provider: 'openai-compatible',
      contextWindow: 32768, maxTokens: 32768, maxOutputTokens: 4096, defaultMaxTokens: 1024,
      supportsVision: false, supportsFiles: false, source: 'remote', chatCompatible: true,
      reasoningMode: 'openai-effort', reasoningEfforts: ['low', 'high'] }] }
  const profile = resolveProviderModelExecutionProfile({ provider: restricted, model: 'reasoner' })
  expect(profile.capabilities).not.toContain('reasoning')
  expect(profile.manifest.reasoning.selectableEfforts).toEqual([])
  expect(getConversationReasoningEffortOptions(restricted, 'reasoner')).toEqual([])
  const candidates = buildProviderFallbackCandidates({ providers: [restricted], original: { providerId: restricted.id, model: 'reasoner' }, requiredCapabilities: ['reasoning'] })
  expect(candidates.candidates).toHaveLength(0)
})

it('uses the serialized Responses protocol for attachment-dependent conformance', () => {
  const request: ProviderRuntimeChatRequest = { provider, model: 'gpt-4o-mini', messages: [], generationParameterSources: {},
    attachments: [{ id: 'file', type: 'text', name: 'test.txt', uri: 'data:text/plain;base64,dGVzdA==', mimeType: 'text/plain', size: 4 }],
  }
  const profile = resolveProviderModelExecutionProfile(request)
  expect(profile.adapter.bodyTarget).toBe('openai-responses')
  expect(profile.manifest.protocol).toBe('openai-responses')
  expect(providerRequestSerializer.serialize(request).conformance.manifest.protocol).toBe('openai-responses')
})

it('does not admit OpenAI built-in search for a Gemini-compatible route', () => {
  const relay: AIProvider = { ...provider, type: 'openai-compatible', models: ['gemini-2.5-pro'], modelAliases: [],
    modelConfigs: [{ id: 'gemini-2.5-pro', name: 'Gemini', provider: 'openai-compatible', source: 'remote',
      contextWindow: 32768, maxTokens: 32768, maxOutputTokens: 4096, defaultMaxTokens: 1024,
      supportsVision: true, supportsFiles: false, chatCompatible: true, preferredEndpoint: 'responses' }] }
  expect(resolveProviderModelExecutionProfile({ provider: relay, model: 'gemini-2.5-pro' }).capabilities).not.toContain('native_search')
})

it('serializes aliases with upstream identity while retaining the requested model in routing', () => {
  const request: ProviderRuntimeChatRequest = { provider, model: 'reasoner', messages: [{ role: 'user', content: 'hello' }], generationParameterSources: {} }
  const before = JSON.stringify(request)
  const profile = resolveProviderModelExecutionProfile(request)
  const serialized = providerRequestSerializer.serialize(request)
  expect(resolveProviderProtocolAdapter(request).id).toBe(profile.adapter.id)
  expect(serialized.body.model).toBe('gpt-5.2')
  expect(serialized.conformance.manifest.model).toBe('gpt-5.2')
  expect(serialized.conformance.manifest.protocol).toBe(profile.manifest.protocol)
  expect(JSON.stringify(request)).toBe(before)
})

it.each([false, true])('resolves overlapping aliases once for a prepared request: %s', prepared => {
  const aliasedProvider: AIProvider = { ...provider, modelAliases: [
    { alias: 'fast', model: 'gpt-4o-mini' },
    { alias: 'gpt-4o-mini', model: 'gpt-5.2' },
  ] }
  const request: ProviderRuntimeChatRequest = {
    provider: aliasedProvider, model: prepared ? 'gpt-4o-mini' : 'fast',
    ...(prepared ? { requestedModel: 'fast' } : {}),
    messages: [{ role: 'user', content: 'hello' }], generationParameterSources: {},
  }
  const before = JSON.stringify(request)
  const profile = resolveProviderModelExecutionProfile(request)
  const serialized = providerRequestSerializer.serialize(request)
  expect(profile.selectedModel).toBe('fast')
  expect(profile.upstreamModel).toBe('gpt-4o-mini')
  expect(profile.adapter.bodyTarget).toBe('openai-chat')
  expect(resolveProviderProtocolAdapter(request).id).toBe(profile.adapter.id)
  expect(serialized.body.model).toBe('gpt-4o-mini')
  expect(serialized.conformance.manifest.model).toBe('gpt-4o-mini')
  expect(serialized.decision.selectedModel).toBe('gpt-4o-mini')
  expect(getConversationReasoningEffortOptions(aliasedProvider, 'fast')).toEqual([])
  expect(JSON.stringify(request)).toBe(before)
})
