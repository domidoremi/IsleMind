const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Database } = require('bun:sqlite')
const { readNormalizedConversationEvidence } = require('./conversation-sqlite-evidence')

async function main() {
  const core = await import('../src/core/index.ts')
  const runtimeModule = await import('../src/modules/assistant-runtime/index.ts')
  const conversationsModule = await import('../src/modules/conversations/index.ts')
  const knowledgeModule = await import('../src/modules/knowledge/index.ts')
  const providersModule = await import('../src/modules/providers/index.ts')
  const conversationRuntimeModule = await import('../src/bootstrap/plainChatMessageIdentity.ts')
  assertConversationSnapshotContracts(core, conversationsModule)
  assertStrictChatRequestValidation(core)
  assertPlainMessageIdentityPreservation(conversationRuntimeModule)
  assertContextPlanReceiptBuilder(runtimeModule)
  assertGenericRuntimePreparationBoundary()
  await assertAssistantRunWorkspaceWritebackMigration(core, runtimeModule)
  await assertAssistantRunKindMigration(core, runtimeModule)
  await assertConversationLegacyMigration(conversationsModule)

  const database = new Database(':memory:')
  try {
    const storage = createBunSqliteStorage(database)
    const conversations = conversationsModule.createSqliteConversationRepository(storage)
    await conversations.save({
      id: 'conversation-walking-skeleton',
      title: 'Walking skeleton',
      providerId: 'walking-provider',
      model: 'walking-model',
      systemPrompt: 'Be concise.',
      temperature: 0.2,
      reasoningEffort: 'high',
      maxTokens: 120,
      generationParameterOverrides: {},
      createdAt: 1,
      updatedAt: 1,
      messages: [{ id: 'message-1', role: 'user', content: 'Hello', status: 'done' }],
    })

    const persistence = runtimeModule.createSqliteAssistantRunPersistence(storage)
    const persistedConversation = {
      id: 'conversation-persistence-contract',
      title: 'Persistence contract',
      providerId: 'walking-provider',
      model: 'walking-model',
      updatedAt: 2,
      messages: [{ id: 'message-persistence', role: 'user', content: 'Persist me', status: 'done' }],
    }
    await conversations.save(persistedConversation)
    assert.equal((await conversations.loadAll())[0].id, persistedConversation.id)
    const normalizedState = await storage.get()
    const conversationColumns = await normalizedState.getAll(
      'PRAGMA table_info(conversation_records)',
    )
    assert.equal(
      conversationColumns.some((column) => column.name === 'payloadJson'),
      false,
      'fresh conversation databases have no payload mirror column',
    )
    const normalizedConversationState = await normalizedState.getFirst(
      'SELECT conversationId, messageCount FROM conversation_record_state WHERE conversationId = ?',
      [persistedConversation.id],
    )
    const normalizedMessages = await normalizedState.getAll(
      'SELECT conversationId, id, ordinal, messageJson FROM conversation_message_records WHERE conversationId = ? ORDER BY ordinal',
      [persistedConversation.id],
    )
    assert.deepEqual(normalizedConversationState, {
      conversationId: persistedConversation.id,
      messageCount: persistedConversation.messages.length,
    }, 'conversation metadata is stored separately from message rows')
    assert.deepEqual(normalizedMessages.map((row) => ({
      conversationId: row.conversationId,
      id: row.id,
      ordinal: row.ordinal,
    })), [{
      conversationId: persistedConversation.id,
      id: 'message-persistence',
      ordinal: 0,
    }], 'conversation messages are persisted as individually addressable rows')
    const incrementallyUpdatedConversation = {
      ...persistedConversation,
      title: 'Incrementally updated',
      updatedAt: 3,
      messages: [
        ...persistedConversation.messages,
        { id: 'message-incremental', role: 'assistant', content: 'Only normalized rows change', status: 'done' },
      ],
    }
    await conversations.save(incrementallyUpdatedConversation)
    assert.deepEqual(
      (await conversations.get(persistedConversation.id))?.messages.map((message) => message.id),
      ['message-persistence', 'message-incremental'],
      'normalized reads immediately expose incrementally persisted messages',
    )
    assert.deepEqual(
      readNormalizedConversationEvidence(database, persistedConversation.id)?.messages.map((message) => message.id),
      ['message-persistence', 'message-incremental'],
      'Android evidence readers use the normalized conversation state and message rows',
    )
    await conversations.replaceAll([persistedConversation])
    assert.deepEqual((await conversations.loadAll()).map((item) => item.id), [persistedConversation.id])
    await conversations.clear()
    assert.deepEqual(await conversations.loadAll(), [])
    await conversations.save({
      id: 'conversation-walking-skeleton',
      title: 'Walking skeleton',
      providerId: 'walking-provider',
      model: 'walking-model',
      systemPrompt: 'Be concise.',
      temperature: 0.2,
      reasoningEffort: 'high',
      maxTokens: 120,
      generationParameterOverrides: {},
      createdAt: 1,
      updatedAt: 1,
      messages: [{ id: 'message-1', role: 'user', content: 'Hello', status: 'done' }],
    })
    assert.ok(
      await conversations.get('conversation-walking-skeleton'),
      'the owner repository exposes the normalized runtime fixture before dispatch',
    )
    const contextSnapshots = knowledgeModule.createSqliteContextSnapshotRepository(storage)
    const projections = []
    let capturedRequestSnapshotAtRunCreated
    let now = 50_000
    const ids = { next: (prefix) => `${prefix}-${++now}` }
    const adapter = {
      providerId: 'walking-provider',
      async *stream(request) {
        assert.ok(
          capturedRequestSnapshotAtRunCreated,
          'the exact provider-neutral request is durable before provider dispatch starts',
        )
        capturedProviderRequest = request
        yield { type: 'text-delta', text: 'Persisted ' }
        yield { type: 'citation', citationId: 'source-1', title: 'Source' }
        yield { type: 'text-delta', text: 'answer.' }
        yield { type: 'usage', inputTokens: 2, outputTokens: 2 }
      },
    }
    let capturedProviderRequest
    let capturedPreparation
    const assistantRuntime = runtimeModule.createAssistantRuntime({
      clock: { now: () => ++now },
      ids,
      providerGateway: providersModule.createProviderGateway([adapter]),
      persistence,
    })
    const useCase = conversationsModule.createConversationRunUseCase({
      clock: { now: () => ++now },
      ids,
      conversations,
      assistantRuntime,
      contextSnapshotAssembler: knowledgeModule.createContextSnapshotAssembler({
        clock: { now: () => ++now },
        ids,
        repository: contextSnapshots,
        retriever: {
          async retrieve() {
            return {
              providerContext: 'Use the approved local context when relevant.',
              sources: [{ id: 'memory-1', kind: 'memory', title: 'Preference' }],
            }
          },
        },
      }),
      requestPreparation: {
        prepare(input) {
          capturedPreparation = input
          return {
            ...input.request,
            requestedCapabilities: ['chat'],
          }
        },
      },
    })

    const handle = useCase.start({
      conversationId: 'conversation-walking-skeleton',
      responseMessageId: 'assistant-message-1',
      projection: async (event) => {
        projections.push(event)
        if (event.journalEntry?.type === 'run.created') {
          capturedRequestSnapshotAtRunCreated = await persistence.getRequestSnapshot(event.run.id)
        }
      },
    })
    const completed = await handle.completion

    assert.equal(
      completed.ok,
      true,
      `persisted conversation reaches the target runtime${completed.ok ? '' : ` (${completed.error.code}: ${completed.error.message})`}`,
    )
    if (!completed.ok) throw new Error(completed.error.message)
    assert.equal(completed.value.status, 'succeeded')
    assert.equal(completed.value.kind, 'chat')
    assert.equal(completed.value.responseMessageId, 'assistant-message-1')
    assert.equal(completed.value.result.outputText, 'Persisted answer.')
    assert.equal(completed.value.checkpoint.outputText, 'Persisted answer.')
    assert.equal(capturedPreparation?.request.messages[0].id, 'message-1')
    assert.equal(
      capturedPreparation?.assembledContext?.providerContext,
      'Use the approved local context when relevant.',
      'ConversationRun exposes the assembled context to the single request-preparation boundary',
    )
    assert.equal(capturedProviderRequest.reasoningEffort, 'high', 'SQLite conversation reasoning survives Snapshot and ChatRequest projection')
    assert.deepEqual(
      capturedProviderRequest.generationParameterSources,
      { temperature: 'provider-default', topP: 'provider-default', topK: 'provider-default', maxTokens: 'provider-default' },
      'an empty v2 override map projects every generation parameter as provider-default',
    )
    assert.equal(
      capturedProviderRequest.systemPrompt,
      'Be concise.\n\nUse the approved local context when relevant.',
      'the provider receives the persisted, frozen context prompt rather than retrieving context itself',
    )
    assert.deepEqual(
      capturedProviderRequest.requestedCapabilities,
      ['chat'],
      'the provider receives the final request-preparation result',
    )
    const requestSnapshot = await persistence.getRequestSnapshot(handle.runId)
    assert.ok(requestSnapshot, 'the final provider-neutral request is inspectable from durable AssistantRun data')
    assert.equal(requestSnapshot.schema, 'islemind.assistant-run-request-snapshot.v1')
    assert.equal(requestSnapshot.runId, handle.runId)
    assert.deepEqual(
      requestSnapshot.request,
      capturedProviderRequest,
      'the durable request snapshot exactly matches the provider-neutral request dispatched by the gateway',
    )
    assert.equal(
      requestSnapshot.requestHash,
      runtimeModule.buildAssistantRequestHash(capturedProviderRequest),
      'new canonical request snapshots retain a stable hash of the exact dispatched request',
    )
    assert.equal(
      requestSnapshot.capabilityRevision,
      runtimeModule.buildAssistantCapabilityRevision(capturedProviderRequest),
      'new canonical request snapshots retain the capability revision used for planning',
    )
    assert.equal(runtimeModule.isAssistantRequestHash(requestSnapshot.requestHash), true)
    assert.equal(runtimeModule.isAssistantCapabilityRevision(requestSnapshot.capabilityRevision), true)
    assert.notEqual(
      requestSnapshot.requestHash,
      runtimeModule.buildAssistantRequestHash({
        ...capturedProviderRequest,
        messages: [{ ...capturedProviderRequest.messages[0], text: 'Changed request.' }],
      }),
      'request identity changes when the frozen provider-neutral request changes',
    )
    assert.equal(Object.isFrozen(requestSnapshot), true, 'decoded request snapshot evidence is immutable')
    assert.equal(Object.isFrozen(requestSnapshot.request), true, 'decoded provider-neutral request is immutable')
    assert.equal(
      requestSnapshot.capturedAt,
      (await persistence.list(handle.runId))[0].occurredAt,
      'the request snapshot and run.created journal entry share one captured timestamp',
    )
    assert.equal(requestSnapshot.contextReceipt, undefined)
    assert.equal(
      await persistence.getLatestContextReceipt('conversation-walking-skeleton'),
      undefined,
      'a run whose frozen request captured no receipt is skipped by the conversation-scoped read',
    )
    const contextSnapshot = await contextSnapshots.get(completed.value.contextSnapshotId)
    assert.equal(contextSnapshot?.conversationId, 'conversation-walking-skeleton')
    assert.equal(contextSnapshot?.providerContext, 'Use the approved local context when relevant.')
    assert.deepEqual(contextSnapshot?.snapshot.memoryIds, ['memory-1'])
    await assertContextSnapshotPersistence(core, contextSnapshots, storage, contextSnapshot)
    assert.deepEqual(
      (await persistence.list(handle.runId)).map((entry) => entry.type),
      ['run.created', 'run.started', 'provider.route-selected', 'stream.event', 'stream.event', 'stream.event', 'stream.event', 'run.succeeded'],
    )
    assert.deepEqual(
      projections.map((event) => event.journalEntry?.type),
      ['run.created', 'run.started', 'provider.route-selected', 'stream.event', 'stream.event', 'stream.event', 'stream.event', 'run.succeeded'],
      'projection receives only states that were committed with their journal entry',
    )

    await assertPreparedModelOperationRequestSnapshot(
      core,
      runtimeModule,
      providersModule,
      persistence,
      ids,
    )
    await assertAtomicJournalAndRunState(core, persistence)
    await assertChatActivityPersistence(core, runtimeModule, assistantRuntime, persistence, storage)
    await assertChatActivityCancellationPreservesWorkspaceWritebackHandoff(
      core,
      assistantRuntime,
      persistence,
    )
    await assertAgentActivityCreationRejected(core, assistantRuntime, persistence)
    await assertRestartRecovery(core, runtimeModule, conversationsModule, providersModule, persistence, conversations, ids, now)
    await assertAssistantRunResetCascade(persistence, storage)
  } finally {
    database.close()
  }

  console.log('Walking-skeleton integration tests passed')
}

function assertStrictChatRequestValidation(core) {
  const base = {
    schema: core.CHAT_REQUEST_SCHEMA,
    conversationId: 'strict-request-conversation',
    providerId: 'strict-request-provider',
    model: 'strict-request-model',
    messages: [{ id: 'strict-message', role: 'user', text: 'Validate this request.' }],
    generationParameterSources: {},
  }
  assert.equal(core.isChatRequest(base), true, 'the canonical provider-neutral request fixture is accepted')
  assert.equal(core.isChatRequest({ ...base, generationParameterSources: { temperature: 'unknown-source' } }), false, 'unknown generation parameter sources fail closed')
  assert.equal(core.isChatRequest({ ...base, generationParameterSources: undefined }), false, 'missing generation parameter sources fail closed')
  assert.equal(core.isChatRequest({ ...base, reasoningEffort: 'extreme' }), false, 'unknown reasoning effort fails closed')
  assert.equal(core.isChatRequest({ ...base, unexpectedRootField: true }), false, 'unknown root request fields fail closed')
  assert.equal(core.isChatRequest({
    ...base,
    messages: [{ ...base.messages[0], unexpectedMessageField: true }],
  }), false, 'unknown message fields fail closed')
  assert.equal(core.isChatRequest({
    ...base,
    messages: [{
      id: 'strict-assistant-message',
      role: 'assistant',
      text: '',
      toolCalls: [{ callId: 'strict-call', name: 'strict_tool', arguments: {}, unexpectedToolField: true }],
    }],
  }), false, 'unknown tool-call fields fail closed')
  assert.equal(core.isChatRequest({
    ...base,
    messages: [{ id: 'strict-message', role: 'user', text: () => 'not JSON' }],
  }), false, 'function values cannot cross the provider-neutral request boundary')
  assert.equal(core.isChatRequest({
    ...base,
    generationParameterSources: { temperature: new AbortController().signal },
  }), false, 'AbortSignal values cannot cross the provider-neutral request boundary')
  assert.throws(() => core.freezeChatRequest({
    ...base,
    messages: [{ id: 'strict-message', role: 'user', text: () => 'not JSON' }],
  }), /invalid/i, 'function values are rejected before request freezing')
  const bound = core.freezeChatRequest({
    ...base,
    providerStateBinding: { providerId: base.providerId, model: base.model },
  })
  assert.equal(Object.isFrozen(bound), true, 'accepted requests are deeply frozen')
  assert.equal(core.isChatRequest({
    ...base,
    providerStateBinding: { providerId: 'other-provider', model: base.model },
  }), false, 'provider continuation bindings cannot diverge from request routing')
}

function assertGenericRuntimePreparationBoundary() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'bootstrap', 'conversationRuntime.ts'),
    'utf8',
  )
  assert.match(
    source,
    /A bounded Chat request preparation policy is required for new turns\./,
    'generic conversation runtime fails closed instead of dispatching an unplanned full history',
  )
  assert.match(
    source,
    /requestPreparation: createPlainChatRequestPreparation\(/,
    'plain Chat runtime explicitly supplies the bounded preparation policy',
  )
  assert.match(
    source,
    /const upstreamModel = resolveProviderModelAlias\(\s*input\.provider,\s*preparation\.request\.model,\s*\)/,
    'Plain planning resolves the provider-admission upstream model before capability lookup',
  )
  assert.match(
    source,
    /const modelConfig = getModelConfig\(\s*\n?\s*upstreamModel,\s*input\.provider\.type,/,
    'Plain planning uses the upstream model for model capabilities and context-window budgeting',
  )
  assert.match(
    source,
    /const plan = planChatContext\([\s\S]*?model: upstreamModel,[\s\S]*?remoteCompactMode: 'off'/,
    'Plain planning shares the frozen context planner while retaining its native remote-compact limitation',
  )
  assert.match(
    source,
    /contextReceipt: buildAssistantContextPlanReceipt\(\{[\s\S]*?model: upstreamModel,/,
    'Plain context receipts use the same upstream source identity as planning',
  )
}

function assertPlainMessageIdentityPreservation(conversationRuntimeModule) {
  const preserveMessageIdentity = conversationRuntimeModule.preserveMessageIdentity
  assert.equal(typeof preserveMessageIdentity, 'function', 'Plain request preparation exposes its pure identity-preservation behavior to focused tests')

  const duplicateSource = [
    { id: 'user-first', role: 'user', text: 'same question' },
    { id: 'assistant-first', role: 'assistant', text: 'same answer' },
    { id: 'user-second', role: 'user', text: 'same question' },
  ]
  const duplicatePlanned = [
    { role: 'user', content: 'same question' },
    { role: 'assistant', content: 'same answer' },
    { role: 'user', content: 'same question' },
  ]
  assert.deepEqual(
    preserveMessageIdentity(duplicatePlanned, duplicateSource).map((message) => message.id),
    ['user-first', 'assistant-first', 'user-second'],
    'duplicate role/text turns retain their matching persisted IDs in order',
  )

  const sourceWithSystemAndTool = [
    { id: 'system-1', role: 'system', text: 'hidden instruction' },
    { id: 'user-latest', role: 'user', text: 'latest question' },
    { id: 'tool-1', role: 'tool', text: 'tool output' },
  ]
  const plannedWithSummary = [
    { role: 'assistant', content: 'Conversation summary.' },
    { role: 'user', content: 'latest question' },
  ]
  const summarized = preserveMessageIdentity(plannedWithSummary, sourceWithSystemAndTool)
  assert.deepEqual(
    summarized.map((message) => ({ id: message.id, role: message.role, text: message.text })),
    [
      { id: 'planned-message-1', role: 'assistant', text: 'Conversation summary.' },
      { id: 'user-latest', role: 'user', text: 'latest question' },
    ],
    'an inserted summary receives a stable synthetic ID while later source IDs survive filtered roles',
  )

  const generated = preserveMessageIdentity(
    [
      { role: 'user', content: 'new turn' },
      { role: 'assistant', content: 'new response' },
    ],
    [],
  )
  assert.deepEqual(
    generated.map((message) => message.id),
    ['planned-message-1', 'planned-message-2'],
    'newly planned messages use deterministic IDs within one request plan',
  )
  assert.deepEqual(
    preserveMessageIdentity(
      [
        { role: 'user', content: 'new turn' },
        { role: 'assistant', content: 'new response' },
      ],
      [],
    ).map((message) => message.id),
    generated.map((message) => message.id),
    'synthetic IDs remain stable when the same plan is rebuilt',
  )
}

function assertContextPlanReceiptBuilder(runtimeModule) {
  const receipt = runtimeModule.buildAssistantContextPlanReceipt({
    providerId: 'receipt-provider',
    model: 'receipt-model',
    plan: {
      manifest: {
        id: 'receipt-manifest',
        budget: {
          modelContextWindow: 8_192,
          requestBudgetTokens: 6_000,
          contextPromptTokens: 40,
          estimatedInputTokens: 120,
          fixedTokens: 20,
          messageTokens: 60,
          includedFragmentTokens: 40,
          originalFragmentTokens: 80,
          totalTokenCap: 100,
          activeContextTokens: 120,
          tokensUntilCompaction: 5_000,
        },
        failureCodes: ['context_budget_overrun'],
        fragments: [{
          fragmentId: 'receipt-fragment',
          type: 'memory',
          priority: 'high',
          sourceId: 'memory-receipt',
          decision: 'included',
          tokenCap: 80,
          estimatedTokens: 40,
          originalEstimatedTokens: 80,
          authority: 'user-private',
          content: 'raw context must never enter a receipt',
        }],
      },
      windowState: { activeContextTokens: 120, tokensUntilCompaction: 5_000 },
    },
    activePrompt: {
      estimatedInputTokens: 120,
      fixedTokens: 20,
      messageTokens: 60,
      compressionTriggered: true,
      compressionMetadata: {
        strategy: 'structured-v2',
        triggerReason: 'message_budget_exceeded',
        sourceMessageCount: 8,
        keptMessageCount: 4,
        sourceTokens: 240,
        compressedTokens: 120,
        estimatedSavedTokens: 120,
        compressionRatio: 0.5,
        summaryTokens: 32,
        summarySectionCount: 4,
      },
    },
  })
  assert.equal(runtimeModule.isAssistantContextPlanReceipt(receipt), true)
  assert.equal(receipt.sourceManifest[0]?.sourceId, 'memory-receipt')
  assert.equal(JSON.stringify(receipt).includes('raw context must never enter a receipt'), false)
  assert.equal(
    runtimeModule.isAssistantContextPlanReceipt({ ...receipt, rawContext: 'must fail closed' }),
    false,
    'receipt validation rejects uncontracted raw-context fields',
  )
}

async function assertAssistantRunResetCascade(persistence, storage) {
  const database = await storage.get()
  for (const table of [
    'assistant_runs',
    'assistant_run_journal',
    'assistant_run_request_snapshots',
  ]) {
    const before = await database.getFirst(`SELECT COUNT(*) AS count FROM ${table}`)
    assert.ok(Number(before?.count) > 0, `${table} contains durable run evidence before reset`)
  }

  await persistence.clear()

  for (const table of [
    'assistant_runs',
    'assistant_run_journal',
    'assistant_run_request_snapshots',
  ]) {
    const after = await database.getFirst(`SELECT COUNT(*) AS count FROM ${table}`)
    assert.equal(Number(after?.count), 0, `${table} is cleared through the AssistantRun reset boundary`)
  }
}

async function assertPreparedModelOperationRequestSnapshot(
  core,
  runtimeModule,
  providersModule,
  persistence,
  ids,
) {
  const events = []
  let now = 80_000
  let dispatchedRequest
  const providerId = 'prepared-request-provider'
  const adapter = {
    providerId,
    capabilities: ['chat', 'tools'],
    async *stream(request) {
      events.push('dispatch')
      dispatchedRequest = request
      yield { type: 'text-delta', text: 'Prepared request.' }
    },
  }
  const assistantRuntime = runtimeModule.createAssistantRuntime({
    clock: { now: () => ++now },
    ids,
    providerGateway: providersModule.createProviderGateway([adapter]),
    persistence,
  })
  const runId = core.asAssistantRunId('run-prepared-request-snapshot')
  const contextReceipt = {
    schema: 'islemind.assistant-context-plan-receipt.v1',
    providerId,
    model: 'prepared-request-model',
    manifestId: 'context-manifest-fixture',
    budget: {
      modelContextWindow: 8_192,
      requestBudgetTokens: 6_000,
      contextPromptTokens: 40,
      estimatedInputTokens: 120,
      fixedTokens: 20,
      messageTokens: 60,
      includedFragmentTokens: 40,
      originalFragmentTokens: 80,
      totalTokenCap: 100,
      activeContextTokens: 100,
      tokensUntilCompaction: 5_000,
    },
    compression: {
      triggered: true,
      strategy: 'structured-v2',
      triggerReason: 'message_budget_exceeded',
      sourceMessageCount: 8,
      keptMessageCount: 4,
      sourceTokens: 240,
      compressedTokens: 120,
      estimatedSavedTokens: 120,
      compressionRatio: 0.5,
      summaryTokens: 32,
      summarySectionCount: 4,
    },
    sourceManifest: [{
      fragmentId: 'fragment-fixture',
      type: 'memory',
      priority: 'high',
      sourceId: 'memory-fixture',
      decision: 'included',
      tokenCap: 80,
      estimatedTokens: 40,
      originalEstimatedTokens: 80,
      authority: 'user-private',
    }],
    failureCodes: [],
  }
  const result = await assistantRuntime.execute({
    runId,
    request: {
      schema: core.CHAT_REQUEST_SCHEMA,
      conversationId: 'conversation-prepared-request',
      providerId,
      model: 'prepared-request-model',
      messages: [{ id: 'prepared-message', role: 'user', text: 'Use the admitted operation.' }],
      generationParameterSources: {},
    },
    context: {
      schema: 'islemind.context-snapshot.v1',
      id: core.asContextSnapshotId('context-prepared-request'),
      createdAt: now,
      conversationMessageIds: ['prepared-message'],
      memoryIds: [],
      knowledgeSourceIds: [],
      attachmentIds: [],
      approvedToolContextIds: [],
    },
    contextReceipt,
    modelOperationSession: {
      prepareRequest(request) {
        events.push('prepare')
        return {
          ...request,
          requestedCapabilities: ['tools'],
          toolDefinitions: [{
            operationId: 'builtin:fixture:read',
            name: 'fixture_read',
            description: 'Read the bounded fixture.',
            inputSchema: { type: 'object', additionalProperties: false },
            permission: 'read-only',
          }],
        }
      },
      async evaluateTurn() {
        return { kind: 'no-operation' }
      },
      validatePending() {
        return false
      },
      async resume() {
        throw new Error('This fixture never resumes.')
      },
    },
    async onPersisted(event) {
      if (event.journalEntry.type !== 'run.created') return
      events.push('run.created')
      assert.ok(
        await persistence.getRequestSnapshot(event.run.id),
        'run.created projection observes the prepared request only after its atomic persistence',
      )
    },
  })
  assert.equal(result.ok, true, 'model-operation request preparation still reaches provider dispatch')
  if (!result.ok) throw new Error(result.error.message)
  const snapshot = await persistence.getRequestSnapshot(runId)
  assert.ok(snapshot)
  assert.deepEqual(snapshot.request, dispatchedRequest)
  assert.deepEqual(snapshot.contextReceipt, contextReceipt)
  assert.equal(Object.isFrozen(snapshot.contextReceipt), true)
  const latestContextReceipt = await persistence.getLatestContextReceipt('conversation-prepared-request')
  assert.ok(
    latestContextReceipt,
    'the conversation-scoped read finds the receipt captured beside the frozen request',
  )
  assert.equal(latestContextReceipt.runId, runId)
  assert.equal(latestContextReceipt.capturedAt, snapshot.capturedAt)
  assert.deepEqual(latestContextReceipt.receipt, contextReceipt)
  assert.equal(Object.isFrozen(latestContextReceipt.receipt), true, 'the receipt read is immutable')
  assert.equal(
    await persistence.getLatestContextReceipt('conversation-prepared-request-absent'),
    undefined,
    'a conversation with no captured receipt reports no context capacity data',
  )
  assert.equal(snapshot.request.toolDefinitions?.[0]?.operationId, 'builtin:fixture:read')
  assert.deepEqual(
    events.slice(0, 3),
    ['prepare', 'run.created', 'dispatch'],
    'model-operation declarations are frozen and persisted before provider dispatch',
  )
}

async function seedConversationTable(storage) {
  const database = await storage.get()
  await database.exec(`
    CREATE TABLE conversation_records (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      providerId TEXT NOT NULL,
      model TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      payloadJson TEXT NOT NULL
    );
  `)
}

async function assertConversationLegacyMigration(conversationsModule) {
  const database = new Database(':memory:')
  try {
    const storage = createBunSqliteStorage(database)
    await seedConversationTable(storage)
    const executor = await storage.get()
    await executor.run(
      'INSERT INTO conversation_records (id, title, providerId, model, updatedAt, payloadJson) VALUES (?, ?, ?, ?, ?, ?)',
      [
        'conversation-valid-legacy',
        'Valid legacy',
        'walking-provider',
        'walking-model',
        1,
        JSON.stringify({
          schema: conversationsModule.CONVERSATION_SNAPSHOT_SCHEMA,
          id: 'conversation-valid-legacy',
          title: 'Valid legacy',
          providerId: 'walking-provider',
          model: 'walking-model',
          systemPrompt: '',
          temperature: 0.7,
          maxTokens: 512,
          messages: [{
            id: 'legacy-message',
            role: 'user',
            content: 'Migrated',
            timestamp: 1,
            status: 'done',
          }],
          createdAt: 1,
          updatedAt: 1,
        }),
      ],
    )
    await executor.run(
      'INSERT INTO conversation_records (id, title, providerId, model, updatedAt, payloadJson) VALUES (?, ?, ?, ?, ?, ?)',
      ['conversation-invalid-legacy', 'Invalid legacy', 'walking-provider', 'walking-model', 2, '{not-json'],
    )

    const conversations = conversationsModule.createSqliteConversationRepository(storage)
    const loaded = await conversations.loadAll()
    assert.deepEqual(loaded.map((conversation) => conversation.id), ['conversation-valid-legacy'])
    assert.deepEqual(
      (await conversations.get('conversation-valid-legacy'))?.messages.map((message) => message.id),
      ['legacy-message'],
      'valid legacy rows migrate to normalized state and message rows during repository initialization',
    )
    const legacyColumns = await executor.getAll('PRAGMA table_info(conversation_records)')
    assert.equal(
      legacyColumns.some((column) => column.name === 'payloadJson'),
      true,
      'a malformed legacy row keeps the old payload column for a later lossless retry',
    )
    await assert.rejects(
      () => conversations.get('conversation-invalid-legacy'),
      /persisted conversation record is invalid/i,
      'a malformed legacy row fails closed when addressed by id without blocking valid migration',
    )
    await assert.rejects(
      () => conversations.loadReplacementSnapshot(),
      /persisted conversation record is invalid/i,
      'strict recovery rejects record/state coverage drift from an unmigrated legacy row',
    )
    await executor.run(
      'DELETE FROM conversation_records WHERE id = ?',
      ['conversation-invalid-legacy'],
    )
    const repairedConversations = conversationsModule.createSqliteConversationRepository(storage)
    const recovered = await repairedConversations.loadReplacementSnapshot()
    const repairedColumnsAfterRead = await executor.getAll('PRAGMA table_info(conversation_records)')
    assert.equal(
      repairedColumnsAfterRead.some((column) => column.name === 'payloadJson'),
      false,
      'a fresh repository retries the pending migration after the malformed row is removed',
    )
    assert.deepEqual(
      recovered.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        messageIds: conversation.messages.map((message) => message.id),
      })),
      [{
        id: 'conversation-valid-legacy',
        title: 'Valid legacy',
        messageIds: ['legacy-message'],
      }],
      'strict recovery returns the fully migrated legacy conversation from normalized rows',
    )
  } finally {
    database.close()
  }
}

async function assertAssistantRunWorkspaceWritebackMigration(core, runtimeModule) {
  for (const sourceVersion of [1, 2, 3]) {
    await assertLegacyAssistantRunWorkspaceWritebackMigration(
      core,
      runtimeModule,
      sourceVersion,
    )
  }
}

async function assertLegacyAssistantRunWorkspaceWritebackMigration(
  core,
  runtimeModule,
  sourceVersion,
) {
  const database = new Database(':memory:')
  try {
    const storage = createBunSqliteStorage(database)
    const executor = await storage.get()
    const versionedColumns = [
      sourceVersion >= 2 ? "kind TEXT NOT NULL DEFAULT 'chat'" : undefined,
      sourceVersion >= 3 ? 'pendingModelOperationJson TEXT' : undefined,
    ].filter(Boolean)
    await executor.exec(`
      CREATE TABLE platform_schema_migrations (
        scope TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        appliedAt INTEGER NOT NULL,
        PRIMARY KEY (scope, version)
      );
      CREATE TABLE assistant_runs (
        id TEXT PRIMARY KEY NOT NULL,
        conversationId TEXT NOT NULL,
        responseMessageId TEXT,
        providerId TEXT NOT NULL,
        model TEXT NOT NULL,
        contextSnapshotId TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        startedAt INTEGER,
        cancellationRequestedAt INTEGER,
        completedAt INTEGER,
        journalSequence INTEGER NOT NULL,
        checkpointJson TEXT,
        resultJson TEXT,
        failureJson TEXT,
        schema TEXT NOT NULL
        ${versionedColumns.length > 0 ? `, ${versionedColumns.join(', ')}` : ''}
      );
    `)
    const migrationNames = [
      'assistant-runs-and-journal',
      'assistant-run-kind',
      'pending-model-operation',
    ]
    for (let version = 1; version <= sourceVersion; version += 1) {
      await executor.run(
        'INSERT INTO platform_schema_migrations (scope, version, name, appliedAt) VALUES (?, ?, ?, ?)',
        ['assistant-runtime', version, migrationNames[version - 1], version],
      )
    }
    const legacyRunId = core.asAssistantRunId(`run-workspace-handoff-v${sourceVersion}`)
    await executor.run(
      `INSERT INTO assistant_runs (
         id, conversationId, responseMessageId, providerId, model,
         contextSnapshotId, status, createdAt, journalSequence, schema
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        legacyRunId,
        `conversation-v${sourceVersion}`,
        `assistant-message-v${sourceVersion}`,
        `provider-v${sourceVersion}`,
        `model-v${sourceVersion}`,
        `context-v${sourceVersion}`,
        'queued',
        sourceVersion,
        0,
        'islemind.assistant-run.v1',
      ],
    )

    const persistence = runtimeModule.createSqliteAssistantRunPersistence(storage)
    const legacyRun = await persistence.get(legacyRunId)
    assert.equal(
      legacyRun?.workspaceWritebackHandoff,
      undefined,
      `v${sourceVersion} AssistantRun rows migrate to v4 with no synthesized workspace handoff`,
    )
    assert.equal(
      legacyRun?.kind,
      'chat',
      `v${sourceVersion} AssistantRun rows preserve the historical default Chat kind`,
    )
    assert.equal(
      await persistence.getRequestSnapshot(legacyRunId),
      undefined,
      `v${sourceVersion} AssistantRun rows remain readable without inventing an exact request snapshot`,
    )
    const columns = await executor.getAll('PRAGMA table_info(assistant_runs)')
    assert.ok(
      columns.some((column) => column.name === 'workspaceWritebackHandoffJson'),
      `the v4 migration adds the nullable workspace handoff column to v${sourceVersion}`,
    )
    const migration = await executor.getFirst(
      'SELECT name FROM platform_schema_migrations WHERE scope = ? AND version = ?',
      ['assistant-runtime', 4],
    )
    assert.equal(migration?.name, 'workspace-writeback-handoff')
    const requestSnapshotMigration = await executor.getFirst(
      'SELECT name FROM platform_schema_migrations WHERE scope = ? AND version = ?',
      ['assistant-runtime', 6],
    )
    assert.equal(requestSnapshotMigration?.name, 'exact-provider-neutral-request')
    const requestSnapshotTable = await executor.getFirst(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      ['assistant_run_request_snapshots'],
    )
    assert.equal(requestSnapshotTable?.name, 'assistant_run_request_snapshots')
    const requestSnapshotColumns = await executor.getAll('PRAGMA table_info(assistant_run_request_snapshots)')
    assert.ok(
      requestSnapshotColumns.some((column) => column.name === 'capabilityRevision') &&
        requestSnapshotColumns.some((column) => column.name === 'requestHash'),
      'the v8 migration adds nullable request identity evidence without rewriting legacy snapshots',
    )
    assert.equal(
      (await executor.getFirst(
        'SELECT name FROM platform_schema_migrations WHERE scope = ? AND version = ?',
        ['assistant-runtime', 8],
      ))?.name,
      'request-identity-evidence',
    )
  } finally {
    database.close()
  }
}

async function assertAssistantRunKindMigration(core, runtimeModule) {
  const database = new Database(':memory:')
  try {
    const storage = createBunSqliteStorage(database)
    const executor = await storage.get()
    await executor.exec(`
      CREATE TABLE platform_schema_migrations (
        scope TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        appliedAt INTEGER NOT NULL,
        PRIMARY KEY (scope, version)
      );
      CREATE TABLE assistant_runs (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL DEFAULT 'chat',
        conversationId TEXT NOT NULL,
        responseMessageId TEXT,
        workspaceWritebackHandoffJson TEXT,
        providerId TEXT NOT NULL,
        model TEXT NOT NULL,
        contextSnapshotId TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        startedAt INTEGER,
        cancellationRequestedAt INTEGER,
        completedAt INTEGER,
        journalSequence INTEGER NOT NULL,
        checkpointJson TEXT,
        resultJson TEXT,
        failureJson TEXT,
        pendingModelOperationJson TEXT,
        schema TEXT NOT NULL
      );
      CREATE TABLE assistant_run_journal (
        runId TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        occurredAt INTEGER NOT NULL,
        dataJson TEXT,
        schema TEXT NOT NULL,
        PRIMARY KEY (runId, sequence),
        FOREIGN KEY (runId) REFERENCES assistant_runs(id) ON DELETE CASCADE
      );
    `)
    const migrationNames = [
      'assistant-runs-and-journal',
      'assistant-run-kind',
      'pending-model-operation',
      'workspace-writeback-handoff',
    ]
    for (let version = 1; version <= 4; version += 1) {
      await executor.run(
        'INSERT INTO platform_schema_migrations (scope, version, name, appliedAt) VALUES (?, ?, ?, ?)',
        ['assistant-runtime', version, migrationNames[version - 1], version],
      )
    }

    const statuses = ['queued', 'running', 'awaiting-confirmation', 'succeeded', 'failed', 'cancelled']
    for (const [index, status] of statuses.entries()) {
      await executor.run(
        `INSERT INTO assistant_runs (
           id, kind, conversationId, responseMessageId, providerId, model,
           contextSnapshotId, status, createdAt, journalSequence, schema
         ) VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          core.asAssistantRunId(`legacy-agent-${status}`),
          `legacy-agent-conversation-${status}`,
          `legacy-agent-message-${status}`,
          'islemind-activity',
          'agent',
          `legacy-agent-context-${status}`,
          status,
          index + 1,
          'islemind.assistant-run.v1',
        ],
      )
    }
    await executor.run(
      `UPDATE assistant_runs
       SET journalSequence = 2, startedAt = 20
       WHERE id = ?`,
      [core.asAssistantRunId('legacy-agent-running')],
    )
    await executor.run(
      `INSERT INTO assistant_run_journal (runId, sequence, type, occurredAt, dataJson, schema)
       VALUES (?, 1, 'run.created', 10, ?, ?), (?, 2, 'run.started', 20, NULL, ?)`,
      [
        core.asAssistantRunId('legacy-agent-running'),
        JSON.stringify({ executionKind: 'agent', source: 'v4-fixture' }),
        'islemind.assistant-run-journal-entry.v1',
        core.asAssistantRunId('legacy-agent-running'),
        'islemind.assistant-run-journal-entry.v1',
      ],
    )

    const persistence = runtimeModule.createSqliteAssistantRunPersistence(storage)
    await assert.rejects(
      () => persistence.get(core.asAssistantRunId('legacy-agent-queued')),
      /assistant run kind is invalid/i,
      'the v5 tombstone no longer rewrites an older Agent row',
    )
    const migratedRows = await executor.getAll('SELECT id, kind, status FROM assistant_runs ORDER BY createdAt ASC')
    assert.deepEqual(
      migratedRows.map((row) => ({ id: row.id, kind: row.kind, status: row.status })),
      statuses.map((status) => ({ id: `legacy-agent-${status}`, kind: 'agent', status })),
      'the v5 tombstone does not mutate unsupported older rows',
    )
    const migratedJournal = await persistence.list(core.asAssistantRunId('legacy-agent-running'))
    assert.deepEqual(
      migratedJournal,
      [
        {
          schema: 'islemind.assistant-run-journal-entry.v1',
          runId: core.asAssistantRunId('legacy-agent-running'),
          sequence: 1,
          type: 'run.created',
          occurredAt: 10,
          data: { executionKind: 'agent', source: 'v4-fixture' },
        },
        {
          schema: 'islemind.assistant-run-journal-entry.v1',
          runId: core.asAssistantRunId('legacy-agent-running'),
          sequence: 2,
          type: 'run.started',
          occurredAt: 20,
        },
      ],
      'the inert v5 ledger entry leaves existing journal bytes unchanged',
    )
    const migration = await executor.getFirst(
      'SELECT name FROM platform_schema_migrations WHERE scope = ? AND version = ?',
      ['assistant-runtime', 5],
    )
    assert.equal(migration?.name, 'chat-owned-run-kind')
    assert.equal(
      (await executor.getFirst(
        'SELECT name FROM platform_schema_migrations WHERE scope = ? AND version = ?',
        ['assistant-runtime', 6],
      ))?.name,
      'exact-provider-neutral-request',
      'the request snapshot migration is additive after the inert v5 run-kind ledger entry',
    )

    const lateLegacyRunId = core.asAssistantRunId('late-legacy-agent-run')
    await executor.run(
      `INSERT INTO assistant_runs (
         id, kind, conversationId, responseMessageId, providerId, model,
         contextSnapshotId, status, createdAt, journalSequence, schema
       ) VALUES (?, 'agent', ?, ?, ?, ?, ?, 'queued', ?, 0, ?)`,
      [
        lateLegacyRunId,
        'late-legacy-agent-conversation',
        'late-legacy-agent-message',
        'islemind-activity',
        'agent',
        'late-legacy-agent-context',
        statuses.length + 1,
        'islemind.assistant-run.v1',
      ],
    )
    await assert.rejects(
      () => persistence.get(lateLegacyRunId),
      /assistant run kind is invalid/i,
      'an Agent discriminator written after v5 is rejected',
    )

    const legacyCallerRun = Object.freeze({
      id: lateLegacyRunId,
      kind: 'agent',
      conversationId: 'late-legacy-agent-conversation',
      responseMessageId: 'late-legacy-agent-message',
      providerId: 'islemind-activity',
      model: 'agent',
      contextSnapshotId: core.asContextSnapshotId('late-legacy-agent-context'),
      status: 'queued',
      createdAt: statuses.length + 1,
      journalSequence: 0,
    })
    await assert.rejects(
      () => persistence.save(legacyCallerRun),
      /assistant run kind is invalid/i,
      'save rejects forged Agent input before writing',
    )
    assert.equal(
      (await executor.getFirst('SELECT kind FROM assistant_runs WHERE id = ?', [lateLegacyRunId]))?.kind,
      'agent',
      'rejected save leaves the existing row unchanged',
    )

    const unknownRunId = core.asAssistantRunId('unknown-kind-run')
    await executor.run(
      `INSERT INTO assistant_runs (
         id, kind, conversationId, responseMessageId, providerId, model,
         contextSnapshotId, status, createdAt, journalSequence, schema
       ) VALUES (?, 'unknown', ?, ?, ?, ?, ?, 'queued', ?, 0, ?)`,
      [
        unknownRunId,
        'unknown-kind-conversation',
        'unknown-kind-message',
        'fixture-provider',
        'fixture-model',
        'unknown-kind-context',
        statuses.length + 2,
        'islemind.assistant-run.v1',
      ],
    )
    await assert.rejects(
      () => persistence.get(unknownRunId),
      /assistant run kind is invalid/i,
      'unknown durable run kinds fail closed',
    )
  } finally {
    database.close()
  }
}

function assertConversationSnapshotContracts(core, conversationsModule) {
  const v2 = conversationsModule.parseConversationSnapshot({
    schema: conversationsModule.CONVERSATION_SNAPSHOT_SCHEMA,
    id: 'conversation-v2-round-trip',
    providerId: 'provider-v2',
    model: 'model-v2',
    systemPrompt: 'Keep the contract stable.',
    temperature: 0.4,
    topP: 0.8,
    topK: 24,
    reasoningEffort: 'high',
    maxTokens: 512,
    generationParameterOverrides: { temperature: true, topP: false, topK: true, maxTokens: true },
    messages: [{ id: 'message-v2', role: 'user', text: 'Round trip' }],
  })
  assert.ok(v2, 'v2 conversation snapshots parse')
  assert.deepEqual(
    conversationsModule.parseConversationSnapshot(JSON.parse(JSON.stringify(v2))),
    v2,
    'v2 conversation snapshots round-trip their provider-neutral generation contract',
  )
  assert.equal(v2.reasoningEffort, 'high')
  assert.deepEqual(v2.generationParameterOverrides, { temperature: true, topK: true, maxTokens: true })

  const providerDefault = conversationsModule.parseConversationSnapshot({
    schema: conversationsModule.CONVERSATION_SNAPSHOT_SCHEMA,
    id: 'conversation-v2-provider-default',
    providerId: 'provider-v2',
    model: 'model-v2',
    temperature: 0.3,
    maxTokens: 256,
    generationParameterOverrides: {},
    messages: [{ id: 'message-default', role: 'user', content: 'Use defaults' }],
  })
  assert.deepEqual(
    core.resolveGenerationParameterSources({ values: providerDefault, overrides: providerDefault.generationParameterOverrides }),
    { temperature: 'provider-default', topP: 'provider-default', topK: 'provider-default', maxTokens: 'provider-default' },
    'an explicit empty override map means provider defaults',
  )

  const legacy = conversationsModule.parseConversationSnapshot({
    id: 'conversation-legacy',
    providerId: 'provider-legacy',
    model: 'model-legacy',
    temperature: 0.6,
    maxTokens: 384,
    messages: [{ id: 'message-legacy', role: 'user', content: 'Legacy' }],
  })
  assert.equal(legacy.schema, conversationsModule.CONVERSATION_SNAPSHOT_SCHEMA, 'unversioned conversations upgrade to v2 snapshots')
  assert.equal(legacy.generationParameterOverrides, undefined, 'legacy records stay distinguishable until a later save materializes overrides')
  assert.deepEqual(
    core.resolveGenerationParameterSources({ values: legacy, overrides: legacy.generationParameterOverrides }),
    { temperature: 'explicit', maxTokens: 'explicit' },
    'legacy finite values remain explicit for request compatibility',
  )
  assert.ok(conversationsModule.parseConversationSnapshot({ ...legacy, schema: 'islemind.conversation-snapshot.v1' }), 'v1 snapshots remain readable')
  assert.equal(conversationsModule.parseConversationSnapshot({ ...legacy, schema: 'islemind.conversation-snapshot.v99' }), undefined, 'unknown snapshot versions fail closed')
  assert.equal(conversationsModule.parseConversationSnapshot({ ...legacy, reasoningEffort: 'extreme' }), undefined, 'unknown reasoning values fail closed')
  assert.equal(conversationsModule.parseConversationSnapshot({ ...legacy, generationParameterOverrides: { temperature: 'explicit' } }), undefined, 'invalid override sources fail closed')
}

async function assertAtomicJournalAndRunState(core, persistence) {
  const runId = core.asAssistantRunId('run-atomic')
  const baseRun = {
    id: runId,
    kind: 'chat',
    conversationId: 'conversation-walking-skeleton',
    providerId: 'walking-provider',
    model: 'walking-model',
    contextSnapshotId: core.asContextSnapshotId('context-atomic'),
    status: 'queued',
    createdAt: 1,
    journalSequence: 0,
  }
  await persistence.save(baseRun)
  const entry = {
    schema: 'islemind.assistant-run-journal-entry.v1',
    runId,
    sequence: 1,
    type: 'run.created',
    occurredAt: 1,
  }
  const requestSnapshot = {
    schema: 'islemind.assistant-run-request-snapshot.v1',
    runId,
    capturedAt: entry.occurredAt,
    request: {
      schema: core.CHAT_REQUEST_SCHEMA,
      conversationId: baseRun.conversationId,
      providerId: baseRun.providerId,
      model: baseRun.model,
      messages: [{ id: 'message-atomic', role: 'user', text: 'Persist atomically.' }],
      generationParameterSources: {},
    },
  }
  await persistence.appendAndSave(entry, { ...baseRun, journalSequence: 1 }, requestSnapshot)

  await assert.rejects(
    persistence.appendAndSave(
      entry,
      { ...baseRun, status: 'running', journalSequence: 1, startedAt: 2 },
      requestSnapshot,
    ),
    'a duplicate journal write fails inside the transaction',
  )
  const stored = await persistence.get(runId)
  assert.equal(stored.kind, 'chat', 'run envelopes retain the required Chat kind')
  assert.equal(stored.status, 'queued', 'a failed journal insert cannot leave a new run state behind')
  assert.equal(stored.journalSequence, 1)
  assert.deepEqual(
    await persistence.getRequestSnapshot(runId),
    requestSnapshot,
    'run.created atomically retains the original exact request when a duplicate transition rolls back',
  )
}

async function assertChatActivityPersistence(core, runtimeModule, assistantRuntime, persistence, storage) {
  const runId = core.asAssistantRunId('run-chat-activity')
  const activityContextReceipt = {
    schema: 'islemind.assistant-context-plan-receipt.v1',
    providerId: 'activity-provider',
    model: 'activity-model',
    budget: {
      modelContextWindow: 4_096,
      requestBudgetTokens: 3_000,
      contextPromptTokens: 20,
      estimatedInputTokens: 80,
      fixedTokens: 10,
      messageTokens: 50,
      includedFragmentTokens: 20,
      originalFragmentTokens: 20,
      totalTokenCap: 20,
      activeContextTokens: 70,
      tokensUntilCompaction: 2_500,
    },
    compression: {
      triggered: false,
      strategy: 'none',
      triggerReason: 'disabled_or_unneeded',
      sourceMessageCount: 1,
      keptMessageCount: 1,
      sourceTokens: 50,
      compressedTokens: 50,
      estimatedSavedTokens: 0,
      compressionRatio: 1,
      summaryTokens: 0,
      summarySectionCount: 0,
    },
    sourceManifest: [],
    failureCodes: [],
  }
  const canonicalRequest = Object.freeze({
    schema: core.CHAT_REQUEST_SCHEMA,
    conversationId: 'conversation-walking-skeleton',
    providerId: 'activity-provider',
    model: 'activity-model',
    messages: Object.freeze([Object.freeze({
      id: 'message-activity',
      role: 'user',
      text: 'Durable activity.',
    })]),
    generationParameterSources: Object.freeze({ temperature: 'explicit' }),
    requestedCapabilities: Object.freeze(['attachments', 'provider-tools', 'remote-compact']),
    toolDefinitions: Object.freeze([Object.freeze({
      operationId: 'builtin:read_workspace',
      name: 'islemind_builtin_read_workspace',
      description: 'Read the current workspace.',
      inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
      permission: 'read-only',
    })]),
  })
  const workspaceWritebackHandoff = createWorkspaceWritebackHandoff({
    runId,
    conversationId: 'conversation-walking-skeleton',
    assistantMessageId: 'assistant-chat-message-1',
    suffix: 'activity',
  })
  const database = await storage.get()
  let runCreatedRow
  let runCreatedRequestSnapshot
  const persistedTransitions = []
  const result = await assistantRuntime.executeActivity({
    runId,
    kind: 'chat',
    conversationId: 'conversation-walking-skeleton',
    responseMessageId: 'assistant-chat-message-1',
    providerId: 'activity-provider',
    model: 'activity-model',
    request: canonicalRequest,
    contextReceipt: activityContextReceipt,
    workspaceWritebackHandoff,
    context: {
      schema: 'islemind.context-snapshot.v1',
      id: core.asContextSnapshotId('context-chat-activity'),
      createdAt: 2,
      conversationMessageIds: ['message-1'],
      memoryIds: [],
      knowledgeSourceIds: [],
      attachmentIds: [],
      approvedToolContextIds: [],
    },
    executor: {
      async execute({ run, checkpointStreamEvent, checkpointTextDelta }) {
        assert.equal(run.kind, 'chat')
        assert.equal(
          run.workspaceWritebackHandoff,
          workspaceWritebackHandoff,
          'the activity executor receives the exact handoff persisted with run.created',
        )
        await checkpointStreamEvent?.({
          type: 'citation',
          citationId: 'activity-citation',
          title: 'Durable citation',
          url: 'https://example.com/source',
        })
        await checkpointTextDelta?.('Durable ')
        await checkpointStreamEvent?.({
          type: 'tool-call',
          toolCallId: 'activity-tool-call',
          toolName: 'read_workspace',
        })
        await checkpointStreamEvent?.({
          type: 'usage',
          inputTokens: 11,
          outputTokens: 7,
          totalTokens: 18,
        })
        await checkpointStreamEvent?.({
          type: 'trace',
          traceId: 'activity-trace',
          traceType: 'system',
          traceStatus: 'done',
          title: 'Provider request',
        })
        await checkpointTextDelta?.('Chat activity.')
        return {}
      },
    },
    async onPersisted(event) {
      persistedTransitions.push(event)
      if (event.journalEntry.type !== 'run.created') return
      runCreatedRow = await database.getFirst(
        'SELECT workspaceWritebackHandoffJson FROM assistant_runs WHERE id = ?',
        [runId],
      )
      runCreatedRequestSnapshot = await persistence.getRequestSnapshot(runId)
    },
  })
  assert.equal(result.ok, true, 'activity runs persist through the same SQLite journal')
  if (!result.ok) throw new Error(result.error.message)
  assert.equal(result.value.kind, 'chat')
  assert.equal(result.value.result?.outputText, 'Durable Chat activity.')
  assert.equal(result.value.result?.streamEventCount, 6, 'activity checkpoints preserve every normalized durable stream event')
  assert.equal(
    persistedTransitions[0].run.workspaceWritebackHandoff,
    workspaceWritebackHandoff,
    'run.created projects the exact frozen handoff identity only after persistence',
  )
  assert.ok(
    persistedTransitions.every((event) => event.run.workspaceWritebackHandoff === workspaceWritebackHandoff),
    'every in-process run transition preserves the exact handoff identity',
  )
  assert.deepEqual(
    JSON.parse(runCreatedRow.workspaceWritebackHandoffJson),
    workspaceWritebackHandoff,
    'run.created atomically persists the full workspace handoff before projection',
  )
  assert.equal(
    runCreatedRequestSnapshot?.schema,
    'islemind.assistant-run-request-snapshot.v1',
    'run.created projects the canonical Rich request only after atomic persistence',
  )
  assert.deepEqual(
    runCreatedRequestSnapshot?.request,
    canonicalRequest,
    'the Rich activity snapshot retains the exact provider-neutral request used by Plain runs',
  )
  assert.deepEqual(
    runCreatedRequestSnapshot?.contextReceipt,
    activityContextReceipt,
    'Rich and Plain snapshots project the bounded context receipt in the same field',
  )
  assert.equal(
    runCreatedRequestSnapshot?.requestHash,
    runtimeModule.buildAssistantRequestHash(canonicalRequest),
    'Rich and Plain snapshots hash the exact canonical request identically',
  )
  assert.equal(
    runCreatedRequestSnapshot?.capabilityRevision,
    runtimeModule.buildAssistantCapabilityRevision(canonicalRequest),
    'Rich and Plain snapshots derive capability revision from the same canonical request projection',
  )
  assert.equal(Object.isFrozen(runCreatedRequestSnapshot), true)
  assert.equal(Object.isFrozen(runCreatedRequestSnapshot?.request), true)
  assert.equal(Object.isFrozen(runCreatedRequestSnapshot?.request.toolDefinitions), true)
  await database.run(
    'UPDATE assistant_run_request_snapshots SET requestHash = ? WHERE runId = ?',
    ['stable-v1:0000000000000000', runId],
  )
  await assert.rejects(
    () => persistence.getRequestSnapshot(runId),
    /assistant request hash does not match/i,
    'durable request identity evidence is bound to the stored canonical request on read',
  )
  const activityJournal = await persistence.list(runId)
  assert.deepEqual(activityJournal.map((entry) => entry.type), [
    'run.created',
    'run.started',
    'stream.event',
    'stream.event',
    'stream.event',
    'stream.event',
    'stream.event',
    'stream.event',
    'run.succeeded',
  ])
  assert.deepEqual(
    activityJournal.slice(2, 8).map((entry) => entry.data),
    [
      {
        eventType: 'citation',
        citationId: 'activity-citation',
        title: 'Durable citation',
        url: 'https://example.com/source',
      },
      { eventType: 'text-delta', text: 'Durable ' },
      {
        eventType: 'tool-call',
        toolCallId: 'activity-tool-call',
        toolName: 'read_workspace',
      },
      {
        eventType: 'usage',
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
      },
      {
        eventType: 'trace',
        traceId: 'activity-trace',
        traceType: 'system',
        traceStatus: 'done',
        title: 'Provider request',
      },
      { eventType: 'text-delta', text: 'Chat activity.' },
    ],
    'activity checkpoints journal bounded citation, text, tool, usage, and trace evidence',
  )
  assert.deepEqual(
    persistedTransitions.at(-2).run.checkpoint,
    { outputText: 'Durable Chat activity.', streamEventCount: 6 },
    'the final normalized stream event atomically projects the accumulated checkpoint',
  )
  const row = await database.getFirst(
    'SELECT kind, workspaceWritebackHandoffJson FROM assistant_runs WHERE id = ?',
    [runId],
  )
  assert.equal(row?.kind, 'chat', 'SQLite persistence records the Chat-owned activity kind')
  assert.deepEqual(
    JSON.parse(row?.workspaceWritebackHandoffJson),
    workspaceWritebackHandoff,
    'SQLite round-trips the exact populated workspace handoff envelope',
  )
  const stored = await persistence.get(runId)
  assert.deepEqual(stored?.workspaceWritebackHandoff, workspaceWritebackHandoff)
  assert.equal(Object.isFrozen(stored?.workspaceWritebackHandoff), true, 'decoded workspace handoff evidence is immutable')

  let invalidRequestExecutorCalls = 0
  const invalidRequestRunId = core.asAssistantRunId('run-chat-activity-invalid-request')
  const invalidRequestResult = await assistantRuntime.executeActivity({
    runId: invalidRequestRunId,
    kind: 'chat',
    conversationId: 'conversation-walking-skeleton',
    providerId: 'activity-provider',
    model: 'activity-model',
    request: {
      ...canonicalRequest,
      conversationId: 'different-conversation',
    },
    contextReceipt: activityContextReceipt,
    context: {
      schema: 'islemind.context-snapshot.v1',
      id: core.asContextSnapshotId('context-chat-activity-invalid-request'),
      createdAt: 3,
      conversationMessageIds: [],
      memoryIds: [],
      knowledgeSourceIds: [],
      attachmentIds: [],
      approvedToolContextIds: [],
    },
    executor: {
      async execute() {
        invalidRequestExecutorCalls += 1
        return { outputText: 'must not execute' }
      },
    },
  })
  assert.equal(invalidRequestResult.ok, false, 'identity-mismatched canonical activity requests fail closed')
  if (invalidRequestResult.ok) throw new Error('Expected invalid canonical activity request to fail.')
  assert.equal(invalidRequestResult.error.code, 'activity_failed')
  assert.equal(invalidRequestExecutorCalls, 0)
  assert.equal(await persistence.get(invalidRequestRunId), undefined)
  assert.equal(await persistence.getRequestSnapshot(invalidRequestRunId), undefined)

  const validJson = row.workspaceWritebackHandoffJson
  const invalidHandoffs = [
    '{"schema":"invalid"}',
    JSON.stringify({ ...workspaceWritebackHandoff, assistantRunId: 'assistant-run:mismatch' }),
    JSON.stringify({ ...workspaceWritebackHandoff, conversationId: 'conversation-mismatch' }),
    JSON.stringify({ ...workspaceWritebackHandoff, assistantMessageId: 'assistant-message-mismatch' }),
  ]
  for (const invalidJson of invalidHandoffs) {
    await database.run(
      'UPDATE assistant_runs SET workspaceWritebackHandoffJson = ? WHERE id = ?',
      [invalidJson, runId],
    )
    await assert.rejects(
      persistence.get(runId),
      (error) => error?.name === 'AssistantRunPersistenceDataError',
      'malformed or identity-mismatched persisted handoffs fail closed',
    )
  }
  await database.run(
    'UPDATE assistant_runs SET workspaceWritebackHandoffJson = ? WHERE id = ?',
    [validJson, runId],
  )
}

async function assertChatActivityCancellationPreservesWorkspaceWritebackHandoff(
  core,
  assistantRuntime,
  persistence,
) {
  const runId = core.asAssistantRunId('run-chat-activity-cancelled')
  const conversationId = 'conversation-walking-skeleton'
  const assistantMessageId = 'assistant-chat-message-cancelled'
  const workspaceWritebackHandoff = createWorkspaceWritebackHandoff({
    runId,
    conversationId,
    assistantMessageId,
    suffix: 'cancelled',
  })
  const cancellation = new AbortController()
  let executorEntered
  const entered = new Promise((resolve) => { executorEntered = resolve })
  const execution = assistantRuntime.executeActivity({
    runId,
    kind: 'chat',
    conversationId,
    responseMessageId: assistantMessageId,
    workspaceWritebackHandoff,
    context: {
      schema: 'islemind.context-snapshot.v1',
      id: core.asContextSnapshotId('context-chat-activity-cancelled'),
      createdAt: 4,
      conversationMessageIds: ['message-1'],
      memoryIds: [],
      knowledgeSourceIds: [],
      attachmentIds: [],
      approvedToolContextIds: [],
    },
    cancellationSignal: cancellation.signal,
    executor: {
      async execute({ run, signal }) {
        assert.equal(run.workspaceWritebackHandoff, workspaceWritebackHandoff)
        executorEntered()
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
        return { outputText: 'must not succeed' }
      },
    },
  })
  await entered
  cancellation.abort('walking-skeleton-cancellation')
  const result = await execution
  assert.equal(result.ok, false, 'external cancellation terminates the durable workspace-bound activity')
  if (result.ok) throw new Error('Expected workspace-bound activity cancellation.')
  assert.equal(result.error.code, 'cancelled')
  const stored = await persistence.get(runId)
  assert.equal(stored?.status, 'cancelled')
  assert.deepEqual(
    stored?.workspaceWritebackHandoff,
    workspaceWritebackHandoff,
    'cancellation preserves durable handoff evidence without consuming it',
  )
}

function createWorkspaceWritebackHandoff({ runId, conversationId, assistantMessageId, suffix }) {
  return Object.freeze({
    schema: 'islemind.assistant-conversation-workspace-writeback-handoff.v1',
    assistantRunId: runId,
    conversationId,
    assistantMessageId,
    workspaceId: `workspace-${suffix}`,
    repositoryAuthorityRevision: 7,
    latestUserInput: `Workspace input ${suffix}`,
    selectedSceneId: `scene-${suffix}`,
    orderedCharacterIds: Object.freeze([`character-${suffix}`]),
    policy: Object.freeze({
      schema: 'islemind.assistant-conversation-workspace-writeback-policy.v1',
      summary: 'commit',
      characterUpdates: 'review',
      lorebookUpdates: 'review',
      relationshipMemoryUpdates: 'review',
      sceneUpdates: 'review',
    }),
    occurredAt: 1_700,
    idempotencyKey: `islemind.chat-workspace-writeback.v1:sha256:${(suffix === 'activity' ? 'a' : 'b').repeat(64)}`,
  })
}

async function assertAgentActivityCreationRejected(core, assistantRuntime, persistence) {
  const runId = core.asAssistantRunId('run-agent-activity-rejected')
  let executorCalls = 0
  const result = await assistantRuntime.executeActivity({
    runId,
    kind: 'agent',
    conversationId: 'conversation-walking-skeleton',
    context: {
      schema: 'islemind.context-snapshot.v1',
      id: core.asContextSnapshotId('context-agent-activity-rejected'),
      createdAt: 3,
      conversationMessageIds: [],
      memoryIds: [],
      knowledgeSourceIds: [],
      attachmentIds: [],
      approvedToolContextIds: [],
    },
    executor: {
      async execute() {
        executorCalls += 1
        return { outputText: 'must not execute' }
      },
    },
  })
  assert.equal(result.ok, false, 'the runtime rejects a new Agent-owned activity')
  if (result.ok) throw new Error('Expected Agent activity admission to fail.')
  assert.equal(result.error.code, 'activity_failed')
  assert.equal(result.error.retryable, false)
  assert.equal(executorCalls, 0, 'rejected Agent activity does not execute an effect')
  assert.equal(await persistence.get(runId), undefined, 'rejected Agent activity creates no durable run')
}

async function assertContextSnapshotPersistence(core, contextSnapshots, storage, record) {
  assert.ok(record, 'the context snapshot is available after the run commits')
  await assert.rejects(
    contextSnapshots.save(record),
    'context snapshots are immutable once their generated ID has been persisted',
  )

  const database = await storage.get()
  const corruptId = 'context-corrupt'
  await database.run(
    `INSERT INTO knowledge_context_snapshots (
       id, conversationId, requestMessageId, createdAt, payloadJson, schema
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      corruptId,
      record.conversationId,
      record.requestMessageId ?? null,
      record.snapshot.createdAt,
      JSON.stringify(record),
      record.schema,
    ],
  )
  await assert.rejects(
    contextSnapshots.get(core.asContextSnapshotId(corruptId)),
    /invalid/i,
    'the repository rejects a payload whose snapshot ID does not match its durable row',
  )
}

async function assertRestartRecovery(core, runtimeModule, conversationsModule, providersModule, persistence, conversations, ids, initialNow) {
  let now = initialNow + 1_000
  const runId = core.asAssistantRunId('run-recoverable')
  await persistence.save({
    id: runId,
    kind: 'chat',
    conversationId: 'conversation-walking-skeleton',
    providerId: 'walking-provider',
    model: 'walking-model',
    contextSnapshotId: core.asContextSnapshotId('context-recoverable'),
    status: 'running',
    createdAt: now,
    startedAt: now + 1,
    journalSequence: 2,
    checkpoint: { outputText: 'Checkpointed output', streamEventCount: 1 },
  })
  await persistence.append({
    schema: 'islemind.assistant-run-journal-entry.v1',
    runId,
    sequence: 1,
    type: 'run.created',
    occurredAt: now,
  })
  await persistence.append({
    schema: 'islemind.assistant-run-journal-entry.v1',
    runId,
    sequence: 2,
    type: 'run.started',
    occurredAt: now + 1,
  })

  const runtimeAfterRestart = runtimeModule.createAssistantRuntime({
    clock: { now: () => ++now },
    ids,
    providerGateway: providersModule.createProviderGateway([]),
    persistence,
  })
  const useCaseAfterRestart = conversationsModule.createConversationRunUseCase({
    clock: { now: () => ++now },
    ids,
    conversations,
    assistantRuntime: runtimeAfterRestart,
  })
  const recovery = await useCaseAfterRestart.recoverInterruptedRuns()

  assert.equal(recovery.ok, true, 'restart recovery uses the durable target runtime')
  if (!recovery.ok) throw new Error(recovery.error.message)
  const recovered = await persistence.get(runId)
  assert.equal(recovered.status, 'failed')
  assert.equal(recovered.failure.code, 'interrupted')
  assert.equal(recovered.checkpoint.outputText, 'Checkpointed output')
  assert.equal((await persistence.list(runId)).at(-1)?.type, 'run.failed')
}

function createBunSqliteStorage(database) {
  database.exec('PRAGMA foreign_keys = ON')
  const executor = {
    async exec(source) {
      database.exec(source)
    },
    async run(source, parameters = []) {
      const result = database.query(source).run(...parameters)
      return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }
    },
    async getFirst(source, parameters = []) {
      return database.query(source).get(...parameters) ?? null
    },
    async getAll(source, parameters = []) {
      return database.query(source).all(...parameters)
    },
  }
  const storage = {
    ...executor,
    async transaction(work) {
      database.exec('BEGIN IMMEDIATE')
      try {
        const result = await work(executor)
        database.exec('COMMIT')
        return result
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  }
  return { get: async () => storage }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
