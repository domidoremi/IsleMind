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
const localeFiles = ['en', 'zh-CN', 'ja'].map((locale) => ({
  locale,
  json: JSON.parse(read(`src/i18n/resources/${locale}.json`)),
}))

check(
  'ThemeId contract exposes four canonical families',
  /export type CanonicalThemeId = 'minimal' \| 'monet' \| 'material' \| 'liquid-glass'/.test(settingsTypeSource)
    && /export type ThemeId = CanonicalThemeId/.test(settingsTypeSource)
    && !/LegacyThemeId|THEME_ID_ALIASES/.test(settingsTypeSource),
  'the settings contract must expose canonical families only',
)
check('default theme is minimal light', /export const DEFAULT_THEME_ID: CanonicalThemeId = 'minimal'/.test(colorsSource) && /theme: 'light'/.test(settingsStore) && /themeId: 'minimal'/.test(settingsStore), 'colors and settings defaults must both be Minimal Light')
check('themeIds contains exactly four canonical families', /export const themeIds = THEME_FAMILIES/.test(colorsSource) && /CANONICAL_THEME_IDS = \['minimal', 'monet', 'material', 'liquid-glass'\]/.test(settingsTypeSource), 'theme ids are sourced from the canonical settings contract')
check('retired ids fail closed to Minimal', /CANONICAL_THEME_IDS as readonly string\[\]/.test(settingsTypeSource) && /normalizeThemeFamilyValue\(value\)/.test(settingsAppearance) && /normalizeThemeFamilyValue\(value\) \?\? DEFAULT_THEME_ID/.test(colorsSource) && /normalizeThemeId\(rawSettings\.themeId\)/.test(settingsStore) && /themeIdMigrated/.test(settingsStore), 'stale or corrupt persisted ids must be rejected, rewritten, and resolved as Minimal')
check('theme mode normalization fails closed', /normalizeThemeModeValue/.test(settingsTypeSource) && /normalizeSettingsThemeMode/.test(settingsAppearance) && /normalizeSettingsThemeMode\(rawSettings\.theme\)/.test(settingsStore) && /normalizeThemeModeValue\(theme\)/.test(colorsSource), 'invalid persisted modes must not index an undefined palette')
check('useAppTheme exposes canonical family booleans', /isMinimal: canonicalThemeId === 'minimal'/.test(themeHook) && /isMonet: canonicalThemeId === 'monet'/.test(themeHook) && /isMaterial: canonicalThemeId === 'material'/.test(themeHook) && /isLiquidGlass: canonicalThemeId === 'liquid-glass'/.test(themeHook), 'hook consumers need explicit canonical booleans')
check('settings UI offers four canonical theme families', /id: 'minimal'/.test(settingsScreen) && /id: 'monet'/.test(settingsScreen) && /id: 'material'/.test(settingsScreen) && /id: 'liquid-glass'/.test(settingsScreen), 'preferences must allow all canonical families')
check('appearance cards expose rendered radio semantics and compact layout', /function ThemeFamilyCard[\s\S]*?accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ checked: active \}\}[\s\S]*?aria-checked=\{active\}/.test(settingsScreen) && /function ThemeModeCard[\s\S]*?accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ checked: active \}\}[\s\S]*?aria-checked=\{active\}/.test(settingsScreen) && /function ThemeAccentSwatch[\s\S]*?accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ checked: active \}\}[\s\S]*?aria-checked=\{active\}/.test(settingsScreen) && /const actionCompact = width < 360/.test(settingsScreen) && /flexDirection: actionCompact \? 'column' : 'row'/.test(settingsScreen), 'appearance controls must expose checked state to both React Native accessibility and rendered web ARIA')
check('custom accent remains a checked radio choice', /activeCustomThemeAccent/.test(settingsScreen) && /settings-theme-accent-custom/.test(settingsScreen) && /disabled=\{!activeCustomThemeAccent && !normalizedThemeAccentDraft\}/.test(settingsScreen), 'a custom hexadecimal accent must not leave the accent radio group without a selected option')
check('app action policy accepts four canonical theme ids', /SETTINGS_THEME_FAMILIES = CANONICAL_THEME_IDS/.test(settingsActionContracts), 'assistant actions should use the canonical runtime ids')
check('tool schemas expose canonical family inputs only', /enum: \['minimal', 'monet', 'material', 'liquid-glass'\]/.test(builtinTools) && !/lime-road|material-3|material3|Legacy .*migrated/.test(builtinTools), 'assistant tools must reject retired theme ids at the schema boundary')
check('custom accent tool is exposed by the conversation catalog', /name: 'set_theme_accent'/.test(builtinTools), 'assistant settings actions should expose one accent mutation')
check('web bridge writes canonical theme attributes', /data-theme-id', canonicalThemeId/.test(layout) && /data-theme-family', canonicalThemeId/.test(layout) && /data-theme-custom-accent/.test(layout) && !/data-theme-presentation-id|data-theme-(?:lime-road|markdown|glass)/.test(layout), 'web runtime should expose one canonical family identity and the custom-accent flag')
check('web bridge writes semantic variables', /--color-semanticSurfaceBase/.test(layout) && /--color-semanticChromeBackground/.test(layout) && /--color-semanticControlBackground/.test(layout) && /--color-brand/.test(layout), 'web bridge should carry semantic and canonical brand roles')
check('global CSS has all canonical theme fallback selectors', ['minimal', 'monet', 'material', 'liquid-glass'].every((family) => css.includes(`data-theme-id='${family}'`)), 'web fallback selectors must cover all canonical families')
check('global CSS contains no retired theme selectors', !/data-theme-id='(?:lime-road|cartoon|island|markdown|glass|material-3|material3|liquid)'/.test(css), 'pre-hydration CSS must use canonical family selectors only')
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
