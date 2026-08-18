import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { IsleIconButton, IsleListItem, type IsleSize, type IsleTone } from '@/components/ui/isle/Primitives'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { AnimatedNavigationIcon, type NavigationGlyph } from './AnimatedNavigationIcon'
export const NAVIGATION_TRIGGER_DURATION_MS = 224
export type { NavigationGlyph } from './AnimatedNavigationIcon'

type NavigateHandler = () => void | Promise<void>

interface NavigationTriggerOptions {
  durationMs?: number
}

export function useNavigationTrigger(onNavigate: NavigateHandler, options: NavigationTriggerOptions = {}) {
  const motion = useMotionPreference()
  const durationMs = options.durationMs ?? NAVIGATION_TRIGGER_DURATION_MS
  const navigateRef = useRef(onNavigate)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const runningRef = useRef(false)
  const runIdRef = useRef(0)
  const [active, setActive] = useState(false)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    navigateRef.current = onNavigate
  }, [onNavigate])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      runIdRef.current += 1
      runningRef.current = false
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const finish = useCallback((runId: number) => {
    if (runIdRef.current !== runId) return
    clearTimer()
    runningRef.current = false
    if (!mountedRef.current) return
    setRunning(false)
    setActive(false)
  }, [clearTimer])

  const trigger = useCallback(() => {
    if (runningRef.current) return

    const runId = runIdRef.current + 1
    runIdRef.current = runId
    runningRef.current = true
    setRunning(true)
    if (motion === 'full') setActive(true)

    let navigationResult: void | Promise<void>
    try {
      // Navigation is the primary action; the icon feedback runs alongside it.
      navigationResult = navigateRef.current()
    } catch {
      finish(runId)
      return
    }

    if (motion === 'full') {
      if (mountedRef.current && runIdRef.current === runId) {
        timerRef.current = setTimeout(() => finish(runId), durationMs)
      }
      // A rejected transition must not leave the trigger permanently busy.
      void Promise.resolve(navigationResult).catch(() => finish(runId))
      return
    }

    // Reduced motion has no artificial delay, but still fences rapid duplicate taps
    // while an async navigation transition is in flight.
    void Promise.resolve(navigationResult).then(
      () => finish(runId),
      () => finish(runId),
    )
  }, [durationMs, finish, motion])

  return { active, running, trigger }
}

type AnimatedNavigationTriggerProps =
  | {
      variant: 'iconButton'
      label: string
      glyph: NavigationGlyph
      onNavigate: NavigateHandler
      color?: string
      accentColor?: string
      externalActive?: boolean
      durationMs?: number
      disabled?: boolean
      size?: IsleSize
      tone?: IsleTone
      style?: StyleProp<ViewStyle>
    }
  | {
      variant: 'listItem'
      title: string
      description?: string
      glyph: NavigationGlyph
      onNavigate: NavigateHandler
      color?: string
      accentColor?: string
      externalActive?: boolean
      durationMs?: number
      trailing?: ReactNode
      danger?: boolean
      style?: StyleProp<ViewStyle>
    }

export function AnimatedNavigationTrigger(props: AnimatedNavigationTriggerProps) {
  const { colors } = useAppTheme()
  const { active, running, trigger } = useNavigationTrigger(props.onNavigate, { durationMs: props.durationMs })
  const color = props.color ?? colors.text
  const icon = (
    <AnimatedNavigationIcon
      glyph={props.glyph}
      active={active || props.externalActive}
      color={color}
      accentColor={props.accentColor ?? colors.ui.icon.accentForeground}
      size={props.variant === 'iconButton' && props.size === 'lg' ? 23 : 22}
    />
  )

  if (props.variant === 'iconButton') {
    return (
      <IsleIconButton
        label={props.label}
        size={props.size}
        tone={props.tone}
        disabled={props.disabled || running}
        onPress={trigger}
        style={props.style}
      >
        {icon}
      </IsleIconButton>
    )
  }

  return (
    <IsleListItem
      title={props.title}
      description={props.description}
      leading={<NavigationIconBadge>{icon}</NavigationIconBadge>}
      trailing={props.trailing}
      danger={props.danger}
      onPress={trigger}
      style={props.style}
    />
  )
}

export function NavigationIconBadge({ children }: { children: ReactNode }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ width: 40, height: 40, borderRadius: colors.ui.radius.controlLarge, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.minimal ? 'transparent' : colors.ui.icon.accentBackground }}>
      {children}
    </View>
  )
}
