import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { BackHandler, Platform, StyleSheet, View } from 'react-native'
import { router, usePathname } from 'expo-router'

import { IsleMotionFrame, IsleScreen, type IsleBackgroundMode, type IsleBackgroundState } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { ThemeMotionDirection } from '@/theme/themeMotion'
import { createLazyComponent } from '@/utils/lazyLoad'

import { HomeScreenContent } from './HomeScreenContent'
import { MainPagerGestureLockProvider, useMainPagerGestureLock } from './MainPagerGestureLock'

const LazyConversationsScreenContent = createLazyComponent(
  () => import('./ConversationsScreenContent').then((module) => ({ default: module.ConversationsScreenContent })),
)
const LazySettingsScreenContent = createLazyComponent(
  () => import('./SettingsScreenContent').then((module) => ({ default: module.SettingsScreenContent })),
)
const RetainedConversationsScreenContent = memo(LazyConversationsScreenContent)
const RetainedHomeScreenContent = memo(HomeScreenContent)
const RetainedSettingsScreenContent = memo(LazySettingsScreenContent)

export type MainPagerPage = 'history' | 'home' | 'settings'

const PAGE_SEQUENCE: readonly MainPagerPage[] = ['history', 'home', 'settings']

const MAIN_PAGER_PATH_BY_PAGE: Readonly<Record<MainPagerPage, string>> = {
  history: '/conversations',
  home: '/',
  settings: '/settings',
}

interface MainPagerShellProps {
  initialPage?: MainPagerPage
}

export function MainPagerShell({ initialPage = 'home' }: MainPagerShellProps) {
  return (
    <MainPagerGestureLockProvider>
      <MainPagerShellInner initialPage={initialPage} />
    </MainPagerGestureLockProvider>
  )
}

function MainPagerShellInner({ initialPage = 'home' }: MainPagerShellProps) {
  const pathname = usePathname()
  const { colors } = useAppTheme()
  const gestureLock = useMainPagerGestureLock()
  const routePage = resolveMainPagerPage(pathname)
  const resolvedInitialPage = routePage ?? initialPage
  const [page, setPage] = useState<MainPagerPage>(resolvedInitialPage)
  const [mountedPages, setMountedPages] = useState<ReadonlySet<MainPagerPage>>(
    () => new Set([resolvedInitialPage]),
  )
  const [previousPage, setPreviousPage] = useState<MainPagerPage | null>(null)
  const [transitionDirection, setTransitionDirection] = useState<ThemeMotionDirection>('neutral')
  const switchToRef = useRef<(next: MainPagerPage) => void>(() => undefined)
  switchToRef.current = switchTo
  const showHome = useCallback(() => switchToRef.current('home'), [])
  const showHistory = useCallback(() => switchToRef.current('history'), [])
  const showSettings = useCallback(() => switchToRef.current('settings'), [])
  const backgroundMode: IsleBackgroundMode = colors.ui.experience.background === 'plain'
    ? 'none'
    : colors.ui.experience.background === 'tonal'
      ? 'surface'
      : colors.ui.experience.background === 'document'
        ? 'ambient'
        : colors.ui.experience.background === 'glass'
          ? 'ambient'
          : 'surface'
  const backgroundState: IsleBackgroundState = gestureLock?.locked ? 'input' : 'idle'

  const pages = [
    {
      id: 'history' as const,
      node: (
        <RetainedConversationsScreenContent
          active={page === 'history'}
          onHome={showHome}
        />
      ),
    },
    {
      id: 'home' as const,
      node: (
        <RetainedHomeScreenContent
          active={page === 'home'}
          embedded
          settingsTransitionActive={false}
          onHistory={showHistory}
          onSettings={showSettings}
        />
      ),
    },
    {
      id: 'settings' as const,
      node: (
        <RetainedSettingsScreenContent onHome={showHome} />
      ),
    },
  ]

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isMainPagerTopLevelPath(pathname)) return false
      if (page === 'home') return false
      switchTo('home')
      return true
    })
    return () => subscription.remove()
  }, [page, pathname])

  return (
    <IsleScreen padded={false} background={backgroundMode} backgroundState={backgroundState} backgroundIntensity={0.96}>
      <View pointerEvents="none" style={[styles.opaqueFallback, { backgroundColor: colors.ui.experience.background === 'plain' ? colors.background.canvas : 'transparent' }]} />
      <View style={{ flex: 1, overflow: 'hidden' }}>
        {pages.map((item) => {
          if (!mountedPages.has(item.id) && item.id !== page) return null
          const active = item.id === page
          const direction = active
            ? transitionDirection
            : item.id === previousPage
              ? reverseMainPagerDirection(transitionDirection)
              : 'neutral'

          return (
            <PagerPage
              key={item.id}
              active={active}
              direction={direction}
            >
              {item.node}
            </PagerPage>
          )
        })}
      </View>
    </IsleScreen>
  )

  function switchTo(next: MainPagerPage) {
    if (next === page) return
    blurActivePagerFocus()
    setMountedPages((current) => current.has(next) ? current : new Set(current).add(next))
    setPreviousPage(page)
    setTransitionDirection(resolveMainPagerDirection(page, next))
    if (next === 'home' && pathname !== MAIN_PAGER_PATH_BY_PAGE.home) {
      router.replace(MAIN_PAGER_PATH_BY_PAGE.home)
      return
    }
    setPage(next)
  }
}

function blurActivePagerFocus(): void {
  if (Platform.OS !== 'web') return
  const documentRef = (globalThis as typeof globalThis & {
    document?: {
      activeElement?: { blur?: () => void } | null
      body?: unknown
    }
  }).document
  const activeElement = documentRef?.activeElement
  if (!activeElement || activeElement === documentRef?.body) return
  activeElement.blur?.()
}

function PagerPage({
  active,
  children,
  direction,
}: {
  active: boolean
  children: React.ReactNode
  direction: ThemeMotionDirection
}) {
  return (
    <IsleMotionFrame
      role="page"
      active={active}
      direction={direction}
      aria-hidden={!active}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      pointerEvents={active ? 'auto' : 'none'}
      style={[styles.page, { zIndex: active ? 2 : 1 }]}
    >
      {children}
    </IsleMotionFrame>
  )
}

function resolveMainPagerDirection(current: MainPagerPage, next: MainPagerPage): ThemeMotionDirection {
  const currentIndex = PAGE_SEQUENCE.indexOf(current)
  const nextIndex = PAGE_SEQUENCE.indexOf(next)
  if (currentIndex === nextIndex) return 'neutral'
  return nextIndex > currentIndex ? 'forward' : 'backward'
}

function reverseMainPagerDirection(direction: ThemeMotionDirection): ThemeMotionDirection {
  if (direction === 'forward') return 'backward'
  if (direction === 'backward') return 'forward'
  return 'neutral'
}

function resolveMainPagerPage(pathname: string): MainPagerPage | null {
  return PAGE_SEQUENCE.find((page) => MAIN_PAGER_PATH_BY_PAGE[page] === pathname) ?? null
}

function isMainPagerTopLevelPath(pathname: string): boolean {
  return resolveMainPagerPage(pathname) !== null
}

const styles = StyleSheet.create({
  opaqueFallback: {
    ...StyleSheet.absoluteFill,
  },
  page: {
    ...StyleSheet.absoluteFill,
  },
})
