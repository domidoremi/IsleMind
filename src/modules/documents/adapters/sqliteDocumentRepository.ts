import { applySqliteMigrations, type SqliteDatabaseProvider, type SqliteExecutor } from '@/platform/storage'
import {
  DocumentConflictError,
  SAVED_DOCUMENT_SCHEMA,
  SAVED_DOCUMENT_COUNT_LIMIT,
  parseDocumentDraft,
  parseSavedDocument,
  parseSavedDocuments,
  type DocumentRepository,
  type DocumentSummary,
  type SavedDocument,
} from '../document'

interface DocumentRow { id: string; revision: string; payloadJson: string }

export function createSqliteDocumentRepository({ databaseProvider, createId, now }: {
  databaseProvider: SqliteDatabaseProvider
  createId(): string
  now(): number
}): DocumentRepository {
  let initialization: Promise<void> | undefined
  async function database() {
    const db = await databaseProvider.get()
    initialization ??= applySqliteMigrations(db, [{
      scope: 'saved-documents', version: 1, name: 'user-owned-editable-documents',
      async up(transaction) {
        await transaction.exec(`
          CREATE TABLE saved_documents (
            id TEXT PRIMARY KEY NOT NULL,
            revision TEXT NOT NULL,
            title TEXT NOT NULL,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL,
            payloadJson TEXT NOT NULL
          );
          CREATE INDEX saved_documents_updated ON saved_documents(updatedAt DESC, id);
        `)
      },
    }]).catch((error) => { initialization = undefined; throw error })
    await initialization
    return db
  }

  return {
    async list(options = {}) {
      cancelled(options.signal)
      const db = await database()
      const rows = await db.getAll<DocumentSummary>('SELECT id, title, createdAt, updatedAt FROM saved_documents ORDER BY updatedAt DESC, id')
      cancelled(options.signal)
      return [...rows]
    },
    async get(id, options = {}) {
      cancelled(options.signal)
      const db = await database()
      const row = await db.getFirst<DocumentRow>('SELECT id, revision, payloadJson FROM saved_documents WHERE id = ?', [id])
      cancelled(options.signal)
      return row ? decode(row) : undefined
    },
    async create(draft) {
      // Validate and detach before the first await; callers cannot mutate a pending save.
      const value = parseDocumentDraft(draft)
      const time = now()
      const document = parseSavedDocument({ schema: SAVED_DOCUMENT_SCHEMA, id: createId(), revision: createId(), ...value, createdAt: time, updatedAt: time })
      const db = await database()
      await db.transaction(async (tx) => {
        const count = await tx.getFirst<{ count: number }>('SELECT COUNT(*) AS count FROM saved_documents')
        if ((count?.count ?? 0) >= SAVED_DOCUMENT_COUNT_LIMIT) throw new TypeError('The document library is full.')
        await insert(tx, document)
      })
      return document
    },
    async save(id, revision, edit) {
      const value = parseDocumentDraft({ title: edit.title, body: edit.body })
      const db = await database()
      return db.transaction(async (tx) => {
        const row = await tx.getFirst<DocumentRow>('SELECT id, revision, payloadJson FROM saved_documents WHERE id = ?', [id])
        if (!row || row.revision !== revision) throw new DocumentConflictError()
        const previous = decode(row)
        const document = parseSavedDocument({ ...previous, ...value, revision: createId(), updatedAt: Math.max(now(), previous.updatedAt + 1) })
        const result = await tx.run('UPDATE saved_documents SET revision = ?, title = ?, updatedAt = ?, payloadJson = ? WHERE id = ? AND revision = ?',
          [document.revision, document.title, document.updatedAt, JSON.stringify(document), id, revision])
        if (result.changes !== 1) throw new DocumentConflictError()
        return document
      })
    },
    async remove(id, revision) {
      const db = await database()
      const result = await db.run('DELETE FROM saved_documents WHERE id = ? AND revision = ?', [id, revision])
      if (result.changes !== 1) throw new DocumentConflictError()
    },
    async loadSnapshot(options = {}) {
      cancelled(options.signal)
      const db = await database()
      const documents = await readSnapshot(db)
      cancelled(options.signal)
      return documents
    },
    async replaceSnapshot(documents, expected, options = {}) {
      const replacement = parseSavedDocuments(documents)
      const allowed = expected.map((snapshot) => JSON.stringify(parseSavedDocuments(snapshot)))
      cancelled(options.signal)
      const db = await database()
      await db.transaction(async (tx) => {
        cancelled(options.signal)
        const current = JSON.stringify(await readSnapshot(tx))
        if (!allowed.includes(current)) throw new DocumentConflictError()
        if (current === JSON.stringify(replacement)) return
        await tx.run('DELETE FROM saved_documents')
        for (const document of replacement) {
          cancelled(options.signal)
          await insert(tx, document)
        }
        cancelled(options.signal)
      })
    },
    async clear() {
      const db = await database()
      await db.run('DELETE FROM saved_documents')
    },
  }
}

async function readSnapshot(db: SqliteExecutor): Promise<SavedDocument[]> {
  const rows = await db.getAll<DocumentRow>('SELECT id, revision, payloadJson FROM saved_documents ORDER BY id')
  return parseSavedDocuments(rows.map(decode))
}

function decode(row: DocumentRow): SavedDocument {
  const document = parseSavedDocument(JSON.parse(row.payloadJson))
  if (document.id !== row.id || document.revision !== row.revision) throw new TypeError('Inconsistent saved document record.')
  return document
}

async function insert(tx: SqliteExecutor, document: SavedDocument): Promise<void> {
  await tx.run('INSERT INTO saved_documents (id, revision, title, createdAt, updatedAt, payloadJson) VALUES (?, ?, ?, ?, ?, ?)',
    [document.id, document.revision, document.title, document.createdAt, document.updatedAt, JSON.stringify(document)])
}

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Document operation cancelled.')
    error.name = 'AbortError'
    throw error
  }
}
