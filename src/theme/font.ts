import type { CanonicalThemeId } from '@/types/settingsContracts'

/** SIL OFL, static Regular (400): Android otherwise uses the variable face's Thin default. */
export const APP_FONT_FAMILY = 'NotoSansSC'

// Keep functional sans typography for the three precision-oriented themes;
// editorial and handwritten themes use real CJK faces, not synthetic weights.
export function fontFamilyForTheme(family: CanonicalThemeId): string {
  if (family === 'monet') return 'NotoSerifSC'
  if (family === 'animal-island-ui') return 'LXGWWenKai'
  return APP_FONT_FAMILY
}
