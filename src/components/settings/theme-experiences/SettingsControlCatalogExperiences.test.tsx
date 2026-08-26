import { render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import type { CanonicalThemeId } from '@/types/settingsContracts'
import { SettingsControlCatalog } from './SettingsControlCatalogExperiences'

jest.mock('moti', () => ({
  MotiView: ({ children, ...props }: { children?: React.ReactNode }) => {
    const React = jest.requireActual('react')
    return React.createElement('View', props, children)
  },
}))

let mockThemeId: CanonicalThemeId = 'material'

jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/isle', () => {
  const React = jest.requireActual('react')
  const { Pressable } = jest.requireActual('react-native')
  return {
    IslePressable: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement(Pressable, props, children),
  }
})

jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({
    canonicalThemeId: mockThemeId,
    colors: jest.requireActual('@/theme/colors').getColors('light', mockThemeId),
  }),
}))

describe('SettingsControlCatalog surface hierarchy', () => {
  it.each<CanonicalThemeId>(['monet', 'material', 'liquid-glass'])(
    'keeps the %s row icon on the card surface without another background',
    async (family) => {
      mockThemeId = family
      const screen = await render(
        <SettingsControlCatalog
          compact
          entries={[{
            key: 'sample',
            title: 'Sample',
            detail: 'One line',
            icon: 'settings',
            onPress: jest.fn(),
          }]}
        />,
      )

      const style = StyleSheet.flatten(
        screen.getByTestId(`settings-control-icon-${family}-sample`).props.style,
      )
      expect(style.backgroundColor).toBe('transparent')
      expect(style.borderWidth ?? 0).toBe(0)
    },
  )
})
