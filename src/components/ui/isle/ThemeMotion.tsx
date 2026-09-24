import type { ReactNode } from 'react'
import { Platform, type StyleProp, type ViewProps, type ViewStyle } from 'react-native'
import { MotiView } from 'moti'

import { useThemeMotion } from '@/hooks/useThemeMotion'
import {
  type MotionIntensity,
  type ThemeMotionDirection,
  type ThemeMotionRole,
} from '@/theme/themeMotion'
import type { ThemeId } from '@/types/settingsContracts'
import { GlassSurfaceActivity } from './GlassSurface'

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

  const frame = (
    <MotiView
      aria-hidden={ariaHidden ?? accessibilityElementsHidden}
      {...nativeAccessibilityProps}
      importantForAccessibility={importantForAccessibility}
      pointerEvents={pointerEvents}
      testID={testID}
      from={active ? resolved.from : resolved.exit}
      animate={active ? resolved.animate : resolved.exit}
      exit={resolved.exit}
      transition={resolved.transition}
      style={style}
    >
      {children}
    </MotiView>
  )
  return role === 'page' ? <GlassSurfaceActivity active={active}>{frame}</GlassSurfaceActivity> : frame
}
