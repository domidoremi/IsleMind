import type { ApkInstallOptions, ApkReleaseInfo, ApkUpdateResult, PreparedApkUpdate } from '@/platform/native/androidApkUpdates'
import { createApkUpdateDeliveryCoordinator } from './apkUpdateDeliveryCoordinator'

const target: ApkReleaseInfo = {
  version: '1.2.0', versionCode: 12, tagName: 'v1.2.0', name: 'Release',
  htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.2.0',
  apkUrl: 'https://github.com/domidoremi/IsleMind/releases/download/v1.2.0/a.apk',
  apkName: 'a.apk', publishedAt: null, sha256: 'a'.repeat(64), sizeBytes: 100,
  releaseNotes: [{ version: '1.2.0', notes: 'Original' }],
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { resolve, reject, promise }
}
function fixture() {
  const prepared: PreparedApkUpdate = Object.freeze({ release: target, localUri: 'file:///cache/a.apk' })
  const prepare = jest.fn<Promise<ApkUpdateResult>, [ApkReleaseInfo, ApkInstallOptions]>()
    .mockResolvedValue({ status: 'prepared', message: 'Prepared', prepared })
  const open = jest.fn<Promise<ApkUpdateResult>, [PreparedApkUpdate, ApkInstallOptions]>()
    .mockResolvedValue({ status: 'downloaded', message: 'Handed off' })
  const wait = jest.fn<Promise<void>, [AbortSignal]>().mockResolvedValue(undefined)
  const discard = jest.fn<Promise<void>, [PreparedApkUpdate]>().mockResolvedValue(undefined)
  const snapshots = jest.fn()
  const onCancelled = jest.fn()
  const onFailure = jest.fn()
  const onResult = jest.fn()
  const coordinator = createApkUpdateDeliveryCoordinator({
    prepare, open, discard, waitForIdle: wait, canOpenInstaller: () => true,
    onSnapshot: snapshots, onCancelled, onFailure, onResult,
  })
  return { coordinator, prepared, prepare, open, wait, discard, snapshots, onCancelled, onFailure, onResult }
}
it('automatic preparation has no installation authority and reuses bytes only for the same approved target', async () => {
  const f = fixture()
  await f.coordinator.start(target, true)
  expect(f.coordinator.getSnapshot()).toMatchObject({ stage: 'prepared', approved: false })
  expect(f.open).not.toHaveBeenCalled()
  expect(await f.coordinator.start({ ...target, apkUrl: target.apkUrl + '?replacement' })).toBe(false)
  await f.coordinator.start(target)
  expect(f.prepare).toHaveBeenCalledTimes(1)
  expect(f.open).toHaveBeenCalledWith(f.prepared, expect.objectContaining({ canOpenInstaller: expect.any(Function) }))
  expect(f.coordinator.getSnapshot().stage).toBe('handed-off')
})
it('freezes approved metadata and waits for a safe handoff instead of replacing it with latest', async () => {
  const f = fixture()
  const waiting = deferred<void>()
  f.wait.mockReturnValueOnce(waiting.promise)
  const mutable = { ...target, releaseNotes: [{ version: target.version, notes: 'Original' }] }
  const running = f.coordinator.start(mutable)
  mutable.apkUrl = 'https://example.test/replaced.apk'
  mutable.releaseNotes[0].notes = 'Changed'
  await Promise.resolve(); await Promise.resolve()
  expect(f.prepare.mock.calls[0][0].apkUrl).toBe(target.apkUrl)
  expect(f.prepare.mock.calls[0][0].releaseNotes?.[0].notes).toBe('Original')
  expect(f.open).not.toHaveBeenCalled()
  waiting.resolve(); await running
  expect(f.open).toHaveBeenCalledTimes(1)
})
it('binds consent received during automatic preparation to that one active target', async () => {
  const f = fixture()
  const download = deferred<ApkUpdateResult>()
  f.prepare.mockReturnValueOnce(download.promise)
  const preparation = f.coordinator.start(target, true)
  const approved = f.coordinator.start(target)
  expect(await f.coordinator.start({ ...target, versionCode: 13 })).toBe(false)
  download.resolve({ status: 'prepared', message: '', prepared: f.prepared })
  await preparation; await approved
  expect(f.prepare).toHaveBeenCalledTimes(1)
  expect(f.open).toHaveBeenCalledTimes(1)
})
it('cancels during preparation without acknowledging installation or releasing the operation early', async () => {
  const f = fixture()
  const download = deferred<ApkUpdateResult>()
  f.prepare.mockReturnValueOnce(download.promise)
  const running = f.coordinator.start(target)
  f.coordinator.cancel()
  expect(await f.coordinator.start(target)).toBe(false)
  download.resolve({ status: 'prepared', message: '', prepared: f.prepared })
  await running
  expect(f.discard).toHaveBeenCalledWith(f.prepared)
  expect(f.open).not.toHaveBeenCalled()
  expect(f.onCancelled).toHaveBeenCalledTimes(1)
  expect(f.coordinator.getSnapshot()).toMatchObject({ stage: 'idle', approved: false })
})
it('revokes pending idle activation and cannot be undone by a late idle grant', async () => {
  const f = fixture()
  const waiting = deferred<void>()
  f.wait.mockReturnValueOnce(waiting.promise)
  const running = f.coordinator.start(target)
  await Promise.resolve(); await Promise.resolve()
  f.coordinator.cancel()
  waiting.resolve(); await running
  expect(f.open).not.toHaveBeenCalled()
  expect(f.discard).toHaveBeenCalledTimes(1)
})
it('does not cancel a user-approved target when the automatic-download policy is disabled', async () => {
  const f = fixture()
  const waiting = deferred<void>()
  f.wait.mockReturnValueOnce(waiting.promise)
  const running = f.coordinator.start(target)
  await Promise.resolve(); await Promise.resolve()
  f.coordinator.cancel(true)
  expect(f.prepare.mock.calls[0][1].signal?.aborted).toBe(false)
  waiting.resolve(); await running
  expect(f.open).toHaveBeenCalledTimes(1)
})
it('refuses a changed preparation identity and quarantines that file', async () => {
  const f = fixture()
  const wrong = { ...f.prepared, release: { ...target, sha256: 'b'.repeat(64) } }
  f.prepare.mockResolvedValueOnce({ status: 'prepared', message: '', prepared: wrong })
  await f.coordinator.start(target)
  expect(f.discard).toHaveBeenCalledWith(wrong)
  expect(f.open).not.toHaveBeenCalled()
  expect(f.onFailure).toHaveBeenCalledTimes(1)
})
it('clears unapproved prepared state immediately on cancel and ignores old cleanup completion', async () => {
  const f = fixture()
  await f.coordinator.start(target, true)
  const cleanup = deferred<void>()
  f.discard.mockReturnValueOnce(cleanup.promise)
  f.coordinator.cancel()
  expect(f.coordinator.getSnapshot().stage).toBe('idle')
  const next = { ...target, versionCode: 13 }
  f.prepare.mockResolvedValueOnce({ status: 'prepared', message: '', prepared: { ...f.prepared, release: next } })
  await f.coordinator.start(next, true)
  cleanup.resolve(); await Promise.resolve()
  expect(f.coordinator.getSnapshot()).toMatchObject({ stage: 'prepared', target: next })
})
it('does not let teardown or late verification authorize installer handoff', async () => {
  const f = fixture()
  const pending = deferred<ApkUpdateResult>()
  f.prepare.mockReturnValueOnce(pending.promise)
  const running = f.coordinator.start(target)
  f.coordinator.dispose()
  pending.resolve({ status: 'prepared', message: '', prepared: f.prepared })
  await running
  expect(f.open).not.toHaveBeenCalled()
  expect(f.discard).toHaveBeenCalledWith(f.prepared)
  expect(f.onResult).not.toHaveBeenCalled()
  expect(f.coordinator.getSnapshot()).toMatchObject({ stage: 'idle', approved: false })
  expect(f.coordinator.getSnapshot().target).toBeUndefined()
})

it('retains cancellation controls while prepared bytes are being reverified', async () => {
  const f = fixture()
  const verification = deferred<ApkUpdateResult>()
  f.open.mockImplementationOnce((_prepared, options) => {
    options.onProgress?.({ stage: 'verifying', release: target })
    return verification.promise
  })
  const running = f.coordinator.start(target)
  await Promise.resolve(); await Promise.resolve()
  expect(f.coordinator.getSnapshot()).toMatchObject({ stage: 'validating', approved: true })
  f.coordinator.cancel()
  expect(f.open.mock.calls[0][1].canOpenInstaller?.()).toBe(false)
  verification.resolve({ status: 'cancelled', message: '' })
  await running
  expect(f.coordinator.getSnapshot().stage).toBe('idle')
})

it('does not restore approval from a late busy result after cancellation', async () => {
  const f = fixture()
  const handoff = deferred<ApkUpdateResult>()
  f.open.mockReturnValueOnce(handoff.promise)
  const running = f.coordinator.start(target)
  await Promise.resolve(); await Promise.resolve()
  f.coordinator.cancel()
  handoff.resolve({ status: 'busy', message: 'Other native caller' })
  await running
  expect(f.coordinator.getSnapshot()).toMatchObject({ stage: 'idle', approved: false })
  expect(f.onCancelled).toHaveBeenCalledTimes(1)
  expect(f.onResult).not.toHaveBeenCalled()
})

it('does not overwrite cancellation when a progress observer cancels synchronously', async () => {
  const f = fixture()
  const coordinator = createApkUpdateDeliveryCoordinator({
    prepare: async (_target, options) => {
      options.onProgress?.({ stage: 'downloading', release: target })
      return { status: 'prepared', message: '', prepared: f.prepared }
    },
    open: f.open, discard: f.discard, waitForIdle: f.wait, canOpenInstaller: () => true,
    onSnapshot: f.snapshots, onProgress: () => coordinator.cancel(),
  })
  await coordinator.start(target)
  expect(f.snapshots.mock.calls.map(([snapshot]) => snapshot.stage)).toEqual(['preparing', 'cancelling', 'idle'])
  expect(f.open).not.toHaveBeenCalled()
  expect(f.discard).toHaveBeenCalledWith(f.prepared)
})
