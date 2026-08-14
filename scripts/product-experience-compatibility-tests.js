const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

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
    /function AnimatedProcessStatusText\(\{ active, label, tone, motion \}[\s\S]*?const shimmer = active && motion === 'full'[\s\S]*?setInterval\(\(\) =>[\s\S]*?loop: shimmer/.test(messageBubbleSource) &&
      messageBubbleSource.includes("'.'.repeat(motion === 'none' ? 3 : dotCount)") &&
      !messageBubbleSource.includes('function ProcessSpinner') &&
      !messageBubbleSource.includes('<ProcessAnchor'),
    'all active reply stages share one reduced-motion-aware shimmer and dynamic-dot status without a circular anchor',
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
  assert.ok(settingsScreenSource.includes('settingsAttentionItems.length ?'), 'settings status chips stay hidden unless attention is needed')
  assert.ok(settingsScreenSource.includes('runtimeDiagnosticMediaGeneration') && settingsScreenSource.includes('adapterProofWorklist'), 'settings diagnostics expose media generation readiness as proof counts only')
  assert.ok(!settingsScreenSource.includes('function SettingsQuickLink'), 'settings home removes the old arrow-row settings directory')
  assert.ok(!settingsScreenSource.includes('expandedAppearanceGroups'), 'appearance settings no longer require nested disclosure taps')

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
  const chatActiveMessageVirtualListSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveMessageVirtualList.tsx'), 'utf8')
  const chatActiveMessageEmptyStateSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveMessageEmptyState.tsx'), 'utf8')
  const chatEmptyStateSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatEmptyState.tsx'), 'utf8')
  assert.ok(chatWorkspaceSource.includes('resolveChatMultimodalPolicy') && chatWorkspaceSource.includes('runtimeMultimodalPolicy'), 'chat workspace gates media entry points by product mode and current provider/model')
  assert.ok(chatWorkspaceSource.includes('resolveChatAssistantDisplayName') && chatWorkspaceSource.includes('namedComposerPlaceholder'), 'Chat empty and composer copy resolve the optional assistant display name')
  assert.ok(chatWorkspaceSource.includes('getMessageActivityLabel(streamingMessage, t, assistantDisplayName)'), 'Chat accessibility and system activity projection use the same resolved assistant identity')
  assert.match(chatSetupWorkspaceSource, /<ScrollView[\s\S]*?keyboardShouldPersistTaps="handled"[\s\S]*?contentContainerStyle=\{\{[\s\S]*?flexGrow: 1,[\s\S]*?alignItems: 'center',[\s\S]*?justifyContent: 'center',[\s\S]*?paddingTop:[\s\S]*?paddingBottom: composerBottomInset \+ keyboardLift,/, 'setup empty state centers inside the safe keyboard-aware message region and retains scroll fallback')
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
  assert.ok(!composerSource.includes('getChatMediaGenerationGateMetadata') && !composerSource.includes('generationGateSummary'), 'composer omits the removed visible future-generation gate paragraph')
  assert.ok(!composerSource.includes('generationReadinessSummary') && !composerSource.includes('multimodalCapabilityNoticeWithGenerationGate'), 'composer leaves readiness ratios in the action-triggered boundary explanation')
  for (const forbiddenAction of ['onGenerateImage', 'onGenerateVideo', 'generateImage', 'generateVideo']) {
    assert.ok(!composerSource.includes(forbiddenAction), `composer does not expose ${forbiddenAction} while generation is diagnostic-only`)
  }

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
  assert.ok(messageContentSource.includes('STREAMING_MARKDOWN_RENDER_CHAR_LIMIT'), 'streaming message content bounds plain-text rendering during token growth')
  assert.ok(messageContentSource.includes('DATA_PREVIEW_CHAR_LIMIT'), 'rich message content bounds large data preview rendering')
  assert.ok(messageContentSource.includes('SOURCE_LINE_RENDER_LIMIT'), 'rich message content bounds source-line rendering for large blocks')
  assert.ok(messageContentSource.includes('TABLE_ROW_RENDER_LIMIT'), 'rich message content bounds large table row rendering')
  assert.ok(messageContentSource.includes('createBoundedDataPreview'), 'rich data previews truncate before expensive full rendering')
  assert.ok(messageContentSource.includes('truncatedDataPreview'), 'rich data previews explain bounded rendering')
  assert.ok(messageContentSource.includes('parseDelimitedTablePreview'), 'rich delimited table parsing is bounded for large data blocks')
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
  assert.match(contextPanelSource, /function ContextList\([\s\S]*?minHeight: 44,[\s\S]*?style=\{\{ width: 44, height: 44,/, 'context knowledge and memory clear controls reserve explicit 44dp rows and hit targets')

  const resetSource = fs.readFileSync(path.join(root, 'src/bootstrap/portableDataReset.ts'), 'utf8')
  assert.ok(resetSource.includes('portableDataResetRuntime'), 'bootstrap exposes the target-owned full local data cleanup seam')
}

if (require.main === module) run()

module.exports = { run }
