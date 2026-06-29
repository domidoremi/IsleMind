const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  RELEASE_READINESS_COMPATIBILITY_EVAL_SCHEMA,
  RELEASE_READINESS_COMPATIBILITY_FIXTURE_IDS,
  runReleaseReadinessCompatibilityEvaluation,
} = require('../src/services/releaseReadinessCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isReleaseReadinessCompatibilityHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  const hook = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2021,
      },
      fileName: filename,
    })
    module._compile(output.outputText, filename)
  }
  hook.isReleaseReadinessCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertReady(item) {
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready`)
  assert.equal(item.policy.sourceStabilityChecked, true, `${item.fixtureId} checks source stability`)
  assert.equal(item.policy.sourceSnapshotRequired, true, `${item.fixtureId} requires source snapshot`)
  assert.equal(item.policy.artifactPathResolved, true, `${item.fixtureId} resolves artifact path`)
  assert.equal(item.policy.artifactFreshnessChecked, true, `${item.fixtureId} checks artifact freshness`)
  assert.equal(item.policy.artifactFreshnessStatus, 'current', `${item.fixtureId} uses current artifact`)
  assert.equal(item.policy.releaseManifestParsed, true, `${item.fixtureId} parses release manifest`)
  assert.equal(item.policy.releaseManifestVersioned, true, `${item.fixtureId} versions release manifest`)
  assert.equal(item.policy.manifestUrlSafe, true, `${item.fixtureId} validates manifest URL`)
  assert.equal(item.policy.assetUrlSafe, true, `${item.fixtureId} validates asset URL`)
  assert.equal(item.policy.versionMatched, true, `${item.fixtureId} matches app version`)
  assert.equal(item.policy.packageMatched, true, `${item.fixtureId} matches package id`)
  assert.equal(item.policy.sha256Verified, true, `${item.fixtureId} verifies SHA256`)
  assert.equal(item.policy.sidecarSha256Verified, true, `${item.fixtureId} verifies sidecar SHA256`)
  assert.equal(item.policy.sizeVerified, true, `${item.fixtureId} verifies size`)
  assert.equal(item.policy.compatibility16kbValidated, true, `${item.fixtureId} validates 16KB compatibility`)
  assert.equal(item.policy.zipAlignmentVerified, true, `${item.fixtureId} verifies ZIP page alignment`)
  assert.equal(item.policy.elf64AlignmentVerified, true, `${item.fixtureId} verifies 64-bit ELF alignment`)
  assert.equal(item.policy.stagedApkCleanupRegistered, true, `${item.fixtureId} registers staged APK cleanup`)
  assert.equal(item.policy.cleanInstallProven, true, `${item.fixtureId} proves clean install`)
  assert.equal(item.policy.launchSmokePassed, true, `${item.fixtureId} proves launch smoke`)
  assert.equal(item.policy.fatalLogChecked, true, `${item.fixtureId} checks fatal logs`)
  assert.equal(item.policy.qaEvidencePath, true, `${item.fixtureId} writes QA evidence`)
  assert.equal(item.policy.smokeEvidencePresent, true, `${item.fixtureId} has smoke evidence`)
  assert.equal(item.policy.networkCallsAllowed, false, `${item.fixtureId} is local/offline`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no release-readiness failures`)
}

function assertBlocked(item, expectedCodes) {
  assert.equal(item.readiness, 'blocked', `${item.fixtureId} is blocked`)
  for (const code of expectedCodes) {
    assert.ok(item.failureCodes.includes(code), `${item.fixtureId} records ${code}`)
  }
}

function run() {
  assert.equal(RELEASE_READINESS_COMPATIBILITY_EVAL_SCHEMA, 'islemind.release-readiness-compatibility-eval.v1', 'release-readiness schema is versioned')
  assert.deepEqual(
    RELEASE_READINESS_COMPATIBILITY_FIXTURE_IDS,
    [
      'source-stability-window',
      'apk-artifact-freshness',
      'release-manifest-contract',
      'apk-url-safety',
      'apk-integrity-verification',
      'staged-apk-cleanup',
      'installer-handoff-evidence',
      'current-apk-smoke',
      'android-16kb-validation',
      'qa-evidence-retention',
      'blocked-stale-apk-artifact',
      'blocked-unverified-apk-artifact',
      'blocked-release-without-smoke-evidence',
    ],
    'release-readiness fixtures cover source, artifact, manifest, download, install, smoke, evidence, and blocked paths'
  )

  const evaluation = runReleaseReadinessCompatibilityEvaluation({ now: () => 2700000000000 })
  assert.equal(evaluation.schema, RELEASE_READINESS_COMPATIBILITY_EVAL_SCHEMA, 'evaluation carries schema')
  assert.equal(evaluation.diagnostics.length, RELEASE_READINESS_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `release-readiness gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  for (const surface of ['source', 'artifact', 'manifest', 'download', 'install', 'smoke', 'evidence']) {
    assert.ok(evaluation.qualityGate.requiredSurfaces.includes(surface), `quality gate tracks ${surface}`)
  }

  const stability = diagnostic(evaluation, 'source-stability-window')
  assertReady(stability)
  assert.equal(stability.surface, 'source', 'source stability is source-scoped')

  const freshness = diagnostic(evaluation, 'apk-artifact-freshness')
  assertReady(freshness)
  assert.equal(freshness.policy.artifactFreshnessStatus, 'current', 'APK freshness fixture requires current status')

  const manifest = diagnostic(evaluation, 'release-manifest-contract')
  assertReady(manifest)
  assert.equal(manifest.policy.releaseManifestParsed, true, 'manifest fixture parses release manifest')
  assert.equal(manifest.policy.versionMatched, true, 'manifest fixture matches version')

  const urlSafety = diagnostic(evaluation, 'apk-url-safety')
  assertReady(urlSafety)
  assert.equal(urlSafety.policy.manifestUrlSafe, true, 'manifest URL is safe')
  assert.equal(urlSafety.policy.assetUrlSafe, true, 'asset URL is safe')

  const integrity = diagnostic(evaluation, 'apk-integrity-verification')
  assertReady(integrity)
  assert.equal(integrity.policy.sha256Verified, true, 'integrity fixture verifies SHA256')
  assert.equal(integrity.policy.sidecarSha256Verified, true, 'integrity fixture verifies sidecar')

  const cleanup = diagnostic(evaluation, 'staged-apk-cleanup')
  assertReady(cleanup)
  assert.equal(cleanup.policy.stagedApkCleanupRegistered, true, 'staged APK cleanup is registered')

  const install = diagnostic(evaluation, 'installer-handoff-evidence')
  assertReady(install)
  assert.equal(install.policy.installHandoffVisible, true, 'installer handoff is visible')
  assert.equal(install.policy.cleanInstallProven, true, 'installer fixture proves clean install')

  const smoke = diagnostic(evaluation, 'current-apk-smoke')
  assertReady(smoke)
  assert.equal(smoke.policy.launchSmokePassed, true, 'current APK smoke launches')
  assert.equal(smoke.policy.fatalLogChecked, true, 'current APK smoke checks fatal logs')

  const compatibility16kb = diagnostic(evaluation, 'android-16kb-validation')
  assertReady(compatibility16kb)
  assert.equal(compatibility16kb.policy.zipAlignmentVerified, true, '16KB fixture verifies ZIP page alignment')
  assert.equal(compatibility16kb.policy.elf64AlignmentVerified, true, '16KB fixture verifies ELF alignment')

  const evidence = diagnostic(evaluation, 'qa-evidence-retention')
  assertReady(evidence)
  assert.equal(evidence.policy.qaEvidencePath, true, 'evidence fixture uses QA evidence path')
  assert.equal(evidence.policy.networkCallsAllowed, false, 'evidence fixture stays offline')

  assertBlocked(diagnostic(evaluation, 'blocked-stale-apk-artifact'), [
    'stale-artifact',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-unverified-apk-artifact'), [
    'missing-sha256',
    'missing-sidecar-sha256',
    'apk-size-not-verified',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-release-without-smoke-evidence'), [
    'missing-16kb-validation',
    'missing-zip-alignment',
    'missing-elf64-alignment',
    'missing-clean-install-proof',
    'missing-launch-proof',
    'missing-fatal-log-check',
    'missing-smoke-evidence',
    'release-without-smoke',
  ])

  assertSourceIntegration()

  console.log('Release readiness compatibility tests passed')
}

function assertSourceIntegration() {
  const packageSource = fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  assert.ok(packageSource.includes('release:source-stability'), 'package scripts expose release source stability')
  assert.ok(packageSource.includes('release:install-current-apk'), 'package scripts expose current release install')
  assert.ok(packageSource.includes('test:current-apk-smoke'), 'package scripts expose current APK smoke')
  assert.ok(packageSource.includes('apk:validate-16kb:strict'), 'package scripts expose strict 16KB validation')

  const freshnessSource = fs.readFileSync(path.join(root, 'scripts/release-freshness-contract.js'), 'utf8')
  assert.ok(freshnessSource.includes('collectReleaseSourceFreshness') && freshnessSource.includes('sourceSnapshotPath'), 'release freshness contract compares APK freshness and source snapshots')

  const validationSource = fs.readFileSync(path.join(root, 'scripts/release-validation-contract.js'), 'utf8')
  assert.ok(validationSource.includes('validateCurrentApkSmokeResult'), 'release validation contract validates current APK smoke')
  assert.ok(validationSource.includes('zipAlignmentOk') && validationSource.includes('elf64Ok'), 'release validation contract requires 16KB ZIP and ELF evidence')

  const smokeSource = fs.readFileSync(path.join(root, 'scripts/collect-current-apk-smoke.js'), 'utf8')
  assert.ok(smokeSource.includes('test-evidence') && smokeSource.includes('qa'), 'current APK smoke writes QA evidence')
  assert.ok(smokeSource.includes('fatalLog') && smokeSource.includes('validate16kb'), 'current APK smoke checks fatal logs and 16KB compatibility')

  const buildSource = fs.readFileSync(path.join(root, 'scripts/build-and-validate-local-android-apk.js'), 'utf8')
  assert.ok(buildSource.includes('build-local-android-apk.js') && buildSource.includes('validate-android-16kb-apk.js'), 'release build wrapper validates APK after build')

  const updatesSource = fs.readFileSync(path.join(root, 'src/services/appUpdates.ts'), 'utf8')
  assert.ok(updatesSource.includes('safeHttpUrl'), 'app update release URLs pass through URL safety')
  assert.ok(updatesSource.includes('verifyDownloadedApk'), 'app update downloads verify size and checksum')
  assert.ok(updatesSource.includes('markDownloadedApkForCleanup') && updatesSource.includes('discardDownloadedApk'), 'app update staged APK lifecycle has cleanup paths')
}

if (require.main === module) run()

module.exports = { run }
