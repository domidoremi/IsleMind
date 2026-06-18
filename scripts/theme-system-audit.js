#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
}

const colors = read('src/theme/colors.ts')
const typeSource = read('src/types/index.ts')
const hook = read('src/hooks/useAppTheme.ts')
const settingsStore = read('src/store/settingsStore.ts')
const css = read('src/global.css')
const layout = read('app/_layout.tsx')
const settingsScreen = read('src/components/main/SettingsScreenContent.tsx')

check('runtime ThemeId excludes legacy island', !/export type ThemeId = .*island/.test(typeSource), 'island must stay a compatibility input, not a runtime family')
check('palettes cover minimal glass cartoon', /minimal:\s*{\s*light:\s*minimalLight,\s*dark:\s*minimalDark/.test(colors) && /glass:\s*{\s*light:\s*glassLight,\s*dark:\s*glassDark/.test(colors) && /cartoon:\s*{\s*light:\s*islandLight,\s*dark:\s*islandDark/.test(colors), 'themePalettes must have light/dark coverage for all families')
check('semantic token layer is present', /semantic:\s*{/.test(colors) && /surface:\s*{/.test(colors) && /content:\s*{/.test(colors) && /chrome:\s*{/.test(colors) && /control:\s*{/.test(colors) && /feedback:\s*{/.test(colors), 'ThemeUiTokens needs surface/content/chrome/control/feedback layers')
check('each ui builder declares the correct family', /family: 'minimal'/.test(colors) && /family: 'glass'/.test(colors) && /family: 'cartoon'/.test(colors), 'minimalUi/glassUi/cartoon alias should be explicit')
check('glass is semantic fallback only in RN source', !/glassEffect|GlassEffectContainer|glassEffectID|glassProminent/.test(colors + layout + settingsScreen), 'native Liquid Glass APIs should not be faked in RN/Expo source')
check('glass theme is marked as glass and non-cartoon', /family: 'glass'[\s\S]*?glass: true[\s\S]*?cartoon: false/.test(colors), 'glass should not inherit cartoon styling behavior')
check('cartoon theme keeps animal-island inspired styling', /family: 'cartoon'[\s\S]*?cartoon: true[\s\S]*?ornamented: true/.test(colors) && /controlMiddle: 999/.test(colors), 'cartoon should retain pill controls and ornament flag')
check('minimal remains default and plain', /DEFAULT_THEME_ID: ThemeId = 'minimal'/.test(colors) && /family: 'minimal'[\s\S]*?ambient: 'plain'/.test(colors), 'minimal should be the default content-first theme')
check('settings migration persists normalized legacy ids', /normalizeThemeId\(rawSettings\.themeId\)/.test(settingsStore) && /themeIdMigrated/.test(settingsStore), 'legacy persisted island should be rewritten after load')
check('settings screen uses canonical theme options only', /THEME_FAMILY_OPTIONS[\s\S]*id: 'minimal'[\s\S]*id: 'glass'[\s\S]*id: 'cartoon'/.test(settingsScreen) && !/id: 'island'/.test(settingsScreen), 'users should not see legacy island as a selectable family')
check('web bridge exposes semantic token slices', /colors\.ui\.semantic\.surface\.base/.test(layout) && /colors\.ui\.semantic\.content\.primary/.test(layout) && /colors\.ui\.semantic\.chrome\.background/.test(layout) && /colors\.ui\.semantic\.control\.background/.test(layout), 'web bridge must map semantic layers')
check('CSS has glass fallback selectors and flags', /data-theme-id='glass'\]\[data-theme-mode='light'\]/.test(css) && /data-theme-id='glass'\]\[data-theme-mode='dark'\]/.test(css) && /--theme-glass-enabled: 1/.test(css), 'pre-native web fallback needs visible glass family markers')
check('CSS aliases island to cartoon only', /data-theme-id='cartoon'\]\[data-theme-mode='light'\],\s*:root\[data-theme-id='island'\]\[data-theme-mode='light'\]/.test(css) && /data-theme-id='cartoon'\]\[data-theme-mode='dark'\],\s*:root\[data-theme-id='island'\]\[data-theme-mode='dark'\]/.test(css), 'legacy CSS selectors should not define a separate runtime theme')
check('hook exposes canonical booleans', /isGlass: themeId === 'glass'/.test(hook) && /isCartoon: themeId === 'cartoon'/.test(hook) && !/isIsland/.test(hook), 'components should branch on glass/cartoon, not island')

const forbiddenRuntimeIsland = [
  'src/types/index.ts',
  'src/hooks/useAppTheme.ts',
  'src/components/main/SettingsScreenContent.tsx',
].filter((file) => /\bisland\b/.test(read(file)))
check('no runtime island references in core typed/theme UI files', forbiddenRuntimeIsland.length === 0, `unexpected island references: ${forbiddenRuntimeIsland.join(', ')}`)

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
