import { createContext, forwardRef, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react'
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
  return <NativeTextInput {...props} ref={setInputRef}
    onFocus={(event) => { setFocused(true); onFocus?.(event) }}
    onBlur={(event) => { setFocused(false); onBlur?.(event) }}
    style={metrics ? [{ fontFamily }, style, metrics] : [{ fontFamily }, style]} />
}), { State: NativeTextInput.State })
