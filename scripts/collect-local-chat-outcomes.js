// Bun --no-env-file scripts/collect-local-chat-outcomes.js --cases <fixed.json>
//   --out <fresh test-evidence/task-outcomes/directory> --endpoint http://127.0.0.1:<port> --model <alias>
// Real Plain Chat -> provider HTTP/SSE -> model operations -> Tasks -> file SQLite.
// Only host/platform configuration ports are adapted. No model answers, request
// preparation, tool arguments, retrieval results or audit results are scripted.
// This is HOST evidence, not a native-app/UI test or a semantic-success oracle.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.resolve(__dirname, '..')
const evidenceRoot = path.join(root, 'test-evidence', 'task-outcomes')
const allowedOperations = ['rag:context_pack', 'work-artifact:summarize']
const fakeLocalCredential = 'islemind-local-evidence-only' // Public placeholder; not a secret or real credential.
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const clone = (value) => JSON.parse(JSON.stringify(value))
const errorRecord = (error) => ({ name: error?.name ?? 'Error', message: String(error?.message ?? error), stack: error?.stack })

function localOrigin(value) {
  const url = new URL(value)
  assert.equal(url.protocol, 'http:', 'Only an explicitly owned loopback HTTP server is supported')
  assert.equal(url.hostname, '127.0.0.1', 'Remote servers and hostname resolution are forbidden')
  assert.ok(Number(url.port) >= 1024 && Number(url.port) <= 65535, 'Use an explicit unprivileged port')
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/')
  return url.origin
}

function freshDestination(value) {
  const destination = path.resolve(value)
  const relative = path.relative(evidenceRoot, destination)
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'Output must be a new child of test-evidence/task-outcomes')
  assert.ok(!fs.existsSync(destination), 'Refusing to overwrite any existing evidence destination')
  // Resolve existing ancestors as well: a junction must not redirect fixture writes.
  let ancestor = path.dirname(destination)
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor)
  const actualRelative = path.relative(fs.realpathSync(evidenceRoot), fs.realpathSync(ancestor))
  assert.ok(actualRelative !== '..' && !actualRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(actualRelative))
  return destination
}

function settingsFor(language) {
  return {
    theme: 'light', themeId: 'minimal', language, defaultProvider: null, fontSize: 16,
    hapticsEnabled: false, memoryEnabled: false, knowledgeEnabled: true,
    webSearchEnabled: false, webSearchMode: 'tavily', searchProvider: 'islemind',
    knowledgeTopK: 4, memoryTopK: 4, ragMode: 'fts', ragProfile: 'offline',
    embeddingMode: 'local', localEmbeddingModelSource: 'none',
    ragQueryRewriteEnabled: false, ragHydeEnabled: false, ragFlareEnabled: false,
    ragGraphEnabled: false, ragRaptorEnabled: false, ragCrossEncoderEnabled: false,
    ragColbertEnabled: false, ragLlmlinguaEnabled: false,
    skillsEnabled: false, mcpEnabled: false, commandPaletteEnabled: false,
    agentWorkflowMaxSteps: 3, agentWorkflowMaxToolCallsPerStep: 1,
    agentWorkflowAllowReadOnlyTools: true, agentWorkflowAllowReadWriteTools: false,
    agentWorkflowAllowDestructiveTools: false, agentWorkflowOutputCharLimit: 4800,
    transportMode: 'http', remoteCompactMode: 'off', modelContextCompressionEnabled: false,
    payloadPolicyMode: 'warn', proxyMode: 'off', proxyBaseUrl: '',
    observabilitySinkMode: 'off', observabilitySinkUserOptIn: false,
    providerAllowlist: [], providerBlocklist: [], modelAllowlist: [], modelBlocklist: [],
    runtimeLogEnabled: false, sessionConcurrencyLimit: 1, sessionQueueTimeoutMs: 1500,
    sessionAffinityEnabled: false, upstreamRequestTimeoutMs: 120000, upstreamMaxRetries: 0,
    upstreamCircuitBreakerEnabled: false, autoUpdateCheckEnabled: false,
  }
}

async function main() {
  if (process.argv.includes('--self-test')) {
    assert.equal(localOrigin('http://127.0.0.1:18085'), 'http://127.0.0.1:18085')
    for (const value of ['https://127.0.0.1:18085', 'http://localhost:18085', 'http://example.com:18085',
      'http://127.0.0.1', 'http://user:pass@127.0.0.1:18085', 'http://127.0.0.1:18085/v1',
      'http://127.0.0.1:18085?token=x', 'http://127.0.0.1:18085#x']) assert.throws(() => localOrigin(value))
    assert.throws(() => freshDestination(root))
    assert.throws(() => freshDestination(evidenceRoot))
    assert.throws(() => freshDestination(path.join(evidenceRoot, '..', 'elsewhere')))
    console.log('Local Chat collector safety checks passed (Host verified; no generation).')
    return
  }
  const args = process.argv.slice(2)
  assert.equal(args.length, 8, 'Required: --cases <file> --out <fresh-dir> --endpoint <loopback-origin> --model <alias>')
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    assert.ok(['--cases', '--out', '--endpoint', '--model'].includes(args[index]) && !options[args[index]])
    options[args[index]] = args[index + 1]
  }
  const origin = localOrigin(options['--endpoint'])
  const model = options['--model']
  assert.match(model, /^[A-Za-z0-9._-]{1,100}$/)
  const casesBytes = fs.readFileSync(path.resolve(options['--cases']))
  const suite = JSON.parse(casesBytes)
  assert.ok(suite.cases.length > 0 && suite.cases.length <= 8)
  assert.ok(suite.limits.maxOutputTokens > 0 && suite.limits.maxOutputTokens <= 1536)
  assert.equal(suite.limits.maxRetries, 0)
  assert.equal(suite.limits.paidOrExternalEndpoints, false)
  const out = freshDestination(options['--out'])
  fs.mkdirSync(out, { recursive: true })
  const write = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
  fs.writeFileSync(path.join(out, 'cases.json'), casesBytes, { flag: 'wx' })

  const receipt = {
    createdAt: new Date().toISOString(), evidenceClass: 'Unverified',
    origin, model, casesSha256: sha256(casesBytes), collectorSha256: sha256(fs.readFileSync(__filename)),
    environment: { platform: process.platform, arch: process.arch, bun: Bun.version },
    boundaries: [
      'Unmodified createPlainChatRuntime/request preparation, provider serializer/admission/HTTP-SSE parser, model-operation session, Tasks and SQLite repositories.',
      'expo-sqlite port delegates to isolated real Bun SQLite files; production file queue and WAL/FULL PRAGMAs remain in use. Not Expo SQLite/native filesystem evidence.',
      'Synthetic Settings store, empty in-memory AsyncStorage, empty external catalogs and fail-closed external executors. Only the two existing internal read-only tools are available.',
      'expo/fetch and global fetch delegate to real host fetch guarded to the exact loopback origin and selected paths; redirects are forbidden. No paid provider, real credentials or user corpus.',
      'Projection callback observes committed runs; React Native presentation/stores are not mounted. Reading a terminal AssistantRun is not rendered UI or application restart evidence.',
      'Runtime/task success and structural qualityAudit are not semantic correctness, source approval, or production readiness. Semantic review is a separate source-based artifact.',
    ],
    sourceHashes: {}, cases: [], externalAttempts: [], network: [], checks: [],
  }
  for (const file of [
    'src/bootstrap/conversationRuntime.ts', 'src/bootstrap/providerRuntime.ts',
    'src/bootstrap/providerRequestBinding.ts', 'src/bootstrap/providerRuntimePipeline.ts',
    'src/bootstrap/providerRuntimeExecutor.ts', 'src/bootstrap/providerTransport.ts',
    'src/bootstrap/conversationModelOperationRuntime.ts', 'src/bootstrap/modelOperationCatalogRuntime.ts',
    'src/bootstrap/taskBoundToolRuntime.ts', 'src/bootstrap/taskRuntime.ts',
    'src/bootstrap/knowledgeContextRuntime.ts', 'src/bootstrap/knowledgeRepository.ts',
    'src/modules/assistant-runtime/runtime.ts', 'src/modules/assistant-runtime/adapters/sqliteAssistantRunStore.ts',
    'src/modules/knowledge/adapters/sqliteKnowledgeRepository.ts', 'src/modules/knowledge/adapters/sqliteKnowledgeRagReplayRepository.ts',
    'src/modules/integrations/workArtifactTaskAdapter.ts', 'src/utils/workArtifact.ts',
    'src/platform/storage/expoSqliteDatabase.ts', 'src/services/promptEngineering.ts',
  ]) receipt.sourceHashes[file] = sha256(fs.readFileSync(path.join(root, file)))

  const check = (target, name, passed, detail) => target.push({ name, status: passed ? 'pass' : 'fail', evidenceClass: 'Host verified', detail })
  const realFetch = globalThis.fetch.bind(globalThis)
  const streamCompletions = []
  const databases = []
  let currentCase = 'setup'
  let settings = settingsFor('en')
  const provider = {
    id: 'e11-owned-local-model', name: 'Owned local llama.cpp evidence', type: 'openai-compatible',
    presetId: 'custom-endpoint', baseUrl: `${origin}/v1`, apiKey: fakeLocalCredential,
    enabled: true, models: [model], modelConfigs: [{
      id: model, name: model, provider: 'openai-compatible', contextWindow: suite.limits.contextWindow,
      maxTokens: suite.limits.contextWindow, maxOutputTokens: suite.limits.maxOutputTokens,
      defaultMaxTokens: suite.limits.maxOutputTokens, defaultTemperature: 0.7, maxTemperature: 2,
      supportsVision: false, supportsFiles: false, supportsTools: true, supportsStreaming: true,
      reasoningMode: 'none', preferredEndpoint: 'chat-completions',
      supportedParameters: ['temperature', 'top_p', 'top_k', 'max_tokens'],
    }],
    capabilities: {
      chat: true, streaming: true, modelList: true, nativeTools: true, topP: true,
      vision: false, files: false, audioInput: false, audioTranscription: false, speech: false,
      nativeSearch: false, reasoningEffort: false, embeddings: false, responsesApi: false,
    },
  }
  write('configuration.json', { provider: { ...provider, apiKey: '[public local-only placeholder]' }, settings,
    cancellationCase: 'Repeat the unchanged final case prompt, cancel after its first durably acknowledged text delta.',
    maxRequestsPerCase: 4, maxResponseBytes: 2 * 1024 * 1024 })

  const guardedFetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.origin !== origin || url.username || url.password || url.search || url.hash ||
      !['/health', '/v1/models', '/v1/chat/completions'].includes(url.pathname)) {
      receipt.externalAttempts.push({ kind: 'network', caseId: currentCase, reason: 'outside admitted loopback route' })
      throw new Error('Collector forbids this network route')
    }
    const method = init.method ?? (input instanceof Request ? input.method : 'GET')
    const isChat = url.pathname === '/v1/chat/completions'
    assert.equal(method.toUpperCase(), isChat ? 'POST' : 'GET')
    let request
    if (isChat) {
      assert.equal(typeof init.body, 'string')
      request = JSON.parse(init.body)
      assert.equal(request.model, model)
      assert.equal(request.stream, true, 'This evidence requires real streaming')
      const maxTokens = request.max_tokens ?? request.max_completion_tokens
      assert.ok(maxTokens > 0 && maxTokens <= suite.limits.maxOutputTokens)
      assert.ok(receipt.network.filter((item) => item.caseId === currentCase && item.request).length < 4)
    }
    const record = { index: receipt.network.length, caseId: currentCase, method, path: url.pathname, startedAt: Date.now(), ...(request ? { request } : {}) }
    receipt.network.push(record) // Never persist HTTP credentials or header values.
    if (request) write(`request-${record.index}.json`, record)
    let settle
    const completed = new Promise((resolve) => { settle = resolve })
    streamCompletions.push(completed)
    const chunks = []
    let bytes = 0
    let finished = false
    const finish = (outcome, error) => {
      if (finished) return
      finished = true
      Object.assign(record, { outcome, completedAt: Date.now(), bytes, signalAborted: init.signal?.aborted === true,
        ...(error ? { error: errorRecord(error) } : {}) })
      fs.writeFileSync(path.join(out, `response-${record.index}.${isChat ? 'sse' : 'json'}`), Buffer.concat(chunks), { flag: 'wx' })
      settle()
    }
    try {
      const response = await realFetch(input, { ...init, redirect: 'error' })
      record.status = response.status
      record.contentType = response.headers.get('content-type')
      record.corsOrigin = response.headers.get('access-control-allow-origin')
      if (!response.body) { finish('empty'); return response }
      const reader = response.body.getReader()
      // Transparent byte capture only. The production provider owns SSE parsing.
      return new Response(new ReadableStream({
        async pull(controller) {
          try {
            const next = await reader.read()
            if (next.done) { finish('complete'); controller.close(); return }
            bytes += next.value.byteLength
            if (bytes > 2 * 1024 * 1024) { await reader.cancel('response budget'); throw new Error('Response exceeded the collector byte budget') }
            chunks.push(Buffer.from(next.value))
            controller.enqueue(next.value)
          } catch (error) { finish('read-error', error); controller.error(error) }
        },
        async cancel(reason) { finish('cancelled'); await reader.cancel(reason) },
      }), { status: response.status, statusText: response.statusText, headers: response.headers })
    } catch (error) { finish('request-error', error); throw error }
  }

  try {
    globalThis.fetch = guardedFetch
    const health = await guardedFetch(`${origin}/health`, { signal: AbortSignal.timeout(20000) })
    assert.equal(health.status, 200)
    assert.equal((await health.json()).status, 'ok')
    const models = await guardedFetch(`${origin}/v1/models`, { signal: AbortSignal.timeout(20000) })
    assert.ok((await models.json()).data.some((item) => item.id === model))
    const { mock } = require('bun:test')
    const { Database } = require('bun:sqlite')
    mock.module('expo/fetch', () => ({ fetch: guardedFetch }))
    mock.module('expo-sqlite', () => ({ async openDatabaseAsync(name) {
      assert.equal(name, 'islemind-context.db')
      const db = new Database(path.join(out, name))
      databases.push(db)
      return {
        async execAsync(sql) { db.exec(sql) },
        async runAsync(sql, ...parameters) { const result = db.prepare(sql).run(...parameters); return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) } },
        async getFirstAsync(sql, ...parameters) { return db.prepare(sql).get(...parameters) ?? null },
        async getAllAsync(sql, ...parameters) { return db.prepare(sql).all(...parameters) },
        async withTransactionAsync(work) {
          db.exec('BEGIN')
          try { await work(); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
        },
        async closeAsync() { db.close() },
      }
    } }))
    const values = new Map()
    const storage = {
      async getItem(key) { return values.get(key) ?? null },
      async setItem(key, value) { values.set(key, value) },
      async removeItem(key) { values.delete(key) },
      async getAllKeys() { return [...values.keys()] },
      async multiGet(keys) { return keys.map((key) => [key, values.get(key) ?? null]) },
      async multiSet(pairs) { for (const [key, value] of pairs) values.set(key, value) },
      async multiRemove(keys) { for (const key of keys) values.delete(key) },
    }
    mock.module('@react-native-async-storage/async-storage', () => ({ default: storage }))
    mock.module('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => ({
      settings, providers: [provider],
      async hydrateProviderKey(id) { assert.equal(id, provider.id); return provider },
    }) } }))
    const forbidden = (kind) => async () => {
      receipt.externalAttempts.push({ kind, caseId: currentCase })
      throw new Error(`Collector forbids ${kind}`)
    }
    mock.module('expo-file-system/legacy', () => ({
      documentDirectory: null, cacheDirectory: null, EncodingType: { UTF8: 'utf8' },
      getInfoAsync: forbidden('native-filesystem-read'), readAsStringAsync: forbidden('native-filesystem-read'),
      writeAsStringAsync: forbidden('native-filesystem-write'), deleteAsync: forbidden('native-filesystem-delete'),
    }))
    mock.module('@/bootstrap/mcpCatalog', () => ({
      BUILTIN_SERVER_ID: 'e11-empty-external-catalog',
      listMcpServers: async () => [], listBuiltinToolDescriptors: () => [],
      builtinMcpServer: () => ({ id: 'e11-empty-external-catalog', name: 'Disabled', enabled: false, status: 'disconnected', tools: [] }),
      resolveBuiltInCapabilityAdapter: () => undefined,
    }))
    mock.module('@/bootstrap/mcpExecutionRuntime', () => ({ callMcpTool: forbidden('external-tool') }))
    mock.module('@/presentation/features/settings/settingsActionCommand', () => ({ executeSettingsAction: forbidden('settings-action') }))
    mock.module('@/services/androidDeviceTools', () => ({ listAndroidDeviceToolManifests: () => [], executeAndroidDeviceTool: forbidden('android-action') }))
    mock.module('@/bootstrap/androidStatusNotification', () => ({ openAndroidStatusNotificationSettings: forbidden('android-settings') }))

    const knowledge = await import('../src/modules/knowledge/index.ts')
    const { knowledgeRepository } = await import('../src/bootstrap/knowledgeRepository.ts')
    const { conversationPersistence } = await import('../src/bootstrap/conversationPersistence.ts')
    const { createPlainChatRuntime, getLatestConversationResponseRun } = await import('../src/bootstrap/conversationRuntime.ts')
    const { createExpoSqliteDatabaseProvider } = await import('../src/platform/storage/expoSqliteDatabase.ts')
    const { createSqliteAssistantRunPersistence } = await import('../src/modules/assistant-runtime/index.ts')
    const { createSqliteTaskPersistence } = await import('../src/modules/tasks/index.ts')
    const { createConversationModelOperationCatalog } = await import('../src/bootstrap/modelOperationCatalogRuntime.ts')
    const { setServiceLanguage } = await import('../src/i18n/service.ts')
    const inspectionProvider = createExpoSqliteDatabaseProvider()
    const runStore = createSqliteAssistantRunPersistence(inspectionProvider)
    const taskStore = createSqliteTaskPersistence(inspectionProvider)
    await taskStore.listRecoverable() // Prepare the actual task schema, including zero-tool cases.
    const catalog = await createConversationModelOperationCatalog(settings)
    assert.equal(catalog.ok, true)
    assert.deepEqual(catalog.catalog.snapshot.operations.map((item) => item.id).sort(), allowedOperations)
    assert.ok(catalog.catalog.snapshot.operations.every((item) => item.permission === 'read-only'))
    write('catalog.json', catalog)
    const now = Date.now()
    const allDocuments = [...suite.cases.flatMap((item) => item.documents), suite.offScopeDocument]
    assert.equal(new Set(allDocuments.map((item) => item.id)).size, allDocuments.length)
    for (const source of allDocuments) {
      await knowledgeRepository.saveDocument({
        schema: knowledge.KNOWLEDGE_DOCUMENT_RECORD_SCHEMA, id: source.id, title: source.title,
        mimeType: 'text/plain', size: Buffer.byteLength(source.content), chunkCount: 1, status: 'ready',
        sourceUri: `file:///synthetic-e11/${source.id}.txt`, createdAt: now, updatedAt: now,
      }, [{
        schema: knowledge.KNOWLEDGE_CHUNK_RECORD_SCHEMA, id: `${source.id}-0`, documentId: source.id,
        title: source.title, content: source.content, ordinal: 0, chunkIndex: 0, createdAt: now,
      }], { signal: new AbortController().signal })
    }
    // Fixed before generation. This repeats the same source/prompt under cancellation;
    // it does not replace any failed semantic case with an easier question.
    const cohort = [...suite.cases, { ...suite.cases.at(-1), id: 'stream-cancellation', cancelAfterDelta: true }]
    for (const sample of cohort) {
      currentCase = sample.id
      settings = settingsFor(sample.language)
      setServiceLanguage(sample.language)
      const caseReceipt = { id: sample.id, startedAt: Date.now(), evidenceClass: 'Unverified', checks: [], projections: [], semanticOutcome: 'Requires separate source-based review' }
      receipt.cases.push(caseReceipt)
      const conversation = {
        id: `e11-${sample.id}`, title: sample.title, providerId: provider.id, model,
        systemPrompt: '', knowledgeSources: sample.documents.map((item) => item.id),
        temperature: 0.7, topP: 0.8, topK: 20, maxTokens: suite.limits.maxOutputTokens,
        generationParameterOverrides: { temperature: true, topP: true, topK: true, maxTokens: true },
        messages: [{ id: `${sample.id}-user`, role: 'user', content: sample.prompt, timestamp: Date.now(), status: 'done' }],
        createdAt: now, updatedAt: now,
      }
      const controller = new AbortController()
      const deadline = setTimeout(() => controller.abort(new Error('Collector case time budget exceeded')), 240000)
      try {
        await conversationPersistence.save(conversation)
        const runtime = createPlainChatRuntime({ conversation, provider, settings })
        const responseMessageId = `${sample.id}-assistant`
        const handle = runtime.start({ conversationId: conversation.id, responseMessageId, cancellationSignal: controller.signal,
          async projection(event) {
            caseReceipt.contextCitations ??= clone(event.contextCitations ?? [])
            caseReceipt.projections.push({ observedAt: Date.now(), runId: event.run.id, status: event.run.status,
              sequence: event.run.journalSequence, outputLength: event.run.checkpoint?.outputText.length ?? 0,
              eventType: event.journalEntry?.type })
            if (sample.cancelAfterDelta && !caseReceipt.cancellation && event.journalEntry?.data?.eventType === 'text-delta') {
              try {
                const durable = await runStore.get(event.run.id)
                caseReceipt.cancellation = { requestedAt: Date.now(), acknowledgedRun: durable, acknowledgedJournal: event.journalEntry }
                controller.abort(new DOMException('Evidence caller cancellation after durable text', 'AbortError'))
              } catch (error) { caseReceipt.observationError = errorRecord(error); controller.abort(error) }
            }
          },
        })
        caseReceipt.runId = handle.runId
        caseReceipt.completion = await handle.completion
        clearTimeout(deadline)
        caseReceipt.durableRun = await runStore.get(handle.runId)
        caseReceipt.journal = await runStore.list(handle.runId)
        caseReceipt.requestSnapshot = await runStore.getRequestSnapshot(handle.runId)
        caseReceipt.contextReceipt = await runStore.getLatestContextReceipt(conversation.id)
        caseReceipt.reconstructedRun = await getLatestConversationResponseRun(conversation.id, responseMessageId)
        const db = await inspectionProvider.get()
        const taskRows = await db.getAll('SELECT id FROM assistant_tasks WHERE runId = ?', [handle.runId])
        caseReceipt.tasks = await Promise.all(taskRows.map(async ({ id }) => ({ task: await taskStore.get(id), journal: await taskStore.list(id) })))
        const journal = caseReceipt.journal
        const requests = receipt.network.filter((item) => item.caseId === sample.id && item.request)
        check(caseReceipt.checks, 'real streaming provider request', requests.length > 0 && requests.every((item) => item.status === 200 && item.contentType?.includes('text/event-stream')), { requests: requests.length })
        check(caseReceipt.checks, 'read-only terminal reconstruction equals durable owner', JSON.stringify(caseReceipt.reconstructedRun) === JSON.stringify(caseReceipt.durableRun))
        check(caseReceipt.checks, 'journal sequence is unique and contiguous', journal.every((item, index) => item.sequence === index + 1))
        check(caseReceipt.checks, 'exactly one durable terminal event', journal.filter((item) => ['run.succeeded', 'run.failed', 'run.cancelled'].includes(item.type)).length === 1)
        check(caseReceipt.checks, 'off-scope source never entered provider payload', requests.every((item) => !JSON.stringify(item.request).includes('OFF_SCOPE_DECOY_DO_NOT_USE')))
        check(caseReceipt.checks, 'task execution remains bound to allowed internal tools and owning run', caseReceipt.tasks.every(({ task }) => allowedOperations.includes(task.toolId) && task.runId === handle.runId))
        check(caseReceipt.checks, 'executed internal tasks succeeded (separate from Chat status)', caseReceipt.tasks.every(({ task }) => task.status === 'succeeded'), caseReceipt.tasks.map(({ task }) => ({ toolId: task.toolId, status: task.status })))
        if (sample.cancelAfterDelta) {
          check(caseReceipt.checks, 'cancellation follows a durable text acknowledgement', Boolean(caseReceipt.cancellation?.acknowledgedRun?.checkpoint?.outputText))
          check(caseReceipt.checks, 'cancellation is authoritative; not successful', caseReceipt.completion.ok === false && caseReceipt.completion.error.code === 'cancelled' && caseReceipt.durableRun?.status === 'cancelled' && !caseReceipt.durableRun.result)
          check(caseReceipt.checks, 'acknowledged cancelled prefix retained exactly once', Boolean(caseReceipt.cancellation) && caseReceipt.durableRun?.checkpoint?.outputText === caseReceipt.cancellation.acknowledgedRun?.checkpoint?.outputText)
          check(caseReceipt.checks, 'no task executed after early streaming cancellation', caseReceipt.tasks.length === 0)
        } else {
          check(caseReceipt.checks, 'runtime terminal success (not semantic correctness)', caseReceipt.completion.ok === true && caseReceipt.durableRun?.status === 'succeeded')
          check(caseReceipt.checks, 'successful output survives independent read', Boolean(caseReceipt.completion.value?.result?.outputText) && caseReceipt.completion.value?.result?.outputText === caseReceipt.reconstructedRun?.result?.outputText)
        }
        caseReceipt.evidenceClass = 'Host verified'
        caseReceipt.output = caseReceipt.durableRun?.result?.outputText ?? caseReceipt.durableRun?.checkpoint?.outputText ?? ''
      } catch (error) { caseReceipt.error = errorRecord(error) }
      finally { clearTimeout(deadline); caseReceipt.completedAt = Date.now(); write(`${sample.id}.json`, caseReceipt) }
      console.log(JSON.stringify({ id: sample.id, runtimeStatus: caseReceipt.durableRun?.status, failedChecks: caseReceipt.checks.filter((item) => item.status === 'fail').map((item) => item.name), error: caseReceipt.error }))
    }
    const settled = await Promise.race([Promise.all(streamCompletions).then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 5000))])
    check(receipt.checks, 'captured transports reached a terminal state', settled)
    check(receipt.checks, 'no attempted external effects or network', receipt.externalAttempts.length === 0)
    const db = await inspectionProvider.get()
    receipt.sqlite = {
      version: await db.getFirst('SELECT sqlite_version() AS version'),
      connections: databases.map((connection) => ({
        journalMode: connection.prepare('PRAGMA journal_mode').get(),
        synchronous: connection.prepare('PRAGMA synchronous').get(),
        foreignKeys: connection.prepare('PRAGMA foreign_keys').get(),
      })),
      integrity: await db.getAll('PRAGMA integrity_check'), foreignKeyCheck: await db.getAll('PRAGMA foreign_key_check'),
    }
    check(receipt.checks, 'host file database integrity', receipt.sqlite.integrity.length === 1 && Object.values(receipt.sqlite.integrity[0])[0] === 'ok' && receipt.sqlite.foreignKeyCheck.length === 0)
    check(receipt.checks, 'all host connections retain WAL FULL foreign_keys', receipt.sqlite.connections.every((item) => item.journalMode.journal_mode === 'wal' && item.synchronous.synchronous === 2 && item.foreignKeys.foreign_keys === 1))
    receipt.evidenceClass = 'Host verified'
  } catch (error) { receipt.error = errorRecord(error) }
  finally {
    globalThis.fetch = realFetch
    for (const db of databases) { try { db.close() } catch (error) { (receipt.closeErrors ??= []).push(errorRecord(error)) } }
    receipt.completedAt = new Date().toISOString()
    receipt.databaseSha256 = fs.existsSync(path.join(out, 'islemind-context.db')) ? sha256(fs.readFileSync(path.join(out, 'islemind-context.db'))) : undefined
    write('result.json', receipt)
  }
  if (receipt.error || receipt.cases.some((item) => item.error || item.checks.some((check) => check.status === 'fail')) || receipt.checks.some((item) => item.status === 'fail')) process.exitCode = 1
  console.log(JSON.stringify({ evidenceClass: receipt.evidenceClass, output: out, error: receipt.error, note: 'Runtime checks do not grade semantic outcomes or native readiness.' }))
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1 })
