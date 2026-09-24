import type { SqliteDatabaseProvider } from './contracts'

export interface SqliteMaintenanceSnapshot {
  supported?: boolean
  logFrames?: number
  checkpointedFrames?: number
  pageSize?: number
  error?: 'checkpoint_failed' | 'invalid_result'
  /** A failed observation must not accidentally reopen a previously blocked gate. */
  admissionBlocked: boolean
  pendingBytes: number
  pressure: 'normal' | 'warning' | 'blocked' | 'unknown'
  durationMs: number
  busy: boolean
}

/** One instance per database in bootstrap. No polling, lock retries or WAL deletion. */
export function createSqliteMaintenance(provider: SqliteDatabaseProvider, now = Date.now) {
  let lastStarted = -Infinity
  let pending: Promise<void> | undefined
  let snapshot: SqliteMaintenanceSnapshot = { pendingBytes: 0, pressure: 'unknown', durationMs: 0, busy: false, admissionBlocked: false }
  return {
    getSnapshot: (): Readonly<SqliteMaintenanceSnapshot> => ({ ...snapshot }),
    request(): Promise<void> {
      if (pending) return pending
      if (now() - lastStarted < 30_000) return Promise.resolve()
      lastStarted = now()
      const started = lastStarted
      pending = (async () => {
        try {
          const database = await provider.get()
          if (!database.passiveCheckpoint) {
            snapshot = { ...snapshot, supported: false, pressure: 'unknown' }
            return
          }
          const result = await database.passiveCheckpoint()
          if (result.logFrames === -1 && result.checkpointedFrames === -1) {
            snapshot = { ...snapshot, supported: false, pressure: 'unknown' }
            return
          }
          if (![result.logFrames, result.checkpointedFrames, result.pageSize, result.busy].every(Number.isSafeInteger)
            || result.logFrames < 0 || result.checkpointedFrames < 0 || result.checkpointedFrames > result.logFrames
            || result.pageSize <= 0 || (result.busy !== 0 && result.busy !== 1)) throw new Error('Invalid WAL result')
          const pendingBytes = Math.max(0, result.logFrames - result.checkpointedFrames) * result.pageSize
          if (!Number.isSafeInteger(pendingBytes)) throw new Error('Invalid WAL size')
          snapshot = {
            supported: true, logFrames: result.logFrames, checkpointedFrames: result.checkpointedFrames, pageSize: result.pageSize,
            admissionBlocked: pendingBytes >= 64 * 1024 * 1024,
            pendingBytes, busy: result.busy !== 0, durationMs: Math.max(0, now() - started),
            pressure: pendingBytes >= 64 * 1024 * 1024 ? 'blocked' : pendingBytes >= 16 * 1024 * 1024 ? 'warning' : 'normal',
          }
        } catch {
          snapshot = { ...snapshot, pressure: 'unknown', error: 'checkpoint_failed', durationMs: Math.max(0, now() - started) }
        }
      })().finally(() => { pending = undefined })
      return pending
    },
  }
}
