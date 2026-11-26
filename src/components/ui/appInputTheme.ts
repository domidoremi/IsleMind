import type { TextInputProps } from 'react-native'
import type { AppPalette } from '@/theme/colors'

type InputThemeOverrides = Pick<TextInputProps,
  'placeholderTextColor' | 'selectionColor' | 'cursorColor' | 'selectionHandleColor'
  | 'keyboardAppearance' | 'underlineColorAndroid' | 'disableFullscreenUI'>

/** Keep every input host on the same theme defaults, including shared controls. */
export function resolveAppInputThemeProps(
  colors: AppPalette,
  mode: 'light' | 'dark',
  platform: string,
  overrides: InputThemeOverrides = {},
): InputThemeOverrides {
  return {
    placeholderTextColor: overrides.placeholderTextColor ?? colors.ui.input.placeholderForeground,
    selectionColor: overrides.selectionColor ?? (platform === 'ios'
      ? colors.ui.input.focus
      : colors.design?.semantic.color.selection ?? colors.ui.input.focus),
    cursorColor: overrides.cursorColor ?? colors.ui.input.focus,
    selectionHandleColor: overrides.selectionHandleColor ?? colors.ui.input.focus,
    keyboardAppearance: overrides.keyboardAppearance ?? mode,
    underlineColorAndroid: overrides.underlineColorAndroid ?? 'transparent',
    disableFullscreenUI: overrides.disableFullscreenUI ?? true,
  }
}
