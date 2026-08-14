#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
}

const settingsTypeSource = read('src/types/settingsContracts.ts')
const colorsSource = read('src/theme/colors.ts')
const settingsAppearance = read('src/modules/settings/appearance.ts')
const settingsStore = read('src/store/settingsStore.ts')
const themeHook = read('src/hooks/useAppTheme.ts')
const settingsScreen = read('src/components/main/SettingsScreenContent.tsx')
const layout = read('app/_layout.tsx')
const css = read('src/global.css')
const settingsActionContracts = read('src/modules/settings/contracts.ts')
const builtinTools = read('src/modules/integrations/conversationToolCatalog.ts')
const agentTools = read('src/modules/integrations/conversationToolCatalog.ts')
const localeFiles = ['en', 'zh-CN', 'ja'].map((locale) => ({
  locale,
  json: JSON.parse(read(`src/i18n/resources/${locale}.json`)),
}))

check(
  'ThemeId union exposes minimal/lime-road/markdown',
  /export type ThemeId = 'minimal' \| 'lime-road' \| 'markdown'/.test(settingsTypeSource),
  'the direct settings contract should not expose island as a runtime ThemeId',
)
check('default theme is minimal', /export const DEFAULT_THEME_ID: ThemeId = 'minimal'/.test(colorsSource) && /themeId: 'minimal'/.test(settingsStore), 'colors and settings defaults must both be minimal')
check('themeIds contains exactly minimal/lime-road/markdown', /themeIds = \['minimal', 'lime-road', 'markdown'\]/.test(colorsSource), 'themeIds drives settings UI and audits')
check('legacy ids normalize to canonical families', /if \(value === 'cartoon' \|\| value === 'island'\) return 'lime-road'/.test(settingsAppearance) && /if \(value === 'glass'\) return 'markdown'/.test(settingsAppearance) && /normalizeSettingsThemeFamily\(value\) \?\? DEFAULT_THEME_ID/.test(colorsSource) && /normalizeThemeId\(rawSettings\.themeId\)/.test(settingsStore), 'persisted cartoon/island/glass settings must migrate through the Settings-owned policy')
check('theme mode normalization fails closed', /normalizeSettingsThemeMode/.test(settingsAppearance) && /normalizeSettingsThemeMode\(rawSettings\.theme\)/.test(settingsStore) && /normalizeSettingsThemeMode\(theme\)/.test(colorsSource), 'invalid persisted modes must not index an undefined palette')
check('useAppTheme exposes family booleans', /isMinimal: themeId === 'minimal'/.test(themeHook) && /isMarkdown: themeId === 'markdown'/.test(themeHook) && /isLimeRoad: themeId === 'lime-road'/.test(themeHook), 'hook consumers need explicit booleans')
check('settings UI offers three theme families', /id: 'minimal'/.test(settingsScreen) && /id: 'lime-road'/.test(settingsScreen) && /id: 'markdown'/.test(settingsScreen), 'preferences must allow minimal/lime-road/markdown')
check('appearance cards expose rendered radio semantics and compact layout', /function ThemeFamilyCard[\s\S]*?accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ checked: active \}\}[\s\S]*?aria-checked=\{active\}/.test(settingsScreen) && /function ThemeModeCard[\s\S]*?accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ checked: active \}\}[\s\S]*?aria-checked=\{active\}/.test(settingsScreen) && /function ThemeAccentSwatch[\s\S]*?accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ checked: active \}\}[\s\S]*?aria-checked=\{active\}/.test(settingsScreen) && /const actionCompact = width < 360/.test(settingsScreen) && /flexDirection: actionCompact \? 'column' : 'row'/.test(settingsScreen), 'appearance controls must expose checked state to both React Native accessibility and rendered web ARIA')
check('custom accent remains a checked radio choice', /activeCustomThemeAccent/.test(settingsScreen) && /settings-theme-accent-custom/.test(settingsScreen) && /disabled=\{!activeCustomThemeAccent && !normalizedThemeAccentDraft\}/.test(settingsScreen), 'a custom hexadecimal accent must not leave the accent radio group without a selected option')
check('app action policy accepts canonical theme ids', /SETTINGS_THEME_FAMILIES = \['minimal', 'lime-road', 'markdown'\] as const/.test(settingsActionContracts), 'assistant actions should use the canonical runtime ids')
check('tool schemas expose canonical and compatibility family inputs', /enum: \['minimal', 'lime-road', 'markdown', 'cartoon', 'glass', 'island'\]/.test(builtinTools) && /enum: \['minimal', 'lime-road', 'markdown', 'cartoon', 'glass', 'island'\]/.test(agentTools), 'assistant/builtin tools may accept old ids but runtime normalizes them')
check('custom accent tool is shared across action catalogs', /name: 'set_theme_accent'/.test(builtinTools) && /name: 'set_theme_accent'/.test(agentTools), 'assistant and Agent settings actions should expose one accent mutation')
check('web bridge writes theme attributes', /data-theme-family/.test(layout) && /data-theme-markdown/.test(layout) && /data-theme-lime-road/.test(layout) && /data-theme-custom-accent/.test(layout), 'web runtime should expose theme family and custom-accent flags')
check('web bridge writes semantic variables', /--color-semanticSurfaceBase/.test(layout) && /--color-semanticChromeBackground/.test(layout) && /--color-semanticControlBackground/.test(layout), 'web bridge should carry semantic tokens')
check('global CSS has all theme fallback selectors', /data-theme-id='minimal'/.test(css) && /data-theme-id='markdown'/.test(css) && /data-theme-id='lime-road'/.test(css), 'web fallback selectors must cover all theme families')
check('global CSS keeps cartoon/island only as compatibility selectors', /data-theme-id='island'/.test(css) && /data-theme-id='lime-road'\]\[data-theme-mode='light'\],\s*:root\[data-theme-id='cartoon'\]\[data-theme-mode='light'\],\s*:root\[data-theme-id='island'\]/.test(css), 'cartoon/island selectors should alias lime-road fallback')
check('global CSS declares theme family flags', /--theme-family: minimal/.test(css) && /--theme-family: markdown/.test(css) && /--theme-family: lime-road/.test(css), 'CSS should expose current family for web consumers')

for (const { locale, json } of localeFiles) {
  check(`${locale} locale has new theme labels`, Boolean(json.settings?.themeMinimal && json.settings?.themeMarkdown && json.settings?.themeLimeRoad), `${locale} settings labels should include all theme families`)
  check(`${locale} locale has new theme descriptions`, Boolean(json.settings?.themeMinimalDescription && json.settings?.themeMarkdownDescription && json.settings?.themeLimeRoadDescription), `${locale} settings descriptions should include all theme families`)
  check(`${locale} locale has accent controls`, Boolean(json.settings?.themeAccent && json.settings?.themeAccentCustom && json.settings?.themeAccentApply), `${locale} settings labels should cover custom accent controls`)
  check(`${locale} locale removes legacy cartoon labels`, !json.settings?.themeIsland && !json.settings?.themeIslandDescription, `${locale} should not expose retired cartoon copy`)
}

const failures = checks.filter((item) => !item.ok)
for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`)
  if (!item.ok) console.log(`  ${item.detail}`)
}

if (process.argv.includes('--sync-global-css')) {
  console.log('INFO --sync-global-css is intentionally read-only; src/global.css is validated from source.')
}

if (failures.length) {
  console.error(`theme web source verification failed: ${failures.length} issue(s)`)
  process.exit(1)
}

console.log(`theme web source verification passed: ${checks.length} checks`)
