import { useEffect, useState } from 'react'
import {
  Keyboard,
  Platform,
  type KeyboardEvent,
  type KeyboardEventEasing,
} from 'react-native'
import {
  PRODUCT_MOBILE_COMPOSER_COLLAPSED_MIN_HEIGHT,
  resolveProductMobileComposerLayout,
} from '@/presentation/layout/productMobileLayout'

export const COMPOSER_KEYBOARD_FALLBACK_DURATION_MS = 232

export interface ComposerKeyboardMotion {
  durationMs: number
  easing: KeyboardEventEasing
  phase: 'show' | 'hide'
}

interface ResolveComposerKeyboardLiftInput {
  platform: 'android' | 'ios' | 'web' | 'windows' | 'macos' | 'native'
  keyboardHeight: number
  baselineWindowHeight: number
  windowHeight: number
}

export function resolveComposerKeyboardLift({
  platform,
  keyboardHeight,
  baselineWindowHeight,
  windowHeight,
}: ResolveComposerKeyboardLiftInput): number {
  const androidResizeInset = platform === 'android' && keyboardHeight > 0
    ? Math.max(0, baselineWindowHeight - windowHeight)
    : 0
  return platform === 'android'
    ? Math.max(0, keyboardHeight - androidResizeInset)
    : Math.max(0, keyboardHeight)
}

export function normalizeComposerKeyboardMotion(
  event: Pick<KeyboardEvent, 'duration' | 'easing'>,
  phase: ComposerKeyboardMotion['phase'],
): ComposerKeyboardMotion {
  const durationMs = Number.isFinite(event.duration) && event.duration > 0
    ? Math.round(event.duration)
    : COMPOSER_KEYBOARD_FALLBACK_DURATION_MS
  return {
    durationMs,
    easing: event.easing,
    phase,
  }
}

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
  const [keyboardBaselineHeight, setKeyboardBaselineHeight] =
    useState(windowHeight)
  const [keyboardMotion, setKeyboardMotion] =
    useState<ComposerKeyboardMotion>({
      durationMs: COMPOSER_KEYBOARD_FALLBACK_DURATION_MS,
      easing: 'keyboard',
      phase: 'hide',
    })
  const [composerFocused, setComposerFocused] = useState(false)
  const [composerHeight, setComposerHeight] =
    useState(PRODUCT_MOBILE_COMPOSER_COLLAPSED_MIN_HEIGHT)

  const keyboardLift = resolveComposerKeyboardLift({
    platform: Platform.OS,
    keyboardHeight,
    baselineWindowHeight: keyboardBaselineHeight,
    windowHeight,
  })
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
    const applyEvent = (
      event: KeyboardEvent,
      phase: ComposerKeyboardMotion['phase'],
    ) => {
      Keyboard.scheduleLayoutAnimation(event)
      const nextHeight = phase === 'hide'
        ? 0
        : Math.max(0, Math.ceil(event.endCoordinates.height))
      setKeyboardMotion(normalizeComposerKeyboardMotion(event, phase))
      setKeyboardHeight((current) =>
        Math.abs(current - nextHeight) < 2 ? current : nextHeight
      )
    }

    const subscriptions = Platform.OS === 'ios'
      ? [
        Keyboard.addListener('keyboardWillShow', (event) =>
          applyEvent(event, 'show')
        ),
        Keyboard.addListener('keyboardWillHide', (event) =>
          applyEvent(event, 'hide')
        ),
        Keyboard.addListener('keyboardWillChangeFrame', (event) =>
          applyEvent(
            event,
            event.endCoordinates.height > 0 ? 'show' : 'hide',
          )
        ),
      ]
      : [
        Keyboard.addListener('keyboardDidShow', (event) =>
          applyEvent(event, 'show')
        ),
        Keyboard.addListener('keyboardDidHide', (event) =>
          applyEvent(event, 'hide')
        ),
      ]
    return () => {
      for (const subscription of subscriptions) subscription.remove()
    }
  }, [active])

  return {
    composerBottomInset: composerLayout.bottomInset,
    composerLayout,
    keyboardLift,
    keyboardMotion,
    keyboardVisible,
    setComposerFocused,
    setComposerHeight,
  }
}
