const { defaultReleaseSmokeArch } = require('./release-artifact-contract')

const defaultReleaseAppPackageName = 'com.islemind.app'
const cleanInstallWindowMs = 60_000

function validateReleaseProvenance(provenance, options = {}) {
  const appPackageName = options.appPackageName ?? defaultReleaseAppPackageName
  if (!provenance) return ['Release provenance was not collected.']
  const issues = []
  if (!provenance.appPackageName) {
    issues.push('Release provenance appPackageName is missing.')
  } else if (provenance.appPackageName !== appPackageName) {
    issues.push(`Release provenance appPackageName is ${provenance.appPackageName}, expected ${appPackageName}.`)
  }
  validateReleaseApkEvidence(provenance.apk, issues, 'Release APK')
  validateReleaseExpectedConfig(provenance.expected, issues, { appPackageName })
  validateReleaseInstalledPackage(provenance.installed, provenance.expected, issues)
  validateReleaseSourceFreshness(provenance.sourceFreshness, issues, {
    stalePrefix: 'Source/resource file',
    staleSuffix: '; rebuild and clean-install before using this APK as current evidence.',
  })
  if (provenance.source === 'stale-cache') issues.push('Cached installed-package provenance does not match the current APK SHA256.')
  return issues
}

function validateCurrentApkSmokeResult(result, options = {}) {
  const expected = options.expected ?? result?.expected ?? null
  const appPackageName = options.appPackageName ?? defaultReleaseAppPackageName
  const issues = []
  if (!result) return ['Current APK smoke result was not collected.']
  validateReleaseApkEvidence(result.apk, issues, 'Current APK', { requireExists: true })
  validateReleaseExpectedConfig(expected, issues, { appPackageName })
  validateReleaseSourceFreshness(result.sourceFreshness, issues, {
    stalePrefix: 'Current APK smoke used a stale APK:',
    staleSuffix: '.',
  })
  validateReleaseInstalledPackage(result.installed, expected, issues)
  if (!result.launch?.ok) issues.push('Current APK launch smoke did not prove a running app without fatal log lines.')
  if (result.launch?.fatalLog?.fatal) issues.push('Current APK launch log contains fatal app lines.')
  if (!result.compatibility16kb?.ok) issues.push('16KB APK validation did not pass.')
  if (!result.compatibility16kb?.zipAlignmentOk) issues.push('ZIP page alignment was not proven with zipalign -P 16.')
  if (!result.compatibility16kb?.elf64Ok) issues.push('64-bit ELF LOAD alignment was not proven.')
  return issues
}

function validateReleaseApkEvidence(apk, issues, label, options = {}) {
  if (!apk?.path) issues.push('No x86_64 no-model release APK was found in dist-apk.')
  if (options.requireExists && !apk?.exists) issues.push('Canonical x86_64 no-model APK was not present when the smoke ran.')
  if (!apk?.sha256) issues.push(`${label} SHA256 could not be calculated.`)
  if (!apk?.sidecarSha256) issues.push(`${label} .sha256 sidecar file is missing or unreadable.`)
  if (apk?.sha256 && apk?.sidecarSha256 && apk.sha256 !== apk.sidecarSha256) issues.push(`${label} SHA256 does not match its .sha256 sidecar.`)
  if (!Number.isFinite(apk?.sizeBytes) || apk.sizeBytes <= 0) issues.push(`${label} size was not recorded as a positive byte count.`)
}

function validateReleaseExpectedConfig(expected, issues, options = {}) {
  const appPackageName = options.appPackageName ?? defaultReleaseAppPackageName
  if (!expected?.packageVersion) issues.push('package.json version is missing.')
  if (!expected?.expoVersion) issues.push('app.json expo.version is missing.')
  if (!expected?.androidPackage) {
    issues.push('app.json android.package is missing.')
  } else if (expected.androidPackage !== appPackageName) {
    issues.push(`app.json android.package is ${expected.androidPackage}, expected ${appPackageName}.`)
  }
  if (!Number.isInteger(expected?.androidVersionCode)) issues.push('app.json android.versionCode is missing.')
  if (expected?.expoVersion && expected?.packageVersion && expected.expoVersion !== expected.packageVersion) issues.push('package.json version and app.json expo.version differ.')
}

function validateReleaseInstalledPackage(installed, expected, issues) {
  if (!installed) {
    issues.push('Installed package provenance was not collected from an Android device or valid cache.')
    return
  }
  if (!installed.deviceSerial) issues.push('Installed package deviceSerial is missing.')
  if (expected?.expoVersion && installed.versionName !== expected.expoVersion) issues.push(`Installed versionName ${installed.versionName ?? 'missing'} does not match app.json version ${expected.expoVersion}.`)
  if (expected?.androidVersionCode != null && installed.versionCode !== expected.androidVersionCode) issues.push(`Installed versionCode ${installed.versionCode ?? 'missing'} does not match app.json android.versionCode ${expected.androidVersionCode}.`)
  if (expected?.androidPackage && !String(installed.packagePath ?? '').includes(expected.androidPackage)) issues.push(`Installed package path does not include expected Android package ${expected.androidPackage}.`)
  if (installed.primaryCpuAbi !== defaultReleaseSmokeArch) issues.push(`Installed primaryCpuAbi is ${installed.primaryCpuAbi ?? 'missing'}, expected ${defaultReleaseSmokeArch}.`)
  if (installed.deviceAbi && installed.deviceAbi !== defaultReleaseSmokeArch) issues.push(`Device ABI is ${installed.deviceAbi}, expected ${defaultReleaseSmokeArch}.`)
  if (!installed.firstInstallTime || !installed.lastUpdateTime) issues.push('Installed package timestamps are missing.')
  if (!installed.cleanInstall) issues.push(`Installed package timestamps are outside the ${cleanInstallWindowMs}ms clean-install window, so clean install is not proven.`)
  if (!Number.isFinite(installed.cleanInstallWindowMs)) {
    issues.push('Installed package clean-install window was not recorded as a finite millisecond value.')
  } else if (installed.cleanInstallWindowMs < 0) {
    issues.push('Installed package clean-install window is invalid.')
  } else if (installed.cleanInstallWindowMs > cleanInstallWindowMs) {
    issues.push(`Installed package clean-install window ${installed.cleanInstallWindowMs}ms exceeds ${cleanInstallWindowMs}ms.`)
  }
}

function cleanInstallState(firstInstallTime, lastUpdateTime) {
  const firstMs = parseAndroidPackageTime(firstInstallTime)
  const lastMs = parseAndroidPackageTime(lastUpdateTime)
  const windowMs = Number.isFinite(firstMs) && Number.isFinite(lastMs) ? Math.abs(lastMs - firstMs) : null
  return {
    cleanInstall: windowMs != null && windowMs <= cleanInstallWindowMs,
    cleanInstallWindowMs: windowMs,
  }
}

function parseAndroidPackageTime(value) {
  if (!value) return NaN
  const parsed = Date.parse(`${String(value).trim().replace(' ', 'T')}Z`)
  return Number.isFinite(parsed) ? parsed : NaN
}

function validateReleaseSourceFreshness(sourceFreshness, issues, options = {}) {
  if (!sourceFreshness) {
    issues.push('Release source freshness was not collected.')
    return
  }
  if (sourceFreshness.status === 'stale') {
    const newest = sourceFreshness.newestInput?.path ?? 'unknown source/resource'
    const modifiedAt = sourceFreshness.newestInput?.modifiedAt ?? 'unknown time'
    const apkModifiedAt = sourceFreshness.apkModifiedAt ?? 'unknown APK time'
    const prefix = options.stalePrefix ?? 'Source/resource file'
    const suffix = options.staleSuffix ?? '.'
    if (prefix.endsWith(':')) {
      issues.push(`${prefix} ${newest} (${modifiedAt}) is newer than the APK (${apkModifiedAt})${suffix}`)
    } else {
      issues.push(`${prefix} ${newest} (${modifiedAt}) is newer than release APK (${apkModifiedAt})${suffix}`)
    }
    return
  }
  if (sourceFreshness.status !== 'current') issues.push('Release source freshness could not be verified.')
}

module.exports = {
  cleanInstallState,
  cleanInstallWindowMs,
  defaultReleaseAppPackageName,
  defaultReleaseSmokeArch,
  validateCurrentApkSmokeResult,
  validateReleaseProvenance,
}
