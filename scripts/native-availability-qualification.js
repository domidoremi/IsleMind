const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

const PRODUCTION_PACKAGE = 'com.islemind.app'
const C4_ACCEPTANCE = Object.freeze({
  detailSqlP95Ms: 250, filteredSqlP95Ms: 100, aggregateP95Ms: 50,
  uiFirstPageP95Ms: 500, writeBatchP95Ms: 250, cleanupBatchP95Ms: 50,
  startupPopulatedMedianIncreaseMs: 100, additionalUsedJsHeapBytes: 16 * 1024 * 1024,
  scrollingFrameP95Ms: 33.34, scrollingFramesOver50MsFraction: .05,
  historyBoundMustHold: true, integrityAndRecoveryMustPass: true,
})

function assertC4Preservation(before, after) {
  const hash = value => createHash('sha256').update(value).digest('hex')
  const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
  for (const snapshot of [before, after]) {
    assert(snapshot && snapshot.identity, 'Missing original installation identity')
    for (const field of ['userId', 'codePath', 'dataDir']) {
      assert(typeof snapshot.identity[field] === 'string' && snapshot.identity[field].trim(), `Missing original ${field}`)
    }
    assert(Array.isArray(snapshot.apks) && snapshot.apks.length > 0, 'Missing original APK hashes')
    for (const apk of snapshot.apks) {
      assert(typeof apk.path === 'string' && apk.path.trim() && sha256(apk.sha256), 'Invalid original APK hash')
    }
    assert(Array.isArray(snapshot.files) && snapshot.files.some(file => file.area === 'credential' && file.category === 'database'),
      'No original database was hashed; unreadable data is not an empty preservation snapshot')
    const paths = new Set()
    for (const file of snapshot.files) {
      assert(['credential', 'device', 'external'].includes(file.area) && sha256(file.pathSha256) && sha256(file.sha256),
        'Invalid original private-file hash')
      const key = `${file.area}/${file.pathSha256}`
      assert(!paths.has(key), 'Duplicate original private-file identity')
      paths.add(key)
    }
    assert.equal(snapshot.manifestSha256, hash(JSON.stringify(snapshot.files)), 'Private-file manifest hash mismatch')
    assert(typeof snapshot.dataDirectoryStat === 'string' && snapshot.dataDirectoryStat.trim(), 'Missing original data-directory identity')
  }
  assert.deepEqual(after.identity, before.identity, 'Original installation identity changed')
  assert.deepEqual(after.apks, before.apks, 'Original APK changed')
  assert.equal(after.dataDirectoryStat, before.dataDirectoryStat, 'Original data-directory identity changed')
  assert.deepEqual(after.files, before.files, 'Original private-file hashes changed')
  return true
}

function qualificationProfile(network = false) {
  return {
    name: network ? 'network' : 'offline',
    package: network ? 'com.islemind.stage9.network' : 'com.islemind.stage9',
    scheme: network ? 'islemind-stage9-network' : 'islemind-stage9',
    internet: network,
    buildType: 'qualification',
  }
}

function configureQualificationGradle(source, profile) {
  const marker = '// Isolated qualification build type'
  assert(!source.includes(marker), 'Qualification instrumentation must start from a fresh native project')
  assert(/\bbuildTypes\s*\{/.test(source), 'Missing Android buildTypes')
  assert(/\bentryFile\s*=\s*file\(/.test(source), 'Missing React Native entryFile')
  assert(source.includes(PRODUCTION_PACKAGE), 'Unexpected generated Android namespace')
  return source
    .replace(/entryFile = file\([^\n]+/, 'entryFile = file("../../scripts/native-availability-entry.tsx")')
    .replaceAll(PRODUCTION_PACKAGE, profile.package)
    .replace(/versionCode \d+/, 'versionCode 9001')
    .replace(/versionName "[^"]+"/, 'versionName "1.1.0-qualification"')
    // AGP otherwise selects Debug C++ from debuggable=true, while fallback
    // dependencies use Release RN binaries (whose debug-only symbols are absent).
    + `\n${marker}\nandroid {\n    buildTypes {\n        qualification {\n            initWith release\n            debuggable true\n            signingConfig signingConfigs.debug\n            matchingFallbacks = ['release']\n            externalNativeBuild {\n                cmake { arguments "-DCMAKE_BUILD_TYPE=RelWithDebInfo" }\n            }\n        }\n    }\n}\n`
}

function configureQualificationManifest(source, profile) {
  assert(source.includes('<application '), 'Missing Android application manifest')
  let result = source.replace(/android:allowBackup="[^"]*"/, 'android:allowBackup="false"')
    .replace('android:scheme="islemind"', `android:scheme="${profile.scheme}"`)
  const denied = ['READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES',
    'READ_MEDIA_VIDEO', 'READ_MEDIA_AUDIO', 'ACCESS_MEDIA_LOCATION', 'CAMERA', 'RECORD_AUDIO',
    'REQUEST_INSTALL_PACKAGES', 'SYSTEM_ALERT_WINDOW', 'POST_NOTIFICATIONS', 'POST_PROMOTED_NOTIFICATIONS',
    'MODIFY_AUDIO_SETTINGS', 'VIBRATE', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_DATA_SYNC', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK']
  if (!profile.internet) denied.push('INTERNET')
  for (const name of denied) {
    result = result.replace(new RegExp(`<uses-permission\\s+android:name="android\\.permission\\.${name}"[^>]*/>`, 'g'), '')
    result = result.replace('<application ', `<uses-permission android:name="android.permission.${name}" tools:node="remove"/>\n  <application `)
  }
  if (profile.internet) {
    result = result.replace(/<uses-permission\s+android:name="android\.permission\.INTERNET"[^>]*\/>/g, '')
      .replace('<application ', '<uses-permission android:name="android.permission.INTERNET"/>\n  <application ')
  }
  return result.replace(/<uses-permission\s+android:name="com.android.alarm.permission.SET_ALARM"[^>]*\/>/g, '')
}

function assertQualificationApk({ badging, manifest, signing }, profile) {
  assert.equal(/package: name='([^']+)'/.exec(badging)?.[1], profile.package, 'Unexpected qualification package')
  assert.equal(/launchable-activity: name='([^']+)'/.exec(badging)?.[1], `${profile.package}.MainActivity`)
  assert(!manifest.includes('sharedUserId') && !manifest.includes(PRODUCTION_PACKAGE), 'Qualification APK shares production identity')
  assert.equal(badging.includes("name='android.permission.INTERNET'"), profile.internet, 'Qualification network profile mismatch')
  const manifestBoolean = (name, value) => new RegExp(`^\\s*A: (?:android:|http://schemas\\.android\\.com/apk/res/android:)${name}\\(0x[0-9a-f]+\\)=(?:${value}|\\(type 0x12\\)${value ? '0xffffffff' : '0x0'})\\s*$`, 'm').test(manifest)
  assert(manifestBoolean('allowBackup', false), 'Qualification backup must be disabled')
  assert(manifestBoolean('debuggable', true), 'Qualification APK must permit private test-file inspection')
  assert(/certificate DN:.*CN=Android Debug/.test(signing), 'Qualification APK must use only the local Android debug certificate')
  assert(/native-code: 'arm64-v8a'\s*$/.test(badging.trim()), 'Expected exactly arm64-v8a')
}

function validateQualificationProbe(receipt) {
  assert.equal(receipt.schema, 'islemind.native-availability-qualification.v1')
  const profile = qualificationProfile(receipt.profile === 'network')
  assert.equal(receipt.profile, profile.name)
  assert.equal(receipt.scope, 'isolated-storage-qualification')
  assert.equal(receipt.package, profile.package)
  assert.equal(receipt.identity.package, profile.package)
  assert.equal(receipt.identity.internet, profile.internet)
  assert.equal(receipt.identity.debuggable, true)
  assert.equal(receipt.identity.backup, false)
  assert.equal(receipt.identity.sharedUid, false)
  assert.equal(receipt.installedApkSha256, receipt.identity.sha256)
  assert.match(receipt.installedApkSha256, /^[a-f0-9]{64}$/)
  assert(receipt.uid && receipt.uid !== receipt.productionBefore.identity.userId)
  assert.deepEqual(receipt.productionAfter.identity, receipt.productionBefore.identity)
  assert.deepEqual(receipt.productionAfter.apks, receipt.productionBefore.apks)
  assert.equal(receipt.productionPrivatePreservation.verified, false)
  assert.equal(receipt.productionPrivatePreservation.status, 'not-inspected')
  assert.equal(receipt.fullC4, 'not-certified')
  assert.match(receipt.database, /^stage9-qualification-[a-f0-9]{32}\.db$/)
  assert.equal(receipt.privateFileRead.exitCode, 0)
  assert.match(receipt.privateFileRead.sha256, /^[a-f0-9]{64}$/)
  assert.equal(receipt.privateFileRead.database, receipt.database)
  assert.equal(receipt.environment.model, 'M2007J3SC')
  assert(receipt.completedAt && receipt.before && receipt.after)
  for (const value of [receipt.before, receipt.after]) {
    assert.equal(value.storage.current.count, 8)
    assert.equal(value.storage.history.count, 8)
    assert(value.storage.dbBytes > 0)
    assert.equal(value.storage.journalMode.journal_mode, 'wal')
    assert.equal(value.storage.synchronous.synchronous, 2)
    assert.equal(value.storage.foreignKeys.foreign_keys, 1)
    assert.equal(value.integrity.integrity[0].integrity_check, 'ok')
    assert.deepEqual(value.integrity.foreignKeyViolations, [])
  }
  assert.equal(receipt.reseededAfterRestart, false)
  for (const value of [receipt.before, receipt.after]) {
    assert.equal(value.storage.database, receipt.database)
    assert.equal(value.queries.config.database, receipt.database)
    assert.equal(value.queries.first.length, 1)
    assert.match(value.rowsSha256, /^[a-f0-9]{64}$/)
  }
  assert.equal(receipt.before.rowsSha256, receipt.after.rowsSha256, 'Qualification rows changed across process restart')
  return { scope: receipt.scope, passed: true, productionPrivatePreservation: receipt.productionPrivatePreservation, fullC4: receipt.fullC4 }
}

module.exports = { PRODUCTION_PACKAGE, C4_ACCEPTANCE, assertC4Preservation, qualificationProfile, configureQualificationGradle, configureQualificationManifest, assertQualificationApk, validateQualificationProbe }
