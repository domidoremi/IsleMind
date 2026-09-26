const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')

if (process.argv.includes('--focus=pager-transition')) {
  assertPagerReleaseSourceContract()
  console.log('Release pager transition source contract passed')
  process.exit(0)
}

const { transformTypeScriptModule } = require('./node-ts-support')
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
    module._compile(transformTypeScriptModule(source, filename), filename)
  }
  hook.isReleaseReadinessCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function assertPagerReleaseSourceContract() {
  const homeRouteSource = fs.readFileSync(path.join(root, 'app/index.tsx'), 'utf8')
  const conversationsRouteSource = fs.readFileSync(path.join(root, 'app/conversations.tsx'), 'utf8')
  const settingsRouteSource = fs.readFileSync(path.join(root, 'app/settings/index.tsx'), 'utf8')
  const chatDeepLinkSource = fs.readFileSync(path.join(root, 'app/chat/[id].tsx'), 'utf8')
  const sourceRouteSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/SourceDetailScreen.tsx'), 'utf8')
  const chatActiveChromeSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveChromeLayer.tsx'), 'utf8')
  const chatWorkspaceSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatWorkspace.tsx'), 'utf8')
  const chatWorkspaceLifecycleSource = fs.readFileSync(path.join(root, 'src/components/chat/chatWorkspaceLifecycleState.ts'), 'utf8')
  const settingsPageShellSource = fs.readFileSync(path.join(root, 'src/components/settings/SettingsPageShell.tsx'), 'utf8')
  const providerSettingsRouteSource = fs.readFileSync(path.join(root, 'app/settings/providers.tsx'), 'utf8')
  const usageSettingsRouteSource = fs.readFileSync(path.join(root, 'app/settings/usage.tsx'), 'utf8')
  const conversationsScreenSource = fs.readFileSync(path.join(root, 'src/components/main/ConversationsScreenContent.tsx'), 'utf8')
  const settingsScreenSource = fs.readFileSync(path.join(root, 'src/components/main/SettingsScreenContent.tsx'), 'utf8')
  const chatSettingsRoutesSource = fs.readFileSync(path.join(root, 'src/components/chat/chatSettingsRoutes.ts'), 'utf8')
  const routeReturnPolicySource = fs.readFileSync(path.join(root, 'src/presentation/app-shell/routeReturnPolicy.ts'), 'utf8')
  const pagerSource = fs.readFileSync(path.join(root, 'src/components/main/MainPagerShell.tsx'), 'utf8')
  const collectorSource = fs.readFileSync(path.join(root, 'scripts/collect-navigation-android-smoke.js'), 'utf8')

  assert.match(homeRouteSource, /MainPagerShell initialPage="home"/, 'the / alias selects Home')
  assert.match(conversationsRouteSource, /MainPagerShell initialPage="history"/, 'the /conversations alias selects History')
  assert.match(settingsRouteSource, /MainPagerShell initialPage="settings"/, 'the /settings alias selects Settings')
  assert.match(pagerSource, /const resolvedInitialPage = routePage \?\? initialPage[\s\S]*const \[page, setPage\] = useState<MainPagerPage>\(resolvedInitialPage\)/, 'compatible route aliases seed one retained pager authority')
  assert.match(pagerSource, /useState<ReadonlySet<MainPagerPage>>[\s\S]*new Set\(\[resolvedInitialPage\]\)/, 'the pager defers unvisited heavy trees')
  assert.match(pagerSource, /if \(!mountedPages\.has\(item\.id\) && item\.id !== page\) return null[\s\S]*?<PagerPage[\s\S]*?key=\{item\.id\}[\s\S]*?active=\{active\}[\s\S]*?direction=\{direction\}[\s\S]*?\{item\.node\}[\s\S]*?<\/PagerPage>/, 'visited page trees retain state while unvisited trees stay deferred')
  assert.doesNotMatch(pagerSource, /MainPagerExperience|ThemeNavigationDrawer|AppTopBar|shellNavigation/, 'the pager owns no global top bar, drawer, or hidden shell navigation authority')
  assert.match(pagerSource, /<IsleMotionFrame[\s\S]*role="page"[\s\S]*direction=\{direction\}[\s\S]*importantForAccessibility=\{active \? 'auto' : 'no-hide-descendants'\}[\s\S]*pointerEvents=\{active \? 'auto' : 'none'\}/, 'inactive routes keep semantic motion without intercepting input or accessibility')
  assert.doesNotMatch(pagerSource, /transitionRequest|readinessToken|handlePagerPageReady|requestPagerPageChild|withTiming|withSpring|GestureDetector|Animated\.View/, 'route navigation avoids readiness handshakes and feature-owned animation primitives')
  assert.match(pagerSource, /styles\.opaqueFallback[\s\S]*colors\.background\.canvas/, 'the route pager has an opaque canvas fallback that matches the immersive screen')
  assert.match(chatActiveChromeSource, /if \(showOptions\)[\s\S]*setShowOptions\(false\)[\s\S]*goHistory\(\)/, 'the direct Chat header delegates Back to the workspace return authority after closing local options')
  assert.doesNotMatch(chatActiveChromeSource, /router\.canGoBack\(\)|router\.back\(\)/, 'the direct Chat chrome does not create a second history-stack return authority')
  assert.match(chatDeepLinkSource, /resolveConversationReturnAction\(params\.returnTo, router\.canGoBack\(\)\)[\s\S]*action\.kind === 'back'[\s\S]*router\.back\(\)[\s\S]*router\.replace\(action\.pathname\)/, 'Chat deep links resolve an explicit safe parent before navigating')
  assert.match(chatDeepLinkSource, /showBack[\s\S]*onHistory=\{returnToPreviousSurface\}/, 'active Chat deep links share the same explicit return authority with header and hardware Back')
  assert.match(chatDeepLinkSource, /Platform\.OS !== 'android' \|\| conversation[\s\S]*BackHandler\.addEventListener\('hardwareBackPress'[\s\S]*returnToPreviousSurface\(\)[\s\S]*return true/, 'a missing Chat deep link owns the no-history Android fallback without racing active workspace overlays')
  assert.match(chatWorkspaceSource, /const goBack = useCallback\(\(\) => \{[\s\S]*if \(showBack && onHistory\)[\s\S]*onHistory\(\)[\s\S]*router\.canGoBack\(\)[\s\S]*goHistory\(\)[\s\S]*onUnhandledAndroidBack: showBack \? goBack : undefined/, 'active Chat deep links delegate explicit-origin Back through the workspace overlay controller')
  assert.match(chatWorkspaceLifecycleSource, /if \(workspaceReviewOpen\)[\s\S]*if \(showOptions\)[\s\S]*if \(composerPanel\)[\s\S]*if \(intentDraft\)[\s\S]*if \(keyboardVisible\)[\s\S]*Keyboard\.dismiss\(\)[\s\S]*if \(onUnhandledAndroidBack\)[\s\S]*onUnhandledAndroidBack\(\)/, 'Android Back closes modal state and the keyboard before leaving a direct Chat route')
  assert.match(sourceRouteSource, /const returnToConversation = useCallback\(\(\) => \{[\s\S]*router\.canGoBack\(\)[\s\S]*pathname: '\/chat\/\[id\]'[\s\S]*id: conversationId[\s\S]*router\.replace\('\/'\)/, 'source details return to their exact conversation or Home instead of dead-ending without history')
  assert.match(sourceRouteSource, /BackHandler\.addEventListener\('hardwareBackPress'[\s\S]*returnToConversation\(\)[\s\S]*return true/, 'Android hardware Back uses the same safe source return chain')
  assert.match(settingsPageShellSource, /resolveSettingsChildReturnAction\(params\.returnTo, router\.canGoBack\(\)\)[\s\S]*action\.kind === 'back'[\s\S]*router\.back\(\)[\s\S]*router\.replace\(action\.pathname\)/, 'Settings child headers use explicit parent intent and a safe direct-link fallback')
  assert.match(settingsPageShellSource, /BackHandler\.addEventListener\('hardwareBackPress'[\s\S]*if \(keyboardHeight > 0\)[\s\S]*Keyboard\.dismiss\(\)[\s\S]*returnToSettings\(\)/, 'Settings child Android Back dismisses the keyboard before leaving through the safe return chain')
  assert.match(settingsPageShellSource, /onNavigate=\{returnToSettings\}/, 'every shared Settings child header uses the same return authority')
  assert.match(providerSettingsRouteSource, /BackHandler\.addEventListener\('hardwareBackPress'[\s\S]*navigateBackFromProviderSettings\(\)/, 'Provider Settings hardware Back preserves the retained parent when one exists')
  assert.doesNotMatch(providerSettingsRouteSource, /closeProviderSettings/, 'Provider Settings has no second replace-only return authority')
  assert.match(usageSettingsRouteSource, /resolveSettingsChildReturnAction\(params\.returnTo, router\.canGoBack\(\)\)[\s\S]*router\.replace\(action\.pathname\)[\s\S]*BackHandler\.addEventListener\('hardwareBackPress'[\s\S]*goBack\(\)/, 'Usage Settings shares the explicit header and Android return chain')
  assert.match(routeReturnPolicySource, /type RouteReturnIntent = 'chat' \| 'history' \| 'settings'[\s\S]*resolveConversationReturnAction[\s\S]*resolveSettingsChildReturnAction/, 'return intent is a closed presentation policy rather than an arbitrary route parameter')
  assert.match(conversationsScreenSource, /pathname: '\/chat\/\[id\]'[\s\S]*returnTo: 'history'/, 'History marks its Chat destination with an explicit History return intent')
  assert.match(settingsScreenSource, /function pushSettingsChildRoute[\s\S]*returnTo: 'settings'/, 'Settings marks every owned child route with an explicit Settings return intent')
  assert.match(chatSettingsRoutesSource, /function pushChatSettingsRoute[\s\S]*returnTo: 'chat'/, 'Chat marks Settings child routes so they can return to the originating Chat stack')
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
  assertCurrentApkDeviceSelection()
  assertCurrentApkInstallerTargeting()
  assertCurrentApkInstallerPreflight()
  assertCurrentApkStagingFilesystem()
  assertReleaseSourceSnapshotBinding()
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

function currentApkDeviceFixtures() {
  const blocked = [
    { name: 'absent default with an unrelated phone', inventory: 'unrelated-phone\tdevice' },
    { name: 'absent default with another emulator', inventory: 'emulator-5556\tdevice' },
    { name: 'empty inventory', inventory: '' },
    { name: 'failed inventory command', inventoryError: true },
    ...['offline', 'unauthorized', 'bootloader', 'recovery', 'no permissions'].map((state) => ({
      name: `default emulator is ${state}`,
      inventory: `unrelated-phone\tdevice\nemulator-5554\t${state}`,
    })),
    { name: 'duplicate ready default', inventory: 'emulator-5554\tdevice\nemulator-5554\tdevice' },
    { name: 'conflicting default states', inventory: 'emulator-5554\tdevice\nemulator-5554\toffline' },
    { name: 'prefix is not exact identity', inventory: 'emulator-55540\tdevice' },
    { name: 'explicit target is missing', requested: 'authorized-phone', inventory: 'emulator-5554\tdevice\nunrelated-phone\tdevice' },
    { name: 'explicit target is offline', requested: 'authorized-phone', inventory: 'authorized-phone\toffline\nemulator-5554\tdevice' },
    { name: 'explicit target is unauthorized', requested: 'authorized-phone', inventory: 'authorized-phone\tunauthorized\nunrelated-phone\tdevice' },
    { name: 'duplicate explicit target', requested: 'authorized-phone', inventory: 'authorized-phone\tdevice\nauthorized-phone\tdevice' },
    { name: 'conflicting explicit states', requested: 'authorized-phone', inventory: 'authorized-phone\tdevice\nauthorized-phone\tunauthorized' },
    ...['', ' ', ' authorized-phone ', 'authorized-phone\n', 'authorized-phone\0'].map((requested) => ({
      name: `invalid explicit serial ${JSON.stringify(requested)}`,
      requested,
      inventory: `emulator-5554\tdevice\nauthorized-phone\tdevice\n${requested}\tdevice`,
      invalidSerial: true,
    })),
  ]
  const admitted = [
    { name: 'sole default emulator', inventory: 'emulator-5554\tdevice', expected: 'emulator-5554' },
    { name: 'default after unrelated phone', inventory: 'unrelated-phone\tdevice\nemulator-5554\tdevice', expected: 'emulator-5554' },
    { name: 'default before unrelated phone', inventory: 'emulator-5554\tdevice\nunrelated-phone\tdevice', expected: 'emulator-5554' },
    { name: 'unrelated unready entries', inventory: 'offline-phone\toffline\nemulator-5554\tdevice\nuntrusted-phone\tunauthorized', expected: 'emulator-5554' },
    { name: 'explicit authorized phone', requested: 'authorized-phone', inventory: 'authorized-phone\tdevice', expected: 'authorized-phone' },
    { name: 'explicit phone beats default', requested: 'authorized-phone', inventory: 'emulator-5554\tdevice\nauthorized-phone\tdevice', expected: 'authorized-phone' },
    { name: 'explicit different emulator', requested: 'emulator-5556', inventory: 'emulator-5554\tdevice\nemulator-5556\tdevice', expected: 'emulator-5556' },
    { name: 'explicit TCP serial', requested: '192.0.2.1:5555', inventory: 'unrelated-phone\tdevice\n192.0.2.1:5555\tdevice', expected: '192.0.2.1:5555' },
    { name: 'explicit mDNS serial', requested: 'adb-fixture._adb-tls-connect._tcp', inventory: 'adb-fixture._adb-tls-connect._tcp\tdevice', expected: 'adb-fixture._adb-tls-connect._tcp' },
    { name: 'ADB whitespace and metadata', requested: 'authorized-phone', inventory: '\n  authorized-phone\tdevice product:fixture model:fixture transport_id:1\r\n', expected: 'authorized-phone' },
  ]
  return { blocked, admitted }
}

function assertCurrentApkDeviceSelection() {
  const { blocked, admitted } = currentApkDeviceFixtures()
  for (const fixture of blocked) {
    const { result, commands, exitCode } = runCurrentApkFixture(fixture)
    assert.deepEqual(commands.filter(({ args }) => args[0] !== 'devices'), [], `${fixture.name}: no device command or compatibility subprocess is admitted`)
    if (fixture.invalidSerial) assert.deepEqual(commands, [], `${fixture.name}: invalid configuration does not start ADB`)
    assert.equal(result.device, null, `${fixture.name}: no fallback target`)
    assert.equal(result.installed, null, `${fixture.name}: no installed-package read`)
    assert.equal(result.launch.ok, false, `${fixture.name}: failed launch receipt`)
    assert.match(result.launch.error, /QA_DEVICE_SERIAL/, `${fixture.name}: actionable target diagnostic`)
    assert.equal(result.compatibility16kb, null, `${fixture.name}: no compatibility pass fabricated`)
    assert.equal(exitCode, 1, `${fixture.name}: CLI fails`)
  }
  for (const fixture of admitted) {
    const { result, commands, exitCode } = runCurrentApkFixture(fixture)
    assert.equal(result.device, fixture.expected, fixture.name)
    assert.equal(result.installed.deviceSerial, fixture.expected, `${fixture.name}: receipt is target-scoped`)
    assert.equal(result.launch.ok, true, `${fixture.name}: synthetic launch path is retained`)
    assert.equal(result.compatibility16kb.ok, true, `${fixture.name}: synthetic compatibility path is retained`)
    assert.equal(exitCode, 0, `${fixture.name}: valid synthetic evidence passes the real release validator`)
    assert.ok(commands.some(({ args }) => args.includes('force-stop')), `${fixture.name}: selected app is stopped`)
    assert.ok(commands.some(({ args }) => args.includes('monkey')), `${fixture.name}: selected app is launched`)
    for (const { command, args } of commands.filter(({ command, args }) => command === 'adb' && args[0] !== 'devices')) {
      assert.deepEqual([command, ...args.slice(0, 2)], ['adb', '-s', fixture.expected], `${fixture.name}: every ADB operation pins the exact target`)
    }
  }

  const disconnected = runCurrentApkFixture({
    requested: 'authorized-phone',
    inventory: 'authorized-phone\tdevice\nunrelated-phone\tdevice',
    deviceDisconnected: true,
  })
  assert.equal(disconnected.result.device, 'authorized-phone', 'disconnect never reselects another device')
  assert.equal(disconnected.result.launch.ok, false, 'disconnect is a launch failure')
  assert.equal(disconnected.exitCode, 1, 'disconnect fails the CLI')
  for (const { args } of disconnected.commands.filter(({ command, args }) => command === 'adb' && args[0] !== 'devices')) {
    assert.deepEqual(args.slice(0, 2), ['-s', 'authorized-phone'], 'commands after a disconnect stay pinned instead of falling back')
  }
  console.log(`Current APK device selection: ${blocked.length + admitted.length + 1} host command-capture cases passed (no real ADB or filesystem writes)`)
}

function currentApkSourceFreshnessFixture(sha256, sizeBytes) {
  return {
    status: 'current',
    snapshot: {
      present: true,
      schema: require('./release-freshness-contract').releaseSourceSnapshotSchema,
      apk: { sha256, sizeBytes },
      comparison: { status: 'unchanged' },
    },
  }
}

function assertCurrentApkInstallerTargeting() {
  const shared = currentApkDeviceFixtures()
  const inventory = 'emulator-5554\tdevice\nauthorized-phone\tdevice\nunrelated-phone\tdevice'
  const invalidArgs = [
    ['--device'],
    ['--device='],
    ['--device', ''],
    ['--device', '--keep-data'],
    ['--device', '--device=authorized-phone'],
    ['--device=authorized-phone', '--device=unrelated-phone'],
    ['--device', 'authorized-phone', '--device=authorized-phone'],
    ['--device=unrelated-phone', '--device', 'authorized-phone'],
    ['--device', 'authorized-phone', '--device', 'unrelated-phone'],
    ['--device=authorized-phone', '--device=authorized-phone'],
    ['--device', ' authorized-phone '],
    ['--device=authorized-phone\n'],
    ['--device=authorized-phone\0'],
    ['--help'],
    ['--devcie', 'authorized-phone'],
    ['--keep-data=true'],
    ['authorized-phone'],
    ['--device=authorized-phone', 'unexpected'],
    ['--device=authorized-phone', '--bogus'],
  ]
  const blocked = [
    ...shared.blocked,
    ...invalidArgs.map((args) => ({ name: `invalid CLI ${JSON.stringify(args)}`, args, requested: 'authorized-phone', inventory, invalidSerial: true })),
    { name: 'missing CLI target cannot fall back to valid environment', args: ['--device=absent-phone'], requested: 'authorized-phone', inventory },
    { name: 'offline CLI target cannot fall back to default', args: ['--device', 'offline-phone'], inventory: `${inventory}\noffline-phone\toffline` },
    { name: 'duplicate CLI target inventory', args: ['--device=authorized-phone'], inventory: `${inventory}\nauthorized-phone\tdevice` },
  ]
  for (const fixture of blocked) {
    const { result, commands, exitCode, error } = runCurrentApkFixture({ ...fixture, kind: 'install' })
    assert.deepEqual(commands.filter(({ args }) => args[0] !== 'devices'), [], `${fixture.name}: rejected installer input sends no device commands`)
    if (fixture.invalidSerial) assert.deepEqual(commands, [], `${fixture.name}: invalid configuration cannot start ADB`)
    assert.equal(result, undefined, `${fixture.name}: no install receipt fabricated`)
    assert.equal(exitCode, 1, `${fixture.name}: installer fails`)
    assert.match(error?.message ?? '', /--device|QA_DEVICE_SERIAL|synthetic ADB inventory failure/, `${fixture.name}: targeting failure is explicit`)
  }

  const admitted = [
    ...shared.admitted,
    { name: 'spaced CLI overrides environment', args: ['--device', 'authorized-phone'], requested: 'unrelated-phone', inventory, expected: 'authorized-phone' },
    { name: 'equals CLI overrides environment', args: ['--device=authorized-phone'], requested: 'unrelated-phone', inventory, expected: 'authorized-phone' },
    { name: 'valid CLI overrides invalid environment', args: ['--device=authorized-phone'], requested: '', inventory, expected: 'authorized-phone' },
    { name: 'equals in exact serial', args: ['--device=fixture=phone'], inventory: 'fixture=phone\tdevice', expected: 'fixture=phone' },
    { name: 'keep data before target', args: ['--keep-data', '--device=authorized-phone'], inventory, expected: 'authorized-phone' },
    { name: 'keep data after target', args: ['--device', 'authorized-phone', '--keep-data'], inventory, expected: 'authorized-phone' },
    { name: 'already absent app', requested: 'authorized-phone', inventory, expected: 'authorized-phone', appMissing: true },
  ]
  for (const fixture of admitted) {
    const { result, commands, exitCode, error } = runCurrentApkFixture({ ...fixture, kind: 'install' })
    assert.equal(error, undefined, fixture.name)
    assert.equal(exitCode, 0, `${fixture.name}: synthetic install succeeds`)
    assert.equal(result.device, fixture.expected, fixture.name)
    assert.equal(result.installed.deviceSerial, fixture.expected, `${fixture.name}: provenance stays target-scoped`)
    assert.equal(result.installed.packageSha256, result.apk.sha256, `${fixture.name}: installed digest matches the artifact`)
    const keepData = fixture.args?.includes('--keep-data') ?? false
    assert.equal(result.keepData, keepData, `${fixture.name}: data-retention option is preserved`)
    const uninstalls = commands.filter(({ args }) => args[2] === 'uninstall')
    const installs = commands.filter(({ args }) => args[2] === 'install')
    assert.equal(uninstalls.length, keepData || fixture.appMissing ? 0 : 1, `${fixture.name}: uninstall only on the deliberate clean path`)
    assert.equal(installs.length, 1, `${fixture.name}: exactly one install`)
    assert.equal(installs[0].args.includes('-r'), keepData, `${fixture.name}: replacement is keep-data only`)
    if (uninstalls.length) assert.ok(commands.indexOf(uninstalls[0]) < commands.indexOf(installs[0]), `${fixture.name}: clean uninstall precedes install`)
    for (const { args } of commands.filter(({ args }) => args[0] !== 'devices')) {
      assert.deepEqual(args.slice(0, 2), ['-s', fixture.expected], `${fixture.name}: every command pins the admitted target`)
    }
  }

  const failures = [
    { name: 'missing artifact', missingApk: true, message: /APK was not found/ },
    { name: 'device disconnect', deviceDisconnected: true, message: /synthetic device disconnect/ },
    { name: 'uninstall failure', uninstallFailure: true, message: /synthetic uninstall failure/ },
    { name: 'install failure', installFailure: true, message: /synthetic install failure/ },
    { name: 'missing installed digest', installedDigest: 'missing', message: /SHA256 could not be calculated/ },
    { name: 'mismatched installed digest', installedDigest: 'mismatch', message: /SHA256 .* does not match/ },
  ]
  for (const fixture of failures) {
    const { result, commands, exitCode, error } = runCurrentApkFixture({ ...fixture, kind: 'install', requested: 'authorized-phone', inventory })
    assert.equal(exitCode, 1, `${fixture.name}: failure does not become install success`)
    assert.match(error?.message ?? '', fixture.message, fixture.name)
    if (fixture.missingApk) assert.equal(commands.some(({ args }) => args[2] === 'install' || args[2] === 'uninstall'), false, 'missing APK cannot uninstall app data')
    if (fixture.uninstallFailure) assert.equal(commands.some(({ args }) => args[2] === 'install'), false, 'uninstall failure blocks installation')
    if (fixture.installedDigest) assert.ok(result, `${fixture.name}: failed digest evidence is retained`)
    else assert.equal(result, undefined, `${fixture.name}: incomplete install has no success receipt`)
    for (const { args } of commands.filter(({ args }) => args[0] !== 'devices')) {
      assert.deepEqual(args.slice(0, 2), ['-s', 'authorized-phone'], `${fixture.name}: no fallback after admission`)
    }
  }
  console.log(`Current APK installer targeting: ${blocked.length + admitted.length + failures.length} host command-capture cases passed (no real ADB or filesystem writes)`)
}

function assertCurrentApkInstallerPreflight() {
  const snapshot = { present: true, comparison: { status: 'unchanged' } }
  const blocked = [
    { name: 'missing APK', missingApk: true, message: /APK was not found/ },
    { name: 'directory instead of APK', apkIsDirectory: true, message: /nonempty regular file/ },
    { name: 'empty APK', emptyApk: true, message: /nonempty regular file/ },
    { name: 'unreadable APK', unreadableApk: true, message: /unreadable APK/ },
    { name: 'missing sidecar', missingSidecar: true, message: /sidecar file is missing/ },
    { name: 'mismatched sidecar', sidecarText: '0'.repeat(64), message: /does not match its .sha256/ },
    { name: 'unreadable sidecar', unreadableSidecar: true, message: /unreadable sidecar/ },
    { name: 'empty sidecar', sidecarText: '', message: /sidecar file is missing/ },
    { name: 'short digest', sidecarText: 'a'.repeat(63), message: /sidecar file is missing/ },
    { name: 'long digest', sidecarText: 'a'.repeat(65), message: /sidecar file is missing/ },
    { name: 'nonhex digest', sidecarText: 'z'.repeat(64), message: /sidecar file is missing/ },
    { name: 'multiple sidecar records', sidecarText: (hash) => `${hash}\n${hash}`, message: /sidecar file is missing/ },
    { name: 'staging directory failure', stagingDirectoryFailure: true, message: /staging directory failure/ },
    { name: 'partial copy failure', copyFailure: true, message: /copy failure/ },
    { name: 'corrupt copy', corruptCopy: true, message: /does not match its .sha256/ },
    { name: 'source changes during copy', sourceChangedDuringCopy: true, message: /changed while being staged/ },
    { name: 'hash open failure', hashOpenFailure: true, message: /hash open failure/ },
    { name: 'hash read failure', hashReadFailure: true, message: /hash read failure/ },
    { name: 'freshness read failure', freshnessFailure: true, message: /freshness read failure/ },
    { name: 'missing freshness', sourceFreshness: null, message: /freshness was not collected/ },
    { name: 'unknown freshness', sourceFreshness: { status: 'unknown', snapshot }, message: /freshness could not be verified/ },
    { name: 'stale artifact', sourceFreshness: { status: 'stale', snapshot }, message: /newer than release APK/ },
    { name: 'missing source snapshot', sourceFreshness: { status: 'current', snapshot: { present: false } }, message: /matching .source-snapshot.json/ },
    { name: 'unreadable snapshot despite current mtime', sourceFreshness: { status: 'current', snapshot: { present: true, readError: 'synthetic invalid snapshot', comparison: { status: 'error' } } }, message: /matching .source-snapshot.json/ },
    { name: 'uncompared source snapshot', sourceFreshness: { status: 'current', snapshot: { present: true } }, message: /matching .source-snapshot.json/ },
    { name: 'changed source snapshot', sourceFreshness: { status: 'current', snapshot: { present: true, comparison: { status: 'changed' } } }, message: /matching .source-snapshot.json/ },
    { name: 'legacy unbound snapshot', sourceFreshness: (apk) => {
      const freshness = currentApkSourceFreshnessFixture(apk.sha256, apk.sizeBytes)
      delete freshness.snapshot.schema
      return freshness
    }, message: /not bound.*snapshot_schema_unsupported/ },
    { name: 'snapshot from another APK', sourceFreshness: (apk) => currentApkSourceFreshnessFixture('0'.repeat(64), apk.sizeBytes), message: /not bound.*apk_sha256_mismatch/ },
    { name: 'snapshot byte-count mismatch', sourceFreshness: (apk) => currentApkSourceFreshnessFixture(apk.sha256, apk.sizeBytes + 1), message: /not bound.*apk_size_mismatch/ },
    { name: 'snapshot missing binary digest', sourceFreshness: (apk) => currentApkSourceFreshnessFixture(null, apk.sizeBytes), message: /not bound.*snapshot_apk_identity_missing/ },
    { name: 'forged binding status', sourceFreshness: (apk) => ({ ...currentApkSourceFreshnessFixture('0'.repeat(64), apk.sizeBytes), artifactBinding: { status: 'matched' } }), message: /not bound.*apk_sha256_mismatch/ },
    { name: 'missing package version', packageConfig: { version: null }, message: /package.json version is missing/ },
    { name: 'missing Expo version', expoConfig: { version: null }, message: /expo.version is missing/ },
    { name: 'inconsistent versions', expoConfig: { version: '0.0.14' }, message: /versions? .*differ|expo.version differ/ },
    { name: 'missing Android package', androidConfig: { package: null }, message: /android.package is missing/ },
    { name: 'missing Android version code', androidConfig: { versionCode: null }, message: /android.versionCode is missing/ },
    { name: 'fractional Android version code', androidConfig: { versionCode: 13.5 }, message: /android.versionCode is missing/ },
  ]
  const runInstaller = (options) => runCurrentApkFixture({
    kind: 'install', requested: 'authorized-phone', inventory: 'authorized-phone\tdevice', ...options,
  })
  for (const fixture of blocked) {
    for (const keepData of [false, true]) {
      const { commands, result, exitCode, error } = runInstaller({ ...fixture, args: keepData ? ['--keep-data'] : [] })
      const afterAbi = commands.filter(({ args }) => args[0] !== 'devices' && args.slice(2).join(' ') !== 'shell getprop ro.product.cpu.abi')
      assert.deepEqual(afterAbi, [], `${fixture.name} (keep-data=${keepData}): admission must precede app-data deletion, install and package reads`)
      assert.equal(result, undefined, `${fixture.name}: no install receipt fabricated`)
      assert.equal(exitCode, 1, `${fixture.name}: installer fails closed`)
      assert.match(error?.message ?? '', fixture.message, fixture.name)
    }
  }

  const admitted = [
    { name: 'uppercase checksum', sidecarText: (hash) => hash.toUpperCase() },
    { name: 'checksum with filename', sidecarText: (hash) => `${hash}  IsleMind-0.0.13-x86_64-no-model.apk\r\n` },
    { name: 'binary checksum marker', sidecarText: (hash) => `${hash} *IsleMind-0.0.13-x86_64-no-model.apk\n` },
    { name: 'partial hash reads', partialReadBytes: 3 },
    ...['replace', 'remove'].flatMap((sourceMutation) => [false, true].map((keepData) => ({
      name: `${sourceMutation} source after admission (keep-data=${keepData})`, sourceMutation,
      args: keepData ? ['--keep-data'] : [],
    }))),
  ]
  for (const fixture of admitted) {
    const run = runInstaller(fixture)
    assert.equal(run.error, undefined, fixture.name)
    assert.equal(run.exitCode, 0, fixture.name)
    assert.equal(run.result.apk.sha256, run.apkDigest, `${fixture.name}: receipt retains the admitted copy's digest`)
    assert.equal(run.result.apk.sidecarSha256, run.apkDigest, `${fixture.name}: normalized sidecar matches`)
    assert.equal(run.result.installed.packageSha256, run.apkDigest, `${fixture.name}: installed bytes are the admitted copy`)
    assert.equal(run.result.apk.modifiedAt, run.originalModifiedAt, `${fixture.name}: copy mtime cannot launder an old APK`)
    assert.equal(run.result.apk.path, path.relative(root, run.apkPath).replace(/\\/g, '/'), `${fixture.name}: receipt identifies the original build artifact`)
    assert.equal(run.result.sourceFreshness.snapshot.comparison.status, 'unchanged', 'receipt retains observed freshness, not launch evidence')
    const firstMutation = run.events.findIndex((event) => event.kind === 'command' && ['uninstall', 'install'].includes(event.args[2]))
    const freshness = run.events.findIndex((event) => event.kind === 'freshness')
    assert.ok(freshness > run.events.findIndex((event) => event.kind === 'copy') && freshness < firstMutation, `${fixture.name}: staged preflight precedes device mutation`)
    if (fixture.partialReadBytes) {
      assert.ok(run.readRequests.length > 2, 'hashing tolerates partial reads instead of treating them as EOF')
      assert.ok(run.readRequests.every((size) => size <= 1024 * 1024), 'hashing keeps a bounded 1 MiB buffer')
    }
    const smokeIssues = require('./release-validation-contract').validateCurrentApkSmokeResult(run.result)
    assert.ok(smokeIssues.some((issue) => issue.includes('launch smoke')) && smokeIssues.some((issue) => issue.includes('16KB')), 'an install receipt cannot fabricate smoke or compatibility evidence')
  }

  const failures = [
    { name: 'receipt failure', receiptFailure: true, message: /receipt write failure/ },
    { name: 'file cleanup failure after install', cleanupFailure: 'file', message: /Temporary APK cleanup failed.*file cleanup failure/ },
    { name: 'directory cleanup failure after install', cleanupFailure: 'directory', message: /Temporary APK cleanup failed.*directory cleanup failure/ },
    { name: 'install and cleanup failure', installFailure: true, cleanupFailure: 'file', message: /install failure.*cleanup failed/, aggregate: true },
    { name: 'preflight and cleanup failure', freshnessFailure: true, cleanupFailure: 'directory', message: /freshness read failure.*cleanup failed/, aggregate: true },
  ]
  for (const fixture of failures) {
    const run = runInstaller(fixture)
    assert.equal(run.exitCode, 1, `${fixture.name}: errors remain failures`)
    assert.match(run.error?.message ?? '', fixture.message, fixture.name)
    if (fixture.aggregate) {
      assert.equal(run.error.name, 'AggregateError', 'cleanup cannot hide the primary failure')
      assert.equal(run.error.errors.length, 2, 'both original errors remain inspectable')
    }
    if (fixture.freshnessFailure) assert.equal(run.commands.some(({ args }) => ['install', 'uninstall'].includes(args[2])), false, 'cleanup failure grants no device authority')
    if (fixture.installFailure || fixture.freshnessFailure || fixture.receiptFailure) assert.equal(run.result, undefined, 'failed installation never fabricates a receipt')
    else assert.ok(run.result, 'completed install evidence survives a later cleanup failure')
  }
  console.log(`Current APK installer preflight: ${blocked.length * 2 + admitted.length + failures.length} host command-capture cases passed (no real ADB or filesystem writes)`)
}

function assertCurrentApkStagingFilesystem() {
  const os = require('node:os')
  const crypto = require('node:crypto')
  const { withStagedApk } = require('./install-current-release-apk')
  const { collectReleaseSourceFreshness, writeReleaseSourceSnapshot } = require('./release-freshness-contract')
  const { validateCurrentApkInstallPreflight } = require('./release-validation-contract')
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-install-preflight-test-'))
  const apkPath = path.join(temporaryRoot, 'release.apk')
  const sourcePath = path.join(temporaryRoot, 'app.json')
  const expected = { packageVersion: '0.0.13', expoVersion: '0.0.13', androidPackage: 'com.islemind.app', androidVersionCode: 13 }
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 17, 0x5a)
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  const oldTime = new Date(Date.now() - 86_400_000)
  let lastStagedPath
  function resetArtifact() {
    fs.writeFileSync(sourcePath, '{"fixture":"current source"}')
    fs.writeFileSync(apkPath, bytes)
    fs.utimesSync(apkPath, oldTime, oldTime)
    fs.writeFileSync(`${apkPath}.sha256`, `${sha256}  release.apk\n`)
    writeReleaseSourceSnapshot(temporaryRoot, apkPath)
  }
  function preflight(useArtifact) {
    return withStagedApk(apkPath, ({ apk, stagedApkPath }) => {
      lastStagedPath = stagedApkPath
      const sourceFreshness = collectReleaseSourceFreshness(temporaryRoot, { ...apk, path: apkPath })
      const issues = validateCurrentApkInstallPreflight({ apk, expected, sourceFreshness })
      if (issues.length) throw new Error(issues.join(' '))
      return useArtifact({ apk, stagedApkPath, sourceFreshness })
    })
  }
  function assertCleaned() {
    assert.equal(fs.existsSync(lastStagedPath), false, 'owned staging file is removed')
    assert.equal(fs.existsSync(path.dirname(lastStagedPath)), false, 'owned staging directory is removed')
    assert.equal(fs.readFileSync(sourcePath, 'utf8').includes('fixture'), true, 'unrelated source input is preserved')
  }
  try {
    for (const mutation of ['replace', 'remove']) {
      resetArtifact()
      assert.equal(preflight(({ apk, stagedApkPath, sourceFreshness }) => {
        assert.notEqual(stagedApkPath, apkPath, 'installation gets an independent artifact path')
        assert.equal(apk.sha256, sha256, 'multi-chunk file hashing matches the actual bytes')
        assert.equal(apk.sizeBytes, bytes.length, 'staged byte count is exact')
        assert.equal(apk.modifiedAt, fs.statSync(apkPath).mtime.toISOString(), 'freshness retains source mtime')
        assert.equal(sourceFreshness.reason, 'mtime_drift_same_content', 'real freshness honors content-matching snapshots despite old APK time')
        if (mutation === 'replace') {
          fs.renameSync(apkPath, `${apkPath}.previous`)
          fs.writeFileSync(apkPath, 'replacement artifact')
        } else fs.unlinkSync(apkPath)
        assert.deepEqual(fs.readFileSync(stagedApkPath), bytes, `${mutation}: source mutation cannot change staged bytes`)
        return 'staged callback complete'
      }), 'staged callback complete')
      assertCleaned()
    }

    resetArtifact()
    const callbackFailure = new Error('synthetic install callback failure')
    assert.throws(() => preflight(() => { throw callbackFailure }), (error) => error === callbackFailure, 'original error identity survives successful cleanup')
    assertCleaned()

    for (const failure of ['changed-source', 'missing-snapshot', 'unreadable-snapshot', 'mismatched-sidecar', 'mismatched-apk-snapshot']) {
      resetArtifact()
      if (failure === 'changed-source') fs.writeFileSync(sourcePath, '{"fixture":"changed source"}')
      if (failure === 'missing-snapshot') fs.unlinkSync(`${apkPath}.source-snapshot.json`)
      if (failure === 'unreadable-snapshot') fs.writeFileSync(`${apkPath}.source-snapshot.json`, '{invalid')
      if (failure === 'mismatched-sidecar') fs.writeFileSync(`${apkPath}.sha256`, '0'.repeat(64))
      if (failure === 'mismatched-apk-snapshot') {
        const staleBytes = Buffer.from('different APK with its own valid checksum but another build snapshot')
        fs.writeFileSync(apkPath, staleBytes)
        fs.writeFileSync(`${apkPath}.sha256`, crypto.createHash('sha256').update(staleBytes).digest('hex'))
        fs.utimesSync(apkPath, oldTime, oldTime)
      }
      if (failure === 'missing-snapshot' || failure === 'unreadable-snapshot') {
        const futureTime = new Date(Date.now() + 10_000)
        fs.utimesSync(apkPath, futureTime, futureTime)
        const freshness = collectReleaseSourceFreshness(temporaryRoot, { path: apkPath })
        assert.equal(freshness.status, 'unknown', `${failure}: timestamp-only freshness cannot qualify unbound evidence as current`)
      }
      let admitted = false
      assert.throws(() => preflight(() => { admitted = true }), /source-snapshot|newer than release APK|does not match/, failure)
      assert.equal(admitted, false, `${failure}: actual artifact evidence blocks the install callback`)
      assertCleaned()
    }
  } finally {
    // Each path is an exact fixture-owned file; no recursive deletion or source-tree cleanup.
    for (const file of [apkPath, `${apkPath}.previous`, `${apkPath}.sha256`, `${apkPath}.source-snapshot.json`, sourcePath]) {
      fs.rmSync(file, { force: true })
    }
    fs.rmdirSync(temporaryRoot)
  }
  console.log('Current APK staging: 8 real temporary-filesystem cases passed (no ADB, install or repository evidence writes)')
}

function assertReleaseSourceSnapshotBinding() {
  const os = require('node:os')
  const crypto = require('node:crypto')
  const contract = require('./release-freshness-contract')
  const validation = require('./release-validation-contract')
  const validators = [validation.validateCurrentApkInstallPreflight, validation.validateCurrentApkSmokeResult, validation.validateReleaseProvenance]
  const smoke = runCurrentApkFixture({ inventory: 'emulator-5554\tdevice' }).result
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-snapshot-binding-test-'))
  const apkPath = path.join(temporaryRoot, 'IsleMind-0.0.13-x86_64-no-model.apk')
  const snapshotPath = `${apkPath}.source-snapshot.json`
  const sourcePath = path.join(temporaryRoot, 'app.json')
  const extraInput = path.join(temporaryRoot, 'babel.config.js')
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 7, 0x61)
  const changedBytes = Buffer.from(bytes)
  changedBytes[0] = 0x62
  const digest = (value) => crypto.createHash('sha256').update(value).digest('hex')
  const apkTime = new Date(Date.now() + 60_000)
  let cases = 0
  function reset() {
    if (fs.existsSync(apkPath) && fs.statSync(apkPath).isDirectory()) fs.rmdirSync(apkPath)
    fs.rmSync(extraInput, { force: true })
    fs.writeFileSync(sourcePath, '{"fixture":"source A"}')
    fs.writeFileSync(apkPath, bytes)
    fs.utimesSync(apkPath, apkTime, apkTime)
    contract.writeReleaseSourceSnapshot(temporaryRoot, apkPath)
    return JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
  }
  function observedApk() {
    const sha256 = digest(fs.readFileSync(apkPath))
    return { path: apkPath, exists: true, sha256, sidecarSha256: sha256, sizeBytes: fs.statSync(apkPath).size, modifiedAt: fs.statSync(apkPath).mtime.toISOString() }
  }
  function assertAdmission(apk, sourceFreshness, admitted, label) {
    const result = { ...smoke, appPackageName: 'com.islemind.app', apk, sourceFreshness, installed: { ...smoke.installed, packageSha256: apk.sha256 } }
    for (const validate of validators) {
      const issues = validate(result)
      if (admitted) assert.deepEqual(issues, [], `${label}: ${validate.name}`)
      else assert.ok(issues.some((issue) => /source|snapshot|stale APK/i.test(issue)), `${label}: ${validate.name} must reject source evidence: ${issues.join('; ')}`)
    }
    assert.equal(contract.isReleaseSourceSnapshotCurrent(sourceFreshness, apk), admitted, `${label}: QA source qualification shares the validators' boundary`)
    cases += 1
  }
  try {
    const written = reset()
    assert.equal(written.schema, 'islemind.release-source-snapshot.v1', 'writer emits the versioned binding contract')
    assert.equal(written.apk.sha256, digest(bytes), 'snapshot records the observed multi-chunk APK digest')
    assert.equal(written.apk.sizeBytes, bytes.length, 'snapshot records the exact APK byte count')
    assertAdmission(observedApk(), contract.collectReleaseSourceFreshness(temporaryRoot, { path: apkPath }), true, 'bound writer/reader round trip')

    reset()
    fs.writeFileSync(apkPath, changedBytes)
    fs.utimesSync(apkPath, apkTime, apkTime)
    const swapped = contract.collectReleaseSourceFreshness(temporaryRoot, observedApk())
    assert.equal(swapped.reason, 'artifact_changed_since_snapshot', 'equal size and mtime cannot hide replaced APK bytes')
    assert.equal(swapped.artifactBinding.reason, 'apk_sha256_mismatch')
    assertAdmission(observedApk(), swapped, false, 'matching sidecar cannot bless another APK snapshot')

    for (const mutation of ['replace', 'remove']) {
      reset()
      const captured = observedApk()
      if (mutation === 'replace') fs.writeFileSync(apkPath, changedBytes)
      else fs.unlinkSync(apkPath)
      assertAdmission(captured, contract.collectReleaseSourceFreshness(temporaryRoot, captured), true, `${mutation}: captured staged-byte identity remains authoritative`)
    }
    const missing = contract.collectReleaseSourceFreshness(temporaryRoot, { path: apkPath })
    assert.equal(missing.artifactBinding.status, 'unverified', 'without captured bytes a missing path cannot prove identity')
    assertAdmission({ ...smoke.apk, path: apkPath }, missing, false, 'missing observed APK')

    const malformedSnapshots = [
      ['legacy snapshot', (snapshot) => { delete snapshot.schema }],
      ['unsupported schema', (snapshot) => { snapshot.schema = 'islemind.release-source-snapshot.v999' }],
      ['missing APK digest', (snapshot) => { delete snapshot.apk.sha256 }],
      ['malformed APK digest', (snapshot) => { snapshot.apk.sha256 = 'not-a-digest' }],
      ['missing byte count', (snapshot) => { delete snapshot.apk.sizeBytes }],
      ['fractional byte count', (snapshot) => { snapshot.apk.sizeBytes = 1.5 }],
      ['wrong byte count', (snapshot) => { snapshot.apk.sizeBytes += 1 }],
    ]
    for (const [label, mutate] of malformedSnapshots) {
      const snapshot = reset()
      mutate(snapshot)
      const original = JSON.stringify(snapshot)
      fs.writeFileSync(snapshotPath, original)
      const freshness = contract.collectReleaseSourceFreshness(temporaryRoot, observedApk())
      assertAdmission(observedApk(), freshness, false, label)
      assert.equal(fs.readFileSync(snapshotPath, 'utf8'), original, 'reading legacy/invalid evidence cannot rewrite it into new authority')
    }
    for (const invalidIdentity of [{ sha256: null }, { sha256: 'malformed' }, { sizeBytes: 0 }, { sizeBytes: '1' }, { readError: 'captured read failure' }, { exists: false }]) {
      reset()
      const captured = { ...observedApk(), ...invalidIdentity }
      const freshness = contract.collectReleaseSourceFreshness(temporaryRoot, captured)
      assert.equal(freshness.artifactBinding.status, 'unverified', 'malformed captured evidence is not replaced by a filesystem fallback')
      assertAdmission(captured, freshness, false, 'invalid captured identity')
    }
    reset()
    for (const failure of [{ exists: false }, { readError: 'known unreadable artifact' }]) {
      const freshness = contract.collectReleaseSourceFreshness(temporaryRoot, { path: apkPath, ...failure })
      assert.equal(freshness.artifactBinding.status, 'unverified', 'explicit failed observation cannot be replaced by a filesystem fallback')
      assertAdmission(observedApk(), freshness, false, 'failed observation without a captured digest')
    }

    for (const mutation of ['changed', 'added', 'removed']) {
      reset()
      if (mutation === 'changed') fs.writeFileSync(sourcePath, '{"fixture":"source B"}')
      if (mutation === 'added') fs.writeFileSync(extraInput, 'module.exports = {}')
      if (mutation === 'removed') fs.unlinkSync(sourcePath)
      const freshness = contract.collectReleaseSourceFreshness(temporaryRoot, observedApk())
      assert.equal(freshness.reason, 'content_changed_since_snapshot', `${mutation} source inputs remain blocking`)
      assertAdmission(observedApk(), freshness, false, `${mutation} source inputs`)
    }
    const relocated = reset()
    relocated.apk.path = 'previous/artifact-location.apk'
    relocated.apk.modifiedAt = '1970-01-01T00:00:00.000Z'
    fs.writeFileSync(snapshotPath, JSON.stringify(relocated))
    assertAdmission(observedApk(), contract.collectReleaseSourceFreshness(temporaryRoot, observedApk()), true, 'path/time are diagnostic, not byte identity')

    const captured = observedApk()
    const forgedStatus = { status: 'current', artifactBinding: { status: 'matched' }, snapshot: { ...relocated, present: true, comparison: { status: 'unchanged' }, apk: { ...relocated.apk, sha256: '0'.repeat(64) } } }
    assertAdmission(captured, forgedStatus, false, 'validators recompute binding rather than trust a copied matched flag')

    const contractFile = path.join(root, 'scripts/release-freshness-contract.js')
    const contractSource = fs.readFileSync(contractFile, 'utf8')
    for (const failure of ['missing-apk', 'empty-apk', 'directory-apk', 'apk-read', 'source-read', 'write', 'rename', 'changed-before-publish', 'rename-and-cleanup']) {
      reset()
      const originalSnapshot = fs.readFileSync(snapshotPath, 'utf8')
      if (failure === 'missing-apk') fs.unlinkSync(apkPath)
      if (failure === 'empty-apk') fs.writeFileSync(apkPath, '')
      if (failure === 'directory-apk') { fs.unlinkSync(apkPath); fs.mkdirSync(apkPath) }
      const opened = new Map()
      const ownedTemporary = (target) => {
        assert.equal(path.dirname(target), temporaryRoot, 'snapshot publication/cleanup stays inside the exact fixture directory')
        assert.ok(target.startsWith(`${snapshotPath}.`) && target.endsWith('.tmp'), 'only the exclusive snapshot temporary file is touched')
      }
      const filesystem = {
        ...fs,
        openSync(target, ...args) { const descriptor = fs.openSync(target, ...args); opened.set(descriptor, target); return descriptor },
        readSync(descriptor, ...args) {
          if ((failure === 'apk-read' && opened.get(descriptor) === apkPath) || (failure === 'source-read' && opened.get(descriptor) === sourcePath)) throw new Error(`synthetic ${failure} failure`)
          return fs.readSync(descriptor, ...args)
        },
        closeSync(descriptor) { fs.closeSync(descriptor); opened.delete(descriptor) },
        writeFileSync(target, content, options) {
          ownedTemporary(target)
          assert.equal(options.flag, 'wx', 'snapshot publication uses exclusive temporary creation')
          fs.writeFileSync(target, failure === 'write' ? '{partial' : content, options)
          if (failure === 'write') throw new Error('synthetic snapshot write failure')
          if (failure === 'changed-before-publish') fs.appendFileSync(apkPath, 'changed after snapshot serialization')
        },
        renameSync(from, to) {
          ownedTemporary(from)
          assert.equal(to, snapshotPath, 'publication replaces only the requested snapshot')
          if (failure === 'rename' || failure === 'rename-and-cleanup') throw new Error('synthetic snapshot rename failure')
          fs.renameSync(from, to)
        },
        rmSync(target, options) {
          ownedTemporary(target)
          assert.equal(options.recursive, undefined, 'snapshot temporary cleanup is not recursive')
          if (failure === 'rename-and-cleanup') throw new Error('synthetic snapshot cleanup failure')
          fs.rmSync(target, options)
        },
      }
      const fixtureModule = { exports: {} }
      vm.runInNewContext(contractSource, { module: fixtureModule, Buffer, require(name) {
        if (name === 'node:fs') return filesystem
        assert.ok(['node:path', 'node:crypto', './model-catalog'].includes(name), `unexpected snapshot dependency ${name}`)
        return require(name)
      } }, { filename: contractFile, timeout: 1000 })
      assert.throws(() => fixtureModule.exports.writeReleaseSourceSnapshot(temporaryRoot, apkPath), (error) => {
        if (failure === 'rename-and-cleanup') assert.equal(error.errors?.length, 2, 'cleanup failure preserves the primary publication failure')
        return /ENOENT|nonempty regular APK|synthetic|APK changed/.test(error.message)
      }, failure)
      assert.equal(opened.size, 0, `${failure}: read descriptors close`)
      assert.equal(fs.readFileSync(snapshotPath, 'utf8'), originalSnapshot, `${failure}: failed publication preserves the preceding snapshot`)
      const leftovers = fs.readdirSync(temporaryRoot).filter((name) => name.endsWith('.tmp'))
      assert.equal(leftovers.length, failure === 'rename-and-cleanup' ? 1 : 0, `${failure}: temporary cleanup is exact`)
      for (const name of leftovers) fs.rmSync(path.join(temporaryRoot, name), { force: true })
      cases += 1
    }
  } finally {
    for (const name of fs.readdirSync(temporaryRoot)) {
      const target = path.join(temporaryRoot, name)
      if (target === apkPath && fs.statSync(target).isDirectory()) fs.rmdirSync(target)
      else fs.rmSync(target, { force: true })
    }
    fs.rmdirSync(temporaryRoot)
  }
  console.log(`Release source binding: ${cases} host artifact/validator/publication cases passed (temporary files only, no ADB)`)
}

function runCurrentApkFixture(options) {
  // Replace CLI filesystem/process effects with in-memory I/O; shared pure validators remain real.
  const isInstaller = options.kind === 'install'
  const file = path.join(root, 'scripts', isInstaller ? 'install-current-release-apk.js' : 'collect-current-apk-smoke.js')
  const source = fs.readFileSync(file, 'utf8')
  const commands = []
  const events = []
  const digest = (bytes) => require('node:crypto').createHash('sha256').update(bytes).digest('hex')
  let apkBytes = Buffer.from(options.emptyApk ? '' : 'synthetic current-APK selection fixture')
  const apkDigest = digest(apkBytes)
  const apkPath = path.join(root, 'dist-apk', 'IsleMind-0.0.13-x86_64-no-model.apk')
  const originalModifiedMs = Date.now() - 86_400_000
  let sourceChanged = false
  let sourcePresent = !options.missingApk
  let installedBytes = apkBytes
  const stagedFiles = new Map()
  const stagingDirectories = new Set()
  const descriptors = new Map()
  const readRequests = []
  const fixtureProcess = { env: {}, argv: [process.execPath, file, ...(options.args ?? [])], execPath: process.execPath, exitCode: undefined }
  if (Object.hasOwn(options, 'requested')) fixtureProcess.env.QA_DEVICE_SERIAL = options.requested
  const fixtureModule = { exports: {} }
  let result
  let error
  let appInstalled = !options.appMissing
  let time = Date.now()
  const modules = {
    'node:path': path,
    'node:os': { tmpdir: () => path.join(root, 'virtual-temp') },
    'node:crypto': require('node:crypto'),
    'node:fs': {
      constants: fs.constants,
      mkdirSync() {},
      existsSync: (target) => stagedFiles.has(target) || stagingDirectories.has(target)
        || (target === apkPath && sourcePresent) || (target === `${apkPath}.sha256` && !options.missingSidecar),
      statSync(target) {
        const original = target === apkPath
        assert.ok(original || stagedFiles.has(target), `Unexpected stat: ${target}`)
        if (original && !sourcePresent) throw new Error('synthetic missing source APK')
        const mtimeMs = original ? originalModifiedMs + (sourceChanged ? 1000 : 0) : time
        return {
          size: (original ? apkBytes : stagedFiles.get(target)).length,
          mtime: new Date(mtimeMs), mtimeMs, ctimeMs: mtimeMs, ino: original ? 1 : 2, dev: 1,
          isFile: () => !original || !options.apkIsDirectory,
        }
      },
      readFileSync(target) {
        if (path.basename(target) === 'package.json') return JSON.stringify({ version: '0.0.13', ...options.packageConfig })
        if (path.basename(target) === 'app.json') return JSON.stringify({ expo: {
          version: '0.0.13', ...options.expoConfig,
          android: { package: 'com.islemind.app', versionCode: 13, ...options.androidConfig },
        } })
        if (target.endsWith('.apk.sha256')) {
          if (options.unreadableSidecar) throw new Error('synthetic unreadable sidecar')
          if (sourceChanged && options.sourceMutation) return digest(apkBytes)
          return typeof options.sidecarText === 'function' ? options.sidecarText(apkDigest) : options.sidecarText ?? apkDigest
        }
        if (target === apkPath) {
          if (!sourcePresent || options.unreadableApk) throw new Error('synthetic unreadable APK')
          return apkBytes
        }
        if (stagedFiles.has(target)) return stagedFiles.get(target)
        assert.fail(`Unexpected fixture read: ${target}`)
      },
      mkdtempSync(prefix) {
        if (options.stagingDirectoryFailure) throw new Error('synthetic staging directory failure')
        const directory = `${prefix}fixture`
        assert.equal(stagingDirectories.size, 0, 'each invocation owns one unique staging directory')
        stagingDirectories.add(directory)
        return directory
      },
      copyFileSync(from, to, flags) {
        assert.equal(from, apkPath)
        assert.equal(flags, fs.constants.COPYFILE_EXCL, 'staging cannot overwrite an existing artifact')
        assert.ok(stagingDirectories.has(path.dirname(to)), 'copy is confined to the owned directory')
        events.push({ kind: 'copy', from, to })
        if (options.unreadableApk) throw new Error('synthetic unreadable APK')
        if (options.copyFailure) {
          stagedFiles.set(to, Buffer.from('partial copy'))
          throw new Error('synthetic copy failure')
        }
        if (options.sourceChangedDuringCopy) sourceChanged = true
        stagedFiles.set(to, options.corruptCopy ? Buffer.from('corrupt copied APK') : Buffer.from(apkBytes))
      },
      openSync(target, mode) {
        assert.equal(mode, 'r')
        assert.ok(stagedFiles.has(target), 'hashing reads only the staged copy')
        if (options.hashOpenFailure) throw new Error('synthetic hash open failure')
        const descriptor = 42
        descriptors.set(descriptor, { bytes: stagedFiles.get(target), position: 0 })
        return descriptor
      },
      readSync(descriptor, buffer, offset, length, position) {
        assert.equal(position, null, 'hash reads advance the descriptor')
        const opened = descriptors.get(descriptor)
        assert.ok(opened, 'hash descriptor is open')
        readRequests.push(length)
        if (options.hashReadFailure) throw new Error('synthetic hash read failure')
        const count = Math.min(length, options.partialReadBytes ?? length, opened.bytes.length - opened.position)
        opened.bytes.copy(buffer, offset, opened.position, opened.position + count)
        opened.position += count
        return count
      },
      closeSync(descriptor) {
        assert.ok(descriptors.delete(descriptor), 'hash descriptor is closed exactly once')
      },
      rmSync(target, config) {
        assert.equal(path.basename(target), 'install.apk', 'cleanup cannot delete the source artifact')
        assert.ok(stagingDirectories.has(path.dirname(target)), 'cleanup stays in the owned staging directory')
        assert.equal(config.recursive, undefined, 'artifact cleanup is not recursive')
        events.push({ kind: 'cleanup-file', target })
        if (options.cleanupFailure === 'file') throw new Error('synthetic file cleanup failure')
        stagedFiles.delete(target)
      },
      rmdirSync(target) {
        assert.ok(stagingDirectories.has(target), 'only the owned empty directory is removed')
        assert.equal(stagedFiles.size, 0, 'staged APK is removed before its directory')
        events.push({ kind: 'cleanup-directory', target })
        if (options.cleanupFailure === 'directory') throw new Error('synthetic directory cleanup failure')
        stagingDirectories.delete(target)
      },
      writeFileSync(target, content) {
        assert.equal(target, path.join(root, 'test-evidence/qa', isInstaller ? 'current-apk-install-results.json' : 'current-apk-smoke-results.json'))
        assert.equal(result, undefined, 'CLI writes exactly one final receipt')
        if (options.receiptFailure) throw new Error('synthetic receipt write failure')
        events.push({ kind: 'receipt', target })
        result = JSON.parse(content)
      },
    },
    'node:child_process': {
      execFileSync(command, args) {
        commands.push({ command, args: Array.from(args) })
        events.push({ kind: 'command', command, args: Array.from(args) })
        assert.equal(command, 'adb', 'collector uses only the captured ADB command')
        if (args.length === 1 && args[0] === 'devices') {
          if (options.inventoryError) throw new Error('synthetic ADB inventory failure')
          return `List of devices attached\r\n${options.inventory ?? ''}\r\n`
        }
        if (options.deviceDisconnected) throw new Error('synthetic device disconnect')
        const operation = args.slice(2).join(' ')
        if (options.sourceMutation && !sourceChanged && (args[2] === 'uninstall' || args[2] === 'install')) {
          sourceChanged = true
          if (options.sourceMutation === 'remove') sourcePresent = false
          else apkBytes = Buffer.from('replaced source APK after admission')
        }
        if (args[2] === 'uninstall') {
          if (options.uninstallFailure) throw new Error('synthetic uninstall failure')
          appInstalled = false
          return 'Success'
        }
        if (args[2] === 'install') {
          if (options.installFailure) throw new Error('synthetic install failure')
          const target = args.at(-1)
          assert.ok(stagedFiles.has(target), 'ADB must consume the staged copy, not the mutable source path')
          installedBytes = stagedFiles.get(target)
          appInstalled = true
          return 'Success'
        }
        if (operation === 'shell am force-stop com.islemind.app') return ''
        if (operation === 'shell dumpsys package com.islemind.app') return 'versionName=0.0.13\nversionCode=13\nprimaryCpuAbi=x86_64\nfirstInstallTime=2026-07-18 00:00:00\nlastUpdateTime=2026-07-18 00:00:00'
        if (operation === 'shell pm path com.islemind.app') return appInstalled ? 'package:/data/app/com.islemind.app/base.apk' : ''
        if (operation === 'shell sha256sum /data/app/com.islemind.app/base.apk') {
          if (options.installedDigest === 'missing') return ''
          return `${options.installedDigest === 'mismatch' ? '0'.repeat(64) : digest(installedBytes)}  /data/app/com.islemind.app/base.apk`
        }
        if (operation === 'shell getprop ro.product.cpu.abi') return 'x86_64'
        if (operation === 'shell getprop debug.hwui.renderer') return ''
        if (operation === 'shell getprop ro.kernel.qemu') return '1'
        if (operation === 'shell pidof com.islemind.app') return '4242'
        if (operation === 'shell dumpsys window windows' || operation === 'shell dumpsys gfxinfo com.islemind.app' || args[2] === 'logcat') return ''
        assert.fail(`Unexpected fixture ADB operation: ${operation}`)
      },
      spawnSync(command, args) {
        commands.push({ command, args: Array.from(args) })
        if (command === 'adb' && args[3] === 'monkey') return { status: options.deviceDisconnected ? 1 : 0, stdout: '', stderr: '' }
        assert.equal(command, process.execPath)
        assert.equal(args[0], 'scripts/validate-android-16kb-apk.js')
        return { status: 0, stdout: '16 KB APK validation passed\nZIP page alignment: OK\nELF LOAD alignment: OK for 64-bit ABIs', stderr: '' }
      },
    },
    './release-artifact-contract': require('./release-artifact-contract'),
    './release-freshness-contract': { collectReleaseSourceFreshness: (_root, apk) => {
      events.push({ kind: 'freshness', apk })
      if (options.freshnessFailure) throw new Error('synthetic freshness read failure')
      if (typeof options.sourceFreshness === 'function') return options.sourceFreshness(apk)
      return Object.hasOwn(options, 'sourceFreshness') ? options.sourceFreshness : currentApkSourceFreshnessFixture(apk?.sha256, apk?.sizeBytes)
    } },
    './release-validation-contract': require('./release-validation-contract'),
  }
  const fixtureRequire = (name) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected collector dependency: ${name}`)
    return modules[name]
  }
  fixtureRequire.main = fixtureModule
  try {
    vm.runInNewContext(source, {
      require: fixtureRequire,
      module: fixtureModule,
      __dirname: path.dirname(file),
      process: fixtureProcess,
      Buffer,
      console: { log() {} },
      Atomics: { wait() {} },
      Date: class extends Date { static now() { time += 1000; return time } },
    }, { filename: file, timeout: 1000 })
  } catch (caught) {
    if (!isInstaller || caught.code === 'ERR_ASSERTION') throw caught
    error = caught
  }
  if (!isInstaller) assert.ok(result, 'smoke CLI produces an in-memory result')
  assert.equal(descriptors.size, 0, 'hash descriptors close on every success/failure path')
  if (!options.cleanupFailure) {
    assert.equal(stagedFiles.size, 0, 'all owned staged bytes are cleaned after success or failure')
    assert.equal(stagingDirectories.size, 0, 'all owned staging directories are cleaned after success or failure')
  }
  return {
    result, commands, error, events, readRequests, apkPath, apkDigest,
    originalModifiedAt: new Date(originalModifiedMs).toISOString(),
    stagedFiles: [...stagedFiles.keys()], stagingDirectories: [...stagingDirectories],
    openDescriptors: [...descriptors.keys()],
    exitCode: error ? 1 : fixtureProcess.exitCode ?? 0,
  }
}

function assertReleaseVersionMonotonicity() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  const updateManifest = JSON.parse(fs.readFileSync(path.join(root, 'updates', 'android.json'), 'utf8'))
  assertCandidateVersionRelationship(packageJson, appJson, updateManifest)

  const candidate = { version: '2.0.0' }
  const app = { expo: { version: '2.0.0', android: { versionCode: 200 } } }
  const published = { versionName: '1.0.0', versionCode: 100 }
  assertCandidateVersionRelationship(candidate, app, published)
  assert.throws(() => assertCandidateVersionRelationship(candidate, app, { ...published, versionCode: 200 }))
  assert.throws(() => assertCandidateVersionRelationship(candidate, app, { ...published, versionName: '2.0.0' }))
  assert.throws(() => assertCandidateVersionRelationship(candidate, app, { ...published, versionName: '3.0.0' }))
  const qualification = { versionName: '2.0.0', versionCode: 200, status: 'prerelease-qualification', assets: [], publishedAt: null }
  assertCandidateVersionRelationship(candidate, app, qualification)
  for (const invalid of [
    { ...qualification, versionName: '1.0.0' },
    { ...qualification, versionCode: 199 },
    { ...qualification, assets: [{ name: 'unexpected.apk' }] },
    { ...qualification, publishedAt: '2026-09-19T00:00:00Z' },
  ]) assert.throws(() => assertCandidateVersionRelationship(candidate, app, invalid))
}

function assertCandidateVersionRelationship(packageJson, appJson, updateManifest) {
  const packageVersion = String(packageJson.version ?? '')
  const expoVersion = String(appJson?.expo?.version ?? '')
  const androidVersionCode = Number(appJson?.expo?.android?.versionCode)
  const publishedVersion = String(updateManifest.versionName ?? '')
  const publishedVersionCode = Number(updateManifest.versionCode)

  assert.equal(packageVersion, expoVersion, 'package and Expo versions remain synchronized')
  assert.ok(Number.isSafeInteger(androidVersionCode) && androidVersionCode > 0, 'candidate versionCode must be a positive integer')
  assert.ok(Number.isSafeInteger(publishedVersionCode) && publishedVersionCode > 0, 'manifest versionCode must be a positive integer')
  if (updateManifest.status === 'prerelease-qualification') {
    // An asset-free qualification manifest describes this source candidate,
    // not a previously published binary against which monotonicity is measured.
    assert.equal(packageVersion, publishedVersion, 'qualification version must match the source candidate')
    assert.equal(androidVersionCode, publishedVersionCode, 'qualification versionCode must match the source candidate')
    assert.deepEqual(updateManifest.assets, [], 'qualification cannot advertise installable APKs')
    assert.equal(updateManifest.publishedAt, null, 'qualification cannot claim a publication date')
    return
  }
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
    [
      'appearance-minimal-light',
      'appearance-minimal-dark',
      'appearance-monet-light',
      'appearance-monet-dark',
      'appearance-material-light',
      'appearance-material-dark',
      'appearance-liquid-glass-light',
      'appearance-liquid-glass-dark-custom-indigo',
    ]
      .every((step) => settingsCollectorSource.includes(step)),
    'settings native evidence retains every canonical family in light/dark plus a custom-accent matrix row',
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
  assert.ok(keyVisualCollectorSource.includes('home-session-options-configuration-open'), 'Chat session-option evidence names the current header configuration surface')
  assert.doesNotMatch(keyVisualCollectorSource, /home-session-options-orb-open/, 'Chat evidence cannot reuse the retired floating-orb capture identity')
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
    sourceFreshness: currentApkSourceFreshnessFixture(expectedApkSha256, 1),
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
  const bootFallbackSource = rootLayoutSource.match(/function BootFallback\([\s\S]*?\n}\n\ntype WebThemeRoot/)?.[0] ?? ''
  const useBootstrapSource = fs.readFileSync(path.join(root, 'src/hooks/useBootstrap.ts'), 'utf8')
  assert.match(bootFallbackSource, /<SafeAreaView\b/, 'cold-start fallback owns a static native safe-area surface')
  assert.match(bootFallbackSource, /<ActivityIndicator\b/, 'cold-start fallback uses the native activity indicator')
  assert.doesNotMatch(bootFallbackSource, /IsleScreen|IsleBackground|HighFrameSpinner|Moti|Reanimated/, 'cold-start fallback does not mount a design-system worklet surface')
  assert.match(rootLayoutSource, /<BootFallback status=\{boot\.status\} failure=\{boot\.failure\} onRetry=\{boot\.retry\}/, 'RootLayout projects the explicit bootstrap state and retry authority')
  assert.match(bootFallbackSource, /status === 'blocked' && failure[\s\S]*accessibilityRole="alert"[\s\S]*failure\.message[\s\S]*failure\.reference[\s\S]*common\.retry/, 'blocked bootstrap state is visible, accessible, diagnosable, and retryable')
  assert.doesNotMatch(bootFallbackSource, /router\.|skip|continue/i, 'blocked bootstrap recovery cannot bypass the fail-closed startup gate')
  assert.match(useBootstrapSource, /type BootstrapStatus = 'loading' \| 'ready' \| 'blocked'/, 'bootstrap exposes an explicit finite status model')
  assert.match(useBootstrapSource, /function blockBootstrap[\s\S]*status: 'blocked'[\s\S]*ready: false[\s\S]*failure: \{ reference, message \}/, 'blocking startup failures terminate the spinner with stable diagnostics')
  assert.match(useBootstrapSource, /function blockBootstrap[\s\S]*if \(!mounted \|\| recoveryController\.signal\.aborted\) return[\s\S]*useChatStore\.getState\(\)\.setError\(message\)/, 'aborted bootstrap attempts cannot publish a stale failure over a newer retry')
  assert.match(useBootstrapSource, /const retry = useCallback[\s\S]*status: 'loading'[\s\S]*setAttempt\(\(current\) => current \+ 1\)/, 'bootstrap retry restarts the guarded recovery attempt without opening the app early')
  assert.match(useBootstrapSource, /blockingFailureReference[^]*'BOOT-PORTABLE-RECOVERY'[^]*await recoverInterruptedPortableImport\(\)[^]*status === 'recovery_required'[^]*throw new Error[^]*blockingFailureReference = 'BOOT-STARTUP'[^]*initializePortableDataApplication\(\)/, 'portable import recovery remains the fail-closed first startup gate')

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
  assert.match(mainPagerSource, /const resolvedInitialPage = routePage \?\? initialPage[\s\S]*const \[page, setPage\] = useState<MainPagerPage>\(resolvedInitialPage\)/, 'the current route selects the cold-start alias while one local pager owns in-app top-level state')
  assert.doesNotMatch(mainPagerSource, /const page = routePage \?\? initialPage|lastResolvedPage/, 'route aliases do not keep remounting top-level page trees after startup')
  assert.match(mainPagerSource, /if \(!mountedPages\.has\(item\.id\) && item\.id !== page\) return null[\s\S]*?<PagerPage[\s\S]*?key=\{item\.id\}[\s\S]*?active=\{active\}[\s\S]*?direction=\{direction\}[\s\S]*?\{item\.node\}[\s\S]*?<\/PagerPage>/, 'the pager retains visited page state without paying every page render cost up front')
  assert.doesNotMatch(mainPagerSource, /ANDROID_HOME_CHILD_DIAGNOSTIC_DELAY_MS|homeBoundaryDiagnostic|pagerHomeBoundary|\[islemind:pager-home-boundary\]/, 'resolved pager crash-bisect delays and markers remain deleted')
  const switchToSource = mainPagerSource.match(/function switchTo\(next: MainPagerPage\) \{[\s\S]*?\n  \}/)?.[0] ?? ''
  assert.match(switchToSource, /setMountedPages\([\s\S]*setPreviousPage\(page\)[\s\S]*setTransitionDirection\([\s\S]*if \(next === 'home' && pathname !== MAIN_PAGER_PATH_BY_PAGE\.home\)[\s\S]*router\.replace\(MAIN_PAGER_PATH_BY_PAGE\.home\)[\s\S]*setPage\(next\)/, 'pager navigation records semantic direction, preserves visited page state, and normalizes compatibility aliases on return to Chat')
  assert.doesNotMatch(switchToSource, /router\.(?:push|dismissTo)/, 'ordinary top-level switches do not allocate duplicate native route screens')
  assert.doesNotMatch(mainPagerSource, /transitionRequest|readinessToken|handlePagerPageReady|requestPagerPageChild|withTiming|withSpring|GestureDetector|Animated\.View/, 'pager navigation avoids feature-owned animation primitives')
  assert.match(
    mainPagerSource,
    /function PagerPage[\s\S]*?<IsleMotionFrame[\s\S]*role="page"[\s\S]*direction=\{direction\}[\s\S]*importantForAccessibility=\{active \? 'auto' : 'no-hide-descendants'\}[\s\S]*pointerEvents=\{active \? 'auto' : 'none'\}[\s\S]*zIndex: active \? 2 : 1/,
    'visited inactive page trees stay mounted without intercepting input or accessibility during semantic transitions',
  )
  assert.doesNotMatch(mainPagerSource, /MainPagerExperience|ThemeNavigationDrawer|AppTopBar|shellNavigation/, 'the pager does not restore the retired global top bar or drawer')
  assert.ok(['common.backToChat', '<HistoryHeaderFrame', 'search={historySearch}', 'newConversationLabel'].every((marker) => conversationsScreenSource.includes(marker)), 'History owns Back to Chat, title/search, and new-chat actions')
  const settingsNavigationSource = fs.readFileSync(path.join(root, 'src/components/settings/SettingsNavigationContent.tsx'), 'utf8')
  assert.match(settingsScreenSource, /<SettingsNavigationContent shellNavigation=\{shellNavigation\} onHome=\{onHome\}/, 'the retained Settings page delegates shell and return intent to its navigation owner')
  assert.ok(['common.backToChat', "t('settings.title')", '<SettingsSearch />', '<IsleSearchField value={query} onChangeText={setQuery}', "onNavigate={onHome ?? (() => router.replace('/'))}"].every((marker) => settingsNavigationSource.includes(marker)), 'Settings navigation owns Back to Chat, title, and editable search')
  assert.ok(['<ChatAiConfigurationSheet', '<ChatPersistentHeader'].every((marker) => floatingChromeSource.includes(marker)) && ['chat.newConversation', 'settings.title', 'onModelPress'].every((marker) => persistentHeaderSource.includes(marker)) && /conversation\.title/.test(floatingChromeSource), 'Chat owns persistent history, AI configuration, new-chat, and Settings actions')
  assert.ok(
    ['useState(false)', 'collapseLocked', 'restoreChrome'].every((marker) => floatingChromeStateSource.includes(marker)) &&
      !floatingChromeStateSource.includes('setTimeout('),
    'Chat navigation uses bounded scroll collapse and restores while local interactions require the header',
  )
  assert.ok(['chat-ai-configuration-panel', '<ChatOptionsPanel', '<ProviderSettingsContent'].every((marker) => chatAiConfigurationSource.includes(marker)), 'one Chat AI sheet composes essential configuration and provider onboarding')
  assert.ok(['chat-ai-provider-connection-section', 'chat-ai-model-selection-section', 'chat-ai-reasoning-section'].every((marker) => chatOptionsPanelSource.includes(marker)), 'the AI sheet exposes provider, model, and reasoning sections from existing state')
  assert.doesNotMatch(mainPagerSource, /function PageHeaderAction/, 'the retired shared PageHeaderAction tree is not restored')
  assert.match(mainPagerSource, /styles\.opaqueFallback[\s\S]*colors\.background\.canvas/, 'the pager keeps an opaque canvas fallback behind every transition')

  const homeContentSource = fs.readFileSync(path.join(root, 'src/components/main/HomeScreenContent.tsx'), 'utf8')
  assert.match(homeContentSource, /<ChatWorkspace[\s\S]*active=\{active\}/, 'Home passes the requested active state directly into the Chat workspace')
  assert.match(homeContentSource, /if \(activeConversation && activeConversation\.providerId !== 'local-setup'\)[\s\S]*select\(activeConversation\.id\)[\s\S]*return[\s\S]*getConfiguredProviders\(\)/, 'ordinary Chat activation resolves the selected conversation before any provider credential hydration')
  assert.match(homeContentSource, /getConfiguredProviders\(\)[\s\S]*\.catch\(\(\) => \{[\s\S]*setConfiguredProviderIds\(\[\]\)/, 'provider setup discovery handles credential-read rejection without an unhandled promise')
  assert.doesNotMatch(homeContentSource, /ANDROID_CHAT_|chatBoundary|chatSetupDiagnostic|\[islemind:home-chat-boundary\]/, 'resolved Home-to-Chat crash-bisect staging remains deleted')

  assert.match(conversationsScreenSource, /useEffect\(\(\) => \{[\s\S]*if \(!active \|\| !conversations\.length\) return undefined[\s\S]*setInterval\(requestRelativeTimeRefresh, RELATIVE_TIME_REFRESH_MS\)[\s\S]*\}, \[active, conversations\.length, requestRelativeTimeRefresh\]\)/, 'visited History pages suspend relative-time timers and AppState work while hidden')

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

  const updatesSource = fs.readFileSync(path.join(root, 'src/platform/native/androidApkUpdates.ts'), 'utf8')
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

  const glass = loadMotionPreferenceHarness('android')
  let glassNotifications = 0
  const stopGlass = glass.systemStore.subscribe(() => { glassNotifications += 1 })
  const stopConservative = glass.store.subscribe(() => undefined)
  assert.equal(glass.systemStore.getSnapshot(), 'reduced', 'glass preserves the conservative Android cold start')
  await flushMicrotasks()
  assert.equal(glass.queryCount(), 1, 'system-motion and conservative consumers share one native query')
  assert.equal(glass.addCount(), 1, 'system-motion and conservative consumers share one native listener')
  glass.resolveQuery(0, false)
  await flushMicrotasks()
  assert.equal(glass.systemStore.getSnapshot(), 'full', 'glass can animate after the OS explicitly permits motion')
  assert.equal(glass.store.getSnapshot(), 'reduced', 'other Android themes keep their conservative policy')
  assert.equal(glassNotifications, 1, 'the opt-in consumer sees a system-only preference change')
  glass.emit(0, true)
  assert.equal(glass.systemStore.getSnapshot(), 'reduced', 'system reduced motion immediately freezes glass')
  glass.emit(0, false)
  assert.equal(glass.systemStore.getSnapshot(), 'full', 'glass resumes when the OS permits motion again')
  stopGlass()
  stopConservative()
  assert.equal(glass.removeCount(), 1, 'the mixed consumers tear down their single native subscription')
  glass.emit(0, true)
  assert.equal(glass.systemStore.getSnapshot(), 'full', 'stale events cannot update unmounted system-motion consumers')

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
    const conservativeStore = store
    useMotionPreference(true)
    const systemStore = store
    return {
      initialValue,
      store: conservativeStore,
      systemStore,
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
  const { qualifiedBuildToolchain } = require('./android-build-toolchain')
  const { parse } = require('yaml')
  const releaseWorkflowSource = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-android-apk.yml'), 'utf8')
  const runnerWorkflowSource = fs.readFileSync(path.join(root, '.github', 'workflows', 'runner-android-apk.yml'), 'utf8')

  for (const [name, source] of [
    ['signed release', releaseWorkflowSource],
    ['runner debug', runnerWorkflowSource],
  ]) {
    assert.ok(source.includes('oven-sh/setup-bun@v2'), `${name} workflow installs Bun`)
    assert.ok(source.includes('bun-version: 1.4.2'), `${name} workflow pins the repository Bun version`)
    assert.ok(source.includes('bun install --frozen-lockfile'), `${name} workflow installs from bun.lock without mutation`)
    assert.ok(source.includes('bun run type-check'), `${name} workflow type-checks through Bun`)
    assert.doesNotMatch(source, /cache:\s*npm|\bnpm\s+(?:ci|install|run)\b|\bnpx\b/, `${name} workflow has no npm package-management path`)
    const jobs = Object.values(parse(source).jobs)
    assert.ok(jobs.length > 0, `${name} workflow has build jobs`)
    for (const job of jobs) {
      const nodeSetups = job.steps.filter(step => step.uses?.startsWith('actions/setup-node@'))
      const bunSetups = job.steps.filter(step => step.uses?.startsWith('oven-sh/setup-bun@'))
      assert.equal(nodeSetups.length, 1, `${name} workflow installs Node exactly once for Node scripts`)
      assert.equal(nodeSetups[0].with?.['node-version'], qualifiedBuildToolchain.node, `${name} workflow pins the qualified Node runtime`)
      assert.equal(nodeSetups[0].with?.cache, undefined, `${name} Node setup does not take over package caching`)
      assert.equal(bunSetups.length, 1, `${name} workflow retains Bun package management`)
      assert.equal(bunSetups[0].with?.['bun-version'], qualifiedBuildToolchain.bun, `${name} workflow pins the qualified Bun version`)
      assert.ok(job.steps.some(step => step.run === 'bun install --frozen-lockfile'), `${name} build job consumes the Bun lockfile`)
      assert.ok(job.steps.some(step => step.run === 'bun run type-check'), `${name} build job retains the type gate`)
    }
  }

  const releaseWorkflow = parse(releaseWorkflowSource)
  const releaseSteps = releaseWorkflow.jobs['release-android-apk'].steps
  const checkout = releaseSteps.find(step => step.uses?.startsWith('actions/checkout@'))
  assert.equal(releaseWorkflow.on.workflow_dispatch.inputs.tag.required, true, 'release builds require an explicit existing tag')
  assert.equal(checkout.with.ref, 'refs/tags/${{ inputs.tag }}', 'build the selected tag, not the workflow branch')
  assert.equal(checkout.with['persist-credentials'], false, 'checkout does not retain write credentials')
  assert.equal(releaseWorkflow.permissions.actions, undefined, 'release builds do not need artifact deletion permissions')
  assert.equal(releaseWorkflow.concurrency['cancel-in-progress'], false, 'a newer build cannot cancel publication in progress')
  const publication = releaseSteps.find(step => step.name === 'Publish GitHub Release').run
  assert.match(publication, /FETCH_HEAD\^\{commit\}/, 'publication rechecks the selected tag commit')
  assert.doesNotMatch(publication, /--clobber|--latest|release (?:edit|create)/, 'builds cannot overwrite assets or change release decisions')
  assert.doesNotMatch(releaseWorkflowSource, /delete-asset|--method DELETE|Prune superseded/, 'older releases and build artifacts remain available')
  assert.match(publication, /dist-apk\/\*\.apk dist-apk\/\*\.apk\.sha256/, 'only APKs and checksums are public release assets')

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
    'test:architecture-contract',
    'test:walking-skeleton',
    'test:task-runtime',
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
