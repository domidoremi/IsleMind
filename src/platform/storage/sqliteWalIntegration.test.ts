import { expect, test } from '@jest/globals'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteMaintenance } from './sqliteMaintenance'
import type { SqliteDatabase } from './contracts'

test('real WAL PASSIVE may complete partially with a reader and later drain without shrinking the file', async () => {
  const { Database } = require('bun:sqlite')
  const directory = mkdtempSync(join(tmpdir(), 'islemind-wal-test-'))
  const path = join(directory, 'isolated.db')
  const writer = new Database(path)
  const reader = new Database(path)
  try {
    writer.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE records (id INTEGER PRIMARY KEY, data TEXT);')
    expect(writer.query('PRAGMA journal_mode').get().journal_mode).toBe('wal')
    expect(writer.query('PRAGMA synchronous').get().synchronous).toBe(2)
    writer.query('INSERT INTO records(data) VALUES (?)').run('initial')
    reader.exec('BEGIN')
    expect(reader.query('SELECT COUNT(*) AS n FROM records').get().n).toBe(1)
    writer.transaction(() => {
      for (let i = 0; i < 100; i++) writer.query('INSERT INTO records(data) VALUES (?)').run('x'.repeat(8192))
    })()
    let now = 0
    const maintenance = createSqliteMaintenance({ get: async () => ({ passiveCheckpoint: async () => {
      const result = writer.query('PRAGMA wal_checkpoint(PASSIVE)').get()
      return { busy: result.busy, logFrames: result.log, checkpointedFrames: result.checkpointed,
        pageSize: writer.query('PRAGMA page_size').get().page_size }
    } } as SqliteDatabase) }, () => now)
    await maintenance.request()
    const partial = maintenance.getSnapshot()
    expect(partial.busy).toBe(false)
    expect(partial.logFrames!).toBeGreaterThan(partial.checkpointedFrames!)
    expect(partial.checkpointedFrames!).toBeGreaterThan(0)
    expect(partial.pendingBytes).toBe((partial.logFrames! - partial.checkpointedFrames!) * partial.pageSize!)
    const retainedFileBytes = statSync(`${path}-wal`).size
    reader.exec('COMMIT')
    now += 30_000
    await maintenance.request()
    expect(maintenance.getSnapshot().pendingBytes).toBe(0)
    expect(statSync(`${path}-wal`).size).toBe(retainedFileBytes)
  } finally {
    reader.close(); writer.close()
    // Only this test-created OS temporary directory is removed; no application DB.
    rmSync(directory, { recursive: true, force: true })
  }
})
