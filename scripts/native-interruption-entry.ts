/**
 * Test-only Metro entry. Never imported by the application entry or release build.
 * Runs the real app and its real Expo SQLite/runtime owners on a disposable AVD.
 * The collector controls interruption from outside the Android process.
 */
import { AppState, Platform } from 'react-native'
import { File, Paths } from 'expo-file-system'
import {
  asAssistantRunId, asContextSnapshotId, asTaskId, systemClock,
} from '../src/core'
import {
  createAssistantRuntime, createSqliteAssistantRunPersistence,
  type AssistantActivityExecutionResult, type AssistantRunPersistence,
} from '../src/modules/assistant-runtime'
import { createTaskRuntime, createSqliteTaskPersistence, type TaskPersistence } from '../src/modules/tasks'
import { createExpoSqliteDatabaseProvider } from '../src/platform/storage'
import 'expo-router/entry'

const endpoint = 'http://127.0.0.1:8081/__e4'
const session = `${Date.now()}-${Math.random().toString(36).slice(2)}`
const databaseName = process.env.EXPO_PUBLIC_E4_DATABASE_NAME ?? 'islemind-e4.db'
const provider = createExpoSqliteDatabaseProvider({ databaseName })
const runs = createSqliteAssistantRunPersistence(provider)
const tasks = createSqliteTaskPersistence(provider)
let sequence = 0
const ids = { next: (prefix: string) => `e4-${prefix}-${Date.now()}-${++sequence}` }
const fileText = 'E4 committed file\n繁體 日本語 😀\n'.repeat(128)
const output = 'E4 output\n繁體 日本語 😀 e\u0301\n'.repeat(96)
const fixtureFile = new File(Paths.document, 'e4-committed.txt')
const pendingRuns = new Map<string, {
  runtime: ReturnType<typeof createAssistantRuntime>
  finish: () => void
  completion: Promise<unknown>
}>()
const pendingTasks = new Map<string, ReturnType<typeof createTaskRuntime>>()
const lifecycle: Array<{ state: string; at: number }> = [{ state: AppState.currentState, at: Date.now() }]
const bootGate = deferred()
let bootView: { ready: boolean; status: string } | undefined
let sourceFixture: { conversationId: string; messageId: string; documentId: string; memoryId: string; foreignId: string } | undefined

// Test-entry-only scheduling seam: hold recovery, not storage loading, and
// observe the actual hook/render admission state. Production exports are not changed.
const bootModule = require('../src/hooks/useBootstrap') as typeof import('../src/hooks/useBootstrap')
const originalBootstrap = bootModule.useBootstrap
bootModule.useBootstrap = function useObservedBootstrap() {
  const state = originalBootstrap()
  bootView = { ready: state.ready, status: state.status }
  return state
}
const recoveryModule = require('../src/presentation/features/conversations/plainChatCommand') as typeof import('../src/presentation/features/conversations/plainChatCommand')
const originalRecover = recoveryModule.recoverChatRuns
recoveryModule.recoverChatRuns = async (...args) => {
  await post('milestone', { name: 'bootstrap-recovery-held' })
  await bootGate.promise
  return originalRecover(...args)
}

function runRuntime(persistence: AssistantRunPersistence = runs) {
  return createAssistantRuntime({
    clock: systemClock, ids, persistence,
    providerGateway: { describe() { return undefined }, async *stream() { throw new Error('Recovery must not call a provider.') } },
  })
}

function taskRuntime(persistence: TaskPersistence = tasks) {
  return createTaskRuntime({
    clock: systemClock, ids, persistence,
    policyEvaluator: { async evaluate(input) {
      return input.toolId === 'e4-confirm'
        ? { outcome: 'requires-confirmation', reasonCode: 'e4-confirm' }
        : { outcome: 'allowed', reasonCode: 'e4-local-fixture' }
    } },
  })
}

function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void
  const promise = new Promise<Value>((yes) => { resolve = yes })
  return { promise, resolve }
}

async function post(path: string, value: unknown) {
  const response = await fetch(`${endpoint}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session, ...value as object }),
  })
  if (!response.ok) throw new Error(`E4 controller HTTP ${response.status}`)
  return response.json()
}

async function startRun(id: string, completed: boolean) {
  const runtime = runRuntime()
  const ready = deferred()
  const finish = deferred()
  const completion = runtime.executeActivity({
    runId: asAssistantRunId(id), kind: 'chat', conversationId: 'e4-runtime-fixture',
    responseMessageId: `${id}-message`,
    context: {
      schema: 'islemind.context-snapshot.v1', id: asContextSnapshotId(`${id}-context`),
      createdAt: Date.now(), conversationMessageIds: [], memoryIds: [],
      knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [],
    },
    executor: { async execute({ checkpointTextDelta }) {
      // Split through UTF-16 surrogate pairs as well as multibyte characters.
      for (let offset = 0; offset < output.length; offset += 37) {
        await checkpointTextDelta!(output.slice(offset, offset + 37))
      }
      ready.resolve()
      if (!completed) await finish.promise
      return { outputText: output } satisfies AssistantActivityExecutionResult
    } },
  })
  pendingRuns.set(id, { runtime, finish: () => finish.resolve(), completion })
  await Promise.race([ready.promise, completion.then((result) => {
    if (!(result as { ok: boolean }).ok) throw new Error(JSON.stringify(result))
  })])
  if (completed) await completion
  return runs.get(asAssistantRunId(id))
}

async function startTask(id: string, kind: 'queued' | 'confirmation' | 'running' | 'completed') {
  const runtime = taskRuntime()
  const created = await runtime.create({
    taskId: asTaskId(id), toolId: kind === 'confirmation' ? 'e4-confirm' : 'e4-effect',
    idempotencyKey: id,
  })
  if (!created.ok) throw new Error(created.error.message)
  pendingTasks.set(id, runtime)
  if (kind === 'queued' || kind === 'confirmation') return created.value
  const ready = deferred()
  const completion = runtime.execute(created.value.id, { async execute(task) {
    // This external fixture observes an actual, awaited native task.started commit.
    await post('effect', { taskId: task.id, durable: await tasks.get(task.id) })
    ready.resolve()
    if (kind === 'running') await new Promise(() => undefined)
    return { summary: 'E4 local effect acknowledged', artifacts: [] }
  } })
  await Promise.race([ready.promise, completion.then((result) => {
    if (!result.ok) throw new Error(JSON.stringify(result))
  })])
  if (kind === 'completed') await completion
  return tasks.get(created.value.id)
}

async function inspect() {
  const db = await provider.get()
  // Force both owners' migrations even on the first empty startup.
  await runs.listRecoverable()
  await tasks.listRecoverable()
  const runRows = await db.getAll<{ id: string; schema: string; checkpointJson: string | null }>(
    'SELECT id, schema, checkpointJson FROM assistant_runs ORDER BY id',
  )
  const taskRows = await db.getAll<{ id: string }>('SELECT id FROM assistant_tasks ORDER BY id')
  return {
    session, appState: AppState.currentState, lifecycle: [...lifecycle],
    hermes: Boolean((globalThis as { HermesInternal?: unknown }).HermesInternal),
    sqlite: await db.getFirst('SELECT sqlite_version() AS version'),
    journalMode: await db.getFirst('PRAGMA journal_mode'),
    synchronous: await db.getFirst('PRAGMA synchronous'),
    foreignKeys: await db.getFirst('PRAGMA foreign_keys'),
    integrity: await db.getAll('PRAGMA integrity_check'),
    foreignKeyViolations: await db.getAll('PRAGMA foreign_key_check'),
    segments: await db.getAll('SELECT runId, COUNT(*) AS count FROM assistant_run_checkpoint_segments GROUP BY runId'),
    runs: await Promise.all(runRows.map(async (row) => ({
      stored: row, run: await runs.get(asAssistantRunId(row.id)),
      journal: await runs.list(asAssistantRunId(row.id)),
    }))),
    tasks: await Promise.all(taskRows.map(async (row) => ({
      task: await tasks.get(asTaskId(row.id)), journal: await tasks.list(asTaskId(row.id)),
    }))),
    file: { exists: fixtureFile.exists, text: fixtureFile.exists ? await fixtureFile.text() : null },
  }
}

function rendezvous<Store extends { listRecoverable: () => Promise<readonly unknown[]> }>(store: Store): Store {
  let calls = 0
  const both = deferred()
  return { ...store, async listRecoverable() {
    const rows = await store.listRecoverable()
    if (++calls === 2) both.resolve()
    await both.promise
    return rows
  } } as Store
}

async function command(name: string, args: Record<string, string>): Promise<unknown> {
  if (name === 'file-integrity-evidence') {
    const { collectNativeFileIntegrityEvidence } = await import('./native-embedding-evidence')
    return collectNativeFileIntegrityEvidence(args.input, (phase, detail) => post('milestone', { name: `integrity-${phase}`, detail }))
  }
  if (name === 'embedding-evidence') {
    const { collectNativeEmbeddingEvidence } = await import('./native-embedding-evidence')
    return collectNativeEmbeddingEvidence(provider, args.input, (phase, detail) => post('milestone', { name: `embedding-${phase}`, detail }))
  }
  if (name === 'embedding-admission-evidence') {
    const { collectNativeEmbeddingAdmissionEvidence } = await import('./native-embedding-evidence')
    return collectNativeEmbeddingAdmissionEvidence(args.input, (phase, detail) => post('milestone', { name: `admission-${phase}`, detail }))
  }
  if (name === 'inspect-boot') return bootView ?? null
  if (name === 'release-boot') { bootGate.resolve(); return { released: true } }
  if (name === 'setup-source-reader') {
    const { knowledgeRepository } = await import('../src/bootstrap/knowledgeRepository')
    const { useSettingsStore } = await import('../src/store/settingsStore')
    const { useChatStore } = await import('../src/store/chatStore')
    useSettingsStore.getState().updateSettings({ language: 'en', autoUpdateCheckEnabled: false,
      knowledgeEnabled: false, memoryEnabled: false, webSearchEnabled: false, mcpEnabled: false,
      systemStatusNotificationsEnabled: false })
    const conversationId = useChatStore.getState().create('e3-offline', 'e3-no-provider')
    const documentId = `e3-doc-${session}`
    const messageId = `e3-message-${session}`
    const memoryId = `e3-memory-${session}`
    const foreignId = `e3-foreign-${session}`
    const timestamp = Date.now()
    const originalUrl = 'http://127.0.0.1:8081/__e3/original'
    const document = { schema: 'islemind.knowledge-document-record.v1' as const, id: documentId,
      title: 'E3 saved document', mimeType: 'text/plain', size: 200, chunkCount: 2, status: 'ready' as const,
      sourceUri: originalUrl, contentHash: 'e3-original-revision', createdAt: timestamp, updatedAt: timestamp }
    const chunks = ['E3_FIRST_SECTION: This retained section was not quoted.',
      'E3_CITED_FULL_TEXT: Saved Unicode 繁體 日本語 😀. This paragraph is absent from the captured excerpt.'].map((content, ordinal) => ({
      schema: 'islemind.knowledge-chunk-record.v1' as const, id: `${documentId}-${ordinal}`, documentId,
      title: document.title, content, ordinal, createdAt: timestamp,
    }))
    await knowledgeRepository.saveDocument(document, chunks)
    await knowledgeRepository.saveMemory({ id: memoryId, content: 'E3_MEMORY_FULL_TEXT: Saved, but disabled.',
      status: 'disabled', scope: { kind: 'conversation', id: conversationId }, sourceKind: 'manual' })
    await knowledgeRepository.saveMemory({ id: foreignId, content: 'E3_FOREIGN_MEMORY_MUST_NOT_LEAK',
      status: 'active', scope: { kind: 'conversation', id: `not-${conversationId}` }, sourceKind: 'manual' })
    await useChatStore.getState().addMessage(conversationId, { id: messageId, role: 'assistant', content: 'E3 local source fixture',
      status: 'done', timestamp: timestamp - 1000, citations: [
        { id: documentId, type: 'knowledge', title: 'Doc', excerpt: 'E3_CAPTURED_EXCERPT', documentId,
          chunkId: chunks[1].id, chunkIndex: 1, url: originalUrl, sourceUri: originalUrl },
        { id: memoryId, type: 'memory', title: 'Memory', excerpt: 'E3_MEMORY_CAPTURED_EXCERPT' },
        { id: foreignId, type: 'memory', title: 'Foreign', excerpt: 'E3_FOREIGN_CAPTURED_EXCERPT' },
      ] })
    sourceFixture = { conversationId, messageId, documentId, memoryId, foreignId }
    return { ...sourceFixture, document, chunks,
      saved: await knowledgeRepository.readLocalSource({ type: 'knowledge', documentId }),
      memory: await knowledgeRepository.readLocalSource({ type: 'memory', memoryId, conversationId }),
      foreign: await knowledgeRepository.readLocalSource({ type: 'memory', memoryId: foreignId, conversationId }) ?? null }
  }
  if (name === 'source-reader-route') {
    if (!sourceFixture) throw new Error('Source reader fixture is not prepared')
    const { router } = await import('expo-router')
    router.replace({ pathname: '/source', params: { conversationId: sourceFixture.conversationId,
      messageId: sourceFixture.messageId, citationId: args.citationId ?? sourceFixture.documentId,
      url: 'http://127.0.0.1:8081/__e3/original' } })
    return { requested: true }
  }
  if (name === 'source-reader-mutate') {
    if (!sourceFixture) throw new Error('Source reader fixture is not prepared')
    const { knowledgeRepository } = await import('../src/bootstrap/knowledgeRepository')
    const { documentId } = sourceFixture
    if (args.action === 'delete') await knowledgeRepository.deleteDocument(documentId)
    else if (args.action === 'replace') {
      const current = await knowledgeRepository.readLocalSource({ type: 'knowledge', documentId })
      if (current?.type !== 'knowledge') throw new Error('Missing source reader fixture')
      await knowledgeRepository.saveDocument({ ...current.document, updatedAt: Date.now(), chunkCount: 1, contentHash: 'e3-replacement-revision' },
        [{ ...current.chunks[0], id: `${documentId}-replacement`, content: 'E3_REPLACEMENT_TEXT: Current revision, not the cited section.' }])
    } else throw new Error('Unknown source fixture mutation')
    return await knowledgeRepository.readLocalSource({ type: 'knowledge', documentId }) ?? null
  }
  if (name === 'inspect') return inspect()
  if (name === 'prepare') {
    fixtureFile.write(fileText)
    await startRun('e4-completed', true)
    await startRun('e4-interrupted', false)
    await startRun('e4-cancel-pending', false)
    await pendingRuns.get('e4-cancel-pending')!.runtime.cancel(asAssistantRunId('e4-cancel-pending'))
    await startTask('e4-task-completed', 'completed')
    await startTask('e4-task-queued', 'queued')
    await startTask('e4-task-confirmation', 'confirmation')
    await startTask('e4-task-unknown-effect', 'running')
    await startTask('e4-task-cancel-pending', 'running')
    await pendingTasks.get('e4-task-cancel-pending')!.cancel(asTaskId('e4-task-cancel-pending'))
    return inspect()
  }
  if (name === 'recover') {
    await post('milestone', { name: 'recovery-entered' })
    const runStore = rendezvous(runs)
    const taskStore = rendezvous(tasks)
    const runResults = await Promise.all([runRuntime(runStore).recoverInterruptedRuns(), runRuntime(runStore).recoverInterruptedRuns()])
    await post('milestone', { name: 'run-recovery-completed', runResults })
    const taskResults = await Promise.all([taskRuntime(taskStore).recoverInterruptedTasks(), taskRuntime(taskStore).recoverInterruptedTasks()])
    await post('milestone', { name: 'task-recovery-completed', taskResults })
    const repeated = { runs: await runRuntime().recoverInterruptedRuns(), tasks: await taskRuntime().recoverInterruptedTasks() }
    return { runResults, taskResults, repeated, snapshot: await inspect() }
  }
  if (name === 'start-run') return startRun(args.id, false)
  if (name === 'finish-run') {
    const pending = pendingRuns.get(args.id)!
    pending.finish()
    return pending.completion
  }
  if (name === 'cancel-run') {
    const pending = pendingRuns.get(args.id)!
    const requested = await pending.runtime.cancel(asAssistantRunId(args.id))
    if (args.settle === 'yes') { pending.finish(); await pending.completion }
    return { requested, snapshot: await inspect() }
  }
  if (name === 'open-transaction') {
    const db = await provider.get()
    await db.exec('CREATE TABLE IF NOT EXISTS e4_atomic (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
    await db.run('INSERT INTO e4_atomic (id, value) VALUES (?, ?)', ['committed', 'before'])
    const inside = deferred()
    void db.transaction(async (transaction) => {
      await transaction.run('UPDATE e4_atomic SET value = ? WHERE id = ?', ['uncommitted', 'committed'])
      await transaction.run('INSERT INTO e4_atomic (id, value) VALUES (?, ?)', ['uncommitted', 'never acknowledge'])
      inside.resolve()
      await new Promise(() => undefined)
    })
    await inside.promise
    return { entered: true, committed: false }
  }
  if (name === 'read-transaction') return (await provider.get()).getAll('SELECT * FROM e4_atomic ORDER BY id')
  if (name === 'barriers') {
    let effects = 0
    const runtime = taskRuntime({ ...tasks, async appendAndSave(entry, task) {
      if (entry.type === 'task.started') throw new Error('E4 injected pre-effect persistence failure')
      await tasks.appendAndSave(entry, task)
    } })
    const created = await runtime.create({ taskId: asTaskId('e4-start-fails'), toolId: 'e4-effect', idempotencyKey: 'e4-start-fails' })
    if (!created.ok) throw new Error(created.error.message)
    const result = await runtime.execute(created.value.id, { async execute() { effects++; return { artifacts: [] } } })
    const saved = await runs.get(asAssistantRunId('e4-interrupted'))
    let staleRejected = false
    if (saved) {
      try {
        await runs.appendAndSave({ schema: 'islemind.assistant-run-journal-entry.v1', runId: saved.id,
          sequence: saved.journalSequence, type: 'run.succeeded', occurredAt: Date.now() }, { ...saved, status: 'succeeded' })
      } catch { staleRejected = true }
    }
    return { effects, result, staleRejected, snapshot: await inspect() }
  }
  if (name === 'setup-chat') {
    const { useSettingsStore } = await import('../src/store/settingsStore')
    const { useChatStore } = await import('../src/store/chatStore')
    const settings = useSettingsStore.getState()
    settings.updateSettings({ language: 'en', autoUpdateCheckEnabled: false, knowledgeEnabled: false,
      memoryEnabled: false, webSearchEnabled: false, mcpEnabled: false, systemStatusNotificationsEnabled: false })
    const fixtureProvider = {
      id: 'e4-provider', name: 'E4 local fixture', type: 'openai-compatible', baseUrl: 'http://127.0.0.1:8081/v1',
      presetId: 'custom-endpoint', detectedPresetId: 'custom-endpoint', wireProtocol: 'openai-compatible', detectionStatus: 'manual',
      apiKey: 'e4-not-a-secret', enabled: true, models: ['e4-model'], manualModels: ['e4-model'], modelAliases: [],
      modelConfigs: [{ id: 'e4-model', name: 'E4 model', provider: 'openai-compatible', contextWindow: 32768,
        maxTokens: 32768, maxOutputTokens: 4096, defaultMaxTokens: 4096, supportsVision: false, supportsFiles: false }],
      credentialGroups: [{ id: 'e4-local-group', label: 'E4 local fixture', apiKey: 'e4-not-a-secret', enabled: true, availableModels: ['e4-model'] }],
    } satisfies Parameters<typeof settings.addProvider>[0]
    if (settings.providers.some((item) => item.id === fixtureProvider.id)) await settings.updateProvider(fixtureProvider.id, fixtureProvider)
    else await settings.addProvider(fixtureProvider)
    await useSettingsStore.getState().flushProviderPersistence()
    const id = useChatStore.getState().create('e4-provider', 'e4-model')
    const title = `E4 ${id.slice(-8)}`
    useChatStore.getState().rename(id, title)
    return { conversationId: id, title }
  }
  if (name === 'replay-migration-check') {
    const knowledge = await import('../src/modules/knowledge')
    const snapshot = knowledge.createKnowledgeRagReplaySnapshot({
      createdAt: 10, query: 'Native migration evidence', profile: 'offline', profileSource: 'settings',
      sourceCount: 1, citationCount: 1, confidence: 0.8, missingEvidence: false,
      ragTraceCount: 0, outputCharLimit: 4800, visibleOutput: 'Retained native source evidence',
      warnings: [], fallbackReasons: [], contextPrompt: 'Retained native source evidence',
      citations: [{ id: 'native-source', label: '[1]', type: 'knowledge', title: 'Retained source' }],
    })!
    const results = []
    for (const order of ['knowledge-first', 'replay-first', 'historical-replay-first']) {
      const storage = createExpoSqliteDatabaseProvider({ databaseName: `${databaseName}-${order}.db` })
      const db = await storage.get()
      if (order === 'historical-replay-first') {
        // A fresh, purpose-owned database reproduces the old marker collision.
        // Never rewrite or delete an existing application migration record.
        await db.exec(`
          CREATE TABLE platform_schema_migrations (scope TEXT NOT NULL, version INTEGER NOT NULL,
            name TEXT NOT NULL, appliedAt INTEGER NOT NULL, PRIMARY KEY(scope, version));
          INSERT INTO platform_schema_migrations VALUES ('knowledge', 3, 'knowledge-rag-replay-snapshots', 1);
          CREATE TABLE knowledge_rag_replay_snapshots (taskId TEXT PRIMARY KEY NOT NULL,
            schema TEXT NOT NULL, createdAt INTEGER NOT NULL, payloadJson TEXT NOT NULL);
        `)
        await db.run('INSERT INTO knowledge_rag_replay_snapshots VALUES (?, ?, ?, ?)',
          ['retained-task', snapshot.schema, snapshot.createdAt, JSON.stringify(snapshot)])
      }
      const repository = knowledge.createSqliteKnowledgeRepository(storage)
      const replay = knowledge.createSqliteKnowledgeRagReplaySnapshotRepository(storage)
      if (order === 'replay-first') await replay.save('retained-task', snapshot)
      await repository.listDocuments()
      await replay.save('new-task', snapshot)
      await repository.saveMemory({ id: 'scoped-memory', content: 'Explicit native user scope.', status: 'active', sourceKind: 'manual',
        scope: { kind: 'user', id: 'isolated-user' }, subject: 'IsleMind', key: 'scope', value: 'isolated-user' })
      const before = await repository.listMemories()
      const markersBefore = await db.getAll('SELECT * FROM platform_schema_migrations ORDER BY scope, version')
      const newStorage = createExpoSqliteDatabaseProvider({ databaseName: `${databaseName}-${order}.db` })
      // Recreate adapters/connections and race read-only initialization through
      // the production file queue. This is native SQLite, not a mock executor.
      const reopened = await Promise.all([
        knowledge.createSqliteKnowledgeRepository(newStorage).listMemories(),
        knowledge.createSqliteKnowledgeRagReplaySnapshotRepository(newStorage).get('new-task'),
        knowledge.createSqliteKnowledgeRagReplaySnapshotRepository(storage).get('new-task'),
      ])
      results.push({ order, snapshot, before, reopened, markersBefore,
        retained: order === 'knowledge-first' ? undefined : await replay.get('retained-task'),
        markersAfter: await db.getAll('SELECT * FROM platform_schema_migrations ORDER BY scope, version'),
        integrity: await db.getAll('PRAGMA integrity_check'), foreignKeys: await db.getAll('PRAGMA foreign_key_check'),
        journalMode: await db.getFirst('PRAGMA journal_mode'), synchronous: await db.getFirst('PRAGMA synchronous'),
      })
    }
    return { hermes: typeof (globalThis as unknown as { HermesInternal?: unknown }).HermesInternal !== 'undefined', results }
  }
  if (name === 'terminal-gap' || name === 'cancel-stream') {
    const { conversationId } = await command('setup-chat', {}) as { conversationId: string }
    const { useChatStore } = await import('../src/store/chatStore')
    const { useSettingsStore } = await import('../src/store/settingsStore')
    const { createPlainChatRuntime } = await import('../src/bootstrap/conversationRuntime')
    const responseMessageId = `e4-gap-assistant-${session}`
    await useChatStore.getState().addMessage(conversationId, { id: `e4-gap-user-${session}`, role: 'user',
      content: name === 'cancel-stream' ? 'E11_CANCEL' : 'E4_COMPLETE', timestamp: Date.now(), status: 'done' })
    await useChatStore.getState().addMessage(conversationId, { id: responseMessageId, role: 'assistant',
      content: '', timestamp: Date.now(), status: 'streaming' })
    await useChatStore.getState().flushStreamingMessage(conversationId, responseMessageId)
    const runtime = createPlainChatRuntime({
      conversation: useChatStore.getState().conversations.find((item) => item.id === conversationId)!,
      // Normal reply admission hydrates SecureStore credentials before this
      // factory. Supply the fixture credential at that same factory boundary.
      provider: { ...useSettingsStore.getState().providers.find((item) => item.id === 'e4-provider')!,
        apiKey: 'e4-not-a-secret', credentialGroups: [{ id: 'e4-local-group', label: 'E4 local fixture',
          apiKey: 'e4-not-a-secret', enabled: true, availableModels: ['e4-model'] }] },
      settings: name === 'cancel-stream' ? { ...useSettingsStore.getState().settings,
        agentWorkflowAllowReadOnlyTools: false, agentWorkflowAllowReadWriteTools: false,
        agentWorkflowAllowDestructiveTools: false, upstreamMaxRetries: 0 } : useSettingsStore.getState().settings,
    })
    // Exercise the real request/context/provider/run path, deliberately omitting
    // its disposable projection to reproduce death after the terminal DB commit.
    const cancellation = new AbortController()
    let acknowledged: Awaited<ReturnType<typeof runs.get>>
    const appRuns = createSqliteAssistantRunPersistence(createExpoSqliteDatabaseProvider())
    const result = await runtime.start({ conversationId, responseMessageId,
      ...(name === 'cancel-stream' ? { cancellationSignal: cancellation.signal,
        async projection(event) {
          if (acknowledged || event.journalEntry?.data?.eventType !== 'text-delta') return
          acknowledged = await appRuns.get(event.run.id)
          cancellation.abort(new Error('Native fixture caller cancelled after a durable text delta'))
        },
      } : {}),
    }).completion
    return { conversationId, responseMessageId, result, acknowledged, snapshot: await command('inspect-chat', { id: conversationId }) }
  }
  if (name === 'inspect-chat') {
    const { useChatStore } = await import('../src/store/chatStore')
    const appProvider = createExpoSqliteDatabaseProvider()
    const db = await appProvider.get()
    const persistence = createSqliteAssistantRunPersistence(appProvider)
    const rows = await db.getAll<{ id: string }>('SELECT id FROM assistant_runs WHERE conversationId = ? ORDER BY createdAt', [args.id])
    return {
      conversation: useChatStore.getState().conversations.find((item) => item.id === args.id),
      runs: await Promise.all(rows.map(async ({ id }) => ({ run: await persistence.get(asAssistantRunId(id)), journal: await persistence.list(asAssistantRunId(id)) }))),
      messages: await db.getAll('SELECT id, ordinal, messageJson FROM conversation_message_records WHERE conversationId = ? ORDER BY ordinal', [args.id]),
    }
  }
  throw new Error(`Unknown E4 command: ${name}`)
}

if (__DEV__ && Platform.OS === 'android') {
  AppState.addEventListener('change', (state) => {
    lifecycle.push({ state, at: Date.now() })
    void post('lifecycle', { state }).catch(() => undefined)
  })
  void (async () => {
    await post('ready', { appState: AppState.currentState })
    for (;;) {
      try {
        const response = await fetch(`${endpoint}/command?session=${encodeURIComponent(session)}`)
        const job = await response.json()
        if (!job) continue
        try { await post('result', { id: job.id, value: await command(job.name, job.args ?? {}) }) }
        catch (error) { await post('result', { id: job.id, error: error instanceof Error ? error.stack ?? String(error) : String(error) }) }
      } catch { await new Promise((resolve) => setTimeout(resolve, 500)) }
    }
  })().catch(() => undefined)
}
