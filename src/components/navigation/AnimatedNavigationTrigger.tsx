import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { IsleIconButton, IsleListItem, type IsleSize, type IsleTone } from '@/components/ui/isle/Primitives'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { AnimatedNavigationIcon, type NavigationGlyph } from './AnimatedNavigationIcon'

export const NAVIGATION_TRIGGER_DURATION_MS = 230
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
  const [active, setActive] = useState(false)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    navigateRef.current = onNavigate
  }, [onNavigate])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const finish = useCallback(() => {
    runningRef.current = false
    if (!mountedRef.current) return
    setRunning(false)
    setActive(false)
  }, [])

  const trigger = useCallback(() => {
    if (runningRef.current) return

    if (motion !== 'full') {
      void Promise.resolve(navigateRef.current())
      return
    }

    runningRef.current = true
    setRunning(true)
    setActive(true)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      Promise.resolve(navigateRef.current()).finally(finish)
    }, durationMs)
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
      accentColor={props.accentColor ?? colors.primary}
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
    <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintSoft }}>
      {children}
    </View>
  )
}
