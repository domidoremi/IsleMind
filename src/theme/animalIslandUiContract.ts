import type { CanonicalThemeId } from '@/types/settingsContracts'

import { THEME_EXPERIENCE_EXTENSIONS, type AnimalIslandUiThemeSupport } from './themeMotion'

const themeSupport = {
  minimal: THEME_EXPERIENCE_EXTENSIONS.minimal.animalIslandUi,
  monet: THEME_EXPERIENCE_EXTENSIONS.monet.animalIslandUi,
  material: THEME_EXPERIENCE_EXTENSIONS.material.animalIslandUi,
  'liquid-glass': THEME_EXPERIENCE_EXTENSIONS['liquid-glass'].animalIslandUi,
} as const satisfies Record<CanonicalThemeId, AnimalIslandUiThemeSupport>

export const ANIMAL_ISLAND_UI_CONTRACT = {
  packageName: 'animal-island-ui',
  reviewedVersion: '1.5.1',
  reviewedCommit: '803cffa197d7030c75ef1f7adeca70fcc8df0779',
  reviewedAt: '2026-08-07',
  integration: 'react-native-contract-adaptation',
  themeSupport,
  forbiddenUpstreamDependencies: [
    'react-dom',
    'Less modules',
    'upstream web fonts',
    'upstream bitmap assets',
  ],
} as const
