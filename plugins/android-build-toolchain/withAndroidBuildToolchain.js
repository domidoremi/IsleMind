const fs = require('node:fs')
const path = require('node:path')
const { withDangerousMod } = require('@expo/config-plugins')
const { qualifiedBuildToolchain } = require('../../scripts/android-build-toolchain')

function pinGradleWrapperProperties(source) {
  const values = name => [...source.matchAll(new RegExp(`^[ \\t]*${name}(?:[ \\t]*[=:][ \\t]*|[ \\t]+)([^\\r\\n]*)`, 'gm'))].map(match => match[1].trim().replaceAll('\\:', ':'))
  const urls = values('distributionUrl')
  const expectedUrl = `https://services.gradle.org/distributions/gradle-${qualifiedBuildToolchain.gradle}-bin.zip`
  if (urls.length !== 1 || urls[0] !== expectedUrl) throw new Error(`Unqualified Gradle wrapper distribution; expected ${expectedUrl}.`)
  const checksums = values('distributionSha256Sum')
  if (checksums.length > 1 || (checksums.length === 1 && checksums[0] !== qualifiedBuildToolchain.gradleDistributionSha256)) {
    throw new Error('Gradle wrapper checksum differs from the qualified distribution; refusing to overwrite it.')
  }
  if (checksums.length === 1) return source
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  return `${source.replace(/[\r\n]+$/, '')}${newline}distributionSha256Sum=${qualifiedBuildToolchain.gradleDistributionSha256}${newline}`
}

// Build metadata only: no native module, permission, manifest or application behavior changes.
module.exports = function withAndroidBuildToolchain(config) {
  return withDangerousMod(config, ['android', mod => {
    const file = path.join(mod.modRequest.platformProjectRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties')
    const source = fs.readFileSync(file, 'utf8')
    const pinned = pinGradleWrapperProperties(source)
    if (pinned !== source) fs.writeFileSync(file, pinned)
    return mod
  }])
}
module.exports.pinGradleWrapperProperties = pinGradleWrapperProperties
