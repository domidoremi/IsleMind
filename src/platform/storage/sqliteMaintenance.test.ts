import { createSqliteMaintenance } from './sqliteMaintenance'
import type { SqliteDatabase } from './contracts'

test('coalesces requests, tracks unfinished frames rather than file size, and throttles maintenance', async () => {
  let now = 0
  const passiveCheckpoint = jest.fn(async () => ({ busy: 0, logFrames: 20000, checkpointedFrames: 100, pageSize: 4096 }))
  const maintenance = createSqliteMaintenance({ get: async () => ({ passiveCheckpoint } as unknown as SqliteDatabase) }, () => now)
  const first = maintenance.request()
  expect(maintenance.request()).toBe(first)
  await first
  expect(maintenance.getSnapshot().pressure).toBe('blocked')
  await maintenance.request()
  expect(passiveCheckpoint).toHaveBeenCalledTimes(1)
  now = 30_000
  passiveCheckpoint.mockResolvedValue({ busy: 0, logFrames: 20000, checkpointedFrames: 20000, pageSize: 4096 })
  await maintenance.request()
  expect(maintenance.getSnapshot().pendingBytes).toBe(0)
})

test('does not retry failures or silently report a healthy database', async () => {
  const passiveCheckpoint = jest.fn(async () => { throw new Error('busy') })
  const maintenance = createSqliteMaintenance({ get: async () => ({ passiveCheckpoint } as unknown as SqliteDatabase) })
  await maintenance.request()
  expect(maintenance.getSnapshot().pressure).toBe('unknown')
  expect(passiveCheckpoint).toHaveBeenCalledTimes(1)
})

test('a failed maintenance attempt cannot clear a known backlog barrier', async () => {
  let now = 0
  const passiveCheckpoint = jest.fn(async () => ({ busy: 0, logFrames: 20000, checkpointedFrames: 0, pageSize: 4096 }))
  const maintenance = createSqliteMaintenance({ get: async () => ({ passiveCheckpoint } as unknown as SqliteDatabase) }, () => now)
  await maintenance.request()
  now += 30_000
  passiveCheckpoint.mockRejectedValueOnce(new Error('I/O'))
  await maintenance.request()
  expect(maintenance.getSnapshot()).toMatchObject({ admissionBlocked: true, pressure: 'unknown', error: 'checkpoint_failed' })
})

test('does not treat a non-WAL backend as a healthy native checkpoint', async () => {
  const maintenance = createSqliteMaintenance({ get: async () => ({ passiveCheckpoint: async () => ({ busy: 0, logFrames: -1, checkpointedFrames: -1, pageSize: 0 }) } as unknown as SqliteDatabase) })
  await maintenance.request()
  expect(maintenance.getSnapshot()).toMatchObject({ supported: false, pressure: 'unknown' })
})
