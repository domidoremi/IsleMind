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
const settingsContracts = read('src/types/settingsContracts.ts')
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

check('runtime ThemeId exposes canonical families', /export type CanonicalThemeId = 'minimal' \| 'monet' \| 'material' \| 'liquid-glass'/.test(settingsContracts) && /CanonicalThemeId/.test(typeSource), 'legacy values must stay compatibility inputs, not runtime families')
check('palettes cover all four canonical families', /minimal:\s*{[\s\S]*?light:\s*projectDesignPalette\(minimalLight, 'minimal', 'light'\)[\s\S]*?dark:\s*projectDesignPalette\(minimalDark, 'minimal', 'dark'\)/.test(colors) && /monet:\s*{[\s\S]*?projectDesignPalette\(limeRoadLight, 'monet', 'light'\)/.test(colors) && /material:\s*{[\s\S]*?projectDesignPalette\(markdownLight, 'material', 'light'\)/.test(colors) && /'liquid-glass':\s*{[\s\S]*?projectDesignPalette\(minimalLight, 'liquid-glass', 'light'\)/.test(colors), 'themePalettes must have light/dark coverage for every canonical family')
check('semantic token layer is present', /semantic:\s*{/.test(colors) && /surface:\s*{/.test(colors) && /content:\s*{/.test(colors) && /chrome:\s*{/.test(colors) && /control:\s*{/.test(colors) && /feedback:\s*{/.test(colors), 'ThemeUiTokens needs surface/content/chrome/control/feedback layers')
check('canonical token registry declares four distinct experience grammars', /layout: 'quiet'[\s\S]*?navigation: 'quiet'[\s\S]*?background: 'plain'[\s\S]*?transition: 'fade'/.test(colors) && /layout: 'editorial'[\s\S]*?navigation: 'route'[\s\S]*?background: 'road'[\s\S]*?transition: 'travel'/.test(colors) && /layout: 'structured'[\s\S]*?navigation: 'material'[\s\S]*?background: 'tonal'[\s\S]*?transition: 'shared-axis'/.test(colors) && /layout: 'layered'[\s\S]*?navigation: 'glass'[\s\S]*?background: 'glass'[\s\S]*?transition: 'fluid'/.test(colors), 'themes must own layout, navigation, background, transition, and density rather than differ only by color tokens')
check('presentation consumes experience grammar', /colors\.ui\.experience\.background/.test(mainPagerShell) && /colors\.ui\.experience\.background/.test(isleBackground) && !/MainPagerExperience|ThemeNavigationDrawer|AppTopBar|shellNavigation/.test(mainPagerShell) && /common\.backToChat/.test(conversationsScreen) && /common\.backToChat/.test(settingsScreen) && /ChatPersistentHeader/.test(floatingChrome) && /ChatPersistentHeader/.test(chatSetupWorkspace) && /ChatChromeThemeSurface/.test(chatPersistentHeader) && /ChatAiConfigurationSheet/.test(floatingChrome) && /chat-ai-configuration-panel/.test(chatAiConfiguration) && /chat-ai-provider-connection-section/.test(chatOptionsPanel) && /chat-ai-model-selection-section/.test(chatOptionsPanel) && /chat-ai-reasoning-section/.test(chatOptionsPanel) && /function ThemeFamilyPreview/.test(settingsScreen) && /getColors\(mode, themeId/.test(settingsScreen) && /ChatActiveThemeExperience/.test(chatActiveExperience) && /ChatSetupThemeExperience/.test(chatSetupExperience) && /ChatEmptyStateExperience/.test(chatEmptyState + chatEmptyExperience) && /monet-breathe|material-shared-axis|glass-refraction/.test(themeMotion), 'page-owned navigation, shared persistent Chat controls, selector previews, Chat AI configuration, and semantic backgrounds should visibly project the selected experience without page entrance motion')
check('Liquid Glass is semantic fallback only in RN source', !/glassEffect|GlassEffectContainer|glassEffectID|glassProminent/.test(colors + layout + settingsScreen), 'native Liquid Glass APIs should not be faked in RN/Expo source')
check('canonical families project explicit behavior flags', /canonicalFamily: family/.test(colors) && /monet,\s*material,\s*liquidGlass/.test(colors) && /contentLayerGlass: false/.test(read('src/theme/themeTokens.ts')), 'canonical family identity must remain available without restoring legacy branches')
check('minimal remains default and plain', /DEFAULT_THEME_ID: CanonicalThemeId = 'minimal'/.test(colors) && /minimal \? 'plain'/.test(colors), 'minimal should be the default content-first theme')
check('settings owns legacy family normalization', /value === 'lime-road' \|\| value === 'cartoon' \|\| value === 'island'\) return 'monet'/.test(settingsAppearance) && /value === 'markdown' \|\| value === 'material-3' \|\| value === 'material3'\) return 'material'/.test(settingsAppearance) && /value === 'glass' \|\| value === 'liquid'\) return 'liquid-glass'/.test(settingsAppearance) && /normalizeSettingsThemeFamily\(value\) \?\? DEFAULT_THEME_ID/.test(colors), 'theme resolution should consume the Settings public policy instead of duplicating compatibility aliases')
check('settings migration persists normalized legacy ids', /normalizeThemeId\(rawSettings\.themeId\)/.test(settingsStore) && /themeIdMigrated/.test(settingsStore), 'legacy persisted island should be rewritten after load')
check('theme mode input fails closed before palette projection', /normalizeSettingsThemeMode/.test(settingsAppearance) && /normalizeSettingsThemeMode\(rawSettings\.theme\)/.test(settingsStore) && /themeModeMigrated/.test(settingsStore) && /normalizeSettingsThemeMode\(theme\)/.test(colors), 'persisted or bypassed invalid modes must resolve to the safe system mode')
check('live family writes normalize before persistence', /normalizeSettingsThemeFamily\(updates\.themeId\) \?\? state\.settings\.themeId/.test(settingsStore), 'unchecked runtime family writes must preserve the current valid family or normalize compatibility aliases before persistence')
check('settings screen uses canonical theme options only', /THEME_FAMILY_OPTIONS[\s\S]*id: 'minimal'[\s\S]*id: 'monet'[\s\S]*id: 'material'[\s\S]*id: 'liquid-glass'/.test(settingsScreen) && !/id: 'cartoon'/.test(settingsScreen) && !/id: 'island'/.test(settingsScreen), 'users should not see legacy aliases as selectable families')
check('appearance selectors expose rendered radio semantics', /function ThemeFamilyCard[\s\S]*?accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ checked: active \}\}[\s\S]*?aria-checked=\{active\}/.test(settingsScreen) && /function ThemeModeCard[\s\S]*?accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ checked: active \}\}[\s\S]*?aria-checked=\{active\}/.test(settingsScreen) && /function ThemeAccentSwatch[\s\S]*?accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ checked: active \}\}[\s\S]*?aria-checked=\{active\}/.test(settingsScreen), 'mutually exclusive family, day/night, and accent controls need checked state in both native and rendered web accessibility APIs')
check('custom accent retains one checked radio option', /activeCustomThemeAccent/.test(settingsScreen) && /settings-theme-accent-custom/.test(settingsScreen), 'a non-preset accent must have an explicit selected radio control')
check('appearance mode uses one checked radio choice', /\['light', 'dark', 'system'\] satisfies ThemeMode\[\]/.test(settingsScreen) && /active=\{settings\.theme === item\}/.test(settingsScreen) && !/settings\.theme === 'system' && resolvedThemeMode === item/.test(settingsScreen), 'Light, Dark, and System must share a single radio selection instead of reporting the resolved mode alongside System')
check('appearance choices expose radio groups', (settingsScreen.match(/accessibilityRole="radiogroup"/g) ?? []).length >= 3, 'family, mode, and accent choices should be grouped for assistive technology')
check('appearance layout has compact-width protections', /const actionCompact = width < 360/.test(settingsScreen) && /flexDirection: actionCompact \? 'column' : 'row'/.test(settingsScreen) && /flexWrap: 'wrap'/.test(settingsScreen) && /flexBasis: compact \? '100%' : '47%'/.test(settingsScreen) && /minWidth: 62/.test(settingsScreen), '320px/360px layouts need stacked custom actions, full-width theme previews, and wrapping selector rows')
check('web bridge exposes semantic token slices', /colors\.ui\.semantic\.surface\.base/.test(layout) && /colors\.ui\.semantic\.content\.primary/.test(layout) && /colors\.ui\.semantic\.chrome\.background/.test(layout) && /colors\.ui\.semantic\.control\.background/.test(layout) && /data-theme-liquid-glass/.test(layout), 'web bridge must map semantic layers')
check('CSS has canonical fallback selectors and flags', ['minimal', 'monet', 'material', 'liquid-glass'].every((family) => css.includes(`data-theme-id='${family}'`)) && /--theme-family: liquid-glass/.test(css), 'pre-native web fallback needs visible canonical family markers')
check('markdown fallbacks use opaque document surfaces', /--color-surfaceSecondary: #ffffff/.test(markdownLightCss) && /--color-semanticChromeBackground: #ffffff/.test(markdownLightCss) && /--theme-shadow-opacity: 0/.test(markdownLightCss) && /--color-surfaceSecondary: #161b22/.test(markdownDarkCss) && /--color-semanticChromeBackground: #161b22/.test(markdownDarkCss) && /--theme-shadow-opacity: 0/.test(markdownDarkCss), 'Markdown should not regress to translucent Glass surfaces or decorative shadows')
check('CSS keeps legacy aliases without separate theme definitions', /data-theme-id='cartoon'/.test(css) && /data-theme-id='island'/.test(css) && /data-theme-id='glass'/.test(css), 'legacy CSS selectors should resolve to canonical families without defining new palettes')
const criticalFallbacks = [
  ['minimal light', cssFallbackBlock('minimal', 'light'), { '--color-primary': '#1f5b50', '--color-controlprimarybackground': '#1f5b50', '--color-iconaccentbackground': '#d4ede5', '--color-iconaccentforeground': '#10352e' }],
  ['minimal dark', cssFallbackBlock('minimal', 'dark'), { '--color-primary': '#a8dccb', '--color-controlprimarybackground': '#a8dccb', '--color-iconaccentbackground': '#174a3e', '--color-iconaccentforeground': '#c8f3e5' }],
  ['monet light', cssFallbackBlock('monet', 'light'), { '--color-primary': '#2f6e68', '--color-controlprimarybackground': '#2f6e68', '--color-iconaccentbackground': '#cfe8df', '--color-iconaccentforeground': '#153d3a' }],
  ['monet dark', cssFallbackBlock('monet', 'dark'), { '--color-primary': '#9dd6c8', '--color-controlprimarybackground': '#9dd6c8', '--color-iconaccentbackground': '#28564a', '--color-iconaccentforeground': '#c6efe2' }],
  ['material light', cssFallbackBlock('material', 'light'), { '--color-primary': '#365f86', '--color-controlprimarybackground': '#365f86', '--color-iconaccentbackground': '#d8e7f5', '--color-iconaccentforeground': '#17324a' }],
  ['material dark', cssFallbackBlock('material', 'dark'), { '--color-primary': '#a6c8ea', '--color-controlprimarybackground': '#a6c8ea', '--color-iconaccentbackground': '#234b6d', '--color-iconaccentforeground': '#d3e7fa' }],
  ['liquid-glass light', cssFallbackBlock('liquid-glass', 'light'), { '--color-primary': '#155e87', '--color-controlprimarybackground': '#155e87', '--color-iconaccentbackground': 'rgba(139, 205, 237, 0.56)', '--color-iconaccentforeground': '#0a3047' }],
  ['liquid-glass dark', cssFallbackBlock('liquid-glass', 'dark'), { '--color-primary': '#8ed0f0', '--color-controlprimarybackground': '#8ed0f0', '--color-iconaccentbackground': 'rgba(55, 113, 145, 0.72)', '--color-iconaccentforeground': '#d7f1ff' }],
]
for (const [label, block, variables] of criticalFallbacks) {
  check(`${label} CSS fallback matches runtime tokens`, fallbackHas(block, variables), 'pre-hydration web fallbacks must agree with the canonical palette for primary, control, and icon tokens')
}
check('hook exposes canonical booleans', /isMinimal: canonicalThemeId === 'minimal'/.test(hook) && /isMonet: canonicalThemeId === 'monet'/.test(hook) && /isMaterial: canonicalThemeId === 'material'/.test(hook) && /isLiquidGlass: canonicalThemeId === 'liquid-glass'/.test(hook), 'components should expose only canonical runtime families')
check('theme hook subscribes only to theme fields', !/useSettingsStore\(\(state\) => state\.settings\)/.test(hook) && /state\.settings\.theme\)/.test(hook) && /state\.settings\.themeId\)/.test(hook) && /state\.settings\.themeAccent\)/.test(hook), 'unrelated settings changes must not rerender every theme consumer')
check('custom accent is normalized before persistence and projection', /normalizeSettingsThemeAccent\(rawSettings\.themeAccent\)/.test(settingsStore) && /normalizeThemeAccent\(themeAccent\)/.test(colors) && /data-theme-custom-accent/.test(layout), 'custom accent input must be validated before reaching native or web styles')
check('native Appearance evidence retains the complete canonical matrix', ['appearance-minimal-light', 'appearance-minimal-dark', 'appearance-monet-light', 'appearance-monet-dark', 'appearance-material-light', 'appearance-material-dark', 'appearance-liquid-glass-light', 'appearance-liquid-glass-dark-custom-indigo'].every((step) => settingsAndroidCollector.includes(step)) && /custom: '#4455B7'/.test(settingsAndroidCollector), 'Android evidence must cover every canonical family, both fixed modes, and the exact custom accent')
check('native Appearance evidence fails closed and restores defaults', /collectThemeLocaleContractIssues/.test(settingsAndroidCollector) && /Could not verify restored Minimalist\/System\/default-accent\/Simplified-Chinese appearance settings/.test(settingsAndroidCollector), 'Android evidence must reject incomplete rows and prove cleanup after custom appearance capture')
check('dialog close controls meet the 44dp target', /width: 44, height: 44, minHeight: 44/.test(dialog) && /width: 44, height: 44/.test(isleKit), 'app-owned dialog close controls must preserve a 44dp hit target')
check('dialog themes preserve alert semantics and one action order', /function LimeRoadDialogSurface[\s\S]*?accessibilityRole="alert"/.test(dialog) && /function MinimalDialogSurface[\s\S]*?dialog\.cancelLabel[\s\S]*?dialog\.confirmLabel/.test(dialog) && /function LimeRoadDialogSurface[\s\S]*?dialog\.cancelLabel[\s\S]*?dialog\.confirmLabel/.test(dialog) && /function MarkdownDialogSurface[\s\S]*?dialog\.cancelLabel[\s\S]*?dialog\.confirmLabel/.test(dialog), 'theme selection must not change dialog announcement or destructive-action muscle memory')

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
