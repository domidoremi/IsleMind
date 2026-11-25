import { createContext, forwardRef, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react'
import { Platform, Text as NativeText, TextInput as NativeTextInput, type TextProps, type TextInputProps } from 'react-native'
import { APP_FONT_FAMILY } from '@/theme/font'
import { getColors, type AppPalette } from '@/theme/colors'
import { resolveWebTextMetricsStyle } from './webTextMetrics'
import { useAppUpdateBlocker } from '@/hooks/useAppUpdateBlocker'

export const AppFontContext = createContext(APP_FONT_FAMILY)
export const AppTextThemeContext = createContext<{ colors: AppPalette; mode: 'light' | 'dark' }>({
  colors: getColors('light', 'minimal'), mode: 'light',
})
const TextAncestorContext = createContext(false)

export type Text = NativeText
export const Text = forwardRef<NativeText, TextProps>(function AppText({ style, ...props }, ref) {
  const fontFamily = useContext(AppFontContext)
  const { colors } = useContext(AppTextThemeContext)
  const nested = useContext(TextAncestorContext)
  const metrics = resolveWebTextMetricsStyle(style)
  const defaults = nested ? undefined : { fontFamily, color: colors.text }
  return <TextAncestorContext.Provider value={true}>
    <NativeText {...props} ref={ref} style={metrics ? [defaults, style, metrics] : [defaults, style]} />
  </TextAncestorContext.Provider>
})
export type TextInput = NativeTextInput
export const TextInput = Object.assign(forwardRef<NativeTextInput, TextInputProps>(function AppTextInput({ style, onFocus, onBlur, ...props }, ref) {
  const fontFamily = useContext(AppFontContext)
  const { colors, mode } = useContext(AppTextThemeContext)
  const [focused, setFocused] = useState(false)
  useAppUpdateBlocker(focused, 'input-focus')
  const inputRef = useRef<NativeTextInput>(null)
  const detachInputRef = useRef<(() => void) | undefined>(undefined)
  const setInputRef = useCallback((input: NativeTextInput | null) => {
    detachInputRef.current?.()
    inputRef.current = input
    if (!input) return
    const cleanup: unknown = typeof ref === 'function' ? ref(input) : undefined
    if (ref && typeof ref !== 'function') ref.current = input
    const detach = () => {
      if (detachInputRef.current !== detach) return
      detachInputRef.current = undefined
      if (inputRef.current === input) inputRef.current = null
      if (typeof cleanup === 'function') cleanup()
      else if (typeof ref === 'function') ref(null)
      else if (ref) ref.current = null
    }
    detachInputRef.current = detach
    return detach
  }, [ref])
  useLayoutEffect(() => () => {
    // Release only this input while its native host can still receive blur.
    const input = inputRef.current
    if (input?.isFocused?.()) input.blur()
  }, [])
  const metrics = resolveWebTextMetricsStyle(style)
  return <NativeTextInput
    placeholderTextColor={colors.ui.input.placeholderForeground}
    selectionColor={Platform.OS === 'ios' ? colors.ui.input.focus : colors.design?.semantic.color.selection ?? colors.ui.input.focus}
    cursorColor={colors.ui.input.focus} selectionHandleColor={colors.ui.input.focus}
    keyboardAppearance={mode} underlineColorAndroid="transparent"
    {...props} ref={setInputRef}
    onFocus={(event) => { setFocused(true); onFocus?.(event) }}
    onBlur={(event) => { setFocused(false); onBlur?.(event) }}
    style={metrics ? [{ fontFamily, color: colors.text }, style, metrics] : [{ fontFamily, color: colors.text }, style]} />
}), { State: NativeTextInput.State })
