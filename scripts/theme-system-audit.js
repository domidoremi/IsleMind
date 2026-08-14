#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

function collectFiles(relativeDir) {
  const dir = path.join(root, relativeDir)
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name)
    if (entry.isDirectory()) return collectFiles(relativePath)
    return /\.(ts|tsx)$/.test(entry.name) ? [relativePath] : []
  })
}

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
}

const colors = read('src/theme/colors.ts')
const settingsAppearance = read('src/modules/settings/appearance.ts')
const typeSource = read('src/types/index.ts')
const hook = read('src/hooks/useAppTheme.ts')
const settingsStore = read('src/store/settingsStore.ts')
const css = read('src/global.css')
const layout = read('app/_layout.tsx')
const settingsScreen = read('src/components/main/SettingsScreenContent.tsx')
const mainPagerShell = read('src/components/main/MainPagerShell.tsx')
const conversationsScreen = read('src/components/main/ConversationsScreenContent.tsx')
const floatingChrome = read('src/components/chat/FloatingChrome.tsx')
const chatSetupWorkspace = read('src/components/chat/ChatSetupWorkspace.tsx')
const chatPersistentHeader = read('src/components/chat/ChatPersistentHeader.tsx')
const chatAiConfiguration = read('src/components/chat/ChatAiConfigurationSheet.tsx')
const chatOptionsPanel = read('src/components/chat/ChatOptionsPanel.tsx')
const chatEmptyState = read('src/components/chat/ChatEmptyState.tsx')
const chatActiveExperience = read('src/components/chat/theme-experiences/ChatActiveThemeExperience.tsx')
const chatSetupExperience = read('src/components/chat/theme-experiences/ChatSetupThemeExperience.tsx')
const chatEmptyExperience = read('src/components/chat/theme-experiences/ChatEmptyStateExperience.tsx')
const isleBackground = read('src/components/ui/isle/Background.tsx')
const themeMotion = read('src/theme/themeMotion.ts')
const motionFrame = read('src/components/ui/isle/ThemeMotion.tsx')
const dialog = read('src/components/ui/isle/Dialog.tsx')
const isleKit = read('src/components/ui/isle/IsleKit.tsx')
const settingsAndroidCollector = read('scripts/collect-settings-state-android.js')
const markdownLightCss = css.match(/:root\[data-theme-id='markdown'\]\[data-theme-mode='light'\],[\s\S]*?\n\}/)?.[0] ?? ''
const markdownDarkCss = css.match(/:root\[data-theme-id='markdown'\]\[data-theme-mode='dark'\],[\s\S]*?\n\}/)?.[0] ?? ''

function cssFallbackBlock(themeId, mode) {
  const marker = `:root[data-theme-id='${themeId}'][data-theme-mode='${mode}']`
  const start = css.lastIndexOf(marker)
  if (start < 0) return ''
  const end = css.indexOf('\n}', start)
  return end < 0 ? '' : css.slice(start, end + 2).toLowerCase()
}

function fallbackHas(block, variables) {
  return Object.entries(variables).every(([name, value]) => block.includes(`${name}: ${value};`))
}

check('runtime ThemeId excludes legacy island', !/export type ThemeId = .*island/.test(typeSource), 'island must stay a compatibility input, not a runtime family')
check('palettes cover minimal lime-road markdown', /minimal:\s*{\s*light:\s*minimalLight,\s*dark:\s*minimalDark/.test(colors) && /markdown:\s*{\s*light:\s*markdownLight,\s*dark:\s*markdownDark/.test(colors) && /['\"]lime-road['\"]:\s*{\s*light:\s*limeRoadLight,\s*dark:\s*limeRoadDark/.test(colors), 'themePalettes must have light/dark coverage for all families')
check('semantic token layer is present', /semantic:\s*{/.test(colors) && /surface:\s*{/.test(colors) && /content:\s*{/.test(colors) && /chrome:\s*{/.test(colors) && /control:\s*{/.test(colors) && /feedback:\s*{/.test(colors), 'ThemeUiTokens needs surface/content/chrome/control/feedback layers')
check('each ui builder declares the correct family', /family: 'minimal'/.test(colors) && /family: 'markdown'/.test(colors) && /family: 'lime-road'/.test(colors), 'minimalUi/markdownUi/limeRoadUi should be explicit')
check('theme families declare distinct experience grammars', /layout: 'editorial'[\s\S]*?navigation: 'route'[\s\S]*?background: 'road'[\s\S]*?transition: 'travel'[\s\S]*?density: 'airy'/.test(colors) && /layout: 'quiet'[\s\S]*?navigation: 'quiet'[\s\S]*?background: 'plain'[\s\S]*?transition: 'fade'[\s\S]*?density: 'balanced'/.test(colors) && /layout: 'document'[\s\S]*?navigation: 'document'[\s\S]*?background: 'document'[\s\S]*?transition: 'cut'[\s\S]*?density: 'compact'/.test(colors), 'themes must own layout, navigation, background, transition, and density rather than differ only by color tokens')
check('presentation consumes experience grammar', /colors\.ui\.experience\.background/.test(mainPagerShell) && /colors\.ui\.experience\.background/.test(isleBackground) && !/MainPagerExperience|ThemeNavigationDrawer|AppTopBar|shellNavigation/.test(mainPagerShell) && /common\.backToChat/.test(conversationsScreen) && /common\.backToChat/.test(settingsScreen) && /ChatPersistentHeader/.test(floatingChrome) && /ChatPersistentHeader/.test(chatSetupWorkspace) && /ChatChromeThemeSurface/.test(chatPersistentHeader) && /ChatAiConfigurationSheet/.test(floatingChrome) && /chat-ai-configuration-panel/.test(chatAiConfiguration) && /chat-ai-provider-connection-section/.test(chatOptionsPanel) && /chat-ai-model-selection-section/.test(chatOptionsPanel) && /chat-ai-reasoning-section/.test(chatOptionsPanel) && /function ThemeFamilyPreview/.test(settingsScreen) && /getColors\(mode, themeId/.test(settingsScreen) && /ChatActiveThemeExperience/.test(chatActiveExperience) && /ChatSetupThemeExperience/.test(chatSetupExperience) && /ChatEmptyStateExperience/.test(chatEmptyState + chatEmptyExperience) && /road-cinema/.test(themeMotion), 'page-owned navigation, shared persistent Chat controls, selector previews, Chat AI configuration, and semantic backgrounds should visibly project the selected experience without page entrance motion')
check('markdown is semantic fallback only in RN source', !/glassEffect|GlassEffectContainer|glassEffectID|glassProminent/.test(colors + layout + settingsScreen), 'native Liquid Glass APIs should not be faked in RN/Expo source')
check('markdown theme is marked as markdown and non-lime-road', /family: 'markdown'[\s\S]*?markdown: true[\s\S]*?limeRoad: false/.test(colors), 'markdown should not inherit lime-road styling behavior')
check('lime-road theme follows editorial UI radius baseline', /family: 'lime-road'[\s\S]*?limeRoad: true[\s\S]*?ornamented: true/.test(colors) && /controlMiddle: 8/.test(colors), 'lime-road should keep its family identity while sharing the 8px control/container radius baseline')
check('minimal remains default and plain', /DEFAULT_THEME_ID: ThemeId = 'minimal'/.test(colors) && /family: 'minimal'[\s\S]*?ambient: 'plain'/.test(colors), 'minimal should be the default content-first theme')
check('settings owns legacy family normalization', /if \(value === 'cartoon' \|\| value === 'island'\) return 'lime-road'/.test(settingsAppearance) && /if \(value === 'glass'\) return 'markdown'/.test(settingsAppearance) && /normalizeSettingsThemeFamily\(value\) \?\? DEFAULT_THEME_ID/.test(colors), 'theme resolution should consume the Settings public policy instead of duplicating compatibility aliases')
check('settings migration persists normalized legacy ids', /normalizeThemeId\(rawSettings\.themeId\)/.test(settingsStore) && /themeIdMigrated/.test(settingsStore), 'legacy persisted island should be rewritten after load')
check('theme mode input fails closed before palette projection', /normalizeSettingsThemeMode/.test(settingsAppearance) && /normalizeSettingsThemeMode\(rawSettings\.theme\)/.test(settingsStore) && /themeModeMigrated/.test(settingsStore) && /normalizeSettingsThemeMode\(theme\)/.test(colors), 'persisted or bypassed invalid modes must resolve to the safe system mode')
check('live family writes normalize before persistence', /normalizeSettingsThemeFamily\(updates\.themeId\) \?\? state\.settings\.themeId/.test(settingsStore), 'unchecked runtime family writes must preserve the current valid family or normalize compatibility aliases before persistence')
check('settings screen uses canonical theme options only', /THEME_FAMILY_OPTIONS[\s\S]*id: 'minimal'[\s\S]*id: 'lime-road'[\s\S]*id: 'markdown'/.test(settingsScreen) && !/id: 'cartoon'/.test(settingsScreen) && !/id: 'island'/.test(settingsScreen), 'users should not see legacy cartoon/island as selectable families')
check('appearance selectors expose rendered radio semantics', /function ThemeFamilyCard[\s\S]*?accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ checked: active \}\}[\s\S]*?aria-checked=\{active\}/.test(settingsScreen) && /function ThemeModeCard[\s\S]*?accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ checked: active \}\}[\s\S]*?aria-checked=\{active\}/.test(settingsScreen) && /function ThemeAccentSwatch[\s\S]*?accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ checked: active \}\}[\s\S]*?aria-checked=\{active\}/.test(settingsScreen), 'mutually exclusive family, day/night, and accent controls need checked state in both native and rendered web accessibility APIs')
check('custom accent retains one checked radio option', /activeCustomThemeAccent/.test(settingsScreen) && /settings-theme-accent-custom/.test(settingsScreen), 'a non-preset accent must have an explicit selected radio control')
check('appearance mode uses one checked radio choice', /\['light', 'dark', 'system'\] satisfies ThemeMode\[\]/.test(settingsScreen) && /active=\{settings\.theme === item\}/.test(settingsScreen) && !/settings\.theme === 'system' && resolvedThemeMode === item/.test(settingsScreen), 'Light, Dark, and System must share a single radio selection instead of reporting the resolved mode alongside System')
check('appearance choices expose radio groups', (settingsScreen.match(/accessibilityRole="radiogroup"/g) ?? []).length >= 3, 'family, mode, and accent choices should be grouped for assistive technology')
check('appearance layout has compact-width protections', /const actionCompact = width < 360/.test(settingsScreen) && /flexDirection: actionCompact \? 'column' : 'row'/.test(settingsScreen) && /flexWrap: 'wrap'/.test(settingsScreen) && /flexBasis: compact \? '100%' : '47%'/.test(settingsScreen) && /minWidth: 62/.test(settingsScreen), '320px/360px layouts need stacked custom actions, full-width theme previews, and wrapping selector rows')
check('web bridge exposes semantic token slices', /colors\.ui\.semantic\.surface\.base/.test(layout) && /colors\.ui\.semantic\.content\.primary/.test(layout) && /colors\.ui\.semantic\.chrome\.background/.test(layout) && /colors\.ui\.semantic\.control\.background/.test(layout) && /data-theme-markdown/.test(layout), 'web bridge must map semantic layers')
check('CSS has markdown fallback selectors and flags', /data-theme-id='markdown'\]\[data-theme-mode='light'\]/.test(css) && /data-theme-id='markdown'\]\[data-theme-mode='dark'\]/.test(css) && /--theme-markdown-enabled: 1/.test(css), 'pre-native web fallback needs visible markdown family markers')
check('markdown fallbacks use opaque document surfaces', /--color-surfaceSecondary: #ffffff/.test(markdownLightCss) && /--color-semanticChromeBackground: #ffffff/.test(markdownLightCss) && /--theme-shadow-opacity: 0/.test(markdownLightCss) && /--color-surfaceSecondary: #161b22/.test(markdownDarkCss) && /--color-semanticChromeBackground: #161b22/.test(markdownDarkCss) && /--theme-shadow-opacity: 0/.test(markdownDarkCss), 'Markdown should not regress to translucent Glass surfaces or decorative shadows')
check('CSS exposes lime-road and aliases legacy cartoon/island', /data-theme-id='lime-road'\]\[data-theme-mode='light'\]/.test(css) && /data-theme-id='lime-road'\]\[data-theme-mode='dark'\]/.test(css) && /data-theme-id='cartoon'\]\[data-theme-mode='light'\],\s*:root\[data-theme-id='island'\]\[data-theme-mode='light'\]/.test(css) && /data-theme-id='cartoon'\]\[data-theme-mode='dark'\],\s*:root\[data-theme-id='island'\]\[data-theme-mode='dark'\]/.test(css), 'legacy CSS selectors should resolve to the lime-road family without defining a separate visual palette')
const criticalFallbacks = [
  ['minimal light', cssFallbackBlock('minimal', 'light'), { '--color-primary': '#234f46', '--color-controlprimarybackground': '#234f46', '--color-iconaccentbackground': '#dcebe6', '--color-iconaccentforeground': '#173a34' }],
  ['minimal dark', cssFallbackBlock('minimal', 'dark'), { '--color-primary': '#9fd8ca', '--color-controlprimarybackground': '#d7f0e8', '--color-iconaccentbackground': '#1f2a2d', '--color-iconaccentforeground': '#d7f0e8' }],
  ['lime-road light', cssFallbackBlock('lime-road', 'light'), { '--color-primary': '#0d6ac4', '--color-controlprimarybackground': '#0d6ac4', '--color-iconaccentbackground': '#ddf2f5', '--color-iconaccentforeground': '#276b7d' }],
  ['lime-road dark', cssFallbackBlock('lime-road', 'dark'), { '--color-primary': '#5db8d1', '--color-controlprimarybackground': '#5db8d1', '--color-iconaccentbackground': '#193c50', '--color-iconaccentforeground': '#9ed7e5' }],
  ['markdown light', cssFallbackBlock('markdown', 'light'), { '--color-primary': '#315a73', '--color-controlprimarybackground': '#315a73', '--color-iconaccentbackground': '#ddf4ff', '--color-iconaccentforeground': '#0550ae' }],
  ['markdown dark', cssFallbackBlock('markdown', 'dark'), { '--color-primary': '#58a6ff', '--color-controlprimarybackground': '#58a6ff', '--color-iconaccentbackground': '#1f2d3d', '--color-iconaccentforeground': '#79c0ff' }],
]
for (const [label, block, variables] of criticalFallbacks) {
  check(`${label} CSS fallback matches runtime tokens`, fallbackHas(block, variables), 'pre-hydration web fallbacks must agree with the canonical palette for primary, control, and icon tokens')
}
check('hook exposes canonical booleans', /isMarkdown: themeId === 'markdown'/.test(hook) && /isLimeRoad: themeId === 'lime-road'/.test(hook) && /isGlass: false as const/.test(hook) && !/isCartoon/.test(hook) && !/isIsland/.test(hook), 'components should expose only canonical runtime families')
check('custom accent is normalized before persistence and projection', /normalizeSettingsThemeAccent\(rawSettings\.themeAccent\)/.test(settingsStore) && /normalizeThemeAccent\(themeAccent\)/.test(colors) && /data-theme-custom-accent/.test(layout), 'custom accent input must be validated before reaching native or web styles')
check('native Appearance evidence retains the representative matrix', ['appearance-minimal-light', 'appearance-lime-road-dark', 'appearance-markdown-light', 'appearance-markdown-dark-custom-indigo'].every((step) => settingsAndroidCollector.includes(step)) && /custom: '#4455B7'/.test(settingsAndroidCollector), 'Android evidence must cover every family, both fixed modes, and the exact custom accent')
check('native Appearance evidence fails closed and restores defaults', /collectThemeLocaleContractIssues/.test(settingsAndroidCollector) && /Could not verify restored Minimalist\/System\/default-accent\/Simplified-Chinese appearance settings/.test(settingsAndroidCollector), 'Android evidence must reject incomplete rows and prove cleanup after custom appearance capture')
check('dialog close controls meet the 44dp target', /width: 44, height: 44, minHeight: 44/.test(dialog) && /width: 44, height: 44/.test(isleKit), 'app-owned dialog close controls must preserve a 44dp hit target')

const forbiddenRuntimeIsland = [
  'src/types/index.ts',
  'src/hooks/useAppTheme.ts',
  'src/components/main/SettingsScreenContent.tsx',
].filter((file) => /\bisland\b/.test(read(file)))
check('no runtime island references in core typed/theme UI files', forbiddenRuntimeIsland.length === 0, `unexpected island references: ${forbiddenRuntimeIsland.join(', ')}`)

const legacyCartoonPresentationConsumers = collectFiles('src/components').filter((file) => /colors\.ui\.cartoon|\bisCartoon\b|palette\.cartoon/.test(read(file)))
check('production presentation uses lime-road flags', legacyCartoonPresentationConsumers.length === 0, `legacy cartoon presentation branches: ${legacyCartoonPresentationConsumers.join(', ')}`)

const failures = checks.filter((item) => !item.ok)
for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`)
  if (!item.ok) console.log(`  ${item.detail}`)
}

if (failures.length) {
  console.error(`theme system audit failed: ${failures.length} issue(s)`)
  process.exit(1)
}

console.log(`theme system audit passed: ${checks.length} checks`)
