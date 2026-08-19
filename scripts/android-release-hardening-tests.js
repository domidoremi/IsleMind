const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  androidReleaseOptimizationGradleArgs,
  resolveAndroidReleaseOptimization,
} = require('./android-release-build-contract')
const {
  normalizeCertificateDigest,
  parseApkSignerOutput,
  validateAndroidReleaseSigningEvidence,
} = require('./android-release-signing-contract')
const { resolveReleaseApkPaths } = require('./release-apk-paths')

const root = path.resolve(__dirname, '..')

function signerOutput({ digest, subject = 'CN=IsleMind Release, O=IsleMind', verifies = true }) {
  return `${verifies ? 'Verifies\n' : ''}Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): false
Signer #1 certificate DN: ${subject}
Signer #1 certificate SHA-256 digest: ${digest}
`
}

function run() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-release-apks-'))
  try {
    const temporaryDist = path.join(temporaryRoot, 'dist-apk')
    fs.mkdirSync(temporaryDist, { recursive: true })
    fs.writeFileSync(path.join(temporaryDist, 'a.apk'), '')
    fs.writeFileSync(path.join(temporaryDist, 'b.apk'), '')
    fs.writeFileSync(path.join(temporaryDist, 'ignore.txt'), '')
    assert.equal(resolveReleaseApkPaths([], { projectRoot: temporaryRoot, defaultDir: temporaryDist }).length, 2)
    assert.equal(
      resolveReleaseApkPaths(['dist-apk/*.apk', 'dist-apk/a.apk'], { projectRoot: temporaryRoot, defaultDir: temporaryDist }).length,
      2,
      'release APK path expansion deduplicates explicit and glob inputs',
    )
  } finally {
    const temporaryBase = `${path.resolve(os.tmpdir())}${path.sep}`
    if (!path.resolve(temporaryRoot).startsWith(temporaryBase)) {
      throw new Error(`Refusing to remove unexpected release APK fixture directory: ${temporaryRoot}`)
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }

  assert.deepEqual(resolveAndroidReleaseOptimization({ buildType: 'release', optimizeRelease: false }).gradleArgs, [])
  assert.deepEqual(
    resolveAndroidReleaseOptimization({ buildType: 'release', optimizeRelease: true }).gradleArgs,
    [...androidReleaseOptimizationGradleArgs],
  )
  assert.throws(
    () => resolveAndroidReleaseOptimization({ buildType: 'debug', optimizeRelease: true }),
    /--optimize-release can only be used with --release/,
  )

  const releaseDigest = '11'.repeat(32)
  const debugDigest = '22'.repeat(32)
  const releaseEvidence = parseApkSignerOutput(signerOutput({ digest: releaseDigest }), 'release.apk')
  assert.deepEqual(
    validateAndroidReleaseSigningEvidence({ artifacts: [releaseEvidence], debugCertificateSha256: debugDigest }),
    [],
    'a verified v2 APK with a non-debug signer passes',
  )
  const debugEvidence = parseApkSignerOutput(signerOutput({
    digest: debugDigest.match(/../g).join(':'),
    subject: 'CN=Android Debug, OU=Android, O=Unknown',
  }), 'debug.apk')
  const debugIssues = validateAndroidReleaseSigningEvidence({ artifacts: [debugEvidence], debugCertificateSha256: debugDigest })
  assert.ok(debugIssues.some((issue) => issue.includes('Android debug certificate')))
  assert.equal(normalizeCertificateDigest(debugDigest.match(/../g).join(':')), debugDigest)

  const buildTools37Evidence = parseApkSignerOutput(`Verifies
Verified using v2 scheme (APK Signature Scheme v2): true
Number of signers: 1
V2 Signer: certificate DN: CN=IsleMind Release, O=IsleMind
V2 Signer: certificate SHA-256 digest: ${releaseDigest}
`, 'build-tools-37.apk')
  assert.equal(buildTools37Evidence.signers[0].sha256, releaseDigest, 'Build Tools 37 signer output is parsed')
  buildTools37Evidence.schemes = { v1: false, 'v3.2': true }
  assert.deepEqual(
    validateAndroidReleaseSigningEvidence({ artifacts: [buildTools37Evidence], debugCertificateSha256: debugDigest }),
    [],
    'a v3.2-only release signature satisfies the v2-or-newer contract',
  )

  const secondSigner = parseApkSignerOutput(signerOutput({ digest: '33'.repeat(32) }), 'other.apk')
  const mismatchIssues = validateAndroidReleaseSigningEvidence({
    artifacts: [releaseEvidence, secondSigner],
    debugCertificateSha256: debugDigest,
  })
  assert.ok(mismatchIssues.includes('Release APKs are not signed by one consistent certificate.'))

  const localBuildSource = fs.readFileSync(path.join(root, 'scripts', 'build-local-android-apk.js'), 'utf8')
  assert.ok(localBuildSource.includes("require('./android-release-build-contract')"))
  assert.ok(localBuildSource.includes('--optimize-release'))
  assert.ok(localBuildSource.includes('Local release APKs are QA artifacts signed with the Android debug certificate.'))
  for (const gradleArg of androidReleaseOptimizationGradleArgs) {
    assert.ok(localBuildSource.includes('releaseOptimization.gradleArgs'))
    assert.ok(gradleArg.includes('=true'))
  }
  assert.match(
    localBuildSource,
    /validate-android-16kb-apk\.js', '--strict', \.\.\.sixtyFourBitOutputs/,
    'every direct local release build runs strict 16 KB validation',
  )
  assert.match(
    localBuildSource,
    /function prepareAndroidProject\(env\) \{[\s\S]*?prebuild', '--platform', 'android'[\s\S]*?ensureAndroidLocalProperties\(\)/,
    'the shared Android preparation refreshes generated version metadata before Gradle runs',
  )
  assert.match(
    localBuildSource,
    /if \(args\.buildType === 'release'\) \{[\s\S]*?prepareAndroidProjectForRelease\(args\)[\s\S]*?\} else \{[\s\S]*?prepareAndroidProject\(androidBuildEnv\(\)\)/,
    'debug builds refresh the generated Android project instead of reusing stale ignored native files',
  )

  const configureSource = fs.readFileSync(path.join(root, 'scripts', 'configure-android-release.js'), 'utf8')
  for (const property of [
    'ISLEMIND_UPLOAD_STORE_FILE',
    'ISLEMIND_UPLOAD_STORE_PASSWORD',
    'ISLEMIND_UPLOAD_KEY_ALIAS',
    'ISLEMIND_UPLOAD_KEY_PASSWORD',
  ]) {
    assert.ok(configureSource.includes(`'${property}'`), `release signing requires ${property}`)
  }
  assert.ok(configureSource.includes('missingSigningProperties'))

  const workflowSource = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-android-apk.yml'), 'utf8')
  assert.ok(workflowSource.includes('bun run test:android-release-hardening'))
  assert.ok(workflowSource.includes('ORG_GRADLE_PROJECT_ISLEMIND_UPLOAD_STORE_PASSWORD'))
  assert.ok(workflowSource.includes('bun scripts/validate-android-release-signing.js dist-apk/*.apk'))
  assert.ok(workflowSource.includes('bun scripts/write-release-source-snapshots.js dist-apk/*.apk'))
  assert.ok(workflowSource.includes('validate-android-16kb-apk.js --strict'))
  assert.ok(workflowSource.includes('-PhermesEnabled=true'))
  for (const gradleArg of androidReleaseOptimizationGradleArgs) {
    assert.equal(
      workflowSource.includes(gradleArg),
      false,
      `publishing keeps ${gradleArg} disabled until exact-current device regression evidence passes`,
    )
  }
  assert.ok(workflowSource.includes('if: always()') && workflowSource.includes('rm -f android/app/islemind-release.keystore'))
  assert.doesNotMatch(workflowSource, />>\s*android\/gradle\.properties/)
  const jobHeader = workflowSource.slice(workflowSource.indexOf('jobs:'), workflowSource.indexOf('    steps:'))
  assert.doesNotMatch(jobHeader, /ANDROID_KEYSTORE_BASE64|ORG_GRADLE_PROJECT_ISLEMIND_UPLOAD_/, 'signing secrets are scoped to required steps')

  const freshnessContract = require('./release-freshness-contract')
  for (const releaseInput of [
    'scripts/android-release-build-contract.js',
    'scripts/android-release-signing-contract.js',
    'scripts/release-apk-paths.js',
    'scripts/validate-android-release-signing.js',
    'scripts/write-release-source-snapshots.js',
  ]) {
    assert.ok(freshnessContract.releaseBuildInputPaths.includes(releaseInput), `release freshness tracks ${releaseInput}`)
  }

  console.log('Android release hardening tests passed')
}

run()
