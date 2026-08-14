import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'
import {
  PRODUCT_MOBILE_COMPOSER_COLLAPSED_MIN_HEIGHT,
  resolveProductMobileComposerLayout,
} from '@/presentation/layout/productMobileLayout'

export function useChatWorkspaceKeyboardState({
  active,
  windowHeight,
  windowWidth,
  safeAreaBottom,
}: {
  active: boolean
  windowHeight: number
  windowWidth: number
  safeAreaBottom: number
}) {
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [keyboardBaselineHeight, setKeyboardBaselineHeight] = useState(windowHeight)
  const [composerFocused, setComposerFocused] = useState(false)
  const [composerHeight, setComposerHeight] = useState(PRODUCT_MOBILE_COMPOSER_COLLAPSED_MIN_HEIGHT)

  const androidResizeInset = Platform.OS === 'android' && keyboardHeight > 0
    ? Math.max(0, keyboardBaselineHeight - windowHeight)
    : 0
  const keyboardLift = Platform.OS === 'android'
    ? Math.max(0, keyboardHeight - androidResizeInset)
    : keyboardHeight
  const composerLayout = resolveProductMobileComposerLayout(windowWidth, {
    composerHeight,
    safeAreaBottom,
    keyboardLift,
  })
  const keyboardVisible = keyboardHeight > 0 || composerFocused

  useEffect(() => {
    if (keyboardHeight <= 0 || windowHeight > keyboardBaselineHeight) {
      setKeyboardBaselineHeight(windowHeight)
    }
  }, [keyboardBaselineHeight, keyboardHeight, windowHeight])

  useEffect(() => {
    if (!active) return undefined
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      const nextHeight = Math.max(0, Math.ceil(event.endCoordinates.height))
      setKeyboardHeight((current) => Math.abs(current - nextHeight) < 2 ? current : nextHeight)
    })
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardHeight((current) => current === 0 ? current : 0)
    })
    return () => {
      show.remove()
      hide.remove()
    }
  }, [active])

  return {
    composerBottomInset: composerLayout.bottomInset,
    composerLayout,
    keyboardLift,
    keyboardVisible,
    setComposerFocused,
    setComposerHeight,
  }
}
