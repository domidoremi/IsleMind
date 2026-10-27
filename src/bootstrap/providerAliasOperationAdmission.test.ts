import { CHAT_REQUEST_SCHEMA, type ChatRequest } from '@/core'
import { createModelOperationCatalogSnapshot, formatTaggedModelOperationPrompt } from '@/modules/integrations'
import { getModelConfig } from '@/types/modelCatalog'
import type { AIProvider } from '@/types/providerContracts'
import { createConversationModelOperationSession, type ConversationModelOperationSessionDependencies } from './conversationModelOperationRuntime'
import { toRuntimeChatRequest } from './providerRuntime'

function fixture(supportsTools: boolean, responses = false) {
  const upstream = 'reviewed-upstream'
  const alias = 'reviewed-alias'
  const provider = {
    id: 'provider', name: 'Reviewed', type: 'openai', enabled: true, apiKey: 'synthetic',
    baseUrl: 'https://example.invalid/v1', models: [upstream],
    capabilities: { chat: true, nativeTools: true },
    modelAliases: [{ alias, model: upstream }],
    modelConfigs: [{ ...getModelConfig('gpt-4o', 'openai'), id: upstream, supportsTools,
      preferredEndpoint: responses ? 'responses' : 'chat-completions' }],
  } as AIProvider
  const created = createModelOperationCatalogSnapshot([{
    id: 'builtin:fixture:read', name: 'read', description: 'Read bounded evidence', permission: 'read-only',
    requiresConfirmation: false, capabilityScopes: ['source:builtin', 'permission:read-only'],
    inputSchema: { type: 'object', properties: { target: { type: 'string' } } },
    executor: { kind: 'builtin', id: 'builtin:fixture:read' }, availability: { status: 'available' },
  }])
  if (!created.ok) throw new Error(created.message)
  const tagged = formatTaggedModelOperationPrompt(created.snapshot)
  if (!tagged.ok) throw new Error(tagged.message)
  const catalog = { snapshot: created.snapshot, taggedPrompt: tagged.prompt, manifests: [] }
  const dependencies = {
    createCatalog: async () => ({ ok: true, catalog }), createRagRuntime: jest.fn(async () => ({})),
    executeExternal: jest.fn(), executeInternal: jest.fn(), declinePendingTask: jest.fn(), now: () => 1,
  } as unknown as ConversationModelOperationSessionDependencies
  const request: ChatRequest = {
    schema: CHAT_REQUEST_SCHEMA, conversationId: 'conversation', providerId: provider.id,
    model: alias, messages: [], systemPrompt: 'Answer from evidence', generationParameterSources: {},
    toolDefinitions: [{ operationId: 'builtin:fixture:read', name: 'read', description: 'Read bounded evidence',
      permission: 'read-only', inputSchema: { type: 'object' } }],
  }
  return { provider, alias, upstream, request, catalog, dependencies }
}

it('uses the reviewed alias upstream tool capability when preparing a canonical operation session', async () => {
  const f = fixture(false)
  const session = (await createConversationModelOperationSession({
    provider: f.provider, conversation: { id: 'conversation', providerId: f.provider.id, model: f.alias, messages: [] },
    settings: {}, signal: new AbortController().signal,
  } as unknown as Parameters<typeof createConversationModelOperationSession>[0], f.dependencies))!
  expect(session.prepareRequest(f.request).systemPrompt).toContain(f.catalog.taggedPrompt)
  expect(f.dependencies.executeExternal).not.toHaveBeenCalled()
})

it('does not invent native tools for an alias whose reviewed upstream explicitly disables them', () => {
  const f = fixture(false)
  const request = toRuntimeChatRequest({ provider: f.provider }, f.request)
  expect(request.providerToolDeclarations).toBeUndefined()
  expect(request.model).toBe(f.alias)
  expect(request.requestedModel).toBe(f.alias)
})

it('uses the reviewed upstream Responses declaration shape without rewriting the user alias', () => {
  const f = fixture(true, true)
  const request = toRuntimeChatRequest({ provider: f.provider }, f.request)
  expect(request.providerToolDeclarations).toHaveLength(1)
  expect(request.providerToolDeclarations![0]).toMatchObject({ type: 'function', name: 'read' })
  expect(request.providerToolDeclarations![0]).not.toHaveProperty('function')
  expect(request.model).toBe(f.alias)
  expect(request.requestedModel).toBe(f.alias)
})

it('keeps direct reviewed models and ordinary supported aliases eligible for native tools', () => {
  const f = fixture(true)
  const alias = toRuntimeChatRequest({ provider: f.provider }, f.request)
  const direct = toRuntimeChatRequest({ provider: f.provider }, { ...f.request, model: f.upstream })
  expect(alias.providerToolDeclarations).toEqual(direct.providerToolDeclarations)
  expect(alias.providerToolDeclarations).toHaveLength(1)
})

it.each([
  ['openai', false, undefined, 'chat'],
  ['openai', true, undefined, 'responses'],
  ['openai-compatible', false, undefined, 'chat'],
  ['openai-compatible', true, undefined, 'responses'],
  ['openai-compatible', false, 'anthropic-compatible', 'anthropic'],
  ['anthropic', false, undefined, 'anthropic'],
  ['google', false, undefined, 'google'],
  ['xiaomi-mimo', false, undefined, 'chat'],
  ['xiaomi-mimo', false, 'anthropic-compatible', 'anthropic'],
] as const)(
  'preserves reviewed %s alias native tools with Responses=%s and wire=%s in the %s declaration shape',
  async (type, responses, wireProtocol, target) => {
    const f = fixture(true, responses)
    f.provider.type = type
    f.provider.wireProtocol = wireProtocol
    const before = JSON.stringify(f.provider)
    const session = (await createConversationModelOperationSession({
      provider: f.provider, conversation: { id: 'conversation', providerId: f.provider.id, model: f.alias, messages: [] },
      settings: {},
    } as unknown as Parameters<typeof createConversationModelOperationSession>[0], f.dependencies))!
    expect(session.prepareRequest(f.request).systemPrompt).not.toContain(f.catalog.taggedPrompt)
    const request = toRuntimeChatRequest({ provider: f.provider }, f.request)
    expect(request.providerToolDeclarations).toHaveLength(1)
    const declaration = request.providerToolDeclarations![0]
    if (target === 'chat') expect(declaration).toMatchObject({ type: 'function', function: { name: 'read' } })
    if (target === 'responses') {
      expect(declaration).toMatchObject({ type: 'function', name: 'read' })
      expect(declaration).not.toHaveProperty('function')
    }
    if (target === 'anthropic') expect(declaration).toMatchObject({ name: 'read', input_schema: { type: 'object' } })
    if (target === 'google') expect(declaration)
      .toMatchObject({ functionDeclarations: [{ name: 'read', parametersJsonSchema: { type: 'object' } }] })
    expect(request.model).toBe(f.alias)
    expect(request.requestedModel).toBe(f.alias)
    expect(JSON.stringify(f.provider)).toBe(before)
    expect(f.dependencies.executeExternal).not.toHaveBeenCalled()
    expect(f.dependencies.executeInternal).not.toHaveBeenCalled()
  },
)

it('keeps a provider-wide native tool restriction authoritative for a supported alias', async () => {
  const f = fixture(true)
  f.provider.capabilities!.nativeTools = false
  const session = (await createConversationModelOperationSession({
    provider: f.provider, conversation: { id: 'conversation', providerId: f.provider.id, model: f.alias, messages: [] },
    settings: {},
  } as unknown as Parameters<typeof createConversationModelOperationSession>[0], f.dependencies))!
  expect(session.prepareRequest(f.request).systemPrompt).toContain(f.catalog.taggedPrompt)
  expect(toRuntimeChatRequest({ provider: f.provider }, f.request).providerToolDeclarations).toBeUndefined()
})

it('preserves existing manually reviewed unknown model behavior without fabricating an alias model config', async () => {
  const f = fixture(true)
  f.provider.models = []
  f.provider.manualModels = [f.upstream]
  f.provider.modelConfigs = []
  const session = (await createConversationModelOperationSession({
    provider: f.provider, conversation: { id: 'conversation', providerId: f.provider.id, model: f.alias, messages: [] },
    settings: {},
  } as unknown as Parameters<typeof createConversationModelOperationSession>[0], f.dependencies))!
  expect(session.prepareRequest(f.request).systemPrompt).not.toContain(f.catalog.taggedPrompt)
  const alias = toRuntimeChatRequest({ provider: f.provider }, f.request)
  const direct = toRuntimeChatRequest({ provider: f.provider }, { ...f.request, model: f.upstream })
  expect(alias.providerToolDeclarations).toEqual(direct.providerToolDeclarations)
  expect(alias.providerToolDeclarations).toHaveLength(1)
  expect(f.provider.modelConfigs).toEqual([])
  expect(alias.requestedModel).toBe(f.alias)
})

it('resolves an original alias exactly once when its upstream name is another reviewed alias', async () => {
  const f = fixture(true)
  f.provider.modelAliases!.push({ alias: f.upstream, model: 'other-upstream' })
  f.provider.modelConfigs!.push({ ...getModelConfig('gpt-4o', 'openai'), id: 'other-upstream',
    supportsTools: false, preferredEndpoint: 'responses' })
  const session = (await createConversationModelOperationSession({
    provider: f.provider, conversation: { id: 'conversation', providerId: f.provider.id, model: f.alias, messages: [] },
    settings: {},
  } as unknown as Parameters<typeof createConversationModelOperationSession>[0], f.dependencies))!
  expect(session.prepareRequest(f.request).systemPrompt).not.toContain(f.catalog.taggedPrompt)
  expect(toRuntimeChatRequest({ provider: f.provider }, f.request).providerToolDeclarations)
    .toEqual([{ type: 'function', function: expect.objectContaining({ name: 'read' }) }])
})

it.each([false, true])(
  'uses an observed canonical producer profile without reinterpreting it as another alias: supportsTools=%s',
  supportsTools => {
    const f = fixture(true)
    f.provider.modelAliases!.push({ alias: f.upstream, model: 'other-upstream' })
    f.provider.modelConfigs!.push({ ...getModelConfig('gpt-4o', 'openai'), id: 'other-upstream',
      supportsTools, preferredEndpoint: 'responses' })
    const request = toRuntimeChatRequest({ provider: f.provider }, { ...f.request, model: f.upstream,
      providerStateBinding: { providerId: f.provider.id, model: f.upstream } })
    expect(request.providerToolDeclarations)
      .toEqual([{ type: 'function', function: expect.objectContaining({ name: 'read' }) }])
    expect(request.model).toBe(f.upstream)
    expect(request.allowFallback).toBe(false)
    expect(request.executionConstraint).toBeUndefined()
  },
)

it('keeps an observed producer tool prohibition despite a same-named alias pointing at a supported profile', () => {
  const f = fixture(false)
  f.provider.modelAliases!.push({ alias: f.upstream, model: 'other-upstream' })
  f.provider.modelConfigs!.push({ ...getModelConfig('gpt-4o', 'openai'), id: 'other-upstream',
    supportsTools: true, preferredEndpoint: 'responses' })
  const request = toRuntimeChatRequest({ provider: f.provider }, { ...f.request, model: f.upstream,
    providerStateBinding: { providerId: f.provider.id, model: f.upstream } })
  expect(request.providerToolDeclarations).toBeUndefined()
  expect(request.model).toBe(f.upstream)
  expect(request.allowFallback).toBe(false)
})
