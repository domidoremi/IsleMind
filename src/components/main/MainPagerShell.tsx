import { useEffect, useMemo, useRef, useState } from 'react'
import { BackHandler, StyleSheet, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { usePathname } from 'expo-router'
import { MotiView } from 'moti'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { IsleScreen, type IsleBackgroundMode, type IsleBackgroundState } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
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
const PAGER_ACTIVE_HORIZONTAL_OFFSET = 18
const PAGER_FAIL_VERTICAL_OFFSET = 36
const PAGER_HORIZONTAL_DOMINANCE_RATIO = 1.35
const PAGER_MIN_HORIZONTAL_DRAG = 24
const PAGE_SETTLE_SPRING = {
  damping: 28,
  stiffness: 220,
  mass: 0.86,
}
const REDUCED_MOTION_SETTLE_MS = 90
const SETTINGS_TRANSITION_SPIN_MS = 420
const SETTINGS_TRANSITION_RELEASE_MS = 110
const SETTINGS_TRANSITION_SETTLE_MS = 560

type SettingsTransitionPhase = 'spin' | 'release' | 'enter'

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
  const pathname = usePathname()
  const gestureLock = useMainPagerGestureLock()
  const motion = useMotionPreference()
  const motionFull = motion === 'full'
  const [page, setPage] = useState<MainPagerPage>(initialPage)
  const [settingsTransitionPhase, setSettingsTransitionPhase] = useState<SettingsTransitionPhase | null>(null)
  const settingsTransitionRunning = useRef(false)
  const settingsTransitionTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const pageValue = useSharedValue(PAGE_INDEX[initialPage])
  const pageIndex = useSharedValue(PAGE_INDEX[initialPage])
  const dragX = useSharedValue(0)
  const gestureSettled = useSharedValue(false)
  const settingsTransitionActive = settingsTransitionPhase !== null
  const backgroundMode: IsleBackgroundMode = settingsTransitionActive ? 'surface' : page === 'settings' ? 'surface' : page === 'home' ? 'focus' : 'surface'
  const backgroundState: IsleBackgroundState = gestureLock?.locked ? 'input' : settingsTransitionActive ? 'active' : 'idle'
  const pages = useMemo(
    () => [
      { id: 'history' as const, index: -1, node: <ConversationsScreenContent active={page === 'history'} onHome={() => switchTo('home')} onSettings={() => switchTo('settings')} /> },
      { id: 'home' as const, index: 0, node: <HomeScreenContent embedded settingsTransitionActive={settingsTransitionPhase === 'spin'} onHistory={() => switchTo('history')} onSettings={startHomeSettingsTransition} /> },
      { id: 'settings' as const, index: 1, node: <SettingsScreenContent active={page === 'settings'} onHome={() => switchTo('home')} /> },
    ],
    [motionFull, page, settingsTransitionPhase]
  )

  useEffect(() => {
    clearSettingsTransition()
    switchTo(initialPage)
  }, [initialPage])

  useEffect(() => clearSettingsTransitionTimers, [])

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isMainPagerTopLevelPath(pathname)) return false
      if (settingsTransitionActive) return true
      if (page !== 'home') {
        switchTo('home')
        return true
      }
      return false
    })
    return () => subscription.remove()
  }, [motionFull, page, pathname, settingsTransitionActive])

  function switchTo(next: MainPagerPage) {
    setPage(next)
    const nextIndex = PAGE_INDEX[next]
    pageIndex.value = nextIndex
    pageValue.value = motionFull
      ? withSpring(nextIndex, PAGE_SETTLE_SPRING)
      : withTiming(nextIndex, { duration: REDUCED_MOTION_SETTLE_MS })
  }

  function clearSettingsTransitionTimers() {
    settingsTransitionTimers.current.forEach((timer) => clearTimeout(timer))
    settingsTransitionTimers.current = []
  }

  function clearSettingsTransition() {
    clearSettingsTransitionTimers()
    settingsTransitionRunning.current = false
    setSettingsTransitionPhase(null)
  }

  function startHomeSettingsTransition() {
    if (settingsTransitionRunning.current || settingsTransitionActive) return
    if (page !== 'home') {
      switchTo('settings')
      return
    }

    clearSettingsTransitionTimers()
    settingsTransitionRunning.current = true
    setSettingsTransitionPhase('spin')

    const spinMs = motionFull ? SETTINGS_TRANSITION_SPIN_MS : REDUCED_MOTION_SETTLE_MS
    const releaseMs = motionFull ? SETTINGS_TRANSITION_RELEASE_MS : 1
    const settleMs = motionFull ? SETTINGS_TRANSITION_SETTLE_MS : REDUCED_MOTION_SETTLE_MS

    const releaseTimer = setTimeout(() => {
      setSettingsTransitionPhase('release')
      const enterTimer = setTimeout(() => {
        setSettingsTransitionPhase('enter')
        switchTo('settings')
        const settleTimer = setTimeout(() => {
          clearSettingsTransition()
        }, settleMs)
        settingsTransitionTimers.current.push(settleTimer)
      }, releaseMs)
      settingsTransitionTimers.current.push(enterTimer)
    }, spinMs)
    settingsTransitionTimers.current.push(releaseTimer)
  }

  function settleToIndex(targetIndex: -1 | 0 | 1) {
    switchTo(PAGE_BY_INDEX[targetIndex])
  }

  const pan = Gesture.Pan()
    .enabled(!gestureLock?.locked && !settingsTransitionActive)
    .activeOffsetX([-PAGER_ACTIVE_HORIZONTAL_OFFSET, PAGER_ACTIVE_HORIZONTAL_OFFSET])
    .failOffsetY([-PAGER_FAIL_VERTICAL_OFFSET, PAGER_FAIL_VERTICAL_OFFSET])
    .cancelsTouchesInView(false)
    .onBegin(() => {
      gestureSettled.value = false
    })
    .onUpdate((event) => {
      const absX = Math.abs(event.translationX)
      const absY = Math.abs(event.translationY)
      const horizontalDominant = absX >= PAGER_MIN_HORIZONTAL_DRAG && absX >= absY * PAGER_HORIZONTAL_DOMINANCE_RATIO
      if (!horizontalDominant) {
        pageValue.value = pageIndex.value
        return
      }

      dragX.value = event.translationX
      const dragProgress = Math.max(-1, Math.min(1, event.translationX / Math.max(width, 1)))
      const nextValue = pageIndex.value - dragProgress
      pageValue.value = Math.max(-1, Math.min(1, nextValue))
    })
    .onEnd((event) => {
      gestureSettled.value = true
      dragX.value = 0
      const absX = Math.abs(event.translationX)
      const absY = Math.abs(event.translationY)
      const absVelocityX = Math.abs(event.velocityX)
      const absVelocityY = Math.abs(event.velocityY)
      const horizontalDominant = absX >= PAGER_MIN_HORIZONTAL_DRAG && absX >= absY * PAGER_HORIZONTAL_DOMINANCE_RATIO
      const velocityHorizontal = absVelocityX >= SWIPE_VELOCITY_THRESHOLD && absVelocityX >= absVelocityY * PAGER_HORIZONTAL_DOMINANCE_RATIO
      const dragProgress = event.translationX / Math.max(width, 1)
      const shouldMove = (horizontalDominant && Math.abs(dragProgress) >= SWIPE_PAGE_THRESHOLD) || velocityHorizontal
      const direction = shouldMove ? (event.translationX < 0 || event.velocityX < -SWIPE_VELOCITY_THRESHOLD ? 1 : -1) : 0
      const targetIndex = Math.max(-1, Math.min(1, pageIndex.value + direction)) as -1 | 0 | 1
      runOnJS(settleToIndex)(targetIndex)
    })
    .onFinalize(() => {
      dragX.value = 0
      if (!gestureSettled.value) {
        pageValue.value = motionFull
          ? withSpring(pageIndex.value, PAGE_SETTLE_SPRING)
          : withTiming(pageIndex.value, { duration: REDUCED_MOTION_SETTLE_MS })
      }
    })

  return (
    <IsleScreen padded={false} background={backgroundMode} backgroundState={backgroundState} backgroundIntensity={settingsTransitionActive ? 1.04 : page === 'home' ? 0.88 : 0.96}>
      <SettingsTransitionWash active={settingsTransitionActive} motionFull={motionFull} />
      <GestureDetector gesture={pan}>
        <Animated.View pointerEvents={settingsTransitionActive ? 'none' : 'auto'} style={{ flex: 1 }}>
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

function SettingsTransitionWash({ active, motionFull }: { active: boolean; motionFull: boolean }) {
  const { colors } = useAppTheme()

  return (
    <MotiView
      pointerEvents="none"
      animate={{
        opacity: active ? 1 : 0,
        translateX: active ? 0 : -24,
        scale: active ? 1 : 1.015,
      }}
      transition={{ type: 'timing', duration: motionFull ? 260 : 1 }}
      style={styles.transitionWash}
    >
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="settingsTransitionWash" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={colors.background.focusCanvas} stopOpacity={0.02} />
            <Stop offset="44%" stopColor={colors.background.mist.primary} stopOpacity={0.14} />
            <Stop offset="72%" stopColor={colors.background.trace.accent} stopOpacity={0.08} />
            <Stop offset="100%" stopColor={colors.background.surfaceCanvas} stopOpacity={0.24} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="390" height="844" fill="url(#settingsTransitionWash)" />
      </Svg>
    </MotiView>
  )
}

function isMainPagerTopLevelPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/settings' || pathname === '/conversations'
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
      transform: [{ translateX: delta * width }],
      zIndex: Math.round(20 - Math.abs(delta) * 8),
    }
  }, [pageIndex, width])

  return (
    <Animated.View style={[{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, style]}>
      {children}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  transitionWash: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
})
