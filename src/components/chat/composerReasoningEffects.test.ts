import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'
import type { ReasoningControlValue } from '@/utils/modelReasoning'
import { resolveReasoningEffortEffect } from './composerReasoningEffects'

const levels: ReasoningControlValue[] = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

it.each(CANONICAL_THEME_IDS)('keeps level identities distinct in both modes of %s', themeId => {
  for (const mode of ['light', 'dark'] as const) {
    const colors = getColors(mode, themeId)
    const effects = levels.map(level => resolveReasoningEffortEffect(level, colors, mode === 'dark'))
    expect(new Set(effects.map(effect => effect.end)).size).toBe(levels.length)
    const off = effects[1]
    expect(off).toMatchObject({ themeId, core: 'hollow', rings: 0, sparks: 0, halo: 0, duration: 0, pop: 1, turn: 0, lift: 0 })
    expect(effects[0].core).toBe('pearl')
    expect(effects[2].core).toBe('seed')
    expect(effects[7].core).toBe('star')
    expect(effects[8].sparks).toBeGreaterThan(effects[7].sparks)
    for (const effect of effects) {
      expect(effect.start).toMatch(/^#[0-9a-f]{6}$/i)
      expect(effect.end).toMatch(/^#[0-9a-f]{6}$/i)
      expect(effect.duration).toBeLessThan(1000)
    }
  }
})

it.each(CANONICAL_THEME_IDS)('uses the custom accent without energizing the off state in %s', themeId => {
  const red = getColors('light', themeId, undefined, '#DC5863')
  const blue = getColors('light', themeId, undefined, '#317BB7')
  for (const level of ['default', 'high'] as const) {
    expect(resolveReasoningEffortEffect(level, red, false).end)
      .not.toBe(resolveReasoningEffortEffect(level, blue, false).end)
  }
  expect(resolveReasoningEffortEffect('none', red, false))
    .toEqual(resolveReasoningEffortEffect('none', blue, false))
})

it('uses quiet motion for minimal, refraction for glass and a bounce for the island', () => {
  const effect = (themeId: typeof CANONICAL_THEME_IDS[number]) =>
    resolveReasoningEffortEffect('max', getColors('light', themeId), false)
  const minimal = effect('minimal')
  const glass = effect('liquid-glass')
  const island = effect('animal-island-ui')
  expect(minimal.halo).toBe(0)
  expect(minimal.turn).toBe(0)
  expect(minimal.duration).toBeLessThan(effect('material').duration)
  expect(glass.turn).toBeGreaterThan(effect('monet').turn)
  expect(glass.borderOpacity).toBeGreaterThan(effect('material').borderOpacity)
  expect(island.lift).toBeLessThan(0)
  expect(island.pop).toBeGreaterThan(glass.pop)
})
