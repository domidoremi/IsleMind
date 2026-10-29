import { compareAppVersions, parseAppVersion } from '@/core/appVersion'
import type { ApkUpdateIgnoreState, Settings } from '@/types/settingsContracts'

export interface InstalledApkVersion {
  appVersion: string
  buildVersion: string
}

export interface ApkUpdateTarget {
  version: string
  versionCode?: number
}

export function normalizeApkUpdateIgnoreState(value: unknown): ApkUpdateIgnoreState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const installed = parseAppVersion(record.installedVersion)
  const target = parseAppVersion(record.targetVersion)
  if (!installed || !target || typeof record.installedBuildVersion !== 'string'
    || !record.installedBuildVersion.trim() || record.installedBuildVersion.length > 64) return undefined
  if (record.targetVersionCode !== undefined && (typeof record.targetVersionCode !== 'number'
    || !Number.isSafeInteger(record.targetVersionCode) || record.targetVersionCode <= 0)) return undefined
  return {
    installedVersion: installed.version,
    installedBuildVersion: record.installedBuildVersion.trim(),
    targetVersion: target.version,
    ...(record.targetVersionCode === undefined ? {} : { targetVersionCode: record.targetVersionCode as number }),
  }
}

export function normalizeSettingsUpdateReminders(settings: Settings): Settings {
  const ignored = normalizeApkUpdateIgnoreState(settings.ignoredApkUpdate)
  const neverRemind = settings.neverRemindUpdates === true
  const interval = [30, 60, 360, 1440].includes(settings.apkUpdateCheckIntervalMinutes ?? 0)
    ? settings.apkUpdateCheckIntervalMinutes! : 1440
  const channel = settings.apkUpdateChannel === 'every-release' ? 'every-release' : 'stable'
  const automaticDownload = settings.autoApkDownloadEnabled === true
  const banner = settings.apkUpdateBannerEnabled !== false
  if (neverRemind === settings.neverRemindUpdates
    && interval === settings.apkUpdateCheckIntervalMinutes && channel === settings.apkUpdateChannel
    && automaticDownload === settings.autoApkDownloadEnabled && banner === settings.apkUpdateBannerEnabled
    && JSON.stringify(ignored) === JSON.stringify(settings.ignoredApkUpdate)) return settings
  return { ...settings, neverRemindUpdates: neverRemind, ignoredApkUpdate: ignored,
    apkUpdateCheckIntervalMinutes: interval, apkUpdateChannel: channel,
    autoApkDownloadEnabled: automaticDownload, apkUpdateBannerEnabled: banner }
}

export function createApkUpdateIgnoreState(
  installed: InstalledApkVersion,
  target: ApkUpdateTarget,
): ApkUpdateIgnoreState | undefined {
  return normalizeApkUpdateIgnoreState({
    installedVersion: installed.appVersion,
    installedBuildVersion: installed.buildVersion,
    targetVersion: target.version,
    targetVersionCode: target.versionCode,
  })
}

/** Installer handoff is not upgrade success; only actual installed metadata expires an ignore. */
export function reconcileApkUpdateIgnoreState(
  value: ApkUpdateIgnoreState | undefined,
  installed: InstalledApkVersion,
): ApkUpdateIgnoreState | undefined {
  const ignored = normalizeApkUpdateIgnoreState(value)
  if (!ignored || !parseAppVersion(installed.appVersion)
    || compareAppVersions(ignored.installedVersion, installed.appVersion) !== 0
    || ignored.installedBuildVersion !== installed.buildVersion.trim()) return undefined
  if (!isNewerTarget(installed, { version: ignored.targetVersion, versionCode: ignored.targetVersionCode })) return undefined
  return ignored
}

export function shouldPromptApkUpdate(
  settings: Pick<Settings, 'neverRemindUpdates' | 'ignoredApkUpdate'>,
  installed: InstalledApkVersion,
  target: ApkUpdateTarget,
): boolean {
  if (settings.neverRemindUpdates === true) return false
  if (!parseAppVersion(installed.appVersion) || !parseAppVersion(target.version)) return false
  if (!isNewerTarget(installed, target)) return false
  const ignored = reconcileApkUpdateIgnoreState(settings.ignoredApkUpdate, installed)
  return !ignored || compareAppVersions(ignored.targetVersion, target.version) !== 0
    || ignored.targetVersionCode !== target.versionCode
}

function isNewerTarget(installed: InstalledApkVersion, target: ApkUpdateTarget): boolean {
  const installedBuild = Number(installed.buildVersion)
  if (Number.isSafeInteger(installedBuild) && installedBuild > 0
    && Number.isSafeInteger(target.versionCode) && (target.versionCode ?? 0) > 0) {
    return target.versionCode! > installedBuild
  }
  return compareAppVersions(target.version, installed.appVersion) > 0
}
