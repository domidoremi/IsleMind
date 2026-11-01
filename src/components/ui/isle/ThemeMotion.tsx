import { useMemo, type ReactNode } from 'react'
import { Platform, type StyleProp, type ViewProps, type ViewStyle } from 'react-native'
import { MotiView } from 'moti'
import { LinearTransition, ReduceMotion } from 'react-native-reanimated'

import { useThemeMotion } from '@/hooks/useThemeMotion'
import {
  type MotionIntensity,
  type ThemeMotionDirection,
  type ThemeMotionRole,
} from '@/theme/themeMotion'
import type { ThemeId } from '@/types/settingsContracts'
import { GlassSurfaceActivity } from './GlassSurface'

const STILL_TRANSITION = { type: 'timing' as const, duration: 0, delay: 0 }

export interface IsleMotionFrameProps extends Pick<
  ViewProps,
  'accessibilityElementsHidden' | 'importantForAccessibility' | 'pointerEvents' | 'testID'
> {
  children?: ReactNode
  role: ThemeMotionRole
  active?: boolean
  direction?: ThemeMotionDirection
  order?: number
  motion?: MotionIntensity
  themeId?: ThemeId
  readable?: boolean
  layout?: boolean
  enter?: boolean
  style?: StyleProp<ViewStyle>
  'aria-hidden'?: boolean
}

export function IsleMotionFrame({
  children,
  role,
  active = true,
  direction = 'neutral',
  order = 0,
  motion,
  themeId,
  readable = role === 'page' || role === 'section' || role === 'overlay',
  layout = false,
  enter = true,
  style,
  accessibilityElementsHidden,
  importantForAccessibility,
  pointerEvents,
  testID,
  'aria-hidden': ariaHidden,
}: IsleMotionFrameProps) {
  const resolved = useThemeMotion(role, {
    themeId,
    motion,
    direction,
    order,
    readable,
  })
  const nativeAccessibilityProps = Platform.OS === 'web'
    ? {}
    : { accessibilityElementsHidden }
  const layoutTransition = useMemo(() => (
    layout && resolved.intensity === 'full'
      ? LinearTransition.duration(Math.min(200, resolved.transition.duration)).reduceMotion(ReduceMotion.System)
      : undefined
  ), [layout, resolved.intensity, resolved.transition.duration])

  const frame = (
    <MotiView
      aria-hidden={ariaHidden ?? accessibilityElementsHidden}
      {...nativeAccessibilityProps}
      importantForAccessibility={importantForAccessibility}
      pointerEvents={pointerEvents}
      testID={testID}
      from={resolved.intensity === 'none' || !enter ? undefined : active ? resolved.from : resolved.exit}
      animate={active ? resolved.animate : resolved.exit}
      exit={resolved.exit}
      transition={resolved.intensity === 'none' ? STILL_TRANSITION : resolved.transition}
      layout={layoutTransition}
      style={style}
    >
      {children}
    </MotiView>
  )
  return role === 'page' ? <GlassSurfaceActivity active={active}>{frame}</GlassSurfaceActivity> : frame
}
