const assert = require('node:assert/strict')
const { Database } = require('bun:sqlite')

async function main() {
  const core = await import('../src/core/index.ts')
  const runtimeModule = await import('../src/modules/assistant-runtime/index.ts')
  const conversationsModule = await import('../src/modules/conversations/index.ts')
  const knowledgeModule = await import('../src/modules/knowledge/index.ts')
  const providersModule = await import('../src/modules/providers/index.ts')
  assertConversationSnapshotContracts(core, conversationsModule)
  await assertAssistantRunWorkspaceWritebackMigration(core, runtimeModule)
  await assertAssistantRunKindMigration(core, runtimeModule)

  const database = new Database(':memory:')
  try {
    const storage = createBunSqliteStorage(database)
    await seedConversationTable(storage)
    await seedConversation(storage, 'conversation-walking-skeleton')

    const persistence = runtimeModule.createSqliteAssistantRunPersistence(storage)
    const conversations = conversationsModule.createSqliteConversationRepository(storage)
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
    await conversations.replaceAll([persistedConversation])
    assert.deepEqual((await conversations.loadAll()).map((item) => item.id), [persistedConversation.id])
    await conversations.clear()
    assert.deepEqual(await conversations.loadAll(), [])
    await seedConversation(storage, 'conversation-walking-skeleton')
    const contextSnapshots = knowledgeModule.createSqliteContextSnapshotRepository(storage)
    const projections = []
    let now = 50_000
    const ids = { next: (prefix) => `${prefix}-${++now}` }
    const adapter = providersModule.createCallbackProviderAdapter({
      providerId: 'walking-provider',
      transport: {
        async start(request, callbacks) {
          capturedProviderRequest = request
          callbacks.onEvent({ type: 'text-delta', text: 'Persisted ' })
          callbacks.onEvent({ type: 'citation', citationId: 'source-1', title: 'Source' })
          callbacks.onEvent({ type: 'text-delta', text: 'answer.' })
          callbacks.onEvent({ type: 'usage', inputTokens: 2, outputTokens: 2 })
          callbacks.onComplete()
        },
      },
    })
    let capturedProviderRequest
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
    })

    const handle = useCase.start({
      conversationId: 'conversation-walking-skeleton',
      responseMessageId: 'assistant-message-1',
      projection: (event) => projections.push(event),
    })
    const completed = await handle.completion

    assert.equal(completed.ok, true, 'persisted conversation reaches the target runtime')
    if (!completed.ok) throw new Error(completed.error.message)
    assert.equal(completed.value.status, 'succeeded')
    assert.equal(completed.value.kind, 'chat')
    assert.equal(completed.value.responseMessageId, 'assistant-message-1')
    assert.equal(completed.value.result.outputText, 'Persisted answer.')
    assert.equal(completed.value.checkpoint.outputText, 'Persisted answer.')
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

    await assertAtomicJournalAndRunState(core, persistence)
    await assertChatActivityPersistence(core, assistantRuntime, persistence, storage)
    await assertChatActivityCancellationPreservesWorkspaceWritebackHandoff(
      core,
      assistantRuntime,
      persistence,
    )
    await assertAgentActivityCreationRejected(core, assistantRuntime, persistence)
    await assertRestartRecovery(core, runtimeModule, conversationsModule, providersModule, persistence, conversations, ids, now)
  } finally {
    database.close()
  }

  console.log('vNext walking-skeleton integration tests passed')
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

async function seedConversation(storage, id) {
  const database = await storage.get()
  const payload = {
    schema: 'islemind.conversation-snapshot.v2',
    id,
    title: 'Walking skeleton',
    providerId: 'walking-provider',
    model: 'walking-model',
    systemPrompt: 'Be concise.',
    temperature: 0.2,
    reasoningEffort: 'high',
    maxTokens: 120,
    generationParameterOverrides: {},
    messages: [
      { id: 'message-1', role: 'user', content: 'Hello', status: 'done' },
    ],
  }
  await database.run(
    'INSERT INTO conversation_records (id, title, providerId, model, updatedAt, payloadJson) VALUES (?, ?, ?, ?, ?, ?)',
    [id, payload.title, payload.providerId, payload.model, 1, JSON.stringify(payload)],
  )
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
  await persistence.appendAndSave(entry, { ...baseRun, journalSequence: 1 })

  await assert.rejects(
    persistence.appendAndSave(entry, { ...baseRun, status: 'running', journalSequence: 1, startedAt: 2 }),
    'a duplicate journal write fails inside the transaction',
  )
  const stored = await persistence.get(runId)
  assert.equal(stored.kind, 'chat', 'run envelopes retain the required Chat kind')
  assert.equal(stored.status, 'queued', 'a failed journal insert cannot leave a new run state behind')
  assert.equal(stored.journalSequence, 1)
}

async function assertChatActivityPersistence(core, assistantRuntime, persistence, storage) {
  const runId = core.asAssistantRunId('run-chat-activity')
  const workspaceWritebackHandoff = createWorkspaceWritebackHandoff({
    runId,
    conversationId: 'conversation-walking-skeleton',
    assistantMessageId: 'assistant-chat-message-1',
    suffix: 'activity',
  })
  const database = await storage.get()
  let runCreatedRow
  const persistedTransitions = []
  const result = await assistantRuntime.executeActivity({
    runId,
    kind: 'chat',
    conversationId: 'conversation-walking-skeleton',
    responseMessageId: 'assistant-chat-message-1',
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
      async execute({ run }) {
        assert.equal(run.kind, 'chat')
        assert.equal(
          run.workspaceWritebackHandoff,
          workspaceWritebackHandoff,
          'the activity executor receives the exact handoff persisted with run.created',
        )
        return { outputText: 'Durable Chat activity.', eventCount: 1 }
      },
    },
    async onPersisted(event) {
      persistedTransitions.push(event)
      if (event.journalEntry.type !== 'run.created') return
      runCreatedRow = await database.getFirst(
        'SELECT workspaceWritebackHandoffJson FROM assistant_runs WHERE id = ?',
        [runId],
      )
    },
  })
  assert.equal(result.ok, true, 'activity runs persist through the same SQLite journal')
  if (!result.ok) throw new Error(result.error.message)
  assert.equal(result.value.kind, 'chat')
  assert.equal(result.value.result?.outputText, 'Durable Chat activity.')
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
  assert.deepEqual((await persistence.list(runId)).map((entry) => entry.type), [
    'run.created',
    'run.started',
    'run.succeeded',
  ])
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
