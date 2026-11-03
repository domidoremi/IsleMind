import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet, type PressableProps } from 'react-native'
import { getColors } from '@/theme/colors'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { SettingsNavigationRow } from './SettingsNavigationRow'

let mockTheme: CanonicalThemeId = 'minimal'
let mockRowStyle: PressableProps['style']
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: require('@/theme/colors').getColors('light', mockTheme),
    canonicalThemeId: mockTheme,
  }),
}))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/isle', () => ({
  IslePressable: (props: PressableProps) => {
    mockRowStyle = props.style
    return require('react').createElement(require('react-native').Pressable, props)
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockTheme = 'minimal'
})

it.each(['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'] as const)(
  '%s responds across the full row without moving the touch target',
  async family => {
    mockTheme = family
    const onPress = jest.fn()
    const screen = await render(
      <SettingsNavigationRow title="Appearance" status="Light" icon="settings" id="row" onPress={onPress} />,
    )
    if (typeof mockRowStyle === 'function') throw new Error('Animated pressables need resolved row styles')
    const idle = StyleSheet.flatten(mockRowStyle)
    await fireEvent(screen.getByTestId('row'), 'pressIn')
    if (typeof mockRowStyle === 'function') throw new Error('Animated pressables need resolved row styles')
    const pressed = StyleSheet.flatten(mockRowStyle)
    expect(pressed.backgroundColor).toBe(getColors('light', family).ui.semantic.surface.muted)
    expect(pressed.minHeight).toBe(idle.minHeight)
    expect(pressed.paddingHorizontal).toBe(idle.paddingHorizontal)
    expect(pressed.paddingVertical).toBe(idle.paddingVertical)
    expect(pressed.flexDirection).toBe(idle.flexDirection)
    expect(pressed.flexDirection).toBe('row')
    await fireEvent(screen.getByTestId('row'), 'pressOut')
    expect(screen.getByTestId('row')).toHaveStyle({ backgroundColor: idle.backgroundColor })
    await fireEvent.press(screen.getByLabelText('Appearance, Light'))
    expect(onPress).toHaveBeenCalledTimes(1)
  },
)

it('keeps Material tiles stacked throughout press feedback', async () => {
  mockTheme = 'material'
  const screen = await render(
    <SettingsNavigationRow title="Appearance" icon="settings" id="row" tile onPress={jest.fn()} />,
  )
  const geometry = { minHeight: 106, width: '48%', flexDirection: 'column' } as const
  expect(screen.getByTestId('row')).toHaveStyle(geometry)
  await fireEvent(screen.getByTestId('row'), 'pressIn')
  expect(screen.getByTestId('row')).toHaveStyle(geometry)
  await fireEvent(screen.getByTestId('row'), 'pressOut')
  expect(screen.getByTestId('row')).toHaveStyle(geometry)
})

it('keeps a visible keyboard focus boundary after a press', async () => {
  const screen = await render(
    <SettingsNavigationRow title="Appearance" icon="settings" id="row" onPress={jest.fn()} />,
  )
  await fireEvent(screen.getByTestId('row'), 'focus')
  await fireEvent(screen.getByTestId('row'), 'pressIn')
  await fireEvent(screen.getByTestId('row'), 'pressOut')
  expect(screen.getByTestId('row')).toHaveStyle({
    borderColor: getColors('light', 'minimal').ui.semantic.control.focus,
  })
})

it('keeps workspace list labels within an explicitly full-width row during feedback', async () => {
  mockTheme = 'material'
  const screen = await render(
    <SettingsNavigationRow title="Appearance" status="Material" icon="settings" id="row" workspace onPress={jest.fn()} />,
  )
  const row = screen.getByTestId('row')
  expect(row).toHaveStyle({ width: '100%', flexShrink: 0, flexDirection: 'row' })
  expect(screen.getByText('Appearance')).toBeTruthy()
  expect(screen.getByText('Material')).toBeTruthy()
  await fireEvent(row, 'pressIn')
  expect(row).toHaveStyle({ width: '100%', flexShrink: 0, flexDirection: 'row' })
})
