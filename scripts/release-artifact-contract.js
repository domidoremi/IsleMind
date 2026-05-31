const path = require('node:path')

const apkOutputDirName = 'dist-apk'
const defaultReleaseSmokeArch = 'x86_64'
const defaultReleaseSmokeVariant = 'no-model'

function formatApkArtifactName({ version, buildType = 'release', variant = defaultReleaseSmokeVariant, arch = defaultReleaseSmokeArch }) {
  if (!version) throw new Error('APK artifact version is required.')
  if (!buildType) throw new Error('APK artifact buildType is required.')
  if (!variant) throw new Error('APK artifact variant is required.')
  if (!arch) throw new Error('APK artifact arch is required.')
  if (buildType === 'release') {
    return `IsleMind-${version}-${arch}-${variant}.apk`
  }
  return `IsleMind-${version}-android-${buildType}-${variant}-${arch}.apk`
}

function formatApkArtifactRelativePath(options) {
  return path.join(apkOutputDirName, formatApkArtifactName(options))
}

function resolveApkArtifactPath(root, options) {
  return path.join(root, formatApkArtifactRelativePath(options))
}

module.exports = {
  apkOutputDirName,
  defaultReleaseSmokeArch,
  defaultReleaseSmokeVariant,
  formatApkArtifactName,
  formatApkArtifactRelativePath,
  resolveApkArtifactPath,
}
