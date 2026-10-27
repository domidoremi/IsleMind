const assert = require('node:assert/strict')

function parseReleaseVersion(value) {
  assert.equal(typeof value, 'string', 'release versions must be strings')
  assert.match(value, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'release versions use three numeric components')
  const parts = value.split('.').map(Number)
  assert.ok(parts.every(Number.isSafeInteger), 'release version components must be safe integers')
  return parts
}

function assertReleaseVersionRelationship(packageJson, appJson, manifest) {
  const sourceVersion = packageJson.version
  const apkVersion = manifest.versionName
  const sourceParts = parseReleaseVersion(sourceVersion)
  const apkParts = parseReleaseVersion(apkVersion)
  const sourceBuild = appJson?.expo?.android?.versionCode
  const apkBuild = manifest.versionCode

  assert.equal(appJson?.expo?.version, sourceVersion, 'package and Expo versions remain synchronized')
  assert.ok(Number.isSafeInteger(sourceBuild) && sourceBuild > 0, 'source versionCode must be a positive integer')
  assert.ok(Number.isSafeInteger(apkBuild) && apkBuild > 0, 'APK manifest versionCode must be a positive integer')

  const differentPart = sourceParts.findIndex((part, index) => part !== apkParts[index])
  const versionOrder = differentPart < 0 ? 0 : sourceParts[differentPart] - apkParts[differentPart]
  assert.ok(versionOrder >= 0, 'APK metadata cannot describe a version newer than the source')

  // A source-only release advances source identity without inventing a newer APK candidate.
  if (versionOrder === 0) {
    assert.equal(apkBuild, sourceBuild, 'matching app versions must identify the same Android build')
  } else {
    assert.ok(apkBuild < sourceBuild, 'an older APK version must retain an older Android build')
  }

  if (manifest.status === 'prerelease-qualification') {
    assert.deepEqual(manifest.assets, [], 'qualification cannot advertise installable APKs')
    assert.equal(manifest.publishedAt, null, 'qualification cannot claim a publication date')
  }

  return {
    sourceVersion,
    sourceBuild,
    apkVersion,
    apkBuild,
    isCurrentBuild: versionOrder === 0,
  }
}

module.exports = { assertReleaseVersionRelationship }
