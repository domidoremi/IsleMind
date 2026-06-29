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
const architectureAudit = read('docs/architecture/theme-system-liquid-glass-audit.md')
const appActionPolicy = read('src/services/appActionPolicy.ts')
const appCommandRouter = read('src/services/appCommandRouter.ts')
const builtinToolRegistry = read('src/services/builtinToolRegistry.ts')
const chatWorkspace = read('src/components/chat/ChatWorkspace.tsx')
const composer = read('src/components/chat/Composer.tsx')
const optionsPanel = read('src/components/chat/ChatOptionsPanel.tsx')
const conversationsScreen = read('src/components/main/ConversationsScreenContent.tsx')
const conversationRow = read('src/components/conversations/ConversationRow.tsx')
const mainPagerShell = read('src/components/main/MainPagerShell.tsx')
const messageContent = read('src/components/chat/MessageContent.tsx')
const apiKeyPanel = read('src/components/settings/ApiKeyPanel.tsx')
const contextPanel = read('src/components/settings/ContextPanel.tsx')
const mcpSettings = read('src/components/settings/McpSettingsContent.tsx')
const preferenceSettings = read('src/components/settings/PreferenceSettingsContent.tsx')
const sourceRoute = read('app/source.tsx')
const chip = read('src/components/ui/isle/Chip.tsx')
const controls = read('src/components/ui/isle/Controls.tsx')
const panel = read('src/components/ui/isle/Panel.tsx')
const primitives = read('src/components/ui/isle/Primitives.tsx')
const dialog = read('src/components/ui/isle/Dialog.tsx')
const isleKit = read('src/components/ui/isle/IsleKit.tsx')
const appIcon = read('src/components/ui/AppIcon.tsx')
const providerSettings = read('src/components/providers/ProviderSettingsContent.tsx')
const activationProgressBanner = read('src/components/providers/ActivationProgressBanner.tsx')
const emptyState = read('src/components/ui/isle/EmptyState.tsx')
const globalCss = read('src/global.css')
const repoSource = collectRepoSource('app') + collectRepoSource('src')

check(
  'theme release gate status is green',
  releaseGate.ok,
  releaseGate.issues.join('; ') || 'theme release gate should pass package/file checks',
)
check(
  'glass tokens remain semantic and canonical',
  /family: 'glass'/.test(colors) && /semantic:\s*semanticUi\('glass'/.test(colors) && /DEFAULT_THEME_ID: ThemeId = 'minimal'/.test(colors),
  'glass should stay a semantic family and minimal should remain default',
)
check(
  'cartoon control tokens keep tactile depth restrained',
  /primaryShadowOpacity: dark \? 0\.12 : 0\.08/.test(colors)
    && /secondaryShadowOpacity: dark \? 0\.04 : 0\.025/.test(colors)
    && /shadowOpacity: dark \? 0\.06 : 0\.04/.test(colors),
  'cartoon controls should stay tactile without restoring the old heavy shadow stack',
)
check(
  'weak control states use semantic tokens instead of global opacity',
  /disabledForeground: string/.test(colors)
    && /placeholderForeground: string/.test(colors)
    && /disabledOpacity: number/.test(colors)
    && /disabledForeground: dark \? '#c8d0d5' : '#566872'/.test(colors)
    && /placeholderForeground: dark \? '#98a6b0' : '#72848d'/.test(colors)
    && /disabledOpacity: 1/.test(colors),
  'disabled and placeholder states should stay readable through semantic tokens, especially in glass light mode',
)
check(
  'legacy island normalization still survives in runtime settings',
  /if \(value === 'island'\) return 'cartoon'/.test(colors) && /normalizeThemeId\(rawSettings\.themeId\)/.test(settingsStore),
  'persisted island values must keep normalizing to cartoon',
)
check(
  'useAppTheme keeps family booleans for high-flow consumers',
  /isGlass: themeId === 'glass'/.test(themeHook) && /isCartoon: themeId === 'cartoon'/.test(themeHook) && /isMinimal: themeId === 'minimal'/.test(themeHook),
  'chat and settings surfaces branch on these booleans',
)
check(
  'preferences route still mounts the preference settings surface',
  /PreferenceSettingsContent/.test(preferencesRoute) && /settings\.preferences/.test(preferencesRoute),
  'the named preferences route should still resolve to the settings preference content shell',
)
check(
  'architecture audit records rn-fallback and chosen high-traffic chat flow',
  /Expo Router \+ React Native \+ TypeScript/.test(architectureAudit) && /main chat flow/.test(architectureAudit) && /rn-fallback/.test(architectureAudit) && /do not claim `glassEffect`/.test(architectureAudit),
  'the repo should carry a durable audit artifact for the native boundary and chosen flow',
)
check(
  'theme app actions and local commands recognize the three canonical families',
  /THEME_IDS: ThemeId\[\] = \['minimal', 'glass', 'cartoon'\]/.test(appActionPolicy) && /return 'glass'/.test(appCommandRouter) && /return 'cartoon'/.test(appCommandRouter),
  'local action and command routing should stay aligned with the canonical theme families',
)
check(
  'builtin tools keep the compatibility island input while exposing the new families',
  /enum: \['minimal', 'glass', 'cartoon', 'island'\]/.test(builtinToolRegistry) && /Legacy island requests map to cartoon/.test(builtinToolRegistry),
  'builtins should remain compatible with old island requests without reviving island as a runtime theme',
)
check(
  'chat workspace top chrome uses SwiftUI-like semantic glass surfaces',
  /semantic\.chrome\.toolbar/.test(chatWorkspace) && /actionBar\.itemBackground/.test(chatWorkspace) && /actionBar\.itemActiveBackground/.test(chatWorkspace) && /topChromeItemSurface = isGlass \? colors\.ui\.actionBar\.itemBackground : colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.muted/.test(chatWorkspace),
  'top toolbar and icon items should use semantic chrome + action bar tokens',
)
check(
  'chat quick panels and health banner use glass chrome containers',
  /panelChromeSurface = isGlass \? colors\.ui\.semantic\.chrome\.background/.test(chatWorkspace) && /backgroundColor: isGlass \? colors\.ui\.semantic\.chrome\.background/.test(chatWorkspace) && /\? colors\.ui\.actionBar\.itemBackground/.test(chatWorkspace) && /resolveChatChromeSurface[\s\S]*?colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.base/.test(chatWorkspace),
  'quick panels and health banner should avoid heavy card styling in glass mode',
)
check(
  'conversation search shell and floating controls use glass chrome shells',
  /searchShellBackground = isGlass \? colors\.ui\.semantic\.chrome\.background/.test(conversationsScreen) && /searchShellBorder = isGlass \? colors\.ui\.semantic\.chrome\.border/.test(conversationsScreen) && /floatingSecondarySurface = isGlass \? colors\.ui\.actionBar\.itemBackground/.test(conversationsScreen),
  'high-frequency conversation controls should use semantic chrome shells',
)
check(
  'conversation rows use glass chrome instead of standalone cards',
  /rowPanelMaterial = isGlass \? 'chrome' : 'paper'/.test(conversationRow) && /rowPanelBackground = isGlass \? \(active \? colors\.ui\.semantic\.surface\.overlay : colors\.ui\.semantic\.chrome\.background\).*?colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.base/.test(conversationRow),
  'conversation list rows should read like system chrome when glass is active',
)
check(
  'supporting Isle controls are glass-aware',
  /actionBar\.itemBackground/.test(chip) && /actionBar\.itemBorder/.test(chip) && /semantic\.surface\.overlay/.test(dialog),
  'chips and dialogs should share the same glass control language',
)
check(
  'cartoon icon roles preserve neutral utility affordances',
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
  'cartoon icon role coloring respects explicit contrast colors',
  /function isExplicitIconColor/.test(appIcon)
    && /requestedColor === colors\.text/.test(appIcon)
    && /requestedColor === colors\.textSecondary/.test(appIcon)
    && /requestedColor === colors\.textTertiary/.test(appIcon)
    && /requestedColor === colors\.ui\.tone\.success\.foreground/.test(appIcon)
    && /if \(isExplicitIconColor\(requestedColor, colors\)\) return requestedColor/.test(appIcon)
    && /name="search-check" color=\{colors\.textTertiary\}/.test(apiKeyPanel)
    && /name="reasoning" color=\{colors\.text\}/.test(contextPanel)
    && /name="spark" color=\{colors\.text\}/.test(preferenceSettings)
    && /name="shield" color=\{colors\.text\}/.test(mcpSettings)
    && /name="toggle-on" color=\{colors\.textSecondary\}/.test(read('src/components/settings/SkillSettingsContent.tsx')),
  'inactive or explicitly semantic icons should not be recolored by cartoon role defaults',
)
check(
  'AppIcon forwards caller fill for selected and stop states',
  /fill,\s*\n\s*style,/.test(appIcon)
    && /fill=\{fill \?\? 'none'\}/.test(appIcon)
    && /name="star"[\s\S]*fill=\{isDefault \? colors\.ui\.control\.primaryForeground : 'transparent'\}/.test(apiKeyPanel)
    && /name="stop"[\s\S]*fill=\{colors\.ui\.control\.primaryForeground\}/.test(chatWorkspace),
  'selected stars and stop controls should render filled icons instead of silently dropping fill props',
)
check(
  'IsleKit demo surfaces stay plain-content first',
  /const tableBackground = palette\.glass \? palette\.ui\.semantic\.chrome\.background : palette\.ui\.semantic\.surface\.base/.test(isleKit)
    && /const frameBackground = palette\.glass \? palette\.ui\.semantic\.chrome\.background : palette\.ui\.semantic\.surface\.base/.test(isleKit)
    && /const phoneSurface = palette\.glass \? palette\.ui\.semantic\.chrome\.background : palette\.ui\.semantic\.surface\.base/.test(isleKit)
    && /const titleShadowOpacity = palette\.cartoon \? \(palette\.isDark \? 0\.08 : 0\.05\) : 0/.test(isleKit),
  'table, time, phone, and title chrome should stay quieter than the primary content layer',
)
check(
  'web fallback still exposes glass and cartoon family selectors',
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
  /panelSurface = sheetMode \? sheetMaterial\.surface : isGlass \? colors\.ui\.semantic\.chrome\.background/.test(optionsPanel) && /panelChrome = sheetMode \? sheetMaterial\.chrome : isGlass \? colors\.ui\.semantic\.chrome\.toolbar/.test(optionsPanel) && /actionSurface = isGlass \? colors\.ui\.actionBar\.itemBackground/.test(optionsPanel) && /isCartoon \? colors\.ui\.semantic\.surface\.base/.test(optionsPanel),
  'popover/sheet chrome should keep sharing the same control language',
)
check(
  'chat composer uses semantic surfaces instead of cartoon default cards',
  /raisedSurface = colors\.ui\.glass \? colors\.ui\.semantic\.chrome\.background : colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.base/.test(composer) && /utilitySurface = colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground : colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.muted/.test(composer) && /chipSurface = colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground : colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.base/.test(composer),
  'composer shell, utility actions, and chips should not reintroduce cartoon default card fills',
)
check(
  'composer and shared controls keep weak states light but readable',
  /const composerShadowOpacity = colors\.ui\.cartoon/.test(composer)
    && /shadowRadius: focused \? 12 : 6/.test(composer)
    && /placeholderTextColor=\{colors\.ui\.input\.placeholderForeground\}/.test(composer)
    && /backgroundColor: canSend \? colors\.ui\.control\.primaryBackground : colors\.ui\.control\.disabledBackground/.test(composer)
    && /color=\{canSend \? colors\.ui\.control\.primaryForeground : colors\.ui\.control\.disabledForeground\}/.test(composer)
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
  /backgroundColor: disabled \? colors\.ui\.control\.disabledBackground : idleBackground/.test(read('src/components/chat/MessageBubble.tsx'))
    && /borderColor: disabled \? colors\.ui\.control\.disabledBorder : idleBorder/.test(read('src/components/chat/MessageBubble.tsx'))
    && !/opacity: disabled \? 0\.58 : 1/.test(read('src/components/chat/MessageBubble.tsx')),
  'locked action buttons should stay visible without turning the whole action row translucent',
)
check(
  'shared Isle primitives keep cartoon surfaces soft by default',
  /return colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.base : colors\.ui\.semantic\.surface\.base/.test(panel) && /colors\.ui\.cartoon\s*\?\s*colors\.ui\.semantic\.surface\.base/.test(chip) && /colors\.ui\.cartoon\s*\?\s*colors\.ui\.semantic\.surface\.base/.test(controls) && /colors\.ui\.cartoon\s*\?\s*colors\.ui\.semantic\.surface\.base/.test(primitives),
  'shared panels, chips, metrics, and list items should use semantic base/muted surfaces in cartoon mode',
)
check(
  'main pager shell keeps the transition wash light and surface-first',
  /backgroundIntensity=\{settingsTransitionActive \? 1\.04 : page === 'home' \? 0\.88 : 0\.96\}/.test(mainPagerShell) && /stopOpacity=\{0\.02\}/.test(mainPagerShell) && /stopOpacity=\{0\.14\}/.test(mainPagerShell),
  'pager chrome should stay lighter than a full scene wash',
)
check(
  'message content rich cards stay secondary to plain content',
  /richCardSurface: colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground : colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.muted : colors\.ui\.semantic\.surface\.muted/.test(messageContent) && /blockRaisedSurface: colors\.ui\.glass \? colors\.ui\.semantic\.chrome\.background : colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.base/.test(messageContent) && /fontSize: 10\.5/.test(messageContent),
  'rich blocks should read lighter than primary message text',
)
check(
  'message content secondary blocks use muted surfaces instead of default cards',
  /tableRowBackground = isUser \? 'transparent' : assistantSurfaces\.blockSurface/.test(messageContent) && /DataSummaryPanel/.test(messageContent) && /DiagramPreviewPanel/.test(messageContent),
  'tables, summaries, and diagrams should stay visually secondary',
)
check(
  'conversation search shell stays muted in non-glass modes',
  /searchShellBackground = isGlass \? colors\.ui\.semantic\.chrome\.background : colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.muted : colors\.ui\.semantic\.surface\.muted/.test(conversationsScreen),
  'search chrome should not reintroduce a heavy default card',
)
check(
  'api key settings surfaces stay on muted secondary layers',
  /backgroundColor: colors\.ui\.glass \? colors\.ui\.semantic\.chrome\.background : colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.muted : colors\.ui\.semantic\.surface\.muted/.test(apiKeyPanel) && /quietControlSurface\(colors, active\)[\s\S]*?colors\.ui\.semantic\.surface\.muted/.test(apiKeyPanel) && /backgroundColor: colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground : colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.muted : colors\.ui\.semantic\.surface\.muted/.test(apiKeyPanel),
  'provider configuration should avoid reverting to default card surfaces for secondary settings chrome',
)
check(
  'context assets and local capability cards stay visually secondary',
  /backgroundColor: colors\.ui\.glass \? colors\.ui\.semantic\.chrome\.background : colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.base : colors\.ui\.semantic\.surface\.base/.test(contextPanel) && /assetCardSurface\(colors, active \? colors\.ui\.control\.primaryBorder : colors\.ui\.tone\.warning\.border\)/.test(contextPanel) && /backgroundColor: colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground : colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.muted : colors\.ui\.semantic\.surface\.base/.test(contextPanel),
  'knowledge, memory, and local capability cards should keep muted surfaces with semantic borders',
)
check(
  'settings foldouts use semantic surfaces in cartoon mode',
  /return colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.base : isGlass \? colors\.ui\.semantic\.chrome\.background/.test(settingsStore + read('src/components/main/SettingsScreenContent.tsx')) && /backgroundColor: colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.muted : colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground/.test(read('src/components/main/SettingsScreenContent.tsx')),
  'settings foldout bodies, cards, and theme selectors should not fall back to cartoon card fills',
)
check(
  'provider settings chrome stays on semantic surfaces instead of heavy cards',
  /const chromeSurface = colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.base : colors\.ui\.glass \? colors\.ui\.semantic\.chrome\.background : colors\.ui\.semantic\.surface\.base/.test(providerSettings)
    && /const mutedSurface = colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.muted : colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground : colors\.ui\.semantic\.surface\.muted/.test(providerSettings)
    && /const raisedSurface = colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.base : colors\.ui\.glass \? colors\.ui\.semantic\.surface\.overlay : colors\.ui\.semantic\.surface\.base/.test(providerSettings)
    && /shadowOpacity: colors\.ui\.cartoon \? Math\.min\(colors\.ui\.card\.shadowOpacity, 0\.08\) : 0/.test(providerSettings),
  'provider management should keep chrome/material hierarchy without falling back to decorative cards',
)
check(
  'provider activation banners keep lightweight semantic chrome',
  /backgroundColor: colors\.ui\.glass \? colors\.ui\.semantic\.chrome\.background : colors\.ui\.cartoon \? colors\.ui\.semantic\.surface\.base : colors\.ui\.semantic\.surface\.base/.test(activationProgressBanner)
    && /shadowOpacity: colors\.ui\.cartoon \? Math\.min\(colors\.ui\.card\.shadowOpacity, 0\.05\) : 0/.test(activationProgressBanner),
  'activation progress chrome should stay readable and light across theme families',
)
check(
  'source reader skeleton and empty states stay on secondary surfaces',
  /const skeletonSurface = colors\.ui\.glass \? colors\.ui\.actionBar\.itemBackground : colors\.ui\.semantic\.surface\.muted/.test(sourceRoute)
    && /shadowOpacity: colors\.ui\.cartoon \? 0\.06 : 0/.test(emptyState),
  'loading and empty surfaces should remain quieter than live content',
)
check(
  'mcp settings server cards use restrained cartoon depth',
  /shadowOpacity: colors\.ui\.cartoon \? Math\.min\(colors\.ui\.card\.shadowOpacity, 0\.04\) : 0/.test(mcpSettings)
    && /shadowRadius: colors\.ui\.cartoon \? Math\.max\(2, colors\.ui\.card\.shadowRadius - 4\) : 0/.test(mcpSettings),
  'MCP management cards should keep clear grouping without reintroducing heavy card treatment',
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
