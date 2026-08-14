export const PROVIDER_COMPACT_STATE_DATABASE_NAME = 'islemind-context.db'

export interface CompactStateRecord {
  id: string
  conversationId: string
  providerId: string
  model: string
  responseId?: string
  sessionId?: string
  compactItemJson: string
  sourceMessageStartIndex: number
  sourceMessageEndIndex: number
  inputTokens?: number
  outputTokens?: number
  estimatedSavedTokens?: number
  activeContextTokens?: number
  autoCompactScopeTokens?: number
  prefillInputTokens?: number
  tokensUntilCompaction?: number
  previousResponseId?: string
  lastCompactSummary?: string
  compactFailureState?: string
  contextFragmentIdentitiesJson?: string
  status: 'active' | 'invalidated' | 'failed'
  failureCode?: string
  createdAt: number
  updatedAt: number
  expiresAt?: number
}

export type ProviderCompactStateSqlValue = string | number | null

export interface ProviderCompactStateDatabase {
  execAsync(source: string): Promise<unknown>
  runAsync(source: string, ...params: ProviderCompactStateSqlValue[]): Promise<unknown>
  getAllAsync<T>(source: string, ...params: ProviderCompactStateSqlValue[]): Promise<T[]>
}

export interface ProviderCompactStateRepositoryDependencies {
  openDatabase(databaseName: string): Promise<ProviderCompactStateDatabase>
  scheduleOperation?<Value>(databaseName: string, operation: () => Promise<Value>): Promise<Value>
  initializeSchema?: boolean
  now?(): number
}

export interface ProviderCompactStateRepository {
  saveCompactState(record: CompactStateRecord): Promise<void>
  listActiveCompactStates(conversationId: string, providerId: string, model: string): Promise<CompactStateRecord[]>
  invalidateCompactStates(conversationId: string, reason?: string): Promise<void>
  invalidateCompactStatesByProvider(providerId: string, reason?: string): Promise<void>
  invalidateAllCompactStates(reason?: string): Promise<void>
  clearAllCompactStates(): Promise<void>
}

export function createProviderCompactStateRepository(
  dependencies: ProviderCompactStateRepositoryDependencies,
): ProviderCompactStateRepository {
  const initializeSchema = dependencies.initializeSchema !== false
  const now = dependencies.now ?? Date.now
  const scheduleOperation = dependencies.scheduleOperation ?? ((_databaseName, operation) => operation())
  let dbPromise: Promise<ProviderCompactStateDatabase> | null = null

  async function getDb(): Promise<ProviderCompactStateDatabase> {
    if (!dbPromise) {
      dbPromise = dependencies.openDatabase(PROVIDER_COMPACT_STATE_DATABASE_NAME).then(async (db) => {
        if (initializeSchema) await scheduleOperation(PROVIDER_COMPACT_STATE_DATABASE_NAME, async () => {
          await db.execAsync(`
            CREATE TABLE IF NOT EXISTS compact_states (
              id TEXT PRIMARY KEY NOT NULL,
              conversationId TEXT NOT NULL,
              providerId TEXT NOT NULL,
              model TEXT NOT NULL,
              responseId TEXT,
              sessionId TEXT,
              compactItemJson TEXT NOT NULL,
              sourceMessageStartIndex INTEGER NOT NULL,
              sourceMessageEndIndex INTEGER NOT NULL,
              inputTokens INTEGER,
              outputTokens INTEGER,
              estimatedSavedTokens INTEGER,
              activeContextTokens INTEGER,
              autoCompactScopeTokens INTEGER,
              prefillInputTokens INTEGER,
              tokensUntilCompaction INTEGER,
              previousResponseId TEXT,
              lastCompactSummary TEXT,
              compactFailureState TEXT,
              contextFragmentIdentitiesJson TEXT,
              status TEXT NOT NULL,
              failureCode TEXT,
              createdAt INTEGER NOT NULL,
              updatedAt INTEGER NOT NULL,
              expiresAt INTEGER
            );
          `)
          await ensureCompactStateColumns(db)
        })
        return db
      }).catch((error) => {
        dbPromise = null
        throw error
      })
    }
    return dbPromise
  }

  async function saveCompactState(record: CompactStateRecord): Promise<void> {
    const db = await getDb()
    await scheduleOperation(PROVIDER_COMPACT_STATE_DATABASE_NAME, () => db.runAsync(
      `INSERT OR REPLACE INTO compact_states (
        id, conversationId, providerId, model, responseId, sessionId, compactItemJson,
        sourceMessageStartIndex, sourceMessageEndIndex, inputTokens, outputTokens,
        estimatedSavedTokens, activeContextTokens, autoCompactScopeTokens, prefillInputTokens,
        tokensUntilCompaction, previousResponseId, lastCompactSummary, compactFailureState, contextFragmentIdentitiesJson,
        status, failureCode, createdAt, updatedAt, expiresAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.conversationId,
      record.providerId,
      record.model,
      record.responseId ?? null,
      record.sessionId ?? null,
      record.compactItemJson,
      record.sourceMessageStartIndex,
      record.sourceMessageEndIndex,
      record.inputTokens ?? null,
      record.outputTokens ?? null,
      record.estimatedSavedTokens ?? null,
      record.activeContextTokens ?? null,
      record.autoCompactScopeTokens ?? null,
      record.prefillInputTokens ?? null,
      record.tokensUntilCompaction ?? null,
      record.previousResponseId ?? null,
      record.lastCompactSummary ?? null,
      record.compactFailureState ?? null,
      record.contextFragmentIdentitiesJson ?? null,
      record.status,
      record.failureCode ?? null,
      record.createdAt,
      record.updatedAt,
      record.expiresAt ?? null,
    ))
  }

  async function listActiveCompactStates(
    conversationId: string,
    providerId: string,
    model: string,
  ): Promise<CompactStateRecord[]> {
    const db = await getDb()
    return scheduleOperation(PROVIDER_COMPACT_STATE_DATABASE_NAME, () => db.getAllAsync<CompactStateRecord>(
      `SELECT * FROM compact_states
       WHERE conversationId = ? AND providerId = ? AND model = ? AND status = 'active' AND (expiresAt IS NULL OR expiresAt > ?)
       ORDER BY updatedAt DESC`,
      conversationId,
      providerId,
      model,
      now(),
    ))
  }

  async function invalidateCompactStates(conversationId: string, reason = 'invalidated'): Promise<void> {
    const db = await getDb()
    await scheduleOperation(PROVIDER_COMPACT_STATE_DATABASE_NAME, () => db.runAsync(
      `UPDATE compact_states SET status = 'invalidated', failureCode = ?, updatedAt = ? WHERE conversationId = ? AND status = 'active'`,
      reason,
      now(),
      conversationId,
    ))
  }

  async function invalidateCompactStatesByProvider(providerId: string, reason = 'provider_changed'): Promise<void> {
    const db = await getDb()
    await scheduleOperation(PROVIDER_COMPACT_STATE_DATABASE_NAME, () => db.runAsync(
      `UPDATE compact_states SET status = 'invalidated', failureCode = ?, updatedAt = ? WHERE providerId = ? AND status = 'active'`,
      reason,
      now(),
      providerId,
    ))
  }

  async function invalidateAllCompactStates(reason = 'all_invalidated'): Promise<void> {
    const db = await getDb()
    await scheduleOperation(PROVIDER_COMPACT_STATE_DATABASE_NAME, () => db.runAsync(
      `UPDATE compact_states SET status = 'invalidated', failureCode = ?, updatedAt = ? WHERE status = 'active'`,
      reason,
      now(),
    ))
  }

  async function clearAllCompactStates(): Promise<void> {
    const db = await getDb()
    await scheduleOperation(PROVIDER_COMPACT_STATE_DATABASE_NAME, () => db.runAsync('DELETE FROM compact_states'))
  }

  return {
    saveCompactState,
    listActiveCompactStates,
    invalidateCompactStates,
    invalidateCompactStatesByProvider,
    invalidateAllCompactStates,
    clearAllCompactStates,
  }
}

async function ensureCompactStateColumns(db: ProviderCompactStateDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(compact_states)')
  const names = new Set(columns.map((column) => column.name))
  const statements: string[] = []
  if (!names.has('activeContextTokens')) statements.push('ALTER TABLE compact_states ADD COLUMN activeContextTokens INTEGER;')
  if (!names.has('autoCompactScopeTokens')) statements.push('ALTER TABLE compact_states ADD COLUMN autoCompactScopeTokens INTEGER;')
  if (!names.has('prefillInputTokens')) statements.push('ALTER TABLE compact_states ADD COLUMN prefillInputTokens INTEGER;')
  if (!names.has('tokensUntilCompaction')) statements.push('ALTER TABLE compact_states ADD COLUMN tokensUntilCompaction INTEGER;')
  if (!names.has('previousResponseId')) statements.push('ALTER TABLE compact_states ADD COLUMN previousResponseId TEXT;')
  if (!names.has('lastCompactSummary')) statements.push('ALTER TABLE compact_states ADD COLUMN lastCompactSummary TEXT;')
  if (!names.has('compactFailureState')) statements.push('ALTER TABLE compact_states ADD COLUMN compactFailureState TEXT;')
  if (!names.has('contextFragmentIdentitiesJson')) statements.push('ALTER TABLE compact_states ADD COLUMN contextFragmentIdentitiesJson TEXT;')
  if (statements.length) await db.execAsync(statements.join('\n'))
}
