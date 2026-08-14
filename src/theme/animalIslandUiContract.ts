import type { ThemeId } from '@/types/settingsContracts'

import { THEME_EXPERIENCE_EXTENSIONS, type AnimalIslandUiThemeSupport } from './themeMotion'

const themeSupport = {
  minimal: THEME_EXPERIENCE_EXTENSIONS.minimal.animalIslandUi,
  'lime-road': THEME_EXPERIENCE_EXTENSIONS['lime-road'].animalIslandUi,
  markdown: THEME_EXPERIENCE_EXTENSIONS.markdown.animalIslandUi,
} as const satisfies Record<ThemeId, AnimalIslandUiThemeSupport>

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
