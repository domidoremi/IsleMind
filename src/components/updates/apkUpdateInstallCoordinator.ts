import type { ApkInstallOptions, ApkInstallProgress, ApkReleaseInfo, ApkUpdateResult } from '@/platform/native/androidApkUpdates'
import { freezeApkUpdateTarget } from './apkUpdateTarget'

export interface ApkUpdateInstallRequest {
  readonly id: number
  readonly target: ApkReleaseInfo
  readonly signal: AbortSignal
}

/** One explicit installation owns its target, cancellation, and asynchronous callbacks. */
export function createApkUpdateInstallCoordinator(input: {
  install(target: ApkReleaseInfo, options: ApkInstallOptions): Promise<ApkUpdateResult>
  onStart?(request: ApkUpdateInstallRequest): void
  onProgress?(progress: ApkInstallProgress, request: ApkUpdateInstallRequest): void
  onResult?(result: ApkUpdateResult, request: ApkUpdateInstallRequest): void
  onFailure?(error: unknown, request: ApkUpdateInstallRequest): void
  onCancelled?(request: ApkUpdateInstallRequest): void
  onBusyChange?(busy: boolean): void
}) {
  let active: { request: ApkUpdateInstallRequest; controller: AbortController } | undefined
  let sequence = 0
  let disposed = false
  return {
    async start(target: ApkReleaseInfo): Promise<boolean> {
      if (disposed || active) return false
      const controller = new AbortController()
      const request = Object.freeze({ id: ++sequence, target: freezeApkUpdateTarget(target), signal: controller.signal })
      const operation = { request, controller }
      active = operation
      const current = () => !disposed && active === operation
      try {
        input.onBusyChange?.(true)
        input.onStart?.(request)
        const result = await input.install(request.target, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (current() && !controller.signal.aborted) input.onProgress?.(progress, request)
          },
        })
        if (current()) input.onResult?.(result, request)
      } catch (error) {
        if (current()) {
          if (controller.signal.aborted) input.onCancelled?.(request)
          else input.onFailure?.(error, request)
        }
      } finally {
        if (active === operation) { active = undefined; input.onBusyChange?.(false) }
      }
      return true
    },
    cancel() { active?.controller.abort() },
    dispose() {
      if (disposed) return
      disposed = true
      active?.controller.abort()
      if (active) { active = undefined; input.onBusyChange?.(false) }
    },
  }
}
