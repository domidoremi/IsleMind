import { useEffect, useMemo, useState } from 'react'
import { BackHandler, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { MotiView } from 'moti'
import { IsleScreen } from '@/components/ui/isle'
import { ConversationsScreenContent } from './ConversationsScreenContent'
import { HomeScreenContent } from './HomeScreenContent'
import { SettingsScreenContent } from './SettingsScreenContent'
import { MainPagerGestureLockProvider, useMainPagerGestureLock } from './MainPagerGestureLock'

export type MainPagerPage = 'history' | 'home' | 'settings'

const PAGE_INDEX: Record<MainPagerPage, number> = {
  history: -1,
  home: 0,
  settings: 1,
}

const PAGE_BY_INDEX: Record<number, MainPagerPage> = {
  [-1]: 'history',
  0: 'home',
  1: 'settings',
}

const SWIPE_PAGE_THRESHOLD = 0.18
const SWIPE_VELOCITY_THRESHOLD = 520

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
  const { width } = useWindowDimensions()
  const gestureLock = useMainPagerGestureLock()
  const [page, setPage] = useState<MainPagerPage>(initialPage)
  const pageValue = useSharedValue(PAGE_INDEX[initialPage])
  const pageIndex = useSharedValue(PAGE_INDEX[initialPage])
  const dragX = useSharedValue(0)
  const gestureSettled = useSharedValue(false)
  const pages = useMemo(
    () => [
      { id: 'history' as const, index: -1, node: <ConversationsScreenContent onHome={() => switchTo('home')} onSettings={() => switchTo('settings')} /> },
      { id: 'home' as const, index: 0, node: <HomeScreenContent embedded onHistory={() => switchTo('history')} onSettings={() => switchTo('settings')} /> },
      { id: 'settings' as const, index: 1, node: <SettingsScreenContent onHome={() => switchTo('home')} /> },
    ],
    []
  )

  useEffect(() => {
    switchTo(initialPage)
  }, [initialPage])

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page !== 'home') {
        switchTo('home')
        return true
      }
      return false
    })
    return () => subscription.remove()
  }, [page])

  function switchTo(next: MainPagerPage) {
    setPage(next)
    const nextIndex = PAGE_INDEX[next]
    pageIndex.value = nextIndex
    pageValue.value = withSpring(nextIndex, {
      damping: 24,
      stiffness: 190,
      mass: 0.9,
    })
  }

  function settleToIndex(targetIndex: -1 | 0 | 1) {
    switchTo(PAGE_BY_INDEX[targetIndex])
  }

  const pan = Gesture.Pan()
    .enabled(!gestureLock?.locked)
    .activeOffsetX([-14, 14])
    .failOffsetY([-80, 80])
    .cancelsTouchesInView(false)
    .onBegin(() => {
      gestureSettled.value = false
    })
    .onUpdate((event) => {
      dragX.value = event.translationX
      const dragProgress = Math.max(-1, Math.min(1, event.translationX / Math.max(width, 1)))
      const nextValue = pageIndex.value - dragProgress
      pageValue.value = Math.max(-1, Math.min(1, nextValue))
    })
    .onEnd((event) => {
      gestureSettled.value = true
      dragX.value = 0
      const dragProgress = event.translationX / Math.max(width, 1)
      const shouldMove = Math.abs(dragProgress) >= SWIPE_PAGE_THRESHOLD || Math.abs(event.velocityX) >= SWIPE_VELOCITY_THRESHOLD
      const direction = shouldMove ? (event.translationX < 0 || event.velocityX < -SWIPE_VELOCITY_THRESHOLD ? 1 : -1) : 0
      const targetIndex = Math.max(-1, Math.min(1, pageIndex.value + direction)) as -1 | 0 | 1
      runOnJS(settleToIndex)(targetIndex)
    })
    .onFinalize(() => {
      dragX.value = 0
      if (!gestureSettled.value) {
        pageValue.value = withSpring(pageIndex.value, { damping: 24, stiffness: 190 })
      }
    })

  return (
    <IsleScreen padded={false}>
      <GestureDetector gesture={pan}>
        <Animated.View style={{ flex: 1 }}>
          {pages.map((item) => (
            <PagerPage key={item.id} pageIndex={item.index} pageValue={pageValue} width={width}>
              {item.node}
            </PagerPage>
          ))}
        </Animated.View>
      </GestureDetector>
    </IsleScreen>
  )
}

function PagerPage({
  pageIndex,
  pageValue,
  width,
  children,
}: {
  pageIndex: number
  pageValue: SharedValue<number>
  width: number
  children: React.ReactNode
}) {
  const style = useAnimatedStyle(() => {
    const delta = pageIndex - pageValue.value
    return {
      transform: [
        { translateX: delta * width },
        { scale: interpolate(Math.abs(delta), [0, 1], [1, 0.985], Extrapolation.CLAMP) },
      ],
      opacity: interpolate(Math.abs(delta), [0, 0.8, 1.2], [1, 0.72, 0.32], Extrapolation.CLAMP),
      zIndex: Math.round(10 - Math.abs(delta) * 2),
    }
  }, [pageIndex, width])

  return (
    <Animated.View style={[{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, style]}>
      {children}
    </Animated.View>
  )
}
