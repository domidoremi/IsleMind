import { useEffect, useMemo, useRef, useState } from 'react'
import { BackHandler, StyleSheet, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Extrapolation,
  interpolate,
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
import { useSettingsStore } from '@/store/settingsStore'
import { ConversationsScreenContent } from './ConversationsScreenContent'
import { HomeScreenContent } from './HomeScreenContent'
import { SettingsScreenContent } from './SettingsScreenContent'
import { MainPagerGestureLockProvider, useMainPagerGestureLock } from './MainPagerGestureLock'

export type MainPagerPage = 'history' | 'home' | 'settings'
export type MainPagerTransitionStyle = 'state' | 'classic'

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
const PAGE_SETTLE_SPRING = {
  damping: 24,
  stiffness: 190,
  mass: 0.9,
}
const REDUCED_MOTION_SETTLE_MS = 90
const SETTINGS_TRANSITION_SPIN_MS = 420
const SETTINGS_TRANSITION_RELEASE_MS = 110
const SETTINGS_TRANSITION_SETTLE_MS = 560

type SettingsTransitionPhase = 'spin' | 'release' | 'enter'

interface MainPagerShellProps {
  initialPage?: MainPagerPage
  transitionStyle?: MainPagerTransitionStyle
}

export function MainPagerShell({ initialPage = 'home', transitionStyle = 'state' }: MainPagerShellProps) {
  return (
    <MainPagerGestureLockProvider>
      <MainPagerShellInner initialPage={initialPage} transitionStyle={transitionStyle} />
    </MainPagerGestureLockProvider>
  )
}

function MainPagerShellInner({ initialPage = 'home', transitionStyle = 'state' }: MainPagerShellProps) {
  const { width } = useWindowDimensions()
  const pathname = usePathname()
  const gestureLock = useMainPagerGestureLock()
  const pageTransitionStyle = useSettingsStore((state) => state.settings.pageTransitionStyle ?? transitionStyle)
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
  const backgroundMode: IsleBackgroundMode = settingsTransitionActive ? 'surface' : page === 'settings' ? 'surface' : page === 'home' ? 'focus' : 'default'
  const backgroundState: IsleBackgroundState = gestureLock?.locked ? 'input' : settingsTransitionActive ? 'active' : page === 'settings' ? 'idle' : 'active'
  const pages = useMemo(
    () => [
      { id: 'history' as const, index: -1, node: <ConversationsScreenContent onHome={() => switchTo('home')} onSettings={() => switchTo('settings')} /> },
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
        pageValue.value = motionFull
          ? withSpring(pageIndex.value, PAGE_SETTLE_SPRING)
          : withTiming(pageIndex.value, { duration: REDUCED_MOTION_SETTLE_MS })
      }
    })

  return (
    <IsleScreen padded={false} background={backgroundMode} backgroundState={backgroundState} backgroundIntensity={settingsTransitionActive ? 1.12 : page === 'home' ? 0.9 : 1}>
      <SettingsTransitionWash active={settingsTransitionActive} motionFull={motionFull} />
      <GestureDetector gesture={pan}>
        <Animated.View pointerEvents={settingsTransitionActive ? 'none' : 'auto'} style={{ flex: 1 }}>
          {pages.map((item) => (
            <PagerPage key={item.id} pageIndex={item.index} pageValue={pageValue} width={width} motionFull={motionFull} transitionStyle={pageTransitionStyle}>
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
            <Stop offset="0%" stopColor={colors.background.focusCanvas} stopOpacity={0.04} />
            <Stop offset="44%" stopColor={colors.background.mist.primary} stopOpacity={0.22} />
            <Stop offset="72%" stopColor={colors.background.trace.accent} stopOpacity={0.12} />
            <Stop offset="100%" stopColor={colors.background.surfaceCanvas} stopOpacity={0.38} />
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
  motionFull,
  transitionStyle,
  children,
}: {
  pageIndex: number
  pageValue: SharedValue<number>
  width: number
  motionFull: boolean
  transitionStyle: MainPagerTransitionStyle
  children: React.ReactNode
}) {
  const style = useAnimatedStyle(() => {
    const delta = pageIndex - pageValue.value
    const absDelta = Math.abs(delta)
    if (!motionFull) {
      if (transitionStyle === 'state') {
        return {
          transform: [{ translateY: interpolate(absDelta, [0, 1], [0, 4], Extrapolation.CLAMP) }],
          opacity: interpolate(absDelta, [0, 0.5, 1], [1, 0.36, 0], Extrapolation.CLAMP),
          zIndex: Math.round(10 - absDelta * 2),
        }
      }
      return {
        transform: [{ translateX: delta * width }],
        opacity: interpolate(absDelta, [0, 1], [1, 0.92], Extrapolation.CLAMP),
        zIndex: Math.round(10 - absDelta * 2),
      }
    }

    if (transitionStyle === 'state') {
      return {
        transform: [
          { translateY: interpolate(absDelta, [0, 1], [0, 16], Extrapolation.CLAMP) },
          { scale: interpolate(absDelta, [0, 0.6, 1], [1, 0.986, 0.97], Extrapolation.CLAMP) },
        ],
        opacity: interpolate(absDelta, [0, 0.42, 0.86], [1, 0.34, 0], Extrapolation.CLAMP),
        zIndex: Math.round(20 - absDelta * 8),
      }
    }

    return {
      transform: [
        { translateX: delta * width },
        { translateY: interpolate(absDelta, [0, 1], [0, 10], Extrapolation.CLAMP) },
        { scale: interpolate(absDelta, [0, 0.6, 1.12], [1, 0.982, 0.946], Extrapolation.CLAMP) },
      ],
      opacity: interpolate(absDelta, [0, 0.56, 1.14], [1, 0.86, 0.24], Extrapolation.CLAMP),
      zIndex: Math.round(20 - absDelta * 8),
    }
  }, [motionFull, pageIndex, transitionStyle, width])

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
