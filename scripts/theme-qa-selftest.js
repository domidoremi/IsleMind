#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const {
  collectThemeSystemReleaseGateReport,
} = require('./theme-release-gate-specs')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const checks = []

function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
}

function collectRepoSource(relativeDir) {
  const dir = path.join(root, relativeDir)
  if (!fs.existsSync(dir)) return ''
  let output = ''
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      output += collectRepoSource(path.join(relativeDir, entry.name))
      continue
    }
    if (!/\.(ts|tsx|js|jsx|json|css)$/.test(entry.name)) continue
    output += `\n/* ${path.relative(root, fullPath)} */\n${fs.readFileSync(fullPath, 'utf8')}\n`
  }
  return output
}

const releaseGate = collectThemeSystemReleaseGateReport({ repoRoot: root })
const colors = read('src/theme/colors.ts')
const themeHook = read('src/hooks/useAppTheme.ts')
const settingsStore = read('src/store/settingsStore.ts')
const preferencesRoute = read('app/settings/preferences.tsx')
const settingsActionContracts = read('src/modules/settings/contracts.ts')
const settingsAppearance = read('src/modules/settings/appearance.ts')
const applicationBuiltinCatalog = read('src/modules/integrations/conversationToolCatalog.ts')
const chatWorkspace = read('src/components/chat/ChatWorkspace.tsx')
const chatSetupWorkspace = read('src/components/chat/ChatSetupWorkspace.tsx')
const chatStatusBanners = read('src/components/chat/ChatStatusBanners.tsx')
const chatChromeSurfaces = read('src/components/chat/chatChromeSurfaces.ts')
const floatingChrome = read('src/components/chat/FloatingChrome.tsx')
const chatPersistentHeader = read('src/components/chat/ChatPersistentHeader.tsx')
const floatingComposer = read('src/components/chat/FloatingComposer.tsx')
const composer = read('src/components/chat/Composer.tsx')
const optionsPanel = read('src/components/chat/ChatOptionsPanel.tsx')
const conversationsScreen = read('src/components/main/ConversationsScreenContent.tsx')
const conversationRow = read('src/components/conversations/ConversationRow.tsx')
const mainPagerShell = read('src/components/main/MainPagerShell.tsx')
const themeMotion = read('src/theme/themeMotion.ts')
const motionFrame = read('src/components/ui/isle/ThemeMotion.tsx')
const settingsScreen = read('src/components/main/SettingsScreenContent.tsx')
const chatAiConfiguration = read('src/components/chat/ChatAiConfigurationSheet.tsx')
const chatEmptyState = read('src/components/chat/ChatEmptyState.tsx')
const chatActiveExperience = read('src/components/chat/theme-experiences/ChatActiveThemeExperience.tsx')
const chatSetupExperience = read('src/components/chat/theme-experiences/ChatSetupThemeExperience.tsx')
const chatEmptyExperience = read('src/components/chat/theme-experiences/ChatEmptyStateExperience.tsx')
const chatThemeSurfaces = read('src/components/chat/theme-surfaces/ChatThemeSurfaces.tsx')
const themeExpressionSurface = read('src/components/ui/isle/ThemeExpressionSurface.tsx')
const historyPresentation = read('src/components/main/history/HistoryPresentation.tsx')
const isleBackground = read('src/components/ui/isle/Background.tsx')
const messageBubble = read('src/components/chat/MessageBubble.tsx')
const messageContent = read('src/components/chat/MessageContent.tsx')
const apiKeyPanel = read('src/components/settings/ApiKeyPanel.tsx')
const contextPanel = read('src/components/settings/ContextPanel.tsx')
const mcpSettings = read('src/components/settings/McpSettingsContent.tsx')
const mcpSettingsExperiences = read('src/components/settings/theme-experiences/McpSettingsExperiences.tsx')
const preferenceSettings = read('src/components/settings/PreferenceSettingsContent.tsx')
const sourceRoute = read('src/presentation/features/conversations/SourceDetailScreen.tsx')
const chip = read('src/components/ui/isle/Chip.tsx')
const controls = read('src/components/ui/isle/Controls.tsx')
const panel = read('src/components/ui/isle/Panel.tsx')
const primitives = read('src/components/ui/isle/Primitives.tsx')
const dialog = read('src/components/ui/isle/Dialog.tsx')
const isleKit = read('src/components/ui/isle/IsleKit.tsx')
const appIcon = read('src/components/ui/AppIcon.tsx')
const providerSettings = read('src/components/providers/ProviderSettingsContent.tsx')
const emptyState = read('src/components/ui/isle/EmptyState.tsx')
const globalCss = read('src/global.css')
const repoSource = collectRepoSource('app') + collectRepoSource('src')

check(
  'theme release gate status is green',
  releaseGate.ok,
  releaseGate.issues.join('; ') || 'theme release gate should pass package/file checks',
)
check(
  'four canonical tokens normalize legacy families safely',
  /canonicalFamily: family/.test(colors)
    && /value === 'glass' \|\| value === 'liquid'\) return 'liquid-glass'/.test(settingsAppearance)
    && /value === 'lime-road' \|\| value === 'cartoon' \|\| value === 'island'\) return 'monet'/.test(settingsAppearance)
    && /value === 'markdown' \|\| value === 'material-3' \|\| value === 'material3'\) return 'material'/.test(settingsAppearance)
    && /normalizeSettingsThemeFamily\(value\) \?\? DEFAULT_THEME_ID/.test(colors)
    && /DEFAULT_THEME_ID: CanonicalThemeId = 'minimal'/.test(colors),
  'minimal, Monet, Material, and Liquid Glass are the runtime families while legacy values remain load-compatible',
)
check(
  'lime-road control tokens keep tactile depth restrained',
  /primaryShadowOpacity: dark \? 0\.08 : 0\.04/.test(colors)
    && /secondaryShadowOpacity: dark \? 0\.025 : 0\.015/.test(colors)
    && /shadowOpacity: dark \? 0\.04 : 0\.025/.test(colors),
  'lime-road controls should stay tactile without restoring the old heavy shadow stack',
)
check(
  'theme families own materially different experience grammars',
  /layout: 'editorial'[\s\S]*?navigation: 'route'[\s\S]*?background: 'road'[\s\S]*?transition: 'travel'/.test(colors)
    && /layout: 'quiet'[\s\S]*?navigation: 'quiet'[\s\S]*?background: 'plain'[\s\S]*?transition: 'fade'/.test(colors)
    && /layout: 'structured'[\s\S]*?navigation: 'material'[\s\S]*?background: 'tonal'[\s\S]*?transition: 'shared-axis'/.test(colors)
    && /layout: 'layered'[\s\S]*?navigation: 'glass'[\s\S]*?background: 'glass'[\s\S]*?transition: 'fluid'/.test(colors),
  'theme families should change the product composition and motion grammar, not only primitive colors and radii',
)
check(
  'experience grammar reaches the live shell and theme previews',
  !/MainPagerExperience|ThemeNavigationDrawer|AppTopBar|shellNavigation/.test(mainPagerShell)
    && /colors\.ui\.experience\.background/.test(mainPagerShell)
    && /monet-breathe/.test(themeMotion)
    && /material-shared-axis/.test(themeMotion)
    && /glass-refraction/.test(themeMotion)
    && /experienceBackground = colors\.ui\.experience\.background/.test(isleBackground)
    && /function ThemeFamilyPreview/.test(settingsScreen)
    && /getColors\(mode, themeId/.test(settingsScreen)
    && /ChatActiveThemeExperience/.test(chatActiveExperience)
    && /ChatSetupThemeExperience/.test(chatSetupExperience)
    && /ChatEmptyStateExperience/.test(chatEmptyState + chatEmptyExperience)
    && /ChatAiConfigurationSheet/.test(floatingChrome)
    && /chat-ai-configuration-panel/.test(chatAiConfiguration)
    && /chat-ai-provider-connection-section/.test(optionsPanel)
    && /chat-ai-model-selection-section/.test(optionsPanel)
     && /chat-ai-reasoning-section/.test(optionsPanel)
     && /chat-composer-surface-minimal/.test(chatThemeSurfaces)
     && /chat-composer-surface-monet/.test(chatThemeSurfaces)
     && /chat-composer-surface-material/.test(chatThemeSurfaces)
     && /chat-composer-surface-liquid-glass/.test(chatThemeSurfaces)
     && /themeId: CanonicalThemeId/.test(chatThemeSurfaces),
  'navigation, static page composition, background composition, theme selection, and the chat entry should project family identity without automatic entrance motion',
)
check(
  'weak control states use semantic tokens instead of global opacity',
  /disabledForeground: string/.test(colors)
    && /placeholderForeground: string/.test(colors)
    && /disabledOpacity: number/.test(colors)
    && /disabledForeground: dark \? '#8C959F' : '#59636E'/.test(colors)
    && /placeholderForeground: dark \? '#8C959F' : '#6E7781'/.test(colors)
    && /disabledOpacity: 1/.test(colors),
  'disabled and placeholder states should stay readable through semantic tokens, especially in Markdown light mode',
)
check(
  'legacy island normalization still survives in runtime settings',
  /value === 'lime-road' \|\| value === 'cartoon' \|\| value === 'island'\) return 'monet'/.test(settingsAppearance) && /normalizeThemeId\(rawSettings\.themeId\)/.test(settingsStore),
  'persisted legacy Monet aliases must keep normalizing to Monet',
)
check(
  'useAppTheme keeps family booleans for high-flow consumers',
  /isMonet: canonicalThemeId === 'monet'/.test(themeHook) && /isMaterial: canonicalThemeId === 'material'/.test(themeHook) && /isLiquidGlass: canonicalThemeId === 'liquid-glass'/.test(themeHook) && /isMinimal: canonicalThemeId === 'minimal'/.test(themeHook),
  'canonical families stay explicit while legacy presentation projections remain separate',
)
check(
  'preferences route still mounts the preference settings surface',
  /PreferenceSettingsContent/.test(preferencesRoute) && /settings\.preferences/.test(preferencesRoute),
  'the named preferences route should still resolve to the settings preference content shell',
)
check(
  'theme app actions recognize the four canonical families',
  /SETTINGS_THEME_FAMILIES = \['minimal', 'monet', 'material', 'liquid-glass'\] as const/.test(settingsActionContracts),
  'structured Settings actions should stay aligned with the canonical theme families',
)
check(
  'builtin tools keep compatibility aliases while exposing the new families',
  /enum: \['minimal', 'monet', 'material', 'liquid-glass', 'lime-road', 'markdown', 'cartoon', 'island', 'glass', 'material-3', 'material3', 'liquid'\]/.test(applicationBuiltinCatalog) && /Legacy .*migrated to the matching canonical family/.test(applicationBuiltinCatalog),
  'builtins should remain compatible with old values without reviving them as runtime themes',
)
check(
  'chat workspace uses one theme-owned persistent header',
  /ChatPersistentHeader/.test(floatingChrome)
    && /ChatPersistentHeader/.test(chatSetupWorkspace)
    && /ChatChromeThemeSurface/.test(chatPersistentHeader)
    && /themeId=\{themeId\}/.test(chatPersistentHeader)
    && /chat-chrome-surface-minimal/.test(chatThemeSurfaces)
    && /chat-chrome-surface-monet/.test(chatThemeSurfaces)
    && /chat-chrome-surface-material/.test(chatThemeSurfaces)
    && /chat-chrome-surface-liquid-glass/.test(chatThemeSurfaces)
    && /ThemeExpressionSurface/.test(chatThemeSurfaces)
    && /const RENDERERS: Record<CanonicalThemeId, Renderer>/.test(themeExpressionSurface)
    && /props\.colors\.ui\.semantic\.chrome\.border/.test(themeExpressionSurface),
  'active and setup Chat should share persistent controls while each theme retains its own surface composition',
)
check(
  'chat quick panels and health banner use glass chrome containers',
  /panelChromeSurface = isGlass \? colors\.ui\.semantic\.chrome\.background/.test(floatingComposer)
    && (/backgroundColor: isGlass \? colors\.ui\.semantic\.chrome\.background/.test(chatWorkspace)
      || /backgroundColor: isGlass \? colors\.ui\.semantic\.chrome\.background/.test(chatStatusBanners)
      || /backgroundColor: resolveChatChromeSurface\(colors, isGlass\)/.test(chatStatusBanners))
    && /\? colors\.ui\.actionBar\.itemBackground/.test(floatingComposer)
    && /resolveChatChromeSurface[\s\S]*?colors\.ui\.limeRoad \? colors\.ui\.semantic\.surface\.base/.test(chatChromeSurfaces),
  'quick panels and health banner should avoid heavy card styling in glass mode',
)
 check(
   'conversation search shell and persistent controls use theme-owned chrome',
   /HistoryHeaderFrame/.test(conversationsScreen)
     && /themeId=\{canonicalThemeId\}/.test(conversationsScreen)
     && /ComposerToolButton/.test(floatingComposer)
     && /ChatChromeThemeSurface/.test(chatPersistentHeader),
  'high-frequency history and conversation controls should use theme-owned compositions',
)
check(
  'conversation rows stay list-like instead of standalone cards',
   !conversationRow.includes('<IslePanel')
     && /HistoryRowFrame/.test(conversationRow)
     && /history-row-experience-minimal/.test(historyPresentation)
     && /history-row-experience-monet/.test(historyPresentation)
     && /history-row-experience-material/.test(historyPresentation)
     && /history-row-experience-liquid-glass/.test(historyPresentation)
     && /borderBottomWidth: StyleSheet\.hairlineWidth/.test(historyPresentation),
  'conversation history rows should use theme-owned continuous/list or route/document frames',
)
check(
  'supporting Isle controls are glass-aware',
  /actionBar\.itemBackground/.test(chip) && /actionBar\.itemBorder/.test(chip) && /semantic\.surface\.overlay/.test(dialog),
  'chips and dialogs should share the same glass control language',
)
check(
  'lime-road icon roles preserve neutral utility affordances',
  /delete: 'danger'/.test(appIcon)
    && !/close: 'danger'/.test(appIcon)
    && !/power: 'danger'/.test(appIcon)
    && !/stop: 'danger'/.test(appIcon)
    && !/star: 'warning'/.test(appIcon)
    && !/sun: 'warning'/.test(appIcon)
    && !/zap: 'warning'/.test(appIcon),
  'only truly destructive icons should be force-colored; neutral utility icons should keep their caller-provided contrast color',
)
check(
  'lime-road icon role coloring respects explicit contrast colors',
  /function isExplicitIconColor/.test(appIcon)
    && /requestedColor === colors\.text/.test(appIcon)
    && /requestedColor === colors\.textSecondary/.test(appIcon)
    && /requestedColor === colors\.textTertiary/.test(appIcon)
    && /requestedColor === colors\.ui\.tone\.success\.foreground/.test(appIcon)
    && /if \(isExplicitIconColor\(requestedColor, colors\)\) return requestedColor/.test(appIcon)
    && /name="search-check" color=\{colors\.textTertiary\}/.test(apiKeyPanel)
    && /name="reasoning" color=\{colors\.text\}/.test(contextPanel)
    && /name="shield" color=\{colors\.text\}/.test(preferenceSettings)
    && /name="shield" color=\{colors\.text\}/.test(mcpSettings)
    && /name="toggle-on" color=\{colors\.textSecondary\}/.test(read('src/components/settings/SkillSettingsContent.tsx')),
  'inactive or explicitly semantic icons should not be recolored by lime-road role defaults',
)
check(
  'AppIcon forwards caller fill for selected and stop states',
  /fill,\s*\n\s*style,/.test(appIcon)
    && /fill=\{fill \?\? 'none'\}/.test(appIcon)
    && /name="star"[\s\S]*fill=\{isDefault \? colors\.ui\.control\.primaryForeground : 'transparent'\}/.test(apiKeyPanel)
    && /name="stop"[\s\S]*fill=\{colors\.ui\.control\.primaryForeground\}/.test(floatingComposer),
  'selected stars and stop controls should render filled icons instead of silently dropping fill props',
)
check(
  'IsleKit demo surfaces stay plain-content first',
  /const tableBackground = palette\.glass \? palette\.ui\.semantic\.chrome\.background : palette\.ui\.semantic\.surface\.base/.test(isleKit)
    && /const frameBackground = palette\.glass \? palette\.ui\.semantic\.chrome\.background : palette\.ui\.semantic\.surface\.base/.test(isleKit)
    && /const phoneSurface = palette\.glass \? palette\.ui\.semantic\.chrome\.background : palette\.ui\.semantic\.surface\.base/.test(isleKit)
    && /const ornamentedTitle = palette\.limeRoad && palette\.ui\.ornamented/.test(isleKit)
    && /const titleShadowOpacity = ornamentedTitle \? \(palette\.isDark \? 0\.08 : 0\.05\) : 0/.test(isleKit),
  'table, time, phone, and title chrome should stay quieter than the primary content layer',
)
check(
  'web fallback keeps only the documented legacy family selectors',
  /data-theme-id='glass'/.test(globalCss) && /data-theme-id='cartoon'/.test(globalCss) && /data-theme-id='island'/.test(globalCss),
  'web fallback should cover all runtime families plus the island alias',
)
check(
  'repo source does not fake native Liquid Glass APIs',
  !/glassEffect|GlassEffectContainer|glassEffectID|buttonStyle\(\.glass|buttonStyle\(\.glassProminent/.test(repoSource),
  'RN fallback should not pretend to be the native iOS 26 API surface',
)
check(
  'repo boundary still resolves to RN fallback rather than native iOS target',
  releaseGate.nativeIosBoundary.mode === 'rn-fallback' && releaseGate.nativeIosBoundary.nativeTargetAvailable === false,
  'without repo-owned Xcode targets this implementation must stay on the RN fallback path',
)
check(
  'chat options panel stays aligned with glass chrome tokens',
  /panelSurface = sheetMode \? sheetMaterial\.surface : isGlass \? colors\.ui\.semantic\.chrome\.background/.test(optionsPanel) && /panelChrome = sheetMode \? sheetMaterial\.chrome : isGlass \? colors\.ui\.semantic\.chrome\.toolbar/.test(optionsPanel) && /actionSurface = isGlass \? colors\.ui\.actionBar\.itemBackground/.test(optionsPanel) && /isLimeRoad \? colors\.ui\.semantic\.surface\.base/.test(optionsPanel),
  'popover/sheet chrome should keep sharing the same control language',
)
check(
  'chat composer uses semantic surfaces instead of lime-road default cards',
  /raisedSurface = colors\.ui\.glass \? colors\.ui\.semantic\.chrome\.background : colors\.ui\.limeRoad \? colors\.ui\.semantic\.surface\.base/.test(composer)
    && /chipSurface = colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground : colors\.ui\.limeRoad \? colors\.ui\.semantic\.surface\.base/.test(composer)
    && /backgroundColor: attachmentsOpen \? colors\.ui\.actionBar\.itemActiveBackground : 'transparent'/.test(composer)
    && /backgroundColor: recording \? colors\.ui\.tone\.danger\.background : 'transparent'/.test(composer),
  'composer shell and chips should keep semantic surfaces while idle utilities stay transparent and active states remain explicit',
)
check(
  'composer and shared controls keep weak states light but readable',
  /const composerShadowOpacity = 0/.test(composer)
    && /shadowRadius: focused \? 12 : 6/.test(composer)
    && /placeholderTextColor=\{colors\.ui\.input\.placeholderForeground\}/.test(composer)
    && /backgroundColor: canSend \? colors\.ui\.control\.primaryBackground : colors\.ui\.control\.disabledBackground/.test(composer)
    && /color=\{canSend \? colors\.ui\.control\.primaryForeground : colors\.ui\.control\.disabledForeground\}/.test(composer)
    && /backgroundColor: disabled \? 'transparent'/.test(composer)
    && /activeSurface="quiet"/.test(floatingComposer)
    && /placeholderTextColor=\{input\.placeholderForeground\}/.test(isleKit)
    && /color: disabled \? input\.disabledForeground : palette\.colors\.text/.test(isleKit)
    && /opacity: disabled \? disabledStyle\.opacity : 1/.test(isleKit),
  'high-frequency composer and input controls should use semantic weak-state colors instead of blanket dimming',
)
check(
  'shared choice controls avoid blanket disabled opacity',
  /const switchTextColor = disabled \? disabledStyle\.foreground/.test(isleKit)
    && /backgroundColor: disabled \? disabledStyle\.backgroundColor : active \? switchTokens\.trackOn : switchTokens\.trackOff/.test(isleKit)
    && /const questionColor = disabled \? disabledStyle\.foreground : palette\.text/.test(isleKit)
    && /const optionDisabled = !!option\.disabled/.test(isleKit)
    && /backgroundColor: optionDisabled \? disabledStyle\.backgroundColor : optionActive \? activeOptionBackground : 'transparent'/.test(isleKit)
    && /const boxBackground = optionDisabled \? disabledStyle\.backgroundColor : active \? activeBoxBackground : inactiveBoxBackground/.test(isleKit)
    && !/opacity: disabled \? 0\.55 : 1/.test(isleKit)
    && !/opacity: option\.disabled \? 0\.45 : 1/.test(isleKit)
    && !/opacity: disabled \|\| option\.disabled \? 0\.55 : 1/.test(isleKit),
  'switches, collapses, selects, and checkboxes should express disabled state through semantic chrome and text colors',
)
check(
  'message action lock uses disabled chrome without dimming the icon row',
  /backgroundColor: locked\n\s*\? colors\.ui\.control\.disabledBackground\n\s*: colors\.ui\.control\.primaryBackground/.test(messageBubble)
    && /borderColor: locked\n\s*\? colors\.ui\.control\.disabledBorder\n\s*: colors\.ui\.control\.primaryBorder/.test(messageBubble)
    && !/opacity: locked/.test(messageBubble),
  'locked confirmation actions should stay visible through semantic disabled chrome without opacity dimming',
)
check(
  'ambient loading indicators stop looping outside full motion',
  (messageBubble.match(/loop: motion === 'full'/g) ?? []).length >= 5
    && messageBubble.includes("const shimmer = active && motion === 'full' && grammar !== 'precision'")
    && messageBubble.includes('loop: shimmer')
    && messageBubble.includes("'.'.repeat(motion === 'full' ? dotCount : 3)")
    && messageBubble.includes("scrollToEnd({ animated: running && motion === 'full' })")
    && !messageBubble.includes('function ProcessSpinner')
    && !sourceRoute.includes('MotiView')
    && !sourceRoute.includes('useMotionPreference'),
  'status shimmer, typing, cursor, source skeleton, and source loading loops must render stable reduced-motion states',
)
check(
  'shared Isle primitives keep lime-road surfaces soft by default',
  /case 'raised':[\s\S]*?return colors\.ui\.limeRoad \? colors\.ui\.semantic\.surface\.base : colors\.ui\.semantic\.surface\.base/.test(panel)
    && /ornamented[\s\S]*?colors\.ui\.semantic\.surface\.base[\s\S]*?colors\.ui\.semantic\.surface\.muted/.test(chip)
    && /const backgroundColor = colors\.ui\.limeRoad\s*\?\s*colors\.ui\.semantic\.surface\.base/.test(controls)
    && /const toggleSurface = active[\s\S]*?colors\.ui\.limeRoad[\s\S]*?colors\.ui\.semantic\.surface\.base/.test(primitives)
    && /const itemBackground = danger[\s\S]*?colors\.ui\.limeRoad[\s\S]*?colors\.ui\.semantic\.surface\.base/.test(primitives),
  'shared panels, chips, metrics, and list items should use semantic base/muted surfaces in Lime Road mode',
)
check(
  'page-owned navigation preserves family composition without a global shell',
  /const backgroundMode: IsleBackgroundMode = colors\.ui\.experience\.background === 'plain'/.test(mainPagerShell)
    && /colors\.ui\.experience\.background === 'tonal'/.test(mainPagerShell)
    && /colors\.ui\.experience\.background === 'document'/.test(mainPagerShell)
    && /colors\.ui\.experience\.background === 'glass'/.test(mainPagerShell)
     && /backgroundIntensity=\{0\.96\}/.test(mainPagerShell)
     && /colors\.ui\.experience\.background === 'plain' \? colors\.background\.canvas : 'transparent'/.test(mainPagerShell)
     && /testID="theme-background-road"/.test(isleBackground)
     && /testID="theme-background-tonal"/.test(isleBackground)
     && /testID="theme-background-glass"/.test(isleBackground)
     && /motion === 'full'[\s\S]*?colors\.background\.motion !== 'none'[\s\S]*?state === 'idle' \|\| state === 'active'/.test(isleBackground)
     && /chat-setup-experience-minimal/.test(chatSetupExperience)
     && /chat-setup-experience-monet/.test(chatSetupExperience)
     && /chat-setup-experience-material/.test(chatSetupExperience)
     && /chat-setup-experience-liquid-glass/.test(chatSetupExperience)
     && [/function MinimalSetupExperience[\s\S]*?\{chrome\}/, /function MonetSetupExperience[\s\S]*?\{chrome\}/, /function MaterialSetupExperience[\s\S]*?\{chrome\}/, /function LiquidGlassSetupExperience[\s\S]*?\{chrome\}/].every((pattern) => pattern.test(chatSetupExperience))
    && /HistoryHeaderFrame/.test(conversationsScreen)
    && /<SettingsOverviewExperience/.test(settingsScreen)
    && !/MainPagerExperience|ThemeNavigationDrawer|AppTopBar|shellNavigation/.test(mainPagerShell)
    && !/stopOpacity/.test(mainPagerShell),
  'page headers and family-owned backgrounds should replace the retired drawer and masthead shell',
)
check(
  'message content rich cards stay secondary to plain content',
  /richCardSurface: colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground : colors\.ui\.limeRoad \? colors\.ui\.semantic\.surface\.muted : colors\.ui\.semantic\.surface\.muted/.test(messageContent) && /blockRaisedSurface: colors\.ui\.glass \? colors\.ui\.semantic\.chrome\.background : colors\.ui\.limeRoad \? colors\.ui\.semantic\.surface\.base/.test(messageContent) && /fontSize: 10\.5/.test(messageContent),
  'rich blocks should read lighter than primary message text',
)
check(
  'message content secondary blocks use muted surfaces instead of default cards',
  /tableRowBackground = isUser \? 'transparent' : assistantSurfaces\.blockSurface/.test(messageContent) && /DataSummaryPanel/.test(messageContent) && /DiagramPreviewPanel/.test(messageContent),
  'tables, summaries, and diagrams should stay visually secondary',
)
check(
   'conversation search shell stays muted in non-glass modes',
   /HistoryHeaderFrame/.test(conversationsScreen)
     && /history-header-experience-minimal/.test(historyPresentation)
     && /history-header-experience-monet/.test(historyPresentation)
     && /history-header-experience-material/.test(historyPresentation)
     && /history-header-experience-liquid-glass/.test(historyPresentation),
  'search chrome should be owned by the selected history experience rather than a single shared shell',
)
check(
  'api key settings surfaces stay on muted secondary layers',
  /backgroundColor: colors\.ui\.glass \? colors\.ui\.semantic\.chrome\.background : colors\.ui\.limeRoad \? colors\.ui\.semantic\.surface\.muted : colors\.ui\.semantic\.surface\.muted/.test(apiKeyPanel)
    && /function quietControlSurface[\s\S]*?colors\.ui\.semantic\.surface\.muted/.test(apiKeyPanel)
    && /backgroundColor: colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground : colors\.ui\.semantic\.surface\.muted/.test(apiKeyPanel)
    && /const backgroundColor = toneToken\?\.background \?\? \(colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground : colors\.ui\.semantic\.surface\.muted\)/.test(apiKeyPanel),
  'provider configuration should avoid reverting to default card surfaces for secondary settings chrome',
)
check(
  'context assets and local capability cards stay visually secondary',
  /backgroundColor: colors\.ui\.glass \? colors\.ui\.semantic\.chrome\.background : colors\.ui\.limeRoad \? colors\.ui\.semantic\.surface\.base : colors\.ui\.semantic\.surface\.base/.test(contextPanel) && /assetCardSurface\(colors, active \? colors\.ui\.control\.primaryBorder : colors\.ui\.tone\.warning\.border\)/.test(contextPanel) && /backgroundColor: colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground : colors\.ui\.limeRoad \? colors\.ui\.semantic\.surface\.muted : colors\.ui\.semantic\.surface\.base/.test(contextPanel),
  'knowledge, memory, and local capability cards should keep muted surfaces with semantic borders',
)
check(
  'settings foldouts use semantic surfaces in Lime Road mode',
  /return colors\.ui\.limeRoad \? colors\.ui\.semantic\.surface\.base : isGlass \? colors\.ui\.semantic\.chrome\.background/.test(settingsStore + read('src/components/main/SettingsScreenContent.tsx')) && /backgroundColor: colors\.ui\.limeRoad \? colors\.ui\.semantic\.surface\.muted : colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground/.test(read('src/components/main/SettingsScreenContent.tsx')),
  'settings foldout bodies, cards, and theme selectors should not fall back to decorative card fills',
)
check(
  'provider settings chrome stays on semantic surfaces instead of heavy cards',
  /function resolveProviderChrome/.test(providerSettings)
    && /const chromeSurface = colors\.ui\.limeRoad \? colors\.ui\.semantic\.surface\.base : colors\.ui\.glass \? colors\.ui\.semantic\.chrome\.background : colors\.ui\.semantic\.surface\.base/.test(providerSettings)
    && /const mutedSurface = colors\.ui\.limeRoad \? colors\.ui\.semantic\.surface\.muted : colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground : colors\.ui\.semantic\.surface\.muted/.test(providerSettings)
    && /const raisedSurface = colors\.ui\.limeRoad \? colors\.ui\.semantic\.surface\.base : colors\.ui\.glass \? colors\.ui\.semantic\.surface\.overlay : colors\.ui\.semantic\.surface\.base/.test(providerSettings)
    && /backgroundColor: chromeSurface/.test(providerSettings)
    && /shadowOpacity: 0/.test(providerSettings),
  'provider management should keep chrome/material hierarchy without falling back to decorative cards',
)
check(
  'provider activation progress keeps lightweight semantic chrome',
  /function ActivationProgressCard/.test(providerSettings)
    && /backgroundColor: chromeSurface/.test(providerSettings)
    && /borderColor: chromeBorder/.test(providerSettings)
    && /shadowOpacity: 0/.test(providerSettings),
  'activation progress chrome should stay readable and light across theme families',
)
check(
  'source reader skeleton and empty states stay on secondary surfaces',
  /const skeletonSurface = colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground : colors\.ui\.semantic\.surface\.muted/.test(sourceRoute)
    && /resolveThemeComponentExpression\(canonicalThemeId, 'emptyState'\)/.test(emptyState)
    && /shadowOpacity: glass \? 0\.16 : monet \? 0\.08 : 0/.test(emptyState),
  'loading and empty surfaces should remain quieter than live content while retaining bounded Monet and Glass depth identity',
)
check(
  'mcp settings separates quiet, route, and document server geometries while keeping restrained detail depth',
  /const cardSurface = colors\.ui\.glass \? colors\.ui\.semantic\.chrome\.background : colors\.ui\.semantic\.surface\.base/.test(mcpSettings)
    && /const mutedSurface = colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground : colors\.ui\.semantic\.surface\.muted/.test(mcpSettings)
    && /mcp-server-catalog-minimal/.test(mcpSettingsExperiences)
    && /mcp-server-catalog-lime-road/.test(mcpSettingsExperiences)
    && /mcp-server-catalog-markdown/.test(mcpSettingsExperiences)
    && /const enabledSurface = '#198754'/.test(mcpSettingsExperiences)
    && !/aspectRatio: 1/.test(mcpSettings)
    && /shadowOpacity: 0/.test(mcpSettings)
    && /shadowRadius: 0/.test(mcpSettings),
  'MCP should leave the legacy shared square grid while management details keep light semantic grouping',
)

const failures = checks.filter((item) => !item.ok)
for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`)
  if (!item.ok) console.log(`  ${item.detail}`)
}

if (failures.length) {
  console.error(`theme QA self-test failed: ${failures.length} issue(s)`)
  process.exit(1)
}

console.log(`theme QA self-test passed: ${checks.length} checks`)
