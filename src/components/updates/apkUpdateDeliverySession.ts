import type { ApkReleaseInfo } from '@/platform/native/androidApkUpdates'
import type { ApkDeliverySnapshot } from './apkUpdateDeliveryCoordinator'

type DeliveryApi = { start(target: ApkReleaseInfo, prepareOnly?: boolean): Promise<boolean>; cancel(automaticOnly?: boolean): void }
const idle: ApkDeliverySnapshot = Object.freeze({ stage: 'idle', approved: false })
let snapshot = idle
let owner: DeliveryApi | undefined
const listeners = new Set<() => void>()
const publish = (next: ApkDeliverySnapshot) => {
  snapshot = next
  for (const listener of [...listeners]) { try { listener() } catch { /* UI observers have no effect authority. */ } }
}

/** Read-only UI projection and commands routed to the one mounted root owner. */
export const apkUpdateDeliverySession = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  bind(api: DeliveryApi) {
    if (owner) throw new Error('An APK delivery root is already mounted.')
    owner = api
    publish(idle)
    return {
      publish(next: ApkDeliverySnapshot) { if (owner === api) publish(next) },
      release() { if (owner === api) { owner = undefined; publish(idle) } },
    }
  },
  install(target: ApkReleaseInfo) { return owner?.start(target) ?? Promise.resolve(false) },
  prepare(target: ApkReleaseInfo) { return owner?.start(target, true) ?? Promise.resolve(false) },
  cancel(automaticOnly = false) { owner?.cancel(automaticOnly) },
}
