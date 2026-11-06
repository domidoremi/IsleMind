import { previewDraftContextCapacity } from './contextCapacityDraftRuntime'
import { projectContextCapacity, ASSISTANT_CONTEXT_PLAN_RECEIPT_SCHEMA } from '@/modules/assistant-runtime'
import { useSettingsStore } from '@/store/settingsStore'
import { getModelConfig } from '@/types/modelCatalog'
import { emitRuntimeEvent } from '@/services/runtimeEvents'
import { decideRemoteCompact } from './providerRemoteCompact'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'

jest.mock('@/services/runtimeEvents', () => ({ emitRuntimeEvent: jest.fn() }))
jest.mock('./providerRemoteCompact', () => {
  const actual = jest.requireActual('./providerRemoteCompact')
  return { ...actual, decideRemoteCompact: jest.fn(actual.decideRemoteCompact) }
})

const provider: AIProvider = {
  id: 'current-connection', name: 'Current connection', type: 'openai-compatible', wireProtocol: 'openai-compatible',
  presetId: 'custom-endpoint', baseUrl: 'https://context-fixture.invalid/v1', apiKey: '', enabled: true,
  models: ['small', 'large'], manualModels: ['small', 'large'],
  modelAliases: [{ alias: 'daily', model: 'small' }],
  modelConfigs: ['small', 'large'].map(id => ({
    ...getModelConfig(id, 'openai-compatible'), id, source: 'remote', contextWindow: id === 'small' ? 4096 : 32768,
    maxOutputTokens: 1024, defaultMaxTokens: 512, supportsTools: false,
  })),
}
const conversation: Conversation = {
  id: 'chat-context', title: 'Context fixture', providerId: provider.id, model: 'daily',
  systemPrompt: 'A private system instruction.', temperature: 1, maxTokens: 512, createdAt: 1, updatedAt: 1,
  messages: [
    { id: 'question', role: 'user', content: 'Earlier question.', timestamp: 1, status: 'done' },
    { id: 'answer', role: 'assistant', content: 'Earlier answer.', responseText: 'Visible answer.', timestamp: 2, status: 'done' },
  ],
}
const settings = { ...useSettingsStore.getState().settings, language: 'en' as const, remoteCompactMode: 'off' as const }
const draft = { ready: true, text: 'Current private draft.', attachmentCount: 0 }

function preview(overrides: Partial<Parameters<typeof previewDraftContextCapacity>[0]> = {}) {
  return previewDraftContextCapacity({ conversation, provider, settings, draft, capturedAt: 100, ...overrides })
}

beforeEach(() => jest.clearAllMocks())

it('uses the current requested alias, upstream model, budget and committed draft without changing the recorded plan', () => {
  const historical = projectContextCapacity({
    runId: 'historical-run', capturedAt: 10,
    receipt: {
      schema: ASSISTANT_CONTEXT_PLAN_RECEIPT_SCHEMA, providerId: 'historical-provider', model: 'historical-model',
      budget: { modelContextWindow: 128000, requestBudgetTokens: 80000, contextPromptTokens: 0, estimatedInputTokens: 20, fixedTokens: 10, messageTokens: 20, includedFragmentTokens: 30, originalFragmentTokens: 30, totalTokenCap: 80000, activeContextTokens: 30, tokensUntilCompaction: 79970 },
      compression: { triggered: false, strategy: 'none', triggerReason: 'disabled_or_unneeded', sourceMessageCount: 0, keptMessageCount: 0, sourceTokens: 0, compressedTokens: 0, estimatedSavedTokens: 0, compressionRatio: 0, summaryTokens: 0, summarySectionCount: 0 },
      sourceManifest: [], failureCodes: [],
    },
  })
  const frozenHistory = JSON.stringify(historical)
  const before = JSON.stringify({ conversation, provider, settings, draft })
  const first = preview()
  expect(first.kind).toBe('ready')
  if (first.kind !== 'ready') throw new Error('Expected a preview')
  expect(first.requestedModel).toBe('daily')
  expect(first.view).toMatchObject({ providerId: provider.id, model: 'small', contextWindowTokens: 4096, capturedAt: 100, measurement: 'estimated' })
  const changed = preview({ conversation: { ...conversation, model: 'large' }, draft: { ...draft, text: 'More draft text. '.repeat(100) } })
  if (changed.kind !== 'ready') throw new Error('Expected a preview')
  expect(changed.view.contextWindowTokens).toBe(32768)
  expect(changed.view.usedTokens).toBeGreaterThan(first.view.usedTokens)
  expect(JSON.stringify(historical)).toBe(frozenHistory)
  expect(JSON.stringify({ conversation, provider, settings, draft })).toBe(before)
  expect(emitRuntimeEvent).not.toHaveBeenCalled()
})

it('preserves an unknown model window instead of filling in the last request window', () => {
  const unknown = { ...provider, modelConfigs: provider.modelConfigs!.map(config => ({ ...config, contextWindow: 0 })) }
  const result = preview({ provider: unknown })
  expect(result.kind).toBe('ready')
  if (result.kind !== 'ready') throw new Error('Expected a preview')
  expect(result.view.status).toBe('unmeasured')
  expect(result.view.contextWindowTokens).toBe(0)
  expect(result.view.failureCodes).not.toContain('context_budget_overrun')
})

it('does not present an inferred provider-family default as a confirmed model window', () => {
  const result = preview({ provider: { ...provider, modelConfigs: [] } })
  if (result.kind !== 'ready') throw new Error('Expected a preview')
  expect(result.view.status).toBe('unmeasured')
  expect(result.view.contextWindowTokens).toBe(0)
  expect(result.view.usedRatio).toBe(0)
  expect(result.view.failureCodes).not.toContain('context_budget_overrun')
})

it.each(['openai', 'openai-compatible'] as const)('plans the selected %s Responses protocol without executing remote compaction', type => {
  const responsesProvider: AIProvider = {
    ...provider, type,
    capabilities: {
      chat: true, streaming: true, modelList: true, vision: false, files: false,
      audioInput: false, audioTranscription: false, speech: false, nativeSearch: false,
      reasoningEffort: false, topP: true, responsesApi: true,
    },
    modelConfigs: provider.modelConfigs!.map(config => ({ ...config, preferredEndpoint: 'responses' })),
  }
  expect(preview({ provider: responsesProvider }).kind).toBe('ready')
  expect(decideRemoteCompact).toHaveBeenCalledWith(expect.objectContaining({ usesOpenAIResponses: true }))
  expect(emitRuntimeEvent).not.toHaveBeenCalled()
})

it('keeps attachment cost unmeasured and returns no draft, message, system or attachment bodies', () => {
  const result = preview({ draft: { ...draft, attachmentCount: 2 } })
  if (result.kind !== 'ready') throw new Error('Expected a preview')
  expect(result.view.segments.find(segment => segment.type === 'attachments')).toMatchObject({ tokens: 0, unmeasuredSourceCount: 2 })
  const encoded = JSON.stringify(result)
  for (const secret of [conversation.systemPrompt, draft.text, 'Earlier question.', 'Visible answer.']) {
    expect(encoded).not.toContain(secret)
  }
  expect(emitRuntimeEvent).not.toHaveBeenCalled()
})

it('honors the conversation threshold while leaving global settings and historical sources untouched', () => {
  const result = preview({ conversation: { ...conversation, contextPolicyOverride: { schema: 'islemind.conversation-context-policy.v1', remoteCompactThreshold: 0.65 } } })
  if (result.kind !== 'ready') throw new Error('Expected a preview')
  expect(result.view.contextPolicy).toMatchObject({ threshold: 0.65, source: 'conversation' })
  expect(settings.remoteCompactThreshold).not.toBe(0.65)
})

it.each(['streaming', 'sending'] as const)('declines to estimate during an active %s response', status => {
  expect(preview({ conversation: { ...conversation, messages: [...conversation.messages, { id: 'active', role: 'assistant', content: 'In progress', status, timestamp: 3 }] } })).toEqual({ kind: 'draft-busy' })
})

it('requires a loaded draft and the exact current connection', () => {
  expect(preview({ draft: undefined })).toEqual({ kind: 'draft-unavailable' })
  expect(preview({ draft: { ...draft, ready: false } })).toEqual({ kind: 'draft-unavailable' })
  expect(preview({ provider: undefined })).toEqual({ kind: 'draft-unbound' })
  expect(preview({ provider: { ...provider, id: 'another-connection' } })).toEqual({ kind: 'draft-unbound' })
})
