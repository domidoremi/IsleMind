import { createContext, forwardRef, useContext } from 'react'
import { Text as NativeText, TextInput as NativeTextInput, type TextProps, type TextInputProps } from 'react-native'
import { APP_FONT_FAMILY } from '@/theme/font'

export const AppFontContext = createContext(APP_FONT_FAMILY)

export type Text = NativeText
export const Text = forwardRef<NativeText, TextProps>(function AppText({ style, ...props }, ref) {
  const fontFamily = useContext(AppFontContext)
  return <NativeText {...props} ref={ref} style={[{ fontFamily }, style]} />
})
export type TextInput = NativeTextInput
export const TextInput = Object.assign(forwardRef<NativeTextInput, TextInputProps>(function AppTextInput({ style, ...props }, ref) {
  const fontFamily = useContext(AppFontContext)
  return <NativeTextInput {...props} ref={ref} style={[{ fontFamily }, style]} />
}), { State: NativeTextInput.State })
