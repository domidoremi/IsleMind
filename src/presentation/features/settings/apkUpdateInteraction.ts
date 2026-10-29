import { createApkUpdateIgnoreState, type ApkUpdateTarget, type InstalledApkVersion } from '@/modules/settings'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'

let manualChecks = 0
const automaticPrompts = new Set<AbortController>()
const handledTargets = new Set<string>()

/** A manual action owns confirmation; cancel any queued automatic duplicate without ignoring it. */
export function beginManualApkUpdateCheck(): () => void {
  manualChecks += 1
  const releaseBlocker = appUpdateActivity.acquireBlocker('manual-update-check')
  for (const controller of automaticPrompts) controller.abort()
  let finished = false
  return () => {
    if (finished) return
    finished = true
    manualChecks -= 1
    releaseBlocker()
  }
}

export function claimAutomaticApkUpdatePrompt(
  installed: InstalledApkVersion,
  target: ApkUpdateTarget,
  controller: AbortController,
): (() => void) | undefined {
  if (manualChecks || controller.signal.aborted || automaticPrompts.size
    || handledTargets.has(targetIdentity(installed, target))) return undefined
  automaticPrompts.add(controller)
  const release = () => {
    automaticPrompts.delete(controller)
    controller.signal.removeEventListener('abort', release)
  }
  controller.signal.addEventListener('abort', release, { once: true })
  return release
}

export function markApkUpdatePromptHandled(installed: InstalledApkVersion, target: ApkUpdateTarget): void {
  handledTargets.add(targetIdentity(installed, target))
}

/** The app root owns this transient session; durable per-version ignores live in Settings. */
export function clearAutomaticApkUpdatePromptSession(): void {
  for (const controller of automaticPrompts) controller.abort()
  handledTargets.clear()
}

function targetIdentity(installed: InstalledApkVersion, target: ApkUpdateTarget): string {
  return JSON.stringify(createApkUpdateIgnoreState(installed, target) ?? {
    installedVersion: installed.appVersion, installedBuildVersion: installed.buildVersion,
    targetVersion: target.version, targetVersionCode: target.versionCode,
  })
}
