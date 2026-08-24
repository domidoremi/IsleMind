const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

if (process.argv.includes('--focus=pager-transition')) {
  assertPagerTransitionSourceContract()
  console.log('Product mobile pager transition source contract passed')
  process.exit(0)
}

const ts = require('typescript')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  PRODUCT_MOBILE_COMPOSER_COMPACT_BREAKPOINT,
  PRODUCT_MOBILE_LAYOUT_AUDIT_VIEWPORTS,
  PRODUCT_MOBILE_VISUAL_AUDIT_HEIGHTS,
  resolveProductMobileChatConfigurationSheetLayout,
  resolveProductMobileChatSetupLayout,
  resolveProductMobileLayout,
  resolveProductMobileComposerLayout,
  resolveProductMobileComposerToolsLayout,
  resolveProductMobileMessageListLayout,
  resolveProductMobilePagerTransition,
  resolveProductMobileVisualAuditFrame,
} = require('../src/presentation/layout/productMobileLayout.ts')
const { CHAT_PRESENTATION_CATALOG } = require('../src/presentation/features/chat/chatPresentationCatalog.ts')
const { buildMessageListAccessibility, buildMessageListExtraData } = require('../src/components/chat/chatMessageListState.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isProductMobileLayoutHook) return

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
  hook.isProductMobileLayoutHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function assertPagerTransitionSourceContract() {
  const source = fs.readFileSync(path.join(root, 'src/components/main/MainPagerShell.tsx'), 'utf8')
  const switchToSource = source.match(/function switchTo\(next: MainPagerPage\) \{[\s\S]*?\n  \}/)?.[0] ?? ''

  assert.match(source, /const MAIN_PAGER_PATH_BY_PAGE:[\s\S]*history: '\/conversations'[\s\S]*home: '\/'[\s\S]*settings: '\/settings'/, 'pager centralizes compatible aliases')
  assert.match(source, /const resolvedInitialPage = routePage \?\? initialPage[\s\S]*const \[page, setPage\] = useState<MainPagerPage>\(resolvedInitialPage\)/, 'top-level aliases seed one durable pager instance instead of becoming a second live navigation authority')
  assert.match(source, /useState<ReadonlySet<MainPagerPage>>[\s\S]*new Set\(\[resolvedInitialPage\]\)/, 'pager mounts only the route-resolved first page')
  assert.match(source, /if \(!mountedPages\.has\(item\.id\) && item\.id !== page\) return null[\s\S]*?<PagerPage[\s\S]*?active=\{active\}[\s\S]*?direction=\{direction\}[\s\S]*?\{item\.node\}[\s\S]*?<\/PagerPage>/, 'visited pages stay mounted while unvisited heavy trees remain deferred')
  assert.match(switchToSource, /setMountedPages\([\s\S]*setPreviousPage\(page\)[\s\S]*setTransitionDirection\([\s\S]*if \(next === 'home' && pathname !== MAIN_PAGER_PATH_BY_PAGE\.home\)[\s\S]*router\.replace\(MAIN_PAGER_PATH_BY_PAGE\.home\)[\s\S]*setPage\(next\)/, 'top-level intent switches the retained pager locally and normalizes only compatibility-alias returns')
  assert.doesNotMatch(switchToSource, /router\.(?:push|dismissTo)/, 'ordinary top-level navigation does not create or destroy duplicate native stack screens')
  assert.doesNotMatch(source, /transitionRequest|readinessToken|handlePagerPageReady|requestPagerPageChild|withTiming|withSpring|GestureDetector|Animated\.View/, 'pager avoids readiness handshakes and feature-owned animation primitives')
  assert.match(source, /<IsleMotionFrame[\s\S]*role="page"[\s\S]*direction=\{direction\}[\s\S]*importantForAccessibility=\{active \? 'auto' : 'no-hide-descendants'\}[\s\S]*pointerEvents=\{active \? 'auto' : 'none'\}/, 'semantic page motion preserves touch and accessibility isolation')
  assert.match(source, /function blurActivePagerFocus\(\)[\s\S]*activeElement[\s\S]*activeElement\.blur/, 'pager clears focused Web controls before hiding the previous page')
  assert.match(switchToSource, /blurActivePagerFocus\(\)[\s\S]*setMountedPages\(/, 'pager clears focus before committing the page visibility change')
  assert.doesNotMatch(source, /MainPagerExperience|AppTopBar|ThemeNavigationDrawer|shellNavigation/, 'pager does not own global header chrome or navigation drawers')
  assert.doesNotMatch(source, /accessibilityRole="tablist"|accessibilityRole="tab"/, 'the main header does not restore a full-width segmented tab control')
  assert.match(source, /styles\.opaqueFallback[\s\S]*colors\.background\.canvas/, 'pager has an opaque canvas fallback that matches the immersive screen')
  assert.match(source, /<RetainedHomeScreenContent[\s\S]*?active=\{page === 'home'\}/, 'Home work follows settled active state')
  assert.match(source, /const showHome = useCallback\(\(\) => switchToRef\.current\('home'\), \[\]\)[\s\S]*const showHistory = useCallback[\s\S]*const showSettings = useCallback/, 'retained pages receive stable navigation callbacks')
  assert.doesNotMatch(source, /import \{ (?:ConversationsScreenContent|SettingsScreenContent) \} from '\.\/(?:ConversationsScreenContent|SettingsScreenContent)'/, 'unvisited History and Settings modules stay out of the synchronous Chat startup graph')
  assert.match(source, /const LazyConversationsScreenContent = createLazyComponent\([\s\S]*import\('\.\/ConversationsScreenContent'\)[\s\S]*const LazySettingsScreenContent = createLazyComponent\([\s\S]*import\('\.\/SettingsScreenContent'\)/, 'History and Settings begin loading only when their retained page first renders')
  assert.match(source, /const RetainedConversationsScreenContent = memo\(LazyConversationsScreenContent\)[\s\S]*const RetainedHomeScreenContent = memo\(HomeScreenContent\)[\s\S]*const RetainedSettingsScreenContent = memo\(LazySettingsScreenContent\)/, 'retained pager boundaries skip parent-only updates after their modules load')
  assert.match(source, /<RetainedConversationsScreenContent[\s\S]*active=\{page === 'history'\}[\s\S]*onHome=\{showHome\}[\s\S]*<RetainedHomeScreenContent[\s\S]*active=\{page === 'home'\}/, 'pager renders its heavy retained pages through the memoized boundaries')
  assert.match(source, /<RetainedSettingsScreenContent onHome=\{showHome\} \/>/, 'the retained Settings tree does not re-render for pager visibility changes')
}

function run() {
  assertPagerTransitionSourceContract()

  const idleListExtraData = buildMessageListExtraData({
    activeActionMessageId: null,
    isStreaming: false,
    messageListMotion: 'full',
    conversationTasks: [],
    multiSelectActive: false,
    selectedMessageSignature: '',
  })
  const streamingListExtraData = buildMessageListExtraData({
    activeActionMessageId: null,
    isStreaming: true,
    messageListMotion: 'full',
    conversationTasks: [],
    multiSelectActive: false,
    selectedMessageSignature: '',
  })
  assert.equal(idleListExtraData.isStreaming, false, 'idle message-list extra data clears the native busy state')
  assert.equal(streamingListExtraData.isStreaming, true, 'streaming message-list extra data forces the native busy state refresh')
  const accessibilityT = (key) => key
  assert.deepEqual(buildMessageListAccessibility({ activityLabel: '', isStreaming: false, messageCount: 2, t: accessibilityT }), {
    value: 'chat.messageListAccessibilityValue',
    state: { busy: false },
  }, 'idle message-list accessibility explicitly clears the native busy flag')
  assert.deepEqual(buildMessageListAccessibility({ activityLabel: 'working', isStreaming: true, messageCount: 2, t: accessibilityT }), {
    value: 'chat.messageListGeneratingAccessibilityValue',
    state: { busy: true },
  }, 'streaming message-list accessibility explicitly sets the native busy flag')

  assert.deepEqual(
    PRODUCT_MOBILE_LAYOUT_AUDIT_VIEWPORTS,
    [320, 360, 390],
    'mobile layout audit covers the required 320-390px viewports',
  )
  assert.equal(393 < PRODUCT_MOBILE_COMPOSER_COMPACT_BREAKPOINT, true, 'common 393dp Android devices use the compact Composer control rail')
  assert.equal(400 < PRODUCT_MOBILE_COMPOSER_COMPACT_BREAKPOINT, false, '400dp and wider Composer layouts keep labeled secondary controls')
  assert.deepEqual(
    PRODUCT_MOBILE_VISUAL_AUDIT_HEIGHTS,
    [568, 640, 844],
    'mobile visual audit covers short, common, and tall mobile heights',
  )

  assert.deepEqual(
    resolveProductMobileChatSetupLayout(568, 320),
    {
      compactLandscape: true,
      contentHeaderGap: 4,
      showIntroDecoration: false,
      showIntroDescription: false,
    },
    'short landscape setup removes only decorative density and starts below the persistent header',
  )
  assert.deepEqual(
    resolveProductMobileChatSetupLayout(320, 568),
    {
      compactLandscape: false,
      contentHeaderGap: 0,
      showIntroDecoration: true,
      showIntroDescription: true,
    },
    'portrait setup preserves the full empty-state presentation',
  )
  assert.equal(resolveProductMobileChatSetupLayout(640, 360).compactLandscape, true, '360px-high landscape uses the compact setup boundary')
  assert.equal(resolveProductMobileChatSetupLayout(640, 361).compactLandscape, false, 'taller landscape keeps the full setup presentation')
  assert.equal(resolveProductMobileChatSetupLayout(360, 360).compactLandscape, false, 'square viewports do not opt into landscape-only compaction')

  assert.deepEqual(
    resolveProductMobileChatConfigurationSheetLayout(320),
    {
      height: 308,
      availableHeight: 308,
      compact: true,
    },
    'short landscape AI configuration stays fully inside the viewport instead of enforcing an off-screen minimum',
  )
  assert.deepEqual(
    resolveProductMobileChatConfigurationSheetLayout(320, { safeAreaTop: 44 }),
    {
      height: 276,
      availableHeight: 276,
      compact: true,
    },
    'short landscape AI configuration preserves the physical top safe area',
  )
  assert.deepEqual(
    resolveProductMobileChatConfigurationSheetLayout(568),
    {
      height: 523,
      availableHeight: 556,
      compact: false,
    },
    'portrait AI configuration keeps the established near-full-height sheet rhythm',
  )

  for (const width of PRODUCT_MOBILE_LAYOUT_AUDIT_VIEWPORTS) {
    const layout = resolveProductMobileLayout(width)
    const composer = resolveProductMobileComposerLayout(width, {
      composerHeight: 118,
      safeAreaBottom: 24,
      keyboardLift: 216,
    })
    const composerTools = resolveProductMobileComposerToolsLayout(width, {
      entryCount: 6,
      unavailableEntryCount: 3,
    })
    const messageList = resolveProductMobileMessageListLayout(width, {
      topChromeInset: 68,
      chromeHeight: 50,
    })
    const transition = resolveProductMobilePagerTransition(width, { motionFull: true })
    const reducedTransition = resolveProductMobilePagerTransition(width, { motionFull: false })
    const shortFrame = resolveProductMobileVisualAuditFrame(width, {
      viewportHeight: PRODUCT_MOBILE_VISUAL_AUDIT_HEIGHTS[0],
      composerHeight: 118,
      safeAreaBottom: 10,
      keyboardLift: 0,
      topChromeInset: transition.persistentTopBarOffset,
      chromeHeight: 50,
    })
    const commonFrame = resolveProductMobileVisualAuditFrame(width, {
      viewportHeight: PRODUCT_MOBILE_VISUAL_AUDIT_HEIGHTS[1],
      composerHeight: 118,
      safeAreaBottom: 10,
      keyboardLift: 0,
      topChromeInset: transition.persistentTopBarOffset,
      chromeHeight: 50,
    })
    const keyboardFrame = resolveProductMobileVisualAuditFrame(width, {
      viewportHeight: PRODUCT_MOBILE_VISUAL_AUDIT_HEIGHTS[0],
      composerHeight: 118,
      safeAreaBottom: 24,
      keyboardLift: 216,
      topChromeInset: transition.persistentTopBarOffset,
      chromeHeight: 50,
    })
    const topBar = layout.topBar
    const starter = layout.starter
    const consumedTopBarWidth = topBar.horizontalInset * 2 + topBar.actionSize * 2 + topBar.gap * 2 + topBar.centerPadding * 2

    assert.equal(layout.viewportWidth, width, `${width}px layout records viewport`)
    assert.ok(topBar.actionSize >= 44, `${width}px top-bar actions meet mobile touch target`)
    assert.ok(consumedTopBarWidth <= width, `${width}px top-bar controls fit without horizontal overflow`)
    assert.ok(topBar.availableCenterWidth >= topBar.centerPadding * 2, `${width}px Chat title keeps a bounded center slot`)
    assert.ok(topBar.selectedLabelFontSize >= topBar.inactiveLabelFontSize, `${width}px active Chat title remains visually dominant`)

    assert.ok(starter.setupContentMaxWidth <= width - 40, `${width}px setup starter content respects horizontal gutters`)
    assert.ok(starter.emptyContentMaxWidth <= width - 40, `${width}px empty starter content respects horizontal gutters`)
    assert.ok(starter.actionMinWidth >= 132, `${width}px sparse entry actions retain a stable touch width`)
    assert.ok(starter.statusPillGlyphSize >= 8.5, `${width}px boundary status action glyph remains legible`)

    assert.ok(composer.minimumHeight >= 112, `${width}px two-level composer keeps a stable collapsed height`)
    assert.ok(composer.horizontalPadding >= 12, `${width}px floating composer keeps side gutters`)
    assert.equal(composer.floatingBottomOffset, 216, `${width}px floating composer follows keyboard lift`)
    assert.ok(composer.innerBottomPadding >= 30, `${width}px composer includes safe-area bottom padding`)
    assert.ok(composer.bottomInset >= 118 + 24, `${width}px message list reserves measured composer height plus safe area`)
    assert.equal(composer.messageListBottomPadding, composer.messageListGap + composer.bottomInset + 216, `${width}px message list bottom padding clears composer and keyboard`)
    assert.ok(composerTools.chipsPerRow >= 3, `${width}px expanded composer tools keep at least three compact chips per row`)
    assert.equal(composerTools.rowCount, 2, `${width}px six composer media/knowledge tools fit in two rows`)
    assert.ok(composerTools.chipMinWidth * composerTools.chipsPerRow + composerTools.chipGap * (composerTools.chipsPerRow - 1) <= width - composer.horizontalPadding * 2 - composerTools.panelHorizontalPadding * 2, `${width}px composer tool chips fit without horizontal overflow`)
    assert.ok(composerTools.capabilityNoticeHeight >= 30, `${width}px expanded composer tools reserve visible capability notice height`)
    assert.ok(composerTools.estimatedPanelHeight <= 170, `${width}px expanded composer tools stay compact enough for small screens`)

    assert.ok(messageList.horizontalPadding <= 20, `${width}px message list gutters stay mobile-safe`)
    assert.ok(messageList.topInset >= 68, `${width}px message list clears persistent top chrome`)
    assert.ok(messageList.conversationHeaderTopPadding >= messageList.topInset, `${width}px conversation header starts below top chrome`)
    assert.ok(messageList.emptyConversationTopPadding > messageList.conversationHeaderTopPadding, `${width}px empty state has extra top breathing room`)

    assert.equal(transition.persistentTopBarOffset, 68, `${width}px pager reserves the persistent navigation chrome`)
    assert.ok(transition.activeHorizontalOffset < transition.minHorizontalDrag, `${width}px pager waits for a deliberate horizontal drag`)
    assert.ok(transition.failVerticalOffset > transition.minHorizontalDrag, `${width}px pager tolerates vertical scroll before failing horizontal intent`)
    assert.ok(transition.horizontalDominanceRatio > 1, `${width}px pager requires horizontal dominance`)
    assert.ok(transition.swipePageThreshold > 0 && transition.swipePageThreshold < 0.34, `${width}px swipe threshold is reachable but not twitchy`)
    assert.ok(transition.settleMs >= 160 && transition.settleMs <= 220, `${width}px full-motion page settle stays quick`)
    assert.equal(transition.revealMs, transition.settleMs + 48, `${width}px inactive page exposure covers settle duration`)
    assert.ok(transition.settingsSpinMs > transition.settingsReleaseMs, `${width}px settings transition gives the icon spin readable time`)
    assert.ok(reducedTransition.settleMs < transition.settleMs, `${width}px reduced motion shortens page settle`)
    assert.ok(reducedTransition.settingsWashMs <= reducedTransition.settleMs, `${width}px reduced motion keeps background wash minimal`)

    assert.equal(shortFrame.viewportHeight, 568, `${width}px visual audit records short viewport height`)
    assert.equal(shortFrame.starterActionStackHeight, 44, `${width}px visual audit reserves only one starter action`)
    assert.equal(shortFrame.boundaryActionHeight, 44, `${width}px visual audit reserves one accessible boundary-details action`)
    assert.ok(shortFrame.availableEmptyStateHeight > 0, `${width}px short viewport keeps an available empty-state window`)
    assert.ok(
      shortFrame.setupFitsWithoutScroll || shortFrame.scrollFallbackExpected,
      `${width}px setup empty state either fits or declares scroll fallback on short mobile`,
    )
    assert.ok(
      shortFrame.conversationEmptyFitsWithoutScroll || shortFrame.scrollFallbackExpected,
      `${width}px conversation empty state either fits or declares scroll fallback on short mobile`,
    )
    assert.ok(commonFrame.setupFitsWithoutScroll, `${width}px setup empty state fits without keyboard on common mobile height`)
    assert.ok(commonFrame.conversationEmptyFitsWithoutScroll, `${width}px sparse conversation empty state fits on common mobile height`)
    assert.equal(shortFrame.composerOverlapRisk, false, `${width}px source visual audit reserves composer clearance`)
    assert.equal(keyboardFrame.scrollFallbackExpected, true, `${width}px keyboard-open empty state expects scroll instead of hidden controls`)
    assert.equal(keyboardFrame.composerOverlapRisk, false, `${width}px keyboard-open frame still reserves composer clearance`)
  }

  assert.ok(CHAT_PRESENTATION_CATALOG.starters.length >= 3, 'Chat keeps one-tap starter actions for mobile entry')
  assert.ok(CHAT_PRESENTATION_CATALOG.cues.length >= 3, 'Chat retains cue metadata without rendering a mode strip')

  assertSourceIntegration()

  console.log('Product mobile layout tests passed')
}

function assertSourceIntegration() {
  const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  const mainPagerSource = fs.readFileSync(path.join(root, 'src/components/main/MainPagerShell.tsx'), 'utf8')
  const historyScreenSource = fs.readFileSync(path.join(root, 'src/components/main/ConversationsScreenContent.tsx'), 'utf8')
  assert.match(historyScreenSource, /if \(!active \|\| !deferredSearchReady\) return \{ index: \[\], source: null \}/, 'inactive History does not build a full-text search index in the background')
  const chatHeaderSource = fs.readFileSync(path.join(root, 'src/components/chat/FloatingChrome.tsx'), 'utf8')
  const chatPersistentHeaderSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatPersistentHeader.tsx'), 'utf8')
  const chatSetupSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatSetupWorkspace.tsx'), 'utf8')
  const chatAiConfigurationSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatAiConfigurationSheet.tsx'), 'utf8')
  const settingsScreenSource = fs.readFileSync(path.join(root, 'src/components/main/SettingsScreenContent.tsx'), 'utf8')
  const searchFieldSource = fs.readFileSync(path.join(root, 'src/components/ui/isle/SearchField.tsx'), 'utf8')
  const runtimeDiagnosticsDetailsSource = fs.readFileSync(path.join(root, 'src/components/settings/RuntimeDiagnosticsDetails.tsx'), 'utf8')
  const providerSettingsRouteSource = fs.readFileSync(path.join(root, 'app/settings/providers.tsx'), 'utf8')
  const usageSettingsRouteSource = fs.readFileSync(path.join(root, 'app/settings/usage.tsx'), 'utf8')
  const lazyLoadSource = fs.readFileSync(path.join(root, 'src/utils/lazyLoad.tsx'), 'utf8')
  const apiKeyPanelSource = fs.readFileSync(path.join(root, 'src/components/settings/ApiKeyPanel.tsx'), 'utf8')
  const usageStatisticsSource = fs.readFileSync(path.join(root, 'src/components/settings/UsageStatisticsContent.tsx'), 'utf8')
  const mcpSettingsSource = fs.readFileSync(path.join(root, 'src/components/settings/McpSettingsContent.tsx'), 'utf8')
  const isleKitSource = fs.readFileSync(path.join(root, 'src/components/ui/isle/IsleKit.tsx'), 'utf8')
  assert.equal(appConfig.expo.orientation, 'default', 'Expo enables portrait and landscape instead of locking the product to one orientation')
  assert.equal(appConfig.expo.web?.favicon, './assets/favicon.png', 'Expo Web publishes the branded favicon instead of producing a first-load 404')
  assert.doesNotMatch(mainPagerSource, /MainPagerExperience|AppTopBar|ThemeNavigationDrawer|shellNavigation/, 'main pager owns no global top bar or navigation drawer')
  assert.ok(mainPagerSource.includes("type MainPagerPage = 'history' | 'home' | 'settings'"), 'main pager exposes only History, Chat, and Settings pages')
  assert.ok(mainPagerSource.includes("const PAGE_SEQUENCE: readonly MainPagerPage[] = ['history', 'home', 'settings']"), 'main pager keeps a compact three-page sequence')
  for (const forbiddenMarker of ['modeDrafts', 'PRODUCT_MODE_PAGE', 'buildTopBarModeAccessibility']) {
    assert.equal(mainPagerSource.includes(forbiddenMarker), false, `main pager does not restore ${forbiddenMarker}`)
  }
  assert.ok(historyScreenSource.includes('common.backToChat') && historyScreenSource.includes('conversation.title') && historyScreenSource.includes('chat.newConversation'), 'History owns return, title, search, and new conversation actions')
  const historyEmptyStateSource = historyScreenSource.match(/kind="history-empty"[\s\S]*?\/>/)?.[0] ?? ''
  assert.doesNotMatch(historyEmptyStateSource, /actionLabel|actionGlyph|onAction/, 'History empty state does not duplicate the persistent new-conversation action')
  assert.ok(settingsScreenSource.includes('common.backToChat') && settingsScreenSource.includes("searchLabel={t('settings.search')}"), 'Settings owns return, title, and search actions')
  assert.ok(chatHeaderSource.includes("t('conversation.title')") && chatPersistentHeaderSource.includes('chat.newConversation') && chatPersistentHeaderSource.includes('settings.title'), 'Chat owns the conversation entry, new conversation, and settings header actions')
  assert.match(chatPersistentHeaderSource, /width: ISLE_MIN_TOUCH_TARGET,[\s\S]*height: ISLE_MIN_TOUCH_TARGET/, 'Chat header navigation exposes physical 44dp controls')
  assert.ok(chatHeaderSource.includes('onOpenModelPicker') && chatHeaderSource.includes('<ChatAiConfigurationSheet') && chatSetupSource.includes('<ChatAiConfigurationSheet') && chatAiConfigurationSource.includes('chat-ai-configuration-panel'), 'Chat model triggers reach one unified AI configuration sheet')
  assert.ok(chatAiConfigurationSource.includes('resolveProductMobileChatConfigurationSheetLayout') && chatAiConfigurationSource.includes('height: sheetLayout.height') && chatAiConfigurationSource.includes("maxHeight: '100%'") && chatAiConfigurationSource.includes('<KeyboardAvoidingView'), 'AI configuration uses shared viewport-safe sheet geometry and keyboard-aware containment')
  assert.match(chatAiConfigurationSource, /function handleRequestClose\(\)[\s\S]*Platform\.OS === 'android' && Keyboard\.isVisible\(\)[\s\S]*Keyboard\.dismiss\(\)[\s\S]*return[\s\S]*closeCurrentView\(\)[\s\S]*onRequestClose=\{handleRequestClose\}/, 'Android Back dismisses the active keyboard before leaving the AI configuration flow')
  assert.ok(chatAiConfigurationSource.includes('if (!visible) return null'), 'closed AI configuration avoids mounting its provider and model management trees')
  assert.match(chatAiConfigurationSource, /createLazyComponent\([\s\S]*import\('@\/components\/providers\/ProviderSettingsContent'\)/, 'Chat defers the heavy provider manager until provider onboarding is opened')
  assert.match(providerSettingsRouteSource, /createLazyComponent\([\s\S]*import\('@\/components\/providers\/ProviderSettingsContent'\)/, 'the Provider route does not evaluate its heavy content while Expo Router builds the route tree')
  assert.match(usageSettingsRouteSource, /createLazyComponent\([\s\S]*import\('@\/components\/settings\/UsageStatisticsScreen'\)/, 'the Usage route does not evaluate statistics storage and export code before navigation')
  assert.match(lazyLoadSource, /accessibilityRole="progressbar"[\s\S]*accessibilityLabel=\{t\('common\.loading'\)\}/, 'deferred screens announce a localized loading state')
  assert.ok(mainPagerSource.includes("importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}"), 'inactive pager pages are hidden from accessibility')
  assert.ok(mainPagerSource.includes("pointerEvents={active ? 'auto' : 'none'}"), 'inactive pager pages do not intercept touches')
  assert.ok(mainPagerSource.includes('aria-hidden={!active}'), 'web pager pages expose hidden state for inactive pages')
  assert.match(mainPagerSource, /const MAIN_PAGER_PATH_BY_PAGE:[\s\S]*history: '\/conversations'[\s\S]*home: '\/'[\s\S]*settings: '\/settings'/, 'pager centralizes all three compatible top-level aliases')
  assert.match(runtimeDiagnosticsDetailsSource, /runtimeDiagnosticCompactValue[\s\S]{0,1000}capable: diagnostics\.compact\.capableProviders/, 'runtime diagnostics interpolate compact capable-provider counts')
  assert.match(settingsScreenSource, /function SettingsToggleRow[\s\S]{0,1800}<Text numberOfLines=\{3\}/, 'advanced notification details retain three readable mobile lines')
  assert.ok(settingsScreenSource.includes('<IsleSearchField') && searchFieldSource.includes('style={{ width: 44, height: 44'), 'Settings search exposes a shared physical 44dp clear action')
  assert.ok(settingsScreenSource.includes('controlSearchPlaceholder') && searchFieldSource.includes('minHeight: 44'), 'Settings search input exposes a physical 44dp target')
  assert.match(apiKeyPanelSource, /function ChoiceButton[\s\S]*minHeight: ISLE_MIN_TOUCH_TARGET/, 'provider model choices expose physical 44dp targets')
  assert.match(apiKeyPanelSource, /function CapabilityToggle[\s\S]*minHeight: ISLE_MIN_TOUCH_TARGET/, 'provider capability toggles expose physical 44dp targets')
  assert.match(apiKeyPanelSource, /function IconIsleChip[\s\S]*width: ISLE_MIN_TOUCH_TARGET[\s\S]*height: ISLE_MIN_TOUCH_TARGET/, 'provider credential icon actions expose physical 44dp targets')
  assert.match(apiKeyPanelSource, /placeholder=\{t\('apiKeyPanel\.aliasDisplayName'\)\}[\s\S]{0,500}minHeight: ISLE_MIN_TOUCH_TARGET[\s\S]{0,800}placeholder=\{t\('apiKeyPanel\.aliasTargetModel'\)\}[\s\S]{0,500}minHeight: ISLE_MIN_TOUCH_TARGET/, 'provider alias inputs expose physical 44dp targets')
  assert.doesNotMatch(searchFieldSource, /clearAccessibilityLabel[^>]*hitSlop=/, 'Settings search does not rely on invisible hit slop around a smaller clear node')
  assert.match(usageStatisticsSource, /tabButton: \{[\s\S]*minHeight: ISLE_MIN_TOUCH_TARGET/, 'usage tabs expose physical 44dp targets')
  assert.match(usageStatisticsSource, /function OptionChips[\s\S]*minHeight: ISLE_MIN_TOUCH_TARGET/, 'usage filter chips expose physical 44dp targets')
  assert.match(mcpSettingsSource, /function McpDisclosureRow[\s\S]*minHeight: ISLE_MIN_TOUCH_TARGET/, 'MCP disclosure rows expose physical 44dp targets')
  assert.ok(isleKitSource.includes('export const ISLE_MIN_TOUCH_TARGET = 44'), 'shared controls expose one canonical 44dp touch target')
  assert.match(isleKitSource, /export function IsleButton\([\s\S]*const minimumButtonHeight = resolveMinimumTouchTargetHeight\(height, flattenedStyle, ISLE_MIN_TOUCH_TARGET\)/, 'shared buttons resolve a physical 44dp minimum target after flattening feature styles')
  assert.match(isleKitSource, /style,\s*\{ minHeight: minimumButtonHeight \}/, 'shared buttons apply the resolved minimum after feature styles so compact overrides cannot shrink the target')
  assert.match(isleKitSource, /export function IsleInput\([\s\S]*const inputMinimumHeight = multiline \? 76 : Math\.max\(height, ISLE_MIN_TOUCH_TARGET\)[\s\S]*minHeight: Math\.max\(inputMinimumHeight, fieldTokens\?\.minHeight \?\? inputMinimumHeight\)/, 'single-line input shells expose a physical 44dp minimum before applying a larger theme-owned field height')
  assert.match(isleKitSource, /ISLE_INPUT_CLEAR_BUTTON_SIZE = 26[\s\S]*width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET[\s\S]*width: ISLE_INPUT_CLEAR_BUTTON_SIZE, height: ISLE_INPUT_CLEAR_BUTTON_SIZE/, 'input clear actions wrap a compact visual icon in a physical 44dp control')
  assert.match(isleKitSource, /export function IsleSwitch\([\s\S]*const touchWidth = Math\.max\(width, ISLE_MIN_TOUCH_TARGET\)[\s\S]*width: touchWidth,[\s\S]*height: ISLE_MIN_TOUCH_TARGET[\s\S]*top: trackTop, left: trackLeft, width, height/, 'shared switches preserve compact track geometry inside a physical 44dp control')
  assert.match(isleKitSource, /export function IsleCollapse\([\s\S]*minHeight: ISLE_MIN_TOUCH_TARGET/, 'shared collapse headers expose a physical 44dp target')
  assert.match(isleKitSource, /export function IsleSelect\([\s\S]*style=\{\{ minHeight: ISLE_MIN_TOUCH_TARGET/, 'shared select options expose a physical 44dp target')

  const switchToSource = mainPagerSource.match(/function switchTo\(next: MainPagerPage\) \{[\s\S]*?\n  \}/)?.[0] ?? ''
  assert.match(switchToSource, /setMountedPages\([\s\S]*setPreviousPage\(page\)[\s\S]*setTransitionDirection\([\s\S]*if \(next === 'home' && pathname !== MAIN_PAGER_PATH_BY_PAGE\.home\)[\s\S]*router\.replace\(MAIN_PAGER_PATH_BY_PAGE\.home\)[\s\S]*setPage\(next\)/, 'navigation intent preserves one native screen, visited-page state, and safe alias-to-Chat normalization')
  assert.doesNotMatch(switchToSource, /router\.(?:push|dismissTo)/, 'ordinary pager switches do not churn native route screens')
  assert.match(mainPagerSource, /if \(!mountedPages\.has\(item\.id\) && item\.id !== page\) return null[\s\S]*?<PagerPage[\s\S]*?key=\{item\.id\}[\s\S]*?active=\{active\}[\s\S]*?direction=\{direction\}[\s\S]*?\{item\.node\}[\s\S]*?<\/PagerPage>/, 'visited page trees retain state while unvisited pages stay out of the initial render')
  assert.doesNotMatch(mainPagerSource, /transitionRequest|readinessToken|handlePagerPageReady|requestPagerPageChild|withTiming|withSpring|GestureDetector|Animated\.View/, 'pager uses the semantic motion wrapper instead of feature-owned animation primitives')
  assert.match(mainPagerSource, /styles\.opaqueFallback[\s\S]*colors\.background\.canvas/, 'pager keeps an opaque canvas fallback behind moving pages')
  assert.match(mainPagerSource, /<RetainedHomeScreenContent[\s\S]*?active=\{page === 'home'\}/, 'Home refresh work follows the settled active page, not the visual target')
  assert.match(mainPagerSource, /<RetainedConversationsScreenContent[\s\S]*onHome=\{showHome\}/, 'History keeps its direct Home-return action')
  assert.match(mainPagerSource, /<RetainedSettingsScreenContent onHome=\{showHome\} \/>/, 'Settings keeps a stable direct Home-return action without visibility-driven re-renders')
  assert.match(settingsScreenSource, /export const SettingsScreenContent = memo\(function SettingsScreenContent/, 'the retained Settings tree memoizes parent-only pager updates')
  assert.doesNotMatch(settingsScreenSource, /usePathname|scrollRef\.current\?\.scrollTo\(\{ y: 0, animated: false \}\)/, 'returning to Settings preserves scroll context instead of forcing duplicate top resets')
  assert.match(settingsScreenSource, /if \(!expandedGroups\.advanced\) return[\s\S]*refreshSystemStatusNotificationStatus/, 'native notification status loads only when its panel is disclosed')
  assert.match(settingsScreenSource, /if \(!expandedGroups\.governance \|\| !expandedGovernanceGroups\.observability\) return[\s\S]*getObservabilitySinkApiKey/, 'secure observability credentials load only when their disclosure is visible')

  const chatWorkspaceSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatWorkspace.tsx'), 'utf8')
  const chatActiveWorkspaceSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveWorkspace.tsx'), 'utf8')
  const chatActiveWorkspaceViewSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveWorkspaceView.tsx'), 'utf8')
  const chatActiveWorkspaceLayerPropsSource = fs.readFileSync(path.join(root, 'src/components/chat/chatActiveWorkspaceLayerProps.ts'), 'utf8')
  const chatActiveWorkspaceLayerPropTypesSource = fs.readFileSync(path.join(root, 'src/components/chat/chatActiveWorkspaceLayerPropTypes.ts'), 'utf8')
  const chatActiveWorkspaceComposerDockPropsSource = fs.readFileSync(path.join(root, 'src/components/chat/chatActiveWorkspaceComposerDockProps.ts'), 'utf8')
  const chatActiveWorkspaceChromeLayerPropsSource = fs.readFileSync(path.join(root, 'src/components/chat/chatActiveWorkspaceChromeLayerProps.ts'), 'utf8')
  const chatActiveWorkspaceStatusLayerPropsSource = fs.readFileSync(path.join(root, 'src/components/chat/chatActiveWorkspaceStatusLayerProps.ts'), 'utf8')
  const chatActiveWorkspaceMessageListPropsSource = fs.readFileSync(path.join(root, 'src/components/chat/chatActiveWorkspaceMessageListProps.ts'), 'utf8')
  const chatActiveWorkspaceControlsLayerPropsSource = fs.readFileSync(path.join(root, 'src/components/chat/chatActiveWorkspaceControlsLayerProps.ts'), 'utf8')
  const chatActiveMessageListSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveMessageList.tsx'), 'utf8')
  const chatActiveMessageFeedSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveMessageFeed.tsx'), 'utf8')
  const chatActiveMessageVirtualListSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveMessageVirtualList.tsx'), 'utf8')
  const chatActiveMessageFeedStateSource = fs.readFileSync(path.join(root, 'src/components/chat/chatActiveMessageFeedState.ts'), 'utf8')
  const chatMessageListScrollStateSource = fs.readFileSync(path.join(root, 'src/components/chat/chatMessageListScrollState.ts'), 'utf8')
  const chatActiveMessageEmptyStateSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveMessageEmptyState.tsx'), 'utf8')
  const chatActiveMessageItemSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveMessageItem.tsx'), 'utf8')
  const chatActiveNavigationRailSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveNavigationRail.tsx'), 'utf8')
  const chatActiveChromeLayerSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveChromeLayer.tsx'), 'utf8')
  const chatActiveControlsLayerSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveControlsLayer.tsx'), 'utf8')
  const chatActiveWorkspaceControllersSource = fs.readFileSync(path.join(root, 'src/components/chat/chatActiveWorkspaceControllers.ts'), 'utf8')
  const chatActiveWorkspaceLayoutSource = fs.readFileSync(path.join(root, 'src/components/chat/chatActiveWorkspaceLayoutState.ts'), 'utf8')
  const chatSetupWorkspaceSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatSetupWorkspace.tsx'), 'utf8')
  const chatWorkspaceKeyboardSource = fs.readFileSync(path.join(root, 'src/components/chat/chatWorkspaceKeyboard.ts'), 'utf8')
  const chatEmptyStateSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatEmptyState.tsx'), 'utf8')
  const floatingComposerSource = fs.readFileSync(path.join(root, 'src/components/chat/FloatingComposer.tsx'), 'utf8')
  const floatingComposerSurfacesSource = fs.readFileSync(path.join(root, 'src/components/chat/FloatingComposerSurfaces.tsx'), 'utf8')
  const floatingComposerGeometrySource = fs.readFileSync(path.join(
    root,
    'src/components/chat/floatingComposerGeometry.ts',
  ), 'utf8')
  const composerLongDraftStateSource = fs.readFileSync(path.join(
    root,
    'src/components/chat/composerLongDraftState.ts',
  ), 'utf8')
  const composerMarkdownEditingSource = fs.readFileSync(path.join(
    root,
    'src/components/chat/composerMarkdownEditing.ts',
  ), 'utf8')
  const composerEditHistorySource = fs.readFileSync(path.join(
    root,
    'src/components/chat/composerEditHistory.ts',
  ), 'utf8')
  const providerBrandIconSource = fs.readFileSync(path.join(
    root,
    'src/components/ui/ProviderBrandIcon.tsx',
  ), 'utf8')
  const programErrorBannerSource = fs.readFileSync(path.join(root, 'src/components/chat/ProgramErrorBanner.tsx'), 'utf8')
  const floatingChromeSource = fs.readFileSync(path.join(root, 'src/components/chat/FloatingChrome.tsx'), 'utf8')
  const persistentHeaderSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatPersistentHeader.tsx'), 'utf8')
  const floatingChromeStateSource = fs.readFileSync(path.join(root, 'src/components/chat/chatFloatingChromeState.ts'), 'utf8')
  const chatOptionsSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatOptionsPanel.tsx'), 'utf8')
  const runtimeRepairIntentSource = fs.readFileSync(path.join(root, 'src/components/chat/RuntimeRepairIntentCard.tsx'), 'utf8')
  const messageBubbleSource = fs.readFileSync(path.join(root, 'src/components/chat/MessageBubble.tsx'), 'utf8')
  const messageContentSource = fs.readFileSync(path.join(root, 'src/components/chat/MessageContent.tsx'), 'utf8')
  const emptyStateSource = fs.readFileSync(path.join(root, 'src/components/ui/isle/EmptyState.tsx'), 'utf8')
  const globalGenerationStatusSource = fs.readFileSync(path.join(root, 'src/components/ui/GlobalGenerationStatusLayer.tsx'), 'utf8')
  const providerSettingsSource = fs.readFileSync(path.join(root, 'src/components/providers/ProviderSettingsContent.tsx'), 'utf8')
  const sourceDetailScreenSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/SourceDetailScreen.tsx'), 'utf8')
  assert.ok(chatActiveWorkspaceSource.includes("from './chatActiveWorkspaceControllers'") && chatActiveWorkspaceControllersSource.includes("from './chatActiveWorkspaceLayoutState'") && chatActiveWorkspaceLayoutSource.includes("from '@/presentation/layout/productMobileLayout'"), 'chat active workspace imports shared mobile layout metrics through the active controller and layout helpers')
  assert.ok(chatActiveWorkspaceViewSource.includes("from './chatActiveWorkspaceLayerProps'") && chatActiveWorkspaceViewSource.includes("from './chatActiveWorkspaceLayerPropTypes'") && chatActiveWorkspaceLayerPropsSource.includes("from './chatActiveWorkspaceChromeLayerProps'") && chatActiveWorkspaceLayerPropsSource.includes("from './chatActiveWorkspaceComposerDockProps'") && chatActiveWorkspaceLayerPropsSource.includes("from './chatActiveWorkspaceControlsLayerProps'") && chatActiveWorkspaceLayerPropsSource.includes("from './chatActiveWorkspaceMessageListProps'") && chatActiveWorkspaceLayerPropsSource.includes("from './chatActiveWorkspaceStatusLayerProps'") && chatActiveWorkspaceLayerPropsSource.includes("from './chatActiveWorkspaceLayerPropTypes'") && chatActiveWorkspaceLayerPropsSource.includes('messageListProps') && chatActiveWorkspaceLayerPropsSource.includes('composerDockProps') && chatActiveWorkspaceLayerPropTypesSource.includes('ChatActiveWorkspaceLayerProps') && chatActiveWorkspaceChromeLayerPropsSource.includes('buildChatActiveChromeLayerProps') && chatActiveWorkspaceComposerDockPropsSource.includes('buildChatActiveComposerDockProps') && chatActiveWorkspaceStatusLayerPropsSource.includes('buildChatActiveStatusLayerProps') && chatActiveWorkspaceMessageListPropsSource.includes('buildChatActiveMessageListProps') && chatActiveWorkspaceControlsLayerPropsSource.includes('buildChatActiveControlsLayerProps'), 'chat active workspace groups layer prop projection behind dedicated per-layer helpers')
  assert.ok(chatWorkspaceSource.includes("from './chatWorkspaceKeyboard'") && chatWorkspaceKeyboardSource.includes("from '@/presentation/layout/productMobileLayout'"), 'chat workspace keyboard helper imports shared composer layout metrics')
  assert.ok(chatEmptyStateSource.includes("from '@/presentation/layout/productMobileLayout'"), 'Chat empty state imports shared mobile layout metrics')
  assert.ok(floatingComposerSource.includes("from '@/presentation/layout/productMobileLayout'"), 'floating composer imports shared mobile layout metrics')
  assert.match(chatMessageListScrollStateSource, /import \{[^}]*Keyboard[^}]*\} from 'react-native'[\s\S]*const handleListTouchStart = useCallback\(\(\) => \{[\s\S]*Keyboard\.dismiss\(\)[\s\S]*lockPagerGestureForMessageScroll\(\)/, 'touching the active message area blurs a composer input whose Android keyboard was already hidden')
  assert.match(chatSetupWorkspaceSource, /<ScrollView[\s\S]{0,300}keyboardShouldPersistTaps="handled"[\s\S]{0,300}onTouchStart=\{Keyboard\.dismiss\}/, 'touching the setup content blurs a composer input whose Android keyboard was already hidden')
  assert.ok(chatWorkspaceKeyboardSource.includes('resolveProductMobileComposerLayout(windowWidth'), 'chat workspace keyboard helper uses shared composer clearance metrics')
  assert.ok(floatingComposerSource.includes('resolveProductMobileComposerLayout(composerWindowWidth'), 'floating composer resolves its own safe-area layout metrics')
  assert.match(programErrorBannerSource, /programErrorDismissAccessibilityLabel[\s\S]*width: ISLE_MIN_TOUCH_TARGET[\s\S]*height: ISLE_MIN_TOUCH_TARGET/, 'program error dismissal exposes a real 44dp accessibility target')
  assert.ok(floatingComposerSource.includes('minHeight: ISLE_MIN_TOUCH_TARGET') && floatingComposerSource.includes('height: ISLE_MIN_TOUCH_TARGET'), 'composer context and panel actions use the shared physical touch target')
  assert.ok(floatingComposerSource.includes('resolveChatModelDisplayName') && floatingComposerSource.includes('ellipsizeMode="middle"') && persistentHeaderSource.includes('numberOfLines={1}'), 'custom model labels retain a bounded one-line mobile presentation while preserving a useful model suffix')
  assert.ok(
    floatingComposerSource.includes('composerPresentation.sizeMode') &&
      floatingComposerSource.includes('composerPresentation.activityState') &&
      floatingComposerGeometrySource.includes("sizeMode !== 'compact'") &&
      floatingComposerGeometrySource.includes("activityState !== 'idle'"),
    'Composer width follows independent size and activity axes',
  )
  assert.match(floatingComposerSource, /const modelStatusLabel = provider[\s\S]*resolveChatModelDisplayName[\s\S]*t\('chat\.configure'\)[\s\S]*const modelStatusAccessibilityLabel = provider[\s\S]*t\('chat\.configureProviders'\)/, 'setup Composer uses a compact localized action while preserving a descriptive accessibility label')
  assert.ok(chatOptionsSource.includes('SETTINGS_IDENTITY_DISPLAY_NAME_MAX_LENGTH') && chatOptionsSource.includes('numberOfLines={1}'), 'model alias editing stays bounded and canonical identity text truncates on narrow screens')
  assert.match(chatOptionsSource, /selectProviderAccessibilityHint[\s\S]*minHeight: ISLE_MIN_TOUCH_TARGET[\s\S]*selectModelAccessibilityHint[\s\S]*minHeight: ISLE_MIN_TOUCH_TARGET/, 'AI configuration provider and model chips expose physical 44dp targets')
  assert.match(runtimeRepairIntentSource, /function RuntimeRepairIntentButton[\s\S]*minHeight: ISLE_MIN_TOUCH_TARGET/, 'runtime repair actions expose physical 44dp targets')
  assert.match(providerSettingsSource, /placeholder=\{t\('providerSettings\.filterModels'\)\}[\s\S]{0,500}minHeight: ISLE_MIN_TOUCH_TARGET/, 'provider model search exposes a physical 44dp input target')
  assert.match(providerSettingsSource, /accessibilityLabel=\{t\('common\.clearSearch'\)\}[\s\S]{0,300}width: ISLE_MIN_TOUCH_TARGET[\s\S]*height: ISLE_MIN_TOUCH_TARGET/, 'provider model search clear action exposes a physical 44dp target')
  assert.match(providerSettingsSource, /function ChoiceIsleChip[\s\S]*minHeight: ISLE_MIN_TOUCH_TARGET/, 'provider filter choices expose physical 44dp targets')
  assert.match(providerSettingsSource, /advancedInterfaceSettings[\s\S]{0,500}minHeight: ISLE_MIN_TOUCH_TARGET/, 'provider advanced settings disclosure exposes a physical 44dp target')
  assert.match(messageBubbleSource, /function MessageSourceLink[\s\S]*minHeight: ISLE_MIN_TOUCH_TARGET/, 'message source links expose physical 44dp targets')
  assert.match(messageBubbleSource, /function MessageProcessLayer[\s\S]*minHeight: ISLE_MIN_TOUCH_TARGET/, 'message process disclosures expose physical 44dp targets')
  assert.ok(messageBubbleSource.includes('getAssistantThinkingLabel') && messageBubbleSource.includes('numberOfLines={1}'), 'named assistant activity reuses the bounded single-line process status on mobile')
  assert.equal(messageBubbleSource.includes('<ProcessAnchor'), false, 'reply process status does not render the retired circular anchor')
  assert.equal(messageBubbleSource.includes('function ProcessSpinner'), false, 'reply process status does not retain the circular spinner implementation')
  assert.ok(messageBubbleSource.includes("const activeTrace = selectActiveProcessTrace(traces, message.status)") && messageBubbleSource.includes('activeTrace && !isGenericModelRequestTrace(activeTrace)'), 'active search, retrieval, reasoning, and tool traces take priority over the generic writing label')
  assert.doesNotMatch(emptyStateSource, /from=\{\{|<MotiView/, 'empty states render immediately without automatic mount animation')
  assert.doesNotMatch(globalGenerationStatusSource, /from=|<AnimatePresence|<MotiView/, 'global generation status renders immediately without entrance or exit animation')
  assert.doesNotMatch(providerSettingsSource, /from=\{\{ opacity: 0, translateY: (?:6|8|32) \}\}/, 'provider progress cards and modal shells do not restore automatic mount animation')
  assert.doesNotMatch(sourceDetailScreenSource, /from=\{\{ opacity: motion === 'full'/, 'source loading indicators pulse without a first-mount fade')
  assert.ok(
    messageBubbleSource.includes("grammar === 'precision'") &&
      messageBubbleSource.includes("grammar === 'material'") &&
      messageBubbleSource.includes("'.'.repeat(motion === 'full' ? dotCount : 3)") &&
      messageBubbleSource.includes('setInterval(() =>') &&
      messageBubbleSource.includes("const shimmer = active && motion === 'full' && grammar !== 'precision'") &&
      messageBubbleSource.includes('loop: shimmer'),
    'reply process labels preserve theme-specific precision, Material, organic, and fluid status motion',
  )
  assert.ok(
    messageBubbleSource.includes('const bubbleUsesAvailableWidth = displayFormulaLayout || (!isUser') &&
      messageBubbleSource.includes('processLayerVisible || hasWideMessageContent(renderedDisplayText)') &&
      messageBubbleSource.includes('width: bubbleUsesAvailableWidth ? (isUser ? bubbleMaxWidth : bubbleMaxWidth + 32) : undefined') &&
      messageBubbleSource.includes('width: isUser ? undefined : bubbleUsesAvailableWidth ? bubbleMaxWidth : undefined'),
    'wide assistant Markdown and process content claims its available mobile width plus the provider-badge gutter while short assistant and user bubbles remain compact',
  )
  assert.ok(messageBubbleSource.includes("!isStreamingContent && message.status !== 'cancelled'"), 'an empty cancelled assistant turn relies on its stopped status instead of rendering the empty-response failure copy')
  assert.ok(messageBubbleSource.includes('minWidth: showStatusLabel ? 176 : undefined'), 'terminal process status and token text retain enough width to avoid truncating the stopped label')
  assert.ok(chatActiveWorkspaceLayoutSource.includes('resolveProductMobileMessageListLayout(activeWindowWidth'), 'chat workspace uses shared message-list top spacing metrics')
  assert.ok(chatActiveWorkspaceLayoutSource.includes('topChromeInset: Math.max(topChromeInset, visualTopInset)'), 'chat message-list top spacing includes the device safe area below persistent local chrome')
  assert.ok(chatActiveMessageVirtualListSource.includes('messageListLayout.horizontalPadding'), 'message list horizontal gutters are source-audited')
  assert.ok(chatActiveMessageFeedSource.includes("from './chatActiveMessageFeedState'") && chatActiveMessageFeedSource.includes("from './ChatActiveMessageVirtualList'") && chatActiveMessageFeedStateSource.includes("from './chatMessageListState'"), 'message feed state stays behind the active message feed state hook')
  assert.equal(chatActiveMessageFeedStateSource.includes("from '@/product/modeHandoff'"), false, 'message feed state does not restore product-mode handoff derivation')
  assert.ok(chatWorkspaceSource.includes('composerLayout.messageListBottomPadding'), 'message list bottom padding clears composer through shared metrics')
  assert.ok(floatingComposerSource.includes('composerLayout.innerBottomPadding'), 'floating composer safe-area padding uses shared metrics')
  assert.ok(chatSetupWorkspaceSource.includes('resolveProductMobileChatSetupLayout') && chatSetupWorkspaceSource.includes("justifyContent: setupLayout.compactLandscape ? 'flex-start' : 'center'") && chatSetupWorkspaceSource.includes('setupHeaderBottom + setupLayout.contentHeaderGap'), 'short landscape Chat setup starts below local header chrome instead of centering its CTA behind Composer')
  assert.ok(chatEmptyStateSource.includes('showDecoration={setupLayout.showIntroDecoration}') && chatEmptyStateSource.includes('showDescription={setupLayout.showIntroDescription}'), 'short landscape setup removes visual-only intro density while retaining the full accessible description')
  assert.ok(chatActiveMessageListSource.includes("from './ChatActiveMessageFeed'") && chatActiveMessageFeedSource.includes("from './ChatActiveMessageVirtualList'") && chatActiveMessageVirtualListSource.includes("from './ChatActiveMessageItem'") && chatActiveMessageItemSource.includes("from './MessageBubble'"), 'message bubble actions stay behind the active message feed, virtual list, and item surfaces')
  assert.ok(chatActiveMessageVirtualListSource.includes("from './ChatActiveMessageEmptyState'") && chatActiveMessageEmptyStateSource.includes("from './ChatEmptyState'"), 'empty conversation rendering stays behind the active message virtual-list and Chat empty-state surfaces')
  assert.ok(chatActiveMessageListSource.includes("from './ChatActiveNavigationRail'") && chatActiveNavigationRailSource.includes("from './ConversationNavigationRail'"), 'assistant navigation rail stays behind the active navigation surface')
  assert.ok(chatWorkspaceSource.includes('showSetupEmptyState = true'), 'the upstream Chat workspace retains its temporary setup-visibility compatibility input')
  assert.ok(chatEmptyStateSource.includes('starterLayout.setupContentMaxWidth'), 'setup empty state uses shared starter width')
  assert.ok(chatEmptyStateSource.includes('starterLayout.emptyContentMaxWidth'), 'conversation empty state uses shared starter width')
  assert.doesNotMatch(chatEmptyStateSource, /ProductInteractionMode|PRODUCT_MODE_SHOW_EMPTY_STATE_CONTENT|\bagent\b|\bcompanion\b/, 'Chat empty-state layout has no historical mode branch')
  assert.ok(chatActiveWorkspaceLayoutSource.includes("from './FloatingChrome'") && chatActiveWorkspaceLayoutSource.includes("from './chatNoticeLayout'"), 'active Chat retains shared chrome and notice layout metrics')
  assert.ok(chatActiveWorkspaceViewSource.includes("from './ChatActiveChromeLayer'") && chatActiveChromeLayerSource.includes("from './FloatingChrome'") && floatingChromeSource.includes('export function FloatingChrome'), 'full top provider chrome stays behind reusable active chrome and floating chrome components')
  assert.ok(floatingChromeSource.includes('export const FLOATING_CHROME_SAFE_AREA_GAP = 0') && floatingChromeSource.includes('<ChatPersistentHeader'), 'floating chrome meets the parent safe area without adding a second visual gap and delegates controls to the persistent header')
  assert.ok(floatingChromeStateSource.includes('const chromeCollapsed = false') && !floatingChromeStateSource.includes('setTimeout('), 'Chat header remains visible across idle, streaming, focus, and scroll state changes')
  assert.ok(chatActiveChromeLayerSource.includes('onNewConversation') && !chatActiveWorkspaceViewSource.includes('showFloatingControlOrb') && !chatActiveControlsLayerSource.includes('FloatingControlOrb'), 'Chat header remains visible while Composer owns the only toolbox entry')
  assert.ok(chatActiveControlsLayerSource.includes("from './MessageMultiSelectBar'"), 'active multi-select controls stay behind the controls layer instead of the active shell')
  assert.ok(chatEmptyStateSource.includes('maxWidth={starterLayout.emptyContentMaxWidth}'), 'Chat entry actions share the mobile content width budget')
  assert.ok(chatEmptyStateSource.includes('starterLayout.statusPillGlyphSize'), 'Chat readiness action glyph uses the shared mobile size budget')
  assert.ok(chatEmptyStateSource.includes('projection.accessibility.minimumTouchTarget'), 'Chat readiness rendering consumes its tested 44dp touch-target projection')
  assert.ok(chatSetupWorkspaceSource.includes('multimodalPolicy={setupState.setupMultimodalPolicy}'), 'setup Chat boundary displays provider/media readiness')
  assert.ok(chatSetupWorkspaceSource.includes('onInspectProvider={openAiConfiguration}') && chatSetupWorkspaceSource.includes('<ChatAiConfigurationSheet') && chatSetupWorkspaceSource.includes("initialView={setupNeedsConfiguration ? 'providers' : 'configuration'}") && chatSetupWorkspaceSource.includes('autoOpenProviderAdd={!setupState.hasEnabledProvider}'), 'setup Chat opens the first useful provider or model view in the unified AI panel')
  assert.ok(
    floatingComposerSource.includes('ModelMenu') &&
      floatingComposerSource.includes('buildModelQuickOptions') &&
      floatingComposerSurfacesSource.includes('export function ComposerOverlay') &&
      floatingComposerSurfacesSource.includes('export function ModelSelector') &&
      floatingComposerSurfacesSource.includes('export function MessageInput') &&
      floatingComposerSurfacesSource.includes('export function SendButton') &&
      floatingComposerSurfacesSource.includes('export function ModelMenu'),
    'floating Composer owns explicit independent surfaces and an anchored model menu',
  )
  assert.ok(chatActiveWorkspaceMessageListPropsSource.includes('multimodalPolicy') && chatActiveMessageFeedSource.includes('multimodalPolicy={multimodalPolicy}') && chatActiveMessageEmptyStateSource.includes('multimodalPolicy={multimodalPolicy}'), 'empty conversation boundary displays provider/media readiness')
  assert.ok(chatEmptyStateSource.includes('onInspectProvider={onProviders}'), 'empty compact boundary routes provider-fixable gaps without adding another card')
  assert.ok(chatSetupWorkspaceSource.includes("onOpenTools={() => setComposerPanel('more')}") && chatActiveMessageEmptyStateSource.includes("onOpenTools={() => setComposerPanel('more')}"), 'compact boundary can open composer tools without adding another mobile card')
  assert.ok(chatWorkspaceSource.includes("pushChatSettingsRoute('/settings/memory', { focus: 'review' })"), 'compact boundary can route pending memory to review without adding another mobile card')
  assert.ok(chatSetupWorkspaceSource.includes('memoryStatus={boundaryMemoryStatus}') && chatActiveWorkspaceMessageListPropsSource.includes('memoryStatus') && chatActiveMessageFeedSource.includes('memoryStatus={memoryStatus}'), 'compact boundary receives source-level memory status without a tall drawer')

  const composerSource = fs.readFileSync(path.join(root, 'src/components/chat/Composer.tsx'), 'utf8')
  const chatWorkspaceReviewSheetSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatWorkspaceReviewSheet.tsx'), 'utf8')
  assert.ok(composerSource.includes('resolveProductMobileComposerToolsLayout'), 'composer imports shared expanded tool-panel layout metrics')
  assert.ok(composerSource.includes('<MessageInput') && composerSource.includes('<SendButton'), 'composer delegates the primary input and send controls to independent surfaces')
  assert.ok(
    composerSource.includes('useComposerLongDraftEditor') &&
      composerSource.includes('resolveFloatingComposerGeometry') &&
      composerSource.includes('const multilineInput = true') &&
      composerSource.includes('captureSendRecovery') &&
      composerSource.includes('restoreRejectedSend'),
    'Composer keeps wrapping enabled while coordinating measured long drafts and rejected-send recovery',
  )
  assert.ok(
    composerLongDraftStateSource.includes("mode: 'review'") &&
      composerLongDraftStateSource.includes("'hold-review'") &&
      composerLongDraftStateSource.includes('visualLineCount >= 8'),
    'long-draft sizing uses Review/Large hysteresis and manual hold',
  )
  assert.ok(
    floatingComposerSurfacesSource.includes('composer-long-draft-toolbar') &&
      floatingComposerSurfacesSource.includes('keyboardShouldPersistTaps="always"') &&
      floatingComposerSurfacesSource.includes('accessibilityHint={hint}') &&
      floatingComposerSurfacesSource.includes('paddingBottom: toolbarBottomPadding'),
    'Large MessageInput owns a one-row toolbar without an empty lower tray',
  )
  assert.doesNotMatch(
    floatingComposerSurfacesSource,
    /withSpring|bounce/,
    'Floating Composer motion stays on restrained timing curves without overshoot',
  )
  assert.ok(
    chatWorkspaceKeyboardSource.includes('normalizeComposerKeyboardMotion') &&
      chatWorkspaceKeyboardSource.includes('Keyboard.scheduleLayoutAnimation') &&
      floatingComposerSurfacesSource.includes('keyboardMotion.durationMs') &&
      floatingComposerSurfacesSource.includes('keyboardEasing(keyboardMotion.easing)'),
    'Floating Composer follows the system IME duration and easing with a tested fallback',
  )
  assert.ok(
    composerMarkdownEditingSource.includes('normalizeComposerSelection') &&
      composerEditHistorySource.includes('COMPOSER_EDIT_HISTORY_LIMIT = 50') &&
      composerEditHistorySource.includes('COMPOSER_TYPING_MERGE_MS = 600'),
    'composer editing preserves legal selections and bounded session history',
  )
  assert.equal(
    floatingComposerSurfacesSource.includes('measuredMenuHeight'),
    false,
    'ModelMenu does not reposition itself after measuring its content',
  )
  assert.ok(
    floatingComposerSurfacesSource.includes("event.key === 'Escape'") &&
      floatingComposerSurfacesSource.includes('onRequestClose={onClose}') &&
      floatingComposerSurfacesSource.includes('onPress={onClose}'),
    'ModelMenu closes through Escape, native Back, and its outside backdrop',
  )
  assert.ok(
    floatingComposerSource.includes('<ProviderBrandIcon') &&
      floatingComposerSurfacesSource.includes('iconOnly') &&
      providerBrandIconSource.includes("openai: 'M") &&
      providerBrandIconSource.includes("anthropic: 'M") &&
      providerBrandIconSource.includes("grok: 'M") &&
      providerBrandIconSource.includes("deepseek: 'M") &&
      providerBrandIconSource.includes('<Path d={path} fill={fill} />'),
    'model selector uses embedded transparent provider marks for OpenAI, Anthropic, Grok, and DeepSeek',
  )
  assert.ok(composerSource.includes('toolsLayout.chipMinWidth'), 'composer tool chips use shared min-width budget')
  assert.ok(composerSource.includes('toolsLayout.chipGap'), 'composer tool rows use shared gap budget')
  assert.ok(
    composerSource.includes('trailingAccessory') &&
      composerSource.includes('openCommandEntry') &&
      composerSource.includes('useComposerVoiceInput') &&
      composerSource.includes('voiceInput.begin()') &&
      composerSource.includes('voiceInput.stop()'),
    'composer separates the full-width draft from stable lower dock actions',
  )
  assert.ok(composerSource.includes('COMPOSER_DOCK_CONTROL_SIZE = ISLE_MIN_TOUCH_TARGET'), 'composer dock actions consume the shared 44dp touch geometry')
  assert.ok(composerSource.includes('composerWindowWidth < PRODUCT_MOBILE_COMPOSER_COMPACT_BREAKPOINT'), 'composer attachment density shares the tested compact breakpoint with its context rail')
  assert.ok(composerSource.includes('const showSendAction = true'), 'Composer keeps a visible disabled send surface before a draft exists')
  assert.match(composerSource, /removeAttachment[\s\S]*minHeight: ISLE_MIN_TOUCH_TARGET[\s\S]*composer-attachment-\$\{canonicalThemeId\}[\s\S]*minHeight: attachmentGrammar === 'precision' \? 26 : 30/, 'attachment removal keeps a themed compact visual chip inside a real 44dp target')
  assert.match(composerSource, /clearPendingAccessibilityHint[\s\S]*minHeight: ISLE_MIN_TOUCH_TARGET/, 'pending-message dismissal exposes a real 44dp target')
  assert.match(messageContentSource, /function CardHeader[\s\S]*minHeight: ISLE_MIN_TOUCH_TARGET/, 'rich-content copy actions expose physical 44dp targets')
  assert.match(chatOptionsSource, /accessibilityLabel=\{resetLabel\}[\s\S]*width: ISLE_MIN_TOUCH_TARGET[\s\S]*height: ISLE_MIN_TOUCH_TARGET/, 'generation parameter reset exposes a real 44dp target')
  assert.match(chatWorkspaceReviewSheetSource, /function ActionButton[\s\S]*height: ISLE_MIN_TOUCH_TARGET/, 'workspace review actions expose a real 44dp target')

  const conversationRowSource = fs.readFileSync(path.join(root, 'src/components/conversations/ConversationRow.tsx'), 'utf8')
  const historyPresentationSource = fs.readFileSync(path.join(root, 'src/components/main/history/HistoryPresentation.tsx'), 'utf8')
  assert.equal(conversationRowSource.includes("@/presentation/features/chat/chatPresentationCatalog"), false, 'history rows cannot import the active Chat presentation catalog')
  assert.doesNotMatch(conversationRowSource, /sumConversationTokens|formatCompactTokenCount|conversation\.rowUsageTokens/, 'history rows do not scan entire transcripts or render low-value token totals')
  assert.ok(historyPresentationSource.includes("flexWrap: 'wrap'"), 'history metadata can wrap instead of overflowing narrow rows')
  assert.equal(conversationRowSource.includes('<IslePanel'), false, 'history rows render as a continuous list instead of repeated cards')
  assert.ok(['minimal', 'monet', 'material', 'liquid-glass'].every((family) => historyPresentationSource.includes(`history-row-experience-${family}`)), 'history rows use all four canonical theme-specific composition frames')
  assert.ok(conversationRowSource.includes("name={actionsOpen ? 'close' : 'more'}"), 'rename and delete stay behind one contextual action entry')

  const conversationsScreenSource = fs.readFileSync(path.join(root, 'src/components/main/ConversationsScreenContent.tsx'), 'utf8')
  assert.equal(conversationsScreenSource.includes('CONVERSATION_HISTORY_MODE_FILTERS.map'), false, 'history screen does not render a redundant mode-filter strip')
  assert.equal(conversationsScreenSource.includes('showHistoryModeFilters'), false, 'history screen does not restore hidden mode-filter selection state')
  assert.equal(conversationsScreenSource.includes('accessibilityRole="tablist"'), false, 'history screen does not expose a mode-filter tablist')
  assert.equal(conversationsScreenSource.includes('accessibilityRole="tab"'), false, 'history screen does not expose mode-filter tabs')
  assert.equal(conversationsScreenSource.includes('firstSearchResultActionHasMatch'), false, 'history search does not add a redundant inline open-result button')
  assert.ok(conversationsScreenSource.includes("t('conversation.historyCount', { count: conversations.length })") && conversationsScreenSource.includes("fontSize: 13, lineHeight: 18, fontWeight: '600'"), 'embedded history relies on the shell title and keeps only a compact count row')
  assert.ok(conversationsScreenSource.includes('width: SCROLL_TOP_ACTION_SIZE') && conversationsScreenSource.includes('accessibilityValue={currentConversationActionAccessibilityValue}'), 'current-conversation navigation is an icon-sized control with its position retained for accessibility')
  assert.ok(conversationsScreenSource.includes('<IsleSearchField') && searchFieldSource.includes('style={{ width: 44, height: 44'), 'history search dismissal exposes a shared real 44dp target')
  assert.ok(conversationsScreenSource.includes('!listInteractionActiveRef.current'), 'history current-conversation floating action stays hidden during programmatic scroll/reveal')
  assert.ok(conversationsScreenSource.includes('setCurrentConversationActionVisibility(false)'), 'history current-conversation floating action can be suppressed before native evidence screenshots')
}

if (require.main === module) run()

module.exports = { run }
