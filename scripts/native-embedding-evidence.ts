/** Disposable test entry only. All tensors, sessions, model reads and SQLite
 * owners below are real native implementations; instrumentation delegates to them. */
import { NativeModules, Platform } from 'react-native'
import { createExpoSqliteDatabaseProvider, type SqliteDatabaseProvider } from '../src/platform/storage'
import { createOnnxEmbeddingProvider, releaseOnnxEmbeddingResources } from '../src/bootstrap/knowledgeEmbeddingProvider'
import { localEmbeddingModelCatalogPolicy, localEmbeddingModelDirectory } from '../src/bootstrap/localModelCatalog'
import { localModelStateRepository } from '../src/bootstrap/localModelStateRepository'
import {
  buildKnowledgeScope, createKnowledgeQueryEmbeddingUseCase, createSqliteKnowledgeHybridIndex,
  createSqliteKnowledgeRepository, KNOWLEDGE_CHUNK_RECORD_SCHEMA, KNOWLEDGE_DOCUMENT_RECORD_SCHEMA,
  type KnowledgeChunkRecord,
} from '../src/modules/knowledge'

interface EmbeddingEvidenceInput {
  modelId: string
  cases: Array<{ id: string; text: string }>
  documents: Array<{ id: string; title: string; content: string }>
  queries: Array<{ id: string; text: string; scope?: string[] }>
  legacy: { model: string; text: string; vector: number[] }
}

/** Profile the real bounded file adapter separately from catalogue/inference.
 * Only owned, already hash-checked model files are read; no model files change. */
export async function collectNativeFileIntegrityEvidence(raw: string,
  report: (phase: string, detail: unknown) => Promise<unknown>) {
  const { modelId } = JSON.parse(raw) as { modelId: string }
  const model = localEmbeddingModelCatalogPolicy.requireModel(modelId)
  const fs = await import('expo-file-system/legacy')
  const nativeFiles = await import('expo-file-system')
  const integrity = await import('../src/platform/localModels/expoLocalModelFileIntegrity')
  const native = NativeModules.AndroidFileIntegrity as import('../src/platform/localModels/expoLocalModelFileIntegrity').AndroidFileIntegrityModule | undefined
  const records = []
  for (const file of model.files) {
    const uri = `${localEmbeddingModelDirectory(model.id, 'downloaded')}${file.path}`
    let readMs = 0, infoMs = 0, readCount = 0, requestedBytes = 0, maxReadBytes = 0
    let nativeMs = 0, nativeCalls = 0, nativeBytesHashed = 0
    const port = integrity.createExpoLocalModelFileIntegrityPort({
      EncodingType: fs.EncodingType,
      async getInfoAsync(value) {
        const start = performance.now()
        try { return await fs.getInfoAsync(value) }
        finally { infoMs += performance.now() - start }
      },
      async readAsStringAsync(value, options) {
        readCount += 1; requestedBytes += options.length
        maxReadBytes = Math.max(maxReadBytes, options.length)
        const start = performance.now()
        try { return await fs.readAsStringAsync(value, { ...options, encoding: fs.EncodingType.Base64 }) }
        finally { readMs += performance.now() - start }
      },
    }, native ? {
      async sha256File(id, value, bytes) {
        nativeCalls += 1
        const start = performance.now()
        try {
          const result = await native.sha256File(id, value, bytes)
          nativeBytesHashed += result.bytesHashed
          return result
        } finally { nativeMs += performance.now() - start }
      },
      cancel(id) { native.cancel(id) },
    } : null)
    let lastTick = performance.now(), maxTimerGapMs = 0, timerTicks = 0
    const timer = setInterval(() => {
      const now = performance.now()
      maxTimerGapMs = Math.max(maxTimerGapMs, now - lastTick)
      lastTick = now; timerTicks += 1
    }, 25)
    let sha256: string, totalMs: number
    try {
      const start = performance.now()
      sha256 = await port.sha256File(uri)
      totalMs = performance.now() - start
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    } finally { clearInterval(timer) }

    // A bounded native byte read lets the existing JS hash be timed without
    // legacy base64 conversion. It is a prefix probe, not a new file verifier.
    const handle = new nativeFiles.File(uri).open(nativeFiles.FileMode.ReadOnly)
    let prefixHash: string, prefixBytes: number, prefixReadMs: number, prefixHashMs: number
    try {
      let start = performance.now()
      const prefix = handle.readBytes(Math.min(file.bytes, integrity.LOCAL_MODEL_SHA256_READ_CHUNK_BYTES))
      prefixReadMs = performance.now() - start
      prefixBytes = prefix.length
      start = performance.now()
      prefixHash = integrity.sha256LocalModelBytes(prefix)
      prefixHashMs = performance.now() - start
    } finally { handle.close() }
    const record = { path: file.path, bytes: file.bytes, sha256, totalMs, readMs, infoMs,
      nonReadMs: totalMs - readMs - infoMs, readCount, requestedBytes, maxReadBytes,
      engine: nativeCalls ? 'android-message-digest' : 'legacy-js', nativeMs, nativeCalls, nativeBytesHashed,
      maxTimerGapMs, timerTicks, prefixHash, prefixBytes, prefixReadMs, prefixHashMs }
    records.push(record)
    await report('file', record)
  }
  let nativeSafety: Record<string, unknown> | undefined
  if (native) {
    const largest = [...model.files].sort((a, b) => b.bytes - a.bytes)[0]
    const uri = `${localEmbeddingModelDirectory(model.id, 'downloaded')}${largest.path}`
    const unique = `e14-${Date.now()}`
    const outcome = async (pending: Promise<unknown>) => {
      try { return { status: 'fulfilled', value: await pending } }
      catch (error) { return { status: 'rejected', name: (error as Error).name, code: (error as { code?: string }).code } }
    }
    const wrongSize = await outcome(native.sha256File(`${unique}-size`, uri, largest.bytes + 1))
    const outside = await outcome(native.sha256File(`${unique}-outside`, 'file:///proc/self/cmdline', 0))
    const invalidSize = await outcome(native.sha256File(`${unique}-invalid`, uri, -1))
    const duplicateOwner = outcome(native.sha256File(`${unique}-duplicate`, uri, largest.bytes))
    const duplicate = await outcome(native.sha256File(`${unique}-duplicate`, uri, largest.bytes))
    native.cancel(`${unique}-duplicate`)
    const original = await duplicateOwner
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    native.cancel(`${unique}-duplicate`)
    const reuse = await outcome(native.sha256File(`${unique}-duplicate`, uri, largest.bytes))

    let started!: () => void
    const dispatched = new Promise<void>(resolve => { started = resolve })
    let nativeCancelledOutcome: unknown
    const cancelPort = integrity.createExpoLocalModelFileIntegrityPort(fs as unknown as import('../src/platform/localModels/expoLocalModelFileIntegrity').ExpoLocalModelFileSystem, {
      sha256File(id, value, bytes) {
        const result = native.sha256File(id, value, bytes)
        started()
        return result.then(value => { nativeCancelledOutcome = 'fulfilled'; return value }, error => {
          nativeCancelledOutcome = (error as { code?: string }).code; throw error
        })
      },
      cancel(id) { native.cancel(id) },
    })
    const controller = new AbortController()
    const cancelled = outcome(cancelPort.sha256File(uri, controller.signal))
    await dispatched
    const healthy = outcome(integrity.createExpoLocalModelFileIntegrityPort().sha256File(uri))
    await new Promise<void>(resolve => setTimeout(resolve, 10))
    const cancelledAt = performance.now()
    controller.abort()
    const cancelledResult = await cancelled
    const cancellationMs = performance.now() - cancelledAt
    const healthyResult = await healthy

    const emptyUri = `${fs.cacheDirectory}${unique}-empty`
    let empty: unknown
    try {
      await fs.writeAsStringAsync(emptyUri, '')
      empty = await integrity.createExpoLocalModelFileIntegrityPort().sha256File(emptyUri)
    } finally { await fs.deleteAsync(emptyUri, { idempotent: true }) }
    nativeSafety = { wrongSize, outside, invalidSize, duplicate, original, reuse,
      cancelledResult, cancellationMs, nativeCancelledOutcome, healthyResult, empty,
      cancellationBoundary: 'Abort 10 ms after real native dispatch with an independent healthy hash. Native rejection and settlement are observed; exact read offset at cancellation is not instrumented, and this is not a UI gesture.' }
    await report('native-safety', nativeSafety)
  }
  return { hermes: Boolean((globalThis as unknown as { HermesInternal?: unknown }).HermesInternal),
    platform: Platform.OS, modelId, records, nativeSafety,
    boundary: 'Instrumented production adapter delegates real native I/O and optional MessageDigest. Non-read time includes native digest, JS and scheduling, not isolated CPU. Prefix hashing uses real native FileHandle bytes. Native buffer/worker bounds come from compiled source, not a heap allocation trace. Timers are not user-cancellation gestures; files are warmed and this is not a release benchmark.' }
}

export async function collectNativeEmbeddingEvidence(database: SqliteDatabaseProvider, raw: string,
  report: (phase: string, detail: unknown) => Promise<unknown>) {
  const input = JSON.parse(raw) as EmbeddingEvidenceInput
  const startedAt = Date.now()
  await report('started', { cases: input.cases.length })
  const model = localEmbeddingModelCatalogPolicy.requireModel(input.modelId)
  await releaseOnnxEmbeddingResources()
  const ort = require('onnxruntime-react-native') as typeof import('onnxruntime-react-native')
  const originalCreate = Object.getOwnPropertyDescriptor(ort.InferenceSession, 'create')!
  const originalDispose = Object.getOwnPropertyDescriptor(ort.Tensor.prototype, 'dispose')!
  const create = ort.InferenceSession.create
  const dispose = ort.Tensor.prototype.dispose
  let creates = 0, runs = 0, releases = 0, disposals = 0
  const sessionInitializationMs: number[] = []
  const tokenizerJsonParses: Array<{ codeUnits: number; elapsedMs: number }> = []
  const vocabularyJsonBatches: Array<{ codeUnits: number; entries: number; elapsedMs: number }> = []
  let onTokenizerParsed: (() => void) | undefined
  const originalParse = Object.getOwnPropertyDescriptor(JSON, 'parse')!
  Object.defineProperty(JSON, 'parse', { ...originalParse, value: (...args: unknown[]) => {
    const start = performance.now()
    const value = Reflect.apply(originalParse.value, JSON, args)
    const elapsedMs = performance.now() - start
    const definition = value as { normalizer?: { type?: string } } | null
    if (typeof args[0] === 'string' && definition?.normalizer?.type === 'Precompiled') {
      tokenizerJsonParses.push({ codeUnits: args[0].length, elapsedMs })
      onTokenizerParsed?.()
    } else if (typeof args[0] === 'string' && Array.isArray(value) && value.length > 0
      && Array.isArray(value[0]) && value[0].length === 2 && typeof value[0][0] === 'string' && typeof value[0][1] === 'number') {
      vocabularyJsonBatches.push({ codeUnits: args[0].length, entries: value.length, elapsedMs })
    }
    return value
  } })
  const resources: Array<{ phase: string; elapsedMs: number; maxTimerGapMs: number; timerTicks: number }> = []
  const measure = async <T,>(phase: string, work: () => Promise<T>): Promise<T> => {
    const start = performance.now()
    let lastTick = start, maxTimerGapMs = 0, timerTicks = 0
    const timer = setInterval(() => {
      const now = performance.now(); maxTimerGapMs = Math.max(maxTimerGapMs, now - lastTick)
      lastTick = now; timerTicks += 1
    }, 25)
    try { return await work() } finally {
      const elapsedMs = performance.now() - start
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      maxTimerGapMs = Math.max(maxTimerGapMs, performance.now() - lastTick)
      clearInterval(timer)
      resources.push({ phase, elapsedMs, maxTimerGapMs, timerTicks })
    }
  }
  let lastFeed: Record<string, { type: string; dims: readonly number[]; data: number[] }> = {}
  let abortAfterDispatch: AbortController | undefined
  let dispatched: (() => void) | undefined
  Object.defineProperty(ort.InferenceSession, 'create', { ...originalCreate, value: async (...args: unknown[]) => {
    creates += 1
    const started = performance.now()
    const session = await Reflect.apply(create, ort.InferenceSession, args) as Awaited<ReturnType<typeof create>>
    sessionInitializationMs.push(performance.now() - started)
    const run = session.run, release = session.release
    Object.defineProperty(session, 'run', { configurable: true, value: (...runArgs: unknown[]) => {
      runs += 1
      const feeds = runArgs[0] as Record<string, InstanceType<typeof ort.Tensor>>
      lastFeed = Object.fromEntries(Object.entries(feeds).map(([name, tensor]) => [name,
        { type: tensor.type, dims: [...tensor.dims], data: Array.from(tensor.data as BigInt64Array, Number) }]))
      const pending = Reflect.apply(run, session, runArgs)
      // Abort after the real session.run invocation, not instead of native
      // inference. No binding-level kernel cancellation is claimed.
      abortAfterDispatch?.abort()
      dispatched?.()
      return pending
    } })
    Object.defineProperty(session, 'release', { configurable: true, value: async () => {
      releases += 1
      return Reflect.apply(release, session, [])
    } })
    return session
  } })
  Object.defineProperty(ort.Tensor.prototype, 'dispose', { ...originalDispose, value: function (this: InstanceType<typeof ort.Tensor>) {
    disposals += 1
    return Reflect.apply(dispose, this, [])
  } })
  try {
    const preference = { localEmbeddingModelId: model.id, localEmbeddingModelSource: 'downloaded' as const }
    const embedding = (await createOnnxEmbeddingProvider(preference))!
    if (!await measure('provider-admission', () => embedding.available!())) throw new Error('Actual native ONNX provider is unavailable')
    if (!embedding.model?.startsWith(`${model.id}@${model.version}:`)) throw new Error('Native model resolution fell back to another model')
    // available() already hashes every requested downloaded file through the
    // production catalogue/integrity owner. Do not hash the full model twice.
    await localModelStateRepository.recordInstalledModel({ modelId: model.id, source: 'downloaded',
      downloadedAt: Date.now(), verifiedAt: Date.now(), bytes: model.sizeBytes,
      sha256: Object.fromEntries(model.files.map(file => [file.path, file.sha256])) })
    await report('provider-available', { elapsedMs: Date.now() - startedAt, measurement: resources.at(-1), tokenizerJsonParses: [...tokenizerJsonParses] })
    const inputBounds = []
    if (model.tokenizer === 'unigram') {
      for (const [name, text] of [['input', 'a'.repeat(32769)], ['normalization', 'ﷺ'.repeat(4096)]]) {
        const before = { creates, runs }
        let rejected = false
        try { await measure(`reject-${name}-bound`, () => embedding.embed(text)) }
        catch (error) { rejected = /bound/.test((error as Error).message) }
        inputBounds.push({ name, rejected, noNativeWork: before.creates === creates && before.runs === runs })
      }
    }
    const records = []
    for (const item of input.cases) {
      const started = Date.now()
      const vector = await measure(`case:${item.id}`, () => embedding.embed(item.text))
      records.push({ id: item.id, text: item.text, vector, feeds: lastFeed, elapsedMs: Date.now() - started })
      if (records.length === 1) await report('first-inference', { elapsedMs: Date.now() - startedAt })
      if (records.length % 20 === 0) await report('reference-batch', { completed: records.length, elapsedMs: Date.now() - startedAt })
    }
    const initialSessionCount = creates
    const concurrent = await Promise.all([embedding.embed('Hello world!'), embedding.embed('Hello world!')])
    const concurrency = { initialSessionCount, afterConcurrentSessionCount: creates, vectorsEqual: JSON.stringify(concurrent[0]) === JSON.stringify(concurrent[1]) }
    await report('reference-complete', { concurrency, elapsedMs: Date.now() - startedAt })

    const repository = createSqliteKnowledgeRepository(database)
    const queryEmbedding = createKnowledgeQueryEmbeddingUseCase({
      async embedWithOnnx(request) {
        if (request.localEmbeddingModelSource === 'none') return null
        return { embedding: await embedding.embed(request.query, { signal: request.signal }), model: embedding.model! }
      },
      async embedWithProvider() { throw new Error('Provider calls are forbidden in native embedding evidence') },
      async notifyProviderUnsupported() {},
    })
    const index = createSqliteKnowledgeHybridIndex(database, { repository, queryEmbedding,
      resolveOnnxEmbeddingPort: () => ({ model: embedding.model!, embed: (text, options) => embedding.embed(text, options) }) })
    const signal = new AbortController().signal
    const chunks: KnowledgeChunkRecord[] = []
    const saveDocument = async (id: string, title: string, content: string) => {
      const chunk: KnowledgeChunkRecord = { schema: KNOWLEDGE_CHUNK_RECORD_SCHEMA, id: `${id}-0`, documentId: id,
        title, content, ordinal: 0, chunkIndex: 0, embeddingProvider: 'hash' as const, createdAt: Date.now() }
      await repository.saveDocument({ schema: KNOWLEDGE_DOCUMENT_RECORD_SCHEMA, id, title, mimeType: 'text/plain',
        size: content.length, chunkCount: 1, status: 'ready', sourceUri: `file:///e2-evaluation/${id}.txt`,
        createdAt: Date.now(), updatedAt: Date.now() }, [chunk], { signal })
      await index.synchronizeEmbeddings([chunk], { embeddingMode: 'local', localEmbeddingModelSource: 'none', signal })
      return chunk
    }
    for (const document of input.documents) {
      chunks.push(await saveDocument(document.id, document.title, document.content))
      if (chunks.length % 20 === 0) await report('index-batch', { documents: chunks.length, elapsedMs: Date.now() - startedAt })
    }
    const retrieval = []
    for (const source of ['none', 'downloaded'] as const) {
      if (source === 'downloaded') await index.synchronizeEmbeddings(chunks, { ...preference, embeddingMode: 'local', signal })
      await index.clearCache({ signal })
      for (const query of input.queries) {
        const hits = await index.searchHybrid({ query: query.text, limit: 5, embeddingMode: 'local',
          localEmbeddingModelId: model.id, localEmbeddingModelSource: source, knowledgeScope: buildKnowledgeScope(query.scope), signal })
        retrieval.push({ mode: source === 'none' ? 'hash-hybrid' : 'onnx-hybrid', id: query.id, hits })
      }
      await report('retrieval-mode-complete', { source, elapsedMs: Date.now() - startedAt })
    }
    // Seed a real old-space vector as historical durable state, not a new write
    // mislabeled as v2. Query/fallback must preserve it until explicit reindexing.
    const legacyChunk = await saveDocument('e2-legacy', 'Legacy vector canonical source', input.legacy.text)
    const db = await database.get()
    await db.run("UPDATE chunk_embeddings SET embeddingJson = ?, dimension = ?, source = 'onnx', model = ?, status = 'ready', error = NULL WHERE chunkId = ?",
      [JSON.stringify(input.legacy.vector), input.legacy.vector.length, input.legacy.model, legacyChunk.id])
    const readLegacy = () => db.getFirst('SELECT * FROM chunk_embeddings WHERE chunkId = ?', [legacyChunk.id])
    const before = await readLegacy()
    const legacyHits = await index.searchHybrid({ query: input.legacy.text, limit: 5, embeddingMode: 'local',
      ...preference, knowledgeScope: buildKnowledgeScope(['e2-legacy']), signal })
    const afterQuery = await readLegacy()
    await index.synchronizeEmbeddings([legacyChunk], { embeddingMode: 'local', localEmbeddingModelSource: 'none', signal })
    const afterFallback = await readLegacy()
    await index.synchronizeEmbeddings([legacyChunk], { embeddingMode: 'local', ...preference, signal })
    const afterExplicitReindex = await readLegacy()
    const canonical = await repository.readLocalSource({ type: 'knowledge', documentId: 'e2-legacy' })
    await report('legacy-complete', { elapsedMs: Date.now() - startedAt })

    const preAbort = new AbortController(); preAbort.abort()
    const runsBeforePreAbort = runs
    let preAbortName: string | undefined
    try { await embedding.embed('Hello world!', { signal: preAbort.signal }) } catch (error) { preAbortName = (error as Error).name }
    const noPreAbortedDispatch = runs === runsBeforePreAbort
    abortAfterDispatch = new AbortController()
    const ready = new Promise<void>(resolve => { dispatched = resolve })
    const pending = embedding.embed('hello '.repeat(300), { signal: abortAfterDispatch.signal })
      .then(() => 'unexpected-success', error => (error as Error).name)
    await ready
    const releasesWhilePending = releases
    const disposalsBeforeSettle = disposals
    await releaseOnnxEmbeddingResources()
    const noEarlyRelease = releases === releasesWhilePending
    const lateAbortName = await pending
    const cancellation = { preAbortName, noPreAbortedDispatch, lateAbortName, noEarlyRelease,
      tensorsDisposedAfterSettle: disposals > disposalsBeforeSettle, releasesAfterSettle: releases - releasesWhilePending,
      scope: 'Test-entry abort after real session.run invocation; late results discarded, not native kernel cancellation.' }
    await report('cancellation-complete', { elapsedMs: Date.now() - startedAt })
    let initialization: Record<string, unknown> | undefined
    if (model.tokenizer === 'unigram') {
      abortAfterDispatch = undefined; dispatched = undefined
      try {
        // Observe the real parse, then act during cooperative vocabulary build.
        // Expo's re-exported filesystem functions are immutable accessors.
        const peerAbort = new AbortController()
        const parsed = new Promise<void>(resolve => { onTokenizerParsed = resolve })
        const before = { creates, runs, parses: tokenizerJsonParses.length }
        const peers = Promise.allSettled([embedding.embed(input.cases[0].text, { signal: peerAbort.signal }), embedding.embed(input.cases[0].text)])
        await parsed; peerAbort.abort()
        const outcomes = await peers
        const shared = { cancelledName: outcomes[0].status === 'rejected' ? (outcomes[0].reason as Error).name : 'unexpected-success',
          healthyVector: outcomes[1].status === 'fulfilled' ? outcomes[1].value : null,
          tokenizerParses: tokenizerJsonParses.length - before.parses, sessionCreates: creates - before.creates, runs: runs - before.runs }
        await releaseOnnxEmbeddingResources()

        // Retirement while real tokenizer initialization is pending cannot admit a
        // session later. No file is deleted or altered by this test interleaving.
        const retiringParse = new Promise<void>(resolve => { onTokenizerParsed = resolve })
        const beforeRetire = { creates, runs }
        const retiring = embedding.embed(input.cases[0].text).then(() => 'unexpected-success', error => (error as Error).name)
        await retiringParse; await releaseOnnxEmbeddingResources()
        const retiredName = await retiring
        const noRetiredNativeWork = creates === beforeRetire.creates && runs === beforeRetire.runs
        onTokenizerParsed = undefined
        const retryVector = await embedding.embed(input.cases[0].text)
        initialization = { shared, retiredName, noRetiredNativeWork, retryVector,
          scope: 'Abort/retire at the real metadata parse before tokenizer admission returns, with actual native file reads and ORT. Controlled interleavings, not user gestures or native kernel preemption.' }
        await report('initialization-authority-complete', { elapsedMs: Date.now() - startedAt })
      } finally { onTokenizerParsed = undefined }
    }
    return { hermes: Boolean((globalThis as typeof globalThis & { HermesInternal?: unknown }).HermesInternal),
      platform: Platform.OS, androidVersion: Platform.Version, onnxRuntimeVersions: ort.env.versions,
      nativeOnnxRuntimeVersion: (globalThis as typeof globalThis & { OrtApi?: { version?: string } }).OrtApi?.version,
      model: embedding.model, dimension: embedding.dimension,
      modelDirectory: localEmbeddingModelDirectory(model.id, 'downloaded'), nativeFileVerification: true,
      records, concurrency, retrieval, legacy: { before, afterQuery, afterFallback, afterExplicitReindex, hits: legacyHits, canonical },
      cancellation, initialization, resources, inputBounds, sessionInitializationMs, tokenizerJsonParses, vocabularyJsonBatches,
      resourceBoundary: '25 ms JS timer samples and operation wall times in a debug test entry, not rendered frames or isolated CPU. Controller memory checkpoints are snapshots, not a peak trace.',
      nativeSessionCreates: creates, nativeRuns: runs, nativeReleases: releases, tensorDisposeCalls: disposals }
  } finally {
    abortAfterDispatch = undefined; dispatched = undefined
    await releaseOnnxEmbeddingResources()
    Object.defineProperty(ort.InferenceSession, 'create', originalCreate)
    Object.defineProperty(ort.Tensor.prototype, 'dispose', originalDispose)
    Object.defineProperty(JSON, 'parse', originalParse)
  }
}

/** Measure real bootstrap query/index factories, not the reused-provider E2 fixture.
 * Wrappers only observe/delegate. Cancellation is injected after native file
 * verification has started; corrupting one owned fixture file is always undone. */
export async function collectNativeEmbeddingAdmissionEvidence(raw: string,
  report: (phase: string, detail: unknown) => Promise<unknown>) {
  const input = JSON.parse(raw) as { modelId: string; text: string }
  const { knowledgeRepository, knowledgeHybridIndex } = await import('../src/bootstrap/knowledgeRepository')
  const catalog = require('../src/bootstrap/localModelCatalog') as typeof import('../src/bootstrap/localModelCatalog')
  const fileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy')
  const ort = require('onnxruntime-react-native') as typeof import('onnxruntime-react-native')
  const policy = catalog.localEmbeddingModelCatalogPolicy
  const resolveDescriptor = Object.getOwnPropertyDescriptor(policy, 'resolveActiveModel')!
  const createDescriptor = Object.getOwnPropertyDescriptor(ort.InferenceSession, 'create')!
  const resolve = policy.resolveActiveModel
  const create = ort.InferenceSession.create
  const verifications: Array<Record<string, unknown>> = []
  const measurements: Array<Record<string, unknown>> = [], sessionCreates: number[] = [], nativeRuns: number[] = []
  const pending: Promise<unknown>[] = []
  let verificationStarted: (() => void) | undefined
  let phase = 'setup'
  const track = <T>(promise: Promise<T>) => { pending.push(promise.catch(() => undefined)); return promise }
  const drain = async () => {
    let cursor = 0
    while (cursor < pending.length) { const batch = pending.slice(cursor); cursor = pending.length; await Promise.all(batch) }
  }
  // Observe the mutable owner instance. Metro's named re-exports are accessor
  // properties, not replaceable function slots. No production export is changed.
  Object.defineProperty(policy, 'resolveActiveModel', { ...resolveDescriptor, value: (...args: Parameters<typeof resolve>) => {
    const started = Date.now()
    const operationSignal = args[1]?.signal
    const record: Record<string, unknown> = { phase, signalProvided: Boolean(operationSignal),
      files: policy.requireModel(input.modelId).files.map(file => ({ bytes: file.bytes, sha256: file.sha256 })),
      scope: 'Real catalogue admission including file verification; not isolated filesystem/SHA timing.' }
    verifications.push(record)
    const operation = resolve(...args)
    verificationStarted?.(); verificationStarted = undefined
    return track(operation.then(value => { record.result = value !== null; record.modelId = value?.model.id ?? null; return value }, error => {
      record.errorName = (error as Error).name; throw error
    }).finally(() => { record.elapsedMs = Date.now() - started; record.abortedAtSettlement = operationSignal?.aborted ?? false }))
  } })
  Object.defineProperty(ort.InferenceSession, 'create', { ...createDescriptor, value: async (...args: Parameters<typeof create>) => {
    const started = Date.now()
    const session = await Reflect.apply(create, ort.InferenceSession, args) as Awaited<ReturnType<typeof create>>
    sessionCreates.push(Date.now() - started)
    const run = session.run
    Object.defineProperty(session, 'run', { configurable: true, value: async (...runArgs: unknown[]) => {
      const runStarted = Date.now()
      try { return await Reflect.apply(run, session, runArgs) }
      finally { nativeRuns.push(Date.now() - runStarted) }
    } })
    return session
  } })
  const preference = { localEmbeddingModelId: input.modelId, localEmbeddingModelSource: 'downloaded' as const, embeddingMode: 'local' as const }
  const signal = new AbortController().signal
  const id = `e14-admission-${Date.now()}`
  const chunk: KnowledgeChunkRecord = { schema: KNOWLEDGE_CHUNK_RECORD_SCHEMA, id: `${id}-0`, documentId: id,
    title: 'E14 model admission', content: input.text, ordinal: 0, chunkIndex: 0, embeddingProvider: 'hash', createdAt: Date.now() }
  const database = await createExpoSqliteDatabaseProvider().get()
  const readVector = () => database.getFirst<Record<string, unknown>>('SELECT * FROM chunk_embeddings WHERE chunkId = ?', [chunk.id])
  const measure = async <T>(label: string, operation: () => Promise<T>) => {
    const started = Date.now(), before = verifications.length, runsBefore = nativeRuns.length
    const row: Record<string, unknown> = { label }
    measurements.push(row)
    let value: T | undefined
    try { value = await operation(); row.outcome = 'fulfilled' }
    catch (error) { row.outcome = 'rejected'; row.errorName = (error as Error).name }
    row.elapsedMs = Date.now() - started; row.verificationsStarted = verifications.length - before
    row.nativeRunsCompleted = nativeRuns.length - runsBefore
    await report(label, row)
    return value
  }
  const search = (operationSignal: AbortSignal, observeResolution = false) => knowledgeHybridIndex.searchHybrid({
    ...preference, query: input.text, limit: 5, knowledgeScope: buildKnowledgeScope([id]), signal: operationSignal,
    // This existing observer bypasses result-cache reads, not model admission.
    ...(observeResolution ? { onEmbeddingResolved: () => {} } : {}),
  })
  let originalFile: string | undefined
  const configUri = `${catalog.localEmbeddingModelDirectory(input.modelId, 'downloaded')}config.json`
  try {
    await releaseOnnxEmbeddingResources()
    await knowledgeRepository.saveDocument({ schema: KNOWLEDGE_DOCUMENT_RECORD_SCHEMA, id, title: chunk.title,
      mimeType: 'text/plain', size: input.text.length, chunkCount: 1, status: 'ready',
      sourceUri: `file:///e14-evaluation/${id}.txt`, createdAt: Date.now(), updatedAt: Date.now() }, [chunk], { signal })
    phase = 'cold-index'
    const cold = await measure(phase, () => knowledgeHybridIndex.synchronizeEmbeddings([chunk], { ...preference, signal }))
    const initialVector = await readVector()
    phase = 'warm-query'
    const warm = await measure(phase, () => search(signal))
    phase = 'query-cache-hit'
    const cached = await measure(phase, () => search(signal))

    phase = 'concurrent-cancelled-and-healthy-query'
    const cancelled = new AbortController()
    const started = new Promise<void>(yes => { verificationStarted = yes })
    const cancelledQuery = measure('cancelled-query', () => search(cancelled.signal, true))
    await started
    const healthyQuery = measure('concurrent-healthy-query', () => search(signal, true))
    cancelled.abort()
    const concurrent = await Promise.all([cancelledQuery, healthyQuery])
    const drainStarted = Date.now(); await drain()
    await report('query-background-work-drained', { elapsedMs: Date.now() - drainStarted })
    const afterQueryCancellation = await readVector()

    phase = 'cancelled-index'
    const indexAbort = new AbortController()
    const indexStarted = new Promise<void>(yes => { verificationStarted = yes })
    const cancelledIndex = measure(phase, () => knowledgeHybridIndex.synchronizeEmbeddings([chunk], { ...preference, signal: indexAbort.signal }))
    await indexStarted; indexAbort.abort(); await cancelledIndex
    const indexDrainStarted = Date.now(); await drain()
    const indexBackgroundWorkMs = Date.now() - indexDrainStarted
    await report('index-background-work-drained', { elapsedMs: indexBackgroundWorkMs })
    const afterIndexCancellation = await readVector()

    phase = 'same-size-corrupt-config'
    originalFile = await fileSystem.readAsStringAsync(configUri)
    if (!originalFile.startsWith('{')) throw new Error('Unexpected owned fixture configuration; refusing corruption probe')
    await fileSystem.writeAsStringAsync(configUri, `!${originalFile.slice(1)}`)
    const beforeCorruptRuns = nativeRuns.length
    const corrupt = await measure(phase, () => knowledgeHybridIndex.synchronizeEmbeddings([chunk], { ...preference, signal }))
    const afterCorrupt = await readVector()
    const corruptDispatchedInference = nativeRuns.length !== beforeCorruptRuns
    await fileSystem.writeAsStringAsync(configUri, originalFile)
    const configRestored = await fileSystem.readAsStringAsync(configUri) === originalFile
    originalFile = undefined
    const canonical = await knowledgeRepository.readLocalSource({ type: 'knowledge', documentId: id })
    return { hermes: Boolean((globalThis as typeof globalThis & { HermesInternal?: unknown }).HermesInternal),
      platform: Platform.OS, nativeOnnxRuntimeVersion: (globalThis as typeof globalThis & { OrtApi?: { version?: string } }).OrtApi?.version,
      modelId: input.modelId, text: input.text, measurements, verifications, sessionCreates, nativeRuns,
      cold, warmSourceIds: warm?.map(hit => hit.documentId), cachedSourceIds: cached?.map(hit => hit.documentId),
      healthySourceIds: concurrent[1]?.map(hit => hit.documentId), fixtureId: id, initialVector,
      afterQueryCancellation, afterIndexCancellation, indexBackgroundWorkMs,
      corrupt, afterCorrupt, corruptDispatchedInference, configRestored, canonicalText: canonical?.type === 'knowledge' ? canonical.chunks[0]?.content : undefined }
  } finally {
    verificationStarted = undefined
    if (originalFile !== undefined) await fileSystem.writeAsStringAsync(configUri, originalFile)
    await drain()
    await releaseOnnxEmbeddingResources()
    Object.defineProperty(policy, 'resolveActiveModel', resolveDescriptor)
    Object.defineProperty(ort.InferenceSession, 'create', createDescriptor)
    await knowledgeRepository.deleteDocument(id)
  }
}
