import { act, fireEvent, render } from '@testing-library/react-native'
import { Platform } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { IsleSelect } from './IsleKit'
import { IsleThemeProvider } from './IsleThemeProvider'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: jest.fn(() => 'none') }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 33, bottom: 24, left: 33, right: 0 }),
}))

const nativePlatform = Platform.OS
beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  const colors = getColors('dark', 'animal-island-ui')
  jest.mocked(useAppTheme).mockReturnValue({
    colors, design: colors.design!, canonicalThemeId: 'animal-island-ui', mode: 'dark', isDark: true,
  } as ReturnType<typeof useAppTheme>)
})
afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: nativePlatform }))

it('keeps the native menu inside the safe rectangle when the measured panel would cross the status bar', async () => {
  const screen = await render(<IsleThemeProvider><IsleSelect testID="scene-target" placeholder="Choose"
    options={[{ label: 'New draft', value: 'new' }, { label: 'Existing', value: 'existing' }]} /></IsleThemeProvider>)
  await fireEvent.press(screen.getByText('Choose'))
  const viewport = screen.getByTestId('scene-target-viewport')
  await fireEvent(viewport, 'layout', { persist: () => {}, nativeEvent: { layout: { width: 873, height: 393, x: 0, y: 0 } } })
  const menu = screen.getByTestId('scene-target-listbox')
  await fireEvent(menu, 'layout', { nativeEvent: { layout: { width: 300, height: 320, x: 0, y: 0 } } })
  expect(menu).toHaveStyle({ top: 45, maxHeight: 312, maxWidth: 816 })
  expect(menu.props.style.flat(Infinity).find((value: any) => value?.left !== undefined).left).toBeGreaterThanOrEqual(45)
})

it('reconstrains an open long menu when the keyboard reduces its measured viewport', async () => {
  const screen = await render(<IsleThemeProvider><IsleSelect testID="scene-target" placeholder="Choose"
    options={Array.from({ length: 12 }, (_, index) => ({ label: 'Option ' + index, value: String(index) }))} /></IsleThemeProvider>)
  await fireEvent.press(screen.getByText('Choose'))
  const viewport = screen.getByTestId('scene-target-viewport')
  await fireEvent(viewport, 'layout', { persist: () => {}, nativeEvent: { layout: { width: 320, height: 240, x: 0, y: 0 } } })
  expect(screen.getByTestId('scene-target-listbox')).toHaveStyle({ top: 45, maxHeight: 159, maxWidth: 263 })
  expect(screen.getByTestId('scene-target-options').props.keyboardShouldPersistTaps).toBe('handled')
  expect(screen.getByTestId('scene-target-option-11')).toHaveStyle({ minHeight: 44 })
})

it('native Back closes without changing the selection and disabled options cannot activate', async () => {
  const onChange = jest.fn()
  const screen = await render(<IsleThemeProvider><IsleSelect testID="scene-target" placeholder="Choose"
    options={[{ label: 'Unavailable', value: 'off', disabled: true }, { label: 'Available', value: 'on' }]}
    onChange={onChange} /></IsleThemeProvider>)
  await fireEvent.press(screen.getByText('Choose'))
  await fireEvent.press(screen.getByTestId('scene-target-option-off'))
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByTestId('scene-target-option-off').props.focusable).toBe(false)
  await act(() => screen.getByTestId('scene-target-modal').props.onRequestClose())
  expect(screen.queryByTestId('scene-target-listbox')).toBeNull()
  expect(onChange).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByText('Choose'))
  await fireEvent.press(screen.getByTestId('scene-target-option-on'))
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenCalledWith('on')
  expect(screen.queryByTestId('scene-target-listbox')).toBeNull()
})
