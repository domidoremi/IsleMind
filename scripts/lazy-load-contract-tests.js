const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const lazyLoadSource = fs.readFileSync(
  path.join(root, 'src', 'utils', 'lazyLoad.tsx'),
  'utf8',
)
const sourceRouteSource = fs.readFileSync(
  path.join(root, 'app', 'source.tsx'),
  'utf8',
)
const chatRouteSource = fs.readFileSync(
  path.join(root, 'app', 'chat', '[id].tsx'),
  'utf8',
)
const settingsScreenSource = fs.readFileSync(
  path.join(root, 'src', 'components', 'main', 'SettingsScreenContent.tsx'),
  'utf8',
)
const runtimeDiagnosticsDetailsSource = fs.readFileSync(
  path.join(root, 'src', 'components', 'settings', 'RuntimeDiagnosticsDetails.tsx'),
  'utf8',
)
const chatAiConfigurationSheetSource = fs.readFileSync(
  path.join(root, 'src', 'components', 'chat', 'ChatAiConfigurationSheet.tsx'),
  'utf8',
)
const androidStatusNotificationSource = fs.readFileSync(
  path.join(root, 'src', 'platform', 'native', 'androidStatusNotification.ts'),
  'utf8',
)
const androidStatusNotificationBootstrapSource = fs.readFileSync(
  path.join(root, 'src', 'bootstrap', 'androidStatusNotification.ts'),
  'utf8',
)
const globalSystemStatusNotificationSource = fs.readFileSync(
  path.join(root, 'src', 'components', 'ui', 'GlobalSystemStatusNotificationLayer.tsx'),
  'utf8',
)
const lazyFactory = lazyLoadSource.match(
  /export function createLazyComponent[\s\S]*?\n}/,
)?.[0]

assert.ok(lazyFactory, 'canonical lazy-load factory remains available')
assert.ok(
  lazyFactory.includes('const LazyComponent = lazy(importFn)'),
  'canonical factory delegates loading to React.lazy',
)
assert.equal(
  /\b(?:preloadComponent|importFn)\s*\(/.test(lazyFactory),
  false,
  'route module evaluation does not start a dynamic import',
)
assert.equal(
  /export function (?:preloadComponent|createLazyComponentWithPreload)/.test(lazyLoadSource),
  false,
  'eager preload and compatibility aliases stay deleted',
)
assert.match(lazyLoadSource, /accessibilityRole="progressbar"[\s\S]*accessibilityLabel=\{t\('common\.loading'\)\}[\s\S]*accessibilityState=\{\{ busy: true \}\}/, 'lazy surfaces announce their busy state')
assert.match(lazyLoadSource, /flex: 1,[\s\S]*width: '100%',[\s\S]*minHeight: 72/, 'lazy fallback fills full-screen parents while retaining an inline minimum')
assert.match(lazyLoadSource, /\{t\('common\.loading'\)\}/, 'lazy surfaces show visible loading copy instead of relying on animation alone')
assert.match(lazyLoadSource, /renderFallback\?:[\s\S]*options\.renderFallback\?\.\(props\)/, 'lazy callers may provide contextual recovery without starting imports eagerly')
assert.match(
  sourceRouteSource,
  /createLazyComponent\([\s\S]*import\('@\/presentation\/features\/conversations\/SourceDetailScreen'\)/,
  'Source route defers its presentation implementation until navigation',
)
assert.doesNotMatch(
  sourceRouteSource,
  /useChatStore|react-native-webview|tracePresentation|WORK_ARTIFACT_WORKFLOW_CONTRACT/,
  'Source route stays a lightweight router boundary',
)
assert.match(
  chatRouteSource,
  /createLazyComponent\([\s\S]*?import\('@\/presentation\/features\/conversations\/RuntimeRepairConversationWorkspace'\)/,
  'Chat deep links defer low-frequency runtime repair intent construction',
)
assert.match(
  chatRouteSource,
  /const isRuntimeRepair = routeParamText\(params\.source\) === 'runtime-repair'[\s\S]*?if \(isRuntimeRepair\)[\s\S]*?<RuntimeRepairConversationWorkspace/,
  'only runtime repair deep links enter the lazy repair workspace',
)
assert.match(
  chatRouteSource,
  /import \{ ChatWorkspace \} from '@\/components\/chat\/ChatWorkspace'[\s\S]*?if \(isRuntimeRepair\)[\s\S]*?<RuntimeRepairConversationWorkspace[\s\S]*?<ChatWorkspace/,
  'ordinary conversation deep links keep the core Chat workspace synchronous',
)
assert.doesNotMatch(
  chatRouteSource,
  /buildRuntimeRepairIntent|RUNTIME_REPAIR_REPLAY_PAYLOAD_SCHEMA|findRuntimeRepairReplayContext/,
  'Chat route evaluation excludes runtime repair replay construction',
)
assert.match(
  chatAiConfigurationSheetSource,
  /createLazyComponent\([\s\S]*?import\('@\/components\/chat\/ChatOptionsPanel'\)/,
  'Chat defers the low-frequency AI configuration controls until the sheet opens',
)
assert.doesNotMatch(
  chatAiConfigurationSheetSource,
  /import\s+\{\s*ChatOptionsPanel\s*\}\s+from\s+['"]\.\/ChatOptionsPanel['"]/,
  'the core Chat path does not statically evaluate the AI configuration controls',
)
assert.match(
  chatAiConfigurationSheetSource,
  /if \(!visible\) return null[\s\S]*?<ChatOptionsPanel/,
  'the lazy AI configuration controls render only for a visible sheet',
)
assert.match(
  chatAiConfigurationSheetSource,
  /initialView\?: 'configuration' \| 'providers'[\s\S]*?useState<'configuration' \| 'providers'>\(initialView\)[\s\S]*?if \(!visible\) setView\(initialView\)/,
  'callers can choose the first useful configuration view without eagerly importing both paths',
)
assert.match(
  chatAiConfigurationSheetSource,
  /autoOpenProviderAdd\?: boolean[\s\S]*?autoOpenAdd=\{autoOpenProviderAdd \?\? switchableProviders\.length === 0\}/,
  'provider setup can distinguish adding the first provider from repairing an existing one',
)
assert.match(
  chatAiConfigurationSheetSource,
  /renderFallback:[\s\S]*?<LazyLoadingFallback[\s\S]*?onDismiss=\{props\.onClose\}/,
  'provider loading inside Chat keeps a reachable return action',
)
assert.match(
  chatAiConfigurationSheetSource,
  /if \(view === 'providers' && initialView !== 'providers'\)[\s\S]*?setView\('configuration'\)[\s\S]*?onClose\(\)/,
  'provider management returns to configuration only when configuration was the entry view',
)
assert.match(
  chatAiConfigurationSheetSource,
  /<ProviderSettingsContent[\s\S]*?onClose=\{closeCurrentView\}/,
  'direct provider setup closes without mounting deferred AI configuration controls on the way out',
)
assert.match(
  settingsScreenSource,
  /createLazyComponent\([\s\S]*?import\('@\/components\/settings\/RuntimeDiagnosticsDetails'\)/,
  'Settings defers low-frequency runtime diagnostic projection until its panel opens',
)
for (const [label, pattern] of [
  ['APK update implementation', /import\('@\/platform\/native\/androidApkUpdates'\)/],
  ['plugin manifest catalog', /import\('@\/bootstrap\/pluginManifest'\)/],
  ['Android status notification bridge', /import\('@\/bootstrap\/androidStatusNotification'\)/],
  ['runtime log implementation', /import\('@\/platform\/native\/runtimeLog'\)/],
  ['Chat store destructive action', /import\('@\/store\/chatStore'\)/],
  ['clipboard bridge', /import\('expo-clipboard'\)/],
  ['sharing bridge', /import\('expo-sharing'\)/],
]) {
  assert.match(settingsScreenSource, pattern, `Settings defers ${label} until its low-frequency action is used`)
}
assert.doesNotMatch(
  settingsScreenSource,
  /^import (?!type\b).*from ['"](?:expo-(?:clipboard|sharing)|@\/(?:bootstrap\/pluginManifest|platform\/native\/(?:androidApkUpdates|runtimeLog)|bootstrap\/androidStatusNotification|store\/chatStore))['"]\s*$/gm,
  'Settings does not statically evaluate low-frequency native and diagnostics modules',
)
assert.doesNotMatch(
  `${androidStatusNotificationSource}\n${androidStatusNotificationBootstrapSource}`,
  /settingsStore|useSettingsStore/,
  'the Android notification adapter and bootstrap runtime do not pull the Settings store into their module graph',
)
assert.match(
  androidStatusNotificationSource,
  /options\.enabled !== true/,
  'Android status notifications fail closed unless their caller explicitly enables them',
)
assert.equal(
  settingsScreenSource.match(/\}, \{ enabled: settings\.systemStatusNotificationsEnabled === true, owner \}\)/g)?.length,
  2,
  'APK update notifications receive the current Settings preference without coupling the bridge to the store',
)
assert.match(
  globalSystemStatusNotificationSource,
  /updateAndroidStatusNotification\(payload, \{ \.\.\.options, enabled: enabledRef\.current \}\)/,
  'the global dispatcher evaluates the latest explicit enable state when queued updates execute',
)
assert.match(
  settingsScreenSource,
  /diagnostics \? \([\s\S]*?<IsleDisclosure[\s\S]*?expanded=\{diagnosticDetailsOpen\}[\s\S]*?diagnosticDetailsOpen \? \([\s\S]*?<RuntimeDiagnosticsDetails[\s\S]*?: null[\s\S]*?: \([\s\S]*?runtimeDiagnosticsRun[\s\S]*?void refreshRuntimeDiagnostics\(\)/,
  'Settings loads the heavy diagnostic projection only after an explicit disclosure action and exposes an explicit refresh action',
)
assert.doesNotMatch(
  settingsScreenSource,
  /if \(!expandedGroups\.diagnostics \|\| diagnostics \|\| refreshingDiagnostics\) return[\s\S]*?void refreshRuntimeDiagnostics\(\)/,
  'opening the diagnostics panel does not automatically evaluate low-frequency provider contracts',
)
assert.match(
  runtimeDiagnosticsDetailsSource,
  /accessibilityLabel=\{t\('settings\.runtimeDiagnosticDetailsSummary'[\s\S]*?visibleRows\.map/,
  'the deferred diagnostic detail surface announces its row and attention summary when mounted',
)
assert.match(
  runtimeDiagnosticsDetailsSource,
  /PRIMARY_DIAGNOSTIC_KEYS[\s\S]*?row\.tone === 'amber'[\s\S]*?hiddenRowCount[\s\S]*?runtimeDiagnosticShowAll[\s\S]*?accessibilityState=\{\{ expanded: showAll \}\}/,
  'runtime diagnostics prioritize actionable and attention rows before users opt into the full technical projection',
)
assert.match(
  settingsScreenSource,
  /const diagnosticsRefreshInFlightRef = useRef\(false\)[\s\S]*?if \(diagnosticsRefreshInFlightRef\.current\) return[\s\S]*?diagnosticsRefreshInFlightRef\.current = true[\s\S]*?diagnosticsRefreshInFlightRef\.current = false/,
  'runtime diagnostics reject duplicate refresh work before React can publish the disabled button state',
)
assert.doesNotMatch(
  settingsScreenSource,
  /function buildDiagnosticRows|function DiagnosticPill|runtimeDiagnosticMediaGeneration|runtimeDiagnosticPluginCatalog|runtimeDiagnosticPerformance/,
  'Settings home excludes heavy diagnostic projection and formatting work',
)
assert.match(
  runtimeDiagnosticsDetailsSource,
  /export function RuntimeDiagnosticsDetails[\s\S]*?function buildDiagnosticRows[\s\S]*?function DiagnosticPill/,
  'the deferred diagnostic component owns the complete detail projection surface',
)
assert.equal(
  runtimeDiagnosticsDetailsSource.match(/useWindowDimensions\(\)/g)?.length,
  1,
  'diagnostic cards share one viewport subscription instead of subscribing per row',
)
assert.match(
  runtimeDiagnosticsDetailsSource,
  /const \{ colors \} = useAppTheme\(\)[\s\S]*?visibleRows\.map[\s\S]*?colors=\{colors\}[\s\S]*?compact=\{compact\}/,
  'diagnostic cards receive shared theme and viewport projection props',
)
for (const marker of [
  'runtimeDiagnosticMediaGeneration',
  'runtimeDiagnosticPluginCatalog',
  'runtimeDiagnosticPerformance',
  'diagnostics.timeline.repairPlan.taskCount',
]) {
  assert.ok(
    runtimeDiagnosticsDetailsSource.includes(marker),
    `deferred runtime diagnostics retain ${marker}`,
  )
}

console.log('Lazy-load contract tests passed')
