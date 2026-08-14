#!/usr/bin/env node

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

function assertAll(source, markers, label) {
  for (const marker of markers) {
    assert.ok(source.includes(marker), `${label}: missing ${marker}`)
  }
}

function run() {
  const pager = read('src/components/main/MainPagerShell.tsx')
  const themeMotion = read('src/theme/themeMotion.ts')
  const motionFrame = read('src/components/ui/isle/ThemeMotion.tsx')
  const animalIslandContract = read('src/theme/animalIslandUiContract.ts')
  const detailFrame = read('src/presentation/app-shell/ThemeDetailFrame.tsx')
  const activeView = read('src/components/chat/ChatActiveWorkspaceView.tsx')
  const activeExperiences = read('src/components/chat/theme-experiences/ChatActiveThemeExperience.tsx')
  const setupExperiences = read('src/components/chat/theme-experiences/ChatSetupThemeExperience.tsx')
  const setupWorkspace = read('src/components/chat/ChatSetupWorkspace.tsx')
  const chatStatusBanners = read('src/components/chat/ChatStatusBanners.tsx')
  const dialogs = read('src/components/ui/isle/Dialog.tsx')
  const emptyExperiences = read('src/components/chat/theme-experiences/ChatEmptyStateExperience.tsx')
  const chatSurfaces = read('src/components/chat/theme-surfaces/ChatThemeSurfaces.tsx')
  const floatingComposer = read('src/components/chat/FloatingComposer.tsx')
  const floatingChrome = read('src/components/chat/FloatingChrome.tsx')
  const persistentHeader = read('src/components/chat/ChatPersistentHeader.tsx')
  const aiConfiguration = read('src/components/chat/ChatAiConfigurationSheet.tsx')
  const chatOptionsPanel = read('src/components/chat/ChatOptionsPanel.tsx')
  const floatingOrb = read('src/components/chat/FloatingControlOrb.tsx')
  const messageBubble = read('src/components/chat/MessageBubble.tsx')
  const messageContent = read('src/components/chat/MessageContent.tsx')
  const historyScreen = read('src/components/main/ConversationsScreenContent.tsx')
  const historyRow = read('src/components/conversations/ConversationRow.tsx')
  const historyExperiences = read('src/components/main/history/HistoryPresentation.tsx')
  const settingsScreen = read('src/components/main/SettingsScreenContent.tsx')
  const settingsShell = read('src/components/settings/SettingsPageShell.tsx')
  const settingsOverview = read('src/components/settings/theme-experiences/SettingsOverviewExperiences.tsx')
  const settingsPages = read('src/components/settings/theme-experiences/SettingsPageExperiences.tsx')
  const settingsControlCatalog = read('src/components/settings/theme-experiences/SettingsControlCatalogExperiences.tsx')
  const preferenceExperiences = read('src/components/settings/theme-experiences/PreferenceSettingsExperiences.tsx')
  const preferenceContent = read('src/components/settings/PreferenceSettingsContent.tsx')
  const mcpExperiences = read('src/components/settings/theme-experiences/McpSettingsExperiences.tsx')
  const mcpContent = read('src/components/settings/McpSettingsContent.tsx')
  const skillExperiences = read('src/components/settings/theme-experiences/SkillSettingsExperiences.tsx')
  const skillContent = read('src/components/settings/SkillSettingsContent.tsx')
  const contextExperiences = read('src/components/settings/theme-experiences/ContextSettingsExperiences.tsx')
  const contextContent = read('src/components/settings/ContextPanel.tsx')
  const sourceRoute = read('app/source.tsx')
  const missingChatRoute = read('app/chat/[id].tsx')
  const providersRoute = read('app/settings/providers.tsx')
  const providerExperiences = read('src/components/providers/theme-experiences/ProviderSettingsExperiences.tsx')
  const providerContent = read('src/components/providers/ProviderSettingsContent.tsx')
  const providerGrid = read('src/components/providers/ProviderCardGrid.tsx')
  const zhLocale = read('src/i18n/resources/zh-CN.json')

  assert.doesNotMatch(pager, /MainPagerExperience|AppTopBar|ThemeNavigationDrawer|shellNavigation/, 'main pager owns no global navigation chrome')
  assert.doesNotMatch(
    `${pager}\n${historyExperiences}\n${setupExperiences}\n${settingsOverview}`,
    /themeLimeRoad(?:Tagline)?|直到大地变成一颗酸橙|酸橙公路|\.toLowerCase\(\)\}\.md/,
    'runtime navigation expresses Lime Road through composition instead of campaign copy',
  )
  assert.ok(zhLocale.includes('"themeLimeRoad"'), 'the settings theme selector retains a localized Lime Road label')
  assertAll(pager, [
    "const PAGE_SEQUENCE: readonly MainPagerPage[] = ['history', 'home', 'settings']",
    '<IsleMotionFrame',
    'role="page"',
    'direction={direction}',
    "importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}",
    "pointerEvents={active ? 'auto' : 'none'}",
    'aria-hidden={!active}',
  ], 'pager retains shared state and inactive-page isolation')
  assert.equal(pager.includes('persistentTopBarOffset'), false, 'pages own their navigation height without a shared top-bar spacer')

  assertAll(themeMotion, [
    "foundation: 'animal-island'",
    "seasonalLayer: 'summer-road'",
    "id: 'road-cinema'",
    "id: 'quiet'",
    "id: 'document-cut'",
    "intensity === 'reduced'",
    "intensity === 'none'",
    'parallaxX: 18',
    "role: ThemeMotionRole",
  ], 'theme registry owns foundation, seasonal, camera, and reduced-motion contracts')
  assertAll(motionFrame, [
    'export function IsleMotionFrame',
    'resolveThemeMotion({',
    'from={active ? resolved.from : resolved.exit}',
    'animate={active ? resolved.animate : resolved.exit}',
  ], 'Isle UI exposes one semantic motion wrapper instead of feature-owned transform constants')
  assertAll(animalIslandContract, [
    "packageName: 'animal-island-ui'",
    "reviewedVersion: '1.5.1'",
    "reviewedCommit: '803cffa",
    "integration: 'react-native-contract-adaptation'",
  ], 'Animal Island upstream maintenance is a central theme contract')

  assertAll(activeExperiences, [
    'chat-active-experience-minimal',
    'chat-active-experience-lime-road',
    'chat-active-experience-markdown',
    'styles.limeWorkbench',
    'styles.markdownWorkbench',
    'borderLeftWidth: 3',
    'borderLeftWidth: 2',
  ], 'active Chat owns three compositions')
  assertAll(setupExperiences, [
    'chat-setup-experience-minimal',
    'chat-setup-experience-lime-road',
    'chat-setup-experience-markdown',
    'styles.limeContent',
    'borderLeftWidth: 3',
  ], 'setup Chat owns three compositions')
  for (const setupExperience of ['MinimalSetupExperience', 'LimeRoadSetupExperience', 'MarkdownSetupExperience']) {
    const source = setupExperiences.match(new RegExp(`function ${setupExperience}\\([\\s\\S]*?\\n}`))?.[0] ?? ''
    assert.match(source, /<View[\s\S]*?\{chrome\}[\s\S]*?\{status\}/, `${setupExperience} keeps page navigation above status and content`)
  }
  assert.doesNotMatch(setupExperiences + setupWorkspace, /setup-configuration-|setup-step-|ChatSetupConfiguration/, 'setup Chat does not restore the three-step homepage card')
  assertAll(setupWorkspace, ['<ChatAiConfigurationSheet', 'scope="essential"', 'onInspectProvider={openAiConfiguration}', 'visible={showOptions}'], 'unconfigured Chat opens one AI configuration surface')
  assertAll(aiConfiguration, ['chat-ai-configuration-panel', '<ChatOptionsPanel', '<ProviderSettingsContent', "'configuration' | 'providers'"], 'AI configuration keeps provider onboarding inside the same sheet flow')
  assertAll(chatOptionsPanel, ['chat-ai-provider-connection-section', 'chat-ai-model-selection-section', 'chat-ai-reasoning-section'], 'AI configuration exposes provider, model, and reasoning sections')
  assert.doesNotMatch(floatingComposer, /modelOpen|QuickChoiceButton|buildModelQuickOptions/, 'composer no longer duplicates the provider/model picker')
  assertAll(chatStatusBanners, [
    'chat-health-experience-minimal',
    'chat-health-experience-lime-road',
    'chat-health-experience-markdown',
    'chat-compression-experience-minimal',
    'chat-compression-experience-lime-road',
    'chat-compression-experience-markdown',
  ], 'AI health owns utility, checkpoint, and runtime-document compositions')
  const taskStatus = read('src/components/chat/ConversationTaskStatusCard.tsx')
  assertAll(taskStatus, [
    'chat-task-experience-minimal',
    'chat-task-experience-lime-road',
    'chat-task-experience-markdown',
  ], 'AI task status owns utility, checkpoint, and runtime-document compositions')
  assertAll(dialogs, [
    'dialog-experience-minimal',
    'dialog-experience-lime-road',
    'dialog-experience-markdown',
  ], 'dialogs own three theme-specific interaction compositions')
  assertAll(emptyExperiences, [
    'chat-empty-experience-minimal',
    'chat-empty-experience-lime-road',
    'chat-empty-experience-markdown',
    'styles.limeRoot',
    'styles.markdownRoot',
  ], 'Chat empty state owns three compositions')
  assert.doesNotMatch(
    `${setupExperiences}\n${emptyExperiences}\n${settingsControlCatalog}\n${preferenceExperiences}`,
    /LIME ROAD|ROUTE ENTRY|CHECKPOINT 02|PERSONAL ROUTE|\d\d STOPS|CURRENT STOP|NEXT STOP|document: preferences|\.config\b|CHAT\.md|CONVERSATION\.md|README/,
    'repeated workflow surfaces use real product labels instead of campaign or pseudo-document copy',
  )
  assert.ok(activeView.includes('showFloatingControlOrb={false}'), 'page-level Chat chrome remains visible instead of delegating navigation to the floating orb')
  assert.ok(persistentHeader.includes('chat.newConversation') && floatingChrome.includes('onOpenModelPicker') && setupWorkspace.includes('onModelPress={openAiConfiguration}'), 'Chat header exposes persistent new-conversation and unified AI configuration actions')

  for (const surface of ['composer', 'chrome', 'control-panel', 'control-trigger', 'message', 'message-content']) {
    assertAll(chatSurfaces, [
      `chat-${surface}-surface-minimal`,
      `chat-${surface}-surface-lime-road`,
      `chat-${surface}-surface-markdown`,
    ], `${surface} owns three theme surfaces`)
  }
  assertAll(floatingComposer, ['ChatComposerThemeSurface', 'themeId={themeId}'], 'live composer uses theme surface dispatcher')
  assertAll(persistentHeader, ['ChatChromeThemeSurface', 'themeId={themeId}'], 'shared persistent chrome uses the theme surface dispatcher')
  assert.ok(floatingChrome.includes('<ChatPersistentHeader') && setupWorkspace.includes('<ChatPersistentHeader'), 'active and setup Chat share one persistent header authority')
  assertAll(floatingOrb, ['ChatControlPanelThemeSurface', 'ChatControlTriggerThemeSurface'], 'live control orb uses theme surface dispatchers')
  assertAll(messageBubble, ['MessageBubbleThemeSurface', 'themeId={themeId}'], 'live message bubble uses theme surface dispatcher')
  assertAll(messageContent, ['MessageContentThemeSurface', 'themeId={themeId}'], 'live message content uses theme surface dispatcher')

  assertAll(historyExperiences, [
    'history-header-experience-minimal',
    'history-header-experience-lime-road',
    'history-header-experience-markdown',
    'history-row-experience-minimal',
    'history-row-experience-lime-road',
    'history-row-experience-markdown',
    'history-empty-experience-minimal-',
    'history-empty-experience-lime-road-',
    'history-empty-experience-markdown-',
    'styles.routeHeaderFocus',
    'styles.documentHeaderFocus',
    'styles.routeEmptySurface',
    'styles.documentEmptySurface',
    'styles.quietRow',
  ], 'History owns theme-specific headers and records')
  assertAll(historyScreen, ['<HistoryHeaderFrame', '<HistoryEmptyStateFrame', 'themeId={themeId}', 'extraData={conversationListExtraData}'], 'History controller passes theme identity into the live list')
  assertAll(historyRow, ['<HistoryRowFrame', '<HistoryRowContent', 'previous.themeId !== next.themeId'], 'History row keeps shared actions while dispatching its composition')
  assert.match(historyScreen, /CONVERSATION_ROW_HEIGHT_CACHE_PREFIX_[A-Z]+[^\n]*[\s\S]*themeId/, 'History cache identity includes theme-dependent row geometry')

  assertAll(settingsOverview, [
    'settings-overview-experience-minimal',
    'settings-overview-experience-lime-road',
    'settings-overview-experience-markdown',
    'settings-lime-road-itinerary',
    'embedded: boolean',
    'borderLeftWidth: 3',
    'borderLeftWidth: 2',
  ], 'Settings overview owns utility, itinerary, and document structures')
  assertAll(settingsPages, [
    'settings-page-experience-minimal',
    'settings-page-experience-lime-road',
    'settings-page-experience-markdown',
    'settings-detail-surface-minimal',
    'settings-detail-surface-lime-road',
    'settings-detail-surface-markdown',
    'settings-markdown-detail-outline',
  ], 'Settings detail pages own three frames')
  assertAll(settingsScreen, ['LimeRoadSettingsOverviewExperience', 'MarkdownSettingsOverviewExperience', 'MinimalSettingsOverviewExperience'], 'Settings controller selects a theme-owned overview')
  assertAll(settingsShell, ['LimeRoadSettingsPageExperience', 'MarkdownSettingsPageExperience', 'MinimalSettingsPageExperience'], 'Settings route shell selects a theme-owned detail frame')
  assertAll(settingsControlCatalog, [
    'settings-control-navigation-minimal',
    'settings-control-navigation-lime-road',
    'settings-control-navigation-markdown',
    'settings-control-catalog-minimal',
    'settings-control-catalog-lime-road',
    'settings-control-catalog-markdown',
  ], 'Settings control catalog owns three navigation and directory geometries')
  assertAll(settingsScreen, ['<SettingsControlNavigation', '<SettingsControlCatalog'], 'Settings overview uses theme-owned control navigation and catalog')
  assert.equal(settingsScreen.includes('function SettingsControlTile'), false, 'Settings no longer retains the shared legacy square control tile')

  assertAll(preferenceExperiences, [
    'preference-settings-experience-minimal',
    'preference-settings-experience-lime-road',
    'preference-settings-experience-markdown',
    'preference-settings-layout-minimal',
    'preference-settings-layout-lime-road',
    'preference-settings-layout-markdown',
  ], 'Preferences owns utility, route, and document layouts')
  assert.match(preferenceExperiences, /const stops = \[[\s\S]*?identity[\s\S]*?interaction[\s\S]*?generation[\s\S]*?workflow/, 'Lime Road Preferences changes section order into an itinerary')
  assert.match(preferenceExperiences, /\{generation\}[\s\S]*?\{identity\}[\s\S]*?\{workflow\}[\s\S]*?\{interaction\}/, 'Markdown Preferences changes section order into a document workflow')
  assert.match(preferenceExperiences, /function MinimalPreferenceSettingsExperience[\s\S]*?flex: compact \? undefined : 1[\s\S]*?width: compact \? '100%' : undefined/, 'Minimal Preferences lets compact columns grow to content height without overlap')
  assertAll(preferenceContent, ['LimeRoadPreferenceSettingsExperience', 'MarkdownPreferenceSettingsExperience', 'MinimalPreferenceSettingsExperience'], 'Preferences controller dispatches a theme-owned tree')

  assertAll(mcpExperiences, [
    'mcp-settings-experience-minimal',
    'mcp-settings-experience-lime-road',
    'mcp-settings-experience-markdown',
    'mcp-server-catalog-minimal',
    'mcp-server-catalog-lime-road',
    'mcp-server-catalog-markdown',
  ], 'MCP owns continuous-list, route-registry, and manifest-table workspaces')
  assertAll(mcpContent, ['MinimalMcpSettingsExperience', 'LimeRoadMcpSettingsExperience', 'MarkdownMcpSettingsExperience', 'managementSections'], 'MCP controller retains behavior while dispatching independent compositions')
  assert.equal(mcpContent.includes('aspectRatio: 1'), false, 'MCP controller no longer hard-codes one square-card geometry for every theme')

  assertAll(skillExperiences, [
    'skill-settings-experience-minimal',
    'skill-settings-experience-lime-road',
    'skill-settings-experience-markdown',
  ], 'Skills owns three distinct registry leads')
  assertAll(skillContent, ['MinimalSkillSettingsLead', 'LimeRoadSkillSettingsLead', 'MarkdownSkillSettingsLead', "themeId === 'minimal'", "themeId === 'markdown'"], 'Skills changes summary presence and disclosure grammar by theme')

  assertAll(contextExperiences, [
    'context-settings-experience-minimal',
    'context-settings-experience-lime-road',
    'context-settings-experience-markdown',
  ], 'Context owns utility, route-board, and notebook leads')
  assertAll(contextContent, ['MinimalContextSettingsLead', 'LimeRoadContextSettingsLead', 'MarkdownContextSettingsLead', "themeId === 'minimal'", "themeId === 'markdown'"], 'Context changes lead ordering, lists, disclosures, and records by theme')

  assertAll(detailFrame, [
    'theme-detail-minimal-',
    'theme-detail-lime-road-',
    'theme-detail-markdown-',
    'styles.documentHeaderSubtitle',
  ], 'secondary routes own three detail frames')
  assert.doesNotMatch(detailFrame, /FIELD NOTE \/ 0|islemind\/\{kind\}\.md|\{title\}\.md/, 'secondary routes do not repeat decorative field-note or pseudo-path labels')
  assert.ok(sourceRoute.includes('<ThemeDetailFrame'), 'source/process route uses the theme detail frame')
  assert.ok(missingChatRoute.includes('<ThemeDetailFrame'), 'missing conversation route uses the theme detail frame')
  assert.ok(providersRoute.includes('<ThemeDetailFrame'), 'provider route uses the theme detail frame')
  assert.doesNotMatch(missingChatRoute, /ROUTE LOST|RETURN POINT|# 404|conversation\.md|&gt;/, 'missing conversation states use real product copy instead of theme slogans or pseudo documents')
  assert.doesNotMatch(`${settingsOverview}\n${settingsPages}\n${historyScreen}`, /\{title\}\.md|conversation\.title'\)\}\.md/, 'Markdown hierarchy is expressed through composition rather than file-name suffixes')
  assertAll(providerExperiences, [
    'provider-settings-experience-minimal',
    'provider-settings-experience-lime-road',
    'provider-settings-experience-markdown',
    'provider-lime-road-itinerary',
    'provider-markdown-outline',
  ], 'Provider settings owns three independent workspaces')
  assert.doesNotMatch(
    [activeExperiences, setupExperiences, chatStatusBanners, taskStatus, dialogs, emptyExperiences, settingsControlCatalog, preferenceExperiences, mcpExperiences, skillExperiences, skillContent, contextExperiences, contextContent, providerExperiences].join('\n'),
    /LIME ROAD|ROUTE ENTRY|ROUTE INTERRUPTION|ROUTE CHECKPOINT|SUPPLY ROUTE|SKILL ROUTE|NETWORK ROUTE|CURRENT STOP|NEXT STOP|\d\d STOPS|runtime\/(?:health|task)\.yml|islemind\/dialog\.md|settings\/providers\.yml|document:|registry: skills|rm --all|open\(\)|\[x\]/,
    'theme families use composition and real product labels instead of campaign, itinerary, or pseudo-document copy',
  )
  assertAll(providerContent, [
    'MinimalProviderSettingsExperience',
    'LimeRoadProviderSettingsExperience',
    'MarkdownProviderSettingsExperience',
    'experience={colors.ui.family}',
    'providerAttentionItems.length ?',
  ], 'Provider controller dispatches theme-owned composition and list geometry')
  assert.doesNotMatch(providerContent, /providers\/\$\{provider\.id\}\.yml|> providers: \[\]/, 'Provider states do not expose pseudo registry files or data literals')
  assertAll(providerGrid, [
    "experience = 'lime-road'",
    "experience !== 'lime-road'",
    'provider-card-grid-${experience}',
  ], 'Provider list can leave the legacy square grid outside Lime Road')

  console.log('Theme experience structure tests passed')
}

if (require.main === module) run()

module.exports = { run }
