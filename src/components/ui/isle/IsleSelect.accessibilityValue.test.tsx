import { fireEvent, render } from '@testing-library/react-native'
import { Platform } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { IsleSelect } from './IsleKit'
import { IsleThemeProvider } from './IsleThemeProvider'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 24, left: 0 }) }))

const originalPlatform = Platform.OS
beforeEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' }))
afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform }))

it.each(['light', 'dark'] as const)('reports the committed native selection through changes and disabling in %s mode', async mode => {
  const colors = getColors(mode, 'animal-island-ui')
  jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design!, canonicalThemeId: 'animal-island-ui', mode, isDark: mode === 'dark' } as ReturnType<typeof useAppTheme>)
  const onChange = jest.fn()
  const options = [{ value: 'key-a', label: 'Connection A' }, { value: 'key-b', label: 'Connection B' }]
  const control = (value: string, disabled = false) => <IsleThemeProvider><IsleSelect testID="connection" accessibilityLabel="Connection" value={value} options={options} disabled={disabled} onChange={onChange} /></IsleThemeProvider>
  const screen = await render(control('key-a'))
  expect(screen.getByRole('combobox', { name: 'Connection' })).toHaveAccessibilityValue({ text: 'Connection A' })
  await fireEvent.press(screen.getByRole('combobox', { name: 'Connection' }))
  await fireEvent.press(screen.getByTestId('connection-option-key-b'))
  expect(onChange).toHaveBeenCalledWith('key-b')
  expect(screen.getByRole('combobox', { name: 'Connection' })).toHaveAccessibilityValue({ text: 'Connection A' })
  await screen.rerender(control('key-b'))
  expect(screen.getByRole('combobox', { name: 'Connection' })).toHaveAccessibilityValue({ text: 'Connection B' })
  await screen.rerender(control('key-b', true))
  expect(screen.getByRole('combobox', { name: 'Connection' })).toBeDisabled()
  expect(screen.getByRole('combobox', { name: 'Connection' })).toHaveAccessibilityValue({ text: 'Connection B' })
  expect(screen.queryByTestId('connection-listbox')).toBeNull()
})

it('reports the visible placeholder when a stored native value is not in the available options', async () => {
  const colors = getColors('dark', 'animal-island-ui')
  jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design!, canonicalThemeId: 'animal-island-ui', mode: 'dark', isDark: true } as ReturnType<typeof useAppTheme>)
  const screen = await render(<IsleThemeProvider><IsleSelect accessibilityLabel="Connection" placeholder="Choose a connection" value="removed-key" options={[{ value: 'key-a', label: 'Connection A' }]} /></IsleThemeProvider>)
  expect(screen.getByRole('combobox', { name: 'Connection' })).toHaveAccessibilityValue({ text: 'Choose a connection' })
})
