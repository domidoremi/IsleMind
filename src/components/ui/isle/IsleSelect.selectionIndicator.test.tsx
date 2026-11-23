import { fireEvent, render, within } from '@testing-library/react-native'
import { Platform, StyleSheet } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { IsleSelect } from './IsleKit'
import { IsleThemeProvider } from './IsleThemeProvider'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: ({ name, color }: { name: string; color: string }) =>
  require('react').createElement(require('react-native').View, { testID: `icon-${name}`, style: { color } }),
}))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 24, left: 0 }) }))

const originalPlatform = Platform.OS
beforeEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' }))
afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform }))
const labels = {
  en: ['Same connection · service.example:8443 · First model', 'Same connection · service.example:8444 · Second model'],
  ja: ['同じ接続名 · service.example:8443 · 最初のモデル', '同じ接続名 · service.example:8444 · 次のモデル'],
  'zh-CN': ['同名连接 · service.example:8443 · 第一个模型', '同名连接 · service.example:8444 · 第二个模型'],
}
function contrast(first: string, second: string) {
  function luminance(hex: string) {
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
    const channels = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
const cases = (['light', 'dark'] as const).flatMap(mode => (['en', 'ja', 'zh-CN'] as const).map(language => ({ mode, language })))
it.each(cases)('$language/$mode shows exactly one non-color selection marker and moves it only after a committed change', async ({ mode, language }) => {
  const colors = getColors(mode, 'animal-island-ui')
  jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design!, canonicalThemeId: 'animal-island-ui', mode, isDark: mode === 'dark' } as ReturnType<typeof useAppTheme>)
  const onChange = jest.fn(), options = [{ value: 'a', label: labels[language][0] }, { value: 'b', label: labels[language][1] }, { value: 'off', label: 'Unavailable', disabled: true }]
  const control = (value: string) => <IsleThemeProvider><IsleSelect testID="connection" accessibilityLabel="Connection" value={value} options={options} onChange={onChange} /></IsleThemeProvider>
  const screen = await render(control('a'))
  await fireEvent.press(screen.getByRole('combobox', { name: 'Connection' }))
  const first = screen.getByRole('option', { name: options[0].label })
  const second = screen.getByRole('option', { name: options[1].label })
  const marker = within(first).queryAllByTestId('icon-check', { includeHiddenElements: true })
  expect(marker).toHaveLength(1)
  expect(within(second).queryAllByTestId('icon-check', { includeHiddenElements: true })).toHaveLength(0)
  expect(marker[0].parent?.props.accessible).toBe(false)
  expect(marker[0].parent?.props.importantForAccessibility).toBe('no-hide-descendants')
  expect(first.props.accessibilityState).toEqual({ selected: true, disabled: false })
  expect(second.props.accessibilityState).toEqual({ selected: false, disabled: false })
  const background = StyleSheet.flatten(first.props.style).backgroundColor
  expect(contrast(StyleSheet.flatten(marker[0].props.style).color, background)).toBeGreaterThanOrEqual(4.5)
  expect(first).toHaveStyle({ minHeight: 44 })
  await fireEvent.press(screen.getByRole('option', { name: 'Unavailable' }))
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByTestId('connection-listbox')).toBeTruthy()
  await fireEvent.press(second)
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenCalledWith('b')
  expect(screen.queryByTestId('connection-listbox')).toBeNull()
  expect(screen.getByRole('combobox', { name: 'Connection' })).toHaveAccessibilityValue({ text: options[0].label })
  await screen.rerender(control('b'))
  await fireEvent.press(screen.getByRole('combobox', { name: 'Connection' }))
  expect(within(screen.getByRole('option', { name: options[0].label })).queryAllByTestId('icon-check', { includeHiddenElements: true })).toHaveLength(0)
  const next = screen.getByRole('option', { name: options[1].label })
  expect(within(next).queryAllByTestId('icon-check', { includeHiddenElements: true })).toHaveLength(1)
  expect(next.props.accessibilityState.selected).toBe(true)
  expect(screen.getByRole('combobox', { name: 'Connection', includeHiddenElements: true })).toHaveAccessibilityValue({ text: options[1].label })
  await screen.unmount()
})
