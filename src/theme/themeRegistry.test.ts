import { appearanceColors } from 'animal-island-ui-rn/theme'
import { CANONICAL_THEME_IDS, normalizeThemeFamilyValue } from '@/types/settingsContracts'
import { normalizeSettingsThemeFamily } from '@/modules/settings/appearance'
import { getColors, normalizeThemeId, themeIds } from './colors'
import { resolveThemeDesignTokens } from './themeTokens'

it('retains the fork theme through the shared settings and runtime boundary', () => {
  expect(CANONICAL_THEME_IDS).toContain('animal-island-ui')
  expect(themeIds).toEqual(CANONICAL_THEME_IDS)
  expect(normalizeSettingsThemeFamily('animal-island-ui')).toBe('animal-island-ui')
  expect(normalizeThemeFamilyValue(' ANIMAL-ISLAND-UI ')).toBe('animal-island-ui')
  expect(normalizeThemeId('animal-island-ui')).toBe('animal-island-ui')
  expect(normalizeThemeId('island')).toBe('minimal')
})

it.each(['light', 'dark'] as const)('projects %s colors from the fork rather than a copied palette', (mode) => {
  const palette = getColors(mode, 'animal-island-ui')
  expect(palette.background.canvas).toBe(appearanceColors[mode].canvas)
  expect(palette.text).toBe(appearanceColors[mode].onSurface)
  expect(resolveThemeDesignTokens('animal-island-ui', mode).family).toBe('animal-island-ui')
})
