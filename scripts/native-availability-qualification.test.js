const fs = require('node:fs')
const path = require('node:path')
const {
  qualificationProfile,
  configureQualificationGradle,
  configureQualificationManifest,
  assertQualificationApk,
  validateQualificationProbe,
} = require('./native-availability-qualification')

const root = path.resolve(__dirname, '..')
const gradle = `react {
    entryFile = file("index.js")
}
android {
    namespace "com.islemind.app"
    defaultConfig { applicationId "com.islemind.app"; versionCode 125; versionName "1.1.0" }
    signingConfigs {
        release { keyAlias "fixture-release" }
    }
    buildTypes {
        release { debuggable false; signingConfig signingConfigs.release }
    }
}
`
const manifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">
  <uses-permission android:name="android.permission.INTERNET"/>
  <application android:allowBackup="true"><data android:scheme="islemind"/></application>
</manifest>`

function apkEvidence(profile) {
  return {
    badging: `package: name='${profile.package}'\nlaunchable-activity: name='${profile.package}.MainActivity'\n${profile.internet ? "uses-permission: name='android.permission.INTERNET'\n" : ''}native-code: 'arm64-v8a'`,
    manifest: 'A: android:allowBackup(0x01010280)=(type 0x12)0x0\nA: android:debuggable(0x0101000f)=(type 0x12)0xffffffff',
    signing: 'Signer #1 certificate DN: C=US, O=Android, CN=Android Debug',
  }
}

function probeReceipt(network = false) {
  const profile = qualificationProfile(network)
  const database = `stage9-qualification-${'a'.repeat(32)}.db`
  const storage = { database, current: { count: 8 }, history: { count: 8 }, dbBytes: 4096,
    journalMode: { journal_mode: 'wal' }, synchronous: { synchronous: 2 }, foreignKeys: { foreign_keys: 1 } }
  const value = { storage, integrity: { integrity: [{ integrity_check: 'ok' }], foreignKeyViolations: [] },
    queries: { first: [1], config: { database } }, rowsSha256: 'b'.repeat(64) }
  const original = { identity: { userId: '10001', versionCode: '125' }, apks: [{ sha256: 'c'.repeat(64) }] }
  return { schema: 'islemind.native-availability-qualification.v1', scope: 'isolated-storage-qualification',
    package: profile.package, profile: profile.name, database, uid: '10002',
    identity: { package: profile.package, sha256: 'd'.repeat(64), internet: profile.internet, debuggable: true, backup: false, sharedUid: false },
    installedApkSha256: 'd'.repeat(64), productionBefore: original, productionAfter: structuredClone(original),
    productionPrivatePreservation: { status: 'not-inspected', verified: false }, fullC4: 'not-certified',
    environment: { model: 'M2007J3SC' }, privateFileRead: { database, exitCode: 0, sha256: 'e'.repeat(64) },
    before: value, after: structuredClone(value), reseededAfterRestart: false, completedAt: '2026-09-18T00:00:00Z' }
}

test('qualification adds a distinct build type without changing release or signing blocks', () => {
  const result = configureQualificationGradle(gradle, qualificationProfile())
  expect(result).toContain('release { keyAlias "fixture-release" }')
  expect(result).toContain('release { debuggable false; signingConfig signingConfigs.release }')
  expect(result).toContain('qualification {\n            initWith release\n            debuggable true\n            signingConfig signingConfigs.debug')
  expect(result).toContain('cmake { arguments "-DCMAKE_BUILD_TYPE=RelWithDebInfo" }')
  expect(result).toContain("matchingFallbacks = ['release']")
  expect(result).not.toContain('debuggableVariants')
  expect(result).not.toContain('com.islemind.app')
  expect(() => configureQualificationGradle(result, qualificationProfile())).toThrow()
  expect(() => configureQualificationGradle('unknown template', qualificationProfile())).toThrow()
})

test.each([false, true])('network profile is explicit and has an independent identity: %s', network => {
  const profile = qualificationProfile(network)
  const result = configureQualificationManifest(manifest, profile)
  expect(result).toContain('android:allowBackup="false"')
  expect(result).toContain(`android:scheme="${profile.scheme}"`)
  expect(result.includes('android.permission.INTERNET" tools:node="remove"')).toBe(!network)
  expect(result.includes('android.permission.INTERNET"/>')).toBe(network)
  expect(() => assertQualificationApk(apkEvidence(profile), profile)).not.toThrow()
  expect(() => assertQualificationApk(apkEvidence(profile), qualificationProfile(!network))).toThrow()
})

test.each([
  evidence => { evidence.manifest = evidence.manifest.replace('0xffffffff', '0x0') },
  evidence => { evidence.manifest += '\nsharedUserId=10001' },
  evidence => { evidence.manifest += '\ncom.islemind.app.MainActivity' },
  evidence => { evidence.manifest = evidence.manifest.replace('0x0\n', '0xffffffff\n') },
  evidence => { evidence.signing = 'Signer #1 certificate DN: CN=Fixture Release' },
])('unsafe qualification APK is rejected', mutate => {
  const profile = qualificationProfile()
  const evidence = apkEvidence(profile)
  mutate(evidence)
  expect(() => assertQualificationApk(evidence, profile)).toThrow()
})

test('aapt2 textual manifest booleans preserve the same fail-closed checks as typed hex', () => {
  const profile = qualificationProfile()
  const evidence = apkEvidence(profile)
  evidence.manifest = 'A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)=false\nA: http://schemas.android.com/apk/res/android:debuggable(0x0101000f)=true'
  expect(() => assertQualificationApk(evidence, profile)).not.toThrow()
  for (const manifest of [evidence.manifest.replace('=false', '=true'), evidence.manifest.replace('=true', '=false'),
    evidence.manifest.replace('=false', '=false-extra'), evidence.manifest.replace('=false', '="false"')]) {
    expect(() => assertQualificationApk({ ...evidence, manifest }, profile)).toThrow()
  }
})

test.each([false, true])('real isolated probe evidence cannot certify production or C4: %s', network => {
  expect(validateQualificationProbe(probeReceipt(network))).toEqual({
    scope: 'isolated-storage-qualification', passed: true,
    productionPrivatePreservation: { status: 'not-inspected', verified: false }, fullC4: 'not-certified',
  })
})

test.each([
  receipt => { receipt.privateFileRead.exitCode = 1 },
  receipt => { receipt.privateFileRead.database = 'islemind-context.db' },
  receipt => { receipt.uid = receipt.productionBefore.identity.userId },
  receipt => { receipt.after.storage.history.count = 0 },
  receipt => { receipt.after.storage.synchronous.synchronous = 1 },
  receipt => { receipt.after.integrity.integrity[0].integrity_check = 'corrupt' },
  receipt => { receipt.after.rowsSha256 = 'f'.repeat(64) },
  receipt => { receipt.reseededAfterRestart = true },
  receipt => { receipt.productionAfter.apks[0].sha256 = 'f'.repeat(64) },
  receipt => { receipt.installedApkSha256 = 'f'.repeat(64) },
  receipt => { receipt.productionPrivatePreservation.verified = true },
  receipt => { receipt.fullC4 = 'passed' },
])('incomplete, misbound or false-success probe evidence is rejected', mutate => {
  const receipt = probeReceipt()
  mutate(receipt)
  expect(() => validateQualificationProbe(receipt)).toThrow()
})

test('builder never copies native signing files or assembles a release task', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/build-native-availability-apk.js'), 'utf8')
  expect(source).toContain("['app', 'src', 'assets'")
  expect(source).toContain('app:assembleQualification')
  expect(source).not.toContain('app:assembleRelease')
  expect(source).not.toContain('configure-android-release')
  expect(source).not.toContain('...process.env,')
})

test('strict C4 validator still requires original private files and full measurements', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/validate-native-availability-evidence.js'), 'utf8')
  expect(source).toContain("load('final/measurements.json')")
  expect(source).toContain("load('install/preservation-before.json')")
  expect(source).toContain('JSON.stringify(baseline.files) === JSON.stringify(preserved.files)')
  expect(source).toContain("'qualification-verdict.json'")
  expect(source).toContain("'stage9-verdict.json'")
})
