const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

if (process.argv.includes('--focus=pager-transition')) {
  assertPagerReleaseSourceContract()
  console.log('Release pager transition source contract passed')
  process.exit(0)
}

const ts = require('typescript')
const originalLoad = Module._load
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  RELEASE_READINESS_COMPATIBILITY_EVAL_SCHEMA,
  RELEASE_READINESS_COMPATIBILITY_FIXTURE_IDS,
  runReleaseReadinessCompatibilityEvaluation,
} = require('../src/modules/diagnostics/testing/releaseReadinessCompatibilityEvaluation.ts')

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

function assertPagerReleaseSourceContract() {
  const homeRouteSource = fs.readFileSync(path.join(root, 'app/index.tsx'), 'utf8')
  const conversationsRouteSource = fs.readFileSync(path.join(root, 'app/conversations.tsx'), 'utf8')
  const settingsRouteSource = fs.readFileSync(path.join(root, 'app/settings/index.tsx'), 'utf8')
  const pagerSource = fs.readFileSync(path.join(root, 'src/components/main/MainPagerShell.tsx'), 'utf8')
  const collectorSource = fs.readFileSync(path.join(root, 'scripts/collect-navigation-android-smoke.js'), 'utf8')

  assert.match(homeRouteSource, /MainPagerShell initialPage="home"/, 'the / alias selects Home')
  assert.match(conversationsRouteSource, /MainPagerShell initialPage="history"/, 'the /conversations alias selects History')
  assert.match(settingsRouteSource, /MainPagerShell initialPage="settings"/, 'the /settings alias selects Settings')
  assert.match(pagerSource, /pages\.map\(\(item,\s*index\) => \([\s\S]*?<PagerPage[\s\S]*?key=\{item\.id\}[\s\S]*?active=\{item\.id === page\}[\s\S]*?pageIndex=\{index\}[\s\S]*?\{item\.node\}[\s\S]*?<\/PagerPage>/, 'all three route trees stay mounted across navigation')
  assert.doesNotMatch(pagerSource, /MainPagerExperience|ThemeNavigationDrawer|AppTopBar|shellNavigation/, 'the pager owns no global top bar, drawer, or hidden shell navigation authority')
  assert.match(pagerSource, /importantForAccessibility=\{active \? 'auto' : 'no-hide-descendants'\}[\s\S]*pointerEvents=\{active \? 'auto' : 'none'\}[\s\S]*opacity: active \? 1 : 0/, 'inactive routes remain mounted without intercepting input or accessibility')
  assert.doesNotMatch(pagerSource, /mountedPageChildren|transitionRequest|readinessToken|handlePagerPageReady|requestPagerPageChild|withTiming|withSpring|GestureDetector|Animated\.View/, 'route navigation avoids lazy mounting and animated native reparenting')
  assert.match(pagerSource, /styles\.opaqueFallback[\s\S]*colors\.background\.surfaceCanvas/, 'the route pager has an opaque fallback')
  assert.ok(collectorSource.includes("name: 'history-to-home'") && collectorSource.includes("name: 'settings-to-home'") && collectorSource.includes("name: 'nested-settings-to-home'"), 'collector covers every Home-return path')
  assert.match(collectorSource, /homeReturnRepeatCount = 2[\s\S]*for \(let cycle = 1; cycle <= homeReturnRepeatCount; cycle \+= 1\)/, 'collector repeats Home-return cycles')
  assert.match(collectorSource, /failedHomeReturns[\s\S]*!row\.sourceStable[\s\S]*!row\.tappedHome[\s\S]*!row\.homeStable[\s\S]*row\.siblingVisible[\s\S]*row\.errorVisible/, 'collector fails closed on incomplete returns')
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

async function run() {
  assertReleaseVersionMonotonicity()
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
  await assertMotionPreferenceRuntimeContract()

  console.log('Release readiness compatibility tests passed')
}

function assertReleaseVersionMonotonicity() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  const updateManifest = JSON.parse(fs.readFileSync(path.join(root, 'updates', 'android.json'), 'utf8'))
  const packageVersion = String(packageJson.version ?? '')
  const expoVersion = String(appJson?.expo?.version ?? '')
  const androidVersionCode = Number(appJson?.expo?.android?.versionCode)
  const publishedVersion = String(updateManifest.versionName ?? '')
  const publishedVersionCode = Number(updateManifest.versionCode)

  assert.equal(packageVersion, expoVersion, 'package and Expo versions remain synchronized')
  assert.ok(compareSemanticVersions(packageVersion, publishedVersion) > 0, 'candidate app version is newer than the published Android manifest')
  assert.ok(Number.isSafeInteger(androidVersionCode) && androidVersionCode > publishedVersionCode, 'candidate Android versionCode is newer than the published manifest')
}

function compareSemanticVersions(left, right) {
  const leftParts = String(left).replace(/^v/i, '').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const rightParts = String(right).replace(/^v/i, '').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function assertSourceIntegration() {
  const packageSource = fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  const packageConfig = JSON.parse(packageSource)
  const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  const configuredPlugins = appConfig.expo?.plugins ?? []
  const androidHardwareAccelerationPlugin = './plugins/android-hardware-acceleration/withAndroidHardwareAccelerationDisabled'
  assert.equal(
    configuredPlugins.some((entry) => entry === androidHardwareAccelerationPlugin || (Array.isArray(entry) && entry[0] === androidHardwareAccelerationPlugin)),
    false,
    'Android release config no longer registers the software-rendering compatibility plugin',
  )
  assert.equal(
    fs.existsSync(path.join(root, `${androidHardwareAccelerationPlugin}.js`)),
    false,
    'Android software-rendering compatibility plugin is deleted after the diagnostic experiment',
  )

  assert.equal(
    packageConfig.reanimated?.staticFeatureFlags?.ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS,
    true,
    'Android release config routes non-layout Reanimated updates through the supported synchronous UI-props path',
  )
  assert.equal(
    packageConfig.reanimated?.staticFeatureFlags?.DISABLE_COMMIT_PAUSING_MECHANISM,
    undefined,
    'Android release config does not expand the compatibility slice to Reanimated commit-pausing behavior',
  )

  const babelConfigPath = path.join(root, 'babel.config.js')
  const babelConfigSource = fs.readFileSync(babelConfigPath, 'utf8')
  assert.doesNotMatch(
    babelConfigSource,
    /react-native-(?:reanimated|worklets)\/plugin/,
    'Expo owns Worklets Babel plugin registration without an explicit duplicate compatibility alias',
  )
  const babelOptions = require('@babel/core').loadOptions({
    cwd: root,
    filename: path.join(root, 'app', 'index.tsx'),
    configFile: babelConfigPath,
  })
  const workletsPluginCount = babelOptions.plugins.filter((plugin) => /worklets/i.test(String(plugin.key))).length
  assert.equal(workletsPluginCount, 1, 'the effective release Babel pipeline applies the Worklets transform exactly once')

  assert.ok(packageSource.includes('release:source-stability'), 'package scripts expose release source stability')
  assert.ok(packageSource.includes('release:install-current-apk'), 'package scripts expose current release install')
  assert.ok(packageSource.includes('test:current-apk-smoke'), 'package scripts expose current APK smoke')
  assert.ok(packageSource.includes('apk:validate-16kb:strict'), 'package scripts expose strict 16KB validation')

  const freshnessContract = require(path.join(root, 'scripts/release-freshness-contract.js'))
  const artifactContract = require(path.join(root, 'scripts/release-artifact-contract.js'))
  assert.equal(artifactContract.resolveReleaseArchForAndroidAbi('arm64-v8a'), 'arm64-v8a', 'release artifact selection maps ARM64 devices to the ARM64 artifact')
  assert.equal(artifactContract.resolveReleaseArchForAndroidAbi('x86_64'), 'x86_64', 'release artifact selection maps x86_64 devices to the x86_64 artifact')
  assert.equal(artifactContract.resolveReleaseArchForAndroidAbi('armeabi-v7a'), 'armeabi-v7a-legacy', 'release artifact selection maps 32-bit ARM devices to the legacy artifact')
  assert.equal(artifactContract.resolveReleaseArchForAndroidAbi('unsupported'), null, 'release artifact selection fails closed for unsupported ABIs')
  assert.equal(
    artifactContract.formatApkArtifactName({ version: '0.0.13', arch: 'x86_64', variant: 'no-model' }),
    'IsleMind-0.0.13-x86_64-no-model.apk',
    'release artifact naming keeps the canonical Hermes artifact path unchanged',
  )
  const artifactContractSource = fs.readFileSync(path.join(root, 'scripts/release-artifact-contract.js'), 'utf8')
  assert.doesNotMatch(artifactContractSource, /runtimeCell|\bjsc\b/, 'release artifact naming does not claim an unsupported JSC runtime cell')
  const releaseInputs = new Set(freshnessContract.collectReleaseInputFiles(root).map((file) => path.relative(root, file).replace(/\\/g, '/')))
  const freshnessSource = fs.readFileSync(path.join(root, 'scripts/release-freshness-contract.js'), 'utf8')
  assert.ok(freshnessSource.includes('collectReleaseSourceFreshness') && freshnessSource.includes('sourceSnapshotPath'), 'release freshness contract compares APK freshness and source snapshots')
  assert.ok(releaseInputs.has('package.json') && releaseInputs.has('bun.lock'), 'release freshness tracks dependency and native feature-flag inputs')
  assert.ok(releaseInputs.has('babel.config.js') && releaseInputs.has('metro.config.js'), 'release freshness tracks JavaScript bundle configuration')
  assert.equal(releaseInputs.has('plugins/android-hardware-acceleration/withAndroidHardwareAccelerationDisabled.js'), false, 'release freshness no longer tracks the deleted software-rendering compatibility plugin')
  assert.ok(releaseInputs.has('plugins/android-status-notification/AndroidStatusNotificationModule.kt'), 'release freshness tracks Kotlin sources copied by Android config plugins')
  assert.ok(releaseInputs.has('scripts/build-local-android-apk.js') && releaseInputs.has('scripts/configure-android-release.js'), 'release freshness tracks the local Android build pipeline')

  const validationSource = fs.readFileSync(path.join(root, 'scripts/release-validation-contract.js'), 'utf8')
  assert.ok(validationSource.includes('validateCurrentApkSmokeResult'), 'release validation contract validates current APK smoke')
  assert.ok(validationSource.includes('zipAlignmentOk') && validationSource.includes('elf64Ok'), 'release validation contract requires 16KB ZIP and ELF evidence')
  const qaAuditSource = fs.readFileSync(path.join(root, 'scripts/qa-coverage-audit.js'), 'utf8')
  assert.ok(qaAuditSource.includes("runAdb(deviceSerial, ['pull'") && qaAuditSource.includes('hashInstalledBaseApk'), 'QA provenance pulls and hashes the installed base APK')
  assert.ok(qaAuditSource.includes('fs.rmSync(temporaryApkPath') && qaAuditSource.includes('finally'), 'QA provenance cleans the temporary installed APK after hashing')
  assert.ok(qaAuditSource.includes('Installed package SHA256') && qaAuditSource.includes('APK/device SHA256 parity'), 'QA provenance renders the installed digest and local/device parity')
  assert.ok(qaAuditSource.includes('collectFreshRouteSmokeIssues') && qaAuditSource.includes('collectSettingsBackResultIssues'), 'QA audit consumes strict route and Back validators')
  assert.ok(qaAuditSource.includes('collectFreshKeyboardSmokeIssues') && qaAuditSource.includes('collectPreferencePersistenceIssues'), 'QA audit consumes strict keyboard and preference validators')
  assert.ok(qaAuditSource.includes('collectThemeLocaleIssues') && qaAuditSource.includes('collectFontScaleIssues'), 'QA audit consumes strict theme/locale and font-scale validators')
  assert.ok(qaAuditSource.includes('validateMcpAndroidSmokeResult') && qaAuditSource.includes('validateMcpOnlineRequestRows'), 'QA audit consumes the MCP Android evidence contract')
  assert.ok(qaAuditSource.includes('validateMockProviderChatResult') && qaAuditSource.includes('mock-provider-chat-results.json'), 'QA audit requires the mock-provider Chat interaction result alongside the request log')
  assert.ok(qaAuditSource.includes('runMockProviderChatResultSelfTest') && qaAuditSource.includes('deleteConfirmVisible: false'), 'QA audit self-tests mock-provider interaction and same-run request binding failures')
  assert.ok(qaAuditSource.includes('collectProviderRuntimeCurrentArtifactIssues') && qaAuditSource.includes('Provider Runtime Android result predates the current APK artifact'), 'QA audit binds Provider Runtime evidence to the current APK artifact and install')
  assert.ok(qaAuditSource.includes('/provider-runtime.*import.*keyboard/') && qaAuditSource.includes('canonical paired Provider Runtime import-keyboard capture'), 'QA audit counts the canonical Provider Runtime keyboard pair with focused coverage')
  assert.ok(qaAuditSource.includes('collectProviderActivationCoverage') && qaAuditSource.includes('reject filename-only Provider activation evidence'), 'QA audit accepts Provider activation captures only from a passing current-artifact scenario')
  const providerRuntimeCollectorSource = fs.readFileSync(path.join(root, 'scripts/collect-provider-runtime-android.js'), 'utf8')
  assert.ok(providerRuntimeCollectorSource.includes('hasEnabledClickableExactLabel') && providerRuntimeCollectorSource.includes("['导入', 'Import']"), 'Provider Runtime keyboard evidence requires an enabled exact Import action')
  assert.ok(providerRuntimeCollectorSource.includes("scenarioRecord('provider-activation'") && providerRuntimeCollectorSource.includes('hasProviderActivationProgressEvidence') && providerRuntimeCollectorSource.includes('hasProviderActivationResultEvidence'), 'Provider Runtime collector proves app-owned activation progress and result semantics')
  assert.ok(providerRuntimeCollectorSource.includes("request.url === '/v1/models'") && providerRuntimeCollectorSource.includes('modelsDelayMs'), 'Provider Runtime collector holds activation progress open with a deterministic delayed model response')
  assert.ok(providerRuntimeCollectorSource.includes('waitForUiaText') && providerRuntimeCollectorSource.includes('captureStepUiaFirst'), 'Provider Runtime collector admits activation semantics before taking canonical paired captures')
  assert.ok(providerRuntimeCollectorSource.includes('modelsDelayMs: options.modelsDelayMs ?? 6500'), 'Provider Runtime collector holds progress within the production single-provider timeout')
  const providerRuntimeContractSource = fs.readFileSync(path.join(root, 'scripts/provider-runtime-android-contract.js'), 'utf8')
  assert.ok(providerRuntimeContractSource.includes("'provider-activation'") && providerRuntimeContractSource.includes('validateProviderRuntimeActivationEvidence'), 'Provider Runtime contract requires canonical activation evidence')
  const navigationCollectorSource = fs.readFileSync(path.join(root, 'scripts/collect-navigation-android-smoke.js'), 'utf8')
  assert.ok(navigationCollectorSource.includes('siblingVisible') && navigationCollectorSource.includes('stableCaptureCount'), 'navigation evidence records sibling rejection and stable captures')
  assert.ok(navigationCollectorSource.includes('runHomeReturnSmoke') && navigationCollectorSource.includes('home-return-results.json'), 'navigation evidence writes a dedicated Home-return result')
  assert.ok(navigationCollectorSource.includes("name: 'history-to-home'") && navigationCollectorSource.includes("name: 'settings-to-home'") && navigationCollectorSource.includes("name: 'nested-settings-to-home'"), 'navigation evidence covers History, Settings, and nested Settings returns')
  assert.match(navigationCollectorSource, /homeReturnRepeatCount = 2[\s\S]*for \(let cycle = 1; cycle <= homeReturnRepeatCount; cycle \+= 1\)/, 'navigation evidence repeats every Home-return cycle')
  assert.match(navigationCollectorSource, /failedHomeReturns[\s\S]*!row\.sourceStable[\s\S]*!row\.tappedHome[\s\S]*!row\.homeStable[\s\S]*row\.siblingVisible[\s\S]*row\.errorVisible/, 'navigation evidence fails closed on incomplete or stale Home returns')
  assert.doesNotMatch(navigationCollectorSource, /providers-back-fixed-results|writeProviderBackResult/, 'navigation collector does not maintain the redundant provider Back projection')
  const settingsCollectorSource = fs.readFileSync(path.join(root, 'scripts/collect-settings-state-android.js'), 'utf8')
  assert.ok(settingsCollectorSource.includes('restoredFontScale') && settingsCollectorSource.includes('home-restore-system'), 'settings evidence proves font restoration and the restored Home surface')
  assert.ok(settingsCollectorSource.includes('checkable') && settingsCollectorSource.includes('afterRestartState'), 'settings evidence records exact preference checked states')
  assert.ok(settingsCollectorSource.includes('if (restartToggle)') && settingsCollectorSource.includes('if (restoreTapped)'), 'settings evidence attempts preference restoration after partial persistence observation')
  assert.ok(settingsCollectorSource.includes('stagingPath') && settingsCollectorSource.includes('fs.copyFileSync(stagingPath, localPath)'), 'settings captures publish only a fresh staged adb pull')
  assert.ok(settingsCollectorSource.includes('box.right <= box.left') && settingsCollectorSource.includes('box.bottom <= box.top'), 'settings interactions reject zero-area accessibility bounds')
  assert.ok(
    ['appearance-minimal-light', 'appearance-lime-road-dark', 'appearance-markdown-light', 'appearance-markdown-dark-custom-indigo']
      .every((step) => settingsCollectorSource.includes(step)),
    'settings native evidence retains the representative Minimalist, Lime Road, Markdown, light/dark, and custom-accent matrix',
  )
  assert.ok(settingsCollectorSource.includes("custom: '#4455B7'") && settingsCollectorSource.includes('collectThemeLocaleContractIssues'), 'settings native evidence validates the exact custom accent and fails closed on incomplete Appearance rows')
  const settingsCollector = require(path.join(root, 'scripts/collect-settings-state-android.js'))
  assert.equal(
    settingsCollector.isSettingsRoot('<node text="Common" content-desc="" long-clickable="false" enabled="true" bounds="[0,0][10,10]" />'),
    true,
    'settings root detection does not treat the long-clickable XML attribute as a visible Back label',
  )
  assert.equal(
    settingsCollector.isSettingsRoot('<node text="Common" content-desc="" enabled="true" bounds="[0,0][10,10]" /><node text="Back" content-desc="" enabled="true" bounds="[0,10][10,20]" />'),
    false,
    'settings root detection still rejects a visible Back label',
  )
  const mcpCollectorSource = fs.readFileSync(path.join(root, 'scripts/collect-mcp-android-smoke.js'), 'utf8')
  assert.ok(mcpCollectorSource.includes('mcpAndroidSmokeSchema') && mcpCollectorSource.includes('runToken') && mcpCollectorSource.includes('responsePayload'), 'MCP evidence records a correlated schema, run token, and response payloads')
  assert.ok(mcpCollectorSource.includes('stagingPath') && mcpCollectorSource.includes('fs.copyFileSync(stagingPath, localPath)'), 'MCP captures publish only a fresh staged adb pull')
  assert.ok(mcpCollectorSource.includes('usableEditableCount') && mcpCollectorSource.includes('waitForUsableEditables') && mcpCollectorSource.includes('if (!anchorBounds) return false'), 'MCP evidence opens the add form and refuses unscoped actions')
  const mcpCollector = require(path.join(root, 'scripts/collect-mcp-android-smoke.js'))
  assert.equal(mcpCollector.isUsableBounds('[0,0][0,0]'), false, 'MCP interactions reject zero-area accessibility bounds')
  assert.equal(mcpCollector.isUsableBounds('[1,2][10,12]'), true, 'MCP interactions accept positive accessibility bounds')
  assert.equal(mcpCollector.hasUsableText('<node text="QA server" content-desc="" enabled="true" bounds="[0,0][0,0]" />', ['QA server']), false, 'MCP route search rejects zero-area server labels')
  assert.equal(mcpCollector.hasUsableText('<node text="QA server" content-desc="" enabled="true" bounds="[1,2][10,12]" />', ['QA server']), true, 'MCP route search accepts visible server labels')
  assert.doesNotMatch(mcpCollectorSource, /function isMcpResultPassing\(/, 'MCP collector does not retain the vacuous result predicate')
  const keyVisualCollectorSource = fs.readFileSync(path.join(root, 'scripts/collect-key-visual-gaps-android.js'), 'utf8')
  assert.ok(keyVisualCollectorSource.includes('captureFreshFile') && keyVisualCollectorSource.includes('fs.copyFileSync(stagingPath, localPath)'), 'key visual captures publish only a fresh staged adb pull')
  assert.match(keyVisualCollectorSource, /const uniqueName = `\$\{name\}-\$\{process\.pid\}-\$\{Date\.now\(\)\}`[\s\S]*?cleanupRemoteFiles\(device, \[remotePng, remoteUia\]\)/, 'key visual captures use unique remote paths and one paired cleanup after both staged pulls')
  assert.match(keyVisualCollectorSource, /function cleanupRemoteFiles[\s\S]*?timeoutMs: 5000/, 'key visual remote cleanup is bounded independently from evidence capture')
  assert.doesNotMatch(keyVisualCollectorSource, /sanitizePersistedTextEvidence/, 'key visual captures do not normalize or rewrite raw UIA evidence')
  const keyVisualCollector = require(path.join(root, 'scripts/collect-key-visual-gaps-android.js'))
  assert.equal(keyVisualCollector.resolveExecutableCommand('adb', 'win32'), 'adb.exe', 'Windows key visual collection owns the direct adb executable process so timeout cleanup cannot orphan cmd children')
  assert.equal(keyVisualCollector.resolveExecutableCommand('adb', 'linux'), 'adb', 'non-Windows key visual collection retains the native adb command')
  assert.deepEqual(
    keyVisualCollector.parseCollectorOptions(['--scope', 'knowledge-memory'], { captureDestructiveDialogs: false }),
    { scope: 'knowledge-memory', captureDestructiveDialogs: true },
    'Knowledge/Memory scope always captures destructive dialogs for non-confirming evidence',
  )
  assert.deepEqual(
    keyVisualCollector.parseCollectorOptions(['--scope=session-options'], { captureDestructiveDialogs: false }),
    { scope: 'session-options', captureDestructiveDialogs: false },
    'session-options scope refreshes only direct Chat overlay evidence without destructive dialogs',
  )
  assert.deepEqual(
    keyVisualCollector.parseCollectorOptions([], { captureDestructiveDialogs: false }),
    { scope: null, captureDestructiveDialogs: false },
    'key visual collection remains full by default',
  )
  assert.throws(() => keyVisualCollector.parseCollectorOptions(['--scope']), /requires a value/, 'key visual collection rejects a missing scope value')
  assert.throws(() => keyVisualCollector.parseCollectorOptions(['--scope=unknown']), /Unsupported/, 'key visual collection rejects an unknown scope')
  const knowledgeMemoryScopeBranch = keyVisualCollectorSource.match(/if \(options\.scope === knowledgeMemoryScope\) \{([\s\S]*?)\} else \{/)
  assert.ok(knowledgeMemoryScopeBranch, 'key visual collection has an explicit Knowledge/Memory scope branch')
  assert.match(knowledgeMemoryScopeBranch[1], /captureKnowledgeKeyboard[\s\S]*captureSettingsContextSelfTest[\s\S]*captureKnowledgeMemoryDialogs/, 'Knowledge/Memory scope runs the three intended capture flows')
  assert.doesNotMatch(knowledgeMemoryScopeBranch[1], /captureAppShellStates|captureCleanBaselines|captureRouteAndHomeOverlays/, 'Knowledge/Memory scope does not run unrelated app-shell, baseline, or Chat-overlay probes')
  assert.match(keyVisualCollectorSource, /readRequiredExistingResult\(\)/, 'Knowledge/Memory scope requires the existing global result before collection')
  assert.match(keyVisualCollectorSource, /else if \(options\.scope === sessionOptionsScope\) \{[\s\S]*?captureHomeSessionOptions\(device, result\)/, 'session-options scope runs only the direct Chat overlay capture flow')
  assert.match(
    keyVisualCollectorSource,
    /captureAndAssertStable\(device, result, 'knowledge-delete-start'[\s\S]*?captureAndAssertStable\(device, result, 'knowledge-clear-confirm'[\s\S]*?captureAndAssertStable\(device, result, 'memory-delete-start'[\s\S]*?captureAndAssertStable\(device, result, 'memory-clear-confirm'/,
    'destructive Knowledge/Memory evidence waits for stable paired entry and dialog states after deep-link navigation',
  )

  const unrelatedInvalidCapture = {
    name: 'app-shell-error-boundary',
    png: 'test-evidence/qa/key-visual-gaps/app-shell-error-boundary.png',
    uia: 'test-evidence/qa/key-visual-gaps/app-shell-error-boundary.uia.xml',
    packageName: 'com.miui.newhome',
    semanticPassed: false,
    semanticIssues: ['app-shell-error-boundary captured a foreign package.'],
  }
  const previousKeyVisualResult = {
    generatedAt: '2026-07-19T00:00:00.000Z',
    device: 'previous-device',
    packageName: 'com.islemind.app',
    options: { captureDestructiveDialogs: false },
    captures: [
      unrelatedInvalidCapture,
      {
        name: 'settings-context-selftest-dialog',
        png: 'test-evidence/qa/key-visual-gaps/settings-context-selftest-dialog.png',
        uia: 'test-evidence/qa/key-visual-gaps/settings-context-selftest-dialog.uia.xml',
        packageName: 'com.islemind.app',
        semanticPassed: true,
      },
    ],
    errors: ['app-shell-error-boundary captured a foreign package.'],
    passed: false,
  }
  const scopedKeyVisualResult = keyVisualCollector.createKnowledgeMemoryScopedResult(previousKeyVisualResult, {
    generatedAt: '2026-07-20T00:00:00.000Z',
    device: 'emulator-5554',
    packageName: 'com.islemind.app',
    options: { scope: 'knowledge-memory', captureDestructiveDialogs: true },
  })
  assert.equal(keyVisualCollector.hasGlobalCaptureBaseline(previousKeyVisualResult), true, 'Knowledge/Memory scope recognizes an aggregate result with unrelated global captures')
  assert.equal(
    keyVisualCollector.hasGlobalCaptureBaseline({ captures: previousKeyVisualResult.captures.filter((capture) => keyVisualCollector.isKnowledgeMemoryScopeCaptureName(capture.name)) }),
    false,
    'Knowledge/Memory scope rejects a scope-only capture set as a global baseline',
  )
  assert.throws(
    () => keyVisualCollector.createKnowledgeMemoryScopedResult({ ...previousKeyVisualResult, captures: previousKeyVisualResult.captures.filter((capture) => keyVisualCollector.isKnowledgeMemoryScopeCaptureName(capture.name)) }, {
      generatedAt: '2026-07-20T00:00:00.000Z',
      device: 'emulator-5554',
      packageName: 'com.islemind.app',
      options: { scope: 'knowledge-memory', captureDestructiveDialogs: true },
    }),
    /global capture baseline/,
    'Knowledge/Memory scope refuses to overwrite a result that contains only prior scope-owned captures',
  )
  assert.deepEqual(scopedKeyVisualResult.captures.find((capture) => capture.name === unrelatedInvalidCapture.name), unrelatedInvalidCapture, 'Knowledge/Memory scope preserves unrelated invalid capture records verbatim')
  assert.deepEqual(scopedKeyVisualResult.errors, [], 'Knowledge/Memory scope does not inherit unrelated previous errors into scoped pass/fail')
  assert.deepEqual(scopedKeyVisualResult.retainedErrors, previousKeyVisualResult.errors, 'Knowledge/Memory scope retains previous errors in explicit non-gating diagnostics')
  const staleContextCapture = scopedKeyVisualResult.captures.find((capture) => capture.name === 'settings-context-selftest-dialog')
  assert.equal(staleContextCapture?.semanticPassed, false, 'Knowledge/Memory scope invalidates a prior scope-owned capture before refreshing it')
  assert.ok(staleContextCapture?.semanticIssues?.some((issue) => issue.includes('stale until replaced')), 'Knowledge/Memory scope records why prior scope evidence is invalid')
  assert.ok(
    keyVisualCollector.knowledgeMemoryRequiredCaptureNames.every((name) => scopedKeyVisualResult.captures.some((capture) => capture.name === name && capture.semanticPassed === false)),
    'Knowledge/Memory scope seeds every required capture as invalid until fresh replacement',
  )
  const freshRequiredCaptures = scopedKeyVisualResult.captures.map((capture) => (
    keyVisualCollector.knowledgeMemoryRequiredCaptureNames.includes(capture.name)
      ? {
          name: capture.name,
          png: `test-evidence/qa/key-visual-gaps/${capture.name}.png`,
          uia: `test-evidence/qa/key-visual-gaps/${capture.name}.uia.xml`,
          packageName: 'com.islemind.app',
          visibleText: [],
          semanticPassed: true,
        }
      : capture
  ))
  const passingScopedKeyVisualResult = keyVisualCollector.finalizeKnowledgeMemoryScopedResult({
    ...scopedKeyVisualResult,
    captures: freshRequiredCaptures,
  })
  assert.equal(passingScopedKeyVisualResult.passed, true, 'fresh paired passing Knowledge/Memory captures pass independently of unrelated invalid records')
  assert.deepEqual(passingScopedKeyVisualResult.errors, [], 'unrelated prior errors remain excluded from a passing scoped result')
  assert.equal(passingScopedKeyVisualResult.captures.find((capture) => capture.name === unrelatedInvalidCapture.name)?.semanticPassed, false, 'a passing scoped result still retains unrelated semantic-invalid evidence')
  const foreignScopedKeyVisualResult = keyVisualCollector.finalizeKnowledgeMemoryScopedResult({
    ...passingScopedKeyVisualResult,
    captures: passingScopedKeyVisualResult.captures.map((capture) => (
      capture.name === 'memory-clear-confirm' ? { ...capture, packageName: 'com.miui.newhome' } : capture
    )),
    errors: [],
  })
  assert.equal(foreignScopedKeyVisualResult.passed, false, 'Knowledge/Memory completeness rejects a required capture from another foreground package')
  assert.equal(foreignScopedKeyVisualResult.captures.find((capture) => capture.name === 'memory-clear-confirm')?.semanticPassed, false, 'foreign-package completeness failure marks the capture semantically invalid')
  const unpairedScopedKeyVisualResult = keyVisualCollector.finalizeKnowledgeMemoryScopedResult({
    ...passingScopedKeyVisualResult,
    captures: passingScopedKeyVisualResult.captures.map((capture) => (
      capture.name === 'knowledge-clear-confirm' ? { ...capture, uia: null } : capture
    )),
    errors: [],
  })
  assert.equal(unpairedScopedKeyVisualResult.passed, false, 'Knowledge/Memory completeness rejects an unpaired required capture')

  const previousSessionOptionsResult = {
    ...previousKeyVisualResult,
    captures: [
      unrelatedInvalidCapture,
      ...keyVisualCollector.sessionOptionsRequiredCaptureNames.map((name) => ({
        name,
        png: `test-evidence/qa/key-visual-gaps/${name}.png`,
        uia: `test-evidence/qa/key-visual-gaps/${name}.uia.xml`,
        packageName: 'com.islemind.app',
        semanticPassed: true,
      })),
    ],
    errors: ['home-session-options-panel Chat header AI configuration trigger is unavailable on the direct Chat route.'],
  }
  const scopedSessionOptionsResult = keyVisualCollector.createSessionOptionsScopedResult(previousSessionOptionsResult, {
    generatedAt: '2026-07-21T00:00:00.000Z',
    device: 'emulator-5554',
    packageName: 'com.islemind.app',
    options: { scope: 'session-options', captureDestructiveDialogs: false },
  })
  assert.equal(scopedSessionOptionsResult.captures.find((capture) => capture.name === unrelatedInvalidCapture.name)?.semanticPassed, false, 'session-options scope preserves unrelated capture evidence')
  assert.ok(
    keyVisualCollector.sessionOptionsRequiredCaptureNames.every((name) => scopedSessionOptionsResult.captures.some((capture) => capture.name === name && capture.semanticPassed === false)),
    'session-options scope invalidates every owned capture until it is freshly replaced',
  )
  const passingSessionOptionsResult = keyVisualCollector.finalizeSessionOptionsScopedResult({
    ...scopedSessionOptionsResult,
    captures: scopedSessionOptionsResult.captures.map((capture) => (
      keyVisualCollector.sessionOptionsRequiredCaptureNames.includes(capture.name)
        ? { ...capture, packageName: 'com.islemind.app', semanticPassed: true, semanticIssues: [] }
        : capture
    )),
  })
  assert.equal(passingSessionOptionsResult.passed, true, 'fresh paired app-owned session-options captures close the scoped result')
  const chatHeaderAiFixture = '<node text="" content-desc="Switch model" clickable="true" enabled="true" bounds="[110,62][820,168]" />' +
    '<node text="" content-desc="Settings" clickable="true" enabled="true" bounds="[920,62][1020,168]" />'
  assert.equal(keyVisualCollector.findChatAiConfigurationTriggerNode(chatHeaderAiFixture)?.contentDesc, 'Switch model', 'session-options evidence selects the visible Chat header AI configuration trigger')

  const appOwnedCaptureFixture = '<node package="com.islemind.app" text="会话消息列表" content-desc="输入消息" enabled="true" bounds="[1,1][20,20]" />'
  assert.equal(keyVisualCollector.readCapturePackage(appOwnedCaptureFixture), 'com.islemind.app', 'key visual evidence records the foreground package from UIA')
  assert.deepEqual(
    keyVisualCollector.assertCaptureText('app-owned-capture', appOwnedCaptureFixture, {
      packageName: 'com.islemind.app',
      includeAny: [['会话消息列表'], ['输入消息']],
    }),
    [],
    'key visual evidence accepts an app-owned state-neutral route capture',
  )
  assert.ok(
    keyVisualCollector.assertCaptureText('wrong-package-capture', '<node package="com.miui.newhome" text="首页" content-desc="" enabled="true" bounds="[1,1][20,20]" />', { packageName: 'com.islemind.app' })
      .some((issue) => issue.includes('captured package')),
    'key visual evidence rejects a capture from another foreground package',
  )
  const scopedAssertion = keyVisualCollector.resolveCaptureAssertion(
    { options: { scope: 'knowledge-memory' } },
    { includeAny: [['确认清空？', 'Clear everything?', '消去しますか？']] },
  )
  assert.equal(scopedAssertion.packageName, 'com.islemind.app', 'Knowledge/Memory scope automatically requires the release application package for semantic assertions')
  assert.ok(
    keyVisualCollector.assertCaptureText(
      'foreign-scoped-dialog',
      '<node package="com.miui.newhome" text="Clear everything?" content-desc="" enabled="true" bounds="[1,1][20,20]" />',
      scopedAssertion,
    ).some((issue) => issue.includes('captured package')),
    'Knowledge/Memory scoped assertions reject foreign foreground dialogs',
  )
  const destructiveClearFixture =
    '<node package="com.islemind.app" text="3 knowledge files" content-desc="" clickable="false" enabled="true" bounds="[1,1][200,40]" />' +
    '<node package="com.islemind.app" text="" content-desc="Clear 3 knowledge files" clickable="true" enabled="true" bounds="[210,1][254,45]" />' +
    '<node package="com.islemind.app" text="" content-desc="Clear filters" clickable="true" enabled="true" bounds="[1,50][120,94]" />'
  assert.equal(keyVisualCollector.findDestructiveClearNode(destructiveClearFixture, 'knowledge')?.contentDesc, 'Clear 3 knowledge files', 'Knowledge evidence selects the exact collection-clear control instead of a generic knowledge or filter control')
  assert.equal(keyVisualCollector.findDestructiveClearNode(destructiveClearFixture, 'memory'), null, 'Knowledge evidence cannot be reused as a memory clear control')
  assert.match(keyVisualCollectorSource, /knowledge-clear-confirm[\s\S]*?back\(device\)[\s\S]*?memory-clear-confirm[\s\S]*?back\(device\)/, 'destructive Knowledge/Memory evidence dismisses each confirmation with Android Back without confirming deletion')
  assert.doesNotMatch(keyVisualCollectorSource, /还没有历史|还没有消息|No history yet|请先添加并启用一个服务商/, 'key visual route checks do not require empty-state or unconfigured-provider copy')
  assert.match(keyVisualCollectorSource, /'-p', appPackageName/, 'key visual deep links target the application package explicitly')
  assert.match(
    keyVisualCollectorSource,
    /openColdRoute\(device, 'islemind:\/\/chat\/qa-mock-provider-live'\)[\s\S]*?home-session-options-start[\s\S]*?findChatAiConfigurationTriggerNode[\s\S]*?home-session-options-panel/,
    'key visual top-session evidence uses the seeded direct Chat route and opens its Chat header AI configuration action',
  )
  assert.match(keyVisualCollectorSource, /'-S'[\s\S]*?`\$\{appPackageName\}\/\.MainActivity`[\s\S]*?'android.intent.category.BROWSABLE'/, 'key visual direct Chat evidence performs an explicit browsable cold start')
  const directChatRouteFixture = '<node package="com.islemind.app" text="" content-desc="会话消息列表, 共 1 条消息" enabled="true" bounds="[0,200][1080,1900]" />'
  const directChatRouteAssertion = {
    packageName: 'com.islemind.app',
    includeAny: [['会话消息列表', 'Conversation message list', '会話メッセージ一覧']],
    excludeAny: [['Tavern'], ['Agent'], ['会话不可用', 'Chat unavailable', 'チャットを利用できません']],
  }
  assert.deepEqual(keyVisualCollector.assertCaptureText('direct-chat-route', directChatRouteFixture, directChatRouteAssertion), [], 'key visual evidence accepts the non-shell direct Chat route')
  assert.ok(
    keyVisualCollector.assertCaptureText('shell-chat-route', `${directChatRouteFixture}<node package="com.islemind.app" text="Tavern" content-desc="Tavern" enabled="true" bounds="[100,100][200,150]" />`, directChatRouteAssertion)
      .some((issue) => issue.includes('excluded marker')),
    'key visual evidence rejects the shell Home as top-session proof',
  )
  const homeModelTriggerFixture =
    '<node text="模型" content-desc="" clickable="false" enabled="true" bounds="[80,1288][150,1330]" />' +
    '<node text="Islemind Mock Chat" content-desc="" clickable="false" enabled="true" bounds="[154,1288][348,1330]" />' +
    '<node text="" content-desc="模型: Islemind Mock Chat" clickable="true" enabled="true" bounds="[62,1280][368,1401]" />'
  assert.equal(
    keyVisualCollector.findHomeModelTriggerNode(homeModelTriggerFixture)?.contentDesc,
    '模型: Islemind Mock Chat',
    'legacy evidence helper still recognizes the clickable model trigger shape',
  )
  assert.equal(
    keyVisualCollector.findHomeModelTriggerNode('<node text="模型" content-desc="" clickable="true" enabled="true" bounds="[0,0][0,0]" />'),
    null,
    'key visual evidence rejects an off-viewport model trigger',
  )
  assert.match(
    keyVisualCollectorSource,
    /findHomeModelTriggerNode\(toolsPanel\.uiaText\)[\s\S]*?home-bottom-model-panel[\s\S]*?Providers[\s\S]*?home-more-panel-reopen-start[\s\S]*?home-more-panel/,
    'legacy tools-panel evidence reaches the same AI configuration sheet and captures More separately',
  )
  const contextCapabilityFixture =
    '<node text="" class="android.widget.Switch" content-desc="长期记忆. 默认关闭" checkable="true" checked="false" clickable="true" enabled="true" bounds="[62,400][1019,565]" />' +
    '<node text="" class="android.widget.Switch" content-desc="Local knowledge. Enabled" checkable="true" checked="true" clickable="true" enabled="true" bounds="[62,590][1019,755]" />'
  assert.equal(keyVisualCollector.readContextCapabilityState(contextCapabilityFixture, 'memoryEnabled'), false, 'Context evidence reads a disabled memory switch without conflating absence with false')
  assert.equal(keyVisualCollector.readContextCapabilityState(contextCapabilityFixture, 'knowledgeEnabled'), true, 'Context evidence reads an enabled knowledge switch across locales')
  assert.equal(
    keyVisualCollector.findContextCapabilityToggleNode('<node text="" class="android.widget.Switch" content-desc="長期メモリ" checkable="true" checked="false" clickable="true" enabled="true" bounds="[0,0][0,0]" />', 'memoryEnabled'),
    null,
    'Context evidence rejects an off-viewport capability switch',
  )
  const contextConfigurationPlan = keyVisualCollector.createContextSelfTestConfigurationPlan({ memoryEnabled: false, knowledgeEnabled: false, ragMode: 'off' })
  assert.deepEqual(
    contextConfigurationPlan.apply,
    [
      { key: 'memoryEnabled', value: true },
      { key: 'knowledgeEnabled', value: true },
      { key: 'ragMode', value: 'hybrid' },
    ],
    'Context evidence enables every required self-test capability',
  )
  assert.deepEqual(
    contextConfigurationPlan.restore,
    [
      { key: 'ragMode', value: 'off' },
      { key: 'knowledgeEnabled', value: false },
      { key: 'memoryEnabled', value: false },
    ],
    'Context evidence restores the exact original configuration in reverse mutation order',
  )
  assert.deepEqual(
    keyVisualCollector.createContextSelfTestConfigurationPlan({ memoryEnabled: true, knowledgeEnabled: true, ragMode: 'hybrid' }).apply,
    [],
    'Context evidence does not mutate an already-valid self-test configuration',
  )
  assert.deepEqual(
    keyVisualCollector.createContextSelfTestRestorationPlan(
      { memoryEnabled: true, knowledgeEnabled: true, ragMode: 'hybrid' },
      { memoryEnabled: false, knowledgeEnabled: true, ragMode: 'off' },
    ),
    [
      { key: 'ragMode', value: 'hybrid' },
      { key: 'memoryEnabled', value: true },
    ],
    'Context evidence restores unexpected drift even when the original configuration required no setup mutation',
  )
  assert.deepEqual(
    keyVisualCollector.createContextSelfTestRestorationPlan(
      { memoryEnabled: false, knowledgeEnabled: false, ragMode: 'off' },
      { memoryEnabled: null, knowledgeEnabled: true, ragMode: null },
    ),
    [
      { key: 'ragMode', value: 'off' },
      { key: 'knowledgeEnabled', value: false },
      { key: 'memoryEnabled', value: false },
    ],
    'Context evidence still attempts every affected restoration when a post-test control is temporarily unreadable',
  )
  const originalContextConfiguration = { memoryEnabled: false, knowledgeEnabled: false, ragMode: 'off' }
  const restorePhases = []
  const appliedRestorations = []
  const successfulRestoreObservations = [
    { memoryEnabled: true, knowledgeEnabled: true, ragMode: 'hybrid' },
    { memoryEnabled: false, knowledgeEnabled: false, ragMode: 'off' },
  ]
  const successfulRestore = keyVisualCollector.restoreContextSelfTestConfigurationWithCallbacks(originalContextConfiguration, {
    observe(phase) {
      restorePhases.push(phase)
      return successfulRestoreObservations.shift()
    },
    apply(operation) {
      appliedRestorations.push(operation)
      return operation.value
    },
  })
  assert.deepEqual(restorePhases, ['restore-before', 'restore-after'], 'Context evidence re-observes every configuration control after restoration settles')
  assert.deepEqual(appliedRestorations, [
    { key: 'ragMode', value: 'off' },
    { key: 'knowledgeEnabled', value: false },
    { key: 'memoryEnabled', value: false },
  ], 'Context evidence attempts each planned restoration before its final observation')
  assert.deepEqual(successfulRestore.finalState, originalContextConfiguration, 'Context evidence records the final observed original configuration')
  assert.equal(successfulRestore.ok, true, 'Context evidence accepts a final observation that exactly matches the original configuration')
  const delayedDriftRestore = keyVisualCollector.restoreContextSelfTestConfigurationWithCallbacks(originalContextConfiguration, {
    observe(phase) {
      return phase === 'restore-before'
        ? { memoryEnabled: true, knowledgeEnabled: true, ragMode: 'hybrid' }
        : { memoryEnabled: false, knowledgeEnabled: true, ragMode: 'off' }
    },
    apply() {
      return true
    },
  })
  assert.equal(delayedDriftRestore.ok, false, 'Context evidence fails closed when a control drifts after restoration setters report success')
  assert.deepEqual(delayedDriftRestore.finalState, { memoryEnabled: false, knowledgeEnabled: true, ragMode: 'off' }, 'Context evidence retains the mismatched final observation for diagnosis')
  assert.equal(keyVisualCollector.createContextSelfTestConfigurationPlan({ memoryEnabled: null, knowledgeEnabled: true, ragMode: 'hybrid' }), null, 'Context evidence fails closed when an original capability state is unreadable')
  const contextRagModeFixture =
    '<node text="" class="android.widget.Button" content-desc="混合检索" selected="true" clickable="true" enabled="true" bounds="[64,1244][259,1365]" />' +
    '<node text="" class="android.widget.Button" content-desc="FTS only" selected="false" clickable="true" enabled="true" bounds="[281,1244][447,1365]" />' +
    '<node text="" class="android.widget.Button" content-desc="RAG オフ" selected="false" clickable="true" enabled="true" bounds="[469,1244][678,1365]" />'
  assert.equal(keyVisualCollector.readContextRagMode(contextRagModeFixture), 'hybrid', 'Context evidence reads the selected RAG mode from accessibility state')
  assert.equal(keyVisualCollector.findContextRagModeNode(contextRagModeFixture, 'fts')?.contentDesc, 'FTS only', 'Context evidence resolves RAG mode controls across locales')
  assert.ok(
    keyVisualCollectorSource.includes('finally')
      && keyVisualCollectorSource.includes('restoreContextSelfTestConfiguration')
      && keyVisualCollectorSource.includes("observe('restore-after')")
      && keyVisualCollectorSource.includes('configuration.restorationPassed')
      && keyVisualCollectorSource.includes('contextSelfTestConfiguration'),
    'Context evidence restores settings in finally, re-observes final state, and records original, applied, and restored state',
  )
  const contextRagDisclosure = keyVisualCollector.findContextRagDisclosureNode(
    '<node text="" content-desc="RAG 检索模式. 关闭 RAG. 0 个技术 · 0 个本地模型" clickable="false" enabled="true" bounds="[33,335][352,494]" />' +
    '<node text="RAG 检索模式" content-desc="" clickable="false" enabled="true" bounds="[113,354][329,387]" />' +
    '<node text="" content-desc="RAG 检索模式. 关闭 RAG · 自适应 · 服务商优先" clickable="true" enabled="true" bounds="[33,865][1047,981]" />',
  )
  assert.equal(
    contextRagDisclosure?.contentDesc,
    'RAG 检索模式. 关闭 RAG · 自适应 · 服务商优先',
    'Context evidence targets the clickable RAG disclosure when a compact summary card shares its label',
  )
  assert.equal(
    keyVisualCollector.findContextRagDisclosureNode('<node text="" content-desc="RAG retrieval mode. Off RAG · Adaptive" clickable="true" enabled="true" bounds="[33,865][1047,981]" />')?.contentDesc,
    'RAG retrieval mode. Off RAG · Adaptive',
    'Context evidence recognizes the English RAG disclosure prefix without relying on punctuation',
  )
  assert.equal(
    keyVisualCollector.findContextRagDisclosureNode('<node text="" content-desc="RAG 検索モード。RAG オフ · 適応" clickable="true" enabled="true" bounds="[33,865][1047,981]" />')?.contentDesc,
    'RAG 検索モード。RAG オフ · 適応',
    'Context evidence recognizes the Japanese RAG disclosure prefix without relying on punctuation',
  )
  assert.equal(
    keyVisualCollector.findTappableTextNode(
      keyVisualCollector.parseNodes('<node text="" content-desc="运行上下文功能自检" clickable="true" enabled="true" bounds="[0,0][0,0]" />'),
      ['运行上下文功能自检'],
    ),
    null,
    'Context evidence rejects an off-viewport zero-area self-test trigger',
  )
  assert.equal(
    keyVisualCollector.findTappableTextNode(
      keyVisualCollector.parseNodes('<node text="" content-desc="运行上下文功能自检" clickable="true" enabled="true" bounds="[64,1720][1016,1841]" />'),
      ['运行上下文功能自检'],
    )?.bounds,
    '[64,1720][1016,1841]',
    'Context evidence accepts the self-test trigger after bounded scrolling gives it usable bounds',
  )
  assert.ok(keyVisualCollectorSource.includes('tapTextAfterScrolling') && keyVisualCollectorSource.includes('settings-context-selftest-trigger'), 'Context evidence scrolls and recaptures until the self-test trigger is actionable')
  const statusFirstSummary = keyVisualCollector.parseSelfTestSummary('<node text="passed 4, warning 1, failed 2" content-desc="" />')
  assert.deepEqual(
    { passed: statusFirstSummary.passed, warning: statusFirstSummary.warning, failed: statusFirstSummary.failed, total: statusFirstSummary.total },
    { passed: 4, warning: 1, failed: 2, total: 7 },
    'Context evidence parses status-first English self-test summaries',
  )
  const countFirstSummary = keyVisualCollector.parseSelfTestSummary('<node text="4 passed, 1 warning, 2 failed" content-desc="" />')
  assert.deepEqual(
    { passed: countFirstSummary.passed, warning: countFirstSummary.warning, failed: countFirstSummary.failed, total: countFirstSummary.total },
    { passed: 4, warning: 1, failed: 2, total: 7 },
    'Context evidence parses count-first English self-test summaries',
  )
  const mcpContractSource = fs.readFileSync(path.join(root, 'scripts/mcp-android-smoke-contract.js'), 'utf8')
  assert.ok(mcpContractSource.includes('requiredMcpMethods') && mcpContractSource.includes('validateMcpOnlineRequestRows'), 'MCP contract requires the full handshake and response shapes')
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(packageJson.scripts['test:mcp-android:evidence'], 'bun scripts/collect-mcp-android-smoke.js', 'MCP evidence has one discoverable Bun command')
  const mockProviderCollectorSource = fs.readFileSync(path.join(root, 'scripts/collect-mock-provider-chat-android.js'), 'utf8')
  assert.ok(mockProviderCollectorSource.includes('serveOnly') && mockProviderCollectorSource.includes('QA_MOCK_PROVIDER_PORT'), 'mock provider evidence supports a persistent fixed-port server')
  assert.ok(mockProviderCollectorSource.includes('展开导入 / 导出') && mockProviderCollectorSource.includes('mock-provider-import-disclosure'), 'mock provider evidence opens the Import/Export disclosure before importing')
  assert.ok(mockProviderCollectorSource.includes('hasUsableText(capture.uiaText, labels)') && mockProviderCollectorSource.includes('isUsableBounds(node.bounds)'), 'mock provider evidence scrolls until the target control is visibly actionable')
  assert.ok(mockProviderCollectorSource.includes('mock-provider-token-editor-open'), 'mock provider evidence opens the token editor before selecting its input')
  assert.ok(mockProviderCollectorSource.includes("const fakeApiKey = 'sk-qa-mock'") && mockProviderCollectorSource.includes('tokenDraftValue !== fakeApiKey'), 'mock provider evidence uses a short deterministic fixture key and fails before staging a truncated input')
  assert.ok(mockProviderCollectorSource.includes('stagingPath') && mockProviderCollectorSource.includes('fs.copyFileSync(stagingPath, localPath)'), 'mock provider captures publish only a fresh staged adb pull')
  assert.ok(mockProviderCollectorSource.includes('android.intent.action.MEDIA_SCANNER_SCAN_FILE') && mockProviderCollectorSource.includes('file://${remoteFixturePath}'), 'mock provider evidence media-scans each freshly pushed fixture before opening DocumentsUI')
  assert.ok(mockProviderCollectorSource.includes('selectDocumentsUiFileFromDownloads') && mockProviderCollectorSource.includes('mock-provider-file-picker-roots') && mockProviderCollectorSource.includes("['Downloads', 'Download', '下载']"), 'mock provider evidence falls back from stale Recent search to the Downloads provider')
  assert.ok(mockProviderCollectorSource.includes('completeDocumentsUiSelection') && mockProviderCollectorSource.includes("['Select', '选择', '選取']"), 'mock provider evidence confirms Android DocumentsUI multi-select mode before waiting for the import dialog')
  assert.ok(mockProviderCollectorSource.includes('waitForImportTerminalState') && mockProviderCollectorSource.includes("classifyImportTerminalState(capture.uiaText) !== 'pending'"), 'mock provider evidence waits for an explicit import success or failure after DocumentsUI returns')
  assert.ok(mockProviderCollectorSource.includes("classifyImportTerminalState('<node text=\"Not imported\" />') !== 'failure'"), 'mock provider collector self-test rejects an explicit import failure instead of treating it as a delayed success')
  const messageActionsCollectorSource = mockProviderCollectorSource.match(/function openMessageActions[\s\S]*?(?=\nfunction waitForText)/)?.[0] ?? ''
  assert.match(messageActionsCollectorSource, /findNodeByText\(parseNodes\(latest\.uiaText\), \[seededAssistantToken\]\)[\s\S]*?largestAssistantLikeNode\(latest\.uiaText\)[\s\S]*?longPressBoundsCenter\(device, longPressNode\.bounds\)/, 'mock provider evidence opens message actions through the production long-press gesture')
  assert.doesNotMatch(messageActionsCollectorSource, /textMatchesAny\(node, \['操作', 'Actions'\]\)/, 'mock provider evidence does not wait for an action-bar label before opening the long-press-only action bar')
  const validationContract = require(path.join(root, 'scripts/release-validation-contract.js'))
  const expectedApkSha256 = 'a'.repeat(64)
  const installedApkSha256 = 'b'.repeat(64)
  const parityFixture = {
    apk: {
      path: 'dist-apk/IsleMind-0.0.13-arm64-v8a-no-model.apk',
      exists: true,
      sha256: expectedApkSha256,
      sidecarSha256: expectedApkSha256,
      sizeBytes: 1,
      modifiedAt: '2026-07-18T00:00:00.000Z',
    },
    expected: {
      packageVersion: '0.0.13',
      expoVersion: '0.0.13',
      androidPackage: 'com.islemind.app',
      androidVersionCode: 13,
    },
    sourceFreshness: { status: 'current' },
    installed: {
      deviceSerial: 'fixture-device',
      deviceAbi: 'arm64-v8a',
      packagePath: 'package:/data/app/com.islemind.app/base.apk',
      packageSha256: installedApkSha256,
      versionName: '0.0.13',
      versionCode: 13,
      primaryCpuAbi: 'arm64-v8a',
      firstInstallTime: '2026-07-18 00:00:00',
      lastUpdateTime: '2026-07-18 00:00:00',
      cleanInstall: true,
      cleanInstallWindowMs: 0,
    },
    launch: { ok: true, fatalLog: { fatal: false } },
    compatibility16kb: { ok: true, zipAlignmentOk: true, elf64Ok: true },
  }
  const mismatchIssues = validationContract.validateCurrentApkSmokeResult(parityFixture)
  assert.ok(mismatchIssues.some((issue) => issue.includes('does not match current APK SHA256')), 'current APK smoke rejects a device-installed APK digest mismatch')
  const provenanceMismatchIssues = validationContract.validateReleaseProvenance(parityFixture)
  assert.ok(provenanceMismatchIssues.some((issue) => issue.includes('does not match current APK SHA256')), 'QA provenance rejects a device-installed APK digest mismatch')
  parityFixture.installed.packageSha256 = expectedApkSha256
  const matchingIssues = validationContract.validateCurrentApkSmokeResult(parityFixture)
  assert.equal(matchingIssues.some((issue) => issue.includes('Installed package SHA256')), false, 'current APK smoke accepts matching local and device APK digests')
  const matchingProvenanceIssues = validationContract.validateReleaseProvenance(parityFixture)
  assert.equal(matchingProvenanceIssues.some((issue) => issue.includes('Installed package SHA256')), false, 'QA provenance accepts matching local and device APK digests')
  parityFixture.launch.renderer = { systemPropertyDefault: true, windowHardwareAccelerated: false }
  assert.deepEqual(validationContract.validateCurrentApkSmokeResult(parityFixture), [], 'current APK smoke treats the application window rendering mode as diagnostic evidence rather than a software-rendering compatibility requirement')
  delete parityFixture.installed.packageSha256
  const missingDigestIssues = validationContract.validateCurrentApkSmokeResult(parityFixture)
  assert.ok(missingDigestIssues.includes('Installed package SHA256 was not collected from the device APK.'), 'current APK smoke fails closed when the device APK digest is absent')
  const missingProvenanceDigestIssues = validationContract.validateReleaseProvenance(parityFixture)
  assert.ok(missingProvenanceDigestIssues.includes('Installed package SHA256 was not collected from the device APK.'), 'QA provenance fails closed when the device APK digest is absent')

  const smokeSource = fs.readFileSync(path.join(root, 'scripts/collect-current-apk-smoke.js'), 'utf8')
  assert.ok(smokeSource.includes('test-evidence') && smokeSource.includes('qa'), 'current APK smoke writes QA evidence')
  assert.ok(smokeSource.includes('fatalLog') && smokeSource.includes('validate16kb'), 'current APK smoke checks fatal logs and 16KB compatibility')
  assert.ok(smokeSource.includes('debug.hwui.renderer') && smokeSource.includes('systemPropertyDefault'), 'current APK smoke tracks renderer evidence')
  assert.ok(smokeSource.includes('ro.kernel.qemu') && smokeSource.includes("rendererProperty === 'skiagl'"), 'current APK smoke accepts the emulator default renderer as diagnostic evidence')
  assert.ok(smokeSource.includes('windowHardwareAccelerated'), 'current APK smoke records the application-window rendering mode as diagnostic evidence')
  assert.doesNotMatch(smokeSource, /androidHardwareAccelerationDisabled|androidHardwareAccelerationPlugin/, 'current APK smoke no longer derives behavior from the deleted software-rendering compatibility plugin')
  const smokeStabilizationMs = Number(smokeSource.match(/const launchStabilizationMs = (\d+)/)?.[1])
  assert.ok(smokeStabilizationMs >= 17_000 && smokeStabilizationMs <= 19_000, 'current APK smoke observes the nested Home, workspace-shell, and plain-surface diagnostic windows')
  assert.ok(smokeSource.includes('QA_POST_WINDOW_OBSERVATION_MS') && smokeSource.includes('postWindowObservation'), 'current APK smoke can record a separate delayed process-survival window')
  const maxPostWindowObservationMs = Number((smokeSource.match(/const maxPostWindowObservationMs = ([\d_]+)/)?.[1] ?? '').replaceAll('_', ''))
  assert.ok(maxPostWindowObservationMs >= 370_000, 'current APK smoke can hold the final staged setup layer through its full delayed-crash observation window')
  assert.ok(smokeSource.includes('resolveReleaseArchForAndroidAbi') && smokeSource.includes('packageSha256'), 'current APK smoke selects the device ABI artifact and records device APK digest parity')
  const fatalEvidenceLineLimit = Number(smokeSource.match(/const fatalEvidenceLineLimit = (\d+)/)?.[1])
  assert.ok(fatalEvidenceLineLimit >= 1_000, 'current APK smoke retains a crash-sized fatal evidence window')
  const commandOutputBufferBytes = Number(smokeSource.match(/const commandOutputBufferBytes = (\d+) \* 1024 \* 1024/)?.[1]) * 1024 * 1024
  assert.ok(commandOutputBufferBytes >= 16 * 1024 * 1024, 'current APK smoke retains verbose emulator logcat and native tombstone output')
  assert.match(smokeSource, /timeout: 15000,\s*maxBuffer: commandOutputBufferBytes/, 'current APK smoke applies the expanded output buffer to adb collection commands')

  const smokeCollector = require(path.join(root, 'scripts/collect-current-apk-smoke.js'))
  const previousQaApkPath = process.env.QA_APK_PATH
  const previousQaApkArch = process.env.QA_APK_ARCH
  try {
    delete process.env.QA_APK_PATH
    delete process.env.QA_APK_ARCH
    assert.match(
      smokeCollector.resolveApkPath({ packageVersion: '0.0.13' }, { deviceAbi: 'arm64-v8a' }),
      /IsleMind-0\.0\.13-arm64-v8a-no-model\.apk$/,
      'current APK smoke resolves the artifact for the selected physical-device ABI',
    )
  } finally {
    if (previousQaApkPath == null) delete process.env.QA_APK_PATH
    else process.env.QA_APK_PATH = previousQaApkPath
    if (previousQaApkArch == null) delete process.env.QA_APK_ARCH
    else process.env.QA_APK_ARCH = previousQaApkArch
  }
  const installerSource = fs.readFileSync(path.join(root, 'scripts/install-current-release-apk.js'), 'utf8')
  assert.ok(installerSource.includes('resolveReleaseArchForAndroidAbi(deviceAbi)') && installerSource.includes('packageSha256'), 'current APK install selects the physical-device ABI artifact and proves the installed digest')
  const acceleratedWindowDump = `
  Window #4 Window{abc u0 com.islemind.app/com.islemind.app.MainActivity}:
    mAttrs={(0,0)(fillxfill) sim={adjust=nothing} ty=BASE_APPLICATION
      fl=LAYOUT_IN_SCREEN SPLIT_TOUCH HARDWARE_ACCELERATED DRAWS_SYSTEM_BAR_BACKGROUNDS
      pfl=NO_MOVE_ANIMATION USE_BLAST
  imeLayeringTarget in display# 0 Window{abc u0 com.islemind.app/com.islemind.app.MainActivity}`
  const softwareWindowDump = acceleratedWindowDump.replace(' HARDWARE_ACCELERATED', '')
  assert.equal(smokeCollector.readMainActivityWindowHardwareAcceleration(acceleratedWindowDump), true, 'current APK smoke identifies an accelerated application window')
  assert.equal(smokeCollector.readMainActivityWindowHardwareAcceleration(softwareWindowDump), false, 'current APK smoke identifies a software-rendered application window')
  assert.equal(smokeCollector.readMainActivityWindowHardwareAcceleration('unrelated window dump'), null, 'current APK smoke fails closed when the application window is absent')
  assert.equal(smokeCollector.readExpectedAppConfig().androidHardwareAccelerationDisabled, undefined, 'current APK smoke expected config has no deleted software-rendering compatibility flag')
  assert.deepEqual(
    smokeCollector.observePostWindowProcess('fixture-device', 'fixture-pid', '', 5_000),
    {
      requestedMs: 5_000,
      elapsedMs: 0,
      observed: true,
      pid: null,
      stable: false,
      deathDetected: true,
      endedEarly: true,
      pollCount: 0,
    },
    'current APK smoke records process death detected during launch stabilization',
  )
  let transientPidNow = 0
  const transientPids = ['', '', 'fixture-pid']
  assert.equal(
    smokeCollector.readStablePackagePid('fixture-device', {
      readPid: () => transientPids.shift() ?? '',
      sleep: (ms) => { transientPidNow += ms },
    }),
    'fixture-pid',
    'current APK smoke retries transient empty PID reads before classifying a process as dead',
  )
  assert.equal(transientPidNow, 500, 'current APK smoke bounds transient PID retry delay')
  let deathNow = 0
  const deathPids = ['fixture-pid', '']
  const earlyDeathObservation = smokeCollector.observePostWindowProcess('fixture-device', 'fixture-pid', 'fixture-pid', 5_000, {
    now: () => deathNow,
    sleep: (ms) => { deathNow += ms },
    readPid: () => deathPids.shift() ?? '',
    pollIntervalMs: 1_000,
  })
  assert.deepEqual(earlyDeathObservation, {
    requestedMs: 5_000,
    elapsedMs: 2_000,
    observed: true,
    pid: null,
    stable: false,
    deathDetected: true,
    endedEarly: true,
    pollCount: 2,
  }, 'current APK smoke stops the delayed observation promptly after confirmed process death')
  let survivorNow = 0
  const survivorObservation = smokeCollector.observePostWindowProcess('fixture-device', 'fixture-pid', 'fixture-pid', 5_000, {
    now: () => survivorNow,
    sleep: (ms) => { survivorNow += ms },
    readPid: () => 'fixture-pid',
    pollIntervalMs: 1_000,
  })
  assert.deepEqual(survivorObservation, {
    requestedMs: 5_000,
    elapsedMs: 5_000,
    observed: true,
    pid: 'fixture-pid',
    stable: true,
    deathDetected: false,
    endedEarly: false,
    pollCount: 5,
  }, 'current APK smoke retains the full requested delayed window for surviving processes')
  const fatalEvidenceFixture = [
    '1784296683.034 22808 22808 F libc : Fatal signal 11 (SIGSEGV)',
    '1784296683.293 22889 22889 F DEBUG : #00 libharfbuzz_ng.so (hb_font_get_nominal_glyphs_default)',
    '1784296683.294 22889 22889 I unrelated : ordinary diagnostic',
  ]
  assert.deepEqual(
    smokeCollector.selectFatalEvidenceLines(fatalEvidenceFixture, '22808'),
    fatalEvidenceFixture.slice(0, 2),
    'current APK smoke retains epoch-format libc and symbolized DEBUG tombstone lines',
  )
  const longFatalEvidenceFixture = [
    '1784296683.000 22808 22808 I ReactNativeJS: application startup diagnostic',
    '1784296683.034 22808 22808 F libc : Fatal signal 11 (SIGSEGV)',
    ...Array.from({ length: fatalEvidenceLineLimit + 80 }, (_, index) => `1784296683.${String(index).padStart(3, '0')} 22808 22808 I crash-probe: line-${index}`),
    '1784296684.999 22889 22889 F DEBUG : tombstone-tail',
  ]
  const retainedFatalEvidence = smokeCollector.retainFatalEvidenceLines(longFatalEvidenceFixture, fatalEvidenceLineLimit)
  assert.equal(retainedFatalEvidence.length, fatalEvidenceLineLimit, 'current APK smoke bounds oversized fatal evidence')
  assert.ok(retainedFatalEvidence.includes(longFatalEvidenceFixture[0]), 'fatal evidence retention preserves nearby React Native startup context')
  assert.ok(retainedFatalEvidence.includes(longFatalEvidenceFixture[1]), 'fatal evidence retention preserves the fatal-signal header')
  assert.ok(retainedFatalEvidence.includes(longFatalEvidenceFixture.at(-1)), 'fatal evidence retention preserves the tombstone tail')

  const rootLayoutSource = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8')
  const bootFallbackSource = rootLayoutSource.match(/function BootFallback\(\)[\s\S]*?\n}\n\nfunction resolveStackTransitionOptions/)?.[0] ?? ''
  assert.match(bootFallbackSource, /<SafeAreaView\b/, 'cold-start fallback owns a static native safe-area surface')
  assert.match(bootFallbackSource, /<ActivityIndicator\b/, 'cold-start fallback uses the native activity indicator')
  assert.doesNotMatch(bootFallbackSource, /IsleScreen|IsleBackground|HighFrameSpinner|Moti|Reanimated/, 'cold-start fallback does not mount a design-system worklet surface')

  const homeRouteSource = fs.readFileSync(path.join(root, 'app/index.tsx'), 'utf8')
  const conversationsRouteSource = fs.readFileSync(path.join(root, 'app/conversations.tsx'), 'utf8')
  const settingsRouteSource = fs.readFileSync(path.join(root, 'app/settings/index.tsx'), 'utf8')
  assert.doesNotMatch(homeRouteSource, /PAGER_MOUNT_DELAY_MS|isPagerReady|setTimeout|ActivityIndicator/, 'home route removes the completed four-second whole-pager diagnostic delay')
  assert.match(homeRouteSource, /return <MainPagerShell initialPage="home" \/>/, 'home route mounts the existing pager directly')
  assert.match(conversationsRouteSource, /return <MainPagerShell initialPage="history" \/>/, 'the /conversations compatibility alias selects History')
  assert.match(settingsRouteSource, /return <MainPagerShell initialPage="settings" \/>/, 'the /settings compatibility alias selects Settings')

  const mainPagerSource = fs.readFileSync(path.join(root, 'src/components/main/MainPagerShell.tsx'), 'utf8')
  const conversationsScreenSource = fs.readFileSync(path.join(root, 'src/components/main/ConversationsScreenContent.tsx'), 'utf8')
  const settingsScreenSource = fs.readFileSync(path.join(root, 'src/components/main/SettingsScreenContent.tsx'), 'utf8')
  const floatingChromeSource = fs.readFileSync(path.join(root, 'src/components/chat/FloatingChrome.tsx'), 'utf8')
  const persistentHeaderSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatPersistentHeader.tsx'), 'utf8')
  const floatingChromeStateSource = fs.readFileSync(path.join(root, 'src/components/chat/chatFloatingChromeState.ts'), 'utf8')
  const chatAiConfigurationSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatAiConfigurationSheet.tsx'), 'utf8')
  const chatOptionsPanelSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatOptionsPanel.tsx'), 'utf8')
  assert.match(mainPagerSource, /const MAIN_PAGER_PATH_BY_PAGE:[\s\S]*history: '\/conversations'[\s\S]*home: '\/'[\s\S]*settings: '\/settings'/, 'the pager owns one canonical mapping for all compatible top-level aliases')
  const initialPageEffect = mainPagerSource.match(/useEffect\(\(\) => \{\s*const nextPage = resolveMainPagerPage\(pathname\) \?\? initialPage[\s\S]*?\}, \[initialPage, pathname\]\)/)?.[0] ?? ''
  assert.match(initialPageEffect, /resolveMainPagerPage\(pathname\) \?\? initialPage/, 'route aliases resolve through the canonical pager mapping')
  assert.match(initialPageEffect, /if \(nextPage !== page\) setPage\(nextPage\)/, 'route synchronization skips the already active page')
  assert.match(mainPagerSource, /useState<MainPagerPage>\(resolvedInitialPage\)/, 'the route-resolved initial page is active in the first render without a diagnostic delay')
  assert.match(mainPagerSource, /pages\.map\(\(item\) => \([\s\S]*?<PagerPage[\s\S]*?key=\{item\.id\}[\s\S]*?active=\{item\.id === page\}[\s\S]*?\{item\.node\}[\s\S]*?<\/PagerPage>/, 'the pager keeps all three page trees mounted across static navigation switches')
  assert.doesNotMatch(mainPagerSource, /ANDROID_HOME_CHILD_DIAGNOSTIC_DELAY_MS|homeBoundaryDiagnostic|pagerHomeBoundary|\[islemind:pager-home-boundary\]/, 'resolved pager crash-bisect delays and markers remain deleted')
  const switchToSource = mainPagerSource.match(/function switchTo\(next: MainPagerPage\) \{[\s\S]*?\n  \}/)?.[0] ?? ''
  assert.match(switchToSource, /if \(next !== page\) setPage\(next\)/, 'pager navigation changes active state directly')
  assert.doesNotMatch(mainPagerSource, /mountedPageChildren|transitionRequest|readinessToken|handlePagerPageReady|requestPagerPageChild|withTiming|withSpring|GestureDetector|Animated\.View/, 'pager navigation avoids lazy mounting and animated native reparenting')
  assert.match(
    mainPagerSource,
    /function PagerPage[\s\S]*?<View[\s\S]*importantForAccessibility=\{active \? 'auto' : 'no-hide-descendants'\}[\s\S]*pointerEvents=\{active \? 'auto' : 'none'\}[\s\S]*zIndex: active \? 2 : 1/,
    'inactive page trees stay mounted without intercepting input or accessibility during static switches',
  )
  assert.doesNotMatch(mainPagerSource, /MainPagerExperience|ThemeNavigationDrawer|AppTopBar|shellNavigation/, 'the pager does not restore the retired global top bar or drawer')
  assert.ok(['common.backToChat', '<HistoryHeaderFrame', 'search={historySearch}', 'newConversationLabel'].every((marker) => conversationsScreenSource.includes(marker)), 'History owns Back to Chat, title/search, and new-chat actions')
  assert.ok(['common.backToChat', '<SettingsOverviewExperience', 'value={settingsSearch}'].every((marker) => settingsScreenSource.includes(marker)), 'Settings owns Back to Chat, title, and search')
  assert.ok(['<ChatAiConfigurationSheet', '<ChatPersistentHeader'].every((marker) => floatingChromeSource.includes(marker)) && ['chat.newConversation', 'settings.title', 'onModelPress'].every((marker) => persistentHeaderSource.includes(marker)) && /conversation\.title/.test(floatingChromeSource), 'Chat owns persistent history, AI configuration, new-chat, and Settings actions')
  assert.ok(floatingChromeStateSource.includes('const chromeCollapsed = false') && !floatingChromeStateSource.includes('setTimeout('), 'Chat navigation remains visible across idle, focus, scrolling, and generation state')
  assert.ok(['chat-ai-configuration-panel', '<ChatOptionsPanel', '<ProviderSettingsContent'].every((marker) => chatAiConfigurationSource.includes(marker)), 'one Chat AI sheet composes essential configuration and provider onboarding')
  assert.ok(['chat-ai-provider-connection-section', 'chat-ai-model-selection-section', 'chat-ai-reasoning-section'].every((marker) => chatOptionsPanelSource.includes(marker)), 'the AI sheet exposes provider, model, and reasoning sections from existing state')
  assert.doesNotMatch(mainPagerSource, /function PageHeaderAction/, 'the retired shared PageHeaderAction tree is not restored')
  assert.match(mainPagerSource, /styles\.opaqueFallback[\s\S]*colors\.background\.surfaceCanvas/, 'the pager keeps an opaque semantic fallback behind every transition')

  const homeContentSource = fs.readFileSync(path.join(root, 'src/components/main/HomeScreenContent.tsx'), 'utf8')
  assert.match(homeContentSource, /<ChatWorkspace[\s\S]*active=\{active\}/, 'Home passes the requested active state directly into the Chat workspace')
  assert.doesNotMatch(homeContentSource, /ANDROID_CHAT_|chatBoundary|chatSetupDiagnostic|\[islemind:home-chat-boundary\]/, 'resolved Home-to-Chat crash-bisect staging remains deleted')

  const chatWorkspaceSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatWorkspace.tsx'), 'utf8')
  assert.doesNotMatch(chatWorkspaceSource, /onSurfaceCommit|renderableSurface|lastReportedSurface|ChatSetupDiagnosticStage|setupDiagnosticStage|onSetupLayerCommit/, 'ChatWorkspace no longer carries crash-bisect surface or stage contracts')
  const chatSetupWorkspaceSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatSetupWorkspace.tsx'), 'utf8')
  assert.match(chatSetupWorkspaceSource, /<ChatPersistentHeader/, 'Chat setup shares the same persistent navigation and AI configuration entry as active Chat')
  assert.match(chatSetupWorkspaceSource, /showSetupEmptyState \? \([\s\S]*<ScrollView[\s\S]*keyboardShouldPersistTaps="handled"[\s\S]*<ChatSetupEmptyState/, 'Chat setup renders its keyboard-aware Chat readiness content without staged gates')
  assert.ok(['<ChatAiConfigurationSheet', 'scope="essential"', 'visible={showOptions}'].every((marker) => chatSetupWorkspaceSource.includes(marker)), 'Chat setup exposes one stable provider/model/reasoning configuration sheet')
  assert.doesNotMatch(chatSetupWorkspaceSource, /setup-configuration-|setup-step-|<FloatingControlOrb/, 'Chat setup does not restore the three-step card or floating navigation orb')
  assert.match(chatSetupWorkspaceSource, /<FloatingComposer[\s\S]*streaming=\{false\}/, 'Chat setup mounts the production composer directly')
  assert.doesNotMatch(chatSetupWorkspaceSource, /ChatSetupDiagnosticStage|diagnosticStage|setupScrollShellEnabled|setupScrollLayoutEnabled|setupScrollPlaceholderEnabled|setupContentEnabled|setupControlOrbEnabled|setupComposerEnabled|setupChromeEnabled|committedDiagnosticLayers/, 'resolved Chat setup crash-bisect staging remains deleted')

  const motionPreferenceSource = fs.readFileSync(path.join(root, 'src/hooks/useMotionPreference.ts'), 'utf8')
  const motionSnapshotSource = motionPreferenceSource.match(/function getMotionPreferenceSnapshot\(\)[\s\S]*?\n}/)?.[0] ?? ''
  assert.match(motionPreferenceSource, /Platform\.OS === 'android' \? 'reduced' : 'full'/, 'Android cold start preserves the reduced-motion default')
  assert.doesNotMatch(motionSnapshotSource, /AccessibilityInfo|startMotionPreferenceSubscription|isReduceMotionEnabled|addEventListener/, 'motion snapshot reads stay free of native side effects')
  assert.match(motionPreferenceSource, /motionPreferenceSubscription\?\.remove\(\)/, 'motion preference removes its native subscription after the final consumer unmounts')

  const buildSource = fs.readFileSync(path.join(root, 'scripts/build-and-validate-local-android-apk.js'), 'utf8')
  assert.ok(buildSource.includes('build-local-android-apk.js') && buildSource.includes('validate-android-16kb-apk.js'), 'release build wrapper validates APK after build')
  const localBuildSource = fs.readFileSync(path.join(root, 'scripts/build-local-android-apk.js'), 'utf8')
  assert.match(localBuildSource, /'-PhermesEnabled=true'/, 'local release builds bind the supported Hermes engine explicitly at Gradle execution')
  assert.doesNotMatch(localBuildSource, /--js-engine|jsEngine|\bjsc\b/, 'local release builds do not expose the unsupported Worklets JSC cell')
  assert.match(localBuildSource, /path\.join\(onnxruntimeAndroidDir, '\.cxx'\)/, 'local release builds discard stale ONNX Runtime CMake configuration')
  assert.match(localBuildSource, /path\.join\(onnxruntimeAndroidDir, 'build'\)/, 'local release builds discard stale ONNX Runtime native outputs and versioned AAR extractions')

  assertReleaseWorkflowIntegration()

  const updatesSource = fs.readFileSync(path.join(root, 'src/services/appUpdates.ts'), 'utf8')
  assert.ok(updatesSource.includes('safeHttpUrl'), 'app update release URLs pass through URL safety')
  assert.ok(updatesSource.includes('verifyDownloadedApk'), 'app update downloads verify size and checksum')
  assert.ok(updatesSource.includes('markDownloadedApkForCleanup') && updatesSource.includes('discardDownloadedApk'), 'app update staged APK lifecycle has cleanup paths')
}

async function assertMotionPreferenceRuntimeContract() {
  const android = loadMotionPreferenceHarness('android')
  assert.equal(android.initialValue, 'reduced', 'Android motion starts from the prior reduced default')
  assert.equal(android.queryCount(), 0, 'Android motion snapshot does not query native accessibility state during render')
  assert.equal(android.addCount(), 0, 'Android motion snapshot does not register a native listener during render')
  assert.equal(android.store.getSnapshot(), 'reduced', 'Android client snapshot is pure and stable')
  assert.equal(android.store.getServerSnapshot(), 'reduced', 'Android server snapshot returns the pure platform default')
  assert.equal(android.queryCount(), 0, 'snapshot reads remain free of native queries')
  assert.equal(android.addCount(), 0, 'snapshot reads remain free of native listener registration')

  const stopAndroidA = android.store.subscribe(() => undefined)
  const stopAndroidB = android.store.subscribe(() => undefined)
  await flushMicrotasks()
  assert.equal(android.queryCount(), 1, 'two Android consumers share one native accessibility query')
  assert.equal(android.addCount(), 1, 'two Android consumers share one native accessibility listener')
  stopAndroidA()
  assert.equal(android.removeCount(), 0, 'the shared native listener remains while one Android consumer is mounted')
  stopAndroidB()
  assert.equal(android.removeCount(), 1, 'the final Android consumer removes the shared native listener')
  android.resolveQuery(0, false)
  await flushMicrotasks()
  assert.equal(android.store.getSnapshot(), 'reduced', 'a late Android query cannot mutate the store after teardown')

  const ios = loadMotionPreferenceHarness('ios')
  assert.equal(ios.initialValue, 'full', 'non-Android motion preserves the full-motion default')
  let firstNotifications = 0
  let secondNotifications = 0
  const stopIosA = ios.store.subscribe(() => { firstNotifications += 1 })
  const stopIosB = ios.store.subscribe(() => { secondNotifications += 1 })
  await flushMicrotasks()
  assert.equal(ios.queryCount(), 1, 'two non-Android consumers share one native accessibility query')
  assert.equal(ios.addCount(), 1, 'two non-Android consumers share one native accessibility listener')

  ios.emit(0, true)
  assert.equal(ios.store.getSnapshot(), 'reduced', 'an active native reduce-motion event updates the shared snapshot')
  assert.equal(firstNotifications, 1, 'the first active consumer receives the native preference change')
  assert.equal(secondNotifications, 1, 'the second active consumer receives the native preference change')
  ios.resolveQuery(0, false)
  await flushMicrotasks()
  assert.equal(ios.store.getSnapshot(), 'reduced', 'an older initial query cannot overwrite a newer native event')

  stopIosA()
  stopIosB()
  assert.equal(ios.removeCount(), 1, 'the final non-Android consumer removes the shared native listener')
  ios.emit(0, false)
  assert.equal(ios.store.getSnapshot(), 'reduced', 'a queued native event is ignored after subscription teardown')
  assert.equal(firstNotifications, 1, 'a stale native event does not notify the first unmounted consumer')
  assert.equal(secondNotifications, 1, 'a stale native event does not notify the second unmounted consumer')

  let resumedNotifications = 0
  const stopIosResumed = ios.store.subscribe(() => { resumedNotifications += 1 })
  await flushMicrotasks()
  assert.equal(ios.queryCount(), 2, 'a new first consumer refreshes the native accessibility preference')
  assert.equal(ios.addCount(), 2, 'a new first consumer owns a fresh native listener')
  stopIosResumed()
  ios.resolveQuery(1, false)
  await flushMicrotasks()
  assert.equal(ios.store.getSnapshot(), 'reduced', 'a query resolving after the resumed consumer unmounts is ignored')
  assert.equal(resumedNotifications, 0, 'a late resumed query does not notify an unmounted consumer')
}

function loadMotionPreferenceHarness(platform) {
  const hookPath = path.join(root, 'src/hooks/useMotionPreference.ts')
  const resolvedHookPath = require.resolve(hookPath)
  delete require.cache[resolvedHookPath]

  let store
  let nativeQueryCount = 0
  let nativeAddCount = 0
  let nativeRemoveCount = 0
  const queryResolvers = []
  const nativeHandlers = []
  const reactMock = {
    useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
      store = { subscribe, getSnapshot, getServerSnapshot }
      return getSnapshot()
    },
  }
  const reactNativeMock = {
    Platform: { OS: platform },
    AccessibilityInfo: {
      isReduceMotionEnabled() {
        nativeQueryCount += 1
        return new Promise((resolve) => queryResolvers.push(resolve))
      },
      addEventListener(eventName, handler) {
        assert.equal(eventName, 'reduceMotionChanged', 'motion preference subscribes only to reduce-motion changes')
        nativeAddCount += 1
        nativeHandlers.push(handler)
        let removed = false
        return {
          remove() {
            if (removed) return
            removed = true
            nativeRemoveCount += 1
          },
        }
      },
    },
  }

  Module._load = function loadMotionPreferenceMocks(request, parent, isMain) {
    if (request === 'react') return reactMock
    if (request === 'react-native') return reactNativeMock
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const { useMotionPreference } = require(hookPath)
    const initialValue = useMotionPreference()
    assert.ok(store, 'motion preference hook supplies the external-store contract')
    return {
      initialValue,
      store,
      queryCount: () => nativeQueryCount,
      addCount: () => nativeAddCount,
      removeCount: () => nativeRemoveCount,
      resolveQuery(index, enabled) {
        assert.ok(queryResolvers[index], `native motion query ${index} exists`)
        queryResolvers[index](enabled)
      },
      emit(index, enabled) {
        assert.ok(nativeHandlers[index], `native motion handler ${index} exists`)
        nativeHandlers[index](enabled)
      },
    }
  } finally {
    Module._load = originalLoad
    delete require.cache[resolvedHookPath]
  }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function assertReleaseWorkflowIntegration() {
  const releaseWorkflowSource = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-android-apk.yml'), 'utf8')
  const runnerWorkflowSource = fs.readFileSync(path.join(root, '.github', 'workflows', 'runner-android-apk.yml'), 'utf8')

  for (const [name, source] of [
    ['signed release', releaseWorkflowSource],
    ['runner debug', runnerWorkflowSource],
  ]) {
    assert.ok(source.includes('oven-sh/setup-bun@v2'), `${name} workflow installs Bun`)
    assert.ok(source.includes('bun-version: 1.3.14'), `${name} workflow pins the repository Bun version`)
    assert.ok(source.includes('bun install --frozen-lockfile'), `${name} workflow installs from bun.lock without mutation`)
    assert.ok(source.includes('bun run type-check'), `${name} workflow type-checks through Bun`)
    assert.doesNotMatch(source, /actions\/setup-node|cache:\s*npm|\bnpm\s+(?:ci|install|run)\b|\bnpx\b/, `${name} workflow has no npm toolchain path`)
  }

  const qualityGateIndex = releaseWorkflowSource.indexOf('- name: Release quality contracts')
  const recoveryGateIndex = releaseWorkflowSource.indexOf('- name: Architecture and recovery contracts')
  const prebuildIndex = releaseWorkflowSource.indexOf('- name: Generate Android project')
  const publishIndex = releaseWorkflowSource.indexOf('- name: Publish GitHub Release')
  assert.ok(qualityGateIndex > 0 && qualityGateIndex < prebuildIndex, 'signed release quality contracts run before Android prebuild')
  assert.ok(recoveryGateIndex > qualityGateIndex && recoveryGateIndex < prebuildIndex, 'signed release recovery contracts run before Android prebuild')
  assert.ok(prebuildIndex < publishIndex, 'signed release contracts and build run before publication')

  for (const script of [
    'test:release-readiness-compatibility',
    'test:runtime-budget-governance-compatibility',
    'test:runtime-privacy-retention-compatibility',
    'test:vnext-architecture-contract',
    'test:vnext-walking-skeleton',
    'test:vnext-task-runtime',
  ]) {
    assert.ok(releaseWorkflowSource.includes(`bun run ${script}`), `signed release workflow runs ${script}`)
  }

  for (const deviceOnlyScript of [
    'test:current-apk-smoke',
    'test:provider-runtime-android',
    'test:android-status-notification:evidence',
    'test:android-device-task:evidence',
  ]) {
    assert.equal(releaseWorkflowSource.includes(deviceOnlyScript), false, `signed release workflow does not claim device evidence via ${deviceOnlyScript}`)
    assert.equal(runnerWorkflowSource.includes(deviceOnlyScript), false, `runner debug workflow does not claim device evidence via ${deviceOnlyScript}`)
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
