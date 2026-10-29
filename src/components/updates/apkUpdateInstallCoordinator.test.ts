import type { ApkInstallOptions, ApkReleaseInfo, ApkUpdateResult } from '@/platform/native/androidApkUpdates'
import { createApkUpdateInstallCoordinator } from './apkUpdateInstallCoordinator'

const target: ApkReleaseInfo = {
  version: '1.2.0', versionCode: 12, tagName: 'v1.2.0', name: 'Release',
  htmlUrl: 'https://example.test/release', apkUrl: 'https://example.test/a.apk',
  apkName: 'a.apk', publishedAt: null, sha256: 'a'.repeat(64), sizeBytes: 100,
  releaseNotes: [{ version: '1.2.0', notes: '- Original' }],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture() {
  const pending = deferred<ApkUpdateResult>()
  const install = jest.fn<Promise<ApkUpdateResult>, [ApkReleaseInfo, ApkInstallOptions]>(() => pending.promise)
  const onStart = jest.fn()
  const onProgress = jest.fn()
  const onResult = jest.fn()
  const onFailure = jest.fn()
  const onCancelled = jest.fn()
  const onBusyChange = jest.fn()
  const coordinator = createApkUpdateInstallCoordinator({
    install, onStart, onProgress, onResult, onFailure, onCancelled, onBusyChange,
  })
  return { coordinator, pending, install, onStart, onProgress, onResult, onFailure, onCancelled, onBusyChange }
}

it('freezes the selected artifact and nested notes while refusing parallel starts', async () => {
  const f = fixture()
  const mutable = { ...target, releaseNotes: [{ version: '1.2.0', notes: '- Original' }] }
  const running = f.coordinator.start(mutable)
  mutable.apkUrl = 'https://example.test/b.apk'
  mutable.releaseNotes[0].notes = '- Changed later'
  expect(await f.coordinator.start(mutable)).toBe(false)
  const selected = f.install.mock.calls[0][0]
  expect(selected.apkUrl).toBe(target.apkUrl)
  expect(selected.releaseNotes?.[0].notes).toBe('- Original')
  expect(Object.isFrozen(selected)).toBe(true)
  expect(Object.isFrozen(selected.releaseNotes?.[0])).toBe(true)
  expect(Object.isFrozen(f.onStart.mock.calls[0][0])).toBe(true)
  f.pending.resolve({ status: 'downloaded', message: 'Installer opened' })
  expect(await running).toBe(true)
  expect(f.onResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'downloaded' }), expect.objectContaining({ target: selected }))
  expect(f.onBusyChange.mock.calls).toEqual([[true], [false]])
})

it('cancels only the active request and fences subsequent progress', async () => {
  const f = fixture()
  const running = f.coordinator.start(target)
  const options = f.install.mock.calls[0][1]
  options.onProgress?.({ stage: 'downloading', release: target, percent: 10 })
  expect(f.onProgress).toHaveBeenCalledTimes(1)
  f.coordinator.cancel(); f.coordinator.cancel()
  expect(options.signal?.aborted).toBe(true)
  options.onProgress?.({ stage: 'verifying', release: target })
  expect(f.onProgress).toHaveBeenCalledTimes(1)
  f.pending.reject(new Error('Transport cancelled'))
  await running
  expect(f.onCancelled).toHaveBeenCalledTimes(1)
  expect(f.onFailure).not.toHaveBeenCalled()
})

it('does not treat cancellation after the installer handoff as revoking that handoff', async () => {
  const f = fixture()
  const running = f.coordinator.start(target)
  f.install.mock.calls[0][1].onProgress?.({ stage: 'opening-installer', release: target })
  f.coordinator.cancel()
  f.pending.resolve({ status: 'downloaded', message: 'Installer already opened' })
  await running
  expect(f.onResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'downloaded' }), expect.anything())
  expect(f.onCancelled).not.toHaveBeenCalled()
})

it('ignores asynchronous completions after teardown and releases its busy scope exactly once', async () => {
  const f = fixture()
  const running = f.coordinator.start(target)
  f.coordinator.dispose(); f.coordinator.dispose()
  expect(f.install.mock.calls[0][1].signal?.aborted).toBe(true)
  f.install.mock.calls[0][1].onProgress?.({ stage: 'verifying', release: target })
  f.pending.resolve({ status: 'downloaded', message: 'Late completion' })
  await running
  expect(f.onProgress).not.toHaveBeenCalled()
  expect(f.onResult).not.toHaveBeenCalled()
  expect(f.onBusyChange.mock.calls).toEqual([[true], [false]])
  expect(await f.coordinator.start(target)).toBe(false)
})

it('does not let an earlier callback overwrite a subsequent request', async () => {
  const f = fixture()
  const first = f.coordinator.start(target)
  const oldOptions = f.install.mock.calls[0][1]
  f.pending.resolve({ status: 'error', message: 'Failed' })
  await first
  const next = deferred<ApkUpdateResult>()
  f.install.mockReturnValueOnce(next.promise)
  const second = f.coordinator.start({ ...target, apkUrl: 'https://example.test/b.apk' })
  oldOptions.onProgress?.({ stage: 'downloading', release: target })
  expect(f.onProgress).not.toHaveBeenCalled()
  next.reject(new Error('Network failure'))
  await second
  expect(f.onFailure).toHaveBeenCalledTimes(1)
  expect(f.onStart.mock.calls.map(([request]) => request.id)).toEqual([1, 2])
})

it('cleans up a failed presentation start without invoking the installer', async () => {
  const onBusyChange = jest.fn()
  const install = jest.fn()
  const onFailure = jest.fn()
  const coordinator = createApkUpdateInstallCoordinator({
    install, onBusyChange, onFailure, onStart: () => { throw new Error('Presentation failed') },
  })
  await coordinator.start(target)
  expect(install).not.toHaveBeenCalled()
  expect(onFailure).toHaveBeenCalledTimes(1)
  expect(onBusyChange.mock.calls).toEqual([[true], [false]])
})
