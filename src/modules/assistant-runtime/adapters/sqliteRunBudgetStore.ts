import { applySqliteMigrations, type SqliteDatabaseProvider, type SqliteExecutor } from '@/platform/storage'
import { createRunBudget, decodeRunBudget, reserveRunAttempt, reserveRunTool, setRunBudgetActive, settleRunAttempt,
  type RunAttemptUsageUpdate, type RunBudgetAttempt, type RunBudgetLimits, type RunBudgetSnapshot } from '../application/runBudget'

export interface RunBudgetStore {
  create(rootRunId: string, limits?: RunBudgetLimits): Promise<void>
  attach(rootRunId: string, runId: string): Promise<void>
  get(rootRunId: string): Promise<RunBudgetSnapshot | undefined>
  reserve(rootRunId: string, attempt: Omit<RunBudgetAttempt, 'sequence' | 'settled' | 'complete'>, now: number): Promise<void>
  settle(update: RunAttemptUsageUpdate): Promise<void>
  reserveTool(rootRunId: string, operationId: string, now: number): Promise<void>
  setActive(rootRunId: string, active: boolean, now: number, runId?: string): Promise<void>
  recoverActiveTime(isActiveRoot: (rootRunId: string) => boolean): Promise<readonly string[]>
  clear(): Promise<void>
}

export function createSqliteRunBudgetStore(provider: SqliteDatabaseProvider): RunBudgetStore {
  let initialized: Promise<void> | undefined
  async function database() {
    const db = await provider.get()
    // Rejected migration remains rejected. Never interpret failed storage as empty history.
    initialized ??= applySqliteMigrations(db, [{ scope: 'harness-budget', version: 1, name: 'actual-attempt-ledger', async up(tx) {
      await tx.exec(`CREATE TABLE harness_run_budgets (rootRunId TEXT PRIMARY KEY NOT NULL, snapshotJson TEXT NOT NULL);
        CREATE TABLE harness_attempt_owners (attemptId TEXT PRIMARY KEY NOT NULL, rootRunId TEXT NOT NULL);`)
    } }, { scope: 'harness-budget', version: 2, name: 'root-budget-members', async up(tx) {
      await tx.exec('CREATE TABLE harness_budget_members (runId TEXT PRIMARY KEY NOT NULL, rootRunId TEXT NOT NULL);')
    } }])
    await initialized
    return db
  }
  async function read(tx: SqliteExecutor, rootRunId: string) {
    const member = await tx.getFirst<{ rootRunId: string }>('SELECT rootRunId FROM harness_budget_members WHERE runId = ?', [rootRunId])
    rootRunId = member?.rootRunId ?? rootRunId
    const row = await tx.getFirst<{ snapshotJson: string }>('SELECT snapshotJson FROM harness_run_budgets WHERE rootRunId = ?', [rootRunId])
    const snapshot = row ? decodeRunBudget(row.snapshotJson) : undefined
    if (snapshot && snapshot.rootRunId !== rootRunId) throw new Error('Budget owner mismatch')
    return snapshot
  }
  async function save(tx: SqliteExecutor, snapshot: RunBudgetSnapshot) {
    await tx.run('UPDATE harness_run_budgets SET snapshotJson = ? WHERE rootRunId = ?', [JSON.stringify(snapshot), snapshot.rootRunId])
  }
  async function mutate(rootRunId: string, update: (snapshot: RunBudgetSnapshot) => RunBudgetSnapshot) {
    await (await database()).transaction(async (tx) => {
      const snapshot = await read(tx, rootRunId)
      if (!snapshot) throw new Error('Missing root budget')
      await save(tx, update(snapshot))
    })
  }
  return {
    async create(rootRunId, limits) {
      const snapshot = createRunBudget(rootRunId, limits)
      await (await database()).run('INSERT INTO harness_run_budgets (rootRunId, snapshotJson) VALUES (?, ?)', [rootRunId, JSON.stringify(snapshot)])
    },
    async attach(rootRunId, runId) {
      await (await database()).transaction(async (tx) => {
        const budget = await read(tx, rootRunId)
        if (!budget || budget.rootRunId !== rootRunId || rootRunId === runId) throw new Error('Invalid child budget owner')
        if (await read(tx, runId)) throw new Error('Child already belongs to a budget')
        const members = await tx.getAll<{ runId: string }>('SELECT runId FROM harness_budget_members WHERE rootRunId = ?', [rootRunId])
        if (members.length >= 6) throw new Error('Root child budget limit exceeded')
        await tx.run('INSERT INTO harness_budget_members (runId, rootRunId) VALUES (?, ?)', [runId, rootRunId])
      })
    },
    async get(rootRunId) { return read(await database(), rootRunId) },
    async reserve(rootRunId, attempt, now) {
      await (await database()).transaction(async (tx) => {
        const snapshot = await read(tx, rootRunId)
        if (!snapshot) throw new Error('Missing root budget')
        rootRunId = snapshot.rootRunId
        const owner = await tx.getFirst<{ rootRunId: string }>('SELECT rootRunId FROM harness_attempt_owners WHERE attemptId = ?', [attempt.attemptId])
        if (owner && owner.rootRunId !== rootRunId) throw new Error('Attempt belongs to another root')
        const next = reserveRunAttempt(snapshot, attempt, now)
        if (!owner) await tx.run('INSERT INTO harness_attempt_owners (attemptId, rootRunId) VALUES (?, ?)', [attempt.attemptId, rootRunId])
        await save(tx, next)
      })
    },
    async settle(update) {
      await (await database()).transaction(async (tx) => {
        const owner = await tx.getFirst<{ rootRunId: string }>('SELECT rootRunId FROM harness_attempt_owners WHERE attemptId = ?', [update.attemptId])
        // Non-Harness provider operations have no owner and keep their existing statistics path.
        if (!owner) return
        const snapshot = await read(tx, owner.rootRunId)
        if (!snapshot) throw new Error('Missing attempt budget')
        await save(tx, settleRunAttempt(snapshot, update))
      })
    },
    reserveTool: (rootRunId, operationId, now) => mutate(rootRunId, (snapshot) => reserveRunTool(snapshot, operationId, now)),
    setActive: (rootRunId, active, now, runId = rootRunId) => mutate(rootRunId, (snapshot) => setRunBudgetActive(snapshot, active, now, runId)),
    async recoverActiveTime(isActiveRoot) {
      const db = await database()
      const recovered: string[] = []
      let after = ''
      // Read bounded pages and commit one root at a time. Include terminal/waiting
      // runs: their last status commit may have preceded a failed budget update.
      for (;;) {
        const rows = await db.getAll<{ rootRunId: string }>(
          `SELECT rootRunId FROM harness_run_budgets
           WHERE rootRunId > ? AND json_extract(snapshotJson, '$.activeSince') IS NOT NULL
           ORDER BY rootRunId LIMIT 32`, [after])
        if (!rows.length) break
        for (const { rootRunId } of rows) {
          after = rootRunId
          await db.transaction(async (tx) => {
            if (isActiveRoot(rootRunId)) return
            const snapshot = await read(tx, rootRunId)
            if (!snapshot || snapshot.activeSince === undefined) return
            const children = await tx.getAll<{ runId: string }>(
              'SELECT runId FROM harness_budget_members WHERE rootRunId = ? LIMIT 7', [rootRunId])
            if (children.length > 6) throw new Error('Root child budget limit exceeded')
            let lastActivity = snapshot.activeSince
            for (const runId of [rootRunId, ...children.map((child) => child.runId)]) {
              const entry = await tx.getFirst<{ occurredAt: number }>(
                'SELECT occurredAt FROM assistant_run_journal WHERE runId = ? ORDER BY sequence DESC LIMIT 1', [runId])
              if (entry) {
                if (!Number.isSafeInteger(entry.occurredAt) || entry.occurredAt < 0) throw new Error('Invalid activity timestamp')
                lastActivity = Math.max(lastActivity, entry.occurredAt)
              }
            }
            if (isActiveRoot(rootRunId)) return
            // Wall time after the last durable activity is not evidence of work.
            // Keep request/tool usage and reservations, including unknown effects.
            await save(tx, { ...snapshot, activeMs: snapshot.activeMs + lastActivity - snapshot.activeSince,
              activeSince: undefined, activeRunIds: [] })
            recovered.push(rootRunId)
          })
        }
      }
      return recovered
    },
    async clear() {
      await (await database()).transaction(async (tx) => {
        await tx.run('DELETE FROM harness_attempt_owners')
        await tx.run('DELETE FROM harness_budget_members')
        await tx.run('DELETE FROM harness_run_budgets')
      })
    },
  }
}
