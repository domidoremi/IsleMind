import { fireEvent, render } from '@testing-library/react-native'
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native'

import { MonetSettingsPageExperience } from './SettingsPageExperiences'

let mockMode: 'light' | 'dark' = 'light'

jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({
    canonicalThemeId: 'monet',
    colors: jest.requireActual('@/theme/colors').getColors(mockMode, 'monet'),
  }),
}))

jest.mock('@/components/ui/AppText', () => ({
  Text: jest.requireActual('react-native').Text,
}))

jest.mock('@/components/ui/isle/GlassSurface', () => ({
  GlassSurface: jest.requireActual('react-native').View,
}))

const scenarios = (['light', 'dark'] as const)
  .flatMap(mode => [true, false].map(compact => ({ mode, compact })))

it.each(scenarios)(
  'keeps the rotated Monet wash inside inline bounds without clipping content ($mode, compact=$compact)',
  async ({ mode, compact }) => {
    mockMode = mode
    const onEdit = jest.fn()
    const screen = await render(
      <MonetSettingsPageExperience
        title="Models & answers"
        rootTitle="Settings"
        routeKey="preferences"
        compact={compact}
        leading={<View />}
      >
        <Pressable testID="interactive-content" onPress={onEdit} />
      </MonetSettingsPageExperience>,
    )
    const surface = screen.getByTestId('settings-detail-surface-monet')
    const washes = surface.queryAll(node => {
      const style = StyleSheet.flatten(node.props.style)
      return node.props.pointerEvents === 'none' && style.width === 132 && style.height === 42
    })
    expect(washes).toHaveLength(1)
    const decoration = StyleSheet.flatten(washes[0].props.style) as ViewStyle
    expect(decoration.position).toBe('absolute')
    expect(decoration.transform).toEqual([{ rotate: '4deg' }])
    expect(decoration.opacity).toBe(0.12)

    // Rotation expands the painted rectangle beyond its untransformed width.
    const radians = 4 * Math.PI / 180
    const paintedWidth = 132 * Math.cos(radians) + 42 * Math.sin(radians)
    const rotationBleed = (paintedWidth - 132) / 2
    expect(typeof decoration.right).toBe('number')
    expect(decoration.right as number).toBeGreaterThanOrEqual(rotationBleed)
    const content = StyleSheet.flatten(surface.props.style) as ViewStyle
    const fraction = Number.parseFloat(String(content.width)) / 100
    for (const viewportWidth of [280, 320, 360, 860]) {
      const paintedRight = (content.marginLeft as number) + viewportWidth * fraction
        - (decoration.right as number) + rotationBleed
      expect(paintedRight).toBeLessThanOrEqual(viewportWidth)
    }
    expect(content.paddingTop).toBe(compact ? 12 : 16)
    expect(content.overflow).not.toBe('hidden')
    expect(StyleSheet.flatten(screen.getByTestId('settings-page-experience-monet').props.style).overflow)
      .not.toBe('hidden')
    await fireEvent.press(screen.getByTestId('interactive-content'))
    expect(onEdit).toHaveBeenCalledTimes(1)
  },
)
