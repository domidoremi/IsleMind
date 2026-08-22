import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { BackHandler, findNodeHandle, Keyboard, Platform, ScrollView, TextInput, useWindowDimensions } from 'react-native'
import { router, useLocalSearchParams, usePathname } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AnimatedNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { IsleScreen } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { resolveSettingsChildReturnAction } from '@/presentation/app-shell/routeReturnPolicy'
import {
  LiquidGlassSettingsPageExperience,
  MaterialSettingsPageExperience,
  MinimalSettingsPageExperience,
  MonetSettingsPageExperience,
} from '@/components/settings/theme-experiences/SettingsPageExperiences'
export function SettingsPageShell({
  title,
  subtitle,
  children,
  focusKey,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  focusKey?: string
}) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { t } = useTranslation()
  const pathname = usePathname()
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>()
  const { width } = useWindowDimensions()
  const compact = width < 430
  const scrollRef = useRef<ScrollView>(null)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const returnToSettings = useCallback(() => {
    const action = resolveSettingsChildReturnAction(params.returnTo, router.canGoBack())
    if (action.kind === 'back') {
      router.back()
      return
    }
    router.replace(action.pathname)
  }, [params.returnTo])

  function scrollFocusedInputAboveKeyboard() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        type TextInputState = {
          currentlyFocusedInput?: () => unknown
        }
        type ScrollResponder = {
          scrollResponderScrollNativeHandleToKeyboard?: (
            nodeHandle: number | null,
            additionalOffset?: number,
            preventNegativeScrollOffset?: boolean,
          ) => void
        }
        const textInputState = (TextInput as unknown as { State?: TextInputState }).State
        const focusedInput = textInputState?.currentlyFocusedInput?.()
        const focusedHandle = typeof focusedInput === 'number'
          ? focusedInput
          : focusedInput
            ? findNodeHandle(focusedInput as Parameters<typeof findNodeHandle>[0])
            : null
        if (!focusedHandle) return
        const responder = (scrollRef.current as unknown as { getScrollResponder?: () => ScrollResponder }).getScrollResponder?.()
        responder?.scrollResponderScrollNativeHandleToKeyboard?.(focusedHandle, 96, true)
      })
    })
  }

  useEffect(() => {
    const showSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height)
      scrollFocusedInputAboveKeyboard()
      setTimeout(scrollFocusedInputAboveKeyboard, 112)
    })
    const hideSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardHeight(0)
    })
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [])

  useEffect(() => {
    if (Platform.OS !== 'android' || pathname === '/settings') return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (keyboardHeight > 0) {
        Keyboard.dismiss()
        return true
      }
      returnToSettings()
      return true
    })
    return () => subscription.remove()
  }, [keyboardHeight, pathname, returnToSettings])

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false })
  }, [focusKey])

  const Experience = canonicalThemeId === 'monet'
    ? MonetSettingsPageExperience
    : canonicalThemeId === 'material'
      ? MaterialSettingsPageExperience
      : canonicalThemeId === 'liquid-glass'
        ? LiquidGlassSettingsPageExperience
        : MinimalSettingsPageExperience
  const leading = (
    <AnimatedNavigationTrigger variant="iconButton" label={t('common.back')} size="sm" glyph="back" onNavigate={returnToSettings} color={colors.text} />
  )

  return (
    <IsleScreen padded={false} background="surface" backgroundState={keyboardHeight > 0 ? 'input' : 'idle'}>
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        removeClippedSubviews={Platform.OS === 'android'}
        contentContainerStyle={{ alignItems: 'center', paddingHorizontal: compact ? 14 : 18, paddingTop: compact ? 6 : 10, paddingBottom: compact ? 40 : 48 }}
      >
        <Experience title={title} subtitle={subtitle} rootTitle={t('settings.title')} routeKey={pathname.split('/').filter(Boolean).pop() ?? 'settings'} compact={compact} leading={leading}>
          {children}
        </Experience>
      </ScrollView>
    </IsleScreen>
  )
}
