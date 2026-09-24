import { applySqliteMigrations, type SqliteDatabaseProvider } from '@/platform/storage'
import { decodeAgentDefinition, parseAgentDefinition, parseAgentDefinitions, type AgentDefinition } from '../agentDefinition'
import { AgentDefinitionConflictError, type AgentDefinitionRepository, type AgentDefinitionSnapshotRepository } from '../agentDefinitionRepository'

const SCOPE = 'assistant-agent-definitions'
interface DefinitionRow { id: string; revision: number; definitionJson: string }

export function createSqliteAgentDefinitionRepository(provider: SqliteDatabaseProvider): AgentDefinitionRepository & AgentDefinitionSnapshotRepository {
  let initialized: Promise<void> | undefined
  async function database() {
    const db = await provider.get()
    initialized ??= (async () => {
      const marker = await db.getFirst<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_schema_migrations'")
      if (marker) {
        const latest = await db.getFirst<{ version: number | null }>('SELECT MAX(version) AS version FROM platform_schema_migrations WHERE scope = ?', [SCOPE])
        if ((latest?.version ?? 0) > 1) throw new Error('Unsupported agent repository schema')
      }
      await applySqliteMigrations(db, [{ scope: SCOPE, version: 1, name: 'versioned-agent-definitions', async up(tx) {
        await tx.exec(`CREATE TABLE assistant_agent_definitions (
          id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), definitionJson TEXT NOT NULL
        );`)
      } }])
    })().catch((error) => { initialized = undefined; throw error })
    await initialized
    return db
  }
  function decode(row: DefinitionRow): AgentDefinition {
    const definition = decodeAgentDefinition(row.definitionJson)
    if (definition.id !== row.id || definition.revision !== row.revision) throw new Error('Agent definition identity mismatch')
    return definition
  }
  return {
    async loadSnapshot() {
      return parseAgentDefinitions((await (await database()).getAll<DefinitionRow>(
        'SELECT id, revision, definitionJson FROM assistant_agent_definitions ORDER BY id LIMIT 257',
      )).map(decode))
    },
    async replaceSnapshot(input, expected, signal) {
      const replacement = parseAgentDefinitions(input)
      const allowed = expected.map((snapshot) => JSON.stringify(parseAgentDefinitions(snapshot)))
      const serialized = JSON.stringify(replacement)
      await (await database()).transaction(async (tx) => {
        if (signal?.aborted) throw signal.reason ?? new Error('Import cancelled')
        const current = JSON.stringify(parseAgentDefinitions((await tx.getAll<DefinitionRow>(
          'SELECT id, revision, definitionJson FROM assistant_agent_definitions ORDER BY id LIMIT 257',
        )).map(decode)))
        if (!allowed.includes(current)) throw new AgentDefinitionConflictError()
        if (current === serialized) return
        await tx.run('DELETE FROM assistant_agent_definitions')
        for (const definition of replacement) {
          if (signal?.aborted) throw signal.reason ?? new Error('Import cancelled')
          await tx.run('INSERT INTO assistant_agent_definitions (id, revision, definitionJson) VALUES (?, ?, ?)',
            [definition.id, definition.revision, JSON.stringify(definition)])
        }
        if (signal?.aborted) throw signal.reason ?? new Error('Import cancelled')
      })
    },
    async list({ afterId = '', limit = 20 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50 || afterId.length > 128) throw new TypeError('Invalid agent definition page')
      return (await (await database()).getAll<DefinitionRow>(
        'SELECT id, revision, definitionJson FROM assistant_agent_definitions WHERE id > ? ORDER BY id LIMIT ?', [afterId, limit],
      )).map(decode)
    },
    async get(id) {
      const row = await (await database()).getFirst<DefinitionRow>('SELECT id, revision, definitionJson FROM assistant_agent_definitions WHERE id = ?', [id])
      return row ? decode(row) : undefined
    },
    async save(input, expectedRevision) {
      const definition = parseAgentDefinition(input)
      if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) throw new TypeError('Invalid expected revision')
      return (await database()).transaction(async (tx) => {
        const row = await tx.getFirst<DefinitionRow>('SELECT id, revision, definitionJson FROM assistant_agent_definitions WHERE id = ?', [definition.id])
        if (row) decode(row) // Corruption is never overwritten as if it were an empty record.
        if (expectedRevision === undefined ? !!row : !row || row.revision !== expectedRevision) throw new AgentDefinitionConflictError()
        if (expectedRevision !== undefined && definition.revision !== expectedRevision) throw new AgentDefinitionConflictError()
        const saved = parseAgentDefinition({ ...definition, revision: expectedRevision === undefined ? 1 : expectedRevision + 1 })
        await tx.run(`INSERT INTO assistant_agent_definitions (id, revision, definitionJson) VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, definitionJson = excluded.definitionJson`,
        [saved.id, saved.revision, JSON.stringify(saved)])
        return saved
      })
    },
    async remove(id, expectedRevision) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new TypeError('Invalid expected revision')
      const result = await (await database()).run('DELETE FROM assistant_agent_definitions WHERE id = ? AND revision = ?', [id, expectedRevision])
      if (result.changes !== 1) throw new AgentDefinitionConflictError()
    },
    async clear() { await (await database()).run('DELETE FROM assistant_agent_definitions') },
  }
}
