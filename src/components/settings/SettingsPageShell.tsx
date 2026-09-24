import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { BackHandler, findNodeHandle, Keyboard, Platform, ScrollView, TextInput, View, useWindowDimensions } from 'react-native'
import { router, useLocalSearchParams, useNavigation, usePathname } from 'expo-router'
import { useIsFocused } from 'expo-router/react-navigation'
import { useTranslation } from 'react-i18next'
import { AnimatedNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { IsleScreen } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { resolveSettingsChildReturnAction } from '@/presentation/app-shell/routeReturnPolicy'
import { settingsHelpTopic } from '@/presentation/features/settings/settingsRegistry'
import { SettingsHelpButton } from './SettingsHelp'
import { SettingsEditBoundary, useSettingsLeave } from './SettingsEditBoundary'
import { SettingsSectionContext } from './SettingsSection'
import { LiquidGlassSettingsPageExperience, MaterialSettingsPageExperience, MinimalSettingsPageExperience, MonetSettingsPageExperience } from './theme-experiences/SettingsPageExperiences'

type Props = { title: string; subtitle?: string; children: ReactNode; focusKey?: string; scrollable?: boolean }
export function SettingsPageShell(props: Props) {
  return <SettingsEditBoundary><SettingsPageFrame {...props} /></SettingsEditBoundary>
}
function SettingsPageFrame({ title, children, scrollable = true }: Props) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { t } = useTranslation()
  const pathname = usePathname()
  const params = useLocalSearchParams<{ returnTo?: string | string[]; section?: string; locate?: string }>()
  const { width, fontScale } = useWindowDimensions()
  const compact = width / fontScale < 430
  const motion = useMotionPreference()
  const motionRef = useRef(motion)
  motionRef.current = motion
  const leave = useSettingsLeave()
  const navigation = useNavigation()
  const focused = useIsFocused()
  const scrollRef = useRef<ScrollView>(null)
  const contentRef = useRef<View>(null)
  const nodes = useRef(new Map<string, View>())
  const positions = useRef(new Map<string, number>())
  const viewport = useRef<{ id: string; offset: number } | null>(null)
  const restore = useRef<{ id: string; offset: number } | null>(null)
  const previousSize = useRef({ width, fontScale })
  useLayoutEffect(() => {
    if (previousSize.current.width !== width || previousSize.current.fontScale !== fontScale) restore.current = viewport.current
    previousSize.current = { width, fontScale }
  }, [width, fontScale])
  const epoch = useRef(0)
  const consumed = useRef<string | undefined>(undefined)
  const keyboardFrame = useRef<number | null>(null)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [highlight, setHighlight] = useState<string>()
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [transitioning, setTransitioning] = useState(Platform.OS !== 'web' && (navigation.getState()?.index ?? 0) > 0)
  const ready = useRef(false)
  ready.current = focused && !transitioning
  const target = typeof params.section === 'string' ? params.section : undefined
  const targetRef = useRef(target)
  targetRef.current = target
  const locate = useCallback(() => {
    const id = targetRef.current
    const node = id ? nodes.current.get(id) : undefined
    if (!id || !node || !contentRef.current || !ready.current || consumed.current === id) return
    const request = epoch.current
    node.measureLayout(contentRef.current, (_x, y) => {
      if (request !== epoch.current || !ready.current || targetRef.current !== id || consumed.current === id) return
      consumed.current = id
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: motionRef.current === 'full' })
      setHighlight(id)
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
      highlightTimer.current = setTimeout(() => setHighlight(undefined), 1800)
    }, () => undefined)
  }, [])
  const register = useCallback((id: string, node: View | null) => {
    if (node) {
      nodes.current.set(id, node)
      const request = epoch.current
      if (contentRef.current) node.measureLayout(contentRef.current, (_x, y) => {
        if (request !== epoch.current) return
        positions.current.set(id, y)
        if (restore.current?.id === id && ready.current && (!targetRef.current || consumed.current === targetRef.current)) {
          scrollRef.current?.scrollTo({ y: Math.max(0, y + restore.current.offset), animated: false })
          restore.current = null
        }
      }, () => undefined)
    } else { nodes.current.delete(id); positions.current.delete(id) }
    locate()
  }, [locate])
  const cancel = useCallback(() => {
    epoch.current += 1; restore.current = null; consumed.current = targetRef.current
    if (keyboardFrame.current !== null) { cancelAnimationFrame(keyboardFrame.current); keyboardFrame.current = null }
  }, [])
  useLayoutEffect(() => {
    epoch.current += 1
    consumed.current = undefined
    locate()
  }, [target, params.locate, pathname, locate])
  useEffect(() => {
    if (!focused) { cancel(); return }
    locate()
  }, [focused, transitioning, locate, cancel])
  useEffect(() => {
    const nav = navigation as unknown as { addListener: (name: string, listener: () => void) => () => void }
    const start = nav.addListener('transitionStart', () => { ready.current = false; setTransitioning(true) })
    const end = nav.addListener('transitionEnd', () => setTransitioning(false))
    return () => { start(); end() }
  }, [navigation])
  useEffect(() => () => {
    epoch.current += 1
    if (keyboardFrame.current !== null) cancelAnimationFrame(keyboardFrame.current)
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
  }, [])
  const returnToSettings = useCallback(() => {
    void leave(() => {
      const action = resolveSettingsChildReturnAction(params.returnTo, router.canGoBack())
      if (action.kind === 'back') router.back()
      else router.replace(action.pathname)
    })
  }, [params.returnTo, leave])
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', event => {
      setKeyboardHeight(event.endCoordinates.height)
      if (keyboardFrame.current !== null) cancelAnimationFrame(keyboardFrame.current)
      keyboardFrame.current = requestAnimationFrame(() => {
        keyboardFrame.current = null
        if (!ready.current || (targetRef.current && consumed.current !== targetRef.current)) return
        const input = TextInput.State.currentlyFocusedInput()
        if (!input) return
        const responder = scrollRef.current?.getScrollResponder()
        responder?.scrollResponderScrollNativeHandleToKeyboard(findNodeHandle(input as unknown as Parameters<typeof findNodeHandle>[0]), 96, true)
      })
    })
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0)
      if (keyboardFrame.current !== null) cancelAnimationFrame(keyboardFrame.current)
    })
    return () => { show.remove(); hide.remove(); if (keyboardFrame.current !== null) cancelAnimationFrame(keyboardFrame.current) }
  }, [])
  useEffect(() => {
    if (!focused || Platform.OS !== 'android') return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (keyboardHeight) Keyboard.dismiss()
      else returnToSettings()
      return true
    })
    return () => subscription.remove()
  }, [focused, keyboardHeight, returnToSettings])
  const Experience = canonicalThemeId === 'monet' ? MonetSettingsPageExperience : canonicalThemeId === 'material' ? MaterialSettingsPageExperience : canonicalThemeId === 'liquid-glass' ? LiquidGlassSettingsPageExperience : MinimalSettingsPageExperience
  const leading = <AnimatedNavigationTrigger variant="iconButton" label={t('common.back')} size="sm" glyph="back" onNavigate={returnToSettings} color={colors.text} />
  const content = <View ref={contentRef} collapsable={false} style={{ width: '100%', maxWidth: 860, alignSelf: 'center', flex: scrollable ? undefined : 1 }}>
    <Experience title={title} rootTitle={t('settings.title')} routeKey={pathname.split('/').filter(Boolean).pop() ?? 'settings'} compact={compact} leading={leading}>
      {null}
    </Experience>
    <SettingsHelpButton topic={settingsHelpTopic(pathname)} />
    <View style={scrollable ? undefined : { flex: 1 }}>{children}</View>
  </View>
  return <IsleScreen padded={false} background="surface" backgroundState={keyboardHeight ? 'input' : 'idle'}>
    <SettingsSectionContext.Provider value={{ target: focused && !transitioning ? target : undefined, highlight, register }}>
      {scrollable ? <ScrollView ref={scrollRef} {...(Platform.OS === 'web' ? { onWheel: cancel, onTouchMove: cancel } : {})} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets removeClippedSubviews={false} onScrollBeginDrag={cancel} scrollEventThrottle={64} onScroll={event => {
        const offset = event.nativeEvent.contentOffset.y
        const entry = [...positions.current].filter(([, y]) => y <= offset + 16).sort((a, b) => b[1] - a[1])[0]
        viewport.current = entry ? { id: entry[0], offset: offset - entry[1] } : null
      }} onContentSizeChange={() => { nodes.current.forEach((node, id) => register(id, node)); locate() }} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: compact ? 14 : 18, paddingTop: 8, paddingBottom: 48 }}>{content}</ScrollView> : content}
    </SettingsSectionContext.Provider>
  </IsleScreen>
}
