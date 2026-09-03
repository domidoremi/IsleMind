const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  PRODUCT_EXPERIENCE_COMPATIBILITY_EVAL_SCHEMA,
  PRODUCT_EXPERIENCE_COMPATIBILITY_FIXTURE_IDS,
  runProductExperienceCompatibilityEvaluation,
} = require('../src/modules/conversations/testing/productExperienceCompatibilityEvaluation.ts')
const { shouldPromotePlainDelimitedRows } = require('../src/components/chat/messageContentTablePromotion.ts')
const { sanitizeInternalChatOutputText } = require('../src/services/chatInternalOutputGuard.ts')
const {
  matchesSettingsControlSearch,
  normalizeSettingsControlSearch,
} = require('../src/presentation/features/settings/settingsControlSearch.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isProductExperienceCompatibilityHook) return

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
  hook.isProductExperienceCompatibilityHook = true
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
  assert.equal(item.policy.entryPointVisible, true, `${item.fixtureId} has visible entry point`)
  assert.equal(item.policy.primaryActionVisible, true, `${item.fixtureId} has visible primary action`)
  assert.equal(item.policy.emptyStateActionable, true, `${item.fixtureId} has actionable empty state`)
  assert.equal(item.policy.diagnosticActionVisible, true, `${item.fixtureId} exposes diagnostics`)
  assert.equal(item.policy.recoveryActionVisible, true, `${item.fixtureId} exposes recovery`)
  assert.equal(item.policy.capabilityAware, true, `${item.fixtureId} is capability-aware`)
  assert.equal(item.policy.errorDeduplicated, true, `${item.fixtureId} deduplicates errors`)
  assert.equal(item.policy.mediaGenerationReadinessVisible, true, `${item.fixtureId} exposes media generation readiness`)
  assert.equal(item.policy.mediaGenerationNamedGatesVisible, true, `${item.fixtureId} names media generation gates`)
  assert.equal(item.policy.mediaGenerationDiagnosticOnly, true, `${item.fixtureId} keeps media generation diagnostic-only`)
  assert.equal(item.policy.mediaGenerationExecutionActionHidden, true, `${item.fixtureId} hides media generation execution actions`)
  assert.equal(item.policy.localizationReady, true, `${item.fixtureId} is localized`)
  assert.equal(item.policy.accessibilityReady, true, `${item.fixtureId} is accessible`)
  assert.equal(item.policy.layoutStable, true, `${item.fixtureId} has stable layout`)
  assert.equal(item.policy.rawTechnicalErrorVisible, false, `${item.fixtureId} does not expose raw technical errors`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no product-experience failures`)
}

function assertBlocked(item, expectedCodes) {
  assert.equal(item.readiness, 'blocked', `${item.fixtureId} is blocked`)
  for (const code of expectedCodes) {
    assert.ok(item.failureCodes.includes(code), `${item.fixtureId} records ${code}`)
  }
}

function run() {
  assert.equal(PRODUCT_EXPERIENCE_COMPATIBILITY_EVAL_SCHEMA, 'islemind.product-experience-compatibility-eval.v1', 'product-experience schema is versioned')
  assert.deepEqual(
    PRODUCT_EXPERIENCE_COMPATIBILITY_FIXTURE_IDS,
    [
      'first-run-provider-setup',
      'provider-activation-progress',
      'model-unavailable-recovery',
      'capability-driven-controls',
      'diagnostic-only-media-generation-readiness',
      'chat-error-deduplication',
      'long-running-task-feedback',
      'data-reset-confirmation',
      'offline-local-fallback',
      'blocked-silent-provider-failure',
      'blocked-media-generation-execution-action',
      'blocked-repeated-error-toast',
      'blocked-destructive-reset-without-confirmation',
    ],
    'product-experience fixtures cover setup, activation, recovery, chat, diagnostic media generation readiness, runtime, data, offline, and blocked paths'
  )

  const evaluation = runProductExperienceCompatibilityEvaluation({ now: () => 2600000000000 })
  assert.equal(evaluation.schema, PRODUCT_EXPERIENCE_COMPATIBILITY_EVAL_SCHEMA, 'evaluation carries schema')
  assert.equal(evaluation.diagnostics.length, PRODUCT_EXPERIENCE_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `product-experience gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  for (const surface of ['onboarding', 'provider-setup', 'model-picker', 'chat', 'runtime-task', 'data-management', 'offline']) {
    assert.ok(evaluation.qualityGate.requiredSurfaces.includes(surface), `quality gate tracks ${surface}`)
  }

  const firstRun = diagnostic(evaluation, 'first-run-provider-setup')
  assertReady(firstRun)
  assert.equal(firstRun.surface, 'onboarding', 'first-run fixture is onboarding-scoped')

  const activation = diagnostic(evaluation, 'provider-activation-progress')
  assertReady(activation)
  assert.equal(activation.policy.progressVisible, true, 'provider activation shows progress')
  assert.equal(activation.policy.notificationStrategy, 'single', 'provider activation uses one status surface')

  const unavailable = diagnostic(evaluation, 'model-unavailable-recovery')
  assertReady(unavailable)
  assert.equal(unavailable.policy.notificationStrategy, 'grouped', 'model unavailable messages are grouped')

  const controls = diagnostic(evaluation, 'capability-driven-controls')
  assertReady(controls)
  assert.equal(controls.policy.capabilityAware, true, 'chat controls are capability-aware')

  const mediaReadiness = diagnostic(evaluation, 'diagnostic-only-media-generation-readiness')
  assertReady(mediaReadiness)
  assert.equal(mediaReadiness.policy.mediaGenerationReadinessVisible, true, 'future media generation readiness is visible')
  assert.equal(mediaReadiness.policy.mediaGenerationNamedGatesVisible, true, 'future media generation gates are named')
  assert.equal(mediaReadiness.policy.mediaGenerationDiagnosticOnly, true, 'future media generation remains diagnostic-only')
  assert.equal(mediaReadiness.policy.mediaGenerationExecutionActionHidden, true, 'future media generation execution actions remain hidden')

  const deduped = diagnostic(evaluation, 'chat-error-deduplication')
  assertReady(deduped)
  assert.equal(deduped.policy.errorDeduplicated, true, 'chat errors are deduplicated')
  assert.equal(deduped.policy.notificationStrategy, 'grouped', 'chat repeated errors are grouped')
  const messageBubbleSource = fs.readFileSync(path.join(root, 'src/components/chat/MessageBubble.tsx'), 'utf8')
  assert.ok(messageBubbleSource.includes('<Modal') && messageBubbleSource.includes('testID="message-action-sheet"') && messageBubbleSource.includes('statusBarTranslucent'), 'message actions render in a screen-level modal outside virtualized-list clipping')
  assert.equal(messageBubbleSource.includes('measureInWindow'), false, 'message actions do not depend on stale or clipped bubble coordinates')
  assert.ok(messageBubbleSource.includes('Gesture.LongPress()') && messageBubbleSource.includes('openActionBarFromLongPress'), 'message actions remain available from a message long press')
  assert.equal(messageBubbleSource.includes('AppIcon name="more"'), false, 'message bubbles do not expose a persistent top-right overflow button')
  assert.ok(
    /function AnimatedProcessStatusText\(\{ active, label, tone, icon, motion, grammar, statusMotionPhase, stageStartedAt, previewText \}[\s\S]*?const shimmer = active && motion === 'full' && grammar !== 'precision'[\s\S]*?setInterval\(\(\) =>[\s\S]*?<AppIcon name=\{icon\}[\s\S]*?loop: shimmer/.test(messageBubbleSource) &&
      messageBubbleSource.includes("grammar === 'precision'") &&
      messageBubbleSource.includes("grammar === 'material'") &&
      messageBubbleSource.includes("'.'.repeat(motion === 'full' ? dotCount : 3)") &&
      !messageBubbleSource.includes('function ProcessSpinner') &&
      !messageBubbleSource.includes('<ProcessAnchor'),
    'active reply stages use theme-specific status motion, reduced-motion fallbacks, and no circular anchor',
  )
  assert.equal(messageBubbleSource.includes('function ThinkingStatusText'), false, 'thinking does not branch into a separate dot-only status style')
  assert.match(messageBubbleSource, /const MESSAGE_ACTION_PRIMARY_LIMIT = 5[\s\S]*const primaryActions = prioritizedActions\.slice\(0, MESSAGE_ACTION_PRIMARY_LIMIT\)/, 'message action sheet limits the primary view to five high-frequency commands')
  assert.match(messageBubbleSource, /const secondaryActions = \[[\s\S]*messageBubble\.copyProcessTrace[\s\S]*messageBubble\.multiSelect[\s\S]*common\.delete[\s\S]*const overflowActions/, 'secondary and destructive commands move behind the more-actions view')
  assert.match(messageBubbleSource, /messageBubble\.moreActionsCount[\s\S]*setShowMore\(true\)/, 'the primary action view exposes a labelled more-actions command')
  assert.match(messageBubbleSource, /function MessageActionSheetRow[\s\S]*accessibilityRole="menuitem"[\s\S]*minHeight: 50/, 'message action rows expose accessible touch-sized targets')
  assert.match(messageBubbleSource, /action\('delete',[\s\S]*danger: true/, 'message deletion remains visually isolated as a dangerous action')
  assert.match(messageBubbleSource, /function canShowActionBar\([\s\S]*?canCopyProcessTrace[\s\S]*?canQuoteMessage[\s\S]*?return hasCommonActions/, 'message action admission preserves trace and quote commands')
  assert.doesNotMatch(messageBubbleSource, /message\.usage|message\.tokenCount|messageBubble\.usage(?:Details|Provider|Estimated|TokenCount|Input|Output|Total|Reasoning|Duration)/, 'message bubbles do not render response usage, provider-source, or token-detail metadata')
  for (const marker of ['onSendToAgent', 'onSummarizeInChat', 'onBringIntoTavern']) {
    assert.equal(messageBubbleSource.includes(marker), false, `message actions do not restore ${marker}`)
  }
  assert.match(messageBubbleSource, /function WorkArtifactQuickActionButton[\s\S]*?width: 44,\s*height: 44,/, 'work-artifact quick actions expose an explicit 44dp hit area')
  assert.match(messageBubbleSource, /function handleBubbleLayout\(\)[\s\S]*?hasDefaultWorkArtifactActions[\s\S]*?onLayoutChangeRequest\?\.\(\)/, 'visible work-artifact actions invalidate the virtualized message layout')
  assert.match(messageBubbleSource, /function WorkArtifactQuickActions\([\s\S]*?minHeight: 44,\s*flexShrink: 0,/, 'work-artifact quick-action rows reserve a non-shrinking 44dp layout height')
  assert.match(messageBubbleSource, /canConfirmAction && !multiSelectActive[\s\S]*?<PendingActionQuickAction onPress=\{\(\) => onConfirmAction\?\.\(message\)\}/, 'confirmable pending actions expose a direct message-level confirmation control')
  assert.match(messageBubbleSource, /function PendingActionQuickAction\([\s\S]*?testID="message-pending-action-confirm"[\s\S]*?minHeight: 44,/, 'pending-action confirmation remains discoverable, accessible, and touch-sized without a message long press')
  assert.ok(messageBubbleSource.includes('let maxTraceDuration = 0'), 'message thinking duration avoids allocating duration arrays')
  assert.ok(messageBubbleSource.includes('const summaries: string[] = []'), 'message thinking summaries are collected in one pass')
  assert.ok(messageBubbleSource.includes('resolveChatAssistantDisplayName(configuredAssistantDisplayName)') && messageBubbleSource.includes('getAssistantThinkingLabel'), 'generic live thinking status uses the configured Chat assistant name without historical mode authority')

  const longTask = diagnostic(evaluation, 'long-running-task-feedback')
  assertReady(longTask)
  assert.equal(longTask.policy.progressVisible, true, 'long tasks show progress')
  assert.equal(longTask.policy.cancellationVisible, true, 'long tasks can be cancelled')
  assert.equal(longTask.policy.runtimeTraceVisible, true, 'long tasks expose runtime traces')

  const reset = diagnostic(evaluation, 'data-reset-confirmation')
  assertReady(reset)
  assert.equal(reset.policy.destructiveAction, true, 'reset fixture is destructive')
  assert.equal(reset.policy.confirmationRequired, true, 'reset fixture requires confirmation')
  assert.equal(reset.policy.persistenceSafe, true, 'reset fixture owns persistence cleanup')

  const offline = diagnostic(evaluation, 'offline-local-fallback')
  assertReady(offline)
  assert.equal(offline.policy.requiresOfflineFallback, true, 'offline fixture requires fallback')
  assert.equal(offline.policy.offlineFallbackVisible, true, 'offline fallback is visible')

  assertBlocked(diagnostic(evaluation, 'blocked-silent-provider-failure'), [
    'missing-progress',
    'missing-diagnostic-action',
    'missing-recovery-action',
    'silent-failure',
    'raw-technical-error',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-media-generation-execution-action'), [
    'missing-media-generation-readiness',
    'missing-media-generation-gate-copy',
    'media-generation-not-diagnostic-only',
    'media-generation-execution-action-visible',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-repeated-error-toast'), [
    'missing-error-deduplication',
    'repeated-notification',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-destructive-reset-without-confirmation'), [
    'destructive-without-confirmation',
    'persistence-risk',
    'privacy-copy-missing',
  ])

  assertSourceIntegration()

  console.log('Product experience compatibility tests passed')
}

function assertSourceIntegration() {
  const providerActivationJobSource = fs.readFileSync(path.join(root, 'src/services/providerActivationJob.ts'), 'utf8')
  assert.ok(providerActivationJobSource.includes('completed') && providerActivationJobSource.includes('failed'), 'provider activation job exposes completion and failure states')

  const providerSettingsSource = fs.readFileSync(path.join(root, 'src/components/providers/ProviderSettingsContent.tsx'), 'utf8')
  assert.ok(providerSettingsSource.includes('useProviderActivationJob'), 'provider settings uses the activation job boundary')
  assert.ok(providerSettingsSource.includes('PROVIDER_IMPORT_LIVE_DETECTION_CHAR_LIMIT'), 'provider import modal bounds live detection parsing')
  assert.ok(providerSettingsSource.includes('countLogicalTextLines'), 'provider import modal counts large pasted text without line-array allocation')
  assert.ok(providerSettingsSource.includes('providerAttentionItems.length ?'), 'provider settings hides overview chips unless a provider state needs attention')
  assert.ok(providerSettingsSource.includes('providers.length > 3 || listToolsActive'), 'provider settings hides search and sort tools until the provider list needs them')
  assert.ok(providerSettingsSource.includes('providers.length > 1 || batchActionsActive'), 'provider settings hides batch controls for single-provider setups')
  assert.equal((providerSettingsSource.match(/<IsleOverlayPressable accessible=\{false\} accessibilityRole="none"/g) ?? []).length, 2, 'provider add and import sheets keep touch-dismiss backdrops out of the accessibility tree')
  assert.doesNotMatch(providerSettingsSource, /<IsleOverlayPressable accessibilityLabel=\{t\('dialog\.close'\)\} accessibilityRole="button" onPress=\{(?:closeWithoutSubmit|onClose)\}/, 'provider sheets do not announce duplicate backdrop close buttons alongside their visible close controls')
  assert.match(providerSettingsSource, /function ProviderFormModal[\s\S]*?<View\s+accessibilityViewIsModal\s+style=\{\{ maxHeight: sheetMaxHeight[\s\S]*?function countLogicalTextLines/, 'provider add sheet isolates screen-reader focus inside the modal surface')
  assert.match(providerSettingsSource, /function ProviderImportModal[\s\S]*?<View\s+accessibilityViewIsModal\s+style=\{\{[\s\S]*?function clipboardReadFailureMessage/, 'provider import sheet isolates screen-reader focus inside the modal surface')
  const chatAiConfigurationSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatAiConfigurationSheet.tsx'), 'utf8')
  assert.match(chatAiConfigurationSource, /<Pressable[\s\S]*?accessible=\{false\}[\s\S]*?accessibilityRole="none"[\s\S]*?onPress=\{closeCurrentView\}[\s\S]*?backgroundColor: colors\.backdrop/, 'AI configuration keeps its touch-dismiss backdrop out of the accessibility tree')
  assert.doesNotMatch(chatAiConfigurationSource, /accessibilityLabel=\{t\('dialog\.closeLayer'\)\}/, 'AI configuration announces only its visible close control')
  assert.match(chatAiConfigurationSource, /<View testID="chat-ai-configuration-panel" accessibilityViewIsModal/, 'AI configuration isolates screen-reader focus inside the modal surface')
  assert.match(providerSettingsSource, /<Pressable accessible=\{false\} accessibilityRole="none" onPress=\{\(\) => void requestSheetClose\(\)\}/, 'provider detail keeps its touch-dismiss backdrop out of the accessibility tree')
  assert.match(providerSettingsSource, /<View accessibilityViewIsModal style=\{\{ flex: 1, justifyContent: 'flex-end' \}\}>/, 'provider detail isolates screen-reader focus inside the modal surface')
  const floatingComposerSource = fs.readFileSync(path.join(root, 'src/components/chat/FloatingComposer.tsx'), 'utf8')
  assert.match(floatingComposerSource, /function ReasoningPickerPopover[\s\S]*?<Pressable accessible=\{false\} accessibilityRole="none" onPress=\{onClose\}/, 'reasoning selection announces only its visible close control')
  assert.match(floatingComposerSource, /function ReasoningPickerPopover[\s\S]*?<View accessibilityViewIsModal/, 'reasoning selection isolates screen-reader focus inside the modal surface')
  const workspaceReviewSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatWorkspaceReviewSheet.tsx'), 'utf8')
  assert.match(workspaceReviewSource, /<IsleOverlayPressable[\s\S]*?accessible=\{false\}[\s\S]*?accessibilityRole="none"[\s\S]*?onPress=\{onClose\}/, 'workspace review announces only its visible close control')
  assert.match(workspaceReviewSource, /<MotiView[\s\S]*?accessibilityViewIsModal[\s\S]*?testID="chat-workspace-review-sheet"/, 'workspace review isolates screen-reader focus inside the modal surface')
  const messageActionSource = fs.readFileSync(path.join(root, 'src/components/chat/MessageBubble.tsx'), 'utf8')
  assert.match(messageActionSource, /function MessageActionSheet[\s\S]*?<Pressable[\s\S]*?accessible=\{false\}[\s\S]*?accessibilityRole="none"[\s\S]*?onPress=\{onClose\}/, 'message actions announce only the sheet close control')
  assert.match(messageActionSource, /testID="message-action-sheet"[\s\S]*?accessibilityRole="menu"[\s\S]*?accessibilityViewIsModal/, 'message actions isolate screen-reader focus inside the modal menu')
  const usageStatisticsSource = fs.readFileSync(path.join(root, 'src/components/settings/UsageStatisticsContent.tsx'), 'utf8')
  assert.match(usageStatisticsSource, /function UsageSheet[\s\S]*?<Pressable accessible=\{false\} accessibilityRole="none" style=\{StyleSheet\.absoluteFill\} onPress=\{onClose\}/, 'usage sheets announce only their visible close control')
  assert.match(usageStatisticsSource, /function UsageSheet[\s\S]*?<MotiView[\s\S]*?accessibilityViewIsModal/, 'usage sheets isolate screen-reader focus inside the modal surface')
  const isleKitSource = fs.readFileSync(path.join(root, 'src/components/ui/isle/IsleKit.tsx'), 'utf8')
  assert.match(isleKitSource, /export function IsleModal[\s\S]*?accessible=\{false\}[\s\S]*?accessibilityRole="none"[\s\S]*?backgroundColor: palette\.colors\.backdrop/, 'shared IsleModal keeps its optional touch-dismiss mask out of the accessibility tree')
  assert.match(isleKitSource, /export function IsleModal[\s\S]*?<View accessibilityViewIsModal style=/, 'shared IsleModal isolates screen-reader focus inside the modal surface')
  const isleImageSource = fs.readFileSync(path.join(root, 'src/components/ui/isle/Image.tsx'), 'utf8')
  assert.match(isleImageSource, /<IsleOverlayPressable[\s\S]*?accessible=\{false\}[\s\S]*?accessibilityRole="none"[\s\S]*?setPreviewOpen\(false\)/, 'image preview announces only its visible close control')
  assert.match(isleImageSource, /<Modal[\s\S]*?<View accessibilityViewIsModal style=/, 'image preview isolates screen-reader focus inside the modal surface')

  const providerPanelSource = fs.readFileSync(path.join(root, 'src/components/settings/ApiKeyPanel.tsx'), 'utf8')
  assert.ok(
    providerPanelSource.includes('ProviderWorkspaceTabs') &&
      providerPanelSource.includes("{ value: 'connection'") &&
      providerPanelSource.includes("{ value: 'models'") &&
      !providerPanelSource.includes("{ value: 'overview'") &&
      providerPanelSource.includes("open={workspaceView === 'advanced'}"),
    'provider details expose connection and models as primary tasks while advanced controls stay in one disclosure'
  )

  const settingsScreenSource = fs.readFileSync(path.join(root, 'src/components/main/SettingsScreenContent.tsx'), 'utf8')
  const runtimeDiagnosticsDetailsSource = fs.readFileSync(path.join(root, 'src/components/settings/RuntimeDiagnosticsDetails.tsx'), 'utf8')
  const settingsControlExperienceSource = fs.readFileSync(path.join(root, 'src/components/settings/theme-experiences/SettingsControlCatalogExperiences.tsx'), 'utf8')
  assert.ok(
    settingsScreenSource.includes('SettingsControlNavigation') &&
      settingsScreenSource.includes('SettingsControlCatalog') &&
      settingsControlExperienceSource.includes('settings-control-catalog-minimal') &&
      settingsControlExperienceSource.includes('settings-control-catalog-lime-road') &&
      settingsControlExperienceSource.includes('settings-control-catalog-markdown'),
    'settings home keeps searchable AI and system control views while each theme owns its directory geometry'
  )
  assert.ok(settingsScreenSource.includes("t('settings.controlSearchPlaceholder')"), 'settings home exposes one search entry for settings and capabilities')
  assert.match(settingsScreenSource, /const aiSearchMatches = aiControlEntries\.filter[\s\S]*matchesSettingsControlSearch[\s\S]*const systemSearchMatches = systemControlEntries\.filter[\s\S]*controlView === 'ai' && !aiSearchMatches\.length && systemSearchMatches\.length/, 'settings search can move between AI and system control catalogs when the active tab has no match')
  assert.match(settingsScreenSource, /const focusedControlEntries = normalizedSettingsSearch\s*\?\s*visibleControlEntries/, 'settings search results are not hidden by an already expanded system panel')
  for (const routeFieldKey of [
    'providerSettings.protocol.title',
    'usage.totalTokens',
    'preferences.generationSubtitle',
    'contextPanel.memoryReviewQueue',
    'contextPanel.importKnowledgeFile',
    'contextPanel.ragMode',
    'skills.workflowTemplates',
    'mcp.addServer',
    'settings.themeAccent',
    'settings.exportJson',
    'settings.runtimeLogFile',
    'settings.proxyBaseUrl',
    'settings.checkApk',
    'settings.systemStatusNotifications',
  ]) {
    assert.ok(settingsScreenSource.includes(`t('${routeFieldKey}')`) || settingsScreenSource.includes(`t('${routeFieldKey}',`), `settings search indexes ${routeFieldKey}`)
  }
  const contextSearchEntry = {
    title: 'Context',
    detail: 'Retrieval, search, checks',
    searchTerms: ['RAG retrieval mode', 'Web search'],
  }
  assert.equal(matchesSettingsControlSearch(contextSearchEntry, normalizeSettingsControlSearch('  RAG RETRIEVAL  ')), true, 'settings route metadata matches a normalized child-field query')
  assert.equal(matchesSettingsControlSearch(contextSearchEntry, normalizeSettingsControlSearch('MCP Server')), false, 'settings route metadata does not leak unrelated routes into results')
  const sourceScreenSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/SourceDetailScreen.tsx'), 'utf8')
  assert.match(sourceScreenSource, /const conversation = useChatStore\(\(state\) => state\.conversations\.find\(\(item\) => item\.id === conversationId\)\)/, 'Source reader subscribes only to the requested conversation')
  assert.doesNotMatch(sourceScreenSource, /const conversations = useChatStore\(\(state\) => state\.conversations\)/, 'unrelated conversation updates do not rerender the Source reader')
  assert.ok(settingsScreenSource.includes('settingsAttentionItems.length ?'), 'settings status chips stay hidden unless attention is needed')
  assert.ok(runtimeDiagnosticsDetailsSource.includes('runtimeDiagnosticMediaGeneration') && runtimeDiagnosticsDetailsSource.includes('adapterProofWorklist'), 'settings diagnostics expose media generation readiness as proof counts only')
  assert.ok(!settingsScreenSource.includes('function SettingsQuickLink'), 'settings home removes the old arrow-row settings directory')
  assert.ok(!settingsScreenSource.includes('expandedAppearanceGroups'), 'appearance settings no longer require nested disclosure taps')
  assert.ok(settingsScreenSource.includes('CommittedSettingsField'), 'high-frequency Settings inputs isolate drafts from the full Settings screen render')
  assert.match(settingsScreenSource, /value=\{String\(settings\.remoteCompactThreshold \?\? 0\.8\)\}[\s\S]*onCommit=\{updateRemoteCompactThreshold\}/, 'remote compact threshold commits only after draft normalization')
  assert.doesNotMatch(settingsScreenSource, /onChangeText: updateRemoteCompactThreshold/, 'remote compact threshold does not persist on every keypress')
  assert.doesNotMatch(settingsScreenSource, /onChangeText: \(proxyBaseUrl\) => updateSettings/, 'proxy URL does not persist on every keypress')
  assert.doesNotMatch(settingsScreenSource, /onChangeText: \(observabilitySinkEndpointUrl\) => updateSettings/, 'observability endpoint does not persist on every keypress')
  assert.match(settingsScreenSource, /commitOnSubmit=\{false\}[\s\S]*normalize=\{normalizeSettingsListDraft\}/, 'allow and block lists commit normalized drafts on blur without treating newline as submit')

  const preferenceSettingsSource = fs.readFileSync(path.join(root, 'src/components/settings/PreferenceSettingsContent.tsx'), 'utf8')
  assert.ok(!preferenceSettingsSource.includes('SettingsSummaryStrip'), 'preference settings avoid duplicate overview chips above the actual controls')
  assert.ok(!preferenceSettingsSource.includes('identityOpen') && preferenceSettingsSource.includes('PreferenceIdentityField'), 'preference settings expose assistant identity directly')
  assert.ok(preferenceSettingsSource.includes('PreferenceCapabilityTile') && preferenceSettingsSource.includes('workflowOpen'), 'preference settings keep daily capability switches visible and only defer workflow boundaries')
  const expectedWorkflowLabels = {
    en: { singular: 'Workflow', plural: 'Workflows' },
    ja: { singular: 'ワークフロー', plural: 'ワークフロー' },
    'zh-CN': { singular: '工作流', plural: '工作流' },
  }
  for (const locale of ['en', 'ja', 'zh-CN']) {
    const localeSource = fs.readFileSync(path.join(root, `src/i18n/resources/${locale}.json`), 'utf8')
    const localeData = JSON.parse(localeSource)
    assert.doesNotMatch(localeSource, /"assistantDisplayNamePlaceholder"\s*:\s*"(?:Coca|IsleMind)"/, `${locale} keeps the optional assistant name visibly unset by default`)
    assert.equal(localeData.preferences.agentWorkflow, expectedWorkflowLabels[locale].singular, `${locale} uses Workflow-neutral singular settings copy`)
    assert.equal(localeData.skills.agentWorkflows, expectedWorkflowLabels[locale].plural, `${locale} uses Workflow-neutral plural settings copy`)
  }

  const workflowPresentationSource = fs.readFileSync(path.join(root, 'src/components/chat/workflowPresentation.ts'), 'utf8')
  assert.match(workflowPresentationSource, /focus:\s*'workflow'/, 'new Chat workflow recovery links emit the canonical Workflow settings focus')
  assert.doesNotMatch(workflowPresentationSource, /focus:\s*'agent-workflow'/, 'new Chat workflow recovery links do not emit the legacy Agent workflow focus')

  const skillsSettingsRouteSource = fs.readFileSync(path.join(root, 'app/settings/skills.tsx'), 'utf8')
  assert.match(skillsSettingsRouteSource, /requestedFocus === 'workflow'/, 'Skills settings accepts the canonical Workflow focus input')
  assert.match(skillsSettingsRouteSource, /type WorkflowSettingsFocus/, 'Skills settings consumes the Workflow-neutral focus contract')
  assert.match(skillsSettingsRouteSource, /focus:\s*'workflow'/, 'Skills settings normalizes route input to the canonical Workflow focus')
  assert.equal((skillsSettingsRouteSource.match(/agent-workflow/g) ?? []).length, 0, 'Skills settings removes the historical Agent workflow route decoder')

  const skillSettingsSource = fs.readFileSync(path.join(root, 'src/components/settings/SkillSettingsContent.tsx'), 'utf8')
  for (const requiredSymbol of ['WorkflowSettingsFocus', 'sanitizeWorkflowSettingsFocus', 'findWorkflowFocusSkill', 'workflowSkills', 'visibleWorkflowSkills', 'buildWorkflowVisibleDefinition']) {
    assert.ok(skillSettingsSource.includes(requiredSymbol), `Skills settings keeps neutral ${requiredSymbol}`)
  }
  assert.doesNotMatch(skillSettingsSource, /\b(?:AgentWorkflowSettingsFocus|sanitizeAgentWorkflowSettingsFocus|findAgentWorkflowFocusSkill|agentWorkflowSkills|visibleAgentWorkflowSkills|buildAgentWorkflowVisibleDefinition)\b/, 'Skills settings does not restore Agent-named focus helpers')

  const chatOptionsSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatOptionsPanel.tsx'), 'utf8')
  assert.ok(chatOptionsSource.includes('showTemperatureControl') && chatOptionsSource.includes('showTopKControl'), 'chat options hide controls through capability-driven flags')
  assert.ok(chatOptionsSource.includes('upsertSettingsModelDisplayAlias') && chatOptionsSource.includes('conversation.model'), 'chat options persist model display aliases against stable provider and model identity')

  const chatWorkspaceSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatWorkspace.tsx'), 'utf8')
  const chatSetupWorkspaceSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatSetupWorkspace.tsx'), 'utf8')
  const chatActiveComposerDockSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveComposerDock.tsx'), 'utf8')
  const chatActiveMessageVirtualListSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveMessageVirtualList.tsx'), 'utf8')
  const chatActiveMessageItemSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveMessageItem.tsx'), 'utf8')
  const chatActiveWorkspaceActionsSource = fs.readFileSync(path.join(root, 'src/components/chat/chatActiveWorkspaceActions.ts'), 'utf8')
  const chatActiveMessageEmptyStateSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveMessageEmptyState.tsx'), 'utf8')
  const chatEmptyStateSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatEmptyState.tsx'), 'utf8')
  const streamingIntentSheetSource = fs.readFileSync(path.join(root, 'src/components/chat/StreamingIntentSheet.tsx'), 'utf8')
  assert.ok(chatWorkspaceSource.includes('resolveChatMultimodalPolicy') && chatWorkspaceSource.includes('runtimeMultimodalPolicy'), 'chat workspace gates media entry points by product mode and current provider/model')
  assert.ok(chatWorkspaceSource.includes('resolveChatAssistantDisplayName') && chatWorkspaceSource.includes('const chatComposerPlaceholder = \'\''), 'Chat identity remains available while the composer stays visually empty')
  assert.ok(chatWorkspaceSource.includes('getMessageActivityLabel(streamingMessage, t, assistantDisplayName)'), 'Chat accessibility and system activity projection use the same resolved assistant identity')
  assert.match(chatWorkspaceSource, /const applyQuickStartDraft = useCallback\([\s\S]*?\}, \[markChromeActive\]\)/, 'Chat keeps the high-fanout Composer draft callback stable across workspace state changes')
  assert.match(chatActiveMessageVirtualListSource, /actionSheetActive=\{activeActionMessageId === message\.id\}/, 'message actions project global menu state into a per-row boolean')
  assert.doesNotMatch(chatActiveMessageVirtualListSource, /<ChatActiveMessageItem[\s\S]*?activeActionMessageId=\{activeActionMessageId\}/, 'message cells never receive the global action message id')
  assert.match(chatActiveMessageItemSource, /export const ChatActiveMessageItem = memo\(function ChatActiveMessageItem/, 'message cells skip parent-driven renders when their row inputs are unchanged')
  assert.match(chatActiveMessageItemSource, /activeActionMessageId=\{actionSheetActive \? message\.id : null\}/, 'message cells preserve the controlled MessageBubble action contract')
  assert.match(chatActiveMessageItemSource, /retryConversationMessage\([\s\S]*?catch\(\(\) => \{[\s\S]*?chat\.retryFailed[\s\S]*?chat\.retryFailedMessage/, 'message retry failures remain visible and localized')
  assert.match(chatActiveMessageItemSource, /dialog\.confirm\([\s\S]*?regenerateLastConversationAssistant\([\s\S]*?catch\(\(\) => \{[\s\S]*?chat\.regenerateFailed[\s\S]*?chat\.regenerateFailedMessage/, 'message regeneration requires confirmation and keeps failures visible and localized')
  for (const actionName of ['safeStopMessage', 'repairAgentEvidenceFromMessage', 'confirmActionFromMessage']) {
    assert.match(chatActiveWorkspaceActionsSource, new RegExp(`const ${actionName} = useCallback\\(`), `message action dependency ${actionName} stays referentially stable`)
  }
  const chatWorkspaceLifecycleSource = fs.readFileSync(path.join(root, 'src/components/chat/chatWorkspaceLifecycleState.ts'), 'utf8')
  assert.match(chatWorkspaceLifecycleSource, /function reportConversationRecoveryFailure\([\s\S]*useChatStore\.getState\(\)\.setError\(st\('storage\.sqliteRestoreFailed'/, 'conversation recovery failures reach the existing visible Chat error state')
  assert.doesNotMatch(chatWorkspaceLifecycleSource, /recoverStaleConversationMessages\([^)]*\)\.catch\(\(\) => \{\}\)/, 'conversation recovery never silently swallows activation or foreground failures')
  const providerHealthStateSource = fs.readFileSync(path.join(root, 'src/components/chat/chatWorkspaceProviderHealthState.ts'), 'utf8')
  assert.match(providerHealthStateSource, /setProviderHealth\(null\)[\s\S]*resolveConversationHealth\([\s\S]*\.catch\(\(\) => \{[\s\S]*code: 'unknown'/, 'provider health clears stale conversation state and visibly projects resolution failures')
  assert.match(chatSetupWorkspaceSource, /const setupContentTopPadding = setupLayout\.compactLandscape[\s\S]*?setupHeaderBottom \+ setupLayout\.contentHeaderGap[\s\S]*?: Math\.max\(setupHeaderBottom, compactViewport \? 68 : 80\)/, 'setup empty state derives short-landscape clearance from the shared mobile layout policy')
  assert.match(chatSetupWorkspaceSource, /<ScrollView[\s\S]*?keyboardShouldPersistTaps="handled"[\s\S]*?contentContainerStyle=\{\{[\s\S]*?flexGrow: 1,[\s\S]*?alignItems: 'center',[\s\S]*?justifyContent: setupLayout\.compactLandscape \? 'flex-start' : 'center',[\s\S]*?paddingTop: setupContentTopPadding,[\s\S]*?paddingBottom: composerBottomInset \+ keyboardLift,/, 'setup empty state centers normally, clears themed Composer chrome in short landscape, and retains keyboard-aware scroll fallback')
  assert.ok(chatActiveComposerDockSource.includes('<StreamingIntentSheet') && chatActiveComposerDockSource.includes('keyboardLift={keyboardLift}'), 'the active composer forwards the current keyboard lift to the streaming-intent sheet')
  assert.match(streamingIntentSheetSource, /const bottomOffset = Math\.max\(0, keyboardLift\) \+ Math\.max\(insets\.bottom, 10\) \+ 106/, 'the streaming-intent sheet remains above the keyboard and bottom safe area')
  assert.match(streamingIntentSheetSource, /function IntentAction\([\s\S]*accessibilityRole="button"[\s\S]*accessibilityHint=\{description\}[\s\S]*numberOfLines=\{2\}/, 'streaming-intent actions expose button semantics, descriptive hints, and bounded two-line copy')
  assert.ok(chatActiveMessageVirtualListSource.includes('paddingTop: conversation.messages.length ? 0 : emptyConversationTopPadding'), 'the active message list owns the empty-state top inset')
  assert.match(chatActiveMessageVirtualListSource, /const emptyConversationMinHeight = Math\.max\(\s*0,\s*viewportHeight - emptyConversationTopPadding - messageListBottomPadding,\s*\)/, 'the active empty state derives a stable minimum height from the available message region')
  assert.ok(chatActiveMessageVirtualListSource.includes('minHeight={emptyConversationMinHeight}') && !chatActiveMessageVirtualListSource.includes('topPadding={emptyConversationTopPadding}'), 'the active message list passes available height without duplicating its top inset')
  assert.ok(chatActiveMessageEmptyStateSource.includes('minHeight={Math.max(0, minHeight)}') && !chatActiveMessageEmptyStateSource.includes('topPadding'), 'the active empty-state adapter clamps available height without restoring top padding')
  const emptyConversationStateSource = chatEmptyStateSource.match(/export function ChatConversationEmptyState\([\s\S]*$/)?.[0] ?? ''
  assert.match(emptyConversationStateSource, /width: '100%',\s*minHeight: resolveChatConversationEmptyStateMinHeight\(minHeight\),\s*paddingHorizontal: 20,\s*alignItems: colors\.ui\.experience\.layout === 'editorial' \? 'stretch' : 'center',\s*justifyContent: 'center',/, 'active empty-state content uses the editorial width while default themes stay centered in the clamped region')
  assert.doesNotMatch(emptyConversationStateSource, /paddingTop:\s*topPadding|\bheight:\s*minHeight/, 'active empty-state content keeps list-owned insets and can grow on short keyboard viewports')
  assert.ok(chatEmptyStateSource.includes('projection.mediaReady') && chatEmptyStateSource.includes('projection.generationReady') && chatEmptyStateSource.includes('projection.generationTotal'), 'Chat readiness rendering consumes the executable media and generation projection')
  assert.ok(chatEmptyStateSource.includes('getChatMediaGenerationGateMetadata') && chatEmptyStateSource.includes('projection.generationGateIds'), 'Chat readiness details retain named future generation gates')
  assert.ok(chatEmptyStateSource.includes('presentChatEmptyStateBoundaryAction') && chatEmptyStateSource.includes('onInspectProvider') && chatEmptyStateSource.includes('onOpenMemory') && chatEmptyStateSource.includes('onOpenTools'), 'Chat readiness rendering dispatches the executable provider, memory, and tools action contract')
  assert.ok(chatEmptyStateSource.includes('projection.accessibility.role') && chatEmptyStateSource.includes('projection.accessibility.minimumTouchTarget'), 'Chat readiness rendering consumes its projected accessibility contract')
  assert.ok(chatSetupWorkspaceSource.includes("onOpenTools={() => setComposerPanel('more')}") && chatActiveMessageEmptyStateSource.includes("onOpenTools={() => setComposerPanel('more')}"), 'setup and active Chat surfaces route readiness inspection to composer tools')
  assert.ok(chatWorkspaceSource.includes("pushChatSettingsRoute('/settings/memory', { focus: 'review' })"), 'Chat readiness can route pending context memory to review')

  const boundaryStatusSource = fs.readFileSync(path.join(root, 'src/presentation/features/chat/chatBoundaryStatus.ts'), 'utf8')
  assert.ok(boundaryStatusSource.includes('Object.values(policy.entries)') && boundaryStatusSource.includes('pendingMemoryCount > 0'), 'boundary status contract derives provider and memory actions from Chat readiness only')
  assert.doesNotMatch(boundaryStatusSource, /memoryScope|tavern-isolated|agent-evidence|mode-policy/, 'boundary status cannot restore historical mode or Tavern memory authority')
  assert.ok(boundaryStatusSource.includes('ChatBoundaryStatusActionMetadata') && boundaryStatusSource.includes('requiresConfirmation'), 'boundary status contract records action metadata and confirmation posture')
  assert.ok(!fs.existsSync(path.join(root, 'src/product/modeBoundaryStatus.ts')), 'retired product-mode boundary-status path stays deleted')

  const composerSource = fs.readFileSync(path.join(root, 'src/components/chat/Composer.tsx'), 'utf8')
  assert.ok(composerSource.includes('multimodalPolicy?.unavailableCount') && composerSource.includes('hasBlockedAttachment'), 'composer exposes capability-aware media controls and blocks unsupported draft attachments')
  assert.match(composerSource, /const attachment = await picker\(\)[\s\S]*?if \(attachment\) \{[\s\S]*?markDraftChanged\(\)[\s\S]*?setAttachments\(\(items\) => \[\.\.\.items, attachment\]\)[\s\S]*?\}[\s\S]*?catch \{[\s\S]*?dialog\.toast\(\{[\s\S]*?chat\.attachmentPickerFailed[\s\S]*?chat\.attachmentPickerFailedMessage/, 'composer keeps intentional picker cancellation quiet while surfacing real picker failures')
  assert.ok(!composerSource.includes('getChatMediaGenerationGateMetadata') && !composerSource.includes('generationGateSummary'), 'composer omits the removed visible future-generation gate paragraph')
  assert.ok(!composerSource.includes('generationReadinessSummary') && !composerSource.includes('multimodalCapabilityNoticeWithGenerationGate'), 'composer leaves readiness ratios in the action-triggered boundary explanation')
  for (const forbiddenAction of ['onGenerateImage', 'onGenerateVideo', 'generateImage', 'generateVideo']) {
    assert.ok(!composerSource.includes(forbiddenAction), `composer does not expose ${forbiddenAction} while generation is diagnostic-only`)
  }
  const composerSourceState = fs.readFileSync(path.join(root, 'src/components/chat/chatComposerSourceState.tsx'), 'utf8')
  const composerSourceCache = fs.readFileSync(path.join(root, 'src/components/chat/chatComposerSourceCache.ts'), 'utf8')
  assert.match(composerSourceState, /sourceLoadPromiseRef\.current \?\?= loadComposerSourceSnapshot\([\s\S]*loadSkills: listSkills[\s\S]*loadDocuments: listComposerKnowledgeDocuments[\s\S]*loadMemories: listComposerMemories/, 'composer sources share one failure-bounded load per mounted Chat lifecycle')
  assert.match(composerSourceCache, /const controller = new AbortController\(\)[\s\S]*loadOptional[\s\S]*Promise\.all\([\s\S]*loaders\.loadSkills[\s\S]*loaders\.loadDocuments\(controller\.signal\)[\s\S]*loaders\.loadMemories\(controller\.signal\)/, 'composer source reads fail open per optional source behind one shared cancellation boundary')
  assert.match(composerSourceCache, /let inFlight: ComposerSourceLoadEntry \| null = null[\s\S]*const entry = inFlight \?\? startComposerSourceLoad\(loaders\)/, 'concurrent Chat surfaces coalesce composer source reads')
  assert.match(composerSourceCache, /cacheGeneration \+= 1[\s\S]*previous\?\.controller\.abort\(\)[\s\S]*generation === cacheGeneration/, 'cache invalidation aborts stale work and fences late results')
  assert.match(composerSourceCache, /COMPOSER_SOURCE_CACHE_TTL_MS[\s\S]*cache = \{ expiresAt:/, 'composer source reads reuse a bounded short-lived snapshot')
  assert.match(composerSourceState, /invalidateComposerSourceCache\(\)[\s\S]*setSkills/, 'skill refreshes invalidate the shared composer source snapshot')
  assert.match(composerSourceState, /if \(!active\) return[\s\S]*const controller = new AbortController\(\)[\s\S]*if \(cancelled \|\| controller\.signal\.aborted\) return/, 'inactive Chat defers applying an in-flight source snapshot until the page is active')
  assert.match(composerSourceState, /return \(\) => \{[\s\S]*controller\.abort\(\)[\s\S]*sourceLoadPromiseRef\.current = null/, 'inactive Chat detaches its source-load subscriber and can refresh on the next activation')
  assert.match(composerSourceState, /const composerCommands = useMemo\([\s\S]*!active[\s\S]*const composerReferences = useMemo\([\s\S]*!active/, 'inactive Chat skips rebuilding command and reference projections')

  const multimodalPolicySource = fs.readFileSync(path.join(root, 'src/presentation/features/chat/chatMultimodalPolicy.ts'), 'utf8')
  assert.ok(multimodalPolicySource.includes('resolveProviderCapabilityManifest'), 'multimodal product policy derives image/file support from provider capability manifests')
  assert.ok(multimodalPolicySource.includes('providerCompatibilityCapabilityCanBeSentForProvider'), 'multimodal product policy checks provider audio compatibility before voice transcription')
  assert.ok(multimodalPolicySource.includes('summarizeChatMediaGenerationGateReadiness') && multimodalPolicySource.includes('blocksDefaultEnablement'), 'multimodal product policy exposes default-enable blocking readiness gates for future generation')
  assert.doesNotMatch(multimodalPolicySource, /ProductInteractionMode|ProductModeMultimodal|input\.mode\b/, 'Chat multimodal policy exposes no historical product-mode authority')
  assert.ok(!fs.existsSync(path.join(root, 'src/product/modeMultimodalPolicy.ts')), 'retired product-mode multimodal path stays deleted')

  const mediaGenerationSource = fs.readFileSync(path.join(root, 'src/services/mediaGenerationContract.ts'), 'utf8')
  const mediaGenerationCoreSource = fs.readFileSync(path.join(root, 'src/core/mediaGenerationContracts.ts'), 'utf8')
  assert.ok(mediaGenerationCoreSource.includes('MEDIA_GENERATION_ADAPTER_IMPLEMENTED = false'), 'media generation adapter remains disabled while readiness is diagnostic-only')
  assert.ok(mediaGenerationSource.includes('summarizeMediaGenerationAdapterProofWorklist'), 'media generation readiness is represented by proof worklist counts')

  const apiKeyPanelSource = fs.readFileSync(path.join(root, 'src/components/settings/ApiKeyPanel.tsx'), 'utf8')
  assert.ok(!apiKeyPanelSource.includes('MediaGenerationDisabledAdapterPanel'), 'provider settings keep implementation-readiness gates out of the model capability summary')
  assert.ok(!apiKeyPanelSource.includes('provider settings generation execution action'), 'provider settings do not expose generation execution actions')

  const providerAdmissionSource = fs.readFileSync(path.join(root, 'src/modules/assistant-runtime/application/assistantConversationProviderAdmissionRuntime.ts'), 'utf8')
  const providerAdmissionBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/conversationAssistantProviderAdmissionRuntime.ts'), 'utf8')
  assert.ok(
    providerAdmissionBootstrapSource.includes('conversationProviderAdmissionRuntime.admitConversation') &&
    providerAdmissionSource.includes("admission.kind === 'setup_required'") &&
    providerAdmissionSource.includes("admission.kind === 'rejected'") &&
    providerAdmissionSource.includes("admission.kind === 'failed'") &&
    providerAdmissionSource.includes("dependencies.translate('chatRunner.error.sendFailed')") &&
    providerAdmissionSource.includes('dependencies.projectTerminalFailure({') &&
    providerAdmissionBootstrapSource.includes('projectTerminalFailure: projectConversationAssistantFailure'),
    'chat runtime maps typed provider-admission failures to user-facing recovery states',
  )

  const messageContentSource = fs.readFileSync(path.join(root, 'src/components/chat/MessageContent.tsx'), 'utf8')
  assert.ok(messageContentSource.includes('MARKDOWN_RENDER_CHAR_LIMIT'), 'rich message content bounds long markdown rendering')
  assert.match(messageContentSource, /MARKDOWN_RENDER_EXPANSION_CHAR_COUNT[\s\S]*Math\.min\(content\.length, currentLimit \+ MARKDOWN_RENDER_EXPANSION_CHAR_COUNT\)/, 'completed markdown expands in bounded increments instead of staying permanently truncated or rendering an unbounded payload')
  assert.match(messageContentSource, /hiddenCharCount > 0 \|\| expanded[\s\S]*accessibilityRole="button"[\s\S]*common\.expand[\s\S]*common\.collapse[\s\S]*minHeight: ISLE_MIN_TOUCH_TARGET/, 'long markdown exposes accessible expand and collapse controls through the shared touch target')
  assert.match(messageContentSource, /requestAnimationFrame\(\(\) => onLayoutChangeRequest\?\.\(\)\)/, 'markdown disclosure asks the virtual list to remeasure after its height changes')
  assert.ok(messageContentSource.includes('STREAMING_MARKDOWN_RENDER_CHAR_LIMIT'), 'streaming message content bounds plain-text rendering during token growth')
  assert.ok(messageContentSource.includes('DATA_PREVIEW_CHAR_LIMIT'), 'rich message content bounds large data preview rendering')
  assert.ok(messageContentSource.includes('SOURCE_LINE_RENDER_LIMIT'), 'rich message content bounds source-line rendering for large blocks')
  assert.ok(messageContentSource.includes('TABLE_ROW_RENDER_LIMIT'), 'rich message content bounds large table row rendering')
  assert.match(messageContentSource, /const shouldStackRows = width < 380 && columnCount >= STACKED_TABLE_COLUMN_THRESHOLD[\s\S]*\{shouldStackRows \? \([\s\S]*<StackedTableRows/, 'narrow screens stack tables with four or more columns while compact tables keep horizontal grid rendering')
  assert.ok(messageContentSource.includes('createBoundedDataPreview'), 'rich data previews truncate before expensive full rendering')
  assert.ok(messageContentSource.includes('truncatedDataPreview'), 'rich data previews explain bounded rendering')
  assert.ok(messageContentSource.includes('parseDelimitedTablePreview'), 'rich delimited table parsing is bounded for large data blocks')
  const dialogSource = fs.readFileSync(path.join(root, 'src/components/ui/isle/Dialog.tsx'), 'utf8')
  assert.match(dialogSource, /const dialogMaxHeight = Math\.max\(240, height - modalPaddingTop - modalPaddingBottom\)[\s\S]*paddingTop: modalPaddingTop,[\s\S]*paddingBottom: modalPaddingBottom,[\s\S]*maxHeight: dialogMaxHeight/, 'shared dialogs stay inside the current viewport and both safe-area edges')
  assert.ok(dialogSource.includes("behavior={Platform.OS === 'ios' ? 'padding' : 'height'}"), 'shared dialogs avoid the keyboard on iOS and Android')
  assert.ok(dialogSource.includes('accessibilityViewIsModal'), 'shared dialogs expose modal accessibility containment')
  assert.match(dialogSource, /<Pressable[\s\S]*?accessible=\{false\}[\s\S]*?accessibilityRole="none"[\s\S]*?onPress=\{\(\) => closeDialog\(false\)\}[\s\S]*?backgroundColor: colors\.backdrop/, 'the touch-dismiss backdrop stays out of the accessibility tree because every dialog exposes explicit close and action controls')
  assert.doesNotMatch(dialogSource, /<Pressable[\s\S]*?accessibilityLabel=\{t\('dialog\.closeLayer'\)\}[\s\S]*?closeDialog\(false\)/, 'shared dialogs do not announce an unreachable duplicate backdrop close button')
  assert.equal((dialogSource.match(/<DialogScrollableContent/g) ?? []).length, 4, 'all four canonical theme dialogs keep long content scrollable above fixed actions')
  assert.match(dialogSource, /function DialogScrollableContent[\s\S]*keyboardDismissMode="on-drag"[\s\S]*keyboardShouldPersistTaps="handled"[\s\S]*style=\{\{ flexShrink: 1 \}\}/, 'dialog content scrolls without blocking embedded form controls')
  assert.match(dialogSource, /resolveAppFeedbackTimeout\(durationMs, AccessibilityInfo\)[\s\S]*setTimeout\(\(\) => dismissToast\(activeToast\.id\), recommendedDurationMs\)/, 'toast dismissal resolves the system accessibility timeout before scheduling dismissal')
  assert.doesNotMatch(dialogSource, /AccessibilityInfo\.getRecommendedTimeoutMillis\(/, 'the Dialog provider does not directly call an optional platform accessibility method')
  const appFeedbackTimeoutSource = fs.readFileSync(path.join(root, 'src/components/ui/appFeedbackTimeout.ts'), 'utf8')
  assert.ok(
    appFeedbackTimeoutSource.includes("typeof resolveRecommendedTimeout !== 'function'") &&
    appFeedbackTimeoutSource.includes('resolveRecommendedTimeout.call(accessibilityInfo, durationMs)') &&
    appFeedbackTimeoutSource.includes('await Promise.race([') &&
    appFeedbackTimeoutSource.includes('setTimeout(() => resolve(durationMs), lookupLimitMs)') &&
    appFeedbackTimeoutSource.includes('isValidRecommendedTimeout(recommendedTimeout) ? recommendedTimeout : durationMs') &&
    appFeedbackTimeoutSource.includes('catch {') &&
    appFeedbackTimeoutSource.includes('return durationMs'),
    'toast accessibility timeouts preserve receiver binding and fail closed to the requested duration',
  )
  assert.equal(
    shouldPromotePlainDelimitedRows([
      ['The search tool failed to find the requested documentation', 'as it returned only irrelevant dictionary definitions.'],
      ['Next steps available', 'try another search with a more precise query.'],
      ['In the meantime', 'the official reference is available online.'],
    ]),
    false,
    'multi-line prose with commas is not promoted to a CSV table',
  )
  assert.equal(
    shouldPromotePlainDelimitedRows([
      ['name', 'status'],
      ['search_web', 'ready'],
      ['read_file', 'ready'],
    ]),
    true,
    'compact header-led delimited rows remain eligible for table rendering',
  )
  assert.equal(
    sanitizeInternalChatOutputText('Visible answer\n<islemind_mcp_call>{"tool":"search_web"}</islemind_mcp_call>'),
    'Visible answer\n',
    'completed tagged MCP requests stay out of assistant presentation',
  )
  assert.equal(
    sanitizeInternalChatOutputText('<islemind_mcp_call>{"serverId":"islemind-builtins","tool":"search_web","arguments":{"query":"off'),
    '',
    'partial streaming MCP request tags stay hidden before the closing tag arrives',
  )
  assert.ok(messageContentSource.includes('copyText ?? rows.map'), 'bounded table previews keep a full-copy escape hatch')
  assert.ok(messageContentSource.includes('Clipboard.setStringAsync(content)'), 'rich message content preserves full-block copy when rendering is bounded')
  assert.ok(messageContentSource.includes('Clipboard.setStringAsync(tableCopyText)'), 'rich table content preserves full-table copy when rendering is bounded')

  const tracePresentationSource = fs.readFileSync(path.join(root, 'src/components/chat/tracePresentation.ts'), 'utf8')
  assert.ok(tracePresentationSource.includes('countTraceStatuses'), 'trace summary counts statuses in one pass')
  assert.ok(tracePresentationSource.includes('for (let index = normalized.length - 1'), 'active trace selection avoids extra active-trace array copies')

  const contextPanelSource = fs.readFileSync(path.join(root, 'src/components/settings/ContextPanel.tsx'), 'utf8')
  assert.ok(contextPanelSource.includes('countMemoryStatuses'), 'context panel counts memory statuses in one pass')
  assert.ok(contextPanelSource.includes('useMemo(() => filterAndSortMemories'), 'context panel memoizes filtered memory views')
  assert.ok(contextPanelSource.includes('contextSummaryItems.length ?'), 'context settings hides overview chips until context, memory, or knowledge state is meaningful')
  assert.ok(contextPanelSource.includes("searchCredentialsConfiguredCount > 0"), 'context settings treats configured search credentials as a meaningful summary trigger')
  const searchConfigSaveSource = contextPanelSource.match(/async function saveTavilyKey\(\) \{[\s\S]*?\n  \}/)?.[0] ?? ''
  assert.ok(searchConfigSaveSource.includes('googleSearchCxDraft.trim()') && searchConfigSaveSource.includes('customSearchEndpointDraft.trim()'), 'search configuration trims local non-secret drafts at explicit save time')
  assert.ok(searchConfigSaveSource.includes("updateSettings(settingsUpdates)"), 'search configuration commits non-secret drafts through one explicit Settings update')
  assert.doesNotMatch(contextPanelSource, /onChangeText: \(customSearchEndpoint\) => updateSettings/, 'custom search endpoint input does not persist the complete Settings snapshot per keypress')
  assert.doesNotMatch(contextPanelSource, /case 'googleSearchCx':[\s\S]{0,160}updateSettings/, 'Google CX input does not persist the complete Settings snapshot per keypress')
  assert.match(contextPanelSource, /useEffect\(\(\) => setCustomSearchEndpointDraft\(settings\.customSearchEndpoint \?\? ''\), \[settings\.customSearchEndpoint\]\)/, 'custom search endpoint draft follows imported and reset Settings values')
  assert.match(contextPanelSource, /function commitLocalModelMirror\(\) \{[\s\S]*?updateSettings\(\{ localModelDownloadMirrorBaseUrl: nextMirrorBaseUrl \}\)/, 'local-model mirror configuration commits one normalized Settings update')
  assert.match(contextPanelSource, /value: localModelMirrorDraft,[\s\S]{0,240}onChangeText: setLocalModelMirrorDraft,[\s\S]{0,240}onBlur: commitLocalModelMirror,[\s\S]{0,240}onSubmitEditing: commitLocalModelMirror/, 'local-model mirror input keeps a draft and commits on blur or keyboard submission')
  assert.doesNotMatch(contextPanelSource, /onChangeText: \(localModelDownloadMirrorBaseUrl\) => updateSettings/, 'local-model mirror input does not persist the complete Settings snapshot per keypress')
  assert.match(contextPanelSource, /function ContextList\([\s\S]*?minHeight: 44,[\s\S]*?style=\{\{ width: 44, height: 44,/, 'context knowledge and memory clear controls reserve explicit 44dp rows and hit targets')

  const resetSource = fs.readFileSync(path.join(root, 'src/bootstrap/portableDataReset.ts'), 'utf8')
  assert.ok(resetSource.includes('portableDataResetRuntime'), 'bootstrap exposes the target-owned full local data cleanup seam')
}

if (require.main === module) run()

module.exports = { run }
