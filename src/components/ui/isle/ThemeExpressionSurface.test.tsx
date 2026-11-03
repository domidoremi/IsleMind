import { render } from '@testing-library/react-native'
import { useEffect } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'

import { getColors } from '@/theme/colors'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { GlassSurfaceActivity } from './GlassSurface'
import { ThemeExpressionSurface } from './ThemeExpressionSurface'

it.each(['chrome', 'composer'] as const)(
  'retains the native %s content host through hidden-page theme transitions',
  async kind => {
    const mounted = jest.fn()
    const unmounted = jest.fn()
    function LiveContent() {
      useEffect(() => {
        mounted()
        return unmounted
      }, [])
      return <TextInput testID="live-surface-input" value="Unsent draft" selection={{ start: 4, end: 4 }} />
    }
    const tree = (family: CanonicalThemeId, mode: 'light' | 'dark', active: boolean) => (
      <GlassSurfaceActivity active={active}>
        <View style={{ opacity: active ? 1 : 0 }}>
          <ThemeExpressionSurface family={family} colors={getColors(mode, family)} kind={kind} testID="live-surface">
            <LiveContent />
          </ThemeExpressionSurface>
        </View>
      </GlassSurfaceActivity>
    )
    const screen = await render(tree('minimal', 'dark', true))
    const input = screen.getByTestId('live-surface-input')
    const nativeHost = input.parent

    for (const family of ['material', 'minimal', 'monet', 'liquid-glass', 'animal-island-ui', 'minimal', 'material'] as const) {
      for (const active of [false, true]) {
        await screen.rerender(tree(family, active ? 'light' : 'dark', active))
        expect(screen.getByTestId('live-surface').props.collapsable).toBe(false)
        expect(nativeHost?.props.collapsable).toBe(false)
        expect(screen.getByTestId('live-surface-input')).toBe(input)
        expect(input.parent).toBe(nativeHost)
        expect(input.props.value).toBe('Unsent draft')
        expect(input.props.selection).toEqual({ start: 4, end: 4 })
      }
    }
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(unmounted).not.toHaveBeenCalled()
  },
)

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
