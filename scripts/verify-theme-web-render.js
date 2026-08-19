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
  'ThemeId contract exposes four canonical families',
  /export type CanonicalThemeId = 'minimal' \| 'monet' \| 'material' \| 'liquid-glass'/.test(settingsTypeSource),
  'the settings contract exposes canonical families while legacy values remain input-only aliases',
)
check('default theme is minimal light', /export const DEFAULT_THEME_ID: CanonicalThemeId = 'minimal'/.test(colorsSource) && /theme: 'light'/.test(settingsStore) && /themeId: 'minimal'/.test(settingsStore), 'colors and settings defaults must both be Minimal Light')
check('themeIds contains exactly four canonical families', /themeIds = \['minimal', 'monet', 'material', 'liquid-glass'\]/.test(colorsSource), 'themeIds drives settings UI and audits')
check('legacy ids normalize to canonical families', /value === 'lime-road' \|\| value === 'cartoon' \|\| value === 'island'\) return 'monet'/.test(settingsAppearance) && /value === 'markdown' \|\| value === 'material-3' \|\| value === 'material3'\) return 'material'/.test(settingsAppearance) && /value === 'glass' \|\| value === 'liquid'\) return 'liquid-glass'/.test(settingsAppearance) && /normalizeSettingsThemeFamily\(value\) \?\? DEFAULT_THEME_ID/.test(colorsSource) && /normalizeThemeId\(rawSettings\.themeId\)/.test(settingsStore), 'persisted legacy settings must migrate through the Settings-owned policy')
check('theme mode normalization fails closed', /normalizeSettingsThemeMode/.test(settingsAppearance) && /normalizeSettingsThemeMode\(rawSettings\.theme\)/.test(settingsStore) && /normalizeSettingsThemeMode\(theme\)/.test(colorsSource), 'invalid persisted modes must not index an undefined palette')
check('useAppTheme exposes canonical family booleans', /isMinimal: canonicalThemeId === 'minimal'/.test(themeHook) && /isMonet: canonicalThemeId === 'monet'/.test(themeHook) && /isMaterial: canonicalThemeId === 'material'/.test(themeHook) && /isLiquidGlass: canonicalThemeId === 'liquid-glass'/.test(themeHook), 'hook consumers need explicit canonical booleans')
check('settings UI offers four canonical theme families', /id: 'minimal'/.test(settingsScreen) && /id: 'monet'/.test(settingsScreen) && /id: 'material'/.test(settingsScreen) && /id: 'liquid-glass'/.test(settingsScreen), 'preferences must allow all canonical families')
check('appearance cards expose rendered radio semantics and compact layout', /function ThemeFamilyCard[\s\S]*?accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ checked: active \}\}[\s\S]*?aria-checked=\{active\}/.test(settingsScreen) && /function ThemeModeCard[\s\S]*?accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ checked: active \}\}[\s\S]*?aria-checked=\{active\}/.test(settingsScreen) && /function ThemeAccentSwatch[\s\S]*?accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ checked: active \}\}[\s\S]*?aria-checked=\{active\}/.test(settingsScreen) && /const actionCompact = width < 360/.test(settingsScreen) && /flexDirection: actionCompact \? 'column' : 'row'/.test(settingsScreen), 'appearance controls must expose checked state to both React Native accessibility and rendered web ARIA')
check('custom accent remains a checked radio choice', /activeCustomThemeAccent/.test(settingsScreen) && /settings-theme-accent-custom/.test(settingsScreen) && /disabled=\{!activeCustomThemeAccent && !normalizedThemeAccentDraft\}/.test(settingsScreen), 'a custom hexadecimal accent must not leave the accent radio group without a selected option')
check('app action policy accepts four canonical theme ids', /SETTINGS_THEME_FAMILIES = \['minimal', 'monet', 'material', 'liquid-glass'\] as const/.test(settingsActionContracts), 'assistant actions should use the canonical runtime ids')
check('tool schemas expose canonical and compatibility family inputs', /enum: \['minimal', 'monet', 'material', 'liquid-glass', 'lime-road', 'markdown', 'cartoon', 'island', 'glass', 'material-3', 'material3', 'liquid'\]/.test(builtinTools) && /enum: \['minimal', 'monet', 'material', 'liquid-glass', 'lime-road', 'markdown', 'cartoon', 'island', 'glass', 'material-3', 'material3', 'liquid'\]/.test(agentTools), 'assistant/builtin tools may accept old ids but runtime normalizes them')
check('custom accent tool is shared across action catalogs', /name: 'set_theme_accent'/.test(builtinTools) && /name: 'set_theme_accent'/.test(agentTools), 'assistant and Agent settings actions should expose one accent mutation')
check('web bridge writes canonical theme attributes', /data-theme-family/.test(layout) && /data-theme-monet/.test(layout) && /data-theme-material/.test(layout) && /data-theme-liquid-glass/.test(layout) && /data-theme-custom-accent/.test(layout), 'web runtime should expose canonical theme family and custom-accent flags')
check('web bridge writes semantic variables', /--color-semanticSurfaceBase/.test(layout) && /--color-semanticChromeBackground/.test(layout) && /--color-semanticControlBackground/.test(layout), 'web bridge should carry semantic tokens')
check('global CSS has all canonical theme fallback selectors', ['minimal', 'monet', 'material', 'liquid-glass'].every((family) => css.includes(`data-theme-id='${family}'`)), 'web fallback selectors must cover all canonical families')
check('global CSS keeps legacy aliases as compatibility selectors', /data-theme-id='cartoon'/.test(css) && /data-theme-id='island'/.test(css) && /data-theme-id='glass'/.test(css), 'legacy selectors must remain aliases only')
check('global CSS declares canonical theme family flags', /--theme-family: minimal/.test(css) && /--theme-family: monet/.test(css) && /--theme-family: material/.test(css) && /--theme-family: liquid-glass/.test(css), 'CSS should expose current family for web consumers')

for (const { locale, json } of localeFiles) {
  check(`${locale} locale has new theme labels`, Boolean(json.settings?.themeMinimal && json.settings?.themeMonet && json.settings?.themeMaterial && json.settings?.themeLiquidGlass), `${locale} settings labels should include all canonical theme families`)
  check(`${locale} locale has new theme descriptions`, Boolean(json.settings?.themeMinimalDescription && json.settings?.themeMonetDescription && json.settings?.themeMaterialDescription && json.settings?.themeLiquidGlassDescription), `${locale} settings descriptions should include all canonical theme families`)
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
