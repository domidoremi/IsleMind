#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
}

const typeSource = read('src/types/index.ts')
const colorsSource = read('src/theme/colors.ts')
const settingsStore = read('src/store/settingsStore.ts')
const themeHook = read('src/hooks/useAppTheme.ts')
const settingsScreen = read('src/components/main/SettingsScreenContent.tsx')
const layout = read('app/_layout.tsx')
const css = read('src/global.css')
const appActionPolicy = read('src/services/appActionPolicy.ts')
const appCommandRouter = read('src/services/appCommandRouter.ts')
const builtinTools = read('src/services/builtinToolRegistry.ts')
const agentTools = read('src/services/agent/agentToolRegistry.ts')
const localeFiles = ['en', 'zh-CN', 'ja'].map((locale) => ({
  locale,
  json: JSON.parse(read(`src/i18n/resources/${locale}.json`)),
  source: read(`src/i18n/resources/${locale}.json`),
}))

check(
  'ThemeId union exposes minimal/glass/cartoon',
  /export type ThemeId = 'minimal' \| 'glass' \| 'cartoon'/.test(typeSource),
  'src/types/index.ts should not expose island as a runtime ThemeId',
)
check('default theme is minimal', /export const DEFAULT_THEME_ID: ThemeId = 'minimal'/.test(colorsSource) && /themeId: 'minimal'/.test(settingsStore), 'colors and settings defaults must both be minimal')
check('themeIds contains exactly minimal/glass/cartoon', /themeIds = \['minimal', 'glass', 'cartoon'\]/.test(colorsSource), 'themeIds drives settings UI and audits')
check('legacy island normalizes to cartoon', /if \(value === 'island'\) return 'cartoon'/.test(colorsSource) && /normalizeThemeId\(rawSettings\.themeId\)/.test(settingsStore), 'persisted island settings must migrate on load')
check('useAppTheme exposes family booleans', /isMinimal: themeId === 'minimal'/.test(themeHook) && /isGlass: themeId === 'glass'/.test(themeHook) && /isCartoon: themeId === 'cartoon'/.test(themeHook), 'hook consumers need explicit booleans')
check('settings UI offers three theme families', /id: 'minimal'/.test(settingsScreen) && /id: 'glass'/.test(settingsScreen) && /id: 'cartoon'/.test(settingsScreen), 'preferences must allow minimal/glass/cartoon')
check('app action policy accepts new theme ids', /THEME_IDS: ThemeId\[\] = \['minimal', 'glass', 'cartoon'\]/.test(appActionPolicy), 'agent actions should use the canonical runtime ids')
check('command router maps glass/cartoon phrases', /return 'glass'/.test(appCommandRouter) && /return 'cartoon'/.test(appCommandRouter), 'natural-language theme commands should reach the new families')
check('tool schemas expose compatibility island input', /enum: \['minimal', 'glass', 'cartoon', 'island'\]/.test(builtinTools) && /enum: \['minimal', 'glass', 'cartoon', 'island'\]/.test(agentTools), 'agent/builtin tools may accept island but runtime normalizes it')
check('web bridge writes theme attributes', /data-theme-family/.test(layout) && /data-theme-glass/.test(layout) && /data-theme-cartoon/.test(layout), 'web runtime should expose theme family flags')
check('web bridge writes semantic variables', /--color-semanticSurfaceBase/.test(layout) && /--color-semanticChromeBackground/.test(layout) && /--color-semanticControlBackground/.test(layout), 'web bridge should carry semantic tokens')
check('global CSS has all theme fallback selectors', /data-theme-id='minimal'/.test(css) && /data-theme-id='glass'/.test(css) && /data-theme-id='cartoon'/.test(css), 'web fallback selectors must cover all theme families')
check('global CSS keeps island only as compatibility selector', /data-theme-id='island'/.test(css) && /data-theme-id='cartoon'\]\[data-theme-mode='light'\],\s*:root\[data-theme-id='island'\]/.test(css), 'island selector should alias cartoon fallback')
check('global CSS declares theme family flags', /--theme-family: minimal/.test(css) && /--theme-family: glass/.test(css) && /--theme-family: cartoon/.test(css), 'CSS should expose current family for web consumers')

for (const { locale, json, source } of localeFiles) {
  check(`${locale} locale has new theme labels`, Boolean(json.settings?.themeMinimal && json.settings?.themeGlass && json.settings?.themeCartoon), `${locale} settings labels should include all theme families`)
  check(`${locale} locale has new theme descriptions`, Boolean(json.settings?.themeMinimalDescription && json.settings?.themeGlassDescription && json.settings?.themeCartoonDescription), `${locale} settings descriptions should include all theme families`)
  check(`${locale} locale retains island compatibility keys`, /themeIsland/.test(source) && /themeIslandDescription/.test(source), `${locale} can keep old keys as compatibility copy`)
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
