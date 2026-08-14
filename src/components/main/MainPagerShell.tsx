import { useEffect, useState } from 'react'
import { BackHandler, StyleSheet, View } from 'react-native'
import { usePathname } from 'expo-router'

import { IsleScreen, type IsleBackgroundMode, type IsleBackgroundState } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

import { ConversationsScreenContent } from './ConversationsScreenContent'
import { HomeScreenContent } from './HomeScreenContent'
import { MainPagerGestureLockProvider, useMainPagerGestureLock } from './MainPagerGestureLock'
import { SettingsScreenContent } from './SettingsScreenContent'

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
  const backgroundMode: IsleBackgroundMode = colors.ui.experience.background === 'road'
    ? 'surface'
    : colors.ui.experience.background === 'document'
      ? 'ambient'
      : 'none'
  const backgroundState: IsleBackgroundState = gestureLock?.locked ? 'input' : 'idle'

  const pages = [
    {
      id: 'history' as const,
      node: (
        <ConversationsScreenContent
          active={page === 'history'}
          onHome={() => switchTo('home')}
          onSettings={() => switchTo('settings')}
        />
      ),
    },
    {
      id: 'home' as const,
      node: (
        <HomeScreenContent
          active={page === 'home'}
          embedded
          settingsTransitionActive={false}
          onHistory={() => switchTo('history')}
          onSettings={() => switchTo('settings')}
        />
      ),
    },
    {
      id: 'settings' as const,
      node: (
        <SettingsScreenContent
          active={page === 'settings'}
          onHome={() => switchTo('home')}
        />
      ),
    },
  ]

  useEffect(() => {
    const nextPage = resolveMainPagerPage(pathname) ?? initialPage
    if (nextPage !== page) setPage(nextPage)
  }, [initialPage, pathname])

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isMainPagerTopLevelPath(pathname)) return false
      if (page === 'home') return false
      switchTo('home')
      return true
    })
    return () => subscription.remove()
  }, [page, pathname])

  function switchTo(next: MainPagerPage) {
    if (next !== page) setPage(next)
  }

  return (
    <IsleScreen padded={false} background={backgroundMode} backgroundState={backgroundState} backgroundIntensity={0.96}>
      <View pointerEvents="none" style={[styles.opaqueFallback, { backgroundColor: colors.ui.experience.background === 'plain' ? colors.background.surfaceCanvas : 'transparent' }]} />
      <View style={{ flex: 1, overflow: 'hidden' }}>
        {pages.map((item) => (
          <PagerPage
            key={item.id}
            active={item.id === page}
          >
            {item.node}
          </PagerPage>
        ))}
      </View>
    </IsleScreen>
  )
}

function PagerPage({
  active,
  children,
}: {
  active: boolean
  children: React.ReactNode
}) {
  return (
    <View
      aria-hidden={!active}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      pointerEvents={active ? 'auto' : 'none'}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        opacity: active ? 1 : 0,
        zIndex: active ? 2 : 1,
      }}
    >
      {children}
    </View>
  )
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
})
