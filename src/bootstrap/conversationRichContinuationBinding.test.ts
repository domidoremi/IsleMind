import type { StreamEvent } from '@/core'
import type {
  ProviderContinuationAdmission, ProviderRuntimeChatRequest, ProviderExecutionTarget, ProviderRuntimeCompletionResult,
} from '@/modules/providers'
import {
  deferred, loadProviderAdmissionStoreFixture, prepareStoreExecution,
  type ProviderAdmissionStoreFixture,
} from './testing/providerAdmissionStoreFixture'
import type { ConversationAssistantDurableDispatchInput } from './conversationAssistantDurableExecutionRuntime'

let fixture: ProviderAdmissionStoreFixture
interface RichFinalizationContext {
  requestController: AbortController
  providerContinuation?: ProviderContinuationAdmission
  onExecutionTarget?: ProviderRuntimeChatRequest['onExecutionTarget']
  onStreamEvent?: (event: StreamEvent) => void
}

type RichFixtureFallback = 'model' | 'provider-primary' | 'provider-group'

let deadlineOwners: Array<ReturnType<typeof import('@/modules/assistant-runtime/application/runBudgetDeadline')['createRunBudgetDeadlines']>>
beforeEach(async () => {
  deadlineOwners = []
  // Dispose isolated timers, not the durable debt left by a failed checkpoint.
  jest.doMock('@/modules/assistant-runtime/application/runBudgetDeadline', () => {
    const actual = jest.requireActual<typeof import('@/modules/assistant-runtime/application/runBudgetDeadline')>(
      '@/modules/assistant-runtime/application/runBudgetDeadline',
    )
    return { ...actual, createRunBudgetDeadlines(input: Parameters<typeof actual.createRunBudgetDeadlines>[0]) {
      const owner = actual.createRunBudgetDeadlines(input)
      deadlineOwners.push(owner)
      return owner
    } }
  })
  fixture = await loadProviderAdmissionStoreFixture()
})
afterEach(async () => {
  try {
    expect(fixture.executionResources.retainedTextBytes).toBe(0)
    await fixture.close()
  } finally {
    for (const owner of deadlineOwners) owner.dispose()
    jest.dontMock('@/modules/assistant-runtime/application/runBudgetDeadline')
  }
})

async function richFixture(
  credential: 'primary' | 'group' = 'primary',
  options: { fallback?: RichFixtureFallback; vision?: boolean; model?: string; alias?: string;
    access?: { modelAllowlist?: string[]; modelBlocklist?: string[] } } = {},
) {
  const execution = await prepareStoreExecution(fixture, credential)
  const { getModelConfig } = require('@/types/modelCatalog') as typeof import('@/types/modelCatalog')
  const upstreamModel = options.model ?? 'gpt-4o'
  const requestedModel = options.alias ?? upstreamModel
  const capabilities = { chat: true, streaming: true, modelList: true, vision: options.vision === true, files: false, audioInput: false,
    audioTranscription: false, speech: false, nativeSearch: false, reasoningEffort: false, topP: true, nativeTools: true }
  await fixture.useSettingsStore.getState().updateProvider('fixture-provider', {
    capabilities,
    models: options.fallback === 'model' ? [upstreamModel, 'gpt-4o-mini'] : [upstreamModel],
    modelConfigs: (options.fallback === 'model' ? [upstreamModel, 'gpt-4o-mini'] : [upstreamModel])
      .map(model => ({ ...getModelConfig(model === 'manual-fixture' ? 'gpt-4o' : model, 'openai'),
        id: model, supportsTools: true })),
    ...(options.alias ? { modelAliases: [{ alias: options.alias, model: upstreamModel }] } : {}),
    ...(options.model === 'manual-fixture' ? { manualModels: [upstreamModel], models: ['gpt-4o'] } : {}),
  })
  if (options.fallback?.startsWith('provider')) {
    await fixture.useSettingsStore.getState().addProvider({
      id: 'backup-provider', name: 'Reviewed backup', type: 'openai', enabled: true, apiKey: '',
      baseUrl: 'https://backup.example.invalid/v1', models: ['gpt-4o-mini'], capabilities,
      modelConfigs: [{ ...getModelConfig('gpt-4o-mini', 'openai'), supportsTools: true }],
      ...(options.alias ? { modelAliases: [{ alias: options.alias, model: 'gpt-4o-mini' }] } : {}),
      ...(options.fallback === 'provider-group' ? { credentialGroups: [{ id: 'backup-group', label: 'Backup group',
        enabled: true, apiKey: '', availableModels: ['gpt-4o-mini'], source: { kind: 'group' as const, groupId: 'backup-group' } }] } : {}),
    })
    if (options.fallback === 'provider-group') {
      await fixture.useSettingsStore.getState().setProviderCredentialGroupKey('backup-provider', 'backup-group', 'synthetic-backup-group')
    } else {
      await fixture.useSettingsStore.getState().setProviderApiKey('backup-provider', 'synthetic-backup-primary')
    }
  }
  if (options.access) fixture.useSettingsStore.setState({ settings: {
    ...fixture.useSettingsStore.getState().settings, ...options.access,
  } })
  const catalog = fixture.providers.snapshotProviderConfiguration(fixture.useSettingsStore.getState().providers)
  const selection = await fixture.resolution.resolvePreferred({ preferred: { providerId: 'fixture-provider', model: requestedModel },
    providers: catalog, settings: fixture.useSettingsStore.getState().settings, signal: execution.controller.signal,
    allowFallback: false, ...(credential === 'group' ? { targetCredentialGroupId: 'default' } : {}) })
  if (selection.kind !== 'ready') throw new Error(`Rich fixture admission failed: ${selection.kind}`)
  const modules = require('@/modules/assistant-runtime') as typeof import('@/modules/assistant-runtime')
  const { asAssistantRunId } = require('@/core') as typeof import('@/core')
  const runId = asAssistantRunId(`rich-${credential}`)
  const persistence = modules.createSqliteAssistantRunPersistence(fixture.provider)
  const persistenceErrors: Array<{ type: string; error: unknown }> = []
  const appendAndSave = persistence.appendAndSave
  jest.spyOn(persistence, 'appendAndSave').mockImplementation(async (...args) => {
    try { return await appendAndSave(...args) }
    catch (error) { persistenceErrors.push({ type: args[0].type, error }); throw error }
  })
  const { assistantRunGovernance } = require('./assistantRunGovernance') as typeof import('./assistantRunGovernance')
  const runtime = modules.createAssistantRuntime({ ids: { next: prefix => `${prefix}-fixture` }, clock: { now: Date.now },
    persistence, providerGateway: fixture.providers.createProviderGateway([]), governance: assistantRunGovernance })
  jest.doMock('./applicationAssistantRuntime', () => ({ applicationAssistantRuntime: runtime, assistantRunPersistence: persistence }))
  jest.doMock('./conversationAssistantProviderDispatchRuntime', () => ({ conversationAssistantProviderDispatchRuntime: {} }))
  jest.doMock('./conversationAssistantMessageProjection', () => ({ projectConversationAssistantFailure: jest.fn() }))
  jest.doMock('@/store/chatStore', () => ({ useChatStore: { getState: () => ({ conversations: [],
    upsertMessageTrace: jest.fn(), transitionMessageLifecycle: jest.fn() }) } }))
  jest.doMock('@/store/chatStreamingStore', () => ({ useChatStreamingStore: { getState: () => ({
    activeStreams: new Map(), upsertTrace: jest.fn(), clearStreaming: jest.fn() }) } }))
  jest.doMock('@/presentation/features/conversations/plainChatProjection', () => ({ projectPendingModelOperation: jest.fn() }))
  const { createConversationAssistantDurableExecutionRuntime } = require('./conversationAssistantDurableExecutionRuntime') as
    typeof import('./conversationAssistantDurableExecutionRuntime')
  const { createConversationModelOperationSession } = require('./conversationModelOperationRuntime') as
    typeof import('./conversationModelOperationRuntime')
  const integrations = require('@/modules/integrations') as typeof import('@/modules/integrations')
  const created = integrations.createModelOperationCatalogSnapshot([{ id: 'builtin:fixture:read', name: 'read',
    description: 'Read one bounded fixture', inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] },
    permission: 'read-only', requiresConfirmation: false, capabilityScopes: ['source:builtin', 'permission:read-only'],
    executor: { kind: 'builtin', id: 'builtin:fixture:read' }, availability: { status: 'available' } }])
  if (!created.ok) throw new Error(created.message)
  const prompt = integrations.formatTaggedModelOperationPrompt(created.snapshot)
  if (!prompt.ok) throw new Error(prompt.message)
  const contextBarrier = deferred<void>()
  const context = { schema: 'islemind.context-snapshot.v1' as const, id: 'context-rich' as
    import('@/core').ContextSnapshotId, createdAt: 1, conversationMessageIds: ['user'],
    memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] }
  const contextInputs: ConversationAssistantDurableDispatchInput[] = []
  const providerRequests: ProviderRuntimeChatRequest[] = []
  const targets: ProviderExecutionTarget[] = []
  const startErrors: unknown[] = []
  const projected: string[] = []
  const emitProviderEvent = jest.fn((event: StreamEvent, observe?: (event: StreamEvent) => void) => observe?.(event))
  const finalizations: RichFinalizationContext[] = []
  const finalize = jest.fn(async (result: ProviderRuntimeCompletionResult, _completion: RichFinalizationContext) =>
    ({ kind: 'completed' as const, output: result.text }))
  const failure = jest.fn()
  const confirmFallback = jest.fn(async () => true)
  const operation = jest.fn(async () => ({ observation: { ok: true, status: 'done', output: 'Bounded fixture evidence',
    blocks: [], diagnostic: { id: 'task', type: 'tool', title: 'Receipt', startedAt: 1, status: 'done' },
    metadata: { taskStatus: 'succeeded' } } }))
  const settings = { ...fixture.useSettingsStore.getState().settings, upstreamMaxRetries: 0 }
  const provider = structuredClone(selection.selection.provider)
  const conversation = { id: 'conversation', title: 'Fixture', providerId: provider.id, model: requestedModel,
    temperature: 0.2, maxTokens: 100, messages: [] }
  const session = (await createConversationModelOperationSession({
    provider, settings, conversation, signal: execution.controller.signal,
  } as unknown as Parameters<typeof createConversationModelOperationSession>[0], {
    createCatalog: async () => ({ ok: true, catalog: { snapshot: created.snapshot, taggedPrompt: prompt.prompt,
      manifests: [{ id: 'builtin:fixture:read', name: 'read', description: 'Read', source: 'builtin',
        enabled: true, serverId: 'fixture', permission: 'read-only', inputSchema: { type: 'object' } }] } }),
    executeInternal: jest.fn(), executeExternal: operation, declinePendingTask: jest.fn(),
    createRagRuntime: async () => ({}), now: Date.now,
  } as unknown as Parameters<typeof createConversationModelOperationSession>[1]))!
  const providerDispatch = modules.createAssistantConversationProviderDispatchRuntime({
    generateTraceId: () => 'model-rich', now: Date.now, modelRequestTitle: () => 'Model',
    recordTrace: jest.fn(),
    async startStreaming(input: {
      request: ProviderRuntimeChatRequest; requestController: AbortController; onStreamEvent?: (event: StreamEvent) => void;
      complete: (result: unknown, context: unknown) => Promise<unknown>; completionFailed: (error: unknown) => void;
    }) {
      const request = options.fallback ? {
        ...input.request, confirmFallback, failoverPolicy: { mode: 'ask-before-cross-provider' as const },
      } : input.request
      providerRequests.push(request)
      let producing: ProviderExecutionTarget | undefined
      const handle = await fixture.streamRuntime.streamProviderChat({ ...request, stream: false,
        onExecutionTarget: async target => {
          await request.onExecutionTarget?.(target)
          producing = target
          targets.push(target)
        } }, chunk => {
          projected.push(chunk)
          input.onStreamEvent?.({ type: 'text-delta', text: chunk })
        }, result => {
          if (result.providerToolCalls?.length) {
            emitProviderEvent({ type: 'provider-continuation-state', binding: {
              providerId: producing!.providerId, model: producing!.model }, reasoningReplay: [] }, input.onStreamEvent)
            for (const call of result.providerToolCalls) emitProviderEvent({
              type: 'tool-call', toolCallId: call.callId ?? call.id ?? 'fixture-call', toolName: call.name,
              arguments: call.arguments as import('@/core').JsonRecord,
            }, input.onStreamEvent)
          }
          void input.complete(result, { requestController: input.requestController, flush: jest.fn() })
            .catch(input.completionFailed)
        }, input.completionFailed).catch(error => { startErrors.push(error); throw error })
      return { kind: 'started' as const, handle }
    },
  } as unknown as Parameters<typeof modules.createAssistantConversationProviderDispatchRuntime>[0])
  const bridge = createConversationAssistantDurableExecutionRuntime({
    durableExecutionRuntime: modules.createAssistantConversationDurableExecutionRuntime({
      activityRuntime: runtime, ids: { next: prefix => prefix + '-fixture' },
    }),
    providerDispatchRuntime: providerDispatch as unknown as Parameters<typeof createConversationAssistantDurableExecutionRuntime>[0]['providerDispatchRuntime'],
    createContextSnapshot: async input => {
      contextInputs.push(input)
      await contextBarrier.promise
      return { ok: true, value: { snapshot: context, providerContext: '', sources: [], citations: [] } }
    },
    projectStartFailure: failure,
  })
  const input = { runId, conversationId: 'conversation', assistantMessageId: 'response', requestController: execution.controller,
    runtimeConversation: conversation, provider, upstreamModel, settings, systemPrompt: 'Answer from evidence',
    messages: [{ role: 'user', content: 'Read fixture' }], contextPrompt: '',
    attachments: [], retrievalSources: [], fallbackProviders: [provider], webSearchMode: 'off', remoteCompactEligible: false,
    remoteCompactFallback: undefined, previousResponseId: undefined, providerToolDeclarations: undefined,
    executionConstraint: selection.selection.constraint, sourceMessages: [{ id: 'user', role: 'user', content: 'Read fixture', timestamp: 1 }],
    requestMessageId: 'user', requestText: 'Read fixture', approvedToolContextIds: ['read'], modelOperationSession: session,
    buildStreamLifecycle: () => ({
      complete: async (result: ProviderRuntimeCompletionResult, completion: RichFinalizationContext) => {
        finalizations.push(completion)
        return finalize(result, completion)
      },
      completionFailed: jest.fn(), providerFailed: jest.fn(), startFailed: jest.fn(),
    }),
  } as unknown as ConversationAssistantDurableDispatchInput
  const respond = async (_url: string, requestOptions: RequestInit) => {
    const body = JSON.parse(String(requestOptions.body))
    const first = !body.messages?.some((message: { role: string }) => message.role === 'tool')
    const name = body.tools?.[0]?.function?.name
    return new Response(JSON.stringify({ choices: [{ message: first
      ? { content: '', tool_calls: [{ id: 'first-call', type: 'function', function: { name, arguments: '{"target":"fixture"}' } }] }
      : { content: 'Evidence-backed fixture answer' } }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }), { status: 200 })
  }
  fixture.effects.streamWire.mockImplementation(respond)
  if (options.fallback) {
    fixture.effects.streamWire.mockImplementationOnce(async () => new Response('Temporary upstream unavailable', { status: 503 }))
    fixture.effects.fallbackWire.mockImplementation(respond)
  }
  async function finish() {
    const dispatched = await bridge.dispatch(input)
    if (dispatched.kind !== 'dispatched') return { dispatched, result: undefined }
    const result = await dispatched.completion
    await fixture.idle()
    return { dispatched, result }
  }
  return { bridge, input, contextBarrier, contextInputs, runtime, persistence, runId, targets, providerRequests,
    operation, failure, projected, finalizations, finalize, finish, execution, catalog, confirmFallback, emitProviderEvent,
    startErrors, persistenceErrors }
}

it('keeps the real canonical operation receipt and producing output across a successful Rich continuation', async () => {
  const f = await richFixture()
  f.contextBarrier.resolve()
  const outcome = await f.finish()
  expect(outcome.result).toMatchObject({ ok: true })
  expect(outcome.result?.ok && outcome.result.value.result?.outputText).toBe('Evidence-backed fixture answer')
  expect(f.operation).toHaveBeenCalledTimes(1)
  expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
  expect((await f.persistence.get(f.runId))?.status).toBe('succeeded')
  expect((await fixture.assistantRunBudgetStore.get(f.runId))?.attempts).toHaveLength(2)
  const originalRequest = await f.persistence.getRequestSnapshot(f.runId)
  expect(originalRequest?.request.providerId).toBe('fixture-provider')
  const finalization = f.finalizations[0].providerContinuation!
  expect(finalization.provider.apiKey).toBe(f.input.provider.apiKey)
  expect(finalization.model).toBe('gpt-4o')
  expect(typeof finalization.admit).toBe('function')
})

it('captures Rich dispatch data before context assembly without snapshotting the session, lifecycle or cancellation ports', async () => {
  const f = await richFixture()
  const pending = f.finish()
  f.input.provider.name = 'Later name'
  f.input.provider.id = 'later-provider'
  f.input.settings.upstreamMaxRetries = 99
  f.input.sourceMessages[0].content = 'Later source text'
  ;(f.input.approvedToolContextIds as string[])[0] = 'destroy'
  f.contextBarrier.resolve()
  const outcome = await pending
  expect(outcome.result?.ok).toBe(true)
  expect(f.contextInputs[0]).toMatchObject({ provider: { id: 'fixture-provider', name: 'Reviewed provider' },
    settings: { upstreamMaxRetries: 0 }, sourceMessages: [{ content: 'Read fixture' }], approvedToolContextIds: ['read'] })
  expect(f.contextInputs[0].modelOperationSession).toBe(f.input.modelOperationSession)
  expect(f.contextInputs[0].requestController).toBe(f.execution.controller)
  expect(f.contextInputs[0].buildStreamLifecycle).toBe(f.input.buildStreamLifecycle)
})

it.each(['primary', 'group'] as const)('retains the actual %s credential scope and disables fallback on every continuation', async credential => {
  const f = await richFixture(credential)
  f.contextBarrier.resolve()
  const outcome = await f.finish()
  expect(outcome.result?.ok).toBe(true)
  const budget = (await fixture.assistantRunBudgetStore.get(f.runId))!
  expect(budget.attempts).toHaveLength(2)
  const routeEntries = await f.persistence.list(f.runId)
  const routes = routeEntries.filter(entry => entry.type === 'provider.route-selected')
  expect(routes).toHaveLength(2)
  expect(routes[1].data).toMatchObject({ providerId: 'fixture-provider', model: 'gpt-4o',
    credentialSource: credential === 'group' ? { kind: 'group', groupId: 'default' } : { kind: 'primary' },
    scope: f.targets[0].scope })
})

it.each(['model', 'provider-primary', 'provider-group'] as const)(
  'continues only the real authorized %s fallback producer without rewriting the preference',
  async fallback => {
    const f = await richFixture('primary', { fallback })
    const preference = { provider: fixture.useSettingsStore.getState().settings.defaultProvider,
      model: f.input.runtimeConversation.model }
    f.contextBarrier.resolve()
    const outcome = await f.finish()
    expect(outcome.result?.ok && outcome.result.value.result?.outputText).toBe('Evidence-backed fixture answer')
    expect(f.operation).toHaveBeenCalledTimes(1)
    expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
    expect(fixture.effects.fallbackWire).toHaveBeenCalledTimes(1)
    const producing = f.targets[1]
    expect(producing).toMatchObject({ providerId: fallback === 'model' ? 'fixture-provider' : 'backup-provider',
      model: 'gpt-4o-mini', credentialSource: fallback === 'provider-group'
        ? { kind: 'group', groupId: 'backup-group' } : { kind: 'primary' } })
    const routes = (await f.persistence.list(f.runId)).filter(entry => entry.type === 'provider.route-selected')
    expect(routes).toHaveLength(3)
    expect(routes[2].data).toMatchObject({ providerId: producing.providerId, model: producing.model,
      credentialSource: producing.credentialSource, scope: producing.scope })
    const finalization = f.finalizations[0].providerContinuation!
    expect(finalization.provider.id).toBe(producing.providerId)
    expect(finalization.model).toBe(producing.model)
    const original = await f.persistence.getRequestSnapshot(f.runId)
    expect(original?.request).toMatchObject({ providerId: 'fixture-provider', model: 'gpt-4o' })
    expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(3)
    expect(f.catalog.every(provider => provider.apiKey === '')).toBe(true)
    expect(fixture.useSettingsStore.getState().settings.defaultProvider).toBe(preference.provider)
    expect(f.input.runtimeConversation.model).toBe(preference.model)
    if (fallback === 'model') expect(f.confirmFallback).not.toHaveBeenCalled()
    else expect(f.confirmFallback).toHaveBeenCalledTimes(1)
  },
)

it('preserves the original attachment owner across multiple paid canonical Rich turns', async () => {
  const f = await richFixture('primary', { vision: true })
  const originalBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZl8AAAAASUVORK5CYII='
  const attachment = { id: 'fixture-image', type: 'image' as const, uri: '', name: 'fixture.png',
    mimeType: 'image/png', size: 68, base64: originalBase64 }
  f.input.attachments.push(attachment)
  f.input.messages[0].content = 'Read the attached fixture'
  f.input.sourceMessages[0].content = 'Read the attached fixture'
  fixture.effects.streamWire.mockImplementation(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body))
    const calls = body.messages.filter((message: { role: string }) => message.role === 'tool').length
    const name = body.tools?.[0]?.function?.name
    return new Response(JSON.stringify({ choices: [{ message: calls < 2
      ? { content: '', tool_calls: [{ id: `call-${calls}`, type: 'function',
        function: { name, arguments: '{"target":"fixture"}' } }] }
      : { content: 'Two-receipt evidence-backed answer' } }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }), { status: 200 })
  })
  const pending = f.finish()
  attachment.base64 = 'TGF0ZXIgcmVwbGFjZW1lbnQ='
  attachment.name = 'later.png'
  f.contextBarrier.resolve()
  const outcome = await pending
  if (outcome.dispatched.kind === 'terminal' && outcome.dispatched.outcome.kind === 'failed') {
    throw outcome.dispatched.outcome.error
  }
  expect(outcome.dispatched).toMatchObject({ kind: 'dispatched' })
  expect(outcome.result).toMatchObject({ ok: true })
  expect(outcome.result?.ok && outcome.result.value.result?.outputText).toBe('Two-receipt evidence-backed answer')
  expect(f.operation).toHaveBeenCalledTimes(2)
  expect(fixture.effects.streamWire).toHaveBeenCalledTimes(3)
  for (const call of fixture.effects.streamWire.mock.calls) {
    const body = JSON.parse(String((call[1] as RequestInit).body))
    const users = body.messages.filter((message: { role: string }) => message.role === 'user')
    expect(users).toHaveLength(1)
    expect(JSON.stringify(users[0])).toContain(`data:image/png;base64,${originalBase64}`)
    expect(JSON.stringify(body)).not.toContain(attachment.base64)
    expect(JSON.stringify(body)).not.toContain('later.png')
    expect(body.messages.filter((message: { role: string }) => message.role !== 'user')
      .some((message: unknown) => JSON.stringify(message).includes(originalBase64))).toBe(false)
  }
  expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(3)
  const routes = (await f.persistence.list(f.runId)).filter(entry => entry.type === 'provider.route-selected')
  expect(routes).toHaveLength(3)
  for (const route of routes) expect(route.data).toMatchObject({ scope: f.targets[0].scope,
    providerId: 'fixture-provider', model: 'gpt-4o', credentialSource: { kind: 'primary' } })
})

it.each(['alias', 'manual model'] as const)(
  'retains real %s admission while pinning its actual upstream continuation',
  async mode => {
    const f = await richFixture('primary', mode === 'alias'
      ? { alias: 'reviewed-alias' } : { model: 'manual-fixture' })
    f.contextBarrier.resolve()
    const outcome = await f.finish()
    if (f.persistenceErrors.length) throw f.persistenceErrors[0].error
    if (f.startErrors.length) throw f.startErrors[0]
    if (outcome.dispatched.kind === 'terminal' && outcome.dispatched.outcome.kind === 'failed') {
      throw outcome.dispatched.outcome.error
    }
    expect(outcome.result?.ok).toBe(true)
    const actualModel = mode === 'alias' ? 'gpt-4o' : 'manual-fixture'
    expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
    const routes = (await f.persistence.list(f.runId)).filter(entry => entry.type === 'provider.route-selected')
    for (const route of routes) expect(route.data).toMatchObject({ model: actualModel })
    expect(f.finalizations[0].providerContinuation?.model).toBe(actualModel)
    expect((await f.persistence.getRequestSnapshot(f.runId))?.request.model)
      .toBe(mode === 'alias' ? 'reviewed-alias' : 'manual-fixture')
  },
)

it.each(['primary', 'group'] as const)(
  'retains an alias-only allowance across real %s producing Rich continuations',
  async credential => {
    const f = await richFixture(credential, { alias: 'reviewed-alias', access: { modelAllowlist: ['reviewed-alias'] } })
    f.contextBarrier.resolve()
    const outcome = await f.finish()
    expect(outcome.result?.ok).toBe(true)
    expect(f.operation).toHaveBeenCalledTimes(1)
    expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
    expect(f.finalizations[0].providerContinuation?.model).toBe('gpt-4o')
    expect((await f.persistence.getRequestSnapshot(f.runId))?.request.model).toBe('reviewed-alias')
    expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(2)
    expect(fixture.useSettingsStore.getState().settings.modelAllowlist).toEqual(['reviewed-alias'])
    const routes = (await f.persistence.list(f.runId)).filter(entry => entry.type === 'provider.route-selected')
    expect(routes).toHaveLength(2)
    for (const route of routes) expect(route.data).toMatchObject({ providerId: 'fixture-provider', model: 'gpt-4o',
      credentialSource: credential === 'group' ? { kind: 'group', groupId: 'default' } : { kind: 'primary' },
      scope: f.targets[0].scope })
    for (const call of fixture.effects.streamWire.mock.calls) {
      const options = call[1] as RequestInit
      expect(JSON.parse(String(options.body)).model).toBe('gpt-4o')
      expect((options.headers as Record<string, string>).Authorization)
        .toBe(`Bearer ${credential === 'group' ? 'synthetic-group-key' : 'synthetic-primary-key'}`)
    }
  },
)

it.each(['primary', 'group'] as const)(
  'revokes original alias access before another paid %s Rich continuation',
  async credential => {
    const f = await richFixture(credential, { alias: 'reviewed-alias' })
    f.operation.mockImplementationOnce(async () => {
      fixture.useSettingsStore.setState({ settings: {
        ...fixture.useSettingsStore.getState().settings, modelBlocklist: ['reviewed-alias'],
      } })
      return { observation: { ok: true, status: 'done', output: 'Evidence retained', blocks: [],
        diagnostic: { id: 'task', type: 'tool', title: 'Receipt', startedAt: 1, status: 'done' },
        metadata: { taskStatus: 'succeeded' } } }
    })
    f.contextBarrier.resolve()
    expect((await f.finish()).result?.ok).not.toBe(true)
    expect(f.operation).toHaveBeenCalledTimes(1)
    expect(fixture.effects.streamWire).toHaveBeenCalledTimes(1)
    expect(fixture.effects.fallbackWire).not.toHaveBeenCalled()
    expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(1)
  },
)

it('retains upstream-based alias allowance without rewriting the saved alias or access rules', async () => {
  const f = await richFixture('primary', { alias: 'reviewed-alias', access: { modelAllowlist: ['gpt-4o'] } })
  f.contextBarrier.resolve()
  expect((await f.finish()).result?.ok).toBe(true)
  expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
  expect((await f.persistence.getRequestSnapshot(f.runId))?.request.model).toBe('reviewed-alias')
  expect(fixture.useSettingsStore.getState().settings.modelAllowlist).toEqual(['gpt-4o'])
})

it.each(['primary', 'group'] as const)(
  'keeps alias-only admission and the original scope across multiple paid %s canonical turns',
  async credential => {
    const f = await richFixture(credential, { alias: 'reviewed-alias', access: { modelAllowlist: ['reviewed-alias'] } })
    fixture.effects.streamWire.mockImplementation(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      const calls = body.messages.filter((message: { role: string }) => message.role === 'tool').length
      return new Response(JSON.stringify({ choices: [{ message: calls < 2
        ? { content: '', tool_calls: [{ id: `alias-call-${calls}`, type: 'function',
          function: { name: body.tools[0].function.name, arguments: '{"target":"fixture"}' } }] }
        : { content: 'Two alias-bound receipts' } }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }), { status: 200 })
    })
    f.contextBarrier.resolve()
    const outcome = await f.finish()
    expect(outcome.result?.ok && outcome.result.value.result?.outputText).toBe('Two alias-bound receipts')
    expect(f.operation).toHaveBeenCalledTimes(2)
    expect(fixture.effects.streamWire).toHaveBeenCalledTimes(3)
    expect(fixture.effects.fallbackWire).not.toHaveBeenCalled()
    const routes = (await f.persistence.list(f.runId)).filter(entry => entry.type === 'provider.route-selected')
    expect(routes).toHaveLength(3)
    for (const route of routes) expect(route.data).toMatchObject({ model: 'gpt-4o', scope: f.targets[0].scope,
      credentialSource: credential === 'group' ? { kind: 'group', groupId: 'default' } : { kind: 'primary' } })
    expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(3)
    expect((await f.persistence.getRequestSnapshot(f.runId))?.request.model).toBe('reviewed-alias')
    expect(fixture.useSettingsStore.getState().settings.modelAllowlist).toEqual(['reviewed-alias'])
  },
)

it.each(['primary', 'group'] as const)(
  'does not let an alias allowance override upstream revocation before another paid %s turn',
  async credential => {
    const f = await richFixture(credential, { alias: 'reviewed-alias', access: { modelAllowlist: ['reviewed-alias'] } })
    const operation = f.operation.getMockImplementation()!
    f.operation.mockImplementationOnce(async () => {
      fixture.useSettingsStore.setState({ settings: {
        ...fixture.useSettingsStore.getState().settings, modelBlocklist: ['gpt-4o'],
      } })
      return operation()
    })
    f.contextBarrier.resolve()
    expect((await f.finish()).result?.ok).toBe(false)
    expect(f.operation).toHaveBeenCalledTimes(1)
    expect(fixture.effects.streamWire).toHaveBeenCalledTimes(1)
    expect(fixture.effects.fallbackWire).not.toHaveBeenCalled()
    expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(1)
    expect(fixture.useSettingsStore.getState().settings.modelAllowlist).toEqual(['reviewed-alias'])
  },
)

it.each(['primary', 'group'] as const)(
  'rejects real alias reassignment after the producing %s tool receipt without selecting its new upstream',
  async credential => {
    const f = await richFixture(credential, { alias: 'reviewed-alias' })
    const operation = f.operation.getMockImplementation()!
    f.operation.mockImplementationOnce(async () => {
      await fixture.useSettingsStore.getState().updateProvider('fixture-provider', {
        modelAliases: [{ alias: 'reviewed-alias', model: 'gpt-4o-mini' }],
      })
      return operation()
    })
    f.contextBarrier.resolve()
    expect((await f.finish()).result?.ok).toBe(false)
    expect(f.operation).toHaveBeenCalledTimes(1)
    expect(fixture.effects.streamWire).toHaveBeenCalledTimes(1)
    expect(fixture.effects.fallbackWire).not.toHaveBeenCalled()
    expect((await f.persistence.getRequestSnapshot(f.runId))?.request.model).toBe('reviewed-alias')
    expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(1)
    expect(fixture.useSettingsStore.getState().providers[0].modelAliases)
      .toEqual([{ alias: 'reviewed-alias', model: 'gpt-4o-mini' }])
  },
)

it.each(['model', 'provider-primary', 'provider-group'] as const)(
  'retains the original alias while admitting only the explicitly allowed real %s fallback continuation',
  async fallback => {
    const f = await richFixture('primary', { fallback, alias: 'reviewed-alias',
      access: { modelAllowlist: ['reviewed-alias', 'gpt-4o-mini'] } })
    let admitted: ProviderRuntimeChatRequest | undefined
    f.finalize.mockImplementationOnce(async (result, completion) => {
      const admission = completion.providerContinuation!
      admitted = await admission.admit({ provider: admission.provider, model: admission.model,
        requestedModel: 'reviewed-alias', messages: [], generationParameterSources: {},
        settings: f.input.settings, signal: completion.requestController.signal })
      return { kind: 'completed', output: result.text }
    })
    f.contextBarrier.resolve()
    expect((await f.finish()).result?.ok).toBe(true)
    expect(admitted).toMatchObject({ model: 'gpt-4o-mini', requestedModel: 'gpt-4o-mini',
      allowFallback: false, fallbackProviders: [], settings: { upstreamMaxRetries: 0 },
      executionConstraint: { identity: { providerId: f.targets[1].providerId, model: 'gpt-4o-mini',
        credentialSource: f.targets[1].credentialSource, protocolAdapterId: f.targets[1].protocolAdapterId,
        endpointVariant: f.targets[1].endpointVariant }, scope: f.targets[1].scope } })
    expect(f.operation).toHaveBeenCalledTimes(1)
    expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
    expect(fixture.effects.fallbackWire).toHaveBeenCalledTimes(1)
    const routes = (await f.persistence.list(f.runId)).filter(entry => entry.type === 'provider.route-selected')
    expect(routes).toHaveLength(3)
    expect(routes[2].data).toMatchObject({ model: 'gpt-4o-mini', scope: f.targets[1].scope,
      providerId: fallback === 'model' ? 'fixture-provider' : 'backup-provider',
      credentialSource: fallback === 'provider-group'
        ? { kind: 'group', groupId: 'backup-group' } : { kind: 'primary' } })
    expect((await f.persistence.getRequestSnapshot(f.runId))?.request)
      .toMatchObject({ providerId: 'fixture-provider', model: 'reviewed-alias' })
    expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(3)
    expect(fixture.useSettingsStore.getState().settings.defaultProvider).toBe('fixture-provider')
    expect(f.input.runtimeConversation.model).toBe('reviewed-alias')
  },
)

it.each(['model', 'provider-primary', 'provider-group'] as const)(
  'does not transfer an original alias allowance to a revoked real %s fallback producer',
  async fallback => {
    const f = await richFixture('primary', { fallback, alias: 'reviewed-alias',
      access: { modelAllowlist: ['reviewed-alias', 'gpt-4o-mini'] } })
    const operation = f.operation.getMockImplementation()!
    f.operation.mockImplementationOnce(async () => {
      fixture.useSettingsStore.setState({ settings: {
        ...fixture.useSettingsStore.getState().settings, modelAllowlist: ['reviewed-alias'],
      } })
      return operation()
    })
    f.contextBarrier.resolve()
    expect((await f.finish()).result?.ok).toBe(false)
    expect(f.operation).toHaveBeenCalledTimes(1)
    expect(fixture.effects.streamWire).toHaveBeenCalledTimes(1)
    expect(fixture.effects.fallbackWire).toHaveBeenCalledTimes(1)
    expect(f.targets[1]).toMatchObject({ model: 'gpt-4o-mini',
      providerId: fallback === 'model' ? 'fixture-provider' : 'backup-provider' })
    expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(2)
    expect((await f.persistence.getRequestSnapshot(f.runId))?.request.model).toBe('reviewed-alias')
    expect(fixture.useSettingsStore.getState().settings.modelAllowlist).toEqual(['reviewed-alias'])
    expect(f.input.runtimeConversation.model).toBe('reviewed-alias')
  },
)

it.each(['primary', 'group'] as const)(
  'rejects a blocked original %s alias snapshot despite a permissive live accessor',
  async credential => {
    const f = await richFixture(credential, { alias: 'reviewed-alias' })
    let rejected: unknown
    f.finalize.mockImplementationOnce(async (result) => {
      const { captureProviderRichContinuationBinding } = require('./providerRichContinuationBinding') as
        typeof import('./providerRichContinuationBinding')
      rejected = await captureProviderRichContinuationBinding({ ...f.providerRequests[0],
        settings: { ...f.input.settings, modelBlocklist: ['reviewed-alias'] },
        readCurrentAccessSettings: () => ({}) }, f.targets.at(-1)!)
        .then(() => undefined, error => error)
      return { kind: 'completed', output: result.text }
    })
    f.contextBarrier.resolve()
    expect((await f.finish()).result?.ok).toBe(true)
    expect(rejected).toBeInstanceOf(Error)
    expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
    expect(fixture.effects.fallbackWire).not.toHaveBeenCalled()
    expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(2)
    expect(fixture.useSettingsStore.getState().settings.modelBlocklist).toEqual([])
  },
)

it.each(['primary', 'group'] as const)(
  'rechecks original alias revocation while a later %s continuation credential hydration is pending',
  async credential => {
    const f = await richFixture(credential, { alias: 'reviewed-alias' })
    let rejected: unknown
    f.finalize.mockImplementationOnce(async (result, completion) => {
      const admission = completion.providerContinuation!
      const entered = deferred<void>()
      const release = deferred<void>()
      fixture.hooks.beforeSecureRead = async () => { entered.resolve(); await release.promise }
      const pending = admission.admit({ provider: admission.provider, model: admission.model, messages: [],
        generationParameterSources: {}, settings: f.input.settings, readCurrentAccessSettings: () => ({}),
        signal: new AbortController().signal }).then(() => undefined, error => error)
      await entered.promise
      fixture.useSettingsStore.setState({ settings: {
        ...fixture.useSettingsStore.getState().settings, modelBlocklist: ['reviewed-alias'],
      } })
      fixture.hooks.beforeSecureRead = undefined
      release.resolve()
      rejected = await pending
      return { kind: 'completed', output: result.text }
    })
    f.contextBarrier.resolve()
    expect((await f.finish()).result?.ok).toBe(true)
    expect(rejected).toBeInstanceOf(Error)
    expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
    expect(fixture.effects.fallbackWire).not.toHaveBeenCalled()
    expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(2)
  },
)

it('detaches provider-authored arguments, call metadata and reasoning before observer owners can mutate them', async () => {
  const f = await richFixture()
  const { snapshotPlainData } = require('@/core') as typeof import('@/core')
  f.emitProviderEvent.mockImplementation((event, observe) => {
    const captured = event.type === 'provider-continuation-state'
      ? { ...event, reasoningReplay: [{ kind: 'text' as const, text: 'Original reasoning' }] }
      : event.type === 'tool-call'
        ? { ...event, arguments: { target: 'fixture' }, providerMetadata: { providerCallId: 'original-provider-call' } }
        : event
    // The durable bridge must copy BEFORE returning control to the event owner.
    observe?.(captured)
    if (captured.type === 'provider-continuation-state' && captured.reasoningReplay?.[0]?.kind === 'text') {
      Reflect.set(captured.reasoningReplay[0], 'text', 'Later reasoning')
    }
    if (captured.type === 'tool-call') {
      Reflect.set(captured.arguments!, 'target', 'later-target')
      Reflect.set(captured.providerMetadata!, 'providerCallId', 'later-provider-call')
    }
  })
  f.contextBarrier.resolve()
  expect((await f.finish()).result?.ok).toBe(true)
  expect(f.operation.mock.calls[0]).toBeDefined()
  const operationRequest = (f.operation.mock.calls[0] as unknown as [{ request: { arguments: object } }])[0]
  expect(operationRequest.request.arguments).toEqual({ target: 'fixture' })
  const body = JSON.parse(String((fixture.effects.streamWire.mock.calls[1][1] as RequestInit).body))
  const assistant = body.messages.find((message: { role: string; tool_calls?: unknown[] }) =>
    message.role === 'assistant' && message.tool_calls?.length)
  expect(assistant.tool_calls[0].id).toBe('original-provider-call')
  expect(JSON.parse(assistant.tool_calls[0].function.arguments)).toEqual({ target: 'fixture' })
  const checkpoint = snapshotPlainData((await f.persistence.get(f.runId))?.lifecycleCheckpoint)
  expect(JSON.stringify(checkpoint)).not.toContain('Later reasoning')
  expect(JSON.stringify(checkpoint)).not.toContain('later-provider-call')
})

it('rejects replay attributed to a different producing route before entering the canonical tool executor', async () => {
  const f = await richFixture()
  f.emitProviderEvent.mockImplementation((event, observe) => {
    observe?.(event.type === 'provider-continuation-state'
      ? { ...event, binding: { providerId: 'invented-provider', model: 'invented-model' } } : event)
  })
  f.contextBarrier.resolve()
  const outcome = await f.finish()
  expect(outcome.result?.ok).not.toBe(true)
  expect(f.operation).not.toHaveBeenCalled()
  expect(fixture.effects.streamWire).toHaveBeenCalledTimes(1)
  expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(1)
})

it.each(['availability', 'health'] as const)(
  'revokes a producing continuation after real %s evidence changes without granting another route',
  async mutation => {
    const f = await richFixture()
    f.operation.mockImplementationOnce(async () => {
      if (mutation === 'availability') {
        const operation = await fixture.availability.beginExecution(f.targets[0], 'invalidated-producing-model')
        await fixture.availability.settleExecution(operation, f.targets[0].model, { kind: 'model_invalidated' })
      } else {
        await fixture.health.recordProviderRuntimeRouteFailure({
          providerId: f.targets[0].providerId, model: f.targets[0].model,
        }, { status: 429, retryAfterMs: 60_000 })
      }
      return { observation: { ok: true, status: 'done', output: 'Evidence retained', blocks: [],
        diagnostic: { id: 'task', type: 'tool', title: 'Receipt', startedAt: 1, status: 'done' },
        metadata: { taskStatus: 'succeeded' } } }
    })
    f.contextBarrier.resolve()
    expect((await f.finish()).result?.ok).not.toBe(true)
    expect(f.operation).toHaveBeenCalledTimes(1)
    expect(fixture.effects.streamWire).toHaveBeenCalledTimes(1)
    expect(fixture.effects.fallbackWire).not.toHaveBeenCalled()
    expect(fixture.useSettingsStore.getState().settings.defaultProvider).toBe('fixture-provider')
    expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(1)
  },
)

it.each(['route journal', 'terminal usage'] as const)(
  'keeps a failed real %s receipt visible without starting a new paid continuation',
  async receipt => {
    const f = await richFixture()
    let retainedError: unknown
    let observedAttempts = 0
    f.finalize.mockImplementationOnce(async (result, completion) => {
      const admission = completion.providerContinuation!
      const request = await admission.admit({ provider: admission.provider, model: admission.model,
        messages: [{ role: 'user', content: 'Synthesize once' }], maxTokens: 100,
        generationParameterSources: { maxTokens: 'internal-policy' }, settings: f.input.settings,
        signal: completion.requestController.signal, stream: false })
      fixture.hooks.beforeSql = async (sql, values) => {
        if (receipt === 'route journal' && sql.startsWith('INSERT INTO assistant_run_journal')
          && values[2] === 'provider.route-selected') throw new Error('Observed route journal unavailable')
        if (receipt === 'terminal usage' && sql === 'UPDATE harness_run_budgets SET snapshotJson = ? WHERE rootRunId = ?') {
          const budget = JSON.parse(String(values[0])) as { attempts: Array<{ settled: boolean }> }
          if (budget.attempts.length === 3 && budget.attempts[2].settled) throw new Error('Terminal usage receipt unavailable')
        }
      }
      try {
        const handle = await fixture.streamRuntime.streamProviderChat({
          ...request, onExecutionTarget: async target => {
            observedAttempts += 1
            await completion.onExecutionTarget?.(target)
            if (receipt === 'terminal usage') throw new Error('Observer rejects the same owned attempt')
          },
        }, jest.fn(), jest.fn(), error => { retainedError = error })
        await handle.done
      } catch (error) {
        retainedError = error
      } finally {
        fixture.hooks.beforeSql = undefined
      }
      expect(retainedError).toMatchObject({ name: 'ProviderExecutionTargetObserverError' })
      return { kind: 'completed', output: result.text }
    })
    f.contextBarrier.resolve()
    await f.finish()
    expect(observedAttempts).toBe(1)
    expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
    expect(fixture.effects.fallbackWire).not.toHaveBeenCalled()
    const budget = (await fixture.assistantRunBudgetStore.get(f.runId))!
    expect(budget.attempts).toHaveLength(3)
    expect(budget.attempts[2]).toMatchObject({ settled: receipt !== 'terminal usage', complete: false })
    expect(budget.attempts[2].usage).toBeUndefined()
    if (receipt === 'route journal') expect(budget.activeSince).not.toBeUndefined()
    for (const owner of deadlineOwners) owner.dispose()
    expect(await fixture.assistantRunBudgetStore.get(f.runId)).toEqual(budget)
  },
)

it.each(['primary key', 'group key', 'catalog', 'store access'] as const)('revokes the producing route before a later paid Rich turn after %s changes', async mutation => {
  const f = await richFixture(mutation === 'group key' ? 'group' : 'primary')
  f.operation.mockImplementationOnce(async () => {
    if (mutation === 'primary key') await fixture.useSettingsStore.getState().setProviderApiKey('fixture-provider', 'synthetic-new-primary')
    if (mutation === 'group key') await fixture.useSettingsStore.getState().setProviderCredentialGroupKey('fixture-provider', 'default', 'synthetic-new-group')
    if (mutation === 'catalog') await fixture.useSettingsStore.getState().updateProvider('fixture-provider', { baseUrl: 'https://later.example.invalid/v1' })
    if (mutation === 'store access') fixture.useSettingsStore.setState({ settings: {
      ...fixture.useSettingsStore.getState().settings, modelBlocklist: ['gpt-4o'],
    } })
    return { observation: { ok: true, status: 'done', output: 'Evidence exists but route was revoked', blocks: [],
      diagnostic: { id: 'task', type: 'tool', title: 'Receipt', startedAt: 1, status: 'done' },
      metadata: { taskStatus: 'succeeded' } } }
  })
  f.contextBarrier.resolve()
  const outcome = await f.finish()
  expect(outcome.result?.ok).toBe(false)
  expect(f.operation).toHaveBeenCalledTimes(1)
  expect(fixture.effects.streamWire).toHaveBeenCalledTimes(1)
  const budget = (await fixture.assistantRunBudgetStore.get(f.runId))!
  expect(budget.attempts).toHaveLength(1)
  expect(budget.attempts[0].settled).toBe(true)
  expect(f.projected.join('')).not.toContain('Evidence-backed fixture answer')
})

it('does not start a durable run when the original Rich controller cancels during context assembly', async () => {
  const f = await richFixture()
  const pending = f.finish()
  f.execution.controller.abort()
  Object.defineProperty(f.input, 'requestController', { value: new AbortController(), configurable: true })
  f.contextBarrier.resolve()
  const outcome = await pending
  expect(outcome.dispatched).toMatchObject({ kind: 'terminal', outcome: { kind: 'cancelled' } })
  expect(await f.persistence.get(f.runId)).toBeUndefined()
  expect(fixture.effects.streamWire).not.toHaveBeenCalled()
  expect(f.operation).not.toHaveBeenCalled()
})

it.each(['primary', 'group'] as const)('uses the same real admission and budget owner for a later tagged %s synthesis', async credential => {
  const executeTask = jest.fn(async () => ({ observation: { ok: true, status: 'done', output: 'Synthetic local tool evidence',
    blocks: [{ type: 'text', text: 'Synthetic local tool evidence' }],
    diagnostic: { id: 'tagged-tool', type: 'tool', status: 'done', title: 'Receipt', startedAt: 1 } } }))
  jest.doMock('./taskBoundToolRuntime', () => ({ executeExternalTaskBoundTool: executeTask }))
  const f = await richFixture(credential)
  const { createConversationMcpToolTurnRuntime } = require('./conversationMcpToolTurnRuntime') as
    typeof import('./conversationMcpToolTurnRuntime')
  const { BUILT_IN_CAPABILITY_SERVER_ID, MCP_TOOL_CALL_TAG, parseMcpToolRequest } =
    require('@/modules/integrations') as typeof import('@/modules/integrations')
  const observer = jest.fn(async (target: ProviderExecutionTarget) => {
    await f.finalizations[0].onExecutionTarget?.(target)
  })
  f.finalize.mockImplementationOnce(async (_result, completion) => {
    // A tagged revision belongs to the still-running finalization, not a new run after terminal success.
    const admission = completion.providerContinuation!
    const admitted = await admission.admit({
      provider: admission.provider, model: admission.model,
      messages: [{ role: 'user', content: 'Synthesize bounded evidence' }],
      maxTokens: 100, generationParameterSources: { maxTokens: 'internal-policy' }, settings: f.input.settings,
      signal: completion.requestController.signal, stream: false,
    })
    expect(admitted.allowFallback).toBe(false)
    expect(admitted.executionConstraint?.scope).toEqual(f.targets[0].scope)
    expect(admitted.executionConstraint?.providerCatalog).toEqual(f.catalog)
    const firstOutput = `<${MCP_TOOL_CALL_TAG}>{"serverId":"${BUILT_IN_CAPABILITY_SERVER_ID}","toolName":"read_fixture","arguments":{}}</${MCP_TOOL_CALL_TAG}>`
    expect(parseMcpToolRequest(firstOutput)).toMatchObject({ toolName: 'read_fixture' })
    fixture.effects.streamWire.mockImplementationOnce(async () => new Response(JSON.stringify({ choices: [{ message: {
      content: 'Tagged evidence-backed answer' } }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }),
      { status: 200 }))
    const tagged = createConversationMcpToolTurnRuntime({ conversationId: 'conversation', assistantMessageId: 'response',
      providerContinuation: admission, onExecutionTarget: observer })
    const result = await tagged.execute({ conversationId: 'conversation', assistantMessageId: 'response',
      provider: f.input.provider, settings: f.input.settings, conversation: { id: 'conversation', model: 'gpt-4o' },
      systemPrompt: 'Answer from evidence', messages: [{ role: 'user', content: 'Read fixture' }], baseContextPrompt: '',
      firstOutput, tools: [],
      manifests: [{ id: `builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:read_fixture`, source: 'builtin', name: 'read_fixture',
        description: 'Read fixture', permission: 'read-only', enabled: true, serverId: BUILT_IN_CAPABILITY_SERVER_ID }],
      signal: completion.requestController.signal })
    expect(result?.text).toBe('Tagged evidence-backed answer')
    return { kind: 'completed', output: result!.text }
  })
  f.contextBarrier.resolve()
  const outcome = await f.finish()
  expect(outcome.result?.ok && outcome.result.value.result?.outputText).toBe('Tagged evidence-backed answer')
  expect(executeTask).toHaveBeenCalledTimes(1)
  expect(observer).toHaveBeenCalledTimes(1)
  expect(observer.mock.calls[0][0]).toMatchObject({ scope: f.targets[0].scope,
    credentialSource: credential === 'group' ? { kind: 'group', groupId: 'default' } : { kind: 'primary' } })
  expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(3)
})

it.each(['missing scope', 'unknown catalog route', 'wrong model'] as const)('rejects unbound continuation authority (%s) rather than inventing a route', async invalid => {
  const f = await richFixture()
  f.contextBarrier.resolve()
  await f.finish()
  const { captureProviderRichContinuationBinding } = require('./providerRichContinuationBinding') as
    typeof import('./providerRichContinuationBinding')
  const source = f.providerRequests[0]
  const target = { ...f.targets[0], ...(invalid === 'missing scope' ? { scope: undefined }
    : invalid === 'unknown catalog route' ? { providerId: 'not-admitted' } : { model: 'not-admitted' }) }
  if (invalid === 'wrong model') {
    // The real wire observer establishes the producing model; a later request cannot replace it.
    const binding = await captureProviderRichContinuationBinding(source, f.targets[0])
    await expect(binding.bind({ ...source, model: target.model })).rejects.toThrow()
  } else {
    await expect(captureProviderRichContinuationBinding(source, target)).rejects.toThrow()
  }
  expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
})

it('rechecks both the original request and per-turn cancellation while continuation hydration is pending', async () => {
  const f = await richFixture()
  const entered = deferred<void>()
  const release = deferred<void>()
  const controller = new AbortController()
  let failure: unknown
  f.finalize.mockImplementationOnce(async (_result, completion) => {
    const admission = completion.providerContinuation!
    fixture.hooks.beforeSecureRead = async () => { entered.resolve(); await release.promise }
    try {
      await admission.admit({ provider: admission.provider, model: admission.model, messages: [],
        generationParameterSources: {}, settings: f.input.settings, signal: controller.signal })
      throw new Error('Cancelled continuation admission must not succeed.')
    } catch (error) {
      failure = error
      throw error
    }
  })
  f.contextBarrier.resolve()
  const pending = f.finish()
  await entered.promise
  f.execution.controller.abort()
  fixture.hooks.beforeSecureRead = undefined
  release.resolve()
  await pending
  expect(failure).toMatchObject({ name: 'AbortError' })
  expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
})

it('rechecks per-turn cancellation during continuation hydration without cancelling the original request', async () => {
  const f = await richFixture()
  const controller = new AbortController()
  f.finalize.mockImplementationOnce(async (result, completion) => {
    const admission = completion.providerContinuation!
    const entered = deferred<void>()
    const release = deferred<void>()
    fixture.hooks.beforeSecureRead = async () => { entered.resolve(); await release.promise }
    const pending = admission.admit({ provider: admission.provider, model: admission.model, messages: [],
      generationParameterSources: {}, settings: f.input.settings, signal: controller.signal })
    const outcome = pending.then(() => undefined, error => error)
    await entered.promise
    controller.abort()
    fixture.hooks.beforeSecureRead = undefined
    release.resolve()
    expect(await outcome).toMatchObject({ name: 'AbortError' })
    expect(f.execution.controller.signal.aborted).toBe(false)
    return { kind: 'completed', output: result.text }
  })
  f.contextBarrier.resolve()
  expect((await f.finish()).result?.ok).toBe(true)
  expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
})

it.each(['original request', 'per-turn request'] as const)(
  'preserves %s cancellation when pending continuation hydration rejects',
  async cancellation => {
    const f = await richFixture()
    const turnController = new AbortController()
    let retainedError: unknown
    f.finalize.mockImplementationOnce(async (result, completion) => {
      const admission = completion.providerContinuation!
      const entered = deferred<void>()
      const release = deferred<void>()
      fixture.hooks.beforeSecureRead = async () => {
        entered.resolve()
        await release.promise
        throw new Error('Rejected isolated continuation hydration')
      }
      const pending = admission.admit({ provider: admission.provider, model: admission.model, messages: [],
        generationParameterSources: {}, settings: f.input.settings, signal: turnController.signal })
        .then(() => undefined, error => error)
      await entered.promise
      if (cancellation === 'original request') f.execution.controller.abort()
      else turnController.abort()
      fixture.hooks.beforeSecureRead = undefined
      release.resolve()
      retainedError = await pending
      return { kind: 'completed', output: result.text }
    })
    f.contextBarrier.resolve()
    const outcome = await f.finish()
    expect(retainedError).toMatchObject({ name: 'AbortError' })
    expect(outcome.result?.ok).toBe(cancellation === 'per-turn request')
    expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
    expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(2)
  },
)

it('keeps a noncancelled continuation hydration failure visible without admitting another paid turn', async () => {
  const f = await richFixture()
  let retainedError: unknown
  f.finalize.mockImplementationOnce(async (result, completion) => {
    const admission = completion.providerContinuation!
    const error = new Error('Rejected isolated continuation hydration')
    fixture.hooks.beforeSecureRead = async () => { throw error }
    try {
      retainedError = await admission.admit({ provider: admission.provider, model: admission.model, messages: [],
        generationParameterSources: {}, settings: f.input.settings, signal: new AbortController().signal })
        .then(() => undefined, failure => failure)
    } finally {
      fixture.hooks.beforeSecureRead = undefined
    }
    return { kind: 'completed', output: result.text }
  })
  f.contextBarrier.resolve()
  expect((await f.finish()).result?.ok).toBe(true)
  expect(retainedError).toMatchObject({ name: 'ProviderCredentialStorageError', code: 'read_failed', scope: 'provider' })
  expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
  expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(2)
})

it('retires the finalization admission port when its durable run is terminal', async () => {
  const f = await richFixture()
  f.contextBarrier.resolve()
  expect((await f.finish()).result?.ok).toBe(true)
  const admission = f.finalizations[0].providerContinuation!
  await expect(admission.admit({ provider: admission.provider, model: admission.model, messages: [],
    generationParameterSources: {}, settings: f.input.settings, signal: new AbortController().signal })).rejects.toThrow()
  expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
  expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(2)
})

it('revokes an already bound finalization request before wire admission after its durable run ends', async () => {
  const f = await richFixture()
  let request: ProviderRuntimeChatRequest | undefined
  f.finalize.mockImplementationOnce(async (result, completion) => {
    const admission = completion.providerContinuation!
    request = await admission.admit({ provider: admission.provider, model: admission.model,
      messages: [{ role: 'user', content: 'Synthesize once' }], maxTokens: 100,
      generationParameterSources: { maxTokens: 'internal-policy' }, settings: f.input.settings,
      signal: new AbortController().signal, stream: false })
    return { kind: 'completed', output: result.text }
  })
  f.contextBarrier.resolve()
  expect((await f.finish()).result?.ok).toBe(true)
  let failure: unknown
  try {
    const handle = await fixture.streamRuntime.streamProviderChat({
      ...request!, onExecutionTarget: f.finalizations[0].onExecutionTarget,
    }, jest.fn(), jest.fn(), error => { failure = error })
    await handle.done
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
  expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
  expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(2)
})

it('retires a pending continuation hydration when finalization finishes before its receipt', async () => {
  const f = await richFixture()
  const entered = deferred<void>()
  const release = deferred<void>()
  let pending: Promise<unknown> | undefined
  f.finalize.mockImplementationOnce(async (result, completion) => {
    const admission = completion.providerContinuation!
    fixture.hooks.beforeSecureRead = async () => { entered.resolve(); await release.promise }
    pending = admission.admit({ provider: admission.provider, model: admission.model, messages: [],
      generationParameterSources: {}, settings: f.input.settings, signal: new AbortController().signal })
      .then(() => undefined, error => error)
    await entered.promise
    return { kind: 'completed', output: result.text }
  })
  f.contextBarrier.resolve()
  expect((await f.finish()).result?.ok).toBe(true)
  fixture.hooks.beforeSecureRead = undefined
  release.resolve()
  expect(await pending).toBeInstanceOf(Error)
  expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
  expect((await fixture.assistantRunBudgetStore.get(f.runId))!.attempts).toHaveLength(2)
})

it.each(['original policy', 'original access', 'original cancellation'] as const)(
  'retains %s revocation after bind through the real observer-to-wire tail',
  async revocation => {
    const f = await richFixture()
    let allowed = true
    const access = { modelBlocklist: [] as string[] }
    let rejected: unknown
    f.finalize.mockImplementationOnce(async (result, completion) => {
      const { captureProviderRichContinuationBinding } = require('./providerRichContinuationBinding') as
        typeof import('./providerRichContinuationBinding')
      const binding = await captureProviderRichContinuationBinding({
        ...f.providerRequests[0], isSelectionPolicyCurrent: () => allowed,
        readCurrentAccessSettings: () => access,
      }, f.targets.at(-1)!)
      const turnController = new AbortController()
      const request = await binding.bind({ provider: binding.provider, model: binding.constraint.identity.model,
        messages: [{ role: 'user', content: 'Synthesize once' }], maxTokens: 100,
        generationParameterSources: { maxTokens: 'internal-policy' }, settings: f.input.settings,
        signal: turnController.signal, stream: false })
      try {
        const handle = await fixture.streamRuntime.streamProviderChat({
          ...request,
          onExecutionTarget: async target => {
            await completion.onExecutionTarget?.(target)
            if (revocation === 'original policy') allowed = false
            if (revocation === 'original access') access.modelBlocklist = ['gpt-4o']
            if (revocation === 'original cancellation') f.execution.controller.abort()
          },
        }, jest.fn(), jest.fn(), error => { rejected = error })
        await handle.done
      } catch (error) {
        rejected = error
      }
      expect(rejected).toBeInstanceOf(Error)
      expect(turnController.signal.aborted).toBe(false)
      return { kind: 'completed', output: result.text }
    })
    f.contextBarrier.resolve()
    await f.finish()
    expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
    const budget = (await fixture.assistantRunBudgetStore.get(f.runId))!
    expect(budget.attempts).toHaveLength(3)
    expect(budget.attempts.every(attempt => attempt.settled)).toBe(true)
  },
)

it.each([
  ['primary', 'original source'], ['group', 'original source'],
  ['primary', 'live store'], ['group', 'live store'],
] as const)(
  'retains %s alias revocation from the %s after bind through the actual observer-to-wire tail',
  async (credential, revocation) => {
    const f = await richFixture(credential, { alias: 'reviewed-alias' })
    const access = { modelBlocklist: [] as string[] }
    const turnController = new AbortController()
    let rejected: unknown
    let admitted: ProviderRuntimeChatRequest | undefined
    f.finalize.mockImplementationOnce(async (result, completion) => {
      const { captureProviderRichContinuationBinding } = require('./providerRichContinuationBinding') as
        typeof import('./providerRichContinuationBinding')
      const binding = await captureProviderRichContinuationBinding({
        ...f.providerRequests[0], readCurrentAccessSettings: () => access,
      }, f.targets.at(-1)!)
      admitted = await binding.bind({ provider: binding.provider, model: binding.constraint.identity.model,
        messages: [{ role: 'user', content: 'Synthesize once' }], maxTokens: 100,
        generationParameterSources: { maxTokens: 'internal-policy' }, settings: f.input.settings,
        readCurrentAccessSettings: () => ({}), signal: turnController.signal, stream: false })
      try {
        const handle = await fixture.streamRuntime.streamProviderChat({
          ...admitted, onExecutionTarget: async target => {
            await completion.onExecutionTarget?.(target)
            if (revocation === 'original source') access.modelBlocklist = ['reviewed-alias']
            else fixture.useSettingsStore.setState({ settings: {
              ...fixture.useSettingsStore.getState().settings, modelBlocklist: ['reviewed-alias'],
            } })
          },
        }, jest.fn(), jest.fn(), error => { rejected = error })
        await handle.done
      } catch (error) {
        rejected = error
      }
      return { kind: 'completed', output: result.text }
    })
    f.contextBarrier.resolve()
    expect((await f.finish()).result?.ok).toBe(true)
    expect(admitted).toMatchObject({ model: 'gpt-4o', requestedModel: 'reviewed-alias', allowFallback: false })
    expect(rejected).toBeInstanceOf(Error)
    expect(turnController.signal.aborted).toBe(false)
    expect(fixture.effects.streamWire).toHaveBeenCalledTimes(2)
    expect(fixture.effects.fallbackWire).not.toHaveBeenCalled()
    const budget = (await fixture.assistantRunBudgetStore.get(f.runId))!
    expect(budget.attempts).toHaveLength(3)
    expect(budget.attempts.every(attempt => attempt.settled)).toBe(true)
    const routes = (await f.persistence.list(f.runId)).filter(entry => entry.type === 'provider.route-selected')
    expect(routes).toHaveLength(3)
    expect(routes[2].data).toMatchObject({ model: 'gpt-4o', scope: f.targets[0].scope,
      credentialSource: credential === 'group' ? { kind: 'group', groupId: 'default' } : { kind: 'primary' } })
  },
)
