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
  PRODUCT_MOBILE_LAYOUT_AUDIT_VIEWPORTS,
  PRODUCT_MOBILE_VISUAL_AUDIT_HEIGHTS,
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
  assert.match(source, /pages\.map\(\(item, index\) => \([\s\S]*?<PagerPage key=\{item\.id\} active=\{item\.id === page\}[\s\S]*?pageIndex=\{index\}[\s\S]*?\{item\.node\}[\s\S]*?<\/PagerPage>/, 'all three page trees stay mounted while the active wrapper changes')
  assert.match(switchToSource, /if \(next !== page\) setPage\(next\)/, 'tab intent changes active state directly')
  assert.doesNotMatch(source, /mountedPageChildren|transitionRequest|readinessToken|handlePagerPageReady|requestPagerPageChild|withTiming|withSpring|GestureDetector|Animated\.View/, 'pager avoids lazy mounting and animated native reparenting')
  assert.match(source, /importantForAccessibility=\{active \? 'auto' : 'no-hide-descendants'\}[\s\S]*pointerEvents=\{active \? 'auto' : 'none'\}[\s\S]*opacity: active \? 1 : 0/, 'inactive pages remain mounted but hidden from touch and accessibility')
  assert.doesNotMatch(source, /MainPagerExperience|AppTopBar|ThemeNavigationDrawer|shellNavigation/, 'pager does not own global header chrome or navigation drawers')
  assert.doesNotMatch(source, /accessibilityRole="tablist"|accessibilityRole="tab"/, 'the main header does not restore a full-width segmented tab control')
  assert.match(source, /styles\.opaqueFallback[\s\S]*colors\.background\.surfaceCanvas/, 'pager has an opaque semantic fallback')
  assert.match(source, /<HomeScreenContent[\s\S]*?active=\{page === 'home'\}/, 'Home work follows settled active state')
}

function run() {
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
  assert.deepEqual(
    PRODUCT_MOBILE_VISUAL_AUDIT_HEIGHTS,
    [568, 640, 844],
    'mobile visual audit covers short, common, and tall mobile heights',
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
  const mainPagerSource = fs.readFileSync(path.join(root, 'src/components/main/MainPagerShell.tsx'), 'utf8')
  const historyScreenSource = fs.readFileSync(path.join(root, 'src/components/main/ConversationsScreenContent.tsx'), 'utf8')
  const chatHeaderSource = fs.readFileSync(path.join(root, 'src/components/chat/FloatingChrome.tsx'), 'utf8')
  const chatPersistentHeaderSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatPersistentHeader.tsx'), 'utf8')
  const chatSetupSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatSetupWorkspace.tsx'), 'utf8')
  const chatAiConfigurationSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatAiConfigurationSheet.tsx'), 'utf8')
  const settingsScreenSource = fs.readFileSync(path.join(root, 'src/components/main/SettingsScreenContent.tsx'), 'utf8')
  assert.doesNotMatch(mainPagerSource, /MainPagerExperience|AppTopBar|ThemeNavigationDrawer|shellNavigation/, 'main pager owns no global top bar or navigation drawer')
  assert.ok(mainPagerSource.includes("type MainPagerPage = 'history' | 'home' | 'settings'"), 'main pager exposes only History, Chat, and Settings pages')
  assert.ok(mainPagerSource.includes("const PAGE_SEQUENCE: readonly MainPagerPage[] = ['history', 'home', 'settings']"), 'main pager keeps a compact three-page sequence')
  for (const forbiddenMarker of ['modeDrafts', 'PRODUCT_MODE_PAGE', 'buildTopBarModeAccessibility']) {
    assert.equal(mainPagerSource.includes(forbiddenMarker), false, `main pager does not restore ${forbiddenMarker}`)
  }
  assert.ok(historyScreenSource.includes('common.backToChat') && historyScreenSource.includes('conversation.title') && historyScreenSource.includes('chat.newConversation'), 'History owns return, title, search, and new conversation actions')
  assert.ok(settingsScreenSource.includes('common.backToChat') && settingsScreenSource.includes("searchLabel={t('settings.search')}"), 'Settings owns return, title, and search actions')
  assert.ok(chatHeaderSource.includes("t('conversation.title')") && chatPersistentHeaderSource.includes('chat.newConversation') && chatPersistentHeaderSource.includes('settings.title'), 'Chat owns the conversation entry, new conversation, and settings header actions')
  assert.ok(chatHeaderSource.includes('onOpenModelPicker') && chatHeaderSource.includes('<ChatAiConfigurationSheet') && chatSetupSource.includes('<ChatAiConfigurationSheet') && chatAiConfigurationSource.includes('chat-ai-configuration-panel'), 'Chat model triggers reach one unified AI configuration sheet')
  assert.ok(mainPagerSource.includes("importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}"), 'inactive pager pages are hidden from accessibility')
  assert.ok(mainPagerSource.includes("pointerEvents={active ? 'auto' : 'none'}"), 'inactive pager pages do not intercept touches')
  assert.ok(mainPagerSource.includes('aria-hidden={!active}'), 'web pager pages expose hidden state for inactive pages')
  assert.match(mainPagerSource, /const MAIN_PAGER_PATH_BY_PAGE:[\s\S]*history: '\/conversations'[\s\S]*home: '\/'[\s\S]*settings: '\/settings'/, 'pager centralizes all three compatible top-level aliases')
  assert.match(settingsScreenSource, /runtimeDiagnosticCompactValue[\s\S]{0,1000}capable: diagnostics\.compact\.capableProviders/, 'runtime diagnostics interpolate compact capable-provider counts')
  assert.match(settingsScreenSource, /function SettingsToggleRow[\s\S]{0,1800}<Text numberOfLines=\{3\}/, 'advanced notification details retain three readable mobile lines')

  const switchToSource = mainPagerSource.match(/function switchTo\(next: MainPagerPage\) \{[\s\S]*?\n  \}/)?.[0] ?? ''
  assert.match(switchToSource, /if \(next !== page\) setPage\(next\)/, 'navigation intent changes the active page directly')
  assert.match(mainPagerSource, /pages\.map\(\(item\) => \([\s\S]*?<PagerPage[\s\S]*?key=\{item\.id\}[\s\S]*?active=\{item\.id === page\}[\s\S]*?\{item\.node\}[\s\S]*?<\/PagerPage>/, 'all page trees stay mounted across static page switches')
  assert.doesNotMatch(mainPagerSource, /mountedPageChildren|transitionRequest|readinessToken|handlePagerPageReady|requestPagerPageChild|withTiming|withSpring|GestureDetector|Animated\.View/, 'pager avoids lazy mounting and animated native reparenting')
  assert.match(mainPagerSource, /styles\.opaqueFallback[\s\S]*colors\.background\.surfaceCanvas/, 'pager keeps an opaque semantic fallback behind moving pages')
  assert.match(mainPagerSource, /<HomeScreenContent[\s\S]*?active=\{page === 'home'\}/, 'Home refresh work follows the settled active page, not the visual target')
  assert.match(mainPagerSource, /<ConversationsScreenContent[\s\S]*onHome=\{\(\) => switchTo\('home'\)\}/, 'History keeps its direct Home-return action')
  assert.match(mainPagerSource, /<SettingsScreenContent[\s\S]*onHome=\{\(\) => switchTo\('home'\)\}/, 'Settings keeps its direct Home-return action')

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
  const chatActiveMessageEmptyStateSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveMessageEmptyState.tsx'), 'utf8')
  const chatActiveMessageItemSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveMessageItem.tsx'), 'utf8')
  const chatActiveNavigationRailSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveNavigationRail.tsx'), 'utf8')
  const chatActiveChromeLayerSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveChromeLayer.tsx'), 'utf8')
  const chatActiveControlsLayerSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatActiveControlsLayer.tsx'), 'utf8')
  const chatActiveWorkspaceControllersSource = fs.readFileSync(path.join(root, 'src/components/chat/chatActiveWorkspaceControllers.ts'), 'utf8')
  const chatActiveWorkspaceLayoutSource = fs.readFileSync(path.join(root, 'src/components/chat/chatActiveWorkspaceLayoutState.ts'), 'utf8')
  const chatSetupWorkspaceSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatSetupWorkspace.tsx'), 'utf8')
  const chatWorkspaceConstantsSource = fs.readFileSync(path.join(root, 'src/components/chat/chatWorkspaceConstants.ts'), 'utf8')
  const chatWorkspaceKeyboardSource = fs.readFileSync(path.join(root, 'src/components/chat/chatWorkspaceKeyboard.ts'), 'utf8')
  const chatEmptyStateSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatEmptyState.tsx'), 'utf8')
  const floatingComposerSource = fs.readFileSync(path.join(root, 'src/components/chat/FloatingComposer.tsx'), 'utf8')
  const floatingChromeSource = fs.readFileSync(path.join(root, 'src/components/chat/FloatingChrome.tsx'), 'utf8')
  const persistentHeaderSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatPersistentHeader.tsx'), 'utf8')
  const floatingChromeStateSource = fs.readFileSync(path.join(root, 'src/components/chat/chatFloatingChromeState.ts'), 'utf8')
  const chatOptionsSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatOptionsPanel.tsx'), 'utf8')
  const messageBubbleSource = fs.readFileSync(path.join(root, 'src/components/chat/MessageBubble.tsx'), 'utf8')
  const floatingControlOrbSource = fs.readFileSync(path.join(root, 'src/components/chat/FloatingControlOrb.tsx'), 'utf8')
  const emptyStateSource = fs.readFileSync(path.join(root, 'src/components/ui/isle/EmptyState.tsx'), 'utf8')
  const globalGenerationStatusSource = fs.readFileSync(path.join(root, 'src/components/ui/GlobalGenerationStatusLayer.tsx'), 'utf8')
  const providerSettingsSource = fs.readFileSync(path.join(root, 'src/components/providers/ProviderSettingsContent.tsx'), 'utf8')
  const sourceRouteSource = fs.readFileSync(path.join(root, 'app/source.tsx'), 'utf8')
  assert.ok(chatActiveWorkspaceSource.includes("from './chatActiveWorkspaceControllers'") && chatActiveWorkspaceControllersSource.includes("from './chatActiveWorkspaceLayoutState'") && chatActiveWorkspaceLayoutSource.includes("from '@/presentation/layout/productMobileLayout'"), 'chat active workspace imports shared mobile layout metrics through the active controller and layout helpers')
  assert.ok(chatActiveWorkspaceViewSource.includes("from './chatActiveWorkspaceLayerProps'") && chatActiveWorkspaceViewSource.includes("from './chatActiveWorkspaceLayerPropTypes'") && chatActiveWorkspaceLayerPropsSource.includes("from './chatActiveWorkspaceChromeLayerProps'") && chatActiveWorkspaceLayerPropsSource.includes("from './chatActiveWorkspaceComposerDockProps'") && chatActiveWorkspaceLayerPropsSource.includes("from './chatActiveWorkspaceControlsLayerProps'") && chatActiveWorkspaceLayerPropsSource.includes("from './chatActiveWorkspaceMessageListProps'") && chatActiveWorkspaceLayerPropsSource.includes("from './chatActiveWorkspaceStatusLayerProps'") && chatActiveWorkspaceLayerPropsSource.includes("from './chatActiveWorkspaceLayerPropTypes'") && chatActiveWorkspaceLayerPropsSource.includes('messageListProps') && chatActiveWorkspaceLayerPropsSource.includes('composerDockProps') && chatActiveWorkspaceLayerPropTypesSource.includes('ChatActiveWorkspaceLayerProps') && chatActiveWorkspaceChromeLayerPropsSource.includes('buildChatActiveChromeLayerProps') && chatActiveWorkspaceComposerDockPropsSource.includes('buildChatActiveComposerDockProps') && chatActiveWorkspaceStatusLayerPropsSource.includes('buildChatActiveStatusLayerProps') && chatActiveWorkspaceMessageListPropsSource.includes('buildChatActiveMessageListProps') && chatActiveWorkspaceControlsLayerPropsSource.includes('buildChatActiveControlsLayerProps'), 'chat active workspace groups layer prop projection behind dedicated per-layer helpers')
  assert.ok(chatWorkspaceSource.includes("from './chatWorkspaceKeyboard'") && chatWorkspaceKeyboardSource.includes("from '@/presentation/layout/productMobileLayout'"), 'chat workspace keyboard helper imports shared composer layout metrics')
  assert.ok(chatEmptyStateSource.includes("from '@/presentation/layout/productMobileLayout'"), 'Chat empty state imports shared mobile layout metrics')
  assert.ok(floatingComposerSource.includes("from '@/presentation/layout/productMobileLayout'"), 'floating composer imports shared mobile layout metrics')
  assert.ok(chatWorkspaceKeyboardSource.includes('resolveProductMobileComposerLayout(windowWidth'), 'chat workspace keyboard helper uses shared composer clearance metrics')
  assert.ok(floatingComposerSource.includes('resolveProductMobileComposerLayout(composerWindowWidth'), 'floating composer resolves its own safe-area layout metrics')
  assert.ok(floatingComposerSource.includes('resolveChatModelDisplayName') && persistentHeaderSource.includes('numberOfLines={1}'), 'custom model labels retain the existing one-line mobile truncation boundary')
  assert.ok(chatOptionsSource.includes('SETTINGS_IDENTITY_DISPLAY_NAME_MAX_LENGTH') && chatOptionsSource.includes('numberOfLines={1}'), 'model alias editing stays bounded and canonical identity text truncates on narrow screens')
  assert.ok(messageBubbleSource.includes('getAssistantThinkingLabel') && messageBubbleSource.includes('numberOfLines={1}'), 'named assistant activity reuses the bounded single-line process status on mobile')
  assert.equal(messageBubbleSource.includes('<ProcessAnchor'), false, 'reply process status does not render the retired circular anchor')
  assert.equal(messageBubbleSource.includes('function ProcessSpinner'), false, 'reply process status does not retain the circular spinner implementation')
  assert.ok(messageBubbleSource.includes("const activeTrace = selectActiveProcessTrace(traces, message.status)") && messageBubbleSource.includes('activeTrace && !isGenericModelRequestTrace(activeTrace)'), 'active search, retrieval, reasoning, and tool traces take priority over the generic writing label')
  assert.doesNotMatch(emptyStateSource, /from=\{\{|<MotiView/, 'empty states render immediately without automatic mount animation')
  assert.doesNotMatch(globalGenerationStatusSource, /from=|<AnimatePresence|<MotiView/, 'global generation status renders immediately without entrance or exit animation')
  assert.doesNotMatch(providerSettingsSource, /from=\{\{ opacity: 0, translateY: (?:6|8|32) \}\}/, 'provider progress cards and modal shells do not restore automatic mount animation')
  assert.doesNotMatch(sourceRouteSource, /from=\{\{ opacity: motion === 'full'/, 'source loading indicators pulse without a first-mount fade')
  assert.ok(messageBubbleSource.includes("'.'.repeat(motion === 'none' ? 3 : dotCount)") && messageBubbleSource.includes('setInterval(() =>') && messageBubbleSource.includes('loop: shimmer'), 'reply process labels share dynamic dots and a motion-aware shimmer')
  assert.ok(messageBubbleSource.includes('const bubbleUsesAvailableWidth = displayFormulaLayout || (!isUser') && messageBubbleSource.includes('processLayerVisible || hasWideMessageContent(renderedDisplayText)') && messageBubbleSource.includes('width: bubbleUsesAvailableWidth ? bubbleMaxWidth : undefined'), 'wide assistant Markdown and process content claims its available mobile width while short assistant and user bubbles remain compact')
  assert.ok(messageBubbleSource.includes("!isStreamingContent && message.status !== 'cancelled'"), 'an empty cancelled assistant turn relies on its stopped status instead of rendering the empty-response failure copy')
  assert.ok(messageBubbleSource.includes('minWidth: showStatusLabel ? 176 : undefined'), 'terminal process status and token text retain enough width to avoid truncating the stopped label')
  assert.ok(chatActiveWorkspaceLayoutSource.includes('resolveProductMobileMessageListLayout(activeWindowWidth'), 'chat workspace uses shared message-list top spacing metrics')
  assert.ok(chatActiveWorkspaceLayoutSource.includes('topChromeInset: Math.max(topChromeInset, visualTopInset)'), 'chat message-list top spacing includes the device safe area below persistent local chrome')
  assert.ok(chatActiveMessageVirtualListSource.includes('messageListLayout.horizontalPadding'), 'message list horizontal gutters are source-audited')
  assert.ok(chatActiveMessageFeedSource.includes("from './chatActiveMessageFeedState'") && chatActiveMessageFeedSource.includes("from './ChatActiveMessageVirtualList'") && chatActiveMessageFeedStateSource.includes("from './chatMessageListState'"), 'message feed state stays behind the active message feed state hook')
  assert.equal(chatActiveMessageFeedStateSource.includes("from '@/product/modeHandoff'"), false, 'message feed state does not restore product-mode handoff derivation')
  assert.ok(chatWorkspaceSource.includes('composerLayout.messageListBottomPadding'), 'message list bottom padding clears composer through shared metrics')
  assert.ok(floatingComposerSource.includes('composerLayout.innerBottomPadding'), 'floating composer safe-area padding uses shared metrics')
  assert.ok(chatSetupWorkspaceSource.includes('paddingTop: Math.max(visualTopInset + topChromeInset + 48'), 'Chat setup reserves only its page-local header inset')
  assert.ok(chatActiveMessageListSource.includes("from './ChatActiveMessageFeed'") && chatActiveMessageFeedSource.includes("from './ChatActiveMessageVirtualList'") && chatActiveMessageVirtualListSource.includes("from './ChatActiveMessageItem'") && chatActiveMessageItemSource.includes("from './MessageBubble'"), 'message bubble actions stay behind the active message feed, virtual list, and item surfaces')
  assert.ok(chatActiveMessageVirtualListSource.includes("from './ChatActiveMessageEmptyState'") && chatActiveMessageEmptyStateSource.includes("from './ChatEmptyState'"), 'empty conversation rendering stays behind the active message virtual-list and Chat empty-state surfaces')
  assert.ok(chatActiveMessageListSource.includes("from './ChatActiveNavigationRail'") && chatActiveNavigationRailSource.includes("from './ConversationNavigationRail'"), 'assistant navigation rail stays behind the active navigation surface')
  assert.ok(chatWorkspaceSource.includes('showSetupEmptyState = true'), 'the upstream Chat workspace retains its temporary setup-visibility compatibility input')
  assert.ok(chatEmptyStateSource.includes('starterLayout.setupContentMaxWidth'), 'setup empty state uses shared starter width')
  assert.ok(chatEmptyStateSource.includes('starterLayout.emptyContentMaxWidth'), 'conversation empty state uses shared starter width')
  assert.doesNotMatch(chatEmptyStateSource, /ProductInteractionMode|PRODUCT_MODE_SHOW_EMPTY_STATE_CONTENT|\bagent\b|\bcompanion\b/, 'Chat empty-state layout has no historical mode branch')
  assert.ok(chatActiveWorkspaceLayoutSource.includes("from './chatWorkspaceConstants'"), 'active Chat retains shared layout constants')
  assert.ok(chatActiveWorkspaceViewSource.includes("from './ChatActiveChromeLayer'") && chatActiveChromeLayerSource.includes("from './FloatingChrome'") && floatingChromeSource.includes('export function FloatingChrome'), 'full top provider chrome stays behind reusable active chrome and floating chrome components')
  assert.ok(floatingChromeSource.includes('export const FLOATING_CHROME_SAFE_AREA_GAP = 0') && floatingChromeSource.includes('<ChatPersistentHeader'), 'floating chrome meets the parent safe area without adding a second visual gap and delegates controls to the persistent header')
  assert.ok(floatingChromeStateSource.includes('const chromeCollapsed = false') && !floatingChromeStateSource.includes('setTimeout('), 'Chat header remains visible across idle, streaming, focus, and scroll state changes')
  assert.ok(chatActiveWorkspaceViewSource.includes('showFloatingControlOrb={false}') && chatActiveChromeLayerSource.includes('onNewConversation'), 'Chat header remains visible and owns navigation actions')
  assert.ok(chatActiveControlsLayerSource.includes("from './MessageMultiSelectBar'"), 'active multi-select controls stay behind the controls layer instead of the active shell')
  assert.ok(chatEmptyStateSource.includes('maxWidth={starterLayout.emptyContentMaxWidth}'), 'Chat entry actions share the mobile content width budget')
  assert.ok(chatEmptyStateSource.includes('starterLayout.statusPillGlyphSize'), 'Chat readiness action glyph uses the shared mobile size budget')
  assert.ok(chatEmptyStateSource.includes('projection.accessibility.minimumTouchTarget'), 'Chat readiness rendering consumes its tested 44dp touch-target projection')
  assert.ok(chatSetupWorkspaceSource.includes('multimodalPolicy={setupState.setupMultimodalPolicy}'), 'setup Chat boundary displays provider/media readiness')
  assert.ok(chatSetupWorkspaceSource.includes('onInspectProvider={openAiConfiguration}') && chatSetupWorkspaceSource.includes('<ChatAiConfigurationSheet'), 'setup Chat opens provider configuration in the unified AI panel')
  assert.doesNotMatch(floatingComposerSource, /modelOpen|QuickChoiceButton|buildModelQuickOptions/, 'composer does not duplicate provider/model selection outside the AI configuration sheet')
  assert.ok(chatActiveWorkspaceMessageListPropsSource.includes('multimodalPolicy') && chatActiveMessageFeedSource.includes('multimodalPolicy={multimodalPolicy}') && chatActiveMessageEmptyStateSource.includes('multimodalPolicy={multimodalPolicy}'), 'empty conversation boundary displays provider/media readiness')
  assert.ok(chatEmptyStateSource.includes('onInspectProvider={onProviders}'), 'empty compact boundary routes provider-fixable gaps without adding another card')
  assert.ok(chatSetupWorkspaceSource.includes("onOpenTools={() => setComposerPanel('more')}") && chatActiveMessageEmptyStateSource.includes("onOpenTools={() => setComposerPanel('more')}"), 'compact boundary can open composer tools without adding another mobile card')
  assert.ok(chatWorkspaceSource.includes("pushChatSettingsRoute('/settings/memory', { focus: 'review' })"), 'compact boundary can route pending memory to review without adding another mobile card')
  assert.ok(chatSetupWorkspaceSource.includes('memoryStatus={boundaryMemoryStatus}') && chatActiveWorkspaceMessageListPropsSource.includes('memoryStatus') && chatActiveMessageFeedSource.includes('memoryStatus={memoryStatus}'), 'compact boundary receives source-level memory status without a tall drawer')

  const composerSource = fs.readFileSync(path.join(root, 'src/components/chat/Composer.tsx'), 'utf8')
  assert.ok(composerSource.includes('resolveProductMobileComposerToolsLayout'), 'composer imports shared expanded tool-panel layout metrics')
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
  assert.ok(composerSource.includes('COMPOSER_DOCK_CONTROL_SIZE = 44'), 'composer dock actions retain explicit 44dp touch geometry')

  const conversationRowSource = fs.readFileSync(path.join(root, 'src/components/conversations/ConversationRow.tsx'), 'utf8')
  const historyPresentationSource = fs.readFileSync(path.join(root, 'src/components/main/history/HistoryPresentation.tsx'), 'utf8')
  assert.equal(conversationRowSource.includes("@/presentation/features/chat/chatPresentationCatalog"), false, 'history rows cannot import the active Chat presentation catalog')
  assert.ok(historyPresentationSource.includes("flexWrap: 'wrap'"), 'history metadata can wrap instead of overflowing narrow rows')
  assert.equal(conversationRowSource.includes('<IslePanel'), false, 'history rows render as a continuous list instead of repeated cards')
  assert.ok(historyPresentationSource.includes('history-row-experience-minimal') && historyPresentationSource.includes('history-row-experience-lime-road') && historyPresentationSource.includes('history-row-experience-markdown'), 'history rows use theme-specific composition frames')
  assert.ok(conversationRowSource.includes("name={actionsOpen ? 'close' : 'more'}"), 'rename and delete stay behind one contextual action entry')

  const conversationsScreenSource = fs.readFileSync(path.join(root, 'src/components/main/ConversationsScreenContent.tsx'), 'utf8')
  assert.equal(conversationsScreenSource.includes('CONVERSATION_HISTORY_MODE_FILTERS.map'), false, 'history screen does not render a redundant mode-filter strip')
  assert.equal(conversationsScreenSource.includes('showHistoryModeFilters'), false, 'history screen does not restore hidden mode-filter selection state')
  assert.equal(conversationsScreenSource.includes('accessibilityRole="tablist"'), false, 'history screen does not expose a mode-filter tablist')
  assert.equal(conversationsScreenSource.includes('accessibilityRole="tab"'), false, 'history screen does not expose mode-filter tabs')
  assert.equal(conversationsScreenSource.includes('firstSearchResultActionHasMatch'), false, 'history search does not add a redundant inline open-result button')
  assert.ok(conversationsScreenSource.includes("t('conversation.historyCount', { count: conversations.length })") && conversationsScreenSource.includes("fontSize: 13, lineHeight: 18, fontWeight: '600'"), 'embedded history relies on the shell title and keeps only a compact count row')
  assert.ok(conversationsScreenSource.includes('width: SCROLL_TOP_ACTION_SIZE') && conversationsScreenSource.includes('accessibilityValue={currentConversationActionAccessibilityValue}'), 'current-conversation navigation is an icon-sized control with its position retained for accessibility')
  assert.ok(conversationsScreenSource.includes('!listInteractionActiveRef.current'), 'history current-conversation floating action stays hidden during programmatic scroll/reveal')
  assert.ok(conversationsScreenSource.includes('setCurrentConversationActionVisibility(false)'), 'history current-conversation floating action can be suppressed before native evidence screenshots')
}

if (require.main === module) run()

module.exports = { run }
