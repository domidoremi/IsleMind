import { Pressable, type PressableProps } from 'react-native'
import { PressableScale } from '@/components/ui/PressableScale'

import { useAppTheme } from '@/hooks/useAppTheme'
import { resolveThemeExpression } from '@/theme/themeExpression'

export function IslePressable(props: Parameters<typeof PressableScale>[0]) {
  const { canonicalThemeId } = useAppTheme()
  const interactionProfile = resolveThemeExpression(canonicalThemeId).motion.grammar

  return <PressableScale interactionProfile={interactionProfile} {...props} />
}

export function IsleOverlayPressable(props: PressableProps) {
  const { canonicalThemeId, isLiquidGlass } = useAppTheme()
  const accessibilityState = props.disabled
    ? { ...props.accessibilityState, disabled: true }
    : props.accessibilityState
  if (props.accessible !== false && props.accessibilityRole !== 'none') {
    const profile = resolveThemeExpression(canonicalThemeId ?? (isLiquidGlass ? 'liquid-glass' : 'minimal')).motion.grammar
    return <PressableScale interactionProfile={profile} {...props} accessibilityState={accessibilityState} />
  }
  return <Pressable accessibilityRole="button" {...props} accessibilityState={accessibilityState} />
}
