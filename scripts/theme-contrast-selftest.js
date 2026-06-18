#!/usr/bin/env bun

const { themePalettes } = await import('../src/theme/colors')

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
  ['glass/light textTertiary', themePalettes.glass.light, themePalettes.glass.light.textTertiary, themePalettes.glass.light.ui.card.defaultBackground, 3.5],
  ['glass/light input placeholder', themePalettes.glass.light, themePalettes.glass.light.ui.input.placeholderForeground, themePalettes.glass.light.ui.input.background, 3.5],
  ['glass/light disabled input foreground', themePalettes.glass.light, themePalettes.glass.light.ui.input.disabledForeground, themePalettes.glass.light.ui.input.disabledBackground, 4.5],
  ['glass/light disabled control foreground', themePalettes.glass.light, themePalettes.glass.light.ui.control.disabledForeground, themePalettes.glass.light.ui.control.disabledBackground, 4.5],
  ['glass/light textSecondary on chrome background', themePalettes.glass.light, themePalettes.glass.light.textSecondary, themePalettes.glass.light.ui.semantic.chrome.background, 4.5],
  ['glass/light textSecondary on action item', themePalettes.glass.light, themePalettes.glass.light.textSecondary, themePalettes.glass.light.ui.actionBar.itemBackground, 4.5],
  ['glass/light body text on code surface', themePalettes.glass.light, themePalettes.glass.light.ui.code.text, themePalettes.glass.light.ui.code.background, 7],
  ['glass/light user message foreground', themePalettes.glass.light, themePalettes.glass.light.ui.message.userForeground, themePalettes.glass.light.ui.message.userBackground, 7],
  ['glass/light tertiary text on table header', themePalettes.glass.light, themePalettes.glass.light.textSecondary, themePalettes.glass.light.ui.table.headerBackground, 4.5],
  ['glass/light warning tone', themePalettes.glass.light, themePalettes.glass.light.ui.tone.warning.foreground, themePalettes.glass.light.ui.tone.warning.background, 4.5],
  ['glass/light danger tone', themePalettes.glass.light, themePalettes.glass.light.ui.tone.danger.foreground, themePalettes.glass.light.ui.tone.danger.background, 4.5],
  ['glass/light info tone', themePalettes.glass.light, themePalettes.glass.light.ui.tone.info.foreground, themePalettes.glass.light.ui.tone.info.background, 4.5],
  ['glass/dark textTertiary', themePalettes.glass.dark, themePalettes.glass.dark.textTertiary, themePalettes.glass.dark.ui.card.defaultBackground, 4.5],
  ['glass/dark input placeholder', themePalettes.glass.dark, themePalettes.glass.dark.ui.input.placeholderForeground, themePalettes.glass.dark.ui.input.background, 4.5],
  ['glass/dark disabled input foreground', themePalettes.glass.dark, themePalettes.glass.dark.ui.input.disabledForeground, themePalettes.glass.dark.ui.input.disabledBackground, 4.5],
  ['glass/dark disabled control foreground', themePalettes.glass.dark, themePalettes.glass.dark.ui.control.disabledForeground, themePalettes.glass.dark.ui.control.disabledBackground, 4.5],
  ['glass/dark textSecondary on chrome background', themePalettes.glass.dark, themePalettes.glass.dark.textSecondary, themePalettes.glass.dark.ui.semantic.chrome.background, 4.5],
  ['glass/dark action item', themePalettes.glass.dark, themePalettes.glass.dark.textSecondary, themePalettes.glass.dark.ui.actionBar.itemBackground, 4.5],
  ['glass/dark body text on code surface', themePalettes.glass.dark, themePalettes.glass.dark.ui.code.text, themePalettes.glass.dark.ui.code.background, 7],
  ['glass/dark user message foreground', themePalettes.glass.dark, themePalettes.glass.dark.ui.message.userForeground, themePalettes.glass.dark.ui.message.userBackground, 7],
  ['glass/dark textSecondary on table header', themePalettes.glass.dark, themePalettes.glass.dark.textSecondary, themePalettes.glass.dark.ui.table.headerBackground, 4.5],
  ['cartoon/light textTertiary', themePalettes.cartoon.light, themePalettes.cartoon.light.textTertiary, themePalettes.cartoon.light.ui.card.defaultBackground, 3.5],
  ['cartoon/light input placeholder', themePalettes.cartoon.light, themePalettes.cartoon.light.ui.input.placeholderForeground, themePalettes.cartoon.light.ui.input.background, 3.5],
  ['cartoon/light disabled input foreground', themePalettes.cartoon.light, themePalettes.cartoon.light.ui.input.disabledForeground, themePalettes.cartoon.light.ui.input.disabledBackground, 4.5],
  ['cartoon/light disabled control foreground', themePalettes.cartoon.light, themePalettes.cartoon.light.ui.control.disabledForeground, themePalettes.cartoon.light.ui.control.disabledBackground, 4.5],
  ['cartoon/light textSecondary on muted card', themePalettes.cartoon.light, themePalettes.cartoon.light.textSecondary, themePalettes.cartoon.light.ui.card.mutedBackground, 4.5],
  ['cartoon/light body text on code surface', themePalettes.cartoon.light, themePalettes.cartoon.light.ui.code.text, themePalettes.cartoon.light.ui.code.background, 7],
  ['cartoon/light user message foreground', themePalettes.cartoon.light, themePalettes.cartoon.light.ui.message.userForeground, themePalettes.cartoon.light.ui.message.userBackground, 7],
  ['cartoon/light danger tone', themePalettes.cartoon.light, themePalettes.cartoon.light.ui.tone.danger.foreground, themePalettes.cartoon.light.ui.tone.danger.background, 4.5],
  ['cartoon/dark textTertiary', themePalettes.cartoon.dark, themePalettes.cartoon.dark.textTertiary, themePalettes.cartoon.dark.ui.card.defaultBackground, 4.5],
  ['cartoon/dark input placeholder', themePalettes.cartoon.dark, themePalettes.cartoon.dark.ui.input.placeholderForeground, themePalettes.cartoon.dark.ui.input.background, 4.5],
  ['cartoon/dark disabled input foreground', themePalettes.cartoon.dark, themePalettes.cartoon.dark.ui.input.disabledForeground, themePalettes.cartoon.dark.ui.input.disabledBackground, 4.5],
  ['cartoon/dark disabled control foreground', themePalettes.cartoon.dark, themePalettes.cartoon.dark.ui.control.disabledForeground, themePalettes.cartoon.dark.ui.control.disabledBackground, 4.5],
  ['cartoon/dark textSecondary on muted card', themePalettes.cartoon.dark, themePalettes.cartoon.dark.textSecondary, themePalettes.cartoon.dark.ui.card.mutedBackground, 4.5],
  ['cartoon/dark body text on code surface', themePalettes.cartoon.dark, themePalettes.cartoon.dark.ui.code.text, themePalettes.cartoon.dark.ui.code.background, 7],
  ['cartoon/dark user message foreground', themePalettes.cartoon.dark, themePalettes.cartoon.dark.ui.message.userForeground, themePalettes.cartoon.dark.ui.message.userBackground, 7],
  ['cartoon/dark danger tone on muted surface', themePalettes.cartoon.dark, themePalettes.cartoon.dark.ui.tone.danger.foreground, themePalettes.cartoon.dark.ui.semantic.surface.muted, 4.5],
  ['cartoon/light action item', themePalettes.cartoon.light, themePalettes.cartoon.light.textSecondary, themePalettes.cartoon.light.ui.card.mutedBackground, 4.5],
  ['cartoon/light title on base surface', themePalettes.cartoon.light, themePalettes.cartoon.light.text, themePalettes.cartoon.light.ui.semantic.surface.base, 7],
  ['cartoon/dark title on base surface', themePalettes.cartoon.dark, themePalettes.cartoon.dark.text, themePalettes.cartoon.dark.ui.semantic.surface.base, 7],
]

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
