import { createContext, forwardRef, useContext, useState } from 'react'
import { Text as NativeText, TextInput as NativeTextInput, type TextProps, type TextInputProps } from 'react-native'
import { APP_FONT_FAMILY } from '@/theme/font'
import { resolveWebTextMetricsStyle } from './webTextMetrics'
import { useAppUpdateBlocker } from '@/hooks/useAppUpdateBlocker'

export const AppFontContext = createContext(APP_FONT_FAMILY)

export type Text = NativeText
export const Text = forwardRef<NativeText, TextProps>(function AppText({ style, ...props }, ref) {
  const fontFamily = useContext(AppFontContext)
  const metrics = resolveWebTextMetricsStyle(style)
  return <NativeText {...props} ref={ref} style={metrics ? [{ fontFamily }, style, metrics] : [{ fontFamily }, style]} />
})
export type TextInput = NativeTextInput
export const TextInput = Object.assign(forwardRef<NativeTextInput, TextInputProps>(function AppTextInput({ style, onFocus, onBlur, ...props }, ref) {
  const fontFamily = useContext(AppFontContext)
  const [focused, setFocused] = useState(false)
  useAppUpdateBlocker(focused, 'input-focus')
  const metrics = resolveWebTextMetricsStyle(style)
  return <NativeTextInput {...props} ref={ref}
    onFocus={(event) => { setFocused(true); onFocus?.(event) }}
    onBlur={(event) => { setFocused(false); onBlur?.(event) }}
    style={metrics ? [{ fontFamily }, style, metrics] : [{ fontFamily }, style]} />
}), { State: NativeTextInput.State })
