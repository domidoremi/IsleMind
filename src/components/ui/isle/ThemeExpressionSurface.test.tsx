import { render } from '@testing-library/react-native'
import { StyleSheet, Text } from 'react-native'

import { getColors } from '@/theme/colors'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { ThemeExpressionSurface } from './ThemeExpressionSurface'

describe('ThemeExpressionSurface markdown nesting', () => {
  it.each(['light', 'dark'] as const)(
    'pairs the island user foreground with its message background in %s mode',
    async mode => {
      for (const accent of [undefined, '#2357BD']) {
        const colors = getColors(mode, 'animal-island-ui', undefined, accent)
        const screen = await render(
          <ThemeExpressionSurface family="animal-island-ui" colors={colors} kind="message" isUser testID="island-user-bubble">
            <Text style={{ color: colors.ui.message.userForeground }}>User message</Text>
          </ThemeExpressionSurface>,
        )
        expect(StyleSheet.flatten(screen.getByTestId('island-user-bubble').props.style).backgroundColor)
          .toBe(colors.ui.message.userBackground)
        await screen.unmount()
      }
    },
  )

  it.each<CanonicalThemeId>(['minimal', 'monet', 'material', 'liquid-glass'])(
    'does not shrink the intrinsic user-message width a second time in %s',
    async family => {
      const screen = await render(
        <ThemeExpressionSurface family={family} colors={getColors('light', family)} kind="message" isUser testID="user-bubble">
          <Text>好的</Text>
        </ThemeExpressionSurface>,
      )
      const style = StyleSheet.flatten(screen.getByTestId('user-bubble').props.style)
      expect(style.maxWidth).toBe('100%')
      expect(style.width).toBeUndefined()
      expect(style.alignSelf).toBe('flex-end')
      expect(screen.getByText('好的')).toBeTruthy()
    },
  )

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
