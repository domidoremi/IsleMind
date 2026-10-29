import type { ApkReleaseInfo } from '@/platform/native/androidApkUpdates'

/** Consent binds the displayed artifact and notes, not a mutable "latest release" reference. */
export function freezeApkUpdateTarget(release: ApkReleaseInfo): ApkReleaseInfo {
  return Object.freeze({
    ...release,
    releaseNotes: release.releaseNotes
      ? Object.freeze(release.releaseNotes.map((entry) => Object.freeze({ ...entry }))) : undefined,
  })
}

export function apkUpdateTargetIdentity(release: ApkReleaseInfo): string {
  return JSON.stringify([
    release.version, release.versionCode, release.tagName, release.apkUrl,
    release.apkName, release.sha256, release.sizeBytes, release.abi, release.variant,
  ])
}
