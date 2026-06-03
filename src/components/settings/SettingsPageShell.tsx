import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BackHandler, findNodeHandle, Keyboard, Platform, ScrollView, TextInput, View } from 'react-native'
import { router, usePathname } from 'expo-router'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { AnimatedNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { IsleHeader } from '@/components/ui/isle'
import { IsleScreen } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

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
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const pathname = usePathname()
  const scrollRef = useRef<ScrollView>(null)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const androidKeyboardPadding = Platform.OS === 'android' ? keyboardHeight : 0

  function scrollFocusedInputAboveKeyboard() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        type TextInputState = {
          currentlyFocusedField?: () => number | null
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
            : textInputState?.currentlyFocusedField?.() ?? null
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
      setTimeout(scrollFocusedInputAboveKeyboard, 120)
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
      router.replace('/settings')
      return true
    })
    return () => subscription.remove()
  }, [pathname])

  return (
    <IsleScreen padded={false} background="surface" backgroundState={keyboardHeight > 0 ? 'input' : 'idle'}>
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 56 + androidKeyboardPadding }}
      >
        <IsleHeader
          title={title}
          subtitle={subtitle}
          leading={
            <AnimatedNavigationTrigger variant="iconButton" label={t('common.back')} size="lg" glyph="back" onNavigate={() => router.replace('/settings')} color={colors.text} />
          }
        />
        <MotiView
          key={focusKey ?? title}
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 22, stiffness: 190 }}
          style={{ paddingTop: 16 }}
        >
          <View style={{ gap: 12 }}>
            {children}
          </View>
        </MotiView>
      </ScrollView>
    </IsleScreen>
  )
}
