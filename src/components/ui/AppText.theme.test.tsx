import { createRef } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { Platform, TextInput as NativeInput } from 'react-native'
import { Text, TextInput } from './AppText'
import { IsleThemeProvider } from './isle/IsleThemeProvider'
import { getColors } from '@/theme/colors'
import { useAppTheme } from '@/hooks/useAppTheme'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))

function theme(id: CanonicalThemeId, mode: 'light' | 'dark') {
  const colors = getColors(mode, id)
  jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design, canonicalThemeId: id, mode,
    isDark: mode === 'dark' } as ReturnType<typeof useAppTheme>)
  return colors
}

it('updates all text and editing colors through five themes and both modes while retaining the focused draft', async () => {
  theme('minimal', 'light')
  const ref = createRef<NativeInput>()
  const focus = jest.fn(), blur = jest.fn()
  const tree = () => <IsleThemeProvider>
    <Text testID="default-text">主题 Theme テーマ</Text>
    <Text testID="custom-text" style={{ color: '#123456' }}>Custom</Text>
    <Text testID="parent-text" style={{ color: '#abcdef' }}><Text testID="nested-text">Inherited</Text></Text>
    <TextInput ref={ref} testID="draft" value="保留 Draft 下書き" selection={{ start: 2, end: 7 }} onFocus={focus} onBlur={blur} />
    <TextInput testID="custom-input" style={{ color: '#123456', fontFamily: 'monospace' }}
      placeholderTextColor="#345678" selectionColor="#456789" cursorColor="#56789a" keyboardAppearance="light" />
  </IsleThemeProvider>
  const screen = await render(tree())
  const host = ref.current
  await fireEvent(screen.getByTestId('draft'), 'focus', { nativeEvent: {} })
  for (const id of CANONICAL_THEME_IDS) for (const mode of ['light', 'dark'] as const) {
    const colors = theme(id, mode)
    await screen.rerender(tree())
    expect(screen.getByTestId('default-text')).toHaveStyle({ color: colors.text })
    expect(screen.getByTestId('draft')).toHaveStyle({ color: colors.text })
    expect(screen.getByTestId('draft').props).toMatchObject({
      placeholderTextColor: colors.ui.input.placeholderForeground,
      selectionColor: Platform.OS === 'ios' ? colors.ui.input.focus : colors.design!.semantic.color.selection,
      cursorColor: colors.ui.input.focus,
      selectionHandleColor: colors.ui.input.focus,
      underlineColorAndroid: 'transparent', keyboardAppearance: mode,
      value: '保留 Draft 下書き', selection: { start: 2, end: 7 },
    })
    expect(screen.getByTestId('nested-text').props.style).not.toEqual(expect.arrayContaining([expect.objectContaining({ color: colors.text })]))
    expect(screen.getByTestId('custom-text')).toHaveStyle({ color: '#123456' })
    expect(screen.getByTestId('custom-input')).toHaveStyle({ color: '#123456', fontFamily: 'monospace' })
    expect(screen.getByTestId('custom-input').props).toMatchObject({ placeholderTextColor: '#345678',
      selectionColor: '#456789', cursorColor: '#56789a', keyboardAppearance: 'light' })
    expect(ref.current).toBe(host)
  }
  expect(focus).toHaveBeenCalledTimes(1)
  expect(blur).not.toHaveBeenCalled()
})
