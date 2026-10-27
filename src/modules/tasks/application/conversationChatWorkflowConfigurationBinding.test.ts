import { createConversationChatWorkflowRuntimePolicy } from './conversationChatWorkflowRuntimePolicy'
import type { ConversationChatWorkflowRuntimePolicyDependencies, ConversationChatWorkflowRuntimeInput } from './conversationChatWorkflowRuntimePolicy'
import type { RagQueryPlan } from '@/types/contextContracts'
import type { Settings } from '@/types/settingsContracts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => { resolve = finish })
  return { promise, resolve }
}

function fixture() {
  const barrier = deferred<never[]>()
  const retrievalBarrier = deferred<void>()
  const controller = new AbortController()
  const settings = { theme: 'light', language: 'en', defaultProvider: null, fontSize: 16, hapticsEnabled: false,
    memoryEnabled: true, knowledgeEnabled: true, ragMode: 'hybrid', ragProfile: 'deep',
    knowledgeTopK: 3 } as Settings
  const retrieveContext = jest.fn(async (_conversation: unknown, _message: unknown, _signal?: AbortSignal, _configuration?: unknown) => {
    await retrievalBarrier.promise
    return { sources: [], prompt: '' }
  })
  const createRagQueryPlan = jest.fn(input => ({
    id: 'plan', query: input.query, profile: 'deep', profileSource: 'settings', language: 'en',
    intent: 'fact', complexity: 'simple', risk: 'low', rewrittenQueries: [], subQueries: [],
    enabledTechniques: [], retrievalBudget: 3, contextItemBudget: 3,
    tokenBudget: input.settings.knowledgeTopK * 128, createdAt: 1,
  } as RagQueryPlan))
  const dependencies: ConversationChatWorkflowRuntimePolicyDependencies = {
    clock: { now: () => 1 },
    chatEntry: {
      decideConversationChatWorkflowEntry: () => ({
        shouldHandle: true, reason: 'explicit-tool-request', classification: { suggestedToolRequest: undefined }, traces: [],
      } as unknown as ReturnType<ConversationChatWorkflowRuntimePolicyDependencies['chatEntry']['decideConversationChatWorkflowEntry']>),
      resolveConversationChatWorkflowAssistantMessage: async input => {
        await input.ragRuntime!.buildContextPack({ query: 'original query', conversationTitle: 'Original', systemPrompt: '' },
          { signal: controller.signal })
        return { handled: true, reply: { handled: true, content: 'resolved', status: 'done', traces: [] } }
      },
      buildConversationChatWorkflowAssistantMessagePatch: jest.fn(),
    },
    workflows: { definitionPolicy: { validate: jest.fn() },
      skillPolicy: { extractWorkflowDefinitionsFromSkillSnapshot: () => [],
        hasWorkflowDefinitionCandidatesInSkillSnapshot: () => false,
        listBlockedWorkflowStatesForSkillSnapshot: jest.fn(), listEnabledWorkflowIdsForSkillSnapshot: jest.fn() },
      androidCatalog: {} as ConversationChatWorkflowRuntimePolicyDependencies['workflows']['androidCatalog'] },
    search: { filterLocalSearchToolManifests: value => value, isBuiltinSearchToolRequest: () => false,
      shouldExposeLocalSearchTool: () => false },
    tools: { listConversationToolManifests: () => barrier.promise, listStaticConversationToolManifests: () => [] },
    rag: { createConversationRagRuntime: jest.fn(), createRagQueryPlan },
    trace: { projectTrace: value => value, redactSensitiveText: value => value, clampWorkflowOutput: value => value },
  }
  const policy = createConversationChatWorkflowRuntimePolicy(dependencies)
  const input = { conversation: { id: 'conversation', title: 'Original', systemPrompt: '',
    knowledgeSources: ['original-scope'], messages: [] }, content: 'original request',
    settings, retrieveContext, signal: controller.signal } as unknown as ConversationChatWorkflowRuntimeInput
  return { barrier, retrievalBarrier, controller, settings, retrieveContext, createRagQueryPlan, dependencies, policy, input }
}

it('passes captured workflow settings and provider:null to the local retrieval port after catalog admission', async () => {
  const { barrier, retrievalBarrier, controller, settings, retrieveContext, createRagQueryPlan, policy, input } = fixture()
  const pending = policy.resolveConversationChatWorkflowAssistantMessage(input)
  settings.knowledgeEnabled = false
  settings.knowledgeTopK = 99
  input.conversation.knowledgeSources!.push('later-scope')
  barrier.resolve([])
  for (let index = 0; index < 8; index++) await Promise.resolve()
  expect(retrieveContext).toHaveBeenCalledWith(
    expect.objectContaining({ knowledgeSources: ['original-scope'] }),
    expect.objectContaining({ content: 'original query' }), controller.signal,
    { settings: { theme: 'light', language: 'en', defaultProvider: null, fontSize: 16, hapticsEnabled: false,
      memoryEnabled: true, knowledgeEnabled: true, ragMode: 'hybrid', ragProfile: 'deep', knowledgeTopK: 3 }, provider: null },
  )
  retrievalBarrier.resolve()
  await expect(pending).resolves.toMatchObject({ handled: true })
  expect(createRagQueryPlan).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ knowledgeTopK: 3 }) }))
})

it.each(['completed', 'cancelled'] as const)('keeps the context-pack request and original signal across a %s retrieval await', async mode => {
  const f = fixture()
  const observeContextPack = jest.fn()
  f.dependencies.chatEntry.resolveConversationChatWorkflowAssistantMessage = async input => {
    const request = { query: 'original query', conversationTitle: 'Original',
      systemPrompt: 'original prompt', maxContextItems: 1 }
    const options = { signal: f.controller.signal }
    const pendingPack = input.ragRuntime!.buildContextPack(request, options)
    request.query = 'later query'
    request.conversationTitle = 'Later'
    request.systemPrompt = 'later prompt'
    request.maxContextItems = 99
    options.signal = new AbortController().signal
    observeContextPack(await pendingPack)
    return { handled: true, reply: { handled: true, content: 'resolved', status: 'done', traces: [] } }
  }
  const policy = createConversationChatWorkflowRuntimePolicy(f.dependencies)
  let settled = false
  const pending = policy.resolveConversationChatWorkflowAssistantMessage(f.input)
    .finally(() => { settled = true })
  f.barrier.resolve([])
  for (let index = 0; index < 8; index++) await Promise.resolve()
  expect(f.retrieveContext).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Original', systemPrompt: 'original prompt' }),
    expect.objectContaining({ content: 'original query' }), f.controller.signal,
    expect.objectContaining({ provider: null }),
  )
  if (mode === 'cancelled') f.controller.abort()
  await Promise.resolve()
  expect(settled).toBe(false)
  f.retrievalBarrier.resolve()
  if (mode === 'cancelled') {
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(observeContextPack).not.toHaveBeenCalled()
    expect(f.createRagQueryPlan).not.toHaveBeenCalled()
  } else {
    await expect(pending).resolves.toMatchObject({ handled: true })
    expect(f.createRagQueryPlan).toHaveBeenCalledWith(expect.objectContaining({
      query: 'original query', conversationTitle: 'Original', systemPrompt: 'original prompt', maxContextItems: 1,
    }))
  }
})
