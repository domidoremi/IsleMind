import { render } from '@testing-library/react-native'
import { StyleSheet, Text } from 'react-native'

import { getColors } from '@/theme/colors'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { ThemeExpressionSurface } from './ThemeExpressionSurface'

describe('ThemeExpressionSurface markdown nesting', () => {
  it.each<CanonicalThemeId>(['monet', 'material', 'liquid-glass'])(
    'keeps ordinary markdown transparent inside the %s message surface',
    async (family) => {
      const colors = getColors('light', family)
      const screen = await render(
        <ThemeExpressionSurface
          family={family}
          colors={colors}
          kind="markdown"
          testID={`markdown-${family}`}
        >
          <Text>One line</Text>
        </ThemeExpressionSurface>,
      )

      const style = StyleSheet.flatten(screen.getByTestId(`markdown-${family}`).props.style)
      expect(style.backgroundColor).toBe('transparent')
      expect(style.borderWidth).toBe(0)
      expect(style.paddingHorizontal ?? 0).toBe(0)
      expect(style.paddingVertical ?? 0).toBe(0)
    },
  )

  it.each<CanonicalThemeId>(['monet', 'material', 'liquid-glass'])(
    'keeps the %s message content surface flush with its parent bubble',
    async (family) => {
      const colors = getColors('dark', family)
      const screen = await render(
        <ThemeExpressionSurface family={family} colors={colors} kind="message-content" testID={`content-${family}`}>
          <Text>One line</Text>
        </ThemeExpressionSurface>,
      )

      const style = StyleSheet.flatten(screen.getByTestId(`content-${family}`).props.style)
      expect(style.backgroundColor).toBe('transparent')
      expect(style.borderWidth).toBe(0)
      expect(style.paddingHorizontal ?? 0).toBe(0)
      expect(style.paddingVertical ?? 0).toBe(0)
    },
  )
})
