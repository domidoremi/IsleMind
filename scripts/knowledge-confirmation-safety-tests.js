// Run with Bun against owned in-memory SQLite only. No device or provider access.
const assert = require('node:assert/strict')
const { Database } = require('bun:sqlite')
const {
  createSqliteKnowledgeRepository,
} = require('../src/modules/knowledge/adapters/sqliteKnowledgeRepository.ts')
const {
  KNOWLEDGE_DOCUMENT_RECORD_SCHEMA,
  KNOWLEDGE_CHUNK_RECORD_SCHEMA,
} = require('../src/modules/knowledge/contracts.ts')

function fixture() {
  const native = new Database(':memory:')
  let afterRun
  const executor = {
    async exec(sql) { native.exec(sql) },
    async run(sql, values = []) {
      const result = native.query(sql).run(...values)
      if (afterRun) afterRun(sql)
      return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }
    },
    async getFirst(sql, values = []) { return native.query(sql).get(...values) },
    async getAll(sql, values = []) { return native.query(sql).all(...values) },
  }
  let tail = Promise.resolve()
  const database = {
    ...executor,
    transaction(work) {
      const result = tail.then(async () => {
        native.exec('BEGIN IMMEDIATE')
        try {
          const value = await work(executor)
          native.exec('COMMIT')
          return value
        } catch (error) {
          native.exec('ROLLBACK')
          throw error
        }
      })
      tail = result.then(() => undefined, () => undefined)
      return result
    },
  }
  const provider = { get: async () => database }
  const repository = createSqliteKnowledgeRepository(
    provider,
    { clock: { now: () => 100 } },
  )
  return { native, repository, provider, database, setAfterRun: callback => { afterRun = callback } }
}

async function holdTransactions(database) {
  let release
  let enter
  const ready = new Promise(resolve => { enter = resolve })
  const pending = database.transaction(async () => {
    enter()
    await new Promise(resolve => { release = resolve })
  })
  await ready
  return async () => { release(); await pending }
}

const memory = (id, overrides = {}) => ({
  id, content: `Reviewed memory ${id}`, status: 'pending', sourceKind: 'manual',
  createdAt: 100, updatedAt: 100, ...overrides,
})
const document = (id, overrides = {}) => ({
  schema: KNOWLEDGE_DOCUMENT_RECORD_SCHEMA, id, title: `Reviewed document ${id}`,
  mimeType: 'text/plain', size: 16, chunkCount: 1, status: 'ready',
  contentHash: `hash-${id}`, createdAt: 100, updatedAt: 100, ...overrides,
})
const chunk = id => ({
  schema: KNOWLEDGE_CHUNK_RECORD_SCHEMA, id: `chunk-${id}`, documentId: id,
  title: `Reviewed document ${id}`, content: `Searchable text ${id}`, ordinal: 0, createdAt: 100,
})
const conflict = { name: 'KnowledgeRepositoryConflictError' }
const cases = []
function check(name, work) { cases.push({ name, work }) }

check('status recovery acknowledges the indexed source and clears its old failure without replacing chunks', async ({ repository, native }) => {
  const reviewed = document('recover', { status: 'error', error: 'Indexing interrupted' })
  await repository.saveDocument(reviewed, [chunk(reviewed.id)])
  const chunks = await repository.listChunks(reviewed.id)
  await repository.updateDocumentStatus(reviewed.id, 'ready', undefined, {
    expectedDocument: reviewed, expectedChunks: chunks,
  })
  const { error: _oldError, ...recovered } = reviewed
  assert.deepEqual((await repository.listDocuments())[0], { ...recovered, status: 'ready' })
  assert.deepEqual(await repository.listChunks(reviewed.id), chunks)
  assert.equal(native.query('SELECT count(*) AS count FROM knowledge_fts WHERE documentId = ?').get(reviewed.id).count, 1)
})

check('status recovery rejects changed and missing reviewed documents', async ({ repository }) => {
  const reviewed = document('recover', { status: 'error' })
  await repository.saveDocument(reviewed, [chunk(reviewed.id)])
  const replacement = { ...reviewed, title: 'Unreviewed replacement' }
  await repository.saveDocument(replacement, [chunk(reviewed.id)])
  await assert.rejects(repository.updateDocumentStatus(reviewed.id, 'ready', undefined, {
    expectedDocument: reviewed,
  }), conflict)
  assert.deepEqual((await repository.listDocuments())[0], replacement)
  await repository.deleteDocument(reviewed.id)
  await assert.rejects(repository.updateDocumentStatus(reviewed.id, 'ready', undefined, {
    expectedDocument: reviewed,
  }), conflict)
  assert.deepEqual(await repository.listDocuments(), [])
})

check('status recovery rejects same-tick chunk replacements despite unchanged document metadata', async ({ repository }) => {
  const reviewed = document('recover', { status: 'error' })
  const original = chunk(reviewed.id)
  await repository.saveDocument(reviewed, [original])
  const expectedChunks = await repository.listChunks(reviewed.id)
  await repository.saveDocument(reviewed, [{ ...original, content: 'Unreviewed content' }])
  await assert.rejects(repository.updateDocumentStatus(reviewed.id, 'ready', undefined, {
    expectedDocument: reviewed, expectedChunks,
  }), conflict)
  assert.equal((await repository.listDocuments())[0].status, 'error')
  assert.equal((await repository.listChunks(reviewed.id))[0].content, 'Unreviewed content')
})

check('status recovery allows index-derived provenance and retrieval timestamps to change', async ({ repository, native }) => {
  const reviewed = document('recover', { status: 'error' })
  await repository.saveDocument(reviewed, [chunk(reviewed.id)])
  const expectedChunks = await repository.listChunks(reviewed.id)
  native.query('UPDATE knowledge_chunks SET embeddingProvider = ?, summaryNodeId = ?, lastHitAt = ? WHERE documentId = ?')
    .run('hash', 'rebuilt-summary', 101, reviewed.id)
  await repository.updateDocumentStatus(reviewed.id, 'ready', undefined, {
    expectedDocument: reviewed, expectedChunks,
  })
  assert.equal((await repository.listDocuments())[0].status, 'ready')
  assert.equal((await repository.listChunks(reviewed.id))[0].summaryNodeId, 'rebuilt-summary')
})

check('status recovery detaches reviewed chunks before waiting for transaction admission', async ({ repository, database }) => {
  const reviewed = document('recover', { status: 'error' })
  await repository.saveDocument(reviewed, [chunk(reviewed.id)])
  const expectedDocument = { ...reviewed }, expectedChunks = await repository.listChunks(reviewed.id)
  const release = await holdTransactions(database)
  const pending = repository.updateDocumentStatus(reviewed.id, 'ready', undefined, { expectedDocument, expectedChunks })
  expectedDocument.title = 'Caller mutation'
  expectedChunks[0].content = 'Caller mutation'
  await release()
  await pending
  assert.equal((await repository.listDocuments())[0].status, 'ready')
  assert.equal((await repository.listChunks(reviewed.id))[0].content, chunk(reviewed.id).content)
})

check('status recovery uses the original cancelled signal after queued transaction admission', async ({ repository, database }) => {
  const reviewed = document('recover', { status: 'error' })
  await repository.saveDocument(reviewed, [chunk(reviewed.id)])
  const release = await holdTransactions(database)
  const controller = new AbortController(), options = { expectedDocument: reviewed, signal: controller.signal }
  const pending = repository.updateDocumentStatus(reviewed.id, 'ready', undefined, options)
  controller.abort()
  options.signal = new AbortController().signal
  const rejected = assert.rejects(pending, { name: 'KnowledgeRepositoryCancelledError' })
  await release()
  await rejected
  assert.equal((await repository.listDocuments())[0].status, 'error')
})

check('cancelled status acknowledgement rolls back the persisted update', async ({ repository, setAfterRun }) => {
  const reviewed = document('recover', { status: 'error' })
  await repository.saveDocument(reviewed, [chunk(reviewed.id)])
  const controller = new AbortController()
  setAfterRun(sql => { if (sql.startsWith('UPDATE knowledge_documents SET status')) controller.abort() })
  await assert.rejects(repository.updateDocumentStatus(reviewed.id, 'ready', undefined, {
    expectedDocument: reviewed, signal: controller.signal,
  }), { name: 'KnowledgeRepositoryCancelledError' })
  assert.equal((await repository.listDocuments())[0].status, 'error')
})

check('activation refuses same-ID content changes even within the same clock tick', async ({ repository }) => {
  const reviewed = await repository.saveMemory(memory('changed'))
  const changed = await repository.saveMemory({ ...reviewed, content: 'Unreviewed replacement' })
  await assert.rejects(repository.updateMemoryStatus(reviewed.id, 'active', {
    expectedMemory: reviewed, expectedActiveMemory: null,
  }), conflict)
  assert.deepEqual((await repository.listMemories())[0], changed)
})

check('activation refuses a disappeared reviewed target instead of reporting a successful no-op', async ({ repository }) => {
  const reviewed = await repository.saveMemory(memory('removed'))
  await repository.deleteMemory(reviewed.id)
  await assert.rejects(repository.updateMemoryStatus(reviewed.id, 'active', {
    expectedMemory: reviewed, expectedActiveMemory: null,
  }), conflict)
  assert.deepEqual(await repository.listMemories(), [])
})

check('rejection refuses a replacement record with the same ID', async ({ repository }) => {
  const reviewed = await repository.saveMemory(memory('replaced'))
  await repository.deleteMemory(reviewed.id)
  const replacement = await repository.saveMemory(memory(reviewed.id, {
    content: 'New record', scope: { kind: 'conversation', id: 'new-scope' },
    conversationId: 'new-scope', sourceKind: 'imported',
  }))
  await assert.rejects(repository.deleteMemory(reviewed.id, { expectedMemory: reviewed }), conflict)
  assert.deepEqual((await repository.listMemories())[0], replacement)
})

check('activation cannot supersede an active logical fact that appeared after review', async ({ repository }) => {
  const fact = { subject: 'User', key: 'color', value: 'Amber' }
  const reviewed = await repository.saveMemory(memory('candidate', fact))
  const unseen = await repository.saveMemory(memory('unseen-active', {
    ...fact, value: 'Blue', content: 'Use blue', status: 'active',
  }))
  await assert.rejects(repository.updateMemoryStatus(reviewed.id, 'active', {
    expectedMemory: reviewed, expectedActiveMemory: null,
  }), conflict)
  const records = await repository.listMemories()
  assert.equal(records.find(item => item.id === reviewed.id).status, 'pending')
  assert.deepEqual(records.find(item => item.id === unseen.id), unseen)
})

check('activation compares the reviewed conflicting fact as well as the candidate', async ({ repository }) => {
  const fact = { subject: 'User', key: 'color' }
  const active = await repository.saveMemory(memory('active', { ...fact, value: 'Blue', status: 'active' }))
  const reviewed = await repository.saveMemory(memory('candidate', { ...fact, value: 'Amber' }))
  const changedActive = await repository.saveMemory({ ...active, sourceDetail: 'Changed provenance' })
  await assert.rejects(repository.updateMemoryStatus(reviewed.id, 'active', {
    expectedMemory: reviewed, expectedActiveMemory: active,
  }), conflict)
  assert.deepEqual((await repository.listMemories()).find(item => item.id === active.id), changedActive)
})

check('confirmed memory clear removes only the displayed snapshot, not new unseen records', async ({ repository, native }) => {
  const reviewed = await repository.saveMemory(memory('reviewed'))
  const unseen = await repository.saveMemory(memory('unseen'))
  await repository.clearMemories({ expectedMemories: [reviewed] })
  assert.deepEqual(await repository.listMemories(), [unseen])
  assert.equal(native.query('SELECT count(*) AS count FROM memory_fts WHERE id = ?').get(unseen.id).count, 1)
})

check('a stale memory clear rolls back all selected canonical and FTS records', async ({ repository, native }) => {
  const first = await repository.saveMemory(memory('first'))
  const second = await repository.saveMemory(memory('second'))
  const changed = await repository.saveMemory({ ...second, content: 'Changed second' })
  await assert.rejects(repository.clearMemories({ expectedMemories: [first, second] }), conflict)
  const records = await repository.listMemories()
  assert.deepEqual(records.find(item => item.id === first.id), first)
  assert.deepEqual(records.find(item => item.id === second.id), changed)
  assert.equal(native.query('SELECT count(*) AS count FROM memory_fts').get().count, 2)
})

check('document deletion refuses changed source identity and retains canonical chunks and FTS', async ({ repository, native }) => {
  const reviewed = document('changed')
  await repository.saveDocument(reviewed, [chunk(reviewed.id)])
  const changed = { ...reviewed, contentHash: 'unreviewed-source', title: 'Changed document' }
  await repository.saveDocument(changed, [chunk(reviewed.id)])
  await assert.rejects(repository.deleteDocument(reviewed.id, { expectedDocument: reviewed }), conflict)
  assert.deepEqual(await repository.listDocuments(), [changed])
  assert.equal((await repository.listChunks(reviewed.id)).length, 1)
  assert.equal(native.query('SELECT count(*) AS count FROM knowledge_fts').get().count, 1)
})

check('confirmed document clear preserves new unseen documents and their indexes', async ({ repository, native }) => {
  const reviewed = document('reviewed')
  const unseen = document('unseen')
  await repository.saveDocument(reviewed, [chunk(reviewed.id)])
  await repository.saveDocument(unseen, [chunk(unseen.id)])
  await repository.clearDocuments({ expectedDocuments: [reviewed] })
  assert.deepEqual(await repository.listDocuments(), [unseen])
  assert.deepEqual((await repository.listChunks()).map(item => item.documentId), [unseen.id])
  assert.equal(native.query('SELECT count(*) AS count FROM knowledge_fts').get().count, 1)
})

check('a stale document clear rolls back every selected document, chunk and FTS record', async ({ repository, native }) => {
  const first = document('first')
  const second = document('second')
  await repository.saveDocument(first, [chunk(first.id)])
  await repository.saveDocument(second, [chunk(second.id)])
  await repository.saveDocument({ ...second, title: 'Changed second' }, [chunk(second.id)])
  await assert.rejects(repository.clearDocuments({ expectedDocuments: [first, second] }), conflict)
  assert.equal((await repository.listDocuments()).length, 2)
  assert.equal((await repository.listChunks()).length, 2)
  assert.equal(native.query('SELECT count(*) AS count FROM knowledge_fts').get().count, 2)
})

check('explicit empty confirmations never fall through to a full clear', async ({ repository }) => {
  const retained = await repository.saveMemory(memory('retained'))
  const retainedDocument = document('retained')
  await repository.saveDocument(retainedDocument, [chunk(retainedDocument.id)])
  await repository.clearMemories({ expectedMemories: [] })
  await repository.clearDocuments({ expectedDocuments: [] })
  assert.deepEqual(await repository.listMemories(), [retained])
  assert.deepEqual(await repository.listDocuments(), [retainedDocument])
})

check('unchanged review supports activation, reopen, disabling and explicit rejection', async ({ repository, provider }) => {
  const reviewed = await repository.saveMemory(memory('unchanged'))
  await repository.updateMemoryStatus(reviewed.id, 'active', { expectedMemory: reviewed, expectedActiveMemory: null })
  const reopened = createSqliteKnowledgeRepository(provider, { clock: { now: () => 101 } })
  const active = (await reopened.listMemories())[0]
  assert.equal(active.status, 'active')
  assert.equal(active.lastConfirmedAt, 100)
  await reopened.updateMemoryStatus(active.id, 'disabled', { expectedMemory: active })
  const disabled = (await reopened.listMemories())[0]
  assert.equal(disabled.status, 'disabled')
  await reopened.deleteMemory(disabled.id, { expectedMemory: disabled })
  assert.deepEqual(await reopened.listMemories(), [])
})

check('explicit review of both logical facts authorizes supersession and persists truthful provenance', async ({ repository, native }) => {
  const fact = { subject: 'User', key: 'color' }
  const active = await repository.saveMemory(memory('active', { ...fact, value: 'Blue', status: 'active' }))
  const reviewed = await repository.saveMemory(memory('candidate', { ...fact, value: 'Amber' }))
  await repository.updateMemoryStatus(reviewed.id, 'active', { expectedMemory: reviewed, expectedActiveMemory: active })
  const records = await repository.listMemories()
  assert.equal(records.find(item => item.id === active.id).status, 'superseded')
  const confirmed = records.find(item => item.id === reviewed.id)
  assert.equal(confirmed.status, 'active')
  assert.equal(confirmed.supersedesId, active.id)
  assert.equal(confirmed.conflictWithId, undefined)
  assert.equal(native.query('SELECT count(*) AS count FROM memory_fts').get().count, 2)
})

check('competing writes with the same confirmation snapshot cannot both succeed', async ({ repository }) => {
  const reviewed = await repository.saveMemory(memory('competing'))
  const options = { expectedMemory: reviewed, expectedActiveMemory: null }
  const results = await Promise.allSettled([
    repository.updateMemoryStatus(reviewed.id, 'active', options),
    repository.updateMemoryStatus(reviewed.id, 'disabled', options),
  ])
  assert.deepEqual(results.map(item => item.status), ['fulfilled', 'rejected'])
  assert.equal(results[1].reason.name, conflict.name)
  assert.equal((await repository.listMemories())[0].status, 'active')
})

check('omitting the reviewed active-fact snapshot never implicitly authorizes supersession', async ({ repository }) => {
  const fact = { subject: 'User', key: 'color' }
  const active = await repository.saveMemory(memory('active', { ...fact, value: 'Blue', status: 'active' }))
  const reviewed = await repository.saveMemory(memory('candidate', { ...fact, value: 'Amber' }))
  await assert.rejects(repository.updateMemoryStatus(reviewed.id, 'active', { expectedMemory: reviewed }), conflict)
  assert.deepEqual((await repository.listMemories()).find(item => item.id === active.id), active)
})

check('a confirmation snapshot cannot authorize a different target ID', async ({ repository }) => {
  const reviewed = await repository.saveMemory(memory('reviewed'))
  const other = await repository.saveMemory(memory('other'))
  await assert.rejects(repository.deleteMemory(other.id, { expectedMemory: reviewed }), conflict)
  assert.equal((await repository.listMemories()).length, 2)
  const reviewedDocument = document('reviewed')
  const otherDocument = document('other')
  await repository.saveDocument(reviewedDocument, [chunk(reviewedDocument.id)])
  await repository.saveDocument(otherDocument, [chunk(otherDocument.id)])
  await assert.rejects(repository.deleteDocument(otherDocument.id, { expectedDocument: reviewedDocument }), conflict)
  assert.equal((await repository.listDocuments()).length, 2)
})

check('cancellation before a confirmed mutation leaves every record intact', async ({ repository }) => {
  const reviewed = await repository.saveMemory(memory('cancelled'))
  const reviewedDocument = document('cancelled')
  await repository.saveDocument(reviewedDocument, [chunk(reviewedDocument.id)])
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(repository.clearMemories({ expectedMemories: [reviewed], signal: controller.signal }), { name: 'KnowledgeRepositoryCancelledError' })
  await assert.rejects(repository.clearDocuments({ expectedDocuments: [reviewedDocument], signal: controller.signal }), { name: 'KnowledgeRepositoryCancelledError' })
  assert.deepEqual(await repository.listMemories(), [reviewed])
  assert.deepEqual(await repository.listDocuments(), [reviewedDocument])
})

check('cancellation after memory FTS deletion rolls back the entire confirmed clear', async ({ repository, native, setAfterRun }) => {
  const reviewed = await repository.saveMemory(memory('cancelled'))
  const controller = new AbortController()
  setAfterRun(sql => { if (sql.startsWith('DELETE FROM memory_fts')) controller.abort() })
  await assert.rejects(repository.clearMemories({
    expectedMemories: [reviewed], signal: controller.signal,
  }), { name: 'KnowledgeRepositoryCancelledError' })
  setAfterRun(undefined)
  assert.deepEqual(await repository.listMemories(), [reviewed])
  assert.equal(native.query('SELECT count(*) AS count FROM memory_fts').get().count, 1)
})

check('cancellation after document FTS deletion rolls back documents, chunks and search records', async ({ repository, native, setAfterRun }) => {
  const reviewed = document('cancelled')
  await repository.saveDocument(reviewed, [chunk(reviewed.id)])
  const controller = new AbortController()
  setAfterRun(sql => { if (sql.startsWith('DELETE FROM knowledge_fts')) controller.abort() })
  await assert.rejects(repository.clearDocuments({
    expectedDocuments: [reviewed], signal: controller.signal,
  }), { name: 'KnowledgeRepositoryCancelledError' })
  setAfterRun(undefined)
  assert.deepEqual(await repository.listDocuments(), [reviewed])
  assert.equal((await repository.listChunks()).length, 1)
  assert.equal(native.query('SELECT count(*) AS count FROM knowledge_fts').get().count, 1)
})

for (const action of ['activate', 'delete']) {
  check(`queued memory ${action} retains the original reviewed record despite caller mutation`, async ({ repository, native, database }) => {
    const reviewed = await repository.saveMemory(memory('reviewed'))
    const release = await holdTransactions(database)
    const options = { expectedMemory: reviewed, expectedActiveMemory: null }
    const pending = action === 'activate'
      ? repository.updateMemoryStatus(reviewed.id, 'active', options)
      : repository.deleteMemory(reviewed.id, options)
    native.query('UPDATE memories SET content = ? WHERE id = ?').run('Unreviewed replacement', reviewed.id)
    reviewed.content = 'Unreviewed replacement'
    await release()
    await assert.rejects(pending, conflict)
    const retained = (await repository.listMemories())[0]
    assert.equal(retained.content, 'Unreviewed replacement')
    assert.equal(retained.status, 'pending')
  })
}

check('queued activation retains the originally reviewed active fact and its provenance', async ({ repository, native, database }) => {
  const fact = { subject: 'User', key: 'color' }
  const active = await repository.saveMemory(memory('active', { ...fact, value: 'Blue', status: 'active', sourceMessageIds: ['shown-source'] }))
  const reviewed = await repository.saveMemory(memory('candidate', { ...fact, value: 'Amber' }))
  const release = await holdTransactions(database)
  const pending = repository.updateMemoryStatus(reviewed.id, 'active', { expectedMemory: reviewed, expectedActiveMemory: active })
  native.query('UPDATE memories SET sourceMessageIdsJson = ? WHERE id = ?').run(JSON.stringify(['unreviewed-source']), active.id)
  active.sourceMessageIds[0] = 'unreviewed-source'
  await release()
  await assert.rejects(pending, conflict)
  assert.equal((await repository.listMemories()).find(item => item.id === active.id).status, 'active')
})

check('queued memory clear cannot expand its displayed collection through caller mutation', async ({ repository, database }) => {
  const reviewed = await repository.saveMemory(memory('reviewed'))
  const unseen = await repository.saveMemory(memory('unseen'))
  const release = await holdTransactions(database)
  const expectedMemories = [reviewed]
  const pending = repository.clearMemories({ expectedMemories })
  expectedMemories.push(unseen)
  await release()
  await pending
  assert.deepEqual(await repository.listMemories(), [unseen])
})

check('queued document deletion retains the original reviewed title despite caller mutation', async ({ repository, native, database }) => {
  const reviewed = document('reviewed')
  await repository.saveDocument(reviewed, [chunk(reviewed.id)])
  const release = await holdTransactions(database)
  const pending = repository.deleteDocument(reviewed.id, { expectedDocument: reviewed })
  native.query('UPDATE knowledge_documents SET title = ? WHERE id = ?').run('Unreviewed title', reviewed.id)
  reviewed.title = 'Unreviewed title'
  await release()
  await assert.rejects(pending, conflict)
  assert.equal((await repository.listDocuments())[0].title, 'Unreviewed title')
  assert.equal((await repository.listChunks())[0].documentId, reviewed.id)
})

check('queued document clear cannot expand its displayed collection through caller mutation', async ({ repository, database }) => {
  const reviewed = document('reviewed')
  const unseen = document('unseen')
  await repository.saveDocument(reviewed, [chunk(reviewed.id)])
  await repository.saveDocument(unseen, [chunk(unseen.id)])
  const release = await holdTransactions(database)
  const expectedDocuments = [reviewed]
  const pending = repository.clearDocuments({ expectedDocuments })
  expectedDocuments.push(unseen)
  await release()
  await pending
  assert.deepEqual(await repository.listDocuments(), [unseen])
  assert.equal((await repository.listChunks())[0].documentId, unseen.id)
})

check('queued mutations retain the original cancellation signal if the caller replaces its options', async ({ repository, database }) => {
  const reviewed = await repository.saveMemory(memory('reviewed'))
  const controller = new AbortController()
  const release = await holdTransactions(database)
  const transaction = database.transaction.bind(database)
  let queued
  const admitted = new Promise(resolve => { queued = resolve })
  database.transaction = work => {
    const result = transaction(work)
    queued()
    return result
  }
  const options = { expectedMemories: [reviewed], signal: controller.signal }
  const pending = repository.clearMemories(options)
  await admitted
  controller.abort()
  options.signal = new AbortController().signal
  await release()
  await assert.rejects(pending, { name: 'KnowledgeRepositoryCancelledError' })
  assert.deepEqual(await repository.listMemories(), [reviewed])
})

async function run() {
  let failures = 0
  for (const { name, work } of cases) {
    const value = fixture()
    try {
      await work(value)
      console.log(`PASS ${name}`)
    } catch (error) {
      failures++
      console.error(`FAIL ${name}\n${error.stack}`)
    } finally {
      value.native.close()
    }
  }
  console.log(JSON.stringify({
    capturedAt: new Date().toISOString(), category: 'host in-memory SQLite regression',
    cases: cases.length, passed: cases.length - failures, failed: failures,
    actualSupplierAttempts: 0, deviceOperations: 0,
  }))
  if (failures) process.exitCode = 1
}

run().catch(error => { console.error(error); process.exitCode = 1 })
