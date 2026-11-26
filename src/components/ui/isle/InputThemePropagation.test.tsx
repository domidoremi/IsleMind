import { fireEvent, render } from '@testing-library/react-native'
import { Platform, type TextInputProps } from 'react-native'
import { TextInput } from '@/components/ui/AppText'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import { IsleInput } from './IsleKit'
import { IsleSearchField } from './SearchField'
import { IsleThemeProvider } from './IsleThemeProvider'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))

const cases = CANONICAL_THEME_IDS.flatMap(family => (['android', 'ios', 'web'] as const).flatMap(platform =>
  (['text', 'field', 'search'] as const).map(kind => ({ family, platform, kind }))))
type FieldKind = typeof cases[number]['kind']

function theme(family: CanonicalThemeId, mode: 'light' | 'dark') {
  const colors = getColors(mode, family)
  jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design!, canonicalThemeId: family,
    mode, isDark: mode === 'dark' } as ReturnType<typeof useAppTheme>)
  return colors
}
function editor(kind: FieldKind, props: TextInputProps) {
  const field = kind === 'field' ? <IsleInput {...props} />
    : kind === 'search' ? <IsleSearchField {...props} clearAccessibilityLabel="Clear search" />
      : <TextInput {...props} />
  return <IsleThemeProvider>{field}</IsleThemeProvider>
}
const unspecified = {
  placeholderTextColor: undefined, selectionColor: undefined, cursorColor: undefined,
  selectionHandleColor: undefined, keyboardAppearance: undefined, underlineColorAndroid: undefined,
  disableFullscreenUI: undefined,
}
afterEach(() => jest.restoreAllMocks())

it.each(cases)('projects $family $platform editing defaults into the $kind without replacing its focused draft', async ({ family, platform, kind }) => {
  jest.replaceProperty(Platform, 'OS', platform)
  const focus = jest.fn(), blur = jest.fn(), change = jest.fn()
  const tree = () => editor(kind, { accessibilityLabel: 'Retained editor', value: '保留 Draft 下書き', selection: { start: 2, end: 7 },
    onFocus: focus, onBlur: blur, onChangeText: change })
  theme(family, 'light')
  const screen = await render(tree()), original = screen.getByLabelText('Retained editor')
  await fireEvent(original, 'focus', { nativeEvent: {} })
  for (const mode of ['light', 'dark'] as const) {
    const colors = theme(family, mode)
    await screen.rerender(tree())
    const field = screen.getByLabelText('Retained editor')
    expect(field).toBe(original)
    expect(field.props).toMatchObject({ placeholderTextColor: colors.ui.input.placeholderForeground,
      selectionColor: platform === 'ios' ? colors.ui.input.focus : colors.design!.semantic.color.selection,
      cursorColor: colors.ui.input.focus, selectionHandleColor: colors.ui.input.focus,
      keyboardAppearance: mode, underlineColorAndroid: 'transparent', disableFullscreenUI: true,
      value: '保留 Draft 下書き', selection: { start: 2, end: 7 } })
  }
  expect(focus).toHaveBeenCalledTimes(1)
  expect(blur).not.toHaveBeenCalled()
  expect(change).not.toHaveBeenCalled()
  await fireEvent.changeText(original, 'Changed 草稿')
  expect(change).toHaveBeenCalledWith('Changed 草稿')
  await screen.unmount()
})

it.each(cases)('keeps $family $platform $kind on theme defaults when optional editing props are undefined', async ({ family, platform, kind }) => {
  jest.replaceProperty(Platform, 'OS', platform)
  const colors = theme(family, 'dark')
  const screen = await render(editor(kind, { accessibilityLabel: 'Optional editor', value: 'Kept', ...unspecified }))
  expect(screen.getByLabelText('Optional editor').props).toMatchObject({
    placeholderTextColor: colors.ui.input.placeholderForeground,
    selectionColor: platform === 'ios' ? colors.ui.input.focus : colors.design!.semantic.color.selection,
    cursorColor: colors.ui.input.focus, selectionHandleColor: colors.ui.input.focus,
    keyboardAppearance: 'dark', underlineColorAndroid: 'transparent', disableFullscreenUI: true, value: 'Kept',
  })
  await screen.unmount()
})

it.each(cases)('preserves deliberate $family $platform $kind editing overrides and input behavior', async ({ family, platform, kind }) => {
  jest.replaceProperty(Platform, 'OS', platform)
  theme(family, 'dark')
  const change = jest.fn()
  const screen = await render(editor(kind, { accessibilityLabel: 'Custom editor', value: 'Custom draft',
    selectionColor: '#123456', cursorColor: '#234567', selectionHandleColor: '#345678', keyboardAppearance: 'light',
    underlineColorAndroid: '#456789', disableFullscreenUI: false, returnKeyType: 'search', keyboardType: 'web-search',
    autoCapitalize: 'none', onChangeText: change }))
  const field = screen.getByLabelText('Custom editor')
  expect(field.props).toMatchObject({ selectionColor: '#123456', cursorColor: '#234567', selectionHandleColor: '#345678',
    keyboardAppearance: 'light', underlineColorAndroid: kind !== 'text' && family === 'liquid-glass' ? 'transparent' : '#456789',
    disableFullscreenUI: false, returnKeyType: 'search', keyboardType: 'web-search', autoCapitalize: 'none', value: 'Custom draft' })
  await fireEvent.changeText(field, 'Updated custom draft')
  expect(change).toHaveBeenCalledWith('Updated custom draft')
  await screen.unmount()
})
