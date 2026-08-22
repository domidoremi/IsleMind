import type { ReactNode } from 'react'
import type { StyleProp, ViewProps, ViewStyle } from 'react-native'
import { MotiView } from 'moti'

import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference, type MotionIntensity } from '@/hooks/useMotionPreference'
import {
  resolveThemeMotion,
  type ThemeMotionDirection,
  type ThemeMotionRole,
} from '@/theme/themeMotion'
import type { ThemeId } from '@/types/settingsContracts'

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
  style,
  accessibilityElementsHidden,
  importantForAccessibility,
  pointerEvents,
  testID,
  'aria-hidden': ariaHidden,
}: IsleMotionFrameProps) {
  const appTheme = useAppTheme()
  const preferredMotion = useMotionPreference()
  const resolved = resolveThemeMotion({
    // New motion consumers default to the four-family runtime identity. The
    // optional prop preserves legacy callers that intentionally pass an alias.
    themeId: themeId ?? appTheme.canonicalThemeId,
    role,
    intensity: motion ?? preferredMotion,
    direction,
    order,
  })

  return (
    <MotiView
      aria-hidden={ariaHidden}
      accessibilityElementsHidden={accessibilityElementsHidden}
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
}
