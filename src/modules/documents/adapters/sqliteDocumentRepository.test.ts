import { describe, expect, it } from '@jest/globals'
import type { SqliteDatabase, SqliteDatabaseProvider, SqliteExecutor, SqliteValue } from '@/platform/storage'
import { DOCUMENT_BODY_LIMIT, DOCUMENT_REVIEW_TEXT_LIMIT, SAVED_DOCUMENT_SCHEMA, DocumentConflictError, documentDraftFromMessage, parseDocumentReviewContext, parseSavedDocument, parseSavedDocuments, type DocumentReviewContext } from '../document'
import { createSqliteDocumentRepository } from './sqliteDocumentRepository'

function fixture() {
  const { Database } = require('bun:sqlite')
  const native = new Database(':memory:')
  let sequence = 0
  let queue: Promise<unknown> = Promise.resolve()
  let afterRun: ((sql: string) => void) | undefined
  const tx: SqliteExecutor = {
    async exec(sql) { native.exec(sql) },
    async run(sql, parameters = []) {
      const result = native.query(sql).run(...parameters)
      afterRun?.(sql)
      return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }
    },
    async getFirst<Row extends object>(sql: string, parameters: readonly SqliteValue[] = []) { return native.query(sql).get(...parameters) as Row | null },
    async getAll<Row extends object>(sql: string, parameters: readonly SqliteValue[] = []) { return native.query(sql).all(...parameters) as Row[] },
  }
  const enqueue = <T,>(work: () => Promise<T>): Promise<T> => {
    const next = queue.catch(() => undefined).then(work)
    queue = next
    return next
  }
  const db: SqliteDatabase = {
    exec: (sql) => enqueue(() => tx.exec(sql)),
    run: (sql, values) => enqueue(() => tx.run(sql, values)),
    getFirst: (sql, values) => enqueue(() => tx.getFirst(sql, values)),
    getAll: (sql, values) => enqueue(() => tx.getAll(sql, values)),
    transaction: (work) => enqueue(async () => {
      native.exec('BEGIN IMMEDIATE')
      try { const value = await work(tx); native.exec('COMMIT'); return value }
      catch (error) { native.exec('ROLLBACK'); throw error }
    }),
  }
  const provider: SqliteDatabaseProvider = { get: async () => db }
  const repository = () => createSqliteDocumentRepository({ databaseProvider: provider, createId: () => `document-${++sequence}`, now: () => 10 })
  return { repository, db, setAfterRun: (callback?: typeof afterRun) => { afterRun = callback }, close: () => native.close() }
}

const source = {
  id: 'answer', role: 'assistant' as const, status: 'cancelled' as const, timestamp: 9,
  content: 'old body', responseText: '## Draft\n\nRetain this exact answer.  \n', model: 'captured-model',
  citations: [{ id: 'source-1', type: 'knowledge' as const, title: 'Source', excerpt: 'Captured quote', documentId: 'knowledge-1', sourceUri: 'unretained-private-location' }],
}

const review: DocumentReviewContext = {
  acceptedAt: 10, title: 'Reviewed proposal', body: 'Proposal [S1], then [S2].\n',
  sources: [
    { citationId: 'source-2', type: 'knowledge', documentId: 'knowledge-2', title: 'Second selected first', updatedAt: 8, text: 'Exact source text.  \n' },
    { citationId: 'memory-1', type: 'memory', title: 'Preference', updatedAt: 9, text: '繁體中文 · 日本語' },
  ],
}

describe('saved document ownership and persistence (host SQLite)', () => {
  it('captures terminal text/status and reference order, never execution traces or source-body locations', () => {
    const draft = documentDraftFromMessage({ id: 'chat', title: 'Draft report' }, source)
    expect(draft.body).toBe(source.responseText)
    expect(draft.origin?.originalText).toBe(source.responseText)
    expect(draft.origin?.messageStatus).toBe('cancelled')
    expect(draft.origin?.citations[0]).not.toHaveProperty('sourceUri')
    for (const status of ['sending', 'streaming'] as const) {
      expect(() => documentDraftFromMessage({ id: 'chat', title: 'Draft' }, { ...source, status })).toThrow()
    }
    expect(() => documentDraftFromMessage({ id: 'chat', title: 'Draft' }, { ...source, role: 'user' })).toThrow()
    expect(() => documentDraftFromMessage({ id: 'chat', title: 'Draft' }, { ...source, responseText: 'x'.repeat(DOCUMENT_BODY_LIMIT + 1) })).toThrow()
  })

  it('acknowledges detached content after commit and reconstructs edits with unchanged provenance in another adapter', async () => {
    const f = fixture()
    try {
      const draft = documentDraftFromMessage({ id: 'chat', title: 'Draft report' }, source)
      const repo = f.repository()
      const pending = repo.create(draft)
      draft.body = 'late caller mutation'
      draft.origin!.citations[0].title = 'late source mutation'
      const saved = await pending
      const revised = await repo.save(saved.id, saved.revision, { title: 'Edited report', body: 'Human repair\n' })
      expect(revised.origin).toEqual(saved.origin)
      expect(revised.origin?.citations[0].title).toBe('Source')
      expect(revised.origin?.originalText).toBe(source.responseText)
      expect(revised.origin?.messageStatus).toBe('cancelled')
      expect(revised.updatedAt).toBeGreaterThan(saved.updatedAt)
      const reopened = f.repository()
      expect(await reopened.get(saved.id)).toEqual(revised)
      expect(await reopened.list()).toHaveLength(1)
      expect(await f.db.getAll('SELECT * FROM platform_schema_migrations WHERE scope = ?', ['saved-documents'])).toHaveLength(1)
      expect(await f.db.getFirst('PRAGMA integrity_check')).toEqual({ integrity_check: 'ok' })
    } finally { f.close() }
  })

  it('allows one concurrent edit winner and prevents stale deletion or recreation after deletion', async () => {
    const f = fixture()
    try {
      const a = f.repository(); const b = f.repository()
      const saved = await a.create({ title: 'Original', body: 'body' })
      const results = await Promise.allSettled([
        a.save(saved.id, saved.revision, { title: 'A', body: 'winner A' }),
        b.save(saved.id, saved.revision, { title: 'B', body: 'winner B' }),
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: expect.any(DocumentConflictError) })
      await expect(a.remove(saved.id, saved.revision)).rejects.toBeInstanceOf(DocumentConflictError)
      const winner = (await a.get(saved.id))!
      await a.remove(winner.id, winner.revision)
      await expect(b.save(winner.id, winner.revision, { title: 'Stale', body: 'not recreated' })).rejects.toBeInstanceOf(DocumentConflictError)
      expect(await a.get(saved.id)).toBeUndefined()
    } finally { f.close() }
  })

  it('atomically retains detached review text in v2, preserving order, origin and older context across ordinary edits', async () => {
    const f = fixture()
    try {
      const repo = f.repository()
      const saved = await repo.create(documentDraftFromMessage({ id: 'chat', title: 'Report' }, source))
      const selected = parseDocumentReviewContext(review)
      const pending = repo.save(saved.id, saved.revision, { title: review.title, body: review.body, reviewContext: selected })
      selected.sources[0].text = 'late mutation'
      const accepted = await pending
      expect(accepted.schema).toBe('islemind.saved-document.v2')
      expect(accepted.reviewContext).toEqual(review)
      expect(accepted.origin).toEqual(saved.origin)
      expect(await f.repository().get(saved.id)).toEqual(accepted)
      const humanEdit = await repo.save(accepted.id, accepted.revision, { title: 'Later edit', body: 'Human text' })
      expect(humanEdit.reviewContext).toEqual(review)
      // A copy keeps the independently retained review, without fetching sources.
      const copy = await repo.create(humanEdit)
      expect(copy.id).not.toBe(humanEdit.id)
      expect(copy.reviewContext).toEqual(review)
      const removed = await repo.save(humanEdit.id, humanEdit.revision, { title: humanEdit.title, body: humanEdit.body, reviewContext: null })
      expect(removed.reviewContext).toBeUndefined()
      expect(removed.origin).toEqual(saved.origin)
      expect((await repo.get(copy.id))!.reviewContext).toEqual(review)
    } finally { f.close() }
  })

  it('does not acknowledge partial body/context writes and fences stale removal and rollback', async () => {
    const f = fixture()
    try {
      const repo = f.repository()
      const saved = await repo.create({ title: 'Previous', body: 'Previous body', reviewContext: review })
      const snapshot = await repo.loadSnapshot()
      f.setAfterRun((sql) => { if (sql.startsWith('UPDATE saved_documents')) throw new Error('post-write failure') })
      await expect(repo.save(saved.id, saved.revision, { title: 'New', body: 'New body', reviewContext: null })).rejects.toThrow('post-write failure')
      f.setAfterRun()
      expect(await repo.loadSnapshot()).toEqual(snapshot)
      const newReview = { ...review, body: 'New proposal', acceptedAt: 11 }
      const newer = await repo.save(saved.id, saved.revision, { title: review.title, body: newReview.body, reviewContext: newReview })
      await expect(repo.save(saved.id, saved.revision, { title: 'Stale', body: 'Stale', reviewContext: null })).rejects.toBeInstanceOf(DocumentConflictError)
      await expect(repo.replaceSnapshot(snapshot, [snapshot])).rejects.toBeInstanceOf(DocumentConflictError)
      expect(await repo.get(saved.id)).toEqual(newer)
      const replacement = [{ ...newer, revision: 'imported' }]
      await repo.replaceSnapshot(replacement, [[newer], replacement])
      await repo.replaceSnapshot(replacement, [[newer], replacement])
      await repo.replaceSnapshot([newer], [[newer], replacement])
      expect(await repo.loadSnapshot()).toEqual([newer])
    } finally { f.close() }
  })

  it('reads legacy v1 rows losslessly and writes only v2 without a parallel table or premature rewrite', async () => {
    const f = fixture()
    try {
      const repo = f.repository()
      const saved = await repo.create(documentDraftFromMessage({ id: 'chat', title: 'Report' }, source))
      const legacy = { ...saved, schema: 'islemind.saved-document.v1' }
      const json = JSON.stringify(legacy)
      await f.db.run('UPDATE saved_documents SET payloadJson = ? WHERE id = ?', [json, saved.id])
      expect(await f.repository().get(saved.id)).toEqual(saved)
      expect(await f.db.getFirst('SELECT payloadJson FROM saved_documents WHERE id = ?', [saved.id])).toEqual({ payloadJson: json })
      expect(parseSavedDocument(legacy)).toEqual(saved)
      expect(() => parseSavedDocument({ ...legacy, reviewContext: review })).toThrow('Unsupported')
      const updated = await repo.save(saved.id, saved.revision, { title: review.title, body: review.body, reviewContext: review })
      expect(updated.schema).toBe(SAVED_DOCUMENT_SCHEMA)
      expect(updated.origin).toEqual(saved.origin)
      expect((await f.repository().get(saved.id))!.reviewContext).toEqual(review)
    } finally { f.close() }
  })

  it('strictly validates review sizes, source identity and primitive metadata instead of dropping malformed context', async () => {
    const first = review.sources[0]
    const invalid = [
      { ...review, acceptedAt: '10' }, { ...review, acceptedAt: -1 },
      { ...review, sources: [] }, { ...review, sources: Array(13).fill(first) },
      { ...review, sources: [first, first] },
      { ...review, sources: [first, { ...first, citationId: 'another-reference' }] },
      { ...review, sources: [{ ...first, type: ['knowledge'] }] },
      { ...review, sources: [{ ...first, documentId: undefined }] },
      { ...review, sources: [{ ...first, updatedAt: NaN }] },
      { ...review, sources: [{ ...first, type: 'memory' }] },
      { ...review, sources: [{ ...first, text: 'x'.repeat(DOCUMENT_REVIEW_TEXT_LIMIT) }] },
      { ...review, body: 'x'.repeat(DOCUMENT_REVIEW_TEXT_LIMIT + 1) },
    ]
    for (const value of invalid) expect(() => parseDocumentReviewContext(value)).toThrow()
    const valid = parseDocumentReviewContext({ ...review, effectAuthority: 'untrusted', sources: [{ ...first, secretLocation: 'untrusted' }] })
    expect(valid).not.toHaveProperty('effectAuthority')
    expect(valid.sources[0]).not.toHaveProperty('secretLocation')
    expect(parseDocumentReviewContext(review)).toEqual(review)
  })

  it('makes snapshot recovery idempotent and fences a newer editor from stale import/rollback', async () => {
    const f = fixture()
    try {
      const repo = f.repository()
      const saved = await repo.create({ title: 'Source', body: 'body' })
      const sourceSnapshot = await repo.loadSnapshot()
      const target = [{ ...saved, revision: 'import-revision', body: 'imported' }]
      await repo.replaceSnapshot(target, [sourceSnapshot, target])
      await repo.replaceSnapshot(target, [sourceSnapshot, target])
      expect(await repo.loadSnapshot()).toEqual(target)
      await expect(repo.save(saved.id, saved.revision, { title: 'Stale', body: 'old editor' })).rejects.toBeInstanceOf(DocumentConflictError)
      await repo.replaceSnapshot(sourceSnapshot, [sourceSnapshot, target])
      expect(await repo.loadSnapshot()).toEqual(sourceSnapshot)
      const newer = await repo.save(saved.id, saved.revision, { title: 'Newer', body: 'authoritative edit' })
      await expect(repo.replaceSnapshot(target, [sourceSnapshot, target])).rejects.toBeInstanceOf(DocumentConflictError)
      expect(await repo.get(saved.id)).toEqual(newer)
    } finally { f.close() }
  })

  it('rolls back cancellation inside snapshot replacement without acknowledging a partial library', async () => {
    const f = fixture()
    try {
      const repo = f.repository()
      const saved = await repo.create({ title: 'Retain me', body: 'body' })
      const snapshot = await repo.loadSnapshot()
      const controller = new AbortController()
      f.setAfterRun((sql) => { if (sql === 'DELETE FROM saved_documents') controller.abort() })
      await expect(repo.replaceSnapshot([{ ...saved, revision: 'replacement' }], [snapshot], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
      f.setAfterRun()
      expect(await repo.loadSnapshot()).toEqual(snapshot)
    } finally { f.close() }
  })

  it('rejects malformed/duplicate snapshots and fails a corrupt read instead of silently losing a document', async () => {
    const f = fixture()
    try {
      const repo = f.repository()
      const saved = await repo.create({ title: 'Retain me', body: 'body' })
      expect(() => parseSavedDocuments([saved, saved])).toThrow('Duplicate')
      const captured = { ...saved, ...documentDraftFromMessage({ id: 'chat', title: 'Draft' }, source) }
      expect(() => parseSavedDocuments([{ ...captured, origin: { ...captured.origin, messageStatus: ['cancelled'] } }])).toThrow('origin status')
      expect(() => parseSavedDocuments([{ ...captured, origin: { ...captured.origin, citations: [{ ...captured.origin!.citations[0], type: ['knowledge'] }] } }])).toThrow('citation kind')
      await expect(repo.replaceSnapshot([{ ...saved, schema: 'invalid' } as never], [[saved]])).rejects.toThrow()
      await f.db.run('UPDATE saved_documents SET payloadJson = ? WHERE id = ?', ['{}', saved.id])
      await expect(repo.get(saved.id)).rejects.toThrow()
      await expect(repo.loadSnapshot()).rejects.toThrow()
      expect(await repo.list()).toHaveLength(1)
    } finally { f.close() }
  })
})
