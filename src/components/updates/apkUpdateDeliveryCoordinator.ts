import type { ApkInstallOptions, ApkInstallProgress, ApkReleaseInfo, ApkUpdateResult, PreparedApkUpdate } from '@/platform/native/androidApkUpdates'
import { apkUpdateTargetIdentity, freezeApkUpdateTarget } from './apkUpdateTarget'

export type ApkDeliveryStage = 'idle' | 'preparing' | 'prepared' | 'waiting' | 'validating' | 'cancelling' | 'opening' | 'handed-off' | 'error'
export interface ApkDeliverySnapshot {
  readonly stage: ApkDeliveryStage
  readonly target?: ApkReleaseInfo
  readonly approved: boolean
  readonly progress?: ApkInstallProgress
}

/** Owns one APK preparation, not task admission or gateway restart authority. */
export function createApkUpdateDeliveryCoordinator(input: {
  prepare(target: ApkReleaseInfo, options: ApkInstallOptions): Promise<ApkUpdateResult>
  open(prepared: PreparedApkUpdate, options: ApkInstallOptions): Promise<ApkUpdateResult>
  discard(prepared: PreparedApkUpdate): Promise<void>
  waitForIdle(signal: AbortSignal): Promise<void>
  canOpenInstaller(): boolean
  onSnapshot(snapshot: ApkDeliverySnapshot): void
  onStart?(target: ApkReleaseInfo): void
  onProgress?(progress: ApkInstallProgress, signal: AbortSignal): void
  onResult?(result: ApkUpdateResult): void
  onFailure?(error: unknown): void
  onCancelled?(): void
  onSettled?(): void
}) {
  let disposed = false
  let prepared: PreparedApkUpdate | undefined
  let active: { target: ApkReleaseInfo; controller: AbortController; approved: boolean; promise: Promise<boolean> } | undefined
  let snapshot: ApkDeliverySnapshot = Object.freeze({ stage: 'idle', approved: false })
  const publish = (stage: ApkDeliveryStage, progress?: ApkInstallProgress) => {
    if (disposed) return
    snapshot = Object.freeze({ stage, target: active?.target ?? prepared?.release,
      approved: stage !== 'idle' && stage !== 'error' && stage !== 'cancelling' && active?.approved === true, progress })
    input.onSnapshot(snapshot)
  }
  const dropPrepared = async () => {
    const previous = prepared
    prepared = undefined
    if (previous) await input.discard(previous).catch(() => undefined)
  }
  const run = async (operation: NonNullable<typeof active>, prepareOnly: boolean) => {
    const current = () => !disposed && active === operation
    const valid = () => current() && !operation.controller.signal.aborted
    const options: ApkInstallOptions = {
      signal: operation.controller.signal,
      canOpenInstaller: () => valid() && operation.approved && input.canOpenInstaller(),
      onProgress: (progress) => {
        if (!valid()) return
        input.onProgress?.(progress, operation.controller.signal)
        if (!valid()) return
        publish(progress.stage === 'opening-installer' ? 'opening'
          : prepared ? 'validating' : 'preparing', progress)
      },
    }
    try {
      input.onStart?.(operation.target)
      if (!prepared) {
        publish('preparing')
        const result = await input.prepare(operation.target, options)
        if (!valid()) {
          if (result.prepared) await input.discard(result.prepared).catch(() => undefined)
          if (current()) { input.onCancelled?.(); publish('idle') }
          return true
        }
        if (!result.prepared || result.status !== 'prepared') {
          if (result.status === 'downloaded') throw new Error('Preparation cannot acknowledge installer handoff.')
          publish(result.status === 'cancelled' ? 'idle' : 'error')
          input.onResult?.(result)
          return true
        }
        if (apkUpdateTargetIdentity(result.prepared.release) !== apkUpdateTargetIdentity(operation.target)) {
          await input.discard(result.prepared)
          throw new Error('Preparation changed the approved APK identity.')
        }
        prepared = result.prepared
      }
      if (prepareOnly && !operation.approved) {
        publish('prepared')
        input.onResult?.({ status: 'prepared', release: prepared.release, prepared, message: '' })
        return true
      }
      while (valid() && prepared) {
        publish('waiting')
        await input.waitForIdle(operation.controller.signal)
        if (!valid()) break
        if (!options.canOpenInstaller?.()) continue
        const result = await input.open(prepared, options)
        if (!current()) return true
        if (!valid() && result.status !== 'downloaded') {
          await dropPrepared()
          input.onCancelled?.()
          publish('idle')
          return true
        }
        if (result.status === 'prepared' && !operation.controller.signal.aborted) continue
        if (result.status === 'busy') { publish('prepared'); input.onResult?.(result); return true }
        if (result.status !== 'downloaded') await dropPrepared()
        else prepared = undefined
        publish(result.status === 'downloaded' ? 'handed-off' : result.status === 'cancelled' ? 'idle' : 'error')
        input.onResult?.(result)
        return true
      }
      if (current()) { await dropPrepared(); input.onCancelled?.(); publish('idle') }
    } catch (error) {
      await dropPrepared()
      if (current()) {
        if (operation.controller.signal.aborted) { input.onCancelled?.(); publish('idle') }
        else { publish('error'); input.onFailure?.(error) }
      }
    } finally {
      if (active === operation) { active = undefined; if (!disposed) input.onSettled?.() }
    }
    return true
  }
  return {
    getSnapshot: () => snapshot,
    start(target: ApkReleaseInfo, prepareOnly = false): Promise<boolean> {
      if (disposed) return Promise.resolve(false)
      const frozen = freezeApkUpdateTarget(target)
      if (active) {
        if (!prepareOnly && !active.controller.signal.aborted && !active.approved
          && apkUpdateTargetIdentity(active.target) === apkUpdateTargetIdentity(frozen)) {
          active.approved = true
          publish(snapshot.stage, snapshot.progress)
          return active.promise
        }
        return Promise.resolve(false)
      }
      if (prepared && apkUpdateTargetIdentity(prepared.release) !== apkUpdateTargetIdentity(frozen)) return Promise.resolve(false)
      if (prepared && prepareOnly) return Promise.resolve(true)
      const operation = { target: frozen, controller: new AbortController(), approved: !prepareOnly, promise: Promise.resolve(true) }
      active = operation
      operation.promise = run(operation, prepareOnly)
      return operation.promise
    },
    cancel(automaticOnly = false) {
      if (automaticOnly && (active?.approved || snapshot.approved)) return
      if (active) { active.controller.abort(); publish('cancelling'); return }
      void dropPrepared()
      publish('idle')
    },
    dispose() {
      disposed = true
      active?.controller.abort()
      snapshot = Object.freeze({ stage: 'idle', approved: false })
      void dropPrepared()
    },
  }
}
