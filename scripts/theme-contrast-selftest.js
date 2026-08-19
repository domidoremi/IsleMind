#!/usr/bin/env bun

const { getColors, normalizeThemeAccent, themePalettes } = await import('../src/theme/colors')

function parseColor(input) {
  const value = String(input).trim()
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

function visibleContrast(theme, foreground, background) {
  const canvas = theme.background.canvas ?? theme.material.canvas
  const visibleBackground = flattenColor(background, canvas)
  const visibleForeground = flattenColor(foreground, visibleBackground ?? canvas)
  if (!visibleBackground || !visibleForeground) return null
  const hi = Math.max(relativeLuminance(visibleForeground), relativeLuminance(visibleBackground))
  const lo = Math.min(relativeLuminance(visibleForeground), relativeLuminance(visibleBackground))
  return (hi + 0.05) / (lo + 0.05)
}

const checks = [
  ['minimal/light textTertiary', themePalettes.minimal.light, themePalettes.minimal.light.textTertiary, themePalettes.minimal.light.ui.card.defaultBackground, 3.5],
  ['minimal/light input placeholder', themePalettes.minimal.light, themePalettes.minimal.light.ui.input.placeholderForeground, themePalettes.minimal.light.ui.input.background, 3.5],
  ['minimal/light disabled input foreground', themePalettes.minimal.light, themePalettes.minimal.light.ui.input.disabledForeground, themePalettes.minimal.light.ui.input.disabledBackground, 4.5],
  ['minimal/light disabled control foreground', themePalettes.minimal.light, themePalettes.minimal.light.ui.control.disabledForeground, themePalettes.minimal.light.ui.control.disabledBackground, 4.5],
  ['minimal/light textSecondary on muted surface', themePalettes.minimal.light, themePalettes.minimal.light.textSecondary, themePalettes.minimal.light.ui.semantic.surface.muted, 4.5],
  ['minimal/light body text on code surface', themePalettes.minimal.light, themePalettes.minimal.light.ui.code.text, themePalettes.minimal.light.ui.code.background, 7],
  ['minimal/light user message foreground', themePalettes.minimal.light, themePalettes.minimal.light.ui.message.userForeground, themePalettes.minimal.light.ui.message.userBackground, 7],
  ['minimal/light warning tone', themePalettes.minimal.light, themePalettes.minimal.light.ui.tone.warning.foreground, themePalettes.minimal.light.ui.tone.warning.background, 4.5],
  ['minimal/light info tone', themePalettes.minimal.light, themePalettes.minimal.light.ui.tone.info.foreground, themePalettes.minimal.light.ui.tone.info.background, 4.5],
  ['minimal/dark textTertiary', themePalettes.minimal.dark, themePalettes.minimal.dark.textTertiary, themePalettes.minimal.dark.ui.card.defaultBackground, 4.5],
  ['minimal/dark input placeholder', themePalettes.minimal.dark, themePalettes.minimal.dark.ui.input.placeholderForeground, themePalettes.minimal.dark.ui.input.background, 4.5],
  ['minimal/dark disabled input foreground', themePalettes.minimal.dark, themePalettes.minimal.dark.ui.input.disabledForeground, themePalettes.minimal.dark.ui.input.disabledBackground, 4.5],
  ['minimal/dark disabled control foreground', themePalettes.minimal.dark, themePalettes.minimal.dark.ui.control.disabledForeground, themePalettes.minimal.dark.ui.control.disabledBackground, 4.5],
  ['minimal/dark accentForeground on accentBackground', themePalettes.minimal.dark, themePalettes.minimal.dark.ui.icon.accentForeground, themePalettes.minimal.dark.ui.icon.accentBackground, 4.5],
  ['minimal/dark accentForeground on action item', themePalettes.minimal.dark, themePalettes.minimal.dark.ui.icon.accentForeground, themePalettes.minimal.dark.ui.actionBar.itemBackground, 4.5],
  ['minimal/dark body text on code surface', themePalettes.minimal.dark, themePalettes.minimal.dark.ui.code.text, themePalettes.minimal.dark.ui.code.background, 7],
  ['minimal/dark user message foreground', themePalettes.minimal.dark, themePalettes.minimal.dark.ui.message.userForeground, themePalettes.minimal.dark.ui.message.userBackground, 7],
  ['markdown/light textTertiary', themePalettes.markdown.light, themePalettes.markdown.light.textTertiary, themePalettes.markdown.light.ui.card.defaultBackground, 3.5],
  ['markdown/light input placeholder', themePalettes.markdown.light, themePalettes.markdown.light.ui.input.placeholderForeground, themePalettes.markdown.light.ui.input.background, 3.5],
  ['markdown/light disabled input foreground', themePalettes.markdown.light, themePalettes.markdown.light.ui.input.disabledForeground, themePalettes.markdown.light.ui.input.disabledBackground, 4.5],
  ['markdown/light disabled control foreground', themePalettes.markdown.light, themePalettes.markdown.light.ui.control.disabledForeground, themePalettes.markdown.light.ui.control.disabledBackground, 4.5],
  ['markdown/light textSecondary on chrome background', themePalettes.markdown.light, themePalettes.markdown.light.textSecondary, themePalettes.markdown.light.ui.semantic.chrome.background, 4.5],
  ['markdown/light textSecondary on action item', themePalettes.markdown.light, themePalettes.markdown.light.textSecondary, themePalettes.markdown.light.ui.actionBar.itemBackground, 4.5],
  ['markdown/light body text on code surface', themePalettes.markdown.light, themePalettes.markdown.light.ui.code.text, themePalettes.markdown.light.ui.code.background, 7],
  ['markdown/light user message foreground (compatibility projection)', themePalettes.markdown.light, themePalettes.markdown.light.ui.message.userForeground, themePalettes.markdown.light.ui.message.userBackground, 4.5],
  ['markdown/light tertiary text on table header', themePalettes.markdown.light, themePalettes.markdown.light.textSecondary, themePalettes.markdown.light.ui.table.headerBackground, 4.5],
  ['markdown/light warning tone', themePalettes.markdown.light, themePalettes.markdown.light.ui.tone.warning.foreground, themePalettes.markdown.light.ui.tone.warning.background, 4.5],
  ['markdown/light danger tone', themePalettes.markdown.light, themePalettes.markdown.light.ui.tone.danger.foreground, themePalettes.markdown.light.ui.tone.danger.background, 4.5],
  ['markdown/light info tone', themePalettes.markdown.light, themePalettes.markdown.light.ui.tone.info.foreground, themePalettes.markdown.light.ui.tone.info.background, 4.5],
  ['markdown/dark textTertiary', themePalettes.markdown.dark, themePalettes.markdown.dark.textTertiary, themePalettes.markdown.dark.ui.card.defaultBackground, 4.5],
  ['markdown/dark input placeholder', themePalettes.markdown.dark, themePalettes.markdown.dark.ui.input.placeholderForeground, themePalettes.markdown.dark.ui.input.background, 4.5],
  ['markdown/dark disabled input foreground', themePalettes.markdown.dark, themePalettes.markdown.dark.ui.input.disabledForeground, themePalettes.markdown.dark.ui.input.disabledBackground, 4.5],
  ['markdown/dark disabled control foreground', themePalettes.markdown.dark, themePalettes.markdown.dark.ui.control.disabledForeground, themePalettes.markdown.dark.ui.control.disabledBackground, 4.5],
  ['markdown/dark textSecondary on chrome background', themePalettes.markdown.dark, themePalettes.markdown.dark.textSecondary, themePalettes.markdown.dark.ui.semantic.chrome.background, 4.5],
  ['markdown/dark action item', themePalettes.markdown.dark, themePalettes.markdown.dark.textSecondary, themePalettes.markdown.dark.ui.actionBar.itemBackground, 4.5],
  ['markdown/dark body text on code surface', themePalettes.markdown.dark, themePalettes.markdown.dark.ui.code.text, themePalettes.markdown.dark.ui.code.background, 7],
  ['markdown/dark user message foreground', themePalettes.markdown.dark, themePalettes.markdown.dark.ui.message.userForeground, themePalettes.markdown.dark.ui.message.userBackground, 7],
  ['markdown/dark textSecondary on table header', themePalettes.markdown.dark, themePalettes.markdown.dark.textSecondary, themePalettes.markdown.dark.ui.table.headerBackground, 4.5],
  ['lime-road/light textTertiary', themePalettes['lime-road'].light, themePalettes['lime-road'].light.textTertiary, themePalettes['lime-road'].light.ui.card.defaultBackground, 3.5],
  ['lime-road/light input placeholder', themePalettes['lime-road'].light, themePalettes['lime-road'].light.ui.input.placeholderForeground, themePalettes['lime-road'].light.ui.input.background, 3.5],
  ['lime-road/light disabled input foreground', themePalettes['lime-road'].light, themePalettes['lime-road'].light.ui.input.disabledForeground, themePalettes['lime-road'].light.ui.input.disabledBackground, 4.5],
  ['lime-road/light disabled control foreground', themePalettes['lime-road'].light, themePalettes['lime-road'].light.ui.control.disabledForeground, themePalettes['lime-road'].light.ui.control.disabledBackground, 4.5],
  ['lime-road/light textSecondary on muted card', themePalettes['lime-road'].light, themePalettes['lime-road'].light.textSecondary, themePalettes['lime-road'].light.ui.card.mutedBackground, 4.5],
  ['lime-road/light body text on code surface', themePalettes['lime-road'].light, themePalettes['lime-road'].light.ui.code.text, themePalettes['lime-road'].light.ui.code.background, 7],
  ['lime-road/light user message foreground (compatibility projection)', themePalettes['lime-road'].light, themePalettes['lime-road'].light.ui.message.userForeground, themePalettes['lime-road'].light.ui.message.userBackground, 4.5],
  ['lime-road/light danger tone', themePalettes['lime-road'].light, themePalettes['lime-road'].light.ui.tone.danger.foreground, themePalettes['lime-road'].light.ui.tone.danger.background, 4.5],
  ['lime-road/dark textTertiary', themePalettes['lime-road'].dark, themePalettes['lime-road'].dark.textTertiary, themePalettes['lime-road'].dark.ui.card.defaultBackground, 4.5],
  ['lime-road/dark input placeholder', themePalettes['lime-road'].dark, themePalettes['lime-road'].dark.ui.input.placeholderForeground, themePalettes['lime-road'].dark.ui.input.background, 4.5],
  ['lime-road/dark disabled input foreground', themePalettes['lime-road'].dark, themePalettes['lime-road'].dark.ui.input.disabledForeground, themePalettes['lime-road'].dark.ui.input.disabledBackground, 4.5],
  ['lime-road/dark disabled control foreground', themePalettes['lime-road'].dark, themePalettes['lime-road'].dark.ui.control.disabledForeground, themePalettes['lime-road'].dark.ui.control.disabledBackground, 4.5],
  ['lime-road/dark textSecondary on muted card', themePalettes['lime-road'].dark, themePalettes['lime-road'].dark.textSecondary, themePalettes['lime-road'].dark.ui.card.mutedBackground, 4.5],
  ['lime-road/dark body text on code surface', themePalettes['lime-road'].dark, themePalettes['lime-road'].dark.ui.code.text, themePalettes['lime-road'].dark.ui.code.background, 7],
  ['lime-road/dark user message foreground', themePalettes['lime-road'].dark, themePalettes['lime-road'].dark.ui.message.userForeground, themePalettes['lime-road'].dark.ui.message.userBackground, 7],
  ['lime-road/dark danger tone on muted surface', themePalettes['lime-road'].dark, themePalettes['lime-road'].dark.ui.tone.danger.foreground, themePalettes['lime-road'].dark.ui.semantic.surface.muted, 4.5],
  ['lime-road/light action item', themePalettes['lime-road'].light, themePalettes['lime-road'].light.textSecondary, themePalettes['lime-road'].light.ui.card.mutedBackground, 4.5],
  ['lime-road/light title on base surface', themePalettes['lime-road'].light, themePalettes['lime-road'].light.text, themePalettes['lime-road'].light.ui.semantic.surface.base, 7],
  ['lime-road/dark title on base surface', themePalettes['lime-road'].dark, themePalettes['lime-road'].dark.text, themePalettes['lime-road'].dark.ui.semantic.surface.base, 7],
]

for (const family of ['minimal', 'monet', 'material', 'liquid-glass']) {
  for (const mode of ['light', 'dark']) {
    for (const accent of ['#000', '#FFF', '#FF0', '#4963A6']) {
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
        `${family}/${mode} custom ${accent} table header`,
        theme,
        theme.textSecondary,
        theme.ui.table.headerBackground,
        4.5,
      ])
    }
  }
}

for (const family of ['minimal', 'monet', 'material', 'liquid-glass']) {
  for (const mode of ['light', 'dark']) {
    const theme = themePalettes[family][mode]
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

for (const family of ['minimal', 'monet', 'material', 'liquid-glass']) {
  for (const mode of ['light', 'dark']) {
    const theme = themePalettes[family][mode]
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
for (const [label, theme, fg, bg, minRatio] of checks) {
  const ratio = visibleContrast(theme, fg, bg)
  const ok = typeof ratio === 'number' && ratio >= minRatio
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${ratio?.toFixed(2) ?? 'n/a'} >= ${minRatio}`)
  if (!ok) failures.push(label)
}

if (failures.length) {
  console.error(`theme contrast self-test failed: ${failures.join(', ')}`)
  process.exit(1)
}
