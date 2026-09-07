#!/usr/bin/env bun

const {
  clearThemeAccentPaletteCache,
  getColors,
  getThemeAccentPaletteCacheSize,
  isThemeId,
  normalizeThemeAccent,
  normalizeThemeId,
  resolveThemeMode,
  resolveThemePalette,
  THEME_ACCENT_CACHE_MAX_ENTRIES,
  THEME_PALETTE_REGISTRY,
} = await import('../src/theme/colors')
const {
  resolveThemeComponentExpression,
  resolveThemeExpression,
  THEME_EXPRESSION_REGISTRY,
} = await import('../src/theme/themeExpression')
const { collectThemeMotionProfileIssues, resolveThemeMotion } = await import('../src/theme/themeMotion')
const { resolveThemeDesignTokens, THEME_DESIGN_TOKENS } = await import('../src/theme/themeTokens')
const {
  CANONICAL_THEME_IDS,
  normalizeThemeFamilyValue,
  normalizeThemeModeValue,
} = await import('../src/types/settingsContracts')

const palettes = THEME_PALETTE_REGISTRY

function parseColor(input) {
  const value = String(input).trim()
  if (value.toLowerCase() === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 }
  }
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    const full = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex
    const n = Number.parseInt(full, 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const match = value.match(/rgba?\(([^)]+)\)/i)
  if (!match) return null
  const [r, g, b, alpha] = match[1].split(',').map((part) => Number.parseFloat(part.trim()))
  if ([r, g, b].some((component) => Number.isNaN(component))) return null
  return { r, g, b, a: Number.isFinite(alpha) ? alpha : 1 }
}

function composite(foreground, background) {
  const alpha = foreground.a ?? 1
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
    a: 1,
  }
}

function flattenColor(color, backdrop) {
  const base = parseColor(color)
  const under = parseColor(backdrop)
  if (!base) return null
  if (!under) return base
  if ((base.a ?? 1) >= 1) return { ...base, a: 1 }
  return composite(base, under)
}

function relativeLuminance(color) {
  const toLinear = (channel) => {
    const normalized = channel / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  const { r, g, b } = color
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

function contrastRatio(foreground, background) {
  const a = parseColor(foreground)
  const b = parseColor(background)
  if (!a || !b) return null
  const backgroundBase = b.a && b.a < 1 ? composite(b, { r: 255, g: 255, b: 255, a: 1 }) : b
  const foregroundBase = a.a && a.a < 1 ? composite(a, backgroundBase) : a
  const hi = Math.max(relativeLuminance(foregroundBase), relativeLuminance(backgroundBase))
  const lo = Math.min(relativeLuminance(foregroundBase), relativeLuminance(backgroundBase))
  return (hi + 0.05) / (lo + 0.05)
}

function visibleContrast(theme, foreground, background, backdrop) {
  const canvas = backdrop ?? theme.background.canvas ?? theme.material.canvas
  const visibleBackground = flattenColor(background, canvas)
  const visibleForeground = flattenColor(foreground, visibleBackground ?? canvas)
  if (!visibleBackground || !visibleForeground) return null
  const hi = Math.max(relativeLuminance(visibleForeground), relativeLuminance(visibleBackground))
  const lo = Math.min(relativeLuminance(visibleForeground), relativeLuminance(visibleBackground))
  return (hi + 0.05) / (lo + 0.05)
}

const checks = [
  ['minimal/light textTertiary', palettes.minimal.light, palettes.minimal.light.textTertiary, palettes.minimal.light.ui.card.defaultBackground, 3.5],
  ['minimal/light input placeholder', palettes.minimal.light, palettes.minimal.light.ui.input.placeholderForeground, palettes.minimal.light.ui.input.background, 3.5],
  ['minimal/light disabled input foreground', palettes.minimal.light, palettes.minimal.light.ui.input.disabledForeground, palettes.minimal.light.ui.input.disabledBackground, 4.5],
  ['minimal/light disabled control foreground', palettes.minimal.light, palettes.minimal.light.ui.control.disabledForeground, palettes.minimal.light.ui.control.disabledBackground, 4.5],
  ['minimal/light textSecondary on muted surface', palettes.minimal.light, palettes.minimal.light.textSecondary, palettes.minimal.light.ui.semantic.surface.muted, 4.5],
  ['minimal/light body text on code surface', palettes.minimal.light, palettes.minimal.light.ui.code.text, palettes.minimal.light.ui.code.background, 7],
  ['minimal/light user message foreground', palettes.minimal.light, palettes.minimal.light.ui.message.userForeground, palettes.minimal.light.ui.message.userBackground, 7],
  ['minimal/light warning tone', palettes.minimal.light, palettes.minimal.light.ui.tone.warning.foreground, palettes.minimal.light.ui.tone.warning.background, 4.5],
  ['minimal/light info tone', palettes.minimal.light, palettes.minimal.light.ui.tone.info.foreground, palettes.minimal.light.ui.tone.info.background, 4.5],
  ['minimal/dark textTertiary', palettes.minimal.dark, palettes.minimal.dark.textTertiary, palettes.minimal.dark.ui.card.defaultBackground, 4.5],
  ['minimal/dark input placeholder', palettes.minimal.dark, palettes.minimal.dark.ui.input.placeholderForeground, palettes.minimal.dark.ui.input.background, 4.5],
  ['minimal/dark disabled input foreground', palettes.minimal.dark, palettes.minimal.dark.ui.input.disabledForeground, palettes.minimal.dark.ui.input.disabledBackground, 4.5],
  ['minimal/dark disabled control foreground', palettes.minimal.dark, palettes.minimal.dark.ui.control.disabledForeground, palettes.minimal.dark.ui.control.disabledBackground, 4.5],
  ['minimal/dark accentForeground on accentBackground', palettes.minimal.dark, palettes.minimal.dark.ui.icon.accentForeground, palettes.minimal.dark.ui.icon.accentBackground, 4.5],
  ['minimal/dark accentForeground on action item', palettes.minimal.dark, palettes.minimal.dark.ui.icon.accentForeground, palettes.minimal.dark.ui.actionBar.itemBackground, 4.5],
  ['minimal/dark body text on code surface', palettes.minimal.dark, palettes.minimal.dark.ui.code.text, palettes.minimal.dark.ui.code.background, 7],
  ['minimal/dark user message foreground', palettes.minimal.dark, palettes.minimal.dark.ui.message.userForeground, palettes.minimal.dark.ui.message.userBackground, 7],
  ['material/light textTertiary', palettes.material.light, palettes.material.light.textTertiary, palettes.material.light.ui.card.defaultBackground, 3.5],
  ['material/light input placeholder', palettes.material.light, palettes.material.light.ui.input.placeholderForeground, palettes.material.light.ui.input.background, 3.5],
  ['material/light disabled input foreground', palettes.material.light, palettes.material.light.ui.input.disabledForeground, palettes.material.light.ui.input.disabledBackground, 4.5],
  ['material/light disabled control foreground', palettes.material.light, palettes.material.light.ui.control.disabledForeground, palettes.material.light.ui.control.disabledBackground, 4.5],
  ['material/light textSecondary on chrome background', palettes.material.light, palettes.material.light.textSecondary, palettes.material.light.ui.semantic.chrome.background, 4.5],
  ['material/light textSecondary on action item', palettes.material.light, palettes.material.light.textSecondary, palettes.material.light.ui.actionBar.itemBackground, 4.5],
  ['material/light body text on code surface', palettes.material.light, palettes.material.light.ui.code.text, palettes.material.light.ui.code.background, 7],
  ['material/light user message foreground (canonical projection)', palettes.material.light, palettes.material.light.ui.message.userForeground, palettes.material.light.ui.message.userBackground, 4.5],
  ['material/light tertiary text on table header', palettes.material.light, palettes.material.light.textSecondary, palettes.material.light.ui.table.headerBackground, 4.5],
  ['material/light warning tone', palettes.material.light, palettes.material.light.ui.tone.warning.foreground, palettes.material.light.ui.tone.warning.background, 4.5],
  ['material/light danger tone', palettes.material.light, palettes.material.light.ui.tone.danger.foreground, palettes.material.light.ui.tone.danger.background, 4.5],
  ['material/light info tone', palettes.material.light, palettes.material.light.ui.tone.info.foreground, palettes.material.light.ui.tone.info.background, 4.5],
  ['material/dark textTertiary', palettes.material.dark, palettes.material.dark.textTertiary, palettes.material.dark.ui.card.defaultBackground, 4.5],
  ['material/dark input placeholder', palettes.material.dark, palettes.material.dark.ui.input.placeholderForeground, palettes.material.dark.ui.input.background, 4.5],
  ['material/dark disabled input foreground', palettes.material.dark, palettes.material.dark.ui.input.disabledForeground, palettes.material.dark.ui.input.disabledBackground, 4.5],
  ['material/dark disabled control foreground', palettes.material.dark, palettes.material.dark.ui.control.disabledForeground, palettes.material.dark.ui.control.disabledBackground, 4.5],
  ['material/dark textSecondary on chrome background', palettes.material.dark, palettes.material.dark.textSecondary, palettes.material.dark.ui.semantic.chrome.background, 4.5],
  ['material/dark action item', palettes.material.dark, palettes.material.dark.textSecondary, palettes.material.dark.ui.actionBar.itemBackground, 4.5],
  ['material/dark body text on code surface', palettes.material.dark, palettes.material.dark.ui.code.text, palettes.material.dark.ui.code.background, 7],
  ['material/dark user message foreground', palettes.material.dark, palettes.material.dark.ui.message.userForeground, palettes.material.dark.ui.message.userBackground, 7],
  ['material/dark textSecondary on table header', palettes.material.dark, palettes.material.dark.textSecondary, palettes.material.dark.ui.table.headerBackground, 4.5],
  ['monet/light textTertiary', palettes.monet.light, palettes.monet.light.textTertiary, palettes.monet.light.ui.card.defaultBackground, 3.5],
  ['monet/light input placeholder', palettes.monet.light, palettes.monet.light.ui.input.placeholderForeground, palettes.monet.light.ui.input.background, 3.5],
  ['monet/light disabled input foreground', palettes.monet.light, palettes.monet.light.ui.input.disabledForeground, palettes.monet.light.ui.input.disabledBackground, 4.5],
  ['monet/light disabled control foreground', palettes.monet.light, palettes.monet.light.ui.control.disabledForeground, palettes.monet.light.ui.control.disabledBackground, 4.5],
  ['monet/light textSecondary on muted card', palettes.monet.light, palettes.monet.light.textSecondary, palettes.monet.light.ui.card.mutedBackground, 4.5],
  ['monet/light body text on code surface', palettes.monet.light, palettes.monet.light.ui.code.text, palettes.monet.light.ui.code.background, 7],
  ['monet/light user message foreground (canonical projection)', palettes.monet.light, palettes.monet.light.ui.message.userForeground, palettes.monet.light.ui.message.userBackground, 4.5],
  ['monet/light danger tone', palettes.monet.light, palettes.monet.light.ui.tone.danger.foreground, palettes.monet.light.ui.tone.danger.background, 4.5],
  ['monet/dark textTertiary', palettes.monet.dark, palettes.monet.dark.textTertiary, palettes.monet.dark.ui.card.defaultBackground, 4.5],
  ['monet/dark input placeholder', palettes.monet.dark, palettes.monet.dark.ui.input.placeholderForeground, palettes.monet.dark.ui.input.background, 4.5],
  ['monet/dark disabled input foreground', palettes.monet.dark, palettes.monet.dark.ui.input.disabledForeground, palettes.monet.dark.ui.input.disabledBackground, 4.5],
  ['monet/dark disabled control foreground', palettes.monet.dark, palettes.monet.dark.ui.control.disabledForeground, palettes.monet.dark.ui.control.disabledBackground, 4.5],
  ['monet/dark textSecondary on muted card', palettes.monet.dark, palettes.monet.dark.textSecondary, palettes.monet.dark.ui.card.mutedBackground, 4.5],
  ['monet/dark body text on code surface', palettes.monet.dark, palettes.monet.dark.ui.code.text, palettes.monet.dark.ui.code.background, 7],
  ['monet/dark user message foreground', palettes.monet.dark, palettes.monet.dark.ui.message.userForeground, palettes.monet.dark.ui.message.userBackground, 7],
  ['monet/dark danger tone on muted surface', palettes.monet.dark, palettes.monet.dark.ui.tone.danger.foreground, palettes.monet.dark.ui.semantic.surface.muted, 4.5],
  ['monet/light action item', palettes.monet.light, palettes.monet.light.textSecondary, palettes.monet.light.ui.card.mutedBackground, 4.5],
  ['monet/light title on base surface', palettes.monet.light, palettes.monet.light.text, palettes.monet.light.ui.semantic.surface.base, 7],
  ['monet/dark title on base surface', palettes.monet.dark, palettes.monet.dark.text, palettes.monet.dark.ui.semantic.surface.base, 7],
]

for (const family of CANONICAL_THEME_IDS) {
  for (const mode of ['light', 'dark']) {
    for (const accent of ['#000', '#FFF', '#FF0', '#4963A6', '#AB690A', '#1FAA0C', '#E4805F']) {
      const theme = getColors(mode, family, undefined, accent)
      checks.push([
        `${family}/${mode} custom ${accent} action foreground`,
        theme,
        theme.ui.control.primaryForeground,
        theme.ui.control.primaryBackground,
        4.5,
      ])
      checks.push([
        `${family}/${mode} custom ${accent} loading indicator`,
        theme,
        theme.ui.loading.dot,
        theme.ui.loading.background,
        3,
      ])
      checks.push([
        `${family}/${mode} custom ${accent} message action`,
        theme,
        theme.ui.message.userActionForeground,
        theme.ui.message.userActionBackground,
        4.5,
        theme.ui.message.userBackground,
      ])
      checks.push([
        `${family}/${mode} custom ${accent} table header`,
        theme,
        theme.textSecondary,
        theme.ui.table.headerBackground,
        4.5,
      ])
    }
  }
}

// Registry and derived-palette invariants: the registry must contain canonical
// identities only, canonical palettes must be immutable, and custom input must
// stay bounded even when a colour picker emits many unique values.
const retiredThemeIds = ['lime-road', 'cartoon', 'island', 'markdown', 'glass', 'material-3', 'material3', 'liquid']
const paletteKeys = Object.keys(palettes)
if (paletteKeys.length !== CANONICAL_THEME_IDS.length
  || !CANONICAL_THEME_IDS.every((family) => paletteKeys.includes(family))
  || retiredThemeIds.some((family) => Object.prototype.hasOwnProperty.call(palettes, family))
  || !Object.isFrozen(palettes.minimal.light)
  || !Object.isFrozen(palettes.minimal.light.ui)) {
  throw new Error('theme palette registry is not canonical/immutable')
}

if (normalizeThemeFamilyValue(' MONET ') !== 'monet'
  || normalizeThemeFamilyValue('island') !== undefined
  || normalizeThemeFamilyValue('material3') !== undefined
  || normalizeThemeFamilyValue('invalid') !== undefined
  || normalizeThemeModeValue(' DARK ') !== 'dark'
  || normalizeThemeModeValue('invalid') !== undefined
  || !isThemeId('monet')
  || isThemeId(' MONET ')
  || isThemeId('island')
  || normalizeThemeId('invalid') !== 'minimal'
  || resolveThemeMode('invalid', 'dark') !== 'dark'
  || resolveThemeMode('system', 'invalid') !== 'light'
  || resolveThemePalette('island', 'dark') !== palettes.minimal.dark
  || resolveThemePalette('invalid', 'invalid') !== palettes.minimal.light) {
  throw new Error('theme boundary normalization did not fail closed')
}

if (resolveThemeDesignTokens('glass', 'dark') !== THEME_DESIGN_TOKENS.minimal.dark
  || resolveThemeDesignTokens('invalid', 'invalid') !== THEME_DESIGN_TOKENS.minimal.light
  || !Object.isFrozen(THEME_DESIGN_TOKENS.minimal.light.semantic.color)
  || resolveThemeExpression('island').family !== 'minimal'
  || resolveThemeExpression('invalid').family !== 'minimal'
  || resolveThemeComponentExpression('invalid', 'invalid') !== THEME_EXPRESSION_REGISTRY.minimal.components.settings) {
  throw new Error('theme token/expression resolvers did not normalize safely')
}

const invalidMotion = resolveThemeMotion({
  themeId: 'invalid',
  role: 'invalid',
  intensity: 'full',
  order: Number.NaN,
})
if (collectThemeMotionProfileIssues().length
  || invalidMotion.transition.duration !== 136
  || invalidMotion.transition.delay !== 0) {
  throw new Error('theme motion profiles are invalid or do not fail closed')
}

const customSemanticProbe = getColors('light', 'monet', undefined, '#123456')
if (customSemanticProbe.brand !== '#123456'
  || customSemanticProbe.design?.reference.brand !== '#123456'
  || customSemanticProbe.tertiary !== palettes.monet.light.tertiary
  || customSemanticProbe.design?.reference.tertiary !== palettes.monet.light.design?.reference.tertiary) {
  throw new Error('custom accent replaced theme-owned tertiary semantics')
}

for (const family of CANONICAL_THEME_IDS) {
  for (const mode of ['light', 'dark']) {
    const designMotion = palettes[family][mode].design?.semantic.motion
    const expressionMotion = THEME_EXPRESSION_REGISTRY[family].motion.duration
    for (const role of ['instant', 'interaction', 'emphasis', 'panel', 'page']) {
      if (designMotion?.[role] !== expressionMotion[role]) {
        throw new Error(`${family}/${mode} motion duration drifted between token and expression layers`)
      }
    }
  }
}

clearThemeAccentPaletteCache()
const firstDerivedPalette = getColors('light', 'minimal', undefined, '#010203')
for (let index = 0; index < THEME_ACCENT_CACHE_MAX_ENTRIES + 4; index += 1) {
  const hex = `#${(index + 0x100000).toString(16).slice(-6)}`
  getColors('light', 'minimal', undefined, hex)
}
if (getThemeAccentPaletteCacheSize() !== THEME_ACCENT_CACHE_MAX_ENTRIES) {
  throw new Error('custom accent cache exceeded its configured bound')
}
const secondDerivedPalette = getColors('light', 'minimal', undefined, '#010203')
if (firstDerivedPalette === secondDerivedPalette) {
  throw new Error('custom accent cache did not evict the oldest derived palette')
}
clearThemeAccentPaletteCache()

for (const family of CANONICAL_THEME_IDS) {
  for (const mode of ['light', 'dark']) {
    const theme = palettes[family][mode]
    checks.push([`${family}/${mode} primary content`, theme, theme.text, theme.ui.semantic.surface.base, 4.5])
    checks.push([`${family}/${mode} secondary content`, theme, theme.textSecondary, theme.ui.semantic.surface.muted, 4.5])
    checks.push([`${family}/${mode} focus indicator`, theme, theme.ui.control.focus, theme.ui.semantic.surface.base, 3])
    checks.push([`${family}/${mode} primary control`, theme, theme.ui.control.primaryForeground, theme.ui.control.primaryBackground, 4.5])
    checks.push([`${family}/${mode} input placeholder`, theme, theme.ui.input.placeholderForeground, theme.ui.input.background, 3])
    checks.push([`${family}/${mode} user message`, theme, theme.ui.message.userForeground, theme.ui.message.userBackground, 4.5])
  }
}

if (normalizeThemeAccent('#abc') !== '#AABBCC' || normalizeThemeAccent('not-a-color') !== undefined) {
  throw new Error('theme accent normalization rejected a valid shorthand or accepted invalid input')
}

for (const family of CANONICAL_THEME_IDS) {
  for (const mode of ['light', 'dark']) {
    const theme = palettes[family][mode]
  const expectedSurfaces = [
    theme.ui.semantic.surface.canvas,
    theme.ui.semantic.surface.base,
    theme.ui.semantic.surface.muted,
  ]
  const compatibilitySurfaces = [theme.surface, theme.surfaceSecondary, theme.surfaceTertiary]
  if (compatibilitySurfaces.some((value, index) => value !== expectedSurfaces[index])) {
      throw new Error(`${family}/${mode} compatibility surfaces diverge from the semantic canvas`)
    }
  }
}

const failures = []
for (const [label, theme, fg, bg, minRatio, backdrop] of checks) {
  const ratio = visibleContrast(theme, fg, bg, backdrop)
  const ok = typeof ratio === 'number' && ratio >= minRatio
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${ratio?.toFixed(2) ?? 'n/a'} >= ${minRatio}`)
  if (!ok) failures.push(label)
}

if (failures.length) {
  console.error(`theme contrast self-test failed: ${failures.join(', ')}`)
  process.exit(1)
}
